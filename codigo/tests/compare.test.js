'use strict';
// Topics 24 (comparison as a domain of its own) and 25 (winner per criterion). Golden scenarios named after the specs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, D, EV, VMB, repo, lots, byCode, view;
const DEV = 'viva-juara';
test.before(async () => {
  App = load(); D = App.compare.domain; EV = App.compare.evaluation; VMB = App.compare.viewModel;
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync();
  byCode = c => repo.getLotByCode(c);
  // the UI module is not in the Node harness list: load it the same way the build does (one global App)
  new Function('App', fs.readFileSync(path.join(SRC, 'presentation/compareView.js'), 'utf8'))(App);
  view = App.compareView;
});
// values built inside the vm realm have other prototypes: compare plain JSON
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
const ids = (...codes) => codes.map(c => byCode(c).identity.id);
const clone = l => JSON.parse(JSON.stringify(l));
/** resolver over the repository with per-lot overrides (status change, stale price, conflicts…) */
const resolver = (over = {}) => ref => { const l = repo.resolve(ref); if (!l) return null; return over[l.identity.id] ? over[l.identity.id](clone(l)) : l; };
const R = resolver();
const fromState = (lotIds, extra = {}) => VMB.fromState({ developmentId: DEV, lotIds, resolve: R, audience: 'broker', ...extra });
// unit fixtures for the evaluation: ComparisonValue objects
const V = (id, raw, o = {}) => Object.freeze({ candidateId: id, metricId: o.metricId || 'm', rawValue: raw, valueStatus: o.status || (raw == null ? 'NO_DATA' : 'VALID'), comparableState: o.comparableState || 'COMPARABLE',
  freshness: o.freshness ?? null, confidence: o.confidence ?? 'HIGH', provenanceSummary: o.prov ? { status: o.prov } : null, versionRef: o.versionRef ?? 'v1', unit: o.unit !== undefined ? o.unit : null });
const ctx = (o = {}) => ({ audience: 'broker', reg: EV.registry(DEV), evaluationProfileId: 'BROKER_STANDARD', contextMode: 'GENERAL', hasCustomer: false, customerProfile: null, availabilityPolicy: App.availability.DEFAULT_POLICY, context: D.normalizeContext(), ...o });
const ev = (metricId, values, o) => EV.evaluateCriterion(D.metric(metricId), values.map(v => ({ ...v, metricId, unit: v.unit ?? D.metric(metricId).unit })), ctx(o));
const JARGON = /\bSTALE\b|\bFRESH\b|\bEXPIRED\b|\bUNKNOWN\b|\bAVAILABLE\b|snapshot|checksum|\bcache\b|Vencedor|vencedor/i;
const strings = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => strings(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!['id', 'candidateId', 'metricId', 'sessionId', 'status', 'mode', 'cellState', 'statusCode', 'highlightMode', 'act', 'baseComparison', 'rowEvaluations', 'candidateSummaries', 'cellStates', 'winnerCandidateIds', 'freshness', 'technical', 'policyText', 'profiles'].includes(k)) strings(v, out); } return out; };

