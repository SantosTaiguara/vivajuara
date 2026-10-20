'use strict';
// Topic 61 — data quality & operational governance. Golden scenarios named after spec §444 (DQ*), plus the real check over
// the published 498-lot dataset (read-only: nothing is changed). Modules are loaded after load() through the backend loader
// (they are not in the browser build).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, DATA } = require('./harness.js');
const { attachDataQuality, readDataQualityConfig } = require('../backend/src/modules/dataquality/dataquality.loader.js');

let App, DQ, M, E, W, repo, lots, rows, before;
const DEV = 'viva-juara', NOW = Date.parse('2026-10-16T12:00:00Z');
const J = x => JSON.parse(JSON.stringify(x));
const actor = (perms, o = {}) => ({ id: o.id || 'usr_a', organizationId: o.org || 'org_house7', can: k => perms === '*' || perms.includes(k) });
const ALL = actor('*'), OTHER = actor('*', { id: 'usr_b' });
const withConfig = (mut, fn) => { const cfg = readDataQualityConfig(); mut(cfg); M.setConfig(cfg); try { return fn(); } finally { M.setConfig(readDataQualityConfig()); } };
const gate = (o = {}) => DQ.evaluateGate({ developmentId: DEV, lots: o.lots || lots, now: NOW, ...o });
const reasonOf = (g, ruleId) => g.reasons.find(r => r.ruleId === ruleId);

test.before(async () => {
  App = load(); DQ = attachDataQuality(App, { withView: true }); M = DQ.model; E = DQ.engine; W = DQ.workflow;
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync();
  rows = JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8')); before = JSON.stringify(lots);
});
test.after(() => assert.equal(JSON.stringify(lots), before, 'no lot was changed by any check'));

// ------------------------------------------------------------------ policy / governance
test('policy: valid, versioned, merged PLATFORM ← ORGANIZATION ← DEVELOPMENT; owners/stewards unassigned = necessita confirmação', () => {
  const p = M.policy(DEV);
  assert.equal(p.validation.ok, true, JSON.stringify(p.validation.errors));
  assert.equal(p.organizationId, 'org_house7'); assert.ok(p.policyVersions.PLATFORM && p.policyVersions.ORGANIZATION && p.policyVersions.DEVELOPMENT);
  assert.equal(p.domains.length, 12);
  const own = M.ownershipMatrix(p);
  assert.ok(own.every(o => o.owner === null && o.ownerStatus === 'NECESSITA_CONFIRMACAO' && o.stewardStatus === 'NECESSITA_CONFIRMACAO'));
  assert.equal(own.find(o => o.dataDomainId === 'AVAILABILITY').sourceAuthorityStatus, 'NECESSITA_CONFIRMACAO', 'no sales mirror: no authority');
  assert.ok(M.raciMatrix(p).every(r => r.status === 'NECESSITA_CONFIRMACAO'));
  assert.ok(p.slos.every(s => s.target === null)); assert.ok(p.freshnessPolicies.every(f => f.maxAgeForTransaction === null));
  // unowned ENFORCED rule of a critical domain runs as WARNING
  assert.deepEqual(J(M.effectiveMode(M.rule(p, 'DQ-VOL-001'), p)), { mode: 'WARNING', reason: 'RULE_UNOWNED' });
  assert.equal(M.effectiveMode(M.rule(p, 'DQ-LOT-001'), p).mode, 'ENFORCED');
});
test('policy validation: identity/geometry never auto-corrected; platform rule cannot be weakened; cycles refused', () => {
  const codes = mut => withConfig(mut, () => M.policy(DEV).validation.errors.map(e => e.code));
  assert.ok(codes(c => { c['viva-juara'].reconciliationPolicies.find(r => r.id === 'RP-GEOMETRY').automaticCorrection = 'SAFE_ONLY'; }).includes('DQ_AUTOCORRECT_FORBIDDEN'));
  assert.ok(codes(c => { c['viva-juara'].rules.push({ ...c.platform.rules[0], severity: 'WARNING', platformMandatory: false }); }).includes('DQ_PLATFORM_RULE_WEAKENED'));
  assert.ok(codes(c => { c.platform.rules.find(r => r.id === 'DQ-LOT-001').dependsOn = ['DQ-GEO-012']; }).includes('DQ_RULE_DEPENDENCY_CYCLE'));
  assert.ok(codes(c => { c.platform.rules[0].evaluatorRef = 'SQL'; }).includes('DQ_UNKNOWN_EVALUATOR'), 'no arbitrary evaluator');
  // an invalid policy blocks every gate
  withConfig(c => { c.platform.rules[0].evaluatorRef = 'SQL'; }, () => assert.equal(gate().decision, 'BLOCK'));
});
test('semantic catalog is generated from the Field Registry; glossary and known limitations are present and client-safe', () => {
  const p = M.policy(DEV), cat = M.semanticCatalog(p);
  assert.equal(cat.length, App.model.FIELDS.length);
  const area = cat.find(f => f.fieldKey === 'geometry.areaM2'); assert.equal(area.unit, 'm²'); assert.equal(area.sourceAuthorityRef, 'official-plan-v1');
  assert.ok(cat.find(f => f.fieldKey === 'commercial.price').nullMeaning.includes('nunca 0'));
  assert.ok(M.glossary(p).some(g => g.code === 'UNKNOWN' && /nunca é disponível|Não é disponível/.test(g.definition)));
  const ids = M.knownLimitations(p).map(k => k.id); for (const k of ['KL-TOPOGRAPHY', 'KL-DRAINAGE', 'KL-VENTILATION', 'KL-CONSTRUCTION-RULES', 'KL-AVAILABILITY-NO-MIRROR']) assert.ok(ids.includes(k), k);
  const client = DQ.model.clientSafeLimitations(p).map(x => x.text).join(' ');
  assert.ok(!/UNKNOWN|finding|SLO|DQ-|steward/i.test(client));
});

