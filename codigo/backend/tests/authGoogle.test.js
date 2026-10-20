'use strict';
/* W3 login: Google OIDC (Authorization Code + PKCE) + server-side cookie session + CSRF + principal mapping into the IAM
   tables (organization org_house7). DB-FREE: memory SessionStore/IdentityStore/AuditSink, a pool that only answers the
   two organization reads of GET /me, and a FAKE GOOGLE (locally generated RSA key, JWKS, token endpoint, authorize step).
   Nothing here talks to Google or to Postgres. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

const { loadConfig } = require('../src/shared/config');
const { createApp } = require('../src/app');
const { createAppContext } = require('../src/shared/domain/sharedDomain');
const { createLogger } = require('../src/shared/logging/logger');
const repo = require('../src/modules/auth/auth.repository');
const { emailHash } = require('../src/modules/auth/auth.service');
const authAdmin = require('../src/modules/auth/auth.admin');
const jwt = require('../src/modules/auth/jwt');
const { parseCookies, seal, unseal } = require('../src/modules/auth/cookies');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const App = createAppContext({ srcDir: SRC });
const CLIENT_ID = '1234567890-fakeclient.apps.googleusercontent.com';
const CLIENT_SECRET = 'fake-client-secret-for-tests-only';
const SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';
const ADMIN = 'test-admin-token-0123456789abcdef0123456789';
const APP_URL = 'https://painel.example.test/';
const LOT = 'VJ-QB-L0079';

// ------------------------------------------------------------------------------------------ fake Google
function fakeGoogle({ now }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'fake-kid-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const calls = { jwks: 0, token: 0 };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  function sign(claims, { key = privateKey, header = {} } = {}) {
    const h = b64({ alg: 'RS256', typ: 'JWT', kid, ...header }), p = b64(claims);
    const sig = header.alg && header.alg !== 'RS256' ? 'x' : crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url');
    return `${h}.${p}.${sig}`;
  }
  /** the user consents on "accounts.google.com": returns the code Google would append to the redirect */
  function authorize(location, { email = 'visitante@gmail.com', sub = '110000000000000000001', claims = {}, signWith } = {}) {
    const u = new URL(location), q = u.searchParams;
    const code = '4/' + crypto.randomBytes(16).toString('base64url');
    const t = Math.floor(now() / 1000);
    codes.set(code, { challenge: q.get('code_challenge'), method: q.get('code_challenge_method'), redirect: q.get('redirect_uri'), clientId: q.get('client_id'), signWith,
      claims: { iss: 'https://accounts.google.com', azp: CLIENT_ID, aud: CLIENT_ID, sub, email, email_verified: true, given_name: 'Ana', name: 'Ana Teste', iat: t, exp: t + 3600, nonce: q.get('nonce'), ...claims } });
    return { code, state: q.get('state'), nonce: q.get('nonce') };
  }
  const httpClient = {
    async getJson(url) { calls.jwks++; assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs'); return { status: 200, json: { keys: [jwk] }, headers: { 'cache-control': 'public, max-age=3600' } }; },
    async postForm(url, f) {
      calls.token++;
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      const c = codes.get(f.code); codes.delete(f.code); // single use, like Google
      if (!c || f.grant_type !== 'authorization_code' || f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET || f.redirect_uri !== c.redirect) return { status: 400, json: { error: 'invalid_grant' } };
      const challenge = crypto.createHash('sha256').update(f.code_verifier || '').digest('base64url');
      if (c.method !== 'S256' || challenge !== c.challenge) return { status: 400, json: { error: 'invalid_grant', error_description: 'PKCE' } };
      return { status: 200, json: { access_token: 'ya29.fake-access', id_token: sign(c.claims, c.signWith ? { key: c.signWith } : {}), token_type: 'Bearer', expires_in: 3599 } };
    }
  };
  return { httpClient, authorize, sign, calls, kid, otherKey: other.privateKey, jwk };
}

// ------------------------------------------------------------------------------------------ app under test
function fakePool() {
  const audit = [];
  const pool = {
    audit,
    async query(sql, params = []) {
      if (/FROM organizations WHERE id = \$1/.test(sql)) return { rows: params[0] === 'org_house7' ? [{ id: 'org_house7', slug: 'house-7', display_name: 'House 7 Imóveis', status: 'ACTIVE', default_locale: 'pt-BR', default_timezone: 'America/Sao_Paulo', currency: 'BRL' }] : [] };
      if (/FROM developments WHERE organization_id = \$1/.test(sql)) return { rows: params[0] === 'org_house7' ? [{ id: 'viva-juara', slug: 'viva-juara', name: 'Viva Juara', visibility: 'PUBLIC' }] : [] };
      if (/INSERT INTO audit_log/.test(sql)) { audit.push(params); return { rows: [], rowCount: 1 }; }
      const e = new Error('connect ECONNREFUSED (no database in this test)'); e.code = 'ECONNREFUSED'; throw e;
    },
    on() {}, end: async () => {}, connect: async () => { const e = new Error('no db'); e.code = 'ECONNREFUSED'; throw e; }
  };
  return pool;
}

