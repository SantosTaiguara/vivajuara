'use strict';
/* POST /api/v1/developments/{id}/price-tables: strict validation, dry-run diff (nothing written), publication of a new
   immutable version that becomes current atomically, old version still readable, frontend rule for prices
   (areaM2 × pricePerM2 rounded to cents), geometry/area never touched, actor/when recorded. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { h, contract, DEV, TOKEN, client } = require('./support');

let db, srv, req, lotsBefore;
const P = `/developments/${DEV}/price-tables`;
const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
const count = async t => Number((await q(`SELECT count(*) AS n FROM ${t}`))[0].n);
const frontendPrice = (area, ppm2) => Math.round(area * ppm2 * 100) / 100; // plat/src/data/repositories.js commercialFor
const lotsFingerprint = async () => (await q("SELECT md5(string_agg(id || ':' || checksum || ':' || geometry_checksum || ':' || area_m2::text || ':' || (static->'geometry')::text, '|' ORDER BY id)) AS f FROM lots"))[0].f;

test.before(async () => {
  db = await h.setupDatabase('price_tables');
  srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN }, { pool: db.pool });
  req = client(srv);
  lotsBefore = await lotsFingerprint();
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('current table is R$ 1.196/m² and the stored prices follow the frontend rule', async () => {
  const t = await (await fetch(srv.api + `/developments/${DEV}/commercial/price-tables/current`)).json();
  assert.equal(t.pricePerM2, 1196);
  const rows = await q("SELECT l.static->'geometry'->>'areaM2' AS a, p.metadata->'commercial'->>'price' AS price FROM lots l JOIN lot_prices p ON p.lot_id = l.id");
  assert.equal(rows.length, 498);
  for (const r of rows) assert.equal(Number(r.price), frontendPrice(Number(r.a), 1196));
});

test('dry-run with the current price per m² → 498 lots, 0 changed, nothing written', async () => {
  const before = [await count('price_tables'), await count('lot_prices'), await count('audit_log')];
  const x = await req('POST', P + '?dryRun=true', { version: 'same-price', pricePerM2: 1196 });
  assert.equal(x.r.status, 200, x.text.slice(0, 300));
  contract.assertSchema(x.body, 'PriceTablePublicationResponse');
  const d = x.body.data;
  assert.equal(d.dryRun, true);
  assert.equal(d.priceTable.status, 'DRAFT');
  assert.deepEqual([d.diff.lotCount, d.diff.changed, d.diff.unchanged], [498, 0, 498]);
  assert.equal(d.diff.totals.delta, 0);
  assert.equal(d.publication.publishedAt, null);
  assert.equal(d.publication.previousPriceTableId, 'lancamento-2026-10');
  assert.deepEqual([await count('price_tables'), await count('lot_prices'), await count('audit_log')], before);
});

test('dry-run with a new price → per-lot diff with the frontend rounding; still nothing written', async () => {
  const x = await req('POST', P + '?dryRun=true', { version: '2026-11-01', pricePerM2: 1250.5 });
  assert.equal(x.r.status, 200, x.text.slice(0, 300));
  const d = x.body.data;
  assert.deepEqual([d.diff.changed, d.diff.increased, d.diff.decreased], [498, 498, 0]);
  for (const l of d.diff.lots) {
    assert.equal(l.proposedPrice, frontendPrice(l.areaM2, 1250.5), l.lotId);
    assert.equal(l.currentPrice, frontendPrice(l.areaM2, 1196), l.lotId);
    assert.equal(l.delta, Math.round((l.proposedPrice - l.currentPrice) * 100) / 100);
    assert.equal(l.source, 'TABLE_PRICE_PER_M2');
  }
  assert.equal(d.wouldConflict, false);
  assert.equal(await count('price_tables'), 1);
  const cur = await (await fetch(srv.api + `/developments/${DEV}/manifest`)).json();
  assert.equal(cur.data.priceTableId, 'lancamento-2026-10');
});

test('strict validation: 400 for malformed values, 422 for semantic problems; nothing written', async () => {
  const bad400 = [
    [{ pricePerM2: 1250 }, 'version', 'required'],
    [{ version: '2026-11', pricePerM2: 0 }, 'pricePerM2', 'not_positive'],
    [{ version: '2026-11', pricePerM2: -10 }, 'pricePerM2', 'not_positive'],
    [{ version: '2026-11', pricePerM2: '1250' }, 'pricePerM2', 'type'],
    [{ version: '2026-11', pricePerM2: 1250.123 }, 'pricePerM2', 'max_2_decimals'],
    [{ version: '2026-11', pricePerM2: 2e6 }, 'pricePerM2', 'max'],
    [{ version: '2026-11' }, 'pricePerM2', 'required'],
    [{ version: '2026 11', pricePerM2: 1250 }, 'version', 'format'],
    [{ version: '2026-11', pricePerM2: 1250, price: 1 }, 'price', 'unknown_field'],
    [{ version: '2026-11', pricePerM2: 1250, validFrom: '2026-13-01' }, 'validFrom', 'format'],
    [{ version: '2026-11', lotPrices: [] }, 'lotPrices', 'min_items'],
    [{ version: '2026-11', lotPrices: [{ lotId: 'VJ-QA-L0001' }] }, 'lotPrices[0]', 'exactly_one_of'],
    [{ version: '2026-11', lotPrices: [{ lotId: 'VJ-QA-L0001', price: 1, pricePerM2: 1 }] }, 'lotPrices[0]', 'exactly_one_of'],
    [{ version: '2026-11', lotPrices: [{ lotId: 'bad-id', price: 1 }] }, 'lotPrices[0].lotId', 'format'],
    [{ version: '2026-11', pricePerM2: 1250, downPaymentDefault: 1.5 }, 'downPaymentDefault', 'range']
  ];
  for (const [body, field, reason] of bad400) {
    const x = await req('POST', P, body);
    contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
    assert.ok(x.body.details.some(d => d.field === field && d.reason === reason), `${JSON.stringify(body)} → ${JSON.stringify(x.body.details)}`);
  }
  // non-finite: 1e400 parses to Infinity
  let x = await req('POST', P, undefined, { raw: '{"version":"2026-11","pricePerM2":1e400}' });
  contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
  assert.equal(x.body.details[0].reason, 'not_finite');
  x = await req('POST', P + '?dryRun=yes', { version: '2026-11', pricePerM2: 1250 });
  contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
  x = await req('POST', P + '?other=1', { version: '2026-11', pricePerM2: 1250 });
  contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');

  const bad422 = [
    [{ version: '2026-11', pricePerM2: 1250, areaM2: 300 }, 'areaM2', 'immutable_field'],
    [{ version: '2026-11', lotPrices: [{ lotId: 'VJ-QA-L0001', price: 1, areaM2: 2 }] }, 'lotPrices[0].areaM2', 'immutable_field'],
    [{ version: '2026-11', pricePerM2: 1250, polygon: [[0, 0]] }, 'polygon', 'immutable_field'],
    [{ version: '2026-11', pricePerM2: 1250, lotPrices: [{ lotId: 'VJ-QZ-L9999', price: 100000 }] }, 'lotPrices[0].lotId', 'lot_not_found'],
    [{ version: '2026-11', pricePerM2: 1250, lotPrices: [{ lotId: 'VJ-QA-L0001', price: 100000 }, { lotId: 'VJ-QA-L0001', pricePerM2: 1300 }] }, 'lotPrices[1].lotId', 'duplicate_lot'],
    [{ version: '2026-11', lotPrices: [{ lotId: 'VJ-QA-L0001', price: 100000 }] }, 'lotPrices', 'lots_without_price'],
    [{ version: '2026-11', pricePerM2: 1250, validFrom: '2026-12-01', validUntil: '2026-11-01' }, 'validUntil', 'before_valid_from'],
    [{ version: '2026-11', pricePerM2: 1250, sourceId: 'no-such-source' }, 'sourceId', 'unknown_source']
  ];
  for (const [body, field, reason] of bad422) for (const qs of ['', '?dryRun=true']) {
    const y = await req('POST', P + qs, body);
    contract.assertApiError(y.r, y.body, 422, 'INVALID_PRICE_TABLE');
    assert.ok(y.body.details.some(d => d.field === field && d.reason === reason), `${JSON.stringify(body)} → ${JSON.stringify(y.body.details)}`);
  }
  x = await req('POST', '/developments/other-dev/price-tables', { version: '2026-11', pricePerM2: 1250 });
  contract.assertApiError(x.r, x.body, 404, 'DEVELOPMENT_NOT_FOUND');
  assert.equal(await count('price_tables'), 1);
  assert.equal(await lotsFingerprint(), lotsBefore);
});

test('publish: new immutable version, current atomically, old version still readable, who/when recorded', async () => {
  const etagBefore = (await fetch(srv.api + `/developments/${DEV}/commercial/current`)).headers.get('etag');
  const x = await req('POST', P, { version: '2026-11-01', pricePerM2: 1250.5, validFrom: '2026-11-01', validUntil: null, changeReason: 'Reajuste de novembro' });
  assert.equal(x.r.status, 201, x.text.slice(0, 400));
  contract.assertSchema(x.body, 'PriceTablePublicationResponse');
  const d = x.body.data;
  assert.equal(d.priceTable.id, 'viva-juara-2026-11-01');
  assert.equal(d.priceTable.status, 'PUBLISHED');
  assert.equal(x.r.headers.get('location'), `/api/v1/developments/${DEV}/price-tables/viva-juara-2026-11-01`);
  assert.equal(d.publication.publishedBy, 'admin');
  assert.ok(Math.abs(Date.parse(d.publication.publishedAt) - Date.now()) < 60000);
  assert.equal(x.body.meta.versions.priceTableId, 'viva-juara-2026-11-01');
  // payment plans copied from the previous table, prices from the frontend rule
  const cur = await (await fetch(srv.api + `/developments/${DEV}/commercial/price-tables/current`)).json();
  assert.equal(cur.id, 'viva-juara-2026-11-01'); assert.equal(cur.pricePerM2, 1250.5); assert.equal(cur.validFrom, '2026-11-01');
  const old = await (await fetch(srv.api + `/developments/${DEV}/price-tables/lancamento-2026-10`)).json();
  assert.equal(old.data.status, 'ARCHIVED'); assert.equal(old.data.pricePerM2, 1196);
  assert.deepEqual(cur.plans, old.data.plans);
  const viaId = await fetch(srv.api + x.r.headers.get('location').replace('/api/v1', ''));
  assert.equal(viaId.status, 200);
  const snap = await (await fetch(srv.api + `/developments/${DEV}/commercial/current`)).json();
  assert.equal(snap.priceTableId, 'viva-juara-2026-11-01');
  for (const [id, p] of Object.entries(snap.lots)) {
    const area = d.diff.lots.find(l => l.lotId === id).areaM2;
    assert.equal(p.commercial.price, frontendPrice(area, 1250.5), id);
    assert.equal(p.commercial.priceTableVersion, '2026-11-01');
  }
  assert.notEqual((await fetch(srv.api + `/developments/${DEV}/commercial/current`)).headers.get('etag'), etagBefore);
  // the old prices are untouched (immutable version), geometry and area untouched
  const oldPrices = await q("SELECT count(*)::int AS n FROM lot_prices WHERE price_table_id = 'lancamento-2026-10' AND (metadata->'commercial'->>'pricePerM2')::numeric = 1196");
  assert.equal(oldPrices[0].n, 498);
  assert.equal(await lotsFingerprint(), lotsBefore);
  const row = (await q("SELECT published_by, published_at, change_reason, pricing_mode, status FROM price_tables WHERE id = 'viva-juara-2026-11-01'"))[0];
  assert.deepEqual([row.published_by, row.change_reason, row.pricing_mode, row.status], ['admin', 'Reajuste de novembro', 'PER_M2', 'PUBLISHED']);
  const audit = (await q("SELECT actor_id, old_value, new_value FROM audit_log WHERE action = 'PRICE_TABLE_PUBLISH'"));
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, 'admin'); assert.equal(audit[0].old_value.priceTableId, 'lancamento-2026-10');
  // lot detail / map read the new current table
  const lot = await (await fetch(srv.api + '/lots/VJ-QB-L0079/commercial')).json();
  assert.equal(lot.data.priceTableVersion, '2026-11-01');
  // publishing the same version again → 409 (versions are immutable)
  const again = await req('POST', P, { version: '2026-11-01', pricePerM2: 1300 });
  contract.assertApiError(again.r, again.body, 409, 'PRICE_TABLE_VERSION_EXISTS');
  const dry = await req('POST', P + '?dryRun=true', { version: '2026-11-01', pricePerM2: 1300 });
  assert.equal(dry.body.data.wouldConflict, true);
});

test('per-lot prices (MIXED and PER_LOT): price overrides derive R$/m² like App.domain.updateLotCommercial', async () => {
  const x = await req('POST', P, { version: '2026-12-01', pricePerM2: 1300, lotPrices: [{ lotId: 'VJ-QB-L0079', price: 399999.99 }, { lotId: 'VJ-QA-L0001', pricePerM2: 1400 }] });
  assert.equal(x.r.status, 201, x.text.slice(0, 400));
  const d = x.body.data;
  assert.equal(d.publication.pricingMode, 'MIXED');
  const b79 = d.diff.lots.find(l => l.lotId === 'VJ-QB-L0079'), a1 = d.diff.lots.find(l => l.lotId === 'VJ-QA-L0001');
  assert.equal(b79.proposedPrice, 399999.99); assert.equal(b79.proposedPricePerM2, Math.round(399999.99 / b79.areaM2 * 100) / 100); assert.equal(b79.source, 'LOT_PRICE');
  assert.equal(a1.proposedPrice, frontendPrice(a1.areaM2, 1400)); assert.equal(a1.source, 'LOT_PRICE_PER_M2');
  const c = await (await fetch(srv.api + '/lots/VJ-QB-L0079/commercial')).json();
  assert.equal(c.data.price, 399999.99);
  assert.equal(c.data.downPaymentDefaultValue, Math.round(399999.99 * 12) / 100);
  // PER_LOT: every lot listed, no table price per m²
  const all = d.diff.lots.map(l => ({ lotId: l.lotId, price: Math.round(l.areaM2 * 1111 * 100) / 100 }));
  const y = await req('POST', P, { version: '2027-01-01', lotPrices: all });
  assert.equal(y.r.status, 201, y.text.slice(0, 400));
  assert.equal(y.body.data.publication.pricingMode, 'PER_LOT');
  assert.equal(y.body.data.priceTable.pricePerM2, null);
  const t = await (await fetch(srv.api + `/developments/${DEV}/price-tables/viva-juara-2026-11-01`)).json();
  assert.equal(t.data.status, 'ARCHIVED');
  assert.equal(await lotsFingerprint(), lotsBefore);
});

test('the frontend (ApiLotSource + shared LotFactory) loads the newly published table without errors', async () => {
  const App = h.frontendApp((...a) => fetch(...a));
  h.useBackend(App, DEV, { useBackendData: true, apiBaseUrl: srv.api, fallbackToJson: false });
  const repo = App.repos.createLotRepository(DEV);
  const lots = await repo.load();
  assert.equal(lots.length, 498);
  const l = repo.getLotById('VJ-QB-L0079');
  assert.equal(l.commercial.priceTableVersion, '2027-01-01');
  assert.equal(l.commercial.price, Math.round(l.geometry.areaM2 * 1111 * 100) / 100);
});
