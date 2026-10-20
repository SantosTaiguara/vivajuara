'use strict';
// Data lifecycle: STATIC / VERSIONED / DYNAMIC separation, snapshot validation, freshness policy and state, composition.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');

const plain = x => JSON.parse(JSON.stringify(x));
const codes = list => plain(list).map(e => e.code);
const T0 = Date.parse('2026-10-07T12:00:00.000Z'); // injected clock
const ago = ms => new Date(T0 - ms).toISOString();
const HOUR = 3600e3;

let App, L, repo, layers;
test.before(async () => {
  App = load();
  L = App.lifecycle;
  // a test development with time limits, so every branch of freshnessState can be reached (viva-juara has none)
  App.config.DEVELOPMENTS.push({ id: 'policy-dev', freshnessPolicy: { commercialMaxAgeMs: 1 * HOUR, availabilityMaxAgeMs: 1 * HOUR, commercialExpireAfterMs: 24 * HOUR, availabilityExpireAfterMs: 24 * HOUR } });
  repo = App.repos.LotRepository('viva-juara');
  await repo.load();
  layers = repo.getLayers();
});

// ------------------------------------------------------------------ separation
test('layers: every stored field belongs to exactly one layer, decided by the registry dynamicType', () => {
  assert.deepEqual([...L.LAYERS], ['static', 'analysis', 'commercial', 'availability']);
  const stored = App.model.getStoredFields().filter(f => !f.key.startsWith('metadata.'));
  const seen = new Map();
  for (const l of L.LAYERS) for (const f of L.FIELDS[l]) { assert.ok(!seen.has(f.key), `${f.key} in two layers`); seen.set(f.key, l); }
  assert.equal(seen.size, stored.length);
  for (const f of stored) {
    const l = seen.get(f.key);
    if (f.dynamicType === 'STATIC') assert.equal(l, 'static', f.key);
    else if (f.dynamicType === 'VERSIONED') assert.equal(l, 'analysis', f.key);
    else assert.equal(l, f.key.startsWith('availability.') ? 'availability' : 'commercial', f.key);
  }
  // spot checks of the contract
  assert.equal(seen.get('geometry.areaM2'), 'static');
  assert.equal(seen.get('geometry.polygon'), 'static');
  assert.equal(seen.get('identity.id'), 'static');
  assert.equal(seen.get('intelligence.scores.housing'), 'analysis');
  assert.equal(seen.get('intelligence.alerts'), 'analysis');
  assert.equal(seen.get('commercial.price'), 'commercial');
  assert.equal(seen.get('availability.status'), 'availability');
  assert.ok(L.FIELDS.commercial.every(f => f.key.startsWith('commercial.')));
  assert.ok(L.FIELDS.availability.every(f => f.key.startsWith('availability.')));
  // virtual fields are never stored in a layer
  assert.ok(!seen.has('mobility.routeToGate'));
  assert.ok(!seen.has('identity.developmentName'));
});

test('splitLotData: each part holds only its own layer fields; recomposition is lossless', () => {
  const lot = repo.getLotByCode('B79');
  const parts = L.splitLotData(lot);
  assert.equal(parts.static.geometry.areaM2, 291.78);
  assert.equal(parts.static.commercial, undefined);
  assert.equal(parts.static.intelligence, undefined);
  assert.equal(parts.static.availability, undefined);
  assert.equal(parts.versioned.geometry.areaM2, undefined);
  assert.equal(parts.versioned.geometry.usableGeometryScore, 8.5); // VERSIONED field inside the geometry domain
  assert.equal(parts.versioned.intelligence.class, 'A_PLUS');
  assert.equal(parts.versioned.commercial, undefined);
  assert.equal(parts.dynamic.commercial.commercial.price, lot.commercial.price);
  assert.equal(parts.dynamic.commercial.geometry, undefined);
  assert.equal(parts.dynamic.availability.availability.status, 'UNKNOWN');
  // provenance follows the field's layer
  for (const [k] of Object.entries(parts.static.provenance || {})) assert.equal(L.layerOf(App.model.field(k)), 'static', k);
  for (const [k] of Object.entries(parts.versioned.provenance || {})) assert.equal(L.layerOf(App.model.field(k)), 'analysis', k);
  // static + analysis + commercial + availability → the same Lot
  const id = lot.identity.id;
  const snap = (kind, part, meta) => L.snapshot(kind, 'viva-juara', meta, { [id]: part });
  const composed = L.composeOne(id, {
    static: snap('static', parts.static, { staticDataVersion: layers.static.staticDataVersion }),
    analysis: snap('analysis', parts.versioned, { analysisVersion: layers.analysis.analysisVersion }),
    commercial: { ...layers.commercial, lots: { [id]: parts.dynamic.commercial } },
    availability: { ...layers.availability, lots: { [id]: parts.dynamic.availability } }
  });
  const r = App.domain.LotFactory.create(composed);
  assert.equal(r.success, true);
  assert.equal(App.domain.serializeLot(r.lot), App.domain.serializeLot(lot));
});