async function withAuthApp(fn, { env = {}, clock = { t: Date.UTC(2026, 9, 16, 12, 0, 0) } } = {}) {
  const now = () => clock.t;
  const google = fakeGoogle({ now });
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused@127.0.0.1:1/none', HOST: '127.0.0.1', PORT: '0', RATE_LIMIT_MAX: '100000', SHARED_SRC_DIR: SRC,
    CORS_ORIGINS: 'https://painel.example.test', ADMIN_API_TOKEN: ADMIN, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    AUTH_REDIRECT_URL: 'https://api.example.test/api/v1/auth/google/callback', SESSION_SECRET, AUTH_APP_URL: APP_URL, ...env }, { useDotEnv: false });
  const lines = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } });
  const sessions = repo.createMemorySessionStore(), identities = repo.createMemoryIdentityStore(), audit = repo.createMemoryAuditSink(), pool = fakePool();
  const app = createApp({ config, pool, logger: createLogger({ level: 'debug', stream }), App, authDeps: { http: google.httpClient, sessions, identities, audit, now } });
  const server = http.createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  /** browser-ish client: own cookie jar (honours Max-Age=0), never follows redirects */
  function browser() {
    const jar = new Map();
    async function req(method, p, { headers = {}, body } = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const c of setCookies) { const [pair] = c.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i), v = pair.slice(i + 1); if (/Max-Age=0/.test(c) || v === '') jar.delete(k); else jar.set(k, v); }
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
      return { r, status: r.status, json, text, setCookies, location: r.headers.get('location') };
    }
    /** full login: start → fake Google consent → callback. opts.authorize = options for the fake consent */
    async function login(o = {}) {
      const s = await req('GET', '/api/v1/auth/google/start' + (o.returnTo ? '?returnTo=' + encodeURIComponent(o.returnTo) : ''));
      assert.equal(s.status, 302, s.text);
      const g = google.authorize(s.location, o.authorize || {});
      const state = o.state || g.state;
      const cb = await req('GET', `/api/v1/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(g.code)}&scope=openid%20email%20profile&authuser=0&prompt=consent`);
      return { start: s, consent: g, callback: cb };
    }
    const csrf = async () => (await req('GET', '/api/v1/auth/session')).json.data.csrfToken;
    return { req, login, csrf, jar };
  }
  try { await fn({ base, browser, google, sessions, identities, audit, pool, clock, config, lines: () => lines.join(''), app }); }
  finally { await app.close(); await new Promise(r => server.close(r)); server.closeAllConnections && server.closeAllConnections(); }
}
const reasons = audit => audit.events.filter(e => e.action === 'AUTH_LOGIN_DENIED').map(e => e.newValue.reason);
const attrs = c => c.split(';').map(s => s.trim());

// ------------------------------------------------------------------------------------------ configuration
test('config: login disabled by default; enabled with GOOGLE_CLIENT_ID only when complete (fail closed); secrets never serialized', () => {
  const base = { DATABASE_URL: 'postgres://u@h/d' };
  assert.equal(loadConfig(base, { useDotEnv: false }).oidc.enabled, false);
  assert.throws(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT_ID }, { useDotEnv: false }), /GOOGLE_CLIENT_SECRET.*AUTH_REDIRECT_URL.*SESSION_SECRET/);
  const full = { ...base, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, AUTH_REDIRECT_URL: 'https://api.example.test/api/v1/auth/google/callback', SESSION_SECRET };
  const prod = { ...full, NODE_ENV: 'production' };
  const c = loadConfig(prod, { useDotEnv: false });
  assert.equal(c.oidc.enabled, true);
  assert.equal(c.oidc.session.cookieName, '__Host-plat_session');
  const dump = JSON.stringify(c);
  assert.ok(!dump.includes(CLIENT_SECRET) && !dump.includes(SESSION_SECRET), 'secrets are not enumerable');
  assert.equal(c.oidc.clientSecret, CLIENT_SECRET);
  // fail closed in production
  assert.throws(() => loadConfig({ ...prod, GOOGLE_CLIENT_SECRET: '' }, { useDotEnv: false }), /GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...prod, GOOGLE_CLIENT_SECRET: '<cole aqui>' }, { useDotEnv: false }), /GOOGLE_CLIENT_SECRET/, 'placeholder = missing');
  assert.throws(() => loadConfig({ ...prod, SESSION_SECRET: 'short' }, { useDotEnv: false }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...prod, AUTH_REDIRECT_URL: 'http://api.example.test/cb' }, { useDotEnv: false }), /https/);
  assert.throws(() => loadConfig({ ...prod, AUTH_COOKIE_SECURE: 'false' }, { useDotEnv: false }), /AUTH_COOKIE_SECURE/);
  assert.throws(() => loadConfig({ ...prod, GOOGLE_CLIENT_ID: 'not-a-google-client-id' }, { useDotEnv: false }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => loadConfig({ ...base, AUTH_GOOGLE_ENABLED: 'true' }, { useDotEnv: false }), /GOOGLE_CLIENT_ID/, 'explicitly enabled without values');
  // dev tokens are still refused in production, with or without Google
  assert.throws(() => loadConfig({ ...prod, AUTH_DEV_TOKENS: 'true' }, { useDotEnv: false }), /AUTH_DEV_TOKENS/);
  // the fake-IdP endpoint overrides are ignored in production
  assert.equal(loadConfig({ ...prod, GOOGLE_TOKEN_ENDPOINT: 'https://evil.example/token' }, { useDotEnv: false }).oidc.tokenEndpoint, 'https://oauth2.googleapis.com/token');
  // COOKIE_DOMAIN → no __Host- prefix; ALLOWED_HD normalized
  const d = loadConfig({ ...full, COOKIE_DOMAIN: '.house7.example', ALLOWED_HD: 'House7.example, outra.example' }, { useDotEnv: false });
  assert.equal(d.oidc.session.cookieName, 'plat_session'); assert.deepEqual([...d.oidc.allowedHd], ['house7.example', 'outra.example']);
});

