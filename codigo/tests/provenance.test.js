'use strict';
// Topic 33 — attribute provenance: golden scenarios, validator, conflicts, source upgrade impact, projections,
// adapters, legacy migration (zero-delta) and tenant isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');
const MODULES = ['documents/integrity.js', 'documents/documentDomain.js', 'documents/documentServices.js', 'provenance/provenanceModel.js', 'provenance/provenanceServices.js', 'provenance/legacyProvenance.js', 'presentation/dataTrustView.js'];

let App, P, PS, lots, byId, migrated, before;
const T = { organizationId: 'org_house7', activeDevelopmentId: 'viva-juara' };
const NOW = '2026-10-09T12:00:00.000Z';
const grant = (keys, mode = 'BROKER', org = 'org_house7') => ({ organizationId: org, principalId: 'u_test', mode, can: k => keys === '*' || keys.includes(k) });
const ADMIN = grant('*', 'TECHNICAL');
const pdf = s => new TextEncoder().encode('%PDF-1.7\n' + s + '\n%%EOF');
const keys = o => JSON.stringify(o);

test.before(async () => {
  App = load(); for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  P = App.provenance; PS = App.provenanceServices;
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync(); byId = new Map(lots.map(l => [l.identity.id, l]));
  before = lots.map(l => App.domain.serializeLot(l));
  migrated = PS.createService({ now: NOW }); App.provenanceMigration.load(migrated, T, lots, 'viva-juara', { validate: true });
});

/** a document service with one published plan (classification configurable) */
function docWorld(o = {}) {
  let clock = Date.parse(NOW);
  const ds = App.documentServices.createService({ now: () => clock, scanner: () => 'CLEAN' });
  const pub = (bytes, docId, extra = {}) => {
    const b = ds.ingest(T, { developmentId: 'viva-juara', items: [{ bytes, filename: 'p.pdf', declaredMediaType: 'application/pdf', sourceEffectiveFrom: extra.from || '2026-10-01', ...(docId ? { documentId: docId } : { newDocument: { documentType: 'OFFICIAL_PLAN', title: extra.title || 'Planta', classification: o.classification || 'PUBLIC', authority: 'OFFICIAL_PRIMARY', documentCode: extra.code || null, scope: { scopeType: 'DEVELOPMENT' } } }) }] }, ADMIN);
    const it = b.batch.items[0]; ds.validateVersion(T, it.versionId, ADMIN); clock += 1000; return ds.publish(T, it.documentId, it.versionId, ADMIN);
  };
  const p1 = pub(pdf('plan v' + (o.tag || 1)));
  const svc = PS.createService({ now: NOW, documents: { service: ds } });
  return { ds, svc, p1, pub };
}
const lot = () => lots[0];
const recIn = (path, o) => ({ developmentId: 'viva-juara', entityType: 'LOT', entityId: lot().identity.id, attributePath: path, valueFingerprint: P.fingerprint(P.valueAt(lot(), path)), currentness: 'CURRENT', ...o });

test('OfficialAreaWithExactPage: DIRECT_SOURCE / VERIFIED points to the exact version and page → "Confirmado"', () => {
  const { svc, ds, p1 } = docWorld();
  const sr = ds.sourceRefFor(T, p1.document.id, p1.version.id, { pageNumber: 1 }).sourceRef;
  const r = svc.record(T, recIn('geometry.areaM2', { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.document(sr)], metadata: { sourceAuthority: 'OFFICIAL_PRIMARY' } }), { entity: lot() });
  assert.equal(r.ok, true, keys(r));
  const s = svc.getField(T, 'LOT', lot().identity.id, 'geometry.areaM2').summary;
  assert.equal(s.displayCode, 'CONFIRMED'); assert.equal(s.sourceCount, 1); assert.equal(s.currentness, 'CURRENT');
  const client = svc.project(T, r.record, { mode: 'CLIENT', access: grant([], 'CLIENT') });
  assert.equal(client.label, 'Confirmado'); assert.equal(client.sourcePhrase, 'Fonte: documentação oficial do empreendimento');
  assert.ok(!keys(client).includes(p1.version.id), 'client mode never shows ids');
  const tech = svc.project(T, r.record, { mode: 'TECHNICAL', access: ADMIN });
  assert.equal(tech.sources[0].documentVersionId, p1.version.id); assert.equal(tech.sources[0].locator.pageNumber, 1);
});