test('repository snapshots carry their own version and only their own fields', () => {
  assert.equal(layers.static.kind, 'static');
  assert.equal(layers.static.staticDataVersion, '2026-10-06.1');
  assert.equal(layers.analysis.analysisVersion, '2026-10-06');
  assert.equal(layers.commercial.priceTableVersion, '2026-10-06');
  assert.equal(layers.availability.revision, 0);
  const ids = new Set(Object.keys(layers.static.lots));
  assert.equal(ids.size, 498);
  for (const k of L.LAYERS) assert.deepEqual(codes(L.validateSnapshot(layers[k], k, 'viva-juara', k === 'static' ? null : ids)), [], k);
  const v = plain(repo.getDataVersions());
  assert.deepEqual(v, { staticVersion: '2026-10-06.1', analysisVersion: '2026-10-06', priceTableVersion: '2026-10-06', availabilityRevision: 0 });
});

// ------------------------------------------------------------------ snapshot validation
test('validateSnapshot: every rule produces its error code', () => {
  const id = 'VJ-QB-L0079', ids = new Set([id]);
  const base = (kind, lots, meta) => ({ kind, schemaVersion: '1.0', developmentId: 'viva-juara', staticDataVersion: 's1', analysisVersion: 'a1', priceTableVersion: 'p1', revision: 1, ...meta, lots });
  const V = (s, kind, staticIds = ids) => codes(L.validateSnapshot(s, kind, 'viva-juara', staticIds));
  assert.deepEqual(V(null, 'static'), ['SNAPSHOT_KIND']);
  assert.deepEqual(V(base('analysis', {}), 'static'), ['SNAPSHOT_KIND']);
  assert.deepEqual(V(base('static', {}, { schemaVersion: '0.1' }), 'static', null), ['SCHEMA_MISMATCH']);
  assert.deepEqual(V(base('static', {}, { developmentId: 'other' }), 'static', null), ['DEVELOPMENT_MISMATCH']);
  assert.deepEqual(V(base('static', {}, { staticDataVersion: null }), 'static', null), ['MISSING_VERSION']);
  assert.deepEqual(V(base('static', null), 'static', null), ['NO_LOTS']);
  // a commercial field inside the static snapshot (no duplication across layers)
  assert.deepEqual(V(base('static', { [id]: { geometry: { areaM2: 1 }, commercial: { price: 1 } } }), 'static', null), ['LAYER_VIOLATION']);
  // a static field inside the commercial snapshot
  assert.deepEqual(V(base('commercial', { [id]: { commercial: { price: 1 }, geometry: { areaM2: 2 } } }), 'commercial'), ['LAYER_VIOLATION']);
  // provenance of another layer
  assert.deepEqual(V(base('commercial', { [id]: { commercial: { price: 1 }, provenance: { 'geometry.areaM2': { status: 'CONFIRMED' } } } }), 'commercial'), ['LAYER_VIOLATION']);
  // field outside the registry
  assert.deepEqual(V(base('analysis', { [id]: { intelligence: { mood: 'good' } } }), 'analysis'), ['UNKNOWN_FIELD']);
  // a lot that does not exist in the static data
  assert.deepEqual(V(base('availability', { 'VJ-QZ-L9999': { availability: { status: 'SOLD' } } }), 'availability'), ['ORPHAN_LOT']);
  // and a valid one
  assert.deepEqual(V(base('availability', { [id]: { availability: { status: 'SOLD' } } }), 'availability'), []);
});

