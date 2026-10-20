'use strict';
// Three-level filter system (topic 17): parity with the previous filters, null policies, facets, URL and hash.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');
const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m);
let App, lots, F, byCode;
test.before(async () => { App = load(); const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync(); F = App.filters; byCode = new Map(lots.map(l => [l.identity.code, l])); });
const ids = (state, ctx = {}) => F.run(lots, F.compile(state).query, ctx).matchedIds;

/** the previous FilteringService, verbatim semantics, as the reference */
function legacy(l, f, ctx) {
  const CR = { A_PLUS: 0, A: 1, B: 2, C: 3, D: 4 }, LV = { VERY_LOW: 0, LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 };
  const T = { priceMin: v => l.commercial.price != null && l.commercial.price >= v, priceMax: v => l.commercial.price != null && l.commercial.price <= v, areaMin: v => l.geometry.areaM2 != null && l.geometry.areaM2 >= v,
    areaMax: v => l.geometry.areaM2 != null && l.geometry.areaM2 <= v, block: v => l.identity.blockId === v, statuses: v => !v.length || v.includes(l.availability.status), classMin: v => CR[l.intelligence.class] <= CR[v],
    trafficMax: v => LV[l.mobility.estimatedTraffic] <= LV[v], greenBehind: v => !v || l.surroundings.hasGreenRear === true, noCorner: v => !v || l.geometry.isCorner === false,
    noNoiseAlert: v => !v || !l.intelligence.alerts.some(x => x.type === 'NOISE'), favoritesOnly: v => !v || ctx.favorites.has(l.identity.id) };
  return Object.entries(f).every(([k, v]) => v == null || v === false || (Array.isArray(v) && !v.length) || T[k](v));
}
test('parity with the previous filters on the legacy keys', () => {
  const favorites = new Set(lots.slice(0, 40).map(l => l.identity.id));
  const states = [{ priceMax: 350000 }, { priceMin: 400000, priceMax: 600000 }, { areaMin: 300, areaMax: 450 }, { block: 'B' }, { classMin: 'A' }, { trafficMax: 'LOW' }, { greenBehind: true },
    { noCorner: true }, { noNoiseAlert: true }, { favoritesOnly: true }, { statuses: ['UNKNOWN'] }, { classMin: 'B', greenBehind: true, priceMax: 450000, noCorner: true, trafficMax: 'MEDIUM' }];
  for (const s of states) {
    const got = ids(s, { favorites }), exp = new Set(lots.filter(l => legacy(l, s, { favorites })).map(l => l.identity.id));
    assert.equal(got.size, exp.size, JSON.stringify(s)); for (const id of exp) assert.ok(got.has(id));
  }
});
test('only offerable: zero lots today (availability UNKNOWN is never AVAILABLE)', () => {
  assert.equal(ids({ onlyOfferable: true }, { policy: {} }).size, 0);
  assert.equal(ids({ statuses: ['AVAILABLE'] }).size, 0);
});
test('null policy: unknown never matches a value condition, and null is not zero', () => {
  const l = lots[0], fake = [{ ...l, environmental: { ...l.environmental, noiseLevel: null } }];
  const q = F.compile({ noiseMax: 'VERY_HIGH' }).query;
  assert.equal(F.run(fake, q).matchedIds.size, 0);
  const p = F.compile({ priceMax: 1e9 }).query, nop = [{ ...l, commercial: { ...l.commercial, price: null } }];
  assert.equal(F.run(nop, p).matchedIds.size, 0);
  deq(F.whyNot(nop[0], p), [{ filterId: 'price', fieldKey: 'commercial.price', value: null, unknown: true }]);
});
test('compiler: stable hash and order, invalid values reported, never fail open', () => {
  const a = F.compile({ priceMax: 400000, block: 'B', statuses: ['RESERVED', 'AVAILABLE'] }).query, b = F.compile({ statuses: ['AVAILABLE', 'RESERVED'], block: 'B', priceMax: 400000 }).query;
  assert.equal(a.hash, b.hash); deq(a.conditions.map(c => c.filterId), ['block', 'price', 'statuses']);
  const bad = F.compile({ areaMin: 500, areaMax: 300, noiseMax: 'LOUD', statuses: ['NOPE'] });
  deq(bad.errors.map(e => e.code).sort(), ['INVALID_ENUM', 'INVALID_ENUM', 'INVALID_RANGE']);
  assert.equal(bad.query.conditions.length, 0);
  assert.equal(F.compile({ classMin: 'A', scoreMin: 80 }, { mode: 'client' }).query.conditions.length, 0, 'technical/broker filters are not applied in client mode');
  assert.equal(F.run(lots, { ...a, developmentId: 'other' }, { developmentId: 'viva-juara' }).status, 'INVALID');
});
test('levels: quick, advanced and technical; client mode sees no technical filter', () => {
  const lv = d => F.DEFS.filter(x => x.level === d).map(x => x.id);
  deq(lv('QUICK'), ['statuses', 'onlyOfferable', 'block', 'price', 'area', 'classMin', 'noCorner', 'q']);
  assert.ok(lv('TECHNICAL').every(id => !F.BY[id].clientVisible));
  deq(F.levelsFor('client'), ['QUICK', 'ADVANCED']);
});
test('new filters: orientation, distances, shape, score, alerts, fit, data status', () => {
  const north = ids({ rearOrientation: ['N', 'NE', 'NW'] });
  assert.ok(north.size > 0 && [...north].every(id => ['N', 'NE', 'NW'].includes(lots.find(l => l.identity.id === id).environmental.orientationRear)));
  assert.ok([...ids({ gateMaxM: 200 })].every(id => lots.find(l => l.identity.id === id).mobility.routeDistanceToGateM <= 200));
  assert.ok([...ids({ scoreKey: 'premium', scoreMin: 80 })].every(id => lots.find(l => l.identity.id === id).intelligence.scores.premium >= 80));
  assert.ok([...ids({ alertsExclude: ['AVENUE', 'NOISE'] })].every(id => !lots.find(l => l.identity.id === id).intelligence.alerts.some(a => ['AVENUE', 'NOISE'].includes(a.type))));
  const fit = new Map(lots.map((l, i) => [l.identity.id, { fitScore: i % 100 }]));
  assert.equal(ids({ fitMin: 80 }, { fit }).size, lots.filter((l, i) => i % 100 >= 80).length);
  const r = F.run(lots, F.compile({ fitMin: 80 }).query, {}); assert.ok(r.warnings.some(w => w.code === 'FIT_UNAVAILABLE')); assert.equal(r.matchedIds.size, 0);
  assert.equal(ids({ dataStatusField: 'surroundings.hasGreenRear', dataStatus: ['UNKNOWN'] }).size, lots.filter(l => App.model.getFieldProvenance(l, 'surroundings.hasGreenRear').status === 'UNKNOWN').length);
});
test('facets are self-excluding and count UNKNOWN separately', () => {
  const q = F.compile({ statuses: ['AVAILABLE'], block: 'B' }).query, fc = F.facets(lots, q, {});
  assert.equal(fc.statuses.UNKNOWN, lots.filter(l => l.identity.blockId === 'B').length, 'status counts ignore the status filter itself');
  assert.equal(Object.values(fc.block).reduce((a, b) => a + b, 0), 0, 'blocks counted under the status filter (no AVAILABLE lot today)');
  const st = F.rangeStats(lots, 'commercial.price'); assert.ok(st.min > 0 && st.max > st.min && st.unknown === 0);
});
test('stale data adds a warning instead of hiding lots', () => {
  const r = F.run(lots, F.compile({ priceMax: 400000 }).query, { freshness: { commercial: { status: 'STALE' } } });
  assert.ok(r.warnings.some(w => w.code === 'STALE_PRICE')); assert.ok(r.matchedIds.size > 0);
});
test('URL serialization round-trips, drops unknown parts and never carries favorites', () => {
  const s = { statuses: ['RESERVED', 'AVAILABLE'], priceMax: 400000, areaMin: 300, noCorner: true, favoritesOnly: true, scoreKey: 'premium', scoreMin: 70 };
  const str = F.serialize(s); assert.ok(!/fv/.test(str));
  const back = F.parse(str + ';zz:1;p1:abc');
  assert.equal(F.compile(back.state).query.hash, F.compile({ ...s, favoritesOnly: false }).query.hash);
  deq(back.dropped, ['zz:1', 'p1:abc']);
  assert.equal(F.serialize(s), F.serialize({ ...s, statuses: ['AVAILABLE', 'RESERVED'] }));
});
test('filters do not mutate their inputs and run fast on 498 lots', () => {
  const s = Object.freeze({ priceMax: 450000, statuses: Object.freeze(['UNKNOWN']), greenBehind: true });
  const t0 = Date.now(); for (let i = 0; i < 50; i++) ids(s); assert.ok(Date.now() - t0 < 1500);
  assert.equal(F.without(s, 'price').priceMax, undefined); assert.equal(s.priceMax, 450000);
});

