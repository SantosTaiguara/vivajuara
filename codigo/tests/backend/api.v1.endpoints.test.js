'use strict';
/* Contract tests for the API v1 formal layer (topic 11): every new endpoint is validated against
   docs/openapi.json, checked for correct values against the published JSON (frontend composition),
   for ETag/304, cache policy and semantic 404s. Filters, sorting, pagination and search are checked
   against an independent in-memory evaluation over the 498 canonical lots. */
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const c = require('./contract');

const DEV = 'viva-juara';
let db, srv, App, json, dev;
const get = (p, headers = {}) => fetch(srv.api + p, { headers });
const getJson = async (p, headers) => { const r = await get(p, headers); return { r, body: await r.json() }; };
const post = (p, body, headers = { 'Content-Type': 'application/json' }) => fetch(srv.api + p, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const S = v => h.stableStringify(v);
const plain = v => JSON.parse(JSON.stringify(v)); // canonical lots live in another vm realm

test.before(async () => {
  db = await h.setupDatabase('apiv1');
  assert.equal(db.importReport.status, 'OK', JSON.stringify(db.importReport.errors));
  srv = await h.startTestServer(db.url, {}, { pool: db.pool });
  App = h.sharedApp();
  json = await h.jsonLots();
  dev = App.config.DEVELOPMENTS.find(d => d.id === DEV);
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

async function assertRevalidates(p, cache) {
  const r = await get(p);
  assert.equal(r.status, 200, p);
  if (cache) assert.equal(r.headers.get('cache-control'), cache, p);
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
  const etag = r.headers.get('etag');
  assert.match(etag || '', /^W\/".+"$/, `${p} has no weak ETag`);
  const again = await get(p, { 'If-None-Match': etag });
  assert.equal(again.status, 304, `${p} If-None-Match`);
  assert.equal(await again.text(), '');
  return r.json();
}
const assertMeta = (meta, requestId) => { assert.equal(meta.apiVersion, 'v1'); assert.equal(meta.requestId, requestId); assert.ok(meta.generatedAt.endsWith('Z')); };

// ------------------------------------------------------------------ developments, manifest, sources, config
test('GET /developments lists DevelopmentDto with pagination meta', async () => {
  const { r, body } = await getJson('/developments');
  c.assertSchema(body, 'DevelopmentListResponse');
  assertMeta(body.meta, r.headers.get('x-request-id'));
  assert.deepEqual({ total: body.meta.total, page: body.meta.page, pageSize: body.meta.pageSize, totalPages: body.meta.totalPages }, { total: 1, page: 1, pageSize: 20, totalPages: 1 });
  assert.equal(body.data[0].id, DEV);
  await assertRevalidates('/developments', 'no-cache');
  const x = await getJson('/developments?pageSize=500');
  c.assertApiError(x.r, x.body, 422, 'INVALID_FILTER');
});

test('GET /developments/{id} returns the DevelopmentDto with current versions', async () => {
  const body = await assertRevalidates(`/developments/${DEV}`, 'no-cache');
  c.assertSchema(body, 'DevelopmentResponse');
  assert.deepEqual({ ...body.data, updatedAt: null }, {
    id: DEV, code: dev.code, name: dev.name, slug: dev.slug || DEV, status: 'ACTIVE', currency: dev.currency, locale: dev.locale,
    currentStaticVersion: dev.staticDataVersion, currentAnalysisVersion: dev.analysisVersion, currentPriceTableId: dev.currentPriceTableId,
    currentPriceTableVersion: dev.priceTables[0].version, availabilityRevision: 0, updatedAt: null,
    organizationId: 'org_house7', visibility: 'PUBLIC' // API 1.3 (topic 31): owner organization (opaque id) + explicit visibility
  });
  assert.ok(!('tenantId' in body.data) && !('config' in body.data), 'no administrative/internal fields');
  const x = await getJson('/developments/nao-existe');
  c.assertApiError(x.r, x.body, 404, 'DEVELOPMENT_NOT_FOUND');
});

test('GET /developments/{id}/manifest returns every current version', async () => {
  const body = await assertRevalidates(`/developments/${DEV}/manifest`, 'no-cache');
  c.assertSchema(body, 'ManifestResponse');
  const { generatedAt, ...m } = body.data;
  assert.deepEqual(m, { developmentId: DEV, schemaVersion: App.domain.SCHEMA_VERSION, staticVersion: dev.staticDataVersion, analysisVersion: dev.analysisVersion,
    priceTableId: dev.currentPriceTableId, priceTableVersion: dev.priceTables[0].version, availabilityRevision: 0 });
  assert.ok(generatedAt.endsWith('Z'));
});

test('GET /developments/{id}/sources returns the source catalog (same as config.sources)', async () => {
  const body = await assertRevalidates(`/developments/${DEV}/sources`, 'public, max-age=300, must-revalidate');
  c.assertSchema(body, 'SourcesResponse');
  const config = (await getJson(`/developments/${DEV}/config`)).body;
  assert.equal(S(body.data), S(config.sources));
});

test('GET /developments/{id}/config keeps the v1.0 contract (default layer, features, availability policy)', async () => {
  const { body } = await getJson(`/developments/${DEV}/config`);
  assert.equal(body.map.defaultLayer, dev.map.defaultLayer);
  assert.equal(S(body.features), S(dev.features));
  assert.equal(S(body.availabilityPolicy), S(dev.availabilityPolicy));
});

// ------------------------------------------------------------------ map-lots
test('GET /map-lots: every lot, lean MapLotDto, thematic values equal the canonical fields', async () => {
  const body = await assertRevalidates(`/developments/${DEV}/map-lots`, 'no-cache');
  c.assertSchema(body, 'MapLotsResponse');
  assert.equal(body.count, 498);
  assert.equal(new Set(body.lots.map(l => l.id)).size, 498);
  assert.equal(body.versions.staticVersion, dev.staticDataVersion);
  const get = App.model.get;
  for (const m of body.lots) {
    const l = json.byId.get(m.id);
    assert.ok(l, m.id);
    assert.equal(m.availabilityStatus, l.availability.status);
    assert.notEqual(m.availabilityStatus, 'AVAILABLE', 'no availability feed yet: UNKNOWN is never reported as AVAILABLE');
    assert.equal(m.price, l.commercial.price);
    assert.equal(m.class, l.intelligence.class);
    assert.equal(S(m.polygon), S(l.geometry.polygon));
    const t = m.thematicValues;
    for (const [k, key] of Object.entries({ noiseLevel: 'environmental.noiseLevel', privacyLevel: 'environmental.privacyLevel', estimatedTraffic: 'mobility.estimatedTraffic',
      gateProximity: 'mobility.gateProximity', hasGreenRear: 'surroundings.hasGreenRear', orientationRear: 'environmental.orientationRear',
      routeDistanceToLeisureM: 'mobility.routeDistanceToLeisureM', frontBearingDeg: 'environmental.frontBearingDeg' })) assert.equal(t[k], get(l, key) ?? null, `${m.id} ${key}`);
    for (const k of ['housing', 'investment', 'family', 'premium']) assert.equal(t.scores[k], l.intelligence.scores[k]);
  }
});

// ------------------------------------------------------------------ quick view (summary, batch) vs canonical lots
function expectedQuickView(l) {
  const get = App.model.get;
  return {
    id: l.identity.id, code: l.identity.code, displayCode: l.identity.displayCode, developmentId: l.identity.developmentId, blockId: l.identity.blockId,
    blockNumber: l.identity.blockNumber, lotNumber: l.identity.lotNumber, areaM2: l.geometry.areaM2, frontM: l.geometry.frontM, averageDepthM: l.geometry.averageDepthM,
    isCorner: l.geometry.isCorner, availabilityStatus: l.availability.status, price: l.commercial.price, pricePerM2: l.commercial.pricePerM2, currency: l.commercial.currency,
    priceTableVersion: l.commercial.priceTableVersion, class: l.intelligence.class, scores: l.intelligence.scores,
    criteria: Object.fromEntries(Object.entries(App.model.CRITERIA_FIELDS).map(([k, key]) => [k, get(l, key) ?? null])),
    noiseLevel: l.environmental.noiseLevel, privacyLevel: l.environmental.privacyLevel, estimatedTraffic: l.mobility.estimatedTraffic,
    routeDistanceToGateM: l.mobility.routeDistanceToGateM, hasGreenRear: l.surroundings.hasGreenRear,
    highlights: l.intelligence.highlights.map(x => ({ type: x.type, title: x.title, weight: x.weight ?? null })),
    alerts: l.intelligence.alerts.map(a => ({ type: a.type, severity: a.severity, title: a.title, fieldKey: a.fieldKey ?? null })),
    analysisVersion: l.intelligence.analysisVersion
  };
}

test('GET /lots/{id}/summary returns the LotQuickViewDto with canonical values', async () => {
  const id = 'VJ-QB-L0079';
  const { r, body } = await getJson(`/lots/${id}/summary`);
  c.assertSchema(body, 'LotQuickViewResponse');
  assertMeta(body.meta, r.headers.get('x-request-id'));
  assert.equal(S(body.data), S(expectedQuickView(json.byId.get(id))));
  assert.deepEqual(body.meta.unavailableLayers, []);
  await assertRevalidates(`/lots/${id}/summary`, 'no-cache');
  const x = await getJson('/lots/VJ-QZ-L9999/summary');
  c.assertApiError(x.r, x.body, 404, 'LOT_NOT_FOUND');
});

test('POST /lots/batch-summary: 498 lots in 5 calls equal the canonical lots; order kept, unknown ids reported', async () => {
  const ids = [...json.byId.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await post('/lots/batch-summary', { ids: chunk });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body).slice(0, 300));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    c.assertSchema(body, 'BatchSummaryResponse');
    assert.deepEqual(body.data.map(d => d.id), chunk);
    for (const d of body.data) assert.equal(S(d), S(expectedQuickView(json.byId.get(d.id))), d.id);
  }
  const r = await post('/lots/batch-summary', { ids: ['VJ-QB-L0079', 'VJ-QZ-L9999', 'VJ-QB-L0079', 'VJ-QA-L0001'] });
  const body = await r.json();
  assert.deepEqual(body.data.map(d => d.id), ['VJ-QB-L0079', 'VJ-QA-L0001']);
  assert.deepEqual({ requested: body.meta.requested, found: body.meta.found, notFound: body.meta.notFound }, { requested: 3, found: 2, notFound: ['VJ-QZ-L9999'] });
  const tooMany = await post('/lots/batch-summary', { ids: ids.slice(0, 101) });
  c.assertApiError(tooMany, await tooMany.json(), 400, 'VALIDATION_ERROR');
});

// ------------------------------------------------------------------ list: filters, sorting, pagination
async function listAll(qs) {
  const out = [];
  let meta = null;
  for (let page = 1; ; page++) {
    const { r, body } = await getJson(`/developments/${DEV}/lots?${qs}${qs ? '&' : ''}pageSize=100&page=${page}`);
    assert.equal(r.status, 200, JSON.stringify(body).slice(0, 300));
    c.assertSchema(body, 'LotListResponse');
    meta = body.meta;
    out.push(...body.data);
    if (page >= body.meta.totalPages) break;
  }
  assert.equal(out.length, meta.total);
  return { items: out, meta };
}

const LV = l => l ?? 'UNKNOWN';
const CASES = [
  ['status=UNKNOWN&minArea=250&maxPrice=320000', l => l.availability.status === 'UNKNOWN' && l.geometry.areaM2 >= 250 && l.commercial.price != null && l.commercial.price <= 320000],
  ['class=A_PLUS,A&corner=false', l => ['A_PLUS', 'A'].includes(l.intelligence.class) && l.geometry.isCorner === false],
  ['minHousingScore=80&noiseLevel=VERY_LOW,LOW', l => l.intelligence.scores.housing != null && l.intelligence.scores.housing >= 80 && ['VERY_LOW', 'LOW'].includes(LV(l.environmental.noiseLevel))],
  ['privacyLevel=HIGH,VERY_HIGH&block=B,C', l => ['HIGH', 'VERY_HIGH'].includes(LV(l.environmental.privacyLevel)) && ['B', 'C'].includes(l.identity.blockId)],
  ['minPrice=300000&maxPrice=400000&maxArea=300&corner=true', l => l.commercial.price >= 300000 && l.commercial.price <= 400000 && l.geometry.areaM2 <= 300 && l.geometry.isCorner === true],
  ['status=AVAILABLE', l => l.availability.status === 'AVAILABLE'],
  ['', () => true]
];
for (const [qs, pred] of CASES) {
  test(`GET /lots?${qs || '(no filter)'} matches an independent evaluation over the canonical lots`, async () => {
    const { items, meta } = await listAll(qs);
    const expected = plain(json.lots.filter(pred).map(l => l.identity.id)).sort();
    assert.deepEqual(items.map(i => i.id).sort(), expected);
    assert.equal(meta.total, expected.length);
    if (qs === 'status=AVAILABLE') assert.equal(meta.total, 0, 'UNKNOWN is never AVAILABLE');
    if (qs === '') {
      // natural order = block, lot number; pages are disjoint and complete
      assert.equal(new Set(items.map(i => i.id)).size, 498);
      const nat = plain([...json.lots]).sort((a, b) => a.identity.blockId.localeCompare(b.identity.blockId) || a.identity.lotNumber - b.identity.lotNumber).map(l => l.identity.id);
      assert.deepEqual(items.map(i => i.id), nat);
    }
  });
}

test('GET /lots sorting: whitelisted keys, both directions, nulls last, deterministic tie-break', async () => {
  const keyOf = { price: l => l.commercial.price, areaM2: l => l.geometry.areaM2, housingScore: l => l.intelligence.scores.housing, distanceToGateM: l => l.mobility.routeDistanceToGateM };
  for (const [sortBy, f] of Object.entries(keyOf)) for (const dir of ['asc', 'desc']) {
    const { items, meta } = await listAll(`sortBy=${sortBy}&sortDirection=${dir}`);
    assert.equal(meta.sortBy, sortBy); assert.equal(meta.sortDirection, dir);
    const vals = items.map(i => f(json.byId.get(i.id)));
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] == null) continue;
      assert.ok(vals[i - 1] != null, `${sortBy} ${dir}: null before value`);
      assert.ok(dir === 'asc' ? vals[i - 1] <= vals[i] : vals[i - 1] >= vals[i], `${sortBy} ${dir} at ${i}: ${vals[i - 1]} / ${vals[i]}`);
    }
    // same request twice → same order
    assert.deepEqual((await listAll(`sortBy=${sortBy}&sortDirection=${dir}`)).items.map(i => i.id), items.map(i => i.id));
  }
});

