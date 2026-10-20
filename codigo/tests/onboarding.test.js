'use strict';
// Topic 58 — development onboarding / ingestion pipeline. Golden scenarios named after §336 of the spec.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { load, SRC, DATA } = require('./harness.js');

const FILES = ['config/onboarding/onboardingPolicy.js', 'onboarding/onboardingModel.js', 'onboarding/sourceIntake.js', 'onboarding/parsers.js', 'onboarding/mapping.js', 'onboarding/canonical.js',
  'onboarding/geometryIngest.js', 'onboarding/commercialImport.js', 'onboarding/quality.js', 'onboarding/publication.js', 'onboarding/orchestrator.js', 'onboarding/onboardingView.js'];
let App, O, repoLots, dev;
const lotsPath = path.join(DATA, 'lots.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const lotsChecksumBefore = sha(fs.readFileSync(lotsPath));
test.before(async () => {
  App = load();
  for (const f of FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  O = App.onboarding;
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); repoLots = repo.lotsSync();
  dev = App.repos.DevelopmentRepository.getDevelopment('viva-juara');
});
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
const ORG = 'org_house7';
const ALL = () => Object.values(O.orchestrator.PERM);
const person = (id, perms = ALL(), org = ORG) => ({ id, organizationId: org, permissions: perms });
const op = () => person('u_operator'), approver = () => person('u_publisher');
function workspace(extra = {}) { let t = 0; return O.orchestrator.createWorkspace({ organizationId: ORG, clock: () => new Date(Date.UTC(2026, 9, 17, 12, 0, t++)).toISOString(), scanner: { scan: ({ bytes }) => ({ verdict: Buffer.from(bytes).includes('EICAR') ? 'INFECTED' : 'CLEAN', engine: 'fake' }) }, ...extra }); }
function newCase(ws, o = {}) { const r = ws.createCase(op(), { name: 'Teste', code: o.code || 'TS', timezone: 'America/Sao_Paulo', developmentType: 'LOT_SUBDIVISION', organizationId: ORG, developmentId: o.developmentId || 'teste', lotCountExpected: o.lotCountExpected }); assert.ok(r.ok, r.code); return r.value; }
/** upload + confirm the given mappings (or every suggestion) */
function source(ws, c, f, rules) {
  const s = ws.uploadSource(op(), c.id, f); assert.ok(s.ok, `${s.code} ${s.details}`);
  const d = ws.discover(op(), s.value.id); assert.ok(d.ok, d.code);
  const set = ws.mappingSet(op(), s.value.id).value;
  const upsert = (rules || d.value.suggestions).map(x => ({ ...x, confidence: 'CONFIRMED' }));
  const u = ws.updateMappings(op(), s.value.id, { upsert }, set.revision); assert.ok(u.ok, u.code);
  return s.value;
}
const csv = s => new Uint8Array(Buffer.from(s, 'utf8'));
const LOT_CSV = 'quadra;lote;area\nA;1;250,00\nA;2;260,50\nB;1;300\n';
const sq = (x, y) => (x += 500, y += 500, [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]);
const geo = feats => csv(JSON.stringify({ type: 'FeatureCollection', features: feats.map(([id, q, l, ring]) => ({ type: 'Feature', id, properties: { quadra: q, lote: l }, geometry: { type: 'Polygon', coordinates: [ring] } })) }));
const GEO_OK = () => geo([['f1', 'A', 1, sq(0, 0)], ['f2', 'A', 2, sq(20, 0)], ['f3', 'B', 1, sq(40, 0)]]);
const geoRules = [{ sourceField: 'quadra', targetFieldKey: 'identity.blockId' }, { sourceField: 'lote', targetFieldKey: 'identity.lotNumber' }, { sourceField: '$geometry', targetFieldKey: 'geometry.polygon', transformId: 'polygonPoints' }];
function cleanSetup(ws, o = {}) {
  const c = newCase(ws, o);
  const lots = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'lotes.csv', bytes: csv(o.lotCsv || LOT_CSV) });
  const g = source(ws, c, { sourceType: 'GEOJSON', purpose: 'GEOMETRY', filename: 'lotes.geojson', bytes: o.geo || GEO_OK(), metadata: { coordinateReference: 'PIXEL_SPACE/plan' } }, geoRules);
  ws.declareAuthority(op(), c.id, { domain: 'LOT_IDENTITY', sourceAssetId: lots.id, authorityLevel: 'PRIMARY' });
  ws.declareAuthority(op(), c.id, { domain: 'GEOMETRY', sourceAssetId: g.id, authorityLevel: 'PRIMARY' });
  return { c, lots, g, ids: [lots.id, g.id] };
}
const run = (ws, c, ids, opts = {}) => { const b = ws.createBatch(op(), c.id, { sourceAssetIds: ids, batchType: opts.batchType }); assert.ok(b.ok, b.code); const r = ws.runBatch(op(), b.value.id, { runMode: 'BUILD_CANDIDATE', ...opts }); assert.ok(r.ok, `${r.code} ${r.details}`); return { b: b.value, r, run: r.value }; };
const failing = q => q.checks.filter(x => x.result === 'FAIL').map(x => x.code);

