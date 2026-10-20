'use strict';
/* ShareTokenService (topic 42), pure and DB-free: the backend side of share tokens and passcodes.
   - generateToken(): 32 bytes from the OS CSPRNG, base64url (43 chars, 256 bits). Never derived from an id.
   - hashToken(token, pepper): HMAC-SHA256 with a server-side pepper (env SHARE_TOKEN_PEPPER); only this hash is stored
     (share_tokens.token_hash, unique index). The raw token is returned once, in ShareGrantCreateResultDto.
   - tokenPrefix(token): 4 chars for support screens (does not weaken the remaining 234+ bits).
   - verifyTokenHash(): constant-time comparison.
   - hashPasscode / verifyPasscode: scrypt (N=16384, r=8, p=1) with a random 16-byte salt; never plaintext, never unsalted.
   - redactToken(text): strips tokens from anything bound for logs/analytics.
   Persistence, expiry, revocation, one-time consumption (UPDATE … WHERE access_count < max_access_count RETURNING) and
   rate limits are in the share repository/service contracts (docs/SHARE_GRANT_AND_TOKEN_SECURITY.md). */
const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 });

function generateToken() { return crypto.randomBytes(TOKEN_BYTES).toString('base64url'); }
function pepperOf(pepper) {
  const p = pepper != null ? pepper : process.env.SHARE_TOKEN_PEPPER;
  if (!p || String(p).length < 16) throw Object.assign(new Error('SHARE_TOKEN_PEPPER ausente ou curto (mínimo 16 caracteres)'), { code: 'SHARE_PEPPER_MISSING' });
  return String(p);
}
function hashToken(token, pepper) {
  if (!TOKEN_RE.test(String(token || ''))) throw Object.assign(new Error('formato de token inválido'), { code: 'TOKEN_FORMAT' });
  return crypto.createHmac('sha256', pepperOf(pepper)).update(token).digest('hex');
}
const tokenPrefix = token => String(token).slice(0, 4);
function verifyTokenHash(token, expectedHex, pepper) {
  let got; try { got = Buffer.from(hashToken(token, pepper), 'hex'); } catch (e) { return false; }
  const exp = Buffer.from(String(expectedHex || ''), 'hex');
  return exp.length === got.length && crypto.timingSafeEqual(got, exp);
}
function hashPasscode(passcode, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(passcode), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return { algorithm: `scrypt$N=${SCRYPT.N}$r=${SCRYPT.r}$p=${SCRYPT.p}`, salt: salt.toString('base64'), hash: hash.toString('base64') };
}
function verifyPasscode(passcode, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const h = hashPasscode(passcode, Buffer.from(stored.salt, 'base64'));
  const a = Buffer.from(h.hash, 'base64'), b = Buffer.from(stored.hash, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const redactToken = s => String(s == null ? '' : s).replace(/\/s\/[A-Za-z0-9_-]{20,}/g, '/s/[token]').replace(/\b[A-Za-z0-9_-]{43}\b/g, '[token]');

module.exports = { TOKEN_BYTES, TOKEN_RE, SCRYPT, generateToken, hashToken, tokenPrefix, verifyTokenHash, hashPasscode, verifyPasscode, redactToken };
