'use strict';
// RecommendationEngine follow-ups (topic 15) and Fit robustness (topic 14): ExcludedLotDetail, lot diagnostics,
// data-derived constraint conflicts (never relaxed), primary review reason, Fit config validation, matcher failures,
// result validation, cache key with the data, data-derived profile warnings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');

let App, lots, fitCfg, pol, byId;
test.before(async () => {
  App = load(); const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync();
  fitCfg = App.fit.cfgOf('viva-juara'); pol = App.recommendation.policyOf('viva-juara'); byId = new Map(lots.map(l => [l.identity.id, l]));
});
const withStatus = (l, status) => ({ ...l, availability: { ...l.availability, status } });
const profile = (prefs, extra = {}) => App.fit.buildProfile({ preferences: prefs, ...extra });
const C = (k, v) => App.recommendation.constraint(k, v, pol);
const rec = (p, extra = {}) => App.recommendation.recommend({ developmentId: 'viva-juara', profile: p, constraints: [], lots, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: {}, ...extra });
const mixed = () => lots.map((l, i) => withStatus(l, i % 3 === 0 ? 'AVAILABLE' : i % 3 === 1 ? 'SOLD' : 'UNKNOWN'));

test('excluded: one ExcludedLotDetail per excluded lot; every lot is recommended, in review, excluded or out of scope', () => {
  const ls = mixed(), r = rec(profile({ privacy: 3, quiet: 2 }), { lots: ls, constraints: [C('budgetMax', 450000), C('noCorner', true)] });
  assert.equal(r.excluded.length, r.ineligibleCount + r.lowFitCount);
  const eligible = [...r.recommendations.map(x => x.lotId), ...r.overflow.eligibleLotIds], review = [...r.reviewCandidates.map(x => x.lotId), ...r.overflow.reviewLotIds], ex = r.excluded.map(x => x.lotId);
  assert.equal(review.length, r.reviewRequiredCount); assert.equal(eligible.length + r.lowFitCount, r.eligibleCount);
  const all = [...eligible, ...review, ...ex]; assert.equal(new Set(all).size, all.length, 'disjoint'); assert.equal(all.length + r.outOfScopeCount, ls.length, 'nothing disappears');
  const sold = r.excluded.find(x => x.reasonCode === 'SOLD');
  assert.equal(sold.stage, 'SYSTEM_ELIGIBILITY'); assert.equal(sold.metricKey, 'availability.status'); assert.equal(sold.actualValue, 'SOLD'); assert.deepEqual([...sold.expectedValue], ['AVAILABLE']);
  const price = r.excluded.find(x => x.reasonCode === 'PRICE_ABOVE_MAX');
  assert.equal(price.stage, 'HARD_CONSTRAINT'); assert.equal(price.metricKey, 'commercial.price'); assert.equal(price.expectedValue, 450000); assert.equal(price.constraintLabel, 'Preço até');
  assert.equal(price.actualValue, byId.get(price.lotId).commercial.price); assert.ok(price.actualValue > 450000);
  const corner = r.excluded.find(x => x.reasonCode === 'CORNER_LOT'); assert.equal(corner.actualValue, true); assert.equal(corner.constraintKey, 'noCorner');
  const low = r.excluded.find(x => x.reasonCode === 'LOW_FIT'); assert.equal(low.stage, 'FIT_THRESHOLD'); assert.ok(low.actualValue < pol.minimumFitScore); assert.equal(low.expectedValue, pol.minimumFitScore);
  for (const code of Object.keys(r.exclusionSummary)) assert.equal(r.excluded.filter(x => x.reasonCode === code).length, r.exclusionSummary[code], code);
  assert.equal(App.recommendation.excludedOf(r, price.lotId).reasonCode, 'PRICE_ABOVE_MAX'); assert.equal(App.recommendation.excludedOf(r, 'nope'), null);
});
test('diagnostics: invalid lot, other development and the explicit scope are reported with a reason', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  ls[3] = { ...ls[3], identity: { ...ls[3].identity, developmentId: 'outro' } }; ls.push({ geometry: {} });
  const r = rec(profile({ privacy: 3 }), { lots: ls, scope: { blockIds: ['B'] } });
  const d = code => r.diagnostics.filter(x => x.code === code);
  assert.equal(d('INVALID_LOT').length, 1); assert.equal(d('INVALID_LOT')[0].reason, 'MISSING_IDENTITY'); assert.equal(d('INVALID_LOT')[0].index, ls.length - 1);
  assert.equal(d('OTHER_DEVELOPMENT')[0].lotId, lots[3].identity.id);
  const sc = d('OUT_OF_SCOPE')[0]; assert.equal(sc.reason, 'EXPLICIT_SCOPE'); assert.equal(sc.count + 2, r.outOfScopeCount); assert.ok(sc.lotIds.every(id => byId.get(id).identity.blockId !== 'B'));
});
test('conflicts from the data: budget below the cheapest lot of the accepted area is a warning, never relaxed', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE')), areaMin = 400;
  const cheapest = Math.min(...lots.filter(l => l.geometry.areaM2 >= areaMin).map(l => l.commercial.price));
  const r = rec(profile({ privacy: 3 }), { lots: ls, constraints: [C('budgetMax', cheapest - 1), C('areaMin', areaMin)] });
  const w = r.conflicts.find(x => x.code === 'BUDGET_BELOW_CHEAPEST_MATCH');
  assert.ok(w); assert.equal(w.bestAvailableValue, cheapest); assert.equal(w.autoRelaxed, false); assert.equal(w.severity, 'WARNING');
  assert.equal(w.matchingOtherConstraintsCount, lots.filter(l => l.geometry.areaM2 >= areaMin).length);
  assert.ok(r.diagnostics.some(x => x.code === 'BUDGET_BELOW_CHEAPEST_MATCH'));
  assert.equal(r.recommendations.length, 0); assert.equal(r.status, 'NO_ELIGIBLE_LOTS', 'the constraint stays hard');
  const ok = rec(profile({ privacy: 3 }), { lots: ls, constraints: [C('budgetMax', cheapest), C('areaMin', areaMin)] });
  assert.equal(ok.conflicts.length, 0); assert.ok(ok.recommendations.every(x => byId.get(x.lotId).commercial.price <= cheapest));
  const alone = rec(profile({ privacy: 3 }), { lots: ls, constraints: [C('budgetMax', 1000)] });
  assert.equal(alone.conflicts[0].code, 'BUDGET_BELOW_CHEAPEST_LOT'); assert.equal(alone.conflicts[0].bestAvailableValue, Math.min(...lots.map(l => l.commercial.price)));
  const gate = rec(profile({ privacy: 3 }), { lots: ls, constraints: [C('maxGateRoute', 1), C('blocks', ['A'])] });
  assert.ok(gate.conflicts.some(x => x.code === 'CONSTRAINT_UNSATISFIABLE' && x.constraintKey === 'maxGateRoute'));
});
test('logical conflicts beyond area: lower bound above upper bound on any metric, yes and no on the same field', () => {
  const mk = (metricKey, operator, expectedValue, id) => ({ id, key: id, metricKey, operator, expectedValue, onUnknown: 'EXCLUDE', enabled: true });
  const v = App.recommendation.validateConstraints([mk('mobility.routeDistanceToGateM', 'GTE', 500, 'a'), mk('mobility.routeDistanceToGateM', 'LTE', 300, 'b')], pol);
  assert.ok(v.errors.some(e => e.code === 'HARD_CONSTRAINT_CONFLICT' && e.metricKey === 'mobility.routeDistanceToGateM'));
  assert.ok(App.recommendation.validateConstraints([mk('geometry.isCorner', 'IS_TRUE', true, 'a'), mk('geometry.isCorner', 'IS_FALSE', true, 'b')], pol).errors.some(e => e.code === 'HARD_CONSTRAINT_CONFLICT'));
  assert.ok(App.recommendation.validateConstraints([mk('identity.blockId', 'IN', ['A'], 'a'), mk('identity.blockId', 'NOT_IN', ['A', 'B'], 'b')], pol).errors.some(e => e.code === 'HARD_CONSTRAINT_CONFLICT'));
  assert.equal(App.recommendation.validateConstraints([mk('geometry.areaM2', 'GTE', 300, 'a'), mk('geometry.areaM2', 'LTE', 300, 'b')], pol).ok, true, 'equal bounds are satisfiable');
});
test('review: each candidate has a primary review reason and category, so the UI does not say "status a confirmar" for everything', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const green = lots.map((l, i) => l.surroundings.hasGreenRear === true ? i : -1).filter(i => i >= 0), [iRear, iPrice, iUnk, iCov] = green; // pass greenRear unless made unknown
  ls[iRear] = { ...ls[iRear], surroundings: { ...ls[iRear].surroundings, hasGreenRear: null } };
  ls[iPrice] = { ...ls[iPrice], commercial: { ...ls[iPrice].commercial, price: null } };
  ls[iUnk] = withStatus(ls[iUnk], 'UNKNOWN');
  ls[iCov] = { ...ls[iCov], environmental: { ...ls[iCov].environmental, privacyScore: null, quietScore: null } };
  const r = rec(profile({ privacy: 3, quiet: 3, solar: 1 }), { lots: ls, constraints: [C('greenRear', true), C('budgetMax', 2e6)], policy: { ...pol, reviewLimit: 500 } });
  const rv = id => r.reviewCandidates.find(x => x.lotId === id) || null;
  const has = (i, reason, cat) => { const x = rv(ls[i].identity.id); assert.ok(x, `lot ${i} in review`); assert.equal(x.primaryReviewReason, reason); assert.equal(x.reviewCategory, cat); };
  has(iUnk, 'AVAILABILITY_UNKNOWN', 'AVAILABILITY'); has(iPrice, 'UNKNOWN_PRICE', 'COMMERCIAL_DATA'); has(iCov, 'LOW_FIT_COVERAGE', 'FIT_DATA');
  has(iRear, 'UNKNOWN_REAR', 'CONSTRAINT_DATA');
  assert.equal(Object.values(r.reviewSummary.byCategory).reduce((a, b) => a + b, 0), r.reviewRequiredCount);
  assert.equal(App.recommendation.primaryReviewReason(['LOW_FIT_COVERAGE', 'UNKNOWN_REAR', 'AVAILABILITY_UNKNOWN'], pol), 'AVAILABILITY_UNKNOWN');
  assert.equal(App.recommendation.reviewCategoryOf('UNKNOWN_PRICE', pol), 'COMMERCIAL_DATA');
});

