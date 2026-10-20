'use strict';
// Topic 34 — data confidence ("Confiança do dado") in SHADOW mode: golden scenarios, methodology validation,
// propagation, projections, history/asOf, mixed methodology, tenant isolation and business zero-delta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');
const MODULES = ['documents/integrity.js', 'documents/documentDomain.js', 'documents/documentServices.js', 'provenance/provenanceModel.js', 'provenance/provenanceServices.js', 'provenance/legacyProvenance.js',
  'confidence/confidenceEngine.js', 'confidence/confidenceServices.js', 'presentation/dataTrustView.js'];

let App, P, PS, C, CS, lots, M0;
const T = { organizationId: 'org_house7', activeDevelopmentId: 'viva-juara' };
const NOW = '2026-10-09T12:00:00.000Z';
const grant = (keys, mode = 'BROKER', org = 'org_house7') => ({ organizationId: org, principalId: 'u_test', mode, can: k => keys === '*' || keys.includes(k) });
const TECH = grant(['confidence.technical.read', 'provenance.technical.read'], 'TECHNICAL');
const clone = x => JSON.parse(JSON.stringify(x));

test.before(async () => {
  App = load(); for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  P = App.provenance; PS = App.provenanceServices; C = App.dataConfidence; CS = App.dataConfidenceServices;
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync();
  M0 = CS.createMethodologyRegistry('viva-juara').current();
});
/** methodology variant for scenarios that need an assessed method (never the shipped config) */
const variant = (patch = {}, assessments = []) => { const m = clone(M0); Object.assign(m, patch); m.methodAssessments = [...m.methodAssessments.filter(a => !assessments.some(b => b.methodId === a.methodId)), ...assessments]; m.checksum = C.checksumOf(m); return m; };
const VALIDATED = (methodId, methodVersion, baseReliability) => ({ methodId, methodVersion, assessmentStatus: 'VALIDATED', baseReliability, version: 'test-1', assessedBy: 'test' });
const input = (o = {}) => ({ organizationId: 'org_house7', developmentId: 'viva-juara', entityType: 'LOT', entityId: 'VJ-T-L0001', attributePath: 'geometry.areaM2', valueFingerprint: P.fingerprint(250), provenanceId: 'prov_x',
  provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', currentness: 'CURRENT', sourceAuthorities: [{ authority: 'OFFICIAL_PRIMARY' }], hasConflict: false, locatorSpecificity: 'PAGE', dependencyInputs: [],
  evaluationContext: { asOf: NOW, methodologyVersion: M0.version, mode: 'CURRENT' }, ...o });

test('the shipped methodology is a valid DRAFT, UNCALIBRATED, executed in SHADOW; every non-formula method is UNASSESSED', () => {
  assert.deepEqual(clone(C.validateMethodology(M0)), { valid: true, errors: [] });
  assert.equal(M0.status, 'DRAFT'); assert.equal(M0.calibrationStatus, 'UNCALIBRATED');
  assert.equal(CS.createMethodologyRegistry('viva-juara').executionMode, 'SHADOW');
  for (const a of M0.methodAssessments) if (!/^(lot_price_per_m2_times_area|down_payment_percent_of_price)$/.test(a.methodId)) { assert.equal(a.assessmentStatus, 'UNASSESSED'); assert.equal(a.baseReliability, undefined); }
});

test('OfficialAreaHighConfidence and OfficialAreaSupersededSource: same value, lower confidence when the source is superseded', () => {
  const a = C.evaluate(input(), M0);
  assert.equal(a.status, 'COMPUTED'); assert.ok(a.score > 0.8, String(a.score)); assert.equal(a.band, 'VERY_HIGH'); assert.equal(a.displayScore, Math.round(a.score * 100));
  const b = C.evaluate(input({ currentness: 'SOURCE_SUPERSEDED' }), M0);
  assert.equal(b.valueFingerprint, a.valueFingerprint); assert.ok(b.score <= 0.6); assert.ok(b.trace.appliedCaps.some(c => c.capType === 'CURRENTNESS' && c.applied));
  assert.ok(b.limitingFactors.some(l => l.code === 'SOURCE_SUPERSEDED'));
  assert.deepEqual(clone(C.evaluate(input(), M0)), clone(a), 'deterministic');
  const ex = C.explain(b, M0); assert.ok(!/%|chance|probabilidade de/i.test(ex.text)); assert.ok(ex.caveats.some(c => /não é probabilidade/.test(c)));
});

