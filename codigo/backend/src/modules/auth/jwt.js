'use strict';
/* JWT (RS256 only) + JWKS client on node:crypto — no third-party JOSE library (W3 login).
   - verifyRs256(token, keyResolver): strict compact JWS: three base64url parts, header.alg MUST be RS256 ("none",
     HS256 and every other algorithm are refused, so a public key can never be used as an HMAC secret), signature
     checked with crypto.verify('RSA-SHA256') against the JWK whose kid matches the header.
   - createJwksClient({ http, uri, now }): caches the key set for the Cache-Control max-age (1 h by default, at most
     24 h); an unknown kid triggers at most one refetch per minute (key rotation without letting a forged kid flood
     the IdP). Only RSA signature keys are accepted.
   Errors are AuthTokenError with a stable reason code; tokens and claims are never put in error messages. */
const crypto = require('crypto');

class AuthTokenError extends Error {
  constructor(reason) { super(`id token rejected: ${reason}`); this.reason = reason; }
}
const fail = reason => { throw new AuthTokenError(reason); };

const B64URL = /^[A-Za-z0-9_-]*$/;
function b64json(part, reason) {
  if (!B64URL.test(part)) fail(reason);
  try { const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) fail(reason); return v; } catch (e) { if (e instanceof AuthTokenError) throw e; return fail(reason); }
}

/** decode without verifying (header + payload), for inspection only */
function decode(token) {
  if (typeof token !== 'string' || token.length > 16384) fail('MALFORMED');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) fail('MALFORMED');
  return { header: b64json(parts[0], 'MALFORMED'), payload: b64json(parts[1], 'MALFORMED'), parts };
}

/** verifyRs256(token, resolveKey(kid) → KeyObject|null) → payload (claims NOT validated here) */
async function verifyRs256(token, resolveKey) {
  const { header, payload, parts } = decode(token);
  if (header.alg !== 'RS256') fail('ALG_NOT_ALLOWED');
  if (header.crit !== undefined) fail('ALG_NOT_ALLOWED');
  if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 200) fail('KID_MISSING');
  const key = await resolveKey(header.kid);
  if (!key) fail('KID_UNKNOWN');
  if (!B64URL.test(parts[2])) fail('MALFORMED');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1], 'ascii'), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) fail('BAD_SIGNATURE');
  return payload;
}

/** JWK → KeyObject (RSA signature keys only) or null */
function keyFromJwk(jwk) {
  if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
  if (jwk.use && jwk.use !== 'sig') return null;
  if (jwk.alg && jwk.alg !== 'RS256') return null;
  try { const k = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }); return k.asymmetricKeyDetails && k.asymmetricKeyDetails.modulusLength >= 2048 ? k : null; } catch (_) { return null; }
}

function maxAgeOf(cacheControl) {
  const m = /max-age=(\d+)/i.exec(String(cacheControl || ''));
  return m ? Math.min(Number(m[1]), 24 * 3600) : 3600;
}

function createJwksClient({ http, uri, now = () => Date.now(), minRefetchMs = 60000 }) {
  let keys = new Map(), expiresAt = 0, lastFetch = -Infinity, inflight = null;
  async function load() {
    if (inflight) return inflight;
    inflight = (async () => {
      lastFetch = now();
      const r = await http.getJson(uri);
      if (!r || r.status !== 200 || !r.json || !Array.isArray(r.json.keys)) throw new AuthTokenError('JWKS_UNAVAILABLE');
      const next = new Map();
      for (const jwk of r.json.keys) { const k = typeof jwk.kid === 'string' ? keyFromJwk(jwk) : null; if (k) next.set(jwk.kid, k); }
      keys = next; expiresAt = now() + maxAgeOf(r.headers && r.headers['cache-control']) * 1000;
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function resolveKey(kid) {
    if (now() >= expiresAt) await load();
    if (!keys.has(kid) && now() - lastFetch >= minRefetchMs) await load(); // rotation: one refetch, rate limited
    return keys.get(kid) || null;
  }
  return { resolveKey, size: () => keys.size };
}

module.exports = { verifyRs256, decode, keyFromJwk, createJwksClient, AuthTokenError, maxAgeOf };