test('GET /lots pagination: page size default/limit, out-of-range page, ETag per query', async () => {
  let x = await getJson(`/developments/${DEV}/lots`);
  assert.equal(x.body.meta.pageSize, 50); assert.equal(x.body.data.length, 50); assert.equal(x.body.meta.totalPages, 10);
  x = await getJson(`/developments/${DEV}/lots?page=11&pageSize=50`);
  assert.equal(x.r.status, 200); assert.deepEqual(x.body.data, []); assert.equal(x.body.meta.total, 498);
  for (const bad of ['pageSize=101', 'pageSize=100000', 'pageSize=0', 'page=0']) {
    x = await getJson(`/developments/${DEV}/lots?${bad}`);
    c.assertApiError(x.r, x.body, 422, 'INVALID_FILTER');
  }
  const a = await get(`/developments/${DEV}/lots?class=A`), b = await get(`/developments/${DEV}/lots?class=B`);
  assert.notEqual(a.headers.get('etag'), b.headers.get('etag'));
  await assertRevalidates(`/developments/${DEV}/lots?class=A&sortBy=price`, 'no-cache');
});

// ------------------------------------------------------------------ search
test('GET /lots/search uses the central parser: "79", "B79", "Q B L79", "VJ-QB-L0079", "Lote 5", "QB"', async () => {
  const one = ['79', 'B79', 'Q B L79', 'QB L79', 'quadra b lote 79', 'VJ-QB-L0079'];
  for (const q of one) {
    const { body } = await getJson(`/developments/${DEV}/lots/search?q=${encodeURIComponent(q)}`);
    c.assertSchema(body, 'LotSearchResponse');
    assert.equal(body.meta.kind, 'lot', q);
    assert.deepEqual(body.data.map(d => d.id), ['VJ-QB-L0079'], q);
  }
  let { body } = await getJson(`/developments/${DEV}/lots/search?q=${encodeURIComponent('Lote 5')}&limit=50`);
  const fives = plain(json.lots.filter(l => l.identity.lotNumber === 5).map(l => l.identity.id));
  assert.equal(body.meta.kind, 'multi'); assert.equal(body.meta.total, fives.length); assert.deepEqual(body.data.map(d => d.id).sort(), fives.sort());
  ({ body } = await getJson(`/developments/${DEV}/lots/search?q=QB&limit=10`));
  assert.equal(body.meta.kind, 'block'); assert.equal(body.meta.total, 88); assert.equal(body.data.length, 10); assert.equal(body.meta.truncated, true);
  ({ body } = await getJson(`/developments/${DEV}/lots/search?q=327`));
  assert.equal(body.meta.kind, 'none'); assert.deepEqual(body.data, []);
  // the list filter uses the same parser
  const list = await getJson(`/developments/${DEV}/lots?search=${encodeURIComponent('Lote 5')}&pageSize=100`);
  assert.deepEqual(list.body.data.map(d => d.id).sort(), fives.sort());
  const x = await getJson(`/developments/${DEV}/lots/search`);
  c.assertApiError(x.r, x.body, 400, 'INVALID_FILTER');
  await assertRevalidates(`/developments/${DEV}/lots/search?q=B79`, 'no-cache');
});