// ------------------------------------------------------------------ freshness policy
test('FreshnessPolicy: defaults are all null (no time limit) and frozen', () => {
  assert.ok(Object.isFrozen(L.FreshnessPolicy));
  const keys = ['staticMaxAgeMs', 'analysisMaxAgeMs', 'commercialMaxAgeMs', 'availabilityMaxAgeMs', 'commercialExpireAfterMs', 'availabilityExpireAfterMs'];
  assert.deepEqual(Object.keys(L.FreshnessPolicy).sort(), keys.slice().sort());
  for (const k of keys) assert.equal(L.FreshnessPolicy[k], null, k);
});

test('policyFor: viva-juara keeps the null defaults; unknown dev → defaults; per-development override merges', () => {
  const vj = plain(L.policyFor('viva-juara'));
  for (const v of Object.values(vj)) assert.equal(v, null);
  assert.deepEqual(plain(L.policyFor('does-not-exist')), plain(L.FreshnessPolicy));
  const p = plain(L.policyFor('policy-dev'));
  assert.equal(p.commercialMaxAgeMs, HOUR);
  assert.equal(p.availabilityExpireAfterMs, 24 * HOUR);
  assert.equal(p.staticMaxAgeMs, null); // not overridden → default
  // the result is a copy: changing it never changes the policy
  const q = L.policyFor('policy-dev'); q.commercialMaxAgeMs = 1;
  assert.equal(L.policyFor('policy-dev').commercialMaxAgeMs, HOUR);
});

// ------------------------------------------------------------------ freshnessState matrix
const S = (kind, extra = {}) => ({ kind, developmentId: 'policy-dev', updatedAt: ago(10 * 60e3), lots: {}, ...extra });
const MATRIX = [
  // [name, snapshot, expected status]
  ['no snapshot', null, 'UNKNOWN'],
  // 1. validUntil passed → EXPIRED, before every other rule
  ['validUntil passed (commercial)', S('commercial', { validUntil: ago(1) }), 'EXPIRED'],
  ['validUntil passed beats missing availability updatedAt', S('availability', { updatedAt: null, validUntil: ago(1) }), 'EXPIRED'],
  ['validUntil passed beats CACHE', S('commercial', { source: 'CACHE', stale: true, validUntil: ago(HOUR) }), 'EXPIRED'],
  ['validUntil in the future → not expired', S('commercial', { validUntil: new Date(T0 + HOUR).toISOString() }), 'FRESH'],
  // 2. availability without updatedAt → UNKNOWN (even when cached or stale)
  ['availability without updatedAt', S('availability', { updatedAt: null }), 'UNKNOWN'],
  ['availability without updatedAt, CACHE', S('availability', { updatedAt: null, source: 'CACHE', stale: true }), 'UNKNOWN'],
  ['commercial without updatedAt is not UNKNOWN', S('commercial', { updatedAt: null }), 'FRESH'],
  // 3. past the expire limit → EXPIRED (reference = confirmedAt, else updatedAt for a remote copy)
  ['expired by updatedAt (REMOTE)', S('commercial', { updatedAt: ago(25 * HOUR) }), 'EXPIRED'],
  ['expired by confirmedAt', S('availability', { updatedAt: ago(1), confirmedAt: ago(25 * HOUR) }), 'EXPIRED'],
  ['expired beats stale flag', S('commercial', { updatedAt: ago(25 * HOUR), stale: true }), 'EXPIRED'],
  ['expired CACHE copy with old confirmation', S('commercial', { source: 'CACHE', stale: true, confirmedAt: ago(25 * HOUR) }), 'EXPIRED'],
  ['CACHE without confirmation never expires by age (no reference) → STALE', S('commercial', { source: 'CACHE', updatedAt: ago(100 * HOUR) }), 'STALE'],
  // 4. stale flag or CACHE / BUNDLED source → STALE
  ['stale flag', S('commercial', { stale: true }), 'STALE'],
  ['source CACHE', S('commercial', { source: 'CACHE' }), 'STALE'],
  ['source BUNDLED', S('commercial', { source: 'BUNDLED' }), 'STALE'],
  ['source MEMORY is not stale by itself', S('commercial', { source: 'MEMORY' }), 'FRESH'],
  ['availability CACHE with updatedAt', S('availability', { source: 'CACHE', stale: true }), 'STALE'],
  // 5. past maxAge → STALE
  ['older than maxAge', S('commercial', { updatedAt: ago(2 * HOUR) }), 'STALE'],
  ['confirmed recently although updated long ago', S('commercial', { updatedAt: ago(10 * HOUR), confirmedAt: ago(60e3) }), 'FRESH'],
  ['availability older than maxAge', S('availability', { updatedAt: ago(3 * HOUR) }), 'STALE'],
  // 6. otherwise FRESH
  ['fresh remote commercial', S('commercial'), 'FRESH'],
  ['fresh remote availability', S('availability', { source: 'REMOTE', stale: false }), 'FRESH']
];
for (const [name, snap, expected] of MATRIX) {
  test(`freshnessState: ${name} → ${expected}`, () => {
    assert.equal(L.freshnessState(snap, T0).status, expected);
    assert.equal(L.freshness(snap, T0), expected);
  });
}

