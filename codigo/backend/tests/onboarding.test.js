'use strict';
/* Topic 58 — development onboarding service, DB-FREE: shared domain (plat/src/onboarding) in the backend App context,
   memory repository, fake principals and fake scanner. Covers: golden ids = existing import prepare() ids for the 498 lots,
   deny by default, tenant isolation (404), scan required, duplicate source, batch idempotency, publish with separation of
   duties, rollback, route policies ↔ OpenAPI fragment ↔ permission registry, migration 012 up/down symmetry. No Postgres. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createOnboardingApp } = require('../src/modules/onboarding/onboarding.loader');
const { createMemoryOnboardingRepository, COLLECTIONS } = require('../src/modules/onboarding/onboarding.repository');
const { createOnboardingService, PERMISSIONS } = require('../src/modules/onboarding/onboarding.service');
const { ROUTE_POLICIES, registerOnboardingRoutes } = require('../src/modules/onboarding/onboarding.controller');
const { addOnboardingPaths, ROUTES } = require('../src/modules/onboarding/onboarding.openapi');
const { prepare } = require('../src/modules/imports/importDevelopmentData.service');
const { toRealm } = require('../src/shared/domain/sharedDomain');

const PLAT = path.resolve(__dirname, '..', '..');
const LOTS = path.resolve(PLAT, '..', 'dash', 'lots.json');
const App = createOnboardingApp();
const scanner = { scan: ({ bytes }) => ({ verdict: Buffer.from(bytes).includes('EICAR') ? 'INFECTED' : 'CLEAN', engine: 'fake' }) };
let t = 0; const now = () => Date.UTC(2026, 9, 17, 12, 0, 0) + 1000 * t++;
const ORG = 'org_house7';
const who = (actorId, permissions = [...PERMISSIONS], organizationId = ORG) => ({ actorId, organizationId, permissions });
const op = who('usr_operator'), approver = who('usr_publisher');
const svc = (o = {}) => createOnboardingService({ App, repo: createMemoryOnboardingRepository(), scanner, now, ...o });
const b64 = s => Buffer.from(s).toString('base64');
const CSV = 'quadra;lote;area\nA;1;250,00\nA;2;260,50\nB;1;300\n';
const rej = code => e => e.code === code;

async function lotsCase(s, { content = fs.readFileSync(LOTS), code = 'VJ', developmentId = 'viva-juara' } = {}) {
  const c = await s.createCase(op, { name: 'Viva Juara', code, timezone: 'America/Sao_Paulo', developmentType: 'LOT_SUBDIVISION', developmentId, lotCountExpected: 498 });
  const src = await s.uploadSource(op, c.id, { sourceType: 'OTHER', purpose: 'LOT_MASTER', filename: 'lots.json', contentBase64: content.toString('base64'), metadata: { coordinateReference: 'PIXEL_SPACE/plan' } });
  await s.discover(op, src.id);
  const rules = [['q', 'identity.blockId'], ['n', 'identity.lotNumber'], ['a', 'geometry.areaM2'], ['did', 'identity.id'], ['p', 'geometry.polygon']].map(([sourceField, targetFieldKey]) => ({ sourceField, targetFieldKey, confidence: 'CONFIRMED' }));
  await s.updateMappings(op, src.id, { change: { upsert: rules }, expectedRevision: 1 });
  return { c, src };
}
const devInputs = () => { const dev = App.repos.DevelopmentRepository.getDevelopment('viva-juara'); return { dev, bounds: { minX: 0, minY: 0, maxX: dev.map.width, maxY: dev.map.height } }; };

test('golden: onboarding canonical ids equal the existing import prepare() ids for all 498 lots; lots.json unchanged', async () => {
  const before = crypto.createHash('sha256').update(fs.readFileSync(LOTS)).digest('hex');
  const raw = JSON.parse(fs.readFileSync(LOTS, 'utf8'));
  const prepared = prepare({ App, raw: toRealm(App, raw), devId: 'viva-juara' });
  const s = svc(), { c, src } = await lotsCase(s);
  const b = await s.createBatch(op, c.id, { sourceAssetIds: [src.id] });
  const r = await s.runBatch(op, b.id, { runMode: 'BUILD_CANDIDATE' }, devInputs());
  assert.equal(r.gate.blockers.length, 0, r.gate.blockers.join()); assert.ok(r.candidatePublicationId);
  const ws = App.onboarding.canonical;
  const ids = raw.map(x => ws.canonicalLotId({ developmentCode: 'VJ', blockCode: x.q, lotNumber: x.n }).id);
  assert.deepEqual(ids.slice().sort(), Object.keys(prepared.layers.static.lots).sort(), 'same ids as the existing import');
  assert.equal(new Set(ids).size, 498);
  await assert.rejects(s.createBatch(op, c.id, { sourceAssetIds: [src.id] }), rej('BATCH_DUPLICATE'), 'idempotent batch');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(LOTS)).digest('hex'), before, 'published data never changes');
});

test('deny by default, tenant isolation (404), unauthenticated (401)', async () => {
  const s = svc();
  await assert.rejects(s.createCase(null, {}), e => e.status === 401);
  await assert.rejects(s.createCase(who('usr_x', []), { name: 'x', code: 'X', developmentId: 'x', developmentType: 'LOT_SUBDIVISION', timezone: 'America/Sao_Paulo' }), e => e.status === 403 && e.code === 'PERMISSION_DENIED');
  const c = await s.createCase(op, { name: 'T', code: 'TS', timezone: 'America/Sao_Paulo', developmentType: 'LOT_SUBDIVISION', developmentId: 'teste' });
  await assert.rejects(s.getCase(who('usr_other', [...PERMISSIONS], 'org_other'), c.id), e => e.status === 404);
  await assert.rejects(s.uploadSource(who('usr_r', ['development_onboarding.read']), c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', contentBase64: b64(CSV) }), e => e.status === 403);
  assert.ok(s.securityEvents(op).some(e => e.type === 'UNAUTHORIZED_SOURCE_UPLOAD'));
  assert.ok(!JSON.stringify(s.audit(op)).includes('250,00'), 'audit carries ids only');
});

test('scan is required (no scanner → never parsed); infected rejected; duplicate source 409; immutable in repo', async () => {
  const s0 = svc({ scanner: null }), c0 = await s0.createCase(op, { name: 'T', code: 'TS', timezone: 'America/Sao_Paulo', developmentType: 'LOT_SUBDIVISION', developmentId: 'teste' });
  const a0 = await s0.uploadSource(op, c0.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', contentBase64: b64(CSV) });
  assert.equal(a0.scan.status, 'NOT_CONFIGURED');
  await assert.rejects(s0.discover(op, a0.id), rej('SOURCE_SCAN_REQUIRED'));
  const repo = createMemoryOnboardingRepository(), s = svc({ repo });
  const c = await s.createCase(op, { name: 'T', code: 'TS', timezone: 'America/Sao_Paulo', developmentType: 'LOT_SUBDIVISION', developmentId: 'teste' });
  const a = await s.uploadSource(op, c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'l.csv', contentBase64: b64(CSV) });
  assert.equal(a.checksum, 'sha256:' + crypto.createHash('sha256').update(CSV).digest('hex'));
  await assert.rejects(s.uploadSource(op, c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'x.csv', contentBase64: b64(CSV) }), e => e.code === 'SOURCE_DUPLICATE' && e.status === 409);
  await assert.rejects(s.uploadSource(op, c.id, { sourceType: 'CSV', purpose: 'LOT_MASTER', filename: 'v.csv', contentBase64: b64('quadra;lote\nEICAR;1\n') }), rej('SOURCE_REJECTED'));
  await assert.rejects(repo.put('sources', ORG, { ...(await repo.get('sources', ORG, a.id)), checksum: 'sha256:' + '0'.repeat(64) }), /SOURCE_IMMUTABLE/);
  assert.equal(await repo.get('cases', 'org_other', c.id), null, 'repository is tenant-scoped');
});

test('publish: approval with separation of duties, atomic pointer, idempotent; rollback needs its own permission', async () => {
  const s = svc(), { c, src } = await lotsCase(s);
  const b = await s.createBatch(op, c.id, { sourceAssetIds: [src.id] });
  const dry = await s.runBatch(op, b.id, { runMode: 'DRY_RUN' }, devInputs());
  assert.equal(dry.candidatePublicationId, null, 'dry-run never builds a candidate');
  const r = await s.runBatch(op, b.id, { runMode: 'BUILD_CANDIDATE' }, devInputs());
  assert.ok(r.candidatePublicationId, 'candidate after an explicit BUILD_CANDIDATE run');
  const pub = r.candidatePublicationId;
  await assert.rejects(s.decide(op, c.id, pub, { approve: true }), rej('PUBLICATION_SEPARATION_OF_DUTIES'));
  await s.decide(approver, c.id, pub, { approve: true });
  await assert.rejects(s.publish(approver, c.id, pub, { expectedPointerRevision: 9 }), e => e.status === 409);
  const p = await s.publish(approver, c.id, pub, { expectedPointerRevision: 0 });
  assert.equal(p.publicationNumber, 1);
  assert.ok((await s.publish(approver, c.id, pub, { expectedPointerRevision: 1 })).idempotent);
  assert.equal((await s.getCase(op, c.id)).status, 'PUBLISHED');
  await assert.rejects(s.rollback(who('usr_r', ['development_onboarding.read']), c.id, { reason: 'x', expectedPointerRevision: 1 }), e => e.status === 403);
});

test('routes: policies ↔ OpenAPI fragment ↔ permission registry; router registration without wiring app.js', () => {
  const keys = new Set(JSON.parse(fs.readFileSync(path.join(PLAT, 'config', 'security', 'permissions.json'), 'utf8')).permissions.map(p => p.key));
  const md = fs.readFileSync(path.join(PLAT, 'docs', 'PERMISSION_REGISTRY.md'), 'utf8');
  for (const k of PERMISSIONS) { assert.ok(keys.has(k), k); assert.ok(md.includes('`' + k + '`'), k); }
  for (const { permission } of Object.values(ROUTE_POLICIES)) assert.ok(PERMISSIONS.includes(permission), permission);
  const paths = {}; addOnboardingPaths((p, m, o) => { paths[`${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`] = o; });
  assert.deepEqual(Object.keys(paths).sort(), Object.keys(ROUTE_POLICIES).sort());
  const reg = []; const router = new Proxy({}, { get: (_, m) => (p, h, meta) => reg.push(`${m.toUpperCase()} ${p}`) });
  registerOnboardingRoutes(router, { onboarding: svc() });
  assert.deepEqual(reg.sort(), Object.keys(ROUTE_POLICIES).sort());
  assert.equal(ROUTES.length, 20);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.ok(!app.includes('registerOnboardingRoutes'), 'not wired yet (integrator)');
});

test('migration 012: every table/function created is dropped by the down script; no lot/price/availability table touched', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '012_development_onboarding.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '012_development_onboarding.down.sql'), 'utf8');
  const created = [...up.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1]);
  assert.deepEqual(created.sort(), Object.values(COLLECTIONS).sort());
  for (const tb of created) assert.ok(down.includes(`DROP TABLE IF EXISTS ${tb};`), tb);
  for (const fn of [...up.matchAll(/CREATE FUNCTION (\w+)/g)].map(m => m[1])) assert.ok(down.includes(`DROP FUNCTION IF EXISTS ${fn}()`), fn);
  assert.ok(!/\b(ALTER|UPDATE|DELETE FROM|INSERT INTO)\s+(lots|lot_prices|lot_availability|price_tables|blocks)\b/i.test(up));
});
