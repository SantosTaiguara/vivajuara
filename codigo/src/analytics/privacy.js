/* analytics/privacy.js — topic 45 §19–21, §88–97: privacy and consent policy for analytics.

   · forbidden keys (phone, email, CPF, name, address, notes, message bodies, document content, tokens, passwords,
     passcodes, URLs, raw queries, budget/income/price…) — by exact normalized key and by fragment;
   · reserved context keys a component can never set through the payload (organizationId, userId, tenant, session…);
   · value detectors (EMAIL, PHONE_BR, CPF, CNPJ, URL, BEARER, JWT, LONG_SECRET) applied to every string;
   · ValueRedaction DROP / BUCKET / HASH / ALLOW (HASH is pseudonymous, never "anonymous");
   · CampaignContextExtractor (utm_* allow-list, sanitized, never the landing URL);
   · AnalyticsConsentPolicy: what may be captured locally, what may leave the device, what a revocation purges.
   The code executes the approved policy (plat/config/analytics/policy.json); it does not interpret the law. */
App.eventTracking = App.eventTracking || {};
App.eventTracking.privacy = (() => {
  const pol0 = () => (App.configs && App.configs.analytics && App.configs.analytics.policy) || {};
  const norm = k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const DETECTORS = Object.freeze({
    EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    PHONE_BR: /(?:\+?55[\s.-]?)?\(?\b[1-9]{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/,
    CPF: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
    CNPJ: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/,
    URL: /\b(?:https?|ftp|file|data|javascript):|\bwww\.[a-z0-9-]+\.|\/s\/[A-Za-z0-9_-]{8,}/i,
    BEARER: /\bbearer\s+[A-Za-z0-9._~+\/-]+=*/i,
    JWT: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./,
    LONG_SECRET: /[A-Za-z0-9_\-]{32,}/
  });
  const isForbiddenKey = (k, pol = pol0()) => {
    const p = pol.privacy || {}, n = norm(k);
    if ((p.forbiddenKeys || []).map(norm).includes(n)) return true;
    return (p.forbiddenKeyFragments || []).some(f => n.includes(norm(f)));
  };
  const isReservedKey = (k, pol = pol0()) => ((pol.privacy || {}).reservedContextKeys || []).map(norm).includes(norm(k));
  /** detect(text) → detector codes found (empty when clean) */
  function detect(text, pol = pol0()) {
    if (typeof text !== 'string' || !text) return [];
    const on = (pol.privacy || {}).valueDetectors || Object.keys(DETECTORS);
    return on.filter(c => DETECTORS[c] && DETECTORS[c].test(text));
  }
  /** scrub(obj) → deep copy with forbidden keys removed and PII-looking strings replaced; reports what it did (no values) */
  function scrub(obj, pol = pol0(), path = '', report = { removedKeys: [], redactedValues: [] }) {
    if (Array.isArray(obj)) return { value: obj.map((v, i) => scrub(v, pol, `${path}[${i}]`, report).value), report };
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) { const p = path ? `${path}.${k}` : k; if (isForbiddenKey(k, pol)) { report.removedKeys.push(p); continue; } out[k] = scrub(v, pol, p, report).value; }
      return { value: out, report };
    }
    if (typeof obj === 'string' && detect(obj, pol).length) { report.redactedValues.push(path); return { value: '[removido]', report }; }
    return { value: obj, report };
  }
  // ---------------------------------------------------------------- value redaction (§94–95)
  const Redaction = Object.freeze({ DROP: 'DROP', BUCKET: 'BUCKET', HASH: 'HASH', ALLOW: 'ALLOW' });
  /** bucket(value, edges, unit) → band label like "300K_350K" ("250_350" for areas); null stays null (never 0) */
  function bucket(value, edges, o = {}) {
    if (value == null || !Number.isFinite(+value)) return null;
    const v = +value, e = edges.slice().sort((a, b) => a - b), f = x => o.unit === 'K' ? `${Math.round(x / 1000)}K` : String(x);
    if (v < e[0]) return `LT_${f(e[0])}`;
    for (let i = 0; i < e.length - 1; i++) if (v >= e[i] && v < e[i + 1]) return `${f(e[i])}_${f(e[i + 1])}`;
    return `GE_${f(e[e.length - 1])}`;
  }
  const countBucket = n => n == null || !Number.isFinite(+n) ? null : +n <= 0 ? '0' : +n === 1 ? '1' : +n <= 5 ? '2_5' : +n <= 20 ? '6_20' : '21_PLUS';
  /** hash(text, salt) → FNV-1a hex (pseudonymous: still personal data under policy, §114) */
  function hash(text, salt = '') { let h = 0x811c9dc5; const s = salt + '|' + String(text); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  function redact(value, mode, o = {}) {
    switch (mode) {
      case 'ALLOW': return value;
      case 'BUCKET': return bucket(value, o.edges || [0], o);
      case 'HASH': return value == null ? null : 'h_' + hash(value, o.salt || '');
      default: return undefined; // DROP
    }
  }
  // ---------------------------------------------------------------- campaign context (§91)
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  /** extractCampaign(search) → { utm_source… } from a query string or URLSearchParams; nothing else survives */
  function extractCampaign(search, pol = pol0()) {
    const out = {}; let sp;
    try { sp = typeof search === 'string' ? new URLSearchParams(search.replace(/^[^?]*\?/, '').split('#')[0]) : search; } catch (e) { return out; }
    if (!sp || typeof sp.get !== 'function') return out;
    for (const k of UTM) { let v = sp.get(k); if (v == null) continue; v = String(v).trim().toLowerCase().replace(/[^a-z0-9_.\-]+/g, '_').slice(0, 64); if (v && !detect(v, pol).length) out[k] = v; }
    return out;
  }
  // ---------------------------------------------------------------- consent (§88–90)
  const ConsentState = Object.freeze({ GRANTED: 'GRANTED', DENIED: 'DENIED', UNKNOWN: 'UNKNOWN', NOT_REQUIRED_BY_POLICY: 'NOT_REQUIRED_BY_POLICY' });
  /** consentDecision(def, state) → { capture, remote, reason } for one event definition */
  function consentDecision(def, state, pol = pol0()) {
    const c = pol.consent || {}, st = ConsentState[state] ? state : 'UNKNOWN';
    if (def && def.consentRequirement === 'NOT_REQUIRED_BY_POLICY') return { capture: true, remote: false, reason: 'NOT_REQUIRED_BY_POLICY' }; // technical telemetry stays local
    const capture = (c.localCaptureWhen || ['GRANTED', 'UNKNOWN']).includes(st);
    const remote = capture && (c.remoteSendWhen || ['GRANTED']).includes(st);
    return { capture, remote, reason: capture ? (remote ? 'CONSENT_GRANTED' : 'LOCAL_ONLY') : 'CONSENT_DENIED' };
  }
  /** vendorPayload(envelope, mapping) → the only fields a third party could ever receive (no ids, no entity refs) */
  function vendorPayload(env, mapping, pol = pol0()) {
    if (!mapping) return null;
    const params = {}; for (const k of mapping.params || []) if (env.payload && env.payload[k] != null) params[k] = env.payload[k];
    const banned = (pol.privacy || {}).vendorForbiddenEntityKeys || [];
    const s = scrub(params, pol).value; for (const b of banned) delete s[b];
    return { name: mapping.name, params: s, route: env.navigation && env.navigation.routeCode || null };
  }
  return Object.freeze({ DETECTORS, isForbiddenKey, isReservedKey, detect, scrub, Redaction, bucket, countBucket, hash, redact, UTM, extractCampaign, ConsentState, consentDecision, vendorPayload, normalizeKey: norm });
})();