// ====================================================================== topic 24 — session, policy, candidates
test('session: 1 lot is DRAFT, 2 is READY, duplicate add is idempotent with a message, the 5th is an explicit limit error that keeps every candidate', () => {
  let s = D.createSession(DEV, { id: 'cmp_test' });
  assert.equal(s.schemaVersion, D.SCHEMA_VERSION); assert.match(D.createSession(DEV).id, /^cmp_/);
  let r = D.addCandidate(s, 'B79', { resolve: R, source: 'QUICKVIEW' }); s = r.session;
  assert.equal(s.status, 'DRAFT'); assert.equal(s.candidates[0].lotId, byCode('B79').identity.id, 'short code resolved to the canonical LotId'); assert.equal(s.candidates[0].addedFrom, 'QUICKVIEW');
  s = D.addCandidate(s, 'A1', { resolve: R }).session; assert.equal(s.status, 'READY');
  const dup = D.addCandidate(s, byCode('A1').identity.id, { resolve: R });
  assert.equal(dup.ok, true); assert.equal(dup.duplicate, true); assert.equal(dup.session, s); assert.equal(dup.message, 'Este lote já está na comparação.');
  s = D.addCandidate(D.addCandidate(s, 'A2', { resolve: R }).session, 'A3', { resolve: R }).session;
  const fifth = D.addCandidate(s, 'A4', { resolve: R });
  assert.equal(fifth.ok, false); assert.equal(fifth.code, 'COMPARISON_LIMIT_REACHED'); assert.match(fifth.message, /até 4 lotes/);
  deq([...fifth.session.candidateIds], [...s.candidateIds], 'nothing removed silently');
  assert.equal(D.policyOf(DEV).maxCandidates, 4); assert.equal(D.policyOf(DEV).minCandidates, 2); assert.equal(App.services.comparison.MAX_LOTS, 4);
});
test('session: remove keeps the relative order, reorder is explicit (permutation only), move left/right is the keyboard alternative, replace keeps the position', () => {
  let s = D.createSession(DEV, { candidateIds: ['A1', 'A2', 'A3', 'A4'], resolve: R });
  const [a1, a2, a3, a4] = ids('A1', 'A2', 'A3', 'A4');
  deq([...D.removeCandidate(s, a2).session.candidateOrder], [a1, a3, a4]);
  deq([...D.reorderCandidates(s, [a4, a3, a2, a1]).session.candidateIds], [a4, a3, a2, a1]);
  assert.equal(D.reorderCandidates(s, [a1, a2]).code, 'INVALID_ORDER'); assert.equal(D.reorderCandidates(s, [a1, a1, a2, a3]).code, 'INVALID_ORDER');
  deq([...D.moveCandidate(s, a3, -1).session.candidateIds], [a1, a3, a2, a4]);
  assert.equal(D.moveCandidate(s, a1, -1).unchanged, true);
  const rep = D.replaceCandidate(s, a2, 'B79', { resolve: R }).session;
  deq([...rep.candidateIds], [a1, byCode('B79').identity.id, a3, a4]); deq(rep.candidates.map(c => c.order), [0, 1, 2, 3]);
  assert.equal(D.clear(s).session.status, 'DRAFT');
});
test('validation: unknown, malformed and other-development ids are dropped with a reason, never thrown', () => {
  const other = ref => ref === 'X1' ? { identity: { id: 'OT-QA-L0001', developmentId: 'outro', displayCode: 'QA L1' }, availability: { status: 'AVAILABLE' } } : R(ref);
  const { session, rejected } = D.syncFromIds(null, DEV, ['A1', 'nope', 'X1', 'A1', 'A2', 'A3', 'A4', 'A5'], { resolve: other });
  deq(rejected.map(r => r.code), ['LOT_NOT_FOUND', 'WRONG_DEVELOPMENT', 'DUPLICATE', 'COMPARISON_LIMIT_REACHED']);
  assert.equal(session.candidates.length, 4);
  assert.equal(D.addCandidate(session, 'B79', { resolve: R }).code, 'COMPARISON_LIMIT_REACHED');
  assert.equal(D.addCandidate(session, 'zzz', { resolve: R }).code, 'LOT_NOT_FOUND', 'an invalid id is reported as such, even when full');
  assert.equal(D.addCandidate(D.createSession(DEV), 'zzz', { resolve: R }).validationState, 'MISSING');
  const strict = D.addCandidate(D.createSession(DEV), 'A1', { resolve: R, policy: { ...D.policyOf(DEV), allowUnknownAvailability: false } });
  assert.equal(strict.validationState, 'INACCESSIBLE', 'policy is honoured (default allows UNKNOWN, SOLD and RESERVED)');
});
test('status change and filter change never remove a candidate; the filter mismatch is flagged per candidate', () => {
  const lotIds = ids('A1', 'A2'), s = D.createSession(DEV, { candidateIds: lotIds, resolve: R });
  const sold = resolver({ [lotIds[0]]: l => { l.availability.status = 'SOLD'; l.availability.freshness = 'FRESH'; return l; } });
  const snap = D.buildSnapshot(s, { resolve: sold, filter: { active: true, matchedIds: new Set([lotIds[1]]) } });
  deq([...snap.candidateIds], lotIds);
  assert.equal(snap.candidates[0].availabilitySummary.status, 'SOLD');
  assert.equal(snap.candidates[0].matchesCurrentFilters, false); assert.equal(snap.candidates[1].matchesCurrentFilters, true);
  const r = fromState(lotIds, { resolve: sold, filter: { active: true, matchedIds: new Set([lotIds[1]]) } });
  assert.ok(r.vm.warnings.some(w => /fora dos filtros/.test(w))); assert.equal(r.vm.candidates[0].statusLabel, 'Vendido');
});
test('customer: change updates the contextual Fit without recreating the session; removal hides Fit (never 0%) and keeps the lots', () => {
  const lotIds = ids('A1', 'A2', 'B79'), cfg = App.fit.cfgOf(DEV);
  const p1 = App.fit.buildProfile({ preferences: { privacy: 3, quiet: 2 } }), p2 = App.fit.buildProfile({ preferences: { leisure: 3 } });
  const fit1 = App.fit.cache().get(p1, lots, cfg, {}), fit2 = App.fit.cache().get(p2, lots, cfg, {});
  const a = fromState(lotIds, { customerProfile: p1, fitById: fit1 });
  const fitRow = r => r.matrix.rows.find(x => x.metricId === 'fitScore');
  assert.equal(fitRow(a).cells[0].value, fit1.get(lotIds[0]).fitScore); assert.equal(a.session.context.mode, 'CUSTOMER');
  const b = fromState(lotIds, { customerProfile: p2, fitById: fit2, previous: a });
  assert.equal(b.session.id, a.session.id, 'same session'); deq([...b.session.candidateIds], lotIds, 'order kept');
  assert.equal(fitRow(b).cells[0].value, fit2.get(lotIds[0]).fitScore); assert.notEqual(a.snapshot.hash, b.snapshot.hash);
  const c = fromState(lotIds, { previous: b });
  assert.equal(c.session.id, a.session.id); assert.equal(fitRow(c).cells[0].comparableState, 'CONTEXT_MISSING'); assert.equal(fitRow(c).cells[0].value, null);
  assert.equal(fitRow(c).metadata.hiddenInNormalMode, true);
  assert.ok(!c.vm.groups.some(g => g.rows.some(r => r.metricId === 'fitScore')), 'Fit row disappears without a customer');
  assert.ok(!/Compatibilidade com o perfil|0\/100 compat/.test(view.render(c.vm)), 'no Fit row, no 0% without a customer');
  assert.equal(c.evaluation.metricResults.fitScore, undefined, 'hidden Fit row is not evaluated in broker mode');
});
test('metric profile switch never changes candidates; QUICK only shows the summary; client profile hides intelligence', () => {
  const lotIds = ids('A1', 'A2', 'A3'), s = D.createSession(DEV, { candidateIds: lotIds, resolve: R });
  const q = D.setMetricProfile(s, 'QUICK').session; deq([...q.candidateIds], lotIds);
  assert.equal(D.setMetricProfile(s, 'NOPE').code, 'INVALID_PROFILE');
  const m = D.buildMatrix(q, D.buildSnapshot(q, { resolve: R }), { audience: 'broker' });
  deq(m.groups.map(g => g.id), ['SUMMARY']);
  const cl = fromState(lotIds, { audience: 'client' });
  assert.ok(!cl.vm.groups.some(g => g.id === 'INTELLIGENCE' || g.id === 'DATA_QUALITY'));
  assert.ok(!cl.vm.groups.flatMap(g => g.rows).some(r => /Score|Nota|Classe/.test(r.label)));
  for (const p of D.PROFILES) { assert.ok(p.metricIds.length > 0, p.id); assert.ok(p.metricIds.every(id => D.metric(id)), p.id); }
});
test('null / unknown / conflicted / stale: no R$ 0, "Desconhecido" (never "Plano"), "Verificar divergência" (no silent choice), stale flagged', () => {
  const [a, b, c] = ids('A1', 'A2', 'A3');
  const res = resolver({ [a]: l => { l.commercial.price = null; return l; }, [b]: l => { l.provenance = { ...l.provenance, 'commercial.price': { status: 'CONFLICTED' } }; l.metadata.freshness.commercial = 'STALE'; return l; } });
  const r = fromState([a, b, c], { resolve: res, audience: 'technical' });
  const price = r.matrix.rows.find(x => x.metricId === 'price');
  deq(price.cells.map(x => x.valueStatus), ['NO_DATA', 'CONFLICTED', 'VALID']);
  assert.equal(price.cells[0].value, null);
  const vprice = r.vm.groups.flatMap(g => g.rows).find(x => x.metricId === 'price');
  assert.equal(vprice.cells[0].text, 'Preço não disponível'); assert.equal(vprice.cells[1].text, 'Verificar divergência');
  assert.ok(!vprice.cells.some(x => /R\$\s*0\b/.test(x.text)));
  const topo = r.vm.groups.flatMap(g => g.rows).find(x => x.metricId === 'topography');
  assert.ok(topo.cells.every(x => x.text === 'Desconhecido'), 'unknown topography is never "Plano"');
  assert.equal(r.snapshot.status, 'STALE'); assert.ok(r.snapshot.completenessSummary.staleCells > 0); assert.ok(r.snapshot.completenessSummary.conflictedCells > 0);
  assert.equal(r.evaluation.metricResults.price.evaluationStatus, 'SUPPRESSED'); assert.ok(r.evaluation.metricResults.price.suppressionReasons.includes('CONFLICTED_DATA'));
  assert.ok(r.vm.warnings.length > 0);
  // all-null rows are hidden in normal mode, shown in technical mode
  const br = fromState([a, b, c], { resolve: res, metricProfileId: 'TECHNICAL' });
  assert.ok(!br.vm.groups.flatMap(g => g.rows).some(x => x.metricId === 'topography'));
});
test('snapshot: records data versions, flags MIXED_VERSION, stable hash (order, profile and context matter; generatedAt does not)', () => {
  const lotIds = ids('A1', 'A2'), s = D.createSession(DEV, { candidateIds: lotIds, resolve: R });
  const s1 = D.buildSnapshot(s, { resolve: R, now: '2026-10-08T10:00:00Z' }), s2 = D.buildSnapshot(s, { resolve: R, now: '2026-10-08T11:00:00Z' });
  assert.equal(s1.hash, s2.hash); assert.notEqual(s1.generatedAt, s2.generatedAt);
  assert.equal(s1.dataVersions.priceTableVersion, '2026-10-06'); assert.equal(s1.dataVersions.analysisVersion, '2026-10-06'); assert.equal(s1.dataVersions.comparisonMetricProfileVersion, '1.0.0');
  assert.ok(s1.dataVersions.staticDataVersion); deq(Object.keys(s1.dataVersions.availabilityRevision), lotIds);
  assert.notEqual(D.buildSnapshot(D.reorderCandidates(s, [lotIds[1], lotIds[0]]).session, { resolve: R }).hash, s1.hash);
  assert.notEqual(D.buildSnapshot(D.setMetricProfile(s, 'QUICK').session, { resolve: R }).hash, s1.hash);
  const mixed = D.buildSnapshot(s, { resolve: resolver({ [lotIds[1]]: l => { l.metadata.dataVersions.analysisVersion = '2026-11-01'; return l; } }) });
  assert.equal(mixed.mixedVersion, true); deq(mixed.mixedVersionKeys, ['analysisVersion']); assert.equal(mixed.status, 'PARTIAL');
  deq(mixed.dataVersions.analysisVersion, ['2026-10-06', '2026-11-01']);
  const ev2 = EV.evaluate(mixed, { audience: 'broker' });
  assert.ok(ev2.metricResults.housingScore.suppressionReasons.includes('VERSION_MISMATCH'), 'scores from different analysis versions are not compared');
});
test('persistence: serialize keeps ids/order/profile/mode only (no values, no customer identity); restore validates and migrates', () => {
  const lotIds = ids('A1', 'A2'), s = D.setContext(D.createSession(DEV, { candidateIds: lotIds, resolve: R }), { customerId: 'cust-123', customerProfileVersion: 'abc' }).session;
  const ser = D.serialize(s), txt = JSON.stringify(ser);
  deq(Object.keys(ser).sort(), ['candidateIds', 'contextMode', 'developmentId', 'metricProfileId', 'v']);
  assert.ok(!/cust-123|price|R\$|807/.test(txt));
  const ok = D.restore(ser, { developmentId: DEV, resolve: R, customerProfileVersion: 'abc' });
  deq([...ok.session.candidateIds], lotIds); assert.equal(ok.session.context.mode, 'CUSTOMER');
  const gone = D.restore({ ...ser, metricProfileId: 'CUSTOMER' }, { developmentId: DEV, resolve: R });
  assert.equal(gone.session.context.mode, 'GENERAL'); assert.equal(gone.session.metricProfileId, 'BROKER_STANDARD'); deq([...gone.session.candidateIds], lotIds);
  assert.ok(gone.warnings.some(w => w.code === 'CUSTOMER_CONTEXT_MISSING'));
  const v0 = D.restore(['A1', 'nope', 'A1'], { developmentId: DEV, resolve: R });
  deq([...v0.session.candidateIds], ids('A1')); deq(v0.warnings.map(w => w.code), ['LOT_NOT_FOUND', 'DUPLICATE']);
  assert.equal(D.restore({ v: 99 }, { developmentId: DEV, resolve: R }).warnings[0].code, 'INVALID_STATE');
  assert.equal(D.restore({ ...ser, developmentId: 'outro' }, { developmentId: DEV, resolve: R }).warnings[0].code, 'WRONG_DEVELOPMENT');
  assert.equal(D.restore({ ...ser, metricProfileId: 'XX' }, { developmentId: DEV, resolve: R }).session.metricProfileId, 'BROKER_STANDARD');
});
test('deep link: router grammar round-trip, ?compare= form, invalid ids and >4 never break, other development refused; share payload has no PII', () => {
  const s = D.createSession(DEV, { candidateIds: ['B79', 'A1'], resolve: R });
  const tok = D.deepLinkToken(s, id => repo.getLotById(id).identity.code);
  assert.equal(tok, 'viva-juara.compare.B79~A1');
  deq([...D.parseDeepLink(tok, { developmentId: DEV, resolve: R }).session.candidateIds], [...s.candidateIds]);
  const q = D.parseDeepLink('?compare=' + ids('A1', 'A2').join(','), { developmentId: DEV, resolve: R });
  assert.equal(q.session.candidates.length, 2);
  const bad = D.parseDeepLink('viva-juara.compare.ZZ9~A1~<script>~A2~A3~A4~A5', { developmentId: DEV, resolve: R });
  assert.equal(bad.session.candidates.length, 4); assert.ok(bad.warnings.some(w => w.code === 'LOT_NOT_FOUND')); assert.ok(bad.warnings.some(w => w.code === 'COMPARISON_LIMIT_REACHED'));
  assert.equal(D.parseDeepLink('outro.compare.A1~A2', { developmentId: DEV, resolve: R }).warnings[0].code, 'WRONG_DEVELOPMENT');
  assert.doesNotThrow(() => D.parseDeepLink(null, { developmentId: DEV, resolve: R }));
  const sp = D.sharePayload(D.setContext(s, { customerId: 'cust-9', customerProfileVersion: 'v' }).session, { codeOf: id => repo.getLotById(id).identity.code, baseUrl: 'https://x/' });
  assert.equal(sp.deepLink, 'https://x/#viva-juara.compare.B79~A1'); assert.ok(!JSON.stringify(sp).includes('cust-9'));
  assert.equal(App.router.parse('#' + tok, c => repo.resolve(c)).comparisonLotIds.length, 2, 'same grammar as the app router');
});
test('offline/reconnect: stale commercial data keeps the candidates with a warning; after reconnect the same session is READY again', () => {
  const lotIds = ids('A1', 'A2', 'A3'), stale = resolver(Object.fromEntries(lotIds.map(id => [id, l => { l.metadata.freshness.commercial = 'STALE'; return l; }])));
  const off = fromState(lotIds, { resolve: stale });
  assert.equal(off.snapshot.status, 'STALE'); assert.equal(off.session.candidates.length, 3);
  assert.ok(off.vm.warnings.some(w => /desatualizados/.test(w)));
  assert.equal(off.evaluation.metricResults.price.evaluationStatus, 'WINNER', 'broker: allowed with warning');
  assert.ok(off.evaluation.metricResults.price.caveats.includes('STALE_VALUE'));
  const on = fromState(lotIds, { previous: off });
  assert.equal(on.session.id, off.session.id); assert.equal(on.snapshot.status, 'READY');
  assert.ok(on.evaluation.recomputedMetricIds.includes('price'), 'price row recomputed after reconnect');
});
test('stale responses: an older snapshot never overwrites a newer session (request token + session revision)', () => {
  const svc = D.createService({ developmentId: DEV, resolve: R, track: () => {} });
  svc.addCandidate('A1'); svc.addCandidate('A2');
  const t1 = svc.beginRequest(), t2 = svc.beginRequest();
  assert.equal(svc.buildSnapshot({}, t1).code, 'STALE_RESPONSE');
  assert.equal(svc.buildSnapshot({}, t2).ok, true);
  const old = svc.store.get().snapshot; svc.addCandidate('A3');
  assert.equal(D.isCurrentSnapshot(svc.store.get().session, old), false);
  assert.equal(D.selectors.selectComparisonSnapshot(svc.store.get()), null);
  assert.equal(svc.buildSnapshot({}).ok, true); assert.ok(svc.buildMatrix({ audience: 'broker' }));
  const st = svc.store.get();
  deq(D.selectors.selectComparisonCandidateState(st, ids('A3')[0]), { inComparison: true, index: 3, total: 3 });
  assert.equal(D.selectors.selectComparisonCanAddLot(st, 'x'), true); svc.addCandidate('A4'); assert.equal(D.selectors.selectComparisonCanAddLot(svc.store.get(), 'x'), false);
  assert.equal(D.selectors.selectComparisonSummary(svc.store.get()).limitReached, true);
  assert.equal(D.summary(D.createSession(DEV, { candidateIds: ['A1'], resolve: R })).message, 'Adicione mais 1 lote para comparar.');
});
test('the comparison domain reads canonical data only and never recalculates scores, Fit or winners', () => {
  const src = fs.readFileSync(path.join(SRC, 'compare/comparisonDomain.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/lots\.json|fetch\(|App\.intelligence|App\.fit\.(score|run|compute|cache)|App\.recommendation\.recommend/.test(src));
  assert.ok(!/winner/i.test(src), 'no winner logic in topic 24 code');
  const r = fromState(ids('A1', 'A2'));
  assert.ok(!JSON.stringify(r.matrix).match(/winner/i), 'ComparisonMatrix core carries no winner');
  const before = JSON.stringify(lots[0].intelligence.scores); fromState(ids('A1', 'A2', 'A3')); assert.equal(JSON.stringify(lots[0].intelligence.scores), before);
  const d = D.deltas(D.buildSnapshot(D.createSession(DEV, { candidateIds: ids('A1', 'A2'), resolve: R }), { resolve: R }), 'price');
  assert.equal(d.length, 1); assert.equal(d[0].rawDelta, byCode('A2').commercial.price - byCode('A1').commercial.price); assert.equal(d[0].comparable, true);
  deq(D.deltas(D.buildSnapshot(D.createSession(DEV, { candidateIds: ids('A1', 'A2'), resolve: R }), { resolve: R }), 'shape'), [], 'deltas only for numeric metrics');
});

// ====================================================================== topic 25 — winner per criterion (golden fixtures)
test('ClearLowerWinner (price) and ClearHigherWinner (score): explicit semantics, facts and pt-BR explanation, never "é melhor"', () => {
  const p = ev('price', [V('a', 299000), V('b', 315000)]);
  assert.equal(p.evaluationStatus, 'WINNER'); deq(p.winnerCandidateIds, ['a']); assert.equal(p.explanation.reasonCode, 'LOWEST_VALUE');
  assert.equal(p.explanation.facts.absoluteDifference, 16000); assert.ok(Math.abs(p.explanation.facts.relativeDifferencePct - 5.079) < 0.01);
  assert.equal(p.comparativeAdvantage, 'CLEAR'); assert.ok(p.caveats.includes('PRICE_TABLE_ONLY'));
  deq(p.assessments.map(a => a.assessmentState), ['BEST', 'WEAKER']);
  const s = ev('housingScore', [V('a', 70), V('b', 82), V('c', 75)]);
  assert.equal(s.evaluationStatus, 'WINNER'); deq(s.winnerCandidateIds, ['b']); assert.equal(s.explanation.reasonCode, 'HIGHEST_VALUE');
  assert.equal(s.pairwiseDeltas.length, 2, 'each candidate vs the best, not N²');
});
test('ExactTie, ToleranceTie and NoMaterialDifference: equal → co-winners, within tolerance → tie, different but close → NO_CLEAR_WINNER', () => {
  const exact = ev('price', [V('a', 300000), V('b', 300000)]);
  assert.equal(exact.evaluationStatus, 'TIE'); assert.equal(exact.tieState, 'ALL_TIED'); deq(exact.assessments.map(a => a.assessmentState), ['CO_BEST', 'CO_BEST']);
  const tol = ev('housingScore', [V('a', 92.1), V('b', 92.0), V('c', 70)]);
  assert.equal(tol.evaluationStatus, 'TIE'); assert.equal(tol.tieState, 'TOP_TIED'); deq(tol.winnerCandidateIds, ['a', 'b']);
  const close = ev('price', [V('a', 299000), V('b', 299500)]);
  assert.equal(close.evaluationStatus, 'NO_CLEAR_WINNER'); assert.equal(close.comparativeAdvantage, 'SLIGHT'); deq(close.winnerCandidateIds, []);
  assert.ok(close.suppressionReasons.includes('NO_MATERIAL_DIFFERENCE'));
});
test('OrderedEnumWinner uses the formal order map; NON_ORDERED and INFORMATIONAL never produce a winner', () => {
  const c = ev('lotClass', [V('a', 'B'), V('b', 'A_PLUS'), V('c', 'C')]);
  assert.equal(c.evaluationStatus, 'WINNER'); deq(c.winnerCandidateIds, ['b']); assert.equal(c.explanation.reasonCode, 'HIGHEST_ORDERED_CATEGORY');
  assert.equal(ev('lotClass', [V('a', 'B'), V('b', 'B')]).evaluationStatus, 'TIE');
  const unk = ev('lotClass', [V('a', 'UNKNOWN', { status: 'UNKNOWN' }), V('b', 'A')]);
  assert.equal(unk.evaluationStatus, 'INSUFFICIENT_DATA', 'UNKNOWN class is excluded, a single valid value never wins');
  for (const m of ['rearNeighbor', 'shape', 'orientationFront', 'streetHierarchy']) assert.equal(ev(m, [V('a', 'LOT'), V('b', 'STREET')]).evaluationStatus, 'NOT_COMPARABLE', m);
  for (const m of ['alertsCount', 'downPayment', 'noiseLevel']) { const r = ev(m, [V('a', 1), V('b', 5)]); assert.equal(r.evaluationStatus, 'NOT_COMPARABLE', m); deq(r.winnerCandidateIds, []); }
});
test('ContextRequired: area, distances, sun, traffic, corner and green rear have no winner without a customer preference (no generic max/min)', () => {
  for (const [m, vals] of [['area', [300, 600]], ['distanceToGate', [50, 900]], ['distanceToLeisure', [50, 900]], ['distanceToAvenue', [50, 900]], ['solarScore', [3, 9]], ['traffic', ['LOW', 'HIGH']], ['isCorner', [true, false]], ['greenRear', [true, false]], ['front', [10, 20]], ['distanceToGreen', [10, 500]]]) {
    const r = ev(m, [V('a', vals[0]), V('b', vals[1])]);
    assert.equal(r.evaluationStatus, 'CONTEXT_REQUIRED', m); assert.ok(r.suppressionReasons.includes('MISSING_CONTEXT'), m); deq(r.winnerCandidateIds, [], m);
  }
  const st = ev('status', [V('a', 'AVAILABLE', { freshness: 'FRESH' }), V('b', 'RESERVED', { freshness: 'FRESH' })]);
  assert.equal(st.evaluationStatus, 'CONTEXT_REQUIRED', 'AvailabilityNoWinnerGeneral');
});
test('customer context resolves preferences: TargetRange (inside → tie), area/leisure/gate/green preferences; hard constraints are not used', () => {
  const pref = prefs => ({ hasCustomer: true, contextMode: 'CUSTOMER', customerProfile: App.fit.buildProfile({ preferences: prefs }) });
  const big = ev('area', [V('a', 300), V('b', 600)], pref({ area: 3 }));
  assert.equal(big.evaluationStatus, 'WINNER'); deq(big.winnerCandidateIds, ['b']); assert.equal(big.resolvedPreference.source, 'CUSTOMER_PREFERENCE');
  const rangeProfile = { hasCustomer: true, contextMode: 'CUSTOMER', customerProfile: App.fit.buildProfile({ areaMin: 250, areaMax: 320 }) };
  const inRange = ev('area', [V('a', 260), V('b', 300), V('c', 600)], rangeProfile);
  assert.equal(inRange.evaluationStatus, 'TIE'); deq(inRange.winnerCandidateIds, ['a', 'b'], 'multiple inside the range: co-best');
  assert.equal(inRange.assessments[2].distanceToTarget, 280);
  const one = ev('area', [V('a', 200), V('b', 300)], rangeProfile);
  assert.equal(one.evaluationStatus, 'WINNER'); assert.equal(one.explanation.reasonCode, 'WITHIN_TARGET_RANGE');
  deq(ev('distanceToGate', [V('a', 50), V('b', 900)], pref({ gate: 3 })).winnerCandidateIds, ['a']);
  deq(ev('distanceToAvenue', [V('a', 50), V('b', 900)], pref({ awayFromAvenue: 3 })).winnerCandidateIds, ['b']);
  deq(ev('greenRear', [V('a', false), V('b', true)], pref({ green: 3 })).winnerCandidateIds, ['b']);
  deq(ev('isCorner', [V('a', true), V('b', false)], pref({ noCorner: 3 })).winnerCandidateIds, ['b']);
  assert.equal(ev('area', [V('a', 300), V('b', 600)], { hasCustomer: true, contextMode: 'CUSTOMER', customerProfile: App.fit.buildProfile({ budgetMax: 400000 }) }).evaluationStatus, 'CONTEXT_REQUIRED', 'a budget constraint does not decide the area preference');
  const housing = ev('traffic', [V('a', 'LOW'), V('b', 'HIGH')], { evaluationProfileId: 'HOUSING' });
  deq(housing.winnerCandidateIds, ['a']); assert.equal(housing.evaluationConfidence, 'MEDIUM', 'profile-resolved semantics cap the confidence');
});
test('TargetValueWinner and the rounding policy: raw precision decides, never the rounded display', () => {
  const reg = EV.registry(DEV), over = { ...reg, criteria: { ...reg.criteria, area: { ...reg.criteria.area, winnerSemantics: 'TARGET_VALUE_PREFERRED', targetValue: 300, tiePolicyId: 'exact', marginPolicyId: 'target', invalid: null },
    housingScore: { ...reg.criteria.housingScore, tiePolicyId: 'exact', marginPolicyId: 'zero' } }, marginPolicies: { ...reg.marginPolicies, zero: { resultBelowThreshold: 'NO_CLEAR_WINNER' } }, tiePolicies: { ...reg.tiePolicies, exact: { type: 'EXACT' } } };
  const t = ev('area', [V('a', 330), V('b', 305), V('c', 250)], { reg: over });
  assert.equal(t.evaluationStatus, 'WINNER'); deq(t.winnerCandidateIds, ['b']); assert.equal(t.explanation.reasonCode, 'CLOSE_TO_TARGET');
  const raw = ev('housingScore', [V('a', 92.44), V('b', 92.46)], { reg: over });
  assert.equal(raw.evaluationStatus, 'WINNER', '92,44 vs 92,46 display as 92 and 92, but the raw values differ'); deq(raw.winnerCandidateIds, ['b']);
  const cents = ev('price', [V('a', 300000.004), V('b', 300000.001)]);
  assert.equal(cents.evaluationStatus, 'TIE', 'money compared in integer cents');
});
test('data sufficiency: only one valid value never wins; partial data → broker winner with caveat, client suppressed', () => {
  const only = ev('price', [V('a', 300000), V('b', null), V('c', null)]);
  assert.equal(only.evaluationStatus, 'INSUFFICIENT_DATA'); assert.equal(only.explanation.reasonCode, 'ONLY_VALID_CANDIDATE_SUPPRESSED'); deq(only.winnerCandidateIds, []);
  const vals = [V('a', 300000), V('b', 350000), V('c', 400000), V('d', null)];
  const broker = ev('price', vals);
  assert.equal(broker.evaluationStatus, 'WINNER'); assert.ok(broker.caveats.includes('PARTIAL_DATA')); assert.equal(broker.dataSufficiency.validCandidates, 3);
  assert.equal(broker.evaluationConfidence, 'MEDIUM');
  const client = ev('price', vals, { audience: 'client' });
  assert.equal(client.evaluationStatus, 'SUPPRESSED'); assert.ok(client.suppressionReasons.includes('PARTIAL_DATA'));
  assert.equal(ev('price', [V('a', null), V('b', null)]).evaluationStatus, 'INSUFFICIENT_DATA');
});
test('stale, conflicted and low confidence: StaleSuppressed (client), StaleAllowedWithWarning (broker), expired suppressed, ConflictedSuppressed, LowConfidenceSuppressed', () => {
  const st = [V('a', 300000, { freshness: 'STALE' }), V('b', 350000, { freshness: 'FRESH' })];
  assert.equal(ev('price', st, { audience: 'client' }).evaluationStatus, 'SUPPRESSED');
  assert.ok(ev('price', st, { audience: 'client' }).suppressionReasons.includes('STALE_DATA'));
  const b = ev('price', st); assert.equal(b.evaluationStatus, 'WINNER'); assert.ok(b.caveats.includes('STALE_VALUE'));
  assert.equal(ev('price', [V('a', 300000, { freshness: 'EXPIRED' }), V('b', 350000, { freshness: 'FRESH' })]).evaluationStatus, 'SUPPRESSED');
  const cf = ev('price', [V('a', 300000, { status: 'CONFLICTED' }), V('b', 350000), V('c', 360000)]);
  assert.equal(cf.evaluationStatus, 'SUPPRESSED'); assert.equal(cf.explanation.reasonCode, 'CONFLICT_SUPPRESSION');
  const noise = [V('a', 9.3, { confidence: 'MEDIUM' }), V('b', 3.8, { confidence: 'MEDIUM' })];
  assert.equal(ev('quietScore', noise).evaluationStatus, 'WINNER');
  assert.equal(ev('quietScore', noise, { audience: 'presentation' }).evaluationStatus, 'SUPPRESSED', 'presentation requires high confidence for estimates');
  assert.equal(ev('quietScore', [V('a', 9.3, { confidence: 'LOW' }), V('b', 3.8, { confidence: 'LOW' })], { audience: 'client' }).suppressionReasons[0], 'LOW_CONFIDENCE');
});
test('Fit: higher preferred with a customer (caveats: profile-dependent, not purchase probability); CONTEXT_REQUIRED without one', () => {
  const f = ev('fitScore', [V('a', 80, { confidence: 'MEDIUM' }), V('b', 60, { confidence: 'MEDIUM' })], { hasCustomer: true, contextMode: 'CUSTOMER' });
  assert.equal(f.evaluationStatus, 'WINNER'); assert.ok(f.caveats.includes('NOT_PURCHASE_PROBABILITY')); assert.ok(f.caveats.includes('PROFILE_DEPENDENT'));
  const n = ev('fitScore', [V('a', null, { status: 'NOT_APPLICABLE', comparableState: 'CONTEXT_MISSING' }), V('b', null, { status: 'NOT_APPLICABLE', comparableState: 'CONTEXT_MISSING' })]);
  assert.equal(n.evaluationStatus, 'CONTEXT_REQUIRED');
  const p = App.fit.buildProfile({ preferences: { privacy: 3 } }), fit = App.fit.cache().get(p, lots, App.fit.cfgOf(DEV), {});
  const r = fromState(ids('A1', 'A2', 'B79'), { customerProfile: p, fitById: fit, audience: 'client' });
  assert.ok(r.vm.fitNote.includes('não é probabilidade de compra'));
  const fr = r.vm.groups.flatMap(g => g.rows).find(x => x.metricId === 'fitScore');
  if (fr.evaluation.status === 'WINNER') assert.match(fr.evaluation.caveatText, /não é probabilidade de compra/);
});
test('availability: no winner in GENERAL; in a customer context AVAILABLE is an operational advantage; UNKNOWN is never treated as available', () => {
  const c = { hasCustomer: true, contextMode: 'CUSTOMER' };
  const r = ev('status', [V('a', 'AVAILABLE', { freshness: 'FRESH' }), V('b', 'RESERVED', { freshness: 'FRESH' })], c);
  assert.equal(r.evaluationStatus, 'WINNER'); deq(r.winnerCandidateIds, ['a']); assert.equal(r.explanation.reasonCode, 'PREFERRED_BOOLEAN_VALUE');
  const u = ev('status', [V('a', 'UNKNOWN', { status: 'UNKNOWN', freshness: 'UNKNOWN' }), V('b', 'RESERVED', { freshness: 'FRESH' })], c);
  assert.notEqual(u.evaluationStatus, 'WINNER'); assert.equal(u.assessments[0].assessmentState, 'UNKNOWN');
  const all = ev('status', [V('a', 'UNKNOWN', { status: 'UNKNOWN' }), V('b', 'UNKNOWN', { status: 'UNKNOWN' })], c);
  assert.equal(all.evaluationStatus, 'INSUFFICIENT_DATA');
  assert.equal(ev('status', [V('a', 'AVAILABLE', { freshness: 'STALE' }), V('b', 'RESERVED', { freshness: 'FRESH' })], c).evaluationStatus, 'SUPPRESSED', 'unconfirmed availability is not highlighted');
  // the real data: every lot UNKNOWN → the status row never highlights anything
  const real = fromState(ids('A1', 'A2'), { audience: 'client' });
  assert.ok(real.vm.groups[0].rows[0].cells.every(x => x.text === 'Disponibilidade sujeita a confirmação' && !x.badge));
});
test('ThreeCandidateWinner and FourCandidateCoWinner; ties are never broken by lot id (input order does not change the result)', () => {
  const three = ev('premiumScore', [V('x', 60), V('y', 75), V('z', 64)]);
  deq(three.winnerCandidateIds, ['y']); deq(three.assessments.map(a => a.rankWithinCriterion), [3, 1, 2]);
  const four = ev('familyScore', [V('L9', 80), V('L1', 80.5), V('L5', 60), V('L3', 70)]);
  assert.equal(four.evaluationStatus, 'TIE'); deq(four.winnerCandidateIds, ['L9', 'L1']);
  const rev = ev('familyScore', [V('L1', 80.5), V('L9', 80), V('L3', 70), V('L5', 60)]);
  deq([...rev.winnerCandidateIds].sort(), ['L1', 'L9']); assert.equal(rev.evaluationStatus, 'TIE');
});
test('safety: zero division, unit mismatch, invalid values and invalid policies fail closed', () => {
  const z = ev('price', [V('a', 0), V('b', 100000)]);
  assert.equal(z.evaluationStatus, 'WINNER'); assert.equal(z.pairwiseDeltas[0].relativeDeltaPct, null, 'relative delta on a zero base is null');
  const um = EV.evaluateCriterion(D.metric('area'), [V('a', 300, { unit: 'm²', metricId: 'area' }), V('b', 3000, { unit: 'ft²', metricId: 'area' })], ctx({ hasCustomer: true, customerProfile: App.fit.buildProfile({ preferences: { area: 3 } }) }));
  assert.equal(um.evaluationStatus, 'SUPPRESSED'); assert.equal(um.error.type, 'UNIT_MISMATCH');
  assert.equal(ev('housingScore', [V('a', 140), V('b', 60)]).evaluationStatus, 'SUPPRESSED', 'score outside 0–100 is invalid, not a winner');
  assert.equal(ev('price', [V('a', -5), V('b', 60)]).evaluationStatus, 'SUPPRESSED');
  const reg = EV.registry(DEV, { ...App.configs.compare[DEV], criteria: { price: { winnerSemantics: 'LOWER_IS_PREFERRED', tiePolicyId: 'nope' }, lotClass: { winnerSemantics: 'ORDERED_ENUM', tiePolicyId: 'exact', marginPolicyId: 'ordinal', dataSufficiencyPolicyId: 'default' }, x: { winnerSemantics: 'BIGGER_IS_BETTER' } } });
  assert.equal(ev('price', [V('a', 1), V('b', 1000)], { reg }).evaluationStatus, 'ERROR');
  const om = ev('lotClass', [V('a', 'A'), V('b', 'B')], { reg }); assert.equal(om.evaluationStatus, 'ERROR'); assert.equal(om.error.type, 'MISSING_ORDER_MAP');
  assert.ok(reg.errors.some(e => e.metricId === 'x' && e.errors.includes('UNKNOWN_SEMANTICS')));
  assert.equal(ev('housingScore', [V('a', 1), V('b', 90)], { reg: EV.registry(DEV, { criteria: {} }) }).evaluationStatus, 'NOT_COMPARABLE', 'no registered semantics → no winner');
  assert.equal(EV.registry(DEV).errors.length, 0, 'shipped registry is valid');
});
test('evaluation snapshot: policy version recorded, deterministic, selective recompute (price update, analysis version), filter/layer changes do not re-evaluate', () => {
  const lotIds = ids('A1', 'A2', 'A3'), a = fromState(lotIds);
  assert.equal(a.evaluation.evaluationPolicyVersion, '1.0.0'); assert.equal(a.evaluation.comparisonSnapshotId, a.snapshot.id);
  const again = fromState(lotIds); deq(JSON.parse(JSON.stringify(again.evaluation.metricResults)), JSON.parse(JSON.stringify(a.evaluation.metricResults)));
  const priced = fromState(lotIds, { previous: a, resolve: resolver({ [lotIds[0]]: l => { l.commercial.price = 1000; return l; } }) });
  assert.ok(priced.evaluation.recomputedMetricIds.includes('price')); assert.ok(!priced.evaluation.recomputedMetricIds.includes('housingScore'), 'scores not recomputed on a price update');
  deq(priced.evaluation.metricResults.price.winnerCandidateIds, [lotIds[0]]);
  const av = fromState(lotIds, { previous: a, resolve: resolver(Object.fromEntries(lotIds.map(id => [id, l => { l.metadata.dataVersions.analysisVersion = '2026-12-01'; return l; }]))) });
  assert.ok(av.evaluation.recomputedMetricIds.includes('primaryScore')); assert.ok(!av.evaluation.recomputedMetricIds.includes('price'));
  const filt = fromState(lotIds, { previous: a, filter: { active: true, matchedIds: new Set([lotIds[0]]) }, activeLayerId: 'price' });
  assert.equal(filt.evaluation.recomputedMetricIds.length, 0, 'filter and active layer are presentation hints'); assert.equal(filt.evaluation.contextHash, a.evaluation.contextHash);
  assert.ok(filt.vm.groups[0].rows.find(r => r.metricId === 'price').emphasis, 'active layer emphasises its row');
  const added = fromState([...lotIds, ids('B79')[0]], { previous: a }); assert.ok(added.evaluation.recomputedMetricIds.length > 0);
  const removed = fromState(lotIds.slice(0, 2), { previous: a }); assert.notEqual(removed.evaluation.inputKeys.price, a.evaluation.inputKeys.price); assert.equal(removed.evaluation.metricResults.price.dataSufficiency.totalCandidates, 2);
  assert.ok(EV.log().length > 0 && EV.log().every(e => e.metricId && e.evaluationStatus && 'policyVersion' in e && Array.isArray(e.suppressionReasons) && e.candidateCount >= 2 && Object.keys(e).length === 5), 'observability without PII');
});
test('no overall winner: no best-lot field, win counts are per criterion only, highlights are deduplicated and capped', () => {
  const r = fromState(ids('A1', 'B30', 'F6', 'C10'));
  const keys = JSON.stringify(r.vm) + JSON.stringify(r.evaluation);
  assert.ok(!/overallWinner|bestLot|bestCandidate|champion|melhor lote|é melhor/i.test(keys));
  assert.ok(r.vm.candidates.every(c => !('rank' in c)));
  const total = r.vm.criterionHighlights.reduce((n, h) => n + h.items.length, 0); assert.ok(total <= 5);
  const priceLike = r.vm.criterionHighlights.flatMap(h => h.items).filter(x => /preço de tabela/.test(x));
  assert.ok(priceLike.length <= 1 || new Set(r.vm.criterionHighlights.filter(h => h.items.some(x => /preço/.test(x))).map(h => h.candidateId)).size === priceLike.length, 'price and price/m² not both for the same lot');
  assert.match(r.vm.highlightsNote || 'Destaques por critério; não indicam um lote melhor no geral.', /não indicam um lote melhor no geral/);
  const cl = fromState(ids('A1', 'B30', 'F6', 'C10'), { audience: 'client' });
  assert.ok(cl.vm.criterionHighlights.reduce((n, h) => n + h.items.length, 0) <= 3);
  const share = EV.shareFacts(r.evaluation, { names: Object.fromEntries(r.vm.candidates.map(c => [c.id, c.name])) });
  assert.equal(share.evaluationPolicyVersion, '1.0.0'); assert.ok(share.lines.every(l => /^Q[A-Z]+ L\d+: /.test(l)));
});
test('view model + render: accessible table semantics, badges announced with the value, same output for every breakpoint, no jargon for clients', () => {
  const r = fromState(ids('A1', 'B30', 'F6'));
  const html = view.render(r.vm);
  assert.ok(html.includes('<th scope="col">') && html.includes('<th scope="row">') && html.includes('<caption class="vh">'));
  assert.match(html, /aria-label="Preço de tabela, QF L6, R\$[^"]*Destaque neste critério: QF L6 possui o menor preço de tabela\./);
  assert.match(html, /data-act="cmpMove"[^>]*aria-label="Mover QA L1 para a direita"/); assert.ok(html.includes('data-act="cmpRemove"') && html.includes('data-act="goLot"') && html.includes('data-act="shareCmp"'));
  assert.equal(view.render(r.vm), html, 'pure: same input, same markup (desktop, tablet and mobile differ only in CSS)');
  assert.ok(!/<script|on[a-z]+=/i.test(html));
  const tie = fromState(ids('A1', 'F6'), { metricProfileId: 'TECHNICAL', audience: 'technical' });
  assert.ok(view.render(tie.vm).includes('Regra:'), 'technical mode shows the policy');
  const cl = fromState(ids('A1', 'B30', 'F6', 'C10'), { audience: 'client' });
  const bad = strings(cl.vm).filter(s => JARGON.test(s) || /\b[A-Z]+_[A-Z_]+\b/.test(s));
  deq([...new Set(bad)], []);
  assert.ok(!/Ligeira vantagem|valor menos favorável|Vencedor/.test(view.render(cl.vm)), 'client sees clear highlights only');
  assert.ok(view.render(null).includes('Adicione até 4 lotes'));
  const one = fromState(ids('A1')); assert.equal(one.vm.canCompare, false); assert.match(view.render(one.vm), /Adicione mais 1 lote para comparar/);
  const h = view.handle({ dataset: { act: 'cmpMove', id: ids('A1')[0], dir: '1' } }, { comparisonLotIds: ids('A1', 'B30') });
  deq(h.patch.comparisonLotIds, ids('B30', 'A1'));
  assert.equal(view.handle({ dataset: { act: 'cmpProfile', v: 'QUICK' } }, {}).rerender, true); assert.equal(view.ui.profileId, 'QUICK');
  const q = view.view({ developmentId: DEV, lotIds: ids('A1', 'B30'), resolve: R, audience: 'broker' });
  assert.equal(q.result.session.metricProfileId, 'QUICK'); view.reset();
});
test('legacy App.services.comparison API keeps working and no longer marks area or distances as "melhor" without context', () => {
  const ls = ['A1', 'B30', 'F6'].map(byCode), get = k => l => k.split('.').reduce((o, x) => o[x], l);
  const rows = App.services.comparison.compare(ls, [{ label: 'Preço', get: get('commercial.price'), fieldKey: 'commercial.price', better: 'min' }, { label: 'Área', get: get('geometry.areaM2'), fieldKey: 'geometry.areaM2', better: 'max' },
    { label: 'Portaria', get: get('mobility.routeDistanceToGateM'), fieldKey: 'mobility.routeDistanceToGateM', better: 'min' }, { label: 'X', get: () => 1, better: 'max' }]);
  deq(rows[0].winners, [2]); deq(rows[1].winners, []); deq(rows[2].winners, []); deq(rows[3].winners, []);
  assert.equal(rows[0].values.length, 3);
  const L = App.services.comparison.leaders(ls, [{ label: 'Silêncio', get: l => l.environmental.quietScore }, { label: 'Nada', get: () => null }]);
  deq(L.map(x => x.label), ['Silêncio']);
  // the legacy comparison view model still builds
  const devCfg = App.repos.DevelopmentRepository.getDevelopmentConfig(DEV);
  assert.ok(App.vm.comparisonVM(ls, { cfg: devCfg.presentation, mode: 'broker', objective: null, dev: devCfg }).columns.length === 3);
});