test('freshnessState: default (null) policy never ages data; only confirmation decides', () => {
  const vj = extra => ({ kind: 'commercial', developmentId: 'viva-juara', lots: {}, ...extra });
  assert.equal(L.freshness(vj({ updatedAt: '2000-01-01T00:00:00Z' }), T0), 'FRESH');
  assert.equal(L.freshness(vj({ updatedAt: '2000-01-01T00:00:00Z', source: 'CACHE' }), T0), 'STALE');
  assert.equal(L.freshness(vj({ updatedAt: '2000-01-01T00:00:00Z', validUntil: '2001-01-01' }), T0), 'EXPIRED');
  assert.equal(L.freshness({ kind: 'availability', developmentId: 'viva-juara', lots: {}, updatedAt: '2000-01-01T00:00:00Z' }, T0), 'FRESH');
});

test('freshnessState: reported metadata', () => {
  assert.deepEqual(plain(L.freshnessState(null)), { status: 'UNKNOWN', lastSuccessfulSyncAt: null, sourceUpdatedAt: null, maxAgePolicy: null, source: null });
  const s = L.freshnessState(S('commercial', { confirmedAt: ago(60e3), updatedAt: ago(HOUR / 2) }), T0);
  assert.equal(s.lastSuccessfulSyncAt, ago(60e3));
  assert.equal(s.sourceUpdatedAt, ago(HOUR / 2));
  assert.equal(s.maxAgePolicy, HOUR);
  assert.equal(s.source, 'REMOTE'); // default when not informed
  assert.equal(L.freshnessState(S('commercial', { source: 'CACHE' }), T0).source, 'CACHE');
  assert.equal(L.freshnessState({ kind: 'commercial', developmentId: 'viva-juara', lots: {} }, T0).maxAgePolicy, null);
});

// ------------------------------------------------------------------ compose / composeOne
test('compose: all 498 lots from the four layers, versions and freshness in metadata', () => {
  const res = L.compose(layers, T0);
  assert.equal(res.lots.length, 498);
  assert.equal(res.rejected.length, 0);
  assert.deepEqual(plain(res.orphans), []);
  const l = res.lots.find(x => x.identity.code === 'B79');
  assert.deepEqual(plain(l.metadata.dataVersions), { staticVersion: '2026-10-06.1', analysisVersion: '2026-10-06', priceTableVersion: '2026-10-06', availabilityRevision: 0 });
  assert.deepEqual(plain(l.metadata.freshness), { commercial: 'FRESH', availability: 'UNKNOWN' });
  assert.equal(l.availability.freshness, 'UNKNOWN');
  assert.equal(l.metadata.schemaVersion, '1.0');
});

