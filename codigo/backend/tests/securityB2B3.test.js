'use strict';
/* Patches B2 (per-category rate limits) and B3 (central log redaction, no stack in production) — topic 50.
   DB-free: the policy limiter and the logger are pure; the HTTP checks run createApp with a pool that always fails. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { Writable } = require('stream');

const RL = require('../src/shared/http/rateLimitPolicies');
const { createLogger, redact, redactText } = require('../src/shared/logging/logger');
const { loadConfig } = require('../src/shared/config');
const { createApp } = require('../src/app');
const { createAppContext } = require('../src/shared/domain/sharedDomain');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const capture = () => { const lines = []; const stream = new Writable({ write(c, _e, cb) { lines.push(...String(c).trim().split('\n').map(l => JSON.parse(l))); cb(); } }); return { lines, stream }; };

// ------------------------------------------------------------------ B2: policies and classification
test('B2: policies load from config/security/rateLimits.json (global.ip excluded) and fall back to the embedded copy', () => {
  const p = RL.loadPolicies();
  assert.equal(p.source, 'file');
  assert.ok(!p.has('global.ip'), 'global.ip stays the RATE_LIMIT_MAX limiter');
  for (const id of ['auth.login', 'auth.passwordReset', 'share.validate', 'share.validate.token', 'search', 'analysis.expensive', 'export.bulk', 'admin.write', 'upload']) assert.ok(p.has(id), id);
  assert.equal(p.get('auth.login').maxRequests, 5);
  const fb = RL.loadPolicies('/nonexistent/rateLimits.json');
  assert.equal(fb.source, 'embedded'); assert.equal(fb.get('admin.write').maxRequests, 30);
});

test('B2: classifyRoute maps route templates (never raw paths) to categories', () => {
  const c = RL.classifyRoute;
  assert.deepEqual(c('GET', '/api/v1/developments'), [], 'public reads: global per-IP limit only');
  assert.deepEqual(c('GET', '/api/v1/developments/:developmentId/lots/search'), ['search']);
  assert.deepEqual(c('POST', '/api/v1/developments/:developmentId/analysis/preview', { admin: true }), ['analysis.expensive', 'admin.write']);
  assert.deepEqual(c('PATCH', '/api/v1/lots/:lotId/availability', { write: true }), ['admin.write']);
  assert.deepEqual(c('POST', '/api/v1/auth/login'), ['auth.login']);
  assert.deepEqual(c('POST', '/api/v1/auth/password-reset'), ['auth.passwordReset']);
  assert.deepEqual(c('GET', '/api/v1/shares/:token'), ['share.validate', 'share.validate.token']);
  assert.deepEqual(c('POST', '/api/v1/shares/exchange'), ['share.validate', 'share.validate.token']);
  assert.deepEqual(c('POST', '/api/v1/developments/:developmentId/exports'), ['export.bulk']);
  assert.deepEqual(c('POST', '/api/v1/developments/:developmentId/assets', { write: true }), ['upload', 'admin.write']);
  assert.deepEqual(c('GET', '/api/v1/developments/:developmentId/assets'), [], 'reading assets is not an upload');
});

test('B2: fixed window per key, burst, window reset, separate keys, hashed keys, bounded memory', () => {
  let t = 1_000_000; const now = () => t;
  const lim = RL.createPolicyLimiter({ now, maxKeys: 5 });
  try {
    for (let i = 0; i < 5; i++) assert.ok(lim.check(['auth.login'], { ip: '203.0.113.7' }).ok, `login ${i + 1}`);
    const r = lim.check(['auth.login'], { ip: '203.0.113.7' });
    assert.equal(r.ok, false); assert.equal(r.policyId, 'auth.login'); assert.ok(r.retryAfter >= 1 && r.retryAfter <= 60);
    assert.ok(lim.check(['auth.login'], { ip: '198.51.100.1' }).ok, 'another IP has its own bucket');
    t += 60_000; assert.ok(lim.check(['auth.login'], { ip: '203.0.113.7' }).ok, 'new window');
    // search: 60 + burst 20
    let ok = 0; for (let i = 0; i < 100; i++) if (lim.check(['search'], { ip: '192.0.2.9' }).ok) ok++;
    assert.equal(ok, 80);
    // share token: keyed by prefix only (raw token never stored); policy skipped when no token
    assert.ok(lim.check(['share.validate.token'], { ip: '192.0.2.10' }).ok);
    assert.ok(lim.size() <= 5, 'bounded map');
    const key = RL.keyOf(lim.policies.get('auth.login'), { ip: '203.0.113.7' });
    assert.ok(!key.includes('203.0.113.7')); assert.match(key, /^auth\.login\|[A-Za-z0-9_-]{22}$/);
    assert.equal(RL.keyOf(lim.policies.get('share.validate.token'), {}), null);
  } finally { lim.stop(); }
});

test('B2: user-keyed policies run after authentication (phase post), ip-keyed before (phase pre)', () => {
  const lim = RL.createPolicyLimiter();
  try {
    const ids = ['analysis.expensive', 'admin.write'];
    for (let i = 0; i < 50; i++) assert.ok(lim.check(ids, { ip: '1.2.3.4', endpoint: 'POST /x' }, 'pre').ok, 'no user-keyed policy in pre');
    let blocked = null;
    for (let i = 0; i < 11 && !blocked; i++) { const r = lim.check(ids, { ip: '1.2.3.4', user: 'admin', endpoint: 'POST /x' }, 'post'); if (!r.ok) blocked = r; }
    assert.equal(blocked.policyId, 'analysis.expensive');
    assert.ok(lim.check(ids, { ip: '1.2.3.4', user: 'other-user', endpoint: 'POST /x' }, 'post').ok, 'per user');
  } finally { lim.stop(); }
});

// ------------------------------------------------------------------ B3: logger redaction
test('B3: logger redacts credentials, tokens, PII keys and values; keeps ids; never mutates the caller', () => {
  const { lines, stream } = capture();
  const log = createLogger({ level: 'debug', stream, production: false });
  const fields = {
    requestId: 'c0ffee00-1234-4321-8888-123456789abc', route: 'GET /api/v1/lots/:lotId', statusCode: 200,
    authorization: 'Bearer abc.def.ghi', headers: { cookie: 'sid=1', 'x-api-key': 'k', accept: 'json' }, shareToken: 'x'.repeat(43),
    cpf: '123.456.789-09', email: 'ana@example.com', phone: '(11) 98765-4321', notes: 'cliente quer lote de esquina', customerName: 'Ana',
    userId: 'u_123', detail: 'connect postgres://app:' + 'hunter2pw' + '@db/x failed for ana@example.com cpf 123.456.789-09 tel +55 11 98765-4321 via /s/AbCdEfGhIjKlMnOpQrStUv and ?token=abc123&x=1 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'
  };
  const before = JSON.stringify(fields);
  log.error('falha para ana@example.com', fields);
  assert.equal(JSON.stringify(fields), before, 'caller object untouched');
  const e = lines[0], s = JSON.stringify(e);
  for (const leak of ['abc.def.ghi', 'sid=1', 'hunter2pw', 'ana@example.com', '123.456.789-09', '98765-4321', 'AbCdEfGhIjKlMnOpQrStUv', 'abc123', 'eyJhbGciOiJIUzI1NiJ9', 'esquina', 'Ana"', 'x'.repeat(43)]) assert.ok(!s.includes(leak), `leaked ${leak}`);
  for (const k of ['authorization', 'shareToken', 'cpf', 'email', 'phone', 'notes', 'customerName']) assert.ok(!(k in e), k);
  assert.deepEqual(e.headers, { accept: 'json' });
  assert.equal(e.userId, '[mascarado]');
  assert.equal(e.requestId, fields.requestId); assert.equal(e.route, fields.route); assert.equal(e.statusCode, 200);
  assert.match(e.detail, /postgres:\/\/\[redacted\]@/); assert.match(e.detail, /\[email\]/); assert.match(e.detail, /\[cpf\]/); assert.match(e.detail, /\[phone\]/); assert.match(e.detail, /\/s\/\[token\]/);
  assert.equal(e.msg, 'falha para [email]');
  assert.equal(redactText('VJ-QB-L0079 R$ 1.196/m² 2026-10-06'), 'VJ-QB-L0079 R$ 1.196/m² 2026-10-06', 'lot ids, prices and dates are not PII');
});

test('B3: stack trimmed outside production, dropped in production; bounded depth/arrays/strings', () => {
  const err = new Error('boom ana@example.com');
  const dev = redact({ stack: err.stack }, { production: false });
  assert.ok(dev.stack.split('\n').length <= 9); assert.ok(!dev.stack.includes('ana@example.com'));
  assert.deepEqual(redact({ stack: err.stack, errorCode: 'X' }, { production: true }), { errorCode: 'X' });
  const { lines, stream } = capture();
  createLogger({ stream, production: true }).error('unhandled error', { stack: err.stack, detail: 'x'.repeat(1000), deep: { a: { b: { c: { d: { e: 1 } } } } }, list: Array.from({ length: 50 }, (_, i) => i) });
  assert.ok(!('stack' in lines[0])); assert.ok(lines[0].detail.length <= 301); assert.equal(lines[0].list.length, 20);
  assert.equal(lines[0].deep.a.b.c, '[profundidade]');
});

// ------------------------------------------------------------------ app wiring (no database: every pool query fails)
async function withApp(env, fn) {
  const config = loadConfig({ DATABASE_URL: 'postgres://unused@127.0.0.1:1/none', HOST: '127.0.0.1', PORT: '0', RATE_LIMIT_MAX: '100000', CORS_ORIGINS: 'http://allowed.test', SHARED_SRC_DIR: SRC, ...env }, { useDotEnv: false });
  const pool = { query: async () => { throw new Error('connect ECONNREFUSED for ana@example.com postgres://app:' + 'hunter2pw' + '@db/x'); }, on() {}, end: async () => {}, connect: async () => { throw new Error('no db'); } };
  const { lines, stream } = capture();
  const app = createApp({ config, pool, logger: createLogger({ level: 'debug', stream, production: config.isProduction }), App: createAppContext({ srcDir: SRC }) });
  const server = http.createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, lines); } finally { await app.close(); await new Promise(r => server.close(r)); server.closeAllConnections && server.closeAllConnections(); }
}

test('app: /health/live is minimal; X-Correlation-Id and a valid traceparent are honoured; search hits 429 after 60+20', async () => {
  await withApp({ NODE_ENV: 'development', RATE_LIMIT_POLICIES: 'true' }, async (base, lines) => {
    const live = await fetch(base + '/health/live'); assert.equal(live.status, 200); assert.deepEqual(await live.json(), { status: 'ok' });
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const r = await fetch(base + '/health', { headers: { traceparent: tp, 'x-correlation-id': 'cor_test_1234' } });
    assert.equal(r.headers.get('x-correlation-id'), 'cor_test_1234');
    const req = lines.find(l => l.msg === 'request' && l.correlationId === 'cor_test_1234');
    assert.equal(req.traceId, '0af7651916cd43dd8448eb211c80319c');
    const bad = await fetch(base + '/health', { headers: { 'x-correlation-id': '<script>' } });
    assert.match(bad.headers.get('x-correlation-id'), /^cor_[0-9a-f]{16}$/);
    const statuses = [];
    for (let i = 0; i < 81; i++) statuses.push((await fetch(base + '/api/v1/developments/viva-juara/lots/search?q=a')).status);
    assert.ok(statuses.slice(0, 80).every(s => s !== 429), 'first 80 not rate limited');
    assert.equal(statuses[80], 429);
    const last = lines.filter(l => l.msg === 'request').pop();
    assert.equal(last.rateLimitPolicy, 'search');
  });
});

test('app (production): 500 log has no stack and the driver message is redacted', async () => {
  await withApp({ NODE_ENV: 'production' }, async (base, lines) => {
    const r = await fetch(base + '/api/v1/developments');
    assert.equal(r.status, 500);
    const body = await r.text(); assert.ok(!body.includes('hunter2pw') && !body.includes('ana@example.com'));
    const errLine = lines.find(l => l.msg === 'unhandled error');
    assert.ok(errLine, 'the 500 path logged'); { assert.ok(!('stack' in errLine)); assert.ok(!JSON.stringify(errLine).includes('hunter2pw')); assert.ok(!JSON.stringify(errLine).includes('ana@example.com')); }
    assert.ok(!JSON.stringify(lines).includes('hunter2pw'), 'no credential anywhere in the log');
  });
});