// ---------------------------------------------------------------- Fit robustness
test('fit config validation: the published config is valid; weights, ranges, matcher types and parameters are checked', () => {
  const v = App.fit.validateConfig(fitCfg); assert.equal(v.ok, true, JSON.stringify(v.errors));
  const bad = (mut, code) => { const c = JSON.parse(JSON.stringify(fitCfg)); mut(c); const r = App.fit.validateConfig(c); assert.equal(r.ok, false, code); assert.ok(r.errors.some(e => e.code === code), `${code} ${JSON.stringify(r.errors)}`); };
  bad(c => { c.importanceMap.HIGH = -1; }, 'INVALID_WEIGHT');
  bad(c => { c.importanceMap.HIGH = 'x'; }, 'INVALID_WEIGHT');
  bad(c => { c.minCoverage = 1.5; }, 'INVALID_RANGE');
  bad(c => { c.mismatchMax = 0.9; }, 'THRESHOLD_ORDER');
  bad(c => { c.preferences.quiet.type = 'EVAL'; }, 'UNKNOWN_MATCHER');
  bad(c => { c.preferences.quiet.fieldKey = 'x.y'; }, 'UNKNOWN_FIELD_KEY');
  bad(c => { delete c.preferences.quiet.scaleMax; }, 'MISSING_PARAM');
  bad(c => { c.preferences.nearGate.idealM = 2000; }, 'INVALID_RANGE');
  bad(c => { c.templates[0].preferences.nope = 'HIGH'; }, 'UNKNOWN_PREFERENCE');
  bad(c => { c.legacyImportance['3'] = 'TOP'; }, 'INVALID_IMPORTANCE');
  bad(c => { c.confidence.levels[2].gte = 0.1; }, 'THRESHOLD_ORDER');
  bad(c => { c.fitMethodologyVersion = '1.0'; }, 'INVALID_VERSION');
  assert.equal(App.fit.validateConfig(null).ok, false);
  assert.equal(App.fit.minCoverage('viva-juara'), fitCfg.minCoverage); assert.equal(App.fit.minCoverage({ ...fitCfg, minCoverage: undefined }), null, 'never invented');
});
test('fit: a matcher that throws or returns NaN marks that preference FAILED (never a silent 0) and the rest renormalizes', () => {
  const cfg = { ...fitCfg, preferences: { ...fitCfg.preferences, solar: { ...fitCfg.preferences.solar, type: 'NOPE' }, view: { ...fitCfg.preferences.view, scaleMax: 0 } } };
  const ctx = App.fit.contextFor(lots), l = lots[10];
  const r = App.fit.fitLot(App.fit.buildProfile({ preferences: { privacy: 3, solar: 2, view: 1 } }, cfg), l, cfg, ctx);
  const m = k => r.preferenceMatches.find(x => x.key === k);
  assert.equal(m('solar').status, 'FAILED'); assert.equal(m('solar').reasonCode, 'FIT_MATCHER_FAILED'); assert.equal(m('solar').matchScore, null);
  assert.equal(m('view').status, 'FAILED'); assert.equal(m('view').reasonCode, 'FIT_INVALID_MATCH');
  assert.equal(r.status, 'PARTIAL'); assert.deepEqual([...r.failedPreferences].sort(), ['solar', 'view']);
  assert.ok(r.warnings.filter(w => w.code === 'MATCHER_FAILED').length === 2);
  const only = App.fit.fitLot(App.fit.buildProfile({ preferences: { privacy: 3 } }), l, fitCfg, ctx);
  assert.equal(r.fitScore, only.fitScore, 'the failed preferences are out of the average, not zeros');
  assert.ok(Math.abs(r.coverage - 4 / 7) < 1e-12);
  const all = App.fit.fitLot(App.fit.buildProfile({ preferences: { solar: 2 } }, cfg), l, cfg, ctx);
  assert.equal(all.status, 'FAILED'); assert.equal(all.fitScore, null);
});
test('fit: an invalid result (NaN weight) is FAILED with fitScore null; recommendation sends it to review, never LOW_FIT', () => {
  const cfg = { ...fitCfg, importanceMap: { ...fitCfg.importanceMap, HIGH: NaN } };
  const r = App.fit.fitLot(App.fit.buildProfile({ preferences: { privacy: 3 } }, cfg), lots[0], cfg, App.fit.contextFor(lots));
  assert.equal(r.status, 'FAILED'); assert.equal(r.fitScore, null); assert.ok(r.warnings.some(w => w.code === 'INVALID_FIT_RESULT'));
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const res = App.recommendation.recommend({ developmentId: 'viva-juara', profile: App.fit.buildProfile({ preferences: { privacy: 3 } }, cfg), constraints: [], lots: ls, policy: pol, fitCfg: cfg, availabilityPolicy: {}, dataVersions: {} });
  assert.equal(res.lowFitCount, 0); assert.equal(res.recommendations.length, 0); assert.equal(res.reviewRequiredCount, 498);
  assert.ok(res.reviewCandidates.every(x => x.primaryReviewReason === 'FIT_FAILED' && x.reviewCategory === 'FIT_DATA'));
});
test('fit cache key follows the data: a new price with the same versions is a new key; availability is not', () => {
  const c = App.fit.cache(), p = profile({ priceQuality: 2 }, { budgetMax: 400000 }), opts = { priceTableVersion: 't1', analysisVersion: 'a1' };
  const k0 = c.keyOf(p, lots, fitCfg, opts);
  const repriced = lots.map((l, i) => i === 5 ? { ...l, commercial: { ...l.commercial, price: l.commercial.price + 1000 } } : l);
  assert.notEqual(c.keyOf(p, repriced, fitCfg, opts), k0);
  assert.equal(c.keyOf(p, lots.map(l => withStatus(l, 'SOLD')), fitCfg, opts), k0);
  assert.notEqual(c.keyOf(p, lots, fitCfg, { ...opts, dataRevision: 3 }), k0);
  const a = c.get(p, lots, fitCfg, opts), b = c.get(p, repriced, fitCfg, opts);
  assert.notEqual(a.get(lots[5].identity.id).preferenceMatches.find(m => m.key === 'budget').rawLotValue, b.get(lots[5].identity.id).preferenceMatches.find(m => m.key === 'budget').rawLotValue);
  const ctx = App.fit.contextFor(lots, { dataRevision: 7 });
  assert.ok(App.fit.fitLot(p, lots[0], fitCfg, ctx).cacheKey.endsWith('|rev7')); assert.ok(!App.fit.fitLot(p, lots[0], fitCfg, App.fit.contextFor(lots)).cacheKey.includes('rev'));
});
test('profile warnings are derived from the data: contradictory targets, unsatisfiable targets and trade-offs', () => {
  const cheap = Math.min(...lots.map(l => l.commercial.price)), bigArea = Math.max(...lots.map(l => l.geometry.areaM2));
  const budget = Math.round(cheap * 1.05), areaMin = Math.floor(bigArea * 0.95);
  const jointExpected = lots.some(l => l.commercial.price <= budget && l.geometry.areaM2 >= areaMin);
  const p = profile({ privacy: 3, premium: 2, priceQuality: 2, quiet: 1 }, { budgetMax: budget, areaMin });
  const w = App.fit.profileWarnings(p, lots, fitCfg);
  assert.equal(w.some(x => x.code === 'CONTRADICTORY_PREFERENCES' && x.keys.includes('budget') && x.keys.includes('areaRange')), !jointExpected);
  // every reported trade-off holds in the data, and every pair not reported has a lot strong in both
  const ctx = App.fit.contextFor(lots), strong = k => { const d = fitCfg.preferences[k], pr = App.fit.effectivePreferences(p, fitCfg).find(x => x.key === k); return lots.map(l => { const v = App.model.get(l, d.fieldKey); return v != null && App.fit.MatchingRegistry.get(d.type).run(v, pr, d, ctx) >= fitCfg.strengthMin; }); };
  const keys = ['privacy', 'premium', 'priceQuality', 'quiet'];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = strong(keys[i]), b = strong(keys[j]), joint = a.some((x, k) => x && b[k]), reported = w.some(x => x.code === 'PROFILE_TRADEOFF' && x.keys.includes(keys[i]) && x.keys.includes(keys[j]));
    assert.equal(reported, a.some(Boolean) && b.some(Boolean) && !joint, `${keys[i]} × ${keys[j]}`);
  }
  const none = App.fit.profileWarnings(profile({}, { budgetMax: cheap - 1 }), lots, fitCfg);
  assert.ok(none.some(x => x.code === 'PREFERENCE_NOT_SATISFIABLE' && x.keys[0] === 'budget'));
  const r = rec(p, { lots: lots.map(l => withStatus(l, 'AVAILABLE')) });
  for (const x of w) assert.ok(r.diagnostics.some(d => d.code === x.code && JSON.stringify(d.keys) === JSON.stringify(x.keys)), 'reported in the recommendation diagnostics');
  assert.equal(App.fit.validateProfile(p, fitCfg).warnings.filter(x => x.code === 'PROFILE_TRADEOFF').length, 0, 'without lots nothing is invented');
});
