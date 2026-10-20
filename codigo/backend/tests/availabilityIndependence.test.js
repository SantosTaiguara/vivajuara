'use strict';
/* Topic 29 — availability independent of price.
   Static: the availability module never reads/writes price tables or lot prices, the commercial (price) module never
   reads/writes availability; availability DTO schemas have no price field.
   Database: publishing a price table leaves availability (rows, history, development revision, manifest checksum)
   byte-identical; an availability PATCH leaves price tables, lot prices and the current price pointer byte-identical;
   the manifest reports 498 UNKNOWN, AVAILABLE = 0 and UNKNOWN freshness (UNKNOWN is never AVAILABLE nor FRESH). */
const test = require('node:test');
const { describe, before, after } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { h, contract, TOKEN, DEV, client, get } = require('./support');

const MOD = path.join(__dirname, '..', 'src', 'modules');
const read = dir => fs.readdirSync(path.join(MOD, dir)).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(MOD, dir, f), 'utf8')]);
const PRICE_RE = /\b(price_tables|lot_prices|current_price_table_id)\b|require\([^)]*commercial/;
const AVAIL_RE = /\b(lot_availability|availability_history|availability_revision)\b|require\([^)]*availability/;

test('static: availability code never touches price storage; pricing code never touches availability storage', () => {
  for (const [f, src] of read('availability')) assert.equal(PRICE_RE.test(src), false, `availability/${f} references price storage`);
  for (const [f, src] of read('commercial')) assert.equal(AVAIL_RE.test(src), false, `commercial/${f} references availability storage`);
  for (const [f, src] of read('pricing-history')) assert.equal(AVAIL_RE.test(src), false, `pricing-history/${f} references availability storage`);
});

test('static: availability contracts carry no price field', () => {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.json'), 'utf8')).components.schemas;
  assert.ok(all.AvailabilityManifestDto);
  for (const name of Object.keys(all).filter(n => /^Availability/.test(n))) {
    const text = JSON.stringify(all[name].properties || all[name]);
    assert.equal(/"(price|pricePerM2|priceTableId|amount)"/.test(text), false, name);
  }
});

describe('database (PostgreSQL)', () => {
  let db, srv, req;
  const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
  const availFingerprint = async () => ({
    rows: (await q("SELECT md5(string_agg(lot_id || ':' || status || ':' || revision || ':' || coalesce(updated_at::text, '-') || ':' || coalesce(source_id, '-') || ':' || row_updated_at::text, '|' ORDER BY lot_id)) AS f FROM lot_availability"))[0].f,
    history: (await q('SELECT count(*)::int AS n FROM availability_history'))[0].n,
    dev: (await q('SELECT availability_revision, availability_updated_at, availability_source_id FROM developments WHERE id = $1', [DEV]))[0]
  });
  const priceFingerprint = async () => ({
    tables: (await q("SELECT md5(string_agg(id || ':' || status || ':' || checksum || ':' || coalesce(archived_at::text, '-'), '|' ORDER BY id)) AS f FROM price_tables"))[0].f,
    prices: (await q("SELECT md5(string_agg(price_table_id || ':' || lot_id || ':' || coalesce(amount::text, '-'), '|' ORDER BY price_table_id, lot_id)) AS f FROM lot_prices"))[0].f,
    current: (await q('SELECT current_price_table_id FROM developments WHERE id = $1', [DEV]))[0].current_price_table_id
  });
  const manifest = async () => {
    const x = await get(srv, `/developments/${DEV}/availability/manifest`);
    assert.equal(x.r.status, 200, x.text.slice(0, 300));
    contract.assertSchema(x.body, 'AvailabilityManifestResponse');
    return x.body.data;
  };

  before(async () => {
    db = await h.setupDatabase('availability_independence');
    srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN }, { pool: db.pool });
    req = client(srv);
  });
  after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

  test('manifest today: 498 lots UNKNOWN, AVAILABLE = 0, freshness UNKNOWN, no price field', async () => {
    const m = await manifest();
    assert.equal(m.lotCount, 498);
    assert.equal(m.statusCounts.UNKNOWN, 498); assert.equal(m.statusCounts.AVAILABLE, 0);
    assert.equal(m.freshnessCounts.UNKNOWN, 498); assert.equal(m.freshnessCounts.FRESH, 0);
    assert.equal(m.dataStateCounts.UNKNOWN_SOURCE, 498);
    assert.match(m.checksum, /^[0-9a-f]{64}$/);
    assert.equal(/price/i.test(JSON.stringify(m)), false);
    const snap = await get(srv, `/developments/${DEV}/availability`);
    assert.equal(/"(price|pricePerM2|priceTableId)"/.test(snap.text), false);
  });

  test('publishing a price table never touches availability (rows, history, revision, manifest)', async () => {
    const a0 = await availFingerprint(), m0 = await manifest();
    const pub = await req('POST', `/developments/${DEV}/price-tables`, { version: '2026-11-01', pricePerM2: 1250 }, { key: 'ai-publish-1' });
    assert.equal(pub.r.status, 201, pub.text.slice(0, 300));
    assert.deepEqual(await availFingerprint(), a0);
    const m1 = await manifest();
    assert.equal(m1.checksum, m0.checksum); assert.equal(m1.revision, m0.revision); assert.deepEqual(m1.statusCounts, m0.statusCounts);
    assert.equal((await q("SELECT count(*)::int AS n FROM lot_availability WHERE status = 'AVAILABLE'"))[0].n, 0); // a price never makes a lot AVAILABLE
  });

  test('an availability change never touches prices (tables, lot prices, current pointer)', async () => {
    const p0 = await priceFingerprint();
    const c0 = (await get(srv, '/lots/VJ-QB-L0079/commercial')).body.data;
    const x = await req('PATCH', '/lots/VJ-QB-L0079/availability', { status: 'SOLD', expectedRevision: 0 });
    assert.equal(x.r.status, 200, x.text.slice(0, 300));
    assert.deepEqual(await priceFingerprint(), p0);
    assert.deepEqual((await get(srv, '/lots/VJ-QB-L0079/commercial')).body.data, c0);
    const m = await manifest();
    assert.equal(m.statusCounts.SOLD, 1); assert.equal(m.statusCounts.UNKNOWN, 497); assert.equal(m.freshnessCounts.FRESH, 1); // no time limit configured
    assert.ok(m.revision >= 1); assert.equal(m.dataStateCounts.VALID, 1);
  });

  test('availability manifest is a public read of a PUBLIC development; 404 for unknown development', async () => {
    const x = await get(srv, '/developments/nope-dev/availability/manifest');
    contract.assertApiError(x.r, x.body, 404, 'DEVELOPMENT_NOT_FOUND');
  });
});
