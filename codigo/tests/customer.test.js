'use strict';
// Fit Score (topic 14), RecommendationEngine (topic 15) and ExplanationEngine (topic 16).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');
const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m);

let App, repo, lots, fitCfg, pol, byCode;
test.before(async () => {
  App = load();
  repo = App.repos.LotRepository('viva-juara'); await repo.load();
  lots = repo.lotsSync(); byCode = new Map(lots.map(l => [l.identity.code, l]));
  fitCfg = App.fit.cfgOf('viva-juara'); pol = App.recommendation.policyOf('viva-juara');
});
const profile = (prefs, extra = {}) => App.fit.buildProfile({ preferences: prefs, ...extra });
/** availability override without touching the repository (lots are frozen) */
const withStatus = (l, status) => ({ ...l, availability: { ...l.availability, status } });
const req = (p, extra = {}) => ({ developmentId: 'viva-juara', profile: p, constraints: [], lots, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: { analysisVersion: 'a1', priceTableVersion: 't1', availabilityRevision: 0, staticVersion: 's1' }, ...extra });

// ---------------------------------------------------------------- Fit
test('fit v1 reproduces the panel\'s previous compatibility for every preset and lot', () => {
  for (const preset of App.services.recommendation.PRESETS) {
    const old = new Map(App.services.recommendation.rank(lots, preset.prefs, null).map(r => [r.id, r.relevance]));
    const res = App.fit.fitLots(profile(preset.prefs, { templateId: preset.id }), lots, fitCfg);
    for (const r of res) assert.ok(Math.abs(r.fitScore / 100 - old.get(r.lotId)) < 1e-12, `${preset.id} ${r.code}`);
  }
});
test('golden profiles: QuietFamily, InvestorBudget, NaturePremium', () => {
  const quiet = App.fit.fitLots(profile({ quiet: 3, family: 2, lowTraffic: 2 }), lots, fitCfg);
  const top = quiet.slice().sort((a, b) => b.fitScore - a.fitScore)[0];
  assert.ok(top.fitScore > 85 && top.status === 'COMPLETE' && top.coverage === 1);
  const inv = App.fit.fitLots(profile({ investment: 3 }, { budgetMax: 330000 }), lots, fitCfg);
  const cheap = inv.find(r => byCode.get(r.code).commercial.price <= 330000), dear = inv.find(r => byCode.get(r.code).commercial.price > 363000);
  assert.equal(cheap.preferenceMatches.find(m => m.key === 'budget').matchScore, 1);
  assert.equal(dear.preferenceMatches.find(m => m.key === 'budget').matchScore, 0);
  assert.equal(inv[0].versions.priceTableVersion, null, 'no context version given → null, never invented');
  const nat = App.fit.fitLots(profile({ green: 3, premium: 2, view: 1 }), lots, fitCfg);
  const g = nat.filter(r => byCode.get(r.code).surroundings.hasGreenRear === true), n = nat.filter(r => byCode.get(r.code).surroundings.hasGreenRear === false);
  assert.ok(Math.min(...g.map(r => r.fitScore)) > Math.max(...n.map(r => r.fitScore)) - 30);
  assert.ok(g[0].strengths.some(s => s.key === 'green'));
});
test('fit: range, enum, boolean, proximity and avoidance matchers', () => {
  const R = App.fit.MatchingRegistry;
  assert.equal(R.get('NUMERIC_RANGE').run(330, { target: { min: 250, max: 350 } }, {}), 1);
  assert.equal(R.get('NUMERIC_RANGE').run(375, { target: { min: 250, max: 350 }, tolerance: 50 }, {}), 0.5);
  assert.equal(R.get('ENUM').run('NE', { target: 'N' }, fitCfg.preferences.rearOrientation), 0.5);
  assert.equal(R.get('BOOLEAN').run(false, {}, { target: true }), 0);
  assert.equal(R.get('PROXIMITY').run(150, {}, { idealM: 150, zeroAtM: 1000 }), 1);
  assert.equal(R.get('AVOIDANCE').run(50, {}, { zeroAtM: 50, idealM: 250 }), 0);
  assert.equal(R.get('MAXIMUM').run(330000, { target: 300000 }, { toleranceRatio: 0.1 }), 0);
  assert.ok(Math.abs(R.get('MAXIMUM').run(315000, { target: 300000 }, { toleranceRatio: 0.1 }) - 0.5) < 1e-12);
  assert.equal(R.has('EVAL'), false);
});
test('fit: empty profile is INSUFFICIENT_PROFILE with a null score (never 0)', () => {
  const r = App.fit.fitLot(profile({}), lots[0], fitCfg, App.fit.contextFor(lots));
  assert.equal(r.status, 'INSUFFICIENT_PROFILE'); assert.equal(r.fitScore, null);
});
test('fit: missing lot data is ignored and renormalized, lowering coverage', () => {
  const l = lots[0], fake = { ...l, environmental: { ...l.environmental, quietScore: null } };
  const r = App.fit.fitLot(profile({ quiet: 3, privacy: 3 }), fake, fitCfg, App.fit.contextFor(lots));
  assert.equal(r.coverage, 0.5); assert.equal(r.status, 'PARTIAL');
  assert.ok(Math.abs(r.fitScore - 10 * l.environmental.privacyScore) < 1e-9);
  assert.ok(r.missingInputs.includes('environmental.quietScore'));
});
test('fit: availability never changes the Fit; stale price lowers confidence and warns', () => {
  const p = profile({ privacy: 3 }, { budgetMax: 400000 }), l = lots[5], ctx = App.fit.contextFor(lots);
  const a = App.fit.fitLot(p, l, fitCfg, ctx), b = App.fit.fitLot(p, withStatus(l, 'SOLD'), fitCfg, ctx);
  assert.equal(a.fitScore, b.fitScore); assert.equal(a.cacheKey, b.cacheKey);
  const s = App.fit.fitLot(p, l, fitCfg, App.fit.contextFor(lots, { commercialFreshness: 'STALE' }));
  assert.ok(s.confidence.value < a.confidence.value); assert.ok(s.warnings.some(w => w.code === 'STALE_PRICE'));
});
test('fit: profile validation (invalid key, bad range, duplicate) and deterministic version', () => {
  const p = profile({ quiet: 3 });
  assert.equal(p.profileVersion, profile({ quiet: 3 }).profileVersion);
  assert.notEqual(p.profileVersion, profile({ quiet: 2 }).profileVersion);
  const bad = { ...p, preferences: [...p.preferences, { id: 'x', key: 'nope', importance: 'HIGH' }, { id: 'y', key: 'areaRange', importance: 'LOW', target: { min: 500, max: 300 } }] };
  const v = App.fit.validateProfile(bad, fitCfg);
  assert.ok(v.errors.some(e => e.code === 'INVALID_FIELDKEY')); assert.ok(v.errors.some(e => e.code === 'INVALID_RANGE'));
  const dup = { ...p, preferences: [...p.preferences, { ...p.preferences[0], importance: 'LOW' }] };
  assert.ok(App.fit.validateProfile(dup, fitCfg).warnings.some(w => w.code === 'DUPLICATE_PREFERENCE'));
  assert.equal(App.fit.effectivePreferences(dup, fitCfg)[0].importance, 'LOW', 'last one wins');
  assert.throws(() => App.fit.fitLots(bad, lots, fitCfg), e => e.code === 'INVALID_PROFILE');
});
test('fit: single equals batch; 498 lots in well under a second', () => {
  const p = profile({ quiet: 3, solar: 2, area: 1 }), t0 = Date.now(), all = App.fit.fitLots(p, lots, fitCfg), ms = Date.now() - t0;
  const ctx = App.fit.contextFor(lots);
  for (const i of [0, 77, 300]) deq(App.fit.fitLot(p, lots[i], fitCfg, ctx), all[i]);
  assert.ok(ms < 1000, ms + ' ms');
});