test('SpreadsheetAreaWithExactCell: raw observation keeps its position; normalization is a versioned method (NORMALIZED_SOURCE)', () => {
  const { svc, ds, p1 } = docWorld({ tag: 'xl' });
  const sr = ds.sourceRefFor(T, p1.document.id, p1.version.id, null).sourceRef;
  const raw = PS.rawObservation({ rawValue: '250,00 m²', sourceRef: sr, locator: { sheetName: 'Lotes', cellRange: 'F327' }, rawFieldName: 'Área' });
  const n = PS.normalize(raw, 'geometry.areaM2', 'area_string_to_decimal@1'); assert.equal(n.ok, true); assert.equal(n.observation.canonicalValue, 250);
  assert.equal(PS.NORMALIZERS['br_decimal_to_number@1.0.0']('1.234,56'), 1234.56); assert.equal(PS.NORMALIZERS['br_decimal_to_number@1.0.0']('abc'), null);
  const input = PS.buildFromObservation(n.observation, { organizationId: 'org_house7', developmentId: 'viva-juara', entityType: 'LOT', entityId: 'VJ-TEST-L0327' });
  assert.equal(input.provenanceKind, 'NORMALIZED_SOURCE'); assert.equal(input.methodRef.methodId, 'area_string_to_decimal');
  assert.equal(input.evidenceRefs[0].documentSourceRef.locator.cellRange, 'F327');
  const r = svc.record(T, input); assert.equal(r.ok, true, keys(r)); assert.equal(P.summarize(r.record).displayCode, 'CONFIRMED');
  assert.equal(App.documents.locatorSpecificity(r.record.evidenceRefs[0].documentSourceRef.locator), 'EXACT_CELL');
});

