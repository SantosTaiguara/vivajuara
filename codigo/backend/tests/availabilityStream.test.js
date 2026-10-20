'use strict';
/* GET /api/v1/developments/{id}/availability/stream (Server-Sent Events): an event with the new availabilityRevision
   after each availability write (LISTEN/NOTIFY from the write transaction, or the safety poll), heartbeat comments,
   Last-Event-ID resume, public fields only (never proposalId/notes), clean disconnect, connection cap. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { h, contract, DEV, TOKEN, client, openStream, sleep } = require('./support');

let db, srv, req;
const S = () => `${srv.api}/developments/${DEV}/availability/stream`;
const rev = async () => Number((await db.pool.query('SELECT availability_revision AS r FROM developments WHERE id = $1', [DEV])).rows[0].r);
const lotRev = async id => Number((await db.pool.query('SELECT revision FROM lot_availability WHERE lot_id = $1', [id])).rows[0].revision);
const byRevision = r => s => s.events.find(e => e.event === 'availability' && Number(e.id) === r);

test.before(async () => {
  db = await h.setupDatabase('availability_stream');
  // poll disabled: every event below must come from LISTEN/NOTIFY
  srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, SSE_POLL_INTERVAL_MS: '0', SSE_HEARTBEAT_MS: '150', SSE_RETRY_MS: '2500' }, { pool: db.pool });
  req = client(srv);
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('stream opens with text/event-stream, retry hint and an INITIAL event carrying the current revision; heartbeats follow', async () => {
  const s = await openStream(S());
  try {
    assert.equal(s.res.status, 200);
    assert.match(s.res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(s.res.headers.get('cache-control'), 'no-store');
    assert.ok(s.res.headers.get('x-request-id'));
    const first = await s.waitFor(byRevision(0));
    assert.equal(first.data.reason, 'INITIAL');
    assert.equal(first.data.resync, true);
    assert.deepEqual(first.data.lots, []);
    contract.assertSchema(first.data, 'AvailabilityStreamEvent');
    assert.equal(s.retry, 2500);
    await s.waitFor(x => x.comments.filter(c => c.startsWith('heartbeat')).length >= 2, 3000);
  } finally { s.close(); }
});

test('an availability write emits an event with the new revision and the changed lot (public fields only)', async () => {
  const s = await openStream(S());
  try {
    await s.waitFor(byRevision(0));
    const w = await req('PATCH', '/lots/VJ-QA-L0001/availability', { status: 'PROPOSAL', expectedRevision: 0, proposalId: 'PROP-SECRET-77', notes: 'nota interna sigilosa' });
    assert.equal(w.r.status, 200, w.text);
    const ev = await s.waitFor(byRevision(1));
    contract.assertSchema(ev.data, 'AvailabilityStreamEvent');
    assert.equal(ev.data.availabilityRevision, 1);
    assert.equal(ev.data.previousRevision, 0);
    assert.equal(ev.data.resync, false);
    assert.equal(ev.data.changedLots, 1);
    assert.deepEqual(ev.data.lots.map(l => [l.lotId, l.status, l.revision]), [['VJ-QA-L0001', 'PROPOSAL', 1]]);
    assert.deepEqual(Object.keys(ev.data.lots[0]).sort(), ['freshnessSource', 'lotId', 'reservedUntil', 'revision', 'status', 'updatedAt']);
    assert.ok(!s.raw.includes('PROP-SECRET-77') && !s.raw.includes('sigilosa') && !s.raw.includes('proposalId') && !s.raw.includes('notes'), 'internal fields leaked');
    // a second write → next revision, only the lot changed since revision 1
    await req('PATCH', '/lots/VJ-QA-L0002/availability', { status: 'SOLD', expectedRevision: 0 });
    const ev2 = await s.waitFor(byRevision(2));
    assert.deepEqual(ev2.data.lots.map(l => l.lotId), ['VJ-QA-L0002']);
    // a refused write (409) emits nothing
    const bad = await req('PATCH', '/lots/VJ-QA-L0002/availability', { status: 'AVAILABLE', expectedRevision: 0 });
    assert.equal(bad.r.status, 409);
    await sleep(300);
    assert.equal(s.events.filter(e => Number(e.id) > 2).length, 0);
  } finally { s.close(); }
});

test('Last-Event-ID resumes after a reconnect: lots changed since that revision; equal revision → no event', async () => {
  assert.equal(await rev(), 2);
  const s = await openStream(S(), { 'Last-Event-ID': '0' });
  try {
    const ev = await s.waitFor(byRevision(2));
    assert.equal(ev.data.previousRevision, 0);
    assert.deepEqual(ev.data.lots.map(l => l.lotId).sort(), ['VJ-QA-L0001', 'VJ-QA-L0002']);
  } finally { s.close(); }
  const same = await openStream(S() + '?lastEventId=2');
  try {
    await same.waitFor(x => x.comments.some(c => c.startsWith('heartbeat')), 3000);
    assert.equal(same.events.length, 0);
    await req('PATCH', '/lots/VJ-QA-L0003/availability', { status: 'RESERVED', expectedRevision: 0 });
    const ev = await same.waitFor(byRevision(3));
    assert.deepEqual(ev.data.lots.map(l => l.lotId), ['VJ-QA-L0003']);
  } finally { same.close(); }
  const ahead = await openStream(S(), { 'Last-Event-ID': '999' });
  try {
    const ev = await ahead.waitFor(x => x.events[0]);
    assert.equal(ev.data.reason, 'REVISION_AHEAD'); assert.equal(ev.data.resync, true); assert.equal(Number(ev.id), 3);
  } finally { ahead.close(); }
});

test('several clients receive the same event; disconnects are cleaned up (no clients, listener released)', async () => {
  const stream = srv.app.services.availabilityStream;
  const a = await openStream(S()), b = await openStream(S());
  try {
    await a.waitFor(byRevision(3)); await b.waitFor(byRevision(3));
    assert.equal(stream.stats().clients, 2);
    assert.equal(stream.stats().listening, true);
    await req('PATCH', '/lots/VJ-QA-L0004/availability', { status: 'AVAILABLE', expectedRevision: 0 });
    const [ea, eb] = await Promise.all([a.waitFor(byRevision(4)), b.waitFor(byRevision(4))]);
    assert.deepEqual(ea.data, eb.data);
  } finally { a.close(); b.close(); }
  const t0 = Date.now();
  while (stream.stats().clients > 0 && Date.now() - t0 < 3000) await sleep(20);
  assert.equal(stream.stats().clients, 0);
  while (stream.stats().listening && Date.now() - t0 < 3000) await sleep(20);
  assert.equal(stream.stats().listening, false);
  assert.equal(db.pool.totalCount - db.pool.idleCount, 0, 'no pool client left checked out');
});

test('errors before the stream starts are JSON ApiErrors: bad Last-Event-ID 400, unknown development 404, unknown param 400', async () => {
  let r = await fetch(S(), { headers: { 'Last-Event-ID': 'abc' } });
  contract.assertApiError(r, await r.json(), 400, 'VALIDATION_ERROR');
  r = await fetch(`${srv.api}/developments/other-dev/availability/stream`);
  contract.assertApiError(r, await r.json(), 404, 'DEVELOPMENT_NOT_FOUND');
  r = await fetch(S() + '?since=1');
  contract.assertApiError(r, await r.json(), 400, 'VALIDATION_ERROR');
});

test('poll-only mode (SSE_LISTEN=false) also delivers; connection cap → 503 STREAM_LIMIT_REACHED; close() ends open streams', async () => {
  const poll = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, SSE_LISTEN: 'false', SSE_POLL_INTERVAL_MS: '100', SSE_MAX_CLIENTS: '1' }, { pool: db.pool });
  const s = await openStream(`${poll.api}/developments/${DEV}/availability/stream`);
  try {
    const r0 = await rev();
    await s.waitFor(byRevision(r0));
    assert.equal(poll.app.services.availabilityStream.stats().listening, false);
    const over = await fetch(`${poll.api}/developments/${DEV}/availability/stream`);
    contract.assertApiError(over, await over.json(), 503, 'STREAM_LIMIT_REACHED');
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    await req('PATCH', '/lots/VJ-QA-L0005/availability', { status: 'SOLD', expectedRevision: await lotRev('VJ-QA-L0005') });
    const ev = await s.waitFor(byRevision(r0 + 1), 3000);
    assert.deepEqual(ev.data.lots.map(l => l.lotId), ['VJ-QA-L0005']);
  } finally {
    const t0 = Date.now();
    await poll.close(); // must not hang on the open stream
    assert.ok(Date.now() - t0 < 3000);
    await s.waitFor(x => x.closed, 3000);
  }
});
