'use strict';
/* AuthService — Google sign-in + server-side cookie session (W3 login; decisions: provider Google, organization org_house7).

   /auth/google/start    state + nonce + PKCE verifier (+ validated returnTo) sealed (AES-256-GCM) in a short-lived
                         HttpOnly cookie scoped to the callback path → 302 to Google.
   /auth/google/callback state (constant time) → code exchange (PKCE) → ID token verification (google.oidc.js) →
                         one-time nonce (replay = denied) → principal mapping → NEW session (rotation: the previous
                         session of this browser is revoked) → Set-Cookie → 302 back to the panel.
   Principal mapping (deny by default, no auto-provisioning of roles):
     - Google "sub" → users.external_identity_id = "google:" + sha256(sub) (no raw subject, no e-mail stored);
     - pending invitations for sha256(normalized verified e-mail) are accepted at login (membership ACTIVE + role in
       the invited organization, e.g. org_house7); an invitation is created by an admin (npm run iam -- invite …);
     - no user and no invitation → authenticated but pseudonymous principal with NO organization permission
       (only what any anonymous visitor may do on PUBLIC developments) and no user row.
   Session: opaque 256-bit id in the cookie, only sha256(id) stored; idle timeout (sliding) + absolute timeout;
   suspended/disabled users lose the session on the next request. CSRF: cookie-authenticated unsafe methods need
   X-CSRF-Token = HMAC(csrf key, sha256(session id)) (synchronizer token from GET /auth/session; readable only by
   allowed origins through CORS). Bearer credentials (ADMIN_API_TOKEN, dev tokens) are not cookies: no CSRF needed.
   Audit (append-only): AUTH_LOGIN (SUCCESS), AUTH_LOGIN_DENIED (DENIED/FAILED, reason code), AUTH_LOGOUT. */
const crypto = require('crypto');
const { createGoogleOidc, pkcePair, randomToken, safeEqual } = require('./google.oidc');
const { AuthTokenError } = require('./jwt');
const { parseCookies, serializeCookie, appendSetCookie, seal, unseal } = require('./cookies');
const { ANONYMOUS } = require('../iam/authorization');

const sha256hex = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const SESSION_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const TOUCH_EVERY_MS = 60 * 1000;

/** normalized e-mail hash used to match invitations (gmail: dots and +tag ignored, like Gmail itself) */
function emailHash(email) {
  let e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@'); if (at <= 0) return null;
  let local = e.slice(0, at), domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  e = `${local}@${domain}`;
  return sha256hex('plat-email-v1:' + e);
}
const externalIdOf = subject => 'google:' + sha256hex('plat-google-sub-v1:' + subject);

/** login failures: reason (log/audit only) + public outcome (FAILED → 400 LOGIN_FAILED, DENIED → 403 LOGIN_DENIED) */
const DENIED_REASONS = new Set(['EMAIL_NOT_VERIFIED', 'HOSTED_DOMAIN_NOT_ALLOWED', 'USER_NOT_ACTIVE']);
class LoginError extends Error { constructor(reason) { super(`login failed: ${reason}`); this.reason = reason; this.outcome = DENIED_REASONS.has(reason) ? 'DENIED' : 'FAILED'; } }

const principalInfo = new WeakMap(); // principal → { sessionHash, session } (never serialized)

