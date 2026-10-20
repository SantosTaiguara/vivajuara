'use strict';
// ExplanationEngine follow-ups (topic 16): excluded lots explained with their exclusion factors, data-quality
// factors for every review reason, diagnostics, comparable:false flagged, compareMany for 2–4 lots, ExplanationViewModel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');

let App, E, lots, fitCfg, pol, byId;
test.before(async () => {
  App = load(); E = App.explanation; const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync();
  fitCfg = App.fit.cfgOf('viva-juara'); pol = App.recommendation.policyOf('viva-juara'); byId = new Map(lots.map(l => [l.identity.id, l]));
});
const withStatus = (l, status) => ({ ...l, availability: { ...l.availability, status } });
const profile = (prefs, extra = {}) => App.fit.buildProfile({ preferences: prefs, ...extra });
const C = (k, v) => App.recommendation.constraint(k, v, pol);
const rec = (p, extra = {}) => App.recommendation.recommend({ developmentId: 'viva-juara', profile: p, constraints: [], lots, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: {}, ...extra });
const CODE_LIKE = /\b[A-Z0-9]+_[A-Z0-9_]+\b/;
const texts = o => { const out = []; (function walk(x, k) { if (typeof x === 'string') { if (k === 'text' || k === 'label') out.push(x); } else if (x && typeof x === 'object') for (const [kk, v] of Object.entries(x)) walk(v, kk); })(o, ''); return out; };

