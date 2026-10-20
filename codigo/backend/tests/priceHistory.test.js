'use strict';
/* Topic 28 — price history (read-only, derived from immutable published price table versions).
   Pure domain: one version → change null + reason; increase / decrease / unchanged; a gap (version without price) is a
   MISSING point and a REMOVED event, never zero and never a decrease; zero start price → no percent; another currency
   is excluded; development view uses the same-lot basket median; wording never says valorização / rentabilidade.
   Database: viva-juara has a single version (R$ 1.196/m²) → NOT_CALCULABLE; after publishing a second version the
   change is computed, the previous version is ARCHIVED and still part of the history, and old points never change. */
const test = require('node:test');
const { describe, before, after } = test;
const assert = require('node:assert/strict');
const { h, contract, TOKEN, DEV, client, get } = require('./support');
const d = require('../src/modules/pricing-history/priceHistory.domain');

const V = (id, validFrom, o = {}) => ({ priceTableId: id, version: id, status: o.status || 'ARCHIVED', currency: o.currency || 'BRL', validFrom, validUntil: null,
  issuedOn: null, publishedAt: validFrom + 'T12:00:00.000Z', archivedAt: null, sourceId: 'src', checksum: 'c-' + id, pricingMode: 'PER_M2', changeReason: o.reason || null });
const P = (amount, pricePerM2 = null, currency = 'BRL') => ({ amount, pricePerM2, currency });
const lot = (versions, prices, current = null) => d.buildLotHistory({ developmentId: DEV, lotId: 'VJ-QA-L0001', areaM2: 300, versions,
  pricesByTable: new Map(Object.entries(prices)), currentPriceTableId: current, generatedAt: '2026-10-08T00:00:00.000Z' });
const FORBIDDEN = /valoriza(ç|c)(ã|a)o do lote|rentabilidade (do|garantida)|retorno garantido|investimento seguro/i;

test('single version: point VALID, change null with INSUFFICIENT_COMPARABLE_VERSIONS (never 0)', () => {
  const x = lot([V('t1', '2026-10-06', { status: 'PUBLISHED' })], { t1: P(358800, 1196) }, 't1');
  assert.equal(x.points.length, 1);
  assert.equal(x.points[0].pointStatus, 'VALID');
  assert.equal(x.summary.calculationStatus, 'NOT_CALCULABLE');
  assert.equal(x.summary.notCalculableReason, 'INSUFFICIENT_COMPARABLE_VERSIONS');
  assert.equal(x.summary.absoluteChange, null); assert.equal(x.summary.relativeChangePct, null);
  assert.equal(x.summary.currentPrice, 358800); assert.equal(x.summary.consistentWithCurrent, true);
  assert.deepEqual(x.changeEvents.map(e => e.changeType), ['INITIAL']);
  assert.equal(x.quality.level, 'LOW');
});

test('no price at all: NO_VALID_PRICE, quality INSUFFICIENT', () => {
  const x = lot([V('t1', '2026-10-06')], {});
  assert.equal(x.points[0].pointStatus, 'MISSING'); assert.equal(x.points[0].amount, null);
  assert.equal(x.summary.notCalculableReason, 'NO_VALID_PRICE');
  assert.equal(x.quality.level, 'INSUFFICIENT');
  assert.deepEqual(x.changeEvents, []);
});

test('increase, decrease and unchanged: deltas between consecutive valid points; summary first → last', () => {
  const x = lot([V('t3', '2027-03-01', { status: 'PUBLISHED' }), V('t1', '2026-10-06'), V('t2', '2026-12-01', { reason: 'Reajuste comercial' })], // unordered input
    { t1: P(100000, 1000), t2: P(110000, 1100), t3: P(99000, 990) }, 't3');
  assert.deepEqual(x.points.map(p => p.priceTableId), ['t1', 't2', 't3']);
  assert.deepEqual(x.points.map(p => p.effectiveTo), ['2026-12-01', '2027-03-01', null]);
  assert.deepEqual(x.changeEvents.map(e => e.changeType), ['INITIAL', 'INCREASE', 'DECREASE']);
  assert.equal(x.changeEvents[1].absoluteDelta, 10000); assert.equal(x.changeEvents[1].relativeDeltaPct, 10);
  assert.equal(x.changeEvents[1].reason, 'UNKNOWN_REASON'); assert.equal(x.changeEvents[1].reasonText, 'Reajuste comercial');
  assert.equal(x.changeEvents[2].absoluteDelta, -11000); assert.equal(x.changeEvents[2].relativeDeltaPct, -10);
  assert.equal(x.summary.calculationStatus, 'CALCULATED');
  assert.equal(x.summary.absoluteChange, -1000); assert.equal(x.summary.relativeChangePct, -1);
  assert.equal(x.summary.pricePerM2Change, -10);
  assert.equal(x.summary.changeCount, 2); assert.equal(x.summary.periodDays, 146);
  assert.equal(x.quality.level, 'HIGH');
  const same = lot([V('a', '2026-01-01'), V('b', '2026-02-01')], { a: P(5), b: P(5) });
  assert.equal(same.changeEvents[1].changeType, 'UNCHANGED'); assert.equal(same.summary.absoluteChange, 0);
});

