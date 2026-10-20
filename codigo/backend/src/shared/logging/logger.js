'use strict';
/* Structured JSON logger (one line per event). Callers should log identifiers, routes and codes only — and since
   patch B3 (topic 50) every entry also goes through a central redaction before it is serialized:
   · key rules = the observability policy (plat/config/observability/policy.json via shared/observability/telemetry.js):
     blocked keys/fragments (authorization, cookie, token, password, secret, share token, cpf, email, phone, notes, body,
     name, url, query…) are dropped; masked keys (userId, shareId, sessionId…) become "[mascarado]";
   · value rules (also inside msg/detail/stack/arrays): Bearer/Basic credentials, JWT, /s/<share token>, token-like query
     parameters, dev tokens, postgres URLs with credentials, CPF, CNPJ, e-mail, BR phone numbers, long opaque secrets;
     ids exempt from the secret detector (requestId, traceId…) are kept as they are;
   · bounded: depth, array length and string length; stack trimmed to a few frames;
   · production (NODE_ENV=production or { production: true }): `stack` is never written.
   Redaction must never throw: a failure logs a placeholder instead of the fields. */
const { redactionRules: RR } = require('../observability/telemetry');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const TEXT_RULES = Object.freeze([
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{0,}/g, '[jwt]'],
  [/\/s\/[A-Za-z0-9_-]{16,}/g, '/s/[token]'],
  [/([?&](?:token|access_token|share_token|sharetoken|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature|key|api_key|code|state|passcode|password)=)[^&#\s"]+/gi, '$1[redacted]'],
  [/\bplat_dev_[A-Za-z0-9_-]{8,}/g, '[token]'],
  [/(postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqps?):\/\/[^\s@/]+@/gi, '$1://[redacted]@'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{3}\d{3}\d{3}\d{2}\b(?![\d-])/g, '[cpf]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]\d{4}\b/g, '[phone]'],
  [/\b(?=[A-Za-z0-9_-]{40,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, '[secret]']
]);

/** redactText(s) — value-based redaction of free text (messages, error details, stack traces) */
const redactText = s => TEXT_RULES.reduce((t, [re, rep]) => t.replace(re, rep), String(s == null ? '' : s));
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

function blockedKey(k) {
  const n = RR.norm(k);
  return RR.BLOCKED.has(n) || RR.FRAG.some(f => n.includes(f));
}

/** redact(fields) → copy safe for the log line (never mutates the caller's object) */
function redact(value, { production = false } = {}, depth = 0, key = '') {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    if (RR.EXEMPT.has(RR.norm(key))) return clip(value, RR.maxStringLength);
    return clip(redactText(value), RR.maxStringLength);
  }
  if (typeof value !== 'object') return undefined; // functions, symbols
  if (depth >= RR.maxObjectDepth) return '[profundidade]';
  if (value instanceof Error) return redact({ name: value.code || value.constructor.name, detail: value.message }, { production }, depth, key);
  if (Array.isArray(value)) return value.slice(0, RR.maxArrayLength).map(v => redact(v, { production }, depth + 1, key));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'stack') {
      if (production || v == null) continue;
      out.stack = clip(redactText(String(v).split('\n').slice(0, RR.maxStackFrames + 1).join('\n')), RR.maxStringLength * 4);
      continue;
    }
    if (blockedKey(k)) continue;
    if (RR.MASKED.has(RR.norm(k))) { out[k] = v == null ? null : '[mascarado]'; continue; }
    const r = redact(v, { production }, depth + 1, k);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

function createLogger({ level = 'info', stream = process.stdout, base = {}, production = process.env.NODE_ENV === 'production' } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    let safe;
    try { safe = redact({ ...base, ...fields }, { production }); } catch (_) { safe = { redaction: 'failed' }; }
    const entry = { timestamp: new Date().toISOString(), level: lvl, msg: clip(redactText(msg), 200), ...safe };
    try { stream.write(JSON.stringify(entry) + '\n'); } catch (_) { /* logging must never crash the process */ }
  };
  return {
    debug: (msg, f) => write('debug', msg, f),
    info: (msg, f) => write('info', msg, f),
    warn: (msg, f) => write('warn', msg, f),
    error: (msg, f) => write('error', msg, f),
    child: extra => createLogger({ level, stream, production, base: { ...base, ...extra } })
  };
}

module.exports = { createLogger, LEVELS, redact, redactText };
