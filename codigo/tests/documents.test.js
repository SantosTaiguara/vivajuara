'use strict';
// Topic 32 — documents as entities: integrity, legacy catalog, ingestion → validation → publication, immutability,
// version resolution, tenant isolation, access/search leak, download tokens, retention, snapshots and view models.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { load, SRC } = require('./harness.js');
const MODULES = ['documents/integrity.js', 'documents/documentDomain.js', 'documents/documentServices.js'];
const loadAll = (extra = []) => { const App = load(); for (const f of [...MODULES, ...extra]) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App); return App; };

let App, D, DS;
const T = { organizationId: 'org_house7', activeDevelopmentId: 'viva-juara' };
const OTHER = { organizationId: 'org_other', activeDevelopmentId: null };
const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const grant = (keys, mode = 'BROKER', org = 'org_house7') => ({ organizationId: org, principalId: 'u_test', mode, can: k => keys === '*' || keys.includes(k) });
const ADMIN = grant('*', 'TECHNICAL');
const pdf = s => new TextEncoder().encode('%PDF-1.7\n' + s + '\n%%EOF');
const planDoc = { documentType: 'OFFICIAL_PLAN', title: 'Planta teste', description: 'Quadro de áreas', classification: 'ORGANIZATION_INTERNAL', authority: 'OFFICIAL_PRIMARY', scope: { scopeType: 'DEVELOPMENT' } };
const mkService = (o = {}) => { let clock = NOW; const svc = DS.createService({ now: () => clock, scanner: () => 'CLEAN', extractor: () => ({ status: 'SUCCEEDED', text: 'Quadro de áreas: lote 327 com área de 250,00 m²', extractorId: 'text', extractorVersion: '1', method: 'TEXT_LAYER' }), ...o }); return Object.assign(Object.create(svc), { tick: ms => { clock += ms; } }); };
function publishNew(svc, bytes, extra = {}) {
  const b = svc.ingest(T, { origin: 'UPLOAD', developmentId: 'viva-juara', items: [{ bytes, filename: 'planta.pdf', declaredMediaType: 'application/pdf', issuedAt: '2026-10-01', sourceEffectiveFrom: extra.from || '2026-10-01', ...(extra.documentId ? { documentId: extra.documentId } : { newDocument: { ...planDoc, ...(extra.doc || {}) } }) }] }, ADMIN);
  const it = b.batch.items[0]; assert.equal(it.status, 'READY_FOR_REVIEW', JSON.stringify(it));
  assert.equal(svc.validateVersion(T, it.versionId, ADMIN).ok, true);
  const p = svc.publish(T, it.documentId, it.versionId, ADMIN); assert.equal(p.ok, true, JSON.stringify(p)); return p;
}

test.before(() => { App = loadAll(); D = App.documents; DS = App.documentServices; });

test('integrity: sha256 matches node crypto, canonical fingerprints are order-independent and null is explicit', () => {
  const I = App.integrity;
  for (const s of ['', 'abc', 'ç'.repeat(300), 'x'.repeat(10000)]) assert.equal(I.sha256(s), crypto.createHash('sha256').update(s).digest('hex'));
  assert.equal(I.fingerprint({ a: 1, b: [1, 2] }), I.fingerprint({ b: [1, 2], a: 1 }));
  assert.notEqual(I.fingerprint(null), I.fingerprint(0)); assert.notEqual(I.fingerprint(null), I.fingerprint(''));
  assert.equal(I.detectMediaType(pdf('x')).mediaType, 'application/pdf');
  assert.equal(I.detectMediaType(new TextEncoder().encode('<svg onload=1>')).scriptable, true);
  assert.equal(I.stableId('p', 'a', 1), I.stableId('p', 'a', 1));
});