test('gap: a version without price is MISSING / REMOVED (not zero, not a decrease); no delta across the gap', () => {
  const x = lot([V('t1', '2026-01-01'), V('t2', '2026-02-01'), V('t3', '2026-03-01')], { t1: P(100), t3: P(120) });
  assert.deepEqual(x.points.map(p => p.pointStatus), ['VALID', 'MISSING', 'VALID']);
  assert.equal(x.points[1].amount, null);
  assert.deepEqual(x.changeEvents.map(e => e.changeType), ['INITIAL', 'REMOVED', 'RESTORED']);
  assert.equal(x.changeEvents[1].absoluteDelta, null); assert.equal(x.changeEvents[2].absoluteDelta, null);
  assert.equal(x.intervals[1].amount, null); // no interpolation
  assert.equal(x.summary.absoluteChange, 20); // first known → last known, both VALID
  assert.equal(x.quality.missingPointCount, 1); assert.equal(x.quality.level, 'MEDIUM');
  const last = lot([V('t1', '2026-01-01'), V('t2', '2026-02-01', { status: 'PUBLISHED' })], { t1: P(100) }, 't2');
  assert.ok(last.quality.warnings.includes('LATEST_VERSION_WITHOUT_VALID_PRICE'));
  assert.equal(last.summary.currentPrice, null);
});

test('zero start price: absolute delta only, percent null with ZERO_START_PRICE; other currency excluded', () => {
  const z = lot([V('a', '2026-01-01'), V('b', '2026-02-01')], { a: P(0), b: P(50) });
  assert.equal(z.summary.absoluteChange, 50); assert.equal(z.summary.relativeChangePct, null);
  assert.equal(z.summary.notCalculableReason, 'ZERO_START_PRICE');
  const c = lot([V('a', '2026-01-01'), V('b', '2026-02-01', { currency: 'USD' })], { a: P(100), b: P(30, null, 'USD') });
  assert.equal(c.points[1].pointStatus, 'NOT_APPLICABLE');
  assert.equal(c.summary.calculationStatus, 'NOT_CALCULABLE');
  assert.ok(c.quality.warnings.includes('MIXED_CURRENCY_EXCLUDED'));
  assert.equal(lot([V('a', '2026-01-01')], { a: P(-1) }).points[0].pointStatus, 'INVALID');
});

test('wording: caveats deny valorização / rentabilidade / retorno; no promotional text', () => {
  const x = lot([V('t1', '2026-10-06')], { t1: P(1) });
  const all = JSON.stringify(x);
  assert.equal(FORBIDDEN.test(all), false);
  assert.ok(x.caveats.some(c => /não representam valorização do ativo, rentabilidade nem retorno/.test(c)));
  assert.equal(x.summary.label, 'Variação do preço de tabela (nominal)');
});

test('development history: same-lot basket median; lots priced in one version only do not distort the change', () => {
  const prices = new Map([
    ['t1', new Map([['L1', P(100, 1)], ['L2', P(200, 2)], ['L3', P(300, 3)]])],
    ['t2', new Map([['L1', P(110, 1.1)], ['L2', P(220, 2.2)], ['L4', P(10000, 100)]])] // L3 lost its price, L4 is new (expensive)
  ]);
  const x = d.buildDevelopmentHistory({ developmentId: DEV, versions: [V('t1', '2026-01-01'), V('t2', '2026-02-01', { status: 'PUBLISHED' })], pricesByTable: prices, lotCount: 4, currentPriceTableId: 't2' });
  assert.equal(x.versions.length, 2);
  const c = x.changes[0];
  assert.equal(c.method, 'SAME_LOT_BASKET_MEDIAN');
  assert.equal(c.commonLotCount, 2); assert.equal(c.addedLotCount, 1); assert.equal(c.removedPriceLotCount, 1);
  assert.equal(c.medianRelativeChangePct, 10); assert.equal(c.increased, 2);
  assert.equal(x.summary.calculationStatus, 'CALCULATED'); assert.equal(x.summary.consistentWithCurrent, true);
  const one = d.buildDevelopmentHistory({ developmentId: DEV, versions: [V('t1', '2026-01-01')], pricesByTable: prices, lotCount: 4 });
  assert.equal(one.summary.change, null); assert.equal(one.summary.notCalculableReason, 'INSUFFICIENT_COMPARABLE_VERSIONS');
  assert.match(x.label, /não é índice de mercado nem valorização do ativo/);
});

test('domain is pure: same input → same output; input not mutated', () => {
  const versions = [V('t1', '2026-01-01'), V('t2', '2026-02-01')];
  const frozen = JSON.stringify(versions);
  const a = lot(versions, { t1: P(1), t2: P(2) }), b = lot(versions, { t1: P(1), t2: P(2) });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(versions), frozen);
});

