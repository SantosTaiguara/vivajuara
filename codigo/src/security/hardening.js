/* security/hardening.js — App.securityHardening (topic 50: platform security, browser + shared pure side).
   Pure functions and registries; no DOM, no network, no storage writes. Usable in the browser, in the Node test
   harness and (being a plain script) by the backend's shared-domain loader.

   What lives here (each piece is the client/shared half; the server is ALWAYS the authority):
   - output encoding (escapeHtml / safeUrl / isMarkupFree) — one canonical helper for every view;
   - scrubRestoredState(): defence in depth for state restored from localStorage (values must have the
     type the UI expects: numbers stay numbers, tokens carry no markup) — localStorage is never trusted;
   - auditStorage(): what is allowed in localStorage/sessionStorage (no tokens, no secrets, no PII patterns);
   - redactText / redactRecord: logging & SecurityEvent redaction (Authorization, cookies, ShareToken, signed URL
     query, CPF, e-mail, phone, notes/bodies);
   - csvCell(): spreadsheet formula-injection escaping for exports;
   - buildCsp / securityHeaders / evaluateCsp: the browser policy (config/security/browserPolicy.json);
   - checkOutboundUrl(): SSRF guard for any server-side fetch of a user URL (pure; DNS re-check stays server-side);
   - sniffMime / checkUpload / checkArchive: upload & KMZ/ZIP limits (zip slip, bomb, double extension, SVG);
   - createRateLimiter(): RateLimitPolicy evaluator (pure, injected clock) + the policy catalog;
   - evaluateHighRisk(): HighRiskActionPolicy (permission → step-up → reason → revision → audit);
   - idempotency(): key scoped by tenant/user/endpoint; same key + different payload → REJECT;
   - checkWebhook(): timestamp window + replay (signature itself is verified server-side with the secret);
   - securityEvent(): SecurityEvent (separate from product analytics; redacted; never raw tokens);
   - validateSecurityConfig(): SecurityConfigValidator (fail closed in production);
   - threat model, data classification, token types, legacy inventory: config/security/*.json, validated here.
   Nothing here grants access. Deny by default: unknown action/permission/policy → DENY. */