// ------------------------------------------------------------------ lot detail and sub-resources
test('GET /lots/{id}: LotDetailDto sections equal the canonical Lot, without internal fields; v1.0 fields kept', async () => {
  for (const id of ['VJ-QB-L0079', 'VJ-QA-L0001', 'VJ-QR-L0016']) {
    if (!json.byId.has(id)) continue;
    const body = await assertRevalidates(`/lots/${id}`, 'no-cache');
    c.assertSchema(body, 'LotDetailResponse');
    const l = json.byId.get(id);
    for (const s of ['identity', 'geometry', 'location', 'surroundings', 'mobility', 'environmental', 'construction', 'commercial', 'intelligence']) assert.equal(S(body.data[s]), S(l[s]), `${id} ${s}`);
    const { notes, proposalId, ...pub } = l.availability;
    assert.equal(S(body.data.availability), S(pub));
    assert.ok(!('provenance' in body.data), 'detailed provenance lives in /provenance');
    assert.equal(body.data.provenanceSummary.href, `/api/v1/lots/${id}/provenance`);
    assert.equal(body.data.provenanceSummary.totalFields, App.model.getStoredFields().length);
    assert.equal(h.comparable(App, body.lot), h.comparable(App, l), 'deprecated v1.0 `lot` still identical');
  }
});