// ---------------------------------------------------------------- database
describe('database (PostgreSQL)', () => {
  let db, srv, req;
  const LOT = 'VJ-QB-L0079';
  const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
  before(async () => {
    db = await h.setupDatabase('price_history');
    srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN }, { pool: db.pool });
    req = client(srv);
  });
  after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

  test('viva-juara today: one version (R$ 1.196/m²) → change NOT_CALCULABLE, public read, schema-valid', async () => {
    const x = await get(srv, `/developments/${DEV}/lots/${LOT}/price-history`);
    assert.equal(x.r.status, 200, x.text.slice(0, 300));
    contract.assertSchema(x.body, 'LotPriceHistoryResponse');
    const r = x.body.data;
    assert.equal(r.points.length, 1);
    assert.equal(r.points[0].pricePerM2, 1196); assert.equal(r.points[0].priceTableId, 'lancamento-2026-10');
    assert.equal(r.summary.calculationStatus, 'NOT_CALCULABLE');
    assert.equal(r.summary.notCalculableReason, 'INSUFFICIENT_COMPARABLE_VERSIONS');
    assert.equal(r.summary.relativeChangePct, null);
    assert.equal(r.summary.currentPrice, r.points[0].amount);
    assert.equal(r.summary.currentPrice, Math.round(r.areaM2 * 1196 * 100) / 100); // frontend rule areaM2 × R$/m²
    const dev = await get(srv, `/developments/${DEV}/pricing/history`);
    assert.equal(dev.r.status, 200, dev.text.slice(0, 300));
    contract.assertSchema(dev.body, 'DevelopmentPriceHistoryResponse');
    assert.equal(dev.body.data.versions.length, 1);
    assert.equal(dev.body.data.versions[0].pricedLotCount, 498);
    assert.equal(dev.body.data.versions[0].medianPricePerM2, 1196);
    assert.equal(dev.body.data.summary.change, null);
    assert.equal(FORBIDDEN.test(x.text + dev.text), false);
  });

  test('errors: unknown development / lot → 404; lot of another development → 404; query params rejected', async () => {
    const a = await get(srv, '/developments/nope-dev/pricing/history');
    contract.assertApiError(a.r, a.body, 404, 'DEVELOPMENT_NOT_FOUND');
    const b = await get(srv, `/developments/${DEV}/lots/VJ-QZ-L9999/price-history`);
    contract.assertApiError(b.r, b.body, 404, 'LOT_NOT_FOUND');
    const bad = await get(srv, `/developments/${DEV}/pricing/history?from=2020-01-01`);
    assert.equal(bad.r.status, 400);
  });

  test('after publishing a second version: change computed, old version ARCHIVED and unchanged, ETag changes', async () => {
    const before = await get(srv, `/developments/${DEV}/lots/${LOT}/price-history`);
    const etag = before.r.headers.get('etag');
    const oldRows = await q("SELECT md5(string_agg(lot_id || ':' || amount::text, '|' ORDER BY lot_id)) AS f FROM lot_prices WHERE price_table_id = 'lancamento-2026-10'");
    const pub = await req('POST', `/developments/${DEV}/price-tables`, { version: '2026-11-01', pricePerM2: 1250, validFrom: '2026-11-01' }, { key: 'ph-publish-1' });
    assert.equal(pub.r.status, 201, pub.text.slice(0, 300));
    const x = await get(srv, `/developments/${DEV}/lots/${LOT}/price-history`);
    assert.notEqual(x.r.headers.get('etag'), etag);
    const r = x.body.data;
    assert.equal(r.points.length, 2);
    assert.deepEqual(r.points.map(p => p.versionStatus), ['ARCHIVED', 'PUBLISHED']);
    assert.deepEqual(r.points[0], { ...before.body.data.points[0], versionStatus: 'ARCHIVED', archivedAt: r.points[0].archivedAt, effectiveTo: r.points[0].effectiveTo });
    assert.equal(r.summary.calculationStatus, 'CALCULATED');
    const expected = Math.round((r.points[1].amount - r.points[0].amount) * 100) / 100;
    assert.equal(r.summary.absoluteChange, expected);
    assert.equal(r.summary.pricePerM2Change, 54);
    assert.deepEqual(r.changeEvents.map(e => e.changeType), ['INITIAL', 'INCREASE']);
    assert.equal(r.summary.consistentWithCurrent, true);
    const dev = (await get(srv, `/developments/${DEV}/pricing/history`)).body.data;
    assert.equal(dev.changes.length, 1);
    assert.equal(dev.changes[0].commonLotCount, 498);
    assert.equal(dev.changes[0].increased, 498);
    // immutability: the archived version's prices are byte-identical
    assert.deepEqual(await q("SELECT md5(string_agg(lot_id || ':' || amount::text, '|' ORDER BY lot_id)) AS f FROM lot_prices WHERE price_table_id = 'lancamento-2026-10'"), oldRows);
  });

  test('history endpoints are read-only: no write method is routed', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await fetch(srv.api + `/developments/${DEV}/pricing/history`, { method: m, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' });
      assert.ok([404, 405].includes(r.status), `${m} → ${r.status}`);
    }
  });
});