test('null is never zero: NOT_AVAILABLE → NOT_APPLICABLE; blocking states give no score', () => {
  const na = C.evaluate(input({ provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', valueFingerprint: P.fingerprint(null) }), M0);
  assert.equal(na.status, 'NOT_APPLICABLE'); assert.equal(na.score, null); assert.equal(na.displayScore, null); assert.equal(na.band, null);
  assert.equal(C.evaluate(input({ evidenceState: 'INVALID' }), M0).status, 'INVALID_PROVENANCE');
  assert.equal(C.evaluate(input({ evidenceState: 'MISSING' }), M0).status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(C.evaluate(input({ recordStatus: 'INVALIDATED' }), M0).status, 'INVALID_PROVENANCE');
  assert.equal(C.evaluate(input({ valueFingerprintMismatch: true }), M0).status, 'INVALID_PROVENANCE');
  assert.equal(C.evaluate({ entityId: 'x' }, M0).status, 'ERROR');
});

test('ConflictingOfficialSources: unresolved conflict blocks the score (CONFLICTED, null); a resolved one keeps a warning', () => {
  const c = C.evaluate(input({ hasConflict: true, conflictState: 'OPEN' }), M0);
  assert.equal(c.status, 'CONFLICTED'); assert.equal(c.score, null); assert.match(C.explain(c, M0).text, /fontes conflitantes/);
  const r = C.evaluate(input({ hasConflict: true, conflictState: 'RESOLVED' }), M0);
  assert.equal(r.status, 'COMPUTED'); assert.ok(r.warnings.includes('CONFLICT_RESOLVED_PREVIOUSLY'));
});

test('LegacyConfirmedNoSource: capped by the legacy policy (or no score when configured), never high by default', () => {
  const l = C.evaluate(input({ provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED', currentness: 'UNKNOWN', sourceAuthorities: [], legacyCandidateDocument: true }), M0);
  assert.equal(l.status, 'COMPUTED'); assert.ok(l.score <= M0.legacyPolicy.maxScore); assert.ok(!['HIGH', 'VERY_HIGH'].includes(l.band));
  assert.ok(l.limitingFactors.some(x => x.code === 'LEGACY_SOURCE_UNRESOLVED')); assert.ok(l.trace.appliedCaps.some(c => c.capType === 'LEGACY_UNRESOLVED'));
  const m = variant({ legacyPolicy: { unresolvedLegacyBehavior: 'NO_SCORE' } });
  assert.equal(C.evaluate(input({ provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED', evaluationContext: { asOf: NOW, methodologyVersion: m.version } }), m).status, 'INSUFFICIENT_EVIDENCE');
});

test('EstimatedNoiseUnassessedMethod vs EstimatedNoiseValidatedMethod: no invented reliability; a high-confidence estimate stays an estimate', () => {
  const ref = { methodId: 'analysis_model', methodVersion: '2026-10-06', methodType: 'ESTIMATION' };
  const base = { attributePath: 'environmental.noiseLevel', provenanceKind: 'ESTIMATED', evidenceState: 'PARTIAL', sourceAuthorities: [], methodRef: ref, estimate: true,
    dependencyInputs: [{ attributePath: 'location.distanceToExternalRoadM', status: 'COMPUTED', score: 0.9, required: true, valueFingerprint: 'fp' }] };
  const u = C.evaluate(input({ ...base, methodAssessment: C.assessmentOf(M0, ref) }), M0);
  assert.equal(u.status, 'METHOD_UNASSESSED'); assert.equal(u.score, null);
  const m = variant({}, [VALIDATED('analysis_model', '2026-10-06', 0.9)]);
  const v = C.evaluate(input({ ...base, methodAssessment: C.assessmentOf(m, ref) }), m);
  assert.equal(v.status, 'COMPUTED'); assert.ok(v.warnings.includes('VALUE_IS_ESTIMATE')); assert.ok(C.explain(v, m).caveats.some(c => /estimativa/.test(c)));
});

test('Calculated: high-confidence inputs vs one weak input (bounded by the weakest dependency); missing required input blocks', () => {
  const ref = { methodId: 'lot_price_per_m2_times_area', methodVersion: '1', methodType: 'FORMULA' };
  const m = variant({}, [VALIDATED('lot_price_per_m2_times_area', '1', 0.99)]);
  const mk = deps => C.evaluate(input({ attributePath: 'commercial.price', provenanceKind: 'CALCULATED', evidenceState: 'VERIFIED', sourceAuthorities: [], methodRef: ref, methodAssessment: C.assessmentOf(m, ref),
    dependencyInputs: deps.map(([p, s, st = 'COMPUTED']) => ({ attributePath: p, score: s, status: st, required: true, valueFingerprint: 'fp' })), evaluationContext: { asOf: NOW, methodologyVersion: m.version } }), m);
  const hi = mk([['geometry.areaM2', 0.95], ['commercial.pricePerM2', 0.95]]), lo = mk([['geometry.areaM2', 0.95], ['commercial.pricePerM2', 0.3]]);
  assert.equal(hi.status, 'COMPUTED'); assert.ok(hi.score > lo.score);
  assert.ok(lo.score <= 0.3 + m.dependencyPolicy.maxAboveWeakestDependency + 1e-9); assert.ok(lo.trace.appliedCaps.some(c => c.capType === 'WEAKEST_DEPENDENCY' && c.applied));
  const miss = mk([['geometry.areaM2', 0.95], ['commercial.pricePerM2', null, 'NOT_APPLICABLE']]);
  assert.equal(miss.status, 'DEPENDENCY_UNAVAILABLE'); assert.equal(miss.score, null);
});

test('manual assertion with/without support and manual override are conservative', () => {
  const with_ = C.evaluate(input({ provenanceKind: 'MANUAL_ASSERTION', evidenceState: 'PARTIAL', sourceAuthorities: [], manualSupportingEvidence: true }), M0);
  const without = C.evaluate(input({ provenanceKind: 'MANUAL_ASSERTION', evidenceState: 'UNRESOLVED', sourceAuthorities: [], manualSupportingEvidence: false }), M0);
  assert.ok(with_.score > without.score); assert.ok(without.score <= M0.manualAssertionPolicy.maxScoreWithoutEvidence);
  const ov = C.evaluate(input({ provenanceKind: 'MANUAL_OVERRIDE', evidenceState: 'UNRESOLVED', sourceAuthorities: [], attributePath: 'commercial.pricePerM2' }), M0);
  assert.ok(ov.score <= M0.overridePolicy.maxScoreWithoutEvidence); assert.ok(ov.limitingFactors.some(l => l.code === 'MANUAL_OVERRIDE'));
});

test('independent agreeing sources may get a bounded boost; correlated or unknown independence never do', () => {
  const two = [{ authority: 'OFFICIAL_PRIMARY' }, { authority: 'OFFICIAL_PRIMARY' }];
  const ind = C.evaluate(input({ sourceAuthorities: two, sourceIndependenceGroups: ['g1', 'g2'] }), M0);
  const cor = C.evaluate(input({ sourceAuthorities: two, sourceIndependenceGroups: ['g1', 'g1'] }), M0);
  const unk = C.evaluate(input({ sourceAuthorities: two }), M0), one = C.evaluate(input(), M0);
  assert.ok(ind.score > one.score); assert.ok(ind.score - one.score <= 0.06 + M0.multiSourcePolicy.maxAgreementBoost);
  assert.equal(cor.score, one.score); assert.equal(unk.score, one.score);
});

test('methodology validator rejects overlapping bands, negative/zero weights, invented reliability and edited published versions', () => {
  const bad1 = variant({ bands: [{ band: 'LOW', minInclusive: 0, maxExclusive: 0.6 }, { band: 'HIGH', minInclusive: 0.5, maxInclusive: 1 }] });
  assert.equal(C.validateMethodology(bad1).valid, false);
  const bad2 = clone(M0); bad2.evaluationProfiles.DIRECT_SOURCE.dimensions.SOURCE_AUTHORITY = -1; assert.equal(C.validateMethodology(bad2).valid, false);
  const bad3 = clone(M0); bad3.evaluationProfiles.CALCULATED.dimensions = { METHOD_RELIABILITY: 0 }; assert.ok(C.validateMethodology(bad3).errors.some(e => e.code === 'CONFIDENCE_WEIGHT_CONFIGURATION_INVALID'));
  const bad4 = variant({}, [{ methodId: 'analysis_model', methodVersion: '2026-10-06', assessmentStatus: 'UNASSESSED', baseReliability: 0.9, version: 'x' }]); assert.equal(C.validateMethodology(bad4).valid, false);
  const reg = CS.createMethodologyRegistry('viva-juara');
  const v2 = { ...clone(M0), version: '0.2.0-test', status: 'VALIDATED' };
  assert.equal(reg.add(v2).ok, true);
  assert.equal(reg.publish('0.2.0-test', grant(['confidence.read'])).code, 'CONFIDENCE_ACCESS_DENIED');
  assert.equal(reg.publish(M0.version, grant(['confidence.methodology.manage'])).code, 'CONFIDENCE_METHODOLOGY_NOT_VALIDATED', 'a DRAFT is never published');
  assert.equal(reg.publish('0.2.0-test', grant(['confidence.methodology.manage']), NOW).ok, true);
  assert.equal(reg.add({ ...v2, notes: 'edit' }).code, 'CONFIDENCE_METHODOLOGY_IMMUTABLE');
  const tampered = { ...clone(reg.get('0.2.0-test')), notes: 'x' }; assert.equal(C.validateMethodology(tampered).valid, false);
});

// ---------------------------------------------------------------- service level (provenance → confidence)
function world(classification = 'PUBLIC') {
  let clock = Date.parse(NOW);
  const ds = App.documentServices.createService({ now: () => clock, scanner: () => 'CLEAN' }), ADMIN = grant('*', 'TECHNICAL');
  const pub = (s, docId) => { const b = ds.ingest(T, { developmentId: 'viva-juara', items: [{ bytes: new TextEncoder().encode('%PDF-1.7 ' + s), declaredMediaType: 'application/pdf', ...(docId ? { documentId: docId } : { newDocument: { documentType: 'OFFICIAL_PLAN', title: 'Planta', classification, authority: 'OFFICIAL_PRIMARY', scope: { scopeType: 'DEVELOPMENT' } } }) }] }, ADMIN);
    const it = b.batch.items[0]; ds.validateVersion(T, it.versionId, ADMIN); clock += 1000; return ds.publish(T, it.documentId, it.versionId, ADMIN); };
  const p1 = pub('v1'), prov = PS.createService({ now: NOW, documents: { service: ds } });
  const l = lots[0], id = l.identity.id;
  const sr = ds.sourceRefFor(T, p1.document.id, p1.version.id, { pageNumber: 1 }).sourceRef;
  prov.record(T, { developmentId: 'viva-juara', entityType: 'LOT', entityId: id, attributePath: 'geometry.areaM2', valueFingerprint: P.fingerprint(l.geometry.areaM2), provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', currentness: 'CURRENT', evidenceRefs: [P.evidence.document(sr)] });
  return { ds, prov, p1, pub, l, id };
}

test('RestrictedEvidenceSameConfidenceDifferentProjection + SHADOW: same technical score, invisible to client/broker, visible to technical with permission', () => {
  const a = world('PUBLIC'), b = world('RESTRICTED');
  const ca = CS.createService({ provenance: a.prov, developmentId: 'viva-juara', now: NOW }), cb = CS.createService({ provenance: b.prov, developmentId: 'viva-juara', now: NOW });
  const ra = ca.evaluate(T, 'LOT', a.id, 'geometry.areaM2', { asOf: NOW }).result, rb = cb.evaluate(T, 'LOT', b.id, 'geometry.areaM2', { asOf: NOW }).result;
  assert.equal(ra.status, 'COMPUTED'); assert.equal(ra.score, rb.score, 'access never changes the technical score');
  assert.equal(cb.project(T, rb, { mode: 'CLIENT' }).visible, false); assert.equal(cb.project(T, rb, { mode: 'BROKER' }).reason, 'SHADOW_MODE');
  assert.equal(cb.project(T, rb, { mode: 'TECHNICAL', access: grant(['provenance.read']) }).code, 'CONFIDENCE_ACCESS_DENIED');
  const tech = cb.project(T, rb, { mode: 'TECHNICAL', access: TECH });
  assert.equal(tech.visible, true); assert.equal(tech.shadow, true); assert.match(tech.methodologyBadge, /DRAFT.*shadow/);
  const html = App.dataTrustView.confidencePanel(tech); assert.match(html, /Modo shadow/); assert.match(html, /não é probabilidade/);
  assert.equal(App.dataTrustView.confidencePanel(cb.project(T, rb, { mode: 'BROKER' })), '');
  assert.equal(cb.project({ organizationId: 'org_other' }, rb, { mode: 'TECHNICAL', access: TECH }).code, 'CONFIDENCE_TENANT_MISMATCH');
});

test('SourceUpdateLowersConfidenceWithoutChangingValue + history; HistoricalConfidenceAsOfOldVersion', () => {
  const w = world('PUBLIC'), cs = CS.createService({ provenance: w.prov, developmentId: 'viva-juara', now: NOW });
  const r1 = cs.evaluate(T, 'LOT', w.id, 'geometry.areaM2', { asOf: NOW }).result;
  const p2 = w.pub('v2', w.p1.document.id);
  w.prov.onDocumentVersionPublished(T, { documentId: w.p1.document.id, versionId: p2.version.id, metadata: p2.event.metadata });
  const r2 = cs.evaluate(T, 'LOT', w.id, 'geometry.areaM2', { asOf: '2026-10-10T00:00:00.000Z' }).result;
  assert.equal(r2.valueFingerprint, r1.valueFingerprint); assert.ok(r2.score < r1.score, `${r2.score} < ${r1.score}`);
  const h = cs.repo.history(T, 'LOT', w.id, 'geometry.areaM2'); assert.equal(h.length, 2); assert.equal(h[0].score, r1.score);
  assert.equal(cs.repo.get(T, r1.id).score, r1.score, 'old result is never overwritten');
  assert.equal(r1.asOf, NOW); assert.equal(r1.methodologyVersion, M0.version);
});

test('MethodologyVersionChangesBand: impact report before publishing; mixed versions are never compared or snapshotted together', () => {
  const w = world('PUBLIC');
  const reg = CS.createMethodologyRegistry('viva-juara'); const strict = { ...clone(M0), version: '0.1.1-strict', status: 'DRAFT', bands: [{ band: 'VERY_LOW', minInclusive: 0, maxExclusive: 0.5, labelKey: 'Muito baixa' }, { band: 'LOW', minInclusive: 0.5, maxExclusive: 0.9, labelKey: 'Baixa' }, { band: 'MEDIUM', minInclusive: 0.9, maxExclusive: 0.95, labelKey: 'Média' }, { band: 'HIGH', minInclusive: 0.95, maxExclusive: 0.99, labelKey: 'Alta' }, { band: 'VERY_HIGH', minInclusive: 0.99, maxInclusive: 1, labelKey: 'Muito alta' }] };
  assert.equal(reg.add(strict).ok, true);
  const cs = CS.createService({ provenance: w.prov, developmentId: 'viva-juara', registry: reg, now: NOW });
  const a = cs.evaluate(T, 'LOT', w.id, 'geometry.areaM2', { asOf: NOW, methodologyVersion: M0.version }).result;
  const b = cs.evaluate(T, 'LOT', w.id, 'geometry.areaM2', { asOf: NOW, methodologyVersion: '0.1.1-strict' }).result;
  assert.equal(a.methodologyVersion, M0.version, 'explicit historical methodology is honoured'); assert.notEqual(a.band, b.band);
  const rep = cs.impactReport([a], [b]); assert.equal(rep.affectedResults, 1); assert.equal(rep.fromVersion, M0.version); assert.equal(rep.toVersion, '0.1.1-strict');
  assert.equal(CS.checkComparable([a, b]).label, 'MIXED_METHODOLOGY'); assert.equal(cs.snapshot(T, [a, b], 'SHARE').code, 'CONFIDENCE_MIXED_METHODOLOGY');
  assert.equal(cs.snapshot(T, [a], 'SHARE').ok, true);
  assert.equal(C.evaluate({ ...input(), evaluationContext: { asOf: NOW, methodologyVersion: 'other' } }, M0).status, 'ERROR');
});

test('cache and repository are tenant-isolated; dependency resolution uses provenance lineage', () => {
  const cache = CS.createCache(); const x = input();
  cache.set(cache.key(x, M0.version, '2026-10-09'), 1); cache.set(cache.key({ ...x, organizationId: 'org_other' }, M0.version, '2026-10-09'), 2); cache.clearOrganization('org_other'); assert.equal(cache.size(), 1);
  const repo = CS.createRepository(); assert.equal(repo.put({ organizationId: 'org_other' }, C.evaluate(input(), M0)).code, 'CONFIDENCE_TENANT_MISMATCH');
});

test('full development in SHADOW: distribution only (no overall lot score), and scores / classes / rankings / Fit / Recommendation unchanged', () => {
  const prov = PS.createService({ now: NOW }); App.provenanceMigration.load(prov, T, lots, 'viva-juara', { validate: false });
  const fitCfg = App.fit.cfgOf('viva-juara'), pol = App.recommendation.policyOf('viva-juara');
  const profile = App.fit.buildProfile({ preferences: App.services.recommendation.PRESETS[0].prefs });
  const snapshotBusiness = () => JSON.stringify({ lots: lots.map(l => App.domain.serializeLot(l)), fit: App.fit.fitLots(profile, lots, fitCfg),
    rec: App.recommendation.recommend({ developmentId: 'viva-juara', profile, constraints: [], lots, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: {} }) });
  const before = snapshotBusiness();
  const cs = CS.createService({ provenance: prov, developmentId: 'viva-juara', now: NOW });
  const rs = cs.evaluateDevelopment(T, lots, { asOf: NOW });
  assert.equal(rs.length, 498 * P.pathRegistry.tracked().length);
  assert.equal(snapshotBusiness(), before, 'confidence in shadow never changes business outputs');
  const d = cs.diagnostics(T, rs);
  assert.equal(d.executionMode, 'SHADOW'); assert.equal(d.methodologyStatus, 'DRAFT'); assert.ok(d.statusCounts.METHOD_UNASSESSED > 0); assert.ok(d.statusCounts.NOT_APPLICABLE > 0);
  assert.equal(rs.filter(r => r.status === 'NOT_APPLICABLE' && r.score !== null).length, 0);
  assert.equal(rs.filter(r => r.attributePath === 'geometry.areaM2' && ['HIGH', 'VERY_HIGH'].includes(r.band)).length, 0, 'legacy area is never high');
  const s = cs.lotSummary(T, lots[0].identity.id, rs.filter(r => r.entityId === lots[0].identity.id));
  assert.equal(s.weightedAggregateScore, null); assert.equal(s.trackedAttributeCount, P.pathRegistry.tracked().length);
  for (const r of rs.slice(0, 2000)) assert.equal(cs.project(T, r, { mode: 'BROKER' }).visible, false);
});