// ---------------------------------------------------------------- Recommendation
test('today every lot is UNKNOWN: nothing is recommended, candidates go to review', () => {
  const r = App.recommendation.recommend(req(profile({ privacy: 3 })));
  assert.equal(r.status, 'NO_ELIGIBLE_LOTS'); assert.equal(r.recommendations.length, 0);
  assert.equal(r.reviewRequiredCount, 498); assert.equal(r.reviewCandidates.length, pol.reviewLimit);
  assert.ok(r.reviewCandidates.every(x => x.tier === 'REVIEW_REQUIRED' && x.keyReasonCodes.includes('AVAILABILITY_UNKNOWN')));
});
test('available lots are ranked and tiered; SOLD never reaches constraints or Fit', () => {
  const ls = lots.map((l, i) => withStatus(l, i % 3 === 0 ? 'AVAILABLE' : i % 3 === 1 ? 'SOLD' : 'UNKNOWN'));
  const r = App.recommendation.recommend(req(profile({ privacy: 3, quiet: 2 }), { lots: ls }));
  assert.equal(r.status, 'SUCCESS'); assert.equal(r.recommendations[0].tier, 'PRIMARY');
  assert.ok(r.recommendations.filter(x => x.tier === 'PRIMARY').length <= pol.primaryTierSize);
  assert.ok(r.recommendations.every(x => x.availabilityStatus === 'AVAILABLE'));
  assert.equal(r.exclusionSummary.SOLD, 166);
  for (let i = 1; i < r.recommendations.length; i++) assert.ok(App.recommendation.compare(r.recommendations[i - 1], r.recommendations[i]) <= 0);
  assert.ok(r.recommendations.length <= pol.shortlistSize);
});
test('hard constraints exclude with a reason, never relax, and report their impact', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const cs = [App.recommendation.constraint('budgetMax', 300000, pol), App.recommendation.constraint('noCorner', true, pol)];
  const r = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, constraints: cs }));
  assert.ok(r.recommendations.every(x => byCode.get(x.code).commercial.price <= 300000 && byCode.get(x.code).geometry.isCorner === false));
  assert.ok(r.exclusionSummary.PRICE_ABOVE_MAX > 0);
  const none = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, constraints: [App.recommendation.constraint('budgetMax', 1000, pol)] }));
  assert.equal(none.status, 'NO_ELIGIBLE_LOTS'); assert.equal(none.recommendations.length, 0);
  assert.equal(none.constraintImpact[0].key, 'budgetMax'); assert.equal(none.constraintImpact[0].rejectedCount, 498);
});
test('unknown data follows onUnknown; conflicting constraints are rejected', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE')), l0 = ls[0];
  ls[0] = { ...l0, surroundings: { ...l0.surroundings, hasGreenRear: null } };
  const r = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, constraints: [App.recommendation.constraint('greenRear', true, pol)] }));
  assert.ok(r.reviewCandidates.some(x => x.lotId === l0.identity.id && x.keyReasonCodes.includes('UNKNOWN_REAR')));
  const bad = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, constraints: [App.recommendation.constraint('areaMin', 500, pol), App.recommendation.constraint('areaMax', 400, pol)] }));
  assert.equal(bad.status, 'INVALID_PROFILE'); assert.ok(bad.diagnostics.some(d => d.code === 'HARD_CONSTRAINT_CONFLICT'));
  assert.equal(App.recommendation.recommend(req(profile({}))).status, 'INSUFFICIENT_PROFILE');
});
test('explicit scope only; availability change re-ranks; cache key changes with inputs', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const r = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, scope: { blockIds: ['B'] } }));
  assert.ok(r.recommendations.every(x => byCode.get(x.code).identity.blockId === 'B')); assert.ok(r.outOfScopeCount > 0);
  const full = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls })), top = full.recommendations[0].lotId;
  const ls2 = ls.map(l => l.identity.id === top ? withStatus(l, 'SOLD') : l);
  const again = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls2, dataVersions: { ...req().dataVersions, availabilityRevision: 1 } }));
  assert.notEqual(again.recommendations[0].lotId, top); assert.notEqual(again.cacheKey, full.cacheKey);
  assert.equal(App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls })).requestId, full.requestId, 'deterministic request id');
  const off = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls, offline: true }));
  assert.ok(off.warnings.includes('COMMERCIAL_CONFIRMATION_REQUIRED'));
});

