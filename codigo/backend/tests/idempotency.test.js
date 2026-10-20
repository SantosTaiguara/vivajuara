'use strict';
/* Idempotency-Key on admin POST/PATCH: same key + same request → stored response replayed (handler not re-run);
   same key + different request → 409 IDEMPOTENCY_KEY_REUSED; running → 409 IDEMPOTENCY_REQUEST_IN_PROGRESS;
   failures release the key; keys expire (IDEMPOTENCY_TTL_SECONDS). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { h, contract, DEV, TOKEN, client } = require('./support');

let db, srv, req;
const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
const count = async (sql, p) => Number((await q(sql, p))[0].n);

test.before(async () => {
  db = await h.setupDatabase('idempotency');
  srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, IDEMPOTENCY_TTL_SECONDS: '120' }, { pool: db.pool });
  req = client(srv);
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('PATCH: replay with the same key and body returns the stored response; the command runs once', async () => {
  const body = { status: 'RESERVED', expectedRevision: 0, reservedUntil: '2026-12-31T23:59:59Z' };
  const a = await req('PATCH', '/lots/VJ-QA-L0001/availability', body, { key: 'patch-key-0001' });
  assert.equal(a.r.status, 200, a.text);
  assert.equal(a.r.headers.get('idempotent-replayed'), null);
  const b = await req('PATCH', '/lots/VJ-QA-L0001/availability', body, { key: 'patch-key-0001' });
  assert.equal(b.r.status, 200, b.text);
  assert.equal(b.r.headers.get('idempotent-replayed'), 'true');
  assert.equal(b.text, a.text, 'byte-identical replay');
  // without the key the same body is a new command → 409 (expectedRevision is stale now): proves the replay did not run it
  const c = await req('PATCH', '/lots/VJ-QA-L0001/availability', body);
  contract.assertApiError(c.r, c.body, 409, 'REVISION_CONFLICT');
  assert.equal(await count('SELECT count(*) AS n FROM availability_history WHERE lot_id = $1', ['VJ-QA-L0001']), 1);
  assert.equal(await count("SELECT count(*) AS n FROM audit_log WHERE action = 'AVAILABILITY_UPDATE'"), 1);
  const rec = (await q("SELECT principal, state, status_code, route, expires_at - created_at AS ttl FROM idempotency_keys WHERE key = 'patch-key-0001'"))[0];
  assert.equal(rec.principal, 'admin'); assert.equal(rec.state, 'COMPLETED'); assert.equal(rec.status_code, 200);
  assert.equal(rec.route, 'PATCH /api/v1/lots/:lotId/availability');
  assert.equal(rec.ttl.minutes * 60 + (rec.ttl.seconds || 0), 120);
});

test('same key + different body (or another route) → 409 IDEMPOTENCY_KEY_REUSED, nothing executed', async () => {
  const x = await req('PATCH', '/lots/VJ-QA-L0001/availability', { status: 'SOLD', expectedRevision: 1 }, { key: 'patch-key-0001' });
  contract.assertApiError(x.r, x.body, 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(x.body.details.idempotencyKey, 'patch-key-0001');
  const y = await req('PATCH', '/lots/VJ-QA-L0002/availability', { status: 'RESERVED', expectedRevision: 0, reservedUntil: '2026-12-31T23:59:59Z' }, { key: 'patch-key-0001' });
  contract.assertApiError(y.r, y.body, 409, 'IDEMPOTENCY_KEY_REUSED');
  const z = await req('POST', `/developments/${DEV}/price-tables?dryRun=true`, { version: 'x-1', pricePerM2: 1196 }, { key: 'patch-key-0001' });
  contract.assertApiError(z.r, z.body, 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0001']))[0].status, 'RESERVED');
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0002']))[0].status, 'UNKNOWN');
});

test('POST price table: replay returns the same 201 (Location included) and creates one table only', async () => {
  const body = { version: '2026-11-01', pricePerM2: 1250, changeReason: 'reajuste' };
  const a = await req('POST', `/developments/${DEV}/price-tables`, body, { key: 'pt-2026-11-01-0001' });
  assert.equal(a.r.status, 201, a.text.slice(0, 300));
  const b = await req('POST', `/developments/${DEV}/price-tables`, body, { key: 'pt-2026-11-01-0001' });
  assert.equal(b.r.status, 201);
  assert.equal(b.r.headers.get('idempotent-replayed'), 'true');
  assert.equal(b.r.headers.get('location'), a.r.headers.get('location'));
  assert.equal(b.text, a.text);
  assert.equal(await count('SELECT count(*) AS n FROM price_tables'), 2);
  // body with the same content but different key order hashes the same (canonical JSON)
  const c = await req('POST', `/developments/${DEV}/price-tables`, { changeReason: 'reajuste', pricePerM2: 1250, version: '2026-11-01' }, { key: 'pt-2026-11-01-0001' });
  assert.equal(c.r.status, 201); assert.equal(c.r.headers.get('idempotent-replayed'), 'true');
  // without a key the second publication of the same version is a conflict
  const d = await req('POST', `/developments/${DEV}/price-tables`, body);
  contract.assertApiError(d.r, d.body, 409, 'PRICE_TABLE_VERSION_EXISTS');
});

test('a failed command releases its key: the client can fix the request and retry with the same key', async () => {
  const k = 'retry-after-fix-01';
  const bad = await req('PATCH', '/lots/VJ-QA-L0003/availability', { status: 'RESERVED', expectedRevision: 99 }, { key: k });
  contract.assertApiError(bad.r, bad.body, 409, 'REVISION_CONFLICT');
  assert.equal(await count('SELECT count(*) AS n FROM idempotency_keys WHERE key = $1', [k]), 0);
  const good = await req('PATCH', '/lots/VJ-QA-L0003/availability', { status: 'RESERVED', expectedRevision: 0 }, { key: k });
  assert.equal(good.r.status, 200, good.text);
  const v400 = await req('POST', `/developments/${DEV}/price-tables`, { version: 'v', pricePerM2: -1 }, { key: 'bad-body-key-01' });
  contract.assertApiError(v400.r, v400.body, 400, 'VALIDATION_ERROR');
  assert.equal(await count('SELECT count(*) AS n FROM idempotency_keys WHERE key = $1', ['bad-body-key-01']), 0);
});

test('a key still in progress → 409 IDEMPOTENCY_REQUEST_IN_PROGRESS with Retry-After', async () => {
  const body = { status: 'SOLD', expectedRevision: 0 };
  const { requestHash } = require(h.BACKEND + '/src/shared/http/idempotency');
  const url = new URL(srv.api + '/lots/VJ-QA-L0004/availability');
  await q(`INSERT INTO idempotency_keys (principal, key, method, route, request_hash, expires_at) VALUES ('admin', 'in-flight-key-01', 'PATCH', 'x', $1, now() + interval '1 hour')`,
    [requestHash({ method: 'PATCH', pathname: url.pathname, query: url.searchParams, body })]);
  const x = await req('PATCH', '/lots/VJ-QA-L0004/availability', body, { key: 'in-flight-key-01' });
  contract.assertApiError(x.r, x.body, 409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS');
  assert.ok(Number(x.r.headers.get('retry-after')) >= 1);
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0004']))[0].status, 'UNKNOWN');
});

test('expired keys are not replayed: the key can be used again for another request', async () => {
  await q("UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE key = 'patch-key-0001'");
  const x = await req('PATCH', '/lots/VJ-QA-L0005/availability', { status: 'AVAILABLE', expectedRevision: 0 }, { key: 'patch-key-0001' });
  assert.equal(x.r.status, 200, x.text);
  assert.equal(x.r.headers.get('idempotent-replayed'), null);
  assert.equal((await q("SELECT route FROM idempotency_keys WHERE key = 'patch-key-0001'"))[0].route, 'PATCH /api/v1/lots/:lotId/availability');
});

test('malformed Idempotency-Key → 400 VALIDATION_ERROR; reads ignore the header; TTL floor/default; keys are scoped per credential', async () => {
  for (const k of ['short', 'has space in it', 'x'.repeat(129), 'bad/slash-key']) {
    const x = await req('PATCH', '/lots/VJ-QA-L0006/availability', { status: 'SOLD', expectedRevision: 0 }, { key: k });
    contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
    assert.equal(x.body.details[0].field, 'Idempotency-Key');
  }
  const r = await fetch(srv.api + '/lots/batch-summary', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'short' }, body: JSON.stringify({ ids: ['VJ-QB-L0079'] }) });
  assert.equal(r.status, 200, 'public read POST ignores Idempotency-Key');
  assert.throws(() => require(h.BACKEND + '/src/shared/config').loadConfig({ DATABASE_URL: db.url, IDEMPOTENCY_TTL_SECONDS: '10' }, { useDotEnv: false }), /at least 60/);
  assert.equal(require(h.BACKEND + '/src/shared/config').loadConfig({ DATABASE_URL: db.url }, { useDotEnv: false }).idempotencyTtlSeconds, 86400);
  // scope = credential: the same key under another credential (legacy WRITE_API_KEY) is an independent record
  const both = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, WRITES_ENABLED: 'true', WRITE_API_KEY: 'legacy-key-for-test' }, { pool: db.pool });
  try {
    const legacy = client(both, { token: 'legacy-key-for-test' });
    const x = await legacy('PATCH', '/lots/VJ-QA-L0007/availability', { status: 'SOLD', expectedRevision: 0 }, { key: 'pt-2026-11-01-0001' });
    assert.equal(x.r.status, 200, x.text);
    assert.equal(x.r.headers.get('idempotent-replayed'), null);
    assert.deepEqual((await q("SELECT principal FROM idempotency_keys WHERE key = 'pt-2026-11-01-0001' ORDER BY principal")).map(r => r.principal), ['admin', 'write-api-key']);
  } finally { await both.close(); }
});