test('jwt: only RS256 with a known kid and a valid signature; alg none/HS256 refused; unknown kid refetch is rate limited', async () => {
  let t = 1_000_000;
  const g = fakeGoogle({ now: () => t });
  const jwks = jwt.createJwksClient({ http: g.httpClient, uri: 'https://www.googleapis.com/oauth2/v3/certs', now: () => t });
  const claims = { sub: '1', iss: 'https://accounts.google.com' };
  assert.deepEqual(await jwt.verifyRs256(g.sign(claims), k => jwks.resolveKey(k)), claims);
  const reason = async tok => { try { await jwt.verifyRs256(tok, k => jwks.resolveKey(k)); return 'ACCEPTED'; } catch (e) { return e.reason; } };
  assert.equal(await reason(g.sign(claims, { header: { alg: 'none' } })), 'ALG_NOT_ALLOWED');
  assert.equal(await reason(g.sign(claims, { header: { alg: 'HS256' } })), 'ALG_NOT_ALLOWED');
  assert.equal(await reason(g.sign(claims, { key: g.otherKey })), 'BAD_SIGNATURE');
  const tampered = g.sign(claims).split('.'); tampered[1] = Buffer.from(JSON.stringify({ ...claims, sub: '2' })).toString('base64url');
  assert.equal(await reason(tampered.join('.')), 'BAD_SIGNATURE');
  assert.equal(await reason('a.b'), 'MALFORMED');
  t += 61000; // past the minimum refetch interval
  const before = g.calls.jwks;
  assert.equal(await reason(g.sign(claims, { header: { kid: 'rotated-1' } })), 'KID_UNKNOWN');
  assert.equal(await reason(g.sign(claims, { header: { kid: 'rotated-2' } })), 'KID_UNKNOWN');
  assert.equal(g.calls.jwks - before, 1, 'unknown kids refetch the JWKS at most once per minute');
  assert.equal(jwt.maxAgeOf('public, max-age=999999'), 24 * 3600);
});

test('cookies: sealed login state is confidential, authenticated and expires', () => {
  const k = crypto.randomBytes(32), s = seal(k, { s: 'state', v: 'verifier', exp: 2000 });
  assert.ok(!s.includes('verifier') && !Buffer.from(s.slice(3), 'base64url').toString('latin1').includes('verifier'));
  assert.equal(unseal(k, s, 1000).v, 'verifier');
  assert.equal(unseal(k, s, 2000), null, 'expired');
  assert.equal(unseal(crypto.randomBytes(32), s, 1000), null, 'other key');
  assert.equal(unseal(k, s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + 'A', 1000), null, 'tampered');
  assert.deepEqual([...parseCookies('a=1; b="2"; a=3; bad; =x')], [['a', '1'], ['b', '2']]);
});

