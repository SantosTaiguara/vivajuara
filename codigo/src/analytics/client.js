/* analytics/client.js — topic 45: AnalyticsClient, AnalyticsContextProvider, envelope, dedupe, sampling, buffer,
   batching, retry, offline, transports, destination registry/adapters, quarantine, event health and the
   DomainEventAnalyticsBridge.

   Capture flow: semantic action → client.track → registry (known? published? allowed producer?) → consent policy →
   schema + privacy validation → context provider (organization, actor, product session, route, device, app, entity)
   → envelope (eventId, occurredAt ≠ capturedAt, schemaVersion) → clock-skew check → size check → dedupe → sampling →
   LOCAL_BUFFER (memory, namespaced by organizationId, priority eviction) and, only when a remote destination is
   enabled AND consent allows, the outbox → batch transport with bounded retry (at-least-once + server dedupe; never
   exactly-once). Invalid events go to the quarantine with a reason code — never silently discarded, never echoing
   the offending values. Every remote destination (first-party ingestion, Google Analytics, Meta, warehouse) is OFF by
   policy: nothing leaves the device. Third-party adapters only map the canonical event; no SDK is ever loaded.

   Separations kept: Product/Analytics event ≠ Technical telemetry (eventClass) ≠ Domain event (bridge input) ≠ Audit
   ≠ Security event; tracker self-diagnostics (analytics_transport_failure, analytics_buffer_overflow,
   analytics_schema_rejection) live in `diagnostics`, not in the product stream. User ≠ Customer; Product session ≠
   Auth session ≠ Presentation session ≠ Share access session ≠ Journey. */