// ---------------------------------------------------------------- Explanation
test('explanations never recalculate: factors come from the Fit evidence', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const r = App.recommendation.recommend(req(profile({ privacy: 3, solar: 2, gate: 1 }), { lots: ls }));
  const e = App.explanation.explainLot(r, r.recommendations[0].lotId);
  assert.equal(e.status, 'COMPLETE'); assert.ok(e.summaryReasonCodes.includes('TOP_FIT'));
  assert.ok(e.positiveFactors.length <= 3 && e.positiveFactors.every(f => f.factorType === 'POSITIVE'));
  const total = e.preferenceTable.reduce((a, x) => a + x.contribution, 0);
  assert.ok(Math.abs(total - r.recommendations[0].fitScore) < 1e-9, 'contributions add up to the Fit');
  const trace = App.explanation.rankingTrace(r);
  assert.equal(trace[0].finalRank, 1); deq(trace[0].rankingKeys.map(k => k.key), ['fitScore', 'coverage', 'confidence', 'lotId']);
  assert.equal(App.explanation.explainLot(r, 'nope').status, 'UNAVAILABLE');
});
test('pairwise: deltas add up to the Fit difference; lotId tie-break is shown as equivalent', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const r = App.recommendation.recommend(req(profile({ privacy: 3, solar: 2 }), { lots: ls }));
  const [a, b] = r.recommendations;
  const pw = App.explanation.comparePair(r, b.lotId, a.lotId);
  assert.equal(pw.higherLotId, a.lotId);
  const sum = [...pw.decisiveFactors, ...pw.offsettingFactors].reduce((s, d) => s + d.delta, 0);
  assert.ok(pw.decisiveFactors.length + pw.offsettingFactors.length <= 6);
  if (pw.decisiveFactors.length <= 3 && pw.offsettingFactors.length < 3) assert.ok(Math.abs(sum - pw.fitDelta) < 1e-9);
  const tie = App.recommendation.recommend(req(profile({ green: 3 }), { lots: ls }));
  const t2 = App.explanation.comparePair(tie, tie.recommendations[0].lotId, tie.recommendations[1].lotId);
  assert.ok(t2.summaryReasonCodes.includes('EQUIVALENT_FOR_PROFILE') || t2.summaryReasonCodes.includes('TIE_BREAK_CONFIDENCE') || t2.summaryReasonCodes.includes('TIE_BREAK_COVERAGE'));
  assert.ok(!t2.summaryReasonCodes.includes('HIGHER_FIT'));
});
test('pairwise: a Fit difference below the equivalence margin is never explained as a tie-break', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE')), r = App.recommendation.recommend(req(profile({ privacy: 3, solar: 2, quiet: 1 }), { lots: ls }));
  const eps = App.recommendation.policyOf('viva-juara').explanation.equivalenceEpsilon, all = r.recommendations;
  for (let i = 0; i + 1 < all.length; i++) {
    const d = all[i].fitScore - all[i + 1].fitScore; if (!(d > 0 && d < eps)) continue;
    const pw = App.explanation.comparePair(r, all[i].lotId, all[i + 1].lotId);
    assert.deepEqual([...pw.summaryReasonCodes], ['EQUIVALENT_FOR_PROFILE']); assert.equal(pw.tieBreakUsed, null);
  }
});
test('constraints only (no preferences): no TOP_FIT and no profile-coverage code without a Fit', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const r = App.recommendation.recommend(req(profile({}), { lots: ls, constraints: [App.recommendation.constraint('budgetMax', 320000, pol)] }));
  assert.ok(r.recommendations.length > 0);
  for (const x of r.recommendations) { assert.equal(x.fitScore, null); assert.ok(!x.keyReasonCodes.includes('TOP_FIT') && !x.keyReasonCodes.includes('HIGH_PROFILE_COVERAGE')); }
});
test('rank change names the reason (profile change, availability change)', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const a = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls }));
  const b = App.recommendation.recommend(req(profile({ privacy: 3, solar: 3 }), { lots: ls }));
  const ch = App.explanation.rankChange(a, b);
  assert.ok(ch.length > 0 && ch.every(c => c.changeReasons.includes('PROFILE_CHANGED')));
  const top = a.recommendations[0].lotId, ls2 = ls.map(l => l.identity.id === top ? withStatus(l, 'SOLD') : l);
  const c = App.recommendation.recommend(req(profile({ privacy: 3 }), { lots: ls2 }));
  const moved = App.explanation.rankChange(a, c).find(x => x.lotId === top);
  assert.ok(moved.changeReasons.includes('LEFT_RESULTS'));
});