test('GET /lots/{id}/analysis: scores, class, alerts, highlights, ranking of the current analysisVersion', async () => {
  const id = 'VJ-QB-L0079';
  const body = await assertRevalidates(`/lots/${id}/analysis`, 'public, max-age=300, must-revalidate');
  c.assertSchema(body, 'LotAnalysisResponse');
  const l = json.byId.get(id);
  assert.equal(body.data.analysisVersion, dev.analysisVersion);
  assert.equal(body.meta.versions.analysisVersion, dev.analysisVersion);
  for (const k of ['scores', 'class', 'alerts', 'highlights', 'rankings', 'notes', 'liquidity', 'idealProfiles', 'confidence']) assert.equal(S(body.data[k]), S(l.intelligence[k]), k);
  const x = await getJson('/lots/VJ-QZ-L9999/analysis');
  c.assertApiError(x.r, x.body, 404, 'LOT_NOT_FOUND');
});

test('GET /lots/{id}/commercial: current price, table version and applicable plans', async () => {
  const id = 'VJ-QB-L0079';
  const body = await assertRevalidates(`/lots/${id}/commercial`, 'public, max-age=300, must-revalidate');
  c.assertSchema(body, 'LotCommercialResponse');
  const l = json.byId.get(id), table = dev.priceTables.find(t => t.id === dev.currentPriceTableId);
  assert.equal(body.data.price, l.commercial.price);
  assert.equal(body.data.priceTableId, table.id);
  assert.equal(body.data.priceTableVersion, table.version);
  assert.deepEqual(body.data.plans.map(p => p.id), plain(l.commercial.availablePlans));
  assert.equal(S(body.data.plans), S(table.plans.filter(p => l.commercial.availablePlans.includes(p.id))));
});