test('CalculatedDistanceWithGeometryDependencies: method + inputs (with fingerprints) are kept; lineage tree is depth-limited', () => {
  const svc = PS.createService({ now: NOW }), id = lot().identity.id, mk = (p, fp, o) => svc.record(T, { developmentId: 'viva-juara', entityType: 'LOT', entityId: id, attributePath: p, valueFingerprint: fp, currentness: 'CURRENT', ...o });
  const poly = mk('geometry.polygon', P.fingerprint(lot().geometry.polygon), { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.config({ configId: 'test', configVersion: '1' })] });
  const cen = mk('geometry.centroid', P.fingerprint(lot().geometry.centroid), { provenanceKind: 'CALCULATED', evidenceState: 'VERIFIED', methodRef: P.methodRef({ methodId: 'plan_vectorization', methodVersion: '1', methodType: 'TRANSFORMATION' }),
    dependencyRefs: [P.dependencyRef({ organizationId: 'org_house7', entityType: 'LOT', entityId: id, attributePath: 'geometry.polygon', valueFingerprint: poly.record.valueFingerprint, provenanceId: poly.record.id })] });
  assert.equal(cen.ok, true, keys(cen));
  const noDeps = svc.record(T, { developmentId: 'viva-juara', entityType: 'LOT', entityId: 'X', attributePath: 'geometry.bounds', valueFingerprint: P.fingerprint(1), provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', currentness: 'CURRENT', methodRef: P.methodRef({ methodId: 'plan_vectorization', methodVersion: '1', methodType: 'TRANSFORMATION' }) });
  assert.equal(noDeps.code, 'DEPENDENCIES_REQUIRED', 'known dependencies are mandatory (§502)');
  const noMethod = svc.record(T, { developmentId: 'viva-juara', entityType: 'LOT', entityId: 'X', attributePath: 'geometry.bounds', valueFingerprint: P.fingerprint(1), provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', currentness: 'CURRENT', dependencyRefs: cen.record.dependencyRefs });
  assert.equal(noMethod.code, 'METHOD_REQUIRED');
  const badVer = svc.record(T, { ...recIn('geometry.bounds', {}), entityId: 'Y', provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', methodRef: P.methodRef({ methodId: 'plan_vectorization', methodVersion: '9', methodType: 'TRANSFORMATION' }), dependencyRefs: cen.record.dependencyRefs });
  assert.equal(badVer.code, 'METHOD_VERSION_NOT_FOUND');
  const vm = svc.lineageViewModel(T, 'LOT', id, 'geometry.centroid', { access: ADMIN, depth: 2 });
  assert.equal(vm.ok, true); assert.equal(vm.vm.methodNode.label, 'plan_vectorization v1'); assert.equal(vm.vm.dependencyNodes[0].label, 'geometry.polygon');
  assert.equal(svc.lineageViewModel(T, 'LOT', id, 'geometry.centroid', { access: grant(['provenance.read']) }).code, 'PROVENANCE_ACCESS_DENIED');
  // cycle: polygon cannot depend on its own centroid
  const cyc = svc.record(T, { developmentId: 'viva-juara', entityType: 'LOT', entityId: id, attributePath: 'geometry.polygon', valueFingerprint: poly.record.valueFingerprint, provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', currentness: 'CURRENT',
    methodRef: P.methodRef({ methodId: 'plan_vectorization', methodVersion: '1', methodType: 'TRANSFORMATION' }), dependencyRefs: [P.dependencyRef({ organizationId: 'org_house7', entityType: 'LOT', entityId: id, attributePath: 'geometry.centroid', valueFingerprint: cen.record.valueFingerprint })] });
  assert.equal(cyc.code, 'LINEAGE_CYCLE');
});

test('SolarEstimateWithMethodVersion and NoiseEstimateWithInputLineage: estimates stay estimates', () => {
  const id = lot().identity.id;
  const solar = migrated.repo.current(T, 'LOT', id, 'environmental.morningSun');
  assert.equal(solar.provenanceKind, 'ESTIMATED'); assert.equal(solar.methodRef.methodId, 'solar_orientation'); assert.equal(solar.methodRef.methodVersion, '1');
  const noise = migrated.repo.current(T, 'LOT', id, 'environmental.noiseLevel');
  assert.equal(noise.provenanceKind, 'ESTIMATED'); assert.equal(P.summarize(noise).displayCode, 'ESTIMATED');
  const svc = PS.createService({ now: NOW });
  const direct = svc.record(T, recIn('environmental.noiseLevel', { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.config({ configId: 'x', configVersion: '1' })] }));
  assert.equal(direct.code, 'KIND_NOT_ALLOWED', 'an estimated field cannot be relabelled as a direct source');
  const est = svc.record(T, recIn('environmental.noiseLevel', { provenanceKind: 'ESTIMATED', evidenceState: 'PARTIAL', methodRef: P.methodRef({ methodId: 'analysis_model', methodVersion: '2026-10-06', methodType: 'ESTIMATION' }),
    dependencyRefs: [P.dependencyRef({ organizationId: 'org_house7', entityType: 'LOT', entityId: id, attributePath: 'location.distanceToExternalRoadM', valueFingerprint: P.fingerprint(lot().location.distanceToExternalRoadM) })] }));
  assert.equal(est.ok, true, keys(est)); assert.equal(est.record.dependencyRefs[0].attributePath, 'location.distanceToExternalRoadM');
  assert.equal(App.dataTrustView.badge(svc.project(T, est.record, { mode: 'BROKER', access: grant(['provenance.read']) })).includes('Estimado'), true);
});

test('LegacyConfirmedWithoutRecoverableSource: "confirmado" legacy becomes LEGACY_DECLARED / UNRESOLVED, never VERIFIED', () => {
  const r = migrated.repo.current(T, 'LOT', lot().identity.id, 'geometry.areaM2');
  assert.equal(r.provenanceKind, 'LEGACY_DECLARED'); assert.equal(r.evidenceState, 'UNRESOLVED'); assert.equal(r.evidenceRefs.length, 0);
  assert.equal(r.metadata.legacyLabel, 'CONFIRMED'); assert.equal(r.metadata.candidateDocumentId, 'doc_vj_official_plan'); assert.equal(r.metadata.candidateMatchStatus, 'REQUIRES_REVIEW');
  assert.equal(migrated.project(T, r, { mode: 'BROKER', access: grant(['provenance.read']) }).label, 'Informado');
  assert.equal(migrated.project(T, r, { mode: 'TECHNICAL', access: ADMIN }).label, 'Legado — fonte não rastreada');
  const forged = P.createRecord({ ...JSON.parse(JSON.stringify(r)), id: undefined, evidenceState: 'VERIFIED' });
  assert.ok(P.validateRecord(forged, {}).errors.includes('VERIFIED_WITHOUT_EVIDENCE'));
  const rc = migrated.repo.current(T, 'LOT', lots.find(l => (l.provenance['surroundings.rearCondition'] || {}).status === 'TO_CONFIRM').identity.id, 'surroundings.rearCondition');
  assert.equal(rc.currentness, 'REVIEW_REQUIRED'); assert.equal(P.summarize(rc).displayCode, 'REVIEW');
});

test('not available: configured reason vs null without reason (flagged for review, reason not invented)', () => {
  const topo = migrated.repo.current(T, 'LOT', lot().identity.id, 'construction.topography');
  assert.equal(topo.provenanceKind, 'NOT_AVAILABLE'); assert.equal(topo.notAvailableReason, 'SOURCE_NOT_INGESTED'); assert.equal(topo.status, 'ACTIVE');
  const per = migrated.repo.current(T, 'LOT', lot().identity.id, 'geometry.perimeterM');
  assert.equal(per.notAvailableReason, 'UNKNOWN_REASON'); assert.equal(per.status, 'REVIEW_REQUIRED');
  assert.ok(P.validateRecord(per, {}).warnings.includes('NULL_WITHOUT_REASON'));
  assert.equal(migrated.project(T, topo, { mode: 'CLIENT' }).reason, 'fonte ainda não recebida');
  const bad = P.validateRecord(P.createRecord({ organizationId: 'org_house7', entityType: 'LOT', entityId: 'x', attributePath: 'construction.topography', valueFingerprint: P.fingerprint(null), provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', recordedAt: NOW }), {});
  assert.ok(bad.errors.includes('REASON_REQUIRED'));
});

test('ConflictingAreaSources: 250 vs 255 opens a conflict (never resolved silently); agreeing sources make one record', () => {
  const svc = PS.createService({ now: NOW }), id = lot().identity.id;
  const base = svc.record(T, recIn('geometry.areaM2', { provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED', currentness: 'UNKNOWN' }));
  const docA = P.evidence.document({ documentId: 'doc_a', documentVersionId: 'docver_a3', authority: 'OFFICIAL_PRIMARY' }), docB = P.evidence.document({ documentId: 'doc_b', documentVersionId: 'docver_b5', authority: 'OFFICIAL_PRIMARY' });
  const c = svc.reportCandidates(T, { entityType: 'LOT', entityId: id, attributePath: 'geometry.areaM2', developmentId: 'viva-juara', candidates: [{ value: 250, evidenceRefs: [docA], authority: 'OFFICIAL_PRIMARY' }, { value: 255, evidenceRefs: [docB], authority: 'OFFICIAL_PRIMARY' }] });
  assert.equal(c.agreed, false); assert.equal(c.conflict.resolutionStatus, 'OPEN'); assert.equal(c.conflict.selectedCandidateId, null);
  assert.equal(svc.repo.statusOf(T, base.record.id), 'REVIEW_REQUIRED'); assert.equal(svc.events.list({ type: 'ProvenanceConflictDetected' }).length, 1);
  assert.equal(svc.resolveConflict(T, c.conflict.id, { candidateId: c.conflict.candidates[0].candidateId, reason: 'conferido' }, grant(['provenance.read'])).code, 'PROVENANCE_ACCESS_DENIED');
  const res = svc.resolveConflict(T, c.conflict.id, { candidateId: c.conflict.candidates[0].candidateId, reason: 'planta mais recente conferida' }, grant(['provenance.resolveConflict']));
  assert.equal(res.ok, true); assert.equal(res.conflict.resolutionStatus, 'MANUALLY_RESOLVED'); assert.equal(svc.repo.conflictHistory(T, c.conflict.id).length, 2);
  assert.equal(lot().geometry.areaM2, byId.get(id).geometry.areaM2, 'canonical value untouched');
  const ok = svc.reportCandidates(T, { entityType: 'LOT', entityId: id, attributePath: 'geometry.areaM2', developmentId: 'viva-juara', candidates: [{ value: 250, evidenceRefs: [docA] }, { value: 250, evidenceRefs: [docB] }] });
  assert.equal(ok.agreed, true); assert.equal(ok.recordInput.evidenceRefs.length, 2);
  const auth = P.detectConflict({ organizationId: 'o', entityType: 'LOT', entityId: id, attributePath: 'geometry.areaM2', policy: { mode: 'AUTHORITY_ORDER', authorityOrder: ['OFFICIAL_PRIMARY', 'MARKETING'] }, candidates: [{ value: 250, authority: 'MARKETING', evidenceRefs: [docA] }, { value: 251, authority: 'OFFICIAL_PRIMARY', evidenceRefs: [docB] }] });
  assert.equal(auth.conflict.resolutionStatus, 'AUTO_RESOLVED_BY_POLICY');
  assert.equal(P.resolutionPolicy('geometry.areaM2', 'viva-juara').mode, 'NO_AUTO_RESOLUTION', 'default policy never auto-resolves');
});

test('OfficialPlanVersionUpgradeImpact: a new published version flags review for direct and downstream records; nothing recalculated, history kept', () => {
  const { svc, ds, p1, pub } = docWorld({ tag: 'upg' }), id = lot().identity.id;
  const sr = ds.sourceRefFor(T, p1.document.id, p1.version.id, { pageNumber: 1 }).sourceRef;
  const area = svc.record(T, recIn('geometry.areaM2', { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.document(sr)] }));
  const price = svc.record(T, recIn('commercial.price', { provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', methodRef: P.methodRef({ methodId: 'lot_price_per_m2_times_area', methodVersion: '1', methodType: 'FORMULA' }),
    dependencyRefs: ['geometry.areaM2', 'commercial.pricePerM2'].map(p => P.dependencyRef({ organizationId: 'org_house7', entityType: 'LOT', entityId: id, attributePath: p, valueFingerprint: P.fingerprint(P.valueAt(lot(), p)) })) }));
  assert.equal(area.ok && price.ok, true);
  const p2 = pub(pdf('plan v2 upg'), p1.document.id, { from: '2026-11-01' });
  const impact = svc.onDocumentVersionPublished(T, { documentId: p1.document.id, versionId: p2.version.id, metadata: p2.event.metadata });
  assert.equal(impact.directlyAffected, 1); assert.equal(impact.downstreamAffected, 1); assert.equal(impact.recalculated, 0);
  assert.equal(svc.currentnessOf(T, area.record), 'REVIEW_REQUIRED');
  assert.equal(svc.repo.statusOf(T, price.record.id), 'REVIEW_REQUIRED');
  assert.equal(svc.repo.get(T, area.record.id).evidenceRefs[0].documentSourceRef.documentVersionId, p1.version.id, 'old evidence still points to v1 (no retroactive substitution)');
  const fresh = PS.createService({ now: NOW, documents: { service: ds } }); const r2 = fresh.record(T, recIn('geometry.areaM2', { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.document(sr)] }));
  assert.equal(fresh.currentnessOf(T, r2.record), 'SOURCE_SUPERSEDED');
});

test('ScoreLineageThroughAnalysisVersion: scores are ANALYSIS_DERIVED with analysis + methodology versions (estimate semantics)', () => {
  const r = migrated.repo.current(T, 'LOT', lot().identity.id, 'intelligence.scores.overall');
  assert.equal(r.provenanceKind, 'ANALYSIS_DERIVED');
  const a = r.evidenceRefs.find(e => e.type === 'ANALYSIS_RESULT'); assert.equal(a.analysisVersion, '2026-10-06'); assert.equal(a.methodologyVersion, App.methodology.current('viva-juara').methodologyVersion);
  assert.equal(P.summarize(r).displayCode, 'ESTIMATED');
  const tr = PS.fromAnalysisTrace({ value: 69, trace: { moduleId: 'scoring', moduleVersion: '1.0', methodologyVersion: '1.0.0', inputAttributeRefs: [{ organizationId: 'org_house7', entityType: 'LOT', entityId: 'x', attributePath: 'environmental.noiseLevel', valueFingerprint: P.fingerprint('LOW') }] } },
    { organizationId: 'org_house7', developmentId: 'viva-juara', entityId: 'x', attributePath: 'intelligence.scores.overall', estimate: true });
  assert.equal(tr.dependencyRefs.length, 1); assert.equal(P.validateRecord(P.createRecord({ ...tr, recordedAt: NOW }), {}).valid, true);
});

test('RestrictedDocumentSafeProjection: evidence hidden for the viewer, technical state unchanged', () => {
  const { svc, ds, p1 } = docWorld({ classification: 'RESTRICTED', tag: 'rst' });
  const sr = ds.sourceRefFor(T, p1.document.id, p1.version.id, { pageNumber: 2 }).sourceRef;
  const r = svc.record(T, recIn('geometry.areaM2', { provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [P.evidence.document(sr)] })).record;
  const broker = svc.project(T, r, { mode: 'BROKER', access: grant(['provenance.read', 'document.read']) });
  assert.equal(broker.sources[0].visibility, 'HIDDEN'); assert.equal(broker.summary.evidenceState, 'VERIFIED'); assert.equal(broker.displayCode, 'CONFIRMED');
  assert.ok(!keys(broker).includes(p1.document.id));
  const tech = svc.project(T, r, { mode: 'TECHNICAL', access: grant(['provenance.technical.read', 'document.read']) });
  assert.equal(tech.sources[0].visibility, 'HIDDEN', 'technical permission on provenance does not open a restricted document');
  const full = svc.project(T, r, { mode: 'TECHNICAL', access: grant(['provenance.technical.read', 'document.read', 'document.read.restricted']) });
  assert.equal(full.sources[0].documentId, p1.document.id);
  assert.equal(svc.project(T, r, { mode: 'TECHNICAL', access: grant(['provenance.read']) }).code, 'PROVENANCE_ACCESS_DENIED');
  assert.equal(svc.project(T, r, { mode: 'BROKER', access: grant([]) }).code, 'PROVENANCE_ACCESS_DENIED', 'deny by default');
});

test('fingerprint mismatch, history and manual assertion/override discipline', () => {
  const svc = PS.createService({ now: NOW }), id = lot().identity.id;
  const r = svc.record(T, recIn('surroundings.viewType', { provenanceKind: 'ESTIMATED', evidenceState: 'PARTIAL', methodRef: P.methodRef({ methodId: 'analysis_model', methodVersion: '2026-10-06', methodType: 'ESTIMATION' }) }));
  const changed = { ...lot(), surroundings: { ...lot().surroundings, viewType: 'OUTRO' } };
  const chk = svc.checkValue(T, 'LOT', changed, 'surroundings.viewType'); assert.equal(chk.code, 'PROVENANCE_VALUE_MISMATCH'); assert.equal(svc.repo.statusOf(T, r.record.id), 'REVIEW_REQUIRED');
  assert.equal(svc.record(T, recIn('surroundings.viewType', { provenanceKind: 'ESTIMATED', evidenceState: 'PARTIAL' }), { entity: changed }).code, 'PROVENANCE_VALUE_MISMATCH');
  assert.equal(svc.assertManual(T, { entityType: 'LOT', entityId: id, attributePath: 'construction.topography', developmentId: 'viva-juara', value: 'PLANO', reasonCode: 'VISITA' }, grant(['provenance.read'])).code, 'PROVENANCE_ACCESS_DENIED');
  const m1 = svc.assertManual(T, { entityType: 'LOT', entityId: id, attributePath: 'construction.topography', developmentId: 'viva-juara', value: 'PLANO', reasonCode: 'VISITA', notes: 'nota interna' }, grant(['provenance.override']));
  assert.equal(m1.ok, true, keys(m1)); assert.equal(m1.record.provenanceKind, 'MANUAL_ASSERTION'); assert.equal(m1.record.evidenceState, 'UNRESOLVED');
  assert.ok(!keys(svc.project(T, m1.record, { mode: 'TECHNICAL', access: ADMIN })).includes('nota interna'), 'assertion notes never in projections');
  assert.equal(svc.assertManual(T, { entityType: 'LOT', entityId: id, attributePath: 'commercial.price', developmentId: 'viva-juara', value: 1, reasonCode: 'X' }, grant(['provenance.override'])).code, 'KIND_NOT_ALLOWED');
  assert.equal(svc.override(T, { ...recIn('geometry.areaM2', {}), provenanceKind: 'MANUAL_OVERRIDE', evidenceState: 'UNRESOLVED', reasonCode: 'X' }, ADMIN).code, 'KIND_NOT_ALLOWED', 'overrides are off unless the field policy allows');
  const m2 = svc.assertManual(T, { entityType: 'LOT', entityId: id, attributePath: 'construction.topography', developmentId: 'viva-juara', value: 'ACLIVE', reasonCode: 'LEVANTAMENTO' }, grant(['provenance.override']));
  const h = svc.repo.history(T, 'LOT', id, 'construction.topography');
  assert.equal(h.length, 2); assert.equal(h[0].status, 'SUPERSEDED'); assert.equal(m2.record.supersedesProvenanceId, m1.record.id);
});

test('adapters: Pricing (PriceTableVersion evidence, reproducible formula) and Availability (UNKNOWN never AVAILABLE)', () => {
  const id = lot().identity.id;
  const ppm = migrated.repo.current(T, 'LOT', id, 'commercial.pricePerM2');
  assert.equal(ppm.provenanceKind, 'DIRECT_SOURCE'); assert.equal(ppm.evidenceState, 'PARTIAL'); assert.equal(ppm.evidenceRefs[0].recordType, 'PriceTableVersion');
  assert.equal(P.summarize(ppm).displayCode, 'INFORMED');
  const price = migrated.repo.current(T, 'LOT', id, 'commercial.price');
  assert.equal(price.provenanceKind, 'CALCULATED'); assert.equal(price.metadata.reproducible, true); assert.equal(price.dependencyRefs.length, 2);
  assert.ok(lots.every(l => migrated.repo.current(T, 'LOT', l.identity.id, 'commercial.price').metadata.reproducible), 'price = area × R$/m² for all 498 lots');
  const st = migrated.repo.current(T, 'LOT', id, 'availability.status');
  assert.equal(st.provenanceKind, 'NOT_AVAILABLE'); assert.equal(st.notAvailableReason, 'SOURCE_NOT_INGESTED'); assert.equal(st.valueFingerprint, P.fingerprint('UNKNOWN'));
  assert.ok(PS.availabilityAdapter.supports('LOT', 'availability.status')); assert.ok(!PS.pricingAdapter.supports('LOT', 'availability.status'));
});

test('no numeric confidence in provenance; topic-34 input contract is structural only', () => {
  const r = migrated.repo.current(T, 'LOT', lot().identity.id, 'commercial.price');
  const s = P.summarize(r), ci = migrated.confidenceInputs(T, 'LOT', lot().identity.id, 'commercial.price');
  for (const o of [s, ci]) for (const [k, v] of Object.entries(o)) assert.ok(!/score|confidence/i.test(k), k);
  assert.equal(ci.methodType, 'FORMULA'); assert.equal(ci.dependencyCount, 2);
});

test('legacy migration: zero-delta, deterministic, every tracked attribute of all 498 lots, no legacy "confirmado" turned verified', () => {
  assert.deepEqual(App.provenanceMigration.zeroDelta(before, lots), { ok: true, changedLots: 0 });
  const again = App.provenanceMigration.migrateLots(lots.slice(0, 5), 'viva-juara');
  for (const r of again.records) assert.equal(migrated.repo.get(T, r.id).id, r.id, 'same input → same record id');
  const { report } = App.provenanceMigration.migrateLots(lots.slice(0, 2), 'viva-juara');
  assert.equal(report.verifiedFromLegacyConfirmed, 0);
  const man = migrated.manifest(T, 'viva-juara');
  assert.equal(man.entityCount, 498); assert.equal(man.attributeRecordCount, 498 * P.pathRegistry.tracked().length); assert.equal(man.conflictedCount, 0);
  const diag = migrated.diagnostics(T, 'viva-juara', { entities: byId });
  assert.equal(diag.valueFingerprintMismatches, 0); assert.equal(diag.brokenDependencyRefs, 0); assert.equal(diag.openConflicts, 0);
  const cov = migrated.coverage(T, 'viva-juara'); assert.ok(cov.byKind.LEGACY_DECLARED > 0); assert.match(cov.note, /Não é score de confiança/);
  assert.equal(migrated.repo.current(T, 'LOT', lot().identity.id, 'identity.developmentId').evidenceState, 'VERIFIED', 'config facts are verifiable');
});

test('tenant isolation, batch query and cache', () => {
  const other = { organizationId: 'org_other' };
  assert.equal(migrated.repo.current(other, 'LOT', lot().identity.id, 'geometry.areaM2'), null);
  const foreign = migrated.record(T, { ...recIn('geometry.areaM2', { provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED' }), organizationId: 'org_other' });
  assert.equal(foreign.code, 'TENANT_MISMATCH');
  const dep = P.validateRecord(P.createRecord({ ...recIn('commercial.price', {}), organizationId: 'org_house7', provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', recordedAt: NOW, methodRef: P.methodRef({ methodId: 'lot_price_per_m2_times_area', methodVersion: '1', methodType: 'FORMULA' }),
    dependencyRefs: [P.dependencyRef({ organizationId: 'org_other', entityType: 'LOT', entityId: 'x', attributePath: 'geometry.areaM2', valueFingerprint: P.fingerprint(1) })] }), {});
  assert.ok(dep.errors.includes('TENANT_MISMATCH'), 'no cross-tenant dependency');
  const ids = lots.slice(0, 3).map(l => l.identity.id);
  const b = migrated.batchQuery(T, { entityType: 'LOT', entityIds: ids, attributePaths: ['geometry.areaM2', 'commercial.price'] });
  assert.equal(Object.keys(b).length, 3); assert.equal(b[ids[0]]['commercial.price'].summary.displayCode, 'CALCULATED');
  const c = PS.createCache(); c.set(c.key('org_house7', 'LOT', 'a', 'p', 'S', 1), 1); c.set(c.key('org_other', 'LOT', 'a', 'p', 'S', 1), 2); c.clearOrganization('org_other'); assert.equal(c.size(), 1);
  const snap = migrated.snapshot(T, { entityRefs: [{ entityType: 'LOT', entityId: ids[0] }], attributePaths: ['commercial.price'], purpose: 'SHARE', dataVersionRefs: [P.dataVersionRef('PRICE_TABLE_VERSION', '2026-10-06')] });
  assert.equal(snap.provenanceIds.length, 1); assert.match(snap.checksum, /^sha256:/);
});
