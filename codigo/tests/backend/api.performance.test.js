'use strict';
/* Performance contract of the API layer:
   - no N+1: each endpoint runs a constant number of SQL statements, independent of page size / batch size / lot;
   - map payload: lean MapLotDto, bounded raw / gzip / brotli size, no heavy sections;
   - latency p50/p95 per main endpoint and a small concurrent load (all answers correct, no errors).
   Bounds are generous on purpose (CI machines vary); the measured numbers are printed as diagnostics. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const h = require('./helpers');
const c = require('./contract');

const DEV = 'viva-juara';
const D = `/developments/${DEV}`;
let db, srv, cp, ids;

test.before(async () => {
  db = await h.setupDatabase('apiperf');
  cp = c.countingPool(db.pool);
  srv = await h.startTestServer(db.url, {}, { pool: cp.pool });
  ids = (await (await fetch(srv.api + `${D}/map-lots`)).json()).lots.map(l => l.id);
  assert.equal(ids.length, 498);
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

/** runs one request and returns { status, n: SQL statements it ran, body } */
async function counted(p, body) {
  cp.reset();
  const r = await fetch(srv.api + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const text = await r.text();
  return { status: r.status, n: cp.counter.n, statements: [...cp.counter.statements], body: text ? JSON.parse(text) : null };
}

// ------------------------------------------------------------------ N+1
test('constant SQL statements per request (no N+1), with documented upper bounds', async t => {
  const bounds = [
    [`${D}/map-lots`, 2], [`${D}/lots?pageSize=100`, 2], [`${D}/lots?pageSize=100&search=QB`, 3], [`${D}/lots/search?q=QB`, 3],
    ['/developments', 1], [D, 1], [`${D}/manifest`, 1], [`${D}/sources`, 2], [`${D}/config`, 5], [`${D}/lots/static`, 3],
    ['/lots/VJ-QB-L0079/summary', 3], ['/lots/VJ-QB-L0079', 6], ['/lots/VJ-QB-L0079/analysis', 6], ['/lots/VJ-QB-L0079/commercial', 7],
    ['/lots/VJ-QB-L0079/provenance', 6], ['/lots/VJ-QB-L0079/availability', 2]
  ];
  for (const [p, max] of bounds) {
    const r = await counted(p);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.n <= max, `${p}: ${r.n} statements > ${max}\n${r.statements.join('\n')}`);
    t.diagnostic(`${p}: ${r.n} SQL`);
  }
});

test('statement count does not grow with page size, batch size, result size or lot', async () => {
  const one = await counted(`${D}/lots?pageSize=1`), hundred = await counted(`${D}/lots?pageSize=100`), last = await counted(`${D}/lots?pageSize=100&page=5`);
  assert.equal(one.body.data.length, 1);
  assert.equal(hundred.body.data.length, 100);
  assert.equal(last.body.data.length, 98);
  assert.equal(one.n, hundred.n);
  assert.equal(hundred.n, last.n);

  const b1 = await counted('/lots/batch-summary', { ids: ids.slice(0, 1) }), b100 = await counted('/lots/batch-summary', { ids: ids.slice(0, 100) });
  assert.equal(b1.body.data.length, 1);
  assert.equal(b100.body.data.length, 100);
  assert.equal(b1.n, 1);
  assert.equal(b100.n, 1);

  const s1 = await counted(`${D}/lots/search?q=VJ-QB-L0079`), sMany = await counted(`${D}/lots/search?q=QB&limit=50`);
  assert.equal(s1.body.data.length, 1);
  assert.ok(sMany.body.data.length > 1);
  assert.equal(s1.n, sMany.n);

  for (const suffix of ['', '/summary', '/analysis', '/commercial', '/provenance']) {
    const counts = new Set();
    for (const id of [ids[0], ids[250], ids[497]]) counts.add((await counted(`/lots/${id}${suffix}`)).n);
    assert.equal(counts.size, 1, `/lots/{id}${suffix}: ${[...counts]}`);
  }
});

test('single-lot reads filter in SQL: no statement loads the whole development for one lot', async () => {
  const r = await counted('/lots/VJ-QB-L0079');
  // every lot-layer statement takes the lot id as a parameter (`$2::text IS NULL OR ...`), so one lot = one row per layer
  for (const s of r.statements.filter(x => /FROM (lots|lot_analysis|lot_prices|lot_availability)\b/.test(x))) assert.ok(/\$\d/.test(s), s);
  const detailBytes = JSON.stringify(r.body).length;
  assert.ok(detailBytes < 64 * 1024, `detail payload ${detailBytes} B`);
});

// ------------------------------------------------------------------ map payload
/** raw wire bytes with a given Accept-Encoding (fetch would decode transparently) */
function wire(p, encoding) {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.api + p);
    const rq = http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'accept-encoding': encoding } }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, encoding: res.headers['content-encoding'] || 'identity', bytes: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    rq.on('error', reject);
  });
}