// ------------------------------------------------------------------ golden: current 498 lots keep their ids
test('golden: the 498 published Viva Juara lots map to exactly the same canonical ids (deterministic, reimport-stable)', () => {
  const ws = workspace(), c = newCase(ws, { code: 'VJ', developmentId: 'viva-juara', lotCountExpected: 498 });
  const bytes = new Uint8Array(fs.readFileSync(lotsPath));
  const s = source(ws, c, { sourceType: 'OTHER', purpose: 'LOT_MASTER', filename: 'lots.json', bytes, metadata: { coordinateReference: 'PIXEL_SPACE/plan' } },
    [{ sourceField: 'q', targetFieldKey: 'identity.blockId' }, { sourceField: 'n', targetFieldKey: 'identity.lotNumber' }, { sourceField: 'a', targetFieldKey: 'geometry.areaM2' }, { sourceField: 'did', targetFieldKey: 'identity.id' }, { sourceField: 'p', targetFieldKey: 'geometry.polygon' }]);
  const { run: r1, b, r } = run(ws, c, [s.id], { bounds: { minX: 0, minY: 0, maxX: dev.map.width, maxY: dev.map.height }, dev, existingLots: O.canonical.existingFromLots(repoLots) });
  const ids = r1.dataset.drafts.map(d => d.canonicalLotId);
  assert.equal(ids.length, 498); assert.equal(new Set(ids).size, 498);
  deq(ids.slice().sort(), repoLots.map(l => l.identity.id).sort(), 'same ids as the published repository');
  const raw = JSON.parse(fs.readFileSync(lotsPath, 'utf8'));
  raw.forEach((x, i) => assert.equal(O.canonical.canonicalLotId({ developmentCode: 'VJ', blockCode: x.q, lotNumber: x.n }).id, x.did, `row ${i}`));
  assert.ok(r1.dataset.identityMatches.matches.every(m => m.matchType === 'EXACT'));
  assert.equal(r1.quality.summary.blockers, 0); assert.equal(r1.quality.summary.status, 'PASS');
  assert.equal(r1.dataset.geometry.descriptor.crs.type, 'PIXEL_SPACE', 'plan coordinates stay pixel space');
  assert.equal(r1.artifacts.manifest.coordinateReference.type, 'PIXEL_SPACE'); assert.equal(r1.artifacts.manifest.coordinateReference.epsgCode, undefined, 'never fake WGS84');
  assert.equal(r1.dataset.geometry.match.matches.length, 498);
  assert.ok(r.candidate, 'candidate built');
  // same sources + same mapping + same pipeline → duplicate batch detected before processing
  const again = ws.createBatch(op(), c.id, { sourceAssetIds: [s.id] });
  assert.equal(again.code, 'BATCH_DUPLICATE'); assert.equal(again.refs.batchId, b.id);
  assert.equal(sha(fs.readFileSync(lotsPath)), lotsChecksumBefore, 'published data never changes');
  assert.match(App.onboardingView.preview(r1), /DADOS NÃO PUBLICADOS/);
});
test('canonical id rule: zero-padded, letter or digit blocks, non-integer lot never gets an id', () => {
  const id = x => O.canonical.canonicalLotId({ developmentCode: 'VJ', ...x });
  assert.equal(id({ blockCode: 'Q', lotNumber: 7 }).id, 'VJ-QQ-L0007');
  assert.equal(id({ blockCode: '012', lotNumber: 327 }).id, 'VJ-Q012-L0327');
  assert.equal(id({ blockCode: 'A', lotNumber: '327A' }).id, null);
  assert.equal(O.mapping.createTransformRegistry().get('normalizeBlockCode').fn('Quadra a').value, 'A');
  assert.equal(O.mapping.createTransformRegistry().get('normalizeLotCode').fn('0327').value, 327);
});