test('GET /lots/{id}/availability: canonical enum + revision (UNKNOWN until a feed exists)', async () => {
  const body = await assertRevalidates('/lots/VJ-QB-L0079/availability', 'no-cache');
  c.assertSchema(body, 'AvailabilityResponse');
  assert.deepEqual(body.data, { lotId: 'VJ-QB-L0079', status: 'UNKNOWN', updatedAt: null, revision: 0, reservedUntil: null, freshnessSource: null });
  const x = await getJson('/lots/VJ-QZ-L9999/availability');
  c.assertApiError(x.r, x.body, 404, 'LOT_NOT_FOUND');
});

test('GET /lots/{id}/provenance: one entry per stored field; fieldKey filter; unknown fieldKey → 422', async () => {
  const id = 'VJ-QB-L0079';
  const body = await assertRevalidates(`/lots/${id}/provenance`, 'no-cache');
  c.assertSchema(body, 'LotProvenanceResponse');
  assert.equal(body.data.fields.length, App.model.getStoredFields().length);
  const l = json.byId.get(id);
  for (const [key, p] of Object.entries(l.provenance || {})) {
    const f = body.data.fields.find(x => x.fieldKey === key);
    if (!f) continue;
    assert.equal(f.lotSpecific, true); assert.equal(f.status, p.status); assert.equal(f.sourceId, p.sourceId ?? null);
  }
  const one = (await getJson(`/lots/${id}/provenance?fieldKey=geometry.areaM2`)).body;
  assert.deepEqual(one.data.fields.map(f => [f.fieldKey, f.status, f.sourceId]), [['geometry.areaM2', 'CONFIRMED', 'official-plan-v1']]);
  let x = await getJson(`/lots/${id}/provenance?fieldKey=geometry.nope`);
  c.assertApiError(x.r, x.body, 422, 'INVALID_FIELD_KEY');
  x = await getJson(`/lots/${id}/provenance?fieldKey=${encodeURIComponent("x'; DROP TABLE lots;--")}`);
  c.assertApiError(x.r, x.body, 400, 'INVALID_FILTER');
});