// ---------------------------------------------------------------- FilterResult v2: unmatched, facets, impacts, diagnostics, dropped
test('FilterResult: unmatched ids, self-excluding facets with options, status OK', () => {
  const r = F.run(lots, F.compile({ block: 'B', shapes: ['RECTANGULAR'] }).query, {});
  assert.equal(r.status, 'OK'); assert.equal(r.matchedIds.size + r.unmatchedLotIds.size, lots.length);
  for (const id of r.matchedIds) assert.ok(!r.unmatchedLotIds.has(id));
  const blockB = lots.filter(l => l.identity.blockId === 'B');
  deq(r.facets.shapes.counts, blockB.reduce((m, l) => (m[l.geometry.shape] = (m[l.geometry.shape] || 0) + 1, m), {}), 'shape counts ignore the shape filter itself');
  assert.ok(r.facets.shapes.options.find(o => o.value === 'RECTANGULAR').selected); assert.ok(!r.facets.shapes.options.find(o => o.value === 'SQUARE').selected);
  deq(r.facets.statuses.counts, F.facets(lots, F.compile({ block: 'B', shapes: ['RECTANGULAR'] }).query, {}).statuses, 'same counts as facets()');
  assert.equal(r.diagnostics.zeroResult, false); assert.equal(r.diagnostics.suggestions.length, 0);
});
test('FilterImpact per condition and zero-result diagnostics: which single removal gives results, and how many (never applied)', () => {
  const st = { statuses: ['AVAILABLE'], block: 'B', priceMax: 400000 }, r = F.run(lots, F.compile(st).query, {});
  assert.equal(r.matchedIds.size, 0); assert.equal(r.diagnostics.zeroResult, true); assert.equal(r.diagnostics.code, 'ZERO_RESULTS');
  for (const [k, x] of r.diagnostics.impacts.entries()) { assert.equal(x.rejectedCount, x.beforeCount - x.afterCount); if (k) assert.equal(x.beforeCount, r.diagnostics.impacts[k - 1].afterCount); }
  assert.equal(r.diagnostics.impacts[0].beforeCount, lots.length);
  const s = r.diagnostics.suggestions; assert.equal(s.length, 1); assert.equal(s[0].filterId, 'statuses');
  assert.equal(s[0].resultCount, ids({ block: 'B', priceMax: 400000 }).size);
  assert.equal(r.matchedIds.size, 0, 'the diagnostic never relaxes the query');
});
test('invalid or hidden conditions are listed as NOT applied in every mode and the result is PARTIAL', () => {
  for (const mode of ['client', 'broker']) {
    const c = F.compile({ noiseMax: 'LOUD', priceMax: 400000, shapes: ['RECTANGULAR', 'NOPE'] }, { mode });
    const d = Object.fromEntries(c.query.dropped.map(x => [x.filterId, x]));
    assert.equal(d.noiseMax.applied, false); assert.equal(d.noiseMax.code, 'INVALID_ENUM');
    assert.equal(d.shapes.applied, 'PARTIAL'); deq(d.shapes.values, ['NOPE']);
    assert.equal(F.run(lots, c.query, {}).status, 'PARTIAL', mode);
  }
  const h = F.compile({ classMin: 'A', priceMax: 400000 }, { mode: 'client' });
  assert.equal(h.query.dropped[0].code, 'HIDDEN_IN_MODE'); assert.equal(h.errors.length, 0); assert.equal(F.run(lots, h.query, {}).status, 'PARTIAL');
  assert.equal(F.compile({ priceMax: 400000 }).query.dropped.length, 0);
});
test('fitMin, fit coverage and fit confidence accept 0–100 only', () => {
  for (const [k, v, ok] of [['fitMin', 150, false], ['fitMin', -1, false], ['fitMin', 'x', false], ['fitMin', 0, true], ['fitMin', 100, true], ['fitCoverageMin', 101, false], ['fitConfidenceMin', 60, true]]) {
    const c = F.compile({ [k]: v }); assert.equal(c.query.conditions.length === 1, ok, `${k}=${v}`); if (!ok) assert.equal(c.errors[0].code, 'INVALID_FILTER_VALUE');
  }
  const fit = new Map(lots.map((l, i) => [l.identity.id, { fitScore: 80, coverage: (i % 4) / 3, confidence: { value: i % 2 ? 0.9 : 0.4 } }]));
  assert.equal(ids({ fitCoverageMin: 100 }, { fit }).size, lots.filter((l, i) => i % 4 === 3).length);
  assert.equal(ids({ fitConfidenceMin: 85 }, { fit }).size, lots.filter((l, i) => i % 2).length);
  assert.ok(F.run(lots, F.compile({ fitCoverageMin: 50 }).query, {}).warnings.some(w => w.code === 'FIT_UNAVAILABLE'));
});
test('link guard: over-long links are reported (never cut silently) and refused on parse', () => {
  const ok = F.serializeChecked({ priceMax: 400000 }); assert.ok(ok.ok); assert.equal(ok.value, F.serialize({ priceMax: 400000 }));
  const no = F.serializeChecked({ priceMax: 400000, q: 'B79' }, { maxLength: 10 }); assert.equal(no.ok, false); assert.equal(no.code, 'LINK_TOO_LONG'); assert.equal(no.value, null);
  const big = F.parse('tx:' + 'A'.repeat(F.MAX_LINK_LENGTH * 5)); assert.equal(big.errors[0].code, 'LINK_TOO_LONG'); deq(big.state, {});
  const back = F.parse(F.serialize({ q: 'Q B', pricePerM2Min: 900, includeUnknown: ['noiseMax'], noiseMax: 'LOW' }));
  assert.equal(F.compile(back.state).query.hash, F.compile({ q: 'Q B', pricePerM2Min: 900, includeUnknown: ['noiseMax'], noiseMax: 'LOW' }).query.hash);
});
test('query migration: an unversioned query becomes the current version; a newer version is refused, never half-applied', () => {
  const cur = F.compile({ priceMax: 400000, block: 'B' }).query;
  const v0 = { developmentId: 'viva-juara', conditions: cur.conditions.map(c => ({ filterId: c.filterId, value: c.value })) };
  const m = F.migrateQuery(v0); assert.ok(m.ok && m.migrated); assert.equal(m.query.version, F.QUERY_VERSION); assert.equal(m.query.hash, cur.hash);
  assert.equal(m.warnings[0].code, 'QUERY_MIGRATED');
  const r = F.run(lots, v0, {}); deq([...r.matchedIds].sort(), [...F.run(lots, cur, {}).matchedIds].sort()); assert.ok(r.warnings.some(w => w.code === 'QUERY_MIGRATED'));
  const future = F.run(lots, { ...cur, version: F.QUERY_VERSION + 1 }, {});
  assert.equal(future.status, 'INVALID'); assert.equal(future.matchedIds.size, 0); assert.equal(future.warnings[0].code, 'UNSUPPORTED_QUERY_VERSION');
  const unk = F.migrateQuery({ version: 1, conditions: [{ filterId: 'nope', value: 1 }] }); assert.equal(unk.query.conditions.length, 0); assert.equal(unk.query.dropped[0].filterId, 'nope');
  assert.equal(F.migrateQuery(null).errors[0].code, 'INVALID_QUERY');
  deq(F.migrateState({ priceMax: 1, zz: 2 }).dropped, ['zz']);
});
test('text search on lot / block code (q) uses the search grammar', () => {
  deq([...ids({ q: 'B79' })], ['VJ-QB-L0079']);
  const blockB = lots.filter(l => l.identity.blockId === 'B').map(l => l.identity.id).sort();
  deq([...ids({ q: 'Quadra B' })].sort(), blockB); deq([...ids({ q: 'q b' })].sort(), blockB);
  deq([...ids({ q: '79' })].sort(), lots.filter(l => l.identity.lotNumber === 79).map(l => l.identity.id).sort());
  assert.equal(ids({ q: 'ZZ999' }).size, 0);
  assert.equal(F.compile({ q: 'B79' }, { mode: 'client' }).query.conditions.length, 1, 'client mode can search');
  assert.equal(F.compile({ q: 'x'.repeat(80) }).errors[0].code, 'INVALID_FILTER_VALUE');
});
test('new ranges: price per m², frontage and depth (unknown never matches)', () => {
  const inR = (st, k, lo, hi) => { const got = ids(st); const exp = lots.filter(l => { const v = App.model.get(l, k); return v != null && (lo == null || v >= lo) && (hi == null || v <= hi); }); assert.equal(got.size, exp.length, k); assert.ok(exp.every(l => got.has(l.identity.id))); };
  const ppm = F.rangeStats(lots, 'commercial.pricePerM2'), fr = F.rangeStats(lots, 'geometry.frontM'), dp = F.rangeStats(lots, 'geometry.averageDepthM');
  inR({ pricePerM2Min: ppm.min, pricePerM2Max: ppm.max }, 'commercial.pricePerM2', ppm.min, ppm.max); inR({ pricePerM2Max: ppm.min - 1 }, 'commercial.pricePerM2', null, ppm.min - 1); // one price per m² today
  inR({ frontMin: 12 }, 'geometry.frontM', 12, null); inR({ depthMax: (dp.min + dp.max) / 2 }, 'geometry.averageDepthM', null, (dp.min + dp.max) / 2);
  assert.equal(F.compile({ frontMin: 20, frontMax: 10 }).errors[0].code, 'INVALID_RANGE');
  const l = lots[0], nf = [{ ...l, geometry: { ...l.geometry, frontM: null } }];
  assert.equal(F.run(nf, F.compile({ frontMin: 0 }).query).matchedIds.size, 0, 'null is not 0');
  assert.ok(fr.count > 0);
});
test('"não informado" is an explicit option: null never matches a level unless the user picks it', () => {
  const l = lots[0], nul = { ...l, identity: { ...l.identity, id: 'VJ-QX-L0001' }, environmental: { ...l.environmental, noiseLevel: null }, geometry: { ...l.geometry, shape: null } }, set = [l, nul];
  const m = st => [...F.run(set, F.compile(st).query, {}).matchedIds];
  deq(m({ noiseMax: 'VERY_HIGH' }), [l.identity.id]);
  deq(m({ noiseMax: 'UNKNOWN' }), ['VJ-QX-L0001']);
  deq(m({ noiseMax: 'VERY_HIGH', includeUnknown: ['noiseMax'] }).sort(), [l.identity.id, 'VJ-QX-L0001'].sort());
  deq(m({ shapes: ['UNKNOWN'] }), l.geometry.shape === 'UNKNOWN' ? [l.identity.id, 'VJ-QX-L0001'] : ['VJ-QX-L0001']);
  assert.notEqual(F.compile({ noiseMax: 'LOW', includeUnknown: ['noiseMax'] }).query.hash, F.compile({ noiseMax: 'LOW' }).query.hash);
  assert.equal(F.compile({ includeUnknown: ['price'] }).errors[0].code, 'INVALID_ENUM', 'only filters that offer "não informado"');
  for (const id of ['noiseMax', 'privacyMin', 'trafficMax', 'shapes']) assert.ok(F.BY[id].options().includes('UNKNOWN'), id);
  const fresh = ids({ freshness: ['UNKNOWN'] }); assert.equal(fresh.size, lots.filter(x => x.availability.freshness === 'UNKNOWN' || x.availability.freshness == null).length);
  assert.equal(ids({ freshness: ['FRESH'] }).size, lots.filter(x => x.availability.freshness === 'FRESH').length);
});
test('quick filter order: registry order on desktop, mobilePriority on mobile, client mode without technical', () => {
  deq(F.quickFilterOrder('broker', false), F.DEFS.filter(d => d.level === 'QUICK').map(d => d.id));
  const mob = F.quickFilterOrder('client', true);
  assert.equal(mob[0], 'q'); assert.ok(!mob.includes('classMin'));
  const pr = mob.map(id => F.BY[id].mobilePriority ?? 99); assert.ok(pr.every((p, i) => !i || p >= pr[i - 1]));
});