test('e-mail hash: normalized (case, gmail dots and +tag); never the raw address', () => {
  assert.equal(emailHash('Corretora.Teste+painel@GMAIL.com'), emailHash('corretorateste@gmail.com'));
  assert.equal(emailHash('ana@googlemail.com'), emailHash('ana@gmail.com'));
  assert.notEqual(emailHash('a.b@house7.example'), emailHash('ab@house7.example'), 'dots matter outside gmail');
  assert.match(emailHash('ana@gmail.com'), /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------------------------------------------ flow
test('happy path: start → Google (PKCE S256, state, nonce) → callback → session cookie; unknown account = authenticated with NO organization permission', async () => {
  await withAuthApp(async ({ browser, google, audit, lines, sessions }) => {
    const b = browser();
    const { start, callback } = await b.login({ returnTo: 'https://painel.example.test/#viva-juara.lots.B79' });
    const u = new URL(start.location);
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const q = u.searchParams;
    assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('client_id'), CLIENT_ID); assert.equal(q.get('scope'), 'openid email profile');
    assert.equal(q.get('redirect_uri'), 'https://api.example.test/api/v1/auth/google/callback'); assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('state'), /^[A-Za-z0-9_-]{43}$/); assert.match(q.get('nonce'), /^[A-Za-z0-9_-]{43}$/); assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!q.has('client_secret'));
    const lc = attrs(start.setCookies[0]);
    assert.ok(lc[0].startsWith('plat_oauth=v1.'));
    for (const a of ['Path=/api/v1/auth/google/callback', 'Max-Age=600', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(lc.includes(a), a);
    assert.equal(start.r.headers.get('cache-control'), 'no-store');
    // callback
    assert.equal(callback.status, 302); assert.equal(callback.location, 'https://painel.example.test/#viva-juara.lots.B79');
    const sc = callback.setCookies.map(attrs).find(a => a[0].startsWith('__Host-plat_session='));
    assert.ok(sc, 'session cookie set');
    for (const a of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=43200']) assert.ok(sc.includes(a), a);
    assert.ok(!sc.some(a => a.startsWith('Domain=')), '__Host- cookie has no Domain');
    assert.ok(callback.setCookies.some(c => c.startsWith('plat_oauth=;') && /Max-Age=0/.test(c)), 'login cookie consumed');
    const sid = b.jar.get('__Host-plat_session');
    assert.match(sid, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(![...sessions.sessions.keys()].includes(sid), 'only the hash is stored');
    // /me: authenticated, Google, no organization, only the public permissions (deny by default)
    const me = await b.req('GET', '/api/v1/me');
    assert.equal(me.status, 200, me.text);
    const d = me.json.data;
    assert.equal(d.authenticated, true); assert.equal(d.principal.type, 'USER'); assert.equal(d.principal.authenticationMethod, 'GOOGLE_OIDC');
    assert.equal(d.principal.displayName, 'Ana');
    assert.equal(d.organizationId, null); assert.deepEqual(d.roles, []); assert.deepEqual(d.memberships, []);
    assert.deepEqual(d.permissions, d.publicPermissions, 'no organization permission');
    assert.deepEqual(d.identityProvider, { status: 'CONFIGURED', mode: 'GOOGLE_OIDC' });
    assert.ok(d.session.expiresAt);
    assert.match(me.r.headers.get('cache-control'), /no-store/);
    // audit + no PII / secrets in audit or logs
    const ev = audit.events.find(e => e.action === 'AUTH_LOGIN');
    assert.equal(ev.outcome, 'SUCCESS'); assert.equal(ev.newValue.known, false); assert.equal(ev.actorId, null);
    const all = JSON.stringify(audit.events) + lines();
    for (const secret of ['visitante@gmail.com', CLIENT_SECRET, sid, 'ya29.', 'eyJ', '110000000000000000001', '4/']) assert.ok(!all.includes(secret), `leaked ${secret}`);
    assert.equal(google.calls.token, 1);
  });
});

test('bad state: mismatch, missing or expired login cookie → no session, back to the panel with ?login=erro (audited)', async () => {
  const clock = { t: Date.UTC(2026, 9, 16, 12, 0, 0) };
  await withAuthApp(async ({ browser, audit, google }) => {
    const b = browser();
    const { callback } = await b.login({ state: 'A'.repeat(43) });
    assert.equal(callback.status, 302); assert.equal(callback.location, APP_URL + '?login=erro');
    assert.ok(!b.jar.has('__Host-plat_session'));
    // no login cookie at all (e.g. callback opened in another browser)
    const c2 = await browser().req('GET', '/api/v1/auth/google/callback?state=x&code=y');
    assert.equal(c2.location, APP_URL + '?login=erro');
    // expired login cookie (> 10 min between start and callback)
    const b3 = browser(); const s = await b3.req('GET', '/api/v1/auth/google/start'); const g = google.authorize(s.location);
    clock.t += 601 * 1000;
    const c3 = await b3.req('GET', `/api/v1/auth/google/callback?state=${g.state}&code=${encodeURIComponent(g.code)}`);
    assert.equal(c3.location, APP_URL + '?login=erro');
    // provider error (user cancelled on the consent screen)
    const b4 = browser(); const s4 = await b4.req('GET', '/api/v1/auth/google/start'); const st = new URL(s4.location).searchParams.get('state');
    const c4 = await b4.req('GET', `/api/v1/auth/google/callback?state=${st}&error=access_denied`);
    assert.equal(c4.location, APP_URL + '?login=erro');
    assert.deepEqual(reasons(audit), ['STATE_MISMATCH', 'STATE_MISSING_OR_EXPIRED', 'STATE_MISSING_OR_EXPIRED', 'PROVIDER_ERROR']);
    assert.ok(audit.events.every(e => e.action !== 'AUTH_LOGIN'));
  }, { clock });
});

test('nonce replay: the same login transaction cannot be used twice (one-time nonce), even with a fresh code', async () => {
  await withAuthApp(async ({ browser, google, audit, base }) => {
    const b = browser();
    const s = await b.req('GET', '/api/v1/auth/google/start');
    const loginCookie = b.jar.get('plat_oauth');
    const g1 = google.authorize(s.location);
    const ok = await b.req('GET', `/api/v1/auth/google/callback?state=${g1.state}&code=${encodeURIComponent(g1.code)}`);
    assert.equal(ok.location, APP_URL);
    // attacker replays the captured login cookie + a new code for an ID token carrying the same nonce
    const g2 = google.authorize(s.location);
    const r = await fetch(`${base}/api/v1/auth/google/callback?state=${g2.state}&code=${encodeURIComponent(g2.code)}`, { redirect: 'manual', headers: { Cookie: `plat_oauth=${loginCookie}` } });
    assert.equal(r.headers.get('location'), APP_URL + '?login=erro');
    assert.ok(!(r.headers.getSetCookie() || []).some(c => c.startsWith('__Host-plat_session=') && !/Max-Age=0/.test(c)));
    assert.deepEqual(reasons(audit), ['NONCE_REPLAY']);
    // the code itself is single use too (Google refuses it): CODE_EXCHANGE_FAILED
    const b2 = browser(); const s2 = await b2.req('GET', '/api/v1/auth/google/start'); const g3 = google.authorize(s2.location);
    await b2.req('GET', `/api/v1/auth/google/callback?state=${g3.state}&code=${encodeURIComponent(g3.code)}`);
    const b3 = browser(); await b3.req('GET', '/api/v1/auth/google/start');
    const again = await b3.req('GET', `/api/v1/auth/google/callback?state=${new URL((await b3.req('GET', '/api/v1/auth/google/start')).location).searchParams.get('state')}&code=${encodeURIComponent(g3.code)}`);
    assert.equal(again.location, APP_URL + '?login=erro');
    assert.equal(reasons(audit).pop(), 'CODE_EXCHANGE_FAILED');
  });
});

test('ID token checks: wrong aud / iss / signature, expired, unverified e-mail, nonce mismatch → refused with the right reason', async () => {
  await withAuthApp(async ({ browser, audit, google }) => {
    const t = Math.floor(Date.UTC(2026, 9, 16, 12, 0, 0) / 1000);
    const cases = [
      [{ claims: { aud: 'other-client.apps.googleusercontent.com' } }, 'AUDIENCE_INVALID', 'erro'],
      [{ claims: { aud: [CLIENT_ID, 'other'], azp: 'other' } }, 'AUDIENCE_INVALID', 'erro'],
      [{ claims: { iss: 'https://evil.example.com' } }, 'ISSUER_INVALID', 'erro'],
      [{ claims: { exp: t - 120, iat: t - 3720 } }, 'TOKEN_EXPIRED', 'erro'],
      [{ claims: { iat: t + 600 } }, 'TOKEN_NOT_YET_VALID', 'erro'],
      [{ claims: { nonce: 'not-the-nonce' } }, 'NONCE_MISMATCH', 'erro'],
      [{ signWith: google.otherKey }, 'BAD_SIGNATURE', 'erro'],
      [{ claims: { email_verified: false } }, 'EMAIL_NOT_VERIFIED', 'negado'],
      [{ claims: { email: undefined } }, 'EMAIL_MISSING', 'erro']
    ];
    for (const [authorize, reason, flag] of cases) {
      const b = browser();
      const { callback } = await b.login({ authorize });
      assert.equal(callback.location, `${APP_URL}?login=${flag}`, reason);
      assert.ok(!b.jar.has('__Host-plat_session'), reason);
      assert.equal(reasons(audit).pop(), reason);
    }
    // the iss form without https:// is valid (Google documents both)
    const ok = await browser().login({ authorize: { claims: { iss: 'accounts.google.com' } } });
    assert.equal(ok.callback.location, APP_URL);
  });
});

test('hosted domain allow-list (ALLOWED_HD): hd claim must match; gmail.com accounts without hd are refused', async () => {
  await withAuthApp(async ({ browser, audit }) => {
    const s = await browser().req('GET', '/api/v1/auth/google/start');
    assert.equal(new URL(s.location).searchParams.get('hd'), 'house7.example', 'single domain → hd hint');
    const gmail = await browser().login({ authorize: { email: 'ana@gmail.com' } });
    assert.equal(gmail.callback.location, APP_URL + '?login=negado');
    const other = await browser().login({ authorize: { email: 'ana@outra.example', claims: { hd: 'outra.example' } } });
    assert.equal(other.callback.location, APP_URL + '?login=negado');
    // the e-mail domain is not the check: only the signed hd claim counts
    const spoof = await browser().login({ authorize: { email: 'ana@house7.example' } });
    assert.equal(spoof.callback.location, APP_URL + '?login=negado');
    const ok = await browser().login({ authorize: { email: 'ana@house7.example', claims: { hd: 'House7.example' } } });
    assert.equal(ok.callback.location, APP_URL);
    assert.deepEqual(reasons(audit), ['HOSTED_DOMAIN_NOT_ALLOWED', 'HOSTED_DOMAIN_NOT_ALLOWED', 'HOSTED_DOMAIN_NOT_ALLOWED']);
  }, { env: { ALLOWED_HD: 'house7.example' } });
});

test('returnTo: only allowed origins (AUTH_APP_URL / CORS_ORIGINS); anything else falls back to AUTH_APP_URL (no open redirect)', async () => {
  await withAuthApp(async ({ browser }) => {
    for (const evil of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)', 'https://painel.example.test.evil.example/', 'https://user:pw@painel.example.test/']) {
      const { callback } = await browser().login({ returnTo: evil });
      assert.equal(callback.location, APP_URL, evil);
    }
    const s = await browser().req('GET', '/api/v1/auth/google/start?returnTo=x&foo=1');
    assert.equal(s.status, 400, 'unknown query parameters are refused');
  });
});

test('callback without any return URL answers JSON (session + csrf) and LOGIN_FAILED / LOGIN_DENIED as ApiError', async () => {
  await withAuthApp(async ({ browser }) => {
    const ok = await browser().login();
    assert.equal(ok.callback.status, 200); assert.equal(ok.callback.json.data.authenticated, true); assert.match(ok.callback.json.data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const bad = await browser().login({ state: 'B'.repeat(43) });
    assert.equal(bad.callback.status, 400); assert.equal(bad.callback.json.code, 'LOGIN_FAILED');
    assert.ok(!/STATE/.test(bad.callback.text), 'the precise reason stays server-side');
    const denied = await browser().login({ authorize: { claims: { email_verified: false } } });
    assert.equal(denied.callback.status, 403); assert.equal(denied.callback.json.code, 'LOGIN_DENIED');
  }, { env: { AUTH_APP_URL: '', CORS_ORIGINS: '' } });
});

// ------------------------------------------------------------------------------------------ principal mapping (org_house7)
test('invited e-mail → membership + role in org_house7 at login (no auto-provisioning; accepted once)', async () => {
  await withAuthApp(async ({ browser, identities, audit }) => {
    const inv = await authAdmin.invite(identities, { email: 'Corretora.Teste@gmail.com', organizationId: 'org_house7', role: 'BROKER', ttlDays: 14, now: Date.UTC(2026, 9, 16) });
    assert.equal(inv.roleCode, 'BROKER');
    assert.ok(!JSON.stringify([...identities.invitations.values()]).includes('orretora'), 'only the e-mail hash is stored');
    const b = browser();
    await b.login({ authorize: { email: 'corretorateste@gmail.com', sub: '220000000000000000002', claims: { given_name: 'Carla' } } });
    const d = (await b.req('GET', '/api/v1/me')).json.data;
    assert.equal(d.organizationId, 'org_house7'); assert.equal(d.tenantResolvedBy, 'SINGLE_MEMBERSHIP');
    assert.deepEqual(d.roles, ['BROKER']); assert.equal(d.principal.displayName, 'Carla');
    for (const k of ['share.create', 'customer_profile.manage', 'lot.compare']) assert.ok(d.permissions.includes(k), k);
    for (const k of ['price_table.publish', 'availability.write', 'admin.audit.view']) assert.ok(!d.permissions.includes(k), k);
    assert.equal(d.organization.developments[0].id, 'viva-juara');
    assert.equal([...identities.invitations.values()][0].status, 'ACCEPTED');
    // second login: same user, no duplicate assignment
    await browser().login({ authorize: { email: 'corretorateste@gmail.com', sub: '220000000000000000002' } });
    assert.equal(identities.users.size, 1); assert.equal(identities.assignments.length, 1);
    const ev = audit.events.filter(e => e.action === 'AUTH_LOGIN');
    assert.equal(ev[0].organizationId, 'org_house7'); assert.equal(ev[0].newValue.invitationsAccepted, 1); assert.equal(ev[1].newValue.invitationsAccepted, 0);
    // another Google account with the same first name is NOT that user
    const other = browser(); await other.login({ authorize: { email: 'outra@gmail.com', sub: '330000000000000000003', claims: { given_name: 'Carla' } } });
    assert.deepEqual((await other.req('GET', '/api/v1/me')).json.data.roles, []);
    // validation of the admin command
    await assert.rejects(authAdmin.invite(identities, { email: 'x@gmail.com', organizationId: 'org_house7', role: 'SUPERUSER' }), /role desconhecida/);
    await assert.rejects(authAdmin.invite(identities, { email: 'not-an-email', organizationId: 'org_house7', role: 'BROKER' }), /e-mail inválido/);
    await assert.rejects(authAdmin.invite(identities, { email: 'x@gmail.com', organizationId: 'house7', role: 'BROKER' }), /organização inválida/);
  });
});

test('permissions are enforced by the backend: unknown account → 403 on a write; invited INVENTORY_MANAGER passes CSRF + permission', async () => {
  await withAuthApp(async ({ browser, identities, pool }) => {
    const anon = browser(); await anon.login();
    const w = await anon.req('PATCH', `/api/v1/lots/${LOT}/availability`, { headers: { 'X-CSRF-Token': await anon.csrf() }, body: { status: 'RESERVED', expectedRevision: 0 } });
    assert.equal(w.status, 403); assert.equal(w.json.code, 'PERMISSION_DENIED');
    await authAdmin.invite(identities, { email: 'estoque@gmail.com', organizationId: 'org_house7', role: 'INVENTORY_MANAGER' });
    const inv = browser(); await inv.login({ authorize: { email: 'estoque@gmail.com', sub: '440000000000000000004' } });
    const noCsrf = await inv.req('PATCH', `/api/v1/lots/${LOT}/availability`, { body: { status: 'RESERVED', expectedRevision: 0 } });
    assert.equal(noCsrf.status, 403); assert.equal(noCsrf.json.code, 'CSRF_TOKEN_INVALID');
    const wrong = await inv.req('PATCH', `/api/v1/lots/${LOT}/availability`, { headers: { 'X-CSRF-Token': await anon.csrf() }, body: { status: 'RESERVED', expectedRevision: 0 } });
    assert.equal(wrong.json.code, 'CSRF_TOKEN_INVALID', 'another session\'s token is not valid');
    const ok = await inv.req('PATCH', `/api/v1/lots/${LOT}/availability`, { headers: { 'X-CSRF-Token': await inv.csrf() }, body: { status: 'RESERVED', expectedRevision: 0 } });
    assert.equal(ok.status, 503, 'authenticated + CSRF + permission passed; then the (absent) database answers'); assert.equal(ok.json.code, 'DATABASE_UNAVAILABLE');
    // a public read sent as POST with the cookie but without CSRF runs as anonymous instead of failing
    const batch = await inv.req('POST', '/api/v1/lots/batch-summary', { body: { ids: [LOT] } });
    assert.notEqual(batch.json && batch.json.code, 'CSRF_TOKEN_INVALID');
  });
});

test('bearer credentials keep working (no CSRF needed) and win over the cookie', async () => {
  await withAuthApp(async ({ browser }) => {
    const b = browser(); await b.login();
    const me = await b.req('GET', '/api/v1/me', { headers: { Authorization: `Bearer ${ADMIN}` } });
    assert.equal(me.json.data.principal.type, 'SYSTEM');
    const w = await b.req('PATCH', `/api/v1/lots/${LOT}/availability`, { headers: { Authorization: `Bearer ${ADMIN}` }, body: { status: 'RESERVED', expectedRevision: 0 } });
    assert.notEqual(w.json.code, 'CSRF_TOKEN_INVALID'); assert.equal(w.status, 503);
    const bad = await b.req('GET', '/api/v1/me', { headers: { Authorization: 'Bearer wrong-token' } });
    assert.equal(bad.status, 401, 'an invalid bearer is never silently replaced by the cookie');
  });
});

test('logout: CSRF required; revokes the server session, clears the cookie, audited; old cookie is dead', async () => {
  await withAuthApp(async ({ browser, audit, base }) => {
    const b = browser(); await b.login();
    const sid = b.jar.get('__Host-plat_session');
    const noCsrf = await b.req('POST', '/api/v1/auth/logout');
    assert.equal(noCsrf.status, 403); assert.equal(noCsrf.json.code, 'CSRF_TOKEN_INVALID');
    const out = await b.req('POST', '/api/v1/auth/logout', { headers: { 'X-CSRF-Token': await b.csrf() } });
    assert.equal(out.status, 200); assert.equal(out.json.data.revoked, true);
    assert.ok(out.setCookies.some(c => c.startsWith('__Host-plat_session=;') && /Max-Age=0/.test(c)));
    assert.ok(!b.jar.has('__Host-plat_session'));
    // replaying the old cookie: anonymous + cookie cleared again
    const r = await fetch(base + '/api/v1/me', { headers: { Cookie: `__Host-plat_session=${sid}` } });
    assert.equal((await r.json()).data.authenticated, false);
    assert.ok((r.headers.getSetCookie() || []).some(c => /Max-Age=0/.test(c)));
    assert.equal(audit.events.filter(e => e.action === 'AUTH_LOGOUT').length, 1);
    // logout without a session is idempotent
    const again = await browser().req('POST', '/api/v1/auth/logout');
    assert.equal(again.status, 200); assert.equal(again.json.data.revoked, false);
  });
});

test('session timeouts: idle (sliding) and absolute; rotation on login; suspended user loses the session', async () => {
  const clock = { t: Date.UTC(2026, 9, 16, 8, 0, 0) };
  await withAuthApp(async ({ browser, identities, sessions }) => {
    const authed = async b => (await b.req('GET', '/api/v1/me')).json.data.authenticated;
    const b = browser(); await b.login();
    const s = await b.req('GET', '/api/v1/auth/session');
    assert.equal(s.json.data.authenticated, true); assert.equal(s.json.data.provider, 'google');
    assert.equal(Date.parse(s.json.data.idleExpiresAt) - clock.t, 3600 * 1000, 'idle = AUTH_SESSION_IDLE_SECONDS');
    // sliding idle: activity every 50 min keeps it alive…
    for (let i = 0; i < 4; i++) { clock.t += 50 * 60 * 1000; assert.equal(await authed(b), true, `active ${i}`); }
    // …but the absolute timeout (4 h) ends it anyway
    clock.t += 50 * 60 * 1000; assert.equal(await authed(b), false, 'absolute timeout');
    assert.ok(!b.jar.has('__Host-plat_session'), 'dead cookie cleared');
    // idle timeout
    const b2 = browser(); await b2.login();
    clock.t += 3601 * 1000; assert.equal(await authed(b2), false, 'idle timeout');
    // rotation: a new login from the same browser revokes the previous session
    const b3 = browser(); await b3.login(); const first = b3.jar.get('__Host-plat_session');
    await b3.login(); const second = b3.jar.get('__Host-plat_session');
    assert.notEqual(first, second);
    const rotated = [...sessions.sessions.values()].filter(x => x.revokedReason === 'ROTATED');
    assert.equal(rotated.length, 1);
    // suspended user: next request is anonymous, and logging in again is denied
    await authAdmin.invite(identities, { email: 'gerente@gmail.com', organizationId: 'org_house7', role: 'COMMERCIAL_MANAGER' });
    const b4 = browser(); await b4.login({ authorize: { email: 'gerente@gmail.com', sub: '550000000000000000005' } });
    assert.equal(await authed(b4), true);
    identities.setUserStatus([...identities.users.values()].find(u => u.displayName === 'Ana').id, 'SUSPENDED');
    assert.equal(await authed(b4), false);
    const again = await browser().login({ authorize: { email: 'gerente@gmail.com', sub: '550000000000000000005' } });
    assert.equal(again.callback.location, APP_URL + '?login=negado');
  }, { clock, env: { AUTH_SESSION_IDLE_SECONDS: '3600', AUTH_SESSION_ABSOLUTE_SECONDS: '14400' } });
});

test('CORS with credentials for allowed origins only; preflight accepts X-CSRF-Token; Vary includes Cookie', async () => {
  await withAuthApp(async ({ base }) => {
    const ok = await fetch(base + '/api/v1/auth/session', { headers: { Origin: 'https://painel.example.test' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://painel.example.test');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.match(ok.headers.get('vary'), /Cookie/);
    const evil = await fetch(base + '/api/v1/auth/session', { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null); assert.equal(evil.headers.get('access-control-allow-credentials'), null);
    const pre = await fetch(base + '/api/v1/auth/logout', { method: 'OPTIONS', headers: { Origin: 'https://painel.example.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-token' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /X-CSRF-Token/);
  });
});

test('login not configured: start/callback → 503 AUTH_NOT_CONFIGURED; session says disabled; /me unchanged for visitors', async () => {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused@127.0.0.1:1/none', SHARED_SRC_DIR: SRC, RATE_LIMIT_MAX: '100000' }, { useDotEnv: false });
  const app = createApp({ config, pool: fakePool(), logger: createLogger({ level: 'silent' }), App });
  const server = http.createServer(app.handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of ['/api/v1/auth/google/start', '/api/v1/auth/google/callback?code=x&state=y']) {
      const r = await fetch(base + p, { redirect: 'manual' }); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'AUTH_NOT_CONFIGURED');
    }
    const s = await (await fetch(base + '/api/v1/auth/session')).json();
    assert.deepEqual(s.data, { enabled: false, provider: null, authenticated: false, csrfToken: null, expiresAt: null, idleExpiresAt: null, loginUrl: null });
    const me = await fetch(base + '/api/v1/me', { headers: { Cookie: '__Host-plat_session=' + 'a'.repeat(43) } });
    const d = (await me.json()).data;
    assert.equal(d.authenticated, false); assert.deepEqual(d.identityProvider, { status: 'NOT_CONFIGURED', mode: 'NONE' });
    assert.equal(me.headers.get('set-cookie'), null, 'cookie ignored when login is off');
  } finally { await app.close(); await new Promise(r => server.close(r)); }
});

test('migration 010 (sessions, nonces, invitations) has a down script that drops exactly what it creates; no e-mail column', () => {
  const fs = require('fs');
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '010_auth_sessions.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '010_auth_sessions.down.sql'), 'utf8');
  const created = [...up.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1]).sort();
  assert.deepEqual(created, ['auth_sessions', 'auth_used_nonces', 'organization_invitations']);
  assert.deepEqual([...down.matchAll(/DROP TABLE IF EXISTS (\w+)/g)].map(m => m[1]).sort(), created);
  assert.ok(!/\bemail\s+TEXT|\bemail\b\s+(TEXT|VARCHAR|CITEXT)/i.test(up), 'only email_hash');
  assert.match(up, /email_hash\s+TEXT NOT NULL CHECK \(email_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});
