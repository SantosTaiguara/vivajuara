'use strict';
/* Write phase (PATCH /lots/{id}/availability), enabled only in this test server:
   auth guard, input validation (400/413/415), optimistic concurrency (409), state machine (422),
   history + audit in the same transaction, frontend reflects the change after refresh,
   and a re-import never overwrites API-managed availability. */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const KEY = 'test-write-key';
let db, srv;
const patch = (lotId, body, { auth = true, contentType = 'application/json', raw = null } = {}) => fetch(`${srv.api}/lots/${lotId}/availability`, {
  method: 'PATCH', headers: { 'Content-Type': contentType, ...(auth ? { Authorization: `Bearer ${KEY}` } : {}) }, body: raw != null ? raw : JSON.stringify(body)
});
const q = async (sql, p) => (await db.pool.query(sql, p)).rows;

test.before(async () => {
  db = await h.setupDatabase('writes');
  srv = await h.startTestServer(db.url, { WRITES_ENABLED: 'true', WRITE_API_KEY: KEY }, { pool: db.pool });
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('write requires the bearer key when configured (401)', async () => {
  const r = await patch('VJ-QA-L0001', { status: 'RESERVED', expectedRevision: 0 }, { auth: false });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'UNAUTHORIZED');
});

test('invalid input is rejected server-side (400 / 413 / 415)', async () => {
  const cases = [
    [{ raw: '{not json' }, 400], [{ contentType: 'text/plain' }, 415],
    [{ body: { status: 'RESERVED' } }, 400],                                   // expectedRevision missing
    [{ body: { status: 'FOR_SALE', expectedRevision: 0 } }, 400],              // unknown enum
    [{ body: { status: 'RESERVED', expectedRevision: -1 } }, 400],
    [{ body: { status: 'RESERVED', expectedRevision: '0' } }, 400],            // wrong type
    [{ body: { status: 'RESERVED', expectedRevision: 0, price: 1 } }, 400],    // mass assignment
    [{ body: { status: 'RESERVED', expectedRevision: 0, reservedUntil: 'tomorrow' } }, 400],
    [{ raw: JSON.stringify({ status: 'RESERVED', expectedRevision: 0, notes: 'x'.repeat(20000) }) }, 413]
  ];
  for (const [c, code] of cases) {
    const r = await patch('VJ-QA-L0001', c.body || {}, { raw: c.raw, contentType: c.contentType });
    const body = await r.json();
    assert.equal(r.status, code, JSON.stringify(c).slice(0, 80) + ' → ' + JSON.stringify(body));
    assert.ok(body.code && body.traceId);
  }
  assert.equal((await q("SELECT count(*)::int AS n FROM availability_history")).at(0).n, 0);
});

test('valid transition → 200, new revision, history + audit written atomically', async () => {
  const r = await patch('VJ-QA-L0001', { status: 'RESERVED', expectedRevision: 0, reservedUntil: '2026-12-31T23:59:59Z' });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.availability.status, 'RESERVED');
  assert.equal(body.availability.revision, 1);
  assert.equal(body.developmentRevision, 1);
  assert.equal(body.availability.reservedUntil, '2026-12-31T23:59:59.000Z');
  // §92 UpdateAvailabilityResponse { lotId, status, revision, updatedAt } at top level
  assert.equal(body.lotId, 'VJ-QA-L0001');
  assert.equal(body.status, 'RESERVED');
  assert.equal(body.revision, 1);
  assert.equal(body.updatedAt, body.availability.updatedAt);
  const hist = await q('SELECT from_status, to_status, revision, request_id FROM availability_history WHERE lot_id = $1', ['VJ-QA-L0001']);
  assert.deepEqual(hist.map(x => [x.from_status, x.to_status, Number(x.revision)]), [['UNKNOWN', 'RESERVED', 1]]);
  assert.ok(hist[0].request_id);
  const audit = await q("SELECT action, entity_id, actor_id, old_value, new_value FROM audit_log WHERE action = 'AVAILABILITY_UPDATE'");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, null);
  assert.equal(audit[0].old_value.status, 'UNKNOWN');
  assert.equal(audit[0].new_value.status, 'RESERVED');
});

test('stale expectedRevision → 409 REVISION_CONFLICT (optimistic concurrency)', async () => {
  const r = await patch('VJ-QA-L0001', { status: 'SOLD', expectedRevision: 0 });
  const body = await r.json();
  assert.equal(r.status, 409);
  assert.equal(body.code, 'REVISION_CONFLICT');
  assert.equal(body.details.currentRevision, 1);
  assert.equal(body.currentRevision, 1); // §94: { code: 'REVISION_CONFLICT', currentRevision }
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0001']))[0].status, 'RESERVED');
});

