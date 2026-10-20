'use strict';
/* Cookie parsing/serialization + the sealed login-transaction cookie (W3 login).
   - parseCookies(header) → Map (first value wins; malformed pairs ignored; values capped).
   - serializeCookie(name, value, opts) → Set-Cookie string (HttpOnly/Secure/SameSite/Path/Domain/Max-Age).
   - appendSetCookie(res, value): keeps cookies already queued on the response (several Set-Cookie headers).
   - seal(key, obj) / unseal(key, sealed, now): AES-256-GCM (confidential + authenticated) with an expiry inside the
     sealed payload; used for { state, nonce, PKCE verifier, returnTo } between /start and /callback, so the server keeps
     no per-attempt state and nothing in it is readable or forgeable by the browser. */
const crypto = require('crypto');

const NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
function parseCookies(header) {
  const out = new Map();
  if (typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i <= 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (!NAME_RE.test(k) || out.has(k) || v.length > 4096) continue;
    out.set(k, v.replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

function serializeCookie(name, value, { httpOnly = true, secure = true, sameSite = 'Lax', path = '/', domain = null, maxAge = null } = {}) {
  if (!NAME_RE.test(name)) throw new Error('invalid cookie name');
  if (!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value)) throw new Error('invalid cookie value');
  const a = [`${name}=${value}`, `Path=${path}`];
  if (domain) a.push(`Domain=${domain}`);
  if (maxAge != null) { a.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`); if (maxAge <= 0) a.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT'); }
  if (secure) a.push('Secure');
  if (httpOnly) a.push('HttpOnly');
  if (sameSite) a.push(`SameSite=${sameSite}`);
  return a.join('; ');
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(prev == null ? [] : Array.isArray(prev) ? prev : [String(prev)]), value]);
}

const VERSION = 'v1';
function seal(key, obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
}
/** unseal → object, or null when tampered, malformed, sealed with another key or expired (obj.exp, ms) */
function unseal(key, sealed, now = Date.now()) {
  if (typeof sealed !== 'string' || !sealed.startsWith(VERSION + '.') || sealed.length > 4096) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length + 1), 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    if (!obj || typeof obj !== 'object' || !Number.isFinite(obj.exp) || obj.exp <= now) return null;
    return obj;
  } catch (_) { return null; }
}

module.exports = { parseCookies, serializeCookie, appendSetCookie, seal, unseal };
