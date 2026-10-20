'use strict';
/* Cross-cutting HTTP concerns: request id, security headers, CORS allowlist,
   in-memory rate limit, JSON body parsing and the write guard (admin bearer token). */
const crypto = require('crypto');
const { E } = require('./errors');

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;
function requestIdOf(req) {
  const h = req.headers['x-request-id'];
  return typeof h === 'string' && REQUEST_ID_RE.test(h) ? h : crypto.randomUUID();
}

function securityHeaders(res, { hsts = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** CORS restricted to an explicit allowlist (CORS_ORIGINS). Returns true when the request was a handled preflight.
    credentials (W3 login): allowed origins (never "*") may send the session cookie (Access-Control-Allow-Credentials). */
function applyCors(req, res, allowlist, { credentials = false } = {}) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return { preflight: false, allowed: true };
  const allowed = allowlist.includes(origin) || (allowlist.includes('*') && true);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowlist.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Request-Id, X-Correlation-Id, Retry-After, Location, Idempotent-Replayed');
    if (credentials && !allowlist.includes('*')) res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    if (!allowed) throw E.forbidden('CORS_ORIGIN_DENIED', 'Origem não permitida');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match, Authorization, X-Request-Id, Idempotency-Key, Last-Event-ID, X-Organization-Id, traceparent, X-Correlation-Id, X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '600');
    return { preflight: true, allowed };
  }
  return { preflight: false, allowed };
}

/** Fixed-window limiter per client IP. Good enough for one instance; Redis when scaled out. */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); }, Math.max(windowMs, 1000));
  timer.unref();
  return {
    check(key) {
      if (!max) return { ok: true };
      const now = Date.now();
      let h = hits.get(key);
      if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + windowMs }; hits.set(key, h); }
      h.count++;
      return h.count > max ? { ok: false, retryAfter: Math.ceil((h.resetAt - now) / 1000) } : { ok: true, remaining: max - h.count };
    },
    stop: () => clearInterval(timer)
  };
}

// With trusted proxies the client controls the left-most X-Forwarded-For entries: take the entry added by the outermost trusted proxy (hops = number of trusted proxies).
function clientIp(req, trustProxy, hops = 1) {
  if (trustProxy) { const xf = req.headers['x-forwarded-for']; if (typeof xf === 'string' && xf) { const ips = xf.split(',').map(s => s.trim()).filter(Boolean); const ip = ips[ips.length - hops]; if (ip) return ip; } }
  return req.socket.remoteAddress || 'unknown';
}

/** Reads a JSON body with a size limit. Rejects non-JSON content types. */
function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(ct)) { req.resume(); return reject(E.unsupportedMedia()); }
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { chunks.length = 0; reject(E.payloadTooLarge(limit)); return; } // keep draining (discarded) so the 413 reaches the client
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return reject(E.badRequest('Corpo JSON ausente'));
      try { resolve(JSON.parse(text)); } catch (_) { reject(E.badRequest('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

/** Write guard (admin bearer token). Read endpoints are public; every mutating route goes through here BEFORE its
    body is read: 403 WRITES_DISABLED when no credential is configured (or the kill switch is on), 401 UNAUTHORIZED
    when the bearer token does not match. Tokens are compared as sha256 digests with crypto.timingSafeEqual (constant
    time, equal lengths). The token is never logged, echoed or stored. Returns the actor context { actorId, principal }. */
function authorizeWrite(req, config) {
  const auth = config.writeAuth;
  if (!auth || !auth.enabled) throw E.forbidden('WRITES_DISABLED', 'Escrita desabilitada neste ambiente (ADMIN_API_TOKEN não configurado)');
  const h = req.headers.authorization;
  const m = typeof h === 'string' ? /^Bearer ([\x21-\x7e]{1,4096})$/.exec(h) : null;
  if (!m) throw E.unauthorized();
  const presented = crypto.createHash('sha256').update(m[1], 'utf8').digest();
  let match = null;
  for (const c of auth.credentials) if (crypto.timingSafeEqual(presented, c.hash) && !match) match = c; // no early exit on the comparison itself
  if (!match) throw E.unauthorized();
  return { actorId: match.actorId, principal: match.principal };
}

module.exports = { requestIdOf, securityHeaders, applyCors, createRateLimiter, clientIp, readJsonBody, authorizeWrite };
