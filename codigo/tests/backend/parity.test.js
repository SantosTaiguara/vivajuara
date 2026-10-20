'use strict';
/* Data parity (JSON vs API) through the shadow-compare tool: 498/498 identical after import,
   and the tool really detects a divergence (mutation check). */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let db, srv;
test.before(async () => {
  db = await h.setupDatabase('parity');
  srv = await h.startTestServer(db.url, {}, { pool: db.pool });
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

const compare = () => h.runShadowCompare({ apiBaseUrl: srv.api, developmentId: 'viva-juara', dataDir: h.DATA, srcDir: h.SRC, detailSample: 498 });

test('JSON and API produce the same 498 lots (ids, area, polygons, price, status, scores, classes, alerts, distances)', async () => {
  const { summary, lots } = await compare();
  assert.equal(summary.jsonLots, 498);
  assert.equal(summary.apiLots, 498);
  for (const k of ['identical', 'area', 'price', 'status', 'scores', 'class', 'alerts', 'distances', 'geometryChecksum']) assert.equal(summary[k], 498, k);
  assert.equal(summary.mapLots.mismatches, 0);
  assert.equal(summary.detailSample.checked, 498);
  assert.equal(summary.detailSample.mismatches, 0);
  assert.equal(summary.parity, true);
  assert.equal(lots.length, 498);
});

test('the reconciliation detects a divergence (mutated area and polygon in the database)', async () => {
  await db.pool.query(`UPDATE lots SET static = jsonb_set(static, '{geometry,areaM2}', to_jsonb((static->'geometry'->>'areaM2')::numeric + 1)),
    geometry = jsonb_set(geometry, '{coordinates,0,0,0}', '0') WHERE id = 'VJ-QB-L0079'`);
  const { summary, lots } = await compare();
  assert.equal(summary.parity, false);
  assert.equal(summary.identical, 497);
  const bad = lots.find(r => r.lotId === 'VJ-QB-L0079');
  assert.equal(bad.area, false);
  assert.equal(bad.geometryChecksum.match, false);
  assert.ok(bad.diff.includes('geometry.areaM2'));
  assert.equal(bad.price, true, 'price comes from the price table snapshot, not recomputed from the mutated area');
});
