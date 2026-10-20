'use strict';
/* Error contract (ApiError), input validation (path, query, body, headers), malicious input,
   Retry-After on 429/503, partial failure (analysis unavailable) and output (DTO) validation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');
const c = require('./contract');
const { ERROR_CATALOG } = require(path.join(h.BACKEND, 'src/shared/http/errors'));

const DEV = 'viva-juara';
let db, srv;
const req = (p, init) => fetch(srv.api + p, init);
async function expectError(p, status, code, init) {
  const r = await req(p, init);
  const body = await r.json();
  c.assertApiError(r, body, status, code);
  return body;
}

test.before(async () => {
  db = await h.setupDatabase('apierrors');
  srv = await h.startTestServer(db.url, {}, { pool: db.pool });
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('every error code used by the server is in the catalog with its status', async () => {
  for (const [code, e] of Object.entries(ERROR_CATALOG)) {
    const statuses = [].concat(e.status);
    assert.ok(statuses.every(s => s >= 400 && s <= 599), code);
    assert.ok(e.description, code);
  }
  // spec §54 codes exist
  for (const code of ['LOT_NOT_FOUND', 'INVALID_FILTER', 'INVALID_AVAILABILITY_TRANSITION', 'REVISION_CONFLICT', 'PRICE_TABLE_NOT_FOUND', 'DEVELOPMENT_NOT_FOUND', 'VALIDATION_ERROR', 'INTERNAL_ERROR']) assert.ok(ERROR_CATALOG[code], code);
});

test('path params: malformed ids → 400 VALIDATION_ERROR; unknown → semantic 404', async () => {
  let body = await expectError('/lots/not-a-lot', 400, 'VALIDATION_ERROR');
  assert.deepEqual([body.details[0].field, body.details[0].reason], ['lotId', 'format']);
  await expectError('/developments/Viva_Juara!/lots', 400, 'VALIDATION_ERROR');
  await expectError(`/developments/${DEV}/price-tables/${encodeURIComponent('../../etc/passwd')}`, 400, 'VALIDATION_ERROR');
  await expectError('/lots/VJ-QZ-L9999', 404, 'LOT_NOT_FOUND');
  await expectError('/developments/nao-existe/manifest', 404, 'DEVELOPMENT_NOT_FOUND');
  await expectError('/developments/nao-existe/lots', 404, 'DEVELOPMENT_NOT_FOUND');
  await expectError('/nada-aqui', 404, 'NOT_FOUND');
});

test('query params: unknown → 400 VALIDATION_ERROR, malformed → 400 INVALID_FILTER, semantic → 422 INVALID_FILTER', async () => {
  const L = `/developments/${DEV}/lots`;
  let b = await expectError(`${L}?colour=red`, 400, 'VALIDATION_ERROR');
  assert.equal(b.details[0].field, 'colour');
  b = await expectError(`${L}?status=FOR_SALE`, 422, 'INVALID_FILTER');
  assert.deepEqual([b.details[0].field, b.details[0].reason], ['status', 'invalid_enum']);
  assert.ok(b.details[0].allowed.includes('AVAILABLE'));
  b = await expectError(`${L}?minPrice=400000&maxPrice=300000`, 422, 'INVALID_FILTER');
  assert.deepEqual([b.details[0].field, b.details[0].reason], ['minPrice', 'range_inverted']);
  await expectError(`${L}?minArea=600&maxArea=200`, 422, 'INVALID_FILTER');
  b = await expectError(`${L}?minArea=abc`, 400, 'INVALID_FILTER');
  assert.equal(b.details[0].reason, 'invalid_type');
  await expectError(`${L}?minPrice=1e309`, 400, 'INVALID_FILTER');
  await expectError(`${L}?minPrice=99999999999999999999`, 422, 'INVALID_FILTER');
  await expectError(`${L}?corner=yes`, 400, 'INVALID_FILTER');
  await expectError(`${L}?class=a_plus`, 422, 'INVALID_FILTER');
  await expectError(`${L}?status=UNKNOWN&status=SOLD`, 400, 'INVALID_FILTER');
  await expectError(`${L}?status=`, 400, 'INVALID_FILTER');
  await expectError(`${L}?sortBy=l.id`, 422, 'INVALID_FILTER');
  await expectError(`${L}?sortBy=${encodeURIComponent('price; DROP TABLE lots')}`, 422, 'INVALID_FILTER');
  await expectError(`${L}?sortDirection=up`, 422, 'INVALID_FILTER');
  await expectError(`${L}?block=${encodeURIComponent("A' OR '1'='1")}`, 400, 'INVALID_FILTER');
  await expectError(`${L}?minHousingScore=101`, 422, 'INVALID_FILTER');
  await expectError(`/developments/${DEV}/map-lots?page=2`, 400, 'VALIDATION_ERROR'); // the map is never paginated
});

test('malicious search text is data, not code: parameterized and parsed in JS only', async () => {
  for (const q of ["' OR 1=1; DROP TABLE lots; --", '<script>alert(1)</script>', '%00', '\u0000', '😀😀', 'B79\'--']) {
    const r = await req(`/developments/${DEV}/lots/search?q=${encodeURIComponent(q)}`);
    const body = await r.json();
    assert.equal(r.status, 200, `${q}: ${JSON.stringify(body)}`);
    assert.equal(body.meta.kind, 'none');
  }
  await expectError(`/developments/${DEV}/lots/search?q=${'x'.repeat(65)}`, 400, 'INVALID_FILTER');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM lots')).rows[0].n, 498);
});

test('body validation (batch-summary): type, size, media type, mass assignment, prototype keys', async () => {
  const P = '/lots/batch-summary';
  const send = (body, ct = 'application/json') => ({ method: 'POST', headers: { 'Content-Type': ct }, body });
  await expectError(P, 400, 'VALIDATION_ERROR', send('{not json'));
  await expectError(P, 400, 'VALIDATION_ERROR', send(''));
  await expectError(P, 400, 'VALIDATION_ERROR', send('[]'));
  await expectError(P, 400, 'VALIDATION_ERROR', send(JSON.stringify({ ids: 'VJ-QB-L0079' })));
  await expectError(P, 400, 'VALIDATION_ERROR', send(JSON.stringify({ ids: [] })));
  let b = await expectError(P, 400, 'VALIDATION_ERROR', send(JSON.stringify({ ids: ["VJ-QB-L0079' OR 1=1 --", 42] })));
  assert.deepEqual(b.details[0].indexes, [0, 1]);
  b = await expectError(P, 400, 'VALIDATION_ERROR', send(JSON.stringify({ ids: ['VJ-QB-L0079'], admin: true })));
  assert.equal(b.details[0].reason, 'unknown_field');
  await expectError(P, 400, 'VALIDATION_ERROR', send('{"ids":["VJ-QB-L0079"],"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
  await expectError(P, 415, 'UNSUPPORTED_MEDIA_TYPE', send(JSON.stringify({ ids: ['VJ-QB-L0079'] }), 'text/plain'));
  await expectError(P, 413, 'PAYLOAD_TOO_LARGE', send(JSON.stringify({ ids: Array(2000).fill('VJ-QB-L0079') })));
  await expectError(P, 405, 'METHOD_NOT_ALLOWED', { method: 'DELETE' });
});

test('X-Request-Id: propagated when well formed, regenerated when malicious', async () => {
  let r = await req('/lots/VJ-QZ-L9999', { headers: { 'X-Request-Id': 'client-req-000123' } });
  assert.equal(r.headers.get('x-request-id'), 'client-req-000123');
  assert.equal((await r.json()).requestId, 'client-req-000123');
  r = await req('/lots/VJ-QZ-L9999', { headers: { 'X-Request-Id': 'x"><script>' } });
  assert.match(r.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  const ok = await req(`/developments/${DEV}/manifest`, { headers: { 'X-Request-Id': 'client-req-000124' } });
  assert.equal((await ok.json()).meta.requestId, 'client-req-000124');
});

test('503 answers carry Retry-After (timeout and database down); 429 too', async () => {
  const slow = await h.startTestServer(db.url, { REQUEST_TIMEOUT_MS: '1', RETRY_AFTER_SECONDS: '7' }, { pool: db.pool });
  try {
    const r = await fetch(`${slow.url}/api/v1/developments/${DEV}/lots/static`);
    c.assertApiError(r, await r.json(), 503, 'REQUEST_TIMEOUT');
    assert.equal(r.headers.get('retry-after'), '7');
  } finally { await slow.close(); }
  const down = await h.startTestServer('postgres://nobody@127.0.0.1:1/none', { DB_CONNECT_TIMEOUT_MS: '500' });
  try {
    const r = await fetch(`${down.url}/api/v1/developments/${DEV}/manifest`);
    c.assertApiError(r, await r.json(), 503, 'DATABASE_UNAVAILABLE');
    assert.equal(r.headers.get('retry-after'), '5');
    const ready = await fetch(`${down.url}/health/ready`);
    assert.equal(ready.status, 503); assert.equal(ready.headers.get('retry-after'), '5');
  } finally { await down.close(); }
  const limited = await h.startTestServer(db.url, { RATE_LIMIT_MAX: '1' }, { pool: db.pool });
  try {
    await fetch(`${limited.url}/api/v1/developments`);
    const r = await fetch(`${limited.url}/api/v1/developments`);
    c.assertApiError(r, await r.json(), 429, 'RATE_LIMITED');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally { await limited.close(); }
});

test('partial failure: without a published analysis the map/list/detail still answer (class UNKNOWN, null scores)', async () => {
  const { rows } = await db.pool.query('SELECT current_analysis_version_id AS id FROM developments WHERE id = $1', [DEV]);
  await db.pool.query('UPDATE developments SET current_analysis_version_id = NULL WHERE id = $1', [DEV]);
  try {
    const map = await (await req(`/developments/${DEV}/map-lots`)).json();
    c.assertSchema(map, 'MapLotsResponse');
    assert.equal(map.count, 498);
    assert.ok(map.lots.every(l => l.class === 'UNKNOWN' && l.overallScore === null && l.thematicValues.scores.housing === null && l.price != null));
    assert.ok(map.lots.every(l => l.availabilityStatus === 'UNKNOWN'));
    const list = await (await req(`/developments/${DEV}/lots?pageSize=5`)).json();
    c.assertSchema(list, 'LotListResponse');
    assert.deepEqual(list.meta.unavailableLayers, ['analysis']);
    assert.ok(list.data.every(d => d.class === 'UNKNOWN' && d.scores.overall === null && d.criteria.quiet === null));
    const detail = await (await req('/lots/VJ-QB-L0079')).json();
    c.assertSchema(detail, 'LotDetailResponse');
    assert.equal(detail.data.intelligence.class, 'UNKNOWN');
    assert.equal(detail.data.commercial.price != null, true);
    await expectError('/lots/VJ-QB-L0079/analysis', 404, 'ANALYSIS_NOT_FOUND');
    await expectError(`/developments/${DEV}/analysis/current`, 404, 'ANALYSIS_NOT_FOUND');
    const m = await (await req(`/developments/${DEV}/manifest`)).json();
    assert.equal(m.data.analysisVersion, null);
  } finally {
    await db.pool.query('UPDATE developments SET current_analysis_version_id = $2 WHERE id = $1', [DEV, rows[0].id]);
  }
});

test('output validation: a DTO that breaks the contract becomes 500 INTERNAL_ERROR (no leak, no partial body)', async () => {
  // corrupt one stored class in a throwaway copy of the analysis row; the server must refuse to emit it
  const { rows } = await db.pool.query("SELECT class FROM lot_analysis WHERE lot_id = 'VJ-QB-L0079'");
  await db.pool.query("UPDATE lot_analysis SET class = 'Z' WHERE lot_id = 'VJ-QB-L0079'");
  try {
    const body = await expectError('/lots/VJ-QB-L0079/summary', 500, 'INTERNAL_ERROR');
    assert.equal(body.details, null);
    assert.ok(!JSON.stringify(body).includes('class'));
  } finally {
    await db.pool.query("UPDATE lot_analysis SET class = $1 WHERE lot_id = 'VJ-QB-L0079'", [rows[0].class]);
  }
  assert.equal((await req('/lots/VJ-QB-L0079/summary')).status, 200);
});
