/* data/offline.js — hybrid execution: ONLINE + LOCAL CACHE + OFFLINE FALLBACK (topic 10).
   Rule: the cache is an operational copy, never the source of truth.
     SOURCE OF TRUTH (published files / backend) → LOCAL CACHE → UI
   - net: GET with timeout, limited exponential retry with jitter; writes are never retried here.
   - Connectivity: ONLINE / OFFLINE / DEGRADED / UNKNOWN from real requests, not only navigator.onLine.
   - Backends: IndexedDB (structured data) or memory (private mode, no IndexedDB); same interface.
   - LocalCacheRepository: static and analysis snapshots by version (current + previous pointers), dynamic
     last-known state, manifest, sync state, asset metadata. Every read is validated (count, checksum,
     snapshot schema); a corrupted version is discarded, never shown.
   - AssetCache: Cache Storage for plan/aerial images keyed by checksum (lazy, P0/P2).
   - HybridLotSource: fast start from a valid cache, network otherwise; cached dynamic data is STALE until
     the source confirms it.
   - SyncManager: one sync per development at a time; version check, atomic replacement, dynamic
     revalidation (network-first, last-known fallback), triggers on boot, reconnect, foreground and manual.
   Components never touch IndexedDB, Cache Storage or the Service Worker: they read selectors. */
