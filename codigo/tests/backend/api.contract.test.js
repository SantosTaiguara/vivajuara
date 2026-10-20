'use strict';
/* Contract tests for every /api/v1 endpoint (+ /health): shapes, versioning, cache headers,
   ETag revalidation, standard errors, CORS, rate limit and invalid input. */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const DEV = 'viva-juara';
let db, srv, App, json;
const get = (p, headers = {}) => fetch(srv.url + p, { headers });
const getJson = async (p, headers) => { const r = await get(p, headers); return { r, body: await r.json() }; };

test.before(async () => {
  db = await h.setupDatabase('contract');
  assert.equal(db.importReport.status, 'OK');
  srv = await h.startTestServer(db.url, {}, { pool: db.pool });
  App = h.sharedApp();
  json = await h.jsonLots();
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

function assertError(body, code) {
  // ApiError (contract 1.1): v1.0 keys { code, message, details, traceId } kept + requestId and timestamp
  assert.deepEqual(Object.keys(body).filter(k => k !== 'currentRevision').sort(), ['code', 'details', 'message', 'requestId', 'timestamp', 'traceId']);
  assert.equal(body.code, code);
  assert.ok(body.traceId && typeof body.traceId === 'string');
  assert.equal(body.requestId, body.traceId);
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)) && body.timestamp.endsWith('Z'));
  assert.ok(!/at .+\.js:\d+/.test(JSON.stringify(body)), 'no stack trace in error body');
}