// ------------------------------------------------------------------ real check over the published dataset
test('REAL: full check over the 498 published lots — findings reported, data untouched', () => {
  const a = E.assess({ developmentId: DEV, lots, rows, now: NOW });
  const R = id => a.run.results.find(r => r.ruleId === id);
  assert.equal(a.run.status, 'PASSED_WITH_WARNINGS');
  for (const id of ['DQ-LOT-001', 'DQ-LOT-002', 'DQ-LOT-004', 'DQ-TEN-001', 'DQ-TEN-002', 'DQ-AVAIL-001', 'DQ-AVAIL-007', 'DQ-GEO-012', 'DQ-GEO-002', 'DQ-GEO-003', 'DQ-GEO-004',
    'DQ-PRICE-008', 'DQ-PRICE-002', 'DQ-PRICE-003', 'DQ-PRICE-004', 'DQ-PRICE-005', 'DQ-ANA-001', 'DQ-ANA-002', 'DQ-ANA-003', 'DQ-VOL-001', 'DQ-VJ-LOT-003', 'DQ-VJ-SCHEMA-001', 'DQ-VJ-DIST-001'])
    assert.equal(R(id).status, 'PASSED', id);
  assert.equal(R('DQ-GEO-012').evaluatedCount, 498, '498/498 valid geometries, 0 lots without geometry');
  assert.equal(R('DQ-AVAIL-002').failedCount, 498, 'availability UNKNOWN for all 498 lots');
  assert.equal(R('DQ-AVAIL-003').status, 'NOT_EVALUATED'); assert.equal(R('DQ-TX-001').reason, 'NO_SOLD_LOT');
  assert.equal(R('DQ-PROV-001').failedCount, 2, 'identity.id and identity.developmentId without sourceId in the Field Registry');
  const nulls = a.run.findings.find(f => f.ruleId === 'DQ-NULL-001');
  assert.equal(nulls.effectiveMode, 'SHADOW'); assert.ok(nulls.failedEntityCount >= 20, 'null fields observed (never treated as errors)');
  assert.ok(nulls.samples.some(s => s.entityRef === 'identity.blockNumber' && s.observed === '498/498 nulos'));
  assert.equal(a.health.domains.find(d => d.dataDomainId === 'AVAILABILITY').status, 'UNKNOWN');
  assert.equal(a.health.domains.find(d => d.dataDomainId === 'GEOMETRY').status, 'HEALTHY');
  assert.notEqual(a.health.overallStatus, 'HEALTHY');
  assert.ok(a.slos.every(s => s.evaluation.status === 'NOT_CONFIGURED'));
  assert.equal(a.slos.find(s => s.id === 'SLO-LOT-ID-UNIQUENESS').observedBaseline, 1);
  assert.equal(a.slos.find(s => s.id === 'SLO-AVAILABILITY-FRESHNESS').observedBaseline, 0);
  assert.ok(!('score' in a.scorecard) && a.scorecard.dimensions.length === 12, 'dimensional scorecard, no single %');
});
test('gate for topic 58: the current batch (rows or lots) passes ONBOARDING_BATCH; unknown action is denied', () => {
  assert.equal(DQ.evaluateGate({ developmentId: DEV, rows, now: NOW }).decision, 'PASS');
  const g = gate(); assert.equal(g.decision, 'PASS'); assert.equal(g.gateId, 'QG-ONBOARDING-BATCH');
  assert.ok(g.findings.some(f => f.ruleId === 'DQ-AVAIL-002'), 'warnings are reported even on PASS');
  assert.equal(gate({ actionCode: 'DELETE_EVERYTHING' }).decision, 'BLOCK');
});