App.offline = (() => {
  const L = App.lifecycle, D = App.domain;
  const DB_NAME = 'ws-cache', DB_VERSION = 1;
  const now = () => Date.now(), iso = t => new Date(t == null ? now() : t).toISOString();
  const track = (evt, data) => { try { App.analytics && App.analytics.track(evt, data); } catch (e) { /* telemetry is optional */ } };

  // ---------------------------------------------------------------- checksum (same function in the build)
  /** FNV-1a 32-bit over the stable JSON of a value. Detects real changes and corrupted copies. */
  function checksum(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(D.stable(value));
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ---------------------------------------------------------------- network
  class NetError extends Error {
    constructor(code, message, status) { super(message); this.code = code; this.status = status || null; this.network = code === 'NETWORK' || code === 'TIMEOUT'; }
  }
  const net = {
    fetchImpl: null, sleep: ms => new Promise(r => setTimeout(r, ms)),
    /** GET JSON with a timeout and a limited retry (1 s, 2 s, 4 s with ±30 % jitter). Never infinite. */
    async getJson(url, opts = {}) {
      const tries = 1 + (opts.retries == null ? 2 : opts.retries), timeoutMs = opts.timeoutMs || 8000;
      let last;
      for (let i = 0; i < tries; i++) {
        if (opts.signal && opts.signal.aborted) throw new NetError('ABORTED', 'cancelado');
        try { return await once(url, timeoutMs, opts.signal); }
        catch (e) {
          last = e;
          const retriable = e.network || (e.status >= 500 || e.status === 408 || e.status === 429);
          if (!retriable || i === tries - 1) break;
          const base = 1000 * Math.pow(2, i), wait = Math.round(base * (0.7 + Math.random() * 0.6));
          await net.sleep(opts.fastRetry ? 0 : wait);
        }
      }
      throw last;
    }
  };
  async function once(url, timeoutMs, outer) {
    const f = net.fetchImpl || fetch;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const onAbort = () => ac && ac.abort();
    if (outer && ac) outer.addEventListener('abort', onAbort, { once: true });
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { if (ac) ac.abort(); rej(new NetError('TIMEOUT', `sem resposta em ${timeoutMs} ms (${url})`)); }, timeoutMs); });
    try {
      let r;
      try { r = await Promise.race([f(url, ac ? { signal: ac.signal, cache: 'no-store' } : { cache: 'no-store' }), timeout]); }
      catch (e) { if (e instanceof NetError) throw e; throw new NetError(outer && outer.aborted ? 'ABORTED' : 'NETWORK', `falha de rede (${url}): ${e.message}`); }
      if (!r || !r.ok) throw new NetError('HTTP', `HTTP ${r ? r.status : '?'} em ${url}`, r ? r.status : 0);
      try { return await Promise.race([r.json(), timeout]); } catch (e) { if (e instanceof NetError) throw e; throw new NetError('PARSE', `resposta inválida em ${url}`); }
    } finally { clearTimeout(timer); if (outer && ac) outer.removeEventListener('abort', onAbort); }
  }

  // ---------------------------------------------------------------- connectivity
  /** ConnectivityState from real requests. navigator.onLine === true does not mean the source is reachable. */
  function Connectivity(win = (typeof window !== 'undefined' ? window : null)) {
    const nav = win && win.navigator;
    let state = nav && nav.onLine === false ? 'OFFLINE' : 'UNKNOWN', subs = [];
    const scopes = {}; // scope → { ok, at, network }
    function set(next, why) {
      if (next === state) return;
      const prev = state; state = next;
      if (next === 'OFFLINE') track('offline_entered', { why }); else if (prev === 'OFFLINE') track('offline_exit', { why });
      subs.forEach(fn => { try { fn(state, prev); } catch (e) { console.error(e); } });
    }
    function derive() {
      if (nav && nav.onLine === false) return 'OFFLINE';
      const v = Object.values(scopes); if (!v.length) return 'UNKNOWN';
      if (v.every(x => x.ok)) return 'ONLINE';
      if (v.every(x => !x.ok && x.network)) return 'OFFLINE';
      return 'DEGRADED';
    }
    /** report(scope, ok, error): every real request tells the connectivity what happened */
    let reportSubs = []; // topic 49: raw reports for App.pwa.connectivity (hysteresis + probe); no URL or payload is passed
    function report(scope, ok, err) { scopes[scope] = { ok, at: now(), network: !!(err && err.network) }; set(derive(), scope);
      for (const fn of reportSubs) try { fn(scope, ok, err ? { network: !!err.network, status: err.status || null } : null); } catch (e) { /* listener */ } }
    if (win && win.addEventListener) {
      win.addEventListener('offline', () => set('OFFLINE', 'browser'));
      win.addEventListener('online', () => { for (const k of Object.keys(scopes)) delete scopes[k]; set('UNKNOWN', 'browser'); });
    }
    /** a new round of requests (a sync): connectivity reflects this round only */
    function beginRound() { for (const k of Object.keys(scopes)) delete scopes[k]; }
    return { get: () => state, report, set, beginRound, subscribe: fn => { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; }, onReport: fn => { reportSubs.push(fn); return () => { reportSubs = reportSubs.filter(f => f !== fn); }; }, navigatorOnline: () => !(nav && nav.onLine === false) };
  }

  // ---------------------------------------------------------------- storage backends
  /** Stores (IndexedDB v1). Key paths are the cache keys of topic 10, item 87. */
  const STORES = {
    metadata: { keyPath: 'key' },
    staticLots: { keyPath: ['developmentId', 'version', 'lotId'], indexes: { byVersion: ['developmentId', 'version'], lotId: 'lotId' } },
    analysisLots: { keyPath: ['developmentId', 'version', 'lotId'], indexes: { byVersion: ['developmentId', 'version'], lotId: 'lotId' } },
    dynamicLots: { keyPath: ['developmentId', 'lotId'], indexes: { developmentId: 'developmentId', status: 'availabilityStatus' } },
    assetsMetadata: { keyPath: ['developmentId', 'path'], indexes: { developmentId: 'developmentId' } },
    syncState: { keyPath: 'developmentId' }
  };
  const keyOf = (store, v) => { const kp = STORES[store].keyPath; return Array.isArray(kp) ? kp.map(k => v[k]) : v[kp]; };
  const HI = '￿';
  /** prefix → key range covering every compound key that starts with it */
  const prefixBounds = prefix => [prefix.concat(['']), prefix.concat([HI])];

  /** Memory backend: same contract as IndexedDB. Used when IndexedDB is unavailable (private mode, old browser) and in tests. */
  function MemoryBackend() {
    const data = Object.fromEntries(Object.keys(STORES).map(s => [s, new Map()]));
    const k = key => JSON.stringify(key);
    const inPrefix = (key, prefix) => prefix.every((p, i) => key[i] === p);
    return {
      kind: 'memory', persistent: false,
      async get(store, key) { const v = data[store].get(k(key)); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
      async getAllPrefix(store, prefix) { const out = []; for (const v of data[store].values()) if (inPrefix(keyOf(store, v), prefix)) out.push(JSON.parse(JSON.stringify(v))); return out; },
      /** batch of writes applied all-or-nothing */
      async write(ops) {
        const copy = Object.fromEntries(Object.keys(data).map(s => [s, new Map(data[s])]));
        for (const o of ops) {
          if (o.op === 'put') copy[o.store].set(k(keyOf(o.store, o.value)), JSON.parse(JSON.stringify(o.value)));
          else if (o.op === 'delete') copy[o.store].delete(k(o.key));
          else if (o.op === 'deletePrefix') { for (const [kk, v] of [...copy[o.store]]) if (inPrefix(keyOf(o.store, v), o.prefix)) copy[o.store].delete(kk); }
          else if (o.op === 'update') { const cur = copy[o.store].get(k(o.key)), nv = o.fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur))); if (nv) copy[o.store].set(k(o.key), JSON.parse(JSON.stringify(nv))); }
          else if (o.op === 'fail') throw new Error('falha simulada');
        }
        Object.assign(data, copy);
      },
      _data: data
    };
  }

  /** IndexedDB backend. One database per origin, namespaced by developmentId inside every key. */
  function IdbBackend(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = DB_NAME) {
    if (!idb) throw new Error('IndexedDB indisponível');
    let dbp = null;
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    function open() {
      return dbp || (dbp = new Promise((res, rej) => {
        let r; try { r = idb.open(name, DB_VERSION); } catch (e) { rej(e); return; }
        r.onupgradeneeded = e => migrate(r.result, e.oldVersion);
        r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
        r.onerror = () => { dbp = null; rej(r.error); };
        r.onblocked = () => { dbp = null; rej(new Error('IndexedDB bloqueado por outra aba')); };
      }));
    }
    /** native versioning: each version adds what it needs; incompatible stores are recreated, others kept */
    function migrate(db, oldVersion) {
      if (oldVersion < 1) for (const [s, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(s)) db.deleteObjectStore(s);
        const os = db.createObjectStore(s, { keyPath: def.keyPath });
        for (const [iname, ipath] of Object.entries(def.indexes || {})) os.createIndex(iname, ipath);
      }
    }
    const range = prefix => { const [lo, hi] = prefixBounds(prefix); return IDBKeyRange.bound(lo, hi); };
    return {
      kind: 'indexeddb', persistent: true,
      async get(store, key) { const db = await open(); const v = await req(db.transaction(store, 'readonly').objectStore(store).get(key)); return v === undefined ? null : v; },
      async getAllPrefix(store, prefix) {
        const db = await open(), os = db.transaction(store, 'readonly').objectStore(store);
        // compound keys with a fixed prefix: [dev, version, ''] … [dev, version, '￿']
        if (Array.isArray(STORES[store].keyPath) && prefix.length === STORES[store].keyPath.length - 1) return req(os.getAll(range(prefix)));
        return (await req(os.getAll())).filter(v => prefix.every((p, i) => keyOf(store, v)[i] === p));
      },
      /** every op in one transaction: all or nothing (a partial download is never activated) */
      async write(ops) {
        const db = await open(), stores = [...new Set(ops.filter(o => o.store).map(o => o.store))];
        if (!stores.length) return;
        await new Promise((res, rej) => {
          const tx = db.transaction(stores, 'readwrite');
          tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('transação abortada'));
          try {
            for (const o of ops) {
              const os = tx.objectStore(o.store);
              if (o.op === 'put') os.put(o.value);
              else if (o.op === 'delete') os.delete(o.key);
              else if (o.op === 'deletePrefix') os.delete(range(o.prefix));
              // read-modify-write inside the same transaction: concurrent writers (another sync, another tab) cannot lose each other's fields
              else if (o.op === 'update') { const g = os.get(o.key); g.onsuccess = () => { try { const nv = o.fn(g.result === undefined ? null : g.result); if (nv) os.put(nv); } catch (e) { try { tx.abort(); } catch (x) { /* done */ } } }; }
              else if (o.op === 'fail') throw new Error('falha simulada');
            }
          } catch (e) { try { tx.abort(); } catch (x) { /* already finished */ } rej(e); }
        });
      },
      close: async () => { if (dbp) (await dbp).close(); dbp = null; }
    };
  }
  /** IndexedDB when it really opens; memory otherwise (the app keeps working online). */
  async function pickBackend(opts = {}) {
    if (opts.backend) return opts.backend;
    try { const b = IdbBackend(opts.indexedDB); await b.get('metadata', '__probe__'); return b; }
    catch (e) { L.note('local cache unavailable', { error: e.message }); return MemoryBackend(); }
  }

  // ---------------------------------------------------------------- LocalCacheRepository
  class CacheCorrupt extends Error { constructor(kind, version, why) { super(`cache ${kind} ${version} inválido: ${why}`); this.kind = kind; this.version = version; this.code = 'CACHE_CORRUPT'; } }
  const LOT_STORE = { static: 'staticLots', analysis: 'analysisLots' };
  function LocalCacheRepository(devId, backend) {
    const mk = (...p) => [devId, ...p].join(':');
    const META = { manifest: mk('manifest'), snap: (kind, v) => mk(kind, v), dyn: kind => mk('dynamic', kind) };
    async function getManifest() { const m = await backend.get('metadata', META.manifest); return m ? m.value : null; }
    async function putManifest(m) { await backend.write([{ op: 'put', store: 'metadata', value: { key: META.manifest, value: { ...m, developmentId: devId, savedAt: iso() } } }]); }
    const EMPTY_MANIFEST = () => ({ developmentId: devId, schemaVersion: D.SCHEMA_VERSION, currentStaticVersion: null, currentAnalysisVersion: null, previousStaticVersion: null,
      previousAnalysisVersion: null, currentCommercialRevision: null, currentAvailabilityRevision: null, remote: null, lastSuccessfulSyncAt: null });
    /** atomic change of the local manifest (read and write in one transaction) */
    async function updateManifest(fn) {
      let out = null;
      await backend.write([{ op: 'update', store: 'metadata', key: META.manifest, fn: rec => {
        const m = rec && rec.value ? rec.value : EMPTY_MANIFEST(); if (fn(m) === false) return null;
        out = { ...m, developmentId: devId, savedAt: iso() }; return { key: META.manifest, value: out };
      } }]);
      return out;
    }

    /** save a versioned snapshot (rows + metadata in ONE transaction). It is not active until activate(). */
    async function putSnapshot(kind, snap, extra = {}) {
      const version = snap[L.VERSION_KEY[kind]], { lots, ...meta } = snap;
      const ops = [{ op: 'deletePrefix', store: LOT_STORE[kind], prefix: [devId, version] }];
      for (const [lotId, data] of Object.entries(lots)) ops.push({ op: 'put', store: LOT_STORE[kind], value: { developmentId: devId, version, lotId, data } });
      ops.push({ op: 'put', store: 'metadata', value: { key: META.snap(kind, version), value: { ...meta, ...extra, lotCount: Object.keys(lots).length, checksum: checksum(lots), cachedAt: iso() } } });
      if (extra.simulateFailure) ops.splice(Math.floor(ops.length / 2), 0, { op: 'fail' });
      await backend.write(ops);
      return version;
    }
    /** read + validate. Throws CacheCorrupt when the copy does not match what was saved. */
    async function getSnapshot(kind, version, staticIds) {
      if (version == null) return null;
      const m = await backend.get('metadata', META.snap(kind, version));
      if (!m) return null;
      const rows = await backend.getAllPrefix(LOT_STORE[kind], [devId, version]);
      const { lotCount, checksum: sum, cachedAt, ...meta } = m.value;
      const lots = {}; for (const r of rows) lots[r.lotId] = r.data;
      if (rows.length !== lotCount) throw new CacheCorrupt(kind, version, `${rows.length} de ${lotCount} lotes`);
      if (checksum(lots) !== sum) throw new CacheCorrupt(kind, version, 'checksum diferente');
      const snap = { ...meta, lots };
      const errors = L.validateSnapshot(snap, kind, devId, staticIds || null);
      if (errors.length) throw new CacheCorrupt(kind, version, errors[0].code);
      return { snap, cachedAt };
    }
    async function discard(kind, version) {
      await backend.write([{ op: 'deletePrefix', store: LOT_STORE[kind], prefix: [devId, version] }, { op: 'delete', store: 'metadata', key: META.snap(kind, version) }]);
      const C = kind === 'static' ? 'currentStaticVersion' : 'currentAnalysisVersion', P = kind === 'static' ? 'previousStaticVersion' : 'previousAnalysisVersion';
      await updateManifest(m => { if (m[C] === version) { m[C] = m[P]; m[P] = null; } else if (m[P] === version) m[P] = null; else return false; });
      L.note('cache discarded', { kind, version });
    }
    /** switch the CURRENT pointer, keep the previous one for local rollback, then remove older versions */
    async function activate(kind, version, remote) {
      const C = kind === 'static' ? 'currentStaticVersion' : 'currentAnalysisVersion', P = kind === 'static' ? 'previousStaticVersion' : 'previousAnalysisVersion';
      const m = await updateManifest(x => { if (x[C] !== version) { x[P] = x[C]; x[C] = version; } if (remote) x.remote = remote; });
      await cleanup(kind, [m[C], m[P]]);
      return m;
    }
    async function cleanup(kind, keep) {
      const rows = await backend.getAllPrefix('metadata', []); // metadata keys are strings; filter by prefix
      const pre = mk(kind) + ':', old = rows.filter(r => r.key.startsWith(pre)).map(r => r.key.slice(pre.length)).filter(v => !keep.includes(v));
      for (const v of old) await backend.write([{ op: 'deletePrefix', store: LOT_STORE[kind], prefix: [devId, v] }, { op: 'delete', store: 'metadata', key: META.snap(kind, v) }]);
      return old;
    }
    /** dynamic last-known state: commercial + availability per lot, replaced as a whole */
    async function putDynamicState(commercial, availability, info = {}) {
      const ops = [{ op: 'deletePrefix', store: 'dynamicLots', prefix: [devId] }], ids = new Set([...Object.keys((commercial && commercial.lots) || {}), ...Object.keys((availability && availability.lots) || {})]);
      for (const lotId of ids) {
        const a = availability && availability.lots[lotId];
        ops.push({ op: 'put', store: 'dynamicLots', value: { developmentId: devId, lotId, commercial: commercial ? commercial.lots[lotId] || null : null, availability: a || null, availabilityStatus: a && a.availability ? a.availability.status : 'UNKNOWN' } });
      }
      const strip = s => { if (!s) return null; const { lots, stale, source, ...meta } = s; return { ...meta, lotCount: Object.keys(lots).length }; };
      ops.push({ op: 'put', store: 'metadata', value: { key: META.dyn('commercial'), value: strip(commercial) } });
      ops.push({ op: 'put', store: 'metadata', value: { key: META.dyn('availability'), value: strip(availability) } });
      ops.push({ op: 'update', store: 'metadata', key: META.manifest, fn: rec => {
        const m = rec && rec.value ? rec.value : EMPTY_MANIFEST();
        m.currentCommercialRevision = commercial ? commercial.revision : null; m.currentAvailabilityRevision = availability ? availability.revision : null;
        if (info.confirmedAt) m.lastSuccessfulSyncAt = info.confirmedAt;
        return { key: META.manifest, value: { ...m, developmentId: devId, savedAt: iso() } };
      } });
      await backend.write(ops);
    }
    /** last-known dynamic state, always marked CACHE (STALE until the source confirms it again) */
    async function getDynamicState(staticIds) {
      const [cm, am] = await Promise.all([backend.get('metadata', META.dyn('commercial')), backend.get('metadata', META.dyn('availability'))]);
      const rows = await backend.getAllPrefix('dynamicLots', [devId]);
      const build = (meta, part) => {
        if (!meta || !meta.value) return null;
        const { lotCount, ...m } = meta.value, lots = {};
        for (const r of rows) if (r[part] && (!staticIds || staticIds.has(r.lotId))) lots[r.lotId] = r[part];
        if (Object.keys(lots).length !== lotCount) throw new CacheCorrupt(part, m.revision, 'lotes faltando no estado dinâmico');
        const snap = { ...m, lots, source: 'CACHE', stale: true };
        const errors = L.validateSnapshot(snap, part, devId, staticIds || null);
        if (errors.length) throw new CacheCorrupt(part, m.revision, errors[0].code);
        return snap;
      };
      return { commercial: build(cm, 'commercial'), availability: build(am, 'availability') };
    }
    async function discardDynamic() { await backend.write([{ op: 'deletePrefix', store: 'dynamicLots', prefix: [devId] }, { op: 'delete', store: 'metadata', key: META.dyn('commercial') }, { op: 'delete', store: 'metadata', key: META.dyn('availability') }]); }
    const putSyncState = s => backend.write([{ op: 'put', store: 'syncState', value: { ...s, developmentId: devId } }]);
    const getSyncState = () => backend.get('syncState', devId);
    const putAsset = a => backend.write([{ op: 'put', store: 'assetsMetadata', value: { ...a, developmentId: devId } }]);
    const getAssets = () => backend.getAllPrefix('assetsMetadata', [devId]);
    /** "Limpar dados locais": this development's data only; preferences are kept unless asked */
    async function clear() {
      const meta = (await backend.getAllPrefix('metadata', [])).filter(r => r.key.startsWith(devId + ':'));
      await backend.write([
        { op: 'deletePrefix', store: 'staticLots', prefix: [devId] }, { op: 'deletePrefix', store: 'analysisLots', prefix: [devId] }, { op: 'deletePrefix', store: 'dynamicLots', prefix: [devId] },
        { op: 'deletePrefix', store: 'assetsMetadata', prefix: [devId] }, { op: 'delete', store: 'syncState', key: devId }, ...meta.map(r => ({ op: 'delete', store: 'metadata', key: r.key }))]);
    }
    return { developmentId: devId, backend, getManifest, putManifest, updateManifest, EMPTY_MANIFEST,
      getStaticSnapshot: v => getSnapshot('static', v), putStaticSnapshot: (s, x) => putSnapshot('static', s, x),
      getAnalysisSnapshot: (v, ids) => getSnapshot('analysis', v, ids), putAnalysisSnapshot: (s, x) => putSnapshot('analysis', s, x),
      getDynamicState, putDynamicState, discardDynamic, discard, activate, cleanup, putSyncState, getSyncState, putAsset, getAssets, clear };
  }
  // memory/IDB backends read metadata with an empty prefix → all rows (metadata keys are plain strings)

  // ---------------------------------------------------------------- remote (official source)
  /** JsonRemote: the published files. manifest.json only informs versions; price and status come from their own files.
      With the backend (topic 9) the same contract is served by /api/v1 (see ApiRemote). */
  function JsonRemote(dev, commercialRepo, opt = {}) {
    const get = (url, o) => net.getJson(url, { timeoutMs: opt.timeoutMs, retries: opt.retries, ...o });
    function validateManifest(m) {
      if (!m || m.developmentId !== dev.id || !m.staticVersion || !m.analysisVersion) throw new NetError('INVALID', 'manifest inválido');
      if (m.schemaVersion !== D.SCHEMA_VERSION) throw new NetError('INVALID', `manifest com schema ${m.schemaVersion}`);
      return m;
    }
    return {
      kind: 'json',
      getManifest: o => get(dev.assets.manifest, o).then(validateManifest),
      /** static + analysis (+ legacy availability) built from lots.json with the versions the manifest announces */
      async getStructural(manifest, o = {}) {
        const raw = await (o.raw || get(dev.assets.lots, o));
        const d = manifest ? { ...dev, staticDataVersion: manifest.staticVersion, analysisVersion: manifest.analysisVersion } : dev;
        const res = App.repos.buildSnapshotsFromLegacy(raw, d, commercialRepo);
        return res;
      },
      /** commercial.json: the published price table document (network-first) */
      async getCommercial(staticSnap, o = {}) {
        const doc = await (o.doc || get(dev.assets.commercial, o));
        return commercialFromDoc(doc, staticSnap, dev, commercialRepo);
      },
      /** topic 47: the boot documents do not depend on each other to be REQUESTED (only to be validated), so the first visit starts
          manifest, lots and commercial together instead of the manifest → lots → commercial waterfall. Unused promises never reject loudly. */
      prefetch(o) { const quiet = p => { p.catch(() => {}); return p; }; return { raw: quiet(get(dev.assets.lots, o)), doc: quiet(get(dev.assets.commercial, o)) }; },
      /** availability feed: only when the manifest announces one (no sales mirror yet → null) */
      async getAvailability(manifest, staticSnap, o) {
        if (!manifest || manifest.availabilityRevision == null || !manifest.availabilityPath) return null;
        return availabilityFromFeed(await get(manifest.availabilityPath, o), staticSnap, dev);
      }
    };
  }
  function commercialFromDoc(doc, staticSnap, dev, commercialRepo) {
    if (!doc || doc.developmentId !== dev.id || !Array.isArray(doc.priceTables)) throw new NetError('INVALID', 'documento comercial inválido');
    const t = doc.priceTables.find(x => x.id === doc.currentPriceTableId);
    if (!t || !(t.pricePerM2 > 0) || !Array.isArray(t.plans) || !t.plans.length) throw new NetError('INVALID', 'tabela comercial vigente ausente ou inválida');
    commercialRepo.addPriceTable(t);
    const snap = commercialRepo.buildSnapshot(staticSnap, t.id);
    return { ...snap, revision: doc.revision != null ? doc.revision : snap.revision, updatedAt: doc.updatedAt || snap.updatedAt, source: 'REMOTE', stale: false, confirmedAt: iso() };
  }
  /** feed { revision, updatedAt, sourceId, lots: { codeOrId: { status, reservedUntil, proposalId, reason } } } → snapshot */
  function availabilityFromFeed(doc, staticSnap, dev) {
    if (!doc || doc.developmentId !== dev.id || !Number.isInteger(doc.revision) || !doc.lots) throw new NetError('INVALID', 'espelho de vendas inválido');
    const byCode = new Map(Object.entries(staticSnap.lots).map(([id, s]) => [s.identity.code, id])), lots = {};
    for (const id of Object.keys(staticSnap.lots)) lots[id] = { availability: { ...App.availability.EMPTY(), freshness: 'UNKNOWN' } };
    for (const [ref, a] of Object.entries(doc.lots)) {
      const id = staticSnap.lots[ref] ? ref : byCode.get(String(ref).toUpperCase()); if (!id) continue;
      const st = { ...App.availability.EMPTY(), ...a, updatedAt: a.updatedAt || doc.updatedAt, sourceId: doc.sourceId || 'sales-mirror', revision: doc.revision };
      delete st.freshness;
      lots[id] = { availability: { ...st, freshness: 'FRESH' }, provenance: st.status === 'UNKNOWN' ? undefined : { 'availability.status': { status: 'CONFIRMED', sourceId: st.sourceId, method: 'declared', confidence: 'HIGH', updatedAt: st.updatedAt } } };
      if (!lots[id].provenance) delete lots[id].provenance;
    }
    return { ...L.snapshot('availability', dev.id, { revision: doc.revision, updatedAt: doc.updatedAt, sourceId: doc.sourceId || 'sales-mirror' }, lots), source: 'REMOTE', stale: false, confirmedAt: iso() };
  }
  /** a topic-9 style source exposing only loadLayers() (ApiLotSource) adapted to the remote contract */
  function fromLayerSource(src) {
    let memo = null;
    const layers = () => memo || (memo = src.loadLayers().finally(() => setTimeout(() => { memo = null; }, 0)));
    return {
      kind: src.kind, getManifest: src.getManifest ? o => src.getManifest(o) : null,
      getStructural: async () => layers(),
      getCommercial: async () => { const r = await layers(); return r.layers.commercial ? { ...r.layers.commercial, source: 'REMOTE', stale: false, confirmedAt: iso() } : null; },
      getAvailability: async () => { const r = await layers(); return r.layers.availability ? { ...r.layers.availability, source: 'REMOTE', stale: false, confirmedAt: iso() } : null; }
    };
  }

  /** empty availability layer: no last-known value → every lot UNKNOWN (never AVAILABLE) */
  const unknownAvailability = (dev, staticSnap) => L.snapshot('availability', dev.id, { revision: 0, updatedAt: null, sourceId: null },
    Object.fromEntries(Object.keys(staticSnap.lots).map(id => [id, { availability: { ...App.availability.EMPTY() } }])));
  /** commercial built from the table embedded in the app: last resort, always STALE ("última tabela disponível") */
  const bundledCommercial = (commercialRepo, staticSnap) => { try { return { ...commercialRepo.buildSnapshot(staticSnap), source: 'BUNDLED', stale: true }; } catch (e) { return null; } };

  // ---------------------------------------------------------------- HybridLotSource
  /** loadLayers(): fast start from a valid cache; network when there is none; a clear error when neither exists. */
  function HybridLotSource(dev, { remote, local, commercialRepo, connectivity, cacheReadTimeoutMs = 3000 }) {
    const self = { kind: 'hybrid', origin: null, remote, local, lastLoad: null };
    const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: tempo esgotado`)), ms))]);

    async function readCache() {
      const t0 = now(), m = await local.getManifest();
      if (!m || !m.currentStaticVersion) { track('cache_miss', { what: 'static' }); return null; }
      let st = null;
      for (const v of [m.currentStaticVersion, m.previousStaticVersion].filter(Boolean)) {
        try { const r = await local.getStaticSnapshot(v); if (r) { st = r; break; } } catch (e) { if (e.code === 'CACHE_CORRUPT') await local.discard('static', v); else throw e; }
      }
      if (!st) return null;
      const ids = new Set(Object.keys(st.snap.lots));
      let an = null;
      for (const v of [m.currentAnalysisVersion, m.previousAnalysisVersion].filter(Boolean)) {
        try { const r = await local.getAnalysisSnapshot(v, ids); if (r) { an = r; break; } } catch (e) { if (e.code === 'CACHE_CORRUPT') await local.discard('analysis', v); else throw e; }
      }
      let dyn = { commercial: null, availability: null };
      try { dyn = await local.getDynamicState(ids); } catch (e) { if (e.code === 'CACHE_CORRUPT') { await local.discardDynamic(); L.note('cache discarded', { kind: 'dynamic' }); } else throw e; }
      track('cache_hit', { ms: now() - t0 });
      return { manifest: m, static: st.snap, analysis: an && an.snap, commercial: dyn.commercial, availability: dyn.availability, readMs: now() - t0 };
    }

    async function persistAll(res, manifest) {
      try {
        const st = res.layers.static, an = res.layers.analysis, norm = { normalization: { warnings: res.warnings || [], variants: res.variants || [], unmapped: res.unmapped || [] } };
        await local.putStaticSnapshot(st, norm); await local.putAnalysisSnapshot(an);
        await local.activate('static', st.staticDataVersion, manifest || null); await local.activate('analysis', an.analysisVersion, manifest || null);
        const c = res.layers.commercial, a = res.layers.availability;
        await local.putDynamicState(c && c.source !== 'BUNDLED' ? c : null, a, { confirmedAt: c && c.confirmedAt });
        return true;
      } catch (e) { L.note('cache write failed', { error: e.message, quota: e.name === 'QuotaExceededError' }); return false; }
    }
    self.persistAll = persistAll;

    self.loadLayers = async () => {
      const t0 = now();
      let cached = null;
      try { cached = await withTimeout(readCache(), cacheReadTimeoutMs, 'leitura do cache'); }
      catch (e) { L.note('cache read failed', { error: e.message }); } // an unreadable cache never takes the app down
      if (cached && cached.analysis) {
        const norm = cached.static.normalization || {};
        const { normalization, ...staticSnap } = cached.static;
        const layers = {
          static: staticSnap, analysis: cached.analysis,
          commercial: cached.commercial || bundledCommercial(commercialRepo, staticSnap),
          availability: cached.availability || unknownAvailability(dev, staticSnap)
        };
        self.origin = 'CACHE'; self.lastLoad = { origin: 'CACHE', ms: now() - t0, manifest: cached.manifest };
        return { layers, states: { static: 'ready', analysis: 'ready', commercial: layers.commercial ? 'ready' : 'error', availability: 'ready' },
          warnings: norm.warnings || [], variants: norm.variants || [], unmapped: norm.unmapped || [], origin: 'CACHE', manifest: cached.manifest };
      }
      // no usable cache → official source (independent requests in parallel; validation stays in order)
      let manifest = null;
      const early = remote.prefetch ? remote.prefetch() : {};
      try { if (remote.getManifest) { manifest = await remote.getManifest(); connectivity && connectivity.report('manifest', true); } }
      catch (e) { connectivity && connectivity.report('manifest', false, e); if (e.network) throw firstVisitError(e); L.note('manifest unavailable', { error: e.message }); }
      let res;
      try { res = await remote.getStructural(manifest, early.raw ? { raw: early.raw } : undefined); connectivity && connectivity.report('static', true); }
      catch (e) { connectivity && connectivity.report('static', false, e); throw e.network ? firstVisitError(e) : e; }
      if (manifest && manifest.checksums) {
        const cs = checksum(res.layers.static.lots), ca = checksum(res.layers.analysis.lots);
        if (cs !== manifest.checksums.static || ca !== manifest.checksums.analysis) L.note('checksum mismatch', { static: cs, analysis: ca, manifest: manifest.checksums });
      }
      try { const c = await remote.getCommercial(res.layers.static, early.doc ? { doc: early.doc } : undefined); if (c) res.layers.commercial = c; connectivity && connectivity.report('commercial', true); }
      catch (e) { connectivity && connectivity.report('commercial', false, e); res.layers.commercial = bundledCommercial(commercialRepo, res.layers.static); L.note('commercial unavailable, using bundled table', { error: e.message }); }
      try { const a = remote.getAvailability && await remote.getAvailability(manifest, res.layers.static); if (a) res.layers.availability = a; }
      catch (e) { connectivity && connectivity.report('availability', false, e); }
      self.origin = 'REMOTE'; self.lastLoad = { origin: 'REMOTE', ms: now() - t0, manifest, at: now(), commercialConfirmed: !!(res.layers.commercial && res.layers.commercial.source === 'REMOTE'), availabilityConfirmed: !!(res.layers.availability && res.layers.availability.source === 'REMOTE') };
      self.pendingPersist = persistAll(res, manifest); // in background: the map does not wait for the cache write
      return { ...res, origin: 'REMOTE', manifest };
    };
    function firstVisitError(e) {
      const err = new Error('Conecte-se à internet para carregar este empreendimento pela primeira vez.');
      err.code = 'FIRST_VISIT_OFFLINE'; err.cause = e; return err;
    }
    return self;
  }

  // ---------------------------------------------------------------- SyncManager
  /** One sync per development at a time (lock), debounced triggers, revision checks before applying. */
  function SyncManager({ dev, repo, source, local, remote, connectivity, win = (typeof window !== 'undefined' ? window : null), opts = {} }) {
    let state = 'IDLE', running = null, queued = null, lastAttemptAt = 0, lastSuccessfulSyncAt = null, lastError = null, lastResult = null, seq = 0, ac = null, subs = [];
    const debounceMs = opts.debounceMs == null ? 2000 : opts.debounceMs;
    const emit = () => subs.forEach(fn => { try { fn(info()); } catch (e) { console.error(e); } });
    const info = () => ({ state, lastAttemptAt: lastAttemptAt ? iso(lastAttemptAt) : null, lastSuccessfulSyncAt, lastError, lastResult, running: !!running });
    const setState = s => { state = s; emit(); };

    /** dynamic data could not be confirmed now: keep the last known value, marked STALE */
    function markDynamicStale(why) {
      const a = repo.touch('commercial', { stale: true }), b = repo.touch('availability', { stale: true });
      if ((a.changed || b.changed)) track('stale_dynamic_used', { why });
    }
    function sync(reason = 'manual', o = {}) {
      const scope = o.scope || 'all';
      if (running) { queued = queued === 'all' || scope === 'all' ? 'all' : 'dynamic'; return running; } // thundering herd: one at a time
      if (reason !== 'manual' && reason !== 'boot' && now() - lastAttemptAt < debounceMs) return Promise.resolve(lastResult);
      const mine = ++seq; ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      running = run(reason, scope, mine).finally(() => {
        running = null;
        if (queued) { const q = queued; queued = null; lastAttemptAt = 0; sync('queued', { scope: q }); }
      });
      return running;
    }
    async function run(reason, scope, mine) {
      const t0 = now(); lastAttemptAt = t0; setState('SYNCING'); connectivity.beginRound();
      if (source && source.pendingPersist) { try { await source.pendingPersist; } catch (e) { /* noted by persistAll */ } } // first cache write finishes before sync touches the cache
      const out = { reason, scope, static: 'skipped', analysis: 'skipped', commercial: 'skipped', availability: 'skipped', manifest: null };
      const signal = ac ? ac.signal : undefined, current = () => mine === seq;
      let manifest = null;
      // topic 47/48: the first visit has just confirmed manifest + commercial (+ availability when announced) with the source;
      // asking again seconds later is a duplicate request. Reuse is bounded in time and only for what was really confirmed.
      const ll = source && source.lastLoad, reuseMs = opts.bootReuseMs == null ? 30000 : opts.bootReuseMs;
      if (reason === 'boot' && ll && ll.origin === 'REMOTE' && ll.manifest && ll.commercialConfirmed && now() - (ll.at || 0) <= reuseMs) {
        const L0 = repo.getLayers(), fresh = l => l && l.source === 'REMOTE' && !l.stale;
        if (fresh(L0.commercial) && L0.static.staticDataVersion === ll.manifest.staticVersion && L0.analysis && L0.analysis.analysisVersion === ll.manifest.analysisVersion) {
          out.manifest = 'reused'; out.static = out.analysis = 'current'; out.commercial = 'confirmed';
          out.availability = !ll.manifest.availabilityPath ? 'no-feed' : ll.availabilityConfirmed && fresh(L0.availability) ? 'confirmed' : 'skipped';
          if (out.availability !== 'skipped') { lastSuccessfulSyncAt = L0.commercial.confirmedAt || iso(); return finish(out, t0, 'SUCCESS'); }
        }
      }
      if (remote.getManifest) {
        try { manifest = await remote.getManifest({ signal }); connectivity.report('manifest', true); out.manifest = 'ok'; }
        catch (e) {
          connectivity.report('manifest', false, e); out.manifest = 'error'; lastError = e.message;
          if (e.network) { markDynamicStale('manifest'); return finish(out, t0, connectivity.get() === 'OFFLINE' ? 'OFFLINE' : 'ERROR'); }
        }
      }
      const layers = repo.getLayers();
      // static / analysis: cache-first + background version check; replaced atomically when the version changed
      if (scope === 'all' && manifest && current()) {
        const needStatic = layers.static.staticDataVersion !== manifest.staticVersion, needAnalysis = !layers.analysis || layers.analysis.analysisVersion !== manifest.analysisVersion;
        if (needStatic || needAnalysis) {
          try {
            const res = await remote.getStructural(manifest, { signal });
            if (!current()) return finish(out, t0, 'IDLE');
            if (manifest.checksums && (checksum(res.layers.static.lots) !== manifest.checksums.static || checksum(res.layers.analysis.lots) !== manifest.checksums.analysis))
              throw new Error('checksum dos dados não confere com o manifest (versão não ativada)');
            if (needStatic) { const r = repo.applyStructuralUpdate(res.layers.static); out.static = r.applied || r.reason === 'mesma versão' ? 'updated' : 'rejected'; if (!r.applied && r.errors) throw new Error('dados estruturais inválidos'); }
            if (needAnalysis) { const r = repo.applyAnalyticalUpdate(res.layers.analysis); out.analysis = r.applied || r.reason === 'mesma versão' ? 'updated' : 'rejected'; if (!r.applied && r.errors) throw new Error('análise inválida'); }
            // save new → switch pointer → remove old (never the other way round)
            const now2 = repo.getLayers(), norm = { normalization: { warnings: res.warnings || [], variants: res.variants || [], unmapped: res.unmapped || [] } };
            try {
              if (needStatic) { await local.putStaticSnapshot(now2.static, norm); await local.activate('static', now2.static.staticDataVersion, manifest); }
              if (needAnalysis || needStatic) { await local.putAnalysisSnapshot(now2.analysis); await local.activate('analysis', now2.analysis.analysisVersion, manifest); }
            } catch (e) { L.note('cache write failed', { error: e.message }); }
          } catch (e) { lastError = e.message; if (out.static === 'skipped') out.static = 'error'; if (out.analysis === 'skipped') out.analysis = 'error'; L.note('structural sync failed', { error: e.message }); }
        } else { out.static = out.analysis = 'current'; }
      }
      // dynamic: network-first; success → FRESH + cache, failure → last known, STALE
      if (!current()) return finish(out, t0, 'IDLE');
      const st = repo.getLayers().static;
      try {
        const c = await remote.getCommercial(st, { signal });
        if (!current()) return finish(out, t0, 'IDLE');
        connectivity.report('commercial', true);
        const prev = repo.getLayers().commercial;
        if (c && prev && prev.priceTableVersion === c.priceTableVersion && prev.revision === c.revision) { repo.touch('commercial', { source: 'REMOTE', stale: false, confirmedAt: c.confirmedAt }); out.commercial = 'confirmed'; }
        else if (c) { const r = repo.applyCommercialUpdate(c); out.commercial = r.applied ? 'updated' : r.reason === 'revisão antiga' ? 'ignored-old' : 'rejected'; if (!r.applied && r.reason !== 'revisão antiga') throw new Error('tabela comercial rejeitada'); }
      } catch (e) { connectivity.report('commercial', false, e); repo.touch('commercial', { stale: true }); out.commercial = 'error'; lastError = e.message; }
      try {
        const a = remote.getAvailability ? await remote.getAvailability(manifest, st, { signal }) : null;
        if (!current()) return finish(out, t0, 'IDLE');
        if (a) {
          const prev = repo.getLayers().availability;
          if (prev && prev.revision === a.revision) { repo.touch('availability', { source: 'REMOTE', stale: false, confirmedAt: a.confirmedAt }); out.availability = 'confirmed'; }
          else { const r = repo.applyAvailabilityUpdate(a); out.availability = r.applied ? 'updated' : r.reason === 'revisão antiga' ? 'ignored-old' : 'rejected'; }
        } else out.availability = 'no-feed';
      } catch (e) { connectivity.report('availability', false, e); repo.touch('availability', { stale: true }); out.availability = 'error'; lastError = e.message; }
      const L2 = repo.getLayers();
      try { await local.putDynamicState(L2.commercial && L2.commercial.source !== 'BUNDLED' ? L2.commercial : null, L2.availability, { confirmedAt: out.commercial === 'confirmed' || out.commercial === 'updated' ? iso() : null }); }
      catch (e) { L.note('cache write failed', { error: e.message, quota: e.name === 'QuotaExceededError' }); }
      const failed = ['static', 'analysis', 'commercial', 'availability'].filter(k => out[k] === 'error' || out[k] === 'rejected').length + (out.manifest === 'error' ? 1 : 0);
      const ok = ['commercial', 'static', 'analysis'].some(k => ['confirmed', 'updated', 'current'].includes(out[k]));
      if (ok && (out.commercial === 'confirmed' || out.commercial === 'updated')) lastSuccessfulSyncAt = iso();
      return finish(out, t0, failed === 0 ? 'SUCCESS' : ok ? 'PARTIAL' : (connectivity.get() === 'OFFLINE' ? 'OFFLINE' : 'ERROR'));
    }
    async function finish(out, t0, st) {
      out.durationMs = now() - t0; lastResult = out;
      if (st === 'SUCCESS') lastError = null;
      if (st === 'ERROR' || st === 'OFFLINE') track('sync_failed', { reason: out.reason, error: lastError });
      try { await local.putSyncState({ state: st, lastAttemptAt: iso(t0), lastSuccessfulSyncAt, lastError, durationMs: out.durationMs, result: out }); } catch (e) { /* storage full or unavailable */ }
      setState(st);
      return out;
    }
    /** triggers: boot (caller), reconnect, back to foreground; going offline marks dynamic data STALE */
    let started = false;
    function start() {
      if (started || !win) return; started = true;
      connectivity.subscribe((s, prev) => {
        if (s === 'OFFLINE') { if (ac) ac.abort(); markDynamicStale('offline'); setState('OFFLINE'); }
        if (s === 'UNKNOWN' && prev === 'OFFLINE') sync('reconnect', { scope: 'all' });
      });
      const doc = win.document;
      if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible' && now() - lastAttemptAt > ((dev.offline && dev.offline.foregroundRevalidateAfterMs) || 60000)) sync('foreground', { scope: 'dynamic' });
      });
    }
    async function restore() { try { const s = await local.getSyncState(); if (s) { lastSuccessfulSyncAt = s.lastSuccessfulSyncAt || null; } } catch (e) { /* no cache */ } }
    return { sync, start, restore, info, markDynamicStale, abort: () => ac && ac.abort(), subscribe: fn => { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; } };
  }

  // ---------------------------------------------------------------- AssetCache (Cache Storage)
  /** Images by checksum: `planta.webp?v=<checksum>` so a replaced file is never served from an eternal cache.
      Lazy: an asset is cached when it is first shown. Falls back to the plain URL when Cache Storage is missing. */
  function AssetCache(dev, { local, cachesApi = (typeof caches !== 'undefined' ? caches : null), fetchFn = null, toUrl = null } = {}) {
    const name = `ws:${dev.id}:assets`, urls = new Map(), inflight = new Map(); // inflight: one download per path (topic 47 dedup)
    let entries = {}; // path → { checksum, bytes, priority }
    const objUrl = toUrl || (blob => URL.createObjectURL(blob));
    const keyOf = p => `${p}?v=${(entries[p] && entries[p].checksum) || '0'}`;
    function setManifest(m) { entries = Object.fromEntries(((m && m.assets) || []).map(a => [a.path, a])); }
    async function open() { if (!cachesApi) return null; try { return await cachesApi.open(name); } catch (e) { return null; } }
    function get(path) {
      if (urls.has(path)) return Promise.resolve(urls.get(path));
      if (inflight.has(path)) return inflight.get(path);
      const p = load(path).finally(() => inflight.delete(path)); inflight.set(path, p); return p;
    }
    async function load(path) {
      const c = await open(), f = fetchFn || net.fetchImpl || fetch;
      if (!c) return path;
      try {
        const hit = await c.match(keyOf(path));
        if (hit) { track('cache_hit', { asset: path }); const u = objUrl(await hit.blob()); urls.set(path, u); touch(path, null); return u; }
      } catch (e) { /* unreadable entry: refetch */ }
      try {
        const r = await f(path, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        try { await c.put(keyOf(path), new Response(blob, { headers: { 'content-type': blob.type || 'application/octet-stream' } })); touch(path, blob.size); await cleanupPath(c, path); }
        catch (e) { L.note('asset cache write failed', { path, quota: e.name === 'QuotaExceededError', error: e.message }); }
        track('cache_miss', { asset: path });
        const u = objUrl(blob); urls.set(path, u); return u;
      } catch (e) {
        // offline: an older copy of the same file is better than nothing (shown as cached data)
        try { const old = (await c.keys()).find(k => k.url.split('?')[0].endsWith('/' + path)); if (old) { const u = objUrl(await (await c.match(old)).blob()); urls.set(path, u); return u; } } catch (x) { /* none */ }
        return path;
      }
    }
    function touch(path, bytes) { if (!local) return; const e = entries[path] || {}; local.putAsset({ path, checksum: e.checksum || null, bytes: bytes != null ? bytes : e.bytes || null, priority: e.priority || null, lastUsedAt: iso() }).catch(() => {}); }
    async function cleanupPath(c, path) { for (const k of await c.keys()) { const [p, q] = k.url.split('?'); if (p.endsWith('/' + path) && q !== 'v=' + ((entries[path] && entries[path].checksum) || '0')) await c.delete(k); } }
    async function has(path) { const c = await open(); return !!(c && await c.match(keyOf(path))); }
    async function clear() { urls.clear(); inflight.clear(); if (cachesApi) try { await cachesApi.delete(name); } catch (e) { /* ignore */ } }
    return { name, setManifest, get, has, clear, entries: () => entries };
  }

  // ---------------------------------------------------------------- storage quota
  async function storageEstimate() {
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } } catch (e) { /* unsupported */ }
    return null;
  }
  async function requestPersistence() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } }

  // ---------------------------------------------------------------- Service Worker (network/cache only)
  /** Progressive enhancement: the app works online without it. No business rule lives in the worker.
      Topic 49: superseded by App.pwa.update.PwaUpdateCoordinator (blockers, pending queue, mixed versions); kept for the current app.js. */
  function registerServiceWorker({ url = 'sw.js', onUpdate } = {}) {
    const out = { supported: false, registered: false, error: null, controlled: false };
    try {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(out);
      out.supported = true; out.controlled = !!navigator.serviceWorker.controller;
      return navigator.serviceWorker.register(url).then(reg => {
        out.registered = true; out.scope = reg.scope;
        const waiting = () => reg.waiting && navigator.serviceWorker.controller && onUpdate && onUpdate(() => { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); });
        waiting();
        reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); }); });
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (out.userAcceptedUpdate && !reloaded) { reloaded = true; location.reload(); } });
        return out;
      }).catch(e => { out.error = e.message; return out; });
    } catch (e) { out.error = e.message; return Promise.resolve(out); }
  }

  // ---------------------------------------------------------------- manifest (also used by the build)
  /** CacheManifest published next to the data. It only informs versions; it is not a commercial source. */
  function buildManifest({ dev, layers, assets, appVersion, generatedAt = iso() }) {
    const c = layers.commercial;
    return {
      kind: 'cache-manifest', developmentId: dev.id, schemaVersion: D.SCHEMA_VERSION, appVersion,
      staticVersion: layers.static.staticDataVersion, analysisVersion: layers.analysis.analysisVersion,
      priceTableVersion: c ? c.priceTableVersion : null, commercialRevision: c ? c.revision : null,
      availabilityRevision: null, availabilityPath: null, // no sales mirror yet
      checksums: { static: checksum(layers.static.lots), analysis: checksum(layers.analysis.lots) },
      lotCount: Object.keys(layers.static.lots).length, assets, generatedAt
    };
  }

  // ---------------------------------------------------------------- composition root
  /** HybridRepository = LotRepository(source = HybridLotSource) + SyncManager + AssetCache. */
  async function createHybrid(devId, o = {}) {
    const R = App.repos, dev = R.DevelopmentRepository.getDevelopment(devId), cfg = dev.offline || {};
    const commercialRepo = R.CommercialRepository(devId);
    const backend = await pickBackend(o);
    const local = LocalCacheRepository(devId, backend);
    const connectivity = o.connectivity || Connectivity(o.win);
    const ds = dev.dataSource || {};
    const remote0 = o.remote || (ds.useBackendData && App.api && App.api.ApiLotSource
      ? fromLayerSource(App.api.ApiLotSource(dev, { fallback: null }))
      : JsonRemote(dev, commercialRepo, { timeoutMs: cfg.requestTimeoutMs, retries: cfg.retries }));
    // topic 49 (integration): optional wrapper, e.g. the offline-pack fallback used only while the browser is offline; same commercialRepo
    const remote = typeof o.wrapRemote === 'function' ? (o.wrapRemote(remote0, commercialRepo) || remote0) : remote0;
    const source = HybridLotSource(dev, { remote, local, commercialRepo, connectivity, cacheReadTimeoutMs: cfg.cacheReadTimeoutMs });
    const repo = R.LotRepository(devId, { commercialRepo, source });
    const sync = SyncManager({ dev, repo, source, local, remote, connectivity, win: o.win, opts: o.syncOpts });
    const assets = AssetCache(dev, { local, cachesApi: o.cachesApi, fetchFn: o.fetchFn, toUrl: o.toUrl });
    return { dev, repo, source, local, remote, connectivity, sync, assets, backend };
  }

  return { checksum, net, NetError, Connectivity, STORES, MemoryBackend, IdbBackend, pickBackend, LocalCacheRepository, CacheCorrupt, JsonRemote, fromLayerSource,
    commercialFromDoc, availabilityFromFeed, HybridLotSource, SyncManager, AssetCache, storageEstimate, requestPersistence, registerServiceWorker, buildManifest, createHybrid,
    unknownAvailability, bundledCommercial };
})();