test('map payload: lean MapLotDto with bounded raw / gzip / brotli size', async t => {
  const raw = await wire(`${D}/map-lots`, 'identity');
  const gz = await wire(`${D}/map-lots`, 'gzip');
  const br = await wire(`${D}/map-lots`, 'br, gzip');
  assert.deepEqual([raw.status, gz.status, br.status], [200, 200, 200]);
  assert.deepEqual([raw.encoding, gz.encoding, br.encoding], ['identity', 'gzip', 'br']);
  // the compressed answers decode to the very same document
  assert.ok(zlib.gunzipSync(gz.bytes).equals(raw.bytes));
  assert.ok(zlib.brotliDecompressSync(br.bytes).equals(raw.bytes));
  const kb = n => (n / 1024).toFixed(1) + ' KB';
  t.diagnostic(`map-lots 498 lots: raw ${kb(raw.bytes.length)} · gzip ${kb(gz.bytes.length)} · brotli ${kb(br.bytes.length)} · ${Math.round(raw.bytes.length / 498)} B/lot raw`);
  assert.ok(raw.bytes.length < 450 * 1024, `raw ${kb(raw.bytes.length)}`);
  assert.ok(gz.bytes.length < 120 * 1024, `gzip ${kb(gz.bytes.length)}`);
  assert.ok(br.bytes.length <= gz.bytes.length, 'brotli is not larger than gzip');
  assert.ok(raw.bytes.length / 498 < 900, 'per-lot budget');

  const body = JSON.parse(raw.bytes.toString('utf8'));
  const HEAVY = ['provenance', 'alerts', 'highlights', 'rankings', 'ranking', 'easements', 'noiseSources', 'analysis', 'commercial', 'paymentPlans', 'static', 'notes', 'proposalId', 'metadata', 'sources'];
  for (const lot of body.lots) {
    const keys = Object.keys(lot);
    assert.ok(keys.length <= 16, `${lot.id}: ${keys.length} keys`);
    for (const k of HEAVY) assert.ok(!(k in lot), `${lot.id}: heavy key ${k} in map payload`);
    assert.ok(Object.keys(lot.thematicValues).length <= 16);
  }
  // the full list page is the heavier DTO; the map stays the lean one
  const list = await (await fetch(srv.api + `${D}/lots?pageSize=100`)).text();
  assert.ok(raw.bytes.length / 498 < list.length / 100, 'MapLotDto lighter than LotSummary page entries');
});

// ------------------------------------------------------------------ latency & load
const stable = d => JSON.parse(JSON.stringify(d, (k, v) => (k === 'generatedAt' ? undefined : v)));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

test('latency p50/p95 per main endpoint (warm, sequential)', async t => {
  const targets = [`${D}/map-lots`, `${D}/lots?pageSize=50`, `${D}/lots?status=UNKNOWN&minArea=250&sortBy=price`, `${D}/lots/search?q=Q%20B%20L79`,
    '/lots/VJ-QB-L0079', '/lots/VJ-QB-L0079/summary', `${D}/manifest`];
  for (const p of targets) {
    const ms = [];
    for (let i = 0; i < 25; i++) {
      const t0 = process.hrtime.bigint();
      const r = await fetch(srv.api + p);
      await r.arrayBuffer();
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.equal(r.status, 200, p);
    }
    const p50 = pct(ms, 50), p95 = pct(ms, 95);
    t.diagnostic(`${p}: p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms`);
    assert.ok(p95 < 2000, `${p}: p95 ${p95.toFixed(0)} ms`);
  }
});

test('concurrent load: 120 mixed requests, 20 in flight, all correct', async t => {
  const reference = new Map();
  const mix = [`${D}/map-lots`, `${D}/lots?pageSize=20&sortBy=price&sortDirection=desc`, '/lots/VJ-QB-L0079/summary', `${D}/lots/search?q=B79`, `${D}/manifest`];
  for (const p of mix) reference.set(p, await (await fetch(srv.api + p)).json());
  const jobs = Array.from({ length: 120 }, (_, i) => mix[i % mix.length]);
  const ms = [];
  let next = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const p = jobs[next++];
      const s = process.hrtime.bigint();
      const r = await fetch(srv.api + p);
      const body = await r.json();
      ms.push(Number(process.hrtime.bigint() - s) / 1e6);
      assert.equal(r.status, 200, `${p}: ${JSON.stringify(body).slice(0, 200)}`);
      const ref = reference.get(p);
      // same data under load (requestId / generatedAt differ per request by design)
      assert.deepEqual(stable(body.data ?? body.lots), stable(ref.data ?? ref.lots), p);
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  const total = Date.now() - t0;
  t.diagnostic(`120 requests / 20 concurrent: ${total} ms total · ${(120 / (total / 1000)).toFixed(0)} req/s · p50 ${pct(ms, 50).toFixed(1)} ms · p95 ${pct(ms, 95).toFixed(1)} ms`);
  assert.equal(ms.length, 120);
  assert.ok(pct(ms, 95) < 5000);
});