// ------------------------------------------------------------------ golden scenarios (§444)
test('DQCanonicalLotIdDuplicateBlocked', () => {
  const ls = J(lots); ls[1].identity.id = ls[0].identity.id;
  const g = gate({ lots: ls }); assert.equal(g.decision, 'BLOCK'); assert.equal(reasonOf(g, 'DQ-LOT-001').code, 'BLOCKING_RULE_FAILED');
});
test('DQAvailabilityUnknownStatusDetected', () => {
  const f = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleIds: ['DQ-AVAIL-002'] }).findings[0];
  assert.equal(f.failedEntityCount, 498); assert.equal(f.sampleEntityRefs.length, 10); assert.equal(f.ownerStatus, 'NECESSITA_CONFIRMACAO');
});
test('DQAvailabilityStaleForReservationBlocked: map display allowed, reservation blocked', () => {
  const ls = J(lots).slice(0, 3); ls.forEach(l => Object.assign(l.availability, { status: 'AVAILABLE', updatedAt: '2026-10-16T08:00:00Z', sourceId: 'mirror', revision: 1 }));
  withConfig(c => Object.assign(c['viva-juara'].freshnessPolicies.find(f => f.id === 'FP-AVAILABILITY'), { maxAgeForDisplay: 'P7D', maxAgeForDecision: 'P1D', maxAgeForTransaction: 'PT1H' }), () => {
    const fp = M.policy(DEV).freshnessPolicies.find(f => f.id === 'FP-AVAILABILITY');
    const a = E.assessFreshness(fp, { sourceTimestamp: '2026-10-16T08:00:00Z', observedAt: NOW });
    assert.equal(a.status, 'STALE_FOR_TRANSACTION'); assert.equal(a.perUse.DISPLAY.allowed, true); assert.equal(a.perUse.TRANSACTION.allowed, false);
    assert.equal(gate({ actionCode: 'RESERVATION', lots: ls }).decision, 'BLOCK');
    ls.forEach(l => { l.availability.updatedAt = '2026-10-16T11:30:00Z'; });
    assert.equal(gate({ actionCode: 'RESERVATION', lots: ls }).decision, 'PASS', 'fresh for transaction');
  });
  // today: threshold not configured and no source date → UNKNOWN → reservation blocked
  const g = gate({ actionCode: 'RESERVATION' }); assert.equal(g.decision, 'BLOCK');
  assert.equal(E.assessFreshness(M.policy(DEV).freshnessPolicies[0], { sourceTimestamp: null, observedAt: NOW }).status, 'UNKNOWN');
});
test('DQPricingMissingDoesNotSetUnavailable', () => {
  const ls = J(lots); ls[0].commercial.price = null;
  const g = gate({ lots: ls }); assert.equal(g.decision, 'PASS');
  assert.equal(g.findings.find(f => f.ruleId === 'DQ-PRICE-005').dataDomainId, 'PRICING'); assert.equal(ls[0].availability.status, 'UNKNOWN');
  ls[0].availability = { ...ls[0].availability, status: 'UNAVAILABLE', reason: 'PRICE_MISSING', updatedAt: '2026-10-16T00:00:00Z', sourceId: 'pipeline' };
  assert.equal(reasonOf(gate({ lots: ls }), 'DQ-AVAIL-007').decision, 'BLOCK');
});
test('DQGeometryInvalidPolygonDetected', () => {
  const ls = J(lots); ls[0].geometry.polygon = [[0, 0], [1, 1]];
  assert.equal(reasonOf(gate({ lots: ls }), 'DQ-GEO-012').decision, 'BLOCK');
  const bow = J(lots); bow[0].geometry.polygon = [[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]];
  assert.ok(E.run({ input: { developmentId: DEV, lots: bow, now: NOW }, ruleIds: ['DQ-GEO-002'] }).findings[0].samples[0].observed.includes('se cruzam'));
});
test('DQGeometryLotMismatchDetected', () => {
  const ls = J(lots); ls[0].geometry.bounds = { x: 0, y: 0, w: 1, h: 1 }; delete ls[1].geometry.polygon;
  const g = gate({ lots: ls }); assert.equal(reasonOf(g, 'DQ-GEO-003').decision, 'REVIEW'); assert.equal(reasonOf(g, 'DQ-GEO-012').decision, 'BLOCK');
});
test('DQPriceDuplicateEntryDetected', () => {
  const pe = E.priceEntriesFromLots(lots); pe.push({ ...pe[0] }); pe.push({ lotId: 'VJ-QZ-L9999', price: 1, currency: 'BRL', priceTableVersion: '2026-10-06' });
  const g = gate({ actionCode: 'PRICE_TABLE_ACTIVATION', priceEntries: pe });
  assert.equal(g.decision, 'BLOCK'); assert.ok(reasonOf(g, 'DQ-PRICE-002') && reasonOf(g, 'DQ-PRICE-008'));
});
test('DQSourceSchemaDriftDetected: removed/retyped field blocks, added field asks for review', () => {
  const removed = rows.map(({ a, ...r }) => r); assert.equal(reasonOf(DQ.evaluateGate({ developmentId: DEV, rows: removed, now: NOW }), 'DQ-VJ-SCHEMA-001').decision, 'BLOCK');
  const added = rows.map(r => ({ ...r, extra: 1 })), g = DQ.evaluateGate({ developmentId: DEV, rows: added, now: NOW });
  assert.equal(g.decision, 'REVIEW'); assert.equal(reasonOf(g, 'DQ-VJ-SCHEMA-001').code, 'SCHEMA_DRIFT_NON_BREAKING');
  const vol = DQ.evaluateGate({ developmentId: DEV, rows: rows.slice(0, 49), now: NOW });
  assert.equal(reasonOf(vol, 'DQ-VOL-001').code, 'UNOWNED_RULE_FAILED', 'expected 498, received 49 → review (rule without owner never blocks alone)');
});
test('DQExternalReconciliationMismatchDetected: differences visible, nothing overwritten', () => {
  const p = M.policy(DEV), rp = p.reconciliationPolicies.find(r => r.id === 'RP-PRICING');
  const src = J(lots); src[3].commercial.price += 1;
  const r = E.reconcile(rp, src, lots, { now: NOW });
  assert.equal(r.status, 'DIFFERENCES'); assert.equal(r.mismatched, 1); assert.deepEqual(J(r.proposedCorrections), []); assert.deepEqual(J(r.appliedCorrections), []);
  assert.equal(E.reconcile(p.reconciliationPolicies.find(x => x.id === 'RP-AVAILABILITY'), [], lots).reason, 'DQ_SOURCE_AUTHORITY_UNDEFINED');
  const si = E.reconcile(p.reconciliationPolicies.find(x => x.id === 'RP-SPATIAL-INDEX'), [{ identity: { id: 'x' }, spatialIndexVersion: 1 }], [], {});
  assert.equal(si.proposedCorrections[0].action, 'REBUILD_DERIVED_ARTIFACT', 'safe-only proposal for a derived cache');
});
test('DQRuleDryRunBeforeEnforcement: rule that would fail most lots stays SHADOW/REVIEW', () => {
  const p = M.policy(DEV), rule = { ...M.rule(p, 'DQ-GEO-004'), id: 'DQ-NEW-001', code: 'DQ-NEW-001', thresholdConfig: { fieldKey: 'geometry.frontM', min: 15 }, enforcementMode: 'SHADOW', status: 'DRAFT', ownerRef: 'usr_owner' };
  const d = E.dryRun(rule, { developmentId: DEV, lots, now: NOW });
  assert.ok(d.wouldFail > 0); assert.match(d.text, /^would fail \d+\/498$/); assert.equal(d.recommendedMode, 'SHADOW'); assert.equal(d.decision, 'REVIEW');
  assert.equal(W.promoteRule(rule, 'ENFORCED', { dryRun: d }, p, ALL).code, 'DQ_PROMOTION_INVALID', 'one step at a time');
  assert.equal(W.promoteRule(rule, 'WARNING', {}, p, ALL).code, 'DQ_DRY_RUN_REQUIRED');
  const w = W.promoteRule(rule, 'WARNING', { dryRun: d }, p, ALL).record;
  assert.equal(W.promoteRule(w, 'ENFORCED', { dryRun: d }, p, ALL).code, 'DQ_PROMOTION_INVALID', 'failures need another person\'s approval');
  assert.equal(W.promoteRule(w, 'ENFORCED', { dryRun: d, approvedBy: 'usr_owner' }, p, ALL).record.enforcementMode, 'ENFORCED');
  assert.equal(W.promoteRule({ ...w, ownerRef: null }, 'ENFORCED', { dryRun: d, approvedBy: 'usr_owner' }, p, ALL).code, 'DQ_OWNER_REQUIRED');
  assert.equal(W.promoteRule(rule, 'WARNING', { dryRun: d }, p, actor([])).code, 'DQ_PERMISSION_DENIED');
});
test('DQExceptionExpires: active exception accepts the finding, after expiry the finding is open again', () => {
  withConfig(c => { c.org_house7.exceptionPolicies.unshift({ ruleId: 'DQ-PRICE-005', exceptionAllowed: true, maxDuration: 'P30D', requiredApprovalPermission: 'data_quality.approve_exception' }); }, () => {
    const p = M.policy(DEV), ls = J(lots); ls[0].commercial.price = null;
    const req = W.requestException(p, { ruleId: 'DQ-PRICE-005', reason: 'preço do lote aguardando tabela', risk: 'LOW', expiresAt: NOW + 86400e3, now: NOW }, ALL);
    assert.equal(req.ok, true, req.message); assert.equal(req.record.status, 'PENDING_APPROVAL');
    assert.equal(W.approveException(req.record, ALL, { now: NOW }).code, 'DQ_PERMISSION_DENIED', 'requester cannot approve');
    const x = W.approveException(req.record, OTHER, { now: NOW }).record;
    const f = () => E.run({ input: { developmentId: DEV, lots: ls, now: NOW }, ruleIds: ['DQ-PRICE-005'] }).findings;
    assert.equal(E.applyExceptions(f(), [x], p, NOW + 1000)[0].status, 'ACCEPTED_EXCEPTION');
    assert.equal(E.applyExceptions(f(), [x], p, NOW + 2 * 86400e3)[0].status, 'OPEN');
    assert.equal(W.exceptionView(x, NOW + 2 * 86400e3).status, 'EXPIRED');
    assert.equal(W.requestException(p, { ruleId: 'DQ-PRICE-005', reason: 'motivo suficientemente longo', risk: 'LOW', expiresAt: null, now: NOW }, ALL).code, 'DQ_EXCEPTION_EXPIRY_REQUIRED');
    assert.equal(W.requestException(p, { ruleId: 'DQ-PRICE-005', reason: 'motivo suficientemente longo', risk: 'LOW', expiresAt: NOW + 90 * 86400e3, now: NOW }, ALL).code, 'DQ_EXCEPTION_TOO_LONG');
  });
});
test('DQCriticalRuleCannotBeWaived', () => {
  const p = M.policy(DEV);
  assert.equal(W.requestException(p, { ruleId: 'DQ-LOT-001', reason: 'tentativa de ignorar duplicidade', risk: 'HIGH', expiresAt: NOW + 3600e3, now: NOW }, ALL).ok, false);
  const ls = J(lots); ls[1].identity.id = ls[0].identity.id;
  const forged = { id: 'dqx_forged', findingOrRuleRef: 'DQ-LOT-001', approvedBy: 'x', approvedAt: '2026-10-16T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', status: 'ACTIVE' };
  const g = gate({ lots: ls, exceptions: [forged] });
  assert.equal(g.decision, 'BLOCK'); assert.equal(g.findings.find(f => f.ruleId === 'DQ-LOT-001').exceptionIgnoredReason, 'NOT_WAIVABLE');
});
test('DQQualityCheckJobFailureProducesUnknown: check error → UNKNOWN, never PASS', () => {
  const a = E.assess({ developmentId: DEV, lots, now: NOW, versions: { analysisVersion: null } });
  assert.equal(a.run.results.find(r => r.ruleId === 'DQ-ANA-001').status, 'CHECK_FAILED'); assert.equal(a.run.status, 'ERROR');
  assert.equal(a.health.domains.find(d => d.dataDomainId === 'ANALYSIS').status, 'UNKNOWN');
  const g = gate({ actionCode: 'DEVELOPMENT_PUBLICATION', versions: { analysisVersion: null } });
  assert.equal(g.decision, 'BLOCK'); assert.equal(reasonOf(g, 'DQ-ANA-001').code, 'CHECK_FAILED_UNKNOWN');
  assert.equal(E.healthSnapshot({ policy: M.policy(DEV), run: E.runSafely({ input: { developmentId: 'nope-dev' } }) }).overallStatus !== 'HEALTHY', true);
});
test('DQPublicationQualitySnapshotCreated + DQHistoricalPublicationRemainsReproducible', () => {
  const r = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleSetIds: ['RS-GEOMETRY'] });
  const s = E.publicationQualitySnapshot({ publicationId: 'pub_vj_2026_10_06', runs: [r], acceptedFindings: [], now: NOW });
  assert.ok(Object.isFrozen(s)); assert.ok(s.ruleSetVersions.includes('RS-GEOMETRY@1.0.0')); assert.equal(s.fingerprint, E.publicationQualitySnapshot({ publicationId: 'pub_vj_2026_10_06', runs: [r], now: NOW }).fingerprint);
  const p = M.policy(DEV), v1 = M.rule(p, 'DQ-GEO-004'), v2 = W.reviseRule(v1, { thresholdConfig: { fieldKey: 'geometry.areaM2', minExclusive: 100 } }, ALL).record;
  assert.equal(v2.version, '1.1.0'); assert.equal(v2.status, 'DRAFT'); assert.equal(v2.enforcementMode, 'SHADOW'); assert.equal(v1.version, '1.0.0', 'active rule never edited in place');
  assert.equal(W.reviseRule(v1, { version: '1.0.0', thresholdConfig: {} }, ALL).code, 'DQ_RULE_VERSION_REQUIRED');
  assert.ok(s.ruleSetVersions.includes('RS-GEOMETRY@1.0.0'), 'old snapshot keeps its rule set version');
});
test('DQRecommendationDegradesOnCriticalAnalysisIssue', () => {
  const ls = J(lots); ls[0].intelligence.scores.overall = 140;
  const a = E.assess({ developmentId: DEV, lots: ls, now: NOW }), h = J(a.health);
  h.domains.find(d => d.dataDomainId === 'ANALYSIS').status = 'CRITICAL';
  const rr = E.recommendationReadiness(h, M.policy(DEV));
  assert.equal(rr.mode, 'DEGRADE'); assert.ok(rr.reasons.some(x => x.dataDomainId === 'AVAILABILITY' && x.mode === 'WARN'));
  assert.equal(a.run.results.find(r => r.ruleId === 'DQ-ANA-002').failedCount, 1);
});
test('DQProposalBlockedOnStaleCommercialData', () => {
  const g = gate({ actionCode: 'PROPOSAL_SUBMIT', targetLotIds: [lots[0].identity.id] });
  assert.equal(g.decision, 'BLOCK'); assert.equal(reasonOf(g, 'DQ-AVAIL-004').code, 'BLOCKING_RULE_FAILED');
});
test('DQDataIncidentRootCauseRecorded: material incident closes only with RCA, prevention, verified remediation and postmortem', () => {
  const p = M.policy(DEV), at = { now: NOW };
  let i = W.createIncident({ title: 'Preços divergentes na tabela candidata', severity: 'SEV2', affectedDomains: ['PRICING'], affectedCapabilities: ['PROPOSAL'] }, ALL, at).record;
  assert.equal(W.createIncident({ title: 'x', severity: 'SEV1', affectedDomains: ['PRICING'] }, actor([]), at).code, 'DQ_PERMISSION_DENIED');
  i = W.transitionIncident(i, 'INVESTIGATING', ALL, at, p).record;
  const plan0 = W.createRemediationPlan({ incidentOrFindingRef: i.id, actions: [{ actionType: 'REIMPORT', targetRef: 'price-table', ownerRef: 'usr_a' }], verificationPlan: ['reexecutar RS-PRICING'] }, ALL, at).record;
  const okRun = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleSetIds: ['RS-PRICING'] });
  assert.equal(W.transitionIncident(i, 'RESOLVED', ALL, { remediationPlan: plan0, verificationRun: okRun }, p).code, 'DQ_REMEDIATION_INCOMPLETE');
  const plan = W.setActionStatus(plan0, 0, 'DONE', ALL).record;
  assert.equal(W.transitionIncident(i, 'RESOLVED', ALL, { remediationPlan: plan, verificationRun: okRun }, p).code, 'DQ_RCA_REQUIRED');
  i = W.recordRootCause(i, { rootCauseCategory: 'SOURCE_ERROR', description: 'planilha com linha duplicada' }, ALL).record;
  assert.equal(W.transitionIncident(i, 'RESOLVED', ALL, { remediationPlan: plan, verificationRun: okRun }, p).code, 'DQ_PREVENTION_REQUIRED');
  i = W.recordRootCause(i, { rootCauseCategory: 'SOURCE_ERROR', description: 'planilha com linha duplicada', preventionActions: ['DQ-PRICE-002 no gate'] }, ALL).record;
  assert.equal(W.transitionIncident(i, 'RESOLVED', ALL, { remediationPlan: plan, verificationRun: { id: 'r', status: 'ERROR', results: [] } }, p).code, 'DQ_VERIFICATION_REQUIRED');
  i = W.transitionIncident(i, 'RESOLVED', ALL, { remediationPlan: plan, verificationRun: okRun }, p).record;
  assert.equal(W.transitionIncident(i, 'CLOSED', ALL, {}, p).code, 'DQ_POSTMORTEM_REQUIRED');
  const pm = W.postmortem(i, { whatHappened: 'x', impact: 'y', whyDetectionFailed: 'z', whatFixed: 'w' });
  const closed = W.transitionIncident(i, 'CLOSED', ALL, { postmortem: pm }, p);
  assert.equal(closed.record.status, 'CLOSED'); assert.equal(closed.audit.action, 'DQ_INCIDENT_CLOSE'); assert.equal(closed.record.rootCause.blameless, true);
});
test('DQSourceAuthorityChangeRequiresReconciliation: cutover blocked while old and new sources differ', () => {
  const rp = M.policy(DEV).reconciliationPolicies.find(r => r.id === 'RP-PRICING');
  const neu = J(lots); for (let k = 0; k < 12; k++) neu[k].commercial.price += 10;
  const rep = E.authorityCutoverReport(rp, lots, neu, { now: NOW });
  assert.equal(rep.mismatched, 12); assert.equal(rep.decision, 'BLOCK');
  const req = { dataDomainId: 'PRICING', currentSourceRef: 'price-table-v1', proposedSourceRef: 'api', reason: 'r', impactAssessmentRef: 'ia', migrationPlanRef: 'mp', status: 'REVIEW', organizationId: 'org_house7' };
  assert.equal(W.transitionSourceAuthorityChange(req, 'APPROVED', ALL, {}).code, 'DQ_RECONCILIATION_REQUIRED');
  assert.equal(W.transitionSourceAuthorityChange(req, 'APPROVED', ALL, { cutoverReport: rep }).code, 'DQ_RECONCILIATION_REQUIRED');
  assert.equal(W.transitionSourceAuthorityChange(req, 'APPROVED', ALL, { cutoverReport: E.authorityCutoverReport(rp, lots, lots) }).record.status, 'APPROVED');
});
test('DQCrossTenantReferenceDetected: foreign development refs blocked; other organization cannot touch records', () => {
  const ls = J(lots); ls[0].identity.developmentId = 'other-dev';
  const g = gate({ lots: ls }); assert.equal(reasonOf(g, 'DQ-TEN-002').decision, 'BLOCK'); assert.equal(reasonOf(g, 'DQ-TEN-001').decision, 'BLOCK');
  assert.equal(gate({ organizationId: 'org_other' }).reasons[0].code, 'DQ_TENANT_MISMATCH');
  const f = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleIds: ['DQ-AVAIL-002'] }).findings[0];
  assert.equal(W.acknowledge(f, actor('*', { org: 'org_other' })).code, 'DQ_NOT_FOUND');
  assert.equal(W.acknowledge(f, null).code, 'DQ_PERMISSION_DENIED');
});
test('DQRestoreRunsCriticalIntegrityChecks: restore/migration validation is never accepted by row count only', () => {
  assert.equal(gate({ actionCode: 'RESTORE_VALIDATION' }).decision, 'PASS');
  const broken = J(lots); broken[10].identity.id = broken[11].identity.id;
  assert.equal(gate({ actionCode: 'RESTORE_VALIDATION', lots: broken }).decision, 'BLOCK', 'same count (498), integrity broken');
  assert.equal(gate({ actionCode: 'MIGRATION_VALIDATION', lots: lots.slice(0, 49) }).decision, 'REVIEW');
});

