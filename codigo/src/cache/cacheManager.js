/* cache/cacheManager.js — topic 48: stores and the CacheManager (reuse + freshness; priority and cancellation stay with the
   LoadCoordinator of topic 47, which calls cache.load()).
   MemoryCacheStore (L1: parsed objects, LRU by approximate size, pinning of active resources) · key-value backends (memory,
   IndexedDB `ws-cache-l2`, separate from offline.js `ws-cache` so its v1 schema is untouched) · PersistentCacheStore (L2:
   stage → validate → commit in one transaction; leftovers of an interrupted write are removed, the old good entry stays) ·
   CacheManager.load(key, loader) with the strategies of the registry (immutable versioned, network-first with labelled
   stale fallback, SWR single-flight, memory-only, network-only, no-cache), ETag/304, checksum integrity and corruption
   recovery, schema migration or invalidation, selective invalidation by structured selector and by domain event,
   logout / tenant switch / permission revision / share revocation / privacy deletion purges, quota + eviction, maintenance,
   capability detection, multi-tab coherence (metadata only) with focus/reconnect revalidation, metrics and diagnostics.
   A cache failure never takes the app down: persistent errors degrade to memory + network. */
App.cache = App.cache || {};
App.cache.manager = (() => {
  const C = App.cache.core, RS = App.loading.resources;
  const SENSITIVE = new Set(['CUSTOMER_SENSITIVE', 'RESTRICTED']);
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  /** loader answer with metadata: envelope(value, { etag, checksum, resourceVersion, dependencyFingerprint, partial, metadata }); { notModified: true } for a 304 */
  const envelope = (value, meta = {}) => ({ ...meta, value, cacheEnvelope: 1 });
  const isEnv = r => !!(r && typeof r === 'object' && r.cacheEnvelope === 1);

  // ---------------------------------------------------------------- L1
  function MemoryCacheStore({ maxBytes = 30e6, now = () => Date.now() } = {}) {
    const m = new Map(); let bytes = 0, evicted = 0;
    const touch = e => { e.lastAccessedAt = new Date(now()).toISOString(); };
    function put(entry) {
      const k = C.serializeCacheKey(entry.key), prev = m.get(k); if (prev) bytes -= prev.sizeBytes || 0;
      const e = { ...entry, storageClass: 'MEMORY' }; m.delete(k); m.set(k, e); bytes += e.sizeBytes || 0;
      // LRU (Map keeps insertion order; reads re-insert): pinned/active entries are skipped
      for (const [kk, v] of m) { if (bytes <= maxBytes) break; if (v.pinned || kk === k) continue; m.delete(kk); bytes -= v.sizeBytes || 0; evicted++; }
      return e;
    }
    function get(key) { const k = typeof key === 'string' ? key : C.serializeCacheKey(key), e = m.get(k); if (!e) return null; m.delete(k); m.set(k, e); touch(e); return e; }
    function del(key) { const k = typeof key === 'string' ? key : C.serializeCacheKey(key), e = m.get(k); if (!e) return false; bytes -= e.sizeBytes || 0; m.delete(k); return true; }
    const scan = (fn = () => true) => [...m.values()].filter(fn);
    const pin = (key, on = true) => { const e = m.get(typeof key === 'string' ? key : C.serializeCacheKey(key)); if (e) e.pinned = !!on; return !!e; };
    return { kind: 'memory', get, put, delete: del, scan, pin, clear: () => { m.clear(); bytes = 0; }, bytes: () => bytes, size: () => m.size, evicted: () => evicted };
  }

  // ---------------------------------------------------------------- key-value backends for L2
  function memoryKv() {
    const m = new Map(); let failNext = null;
    return { kind: 'memory-kv', persistent: false,
      async get(k) { const v = m.get(k); return v === undefined ? null : clone(v); },
      async all() { return [...m.values()].map(clone); },
      /** all-or-nothing batch */
      async tx(ops) { if (failNext) { const e = failNext; failNext = null; throw e; } const copy = new Map(m); for (const o of ops) { if (o.op === 'put') copy.set(o.k, clone(o.v)); else if (o.op === 'delete') copy.delete(o.k); else if (o.op === 'crash') throw new Error('interrupção simulada'); } m.clear(); for (const [k, v] of copy) m.set(k, v); },
      _failNext: e => { failNext = e; }, _raw: m };
  }
  function idbKv(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = 'ws-cache-l2') {
    if (!idb) throw new C.CacheError('NO_INDEXEDDB', 'IndexedDB indisponível');
    let dbp = null;
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      let r; try { r = idb.open(name, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'k' }); };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
      r.onerror = () => { dbp = null; rej(r.error); }; r.onblocked = () => { dbp = null; rej(new Error('IndexedDB bloqueado')); };
    }));
    return { kind: 'indexeddb-kv', persistent: true,
      async get(k) { const db = await open(); const v = await req(db.transaction('entries', 'readonly').objectStore('entries').get(k)); return v === undefined ? null : v; },
      async all() { const db = await open(); return req(db.transaction('entries', 'readonly').objectStore('entries').getAll()); },
      async tx(ops) { const db = await open(); await new Promise((res, rej) => { const t = db.transaction('entries', 'readwrite'), os = t.objectStore('entries'); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('transação abortada'));
        try { for (const o of ops) { if (o.op === 'put') os.put(o.v); else if (o.op === 'delete') os.delete(o.k); else if (o.op === 'crash') throw new Error('interrupção simulada'); } } catch (e) { try { t.abort(); } catch (x) { /* done */ } rej(e); } }); },
      close: async () => { if (dbp) (await dbp).close(); dbp = null; } };
  }

  // ---------------------------------------------------------------- L2
  /** records: { k, status: 'COMMITTED' | 'STAGING', txId, entry } — staging records live under 'stg|<tx>|<k>' */
  function PersistentCacheStore(kv) {
    let txSeq = 0;
    const toRec = (k, entry, status, txId) => ({ k: status === 'STAGING' ? `stg|${txId}|${k}` : k, status, txId: txId || null, entry: { ...entry, storageClass: 'INDEXED_DB', pinned: undefined } });
    async function get(key) { const k = typeof key === 'string' ? key : C.serializeCacheKey(key); const r = await kv.get(k); return r && r.status === 'COMMITTED' ? r.entry : null; }
    /** CacheWriteTransaction: stage → (caller validated) → commit. Never replaces the old good entry before the new one is complete. */
    async function write(entries, o = {}) {
      const id = 'ctx' + Date.now().toString(36) + (++txSeq), t = { id, entries: entries.map(e => e.key), status: 'STAGING', startedAt: new Date().toISOString() };
      const ks = entries.map(e => C.serializeCacheKey(e.key));
      await kv.tx(entries.map((e, i) => ({ op: 'put', k: `stg|${id}|${ks[i]}`, v: toRec(ks[i], e, 'STAGING', id) })));
      if (o.interruptAfterStaging) { t.status = 'FAILED'; return t; } // simulates the browser closing between stage and commit
      t.status = 'VALIDATING';
      try {
        await kv.tx([...entries.map((e, i) => ({ op: 'put', k: ks[i], v: toRec(ks[i], e, 'COMMITTED', id) })), ...ks.map(k => ({ op: 'delete', k: `stg|${id}|${k}` })), ...(o.crashOnCommit ? [{ op: 'crash' }] : [])]);
        t.status = 'COMMITTED';
      } catch (e) { t.status = 'ROLLED_BACK'; try { await kv.tx(ks.map(k => ({ op: 'delete', k: `stg|${id}|${k}` }))); } catch (x) { /* maintenance removes it */ } t.error = e; throw Object.assign(e, { transaction: t }); }
      t.completedAt = new Date().toISOString(); return t;
    }
    const put = entry => write([entry]);
    async function del(key) { const k = typeof key === 'string' ? key : C.serializeCacheKey(key); await kv.tx([{ op: 'delete', k }]); }
    async function scan(fn = () => true) { return (await kv.all()).filter(r => r.status === 'COMMITTED').map(r => r.entry).filter(fn); }
    /** crash consistency: staging leftovers are removed on start; committed entries are untouched */
    async function recover() { const stg = (await kv.all()).filter(r => r.status === 'STAGING'); if (stg.length) await kv.tx(stg.map(r => ({ op: 'delete', k: r.k }))); return stg.length; }
    return { kind: 'persistent', backend: kv, get, put, write, delete: del, scan, recover };
  }

  // ---------------------------------------------------------------- capability / coherence
  function detectCapabilities(win = (typeof window !== 'undefined' ? window : {})) {
    const has = n => { try { return !!win[n]; } catch (e) { return false; } };
    return { memory: true, indexedDb: has('indexedDB'), cacheStorage: has('caches'), storageEstimate: !!(win.navigator && win.navigator.storage && win.navigator.storage.estimate), broadcastChannel: has('BroadcastChannel') };
  }
  const CHANNEL_TYPES = new Set(['CACHE_INVALIDATE', 'TENANT_SWITCHED', 'LOGOUT', 'PERMISSION_REVISION_CHANGED', 'RESOURCE_VERSION_ACTIVATED', 'SHARE_REVOKED']);
  const CHANNEL_FIELDS = ['type', 'organizationId', 'developmentId', 'resourceTypes', 'eventType', 'newVersionRefs', 'permissionRevision', 'principalRef', 'at'];
  /** CacheCoherenceChannel: BroadcastChannel when available; only metadata crosses tabs (never values, customers or tokens) */
  function CoherenceChannel({ BroadcastChannelImpl = (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null), name = 'ws-cache-coherence', onMessage = null } = {}) {
    const bc = BroadcastChannelImpl ? new BroadcastChannelImpl(name) : null; let sent = 0;
    if (bc && onMessage) bc.onmessage = ev => { const m = sanitize(ev && ev.data); if (m) onMessage(m); };
    function sanitize(m) {
      if (!m || !CHANNEL_TYPES.has(m.type)) return null;
      const out = {}; for (const f of CHANNEL_FIELDS) if (m[f] !== undefined) out[f] = f === 'resourceTypes' ? [].concat(m[f]).map(String) : f === 'newVersionRefs' ? Object.fromEntries(Object.entries(m[f] || {}).map(([k, v]) => [k, v == null ? null : String(v)])) : m[f];
      return out;
    }
    function post(m) { const s = sanitize(m); if (!s || !bc) return false; s.at = s.at || new Date().toISOString(); bc.postMessage(s); sent++; return true; }
    return { available: !!bc, post, sanitize, close: () => bc && bc.close(), sent: () => sent };
  }
  const FocusRevalidationPolicy = Object.freeze({ resourceTypes: ['AVAILABILITY_SNAPSHOT', 'PRICING_SNAPSHOT', 'MAP_BOOTSTRAP', 'PERMISSIONS'], minBackgroundDurationMs: 60000, priority: 'NORMAL' });

  // ---------------------------------------------------------------- metrics
  function Metrics() {
    const by = {}, z = () => ({ lookups: 0, hits: 0, staleHits: 0, misses: 0, expired: 0, invalid: 0, corruption: 0, revalidations: 0, revalidation304: 0, revalidationFailures: 0, evictions: 0, writeFailures: 0, quotaPressure: 0, bytesRead: 0, bytesWritten: 0, lookupMs: 0, staleFallbacks: 0 });
    const inc = (type, f, n = 1) => { const b = by[type] || (by[type] = z()); b[f] += n; };
    const hitRate = () => Object.fromEntries(Object.entries(by).map(([t, b]) => [t, b.lookups ? Math.round((b.hits / b.lookups) * 1000) / 1000 : null]));
    const total = f => Object.values(by).reduce((a, b) => a + b[f], 0);
    return { inc, by: () => clone(by), hitRate, total };
  }

  // ---------------------------------------------------------------- manager
  /** CacheManager({ memory, persistent, schemaVersion, checksumOf, now, channel, budget, migrations, capabilities }) */
  function CacheManager(o = {}) {
    const now = o.now || (() => Date.now()), memory = o.memory || MemoryCacheStore({ now }), metrics = Metrics();
    let persistent = o.persistent || null, persistentDegraded = false, lastMaintenanceAt = null;
    const checksumOf = o.checksumOf || (v => C.fingerprintOf(v)), migrations = o.migrations || C.SchemaMigrationRegistry();
    const budget = { ...C.DEFAULT_BUDGET, ...(o.budget || {}) }, flights = new Map(), negative = new Map(), warnings = [];
    const note = w => { warnings.push(w); if (warnings.length > 50) warnings.shift(); };
    const channel = o.channelFactory ? o.channelFactory(msg => applyRemote(msg)) : null;
    const usePersistent = pol => !!(persistent && !persistentDegraded && pol.persistentEnabled && pol.persistentStore === 'INDEXED_DB');
    const isSensitive = type => SENSITIVE.has(C.securityClassOf(type));

    async function persistentGet(k) { try { return await persistent.get(k); } catch (e) { degrade('read', e); return null; } }
    function degrade(what, e) { if (!persistentDegraded) { persistentDegraded = true; note({ code: 'PERSISTENT_DEGRADED', what, error: e && e.message }); } }
    async function dropEverywhere(k, pol) { memory.delete(k); if (persistent && pol.persistentEnabled) try { await persistent.delete(k); } catch (e) { /* degraded */ } }

    /** read(key, policy?) → CacheLookupResult (never throws) */
    async function read(key, policy, ro = {}) {
      const t0 = now(), type = key.resource.type, pol = policy || C.getPolicy(type), k = C.serializeCacheKey(key);
      metrics.inc(type, 'lookups');
      const done = (status, extra = {}) => { metrics.inc(type, 'lookupMs', now() - t0); if (status === 'HIT_FRESH') metrics.inc(type, 'hits'); else if (status === 'HIT_STALE') { metrics.inc(type, 'hits'); metrics.inc(type, 'staleHits'); } else if (status === 'MISS') metrics.inc(type, 'misses'); else if (status === 'EXPIRED') metrics.inc(type, 'expired'); else if (status === 'INVALID') metrics.inc(type, 'invalid');
        return { status, revalidationRequired: status !== 'HIT_FRESH', warnings: [], ...extra }; };
      if (pol.strategy === 'NO_CACHE' || pol.strategy === 'NETWORK_ONLY') return done('MISS');
      let entry = memory.get(k), source = entry ? 'MEMORY' : null;
      if (!entry && usePersistent(pol)) { entry = await persistentGet(k); if (entry) source = 'INDEXED_DB'; }
      // the schema is part of the key: an old-schema copy is found only through a registered migration (then moved to the new key)
      if (!entry) for (const from of migrations.sourcesFor(type, key.representationSchemaVersion)) {
        const ok = { ...key, representationSchemaVersion: from }, osk = C.serializeCacheKey(ok);
        let old = memory.get(osk); if (!old && usePersistent(pol)) old = await persistentGet(osk);
        if (!old) continue;
        await dropEverywhere(osk, pol);
        const r = migrations.migrate(old, key.representationSchemaVersion);
        if (r.action !== 'MIGRATED') return done('INVALID', { warnings: ['SCHEMA_MISMATCH', r.reason] });
        entry = { ...r.entry, checksum: checksumOf(r.entry.value) }; source = old.storageClass === 'INDEXED_DB' ? 'INDEXED_DB' : 'MEMORY';
        await store(entry, pol); break;
      }
      if (!entry) return done('MISS');
      // schema: migrate when a pure migration exists, otherwise invalidate (the cache is disposable)
      if (String(entry.key.representationSchemaVersion) !== String(key.representationSchemaVersion)) {
        const r = migrations.migrate(entry, key.representationSchemaVersion);
        if (r.action !== 'MIGRATED') { await dropEverywhere(k, pol); return done('INVALID', { warnings: ['SCHEMA_MISMATCH'] }); }
        entry = { ...r.entry, checksum: checksumOf(r.entry.value) };
      }
      const comp = C.validateCompatibility(key, entry, ro.expectedContext || {});
      if (comp.status !== 'COMPATIBLE' && comp.status !== 'UNKNOWN') { if (comp.status !== 'SECURITY_SCOPE_MISMATCH') await dropEverywhere(k, pol); return done(comp.status === 'SECURITY_SCOPE_MISMATCH' ? 'FORBIDDEN' : 'INVALID', { warnings: [comp.status] }); }
      const fr = C.evaluateFreshness(entry, pol, now(), { checksumOf: pol.requireChecksum ? checksumOf : null });
      if (fr === 'CORRUPT') { metrics.inc(type, 'corruption'); await dropEverywhere(k, pol); note({ code: 'CORRUPT_ENTRY_REMOVED', type }); return done('CORRUPT', { warnings: ['CHECKSUM_MISMATCH'] }); }
      if (fr === 'INVALID') { await dropEverywhere(k, pol); return done('INVALID'); }
      if (source === 'INDEXED_DB' && pol.memoryEnabled) memory.put(entry); // hot object in L1 after an L2 read
      metrics.inc(type, 'bytesRead', entry.sizeBytes || 0);
      const status = C.lookupStatusOf(fr);
      return done(status, { value: clone(entry.value), entry, source, freshness: fr });
    }

    function buildEntry(key, pol, env, origin, prev) {
      const t = now(), securityClass = C.securityClassOf(key.resource.type);
      return { key, value: env.value, resourceVersion: env.resourceVersion != null ? String(env.resourceVersion) : key.resource.version, dependencyFingerprint: env.dependencyFingerprint,
        checksum: checksumOf(env.value), etag: env.etag, lastModified: env.lastModified, createdAt: prev ? prev.createdAt : new Date(t).toISOString(), ...C.stamp(pol, t, { jitterMs: env.jitterMs }),
        lastAccessedAt: new Date(t).toISOString(), sizeBytes: C.sizeOf(env.value), storageClass: 'MEMORY', securityClass, domainFreshnessRef: env.domainFreshnessRef, origin: origin || 'USER_REQUEST', metadata: env.metadata || {} };
    }
    async function store(entry, pol) {
      const warn = [];
      if (pol.memoryEnabled) memory.put(entry);
      if (pol.persistentEnabled && pol.persistentStore === 'INDEXED_DB') {
        if (isSensitive(entry.key.resource.type) && !pol.persistSensitive) warn.push('SENSITIVE_NOT_PERSISTED');
        else if (pol.requireVersionMatch && !entry.resourceVersion) warn.push('UNVERSIONED_NOT_PERSISTED'); // `current` never becomes an immutable identity
        else if (usePersistent(pol)) {
          try { await persistent.put(entry); metrics.inc(entry.key.resource.type, 'bytesWritten', entry.sizeBytes || 0); }
          catch (e) {
            metrics.inc(entry.key.resource.type, 'writeFailures');
            if (e && e.name === 'QuotaExceededError') { metrics.inc(entry.key.resource.type, 'quotaPressure'); await evictToLowWatermark(); try { await persistent.put(entry); } catch (e2) { degrade('write', e2); warn.push('PERSISTENT_DEGRADED'); } }
            else { degrade('write', e); warn.push('PERSISTENT_DEGRADED'); }
          }
        }
      }
      return warn;
    }
    /** network + validate + write. env: { value, etag, checksum, resourceVersion, dependencyFingerprint, partial } | { notModified: true } */
    async function fetchAndStore(key, loader, pol, prev, lo) {
      const type = key.resource.type, k = C.serializeCacheKey(key);
      const neg = negative.get(k); if (neg && neg > now()) { const e = new Error('404 em cache negativo'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
      let raw;
      try { raw = await loader({ etag: prev && prev.etag, lastModified: prev && prev.lastModified, signal: lo.signal }); }
      catch (e) { const ttl = C.negativeTtl(e && e.status, pol); if (ttl) negative.set(k, now() + ttl); throw e; }
      if (raw && raw.notModified) {
        if (!prev) throw new C.CacheError('NOT_MODIFIED_WITHOUT_ENTRY', '304 sem cópia local');
        metrics.inc(type, 'revalidation304');
        const refreshed = { ...prev, ...C.stamp(pol, now()), etag: raw.etag || prev.etag };
        await store(refreshed, pol);
        return { value: clone(prev.value), cache: { status: 'HIT_FRESH', source: 'NETWORK_304', freshness: 'FRESH', warnings: [], etag: refreshed.etag } };
      }
      const env = isEnv(raw) ? raw : { value: raw };
      if (env.partial) return { value: env.value, partial: true, cache: { status: 'MISS', source: 'NETWORK', freshness: 'UNKNOWN', warnings: ['PARTIAL_NOT_CACHED'], partial: true } }; // PARTIAL is never written as READY
      if (pol.requireChecksum && env.checksum && checksumOf(env.value) !== env.checksum) { metrics.inc(type, 'corruption'); throw new C.CacheError('CHECKSUM_MISMATCH', 'payload não confere com o checksum: cópia anterior mantida'); }
      const entry = buildEntry(key, pol, env, lo.origin, prev);
      const warn = await store(entry, pol);
      return { value: clone(env.value), cache: { status: 'MISS', source: 'NETWORK', freshness: 'FRESH', warnings: warn, etag: entry.etag } };
    }
    function singleFlight(k, fn) { if (flights.has(k)) return flights.get(k); const p = Promise.resolve().then(fn).finally(() => flights.delete(k)); flights.set(k, p); return p; }
    function background(key, loader, pol, prev, lo) {
      const k = C.serializeCacheKey(key); metrics.inc(key.resource.type, 'revalidations');
      singleFlight(k, () => fetchAndStore(key, loader, pol, prev, { ...lo, origin: 'BACKGROUND_REVALIDATION' })).catch(e => { metrics.inc(key.resource.type, 'revalidationFailures'); note({ code: 'BACKGROUND_REVALIDATION_FAILED', type: key.resource.type }); });
    }
    /** load(key, loader, { policy, actionIntent, online, domainFreshness, origin, signal, expectedContext }) → { value, cache: { status, source, freshness, warnings, labels, restrictions } } */
    async function load(key, loader, lo = {}) {
      const type = key.resource.type, pol = lo.policy || C.getPolicy(type, { persistentUnavailable: !persistent || persistentDegraded }), k = C.serializeCacheKey(key);
      if (pol.strategy === 'NO_CACHE' || pol.strategy === 'NETWORK_ONLY') { const v = await loader({ signal: lo.signal }); return { value: isEnv(v) ? v.value : v, cache: { status: 'MISS', source: 'NETWORK', freshness: 'UNKNOWN', warnings: [] } }; }
      const look = await read(key, pol, lo);
      const fr = look.freshness || (look.status === 'MISS' ? 'UNKNOWN' : look.status === 'EXPIRED' ? 'EXPIRED' : look.status === 'CORRUPT' ? 'CORRUPT' : 'INVALID');
      const dec = C.readDecision(pol, look.status === 'HIT_FRESH' ? 'FRESH' : look.status === 'HIT_STALE' ? 'STALE_REVALIDATABLE' : fr, { actionIntent: lo.actionIntent });
      const use = C.useDecision({ policy: pol, status: look.status, actionIntent: lo.actionIntent, online: lo.online !== false, domainFreshness: lo.domainFreshness || null });
      const commercialForced = use.capabilityRestrictions.includes('REQUIRES_NETWORK_REVALIDATION');
      if (dec.useCachedValue && !commercialForced && look.status !== 'MISS') {
        if (dec.revalidate && pol.backgroundRevalidate) background(key, loader, pol, look.entry, lo);
        return { value: look.value, cache: { status: look.status, source: look.source, freshness: look.freshness, warnings: [...look.warnings, ...use.warningCodes], labels: use.labels, restrictions: use.capabilityRestrictions } };
      }
      if (look.status !== 'MISS') metrics.inc(type, 'revalidations');
      try { return await singleFlight(k, () => fetchAndStore(key, loader, pol, look.entry, lo)); }
      catch (e) {
        const fallbackOk = !commercialForced && dec.allowStaleFallback && look.entry && ['HIT_STALE', 'HIT_FRESH'].includes(look.status);
        if (look.status !== 'MISS') metrics.inc(type, 'revalidationFailures');
        if (!fallbackOk) throw e;
        metrics.inc(type, 'staleFallbacks');
        const u2 = C.useDecision({ policy: pol, status: 'HIT_STALE', actionIntent: lo.actionIntent, online: false, domainFreshness: 'STALE' });
        return { value: look.value, cache: { status: 'HIT_STALE', source: look.source, freshness: 'STALE_REVALIDATABLE', warnings: ['NETWORK_FAILED', ...u2.warningCodes], labels: u2.labels, restrictions: u2.capabilityRestrictions, fetchedAt: look.entry.fetchedAt } };
      }
    }
    async function allEntries() { const mem = memory.scan(); if (!persistent || persistentDegraded) return mem; let per = []; try { per = await persistent.scan(); } catch (e) { degrade('scan', e); } const seen = new Set(mem.map(e => C.serializeCacheKey(e.key))); return [...mem, ...per.filter(e => !seen.has(C.serializeCacheKey(e.key)))]; }
    /** selective invalidation by a structured selector (organizationId required) */
    async function invalidate(sel) {
      if (!sel || !sel.organizationId) throw new C.CacheError('TENANT_REQUIRED', 'invalidação exige organizationId');
      let n = 0; for (const e of await allEntries()) if (C.matchesSelector(e, sel)) { await dropEverywhere(C.serializeCacheKey(e.key), C.getPolicy(e.key.resource.type)); n++; }
      return n;
    }
    async function purge(pred, reason) { let n = 0; for (const e of await allEntries()) if (pred(e)) { await dropEverywhere(C.serializeCacheKey(e.key), C.getPolicy(e.key.resource.type)); n++; } note({ code: 'PURGE', reason, removed: n }); return n; }
    const userScoped = e => ['USER', 'CUSTOMER_CONTEXT', 'SHARE_SESSION'].includes(e.key.partition.principalScope);
    /** domain/version event → affected resource types (dependency index) → selective invalidation; broadcast to other tabs */
    async function handleEvent(ev, { fromChannel = false } = {}) {
      const types = C.affectedBy(ev);
      const n = await invalidate({ organizationId: ev.organizationId, developmentId: ev.developmentId, resourceTypes: types });
      if (!fromChannel && channel) channel.post({ type: 'CACHE_INVALIDATE', organizationId: ev.organizationId, developmentId: ev.developmentId, resourceTypes: types, eventType: ev.eventType, newVersionRefs: ev.newVersionRefs });
      return { removed: n, resourceTypes: types };
    }
    /** logout: sensitive memory, user-scoped, customer-context and share-session entries go away now (not at TTL) */
    async function logout({ organizationId, fromChannel = false } = {}) {
      const n = await purge(e => (!organizationId || e.key.resource.organizationId === organizationId) && (C.getPolicy(e.key.resource.type).clearOnLogout || userScoped(e) || isSensitive(e.key.resource.type)), 'LOGOUT');
      if (!fromChannel && channel) channel.post({ type: 'LOGOUT', organizationId }); return n;
    }
    /** tenant switch: entries of other tenants with clearOnTenantSwitch go; public immutable artifacts may stay (their key holds their tenant) */
    async function switchTenant(nextOrg, { fromChannel = false } = {}) {
      const n = await purge(e => e.key.resource.organizationId !== nextOrg && (C.getPolicy(e.key.resource.type).clearOnTenantSwitch || userScoped(e) || isSensitive(e.key.resource.type)), 'TENANT_SWITCH');
      if (!fromChannel && channel) channel.post({ type: 'TENANT_SWITCHED', organizationId: nextOrg }); return n;
    }
    /** permission revision changed: anything non-public for that principal/tenant built under another revision is dropped immediately */
    async function permissionRevisionChanged({ organizationId, principalId = null, permissionRevision, fromChannel = false }) {
      const n = await purge(e => e.key.resource.organizationId === organizationId && C.securityClassOf(e.key.resource.type) !== 'PUBLIC_SAFE' && (principalId == null || e.key.partition.principalId === principalId || e.key.partition.principalScope === 'ORGANIZATION') && e.key.partition.permissionRevision !== String(permissionRevision), 'PERMISSION_REVISION');
      if (!fromChannel && channel) channel.post({ type: 'PERMISSION_REVISION_CHANGED', organizationId, permissionRevision: String(permissionRevision) }); return n;
    }
    async function shareRevoked({ organizationId, shareSessionRef, fromChannel = false }) {
      const n = await purge(e => e.key.resource.organizationId === organizationId && e.key.partition.principalScope === 'SHARE_SESSION' && (!shareSessionRef || e.key.partition.principalId === shareSessionRef), 'SHARE_REVOKED');
      if (!fromChannel && channel) channel.post({ type: 'SHARE_REVOKED', organizationId, principalRef: shareSessionRef }); return n;
    }
    async function privacyDeletion({ organizationId, customerId }) { return purge(e => e.key.resource.organizationId === organizationId && (e.key.partition.principalId === customerId || (/^(CUSTOMER|JOURNEY|RECOMMENDATION)/.test(e.key.resource.type) && e.key.resource.resourceId === customerId)), 'PRIVACY_DELETION'); }
    async function clearPartition(partition) { const p = C.makePartition(partition); return purge(e => C.PARTITION_FIELDS.every(f => p[f] == null || e.key.partition[f] === p[f]), 'CLEAR_PARTITION'); }
    function applyRemote(m) {
      if (m.type === 'CACHE_INVALIDATE') return invalidate({ organizationId: m.organizationId, developmentId: m.developmentId, resourceTypes: m.resourceTypes });
      if (m.type === 'LOGOUT') return logout({ organizationId: m.organizationId, fromChannel: true });
      if (m.type === 'TENANT_SWITCHED') return switchTenant(m.organizationId, { fromChannel: true });
      if (m.type === 'PERMISSION_REVISION_CHANGED') return permissionRevisionChanged({ organizationId: m.organizationId, permissionRevision: m.permissionRevision, fromChannel: true });
      if (m.type === 'SHARE_REVOKED') return shareRevoked({ organizationId: m.organizationId, shareSessionRef: m.principalRef, fromChannel: true });
      if (m.type === 'RESOURCE_VERSION_ACTIVATED') return invalidate({ organizationId: m.organizationId, developmentId: m.developmentId, resourceTypes: m.resourceTypes || [] });
      return null;
    }
    /** focus after a long background, or reconnect: dynamic current resources become due for revalidation (immutable artifacts untouched) */
    function markDueForRevalidation({ hiddenForMs = Infinity, policy = FocusRevalidationPolicy } = {}) {
      if (hiddenForMs < policy.minBackgroundDurationMs) return [];
      const due = [];
      for (const e of memory.scan(x => policy.resourceTypes.includes(x.key.resource.type))) { e.staleAt = new Date(now() - 1).toISOString(); due.push(e.key.resource.type); }
      return [...new Set(due)];
    }
    const onReconnect = () => markDueForRevalidation({ hiddenForMs: Infinity });
    // ------------------------------------------------ quota / eviction / maintenance
    async function evictToLowWatermark(o = {}) {
      const entries = await allEntries(), total = entries.reduce((a, e) => a + (e.sizeBytes || 0), 0);
      const max = o.maxTotalBytes || budget.maxTotalBytes, low = max * budget.targetLowWatermarkRatio, high = max * budget.targetHighWatermarkRatio;
      let removed = 0, cur = total; const byType = {};
      for (const e of entries) byType[e.key.resource.type] = (byType[e.key.resource.type] || 0) + (e.sizeBytes || 0);
      const cands = C.evictionCandidates(entries, { now: now(), isCurrent: o.isCurrent || (() => true), activeKeys: o.activeKeys || new Set() });
      for (const c of cands) {
        const t = c.key.resource.type, typeOver = budget.maxBytesByResourceType[t] != null && byType[t] > budget.maxBytesByResourceType[t];
        if (!(o.force || cur > high || typeOver || (cur > low && removed > 0))) continue;
        if (!typeOver && cur <= low && !o.force) break;
        await dropEverywhere(c.serialized, C.getPolicy(t)); metrics.inc(t, 'evictions'); cur -= c.sizeBytes; byType[t] -= c.sizeBytes; removed++;
      }
      return { removed, beforeBytes: total, afterBytes: cur };
    }
    /** maintenance(reason): cheap on APP_START; removes expired/corrupt/staging leftovers; quota pressure → eviction; never on the critical path */
    async function maintenance(reason = 'IDLE', mo = {}) {
      const out = { reason, removedExpired: 0, removedCorrupt: 0, removedStaging: 0, eviction: null, at: new Date(now()).toISOString() };
      if (persistent && !persistentDegraded) try { out.removedStaging = await persistent.recover(); } catch (e) { degrade('recover', e); }
      if (reason === 'LOGOUT') { out.removed = await logout(mo); lastMaintenanceAt = out.at; return out; }
      if (reason === 'APP_UPDATE') { out.removedSchema = 0; for (const e of await allEntries()) { const cur = String((o.schemaVersions || {})[e.key.resource.type] || '1'); if (String(e.key.representationSchemaVersion) !== cur && !migrations.sourcesFor(e.key.resource.type, cur).includes(String(e.key.representationSchemaVersion))) { await dropEverywhere(C.serializeCacheKey(e.key), C.getPolicy(e.key.resource.type)); out.removedSchema++; } } }
      if (reason !== 'APP_START') for (const e of await allEntries()) {
        const pol = C.getPolicy(e.key.resource.type), fr = C.evaluateFreshness(e, pol, now(), { checksumOf: pol.requireChecksum ? checksumOf : null });
        if (fr === 'EXPIRED') { await dropEverywhere(C.serializeCacheKey(e.key), pol); out.removedExpired++; }
        else if (fr === 'CORRUPT') { await dropEverywhere(C.serializeCacheKey(e.key), pol); out.removedCorrupt++; metrics.inc(e.key.resource.type, 'corruption'); }
      }
      if (reason === 'QUOTA_PRESSURE' || reason === 'IDLE') out.eviction = await evictToLowWatermark(mo);
      lastMaintenanceAt = out.at; return out;
    }
    async function quotaEstimate(nav = (typeof navigator !== 'undefined' ? navigator : null)) { try { if (nav && nav.storage && nav.storage.estimate) { const e = await nav.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } } catch (e) { /* hint only */ } return null; }
    // ------------------------------------------------ diagnostics (technical/admin; no principal ids, no values)
    async function inspect() {
      const entries = await allEntries();
      const rows = entries.map(e => { const r = e.key.resource, sens = C.securityClassOf(r.type) !== 'PUBLIC_SAFE', pol = C.getPolicy(r.type);
        return { type: r.type, resourceId: sens ? '•••' : r.resourceId, version: r.version || e.resourceVersion || null, kind: pol.strategy === 'IMMUTABLE_VERSIONED' ? 'IMMUTABLE ARTIFACT' : r.type === 'MAP_BOOTSTRAP' || r.type === 'PRICING_SNAPSHOT' ? 'CURRENT POINTER' : pol.domainLabel ? 'LAST-KNOWN DYNAMIC' : 'DERIVED',
          partition: e.key.partition.principalScope, strategy: pol.strategy, freshness: C.evaluateFreshness(e, pol, now()), etag: !!e.etag, tier: e.storageClass, sizeBytes: e.sizeBytes || 0, dependencies: !!e.dependencyFingerprint }; });
      return { memoryEntryCount: memory.size(), persistentEntryCount: entries.filter(e => e.storageClass === 'INDEXED_DB').length, estimatedPersistentBytes: entries.filter(e => e.storageClass === 'INDEXED_DB').reduce((a, e) => a + (e.sizeBytes || 0), 0),
        hitRateByResourceType: metrics.hitRate(), staleHitCount: metrics.total('staleHits'), corruptionCount: metrics.total('corruption'), evictionCount: metrics.total('evictions') + memory.evicted(), lastMaintenanceAt,
        persistentDegraded, warnings: warnings.map(w => w.code), rows };
    }
    return { load, read, invalidate, handleEvent, logout, switchTenant, permissionRevisionChanged, shareRevoked, privacyDeletion, clearPartition, applyRemote, markDueForRevalidation, onReconnect,
      evictToLowWatermark, maintenance, quotaEstimate, inspect, metrics, memory, get persistent() { return persistent; }, isDegraded: () => persistentDegraded, channel, pin: (key, on) => memory.pin(key, on) };
  }

  return Object.freeze({ envelope, MemoryCacheStore, memoryKv, idbKv, PersistentCacheStore, detectCapabilities, CoherenceChannel, FocusRevalidationPolicy, Metrics, CacheManager });
})();
