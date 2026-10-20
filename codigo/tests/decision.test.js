'use strict';
// Topic 56 — customer-oriented commercial decision. Golden scenarios named after the spec (§420).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, D, S, V, repo, lots, dev, sel, byCode, pt, avPol;
const DEV = 'viva-juara', ORG = 'org_house7';
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
const clone = x => JSON.parse(JSON.stringify(x));
const LOCAL = { organizationId: ORG, developmentId: DEV, localDevice: true, userId: 'u_local' };
const FRESH = { commercial: { status: 'FRESH' }, availability: { status: 'FRESH' } };
test.before(async () => {
  App = load();
  // new modules are not in the harness ORDER yet: load them as the build does (one global App)
  for (const f of ['decision/decisionDomain.js', 'decision/decisionServices.js', 'decision/decisionView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  D = App.decision.domain; S = App.decision.services; V = App.decisionView;
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync(); dev = App.config.DEVELOPMENTS[0];
  sel = App.selectors(repo, dev); byCode = c => repo.getLotByCode(c); pt = repo.commercialRepo.getPriceTable(); avPol = App.availability.policyOf(dev);
});
const st = (o = {}) => ({ ...App.store.INITIAL, ...o });
const ctxOf = (ui, extra = {}) => D.buildContext({ organizationId: ORG, developmentId: DEV, ui, dataVersions: repo.getDataVersions(), now: '2026-10-12T10:00:00Z', ...extra });
const run = (ctx, extra = {}) => S.orchestrate({ context: ctx, lots: extra.lots || lots, recommendation: extra.recommendation, freshness: extra.freshness || repo.getFreshnessState(), dataVersions: extra.dataVersions || repo.getDataVersions(), priceTable: pt, availabilityPolicy: avPol, mode: extra.mode, shortlist: extra.shortlist, progress: extra.progress, offline: extra.offline, now: '2026-10-12T10:00:00Z' });
/** lots with a commercial feed: given codes AVAILABLE/FRESH (or another status) */
const withStatus = (map, base = lots) => base.map(l => { const s = map[l.identity.code]; if (!s) return l; const c = clone(l); c.availability = { ...c.availability, status: s.status || s, freshness: s.freshness || 'FRESH', updatedAt: '2026-10-12T09:00:00Z', sourceId: 'sales-mirror', revision: 1 }; return c; });
const HOUSING = { preferences: { privacy: 3, leisure: 2 }, constraints: { budgetMax: 320000 }, objective: 'housing' };
const UNSAFE = /melhor lote|o melhor|garantid|ROI|rentabilidade|vai valorizar|valoriza[çc][ãa]o (certa|prevista)|probabilidade de compra/i;
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => strings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach(v => strings(v, out)); return out; };

// ====================================================================== config, registry
test('config: decision policy is bundled, versioned and every criterion maps to the field registry (nothing duplicated)', () => {
  const pol = D.policyOf(DEV); assert.equal(pol.kind, 'decision-policy'); assert.equal(pol.version, '1.0.0');
  assert.equal(pol.shortlistPolicy.defaultSize, 3); assert.equal(pol.shortlistPolicy.maxSize, 5);
  const reg = D.criterionRegistry(DEV); deq(reg.unknownFields, []);
  const fitKeys = Object.keys(App.fit.cfgOf(DEV).preferences), conKeys = Object.keys(App.recommendation.policyOf(DEV).constraints);
  for (const k of fitKeys) assert.ok(reg.get(k), 'preference ' + k);
  for (const k of conKeys) assert.ok(reg.get(k), 'constraint ' + k);
  assert.ok(reg.forConstraintBuilder().every(c => c.supportedAs === 'CONSTRAINT' || c.supportedAs === 'BOTH'), 'hard-constraint builder only offers registered constraints');
  assert.equal(reg.get('pricePerM2').supportedAs, 'DISPLAY_ONLY');
});

// ====================================================================== CustomerDecisionContext
test('DecisionAdHocProfile: context without a persisted Customer from the current panel state; objective explicit; budget stays broker-recorded; no Customer created', () => {
  const c = ctxOf(HOUSING);
  assert.equal(c.customerId, undefined); assert.equal(c.adHocProfileId, 'adhoc-current'); assert.equal(c.objective, 'HOUSING'); assert.equal(c.objectiveInformed, true);
  deq(c.budgetProfile, { currency: 'BRL', source: 'BROKER_RECORDED', purchaseBudget: { maxMinor: 32000000, currency: 'BRL' } });
  deq(c.constraints.map(x => [x.key, x.origin]), [['budgetMax', 'BROKER_CONFIRMED']]);
  deq(c.preferences.map(p => [p.key, p.importance]), [['leisure', 'MEDIUM'], ['privacy', 'HIGH']]);
  assert.ok(Object.isFrozen(c)); assert.equal(c.recommendationPolicyVersion, '1.0.0'); assert.equal(c.fitMethodologyVersion, '1.0.0');
  assert.equal(ctxOf(HOUSING).contextRef, c.contextRef, 'deterministic reference');
  assert.equal(ctxOf({ ...HOUSING, objective: 'premium' }).objective, 'UNDECIDED', 'a preset that does not say live/invest is never guessed');
  const none = ctxOf({ preferences: { privacy: 3 } }); assert.equal(none.objective, 'UNDECIDED'); assert.equal(none.objectiveInformed, false);
  const ad = D.createAdHoc({ objective: 'INVESTMENT', preferences: { priceQuality: 3 } }, { ttlMs: 3600e3, now: '2026-10-12T10:00:00Z' });
  assert.equal(ad.persistent, false); assert.equal(ad.expiresAt, '2026-10-12T11:00:00.000Z');
  const ca = D.buildContext({ organizationId: ORG, developmentId: DEV, adHoc: ad }); assert.equal(ca.objective, 'INVESTMENT'); assert.equal(ca.customerId, undefined); assert.equal(ca.adHocProfileId, ad.id);
  const v = D.validate(c); assert.ok(v.warnings.includes('AD_HOC_PROFILE'));
});
test('context with a persisted Customer: exact profile version, declared budget stays declared, estimated stays estimated; PII is never an id', () => {
  const CD = App.customer.domain, prof = CD.createPreferenceProfile({ organizationId: ORG, id: 'cus_t56' }, { now: '2026-10-12T09:00:00Z' });
  const r = CD.createProfileVersion({ profile: prof, input: { objective: 'INVEST', preferences: [{ key: 'priceQuality', importance: 'HIGH', source: 'CUSTOMER_EXPLICIT' }], hardConstraints: [{ key: 'budgetMax', value: 300000, source: 'CUSTOMER_EXPLICIT' }],
    budgetProfile: { maximumPurchasePrice: 300000, availableDownPayment: 40000, preferredMonthlyPaymentMax: 2500, dataState: 'PROVIDED' }, hardConstraintsReviewed: true } }, { developmentId: DEV, now: '2026-10-12T09:00:00Z' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const c = ctxOf({}, { customer: { customerId: 'cus_t56', profileVersion: r.version } });
  assert.equal(c.customerId, 'cus_t56'); assert.equal(c.customerProfileVersionId, r.version.id); assert.equal(c.objective, 'INVESTMENT');
  assert.equal(c.budgetProfile.source, 'CUSTOMER_DECLARED'); assert.equal(c.budgetProfile.downPaymentCapacity.maxMinor, 4000000); assert.equal(c.budgetProfile.monthlyPaymentCapacity.maxMinor, 250000);
  deq(c.constraints.map(x => [x.key, x.origin]), [['budgetMax', 'CUSTOMER_EXPLICIT']]);
  assert.equal(D.validate(c, { profileVersion: r.version }).profileCompleteness, 1);
  const est = D.budgetProfileOf({ declared: { source: 'ESTIMATED', purchaseMax: 280000 } }); assert.equal(est.source, 'ESTIMATED');
  assert.ok(D.validate(ctxOf({ preferences: { privacy: 3 } }, { budget: { source: 'ESTIMATED', purchaseMax: 280000 } })).warnings.includes('BUDGET_ESTIMATED'));
  assert.throws(() => ctxOf({}, { customer: { customerId: 'joao@mail.com' } }), /opaco/);
  assert.ok(!JSON.stringify(c).match(/@|displayName|"name"/), 'no customer name or contact in the context');
});

// ====================================================================== parity with the existing engine
test('parity: same engine inputs as the selectors, the selector result is consumed as-is, a recompute gives identical ranks/scores, and no lot data changes', () => {
  const before = JSON.stringify(lots.map(l => [l.identity.id, l.intelligence, l.commercial, l.availability]));
  for (const ui of [HOUSING, { preferences: { quiet: 3, lowTraffic: 2 } }, { preferences: { investment: 3 }, constraints: { areaMin: 300 } }, { preferences: { solar: 3, green: 2 }, constraints: { noCorner: true, budgetMax: 400000 } }]) {
    const s = st(ui), c = ctxOf(ui), ei = D.engineInputs(c), rec = sel.selectRecommendation(s);
    assert.equal(ei.profile.profileVersion, sel.selectProfile(s).profileVersion, 'same CustomerProfile version');
    deq(ei.constraints, sel.selectConstraints(s), 'same constraints');
    const a = run(c, { recommendation: rec }); assert.equal(a.engineResult, rec, 'selector result consumed, not recomputed');
    const b = run(c); // recomputed through App.recommendation.recommend
    deq(b.candidateSummaries.map(x => [x.lotId, x.recommendationRank, x.reviewRank, x.tier, x.fitScore, x.fitCoverage]), [...rec.recommendations, ...rec.reviewCandidates].map(x => [x.lotId, x.tier === 'REVIEW_REQUIRED' ? undefined : x.rank, x.tier === 'REVIEW_REQUIRED' ? x.rank : undefined, x.tier, x.fitScore, x.coverage]));
    assert.equal(a.recommendationResultId, rec.requestId); assert.equal(b.recommendationResultId, rec.requestId);
  }
  assert.equal(JSON.stringify(lots.map(l => [l.identity.id, l.intelligence, l.commercial, l.availability])), before, 'scores, classes, prices and availability untouched');
  const c = ctxOf(HOUSING), r1 = run(c), r2 = run(c); deq(r1.candidateSummaries.map(x => x.lotId), r2.candidateSummaries.map(x => x.lotId), 'deterministic');
  const stale = run(ctxOf(HOUSING), { recommendation: sel.selectRecommendation(st({ preferences: { quiet: 3 } })) });
  assert.ok(stale.warnings.includes('RESULT_CONTEXT_MISMATCH_RECOMPUTED'), 'a result of another profile is never presented for this context');
});

// ====================================================================== golden scenarios
test('DecisionHousingBudgetStrict / DecisionUnknownCriticalData: over-budget excluded with its reason, sold excluded, unknown noise is review (never pass), explainable shortlist of 3', () => {
  const soldCode = 'I2', unknownNoise = 'Q1';
  let ls = withStatus({ [soldCode]: 'SOLD' });
  ls = ls.map(l => { if (l.identity.code !== unknownNoise) return l; const c = clone(l); c.environmental.noiseLevel = null; if (c.provenance && c.provenance['environmental.noiseLevel']) c.provenance['environmental.noiseLevel'].status = 'UNKNOWN'; return c; });
  const ui = { preferences: { privacy: 3, leisure: 2 }, constraints: { budgetMax: 320000, maxNoise: ['VERY_LOW', 'LOW', 'MEDIUM'] }, objective: 'housing' };
  const r = run(ctxOf(ui), { lots: ls });
  assert.equal(r.status, 'OPTIONS_PENDING_CONFIRMATION', 'availability UNKNOWN for the feed-less lots: never "available now"');
  assert.ok(!r.candidateSummaries.some(c => c.code === soldCode), 'sold lot is never a candidate');
  const ex = r.engineResult.excluded; assert.equal(ex.find(e => e.code === soldCode).reasonCode, 'SOLD');
  assert.ok(r.exclusions.byReason.PRICE_ABOVE_MAX > 0); const over = ex.find(e => e.reasonCode === 'PRICE_ABOVE_MAX'); assert.ok(over.actualValue > 320000 && over.expectedValue === 320000);
  const q = S.forLot(r, ls.find(l => l.identity.code === unknownNoise).identity.id, { lots: ls, context: ctxOf(ui), priceTable: pt, availabilityPolicy: avPol });
  assert.ok(q, 'lot with unknown noise is still visible'); assert.equal(q.eligibility, 'REVIEW_REQUIRED', 'unknown is never a pass'); assert.ok(q.allTradeoffs.some(t => t.code === 'UNKNOWN_NOISE' && t.type === 'DATA_UNCERTAINTY'));
  assert.equal(r.suggestedShortlistIds.length, 3);
  for (const id of r.suggestedShortlistIds) {
    const c = r.candidateSummaries.find(x => x.lotId === id);
    assert.ok(c.keyReasons.length >= 1, 'why included'); assert.equal(c.keyReasons[0].code, 'WITHIN_BUDGET', 'budget fact first');
    assert.equal(c.commercialViability.status, 'NEEDS_CONFIRMATION'); assert.ok(c.allTradeoffs.some(t => t.code === 'AVAILABILITY_TO_CONFIRM'), 'availability caveat');
    assert.ok(S.explanation(c, r).versionRefs.priceTableVersion, 'version context');
  }
  const vm = S.viewModel(r, { context: ctxOf(ui) });
  assert.ok(vm.cards.every(c => c.availability === 'Disponibilidade sujeita a confirmação'));
  assert.ok(!strings(vm).some(s => UNSAFE.test(s)), 'no absolute "best lot" / guarantee wording');
});
test('confirmed availability: eligible lots are offered first, PRIMARY tier, READY_TO_OFFER; a sold lot with high fit stays out', () => {
  const r0 = run(ctxOf(HOUSING)), top = r0.candidateSummaries.slice(0, 5).map(c => c.code);
  const ls = withStatus({ [top[0]]: 'SOLD', [top[1]]: 'AVAILABLE', [top[2]]: 'AVAILABLE', [top[3]]: 'AVAILABLE' });
  const r = run(ctxOf(HOUSING), { lots: ls, freshness: FRESH });
  assert.equal(r.status, 'CONFIRMED_OPTIONS'); assert.equal(r.counts.eligible, 3);
  deq(r.suggestedShortlistIds, [top[1], top[2], top[3]].map(c => byCode(c).identity.id));
  const c1 = r.candidateSummaries[0]; assert.equal(c1.eligibility, 'ELIGIBLE'); assert.equal(c1.recommendationRank, 1); assert.equal(c1.tier, 'PRIMARY'); assert.equal(c1.commercialViability.status, 'READY_TO_OFFER');
  assert.ok(!r.candidateSummaries.some(c => c.code === top[0]));
  assert.equal(S.viewModel(r, { context: ctxOf(HOUSING) }).cards[0].availability, 'Disponível (confirmado)');
});
test('DecisionStaleAvailability: AVAILABLE but stale is NEEDS_CONFIRMATION, never "available now"; readiness MEDIUM even with high Fit', () => {
  const r0 = run(ctxOf(HOUSING)), code = r0.candidateSummaries[0].code;
  const ls = withStatus({ [code]: { status: 'AVAILABLE', freshness: 'STALE' } });
  const r = run(ctxOf(HOUSING), { lots: ls, freshness: { commercial: { status: 'FRESH' }, availability: { status: 'STALE' } } });
  const c = r.candidateSummaries.find(x => x.code === code);
  assert.equal(c.eligibility, 'REVIEW_REQUIRED'); assert.equal(c.commercialViability.status, 'NEEDS_CONFIRMATION');
  assert.ok(c.fitScore > 80); assert.equal(r.readiness.status, 'MEDIUM'); assert.equal(r.readiness.availabilityFreshness, 'STALE');
  assert.notEqual(S.viewModel(r, { context: ctxOf(HOUSING) }).cards.find(x => x.lotId === c.lotId).availability, 'Disponível (confirmado)');
});
test('DecisionInvestmentLowerTicket: factual reasons, lowest ticket labelled as a fact of the list, table conditions, no ROI / guaranteed valorização', () => {
  const ui = { preferences: { priceQuality: 3 }, constraints: { budgetMax: 300000 }, objective: 'investment' }, c = ctxOf(ui), r = run(c);
  assert.equal(r.objective, 'INVESTMENT');
  const min = Math.min(...r.candidateSummaries.map(x => x.commercialSnapshot.price));
  for (const x of r.candidateSummaries) assert.equal(x.allReasons.some(z => z.code === 'LOWEST_TICKET_IN_LIST'), x.commercialSnapshot.price === min);
  const oc = r.candidateSummaries[0].objectiveContext; assert.equal(oc.objective, 'INVESTMENT'); assert.ok(oc.facts.some(f => /Investidor 18x/.test(f))); assert.ok(oc.facts.some(f => /não é promessa de valorização/.test(f)));
  const all = [...strings(S.viewModel(r, { context: c })), ...strings(S.clientSafe(r))];
  assert.ok(!all.some(s => UNSAFE.test(s)), all.find(s => UNSAFE.test(s)));
  deq(S.clientSafe(r).safety.issues, []);
});
test('DecisionInvestmentPaymentFlexibility / DecisionFinancialIncompatible: FinancialCompatibility consumes the finance service; price PASS can still be financially partial', () => {
  const ui = { preferences: { priceQuality: 3 }, constraints: { budgetMax: 320000 }, objective: 'investment' };
  const ok = run(ctxOf(ui, { budget: { source: 'CUSTOMER_DECLARED', purchaseMax: 320000, downPaymentMax: 60000, monthlyMax: 20000 } }));
  const c = ok.candidateSummaries[0], lot = repo.getLotById(c.lotId), fin = c.financialCompatibility;
  const sim = App.services.finance.simulate({ price: lot.commercial.price, downPaymentPct: lot.commercial.downPaymentDefaultPercent, plans: pt.plans });
  assert.equal(fin.downPayment, sim.downPayment); deq(fin.plans.map(p => p.monthly), sim.plans.map(p => p.main.value), 'no formula duplicated');
  assert.equal(fin.status, 'COMPATIBLE'); assert.ok(fin.bestKnownPlanId); assert.ok(fin.warnings.includes('DOWN_PAYMENT_DEFAULT_TO_CONFIRM'));
  const part = run(ctxOf(ui, { budget: { source: 'CUSTOMER_DECLARED', purchaseMax: 320000, downPaymentMax: 10000, monthlyMax: 20000 } })).candidateSummaries[0];
  assert.equal(part.allReasons[0].code, 'WITHIN_BUDGET', 'price constraint PASS'); assert.equal(part.financialCompatibility.status, 'PARTIALLY_COMPATIBLE'); assert.equal(part.financialCompatibility.downPaymentCompatible, false);
  assert.ok(part.allTradeoffs.some(t => t.type === 'FINANCIAL_TRADEOFF'));
  const bad = run(ctxOf(ui, { budget: { source: 'CUSTOMER_DECLARED', purchaseMax: 320000, downPaymentMax: 10000, monthlyMax: 500 } })).candidateSummaries[0].financialCompatibility;
  assert.equal(bad.status, 'INCOMPATIBLE');
  const unk = run(ctxOf(ui)).candidateSummaries[0].financialCompatibility; assert.equal(unk.status, 'UNKNOWN'); assert.ok(unk.warnings.includes('CAPACITY_NOT_INFORMED'));
});
test('DecisionPartialProfile: recommends with a partial profile, says so, and the next step is to confirm the budget', () => {
  const c = ctxOf({ preferences: { privacy: 3 } }), r = run(c);
  assert.equal(r.validation.status, 'READY_WITH_WARNINGS'); assert.ok(r.validation.warnings.includes('BUDGET_NOT_INFORMED')); assert.ok(r.validation.warnings.includes('PARTIAL_PROFILE'));
  assert.ok(r.candidateSummaries.length > 0); assert.equal(r.nextBestAction.actionType, 'CONFIRM_BUDGET'); assert.equal(r.nextBestAction.requiresHumanConfirmation, true);
  assert.equal(r.readiness.status, 'MEDIUM'); assert.ok(r.readiness.warnings.includes('PARTIAL_PROFILE'));
  assert.ok(S.viewModel(r, { context: c }).readiness.items.includes('Recomendação baseada em perfil parcial'));
});
test('DecisionNoEligibleLots / insufficient / invalid: no fake recommendation; resolution suggestions need confirmation and nothing is relaxed', () => {
  const r = run(ctxOf({ preferences: { privacy: 3 }, constraints: { budgetMax: 100000 } }));
  assert.equal(r.status, 'NO_ELIGIBLE_LOTS'); assert.equal(r.candidateSummaries.length, 0); deq(r.suggestedShortlistIds, []);
  assert.equal(r.readiness.status, 'NOT_READY'); assert.ok(r.resolutionSuggestions.some(s => s.code === 'INCREASE_BUDGET' && s.requiresUserConfirmation === true));
  assert.equal(r.engineResult.excluded.every(e => e.reasonCode === 'PRICE_ABOVE_MAX'), true, 'the constraint was kept, never auto-relaxed');
  const e = run(ctxOf({})); assert.equal(e.status, 'INSUFFICIENT_CONTEXT'); assert.equal(e.nextBestAction.actionType, 'CONFIRM_PREFERENCE');
  const bad = run(ctxOf({ constraints: { areaMin: 400, areaMax: 300 } })); assert.equal(bad.status, 'INVALID_CONTEXT'); assert.equal(bad.validation.status, 'INVALID');
});
test('DecisionNoStrongRecommendation: alternatives are listed but the system says no option fits well (never forces a top 1)', () => {
  const r = run(ctxOf({ preferences: { privacy: 3 }, constraints: { blocks: ['C', 'D'] } }));
  assert.ok(r.candidateSummaries.length > 0); assert.equal(r.status, 'NO_STRONG_MATCH'); assert.equal(r.counts.strong, 0);
  assert.equal(S.viewModel(r, {}).status.title, 'Nenhuma opção atende bem aos critérios atuais');
});

// ====================================================================== session, shortlist, override
test('session lifecycle: DRAFT → ACTIVE on first result, free transitions with history, ARCHIVED final, results never overwritten; deny by default', () => {
  assert.equal(D.startSession({ organizationId: ORG, developmentId: DEV }, { developmentId: DEV }).code, 'FORBIDDEN', 'no permission → denied');
  const c = ctxOf(HOUSING), r = run(c); let s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session;
  assert.equal(s.status, 'DRAFT'); assert.equal(s.customerDecisionContextRef, c.contextRef);
  s = D.attachResult(s, r).session; assert.equal(s.status, 'ACTIVE'); assert.equal(s.recommendationResultId, r.recommendationResultId);
  const r2 = run(ctxOf({ ...HOUSING, preferences: { privacy: 3 } })); s = D.attachResult(s, r2, { refreshReason: 'PROFILE_CHANGED' }).session;
  deq(s.previousResultIds, [r.recommendationResultId], 'the previous RecommendationResult is kept');
  s = D.transition(s, 'SHORTLIST_READY').session; s = D.transition(s, 'ACTIVE', { reasonCode: 'BACK_TO_SEARCH' }).session; assert.equal(s.status, 'ACTIVE');
  assert.equal(D.transition(s, 'PRESENTED', { expectedRevision: '1' }).code, 'REVISION_CONFLICT');
  s = D.transition(s, 'CLOSED', { outcome: 'CUSTOMER_SELECTED_LOT', selectedLotId: r.suggestedShortlistIds[0] }).session; assert.equal(s.outcome, 'CUSTOMER_SELECTED_LOT');
  s = D.transition(s, 'ARCHIVED').session; assert.equal(D.transition(s, 'ACTIVE').code, 'INVALID_TRANSITION');
  deq(s.transitions.map(t => t.to), ['SHORTLIST_READY', 'ACTIVE', 'CLOSED', 'ARCHIVED']);
  assert.ok(s.history.some(h => h.eventType === 'SESSION_CLOSED'));
  assert.equal(D.sameCustomer(s, ctxOf(HOUSING, { customer: { customerId: 'cus_other' } })), false, 'another customer never reuses this session');
  const repoD = D.createRepository(); assert.ok(repoD.save(LOCAL, s).ok); assert.equal(repoD.save(LOCAL, s, '1').code, 'REVISION_CONFLICT');
  assert.equal(repoD.getById({ ...LOCAL, organizationId: 'org_x' }, s.id), null, 'tenant scoped'); assert.equal(repoD.persistent, false);
});
test('DecisionShortlistThreeCandidates / DecisionBrokerOverride: analytical rank untouched, curated order separate, sensitive promotion needs reason + acknowledgement, breach stays visible', () => {
  const c = ctxOf(HOUSING), r = run(c), engineBefore = JSON.stringify(r.engineResult);
  const s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session;
  let sl = D.createShortlist(s, r).shortlist; assert.equal(sl.candidates.length, 3); assert.equal(sl.source, 'RECOMMENDATION');
  const ranks = sl.candidates.map(x => x.reviewRank);
  // reorder: curated position changes, analytical rank does not
  const ro = D.applyOverride(sl, { action: 'REORDER', lotId: sl.orderedCandidateIds[2], toPosition: 1 }, { context: c, tenant: LOCAL }); assert.ok(ro.ok);
  assert.equal(ro.shortlist.orderedCandidateIds[0], sl.orderedCandidateIds[2]); assert.equal(ro.shortlist.candidates[0].reviewRank, ranks[2]); assert.equal(ro.shortlist.source, 'BROKER_CURATED');
  sl = ro.shortlist;
  // over-budget lot: reason, OTHER needs note, acknowledgement required
  const overId = r.engineResult.excluded.find(e => e.reasonCode === 'PRICE_ABOVE_MAX').lotId;
  const cand = S.forLot(r, overId, { lots, context: c, priceTable: pt, availabilityPolicy: avPol });
  assert.equal(cand.eligibility, 'INELIGIBLE'); assert.equal(cand.exclusionReasonCode, 'PRICE_ABOVE_MAX');
  const base = { action: 'PROMOTE_TO_SHORTLIST', lotId: overId };
  assert.equal(D.applyOverride(sl, base, { context: c, tenant: LOCAL, candidate: cand }).code, 'REASON_REQUIRED');
  assert.equal(D.applyOverride(sl, { ...base, reasonCode: 'OTHER' }, { context: c, tenant: LOCAL, candidate: cand }).code, 'NOTE_REQUIRED');
  const w = D.applyOverride(sl, { ...base, reasonCode: 'CUSTOMER_REQUESTED' }, { context: c, tenant: LOCAL, candidate: cand }); assert.equal(w.code, 'WARNING_NOT_ACKNOWLEDGED'); assert.ok(w.breaches.includes('PRICE_ABOVE_MAX'));
  assert.equal(D.applyOverride(sl, { ...base, reasonCode: 'CUSTOMER_REQUESTED', acknowledgeWarning: true }, { context: c, tenant: { organizationId: ORG }, candidate: cand }).code, 'FORBIDDEN', 'decision.override denied by default');
  assert.equal(D.applyOverride(sl, { ...base, reasonCode: 'CUSTOMER_REQUESTED', acknowledgeWarning: true }, { context: c, tenant: LOCAL, candidate: cand, expectedRevision: '1' }).code, 'REVISION_CONFLICT');
  const ok = D.applyOverride(sl, { ...base, reasonCode: 'OTHER', note: 'Cliente Maria pediu ver este (telefone 27999990000)', acknowledgeWarning: true }, { context: c, tenant: LOCAL, candidate: cand });
  assert.ok(ok.ok); assert.equal(ok.shortlist.candidates.length, 4); const added = ok.shortlist.candidates[3];
  assert.equal(added.eligibility, 'INELIGIBLE', 'FAIL is never turned into PASS'); deq(added.constraintBreaches, ['INELIGIBLE', 'PRICE_ABOVE_MAX'].filter(b => added.constraintBreaches.includes(b)));
  assert.ok(added.constraintBreaches.includes('PRICE_ABOVE_MAX'));
  assert.ok(!JSON.stringify(ok.history).includes('Maria') && !JSON.stringify(ok.audit).includes('Maria'), 'notes never reach history or audit');
  assert.equal(JSON.stringify(r.engineResult), engineBefore, 'Recommendation result unchanged');
  // max size
  let full = ok.shortlist; const extra = r.candidateSummaries.filter(x => !full.candidateIds.includes(x.lotId));
  full = D.applyOverride(full, { action: 'PROMOTE_TO_SHORTLIST', lotId: extra[0].lotId, reasonCode: 'VISIT_CONTEXT', acknowledgeWarning: true }, { context: c, tenant: LOCAL, candidate: extra[0] }).shortlist;
  assert.equal(D.applyOverride(full, { action: 'PROMOTE_TO_SHORTLIST', lotId: extra[1].lotId, reasonCode: 'VISIT_CONTEXT', acknowledgeWarning: true }, { context: c, tenant: LOCAL, candidate: extra[1] }).code, 'SHORTLIST_FULL');
  // the view keeps the breach visible and the client-safe projection explains it factually, without the note
  const r2 = run(c, { shortlist: ok.shortlist }), vm = S.viewModel(r2, { context: c, shortlist: ok.shortlist, extraCandidates: [cand] });
  assert.ok(vm.cards.find(x => x.lotId === overId).breach); assert.equal(r2.quality.brokerOverrideCount, 2);
  const cs = S.clientSafe(r2, { shortlist: ok.shortlist, candidates: [cand] }), item = cs.items.find(i => i.lot === cand.displayCode);
  assert.match(item.note, /fora de um dos critérios inicialmente informados/); assert.ok(!JSON.stringify(cs).match(/Maria|2799|320\.000|Compatibilidade|%/));
});
test('DecisionLotSoldAfterShortlist / DecisionPriceChangedAfterRecommendation: history preserved, live overlay marks sold, replacement suggested (broker confirms), currentness explicit', () => {
  const c = ctxOf(HOUSING), r = run(c), s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session, sl = D.createShortlist(s, r).shortlist;
  const snap = D.snapshot(s, r, { shortlist: sl }); assert.match(snap.checksum, /^[0-9a-f]+$/); assert.equal(D.snapshot(s, r, { shortlist: sl }).checksum, snap.checksum);
  const soldId = sl.orderedCandidateIds[0], ls = withStatus({ [repo.getLotById(soldId).identity.code]: 'SOLD' });
  const ov = S.liveOverlay(sl, id => ls.find(l => l.identity.id === id), { availabilityPolicy: avPol, freshness: FRESH }, c);
  assert.equal(ov[0].message, 'Recomendado anteriormente — atualmente vendido'); assert.equal(ov[0].changed, true);
  deq(sl.orderedCandidateIds[0], soldId, 'the shortlist keeps the historical record');
  const rep = S.replacementSuggestions(sl, ov, r); assert.equal(rep.length, 1); assert.equal(rep[0].replacedLotId, soldId); assert.ok(!sl.candidateIds.includes(rep[0].replacementLotId)); assert.equal(rep[0].status, 'PENDING');
  const cur = { ...snap }; assert.equal(D.currentness(snap, cur, DEV).currentness, 'CURRENT');
  const price = D.currentness(snap, { ...snap, priceTableVersion: '2027-01-01' }, DEV); assert.equal(price.currentness, 'COMMERCIAL_CHANGED'); assert.equal(price.refresh, 'SUGGEST'); deq(price.refreshReasons, ['PRICE_CHANGED']);
  const prof = D.currentness(snap, { ...snap, profileVersion: 'x' }, DEV); assert.equal(prof.currentness, 'PROFILE_CHANGED'); assert.equal(prof.refresh, 'REQUIRED');
  assert.equal(D.currentness(snap, { ...snap, fitMethodologyVersion: '2.0.0' }, DEV).currentness, 'METHODOLOGY_CHANGED');
  // price went above the budget for a shortlisted lot: flagged, not removed
  const pricey = lots.map(l => l.identity.id !== sl.orderedCandidateIds[1] ? l : (x => (x.commercial.price = 999999, x))(clone(l)));
  const ov2 = S.liveOverlay(sl, id => pricey.find(l => l.identity.id === id), { availabilityPolicy: avPol, freshness: FRESH }, c);
  assert.equal(ov2[1].overBudgetNow, true); assert.equal(ov2[1].message, 'Preço atual acima do orçamento informado');
});
test('DecisionCustomerFeedbackSuggestion: feedback suggests a preference (PENDING, inactive); the profile is never changed automatically', () => {
  const c = ctxOf(HOUSING), s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session;
  const f1 = D.recordFeedback(s, { lotId: 'VJ-QI-L0002', feedbackType: 'LOCATION_NOT_PREFERRED', criterionId: 'gate', note: 'longe da portaria' });
  const f2 = D.recordFeedback(s, { lotId: 'VJ-QQ-L0001', feedbackType: 'LOCATION_NOT_PREFERRED', criterionId: 'gate' });
  assert.ok(f1.ok && f2.ok); assert.ok(!JSON.stringify(f1.history).includes('portaria'), 'note kept out of history');
  assert.equal(D.recordFeedback(s, { feedbackType: 'NOPE' }).code, 'INVALID_FEEDBACK');
  assert.equal(D.suggestPreferences([f1.feedback], { developmentId: DEV, context: c }).length, 0, 'below the threshold');
  const sug = D.suggestPreferences([f1.feedback, f2.feedback], { developmentId: DEV, context: c, customerId: 'cus_1' });
  assert.equal(sug.length, 1); assert.equal(sug[0].criterionId, 'gate'); assert.equal(sug[0].status, 'PENDING'); assert.equal(sug[0].suggestedPreference.active, false); assert.equal(sug[0].suggestedPreference.source, 'SYSTEM_SUGGESTED_UNCONFIRMED');
  assert.ok(!c.preferences.some(p => p.key === 'gate'), 'context untouched');
  const acc = D.resolveSuggestion(sug[0], true, { developmentId: DEV }); assert.equal(acc.suggestion.status, 'ACCEPTED'); deq(acc.uiPatch, { preferences: { gate: 2 } });
  assert.equal(D.resolveSuggestion(sug[0], false, { developmentId: DEV }).uiPatch, null);
});

// ====================================================================== readiness, next action, capabilities, comparison, presentation
test('next best action follows the stage and is always a suggestion: compare → simulate → present; status confirmation before deciding', () => {
  const c = ctxOf({ ...HOUSING, constraints: { budgetMax: 320000 } });
  assert.deepEqual(run(c).nextActions.map(a => a.actionType), ['COMPARE', 'REQUEST_STATUS_CONFIRMATION']);
  assert.equal(run(c, { progress: { compared: true } }).nextBestAction.actionType, 'SIMULATE');
  assert.equal(run(c, { progress: { compared: true, simulated: true } }).nextBestAction.actionType, 'PREPARE_PRESENTATION');
  const dec = run(c, { mode: 'DECIDE', progress: { compared: true, simulated: true, feedback: [{ feedbackType: 'WANTS_VISIT' }] } });
  deq(dec.nextActions.map(a => a.actionType), ['REQUEST_STATUS_CONFIRMATION', 'PREPARE_PRESENTATION', 'SCHEDULE_VISIT']);
  assert.ok(dec.nextActions.every(a => a.requiresHumanConfirmation === true && a.automation !== 'AUTO_ALLOWED'));
  const caps = S.capabilities({ online: false, tenant: LOCAL, developmentId: DEV, shortlistCount: 3 }), cap = k => caps.find(x => x.action === k);
  assert.equal(cap('EXPLORE').allowed, true); assert.equal(cap('COMPARE').allowed, true); assert.equal(cap('SHARE').allowed, false); assert.equal(cap('RESERVE_OR_PROPOSAL').allowed, false);
  assert.equal(S.capabilities({ online: true, tenant: LOCAL, developmentId: DEV, shortlistCount: 3 }).find(x => x.action === 'SHARE').allowed, false, 'share needs server permission');
  assert.equal(run(c, { offline: true }).readiness.warnings.includes('OFFLINE'), true);
});
test('DecisionCompareFinalists / DecisionPresentationSnapshot: comparison bound to the context, presentation from the curated shortlist (snapshot, never live ranking), client-safe', () => {
  const c = ctxOf(HOUSING), r = run(c), s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session, sl = D.createShortlist(s, r).shortlist;
  const cc = S.comparisonContext(s, r, c); deq(cc.lotIds, sl.orderedCandidateIds); deq(cc.highlightedCriterionIds, ['leisure', 'privacy', 'budgetMax']); assert.equal(cc.versionRefs, r.versionRefs);
  const inp = S.presentationInput(sl); deq(inp.collection.lotIds, sl.orderedCandidateIds);
  const PD = App.presentationMode.domain, pctx = { organizationId: ORG, developmentId: DEV, can: () => true, now: '2026-10-12T10:00:00Z' };
  const def = PD.fromFavorites(pctx, { collection: inp.collection, developmentId: DEV, title: inp.title }); deq(def.lotIds, sl.orderedCandidateIds);
  const cs = S.clientSafe(r, { shortlist: sl }); assert.equal(cs.items.length, 3); deq(cs.safety.issues, []);
  const txt = JSON.stringify(cs); assert.ok(!/fitScore|Compatibilidade \d|REVIEW_REQUIRED|AVAILABILITY_UNKNOWN|cus_|budget|320/.test(txt), txt);
  assert.ok(cs.items.every(i => i.availability === 'Disponibilidade a confirmar'));
});
test('view: broker panel shows facts before score, the availability caveat, only known data-acts; client list hides score; QuickView block reuses the result', () => {
  const c = ctxOf(HOUSING), r = run(c), vm = S.viewModel(r, { context: c, customerLabel: 'Atendendo: João' }), html = V.panel(vm);
  assert.match(html, /O que mostrar a este cliente — e por quê/); assert.match(html, /Disponibilidade sujeita a confirmação/); assert.match(html, /Próximo passo sugerido/);
  assert.ok(html.indexOf('Dentro do orçamento informado') < html.indexOf('Compatibilidade '), 'facts before score');
  const acts = [...new Set([...html.matchAll(/data-act="([^"]+)"/g)].map(m => m[1]))].sort();
  const known = new Set(['goLot', 'explain', 'cmp', 'openFind', ...V.ACTS]); assert.ok(acts.every(a => known.has(a)), acts.join(','));
  assert.ok(!UNSAFE.test(html)); assert.ok(!/<script/i.test(V.panel(S.viewModel(r, { context: c, customerLabel: '<script>x</script>' }))), 'escaped');
  const cl = V.clientList(S.clientSafe(r)); assert.ok(!/%|Compatibilidade/.test(cl)); assert.match(cl, /preço de tabela/);
  const qv = S.quickViewBlock(r, r.candidateSummaries[0].lotId, 'broker'); assert.equal(qv.title, 'Para este cliente'); assert.match(qv.lines.join('|'), /sujeita a confirmação/);
  assert.ok(!S.quickViewBlock(r, r.candidateSummaries[0].lotId, 'client').lines.some(l => /%/.test(l)));
  assert.equal(S.quickViewBlock(null, 'x'), null, 'without a customer the Quick View stays lot-global');
  deq(S.mapOverlay(null).groups, { PRIMARY: [], STRONG_MATCH: [], ALTERNATIVE: [], REVIEW_REQUIRED: [] }); assert.equal(S.mapOverlay(r).replacesAvailabilityLayer, false);
  assert.match(V.overrideConfirm({ lotId: 'x', lotCode: 'QA L1', breaches: ['PRICE_ABOVE_MAX'], reasons: [{ code: 'CUSTOMER_REQUESTED', label: 'Pedido do cliente' }] }), /excede o orçamento máximo informado/);
});
test('privacy and analytics boundary: aggregate-only payloads, no PII/budget/notes, nothing persisted, CONFIDENTIAL classification', () => {
  const c = ctxOf(HOUSING, { customer: { customerId: 'cus_123' } }), r = run(c);
  const p = S.analyticsPayload(r, { action: 'recommendation_generated' }); assert.ok(!/cus_|320000|32000000|budget|preferences/.test(JSON.stringify(p)));
  assert.equal(D.policyOf(DEV).security.classification, 'CONFIDENTIAL'); assert.equal(D.policyOf(DEV).security.persistOffline, false);
  const ev = D.historyEvent('ds_1', 'CONTEXT_UPDATED', { note: 'x', budgetMax: 1, customerName: 'João', lotId: 'L1' }); deq(Object.keys(ev.metadata), ['lotId']);
  assert.equal(S.summary(null, r, null).recommendationCount, r.candidateSummaries.length);
});
test('curation UX: adding a lot pending only availability confirmation (same rule as the suggestion) needs no reason; removing needs none; a lot pending other data does', () => {
  const c = ctxOf(HOUSING), r = run(c), s = D.startSession(LOCAL, { developmentId: DEV, context: c }).session; let sl = D.createShortlist(s, r).shortlist;
  const other = r.candidateSummaries.find(x => !sl.candidateIds.includes(x.lotId) && x.reviewCategory === 'AVAILABILITY');
  const add = D.applyOverride(sl, { action: 'PROMOTE_TO_SHORTLIST', lotId: other.lotId }, { context: c, tenant: LOCAL, candidate: other }); assert.ok(add.ok); deq(add.shortlist.candidates[3].constraintBreaches, []);
  assert.ok(D.applyOverride(add.shortlist, { action: 'REMOVE_FROM_SHORTLIST', lotId: other.lotId }, { context: c, tenant: LOCAL }).ok);
  const pend = { ...other, reviewCategory: 'CONSTRAINT_DATA' };
  assert.equal(D.applyOverride(sl, { action: 'PROMOTE_TO_SHORTLIST', lotId: other.lotId }, { context: c, tenant: LOCAL, candidate: pend }).code, 'REASON_REQUIRED');
});
test('analytics: decTrack event names are registered for the browser and accepted locally with the aggregate payload (no PII, local only)', () => {
  const c = ctxOf(HOUSING, { customer: { customerId: 'cus_123' } }), r = run(c), reg = App.eventTracking.registry.current();
  const src = fs.readFileSync(path.join(SRC, 'presentation', 'app.js'), 'utf8'), names = [...new Set([...src.matchAll(/decTrack\('([a-z_]+)'/g)].map(m => m[1]))];
  assert.ok(names.length >= 3, 'decTrack call sites found');
  for (const n of names) {
    assert.ok(reg.isRegistered(n), n + ' registered'); assert.ok(reg.get(n).sources.includes('WEB_CLIENT'), n + ' producible by the browser');
    const res = App.analytics.client.track(n, S.analyticsPayload(r), { organizationId: undefined });
    assert.ok(['ACCEPTED', 'DUPLICATE'].includes(res.status), n + ' → ' + res.status + ' ' + JSON.stringify(res.issues || res.reason || ''));
    assert.ok(Object.values(res.deliveries || {}).every(d => d.status !== 'PENDING'), 'nothing leaves the device');
  }
  assert.ok(!/cus_|320000|budget/.test(JSON.stringify(App.analytics.client.recent ? App.analytics.client.recent() : App.analytics.log)));
});