test('compose: without static data it refuses to build lots', () => {
  assert.throws(() => L.compose({ analysis: layers.analysis }), e => /estáticos ausentes/.test(e.message));
});

test('compose: a missing layer gives null/UNKNOWN values, never a semantic default', () => {
  const res = L.compose({ static: layers.static }, T0);
  assert.equal(res.lots.length, 498);
  assert.equal(res.rejected.length, 0);
  for (const l of res.lots) {
    assert.equal(l.commercial.price, null);
    assert.equal(l.availability.status, 'UNKNOWN');
    assert.equal(l.availability.freshness, 'UNKNOWN');
    assert.equal(l.intelligence.class, 'UNKNOWN');
    assert.equal(l.intelligence.scores.housing, null);
    assert.equal(l.environmental.noiseLevel, null); // never "LOW"
    assert.deepEqual(plain(l.intelligence.alerts), []);
    assert.deepEqual(plain(l.metadata.freshness), { commercial: 'UNKNOWN', availability: 'UNKNOWN' });
    assert.equal(l.metadata.dataVersions.analysisVersion, null);
    assert.ok(l.geometry.areaM2 > 0);
  }
});

test('compose: orphans in dynamic/analysis layers are reported and ignored', () => {
  const extra = { ...layers.availability, lots: { ...layers.availability.lots, 'VJ-QZ-L0001': { availability: { status: 'SOLD' } } } };
  const res = L.compose({ ...layers, availability: extra }, T0);
  assert.equal(res.lots.length, 498);
  assert.deepEqual(plain(res.orphans), [{ layer: 'availability', lotId: 'VJ-QZ-L0001' }]);
  assert.ok(L.log.some(e => e.event === 'orphan ignored' && e.lotId === 'VJ-QZ-L0001'));
});

test('composeOne: availability freshness follows the snapshot only when the status is known', () => {
  const id = 'VJ-QB-L0079';
  const av = st => ({ kind: 'availability', developmentId: 'viva-juara', revision: 3, updatedAt: ago(60e3), lots: { [id]: { availability: { ...App.availability.EMPTY(), status: st, updatedAt: ago(60e3), revision: 3 } } } });
  const d = L.composeOne(id, { ...layers, availability: av('SOLD') }, T0);
  assert.equal(d.availability.status, 'SOLD');
  assert.equal(d.availability.freshness, 'FRESH');
  assert.equal(d.metadata.dataVersions.availabilityRevision, 3);
  const stale = L.composeOne(id, { ...layers, availability: { ...av('SOLD'), source: 'CACHE', stale: true } }, T0);
  assert.equal(stale.availability.freshness, 'STALE');
  const unk = L.composeOne(id, { ...layers, availability: av('UNKNOWN') }, T0);
  assert.equal(unk.availability.freshness, 'UNKNOWN');
  // a lot absent from the availability snapshot stays UNKNOWN (never AVAILABLE)
  const missing = L.composeOne(id, { ...layers, availability: { ...av('SOLD'), lots: {} } }, T0);
  assert.equal(missing.availability.status, 'UNKNOWN');
  assert.equal(missing.availability.freshness, 'UNKNOWN');
});

test('composeOne: commercial freshness EXPIRED when the table validity passed', () => {
  const d = L.composeOne('VJ-QB-L0079', { ...layers, commercial: { ...layers.commercial, validUntil: '2026-01-01' } }, T0);
  assert.equal(d.metadata.freshness.commercial, 'EXPIRED');
});

// ------------------------------------------------------------------ diff, impact, cache
test('diff: only the changed lot and field are reported', () => {
  const id = 'VJ-QB-L0079';
  const next = plain(layers.commercial);
  next.priceTableVersion = 'x';
  next.lots[id].commercial.price = 1;
  const ch = L.diff(layers.commercial, next);
  assert.equal(ch.domain, 'commercial');
  assert.deepEqual(plain(ch.changedLotIds), [id]);
  assert.deepEqual(plain(ch.changedFields), ['commercial.price']);
  assert.equal(ch.version, 'x');
  assert.equal(ch.previousVersion, '2026-10-06');
  assert.equal(L.diff(null, layers.availability).changedLotIds.length, 498);
});