// ------------------------------------------------------------------ commercial / price tables
test('GET /price-tables/{id} equals the current table; other ids → 404 PRICE_TABLE_NOT_FOUND', async () => {
  const id = dev.currentPriceTableId;
  const body = await assertRevalidates(`/developments/${DEV}/price-tables/${id}`, 'public, max-age=300, must-revalidate');
  c.assertSchema(body, 'PriceTableResponse');
  const current = (await getJson(`/developments/${DEV}/commercial/price-tables/current`)).body;
  c.assertSchema(current, 'PriceTableDto');
  assert.equal(S(body.data), S(current));
  let x = await getJson(`/developments/${DEV}/price-tables/tabela-inexistente`);
  c.assertApiError(x.r, x.body, 404, 'PRICE_TABLE_NOT_FOUND');
  x = await getJson(`/developments/outro-empreendimento/price-tables/${id}`);
  c.assertApiError(x.r, x.body, 404, 'DEVELOPMENT_NOT_FOUND');
});

test('commercial snapshot: price and priceTableVersion come from the same (current) table for every lot', async () => {
  const { body } = await getJson(`/developments/${DEV}/commercial/current`);
  assert.equal(body.priceTableVersion, dev.priceTables[0].version);
  for (const [id, p] of Object.entries(body.lots)) {
    assert.equal(p.commercial.priceTableVersion, body.priceTableVersion, id);
    assert.equal(p.commercial.price, json.byId.get(id).commercial.price, id);
  }
});

test('GET /health exposes status, version and timestamp only (no secrets)', async () => {
  const r = await fetch(srv.url + '/health');
  const body = await r.json();
  c.assertSchema(body, 'Health');
  assert.ok(!/postgres|password|DATABASE_URL|KEY/i.test(JSON.stringify(body)));
});