test('legacy catalog: 10 inventoried documents, nothing published, official plan only a candidate (REQUIRES_REVIEW)', () => {
  const svc = mkService(), r = DS.seedLegacy(svc, 'viva-juara');
  assert.equal(r.ok, true); assert.equal(r.documents.length, 10); assert.equal(r.report.published, 0);
  const plan = svc.repo.getDocument(T, 'doc_vj_official_plan');
  assert.equal(plan.authority, 'OFFICIAL_PRIMARY'); assert.equal(plan.currentPublishedVersionId, null);
  const v = svc.repo.getVersion(T, 'docver_vj_official_plan_v1'); assert.equal(v.lifecycleStatus, 'UPLOADED');
  const a = svc.repo.getAsset(T, v.primaryFileAssetId); assert.equal(a.storageProvider, 'EXTERNAL_REFERENCE'); assert.equal(a.securityScanStatus, 'NOT_SCANNED');
  assert.ok(r.report.pendingLegacyMatches.some(x => x.legacySourceId === 'official-plan-v1'));
  assert.deepEqual([...r.report.withoutFile].sort(), ['doc_vj_launch_event', 'doc_vj_price_table_2026_10']);
  assert.deepEqual([...r.report.methodsNotDocuments], ['plan-geometry-v1', 'analysis-v1', 'solar-model-v1']);
  // derived representations are never authoritative
  for (const d of r.documents) for (const ver of svc.repo.listVersions(T, d.id)) for (const rep of svc.repo.listRepresentations(T, ver.id)) assert.equal(rep.authoritative, false);
  // an unpublished official plan cannot be published from an external reference without scan + managed copy
  svc.validateVersion(T, 'docver_vj_official_plan_v1', ADMIN);
  const pub = svc.publish(T, 'doc_vj_official_plan', 'docver_vj_official_plan_v1', ADMIN);
  assert.equal(pub.ok, false); assert.ok(['SECURITY_SCAN_FAILED', 'VERSION_CONFLICT'].includes(pub.code));
  assert.equal(svc.repo.getDocument(T, 'doc_vj_official_plan').currentPublishedVersionId, null);
});

test('ingest → validate → publish; a second version supersedes the first and the event carries previousVersionId', () => {
  const svc = mkService(), p1 = publishNew(svc, pdf('v1'));
  assert.equal(p1.version.lifecycleStatus, 'PUBLISHED'); assert.equal(p1.document.currentPublishedVersionId, p1.version.id);
  svc.tick(86400000);
  const p2 = publishNew(svc, pdf('v2'), { documentId: p1.document.id, from: '2026-11-01' });
  assert.equal(p2.supersededVersionId, p1.version.id); assert.equal(svc.repo.getVersion(T, p1.version.id).lifecycleStatus, 'SUPERSEDED');
  assert.equal(p2.event.metadata.previousVersionId, p1.version.id);
  // resolution modes
  assert.equal(svc.resolveVersion(T, { documentId: p1.document.id }, ADMIN).version.id, p2.version.id);
  assert.equal(svc.resolveVersion(T, { documentId: p1.document.id, asOf: '2026-10-15' }, ADMIN).version.id, p1.version.id);
  assert.equal(svc.resolveVersion(T, { documentId: p1.document.id, explicitVersionId: p1.version.id }, ADMIN).version.id, p1.version.id);
  // exact source ref for topic 33
  const sr = svc.sourceRefFor(T, p1.document.id, p1.version.id, { pageNumber: 1 }); assert.equal(sr.ok, true); assert.equal(sr.sourceRef.documentVersionId, p1.version.id);
  assert.equal(svc.sourceRefFor(T, p1.document.id, p1.version.id, { cellRange: 'F3' }).ok, false, 'cellRange without sheetName is invalid');
});

test('published content is immutable; only operational metadata changes', () => {
  const svc = mkService(), p = publishNew(svc, pdf('imm'));
  const bad = svc.repo.putVersion(T, D.createVersion({ ...JSON.parse(JSON.stringify(p.version)), contentChecksum: 'sha256:00' }));
  assert.equal(bad.code, 'PUBLISHED_VERSION_IMMUTABLE');
  assert.equal(svc.repo.setOperational(T, p.version.id, { indexStatus: 'REINDEXED' }).ok, true);
  const r1 = svc.search.record(T, p.version.id).indexVersion; svc.reindex(T, p.document.id, p.version.id);
  assert.equal(svc.search.record(T, p.version.id).indexVersion, r1 + 1, 'reindex never creates a document version');
  assert.equal(svc.repo.listVersions(T, p.document.id).length, 1);
});

test('duplicates and identity: exact duplicate rejected, filename alone never matches an existing document', () => {
  const svc = mkService(), p = publishNew(svc, pdf('dup'));
  const again = svc.ingest(T, { developmentId: 'viva-juara', items: [{ bytes: pdf('dup'), filename: 'planta.pdf', documentId: p.document.id }] }, ADMIN);
  assert.equal(again.batch.items[0].status, 'REJECTED'); assert.ok(again.batch.items[0].errors.includes('DUPLICATE_VERSION'));
  const byName = svc.ingest(T, { developmentId: 'viva-juara', items: [{ bytes: pdf('other'), filename: 'planta.pdf' }] }, ADMIN);
  assert.equal(byName.batch.items[0].status, 'READY_FOR_REVIEW'); assert.ok(byName.batch.items[0].warnings.some(w => /NO_STABLE_IDENTIFIER/.test(w)));
  assert.equal(byName.batch.items[0].versionId, null);
});