test('impactOf: area changes ripple to price and down payment; price never to geometry', () => {
  const a = L.impactOf('geometry.areaM2');
  assert.equal(a.layer, 'static');
  assert.deepEqual(plain(a.fields).sort(), ['commercial.downPaymentDefaultValue', 'commercial.price']);
  const p = L.impactOf('commercial.price');
  assert.ok(p.fields.every(f => f.startsWith('commercial.')));
  assert.equal(p.layer, 'commercial');
});

test('DataCache: keyed by layer:development:version, invalidated per domain only', () => {
  const c = L.DataCache();
  const k1 = c.put(layers.static), k2 = c.put(layers.commercial);
  assert.equal(k1, 'static:viva-juara:2026-10-06.1');
  assert.equal(k2, 'commercial:viva-juara:2026-10-06');
  c.invalidate('commercial', 'viva-juara');
  assert.deepEqual(plain(c.keys()), [k1]);
  assert.equal(c.get(k1), layers.static);
  assert.equal(c.get(k2), null);
});

// ------------------------------------------------------------------ update channels respect the separation
test('a new price table changes only commercial data (geometry, analysis and availability untouched)', async () => {
  const r2 = App.repos.LotRepository('viva-juara'); await r2.load();
  const before = r2.getLotByCode('B79');
  const t = { ...App.config.DEVELOPMENTS[0].priceTables[0], id: 'tabela-2', version: '2026-11-01', pricePerM2: 1300 };
  const res = r2.applyPriceTable(t);
  assert.equal(res.applied, true);
  assert.equal(res.change.changedLotIds.length, 498);
  const after = r2.getLotByCode('B79');
  assert.equal(after.commercial.price, Math.round(291.78 * 1300 * 100) / 100);
  assert.equal(after.commercial.priceTableVersion, '2026-11-01');
  for (const k of ['identity', 'geometry', 'location', 'surroundings', 'mobility', 'environmental', 'construction', 'intelligence', 'availability']) assert.deepEqual(plain(after[k]), plain(before[k]), k);
  assert.equal(r2.getLayers().static, r2.getLayers().static);
  assert.equal(r2.getDataVersions().staticVersion, '2026-10-06.1');
});

test('an analysis update with the same version is ignored; an invalid one never replaces the previous', async () => {
  const r2 = App.repos.LotRepository('viva-juara'); await r2.load();
  const prev = r2.getLayers().analysis;
  assert.deepEqual(plain(r2.applyAnalyticalUpdate(prev)), { applied: false, reason: 'mesma versão' });
  const bad = plain(prev); bad.analysisVersion = '2027-01-01'; bad.lots['VJ-QB-L0079'].commercial = { price: 1 };
  const res = r2.applyAnalyticalUpdate(bad);
  assert.equal(res.applied, false);
  assert.ok(codes(res.errors).includes('LAYER_VIOLATION'));
  assert.equal(r2.getDataVersions().analysisVersion, '2026-10-06');
  assert.equal(r2.getLotByCode('B79').intelligence.class, 'A_PLUS');
});

test('a structural correction recomputes the price from the new area (commercial depends on area)', async () => {
  const r2 = App.repos.LotRepository('viva-juara'); await r2.load();
  const st = plain(r2.getLayers().static); st.staticDataVersion = '2026-10-07.1'; st.lots['VJ-QB-L0079'].geometry.areaM2 = 300;
  const res = r2.applyStructuralUpdate(st);
  assert.equal(res.applied, true);
  const l = r2.getLotByCode('B79');
  assert.equal(l.geometry.areaM2, 300);
  assert.equal(l.commercial.price, 300 * 1196);
  assert.equal(l.intelligence.class, 'A_PLUS'); // analysis kept
  assert.equal(r2.getDataVersions().staticVersion, '2026-10-07.1');
});
