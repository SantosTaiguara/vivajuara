'use strict';
/* HTTP routes of the Google login (W3). All public at the permission level (they establish or end the identity) and
   never cached (Cache-Control: no-store):
     GET  /api/v1/auth/google/start?returnTo=<url>  → 302 to Google (+ sealed login cookie)
     GET  /api/v1/auth/google/callback?code&state   → 302 back to the panel (+ session cookie) — or JSON without AUTH_APP_URL
     GET  /api/v1/auth/session                      → { authenticated, csrfToken, expiresAt, idleExpiresAt, loginUrl }
     POST /api/v1/auth/logout                       → revokes the session (X-CSRF-Token required with a session cookie)
   Login disabled (no GOOGLE_CLIENT_ID) → start/callback answer 503 AUTH_NOT_CONFIGURED; session/logout still answer. */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');
const { E, AppError } = require('../../shared/http/errors');
const { appendSetCookie } = require('./cookies');

const notConfigured = () => E.unavailable('AUTH_NOT_CONFIGURED', 'Login com Google não configurado neste ambiente');

function registerAuthRoutes(router, { auth }) {
  router.get('/api/v1/auth/google/start', async ({ query, requestId, res }) => {
    v.queryAllowlist(query, ['returnTo']);
    if (!auth.enabled) throw notConfigured();
    const r = auth.start({ returnTo: query.get('returnTo') });
    appendSetCookie(res, r.setCookie);
    return { status: 302, headers: { Location: r.location }, body: envelope(requestId, { data: { location: r.location }, meta: {} }), cache: CACHE.NONE, schema: 'AuthRedirectResponse' };
  }, { public: true, auth: true });

  router.get('/api/v1/auth/google/callback', async ({ query, requestId, req, res }) => {
    if ([...query.keys()].length > 20) throw E.badRequest('Parâmetros de consulta demais');
    if (!auth.enabled) throw notConfigured();
    const r = await auth.callback(req, query, requestId);
    for (const c of r.setCookies) appendSetCookie(res, c);
    if (r.location) return { status: 302, headers: { Location: r.location }, body: envelope(requestId, { data: { location: r.location }, meta: {} }), cache: CACHE.NONE, schema: 'AuthRedirectResponse' };
    if (!r.ok) throw r.outcome === 'DENIED' ? new AppError(403, 'LOGIN_DENIED', 'Esta conta Google não pode entrar neste painel') : new AppError(400, 'LOGIN_FAILED', 'Não foi possível concluir o login com o Google. Tente de novo.');
    const data = { enabled: true, provider: 'google', authenticated: true, csrfToken: r.csrfToken, expiresAt: new Date(r.session.expiresAt).toISOString(),
      idleExpiresAt: new Date(r.session.idleExpiresAt).toISOString(), loginUrl: '/api/v1/auth/google/start' };
    return { status: 200, body: envelope(requestId, { data, meta: {} }), cache: CACHE.NONE, schema: 'AuthSessionResponse' };
  }, { public: true, auth: true, rateLimited: true });

  router.get('/api/v1/auth/session', async ({ query, requestId, principal }) => {
    v.queryAllowlist(query, []);
    return { status: 200, body: envelope(requestId, { data: auth.sessionView(principal), meta: {} }), cache: CACHE.NONE, schema: 'AuthSessionResponse' };
  }, { public: true, auth: true });

  router.post('/api/v1/auth/logout', async ({ query, requestId, principal, res }) => {
    v.queryAllowlist(query, []);
    const revoked = await auth.logout(principal, res, requestId);
    return { status: 200, body: envelope(requestId, { data: { revoked }, meta: {} }), cache: CACHE.NONE, schema: 'AuthLogoutResponse' };
  }, { public: true, auth: true, csrf: true });
}

module.exports = { registerAuthRoutes };