test('excluded lot: status EXCLUDED with the exclusion factor (metric, actual vs expected, constraint label) instead of NOT_IN_RESULTS', () => {
  const ls = lots.map((l, i) => withStatus(l, i % 2 ? 'SOLD' : 'AVAILABLE'));
  const r = rec(profile({ privacy: 3, quiet: 2 }), { lots: ls, constraints: [C('budgetMax', 450000)] });
  const px = r.excluded.find(x => x.reasonCode === 'PRICE_ABOVE_MAX'), e = E.explainLot(r, px.lotId);
  assert.equal(e.status, 'EXCLUDED'); assert.deepEqual([...e.summaryReasonCodes], ['EXCLUDED', 'PRICE_ABOVE_MAX']);
  const f = e.exclusionFactors[0];
  assert.equal(f.factorType, 'EXCLUSION'); assert.equal(f.metricKey, 'commercial.price'); assert.equal(f.actualValue, byId.get(px.lotId).commercial.price); assert.equal(f.targetValue, 450000); assert.equal(f.constraintLabel, 'Preço até');
  assert.ok(e.constraintFactors.some(c => c.factorType === 'CONSTRAINT_FAIL' && c.reasonCode === 'PRICE_ABOVE_MAX'));
  const sold = E.explainLot(r, r.excluded.find(x => x.reasonCode === 'SOLD').lotId);
  assert.equal(sold.status, 'EXCLUDED'); assert.equal(sold.exclusionFactors[0].stage, 'SYSTEM_ELIGIBILITY'); assert.equal(sold.positiveFactors.length, 0, 'no Fit was computed: nothing invented');
  const low = r.excluded.find(x => x.reasonCode === 'LOW_FIT'), el = E.explainLot(r, low.lotId, { all: true });
  assert.equal(el.status, 'EXCLUDED'); assert.ok(el.negativeFactors.length > 0);
  assert.ok(Math.abs(el.preferenceTable.reduce((a, x) => a + x.contribution, 0) - low.fitScore) < 1e-9, 'contributions still add up to the Fit');
  assert.equal(E.explainLot(r, 'nope').summaryReasonCodes[0], 'NOT_IN_RESULTS');
  const many = rec(profile({ privacy: 3 }), { lots: lots.map(l => withStatus(l, 'AVAILABLE')) });
  assert.equal(E.explainLot(many, many.overflow.eligibleLotIds[0]).summaryReasonCodes[0], 'NOT_SHORTLISTED');
  const rv = rec(profile({ privacy: 3 }));
  assert.equal(E.explainLot(rv, rv.overflow.reviewLotIds[0]).summaryReasonCodes[0], 'REVIEW_NOT_LISTED');
});
test('data quality: LOW_FIT_COVERAGE, LOW_FIT_CONFIDENCE, STALE_AVAILABILITY, UNKNOWN_* and CONFLICTED_DATA become factors with their metric and values', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE')), green = lots.map((l, i) => l.surroundings.hasGreenRear === true ? i : -1).filter(i => i >= 0);
  const [iCov, iConf, iRear] = green;
  ls[iCov] = { ...ls[iCov], environmental: { ...ls[iCov].environmental, privacyScore: null, quietScore: null } };
  ls[iConf] = { ...ls[iConf], provenance: { ...ls[iConf].provenance, 'environmental.privacyScore': { status: 'CONFLICTED' }, 'environmental.quietScore': { status: 'CONFLICTED' }, 'environmental.solarScore': { status: 'CONFLICTED' } } };
  ls[iRear] = { ...ls[iRear], surroundings: { ...ls[iRear].surroundings, hasGreenRear: null } };
  const big = { ...pol, reviewLimit: 500 };
  const r = rec(profile({ privacy: 3, quiet: 3, solar: 1 }), { lots: ls, constraints: [C('greenRear', true)], policy: big });
  const dq = (i, code) => E.explainLot(r, ls[i].identity.id, { policy: pol.explanation }).dataQualityFactors.find(f => f.reasonCode === code);
  const cov = dq(iCov, 'LOW_FIT_COVERAGE'); assert.equal(cov.metricKey, 'fit.coverage'); assert.ok(cov.actualValue < pol.minFitCoverage); assert.equal(cov.targetValue, pol.minFitCoverage);
  const cf = dq(iConf, 'LOW_FIT_CONFIDENCE'); assert.equal(cf.metricKey, 'fit.confidence'); assert.ok(cf.actualValue < pol.minFitConfidence);
  assert.ok(dq(iConf, 'CONFLICTED_DATA'), 'conflicted input named as such, not as an estimate');
  const rear = dq(iRear, 'UNKNOWN_REAR'); assert.equal(rear.metricKey, 'surroundings.hasGreenRear'); assert.equal(rear.constraintKey, 'greenRear');
  const st = rec(profile({ privacy: 3 }), { lots: lots.map(l => withStatus(l, 'AVAILABLE')), availabilityFreshness: 'STALE' });
  const sf = E.explainLot(st, st.reviewCandidates[0].lotId).dataQualityFactors.find(f => f.reasonCode === 'STALE_AVAILABILITY');
  assert.equal(sf.metricKey, 'availability.status'); assert.equal(sf.dataStatus, 'STALE');
  const e = E.explainLot(r, ls[iCov].identity.id);
  assert.ok(e.diagnostics.some(d => d.code === 'PARTIAL_COVERAGE'));
  assert.equal(e.primaryReason, 'LOW_FIT_COVERAGE'); assert.equal(e.reviewCategory, 'FIT_DATA');
});
test('diagnostics: truncated factors are reported, never silently cut', () => {
  const r = rec(profile({ privacy: 3, quiet: 3, solar: 2, view: 2, gate: 2, leisure: 1, lowTraffic: 1 }), { lots: lots.map(l => withStatus(l, 'AVAILABLE')) });
  const e = E.explainLot(r, r.recommendations[0].lotId);
  if (e.allPositive > pol.explanation.maxPositiveFactors) assert.ok(e.diagnostics.some(d => d.code === 'FACTORS_TRUNCATED' && d.params.totalPositive === e.allPositive));
  else assert.ok(!e.diagnostics.some(d => d.code === 'FACTORS_TRUNCATED'));
});
test('pairwise: factors without data on one side are flagged comparable:false with the side that lacks it', () => {
  const ls = lots.map(l => withStatus(l, 'AVAILABLE'));
  const r0 = rec(profile({ privacy: 3, quiet: 2 }), { lots: ls }), [a, b] = r0.recommendations.map(x => x.lotId);
  const i = ls.findIndex(l => l.identity.id === b); ls[i] = { ...ls[i], environmental: { ...ls[i].environmental, quietScore: null } };
  const r = rec(profile({ privacy: 3, quiet: 2 }), { lots: ls, policy: { ...pol, minFitCoverage: 0, shortlistSize: 500 } });
  const p = E.comparePair(r, a, b);
  assert.equal(p.status, 'COMPLETE');
  const nc = p.notComparableFactors.find(f => f.preferenceKey === 'quiet');
  assert.ok(nc && nc.comparable === false && nc.flag === 'NOT_COMPARABLE');
  assert.equal(nc.notComparableReason, p.higherLotId === b ? 'MISSING_IN_HIGHER' : 'MISSING_IN_LOWER');
  assert.ok(p.warnings.includes('HAS_NOT_COMPARABLE_FACTORS'));
  const clean = E.comparePair(r0, r0.recommendations[0].lotId, r0.recommendations[1].lotId);
  assert.equal(clean.notComparableFactors.length, 0); assert.equal(clean.warnings.length, 0);
});
test('compareMany: 2–4 lots, pairwise matrix, per-preference winners; lots outside the results use the given Fit evidence', () => {
  const ls = lots.map((l, i) => withStatus(l, i % 2 ? 'SOLD' : 'AVAILABLE')), p = profile({ privacy: 3, quiet: 2, solar: 1 });
  const r = rec(p, { lots: ls }), fit = new Map(App.fit.fitLots(p, lots, fitCfg).map(f => [f.lotId, f]));
  assert.equal(E.compareMany(r, [r.recommendations[0].lotId]).status, 'INVALID');
  assert.equal(E.compareMany(r, r.recommendations.slice(0, 5).map(x => x.lotId)).summaryReasonCodes[0], 'COMPARE_COUNT_OUT_OF_RANGE');
  const sold = r.excluded.find(x => x.reasonCode === 'SOLD').lotId, ids = [r.recommendations[2].lotId, sold, r.recommendations[0].lotId, r.recommendations[1].lotId];
  const cm = E.compareMany(r, ids, { fit });
  assert.equal(cm.status, 'COMPLETE'); assert.equal(cm.order[cm.order.length - 1], sold, 'excluded lot comes last');
  assert.deepEqual(cm.order.slice(0, 3), r.recommendations.slice(0, 3).map(x => x.lotId), 'engine order, not recalculated');
  assert.equal(cm.lots.find(x => x.lotId === sold).standing, 'EXCLUDED'); assert.equal(cm.lots.find(x => x.lotId === sold).fitScore, fit.get(sold).fitScore);
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (i === j) { assert.equal(cm.matrix[i][j], null); continue; }
    const x = cm.matrix[i][j], y = cm.matrix[j][i];
    assert.ok(x && y); assert.equal(x.relation === 'HIGHER', y.relation === 'LOWER'); assert.ok(Math.abs(x.fitDelta + y.fitDelta) < 1e-12);
  }
  assert.equal(cm.pairs.length, 6);
  assert.ok(cm.pairs.some(q => q.summaryReasonCodes[0] === 'DIFFERENT_ELIGIBILITY' && q.lowerLotId === sold));
  for (const row of cm.preferences) {
    const ev = row.values.filter(v => v.evaluated), max = Math.max(...ev.map(v => v.match));
    if (row.tied) assert.equal(row.winnerLotIds.length, 0); else for (const w of row.winnerLotIds) assert.equal(row.values.find(v => v.lotId === w).match, max);
  }
  const wins = Object.fromEntries(ids.map(id => [id, cm.preferences.filter(q => q.winnerLotIds.includes(id)).length]));
  assert.deepEqual({ ...cm.winsByLot }, wins);
  const partial = E.compareMany(r, [r.recommendations[0].lotId, sold, 'nope']);
  assert.equal(partial.status, 'PARTIAL'); assert.ok(partial.warnings.includes('NOT_IN_RESULTS'));
});
test('viewModel: levels per mode from the policy, labels from App.reasonCodes, client text without codes', () => {
  const ls = lots.map((l, i) => withStatus(l, i % 2 ? 'UNKNOWN' : 'AVAILABLE'));
  const r = rec(profile({ privacy: 3, quiet: 2 }), { lots: ls, constraints: [C('budgetMax', 450000)] });
  const top = E.explainLot(r, r.recommendations[0].lotId);
  const cv = E.viewModel(top, { mode: 'client' }), bv = E.viewModel(top, { mode: 'broker' });
  assert.deepEqual([...cv.levels], [...pol.explanation.clientLevels]); assert.equal(cv.levelsSource, 'POLICY');
  assert.equal(cv.preferenceTable, undefined); assert.equal(cv.technical, undefined); assert.ok(bv.preferenceTable && bv.technical);
  assert.equal(cv.headline.code, 'TOP_FIT'); assert.equal(cv.headline.text, App.reasonCodes.label('TOP_FIT', 'client'));
  assert.ok(cv.positives.length && cv.positives.every(p => p.text && p.label === fitCfg.preferences[p.preferenceKey].label));
  const review = E.explainLot(r, r.reviewCandidates[0].lotId), rvm = E.viewModel(review, { mode: 'client' });
  assert.equal(rvm.headline.code, 'REVIEW_AVAILABILITY');
  const ex = E.explainLot(r, r.excluded.find(x => x.reasonCode === 'PRICE_ABOVE_MAX').lotId), evm = E.viewModel(ex, { mode: 'client' });
  assert.equal(evm.headline.code, 'EXCLUDED'); assert.match(evm.headline.text, /R\$/); assert.equal(evm.exclusions[0].expected.replace(/\s/g, ' '), 'R$ 450.000');
  for (const vm of [cv, rvm, evm]) for (const t of texts(vm)) assert.ok(!CODE_LIKE.test(t), t);
  assert.equal(E.viewModel(top, { mode: 'client', policy: { ...pol.explanation, clientLevels: undefined } }).levelsSource, 'DEFAULT');
  assert.ok(Object.isFrozen(cv));
});