test('security: malicious upload is quarantined and cannot be published; scriptable content and media mismatch fail validation', () => {
  const svc = mkService({ scanner: () => 'MALICIOUS' });
  const b = svc.ingest(T, { developmentId: 'viva-juara', items: [{ bytes: pdf('bad'), filename: 'x.pdf', declaredMediaType: 'application/pdf', newDocument: planDoc }] }, ADMIN);
  const it = b.batch.items[0]; assert.equal(it.status, 'QUARANTINED');
  assert.equal(svc.repo.getVersion(T, it.versionId).lifecycleStatus, 'REJECTED');
  assert.equal(svc.publish(T, it.documentId, it.versionId, ADMIN).ok, false);
  const pol = D.filePolicy('viva-juara');
  assert.ok(D.checkFile({ mediaType: 'image/png', sizeBytes: 10, securityScanStatus: 'CLEAN' }, pol, { bytes: new TextEncoder().encode('<svg/>') }).errors.includes('SCRIPTABLE_CONTENT'));
  assert.ok(D.checkFile({ mediaType: 'image/png', sizeBytes: 10, securityScanStatus: 'CLEAN' }, pol, { bytes: pdf('p') }).errors.includes('MEDIA_TYPE_MISMATCH'));
  assert.equal(svc.ingest(T, { items: [] }, grant([])).code, 'DOCUMENT_ACCESS_DENIED', 'upload needs document.upload');
});

test('tenant isolation: foreign documents are "not found", relations across tenants are denied', () => {
  const svc = mkService(), p = publishNew(svc, pdf('iso'));
  assert.equal(svc.getDocument(OTHER, p.document.id, grant('*', 'TECHNICAL', 'org_other')).code, 'DOCUMENT_NOT_FOUND');
  assert.equal(svc.getDocument(T, p.document.id, grant('*', 'TECHNICAL', 'org_other')).code, 'DOCUMENT_NOT_FOUND', 'access of another org on this tenant: hidden');
  assert.equal(svc.relate(T, { documentId: p.document.id, relationType: 'APPLIES_TO', targetType: 'DEVELOPMENT', targetId: 'viva-juara', targetOrganizationId: 'org_other' }, ADMIN).code, 'CROSS_TENANT_RELATION');
  assert.equal(svc.relate(T, { documentId: p.document.id, relationType: 'APPLIES_TO', targetType: 'DEVELOPMENT', targetId: 'viva-juara' }, ADMIN).ok, true);
  assert.deepEqual(svc.searchDocuments(OTHER, { text: 'planta' }, grant('*', 'TECHNICAL', 'org_other')), []);
});

test('access and search leak: restricted documents are invisible without permission (no title, snippet or count); client sees only published public', () => {
  const svc = mkService(), pub = publishNew(svc, pdf('internal'));
  const res = publishNew(svc, pdf('restricted'), { doc: { title: 'Parecer restrito', classification: 'RESTRICTED', documentCode: 'RST-1' } });
  const broker = grant(['document.read', 'document.download']);
  const hits = svc.searchDocuments(T, { text: 'area', mode: 'HYBRID' }, broker);
  assert.ok(hits.some(h => h.documentId === pub.document.id)); assert.ok(!hits.some(h => h.documentId === res.document.id));
  assert.equal(svc.getDocument(T, res.document.id, broker).code, 'DOCUMENT_NOT_FOUND', 'RESTRICTED hides existence');
  assert.equal(svc.getDocument(T, res.document.id, grant(['document.read', 'document.read.restricted'])).ok, true);
  assert.equal(D.decide(pub.document, { access: { ...broker, mode: 'CLIENT' } }).allowed, false, 'internal is not client-safe');
  const pubDoc = publishNew(svc, pdf('folder'), { doc: { documentType: 'MARKETING_MATERIAL', title: 'Folder', classification: 'PUBLIC', authority: 'MARKETING' } });
  assert.equal(D.decide(pubDoc.document, { access: { ...broker, mode: 'CLIENT' } }).allowed, true);
  const pkg = svc.clientPackage(T, [pub.document.id, pubDoc.document.id, res.document.id], broker);
  assert.equal(pkg.snapshot.documentVersionRefs.length, 1); assert.equal(pkg.excludedCount, 2);
});

