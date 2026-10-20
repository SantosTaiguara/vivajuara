'use strict';
/* Topic 51 — backend observability helpers (pure, DB-free; traceparent/correlation + /health/live wired into src/app.js; RED metrics not exposed yet: see docs/API_AND_DATABASE_OBSERVABILITY.md).
   · W3C traceparent parse/format; requestId ≠ correlationId ≠ traceId (traceId of the v1 error body stays an alias of requestId);
   · correlation context from headers, accepted only in a safe format;
   · log field redaction (same keys as plat/config/observability/policy.json) for the existing JSON logger;
   · RED metrics in memory (rate, errors, duration p50/p95/p99) with controlled labels: endpoint_group = route TEMPLATE,
     never the raw path; exposition in Prometheus text format for a protected /metrics (decision O1);
   · minimal /health/live body (no version, no topology). */
const crypto = require('crypto');
const fs = require('fs'), path = require('path');

const POLICY = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'config', 'observability', 'policy.json'), 'utf8')); } catch (_) { return {}; } })();
const R = POLICY.redaction || {};
const norm = k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BLOCKED = new Set((R.blockedKeys || ['authorization', 'cookie', 'password', 'token', 'secret', 'body']).map(norm));
const FRAG = (R.blockedKeyFragments || ['token', 'password', 'secret', 'cookie', 'authorization']).map(norm);
const MASKED = new Set((R.maskedKeys || []).map(norm));
const EXEMPT = new Set((R.idKeysExemptFromSecretDetector || ['requestid', 'correlationid', 'traceid', 'spanid', 'parentspanid']).map(norm));
const SECRET_VALUE = /\bbearer\s+\S+|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|postgres(?:ql)?:\/\/\S+/i;

/** redactFields(obj) → copy safe for the logger (blocked keys removed, masked keys masked, secret-looking strings replaced) */
function redactFields(obj, depth = 0) {
  if (obj == null || typeof obj !== 'object') return typeof obj === 'string' && SECRET_VALUE.test(obj) ? '[removido]' : obj;
  if (depth > 4) return '[profundidade]';
  if (Array.isArray(obj)) return obj.slice(0, 20).map(v => redactFields(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = norm(k);
    if (BLOCKED.has(n) || FRAG.some(f => n.includes(f))) continue;
    out[k] = MASKED.has(n) ? (v == null ? null : '[mascarado]') : redactFields(v, depth + 1);
  }
  return out;
}

const hex = n => { let s; do s = crypto.randomBytes(n).toString('hex'); while (/^0+$/.test(s)); return s; };
const formatTraceparent = ({ traceId, spanId, sampled = true }) => `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
function parseTraceparent(h) {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(h || '').trim().toLowerCase());
  if (!m || m[1] === 'ff' || /^0+$/.test(m[2]) || /^0+$/.test(m[3])) return null;
  return { traceId: m[2], parentSpanId: m[3], sampled: (parseInt(m[4], 16) & 1) === 1 };
}
const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;
/** contextFromHeaders(headers, requestId) → { requestId, correlationId, traceId, spanId, parentSpanId, sampled } */
function contextFromHeaders(headers = {}, requestId) {
  const tp = parseTraceparent(headers.traceparent), cor = headers['x-correlation-id'];
  return { requestId, correlationId: typeof cor === 'string' && SAFE_ID.test(cor) ? cor : 'cor_' + hex(8), traceId: tp ? tp.traceId : hex(16), spanId: hex(8), parentSpanId: tp ? tp.parentSpanId : null, sampled: tp ? tp.sampled : true };
}
const statusClass = s => (s >= 500 ? '5xx' : s >= 400 ? '4xx' : s >= 300 ? '3xx' : s >= 200 ? '2xx' : 'NETWORK');
/** endpointGroup('GET /v1/developments/:id/lots/:lotId') → 'developments.lots' (template, never the raw path) */
const endpointGroup = routeTemplate => String(routeTemplate || 'unknown').replace(/^[A-Z]+\s+/, '').split('/').filter(p => p && !p.startsWith(':') && !/^v\d+$/.test(p)).slice(0, 3).join('.').replace(/[^a-z0-9_.]/gi, '_').toLowerCase() || 'root';

function createRedMetrics({ reservoir = 500 } = {}) {
  const series = new Map();
  function record({ route, method, status, durationMs }) {
    const labels = { endpoint_group: endpointGroup(route), method: String(method || 'GET').toUpperCase(), status_class: statusClass(status) };
    const k = JSON.stringify(labels); let s = series.get(k);
    if (!s) { if (series.size >= 500) return false; s = { labels, count: 0, errors: 0, sum: 0, samples: [] }; series.set(k, s); }
    s.count++; if (status >= 500) s.errors++; s.sum += durationMs; s.samples.push(durationMs); if (s.samples.length > reservoir) s.samples.shift();
    return true;
  }
  const q = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)] : null;
  function summary() { return [...series.values()].map(s => { const xs = s.samples.slice().sort((a, b) => a - b); return { ...s.labels, requests: s.count, errors: s.errors, p50: q(xs, 0.5), p95: q(xs, 0.95), p99: q(xs, 0.99) }; }); }
  function prometheus() {
    const lab = l => '{' + Object.entries(l).map(([k, v]) => `${k}="${v}"`).join(',') + '}', out = ['# TYPE api_requests_total counter', '# TYPE api_errors_total counter', '# TYPE api_request_duration_ms summary'];
    for (const s of summary()) { const l = { endpoint_group: s.endpoint_group, method: s.method, status_class: s.status_class }; out.push(`api_requests_total${lab(l)} ${s.requests}`, `api_errors_total${lab(l)} ${s.errors}`);
      for (const [qq, v] of [['0.5', s.p50], ['0.95', s.p95], ['0.99', s.p99]]) if (v != null) out.push(`api_request_duration_ms${lab({ ...l, quantile: qq })} ${v}`); }
    return out.join('\n') + '\n';
  }
  return { record, summary, prometheus, size: () => series.size };
}
/** /health/live — minimal: the process answers (no version, no dependencies, no topology) */
const liveBody = () => ({ status: 'ok' });

/** the same key rules, for the backend JSON logger (shared/logging/logger.js, patch B3) */
const redactionRules = Object.freeze({ norm, BLOCKED, FRAG, MASKED, EXEMPT, maxStringLength: R.maxStringLength || 300, maxObjectDepth: R.maxObjectDepth || 4, maxArrayLength: R.maxArrayLength || 20, maxStackFrames: R.maxStackFrames || 8 });

module.exports = { redactionRules, redactFields, formatTraceparent, parseTraceparent, contextFromHeaders, statusClass, endpointGroup, createRedMetrics, liveBody, newTraceId: () => hex(16), newSpanId: () => hex(8) };