// ------------------------------------------------------------------ remaining units
test('finding lifecycle: false positive needs a reason; resolve needs evidence and a passing re-run', () => {
  const ls = J(lots); ls[0].geometry.bounds = { x: 0, y: 0, w: 1, h: 1 };
  const f = E.run({ input: { developmentId: DEV, lots: ls, now: NOW }, ruleIds: ['DQ-GEO-003'] }).findings[0];
  assert.equal(W.markFalsePositive(f, ALL, { reason: 'curto' }).code, 'DQ_REASON_REQUIRED');
  const a = W.acknowledge(f, ALL).record, m = W.startRemediation(a, ALL).record;
  assert.equal(W.resolveFinding(m, ALL, { resolution: { resolutionType: 'DATA_FIXED', evidenceRefs: [] } }).code, 'DQ_EVIDENCE_REQUIRED');
  const still = E.run({ input: { developmentId: DEV, lots: ls, now: NOW }, ruleIds: ['DQ-GEO-003'] });
  assert.equal(W.resolveFinding(m, ALL, { resolution: { resolutionType: 'SOURCE_FIXED', evidenceRefs: ['ticket'] }, verificationRun: still }).code, 'DQ_VERIFICATION_REQUIRED');
  const fixed = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleIds: ['DQ-GEO-003'] });
  const r = W.resolveFinding(m, ALL, { resolution: { resolutionType: 'SOURCE_FIXED', evidenceRefs: ['ticket'] }, verificationRun: fixed });
  assert.equal(r.record.status, 'RESOLVED'); assert.equal(r.record.resolution.verificationRunRef, fixed.id);
  assert.equal(W.refreshFinding(r.record, f, NOW).status, 'OPEN', 're-failing after resolution reopens');
});
test('contracts: breaking change needs a major version and lists consumers; enum value added asks for review', () => {
  const c = M.policy(DEV).contracts.find(x => x.id === 'DC-PRICING-FINANCIAL');
  const unit = c.fields.map(f => f.fieldKey === 'commercial.price' ? { ...f, unit: 'BRL_CENTS' } : f);
  const r = W.contractCompatibility(c, unit, '1.1.0'); assert.equal(r.breaking, true); assert.equal(r.decision, 'BLOCK'); assert.equal(r.code, 'DQ_BREAKING_CHANGE_NEEDS_MAJOR');
  const r2 = W.contractCompatibility(c, unit, '2.0.0'); assert.equal(r2.decision, 'REVIEW'); assert.deepEqual(J(r2.impactedConsumers), ['financial', 'proposal', 'share']);
  const a = M.policy(DEV).contracts.find(x => x.id === 'DC-AVAILABILITY-RECOMMENDATION');
  const r3 = W.contractCompatibility(a, a.fields.map(f => f.allowedValues ? { ...f, allowedValues: [...f.allowedValues, 'OPTION'] } : f), '1.1.0');
  assert.ok(r3.changes.some(x => x.kind === 'ENUM_VALUE_ADDED')); assert.notEqual(r3.decision, 'PASS');
});
test('certification: permission required; dynamic availability not certifiable; new geometry version expires it', () => {
  const p = M.policy(DEV), run = E.run({ input: { developmentId: DEV, lots, now: NOW }, ruleSetIds: ['RS-GEOMETRY'] });
  assert.equal(W.certify({ scopeRef: 'GeometryVersion', dataDomainId: 'GEOMETRY', run }, p, actor([])).code, 'DQ_PERMISSION_DENIED');
  assert.equal(W.certify({ scopeRef: 'availability', dataDomainId: 'AVAILABILITY', run }, p, ALL).code, 'DQ_CERTIFICATION_EXPIRY_REQUIRED');
  const c = W.certify({ scopeRef: 'GeometryVersion', scopeVersion: '2026-10-06.1', dataDomainId: 'GEOMETRY', run, limitations: ['KL-TOPOGRAPHY'] }, p, ALL, { now: NOW }).record;
  assert.equal(c.certificationLevel, 'CERTIFIED_WITH_LIMITATIONS'); assert.equal(c.expiryStatus, 'NECESSITA_CONFIRMACAO');
  assert.equal(W.certificationView(c, { now: NOW, currentScopeVersion: '2026-11-01.1' }).status, 'EXPIRED');
  const bad = J(lots); bad[1].identity.id = bad[0].identity.id;
  assert.equal(W.certify({ scopeRef: 'x', dataDomainId: 'LOT_IDENTITY', run: E.run({ input: { developmentId: DEV, lots: bad, now: NOW }, ruleIds: ['DQ-LOT-001'] }) }, p, ALL).code, 'DQ_OPEN_BLOCKING_FINDINGS');
});
test('volume, distribution and metrics helpers; SLO never invents a target', () => {
  const vp = M.policy(DEV).volumeExpectations[0];
  assert.equal(E.checkVolume(vp, 49, 498).breaches[0].code, 'BELOW_MIN'); assert.equal(E.checkVolume(vp, 498, 498).changeCheck, 'NOT_CONFIGURED');
  const ls = J(lots); ls.forEach(l => { l.geometry.areaM2 = l.geometry.areaM2 / 10; });
  const d = E.detectDistributionDrift(M.policy(DEV).baselines.distribution['DIST-VJ-LOTS'], E.distributionStats(ls), null);
  assert.ok(d.changes.some(c => c.fieldRef === 'geometry.areaM2' && c.stat === 'median' && c.requiresReview));
  assert.equal(E.evaluateSlo({ id: 's', target: null }, 0.5).status, 'NOT_CONFIGURED');
  assert.equal(E.evaluateSlo({ id: 's', target: 0.9, comparator: 'GTE', dataDomainId: 'GEOMETRY' }, 0.5).breach.status, 'OPEN');
  const m = E.operationalMetrics({ findings: E.assess({ developmentId: DEV, lots, now: NOW }).run.findings });
  assert.ok(m.dq_findings_open >= 2); assert.deepEqual(J(m.labels), ['dataDomainId', 'developmentId'], 'no per-user labels');
  assert.equal(E.durationMs('PT1H'), 3600000); assert.equal(E.durationMs(null), null);
});
test('view: backoffice markup escaped, no data-act, client notice without jargon', () => {
  const a = E.assess({ developmentId: DEV, lots, now: NOW }), html = App.dataQualityView.home(a);
  assert.match(html, /Qualidade e governança dos dados/); assert.match(html, /necessita confirmação/); assert.ok(!/data-act=/.test(html));
  assert.ok(!/<script/i.test(App.dataQualityView.findingsTable([{ ...a.run.findings[0], ruleName: '<script>x</script>' }])));
  assert.ok(!/UNKNOWN|finding/i.test(App.dataQualityView.clientNotice(M.policy(DEV))));
});
test('permissions registered (deny by default, not anonymous, no role grants)', () => {
  for (const k of Object.values(M.PERMISSIONS)) { const p = App.permissions.get(k); assert.ok(p, k); assert.equal(p.anonymousAllowed, false); assert.equal(App.authz.can(k, { developmentId: DEV }), false, k); }
  for (const r of App.permissions.roles()) for (const k of Object.values(M.PERMISSIONS)) assert.ok(!r.grants.includes(k), `${r.code} ${k}`);
});
