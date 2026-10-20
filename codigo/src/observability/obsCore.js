/* observability/obsCore.js — topic 51: ObservabilityContext, correlation ids, LogRedactionPolicy, StructuredLogger,
   ApplicationError taxonomy, ErrorReporter (fingerprint + dedupe), Error Boundaries and the global error handlers.

   Local-first: every signal goes to a bounded in-memory ring buffer of this tab. Nothing leaves the device (the
   REMOTE sink is off by policy, decision O1). Observability is not Product Analytics (topics 44/45), not Audit and not
   SecurityEvent (topic 50): it measures, correlates and reports, it never changes a business rule.
   Invariants: no PII, tokens, bodies or full URLs in any signal (redaction runs before the buffer); telemetry never
   throws into the caller and a failing reporter never recurses; ERROR/FATAL are never sampled away; the user sees a
   safe message and a support code, never a stack. Config: plat/config/observability/{policy,registry}.json. */
App.observability = App.observability || {};
App.observability.core = (() => {
  const cfg = () => (App.configs && App.configs.observability) || {};
  const policy = () => cfg().policy || {};
  const registry = () => cfg().registry || {};
  const LEVELS = Object.freeze(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
  const Level = Object.freeze(Object.fromEntries(LEVELS.map(l => [l, l])));
  const rank = l => Math.max(0, LEVELS.indexOf(l));
  const Category = Object.freeze(Object.fromEntries(['VALIDATION', 'AUTHENTICATION', 'AUTHORIZATION', 'NOT_FOUND', 'CONFLICT', 'DEPENDENCY', 'NETWORK', 'DATA_INTEGRITY', 'INTERNAL'].map(x => [x, x])));
  const Severity = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
  const safe = (f, d = null) => { try { return f(); } catch (e) { return d; } };
  const nowMs = o => (o && o.now != null ? (typeof o.now === 'function' ? o.now() : +new Date(o.now)) : Date.now());
  const iso = ms => new Date(ms).toISOString();

  // ---------------------------------------------------------------- ids (requestId ≠ correlationId ≠ traceId)
  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    const c = safe(() => (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null));
    if (c) c.getRandomValues(a); else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    let s = ''; for (const b of a) s += b.toString(16).padStart(2, '0');
    return /^0+$/.test(s) ? randomHex(bytes) : s; // W3C: all-zero ids are invalid
  }
  const newRequestId = () => 'req_' + randomHex(8);
  const newCorrelationId = () => 'cor_' + randomHex(8);
  const newTraceId = () => randomHex(16);
  const newSpanId = () => randomHex(8);
  const newErrorId = () => 'err_' + randomHex(6);
  /** supportCode(id) → short code a person can read over the phone ("Código do erro"), derived from an id, never from data */
  function supportCode(id) {
    const h = fnv(String(id || '')), A = 'ACDEFGHJKLMNPQRTUVWXY34679';
    let n = parseInt(h, 16), s = ''; for (let i = 0; i < 6; i++) { s += A[n % A.length]; n = Math.floor(n / A.length); }
    return 'VJ-' + s;
  }
  function fnv(text) { let h = 0x811c9dc5; const s = String(text); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  /** W3C Trace Context */
  const traceparent = ({ traceId, spanId, sampled = true }) => `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
  function parseTraceparent(h) {
    const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(h || '').trim().toLowerCase());
    if (!m || m[1] === 'ff' || /^0+$/.test(m[2]) || /^0+$/.test(m[3])) return null;
    return { version: m[1], traceId: m[2], parentSpanId: m[3], sampled: (parseInt(m[4], 16) & 1) === 1 };
  }
  /** shouldPropagate(url) — trace headers only for same-origin (relative) URLs or explicitly approved origins; never third parties */
  function shouldPropagate(url, o = {}) {
    const p = policy().propagation || {}, approved = o.approvedOrigins || p.approvedOrigins || [];
    const u = String(url || '');
    if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//') && !u.startsWith('\\')) return true; // relative = same origin
    const origin = safe(() => new URL(u).origin);
    if (!origin) return false;
    const self = o.selfOrigin || safe(() => (typeof location !== 'undefined' && location.origin) || null);
    return (!!self && origin === self) || approved.includes(origin);
  }
  /** headersFor(ctx, url) → propagation headers (empty object for a non-approved origin) */
  function headersFor(ctx, url, o = {}) {
    if (!ctx || !shouldPropagate(url, o)) return {};
    const h = {};
    if (ctx.traceId && ctx.spanId) h.traceparent = traceparent({ traceId: ctx.traceId, spanId: ctx.spanId, sampled: ctx.sampled !== false });
    if (ctx.requestId) h['x-request-id'] = ctx.requestId;
    if (ctx.correlationId) h['x-correlation-id'] = ctx.correlationId;
    return h;
  }

  // ---------------------------------------------------------------- environment + release
  function environment(o = {}) {
    if (o.environment) return o.environment;
    const env = policy().environments || {}, host = o.hostname != null ? o.hostname : safe(() => location.hostname, '') || '';
    for (const r of env.rules || []) if (host && new RegExp(r.hostPattern, 'i').test(host)) return r.environment;
    return env.default || 'production';
  }
  const release = { appVersion: null, buildId: null, commit: null, deployedAt: null };
  /** setRelease({ appVersion, buildId, commit, deployedAt }) — release marker attached to every signal (§180–182) */
  const setRelease = r => { for (const k of Object.keys(release)) if (r && r[k] != null) release[k] = String(r[k]).slice(0, 64); return { ...release }; };

  // ---------------------------------------------------------------- ObservabilityContext (§10) — never URL, never PII
  const ROUTES = ['MAP', 'LOT', 'DETAILS', 'COMPARE', 'FAVORITES', 'CUSTOMER', 'PRESENTATION', 'SHARED'];
  function routeCodeOf(st) {
    if (!st) return 'OTHER';
    const r = st.presentationView ? 'PRESENTATION' : st.panel === 'details' ? 'DETAILS' : st.currentLotId ? 'LOT' : st.view ? String(st.view).toUpperCase() : 'MAP';
    return ROUTES.includes(r) ? r : 'OTHER';
  }
  const sessionCorrelation = { id: null };
  /** GAP-ARCH-24: the app state, the auth context and the responsive profile are injected by the composition root
      (presentation/app.js → setContextSources); this infrastructure module never reads App.store/App.authz/App.responsive. */
  const sources = { state: null, auth: null, profile: null };
  const setContextSources = (o = {}) => { for (const k of Object.keys(sources)) if (typeof o[k] === 'function') sources[k] = o[k]; return Object.keys(sources).filter(k => sources[k]); };
  const read = k => sources[k] ? safe(() => sources[k]()) : null;
  /** defaultContext() — reads only authoritative app state: development, organization, route, device, connectivity, release */
  function defaultContext() {
    const st = read('state') || null, az = read('auth');
    const rp = read('profile'), fam = rp && rp.family;
    const developmentId = (st && st.developmentId) || null;
    const organizationId = (az && az.tenant && az.tenant.organizationId) || safe(() => App.tenancy.organizationOfDevelopment(developmentId)) || null;
    if (!sessionCorrelation.id) sessionCorrelation.id = newCorrelationId();
    return { environment: environment(), appVersion: release.appVersion || 'web', buildId: release.buildId, organizationId, developmentId,
      correlationId: sessionCorrelation.id, routeCode: routeCodeOf(st), deviceClass: ['MOBILE', 'TABLET', 'DESKTOP'].includes(fam) ? fam : 'UNKNOWN',
      connectivityState: st && ['ONLINE', 'OFFLINE', 'DEGRADED'].includes(String(st.connectivity).toUpperCase()) ? String(st.connectivity).toUpperCase() : 'UNKNOWN' };
  }
  const CONTEXT_KEYS = ['environment', 'appVersion', 'buildId', 'organizationId', 'developmentId', 'principalId', 'requestId', 'correlationId', 'traceId', 'spanId', 'routeCode', 'jobId', 'eventId', 'resourceType', 'resourceId', 'deviceClass', 'connectivityState', 'rendererType', 'component'];
  /** createContext(base, extra) → frozen ObservabilityContext; unknown keys are dropped (the payload cannot add fields) */
  function createContext(base = {}, extra = {}) {
    const all = { ...base, ...extra }, out = {};
    for (const k of CONTEXT_KEYS) if (all[k] != null && all[k] !== '') out[k] = typeof all[k] === 'string' ? all[k].slice(0, 80) : all[k];
    return Object.freeze(out);
  }
  /** requestContext(parent) — one new requestId per request, same correlationId (it crosses frontend → API → job) */
  const requestContext = (parent = defaultContext(), extra = {}) => createContext(parent, { requestId: newRequestId(), correlationId: parent.correlationId || newCorrelationId(), ...extra });

  // ---------------------------------------------------------------- LogRedactionPolicy (§28–33)
  const norm = k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const DETECTORS = Object.freeze({
    EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    PHONE_BR: /(?:\+?55[\s.-]?)?\(?\b[1-9]{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/,
    CPF: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
    CNPJ: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/,
    BEARER: /\bbearer\s+[A-Za-z0-9._~+\/-]+=*/i,
    JWT: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./,
    TOKEN_URL: /[?&#](?:token|t|key|sig|signature|access_token|code|auth)=[^&#\s]*|\/s\/[A-Za-z0-9_-]{8,}|X-Amz-Signature|X-Goog-Signature/i,
    LONG_SECRET: /[A-Za-z0-9_\-]{32,}/
  });
  const DEFAULT_REDACTION = Object.freeze({ blockedKeys: ['authorization', 'cookie', 'setcookie', 'password', 'token', 'secret', 'body', 'notes', 'cpf', 'email', 'phone', 'name', 'url'], blockedKeyFragments: ['token', 'password', 'secret', 'cookie', 'authorization', 'note', 'body'],
    maskedKeys: ['customerid', 'userid', 'principalid'], idKeysExemptFromSecretDetector: ['requestid', 'correlationid', 'traceid', 'spanid', 'errorid', 'fingerprint', 'supportcode'], maxStringLength: 300, maxMessageLength: 200, maxObjectDepth: 4, maxArrayLength: 20, maxStackFrames: 8, valueDetectors: Object.keys(DETECTORS) });
  const redactionPolicy = (o = {}) => ({ ...DEFAULT_REDACTION, ...(policy().redaction || {}), ...o });
  const isBlockedKey = (k, p) => { const n = norm(k); return (p.blockedKeys || []).map(norm).includes(n) || (p.blockedKeyFragments || []).some(f => n.includes(norm(f))); };
  /** detectSensitive(text) → detector codes found */
  function detectSensitive(text, p = redactionPolicy(), exempt = false) {
    if (typeof text !== 'string' || !text) return [];
    return (p.valueDetectors || Object.keys(DETECTORS)).filter(c => DETECTORS[c] && !(exempt && c === 'LONG_SECRET') && DETECTORS[c].test(text));
  }
  /** scrubText(text) → text with every sensitive match replaced (keeps the rest of a human message) */
  function scrubText(text, p = redactionPolicy(), max = p.maxMessageLength) {
    if (text == null) return '';
    let s = String(text).replace(/\b(?:https?|wss?):\/\/[^\s'")<>]+/gi, u => sanitizeUrl(u)); // full URLs first: path only
    for (const c of p.valueDetectors || Object.keys(DETECTORS)) { const re = DETECTORS[c]; if (re) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), `[${c.toLowerCase()}]`); }
    return s.length > max ? s.slice(0, max) + '…' : s;
  }
  /** sanitizeUrl(url) → origin-less path without query/hash; share tokens become :token (RUM sends routeCode instead, §231) */
  function sanitizeUrl(url) {
    const s = String(url || ''); let pathname = s;
    const u = safe(() => new URL(s, 'http://x.invalid'));
    if (u) pathname = u.pathname;
    return pathname.split(/[?#]/)[0].replace(/\/s\/[^/]+/g, '/s/:token').replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/:id').slice(0, 120);
  }
  /** redact(value) → { value, report } — blocked keys removed, masked keys masked, PII-looking strings replaced, truncated by size and depth */
  function redact(value, o = {}) {
    const p = redactionPolicy(o.policy), report = { blocked: [], masked: [], detected: [], truncated: 0 };
    const exemptKeys = new Set((p.idKeysExemptFromSecretDetector || []).map(norm));
    const walk = (v, path, depth, key) => {
      if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const found = detectSensitive(v, p, exemptKeys.has(norm(key)));
        if (found.length) { report.detected.push(path + ':' + found.join('+')); return '[removido]'; }
        if (v.length > p.maxStringLength) { report.truncated++; return v.slice(0, p.maxStringLength) + '…'; }
        return v;
      }
      if (typeof v === 'function' || typeof v === 'symbol') return undefined;
      if (typeof v === 'bigint') return String(v);
      if (depth >= p.maxObjectDepth) { report.truncated++; return '[profundidade]'; }
      if (v instanceof Error || (v && typeof v.stack === 'string' && typeof v.message === 'string')) return { type: v.name || 'Error', code: v.code || null, message: scrubText(v.message, p) };
      if (Array.isArray(v)) { const a = v.slice(0, p.maxArrayLength).map((x, i) => walk(x, `${path}[${i}]`, depth + 1, key)); if (v.length > p.maxArrayLength) { report.truncated++; a.push(`[+${v.length - p.maxArrayLength}]`); } return a; }
      const out = {};
      for (const k of Object.keys(v)) {
        const sub = path ? `${path}.${k}` : k;
        if (isBlockedKey(k, p)) { report.blocked.push(sub); continue; }
        if ((p.maskedKeys || []).map(norm).includes(norm(k))) { report.masked.push(sub); out[k] = v[k] == null ? null : '[mascarado]'; continue; }
        const w = walk(v[k], sub, depth + 1, k); if (w !== undefined) out[k] = w;
      }
      return out;
    };
    return { value: walk(value, '', 0, ''), report };
  }
  /** sanitizeStack(stack) → top frames as "fn@file:line", without query strings, origins or tokens (local only, never shown to the user) */
  function sanitizeStack(stack, max = redactionPolicy().maxStackFrames) {
    if (typeof stack !== 'string') return [];
    return stack.split('\n').map(l => l.trim()).filter(l => /^at\s/.test(l) || /^[\w$.<>\/\[\]-]*@\S+:\d+(?::\d+)?$/.test(l)).slice(0, max).map(l => {
      const m = /^at (?:(.+?) \()?(.+?):(\d+)(?::\d+)?\)?$/.exec(l) || /^(.*?)@(.+?):(\d+)(?::\d+)?$/.exec(l);
      if (!m) return scrubText(l, redactionPolicy(), 120);
      const file = sanitizeUrl(m[2]).split('/').pop() || 'anon';
      return `${(m[1] || 'anon').replace(/[^\w$.<>]/g, '').slice(0, 60) || 'anon'}@${file}:${m[3]}`;
    });
  }

  // ---------------------------------------------------------------- ApplicationError taxonomy (§207–216)
  const errorDef = code => (registry().errors || {})[code] || null;
  /** appError(code, { cause, message, dependency, httpStatus, metadata }) → Error carrying the stable code (logic uses code, never text) */
  function appError(code, o = {}) {
    const def = errorDef(code) || errorDef('INTERNAL_UNEXPECTED') || { code: 'INTERNAL_UNEXPECTED', category: 'INTERNAL', retryable: false, userSafeMessageKey: 'errors.generic', severity: 'HIGH' };
    const e = new Error(o.message || def.code);
    e.name = 'ApplicationError'; e.code = errorDef(code) ? code : def.code; e.category = def.category; e.retryable = def.retryable; e.severity = def.severity;
    e.userSafeMessageKey = def.userSafeMessageKey; e.httpStatus = o.httpStatus || def.httpStatus || null;
    if (o.cause) e.cause = o.cause; if (o.dependency) e.dependency = String(o.dependency).replace(/[^a-z0-9_]/gi, '').slice(0, 30).toLowerCase();
    if (o.metadata) e.metadata = redact(o.metadata).value;
    return e;
  }
  /** classify(error) → stable code for errors that are not ApplicationErrors (browser, network, storage, HTTP status) */
  function classify(err) {
    if (!err || typeof err !== 'object') return 'FRONTEND_UNEXPECTED';
    if (err.code && errorDef(err.code)) return err.code;
    const name = String(err.name || ''), msg = String(err.message || ''), status = +err.status || +err.httpStatus || 0;
    if (name === 'AbortError') return 'REQUEST_ABORTED';
    if (name === 'TimeoutError' || /timeout|timed out/i.test(msg)) return 'REQUEST_TIMEOUT';
    if (name === 'QuotaExceededError') return 'STORAGE_QUOTA_EXCEEDED';
    if (name === 'SecurityError' || name === 'InvalidStateError' && /indexeddb|storage/i.test(msg)) return 'STORAGE_UNAVAILABLE';
    if (status === 401) return 'AUTHENTICATION_REQUIRED';
    if (status === 403) return 'AUTHORIZATION_DENIED';
    if (status === 404) return 'RESOURCE_NOT_FOUND';
    if (status === 409) return 'RESOURCE_VERSION_MISMATCH';
    if (status === 429) return 'RATE_LIMITED';
    if (status === 504) return 'DEPENDENCY_TIMEOUT';
    if (status >= 500) return 'API_SERVER_ERROR';
    if (status >= 400) return 'VALIDATION_FAILED';
    if (name === 'TypeError' && /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return 'NETWORK_UNAVAILABLE';
    if (name === 'SyntaxError' && /json/i.test(msg)) return 'DATA_PARSE_FAILED';
    if (/CHECKSUM_MISMATCH|corrupt/i.test(String(err.code || '') + msg)) return 'CACHE_CORRUPT_ENTRY';
    return 'FRONTEND_UNEXPECTED';
  }
  /** normalizeError(unknown) → { type, code, category, retryable, severity, message, stack[], causeChain[] } — sanitized */
  function normalizeError(err, o = {}) {
    const p = redactionPolicy(), maxDepth = (policy().errors || {}).maxCauseDepth || 5;
    const e = err instanceof Object ? err : { name: 'NonError', message: typeof err === 'string' ? err : String(err) };
    const code = classify(e), def = errorDef(code) || {};
    const chain = []; let c = e.cause, seen = new Set([e]);
    while (c && chain.length < maxDepth && !seen.has(c)) { seen.add(c); chain.push({ type: (c && c.name) || typeof c, code: c && typeof c === 'object' ? classify(c) : null, message: scrubText(c && c.message != null ? c.message : String(c), p) }); c = c && c.cause; }
    return { type: String(e.name || 'Error').slice(0, 40), code, category: def.category || 'INTERNAL', retryable: !!def.retryable, severity: e.severity || def.severity || 'MEDIUM',
      userSafeMessageKey: def.userSafeMessageKey || 'errors.generic', httpStatus: e.httpStatus || e.status || def.httpStatus || null, dependency: e.dependency || null,
      message: scrubText(e.message, p), stack: o.withStack === false ? [] : sanitizeStack(e.stack), causeChain: chain };
  }
  /** userMessage(codeOrKey) → pt-BR safe text (never the internal message) */
  function userMessage(codeOrKey) {
    const msgs = registry().userMessages || {}, def = errorDef(codeOrKey);
    return msgs[def ? def.userSafeMessageKey : codeOrKey] || msgs['errors.generic'] || 'Algo não funcionou nesta parte do painel.';
  }
  /** fingerprint(normalized, component) — type + code + stack location + component; never the dynamic message (§38–39) */
  const fingerprint = (n, component) => 'fp_' + fnv([n.type, n.code, (n.stack && n.stack[0]) || '-', component || 'Global'].join('|'));

  // ---------------------------------------------------------------- RingBuffer with drop priority (§283–285)
  /** createBuffer(max) — when full, drops the oldest item of the lowest priority first (DEBUG, then INFO…); ERROR/FATAL last */
  function createBuffer(max, prio = x => rank(x.level)) {
    const items = []; let dropped = 0;
    function push(x) {
      items.push(x);
      if (items.length > max) {
        let worst = 0; for (let i = 1; i < items.length; i++) if (prio(items[i]) < prio(items[worst])) worst = i;
        items.splice(worst, 1); dropped++;
      }
    }
    return { push, list: () => items.slice(), size: () => items.length, dropped: () => dropped, clear: () => { items.length = 0; } };
  }

  // ---------------------------------------------------------------- telemetry pipeline health (observability of observability, §278–279)
  const telemetry = { dropped: { LOG: 0, ERROR: 0, SPAN: 0, METRIC: 0 }, exportFailures: { LOCAL: 0, CONSOLE: 0, REMOTE: 0 }, recursiveDropped: 0, rateLimited: 0, unregisteredCodes: 0 };

  // ---------------------------------------------------------------- StructuredLogger (§21–27)
  /** createLogger({ service, component, contextProvider, sinks, now, environment, override }) */
  function createLogger(o = {}) {
    const pol = policy(), lv = pol.logLevels || {}, bufMax = (pol.buffers || {}).logs || 300;
    const env = () => environment(o);
    const buffer = createBuffer(bufMax);
    const ctxOf = () => safe(() => (o.contextProvider || defaultContext)(), {}) || {};
    const minLevel = () => { const ov = activeOverride(o); return ov && ov.extraLogLevel === 'DEBUG' ? 'DEBUG' : ((lv.minLevel || {})[env()] || 'INFO'); };
    const consoleOn = () => !!((lv.consoleOutput || {})[env()]) || !!App.debug;
    const sampleInfo = () => { const r = (lv.infoSampleRate || {})[env()]; return r == null ? 1 : r; };
    const rnd = o.random || Math.random;
    function log(level, eventCode, message, metadata, ctx) {
      try {
        if (!Level[level]) level = 'INFO';
        if (rank(level) < rank(minLevel())) return null;
        if (level === 'INFO' && sampleInfo() < 1 && rnd() >= sampleInfo()) { telemetry.dropped.LOG++; return null; } // ERROR/FATAL are never sampled
        const def = (registry().logEvents || {})[eventCode];
        if (!def) telemetry.unregisteredCodes++;
        const c = createContext(ctxOf(), ctx || {}), meta = metadata == null ? undefined : redact(metadata).value;
        const ev = Object.freeze({ timestamp: iso(nowMs(o)), level, eventCode: String(eventCode || 'UNSPECIFIED').slice(0, 64), registered: !!def, message: scrubText(message), service: o.service || pol.service || 'web-panel',
          component: (ctx && ctx.component) || o.component || (def && def.component) || undefined, environment: c.environment || env(), appVersion: c.appVersion, buildId: c.buildId,
          organizationId: c.organizationId, developmentId: c.developmentId, requestId: c.requestId, correlationId: c.correlationId, traceId: c.traceId, spanId: c.spanId, routeCode: c.routeCode,
          errorCode: metadata && metadata.errorCode ? String(metadata.errorCode).slice(0, 64) : undefined, metadata: meta });
        buffer.push(ev);
        for (const s of o.sinks || []) { try { s.write(ev); } catch (e) { telemetry.exportFailures[s.kind || 'REMOTE'] = (telemetry.exportFailures[s.kind || 'REMOTE'] || 0) + 1; } }
        if (consoleOn()) safe(() => { const f = console[level === 'FATAL' || level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : level === 'DEBUG' ? 'debug' : 'info']; f && f.call(console, `[${ev.eventCode}]`, ev.message, ev.metadata || ''); });
        return ev;
      } catch (e) { telemetry.exportFailures.LOCAL++; return null; } // §280: telemetry never breaks the caller
    }
    const at = l => (code, msg, meta, ctx) => log(l, code, msg, meta, ctx);
    return { log, debug: at('DEBUG'), info: at('INFO'), warn: at('WARN'), error: at('ERROR'), fatal: at('FATAL'), entries: () => buffer.list(), dropped: () => buffer.dropped(), size: () => buffer.size(), clear: () => buffer.clear(), minLevel };
  }

  // ---------------------------------------------------------------- TenantDiagnosticOverride (§154–157): temporary, reasoned, approved, bounded
  let override = null;
  function setDiagnosticOverride(ov, o = {}) {
    const p = policy().diagnosticOverride || { maxDurationMs: 3600000 }, t = nowMs(o);
    if (!ov) { override = null; return { ok: true, override: null }; }
    if (p.requireReason !== false && !String(ov.reason || '').trim()) return { ok: false, code: 'REASON_REQUIRED' };
    if (p.requireApprovedBy !== false && !String(ov.approvedBy || '').trim()) return { ok: false, code: 'APPROVER_REQUIRED' };
    const until = Date.parse(ov.enabledUntil);
    if (!Number.isFinite(until) || until <= t) return { ok: false, code: 'INVALID_EXPIRY' };
    if (until - t > p.maxDurationMs) return { ok: false, code: 'TOO_LONG', maxDurationMs: p.maxDurationMs };
    override = Object.freeze({ organizationId: ov.organizationId || null, enabledUntil: iso(until), traceSamplingRate: ov.traceSamplingRate != null ? Math.min(1, Math.max(0, +ov.traceSamplingRate)) : null,
      extraLogLevel: ov.extraLogLevel === 'DEBUG' ? 'DEBUG' : null, reason: scrubText(ov.reason, redactionPolicy(), 120), approvedBy: '[mascarado]' });
    return { ok: true, override };
  }
  function activeOverride(o = {}) { if (!override) return null; if (Date.parse(override.enabledUntil) <= nowMs(o)) { override = null; return null; } return override; }

  // ---------------------------------------------------------------- ErrorReporter (§37–42): fingerprint, dedupe window, rate limit, no recursion
  /** createErrorReporter({ logger, metrics, contextProvider, now }) → { capture, captureMessage, groups, recent, clear }
      Groups keep type, code, category, component, top frame, release and counts — never the free-text message (a name in a
      message cannot be detected reliably, so it is not stored; use a stable code instead). */
  function createErrorReporter(o = {}) {
    const pe = policy().errors || {}, maxGroups = (policy().buffers || {}).errorGroups || 100, windowMs = pe.dedupeWindowMs || 60000, perMin = pe.maxCapturesPerMinute || 60;
    const ignored = (pe.ignoredMessagePatterns || []).map(s => new RegExp(s, 'i'));
    const groups = new Map(), recent = createBuffer(50, () => 0); let busy = false, minuteStart = 0, minuteCount = 0, ignoredCount = 0;
    const ctxOf = () => safe(() => (o.contextProvider || defaultContext)(), {}) || {};
    function capture(error, ctx = {}) {
      if (busy) { telemetry.recursiveDropped++; return null; } // §282: never recursive
      busy = true;
      try {
        const t = nowMs(o);
        if (t - minuteStart > 60000) { minuteStart = t; minuteCount = 0; }
        const n = normalizeError(error), component = ctx.component || 'Global';
        if (ignored.some(re => re.test(n.message))) { ignoredCount++; return null; }
        const c = createContext(ctxOf(), ctx), fp = fingerprint(n, component), errorId = newErrorId();
        let g = groups.get(fp), duplicate = false;
        if (g) { duplicate = t - g.lastSeenMs < windowMs; g.count++; g.lastSeenMs = t; g.lastSeen = iso(t); g.lastErrorId = errorId; if (c.routeCode && g.routeCodes.length < 5 && !g.routeCodes.includes(c.routeCode)) g.routeCodes.push(c.routeCode); }
        else {
          if (groups.size >= maxGroups) { let old = null; for (const [k, v] of groups) if (!old || v.lastSeenMs < groups.get(old).lastSeenMs) old = k; groups.delete(old); }
          g = { fingerprint: fp, code: n.code, type: n.type, category: n.category, severity: n.severity, component, firstSeen: iso(t), lastSeen: iso(t), lastSeenMs: t, count: 1, release: c.appVersion || null, buildId: c.buildId || null,
            topFrame: n.stack[0] || null, routeCodes: c.routeCode ? [c.routeCode] : [], lastErrorId: errorId };
          groups.set(fp, g);
        }
        const out = Object.freeze({ errorId, supportCode: supportCode(errorId), fingerprint: fp, code: n.code, category: n.category, retryable: n.retryable, duplicate, userMessage: userMessage(n.code), requestId: c.requestId || null });
        recent.push({ errorId, fingerprint: fp, code: n.code, at: iso(t), requestId: c.requestId || null });
        safe(() => o.metrics && o.metrics.counter('frontend_errors_total', { error_category: n.category, component, route_code: c.routeCode || 'OTHER' }));
        if (++minuteCount > perMin) { telemetry.rateLimited++; return out; }
        if (!duplicate && o.logger) o.logger.log(ctx.level || (n.severity === 'CRITICAL' ? 'FATAL' : 'ERROR'), ctx.eventCode || 'FRONTEND_ERROR_CAPTURED', `${n.type} ${n.code} em ${component}`,
          { errorCode: n.code, category: n.category, fingerprint: fp, errorId, retryable: n.retryable, topFrame: n.stack[0] || null, causeChain: n.causeChain.map(x => x.code || x.type), dependency: n.dependency }, { ...ctx, component });
        return out;
      } catch (e) { telemetry.exportFailures.LOCAL++; return null; } finally { busy = false; }
    }
    function captureMessage(message, severity = 'MEDIUM', ctx = {}) {
      const e = new Error(scrubText(message)); e.name = 'Message'; e.severity = Severity[severity] || 'MEDIUM'; e.code = ctx.code && errorDef(ctx.code) ? ctx.code : undefined;
      return capture(e, { ...ctx, level: severity === 'LOW' ? 'WARN' : severity === 'CRITICAL' ? 'FATAL' : 'ERROR' });
    }
    const list = () => [...groups.values()].map(g => { const { lastSeenMs, ...rest } = g; return { ...rest, routeCodes: g.routeCodes.slice() }; }).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    return { capture, captureMessage, groups: list, recent: () => recent.list(), ignored: () => ignoredCount, clear: () => { groups.clear(); recent.clear(); } };
  }

  // ---------------------------------------------------------------- Error Boundaries (§40–42): fallback local + report + support code + safe message
  const boundaryAreas = () => registry().errorBoundaries || ['MapRenderer', 'QuickView', 'Comparison', 'CustomerWorkspace', 'PresentationRuntime', 'SharedRuntime', 'AnalyticsDashboard', 'DocumentViewer'];
  /** boundary(area, fn, { reporter, fallback, metrics }) → fn() or fallback(info); the error is reported, never swallowed silently */
  function boundary(area, fn, o = {}) {
    const component = boundaryAreas().includes(area) ? area : 'Global';
    try { return fn(); }
    catch (err) {
      const r = (o.reporter && o.reporter.capture(err, { component, eventCode: 'FRONTEND_ERROR_CAPTURED' })) || { supportCode: null, userMessage: userMessage(classify(err)), code: classify(err) };
      safe(() => o.metrics && o.metrics.counter('frontend_error_boundary_fallback_total', { component }));
      safe(() => o.logger && o.logger.warn('ERROR_BOUNDARY_FALLBACK', `fallback local em ${component}`, { errorCode: r.code, supportCode: r.supportCode }, { component }));
      const info = Object.freeze({ area: component, supportCode: r.supportCode, userMessage: r.userMessage, code: r.code, degraded: true });
      return typeof o.fallback === 'function' ? o.fallback(info) : o.fallback !== undefined ? o.fallback : info;
    }
  }
  async function boundaryAsync(area, fn, o = {}) { try { return await fn(); } catch (err) { return boundary(area, () => { throw err; }, o); } }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** fallbackHtml(info) → user-safe markup with the support code (no stack, no internal message) */
  const fallbackHtml = info => `<div class="obs-fallback" role="status"><p>${esc(info && info.userMessage || userMessage('errors.generic'))}</p>${info && info.supportCode ? `<p class="small">Código do erro: <b>${esc(info.supportCode)}</b></p>` : ''}</div>`;

  // ---------------------------------------------------------------- global handlers (window 'error' + 'unhandledrejection')
  /** installGlobalHandlers(win, reporter) → uninstall(); listeners only (never overwrites window.onerror) */
  function installGlobalHandlers(win, reporter) {
    if (!win || typeof win.addEventListener !== 'function' || !reporter) return () => {};
    const onError = ev => safe(() => { if (!ev || (!ev.error && !ev.message)) return; reporter.capture(ev.error || Object.assign(new Error(String(ev.message || 'erro')), { name: 'ScriptError' }), { component: 'Global', eventCode: 'FRONTEND_ERROR_CAPTURED' }); });
    const onRejection = ev => safe(() => { const r = ev && ev.reason; reporter.capture(r instanceof Object ? r : Object.assign(new Error(String(r)), { name: 'UnhandledRejection' }), { component: 'Global', eventCode: 'UNHANDLED_REJECTION' }); });
    win.addEventListener('error', onError); win.addEventListener('unhandledrejection', onRejection);
    return () => { safe(() => win.removeEventListener('error', onError)); safe(() => win.removeEventListener('unhandledrejection', onRejection)); };
  }

  return Object.freeze({ LEVELS, Level, Category, Severity, randomHex, newRequestId, newCorrelationId, newTraceId, newSpanId, newErrorId, supportCode, hash: fnv,
    traceparent, parseTraceparent, shouldPropagate, headersFor, environment, setRelease, release: () => ({ ...release }), routeCodeOf, defaultContext, setContextSources, createContext, requestContext, CONTEXT_KEYS,
    DETECTORS, redactionPolicy, isBlockedKey, detectSensitive, scrubText, sanitizeUrl, redact, sanitizeStack, errorDef, appError, classify, normalizeError, userMessage, fingerprint,
    createBuffer, telemetry, createLogger, setDiagnosticOverride, activeOverride, createErrorReporter, boundary, boundaryAsync, boundaryAreas, fallbackHtml, installGlobalHandlers, policy, registry, esc });
})();