test('GET /health is public, not cached and carries request id + security headers', async () => {
  const { r, body } = await getJson('/health');
  assert.equal(r.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(r.headers.get('x-request-id'));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const ready = await getJson('/health/ready');
  assert.equal(ready.r.status, 200);
  assert.equal(ready.body.database, 'up');
  assert.equal(ready.body.schemaVersion, h.migrator.listMigrations().pop().version);
});

test('GET /developments/{id}/config mirrors the frontend DevelopmentConfig', async () => {
  const { r, body } = await getJson(`/api/v1/developments/${DEV}/config`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
  const dev = App.config.DEVELOPMENTS.find(d => d.id === DEV);
  for (const k of Object.keys(dev)) {
    if (k === 'dataSource') continue; // runtime switch of the frontend, not served by the API
    if (k === 'sources') { // config sources first (same order), then the system sources registered by the backend
      assert.equal(h.stableStringify(body.sources.slice(0, dev.sources.length)), h.stableStringify(dev.sources));
      assert.deepEqual(body.sources.slice(dev.sources.length).map(s => s.id), ['lots.json', 'availability-api']);
      continue;
    }
    assert.equal(h.stableStringify(body[k]), h.stableStringify(dev[k]), `config.${k}`);
  }
  assert.deepEqual(body.versions, { staticVersion: dev.staticDataVersion, analysisVersion: dev.analysisVersion, priceTableId: dev.currentPriceTableId, priceTableVersion: dev.priceTables[0].version, availabilityRevision: 0 });
  const etag = r.headers.get('etag');
  assert.ok(etag);
  assert.equal((await get(`/api/v1/developments/${DEV}/config`, { 'If-None-Match': etag })).status, 304);
});

const SNAPSHOTS = [
  ['static', 'lots/static', 'staticDataVersion', 'public, max-age=86400, stale-while-revalidate=604800'],
  ['analysis', 'analysis/current', 'analysisVersion', 'public, max-age=300, must-revalidate'],
  ['commercial', 'commercial/current', 'priceTableVersion', 'public, max-age=300, must-revalidate'],
  ['availability', 'availability', 'revision', 'no-cache']
];
for (const [kind, p, versionKey, cache] of SNAPSHOTS) {
  test(`GET /developments/{id}/${p} returns the exact ${kind} snapshot contract`, async () => {
    const { r, body } = await getJson(`/api/v1/developments/${DEV}/${p}`);
    assert.equal(r.status, 200);
    assert.equal(body.kind, kind);
    assert.equal(body.schemaVersion, App.domain.SCHEMA_VERSION);
    assert.equal(body.developmentId, DEV);
    assert.ok(body[versionKey] != null, versionKey);
    assert.equal(Object.keys(body.lots).length, 498);
    const staticIds = new Set(json.lots.map(l => l.identity.id));
    assert.equal(JSON.stringify(App.lifecycle.validateSnapshot(body, kind, DEV, kind === 'static' ? null : staticIds)), '[]');
    assert.equal(r.headers.get('cache-control'), cache);
    const etag = r.headers.get('etag');
    assert.match(etag, /^W\/".+"$/);
    const again = await get(`/api/v1/developments/${DEV}/${p}`, { 'If-None-Match': etag });
    assert.equal(again.status, 304);
  });
}

test('static snapshot is gzip-compressed when accepted and keeps full polygon precision', async () => {
  const r = await fetch(`${srv.url}/api/v1/developments/${DEV}/lots/static`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  const body = await r.json(); // fetch decodes gzip
  for (const l of json.lots) assert.equal(h.stableStringify(body.lots[l.identity.id].geometry.polygon), h.stableStringify(l.geometry.polygon));
});

test('GET /developments/{id}/map-lots returns the lean LotSummaryDto list', async () => {
  const { r, body } = await getJson(`/api/v1/developments/${DEV}/map-lots`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(body.count, 498);
  assert.equal(body.lots.length, 498);
  // v1.0 keys stay; contract 1.1 adds availabilityStatus (alias of status) and thematicValues (additive)
  const keys = ['areaM2', 'availabilityStatus', 'blockId', 'blockNumber', 'centroid', 'class', 'code', 'id', 'lotNumber', 'overallScore', 'polygon', 'price', 'pricePerM2', 'status', 'thematicValues'];
  for (const s of body.lots) { assert.deepEqual(Object.keys(s).sort(), keys); assert.equal(s.availabilityStatus, s.status); }
  const b79 = body.lots.find(s => s.code === 'B79'), ref = json.byId.get(b79.id);
  assert.equal(b79.areaM2, ref.geometry.areaM2);
  assert.equal(b79.price, ref.commercial.price);
  assert.equal(b79.class, ref.intelligence.class);
  assert.equal(b79.status, 'UNKNOWN');
});

test('GET /lots/{id} returns the canonical Lot composed with the shared composer', async () => {
  const id = 'VJ-QB-L0079';
  const { r, body } = await getJson(`/api/v1/lots/${id}`);
  assert.equal(r.status, 200);
  const re = App.domain.LotFactory.rehydrate(body.lot);
  assert.equal(re.success, true, JSON.stringify(re.errors));
  assert.equal(body.lot.identity.code, 'B79');
  assert.equal(h.comparable(App, body.lot), h.comparable(App, json.byId.get(id)));
  assert.equal(body.versions.availabilityRevision, 0);
});

test('GET /developments/{id}/commercial/price-tables/current equals the configured table', async () => {
  const { r, body } = await getJson(`/api/v1/developments/${DEV}/commercial/price-tables/current`);
  assert.equal(r.status, 200);
  const t = App.config.DEVELOPMENTS[0].priceTables[0];
  for (const k of Object.keys(t)) assert.equal(h.stableStringify(body[k]), h.stableStringify(t[k]), k);
  assert.equal(body.status, 'PUBLISHED');
});

test('GET /developments/{id}/assets returns metadata only (no binaries)', async () => {
  const { r, body } = await getJson(`/api/v1/developments/${DEV}/assets`);
  assert.equal(r.status, 200);
  const keys = body.assets.map(a => a.key);
  for (const k of ['plan', 'aerial', 'logo', 'lots']) assert.ok(keys.includes(k), k);
  const plan = body.assets.find(a => a.key === 'plan');
  assert.equal(plan.type, 'OFFICIAL_PLAN');
  assert.match(plan.checksum, /^[0-9a-f]{64}$/);
  assert.equal(plan.url, null); // ASSET_BASE_URL not configured in tests
  assert.ok(JSON.stringify(body).length < 20000);
});

test('invalid input → 400 with the standard error format', async () => {
  let x = await getJson('/api/v1/lots/not-a-lot');
  assert.equal(x.r.status, 400); assertError(x.body, 'VALIDATION_ERROR');
  x = await getJson('/api/v1/developments/Viva_Juara!/map-lots');
  assert.equal(x.r.status, 400); assertError(x.body, 'VALIDATION_ERROR');
  x = await getJson(`/api/v1/developments/${DEV}/map-lots?page=2`);
  assert.equal(x.r.status, 400); assertError(x.body, 'VALIDATION_ERROR');
  assert.equal(x.body.details[0].field, 'page');
});

test('unknown resources → 404 with semantic codes, wrong method → 405, writes disabled → 403', async () => {
  let x = await getJson('/api/v1/developments/other-dev/config');
  assert.equal(x.r.status, 404); assertError(x.body, 'DEVELOPMENT_NOT_FOUND');
  x = await getJson('/api/v1/lots/VJ-QZ-L9999');
  assert.equal(x.r.status, 404); assertError(x.body, 'LOT_NOT_FOUND');
  x = await getJson('/api/v1/nothing-here');
  assert.equal(x.r.status, 404); assertError(x.body, 'NOT_FOUND');
  const r = await fetch(`${srv.url}/api/v1/developments/${DEV}/availability`, { method: 'POST' });
  assert.equal(r.status, 405); assert.match(r.headers.get('allow'), /GET/); assertError(await r.json(), 'METHOD_NOT_ALLOWED');
  const w = await fetch(`${srv.url}/api/v1/lots/VJ-QB-L0079/availability`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RESERVED', expectedRevision: 0 }) });
  assert.equal(w.status, 403); assertError(await w.json(), 'WRITES_DISABLED');
});

test('X-Request-Id is propagated and becomes the error traceId', async () => {
  const id = 'test-trace-0001';
  const r = await get('/api/v1/lots/bad', { 'X-Request-Id': id });
  assert.equal(r.headers.get('x-request-id'), id);
  const body = await r.json();
  assert.equal(body.traceId, id);
  assert.equal(body.requestId, id);
});

test('CORS is restricted to the configured allowlist', async () => {
  let r = await get('/health', { Origin: 'http://allowed.test' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://allowed.test');
  r = await get('/health', { Origin: 'http://evil.test' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await fetch(`${srv.url}/api/v1/lots/VJ-QB-L0079/availability`, { method: 'OPTIONS', headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'PATCH' } });
  assert.equal(r.status, 403);
  r = await fetch(`${srv.url}/api/v1/lots/VJ-QB-L0079/availability`, { method: 'OPTIONS', headers: { Origin: 'http://allowed.test', 'Access-Control-Request-Method': 'PATCH' } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-methods'), /PATCH/);
});

test('basic rate limit answers 429 with Retry-After (health exempt)', async () => {
  const small = await h.startTestServer(db.url, { RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' }, { pool: db.pool });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${small.url}/api/v1/developments/${DEV}/availability`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const r = await fetch(`${small.url}/api/v1/developments/${DEV}/availability`);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assertError(await r.json(), 'RATE_LIMITED');
    assert.equal((await fetch(`${small.url}/health`)).status, 200);
  } finally { await small.close(); }
});

test('request timeout answers 503 REQUEST_TIMEOUT instead of hanging', async () => {
  const slow = await h.startTestServer(db.url, { REQUEST_TIMEOUT_MS: '1' }, { pool: db.pool });
  try {
    const r = await fetch(`${slow.url}/api/v1/developments/${DEV}/lots/static`);
    assert.equal(r.status, 503);
    assertError(await r.json(), 'REQUEST_TIMEOUT');
  } finally { await slow.close(); }
});

test('docs/openapi.json documents every registered route (no contract drift)', () => {
  const spec = h.readJson(require('path').join(h.BACKEND, 'docs', 'openapi.json'));
  for (const r of srv.app.router.routes) {
    const p = r.template.replace(/:([a-zA-Z]+)/g, '{$1}');
    assert.ok(spec.paths[p] && spec.paths[p][r.method.toLowerCase()], `${r.method} ${p} missing in openapi.json`);
  }
});