function createAuthService({ config, sessions, identities, audit, http, logger, now = () => Date.now() }) {
  const oidc = config.oidc, S = oidc.session, enabled = !!oidc.enabled;
  const google = enabled ? createGoogleOidc({ oidc, http, now }) : null;
  const cookieBase = { secure: S.cookieSecure, httpOnly: true, sameSite: 'Lax' };
  const CALLBACK_PATH = '/api/v1/auth/google/callback';

  const sessionCookie = (value, maxAge) => serializeCookie(S.cookieName, value, { ...cookieBase, path: '/', domain: S.cookieDomain, maxAge });
  const loginCookie = (value, maxAge) => serializeCookie(S.loginCookieName, value, { ...cookieBase, path: CALLBACK_PATH, maxAge });
  const clearSession = res => appendSetCookie(res, sessionCookie('', 0));
  const csrfFor = sessionHash => crypto.createHmac('sha256', oidc.keys.csrf).update('csrf:' + sessionHash).digest('base64url');
  const cookiesOf = req => parseCookies(req.headers.cookie);

  /** returnTo must be an absolute http(s) URL on an allowed origin; anything else → AUTH_APP_URL (or null) */
  function safeReturnTo(raw) {
    if (typeof raw === 'string' && raw.length <= 2048) {
      try { const u = new URL(raw); if (/^https?:$/.test(u.protocol) && !u.username && !u.password && oidc.returnOrigins.includes(u.origin)) return u.toString(); } catch (_) { /* invalid */ }
    }
    return oidc.appUrl;
  }
  const withLoginFlag = (url, flag) => { const u = new URL(url); u.searchParams.set('login', flag); return u.toString(); };

  async function auditLogin(action, outcome, { userId = null, reason = null, organizationId = null, sessionId = null, requestId = null, extra = {} } = {}) {
    await audit.write({ actorId: userId, actorType: userId ? 'USER' : 'ANONYMOUS', action, entityType: 'auth_session', entityId: sessionId || '-', organizationId,
      outcome, requestId, newValue: { provider: 'google', ...(reason ? { reason } : {}), ...extra } });
  }

  // ------------------------------------------------------------------------------------------ /auth/google/start
  function start({ returnTo }) {
    const state = randomToken(), nonce = randomToken(), pk = pkcePair();
    const sealed = seal(oidc.keys.loginState, { s: state, n: nonce, v: pk.verifier, r: safeReturnTo(returnTo), exp: now() + S.loginTtlSeconds * 1000 });
    return { location: google.authorizationUrl({ state, nonce, codeChallenge: pk.challenge }), setCookie: loginCookie(sealed, S.loginTtlSeconds) };
  }

  // ------------------------------------------------------------------------------------------ /auth/google/callback
  /** → { ok, location|null, setCookies[], session?, reason?, outcome? } */
  async function callback(req, query, requestId) {
    const jar = cookiesOf(req), setCookies = [loginCookie('', 0)]; // the login cookie is single use
    const tx = unseal(oidc.keys.loginState, jar.get(S.loginCookieName), now());
    const back = tx && tx.r ? tx.r : oidc.appUrl;
    try {
      if (!tx) throw new LoginError('STATE_MISSING_OR_EXPIRED');
      const state = query.get('state'), code = query.get('code');
      if (!state || !safeEqual(state, tx.s)) throw new LoginError('STATE_MISMATCH');
      if (query.get('error')) throw new LoginError('PROVIDER_ERROR');
      if (!code || code.length > 2048) throw new LoginError('CODE_MISSING');
      let claims;
      try { claims = await google.verifyIdToken(await google.exchangeCode(code, tx.v), { nonce: tx.n, maxAgeSeconds: S.loginTtlSeconds }); }
      catch (e) { if (e instanceof AuthTokenError) throw new LoginError(e.reason); throw e; }
      if (!(await sessions.markNonceUsed(sha256hex('nonce:' + tx.n), new Date((claims.expiresAt + 3600) * 1000).getTime()))) throw new LoginError('NONCE_REPLAY');
      const at = now(), ext = externalIdOf(claims.subject), eh = emailHash(claims.email);
      let user = await identities.findUserByExternalId(ext);
      const invites = eh ? await identities.findPendingInvitations(eh, at) : [];
      let accepted = 0;
      if (invites.length && (!user || user.status === 'ACTIVE')) {
        const r = await identities.acceptInvitations({ userId: user ? user.id : null, externalIdentityId: ext, displayName: claims.givenName || 'Usuário', invitations: invites, at });
        accepted = r.accepted; user = await identities.findUser(r.userId);
      }
      if (user && user.status !== 'ACTIVE') throw Object.assign(new LoginError('USER_NOT_ACTIVE'), { userId: user.id });
      if (user) await identities.recordLogin(user.id, claims.givenName, at);
      // rotation: whatever session this browser had is revoked; a brand-new id is issued
      const prev = jar.get(S.cookieName);
      if (prev && SESSION_ID_RE.test(prev)) await sessions.revoke(sha256hex(prev), 'ROTATED', at);
      const sid = randomToken(), hash = sha256hex(sid), id = crypto.randomUUID();
      const absoluteExpiresAt = at + S.absoluteTimeoutSeconds * 1000, idleExpiresAt = Math.min(at + S.idleTimeoutSeconds * 1000, absoluteExpiresAt);
      await sessions.insert({ id, sessionHash: hash, userId: user ? user.id : null, subjectHash: sha256hex('plat-google-sub-v1:' + claims.subject), provider: 'google',
        displayName: user ? null : claims.givenName, createdAt: at, lastSeenAt: at, idleExpiresAt, absoluteExpiresAt });
      setCookies.push(sessionCookie(sid, S.absoluteTimeoutSeconds));
      const orgs = user ? (await identities.findAccess(user.id)).memberships.filter(m => m.status === 'ACTIVE').map(m => m.organizationId) : [];
      await auditLogin('AUTH_LOGIN', 'SUCCESS', { userId: user ? user.id : null, sessionId: id, organizationId: orgs.length === 1 ? orgs[0] : null, requestId,
        extra: { known: !!user, invitationsAccepted: accepted, organizations: orgs.length } });
      logger && logger.info('login', { requestId, errorCode: null, provider: 'google', known: !!user, invitationsAccepted: accepted });
      return { ok: true, location: back, setCookies, session: { id, expiresAt: absoluteExpiresAt, idleExpiresAt }, csrfToken: csrfFor(hash) };
    } catch (e) {
      if (!(e instanceof LoginError)) throw e;
      await auditLogin('AUTH_LOGIN_DENIED', e.outcome, { userId: e.userId || null, reason: e.reason, requestId });
      logger && logger.warn('login rejected', { requestId, errorCode: 'LOGIN_' + e.outcome, reasonCode: e.reason });
      return { ok: false, location: back ? withLoginFlag(back, e.outcome === 'DENIED' ? 'negado' : 'erro') : null, setCookies, reason: e.reason, outcome: e.outcome };
    }
  }

  // ------------------------------------------------------------------------------------------ per request
  /** cookie → PrincipalContext (USER) | ANONYMOUS (+ clearSessionCookie when the cookie is dead). Never throws 401:
      public reads keep working for a visitor with an expired session. */
  async function authenticate(req) {
    if (!enabled) return ANONYMOUS;
    const sid = cookiesOf(req).get(S.cookieName);
    if (!sid) return ANONYMOUS;
    const dead = () => Object.freeze({ ...ANONYMOUS, clearSessionCookie: true });
    if (!SESSION_ID_RE.test(sid)) return dead();
    const hash = sha256hex(sid), s = await sessions.findByHash(hash), t = now();
    if (!s || s.revokedAt || t >= s.idleExpiresAt || t >= s.absoluteExpiresAt) return dead();
    let p;
    if (s.userId) {
      const u = await identities.findUser(s.userId);
      if (!u || u.status !== 'ACTIVE') { await sessions.revoke(hash, 'USER_DISABLED', t); return dead(); }
      const access = await identities.findAccess(u.id);
      p = { type: 'USER', id: u.id, userId: u.id, displayName: u.displayName, status: 'ACTIVE', actorId: u.id, idempotencyPrincipal: `user:${u.id}`, ...access };
    } else {
      // signed in with Google, not invited: pseudonymous, no organization, no permission beyond the public ones
      p = { type: 'USER', id: 'google:' + s.subjectHash.slice(0, 16), userId: null, displayName: s.displayName || null, status: 'ACTIVE', actorId: null,
        idempotencyPrincipal: 'ext:' + s.subjectHash.slice(0, 24), memberships: [], assignments: [] };
    }
    if (t - s.lastSeenAt >= TOUCH_EVERY_MS) await sessions.touch(hash, { lastSeenAt: t, idleExpiresAt: Math.min(t + S.idleTimeoutSeconds * 1000, s.absoluteExpiresAt) });
    const principal = Object.freeze({ ...p, authenticationMethod: 'GOOGLE_OIDC', tokenExpiresAt: new Date(s.absoluteExpiresAt).toISOString(), viaSession: true });
    principalInfo.set(principal, { sessionHash: hash, session: { ...s, idleExpiresAt: Math.min(t + S.idleTimeoutSeconds * 1000, s.absoluteExpiresAt) } });
    return principal;
  }

  /** CSRF (synchronizer token, constant time) for a cookie-authenticated principal */
  function checkCsrf(req, principal) {
    const info = principalInfo.get(principal); if (!info) return false;
    const h = req.headers['x-csrf-token'];
    return typeof h === 'string' && safeEqual(h, csrfFor(info.sessionHash));
  }

  /** GET /auth/session payload */
  function sessionView(principal) {
    const info = principal && principalInfo.get(principal);
    return { enabled, provider: enabled ? 'google' : null, authenticated: !!info, csrfToken: info ? csrfFor(info.sessionHash) : null,
      expiresAt: info ? new Date(info.session.absoluteExpiresAt).toISOString() : null, idleExpiresAt: info ? new Date(info.session.idleExpiresAt).toISOString() : null,
      loginUrl: enabled ? '/api/v1/auth/google/start' : null };
  }

  /** POST /auth/logout: revoke + clear cookie + audit (idempotent: no session → just clears the cookie) */
  async function logout(principal, res, requestId) {
    const info = principal && principalInfo.get(principal);
    clearSession(res);
    if (!info) return false;
    await sessions.revoke(info.sessionHash, 'LOGOUT', now());
    await auditLogin('AUTH_LOGOUT', 'SUCCESS', { userId: principal.userId, sessionId: info.session.id, requestId });
    return true;
  }

  return { enabled, start, callback, authenticate, checkCsrf, sessionView, logout, clearSession, safeReturnTo, cookieNames: { session: S.cookieName, login: S.loginCookieName } };
}

module.exports = { createAuthService, emailHash, externalIdOf, LoginError };