// ------------------------------------------------------------------ §336 golden scenarios
test('OnboardingCleanDevelopment: lot master + geometry + pricing + availability + documents → zero blockers, candidate created', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws, { lotCountExpected: 3 });
  const pr = source(ws, c, { sourceType: 'CSV', purpose: 'PRICING', filename: 'precos.csv', bytes: csv('quadra;lote;preco\nA;1;R$ 299.000,00\nA;2;311.558,00\nB;1;358.800,00\n') });
  const av = source(ws, c, { sourceType: 'CSV', purpose: 'AVAILABILITY', filename: 'status.csv', bytes: csv('quadra;lote;status\nA;1;DISPONIVEL\nA;2;VENDIDO\nB;1;RESERVADO\n') });
  const doc = ws.uploadSource(op(), c.id, { sourceType: 'PDF', purpose: 'REGULATION', filename: 'regulamento.pdf', bytes: csv('%PDF-1.4 regulamento'), extracted: { facts: [{ fieldKey: 'construction.frontSetbackM', value: 5, location: 'page:7' }] } });
  assert.ok(doc.ok);
  const { run: r, r: res } = run(ws, c, [...ids, pr.id, av.id, doc.value.id], { proposedPriceTableVersion: 'tabela-teste-1', initialAvailability: true });
  deq(failing(r.quality), [], 'all mappings valid, no failing check');
  assert.equal(r.quality.summary.blockers, 0);
  assert.ok(res.candidate && res.candidate.status === 'CANDIDATE');
  const pc = r.commands.find(x => x.domain === 'PRICING'), ac = r.commands.find(x => x.domain === 'AVAILABILITY');
  assert.equal(pc.touchesLotIdentity, false); assert.equal(ac.bypassesStateMachine, false); assert.equal(ac.command, 'SEED_INITIAL_REVISION');
  deq(r.dataset.prices.candidates.map(x => x.listPriceMinor), [29900000, 31155800, 35880000], 'minor units');
  assert.equal(r.dataset.documentExtractions[0].extractedFacts[0].legalInterpretation, false);
  assert.ok(r.reviews.some(x => x.category === 'DOCUMENT_EXTRACTION'), 'extracted facts are reviewed');
  const p = ws.progress(op(), r.batchId).value; assert.ok(p.completedStages.includes('PARSE') && p.currentStageProgress === undefined);
});
test('OnboardingDuplicateLotDetected: two rows map to the same canonical lot → BLOCKING', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws, { lotCsv: LOT_CSV + 'A;01;250\n' });
  const { run: r, r: res } = run(ws, c, ids);
  assert.ok(failing(r.quality).includes('UNIQUENESS.CANONICAL_LOT_ID')); assert.equal(r.quality.gate.publishable, false); assert.equal(res.candidate, null);
  assert.equal(r.dataset.duplicates[0].classification, 'DUPLICATE_RECORD');
});
test('OnboardingMissingRequiredField: unmapped lot number blocks; suggestion alone is not confirmation', () => {
  const ws = workspace(), c = newCase(ws);
  const s = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV) }, [{ sourceField: 'quadra', targetFieldKey: 'identity.blockId' }]);
  const set = ws.mappingSet(op(), s.id).value;
  ws.updateMappings(op(), s.id, { upsert: [{ sourceField: 'lote', targetFieldKey: 'identity.lotNumber', confidence: 'SUGGESTED' }] }, set.revision);
  const { run: r } = run(ws, c, [s.id], { requireGeometry: false });
  assert.ok(failing(r.quality).includes('CONSISTENCY.MAPPING_VALID'));
  assert.ok(r.dataset.mappingValidation[0].errors.some(e => e.code === 'FIELD_MAPPING_MISSING'));
  assert.ok(r.reviews.some(x => x.category === 'FIELD_MAPPING'));
  assert.equal(ws.updateMappings(op(), s.id, { upsert: [] }, '1').code, 'MAPPING_REVISION_CONFLICT', 'optimistic concurrency');
  const bad = ws.updateMappings(op(), s.id, { upsert: [{ sourceField: 'area', targetFieldKey: 'lot.areaInventada', confidence: 'CONFIRMED' }] }, ws.mappingSet(op(), s.id).value.revision);
  assert.ok(bad.ok); assert.ok(O.mapping.validateMappingSet(bad.value, { purpose: 'LOT_MASTER' }).errors.some(e => e.code === 'FIELD_MAPPING_UNKNOWN_TARGET'), 'no ad hoc target fields');
});
test('OnboardingGeometryUnmatched: polygon without lot and lot without polygon → BLOCKING', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws, { geo: geo([['f1', 'A', 1, sq(0, 0)], ['f2', 'A', 2, sq(20, 0)], ['f9', 'C', 9, sq(60, 0)]]) });
  const { run: r } = run(ws, c, ids);
  const f = failing(r.quality); assert.ok(f.includes('REFERENTIAL_INTEGRITY.GEOMETRY_LOT_EXISTS') && f.includes('COMPLETENESS.GEOMETRY_PRESENT'));
  deq(r.dataset.geometry.match.lotsWithoutGeometry, ['TS-QB-L0001']);
});
test('OnboardingGeometryInvalidPolygon: self-intersection / zero area → BLOCKING, source geometry never repaired in place', () => {
  const bow = [[540, 500], [550, 500], [540, 510], [560, 510], [540, 500]];
  const ws = workspace(), { c, ids } = cleanSetup(ws, { geo: geo([['f1', 'A', 1, sq(0, 0)], ['f2', 'A', 2, [[520, 500], [530, 500], [540, 500], [520, 500]]], ['f3', 'B', 1, bow]]) });
  const { run: r } = run(ws, c, ids);
  const codes = r.dataset.geometry.issues.map(i => i.code); assert.ok(codes.includes('SELF_INTERSECTION') && codes.includes('ZERO_AREA'), codes.join());
  assert.ok(failing(r.quality).includes('GEOMETRY_INTEGRITY.VALID_POLYGON')); assert.equal(r.quality.gate.publishable, false);
  const f = r.dataset.geometry.features.find(x => x.sourceFeatureId.endsWith('f3'));
  const rep = O.geometry.repairRecord(f, 'SELF_INTERSECTION', 'manual-vertex-order', sq(40, 0), 'u_geo').value;
  assert.notEqual(rep.sourceGeometryChecksum, rep.repairedGeometryChecksum); deq(f.geometry.coordinates[0], bow, 'source untouched');
  assert.equal(App.onboarding.quality.createException({ check: r.quality.checks.find(x => x.code === 'GEOMETRY_INTEGRITY.VALID_POLYGON'), reason: 'x', acceptedBy: 'u', at: null }).code, 'DATA_QUALITY_BLOCKER', 'not waivable');
});
test('OnboardingSourceConflictArea: PDF 250 m² × XLSX/CSV 252 m² → DataConflict, never silent; resolution is audited', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const other = source(ws, c, { sourceType: 'CSV', purpose: 'GEOMETRY', filename: 'quadro_areas.csv', bytes: csv('quadra;lote;area\nA;1;252\n') });
  const { run: r } = run(ws, c, [...ids, other.id]);
  const cf = r.dataset.conflicts.find(x => x.entityId === 'TS-QA-L0001'); assert.ok(cf); assert.equal(cf.status, 'OPEN');
  assert.equal(r.dataset.drafts.find(d => d.canonicalLotId === 'TS-QA-L0001').areaSqm, 250, 'no silent override');
  assert.ok(failing(r.quality).includes('CONSISTENCY.OPEN_CONFLICTS'));
  assert.equal(ws.resolveConflict(op(), cf.id, { selectedSourceRef: cf.candidates[1].sourceRef }).code, 'VALIDATION_ERROR', 'reason required');
  const res = ws.resolveConflict(op(), cf.id, { selectedSourceRef: cf.candidates[1].sourceRef, reason: 'quadro de áreas registrado prevalece' });
  assert.ok(res.ok); assert.ok(ws.audit().some(a => a.action === 'DATA_CONFLICT_RESOLVED' && a.actorId === 'u_operator'));
  const { run: r2 } = run(ws, c, [...ids, other.id], { batchType: 'CORRECTION' });
  assert.equal(r2.dataset.drafts.find(d => d.canonicalLotId === 'TS-QA-L0001').areaSqm, 252);
  assert.match(r2.dataset.drafts.find(d => d.canonicalLotId === 'TS-QA-L0001').provenanceRefs['geometry.areaM2'], /^conflict:/);
});
test('OnboardingPricingMissingDoesNotSetUnavailable', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const pr = source(ws, c, { sourceType: 'CSV', purpose: 'PRICING', filename: 'p.csv', bytes: csv('quadra;lote;preco\nA;1;299.000,00\nA;2;sem informação\nB;1;-\n') });
  const av = source(ws, c, { sourceType: 'CSV', purpose: 'AVAILABILITY', filename: 's.csv', bytes: csv('quadra;lote;status\nA;1;DISPONIVEL\nA;2;\nB;1;N/A\n') });
  const { run: r } = run(ws, c, [...ids, pr.id, av.id]);
  deq(r.dataset.prices.missing, ['TS-QA-L0002', 'TS-QB-L0001'], 'price missing');
  deq(r.dataset.availability.candidates.map(x => x.canonicalStatus), ['AVAILABLE', 'UNKNOWN', 'UNKNOWN'], 'missing status stays UNKNOWN, never UNAVAILABLE, never AVAILABLE');
  assert.ok(!failing(r.quality).includes('COMMERCIAL_COHERENCE.PRICE_MISSING_NOT_UNAVAILABLE'));
});
test('OnboardingUnknownAvailabilityStatus: "PRÉ-RESERVA" without mapping → REVIEW_REQUIRED; never guessed', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const av = source(ws, c, { sourceType: 'CSV', purpose: 'AVAILABILITY', filename: 's.csv', bytes: csv('quadra;lote;status\nA;1;PRÉ-RESERVA\nA;2;DISPONIVEL\nB;1;VENDIDO\n') });
  const { run: r, b } = run(ws, c, [...ids, av.id], { sourceSystem: 'loteadora-x' });
  assert.equal(ws.getBatch(op(), b.id).value.status, 'REVIEW_REQUIRED'); assert.equal(ws.getCase(op(), c.id).value.status, 'REVIEW_REQUIRED');
  assert.ok(failing(r.quality).includes('COMMERCIAL_COHERENCE.AVAILABILITY_STATUS_KNOWN'));
  assert.ok(!r.dataset.availability.candidates.some(x => x.lotId === 'TS-QA-L0001'));
  assert.ok(ws.approveStatusMapping(op(), { sourceSystem: 'loteadora-x', sourceValue: 'PRÉ-RESERVA', canonicalStatus: 'PROPOSAL' }).ok);
  const { run: r2 } = run(ws, c, [...ids, av.id], { sourceSystem: 'loteadora-x', batchType: 'REIMPORT' });
  assert.equal(r2.dataset.availability.candidates.find(x => x.lotId === 'TS-QA-L0001').canonicalStatus, 'PROPOSAL');
  assert.equal(r2.quality.gate.publishable, true);
});
test('OnboardingIncrementalPriceUpdate: 15 prices changed → new PriceTableVersion, no lot identity change', () => {
  const ws = workspace(), c = newCase(ws);
  const n = 30, rows = Array.from({ length: n }, (_, i) => `A;${i + 1};250`).join('\n');
  const lm = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv('quadra;lote;area\n' + rows + '\n') });
  const current = Object.fromEntries(Array.from({ length: n }, (_, i) => [`TS-QA-L${String(i + 1).padStart(4, '0')}`, 29900000]));
  const pr = source(ws, c, { sourceType: 'CSV', purpose: 'PRICING', filename: 'p2.csv', bytes: csv('quadra;lote;preco\n' + Array.from({ length: n }, (_, i) => `A;${i + 1};${i < 15 ? '310.000,00' : '299.000,00'}`).join('\n') + '\n') });
  const { run: r } = run(ws, c, [lm.id, pr.id], { batchType: 'INCREMENTAL', currentPrices: current, requireGeometry: false, proposedPriceTableVersion: 'tabela-2' });
  assert.equal(r.dataset.priceDiff.changedPrices.length, 15); assert.equal(r.dataset.priceDiff.thresholdStatus, 'necessita confirmação');
  assert.ok(r.reviews.some(x => x.category === 'PRICE_DIFF'), 'no universal threshold: changes are reviewed');
  const cmd = r.commands.find(x => x.domain === 'PRICING'); assert.equal(cmd.priceTableVersion, 'tabela-2'); assert.equal(cmd.touchesLotIdentity, false);
  const baseline = new Map(r.dataset.drafts.map(d => [d.canonicalLotId, { areaSqm: d.areaSqm, attributes: d.attributes }]));
  const diff = O.publication.ingestionDiff({ batchId: r.batchId, baseline, drafts: r.dataset.drafts, priceDiff: r.dataset.priceDiff });
  deq(diff.lots, { added: [], changed: [], removed: [] }); assert.equal(O.publication.classifyUpdate(diff).kind, 'OPERATIONAL');
});
test('OnboardingLotRenumberingReview: 327 → 327A opens LOT_IDENTITY review, never auto-matched', () => {
  const ws = workspace(), c = newCase(ws);
  const lm = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv('quadra;lote;area\nA;327A;250\n') });
  const existing = [{ id: 'TS-QA-L0327', blockId: 'A', lotNumber: 327, areaM2: 250, externalCode: null }];
  const { run: r } = run(ws, c, [lm.id], { existingLots: existing, requireGeometry: false });
  const m = r.dataset.identityMatches.matches[0]; assert.equal(m.matchType, 'AMBIGUOUS'); assert.equal(m.incomingLotId, null);
  assert.ok(r.reviews.some(x => x.category === 'LOT_IDENTITY' && x.severity === 'CRITICAL'));
  assert.equal(r.quality.gate.publishable, false);
  const lin = O.canonical.lineageEvent({ eventType: 'RENUMBERED', sourceLotIds: ['TS-QA-L0327'], targetLotIds: ['TS-QA-L0327A'], sourceRef: 'src#row:2' });
  assert.equal(lin.code, 'VALIDATION_ERROR', 'lineage needs an approver');
});
test('OnboardingSourceFileDuplicate: same checksum → SOURCE_DUPLICATE; new version supersedes, never overwrites', () => {
  const ws = workspace(), c = newCase(ws);
  const a = ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV) });
  const dup = ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'outro_nome.csv', bytes: csv(LOT_CSV) });
  assert.equal(dup.code, 'SOURCE_DUPLICATE'); assert.equal(dup.refs.sourceAssetId, a.value.id);
  assert.equal(a.value.checksum, 'sha256:' + sha(Buffer.from(LOT_CSV)));
  const v2 = ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV + 'B;2;310\n'), supersedesId: a.value.id });
  assert.ok(v2.ok); assert.equal(v2.value.version, 2);
  const list = ws.listSources(op(), c.id).value; assert.equal(list.find(s => s.id === a.value.id).status, 'SUPERSEDED');
  assert.equal(O.intake.assertImmutable(a.value, { ...a.value, checksum: 'sha256:x' }).code, 'SOURCE_IMMUTABLE');
  assert.ok(!/\/home|\\/.test(JSON.stringify(O.intake.sanitizeMetadata({ notes: 'C:\\Users\\x\\a.csv', description: '/home/u/a.csv' }))), 'no local paths in metadata');
});
test('OnboardingDryRunNoPublish: dry-run never creates candidates nor touches pointers', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const b = ws.createBatch(op(), c.id, { sourceAssetIds: ids }).value, r = ws.runBatch(op(), b.id, { runMode: 'DRY_RUN' });
  assert.ok(r.ok); assert.equal(r.pointersTouched, false); assert.equal(r.value.quality.gate.publishable, true);
  const st = ws.publicationState(op(), c.id).value; assert.equal(st.publications.length, 0); assert.equal(st.pointer.publicationId, null);
});
function published(ws) {
  const { c, ids } = cleanSetup(ws);
  const { r } = run(ws, c, ids); const pubId = r.candidate.id;
  return { c, ids, pubId };
}
test('OnboardingCandidatePublish: approval with separation of duties, atomic pointer, idempotent, stale tab refused', () => {
  const ws = workspace(), { c, pubId } = published(ws);
  assert.equal(ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 0 }).code, 'PUBLICATION_APPROVAL_REQUIRED');
  assert.equal(ws.decide(op(), c.id, pubId, { approve: true }).code, 'PUBLICATION_SEPARATION_OF_DUTIES', 'requester cannot approve (policy null → strictest)');
  assert.ok(ws.decide(approver(), c.id, pubId, { approve: true }).ok);
  const fail = ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 0, activator: () => { throw new Error('storage down'); } });
  assert.equal(fail.code, 'PUBLICATION_CONFLICT'); assert.equal(ws.publicationState(op(), c.id).value.pointer.publicationId, null, 'failed activation keeps previous pointer');
  assert.equal(ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 7 }).code, 'PUBLICATION_CONFLICT', 'stale expected revision (multi-tab)');
  const ok = ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 0 });
  assert.ok(ok.ok); assert.equal(ok.value.publicationNumber, 1); assert.equal(ok.value.rollbackTarget, null);
  assert.equal(ws.getCase(op(), c.id).value.status, 'PUBLISHED');
  assert.ok(ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 1 }).value.idempotent);
  assert.match(App.onboardingView.publishSummary(ok.value), /Publicação #1/);
  assert.equal(ws.publish(person('u_viewer', [O.orchestrator.PERM.READ]), c.id, pubId, { expectedPointerRevision: 1 }).code, 'PERMISSION_DENIED');
  assert.ok(ws.securityEvents().some(e => e.type === 'UNAUTHORIZED_PUBLICATION'));
});
test('OnboardingRollbackToPreviousPublication: pointer returns, availability untouched', () => {
  const ws = workspace(), { c, ids, pubId } = published(ws);
  ws.decide(approver(), c.id, pubId, { approve: true }); ws.publish(approver(), c.id, pubId, { expectedPointerRevision: 0 });
  const fix = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l2.csv', bytes: csv('quadra;lote;area\nA;1;250,00\nA;2;261\nB;1;300\n'), supersedesId: ids[0] });
  const { r } = run(ws, c, [fix.id, ids[1]], { batchType: 'CORRECTION' }); const p2 = r.candidate.id;
  ws.decide(approver(), c.id, p2, { approve: true }); const pub2 = ws.publish(approver(), c.id, p2, { expectedPointerRevision: 1 });
  assert.ok(pub2.ok, pub2.code); assert.equal(pub2.value.rollbackTarget, pubId);
  const rb = ws.rollback(approver(), c.id, { toPublicationId: pubId, reason: 'área do lote A2 errada', expectedPointerRevision: 2 });
  assert.ok(rb.ok); assert.equal(rb.value.pointer.publicationId, pubId);
  deq(rb.value.dynamicDomainsUntouched, ['AVAILABILITY']);
  assert.equal(rb.value.plan.domains.find(d => d.domain === 'AVAILABILITY').rollbackMode, 'NO_AUTOMATIC_ROLLBACK');
  const hist = O.publication.publicationHistory(ws.publicationState(op(), c.id).value);
  deq(hist.map(h => [h.number, h.status, h.active]), [[1, 'PUBLISHED', true], [2, 'ROLLED_BACK', false]]);
});
test('OnboardingExternalApiIncrementalSync: webhook payload is a source, replay refused, never auto-published', () => {
  const ws = workspace(), { c } = cleanSetup(ws);
  assert.equal(ws.registerConnector(op(), { id: 'cx', provider: 'loteadora', sourceDomains: ['AVAILABILITY'], authRef: 'sk_live_123' }).code, 'VALIDATION_ERROR', 'no secret in connector');
  assert.ok(ws.registerConnector(op(), { id: 'cx', provider: 'loteadora', sourceDomains: ['AVAILABILITY'], authRef: 'secretref://connectors/cx', webhookSupport: true }).ok);
  const payload = { cursor: 'c1', records: [{ quadra: 'A', lote: 1, status: 'VENDIDO' }] };
  const w = ws.ingestWebhook(op(), c.id, { connectorId: 'cx', deliveryId: 'd1', payload, signatureVerified: true });
  assert.ok(w.ok); assert.equal(w.autoPublished, false); assert.equal(w.value.sourceType, 'API'); assert.match(w.value.metadata.cursor, /c1/);
  assert.equal(ws.ingestWebhook(op(), c.id, { connectorId: 'cx', deliveryId: 'd1', payload: { ...payload, x: 1 }, signatureVerified: true }).code, 'BATCH_DUPLICATE');
  assert.equal(ws.ingestWebhook(op(), c.id, { connectorId: 'cx', deliveryId: 'd2', payload, signatureVerified: false }).code, 'PERMISSION_DENIED');
  assert.equal(ws.syncState('cx').status, 'HEALTHY'); ws.recordSyncFailure('cx'); assert.equal(ws.syncState('cx').status, 'DEGRADED');
  assert.equal(O.commercial.freshness({ sourceDomain: 'AVAILABILITY', external: true, lastSuccessfulSyncAt: '2026-10-17T00:00:00Z', now: '2026-10-17T01:00:00Z' }).status, 'UNKNOWN', 'cadence not configured');
  const rec = O.publication.reconcileSource('AVAILABILITY', { a: 'SOLD' }, { a: 'UNKNOWN', b: 'UNKNOWN' }); assert.equal(rec.status, 'DIFFERENCES_FOUND'); assert.equal(rec.writesApplied, 0);
});
test('OnboardingCrossTenantSourceDenied + deny by default', () => {
  const ws = workspace(), c = newCase(ws);
  const r = ws.uploadSource(person('u_x', ALL(), 'org_other'), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV) });
  assert.equal(r.code, 'CROSS_TENANT_DENIED'); assert.ok(ws.securityEvents().some(e => e.type === 'CROSS_TENANT_IMPORT_ATTEMPT'));
  assert.equal(ws.uploadSource(person('u_none', []), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV) }).code, 'PERMISSION_DENIED');
  assert.ok(ws.securityEvents().some(e => e.type === 'UNAUTHORIZED_SOURCE_UPLOAD'));
  assert.equal(ws.getCase(person('u_none', []), c.id).code, 'PERMISSION_DENIED');
  const other = O.orchestrator.createWorkspace({ organizationId: ORG, authorize: undefined });
  assert.equal(other.createCase({ id: 'u' , organizationId: ORG }, { name: 'x', code: 'X', timezone: 'UTC', developmentType: 'OTHER', organizationId: ORG }).code, 'PERMISSION_DENIED');
});
test('OnboardingMaliciousArchiveRejected (+ macro, spoofed MIME, oversized, executable) before any parser', () => {
  const ws = workspace(), c = newCase(ws), PK = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3];
  const slip = ws.uploadSource(op(), c.id, { sourceType: 'KMZ', purpose: 'GEOMETRY', filename: 'mapa.kmz', bytes: PK, archiveEntries: [{ name: '../../etc/passwd', compressedSize: 10, uncompressedSize: 10 }] });
  assert.equal(slip.code, 'SOURCE_REJECTED'); assert.match(slip.details, /ZIP_SLIP/);
  const bomb = ws.uploadSource(op(), c.id, { sourceType: 'KMZ', purpose: 'GEOMETRY', filename: 'b.kmz', bytes: PK, archiveEntries: [{ name: 'doc.kml', compressedSize: 1000, uncompressedSize: 900000000 }] });
  assert.equal(bomb.code, 'SOURCE_REJECTED');
  assert.ok(ws.securityEvents().some(e => e.type === 'MALICIOUS_ARCHIVE_REJECTED'));
  const macro = ws.uploadSource(op(), c.id, { sourceType: 'XLSX', purpose: 'LOT_MASTER', filename: 'tabela.xlsx', bytes: PK, archiveEntries: [{ name: 'xl/workbook.xml', compressedSize: 10, uncompressedSize: 20 }, { name: 'xl/vbaProject.bin', compressedSize: 10, uncompressedSize: 20 }] });
  assert.match(macro.details, /MACRO_FILE/);
  assert.match(ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.xlsm', bytes: csv(LOT_CSV) }).details, /MACRO_FILE/);
  const spoof = ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'lotes.csv', bytes: csv('<html><script>alert(1)</script>') });
  assert.match(spoof.details, /EXECUTABLE_CONTENT/); assert.ok(ws.securityEvents().some(e => e.type === 'SPOOFED_MIME_REJECTED'));
  assert.match(ws.uploadSource(op(), c.id, { sourceType: 'PDF', purpose: 'REGULATION', filename: 'r.pdf', bytes: csv('não é pdf') }).details, /MAGIC_BYTES_MISMATCH/);
  assert.match(ws.uploadSource(op(), c.id, { sourceType: 'MANUAL_FORM', purpose: 'LOT_MASTER', filename: 'f.json', bytes: csv('[' + '1,'.repeat(600000) + '1]') }).details, /FILE_TOO_LARGE/);
  assert.equal(ws.uploadSource(op(), c.id, { sourceType: 'CAD', purpose: 'GEOMETRY', filename: 'p.dwg', bytes: [1, 2, 3] }).code, 'SOURCE_REJECTED', 'CAD unsupported, fails safely');
  const infected = ws.uploadSource(op(), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'v.csv', bytes: csv('quadra;lote\nEICAR;1\n') });
  assert.match(infected.details, /MALWARE_DETECTED/);
  const noScan = O.orchestrator.createWorkspace({ organizationId: ORG, clock: () => null });
  const nc = noScan.createCase(op(), { name: 'x', code: 'NS', timezone: 'UTC', developmentType: 'OTHER', organizationId: ORG }).value;
  const s = noScan.uploadSource(op(), nc.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', bytes: csv(LOT_CSV) });
  assert.equal(s.value.scan.status, 'NOT_CONFIGURED'); assert.equal(noScan.discover(op(), s.value.id).code, 'SOURCE_SCAN_REQUIRED', 'quarantine until scanned');
  assert.equal(O.parsers.KmlParser.parse({ id: 's' }, { bytes: csv('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><kml></kml>') }).code, 'SOURCE_REJECTED', 'XXE');
});

