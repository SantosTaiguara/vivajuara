'use strict';
/* Write authentication (admin bearer token, ADMIN_API_TOKEN):
   - no token configured → every mutating/admin route answers 403 WRITES_DISABLED (reads stay public);
   - token configured → 401 without / with a wrong token (constant-time sha256 comparison), 200 with it, actor "admin";
   - WRITES_ENABLED=false is a kill switch; the token never appears in responses, logs or the config object. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('stream');
const { h, contract, TOKEN, DEV, client } = require('./support');
const { startServer } = require(h.BACKEND + '/src/app');
const { createLogger } = require(h.BACKEND + '/src/shared/logging/logger');
const { authorizeWrite } = require(h.BACKEND + '/src/shared/http/middleware');

let db, off, on, logText = '';
const ADMIN_ROUTES = [
  ['PATCH', '/lots/VJ-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 }],
  ['POST', `/developments/${DEV}/price-tables`, { version: '2026-11-01', pricePerM2: 1250 }],
  ['POST', `/developments/${DEV}/price-tables?dryRun=true`, { version: '2026-11-01', pricePerM2: 1250 }],
  ['POST', `/developments/${DEV}/analysis/preview`, {}]
];

test.before(async () => {
  db = await h.setupDatabase('admin_auth');
  off = await h.startTestServer(db.url, {}, { pool: db.pool });
  const config = h.testConfig(db.url, { ADMIN_API_TOKEN: TOKEN, LOG_LEVEL: 'debug' });
  const stream = new Writable({ write(chunk, _e, cb) { logText += chunk.toString(); cb(); } });
  const srv = await startServer({ config, pool: db.pool, logger: createLogger({ level: 'debug', stream }), App: h.sharedApp() });
  on = { ...srv, api: srv.url + '/api/v1', config };
});
test.after(async () => { if (off) await off.close(); if (on) await on.close(); if (db) await db.pool.end(); });

test('without ADMIN_API_TOKEN every admin route is disabled (403 WRITES_DISABLED), even with a bearer token; reads stay public', async () => {
  const req = client(off);
  for (const [m, p, b] of ADMIN_ROUTES) {
    const x = await req(m, p, b);
    contract.assertApiError(x.r, x.body, 403, 'WRITES_DISABLED');
  }
  const health = await (await fetch(off.url + '/health')).json();
  assert.equal(health.writesEnabled, false);
  for (const p of [`/developments/${DEV}/map-lots`, `/developments/${DEV}/availability`, '/lots/VJ-QB-L0079', `/developments/${DEV}/commercial/price-tables/current`]) assert.equal((await fetch(off.api + p)).status, 200, p);
  assert.equal(Number((await db.pool.query('SELECT count(*) AS n FROM price_tables')).rows[0].n), 1);
});

test('with ADMIN_API_TOKEN: missing, malformed or wrong credentials → 401 UNAUTHORIZED (WWW-Authenticate), checked before the body', async () => {
  const req = client(on);
  const variants = [{ token: null }, { token: 'wrong-token' }, { token: TOKEN + 'x' }, { token: TOKEN.slice(0, -1) }, { token: null, headers: { Authorization: `Basic ${TOKEN}` } }, { token: null, headers: { Authorization: `bearer ${TOKEN}` } }];
  for (const [m, p, b] of ADMIN_ROUTES) for (const o of variants) {
    const x = await req(m, p, b, o);
    contract.assertApiError(x.r, x.body, 401, 'UNAUTHORIZED');
    assert.match(x.r.headers.get('www-authenticate'), /^Bearer/);
  }
  // the guard runs before the body is parsed: an unauthenticated garbage body is still a 401, not a 400
  const x = await req('PATCH', '/lots/VJ-QA-L0001/availability', undefined, { token: 'nope', raw: '{garbage' });
  assert.equal(x.r.status, 401);
});

test('with the right token the write succeeds and the audit actor is "admin"; reads need no token', async () => {
  const req = client(on);
  const x = await req('PATCH', '/lots/VJ-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 });
  assert.equal(x.r.status, 200, x.text);
  const audit = (await db.pool.query("SELECT actor_id FROM audit_log WHERE action = 'AVAILABILITY_UPDATE'")).rows;
  assert.deepEqual(audit.map(a => a.actor_id), ['admin']);
  assert.equal((await fetch(on.api + `/developments/${DEV}/availability`)).status, 200);
  assert.equal((await (await fetch(on.url + '/health')).json()).writesEnabled, true);
});

test('the token is never echoed in responses or logs and is not kept in the config object', async () => {
  const req = client(on);
  const bad = await req('PATCH', '/lots/VJ-QA-L0001/availability', { status: 'SOLD', expectedRevision: 0 }, { token: TOKEN + 'zz' });
  assert.ok(!bad.text.includes(TOKEN));
  const ok = await req('POST', `/developments/${DEV}/price-tables?dryRun=true`, { version: '2026-11-01', pricePerM2: 1250 });
  assert.equal(ok.r.status, 200, ok.text.slice(0, 300));
  assert.ok(!ok.text.includes(TOKEN));
  assert.ok(logText.includes('"msg":"request"'), 'requests were logged');
  assert.ok(!logText.includes(TOKEN), 'token leaked into the log');
  assert.ok(!JSON.stringify(on.config).includes(TOKEN), 'raw token kept in config');
  assert.ok(!require('util').inspect(on.config, { depth: 10 }).includes(TOKEN));
});

test('kill switch and configuration rules', async () => {
  let c = h.testConfig(db.url, { ADMIN_API_TOKEN: TOKEN, WRITES_ENABLED: 'false' });
  assert.equal(c.writesEnabled, false);
  assert.throws(() => authorizeWrite({ headers: { authorization: `Bearer ${TOKEN}` } }, c), e => e.code === 'WRITES_DISABLED');
  c = h.testConfig(db.url, { ADMIN_API_TOKEN: TOKEN });
  assert.deepEqual(authorizeWrite({ headers: { authorization: `Bearer ${TOKEN}` } }, c), { actorId: 'admin', principal: 'admin' });
  assert.throws(() => authorizeWrite({ headers: { authorization: 'Bearer x' } }, c), e => e.code === 'UNAUTHORIZED'); // different length: no timingSafeEqual throw
  c = h.testConfig(db.url, { WRITES_ENABLED: 'true' }); // legacy flag without any credential: still disabled
  assert.equal(c.writesEnabled, false);
  const { loadConfig } = require(h.BACKEND + '/src/shared/config');
  const prod = env => loadConfig({ NODE_ENV: 'production', DATABASE_URL: db.url, CORS_ORIGINS: 'https://app.test', ...env }, { useDotEnv: false });
  assert.throws(() => prod({ ADMIN_API_TOKEN: 'short' }), /at least 32/);
  assert.throws(() => prod({ WRITES_ENABLED: 'true' }), /ADMIN_API_TOKEN/);
  assert.equal(prod({ ADMIN_API_TOKEN: TOKEN }).writesEnabled, true);
  assert.equal(prod({}).writesEnabled, false);
});

test('.env.example documents ADMIN_API_TOKEN as an empty placeholder only', () => {
  const env = require('fs').readFileSync(h.BACKEND + '/.env.example', 'utf8');
  assert.match(env, /^ADMIN_API_TOKEN=$/m);
});
