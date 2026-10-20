'use strict';
/* Topic 59 — privacy backend, DB-FREE: shared privacy domain (plat/src/privacy) loaded in a vm context, memory repository,
   fake principals and a fake router. Covers deny by default, tenant isolation (404), DSR workflow with identity verification,
   deadlines NOT_CONFIGURED while legal rules are null, revision conflicts, denial reasons, consent append-only (denied
   without a validated basis), legal hold, suppression without echo, controller ↔ route policies ↔ OpenAPI, migration 013. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createPrivacyDomain, readPrivacyConfig } = require('../src/modules/privacy/privacy.domain');
const { createMemoryPrivacyRepository } = require('../src/modules/privacy/privacy.repository');
const { createPrivacyService, PrivacyError } = require('../src/modules/privacy/privacy.service');
const { registerPrivacyRoutes } = require('../src/modules/privacy/privacy.controller');
const { ROUTES, ROUTE_POLICIES, PERMISSIONS } = require('../src/modules/privacy/privacy.routes');
const { addPrivacyPaths } = require('../src/modules/privacy/privacy.openapi');

const ALL = PERMISSIONS.map(p => p[0]);
const ADMIN = { actorId: 'usr_dpo', organizationId: 'org_house7', permissions: ALL };
const OTHER = { actorId: 'usr_x', organizationId: 'org_other', permissions: ALL };
const NOW = '2026-10-17T12:00:00.000Z';
const mk = (o = {}) => { const repo = createMemoryPrivacyRepository(); return { repo, S: createPrivacyService({ repo, clock: () => NOW, ...o }) }; };
const rejects = (p, status, reason) => assert.rejects(p, e => e instanceof PrivacyError && e.status === status && (!reason || e.code === reason));

test('deny by default: unauthenticated 401, no tenant 400, missing permission 403', async () => {
  const { S } = mk();
  await rejects(S.registry(null), 401);
  await rejects(S.registry({ actorId: 'u', permissions: ALL }), 400, 'TENANT_CONTEXT_REQUIRED');
  await rejects(S.createRequest({ ...ADMIN, permissions: ['privacy.registry.view'] }, { requestType: 'ACCESS' }), 403, 'PERMISSION_DENIED');
});

test('DSR: deadline NOT_CONFIGURED while the legal rule is null; subjectRef must be opaque; other tenant = 404', async () => {
  const { S } = mk();
  const r = await S.createRequest(ADMIN, { requestType: 'ACCESS', subjectRef: 'sub_1' });
  assert.equal(r.status, 'RECEIVED'); assert.equal(r.dueAt, null); assert.equal(r.deadlineStatus, 'NOT_CONFIGURED'); assert.match(r.id, /^dsr_/);
  await rejects(S.createRequest(ADMIN, { requestType: 'ACCESS', subjectRef: 'maria@example.com' }), 400, 'VALIDATION_ERROR');
  await rejects(S.getRequest(OTHER, r.id), 404, 'NOT_FOUND');
  assert.equal((await S.listRequests(OTHER)).length, 0);
  const m = await S.metrics(ADMIN); assert.equal(m.data_subject_requests_open, 1); assert.equal(m.data_subject_requests_without_deadline, 1);
});

test('DSR: identity verification is proportional and required before review; stale revision 409; denial needs a reason', async () => {
  const { S } = mk();
  const r = await S.createRequest(ADMIN, { requestType: 'ACCESS', subjectRef: 'sub_1' }); // ACCESS = HIGH risk
  await rejects(S.startVerification(ADMIN, r.id, { method: 'KNOWN_CONTACT_CONFIRMATION' }), 422, 'VERIFICATION_NOT_PROPORTIONAL');
  const { request, verification } = await S.startVerification(ADMIN, r.id, { method: 'DOCUMENT_CHECK_BY_DPO' });
  assert.equal(request.status, 'IDENTITY_VERIFICATION');
  await rejects(S.transitionRequest(ADMIN, r.id, { to: 'IN_REVIEW', verificationId: verification.id, expectedRevision: request.revision }), 422, 'IDENTITY_NOT_VERIFIED');
  await S.completeVerification(ADMIN, r.id, { verificationId: verification.id, result: 'VERIFIED', evidenceRef: 'ev_1' });
  await rejects(S.transitionRequest(ADMIN, r.id, { to: 'IN_REVIEW', verificationId: verification.id, expectedRevision: '1' }), 409, 'REVISION_CONFLICT');
  const rev = await S.transitionRequest(ADMIN, r.id, { to: 'IN_REVIEW', verificationId: verification.id, expectedRevision: request.revision });
  assert.equal(rev.status, 'IN_REVIEW'); assert.equal(rev.identityVerificationRef, verification.id);
  await rejects(S.transitionRequest(ADMIN, r.id, { to: 'DENIED_WITH_REASON', expectedRevision: rev.revision }), 422, 'DENIAL_REASON_REQUIRED');
  const d = await S.transitionRequest(ADMIN, r.id, { to: 'DENIED_WITH_REASON', denialReasonCode: 'LEGAL_RETENTION_REQUIRED', expectedRevision: rev.revision });
  assert.equal(d.status, 'DENIED_WITH_REASON'); assert.ok(d.completedAt);
  const audit = await S.audit(ADMIN); assert.ok(audit.length >= 4); assert.ok(!JSON.stringify(audit).includes('@'));
});

test('consent: denied without a validated legal basis (real config); append-only history with a validated fixture', async () => {
  const { S } = mk();
  await rejects(S.grantConsent(ADMIN, { purposeId: 'MARKETING_COMMUNICATION', subjectRef: 'sub_1' }), 422, 'NO_APPROVED_BASIS');
  await rejects(S.grantConsent(ADMIN, { purposeId: 'ALL', subjectRef: 'sub_1' }), 422, 'GENERIC_CONSENT_FORBIDDEN');
  // FIXTURE ONLY (not a legal decision): an approved assessment so the mechanics can be exercised
  const cfg = readPrivacyConfig();
  cfg.registries.legalBasisAssessments = cfg.registries.legalBasisAssessments.map(a => a.id === 'LBA_MARKETING_COMMUNICATION' ? { ...a, legalBasisCode: 'CONSENT', status: 'APPROVED', assessedBy: 'fixture' } : a);
  const domain = createPrivacyDomain({ config: cfg }), { S: S2, repo } = mk({ domain });
  const text = 'Aviso de marketing (fixture).';
  const notice = domain.workflow.createNotice({ organizationId: 'org_house7', noticeType: 'MARKETING', version: '1', content: text }).notice;
  const base = { purposeId: 'MARKETING_COMMUNICATION', subjectRef: 'sub_1', notice, captureMethod: 'WEB', evidenceRef: 'ev_c1' };
  await rejects(S2.grantConsent(ADMIN, { ...base, noticeText: text + ' alterado' }), 422, 'NOTICE_CHECKSUM_MISMATCH');
  const c = await S2.grantConsent(ADMIN, { ...base, noticeText: text });
  assert.equal(c.status, 'GRANTED'); assert.equal(c.consentTextChecksum, notice.checksum);
  await rejects(S2.withdrawConsent(OTHER, c.id), 404);
  await S2.withdrawConsent(ADMIN, c.id);
  assert.deepEqual((await repo.consentHistory('org_house7', c.id)).map(x => x.status), ['GRANTED', 'WITHDRAWN']);
  assert.equal((await S2.listConsents(ADMIN, 'sub_1'))[0].status, 'WITHDRAWN');
  await rejects(S2.listConsents(ADMIN, '11999998888'), 400);
});

test('legal hold, block and suppression: reason required, tenant isolated, contact never echoed', async () => {
  const { S, repo } = mk();
  await rejects(S.createLegalHold(ADMIN, { subjectRef: 'sub_1', reason: 'x' }), 422, 'REASON_REQUIRED');
  const h = await S.createLegalHold(ADMIN, { subjectRef: 'sub_1', reason: 'Processo judicial em curso' });
  assert.equal((await S.operationalState(ADMIN, 'sub_1')).state, 'LEGAL_HOLD');
  await rejects(S.releaseLegalHold(OTHER, h.id), 404);
  assert.equal((await S.releaseLegalHold(ADMIN, h.id)).status, 'RELEASED');
  await S.createBlock(ADMIN, { subjectRef: 'sub_2', reason: 'Oposição do titular' });
  const s = await S.suppress(ADMIN, { contact: '+55 11 99999-8888', channel: 'WHATSAPP' });
  assert.ok(!JSON.stringify(s).includes('9999')); assert.ok(!('normalizedContactHash' in s));
  const stored = await repo.listSuppressions('org_house7'); assert.equal(stored.length, 1); assert.ok(!JSON.stringify(stored).includes('9999'));
  const dry = await S.retentionDryRun(ADMIN, { records: [] }); assert.equal(dry.approvalRequired, true);
});

test('registry: maturity L1 with blockers (nothing legally validated)', async () => {
  const { S } = mk(); const p = await S.registry(ADMIN);
  assert.equal(p.maturity.level, 'L1'); assert.ok(p.blockers.some(b => b.code === 'NO_APPROVED_BASIS')); assert.ok(p.blockers.some(b => b.code === 'DPO_NOT_APPOINTED'));
});

test('controller ↔ route policies ↔ OpenAPI fragment: every route registered, policed and documented; errors mapped', async () => {
  const reg = [];
  const router = { get: (p, h, o) => reg.push(['GET', p, h, o]), post: (p, h, o) => reg.push(['POST', p, h, o]) };
  const { S } = mk(); registerPrivacyRoutes(router, { privacy: S });
  assert.equal(reg.length, ROUTES.length);
  for (const [m, p, , o] of reg) { assert.ok(ROUTE_POLICIES[`${m} ${p}`], `${m} ${p}`); assert.equal(o.admin, true); assert.ok(ALL.includes(ROUTE_POLICIES[`${m} ${p}`].permission)); }
  const docs = []; addPrivacyPaths((p, m, op) => docs.push(`${m.toUpperCase()} ${p}`));
  assert.deepEqual(docs.sort(), reg.map(([m, p]) => `${m} ${p.replace(/:(\w+)/g, '{$1}')}`).sort());
  const get = reg.find(r => r[0] === 'GET' && r[1].endsWith('/requests/:id'))[2];
  await assert.rejects(get({ principal: ADMIN, params: { id: 'dsr_nope' }, query: new URLSearchParams(), requestId: 'r1' }), e => e.status === 404 && e.code === 'NOT_FOUND' && e.details.reason === 'NOT_FOUND');
  const ok = await reg.find(r => r[0] === 'GET' && r[1].endsWith('/registry'))[2]({ principal: ADMIN, params: {}, query: new URLSearchParams(), requestId: 'r2' });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.maturity.level, 'L1');
  for (const r of ROUTES) assert.ok(!/email|phone|cpf|name/i.test(r[1]), 'no PII in route paths');
});

test('migration 013: up/down symmetric, tenant-scoped, no plain PII columns, append-only consents and audit', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '013_privacy.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '013_privacy.down.sql'), 'utf8');
  const tables = [...up.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1]);
  assert.ok(tables.length >= 9);
  for (const t of tables) { assert.match(down, new RegExp(`DROP TABLE IF EXISTS ${t};`)); }
  const cols = up.split('\n').filter(l => /^\s{2}\w+\s+[A-Z]/.test(l)).map(l => l.trim().split(/\s+/)[0]);
  for (const c of cols) assert.ok(!/^(email|phone|telefone|cpf|name|nome|contact)$/i.test(c), c);
  assert.equal((up.match(/organization_id\s+TEXT NOT NULL/g) || []).length, tables.length);
  assert.match(up, /privacy_consents_append_only/); assert.match(up, /privacy_audit_append_only/);
});