// ------------------------------------------------------------------ parsers, geometry, gate, misc
test('parsers: CSV delimiter/decimal/encoding/header detection; KML folders + CRS; XLSX hidden sheets + formulas; PDF needs review', () => {
  const a = { id: 's1', sourceType: 'CSV', metadata: {} };
  const latin = Buffer.concat([Buffer.from('quadra,lote,observa'), Buffer.from([0xe7, 0xe3]), Buffer.from('o\nA,1,x\n')]);
  const p = O.parsers.CsvParser.parse(a, { bytes: new Uint8Array(latin) });
  assert.equal(p.metadata.delimiter, ','); assert.equal(p.metadata.encoding, 'latin1'); assert.ok(p.warnings.some(w => w.code === 'ENCODING_FALLBACK')); assert.equal(p.requiresReview, true);
  assert.equal(O.parsers.CsvParser.parse(a, { bytes: csv(LOT_CSV) }).metadata.decimalSeparatorHint, 'comma');
  assert.ok(O.parsers.CsvParser.parse(a, { bytes: csv('1;2\n3;4\n') }).warnings.some(w => w.code === 'HEADER_NOT_DETECTED'));
  const kml = '<?xml version="1.0"?><kml><Document><Folder><name>Quadra A</name><Placemark id="pm1"><name>A1</name><ExtendedData><Data name="lote"><value>1</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>-40.2,-20.1 -40.21,-20.1 -40.21,-20.11 -40.2,-20.1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder><NetworkLink><Link><href>http://x</href></Link></NetworkLink></Document></kml>';
  const k = O.parsers.KmlParser.parse({ id: 'k', sourceType: 'KML' }, { bytes: csv(kml) });
  assert.equal(k.records[0].recordRef, 'placemark:/Quadra A/A1'); assert.equal(k.metadata.coordinateReference, 'EPSG:4326'); assert.ok(k.warnings.some(w => w.code === 'EXTERNAL_LINK_IGNORED'));
  const pix = O.parsers.GeoJsonParser.parse({ id: 'g', sourceType: 'GEOJSON' }, { bytes: geo([['f', 'A', 1, [[1, 1], [2, 1], [2, 2], [1, 1]]]]) }); assert.equal(pix.metadata.coordinateReference, 'EPSG:4326', 'small numbers are in lon/lat range');
  const big = O.parsers.GeoJsonParser.parse({ id: 'g', sourceType: 'GEOJSON' }, { bytes: geo([['f', 'A', 1, sq(0, 100)]]) }); assert.equal(big.metadata.coordinateReference, 'UNKNOWN', 'pixel values are never assumed WGS84');
  const d = O.geometry.describeSource({ id: 'g', sourceType: 'GEOJSON', metadata: { coordinateReference: 'PIXEL_SPACE/plan' }, version: 1 }, pix); assert.equal(d.value.coordinateReference, 'UNKNOWN', 'declared ≠ verified → UNKNOWN');
  const x = O.parsers.XlsxParser.parse({ id: 'x', sourceType: 'XLSX', metadata: {} }, { extracted: { sheets: [{ name: 'Lotes', rows: [['quadra', 'lote', 'area'], ['A', 1, { f: 'B2*2', v: 500 }]], merged: ['A1:B1'] }, { name: 'Oculta', hidden: true, rows: [['a'], ['b']] }] } });
  assert.equal(x.records.length, 1); assert.equal(x.records[0].recordRef, 'sheet:Lotes,row:2'); assert.equal(x.records[0].values.area, 500);
  deq(x.warnings.map(w => w.code).sort(), ['FORMULA_CACHED_VALUE', 'HIDDEN_SHEET', 'MERGED_CELLS']);
  assert.equal(O.parsers.XlsxParser.parse({ id: 'x', sourceType: 'XLSX', metadata: {} }, {}).code, 'SOURCE_FILE_UNSUPPORTED', 'no fake XLSX support without extractor');
  const pdf = O.parsers.PdfTableParser.parse({ id: 'p', sourceType: 'PDF' }, { extracted: { ocr: true, tables: [{ page: 7, rows: [['quadra', 'lote'], ['A', '1']] }] } });
  assert.equal(pdf.requiresReview, true); assert.equal(pdf.confidence, 'LOW'); assert.equal(pdf.records[0].recordRef, 'page:7,table:1,row:2');
  assert.ok(O.parsers.ImageParser.parse({ id: 'i', sourceType: 'IMAGE', metadata: {} }, { bytes: [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 8, 199, 0, 0, 6, 51] }).warnings.some(w => w.code === 'RASTER_NOT_GEOMETRY'));
  assert.equal(O.geometry.describeSource({ id: 'i', sourceType: 'IMAGE', purpose: 'BASE_MAP', metadata: {} }, null).code, 'GEOMETRY_RASTER_NOT_GEOMETRY');
});
test('mapping: null semantics, zero ≠ null, unknown ≠ false, ambiguous decimals, PII never mapped', () => {
  const T = O.mapping.createTransformRegistry();
  assert.equal(O.mapping.isNullToken('sem informação'), true); assert.equal(O.mapping.isNullToken('0'), false);
  assert.equal(T.get('normalizeBoolean').fn('talvez').ok, false); assert.equal(T.get('parseDecimal').fn('1.234').code, 'AMBIGUOUS_DECIMAL');
  assert.equal(T.get('parseBrazilianDecimal').fn('1.234,56').value, 1234.56); assert.equal(T.get('parseCurrencyBRL').fn('R$ 299.000,00').value, 29900000);
  assert.equal(T.get('excelSerialDate').fn(46301).value, '2026-10-06');
  assert.ok(O.mapping.createTransformRegistry([{ id: 'vjFix', version: '1', fn: v => ({ ok: true, value: v }) }]).errors.length, 'custom transform needs owner + developmentId');
  const ps = { sourceAssetId: 's', records: [{ recordRef: 'row:2', values: { quadra: 'A', lote: '1', cliente: 'Ana', contato: 'ana@ex.com' } }] };
  const pii = O.mapping.detectPii(ps); deq(pii.map(p => p.sourceField).sort(), ['cliente', 'contato']); assert.ok(!JSON.stringify(pii).includes('ana@'), 'values never copied');
  const set = O.mapping.createMappingSet({ sourceAssetId: 's', rules: [{ sourceField: 'contato', targetFieldKey: 'identity.externalCode', confidence: 'CONFIRMED', approvedBy: 'u' }] });
  assert.ok(O.mapping.validateMappingSet(set, { piiFindings: pii }).errors.some(e => e.code === 'PII_FIELD_NOT_ALLOWED'));
  assert.equal(O.mapping.sanitizeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")'); assert.match(O.mapping.ingestionTemplateCsv(), /ingestion-template@1\.0\.0/);
});
test('geometry: alignment is PROPOSED until approved; unapproved transform never produces WGS84; deltas', () => {
  const anchors = [{ id: 'a', source: [0, 0], target: [-40.2, -20.1] }, { id: 'b', source: [100, 0], target: [-40.19, -20.1] }, { id: 'c', source: [0, 100], target: [-40.2, -20.11] }];
  const t = O.geometry.fitAffine({ anchors, sourceRef: 'PIXEL_SPACE/plan', targetRef: 'EPSG:4326' }).value;
  assert.equal(t.status, 'PROPOSED'); assert.ok(t.anchorResidualRms < 1e-9);
  assert.equal(O.geometry.transformPoints([[50, 50]], t).code, 'GEOMETRY_ALIGNMENT_FAILED');
  const ok = O.geometry.transformPoints([[50, 50]], O.geometry.approveTransform(t, 'u_geo', null).value).value;
  assert.equal(ok.valueState, 'calculado'); assert.equal(ok.coordinateReference, 'EPSG:4326');
  assert.equal(O.geometry.fitAffine({ anchors: [anchors[0], { source: [1, 1], target: [0, 0] }, { source: [2, 2], target: [1, 1] }] }).code, 'GEOMETRY_ALIGNMENT_FAILED', 'collinear');
});
test('quality gate: topic-61 provider plugs in; a failing provider fails closed; exceptions only where waivable', () => {
  const Q = O.quality, base = { drafts: [], requireGeometry: false };
  const un = Q.registerProvider({ id: 'dq61-test', version: '0', evaluate: () => [{ code: 'DQ61.X', category: 'VALIDITY', severity: 'BLOCKING', entityScope: 'LOT', result: 'FAIL' }] });
  try { const e = Q.evaluate(base); assert.ok(e.gate.blockers.includes('DQ61.X')); assert.equal(e.gate.publishable, false); deq(e.gate.providers.map(p => p.id), ['onboarding-builtin', 'dq61-test']); } finally { un(); }
  const un2 = Q.registerProvider({ id: 'broken', evaluate: () => { throw new Error('x'); } });
  try { assert.equal(Q.evaluate(base).gate.publishable, false); } finally { un2(); }
  assert.equal(Q.evaluate(base).gate.publishable, true);
  const warn = { code: 'COMPLETENESS.PRICE_PRESENT', severity: 'WARNING' };
  assert.ok(Q.createException({ check: warn, reason: 'preço em negociação', acceptedBy: 'u', at: null }).ok);
  assert.equal(Q.createException({ check: { code: 'UNIQUENESS.CANONICAL_LOT_ID', severity: 'BLOCKING' }, reason: 'x', acceptedBy: 'u' }).code, 'DATA_QUALITY_BLOCKER');
});
test('state machines are server-side: cancelled case cannot publish; obsolete batch cannot publish', () => {
  const M = O.model;
  assert.equal(M.transition('case', { status: 'CANCELLED' }, 'PUBLISHING').code, 'CASE_CANCELLED');
  assert.equal(M.transition('case', { status: 'DRAFT', revision: '1' }, 'PUBLISHED').code, 'INVALID_TRANSITION');
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const { b } = run(ws, c, ids, { runMode: 'DRY_RUN' });
  const v2 = source(ws, c, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l3.csv', bytes: csv(LOT_CSV + 'B;2;1\n'), supersedesId: ids[0] });
  assert.equal(ws.getBatch(op(), b.id).value.status, 'SUPERSEDED', 'source replaced mid-batch → batch obsolete');
  assert.equal(ws.runBatch(op(), b.id, {}).code, 'BATCH_OBSOLETE');
  assert.ok(v2);
  assert.ok(ws.cancelCase(op(), c.id).ok); assert.equal(ws.createBatch(op(), c.id, { sourceAssetIds: ids }).code, 'CASE_CANCELLED');
  assert.ok(ws.listSources(op(), c.id).value.length >= 2, 'cancel keeps raw sources');
});
test('incremental diff: removed lot is CRITICAL and needs classification; recompute plan follows the FieldRegistry graph', () => {
  const baseline = new Map([['TS-QA-L0001', { areaSqm: 250, attributes: {} }], ['TS-QA-L0002', { areaSqm: 260, attributes: {} }]]);
  const drafts = [{ canonicalLotId: 'TS-QA-L0001', areaSqm: 255, attributes: {}, sourceRecordRefs: ['s#row:2'] }];
  const d = O.publication.ingestionDiff({ batchId: 'b', baseline, drafts });
  deq(d.lots.removed, ['TS-QA-L0002']); assert.equal(d.severity, 'CRITICAL'); assert.equal(O.publication.classifyUpdate(d).kind, 'STRUCTURAL');
  const plan = O.publication.recomputePlan(d); assert.ok(plan.affectedFields.includes('commercial.price')); assert.ok(plan.analysisModules.length > 0); assert.equal(plan.fullRecompute, false);
  assert.equal(O.publication.classifyRemoval('TS-QA-L0002', 'DELETED', 'u').code, 'VALIDATION_ERROR');
  assert.ok(O.publication.classifyRemoval('TS-QA-L0002', 'RETIRED', 'u').ok);
});
test('observability + audit carry ids only; views escape; report is immutable and checksummed', () => {
  const ws = workspace(), { c, ids } = cleanSetup(ws);
  const { run: r } = run(ws, c, ids);
  const text = JSON.stringify([ws.logs(), ws.metrics(), ws.audit()]);
  assert.ok(!text.includes('260,50') && !text.includes('quadra;lote'), 'no raw source values in logs/metrics/audit');
  assert.ok(ws.logs().every(l => Object.keys(l).every(k => ['level', 'msg', 'batchId', 'sourceAssetId', 'developmentDraftId', 'at'].includes(k))));
  const V = App.onboardingView;
  const html = V.sourceInventory([{ originalFileName: '<img src=x onerror=1>.csv', sourceType: 'CSV', purpose: 'LOT_MASTER', version: 1, status: 'VALIDATED', checksum: 'sha256:abc', scan: { status: 'CLEAN' } }]);
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  assert.match(V.qualityPanel(r.quality), /Sem pendências|Aprovado com avisos/); assert.match(V.checklist(r, 'READY_TO_PUBLISH'), /✓ Pronto para publicar/);
  const rep = O.publication.onboardingReport({ identity: c.identity, sources: ws.listSources(op(), c.id).value, authorityMatrix: ws.authorityMatrix(op(), c.id).value, lotCount: 3, qualitySummary: r.quality.summary });
  assert.ok(Object.isFrozen(rep) && /^sha256:/.test(rep.reportChecksum));
  assert.equal(ws.authorityMatrix(op(), c.id).value.rows.find(x => x.domain === 'GEOMETRY').status, 'DECLARED');
  const h = O.publication.operationalHandoff({ developmentId: 'teste', publicationId: 'p', acceptedBy: 'u_ops' }).value; assert.ok(h.knownLimitations.some(l => /necessita confirmação/.test(l)));
  assert.equal(sha(fs.readFileSync(lotsPath)), lotsChecksumBefore);
});