test('download: authorized short-lived token, expiry enforced, external references are never downloadable, events carry no content', () => {
  const svc = mkService(), p = publishNew(svc, pdf('dl'));
  const r = svc.requestDownload(T, p.document.id, null, grant(['document.read', 'document.download']));
  assert.equal(r.ok, true); assert.ok(!r.url.includes(p.version.primaryFileAssetId), 'no storage key in the URL');
  assert.equal(svc.storage.redeem(T, r.token, { now: NOW + 1000 }).ok, true);
  assert.equal(svc.storage.redeem(T, r.token, { now: NOW + 3600000 }).code, 'SIGNED_URL_EXPIRED');
  assert.equal(svc.requestDownload(T, p.document.id, null, grant(['document.read'])).code, 'DOCUMENT_ACCESS_DENIED');
  const seeded = mkService(); DS.seedLegacy(seeded, 'viva-juara');
  assert.equal(seeded.requestDownload(T, 'doc_vj_official_plan', 'docver_vj_official_plan_v1', ADMIN).ok, false);
  for (const e of svc.events.list()) assert.ok(!JSON.stringify(e).includes('%PDF'));
});

test('retention: published or referenced versions cannot be hard-deleted; archive keeps history', () => {
  const svc = mkService(), p = publishNew(svc, pdf('ret'));
  assert.equal(svc.repo.deleteVersion(T, p.version.id).code, 'RETENTION_POLICY_BLOCKED');
  const b = svc.ingest(T, { developmentId: 'viva-juara', items: [{ bytes: pdf('staged'), documentId: p.document.id }] }, ADMIN);
  assert.equal(svc.repo.deleteVersion(T, b.batch.items[0].versionId, { referencedBy: ['prov_x'] }).code, 'RETENTION_POLICY_BLOCKED');
  assert.equal(svc.archive(T, p.document.id, ADMIN).ok, true);
  assert.equal(svc.repo.getVersion(T, p.version.id).lifecycleStatus, 'PUBLISHED', 'archiving the document keeps the version');
});

test('snapshots and generated documents point to exact versions; source cycles are rejected', () => {
  const svc = mkService(), a = publishNew(svc, pdf('a')), b = publishNew(svc, pdf('b'), { doc: { title: 'Planta B', documentCode: 'B' } });
  const s = svc.createSnapshot(T, [{ documentId: a.document.id, documentVersionId: a.version.id }], 'REPORT');
  const g = svc.createGeneratedDocument(T, { title: 'Relatório', developmentId: 'viva-juara', snapshotId: s.snapshot.snapshotId }, ADMIN);
  assert.equal(g.ok, true); assert.equal(g.relations[0].targetId, a.version.id);
  assert.equal(svc.relate(T, { documentId: b.document.id, relationType: 'DERIVED_FROM', targetType: 'DOCUMENT', targetId: a.document.id }, ADMIN).ok, true);
  assert.equal(svc.relate(T, { documentId: a.document.id, relationType: 'DERIVED_FROM', targetType: 'DOCUMENT', targetId: b.document.id }, ADMIN).code, 'RELATION_CYCLE');
});

test('view models and DTOs: related documents for the development, no storage keys in DTOs, tenant-namespaced cache', () => {
  const svc = mkService(); DS.seedLegacy(svc, 'viva-juara');
  const rel = DS.relatedDocuments(svc, T, { targetType: 'DEVELOPMENT', targetId: 'viva-juara' }, grant(['document.read', 'document.manage'], 'TECHNICAL'));
  assert.ok(rel.count >= 8); assert.match(rel.label, /^Documentos relacionados \(\d+\)$/);
  const none = DS.relatedDocuments(svc, T, { targetType: 'DEVELOPMENT', targetId: 'viva-juara' }, grant([]));
  assert.equal(none.count, 0);
  const det = DS.detailViewModel(svc, T, 'doc_vj_official_plan', grant(['document.read', 'document.manage'], 'TECHNICAL'));
  assert.equal(det.ok, true); assert.equal(det.vm.currentVersion, null);
  const dto = DS.toVersionDto(svc.repo.getVersion(T, 'docver_vj_official_plan_v1')); assert.ok(!('storageKey' in dto));
  const c = DS.createMetadataCache(); c.set(c.key('org_house7', 'd', 'v', 1), 1); c.set(c.key('org_other', 'd', 'v', 1), 2); c.clearOrganization('org_house7');
  assert.equal(c.size(), 1);
});