App.eventTracking = App.eventTracking || {};
(() => {
  const ET = App.eventTracking, PRI = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
  const policyOf = () => (App.configs && App.configs.analytics && App.configs.analytics.policy) || {};
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const iso = ms => new Date(ms).toISOString();
  const bytes = o => { try { const s = JSON.stringify(o); return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length; } catch (e) { return Infinity; } };
  const getPath = (o, path) => String(path).split('.').reduce((a, k) => a == null ? undefined : a[k], o);
  const CODE = v => v == null ? null : String(v).replace(/[^A-Za-z0-9_.:\-]+/g, '_').slice(0, 64) || null;
  const ENTITY_KEYS = ['developmentId', 'lotId', 'lotRef', 'customerId', 'journeyId', 'comparisonId', 'recommendationResultId', 'presentationSnapshotId', 'shareGrantId', 'financialSimulationId'];
  const PSEUDONYMOUS_ENTITY = ['customerId', 'journeyId'];
  const DeliveryStatus = Object.freeze({ PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED', SKIPPED: 'SKIPPED' });
  const TrackStatus = Object.freeze({ ACCEPTED: 'ACCEPTED', DUPLICATE: 'DUPLICATE', SAMPLED_OUT: 'SAMPLED_OUT', QUARANTINED: 'QUARANTINED', NOT_CAPTURED: 'NOT_CAPTURED', DROPPED: 'DROPPED' });
  const ENV = { production: 'PRODUCTION', staging: 'STAGING', development: 'DEVELOPMENT', test: 'TEST' };

  /** uuid v4 (crypto when available; injected random otherwise) */
  function uuid(random) {
    try { if (!random && typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* no crypto */ }
    const r = random || Math.random, h = [];
    for (let i = 0; i < 16; i++) h.push(Math.floor(r() * 256) & 255);
    h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  /** deterministic [0,1) from a string (sampling) */
  const unit = s => parseInt(ET.privacy.hash(s), 16) / 0x100000000;

  // ================================================================== transports (AnalyticsTransport.send(batch) → result)
  /** HttpAnalyticsTransport — POST /api/v1/analytics/events. Built only when the first-party destination is enabled (D2). */
  function createHttpTransport({ fetch: f, endpoint = '/api/v1/analytics/events', timeoutMs = 8000 } = {}) {
    return { code: 'HTTP', async send(batch, meta = {}) {
      if (typeof f !== 'function') return { status: 'RETRY', errorCode: 'NETWORK' };
      let res, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      try { res = await f(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ events: batch, clientBatchId: meta.clientBatchId }), signal: ctl ? ctl.signal : undefined }); }
      catch (e) { return { status: 'RETRY', errorCode: 'NETWORK' }; } finally { if (t) clearTimeout(t); }
      if (res.status === 429) return { status: 'RETRY', errorCode: '429' };
      if (res.status >= 500) return { status: 'RETRY', errorCode: '5XX' };
      if (res.status >= 400) return { status: 'REJECTED', errorCode: String(res.status) };
      let body = null; try { body = await res.json(); } catch (e) { body = null; }
      return { status: 'OK', accepted: (body && body.accepted) || batch.map(e => e.eventId), duplicated: (body && body.duplicated) || [], rejected: (body && body.rejected) || [], serverReceivedAt: body && body.serverReceivedAt };
    } };
  }
  /** TestTransport — scripted results; records every batch */
  function createTestTransport(script = []) {
    const batches = [], queue = script.slice();
    return { code: 'TEST', batches, async send(batch) { batches.push(clone(batch)); const r = queue.length ? queue.shift() : { status: 'OK' }; const out = typeof r === 'function' ? r(batch) : r;
      return out.status === 'OK' && !out.accepted ? { ...out, accepted: batch.map(e => e.eventId).filter(id => !(out.duplicated || []).includes(id) && !(out.rejected || []).some(x => x.eventId === id)) } : out; } };
  }
  /** DevConsoleTransport — names and versions only; never in production */
  function createDevConsoleTransport(out = (typeof console !== 'undefined' ? console : null)) {
    return { code: 'DEV_CONSOLE', async send(batch) { if (out && out.debug) out.debug('[analytics]', batch.map(e => `${e.eventName}@${e.eventVersion}`).join(', ')); return { status: 'OK', accepted: batch.map(e => e.eventId) }; } };
  }
  /** idbPersistence(indexedDB) — optional offline outbox persistence (policy buffer.persistOffline, D4). Memory stays primary. */
  function idbPersistence(idb, dbName = 'vj-analytics') {
    const open = () => new Promise((res, rej) => { const r = idb.open(dbName, 1); r.onupgradeneeded = () => r.result.createObjectStore('outbox'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = (mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction('outbox', mode), st = t.objectStore('outbox'); const r = fn(st); t.oncomplete = () => { db.close(); res(r && r.result); }; t.onerror = () => { db.close(); rej(t.error); }; }));
    return { save: (org, entries) => tx('readwrite', st => st.put(clone(entries), 'org:' + org)), load: org => tx('readonly', st => st.get('org:' + org)).then(v => v || []), clear: org => tx('readwrite', st => st.delete('org:' + org)) };
  }

  // ================================================================== destination adapters (canonical → vendor, never the reverse)
  const adapters = Object.freeze({
    LOCAL_BUFFER: { map: env => env },
    FIRST_PARTY_INGESTION: { map: env => env },
    CUSTOM_WAREHOUSE: { map: env => env },
    DEBUG: { map: env => ({ eventName: env.eventName, eventVersion: env.eventVersion }) },
    GOOGLE_ANALYTICS: { map: (env, pol) => ET.privacy.vendorPayload(env, ((pol.destinations || {}).GOOGLE_ANALYTICS || {}).mappings && pol.destinations.GOOGLE_ANALYTICS.mappings[env.eventName], pol) },
    META_PIXEL: { map: (env, pol) => ET.privacy.vendorPayload(env, ((pol.destinations || {}).META_PIXEL || {}).mappings && pol.destinations.META_PIXEL.mappings[env.eventName], pol) }
  });

  // ================================================================== AnalyticsClient
  /** createClient(opts) — opts: { registry, policy, now(), random(), context() (AnalyticsContextProvider), transports{DEST}, destinations{DEST:{enabled}}, persistence, environment } */
  function createClient(opts = {}) {
    const reg = () => opts.registry || ET.registry.current();
    const pol = () => opts.policy || policyOf();
    const now = opts.now || (() => Date.now()), random = opts.random || null;
    const B = () => ({ maxLocalEventsPerOrganization: 2000, maxEventsInMemory: 500, maxBatchSize: 25, maxQuarantine: 200, maxDedupKeys: 5000, maxOfflineAgeSeconds: 604800, ...(pol().buffer || {}) });
    const L = () => ({ maxEventBytes: 4096, maxBatchBytes: 65536, ...(pol().payload || {}) });
    const R = () => ({ maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 60000, backoffMultiplier: 2, jitter: true, ...(pol().retry || {}) });
    const destCfg = code => ({ ...((pol().destinations || {})[code] || {}), ...((opts.destinations || {})[code] || {}) });
    const environment = () => { const e = opts.environment || (App.authz && App.authz.environment ? App.authz.environment() : 'production'); return ENV[String(e).toLowerCase()] || 'PRODUCTION'; };
    let consent = ((pol().consent || {}).defaultState) || 'UNKNOWN', online = true;
    let identity = { userId: null, organizationId: null };
    let session = null, seq = 0;
    const spaces = new Map(); // organizationId → namespace (buffer isolation, §116–117)
    const diagnostics = [], recent = [], wiredNames = new Set();
    const health = { captured: 0, accepted: 0, duplicated: 0, quarantined: 0, sampledOut: 0, notCaptured: 0, dropped: 0, droppedByReason: {}, propertiesDropped: 0, purgedByConsent: 0, sent: 0, acceptedRemote: 0, duplicatedRemote: 0, rejectedRemote: 0, deliveryFailures: 0, lastDeliveryLagMs: null, evictedLocal: 0, truncatedBefore: null, observed: {} };
    const space = org => { const k = org || '_unresolved'; if (!spaces.has(k)) spaces.set(k, { local: [], outbox: [], quarantine: [], dedup: new Map(), onChange: new Map() }); return spaces.get(k); };
    const diag = (code, ref) => { diagnostics.push({ code, ref: ref || null, at: iso(now()) }); if (diagnostics.length > 200) diagnostics.shift(); };
    const drop = (reason, n = 1) => { health.dropped += n; health.droppedByReason[reason] = (health.droppedByReason[reason] || 0) + n; };

    // ---------------------------------------------------------------- product session (§13–14): 30 min inactivity, rotated on logout/user/tenant switch
    function productSession(t) {
      const mins = ((pol().session || {}).inactivityMinutes) || 30;
      if (!session || t - session.lastActivityAt > mins * 60000) session = { id: 'ps_' + uuid(random), anonymousId: 'anon_' + uuid(random), startedAt: t, lastActivityAt: t, rotatedBy: session ? 'INACTIVITY' : 'START' };
      session.lastActivityAt = Math.max(session.lastActivityAt, t); return session;
    }
    const rotate = why => { session = null; const s = productSession(now()); s.rotatedBy = why; return s; };
    /** setIdentity({ userId, organizationId }) — logout drops userId and rotates; a different user never inherits the session (no stitching); tenant switch rotates and keeps queues apart */
    function setIdentity(next = {}) {
      const prev = identity, n = { userId: next.userId || null, organizationId: next.organizationId || null };
      let why = null;
      if (prev.organizationId && n.organizationId && prev.organizationId !== n.organizationId) why = 'TENANT_SWITCH';
      else if (prev.userId && !n.userId) why = 'LOGOUT';
      else if (prev.userId && n.userId && prev.userId !== n.userId) why = 'USER_SWITCH';
      identity = n; if (why) rotate(why); return { rotated: !!why, reason: why };
    }
    // ---------------------------------------------------------------- AnalyticsContextProvider (§50): authoritative context, never overridable by payload
    function context() {
      let c = {}; try { c = (opts.context ? opts.context() : {}) || {}; } catch (e) { c = {}; }
      return { ...c, organizationId: identity.organizationId || c.organizationId || null, userId: identity.userId || c.userId || null };
    }

    // ---------------------------------------------------------------- quarantine (§83): reason + issue paths; offending values never stored
    function quarantine(org, name, version, reason, issues, extra = {}) {
      const sp = space(org), q = { quarantineId: 'q_' + uuid(random), eventName: name || null, eventVersion: version || null, reason, issues: (issues || []).map(i => ({ code: i.code, path: i.path })), at: iso(now()), source: extra.source || 'WEB_CLIENT', legacyName: extra.legacyName || null };
      sp.quarantine.push(q); if (sp.quarantine.length > B().maxQuarantine) { sp.quarantine.shift(); drop('QUARANTINE_OVERFLOW'); }
      health.quarantined++; diag('analytics_schema_rejection', `${name || '?'}:${reason}`);
      return { status: TrackStatus.QUARANTINED, reason, issues: q.issues, quarantineId: q.quarantineId };
    }
    // ---------------------------------------------------------------- dedupe (§41–45)
    function dedupKey(def, env, ctx) {
      const d = def.deduplication || { mode: 'EVENT_ID' }, vals = () => (d.keyFields || []).map(f => { const v = getPath(env, f); return Array.isArray(v) ? v.slice().sort().join('+') : v; });
      switch (d.mode) {
        case 'NONE': return null;
        case 'IDEMPOTENCY_KEY': return { k: 'idem:' + (env.idempotencyKey || env.eventId) };
        case 'SESSION_ONCE': { const v = vals(); return v.some(x => x == null || x === '') ? { k: 'id:' + env.eventId } : { k: `once:${def.name}:${v.join('|')}` }; }
        case 'ENTITY_WINDOW': return { k: `win:${def.name}:${env.session.productSessionId}:${vals().join('|')}`, windowMs: d.windowMs };
        case 'ON_CHANGE': return { k: 'id:' + env.eventId, change: { slot: `chg:${def.name}:${env.session.productSessionId}`, value: vals().join('|') } };
        default: return { k: 'id:' + env.eventId };
      }
    }
    function isDuplicate(sp, def, env, t, ctx) {
      const max = B().maxDedupKeys, remember = (k, v) => { sp.dedup.delete(k); sp.dedup.set(k, v); if (sp.dedup.size > max) sp.dedup.delete(sp.dedup.keys().next().value); };
      if (sp.dedup.has('id:' + env.eventId)) return true;
      const dk = dedupKey(def, env, ctx); if (!dk) { remember('id:' + env.eventId, t); return false; }
      if (dk.change) { if (sp.onChange.get(dk.change.slot) === dk.change.value) return true; sp.onChange.set(dk.change.slot, dk.change.value); }
      if (dk.windowMs) { const last = sp.dedup.get(dk.k); if (last != null && t - last < dk.windowMs) { remember(dk.k, t); return true; } remember(dk.k, t); }
      else { if (sp.dedup.has(dk.k)) return true; remember(dk.k, t); }
      if (dk.k !== 'id:' + env.eventId) remember('id:' + env.eventId, t);
      return false;
    }
    function sampledOut(def, env) {
      const s = def.sampling || { mode: 'NONE' };
      if (s.mode === 'NONE' || !(s.rate < 1)) return false;
      if (s.mode === 'RANDOM') return (random || Math.random)() >= s.rate;
      return unit(`${def.name}|${getPath(env, s.keyField || 'session.productSessionId') || env.eventId}`) >= s.rate;
    }
    /** priority eviction: LOW first, oldest first; CRITICAL last (§74) */
    function evict(list, max, reason) {
      while (list.length > max) {
        let idx = 0, best = Infinity;
        for (let i = 0; i < list.length; i++) { const p = PRI[(list[i].priority || (list[i].envelope && list[i].envelope.priority)) || 'NORMAL']; if (p < best) { best = p; idx = i; } }
        const [gone] = list.splice(idx, 1); drop(reason); diag('analytics_buffer_overflow', reason);
        if (reason === 'LOCAL_BUFFER_OVERFLOW') { health.evictedLocal++; const at = gone.envelope ? gone.envelope.occurredAt : gone.occurredAt; if (!health.truncatedBefore || at > health.truncatedBefore) health.truncatedBefore = at; }
      }
    }
    // ---------------------------------------------------------------- envelope (§7)
    function envelope(def, payload, entityIn, ctx, c, t, occurred) {
      const actorUser = c.userId || null;
      const entity = {};
      const addEntity = (src) => { for (const k of ENTITY_KEYS) if (src && src[k] != null) { if (PSEUDONYMOUS_ENTITY.includes(k) && def.privacyClass === 'NONE') continue; const v = CODE(src[k]); if (v) entity[k] = v; } };
      addEntity({ developmentId: c.developmentId }); addEntity(entityIn); addEntity(ctx.entity);
      const ps = productSession(t);
      const env = {
        eventId: ctx.eventId || uuid(random), eventName: def.name, eventVersion: def.version, organizationId: c.organizationId,
        occurredAt: iso(occurred), capturedAt: iso(t),
        actor: { actorType: ctx.source === 'DOMAIN_BRIDGE' || ctx.source === 'SERVER' ? (actorUser ? 'USER' : 'SYSTEM') : actorUser ? 'USER' : 'ANONYMOUS', ...(actorUser ? { userId: CODE(actorUser) } : { anonymousId: ps.anonymousId }), ...(def.privacyClass === 'PSEUDONYMOUS' && c.customerId ? { customerId: CODE(c.customerId) } : {}) },
        session: { productSessionId: ps.id, ...(ctx.presentationSessionId || c.presentationSessionId ? { presentationSessionId: CODE(ctx.presentationSessionId || c.presentationSessionId) } : {}), ...(ctx.shareAccessSessionId || c.shareAccessSessionId ? { shareAccessSessionId: CODE(ctx.shareAccessSessionId || c.shareAccessSessionId) } : {}), ...(def.privacyClass === 'PSEUDONYMOUS' && c.journeyId ? { journeyId: CODE(c.journeyId) } : {}) },
        navigation: { ...(c.routeCode ? { routeCode: CODE(c.routeCode) } : {}), ...(ctx.navigationSource ? { navigationSource: CODE(ctx.navigationSource) } : {}) },
        device: { deviceClass: ['DESKTOP', 'TABLET', 'MOBILE', 'EXTERNAL_DISPLAY'].includes(c.deviceClass) ? c.deviceClass : 'UNKNOWN', ...(c.viewportClass ? { viewportClass: CODE(c.viewportClass) } : {}), ...(['TOUCH', 'POINTER', 'MIXED'].includes(c.inputMode) ? { inputMode: c.inputMode } : {}), ...(c.locale ? { locale: CODE(c.locale) } : {}), ...(c.timezone ? { timezone: String(c.timezone).slice(0, 64) } : {}) },
        app: { appVersion: CODE(c.appVersion) || 'unknown', ...(c.buildId ? { buildId: CODE(c.buildId) } : {}), environment: environment(), platform: c.platform === 'PWA' ? 'PWA' : 'WEB', ...(Array.isArray(c.featureFlags) ? { featureFlags: c.featureFlags.map(CODE).filter(Boolean).slice(0, 20) } : {}) },
        entity, payload,
        privacy: { consentState: def.consentRequirement === 'NOT_REQUIRED_BY_POLICY' ? 'NOT_REQUIRED_BY_POLICY' : consent, piiClass: def.privacyClass, purposeCodes: def.purposes.slice() },
        source: ctx.source || 'WEB_CLIENT', schemaVersion: reg().schemaVersion || 'analytics-envelope/1',
        ...(ctx.idempotencyKey ? { idempotencyKey: String(ctx.idempotencyKey).slice(0, 200) } : {}), ...(ctx.correlationId ? { correlationId: CODE(ctx.correlationId) } : {}), ...(ctx.causationId ? { causationId: CODE(ctx.causationId) } : {}),
        category: def.category, eventClass: def.eventClass, priority: def.priority
      };
      return env;
    }

    /** track(name, payload, ctx?) → result. Sync and cheap; never throws to the caller. ctx: { legacy, source, version, occurredAt, eventId,
        idempotencyKey, correlationId, causationId, presentationSessionId, shareAccessSessionId, entity, navigationSource, organizationId (must match) } */
    function track(name, payload, ctx = {}) {
      try { return trackUnsafe(name, payload, ctx || {}); } catch (e) { diag('analytics_internal_error', e && e.code || 'ERROR'); drop('INTERNAL_ERROR'); return { status: TrackStatus.DROPPED, reason: 'INTERNAL_ERROR' }; }
    }
    function trackUnsafe(name, payload, ctx) {
      const t = now(), c = context(), org = c.organizationId, r = reg(), P = pol(), strict = !ctx.legacy;
      health.captured++;
      const { def: def0, legacy } = r.resolveName(String(name || ''), { legacy: !!ctx.legacy });
      if (!def0) return quarantine(org, String(name || '').slice(0, 64), ctx.version, 'UNKNOWN_EVENT', [], { source: ctx.source, legacyName: ctx.legacy ? name : null });
      const def = ctx.version != null && !legacy ? r.get(def0.name, ctx.version) : def0;
      if (!def) return quarantine(org, def0.name, ctx.version, 'UNSUPPORTED_VERSION', []);
      if (def.status !== 'PUBLISHED' && !(def.status === 'DEPRECATED') && environment() === 'PRODUCTION') return quarantine(org, def.name, def.version, 'NOT_PUBLISHED', []);
      const source = ctx.source || 'WEB_CLIENT';
      if (!def.sources.includes(source)) return quarantine(org, def.name, def.version, 'PRODUCER_NOT_ALLOWED', [{ code: 'PRODUCER_NOT_ALLOWED', path: source }], { source });
      if (ctx.organizationId != null && ctx.organizationId !== org) return quarantine(org, def.name, def.version, 'TENANT_MISMATCH', [{ code: 'TENANT_MISMATCH', path: 'organizationId' }], { source });
      if (!org) return quarantine(null, def.name, def.version, 'TENANT_UNRESOLVED', [], { source });
      const cd = ET.privacy.consentDecision(def, consent, P);
      if (!cd.capture) { health.notCaptured++; return { status: TrackStatus.NOT_CAPTURED, reason: cd.reason }; }
      // payload: legacy transformer first (declarative), then schema + privacy
      let body = payload, entityIn = null;
      if (legacy) { const tr = r.transformLegacy(legacy, payload); body = tr.payload; entityIn = tr.entity; health.propertiesDropped += tr.dropped.length; }
      const v = r.validatePayload(def, body, { strict, policy: P });
      if (!v.ok) { const err = v.issues.find(i => i.severity === 'ERROR'); return quarantine(org, def.name, def.version, err && err.code === 'PRIVACY_VIOLATION' || v.issues.some(i => i.code === 'PRIVACY_VIOLATION' && i.severity === 'ERROR') ? 'PRIVACY_VIOLATION' : (err && err.code === 'INVALID_ENUM' ? 'INVALID_ENUM' : 'SCHEMA_INVALID'), v.issues, { source, legacyName: legacy ? name : null }); }
      health.propertiesDropped += v.issues.filter(i => i.severity === 'WARNING').length;
      // timestamps + clock skew (§8–9): occurredAt is kept; impossible future → quarantine; too old → expired
      const occurred = ctx.occurredAt != null ? (typeof ctx.occurredAt === 'number' ? ctx.occurredAt : Date.parse(ctx.occurredAt)) : t;
      if (!Number.isFinite(occurred)) return quarantine(org, def.name, def.version, 'INVALID_TIMESTAMP', [{ code: 'INVALID_TIMESTAMP', path: 'occurredAt' }], { source });
      const ck = { futureToleranceSeconds: 300, maxEventAgeSeconds: 604800, ...(P.clock || {}) };
      if (occurred > t + ck.futureToleranceSeconds * 1000) return quarantine(org, def.name, def.version, 'INVALID_TIMESTAMP', [{ code: 'INVALID_TIMESTAMP', path: 'occurredAt' }], { source });
      if (occurred < t - ck.maxEventAgeSeconds * 1000) { drop('EXPIRED'); return { status: TrackStatus.DROPPED, reason: 'EXPIRED' }; }
      const env = envelope(def, v.payload, entityIn, ctx, c, t, occurred);
      if (bytes(env) > L().maxEventBytes) return quarantine(org, def.name, def.version, 'PAYLOAD_TOO_LARGE', [{ code: 'PAYLOAD_TOO_LARGE', path: '' }], { source });
      const sp = space(org);
      if (isDuplicate(sp, def, env, t, ctx)) { health.duplicated++; return { status: TrackStatus.DUPLICATE, eventId: env.eventId }; }
      if (sampledOut(def, env)) { health.sampledOut++; return { status: TrackStatus.SAMPLED_OUT }; }
      env.sequenceNumber = ++seq; // producer-local order only (never a global sequence)
      // destinations: LOCAL_BUFFER always local; remote ones only when enabled AND consent allows
      const deliveries = {};
      for (const dcode of def.destinations) {
        const dc = destCfg(dcode);
        if (dcode === 'LOCAL_BUFFER') { if (dc.enabled !== false) { sp.local.push(env); evict(sp.local, B().maxLocalEventsPerOrganization, 'LOCAL_BUFFER_OVERFLOW'); } continue; }
        if (dcode === 'DEBUG') { if (dc.enabled && environment() !== 'PRODUCTION' && App.debug) deliveries.DEBUG = { status: DeliveryStatus.PENDING, attempts: 0 }; continue; }
        if (!dc.enabled) { deliveries[dcode] = { status: DeliveryStatus.SKIPPED, attempts: 0, errorCode: 'DESTINATION_DISABLED' }; continue; }
        if (dc.consentRequired !== false && !cd.remote) { deliveries[dcode] = { status: DeliveryStatus.SKIPPED, attempts: 0, errorCode: 'CONSENT' }; continue; }
        if (!adapters[dcode]) { deliveries[dcode] = { status: DeliveryStatus.SKIPPED, attempts: 0, errorCode: 'UNKNOWN_DESTINATION' }; continue; }
        if ((dcode === 'GOOGLE_ANALYTICS' || dcode === 'META_PIXEL') && !adapters[dcode].map(env, P)) { deliveries[dcode] = { status: DeliveryStatus.SKIPPED, attempts: 0, errorCode: 'NO_MAPPING' }; continue; }
        deliveries[dcode] = { status: DeliveryStatus.PENDING, attempts: 0, nextAttemptAt: t };
      }
      if (Object.values(deliveries).some(d => d.status === DeliveryStatus.PENDING)) { sp.outbox.push({ envelope: env, deliveries, priority: def.priority }); evict(sp.outbox, B().maxEventsInMemory, 'OUTBOX_OVERFLOW'); persist(org); }
      health.accepted++; health.observed[def.name] = (health.observed[def.name] || 0) + 1;
      recent.push({ evt: def.name, data: clone(v.payload), t, eventId: env.eventId, version: def.version, legacyName: legacy ? name : null, deliveries: Object.fromEntries(Object.entries(deliveries).map(([k, d]) => [k, d.status])) }); if (recent.length > 100) recent.shift();
      return { status: TrackStatus.ACCEPTED, eventId: env.eventId, eventName: def.name, version: def.version, deliveries, warnings: v.issues.filter(i => i.severity === 'WARNING').map(i => ({ code: i.code, path: i.path })) };
    }

    // ---------------------------------------------------------------- consent (§88–89)
    /** setConsent(state) — DENIED purges consent-dependent events from the local buffer and the outbox before any flush */
    function setConsent(state) {
      const S = ET.privacy.ConsentState; if (!S[state]) return { ok: false, reason: 'INVALID_CONSENT_STATE' };
      consent = state; let purged = 0;
      if (state === 'DENIED' || state === 'UNKNOWN') for (const sp of spaces.values()) {
        const keep = e => e.privacy && e.privacy.consentState === 'NOT_REQUIRED_BY_POLICY';
        if (state === 'DENIED') { const n0 = sp.local.length; sp.local = sp.local.filter(keep); purged += n0 - sp.local.length; }
        const o0 = sp.outbox.length; sp.outbox = sp.outbox.filter(x => keep(x.envelope)); purged += o0 - sp.outbox.length;
      }
      health.purgedByConsent += purged; for (const org of spaces.keys()) persist(org);
      return { ok: true, state, purged };
    }
    // ---------------------------------------------------------------- flush / retry / offline (§66–73)
    const backoff = attempts => { const r = R(), base = Math.min(r.maxDelayMs, r.initialDelayMs * Math.pow(r.backoffMultiplier, Math.max(0, attempts - 1))); return r.jitter ? Math.round(base * (0.5 + 0.5 * (random || Math.random)())) : base; };
    let flushing = null;
    /** flush() → Promise<summary>. Batches per organization and destination; bounded retry; 400 → quarantine (no retry). */
    function flush() { if (flushing) return flushing; flushing = doFlush().finally(() => { flushing = null; }); return flushing; }
    async function doFlush() {
      const sum = { batches: 0, sent: 0, accepted: 0, duplicated: 0, rejected: 0, retried: 0, dropped: 0, skipped: 0, reason: null };
      if (!online) { sum.reason = 'OFFLINE'; return sum; }
      const t0 = now();
      for (const [org, sp] of spaces) {
        for (const dcode of Object.keys(adapters)) {
          if (dcode === 'LOCAL_BUFFER') continue;
          const tr = (opts.transports || {})[dcode], due = sp.outbox.filter(x => x.deliveries[dcode] && x.deliveries[dcode].status === DeliveryStatus.PENDING && (x.deliveries[dcode].nextAttemptAt || 0) <= t0);
          if (!due.length) continue;
          if (!tr || !destCfg(dcode).enabled) { for (const x of due) x.deliveries[dcode] = { ...x.deliveries[dcode], status: DeliveryStatus.SKIPPED, errorCode: tr ? 'DESTINATION_DISABLED' : 'NO_TRANSPORT' }; sum.skipped += due.length; continue; }
          for (let i = 0; i < due.length;) {
            const batch = []; let size = 2;
            while (i < due.length && batch.length < B().maxBatchSize) { const m = dcode === 'FIRST_PARTY_INGESTION' || dcode === 'CUSTOM_WAREHOUSE' ? due[i].envelope : adapters[dcode].map(due[i].envelope, pol()); const b = bytes(m); if (batch.length && size + b > L().maxBatchBytes) break; batch.push({ x: due[i], m }); size += b + 1; i++; }
            sum.batches++; sum.sent += batch.length; health.sent += batch.length;
            let res; try { res = await tr.send(batch.map(b => b.m), { clientBatchId: 'cb_' + uuid(random), destination: dcode, organizationId: org }); } catch (e) { res = { status: 'RETRY', errorCode: 'NETWORK' }; }
            const at = iso(now());
            if (res.status === 'OK') {
              const acc = new Set(res.accepted || []), dup = new Set(res.duplicated || []), rej = new Map((res.rejected || []).map(x => [x.eventId, x]));
              for (const { x } of batch) {
                const id = x.envelope.eventId, d = x.deliveries[dcode];
                if (rej.has(id)) { x.deliveries[dcode] = { ...d, status: DeliveryStatus.FAILED, attempts: d.attempts + 1, lastAttemptAt: at, errorCode: CODE(rej.get(id).reason) || 'REJECTED' }; sum.rejected++; health.rejectedRemote++; quarantine(org, x.envelope.eventName, x.envelope.eventVersion, 'SERVER_REJECTED', [{ code: CODE(rej.get(id).reason) || 'REJECTED', path: '' }], { source: x.envelope.source }); }
                else { x.deliveries[dcode] = { ...d, status: DeliveryStatus.SENT, attempts: d.attempts + 1, lastAttemptAt: at }; if (dup.has(id)) { sum.duplicated++; health.duplicatedRemote++; } else { sum.accepted++; health.acceptedRemote++; } health.lastDeliveryLagMs = now() - Date.parse(x.envelope.capturedAt); }
              }
            } else if (res.status === 'REJECTED') {
              for (const { x } of batch) { const d = x.deliveries[dcode]; x.deliveries[dcode] = { ...d, status: DeliveryStatus.FAILED, attempts: d.attempts + 1, lastAttemptAt: at, errorCode: res.errorCode || '400' }; sum.rejected++; health.rejectedRemote++; quarantine(org, x.envelope.eventName, x.envelope.eventVersion, 'SERVER_REJECTED', [{ code: res.errorCode || '400', path: '' }], { source: x.envelope.source }); }
            } else {
              diag('analytics_transport_failure', `${dcode}:${res.errorCode || 'RETRY'}`); health.deliveryFailures++;
              for (const { x } of batch) {
                const d = x.deliveries[dcode], attempts = d.attempts + 1;
                if (attempts >= R().maxAttempts) { x.deliveries[dcode] = { ...d, status: DeliveryStatus.FAILED, attempts, lastAttemptAt: at, errorCode: 'RETRY_EXHAUSTED' }; drop('RETRY_EXHAUSTED'); sum.dropped++; }
                else { x.deliveries[dcode] = { ...d, attempts, lastAttemptAt: at, errorCode: res.errorCode || 'RETRY', nextAttemptAt: now() + backoff(attempts) }; sum.retried++; }
              }
            }
          }
        }
        sp.outbox = sp.outbox.filter(x => Object.values(x.deliveries).some(d => d.status === DeliveryStatus.PENDING));
        persist(org);
      }
      return sum;
    }
    function persist(org) { if (opts.persistence && (pol().buffer || {}).persistOffline) { try { const sp = space(org); Promise.resolve(opts.persistence.save(org, sp.outbox)).catch(() => diag('analytics_persistence_failure', org)); } catch (e) { diag('analytics_persistence_failure', org); } } }
    /** restore(org) — loads a persisted outbox (offline policy), discarding entries older than maxOfflineAgeSeconds (counted) */
    async function restore(org) {
      if (!opts.persistence || !(pol().buffer || {}).persistOffline) return { restored: 0 };
      const rows = (await opts.persistence.load(org)) || [], maxAge = B().maxOfflineAgeSeconds * 1000, t = now(), sp = space(org);
      let n = 0; for (const x of rows) { if (t - Date.parse(x.envelope.capturedAt) > maxAge) { drop('OFFLINE_EXPIRED'); continue; } if (!sp.outbox.some(y => y.envelope.eventId === x.envelope.eventId)) { sp.outbox.push(x); n++; } }
      evict(sp.outbox, B().maxEventsInMemory, 'OUTBOX_OVERFLOW'); return { restored: n };
    }
    /** setOnline(on) — reconnect triggers a flush (only meaningful when a remote destination is enabled) */
    function setOnline(on) { const was = online; online = !!on; return !was && online ? flush() : Promise.resolve(null); }

    // ---------------------------------------------------------------- read side (semantic layer, health, debug panel)
    /** events({ organizationId }) → accepted envelopes of that tenant only (copies). The organization is required. */
    function events(q = {}) { if (!q.organizationId) throw Object.assign(new Error('organizationId obrigatório'), { code: 'TENANT_REQUIRED' }); const sp = spaces.get(q.organizationId); return sp ? clone(sp.local) : []; }
    const outbox = org => clone((spaces.get(org) || { outbox: [] }).outbox);
    const quarantined = org => clone((spaces.get(org) || { quarantine: [] }).quarantine);
    function healthSummary() {
      const h = clone(health), c = h.captured, rate = n => c ? n / c : null;
      return { ...h, rates: { acceptRate: rate(h.accepted), duplicateRate: rate(h.duplicated), quarantineRate: rate(h.quarantined), dropRate: rate(h.dropped), sampledOutRate: rate(h.sampledOut) }, consentState: consent, online, generatedAt: iso(now()),
        remoteDestinationsEnabled: Object.keys(adapters).filter(d => d !== 'LOCAL_BUFFER' && destCfg(d).enabled && destCfg(d).remote) };
    }
    /** debugRecent(n) — dev debug panel (§110): names/versions/destinations; payloads only outside production */
    const debugRecent = (n = 20) => recent.slice(-n).reverse().map(r => ({ eventName: r.evt, version: r.version, legacyName: r.legacyName, deliveries: r.deliveries, at: iso(r.t), ...(environment() !== 'PRODUCTION' ? { payload: clone(r.data) } : {}) }));
    /** clearLocal(org) — viewer clears this device's buffer (never touches quarantine counters) */
    function clearLocal(org) { const sp = spaces.get(org); if (!sp) return 0; const n = sp.local.length; sp.local = []; return n; }
    const destinations = () => Object.keys(adapters).map(code => { const d = destCfg(code); return { code, label: d.label || code, enabled: !!d.enabled && (code !== 'DEBUG' || environment() !== 'PRODUCTION'), remote: !!d.remote, thirdParty: !!d.thirdParty, reason: d.reason || null, decisionRef: d.decisionRef || null }; });

    /** wired producers: legacy call sites (inventory), bridged domain events, explicit marks, anything observed — a metric
        whose source events have no producer is "não disponível", not 0 */
    const markWired = names => { for (const n of names || []) wiredNames.add(n); };
    function wired() { const r = reg(), out = new Set(wiredNames); for (const l of r.legacy()) out.add(l.canonicalName); for (const n of Object.keys(health.observed)) out.add(n); return out; }
    return { track, flush, markWired, wired, setConsent, consentState: () => consent, setIdentity, identity: () => ({ ...identity }), session: () => (session ? { ...session } : null), rotateSession: rotate, setOnline, isOnline: () => online, restore,
      events, outbox, quarantined, health: healthSummary, diagnostics: () => diagnostics.slice(), debugRecent, recent: () => recent.slice(), clearLocal, destinations, environment, organizations: () => [...spaces.keys()] };
  }

  // ================================================================== DomainEventAnalyticsBridge (§64–65)
  /** explicit registry: not every domain event becomes an analytics event */
  const DOMAIN_MAPPINGS = Object.freeze([
    { domainEventType: 'PresentationSnapshotCreated', analyticsEventName: 'presentation_snapshot_created', analyticsEventVersion: 1, transformerId: 'presentation.snapshot', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'PresentationStarted', analyticsEventName: 'presentation_started', analyticsEventVersion: 1, transformerId: 'presentation.session', deduplicationPolicyRef: 'SESSION_ONCE', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'PresentationStepViewed', analyticsEventName: 'presentation_step_viewed', analyticsEventVersion: 1, transformerId: 'presentation.step', deduplicationPolicyRef: 'SESSION_ONCE', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'PresentationFeedbackRecorded', analyticsEventName: 'presentation_feedback_recorded', analyticsEventVersion: 1, transformerId: 'presentation.feedback', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'PresentationCompleted', analyticsEventName: 'presentation_completed', analyticsEventVersion: 1, transformerId: 'presentation.session', deduplicationPolicyRef: 'SESSION_ONCE', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'FavoriteAdded', analyticsEventName: 'favorite_added', analyticsEventVersion: 1, transformerId: 'favorite', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'FavoriteRemoved', analyticsEventName: 'favorite_removed', analyticsEventVersion: 1, transformerId: 'favorite', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'JourneyClosedWon', analyticsEventName: 'journey_won', analyticsEventVersion: 1, transformerId: 'journey.outcome', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'DOMAIN_BRIDGE' },
    { domainEventType: 'ShareGrantIssued', analyticsEventName: 'share_grant_created', analyticsEventVersion: 1, transformerId: 'share.grant', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'SERVER' },
    { domainEventType: 'share_opened', analyticsEventName: 'share_opened', analyticsEventVersion: 1, transformerId: 'share.open', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'SERVER' },
    { domainEventType: 'share_feedback_submitted', analyticsEventName: 'share_feedback_submitted', analyticsEventVersion: 1, transformerId: 'share.feedback', deduplicationPolicyRef: 'IDEMPOTENCY_KEY', source: 'SERVER' }
  ]);
  const TRANSFORMERS = Object.freeze({
    'presentation.snapshot': e => ({ payload: { ...(e.purpose ? { purpose: e.purpose } : {}), ...(Number.isFinite(e.lotCount) ? { lotCount: e.lotCount } : {}) }, ctx: { entity: { presentationSnapshotId: e.snapshotId } } }),
    'presentation.session': e => ({ payload: {}, ctx: { presentationSessionId: e.sessionId, entity: { presentationSnapshotId: e.snapshotId } } }),
    'presentation.step': e => ({ payload: { stepId: e.stepId }, ctx: { presentationSessionId: e.sessionId } }),
    'presentation.feedback': e => ({ payload: { ...(e.type ? { feedbackType: e.type } : {}) }, ctx: { presentationSessionId: e.sessionId } }), // never the free text / presenter notes
    favorite: e => ({ payload: { contextType: e.contextType, ...(e.source ? { source: e.source } : {}) }, ctx: { entity: { lotId: e.lotId, developmentId: e.developmentId } } }),
    'journey.outcome': e => ({ payload: { ...(e.sourceCode ? { sourceCode: e.sourceCode } : {}) }, ctx: { entity: { journeyId: e.journeyId } } }),
    'share.grant': e => ({ payload: { ...(e.resourceType ? { resourceType: e.resourceType } : {}) }, ctx: { entity: { shareGrantId: e.shareGrantId } } }),
    'share.open': e => e.preview || e.isBotPreview ? null : ({ payload: {}, ctx: { entity: { shareGrantId: e.shareGrantId } } }), // bot previews never count
    'share.feedback': e => ({ payload: { ...(e.feedbackType ? { feedbackType: e.feedbackType } : {}) }, ctx: { entity: { shareGrantId: e.shareGrantId } } })
  });
  /** idempotency key = domain event id (or its refs + time) + analytics name + version (§43) */
  function idempotencyOf(e, m) {
    const id = e.eventId || e.id || [e.type, e.sessionId, e.snapshotId, e.stepId, e.feedbackId, e.favoriteId, e.journeyId, e.shareGrantId, e.at || e.timestamp].filter(x => x != null).join(':');
    return `${id}|${m.analyticsEventName}|v${m.analyticsEventVersion}`;
  }
  /** createBridge(client, mappings?) → { ingest(events) , attach(source with subscribe), mappings } */
  function createBridge(client, mappings = DOMAIN_MAPPINGS) {
    const byType = new Map(mappings.map(m => [m.domainEventType, m]));
    function ingestOne(e) {
      const m = e && byType.get(e.type); if (!m) return { status: 'NOT_MAPPED', type: e && e.type };
      const t = TRANSFORMERS[m.transformerId](e); if (!t) return { status: 'EXCLUDED', type: e.type };
      const at = e.at || e.timestamp || e.occurredAt || null;
      return client.track(m.analyticsEventName, t.payload, { ...t.ctx, version: m.analyticsEventVersion, source: m.source, idempotencyKey: idempotencyOf(e, m), causationId: e.eventId || e.id || null, ...(at ? { occurredAt: at } : {}), ...(e.organizationId ? { organizationId: e.organizationId } : {}) });
    }
    const wire = () => { if (client.markWired) client.markWired(mappings.filter(m => m.source !== 'SERVER').map(m => m.analyticsEventName)); };
    const ingest = evs => { wire(); return (Array.isArray(evs) ? evs : [evs]).map(ingestOne); };
    /** attach(source) — source.subscribe(fn) (favorites service) → unsubscribe */
    const attach = src => src && typeof src.subscribe === 'function' ? (wire(), src.subscribe(e => { try { ingestOne(e); } catch (x) { /* analytics never breaks the domain */ } })) : () => {};
    return { ingest, attach, mappings: () => mappings.slice() };
  }

  Object.assign(ET, { createClient, createHttpTransport, createTestTransport, createDevConsoleTransport, idbPersistence, adapters, createBridge, DOMAIN_MAPPINGS, TrackStatus, DeliveryStatus, uuid });
})();