test('two concurrent writes with the same expectedRevision → exactly one wins, the other gets 409', async () => {
  const [a, b] = await Promise.all([patch('VJ-QA-L0002', { status: 'RESERVED', expectedRevision: 0 }), patch('VJ-QA-L0002', { status: 'PROPOSAL', expectedRevision: 0, proposalId: 'P-1' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await q('SELECT count(*)::int AS n FROM availability_history WHERE lot_id = $1', ['VJ-QA-L0002']))[0].n, 1);
});

test('invalid transition by the shared state machine → 422 (SOLD → AVAILABLE)', async () => {
  let r = await patch('VJ-QA-L0003', { status: 'SOLD', expectedRevision: 0 });
  assert.equal(r.status, 200);
  const rev = (await r.json()).availability.revision;
  r = await patch('VJ-QA-L0003', { status: 'AVAILABLE', expectedRevision: rev });
  const body = await r.json();
  assert.equal(r.status, 422);
  assert.equal(body.code, 'INVALID_AVAILABILITY_TRANSITION');
  assert.equal(body.details.reason, 'INVALID_TRANSITION'); // original state machine code
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0003']))[0].status, 'SOLD');
});

test('fields that do not apply to the status → 422 FIELD_NOT_ALLOWED; unknown lot → 404', async () => {
  let r = await patch('VJ-QA-L0004', { status: 'SOLD', expectedRevision: 0, reservedUntil: '2026-12-31T00:00:00Z' });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).code, 'FIELD_NOT_ALLOWED');
  r = await patch('VJ-QZ-L9999', { status: 'SOLD', expectedRevision: 0 });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'LOT_NOT_FOUND');
});

test('the frontend reflects the new status after refresh (ApiLotSource) and the availability ETag changes', async () => {
  const App = h.frontendApp((...a) => fetch(...a));
  h.useBackend(App, 'viva-juara', { useBackendData: true, apiBaseUrl: srv.api, fallbackToJson: false });
  const repo = App.repos.createLotRepository('viva-juara');
  await repo.load();
  assert.equal(repo.getLotById('VJ-QA-L0001').availability.status, 'RESERVED');
  assert.equal(repo.getLotById('VJ-QA-L0003').availability.status, 'SOLD');
  assert.equal(repo.getLotById('VJ-QA-L0005').availability.status, 'UNKNOWN');
  const etag = (await fetch(`${srv.api}/developments/viva-juara/availability`)).headers.get('etag');
  await patch('VJ-QA-L0005', { status: 'AVAILABLE', expectedRevision: 0 });
  const again = await fetch(`${srv.api}/developments/viva-juara/availability`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 200, 'dynamic data must not be served from a stale cache');
  // the availability channel of the repository applies the new revision through the state machine
  const snap = await again.json();
  const applied = repo.applyAvailabilityUpdate(snap);
  assert.equal(applied.applied, true, JSON.stringify(applied.errors || applied.reason));
  assert.equal(repo.getLotById('VJ-QA-L0005').availability.status, 'AVAILABLE');
  // GET /lots/{id}/availability (AvailabilityDto) reflects the write; never exposes proposalId/notes
  const one = await (await fetch(`${srv.api}/lots/VJ-QA-L0005/availability`)).json();
  assert.equal(one.data.status, 'AVAILABLE');
  assert.equal(one.data.revision, snap.lots['VJ-QA-L0005'].availability.revision);
  assert.equal(one.data.freshnessSource, 'availability-api');
  assert.ok(!('proposalId' in one.data) && !('notes' in one.data));
});

test('PROPOSAL written by the operator: public DTOs never expose proposalId or notes', async () => {
  const r = await patch('VJ-QA-L0006', { status: 'PROPOSAL', expectedRevision: 0, proposalId: 'PROP-123', notes: 'cliente pediu sigilo' });
  assert.equal(r.status, 200);
  for (const p of ['/lots/VJ-QA-L0006/availability', '/lots/VJ-QA-L0006', '/lots/VJ-QA-L0006/summary']) {
    const body = await (await fetch(srv.api + p)).json();
    const pub = JSON.stringify(body.data);
    assert.ok(!pub.includes('PROP-123') && !pub.includes('sigilo'), `${p} leaks internal fields`);
  }
  const map = await (await fetch(`${srv.api}/developments/viva-juara/map-lots`)).json();
  assert.ok(!JSON.stringify(map).includes('PROP-123'));
  assert.equal(map.lots.find(l => l.id === 'VJ-QA-L0006').availabilityStatus, 'PROPOSAL');
});

test('re-import does not overwrite availability managed by the API', async () => {
  const r = await h.importDevelopmentData({ pool: db.pool, App: db.App, file: h.LOTS_FILE, developmentId: 'viva-juara', assetDir: h.DATA });
  assert.equal(r.status, 'OK', JSON.stringify(r.errors));
  assert.equal(r.created, 0);
  assert.ok(r.warnings.some(w => w.code === 'AVAILABILITY_MANAGED_BY_API'));
  assert.equal((await q('SELECT status FROM lot_availability WHERE lot_id = $1', ['VJ-QA-L0001']))[0].status, 'RESERVED');
});
