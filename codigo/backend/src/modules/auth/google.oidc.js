'use strict';
/* Google as OpenID Connect provider: Authorization Code flow + PKCE (S256), state and nonce (W3 login, D-IDP = Google).
   - authorizationUrl({ state, nonce, codeChallenge }) → https://accounts.google.com/o/oauth2/v2/auth?... (scope
     "openid email profile", prompt=select_account; hd= is only a hint for a single ALLOWED_HD, never the check).
   - exchangeCode(code, codeVerifier) → id_token (token endpoint, client_secret_post). The access token is discarded:
     this backend only needs the identity. Response bodies are never logged.
   - verifyIdToken(idToken, { nonce }) → normalized claims after: RS256 signature against Google's JWKS, iss
     (accounts.google.com, with or without https://), aud = GOOGLE_CLIENT_ID (azp too when aud is an array), exp/iat with
     60 s of clock skew, iat no older than the login window, nonce (constant time), sub, email + email_verified=true and,
     when ALLOWED_HD is set, hd in the allow-list (the hd claim, never the e-mail domain).
   The HTTP client is injectable ({ getJson(url), postForm(url, fields) }) so tests run a local fake Google; the
   default one uses global fetch with a timeout. */
const crypto = require('crypto');
const { verifyRs256, createJwksClient, AuthTokenError } = require('./jwt');

const SKEW_S = 60;
const fail = reason => { throw new AuthTokenError(reason); };

/** default HTTP client (node fetch); 5 s timeout; never follows redirects to another host silently */
function fetchHttpClient({ timeoutMs = 5000 } = {}) {
  const run = async (url, init) => {
    const r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    let json = null; try { json = await r.json(); } catch (_) { json = null; }
    return { status: r.status, json, headers: { 'cache-control': r.headers.get('cache-control') } };
  };
  return {
    getJson: url => run(url, { method: 'GET', headers: { Accept: 'application/json' } }),
    postForm: (url, fields) => run(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(fields).toString() })
  };
}

const b64url = buf => Buffer.from(buf).toString('base64url');
/** PKCE pair (RFC 7636): verifier = 43 base64url chars (256 bits), challenge = BASE64URL(SHA256(verifier)) */
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest()) };
}
const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a == null ? '' : a)), y = Buffer.from(String(b == null ? '' : b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createGoogleOidc({ oidc, http = fetchHttpClient(), now = () => Date.now() }) {
  const jwks = createJwksClient({ http, uri: oidc.jwksUri, now });

  function authorizationUrl({ state, nonce, codeChallenge }) {
    const u = new URL(oidc.authorizationEndpoint);
    const q = { response_type: 'code', client_id: oidc.clientId, redirect_uri: oidc.redirectUrl, scope: 'openid email profile', state, nonce,
      code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'select_account', access_type: 'online', include_granted_scopes: 'false' };
    if (oidc.allowedHd.length === 1) q.hd = oidc.allowedHd[0]; // UX hint only; the hd claim is verified below
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.toString();
  }

  async function exchangeCode(code, codeVerifier) {
    let r;
    try {
      r = await http.postForm(oidc.tokenEndpoint, { grant_type: 'authorization_code', code, redirect_uri: oidc.redirectUrl, client_id: oidc.clientId,
        client_secret: oidc.clientSecret, code_verifier: codeVerifier });
    } catch (_) { fail('TOKEN_ENDPOINT_UNAVAILABLE'); }
    if (!r || r.status !== 200 || !r.json || typeof r.json.id_token !== 'string') fail(r && r.status >= 500 ? 'TOKEN_ENDPOINT_UNAVAILABLE' : 'CODE_EXCHANGE_FAILED');
    return r.json.id_token;
  }

  async function verifyIdToken(idToken, { nonce, maxAgeSeconds = 600 }) {
    let c;
    try { c = await verifyRs256(idToken, kid => jwks.resolveKey(kid)); } catch (e) { if (e instanceof AuthTokenError) throw e; fail('JWKS_UNAVAILABLE'); }
    const t = Math.floor(now() / 1000);
    if (!oidc.issuers.includes(c.iss)) fail('ISSUER_INVALID');
    const aud = c.aud;
    if (Array.isArray(aud) ? !(aud.includes(oidc.clientId) && c.azp === oidc.clientId) : aud !== oidc.clientId) fail('AUDIENCE_INVALID');
    if (c.azp !== undefined && c.azp !== oidc.clientId) fail('AUDIENCE_INVALID');
    if (!Number.isFinite(c.exp) || c.exp + SKEW_S <= t) fail('TOKEN_EXPIRED');
    if (!Number.isFinite(c.iat) || c.iat - SKEW_S > t) fail('TOKEN_NOT_YET_VALID');
    if (t - c.iat > maxAgeSeconds + SKEW_S) fail('TOKEN_TOO_OLD');
    if (typeof c.nonce !== 'string' || !safeEqual(c.nonce, nonce)) fail('NONCE_MISMATCH');
    if (typeof c.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(c.sub)) fail('SUBJECT_INVALID');
    if (typeof c.email !== 'string' || !/^[^\s@]{1,128}@[^\s@]{1,253}$/.test(c.email)) fail('EMAIL_MISSING');
    if (c.email_verified !== true && c.email_verified !== 'true') fail('EMAIL_NOT_VERIFIED');
    const hd = typeof c.hd === 'string' ? c.hd.toLowerCase() : null;
    if (oidc.allowedHd.length && (!hd || !oidc.allowedHd.includes(hd))) fail('HOSTED_DOMAIN_NOT_ALLOWED');
    const given = typeof c.given_name === 'string' && c.given_name.trim() ? c.given_name.trim() : typeof c.name === 'string' ? c.name.trim().split(/\s+/)[0] : '';
    return { subject: c.sub, email: c.email, emailVerified: true, hostedDomain: hd, givenName: given.slice(0, 60) || null, expiresAt: c.exp };
  }

  return { authorizationUrl, exchangeCode, verifyIdToken };
}

module.exports = { createGoogleOidc, fetchHttpClient, pkcePair, randomToken, safeEqual };