App.securityHardening = (() => {
  const freeze = Object.freeze;
  const CLASSIFICATION = freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'SECRET']);
  const CLASS_ORDER = freeze({ PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3, SECRET: 4 });
  const DECISION = freeze({ ALLOW: 'ALLOW', DENY: 'DENY', REQUIRES_STEP_UP: 'REQUIRES_STEP_UP', REQUIRES_APPROVAL: 'REQUIRES_APPROVAL' });
  const AUTH_STRENGTH = freeze({ PASSWORD_ONLY: 1, MFA_VERIFIED: 2, RECENT_REAUTH: 3, FEDERATED_HIGH_ASSURANCE: 3 });
  const SEVERITY = freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  const cfg = () => (App.configs && App.configs.security) || {};
  const pol = name => cfg()[name] || {};

  // ------------------------------------------------------------------ output encoding
  const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** escapeHtml(v) — text AND quoted-attribute context (null/undefined → ''). The canonical esc() of every view. */
  const escapeHtml = v => String(v == null ? '' : v).replace(/[&<>"'`]/g, c => HTML_ESC[c]);
  const MARKUP_RE = /[<>"'`]|&#?\w+;|javascript:|data:text|on\w+\s*=/i;
  /** isMarkupFree(s) — a value that may be interpolated without changing the HTML structure even if a view forgets esc() */
  const isMarkupFree = s => typeof s === 'string' && !MARKUP_RE.test(s) && !/[\u0000-\u001f\u007f]/.test(s);
  const TOKEN_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.,:+\/-]{0,79}$/u;
  /** safeToken(s) — short identifier / enum / code (lot id, block, filter option). */
  const safeToken = s => typeof s === 'string' && TOKEN_RE.test(s) && isMarkupFree(s);
  /** safeUrl(u, opts) → normalized URL string or null. Only https (and mailto/tel when allowed) or same-document relative paths. */
  function safeUrl(u, { protocols = ['https:'], allowRelative = true, allowHosts = null } = {}) {
    if (typeof u !== 'string' || !u.trim() || /[\u0000-\u001f\u007f\s]/.test(u.trim())) return null;
    const s = u.trim();
    if (allowRelative && !/^\/\//.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[A-Za-z0-9_.\/~%-]+([?#][^\s<>"'`]*)?$/.test(s)) return s;
    let url; try { url = new URL(s); } catch (e) { return null; }
    if (!protocols.includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (allowHosts && (url.protocol === 'https:' || url.protocol === 'http:') && !allowHosts.includes(url.hostname)) return null;
    return url.href;
  }

  // ------------------------------------------------------------------ persisted-state scrub (defence in depth)
  const NUM_FILTER = /^(priceMin|priceMax|areaMin|areaMax|pricePerM2Min|pricePerM2Max|frontMin|frontMax|depthMin|depthMax|noiseMax|privacyMin|trafficMax|gateMaxM|clubMaxM|scoreMin|fitMin|fitCoverageMin|fitConfidenceMin)$/;
  const BOOL_FILTER = /^(onlyOfferable|noCorner|greenBehind|noNoiseAlert|favoritesOnly|includeUnknown)$/;
  const LIST_FILTER = /^(statuses|shapes|rearOrientation|alertsExclude|dataStatus|freshness)$/;
  const toNum = v => typeof v === 'number' ? (Number.isFinite(v) ? v : null) : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
  /** scalar(v) → cleaned value | undefined (drop) */
  function scalar(v, kind) {
    if (kind === 'num') return toNum(v) == null ? undefined : toNum(v);
    if (kind === 'bool') return typeof v === 'boolean' ? v : undefined;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'boolean') return v;
    if (kind === 'text') return typeof v === 'string' && v.length <= 80 && isMarkupFree(v) ? v : undefined;
    return safeToken(v) ? v : undefined;
  }
  function cleanMap(obj, kindOf, path, dropped) {
    if (obj == null) return obj;
    if (typeof obj !== 'object' || Array.isArray(obj)) { dropped.push(path); return {}; }
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!safeToken(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') { dropped.push(path + '.?'); continue; }
      const kind = kindOf(k);
      if (Array.isArray(v)) { const ok = v.map(x => scalar(x, kind === 'list' ? 'token' : kind)).filter(x => x !== undefined); if (ok.length !== v.length) dropped.push(`${path}.${k}`); if (ok.length) out[k] = ok; continue; }
      if (v === null) { out[k] = null; continue; }
      const c = scalar(v, kind); if (c === undefined) dropped.push(`${path}.${k}`); else out[k] = c;
    }
    return out;
  }
  const filterKind = k => NUM_FILTER.test(k) ? 'num' : BOOL_FILTER.test(k) ? 'bool' : LIST_FILTER.test(k) ? 'list' : k === 'q' ? 'text' : 'token';
  const constraintKind = k => /(Min|Max|M)$|^(budget|max|min)/.test(k) ? 'num' : /^(no|green|require|only)/.test(k) ? 'bool' : 'token';
  /** scrubRestoredState(state, initial?) — mutates `state` (the store's freshly restored object) and returns { dropped[], piiFields[] }.
      Never invents a value: a field that fails its type goes back to the initial value (or is removed). */
  function scrubRestoredState(state, initial) {
    const dropped = [], piiFields = [];
    if (!state || typeof state !== 'object') return { dropped, piiFields };
    const I = initial || (App.store && App.store.INITIAL) || {};
    const reset = k => { dropped.push(k); if (k in I) state[k] = I[k] && typeof I[k] === 'object' ? JSON.parse(JSON.stringify(I[k])) : I[k]; else delete state[k]; };
    if ('activeFilters' in state) state.activeFilters = cleanMap(state.activeFilters, filterKind, 'activeFilters', dropped) || {};
    if ('constraints' in state) state.constraints = cleanMap(state.constraints, constraintKind, 'constraints', dropped) || {};
    if (state.preferences && typeof state.preferences === 'object') {
      const p = {}; for (const [k, v] of Object.entries(state.preferences)) { if (safeToken(k) && Number.isInteger(v) && v >= 0 && v <= 3) p[k] = v; else dropped.push('preferences.' + k); }
      state.preferences = p;
    } else if ('preferences' in state && state.preferences != null) reset('preferences');
    if (state.solar && typeof state.solar === 'object') {
      const s = { ...state.solar }, d = I.solar || {};
      if (!(typeof s.hour === 'number' && s.hour >= 0 && s.hour <= 24)) { dropped.push('solar.hour'); s.hour = d.hour; }
      if (!safeToken(s.season)) { dropped.push('solar.season'); s.season = d.season; }
      if (typeof s.onMap !== 'boolean') s.onMap = d.onMap;
      state.solar = s;
    }
    if (state.simulation && typeof state.simulation === 'object') {
      const s = { ...state.simulation }, d = I.simulation || {};
      if (!(typeof s.downPaymentPct === 'number' && s.downPaymentPct >= 0 && s.downPaymentPct <= 100)) { dropped.push('simulation.downPaymentPct'); s.downPaymentPct = d.downPaymentPct; }
      if (!safeToken(s.planId)) { dropped.push('simulation.planId'); s.planId = d.planId; }
      if (typeof s.expanded !== 'boolean') s.expanded = !!d.expanded;
      state.simulation = s;
    }
    if ('baseMapBlend' in state && !(typeof state.baseMapBlend === 'number' && state.baseMapBlend >= 0 && state.baseMapBlend <= 1)) reset('baseMapBlend');
    if (state.layerOpacities && typeof state.layerOpacities === 'object') {
      const o = {}; for (const [k, v] of Object.entries(state.layerOpacities)) if (safeToken(k) && typeof v === 'number' && v >= 0 && v <= 1) o[k] = v; else dropped.push('layerOpacities.' + k);
      state.layerOpacities = o;
    }
    for (const k of ['currentLotId', 'currentCustomerId', 'activeMapLayer', 'previousMapLayer', 'backgroundLayer', 'scoreKey', 'activePreset', 'objective', 'legendFocus', 'presentationMode', 'view', 'panel', 'detailSection', 'sheet']) {
      if (k in state && state[k] != null && !(safeToken(state[k]) || (typeof state[k] === 'object' && k === 'objective' && isPlainSafe(state[k])))) reset(k);
    }
    for (const k of ['comparisonLotIds', 'favorites', 'mapOverlays']) if (k in state) {
      const a = Array.isArray(state[k]) ? state[k] : [], ok = a.filter(safeToken);
      if (ok.length !== a.length || !Array.isArray(state[k])) { dropped.push(k); state[k] = ok; }
    }
    if ('customers' in state) {
      const a = Array.isArray(state.customers) ? state.customers : [], ok = [];
      for (const c of a) {
        if (!c || typeof c !== 'object' || !safeToken(c.id)) { dropped.push('customers[]'); continue; }
        const lots = Array.isArray(c.lots) ? c.lots.filter(safeToken) : [];
        if (typeof c.name === 'string' && c.name) piiFields.push('customers[].name');
        // the saved profile is re-applied to preferences/constraints when the customer is picked: same typing rules
        const pr = c.profile && typeof c.profile === 'object' ? c.profile : {}, sub = { preferences: pr.preferences, constraints: pr.constraints, activePreset: pr.activePreset, objective: pr.objective };
        const r = scrubRestoredState(sub, { preferences: {}, constraints: {}, activePreset: null, objective: null });
        for (const d of r.dropped) dropped.push('customers[].profile.' + d);
        ok.push({ ...c, name: typeof c.name === 'string' ? c.name.slice(0, 60) : '', lots, profile: { ...pr, preferences: sub.preferences || {}, constraints: sub.constraints || {}, activePreset: sub.activePreset == null ? null : sub.activePreset, objective: sub.objective == null ? null : sub.objective } });
      }
      state.customers = ok;
    }
    return { dropped, piiFields: [...new Set(piiFields)] };
  }
  function isPlainSafe(o, depth = 0) {
    if (depth > 4) return false;
    if (o == null || typeof o === 'number' || typeof o === 'boolean') return true;
    if (typeof o === 'string') return o.length <= 200 && isMarkupFree(o);
    if (Array.isArray(o)) return o.length <= 100 && o.every(x => isPlainSafe(x, depth + 1));
    if (typeof o === 'object') return Object.entries(o).every(([k, v]) => safeToken(k) && isPlainSafe(v, depth + 1));
    return false;
  }

  // ------------------------------------------------------------------ redaction (logs, SecurityEvents, diagnostics)
  const SECRET_KEY_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|passcode|senha|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|share[_-]?token|csrf[_-]?token|session[_-]?id|private[_-]?key|signature|sig|pepper|database[_-]?url|connection[_-]?string)$/i;
  const PII_KEY_RE = /^(cpf|cnpj|rg|email|e-mail|phone|telefone|whatsapp|address|endereco|note|notes|nota|observacao|body|content|document[_-]?content|fullname|name|nome|birth|nascimento)$/i;
  const TEXT_RULES = freeze([
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, '$1 [redacted]'],
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[jwt]'],
    [/\/s\/[A-Za-z0-9_-]{16,}/g, '/s/[token]'],
    [/([?&](?:token|access_token|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature|se|sp|sv|key|code|state|passcode)=)[^&#\s]+/gi, '$1[redacted]'],
    [/\bplat_dev_[A-Za-z0-9_-]{20,}/g, '[token]'],
    [/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgres://[redacted]@'],
    [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[phone]']
  ]);
  /** redactText(s) — value-based redaction for free text bound for logs/events/diagnostics */
  const redactText = s => TEXT_RULES.reduce((t, [re, rep]) => t.replace(re, rep), String(s == null ? '' : s));
  /** redactRecord(obj) → { value, redacted[] } key-based (secrets, PII, bodies) + value-based (redactText) */
  function redactRecord(obj, path = '', out = [], depth = 0) {
    if (depth > 8) return { value: '[depth]', redacted: out };
    if (Array.isArray(obj)) return { value: obj.slice(0, 200).map((v, i) => redactRecord(v, `${path}[${i}]`, out, depth + 1).value), redacted: out };
    if (typeof obj === 'string') { const r = redactText(obj); if (r !== obj) out.push(path || '(text)'); return { value: r, redacted: out }; }
    if (!obj || typeof obj !== 'object') return { value: obj, redacted: out };
    const v = {};
    for (const [k, x] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (SECRET_KEY_RE.test(k)) { out.push(p); v[k] = '[redacted]'; continue; }
      if (PII_KEY_RE.test(k)) { out.push(p); continue; }
      v[k] = redactRecord(x, p, out, depth + 1).value;
    }
    return { value: v, redacted: out };
  }

  // ------------------------------------------------------------------ storage policy
  const STORAGE_VALUE_RULES = freeze([
    ['BEARER_OR_JWT', /\b(Bearer\s+[A-Za-z0-9._~+\/=-]{10,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})/, 'CRITICAL'],
    ['TOKEN_FIELD', /"(access_?token|refresh_?token|id_?token|share_?token|session_?id|token|password|secret|api_?key)"\s*:\s*"[^"]{6,}"/i, 'HIGH'],
    ['SHARE_URL_TOKEN', /\/s\/[A-Za-z0-9_-]{16,}/, 'HIGH'],
    ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, 'HIGH'],
    ['EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'MEDIUM'],
    ['PHONE', /\(?\b\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/, 'MEDIUM'],
    ['CUSTOMER_NAME', /"customers"\s*:\s*\[\s*\{[^\]]*"name"\s*:\s*"[^"]+"/, 'MEDIUM']
  ]);
  /** auditStorage(storageOrObject) → findings [{ key, code, severity, allowed }] — key allow-list + forbidden value patterns */
  function auditStorage(s) {
    const entries = [];
    if (s && typeof s.length === 'number' && typeof s.key === 'function') { for (let i = 0; i < s.length; i++) { const k = s.key(i); entries.push([k, s.getItem(k)]); } }
    else if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) entries.push([k, typeof v === 'string' ? v : JSON.stringify(v)]);
    const allow = (pol('browserPolicy').storage || {}).allowedKeyPatterns || [];
    const findings = [];
    for (const [k, v] of entries) {
      const allowed = allow.some(p => new RegExp(p).test(k));
      if (!allowed) findings.push({ key: k, code: 'KEY_NOT_IN_POLICY', severity: 'LOW', allowed });
      for (const [code, re, severity] of STORAGE_VALUE_RULES) if (re.test(String(v || ''))) findings.push({ key: k, code, severity, allowed });
    }
    return findings;
  }

  // ------------------------------------------------------------------ CSV export
  /** csvCell(v) — RFC 4180 quoting + formula-injection neutralization (=, +, -, @, tab, CR at start → leading apostrophe) */
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ------------------------------------------------------------------ CSP / security headers
  const META_IGNORED = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'];
  /** buildCsp({ scriptHashes, styleHashes, connect, mode }) → policy string (directives from browserPolicy.csp) */
  function buildCsp({ scriptHashes = [], styleHashes = [], connect = [], mode = 'header', reportUri = null } = {}) {
    const base = (pol('browserPolicy').csp || {}).directives || {};
    const d = {};
    for (const [k, v] of Object.entries(base)) d[k] = [...v];
    const q = h => (/^'sha(256|384|512)-/.test(h) ? h : `'sha256-${h}'`);
    if (scriptHashes.length) d['script-src'] = [...(d['script-src'] || ["'self'"]), ...scriptHashes.map(q)];
    if (styleHashes.length) d['style-src-elem'] = [...(d['style-src-elem'] || ["'self'"]), ...styleHashes.map(q)];
    for (const c of connect) { const u = safeUrl(c, { allowRelative: false }); if (u) (d['connect-src'] = d['connect-src'] || ["'self'"]).push(new URL(u).origin); }
    if (reportUri && mode === 'header') d['report-uri'] = [reportUri];
    return Object.entries(d).filter(([k]) => mode !== 'meta' || !META_IGNORED.includes(k)).map(([k, v]) => v.length ? `${k} ${[...new Set(v)].join(' ')}` : k).join('; ');
  }
  /** evaluateCsp(policy) → findings[] (unsafe-eval, unsafe-inline scripts, wildcards, missing object-src/base-uri/frame-ancestors) */
  function evaluateCsp(p) {
    const f = [], dirs = {};
    for (const part of String(p || '').split(';')) { const [k, ...v] = part.trim().split(/\s+/); if (k) dirs[k.toLowerCase()] = v; }
    const script = dirs['script-src'] || dirs['default-src'] || [];
    if (!Object.keys(dirs).length) f.push({ code: 'CSP_MISSING', severity: 'HIGH' });
    if (script.includes("'unsafe-eval'")) f.push({ code: 'UNSAFE_EVAL', severity: 'HIGH' });
    if (script.includes("'unsafe-inline'") && !script.some(s => /^'(nonce|sha\d+)-/.test(s))) f.push({ code: 'UNSAFE_INLINE_SCRIPT', severity: 'HIGH' });
    if (script.some(s => s === '*' || s === 'https:' || s === 'http:' || s === 'data:')) f.push({ code: 'WILDCARD_SCRIPT', severity: 'HIGH' });
    // round 7: the Entorno base map adds exactly one image host (https://tile.openstreetmap.org); a wildcard image source is refused
    if ((dirs['img-src'] || []).some(s => s === '*' || s === 'https:' || s === 'http:' || /\*/.test(s))) f.push({ code: 'WILDCARD_IMG', severity: 'HIGH' });
    if (!dirs['object-src'] && !(dirs['default-src'] || []).includes("'none'")) f.push({ code: 'OBJECT_SRC_MISSING', severity: 'MEDIUM' });
    if (!dirs['base-uri']) f.push({ code: 'BASE_URI_MISSING', severity: 'MEDIUM' });
    if (!dirs['frame-ancestors']) f.push({ code: 'FRAME_ANCESTORS_MISSING', severity: 'LOW' });
    return f;
  }
  /** securityHeaders({ csp, hsts, route }) → header map for the static host / API (browserPolicy.headers) */
  function securityHeaders({ csp = null, hsts = true, route = 'app' } = {}) {
    const h = { ...((pol('browserPolicy').headers || {})[route] || (pol('browserPolicy').headers || {}).app || {}) };
    if (csp) h['Content-Security-Policy'] = csp;
    if (!hsts) delete h['Strict-Transport-Security'];
    return h;
  }

  // ------------------------------------------------------------------ SSRF guard (outbound URL policy)
  const v4 = h => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); return m && m.slice(1).every(x => +x <= 255) ? m.slice(1).map(Number) : null; };
  function privateV4([a, b]) {
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  /** checkOutboundUrl(url, { allowHosts, allowHttp, ports }) → { ok, reason, url } — protocol allow-list, no credentials, no
      private/loopback/link-local/metadata addresses, allowed ports. The server must re-check the RESOLVED IP (DNS rebinding),
      limit redirects (re-run this check per hop), set a timeout and a max response size. */
  function checkOutboundUrl(raw, { allowHosts = null, allowHttp = false, ports = [443] } = {}) {
    const no = reason => ({ ok: false, reason, url: null });
    let u; try { u = new URL(String(raw)); } catch (e) { return no('URL_INVALID'); }
    if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) return no('PROTOCOL_NOT_ALLOWED');
    if (u.username || u.password) return no('CREDENTIALS_IN_URL');
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const port = u.port ? +u.port : (u.protocol === 'https:' ? 443 : 80);
    if (!ports.includes(port) && !(allowHttp && port === 80)) return no('PORT_NOT_ALLOWED');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || host === 'metadata.google.internal' || host === 'metadata') return no('HOST_INTERNAL');
    if (host.startsWith('[')) {
      const h6 = host.slice(1, -1);
      const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h6);
      if (mapped) { const n = (parseInt(mapped[1], 16) << 16 >>> 0) + parseInt(mapped[2], 16); if (privateV4([n >>> 24, (n >>> 16) & 255])) return no('IP_PRIVATE'); }
      else if (h6 === '::' || h6 === '::1' || /^f[cd]/.test(h6) || /^fe[89ab]/.test(h6) || /^::ffff:/.test(h6)) return no('IP_PRIVATE');
    }
    const ip = v4(host); if (ip && privateV4(ip)) return no('IP_PRIVATE');
    if (allowHosts && !allowHosts.includes(host)) return no('HOST_NOT_ALLOWED');
    return { ok: true, reason: null, url: u.href };
  }

  // ------------------------------------------------------------------ uploads & archives
  const MAGIC = freeze([
    ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['application/zip', [0x50, 0x4b, 0x03, 0x04]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38]],
    ['application/x-msdownload', [0x4d, 0x5a]],
    ['application/x-elf', [0x7f, 0x45, 0x4c, 0x46]]
  ]);
  /** sniffMime(bytes) → detected type from magic bytes ('image/svg+xml' / 'text/html' by text sniff) | null */
  function sniffMime(bytes) {
    const b = bytes ? Array.from(bytes.slice ? bytes.slice(0, 512) : bytes) : [];
    for (const [type, sig] of MAGIC) if (sig.every((x, i) => b[i] === x)) return type;
    if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
    const head = String.fromCharCode(...b.filter(x => x < 128)).replace(/^﻿/, '').trim().toLowerCase();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(head) || /<svg[\s>]/.test(head.slice(0, 300))) return 'image/svg+xml';
    if (/^<(!doctype html|html|script|head|body)/.test(head)) return 'text/html';
    return null;
  }
  const DANGEROUS_EXT = /\.(exe|dll|bat|cmd|com|scr|msi|ps1|vbs|js|mjs|jar|sh|bash|php|py|rb|pl|html?|xhtml|svgz?|hta|lnk|app|dmg|iso|apk|wasm)$/i;
  /** normalizeFilename(name) → metadata-only display name (never a storage path) */
  const normalizeFilename = n => String(n == null ? '' : n).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().replace(/^\.+/, '').replace(/[<>:"|?*]/g, '_').slice(0, 120) || 'arquivo';
  /** checkUpload({ filename, size, declaredMime, bytes }, policyId) → { ok, errors[], detectedMime, displayName } */
  function checkUpload(f = {}, policyId = 'document') {
    const p = (pol('uploadPolicy').policies || {})[policyId];
    const errors = [], E = c => errors.push(c);
    if (!p) return { ok: false, errors: ['UPLOAD_POLICY_UNKNOWN'], detectedMime: null, displayName: null };
    const name = normalizeFilename(f.filename), lower = name.toLowerCase();
    const ext = (/\.([a-z0-9]{1,8})$/.exec(lower) || [])[1] || '';
    const detected = sniffMime(f.bytes);
    if (!(f.size > 0)) E('EMPTY_FILE');
    if (f.size > p.maxBytes) E('FILE_TOO_LARGE');
    if (/\.[a-z0-9]{1,5}\.[a-z0-9]{1,5}$/i.test(lower) && DANGEROUS_EXT.test(lower)) E('DOUBLE_EXTENSION');
    if (DANGEROUS_EXT.test(lower) && !(p.allow || []).some(a => a.ext.includes(ext))) E('DANGEROUS_EXTENSION');
    const rule = (p.allow || []).find(a => a.ext.includes(ext));
    if (!rule) E('EXTENSION_NOT_ALLOWED');
    else {
      if (f.declaredMime && !rule.mime.includes(String(f.declaredMime).toLowerCase())) E('DECLARED_MIME_MISMATCH');
      if (!detected || !rule.mime.includes(detected)) E('MAGIC_BYTES_MISMATCH');
    }
    if (detected === 'image/svg+xml' && !p.allowSvg) E('SVG_NOT_ALLOWED');
    if (detected === 'text/html' || detected === 'application/x-msdownload' || detected === 'application/x-elf') E('EXECUTABLE_CONTENT');
    return { ok: !errors.length, errors: [...new Set(errors)], detectedMime: detected, displayName: name, scanRequired: !!p.malwareScan };
  }
  /** checkArchive(entries[{ name, compressedSize, uncompressedSize, depth }], limitsId) → { ok, errors[] } — zip slip + bomb limits */
  function checkArchive(entries = [], limitsId = 'kmz') {
    const L = (pol('uploadPolicy').archives || {})[limitsId];
    if (!L) return { ok: false, errors: ['ARCHIVE_POLICY_UNKNOWN'] };
    const errors = new Set(); let total = 0, comp = 0;
    if (entries.length > L.maxEntries) errors.add('TOO_MANY_ENTRIES');
    for (const e of entries) {
      const n = String(e.name || '');
      if (!n || /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^([\\/]|[a-z]:)/i.test(n) || n.includes('\\') || /[\u0000]/.test(n)) errors.add('ZIP_SLIP');
      if ((e.depth || 0) > L.maxNesting || /\.(zip|kmz|jar)$/i.test(n) && L.maxNesting === 0) errors.add('NESTED_ARCHIVE');
      total += Math.max(0, +e.uncompressedSize || 0); comp += Math.max(0, +e.compressedSize || 0);
      if ((+e.uncompressedSize || 0) > L.maxEntryBytes) errors.add('ENTRY_TOO_LARGE');
      if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > L.maxRatio) errors.add('COMPRESSION_RATIO');
    }
    if (total > L.maxTotalUncompressedBytes) errors.add('UNCOMPRESSED_TOO_LARGE');
    if (comp > 0 && total / comp > L.maxRatio) errors.add('COMPRESSION_RATIO');
    return { ok: !errors.size, errors: [...errors] };
  }

  // ------------------------------------------------------------------ rate limiting (pure evaluator)
  const rateLimitPolicy = id => ((pol('rateLimits').policies || []).find(p => p.policyId === id) || null);
  /** createRateLimiter(policyOrId) → { check(dimensions, nowMs) → { allowed, retryAfterSeconds, action, remaining } } — fixed window
      plus burst allowance; unknown policy → fail closed (always REJECT). Keys are built from the policy's keyDimensions only. */
  function createRateLimiter(policyOrId) {
    const p = typeof policyOrId === 'string' ? rateLimitPolicy(policyOrId) : policyOrId;
    const hits = new Map();
    return freeze({ policy: p, check(dims = {}, now = Date.now()) {
      if (!p) return { allowed: false, retryAfterSeconds: 60, action: 'REJECT', remaining: 0, reason: 'POLICY_UNKNOWN' };
      const key = p.keyDimensions.map(d => `${d}=${dims[d] == null ? '-' : dims[d]}`).join('|'), w = p.windowSeconds * 1000;
      let h = hits.get(key); if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + w }; hits.set(key, h); }
      h.count++;
      const max = p.maxRequests + (p.burst || 0);
      if (h.count > max) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((h.resetAt - now) / 1000)), action: p.action, remaining: 0, reason: 'RATE_LIMITED' };
      return { allowed: true, retryAfterSeconds: 0, action: null, remaining: max - h.count };
    }, size: () => hits.size });
  }

  // ------------------------------------------------------------------ high-risk actions
  const highRiskPolicy = code => ((pol('highRiskActions').actions || []).find(a => a.actionCode === code) || null);
  /** evaluateHighRisk(actionCode, { allowedPermissions: Set|string[], authStrength, sessionAgeMs, reason, expectedRevision, approvals })
      → { effect, reasons[], obligations[] }. Order: policy → permissions (deny) → step-up → reason → revision → audit obligation.
      Permissions not in the PermissionRegistry are DENY (fail closed) even if the caller claims them. */
  function evaluateHighRisk(code, c = {}) {
    const p = highRiskPolicy(code), D = r => freeze({ effect: DECISION.DENY, reasons: freeze([r]), obligations: freeze([]) });
    if (!p) return D('HIGH_RISK_POLICY_UNKNOWN');
    const allowed = new Set(c.allowedPermissions || []);
    for (const k of p.requiredPermissions) {
      if (!(App.permissions && App.permissions.has(k))) return D('PERMISSION_NOT_REGISTERED');
      if (!allowed.has(k)) return D('NO_GRANT');
    }
    const obligations = [];
    if (p.requireAudit) obligations.push('writeAuditEvent');
    if (p.requireStepUp) {
      const strength = AUTH_STRENGTH[c.authStrength] || 0, fresh = p.maxSessionAgeForActionMs == null || (typeof c.sessionAgeMs === 'number' && c.sessionAgeMs <= p.maxSessionAgeForActionMs);
      if (strength < AUTH_STRENGTH.MFA_VERIFIED || !fresh) return freeze({ effect: DECISION.REQUIRES_STEP_UP, reasons: freeze(['STEP_UP_REQUIRED']), obligations: freeze(obligations) });
    }
    if (p.requireReason && !(typeof c.reason === 'string' && c.reason.trim().length >= 5)) return freeze({ effect: DECISION.DENY, reasons: freeze(['REASON_REQUIRED']), obligations: freeze(obligations) });
    if (p.requireExpectedRevision && (c.expectedRevision == null || c.expectedRevision === '')) return freeze({ effect: DECISION.DENY, reasons: freeze(['EXPECTED_REVISION_REQUIRED']), obligations: freeze(obligations) });
    if (p.requireDualApproval && !((c.approvals || []).filter(a => a && a.by && a.by !== c.actorId).length >= 1)) return freeze({ effect: DECISION.REQUIRES_APPROVAL, reasons: freeze(['DUAL_APPROVAL_REQUIRED']), obligations: freeze(obligations) });
    return freeze({ effect: DECISION.ALLOW, reasons: freeze(['ALLOWED']), obligations: freeze(obligations) });
  }

  // ------------------------------------------------------------------ idempotency (key misuse protection)
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
  /** idempotency({ ttlSeconds }) → { check({ key, tenantId, userId, endpoint, payload, now }) → { outcome: NEW|REPLAY|PAYLOAD_MISMATCH|INVALID_KEY } } */
  function idempotency({ ttlSeconds = 86400 } = {}) {
    const seen = new Map();
    return freeze({ check({ key, tenantId, userId, endpoint, payload, now = Date.now() } = {}) {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return { outcome: 'INVALID_KEY' };
      const scope = `${tenantId || '-'}|${userId || '-'}|${endpoint || '-'}|${key}`, fp = canon(payload == null ? null : payload), e = seen.get(scope);
      if (e && e.expiresAt > now) return { outcome: e.fp === fp ? 'REPLAY' : 'PAYLOAD_MISMATCH' };
      seen.set(scope, { fp, expiresAt: now + ttlSeconds * 1000 });
      return { outcome: 'NEW' };
    } });
  }

  // ------------------------------------------------------------------ webhooks (replay window; signature verified server-side)
  /** checkWebhook({ timestampSeconds, eventId, signatureValid, now }, policy, seen:Set) → { ok, reason } */
  function checkWebhook(m = {}, policy = {}, seen = new Set()) {
    const tol = policy.timestampToleranceSeconds || 300, now = m.now == null ? Date.now() : m.now;
    if (m.signatureValid !== true) return { ok: false, reason: 'INVALID_SIGNATURE' };
    if (!(typeof m.timestampSeconds === 'number') || Math.abs(now / 1000 - m.timestampSeconds) > tol) return { ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };
    if (!m.eventId || seen.has(m.eventId)) return { ok: false, reason: 'REPLAY' };
    if (policy.replayProtection !== false) seen.add(m.eventId);
    return { ok: true, reason: null };
  }

  // ------------------------------------------------------------------ SecurityEvent (≠ AuditEvent ≠ product analytics)
  const secLog = [], MAX = 200; let seq = 0;
  const eventTypes = () => (pol('securityEvents').eventTypes || []);
  /** securityEvent(type, data, { now }) → frozen event | null (unknown type). Metadata is redacted; IPs only as given hash. Local ring buffer only:
      nothing here is sent anywhere and nothing goes to analytics. */
  function securityEvent(type, data = {}, opts = {}) {
    const def = eventTypes().find(e => e.eventType === type); if (!def) return null;
    const { organizationId, principalId, resourceType, resourceId, correlationId, sourceIpHash, ...rest } = data || {};
    const now = opts.now == null ? Date.now() : (typeof opts.now === 'number' ? opts.now : new Date(opts.now).getTime());
    const ev = freeze({ eventId: `sec-${now.toString(36)}-${(++seq).toString(36)}`, eventType: type, severity: def.severity, organizationId: organizationId || null, principalId: principalId || null,
      sourceIpHash: typeof sourceIpHash === 'string' && /^[a-f0-9]{16,64}$/i.test(sourceIpHash) ? sourceIpHash : null, resourceType: resourceType || null,
      resourceId: resourceId != null && safeToken(String(resourceId)) ? String(resourceId) : null, occurredAt: new Date(now).toISOString(), correlationId: correlationId && safeToken(String(correlationId)) ? String(correlationId) : null,
      metadata: freeze(redactRecord(rest).value) });
    secLog.push(ev); if (secLog.length > MAX) secLog.shift();
    return ev;
  }

  // ------------------------------------------------------------------ SecurityConfigValidator (fail closed)
  /** validateSecurityConfig(c, { env }) → { ok, errors[], warnings[] } — c is the backend/static-host config shape:
      { env, corsOrigins[], auth: { devTokens }, adminTokenLength, sharePepperLength, shareEnabled, cookie: { secure, httpOnly, sameSite, domain },
        trustProxy, proxyHops, hsts, debugEndpoints, assetBaseUrl, csp } */
  function validateSecurityConfig(c = {}, { env } = {}) {
    const e = [], w = [], prod = (env || c.env) === 'production';
    const origins = c.corsOrigins || [];
    if (origins.includes('*') && prod) e.push('CORS_WILDCARD_IN_PRODUCTION');
    if (origins.includes('*') && c.corsCredentials) e.push('CORS_WILDCARD_WITH_CREDENTIALS');
    if (prod && origins.some(o => /^http:\/\//.test(o) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(o))) e.push('CORS_HTTP_ORIGIN_IN_PRODUCTION');
    if (prod && origins.some(o => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(o))) w.push('CORS_LOCALHOST_IN_PRODUCTION');
    if (prod && c.auth && c.auth.devTokens) e.push('DEBUG_AUTH_PROVIDER_IN_PRODUCTION');
    if (prod && c.debugEndpoints) e.push('DEBUG_ENDPOINTS_IN_PRODUCTION');
    if (prod && c.adminTokenLength != null && c.adminTokenLength > 0 && c.adminTokenLength < 32) e.push('ADMIN_TOKEN_TOO_SHORT');
    if (c.shareEnabled && !(c.sharePepperLength >= 16)) e.push('SHARE_SIGNING_SECRET_MISSING');
    if (c.cookie) {
      if (prod && !c.cookie.secure) e.push('COOKIE_NOT_SECURE');
      if (!c.cookie.httpOnly) e.push('COOKIE_NOT_HTTPONLY');
      if (!['Lax', 'Strict'].includes(c.cookie.sameSite)) e.push('COOKIE_SAMESITE_WEAK');
      if (c.cookie.domain && /^\./.test(c.cookie.domain)) w.push('COOKIE_WILDCARD_DOMAIN');
    }
    if (c.trustProxy && !(c.proxyHops >= 1)) w.push('TRUST_PROXY_WITHOUT_HOP_COUNT');
    if (prod && c.hsts === false) w.push('HSTS_DISABLED');
    if (prod && c.tenantEnforcement === false) e.push('TENANT_ENFORCEMENT_DISABLED');
    if (c.csp) for (const f of evaluateCsp(c.csp)) (f.severity === 'HIGH' ? e : w).push('CSP_' + f.code);
    if (prod && c.assetBaseUrl && !/^https:\/\//.test(c.assetBaseUrl)) e.push('ASSET_BASE_URL_NOT_HTTPS');
    return { ok: !e.length, errors: e, warnings: w };
  }

  // ------------------------------------------------------------------ BFCache / logout
  /** onPageShow({ persisted, authenticated, lastRevalidatedAt, now }) → 'NONE' | 'REVALIDATE' (§222–224, scenario 375) */
  const onPageShow = ({ persisted = false, authenticated = false, lastRevalidatedAt = 0, now = Date.now(), maxAgeMs = 60000 } = {}) =>
    authenticated && (persisted || now - lastRevalidatedAt > maxAgeMs) ? 'REVALIDATE' : 'NONE';
  /** logoutPlan() → ordered steps the app runs on logout (server revoke first; local purge always, even offline) */
  const logoutPlan = () => (pol('browserPolicy').logout || {}).steps || [];

  // ------------------------------------------------------------------ registries (threat model, classification, inventory)
  const threatModel = () => pol('threatModel');
  const classificationOf = assetOrDataType => { const c = pol('dataClassification').items || []; const it = c.find(x => x.type === assetOrDataType); return it ? it.classification : null; };
  const legacyInventory = () => (pol('legacyInventory').items || []).slice();
  const tokenTypes = () => (pol('tokenTypes').types || []).slice();
  /** validate() → errors[] over config/security topic-50 registries (references, enums, uniqueness) */
  function validate() {
    const errs = [], E = (code, m) => errs.push({ code, message: m });
    const tm = threatModel(), assets = new Map((tm.assets || []).map(a => [a.assetId, a]));
    for (const a of tm.assets || []) { if (!CLASSIFICATION.includes(a.classification)) E('ASSET_CLASSIFICATION', a.assetId); if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(a.businessImpact)) E('ASSET_IMPACT', a.assetId); }
    const ids = new Set();
    for (const t of tm.threats || []) {
      if (ids.has(t.threatId)) E('THREAT_DUPLICATE', t.threatId); ids.add(t.threatId);
      if (!assets.has(t.assetId)) E('THREAT_UNKNOWN_ASSET', t.threatId);
      if (!['Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege'].includes(t.category)) E('THREAT_CATEGORY', t.threatId);
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(t.likelihood) || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(t.severity)) E('THREAT_RATING', t.threatId);
      if (!(t.mitigations || []).length) E('THREAT_NO_MITIGATION', t.threatId);
    }
    for (const req of tm.requiredFlows || []) if (!(tm.threats || []).some(t => (t.flows || []).includes(req))) E('FLOW_WITHOUT_THREAT', req);
    for (const i of pol('dataClassification').items || []) if (!CLASSIFICATION.includes(i.classification)) E('DATA_CLASSIFICATION', i.type);
    for (const a of pol('highRiskActions').actions || []) for (const k of a.requiredPermissions || []) if (!(App.permissions && App.permissions.has(k)) && !(pol('highRiskActions').proposedPermissions || []).some(p => p.key === k)) E('HIGH_RISK_UNKNOWN_PERMISSION', `${a.actionCode}: ${k}`);
    for (const p of pol('rateLimits').policies || []) if (!(p.windowSeconds > 0 && p.maxRequests > 0 && ['THROTTLE', 'REJECT', 'CHALLENGE'].includes(p.action) && (p.keyDimensions || []).length)) E('RATE_LIMIT_POLICY', p.policyId);
    for (const e of pol('securityEvents').eventTypes || []) if (!SEVERITY.includes(e.severity)) E('SECURITY_EVENT_SEVERITY', e.eventType);
    for (const i of pol('legacyInventory').items || []) if (!['KEEP', 'HARDEN', 'REPLACE', 'REMOVE', 'REVIEW'].includes(i.migrationAction) || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(i.severity)) E('LEGACY_ITEM', i.location);
    const csp = buildCsp({ scriptHashes: ['AAAA'] }); for (const f of evaluateCsp(csp)) if (f.severity === 'HIGH') E('CSP_POLICY', f.code);
    return errs;
  }

  return freeze({ CLASSIFICATION, CLASS_ORDER, DECISION, AUTH_STRENGTH, SEVERITY,
    escapeHtml, isMarkupFree, safeToken, safeUrl, scrubRestoredState, redactText, redactRecord, auditStorage, csvCell,
    buildCsp, evaluateCsp, securityHeaders, checkOutboundUrl, sniffMime, normalizeFilename, checkUpload, checkArchive,
    rateLimitPolicy, createRateLimiter, highRiskPolicy, evaluateHighRisk, idempotency, checkWebhook,
    securityEvent, securityEvents: () => secLog.slice(), validateSecurityConfig, onPageShow, logoutPlan,
    threatModel, classificationOf, legacyInventory, tokenTypes, validate });
})();
