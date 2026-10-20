'use strict';
// Topic 59 — LGPD, privacidade, consentimento e ciclo de vida dos dados. Golden scenarios §449–467 + unit tests + the
// device data map fitness test (every storage key literal in plat/src must be in App.privacy.device.INVENTORY).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const CFG_DIR = path.join(__dirname, '..', 'config', 'privacy'), DOCS = path.join(__dirname, '..', 'docs');
const readCfg = () => Object.fromEntries(['registries', 'lifecycle', 'thirdParties', 'governance', 'policies'].map(k => [k, JSON.parse(fs.readFileSync(path.join(CFG_DIR, k + '.json'), 'utf8'))]));
const J = v => JSON.parse(JSON.stringify(v ?? null));
let App, C, W, D, V, BASE;
const NOW = '2026-10-16T12:00:00.000Z';
let n = 0; const idGen = p => `${p}_t${++n}`;
const O = (x = {}) => ({ now: NOW, idGen, actorId: 'usr_dpo', ...x });
const CTX = { organizationId: 'org_house7' }, OTHER = { organizationId: 'org_other' };

test.before(() => {
  App = load();
  for (const f of ['privacy/privacyCore.js', 'privacy/privacyWorkflow.js', 'privacy/deviceData.js', 'privacy/privacyView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  C = App.privacy.core; W = App.privacy.workflow; D = App.privacy.device; V = App.privacyView;
  BASE = readCfg(); C.setConfig(BASE);
});
/** a config where the legal team has approved some assessments/retentions (test fixture only — never the shipped config) */
function approved({ basis = {}, retention = {}, deadlines = {}, vendorsOk = [] } = {}) {
  const c = J(BASE);
  for (const a of c.registries.legalBasisAssessments) if (basis[a.processingPurposeId]) Object.assign(a, { legalBasisCode: basis[a.processingPurposeId], status: 'APPROVED', assessedBy: 'juridico_teste', rationale: 'fixture de teste', effectiveFrom: '2026-01-01' });
  for (const r of c.lifecycle.retentionPolicies) if (retention[r.id]) Object.assign(r, { approvedBy: 'juridico_teste', ...retention[r.id] });
  for (const d of c.lifecycle.deadlineRules) if (deadlines[d.code]) Object.assign(d, deadlines[d.code]);
  return c;
}
const withCfg = (c, fn) => { C.setConfig(c); try { return fn(); } finally { C.setConfig(BASE); } };
const withCfgAsync = async (c, fn) => { C.setConfig(c); try { return await fn(); } finally { C.setConfig(BASE); } };

// ============================================================ registries, defaults, never inferred
test('registries are valid, built from real code, and every legal basis / retention / deadline / DPO value is null until legal validation', () => {
  assert.deepEqual(J(C.validate()), []);
  const cfg = C.config();
  for (const k of ['IDENTITY', 'CONTACT', 'ADDRESS', 'MARITAL_STATUS', 'FINANCIAL_DECLARED', 'FINANCIAL_INFERRED', 'CUSTOMER_PREFERENCE', 'CUSTOMER_BEHAVIOR', 'COMMERCIAL_HISTORY', 'COMMUNICATION_HISTORY', 'DOCUMENT_IDENTIFIER', 'SIGNATURE_DATA', 'AUTHENTICATION', 'DEVICE_TECHNICAL', 'ANALYTICS_PSEUDONYMOUS', 'SENSITIVE_OTHER']) assert.ok(C.category(k), k);
  assert.equal(cfg.registries.purposes.length, 14);
  for (const a of cfg.registries.legalBasisAssessments) { assert.equal(a.legalBasisCode, null, a.id); assert.equal(a.validationStatus, 'NECESSITA_VALIDACAO_JURIDICA'); }
  for (const p of cfg.registries.purposes) assert.equal(C.approvedBasis(p.id), null, p.id);
  for (const r of cfg.lifecycle.retentionPolicies) assert.equal(r.duration, null, r.id);
  for (const r of cfg.lifecycle.deadlineRules) { assert.equal(r.businessDays, null, r.code); assert.equal(r.calendarDays, null, r.code); }
  for (const v of cfg.thirdParties.vendors) { assert.notEqual(v.status, 'APPROVED'); assert.deepEqual(v.hostingRegions, [], 'regions are unknown, never assumed BR'); }
  assert.equal(cfg.governance.dpo.publicDisplayName, 'House 7 Imobiliária'); assert.equal(cfg.governance.dpo.publicContactChannel, null); // named by Edmilson 2026-10-18; channel still missing assert.equal(cfg.governance.dpo.configurationStatus, 'NECESSITA_CONFIRMACAO');
  for (const row of cfg.governance.controllerOperatorMatrix.rows) for (const v of Object.values(row.roles)) assert.ok(v === null || v === '-', 'roles are never assumed (§514–517)');
  const codes = new Set(C.blockers().map(b => b.code));
  for (const c of ['NO_APPROVED_BASIS', 'RETENTION_UNDEFINED', 'VENDOR_UNREVIEWED', 'TRANSFER_WITHOUT_MECHANISM', 'DPO_NOT_APPOINTED', 'NOTICE_NOT_APPROVED', 'DEADLINE_NOT_CONFIGURED']) assert.ok(codes.has(c), c);
  assert.equal(C.maturity().level, 'L1', 'inventory exists; purpose/basis/retention not approved');
});
test('legal basis is never inferred: a code without APPROVED status and a named assessor does not count; CONSENT is not a default', () => {
  const c = J(BASE); const a = c.registries.legalBasisAssessments.find(x => x.processingPurposeId === 'MARKETING_COMMUNICATION'); a.legalBasisCode = 'CONSENT';
  withCfg(c, () => { assert.equal(C.approvedBasis('MARKETING_COMMUNICATION'), null); assert.deepEqual(J(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION' }).reasonCodes), ['NO_APPROVED_BASIS']); });
  a.status = 'APPROVED'; withCfg(c, () => assert.ok(C.validate().some(e => e.code === 'APPROVED_WITHOUT_EVIDENCE')));
  a.legalBasisCode = 'ACCEPT_ALL'; a.assessedBy = 'x'; a.rationale = 'y'; withCfg(c, () => assert.ok(C.validate().some(e => e.code === 'INVALID_LEGAL_BASIS_CODE')));
  for (const p of BASE.registries.purposes) assert.equal(C.mayProcess({ purposeId: p.id }).allowed, false, `${p.id} denied by default`);
  const g = J(BASE); g.lifecycle.retentionPolicies[0].duration = 'forever'; withCfg(g, () => assert.ok(C.validate().some(e => e.code === 'INVALID_DURATION')));
});
test('purpose boundary and progressive collection: CPF not in the lead, document id never for analytics', () => {
  const c = approved({ basis: { CONTRACT_PREPARATION: 'CONTRACT_OR_PRECONTRACTUAL_PROCEDURES', PRODUCT_ANALYTICS: 'LEGITIMATE_INTEREST', LEAD_INTAKE: 'LEGITIMATE_INTEREST' } });
  withCfg(c, () => {
    assert.ok(C.mayCollect('customer.cpf', { purposeId: 'CONTRACT_PREPARATION', stage: 'CLOSING' }).allowed);
    assert.ok(C.mayCollect('customer.cpf', { purposeId: 'CONTRACT_PREPARATION', stage: 'LEAD' }).reasonCodes.includes('COLLECTION_STAGE_TOO_EARLY'));
    assert.ok(C.mayCollect('customer.cpf', { purposeId: 'LEAD_INTAKE', stage: 'LEAD' }).reasonCodes.includes('FIELD_NOT_FOR_PURPOSE'));
    assert.ok(C.mayProcess({ purposeId: 'PRODUCT_ANALYTICS', categoryIds: ['DOCUMENT_IDENTIFIER'] }).reasonCodes.includes('CATEGORY_NOT_ALLOWED_FOR_PURPOSE'));
    assert.ok(C.mayProcess({ purposeId: 'PRODUCT_ANALYTICS', categoryIds: ['ANALYTICS_PSEUDONYMOUS'] }).allowed);
    assert.ok(C.mayCollect('unknown.field', { purposeId: 'LEAD_INTAKE' }).reasonCodes.includes('UNKNOWN_FIELD'));
  });
});

// ============================================================ consent (§449, §450, §462)
const MKT = () => approved({ basis: { MARKETING_COMMUNICATION: 'CONSENT', CUSTOMER_RELATIONSHIP: 'CONTRACT_OR_PRECONTRACTUAL_PROCEDURES', LEGAL_COMPLIANCE: 'LEGAL_OR_REGULATORY_OBLIGATION' } });
const TEXT = 'Autorizo receber ofertas do Viva Juara por WhatsApp. Posso revogar quando quiser.';
const notice = () => W.createNotice({ organizationId: 'org_house7', noticeType: 'MARKETING', version: '1.0.0', content: TEXT, approvedBy: 'juridico_teste', effectiveFrom: NOW }, O()).notice;
test('golden PrivacyConsentMarketingGranted: specific purpose + notice version + checksum + evidence → marketing allowed for that purpose only', () => withCfg(MKT(), () => {
  const nt = notice();
  assert.match(nt.checksum, /^sha256:[0-9a-f]{64}$/);
  const g = W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'ev_form_1' }, O());
  assert.ok(g.ok, g.code); assert.equal(g.record.noticeVersionId, nt.id); assert.equal(g.record.consentTextChecksum, nt.checksum);
  assert.ok(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION', categoryIds: ['CONTACT'], subjectRef: 'cus_1', consents: [g.record], now: NOW }).allowed);
  assert.deepEqual(J(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION', categoryIds: ['CONTACT'], subjectRef: 'cus_2', consents: [g.record], now: NOW }).reasonCodes), ['CONSENT_REQUIRED']);
  assert.equal(W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT + ' (editado)', captureMethod: 'WEB', evidenceRef: 'e' }, O()).code, 'NOTICE_CHECKSUM_MISMATCH');
  assert.equal(W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'ALL', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'e' }, O()).code, 'GENERIC_CONSENT_FORBIDDEN');
  assert.equal(W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT, captureMethod: 'WEB' }, O()).code, 'EVIDENCE_REQUIRED');
  assert.equal(W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'CUSTOMER_RELATIONSHIP', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'e' }, O()).code, 'CONSENT_NOT_LEGAL_BASIS', 'consent only where it is the validated basis');
  assert.equal(W.grantConsent({ organizationId: 'org_other', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'e' }, O()).code, 'CROSS_TENANT_DENIED');
  const sup = W.supersedeNotice(nt, { version: '1.0.0', content: TEXT }, O()); assert.equal(sup.code, 'NOTICE_VERSION_EXISTS', 'an accepted notice is never edited silently');
  assert.ok(W.supersedeNotice(nt, { version: '1.1.0', content: TEXT + ' v2', approvedBy: 'j' }, O()).retired.retiredAt);
}));
test('default config: consent cannot even be recorded (no approved basis)', () => {
  assert.equal(W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: { id: 'n', checksum: 'x', organizationId: 'org_house7' }, noticeText: 'x', captureMethod: 'WEB', evidenceRef: 'e' }, O()).code, 'NO_APPROVED_BASIS');
});
test('golden PrivacyConsentWithdrawn: marketing stops, data needed by another validated purpose is retained with reason, history kept', () => withCfg(MKT(), () => {
  const nt = notice(), g = W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'e' }, O()).record;
  const w = W.withdrawConsent(g, O({ activities: [{ id: 'PA_MKT_WA', purposeRef: 'MARKETING_COMMUNICATION' }, { id: 'PA_OTHER', purposeRef: 'CUSTOMER_RELATIONSHIP' }] }));
  assert.ok(w.ok); assert.equal(w.record.status, 'WITHDRAWN'); assert.equal(w.record.withdrawnAt, NOW); assert.equal(g.status, 'GRANTED', 'original proof is immutable (append-only history)');
  assert.deepEqual(J(w.result.stoppedProcessingActivities), ['PA_MKT_WA']);
  assert.deepEqual(J(w.result.retainedDataCategories.map(x => x.categoryId)).sort(), ['CONTACT', 'IDENTITY']);
  assert.match(w.result.retainedDataCategories[0].retentionReason, /CUSTOMER_RELATIONSHIP/);
  assert.deepEqual(J(w.result.deletionJobsCreated), []); assert.equal(w.result.retentionStatus, 'PRIVACY_REVIEW_REQUIRED');
  assert.deepEqual(J(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION', subjectRef: 'cus_1', consents: [g, w.record], now: NOW }).reasonCodes), ['CONSENT_WITHDRAWN']);
  assert.ok(C.mayProcess({ purposeId: 'CUSTOMER_RELATIONSHIP', categoryIds: ['CONTACT'], subjectRef: 'cus_1', consents: [g, w.record], now: NOW }).allowed, 'transactional relationship continues');
  assert.equal(W.withdrawConsent(w.record, O()).code, 'CONSENT_NOT_ACTIVE');
}));
test('golden PrivacyExpiredConsentNotUsed', () => withCfg(MKT(), () => {
  const nt = notice(), g = W.grantConsent({ organizationId: 'org_house7', subjectRef: 'cus_1', purposeId: 'MARKETING_COMMUNICATION', notice: nt, noticeText: TEXT, captureMethod: 'WEB', evidenceRef: 'e', expiresAt: '2026-10-01T00:00:00Z' }, O()).record;
  assert.deepEqual(J(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION', subjectRef: 'cus_1', consents: [g], now: NOW }).reasonCodes), ['CONSENT_EXPIRED']);
}));
test('communication preferences: marketing needs ALLOWED + basis; marketing opt-out never stops transactional messages; suppression stores only a hash', () => {
  const prefs = [{ subjectRef: 'cus_1', channel: 'WHATSAPP', purpose: 'MARKETING', state: 'NOT_ALLOWED', updatedAt: NOW, source: 'cliente' }];
  const m = W.canContact({ preferences: prefs, subjectRef: 'cus_1', channel: 'WHATSAPP', purpose: 'MARKETING' });
  assert.equal(m.allowed, false); assert.equal(m.label, 'Marketing WhatsApp: não permitido');
  assert.equal(W.canContact({ preferences: [], subjectRef: 'cus_1', channel: 'EMAIL', purpose: 'MARKETING' }).reason, 'UNKNOWN', 'UNKNOWN is never ALLOWED');
  assert.ok(W.canContact({ preferences: prefs, subjectRef: 'cus_1', channel: 'WHATSAPP', purpose: 'TRANSACTIONAL' }).allowed);
  const s = W.suppression('(48) 99999-1234', 'WHATSAPP', 'MARKETING', 'OPT_OUT', O()).suppression;
  assert.ok(!JSON.stringify(s).includes('99999')); assert.match(s.normalizedContactHash, /^[0-9a-f]{64}$/);
  assert.equal(W.canContact({ preferences: [{ ...prefs[0], state: 'ALLOWED', basisRef: 'cns_1' }], suppressions: [s], subjectRef: 'cus_1', contact: '48999991234', channel: 'WHATSAPP', purpose: 'MARKETING' }).reason, 'SUPPRESSED');
  assert.equal(V.contactSignal(m), '<span class="small privacy-signal" data-allowed="false">Marketing WhatsApp: não permitido</span>');
});

// ============================================================ data subject requests (§451, §452, §459)
const newReq = (type = 'ACCESS', subjectRef = 'cus_1') => W.createRequest(CTX, { requestType: type, subjectRef, channel: 'EMAIL' }, O()).request;
function verified(type) {
  let r = newReq(type); r = W.transition(CTX, r, 'IDENTITY_VERIFICATION', O()).request;
  const method = ['ACCESS', 'DELETION', 'ANONYMIZATION', 'PORTABILITY'].includes(type) ? 'DOCUMENT_CHECK_BY_DPO' : 'KNOWN_CONTACT_CONFIRMATION';
  const v = W.completeVerification(W.startVerification(r, method, O()).verification, 'VERIFIED', O({ evidenceRef: 'ev_1' })).verification;
  return W.transition(CTX, r, 'IN_REVIEW', O({ verification: v, expectedRevision: r.revision })).request;
}
test('DataSubjectRequest: deadline from the registry (null → NOT_CONFIGURED, never a default), state machine, proportional identity verification, denial needs a reason', () => {
  const r = newReq();
  assert.equal(r.status, 'RECEIVED'); assert.equal(r.dueAt, null); assert.equal(r.deadlineStatus, 'NOT_CONFIGURED'); assert.equal(r.audit[0].type, 'RECEIVED');
  assert.equal(W.createRequest(CTX, { requestType: 'ACCESS', subjectRef: 'maria@example.com' }, O()).code, 'VALIDATION_ERROR', 'no PII as subjectRef');
  assert.equal(W.createRequest(CTX, { requestType: 'FOO' }, O()).code, 'VALIDATION_ERROR');
  const iv = W.transition(CTX, r, 'IDENTITY_VERIFICATION', O()).request;
  assert.equal(W.transition(CTX, iv, 'IN_REVIEW', O()).code, 'IDENTITY_NOT_VERIFIED');
  assert.equal(W.startVerification(iv, 'KNOWN_CONTACT_CONFIRMATION', O()).code, 'VERIFICATION_NOT_PROPORTIONAL', 'ACCESS is HIGH risk');
  assert.ok(W.startVerification(newReq('CONSENT_WITHDRAWAL'), 'KNOWN_CONTACT_CONFIRMATION', O()).ok, 'no document overcollection for a simple request (§74)');
  const failed = W.completeVerification(W.startVerification(iv, 'DOCUMENT_CHECK_BY_DPO', O()).verification, 'FAILED', O()).verification;
  assert.equal(W.transition(CTX, iv, 'IN_REVIEW', O({ verification: failed })).code, 'IDENTITY_NOT_VERIFIED');
  assert.equal(W.transition(CTX, iv, 'DENIED_WITH_REASON', O()).code, 'DENIAL_REASON_REQUIRED');
  const den = W.transition(CTX, iv, 'DENIED_WITH_REASON', O({ denialReasonCode: 'IDENTITY_NOT_VERIFIED' })).request;
  assert.equal(den.status, 'DENIED_WITH_REASON'); assert.equal(den.completedAt, NOW);
  assert.equal(W.transition(CTX, den, 'IN_REVIEW', O()).code, 'INVALID_TRANSITION', 'terminal');
  assert.equal(W.transition(CTX, iv, 'CANCELLED', O({ expectedRevision: '1' })).code, 'REVISION_CONFLICT');
  const c = approved({ deadlines: { DSR_ACCESS: { businessDays: 10 } } });
  withCfg(c, () => { const x = newReq(); assert.equal(x.deadlineStatus, 'CONFIGURED'); assert.equal(x.dueAt, '2026-10-30T12:00:00.000Z'); });
  for (const t of W.REQUEST_TYPES) assert.ok(C.deadlineRuleFor(t), 'deadline rule row for ' + t);
  assert.ok(W.REQUEST_TYPES.includes('AUTOMATED_DECISION_REVIEW'));
});
test('golden PrivacyAccessRequest: identity verified → domains searched (one failing) → redacted package with checksum, third-party data excluded', async () => {
  const r = verified('ACCESS');
  const locators = [
    { domain: 'customer', locate: async (t, s) => [{ subjectRef: s, dataCategoryId: 'IDENTITY', data: { 'customer.displayName': 'Maria Souza', 'auth.subjectHash': 'abc' } }] },
    { domain: 'journey', locate: async (t, s) => [{ subjectRef: s, dataCategoryId: 'COMMUNICATION_HISTORY', otherSubjects: ['João Lima'], data: { 'customer.notes': 'Visitou com João Lima o lote B79' } }, { subjectRef: 'cus_9', dataCategoryId: 'IDENTITY', data: { x: 1 } }] },
    { domain: 'documents', locate: async () => { throw new Error('offline'); } }
  ];
  const d = await W.discover(CTX, r, locators, O());
  assert.ok(d.ok); assert.deepEqual(J(d.searchedDomains), ['customer', 'journey']); assert.deepEqual(J(d.failedDomains), ['documents']);
  const p = W.accessPackage(r, d.locations, O()).package;
  assert.match(p.checksum, /^sha256:/); assert.equal(W.accessPackage(r, d.locations, O()).package.checksum, p.checksum, 'deterministic');
  const txt = JSON.stringify(p);
  assert.ok(txt.includes('Maria Souza')); assert.ok(!txt.includes('João Lima'), 'redaction of another person'); assert.ok(txt.includes('[outra pessoa]'));
  assert.ok(!p.domains.some(d => d.records.some(x => 'auth.subjectHash' in x.data)), 'non-exportable internal field excluded');
  assert.deepEqual(J(p.excludedData.map(x => x.reasonCode)).sort(), ['NOT_EXPORTABLE', 'THIRD_PARTY_DATA']);
  assert.equal((await W.discover(CTX, newReq(), locators, O())).code, 'IDENTITY_NOT_VERIFIED');
});
test('golden PrivacyCrossTenantRightsDenied: another tenant gets NOT_FOUND (existence not revealed)', async () => {
  const r = newReq();
  assert.equal(W.transition(OTHER, r, 'IDENTITY_VERIFICATION', O()).code, 'NOT_FOUND');
  assert.equal((await W.discover(OTHER, verified('ACCESS'), [], O())).code, 'NOT_FOUND');
  const h = W.createLegalHold(CTX, { subjectRef: 'cus_1', reason: 'Processo judicial 123' }, O()).hold;
  assert.equal(W.releaseLegalHold(OTHER, h, O()).code, 'NOT_FOUND');
  assert.equal(W.createRequest({}, { requestType: 'ACCESS' }, O()).code, 'TENANT_CONTEXT_REQUIRED');
});
test('golden PrivacyCorrectionRequest: correction goes to the owner systems and propagation is tracked', () => {
  const r = verified('CORRECTION');
  let p = W.planCorrection(r, { fieldKey: 'customer.phone', systems: ['customer', 'crm_external'] }).propagation;
  assert.equal(W.propagationDone(p), false);
  p = W.markTarget(p, 'customer', 'COMPLETED', 'rev_7'); assert.equal(W.propagationDone(p), false);
  p = W.markTarget(p, 'crm_external', 'COMPLETED', 'crm_ack'); assert.ok(W.propagationDone(p));
  assert.equal(W.planCorrection(newReq('CORRECTION'), { fieldKey: 'customer.phone' }).code, 'IDENTITY_NOT_VERIFIED');
});

// ============================================================ deletion, retention, holds (§453–456)
const LOCS = [{ domain: 'customer', dataCategoryId: 'CONTACT' }, { domain: 'customer', dataCategoryId: 'IDENTITY' }, { domain: 'journey', dataCategoryId: 'COMMERCIAL_HISTORY' }];
test('default config: deletion plan is REQUIRES_REVIEW (nothing deleted, nothing kept "forever") and cannot be approved', () => {
  const plan = W.planDeletion(verified('DELETION'), { locations: LOCS }).plan;
  assert.equal(plan.status, 'REQUIRES_REVIEW'); assert.ok(plan.actions.every(a => a.action === 'RETAIN' && a.reason === 'PRIVACY_REVIEW_REQUIRED'));
  assert.equal(W.approvePlan(plan, 'dpo').code, 'PLAN_REQUIRES_REVIEW');
});
const DEL_OK = () => approved({ retention: { RET_CUSTOMER_CONTACT: { duration: 'P1Y', retainOnErasureRequest: false, disposition: 'DELETE' }, RET_CUSTOMER_CORE: { duration: 'P1Y', retainOnErasureRequest: false, disposition: 'ANONYMIZE' }, RET_COMMERCIAL_HISTORY: { duration: 'P1Y', retainOnErasureRequest: false, disposition: 'DELETE' } } });
test('golden PrivacyDeletionRequestNoLegalHold: eligible data deleted/anonymized, idempotent, tombstones keep no value', async () => withCfgAsync(DEL_OK(), async () => {
  const r = verified('DELETION'), plan = W.planDeletion(r, { locations: LOCS }).plan;
  assert.equal(plan.status, 'READY_FOR_APPROVAL');
  assert.deepEqual(J(plan.actions.map(a => a.action)), ['DELETE', 'ANONYMIZE', 'DELETE']);
  assert.equal((await W.executePlan(plan, {})).code, 'PLAN_NOT_APPROVED');
  const ap = W.approvePlan(plan, 'usr_dpo').plan, calls = [];
  const adapters = { customer: { execute: async a => { calls.push(a[0].dataCategory); return { evidenceRef: 'del_' + a[0].dataCategory }; } }, journey: { execute: async a => { calls.push(a[0].dataCategory); return {}; } } };
  const x1 = await W.executePlan(ap, adapters, O());
  assert.equal(x1.failed, 0); assert.equal(calls.length, 3); assert.equal(x1.tombstones.length, 3);
  for (const t of x1.tombstones) assert.deepEqual(Object.keys(t).sort(), ['createdAt', 'dataCategoryRef', 'expiresAt', 'reasonRef', 'subjectRef']);
  const x2 = await W.executePlan(ap, adapters, O({ alreadyDone: x1.done }));
  assert.equal(calls.length, 3, 'repeated job is safe (no second delete)'); assert.ok(x2.propagation.targets.every(t => t.status === 'COMPLETED'));
}));
test('golden PrivacyDeletionRequestWithTransactionRetention: extras removed, legally retained transaction fields stay with the reason', () => {
  const c = DEL_OK(); Object.assign(c.lifecycle.retentionPolicies.find(r => r.id === 'RET_COMMERCIAL_HISTORY'), { retainOnErasureRequest: true, legalRationale: 'Obrigação legal de guarda do contrato (fixture).' });
  withCfg(c, () => {
    const plan = W.planDeletion(verified('DELETION'), { locations: LOCS }).plan, hist = plan.actions.find(a => a.dataCategory === 'COMMERCIAL_HISTORY');
    assert.equal(hist.action, 'RETAIN'); assert.equal(hist.reason, 'LEGAL_RETENTION_REQUIRED'); assert.match(hist.explanation, /Obrigação legal/);
    assert.equal(plan.actions.find(a => a.dataCategory === 'CONTACT').action, 'DELETE');
  });
});
test('golden PrivacyLegalHoldBlocksDeletion: retained category + reason; the hold never authorizes marketing', () => {
  const c = approved({ basis: { MARKETING_COMMUNICATION: 'LEGITIMATE_INTEREST', LEGAL_COMPLIANCE: 'LEGAL_OR_REGULATORY_OBLIGATION' } });
  Object.assign(c.lifecycle.retentionPolicies.find(r => r.id === 'RET_CUSTOMER_CONTACT'), { approvedBy: 'j', duration: 'P1Y', retainOnErasureRequest: false });
  withCfg(c, () => {
    assert.equal(W.createLegalHold(CTX, { subjectRef: 'cus_1', reason: '' }, O()).code, 'REASON_REQUIRED');
    const hold = W.createLegalHold(CTX, { subjectRef: 'cus_1', dataCategoryIds: ['CONTACT'], reason: 'Ação judicial nº 0001', retainedForDeletion: true }, O()).hold;
    const a = W.planDeletion(verified('DELETION'), { locations: [LOCS[0]], holds: [hold] }).plan.actions[0];
    assert.equal(a.action, 'RETAIN'); assert.equal(a.reason, 'LEGAL_HOLD'); assert.match(a.explanation, /Ação judicial/);
    assert.ok(C.mayProcess({ purposeId: 'MARKETING_COMMUNICATION', categoryIds: ['CONTACT'], subjectRef: 'cus_1', holds: [hold] }).reasonCodes.includes('LEGAL_HOLD_PURPOSE_ONLY'));
    assert.ok(C.mayProcess({ purposeId: 'LEGAL_COMPLIANCE', categoryIds: ['IDENTITY'], subjectRef: 'cus_1', holds: [hold] }).allowed);
    assert.equal(W.operationalState('cus_1', { holds: [hold] }), 'LEGAL_HOLD');
    const rel = W.releaseLegalHold(CTX, hold, O()).hold; assert.equal(rel.status, 'RELEASED'); assert.equal(W.releaseLegalHold(CTX, rel, O()).code, 'HOLD_NOT_ACTIVE');
    const ra = W.planDeletion(verified('DELETION'), { locations: [LOCS[0]], holds: [rel] }).plan.actions[0]; assert.equal(ra.action, 'DELETE');
  });
});
test('golden PrivacyDeletedSubjectNotReimported + processing block', () => {
  const t = W.tombstone('cus_1', 'IDENTITY', 'dsr_1', O());
  assert.deepEqual(J(W.guardImport({ subjectRef: 'cus_1' }, { tombstones: [t] })), { accepted: false, reason: 'SUBJECT_DELETED_TOMBSTONE' });
  const s = W.suppression('maria@example.com', 'EMAIL', 'ALL', 'DELETED', O()).suppression;
  assert.equal(W.guardImport({ contact: ' Maria@Example.com ', channel: 'EMAIL' }, { suppressions: [s] }).reason, 'CONTACT_SUPPRESSED');
  assert.ok(W.guardImport({ subjectRef: 'cus_2' }, { tombstones: [t] }).accepted);
  const c = approved({ basis: { LOT_RECOMMENDATION: 'LEGITIMATE_INTEREST' } });
  withCfg(c, () => {
    const b = W.createBlock({ subjectRef: 'cus_3', processingPurposeIds: ['LOT_RECOMMENDATION'], reason: 'Oposição do titular' }, O()).block;
    assert.ok(C.mayProcess({ purposeId: 'LOT_RECOMMENDATION', categoryIds: ['CUSTOMER_PREFERENCE'], subjectRef: 'cus_3', blocks: [b], now: NOW }).reasonCodes.includes('PROCESSING_BLOCKED'));
    assert.ok(C.mayProcess({ purposeId: 'LOT_RECOMMENDATION', categoryIds: ['CUSTOMER_PREFERENCE'], subjectRef: 'cus_4', blocks: [b], now: NOW }).allowed);
    assert.ok(C.mayProcess({ purposeId: 'LOT_RECOMMENDATION', categoryIds: ['CUSTOMER_PREFERENCE'], subjectRef: 'cus_1', tombstones: [W.tombstone('cus_1', 'CUSTOMER_PREFERENCE', 'x', O())] }).reasonCodes.includes('DELETED_SUBJECT'));
    assert.equal(W.operationalState('cus_3', { blocks: [b], now: NOW }), 'PROCESSING_BLOCKED');
  });
});
test('retention dry-run: unknown retention → review (never deleted); approved policy → candidates, holds counted, approval required without threshold', () => {
  const recs = [{ domain: 'customer', subjectRef: 'cus_1', dataCategoryId: 'CONTACT', triggerAt: '2024-01-01T00:00:00Z' }, { domain: 'customer', subjectRef: 'cus_2', dataCategoryId: 'CONTACT', triggerAt: '2024-01-01T00:00:00Z' }, { domain: 'customer', subjectRef: 'cus_3', dataCategoryId: 'CONTACT', triggerAt: '2026-10-01T00:00:00Z' }];
  const d0 = W.retentionDryRun(recs, O()); assert.equal(d0.requiresReview, 3); assert.equal(d0.candidates, 0);
  withCfg(DEL_OK(), () => {
    const hold = W.createLegalHold(CTX, { subjectRef: 'cus_2', reason: 'Processo 99' }, O()).hold;
    const d = W.retentionDryRun(recs, O({ holds: [hold] }));
    assert.equal(d.candidates, 1); assert.equal(d.legalHolds, 1); assert.equal(d.notDue, 1); assert.equal(d.approvalRequired, true);
  });
});

// ============================================================ vendors, transfers, incidents (§460, §461, §465)
const VEN = { id: 'V_TEST', name: 'Provedor X', agreementRef: 'dpa_1', securityAssessmentRef: 'sa_1', processingRole: 'OPERATOR', hostingRegions: ['US'], status: 'PENDING_REVIEW' };
test('golden PrivacyInternationalTransferRequiresMechanism', () => {
  assert.deepEqual(J(W.approveVendor(VEN).missing), ['INTERNATIONAL_TRANSFER_MECHANISM']);
  assert.ok(W.approveVendor({ ...VEN, hostingRegions: [] }).missing.includes('HOSTING_REGION_UNKNOWN'), 'unknown region is never assumed Brazil');
  assert.ok(W.approveVendor(VEN, { transfers: [{ importerRef: 'V_TEST', status: 'UNDER_REVIEW', mechanism: 'STANDARD_CONTRACTUAL_CLAUSES', mechanismEvidenceRef: 'scc_1' }] }).missing);
  assert.equal(W.approveVendor(VEN, { transfers: [{ importerRef: 'V_TEST', status: 'ACTIVE', mechanism: 'EQUIVALENT_CLAUSE', mechanismEvidenceRef: 'x' }] }).ok, false, 'no self-made "equivalent" mechanism (§132)');
  assert.equal(W.approveVendor(VEN, { transfers: [{ importerRef: 'V_TEST', status: 'ACTIVE', mechanism: 'STANDARD_CONTRACTUAL_CLAUSES', mechanismEvidenceRef: 'scc_1' }] }).vendor.status, 'APPROVED');
  for (const v of BASE.thirdParties.vendors) assert.equal(W.approveVendor(v).ok, false, v.id);
  assert.equal(W.regionChanged({ ...VEN, status: 'APPROVED' }, ['US', 'IE']).status, 'PENDING_REVIEW');
  assert.equal(W.filterOutbound('V_CRM_EXTERNAL', { 'customer.displayName': 'Maria' }).code, 'VENDOR_NOT_APPROVED');
  const c = J(BASE); c.thirdParties.vendors.find(v => v.id === 'V_CRM_EXTERNAL').status = 'APPROVED'; c.thirdParties.integrationPolicies[0].allowedDataFields = ['customer.displayName', 'customer.cpf'];
  withCfg(c, () => { const f = W.filterOutbound('V_CRM_EXTERNAL', { 'customer.displayName': 'Maria', 'customer.cpf': '123', 'customer.notes': 'x' }); assert.deepEqual(J(f.payload), { 'customer.displayName': 'Maria' }); assert.deepEqual(J(f.dropped).sort(), ['customer.cpf', 'customer.notes']); });
  assert.equal(W.filterOutbound('NOPE', { a: 1 }).code, 'NO_INTEGRATION_POLICY');
});
test('golden PrivacyVendorTerminationPurgesAccess: credentials removed + deletion confirmation tracked', () => {
  const p = W.offboardVendor({ ...VEN, status: 'APPROVED' }, { accessRevoked: true, tokensRevoked: false });
  assert.equal(p.ok, false); assert.equal(p.vendor.status, 'SUSPENDED'); assert.deepEqual(J(p.checklist.pending), ['TOKEN_REVOKE', 'DATA_RETURN_OR_DELETION_CONFIRMATION']);
  const d = W.offboardVendor({ ...VEN, status: 'APPROVED' }, { accessRevoked: true, tokensRevoked: true, dataReturnOrDeletionEvidenceRef: 'cert_1' });
  assert.ok(d.ok); assert.equal(d.vendor.status, 'TERMINATED');
});
test('golden PrivacyIncidentNotificationDeadline: computed from the registry; null registry → NOT_CONFIGURED with the spec reference', () => {
  const si = { id: 'sec_1', organizationId: 'org_house7', discoveredAt: '2026-10-15T10:00:00Z' };
  assert.equal(W.fromSecurityIncident(si, { personalDataAffected: false }).route, 'SECURITY_ONLY');
  let c = W.fromSecurityIncident(si, { personalDataAffected: true, dataCategoryIds: ['CONTACT'], controllerAwarenessAt: '2026-10-16T09:00:00Z' }, O()).case; // Friday
  const d0 = W.notificationDeadlines(c);
  assert.equal(d0.authority.status, 'NOT_CONFIGURED'); assert.equal(d0.authority.dueAt, null); assert.equal(d0.authority.referenceFromSpec.businessDays, 3);
  withCfg(approved({ deadlines: { INCIDENT_NOTIFICATION_ANPD: { businessDays: 3 }, INCIDENT_NOTIFICATION_SUBJECTS: { businessDays: 3 } } }), () => {
    const d = W.notificationDeadlines(c);
    assert.equal(d.authority.dueAt, '2026-10-21T09:00:00.000Z', 'Fri + 3 business days = Wed'); assert.deepEqual(J(d.authority.warnings), ['HOLIDAYS_NOT_CONFIGURED']);
  });
  assert.equal(W.moveIncident(c, 'CLOSED').code, 'NOTIFICATION_DECISION_PENDING');
  c = W.assessIncident(c, { riskOrRelevantHarm: 'YES', assessedBy: 'usr_dpo', dataTypes: ['CONTACT'] }, O()).case; assert.equal(c.notificationDecision, 'REQUIRED');
  c = W.moveIncident(c, 'NOTIFYING').case; assert.equal(W.moveIncident(c, 'CLOSED').code, 'NOTIFICATION_EVIDENCE_REQUIRED');
  c = W.recordNotification(c, { target: 'AUTHORITY', content: 'Comunicação preliminar', channel: 'PETICIONAMENTO_ANPD', recipientScope: 'ANPD', preliminary: true }, O()).case;
  c = W.recordNotification(c, { target: 'SUBJECTS', content: 'Aviso aos titulares', channel: 'EMAIL', recipientScope: 'titulares afetados' }, O()).case;
  assert.equal(W.moveIncident(c, 'CLOSED').case.status, 'CLOSED'); assert.ok(!JSON.stringify(c.notifications).includes('Aviso aos titulares'), 'evidence keeps checksum, not a dataset copy');
});

// ============================================================ product guardrails (§457, §458, §463, §464, §466, §467)
test('golden PrivacyAnalyticsRejectsEmail (reuses the topic 45 analytics privacy policy)', () => {
  const r = C.analyticsPayloadCheck({ routeCode: 'MAP', email: 'maria@example.com', note: 'ligar 48 99999-1234' });
  assert.equal(r.ok, false); assert.ok(r.findings.some(f => f.code === 'FORBIDDEN_KEY' && f.path === 'email')); assert.ok(r.findings.some(f => f.code === 'PHONE_BR'));
  assert.ok(C.analyticsPayloadCheck({ routeCode: 'MAP', lotCount: 3 }).ok);
});
test('golden PrivacyShareProjectionNoInternalNotes: the real client-safe lot card drops injected notes/customer fields', async () => {
  const repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const lot = JSON.parse(JSON.stringify(repo.getLotByCode('B79'))); lot.internalNotes = 'cliente com problema de saúde'; lot.customerName = 'Maria'; lot.cpf = '123.456.789-09';
  const card = App.presentationMode.projection.lotCard(lot, { mode: 'client' });
  assert.ok(C.checkClientSafe(card).ok, JSON.stringify(C.checkClientSafe(card).leaks));
  const leak = C.checkClientSafe({ title: 'B79', notes: 'interno', contact: 'maria@example.com' });
  assert.deepEqual(J(leak.leaks.map(l => l.code)).sort(), ['EMAIL', 'FORBIDDEN_KEY']);
  assert.equal(C.mayShare('customer.notes', 'CLIENT').allowed, false); assert.equal(C.mayShare('customer.cpf', 'CLIENT').allowed, false);
});
test('golden PrivacySensitiveCriterionRejected: every real recommendation criterion is allowlisted; sensitive traits never', () => {
  for (const t of ['religion', 'health', 'saude', 'raca', 'sexualOrientation', 'politicalOpinion', 'filhos']) assert.equal(C.evaluateCriterion(t).allowed, false, t);
  assert.equal(C.evaluateCriterion('xyzUnknown').reason, 'NOT_ALLOWLISTED');
  const fields = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'customer', 'policy.json'), 'utf8')).profileBuilderGroups.flatMap(g => g.fields);
  for (const f of fields) { const e = C.evaluateCriterion(f); assert.ok(e.allowed, f); assert.equal(e.reason, 'ALLOWLISTED_PENDING_REVIEW', 'reviewedBy null = still pending review'); }
  const g = C.assessChange({ featureRef: 'rec.v2', recommendationCriteria: ['religiao'] }); assert.equal(g.status, 'BLOCKED');
});
test('golden PrivacyOfflineCustomerDataNotPersisted: no high-risk data in browser storage, customer PII not offline', () => {
  for (const f of ['customer.cpf', 'customer.notes', 'auth.subjectHash']) assert.equal(C.mayPersist(f, 'BROWSER').allowed, false, f);
  assert.deepEqual(J(C.mayPersist('customer.displayName', 'OFFLINE').reasonCodes), ['CUSTOMER_OFFLINE_NOT_APPROVED']);
  assert.ok(C.mayPersist('LOT_DATA', 'OFFLINE').allowed);
  const cp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'customer', 'policy.json'), 'utf8')).organizations.org_house7.offlinePolicy;
  assert.deepEqual([cp.allowContactCache, cp.allowProfileCache, cp.allowNotesCache], [false, false, false], 'topic 39 offline policy agrees');
});
test('golden PrivacyMinorCustomerReview and PrivacyDocumentExtractionAllowlist', () => {
  assert.equal(C.subjectReview({ birthDate: '2010-05-01', now: NOW }).status, 'PRIVACY_REVIEW_REQUIRED');
  assert.equal(C.subjectReview({ birthDate: '1990-05-01', now: NOW }).status, 'NORMAL');
  assert.equal(C.subjectReview({ declaredMinor: true }).operationalState, 'PRIVACY_REVIEW');
  const x = C.filterExtraction('IDENTITY_DOCUMENT', { name: 'Maria', cpf: '1', motherName: 'Ana', photo: 'b64' });
  assert.deepEqual(J(x.kept), {}); assert.equal(x.status, 'NOTHING_ALLOWED_YET');
  const c = J(BASE); c.policies.documentExtraction[0].allowedFieldKeys = ['name', 'cpf'];
  withCfg(c, () => { const y = C.filterExtraction('IDENTITY_DOCUMENT', { name: 'Maria', cpf: '1', motherName: 'Ana' }); assert.deepEqual(J(y.kept), { name: 'Maria', cpf: '1' }); assert.deepEqual(J(y.dropped), ['motherName']); });
  assert.equal(C.filterExtraction('UNKNOWN_DOC', { a: 1 }).status, 'NO_POLICY');
});
test('masking, log policy, PII in URLs/keys, denial text never reveals existence', () => {
  assert.equal(C.maskCpf('123.456.789-12'), '***.***.***-12'); assert.equal(C.maskPhone('(48) 99999-1234'), '(**) *****-1234'); assert.equal(C.maskEmail('maria@example.com'), 'm***@example.com'); assert.equal(C.maskName('Maria Souza Lima'), 'Maria S. L.');
  assert.equal(C.maskField('customer.cpf', '12345678912').value, '***.***.***-12');
  assert.equal(C.maskField('customer.notes', 'nota').value, 'Não disponível');
  assert.equal(C.maskField('legacyCustomer.profile.constraints.budget', 500000).value, 'Não disponível');
  assert.equal(C.maskField('legacyCustomer.profile.constraints.budget', 500000, { permissions: ['customer_profile.manage'] }).value, 500000);
  assert.equal(C.maskField('customer.phone', null).value, null, 'null stays null');
  const s = C.sanitizeForLog({ cpf: '1', authToken: 'x', password: 'p', email: 'a@b.co', customerId: 'cus_1', msg: 'mail maria@example.com', nested: { phone: '48999991234', lotId: 'VJ-QB-L0079' } });
  assert.deepEqual(Object.keys(s).sort(), ['customerId', 'email', 'msg', 'nested']); assert.equal(s.email, '[e-mail removido]'); assert.match(s.customerId, /^h_[0-9a-f]{8}$/); assert.equal(s.msg, '[removido]'); assert.equal(s.nested.lotId, 'VJ-QB-L0079');
  assert.ok(C.piiInUrl('https://x.test/?cpf=1').includes('FORBIDDEN_PARAM:cpf')); assert.ok(C.piiInUrl('https://x.test/#a?e=maria%40example.com').includes('EMAIL'));
  assert.deepEqual(C.piiInUrl('https://x.test/#viva-juara.lots.B79'), []);
  assert.ok(C.piiInKey('cache:maria@example.com')); assert.ok(!C.piiInKey('org:org_house7:dev:viva-juara'));
  const cap = C.capability({ authenticated: true, tenantOk: true, permission: 'customer_profile.manage', permissions: [] });
  assert.equal(cap.canView, false); assert.equal(cap.message, 'Não disponível'); assert.deepEqual(J(cap.reasonCodes), ['PERMISSION_DENIED']);
  assert.ok(C.mayExport('customer.phone', { bulk: true, permissions: [] }).reasonCodes.includes('PERMISSION_DENIED'));
});
test('privacy change gate, exceptions always expire, sensitive note warning (advisory), profiling truthfulness', () => {
  assert.equal(C.assessChange({ featureRef: 'whatsapp.crm', newRecipients: ['V_CRM_EXTERNAL'], newPurposes: ['MARKETING_COMMUNICATION'] }).status, 'REVIEW_REQUIRED');
  assert.equal(C.assessChange({ featureRef: 'x', newRecipients: ['V_CRM_EXTERNAL'], newTransfers: ['TR_X'] }).status, 'BLOCKED');
  assert.equal(C.assessChange({ featureRef: 'ui.color' }).status, 'PASS');
  assert.equal(C.exceptionStatus({ policyCode: 'X', reason: 'r', approvedBy: 'a' }), 'INVALID', 'no permanent temporary exception');
  assert.equal(C.exceptionStatus({ policyCode: 'NO_APPROVED_BASIS', reason: 'r', approvedBy: 'a', expiresAt: '2027-01-01' }, { now: NOW }), 'INVALID', 'legal blocker not casually waivable');
  assert.equal(C.exceptionStatus({ policyCode: 'X', reason: 'r', approvedBy: 'a', expiresAt: '2026-01-01' }, { now: NOW }), 'EXPIRED');
  const w = C.sensitiveTextWarning('Cliente comentou sobre tratamento médico do filho'); assert.ok(w.warn); assert.equal(w.message, 'Registre somente informação necessária ao atendimento.');
  assert.equal(C.sensitiveTextWarning('Prefere lote de esquina').warn, false);
  const c = J(BASE); delete c.policies.profiling[0].humanInTheLoopEvidence; withCfg(c, () => assert.ok(C.validate().some(e => e.code === 'HUMAN_IN_THE_LOOP_WITHOUT_EVIDENCE')));
  const m = W.metrics({ requests: [newReq(), { ...newReq(), status: 'COMPLETED' }], vendors: BASE.thirdParties.vendors, now: NOW });
  assert.equal(m.data_subject_requests_open, 1); assert.equal(m.data_subject_requests_without_deadline, 1); assert.ok(!JSON.stringify(m).includes('cus_'), 'metrics carry no identity');
});

// ============================================================ device data map (real code) + Privacy Center
test('data map fitness: every storage key literal in plat/src is in the device inventory', () => {
  const NOT_STORAGE = new Set(['ws-cache-coherence', 'ws-sync']); // BroadcastChannel name, Background Sync tag
  const lits = new Set();
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'privacy') walk(p); } else if (f.endsWith('.js')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]((?:vj|ws)-[a-z0-9:-]*)['"`]/g)) lits.add(m[1]); } };
  walk(SRC);
  assert.ok(lits.size >= 20);
  for (const k of lits) { if (NOT_STORAGE.has(k)) continue; const probe = /[-:]$/.test(k) ? k + 'x' : k; assert.ok(['LOCAL_STORAGE', 'INDEXED_DB', 'CACHE_STORAGE'].some(kind => D.entryOf(kind, probe)), 'uncatalogued storage key ' + k); }
  assert.ok(D.entryOf('LOCAL_STORAGE', App.store.keyOf('viva-juara')), 'store key');
  assert.ok(D.entryOf('LOCAL_STORAGE', App.tenancy.storageKey('org_house7', 'viva-juara')));
  assert.ok(D.entryOf('LOCAL_STORAGE', App.favorites.nsKey('org_house7', 'dev_abc123', 'viva-juara')));
  for (const id of ['LPF_LOCAL_CUSTOMER_NAMES', 'LPF_SHARE_NAME_IN_URL']) assert.ok(BASE.governance.legacyFindings.some(f => f.id === id));
  assert.match(App.services.share.whatsappUrl('Olá, Maria!'), /Maria/, 'LPF_SHARE_NAME_IN_URL is real (documented, behaviour unchanged)');
});
function fakeStorage(init = {}) { const m = new Map(Object.entries(init)); return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
const STATE = () => JSON.stringify({ v: 3, savedAt: NOW, prefs: { customers: [{ id: 'c1', name: 'Maria Souza', lots: ['VJ-QB-L0079'], profile: { constraints: { budget: 500000 } } }], preferences: { solar: 1 }, constraints: { budget: 500000 }, favorites: ['VJ-QB-L0079'], scoreKey: 'housing', baseMapBlend: 0.42 }, session: { currentCustomerId: 'c1', currentLotId: 'VJ-QB-L0079' } });
test('Privacy Center: scan finds the local customer names, export packages this device only, erase PERSONAL keeps UI prefs, erase ALL clears the inventory', async () => {
  const s = fakeStorage({ 'ws:viva-juara:state': STATE(), 'vj-device-id': 'dev_abc123', 'ws:viva-juara:layout:desktop': '{}', 'fav:v1:org_house7:dev_abc123:viva-juara': '{"items":[]}', 'ws-pwa-install': '{}', 'other-app': '1' });
  const sc = D.scan({ localStorage: s, indexedDBNames: ['ws-favorites', 'ws-cache'], cacheNames: ['ws-shell-123'] });
  assert.equal(sc.summary.unknown, 1); assert.ok(sc.findings.some(f => f.issueType === 'NO_BASIS_RECORD' && f.count === 1));
  assert.ok(!JSON.stringify(sc).includes('Maria'), 'scan never copies values');
  const ex = D.exportLocal({ localStorage: s, indexedDBNames: ['ws-favorites'], now: NOW });
  assert.equal(ex.filename, 'dados-deste-aparelho-2026-10-16.json'); assert.ok(JSON.stringify(ex.package).includes('Maria Souza')); assert.match(ex.package.checksum, /^sha256:/);
  assert.ok(!ex.package.items.some(i => i.key === 'ws:viva-juara:layout:desktop'), 'only personal entries');
  const deleted = [], idb = { deleteDatabase: nm => { deleted.push(nm); const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; } };
  const e1 = await D.eraseLocal({ localStorage: s, indexedDB: idb, scope: 'PERSONAL' });
  assert.ok(e1.ok); assert.deepEqual(J(e1.rewrittenKeys), ['ws:viva-juara:state']); assert.ok(e1.removedKeys.includes('fav:v1:org_house7:dev_abc123:viva-juara'));
  const st = JSON.parse(s.getItem('ws:viva-juara:state'));
  assert.equal(st.prefs.customers, undefined); assert.equal(st.prefs.constraints, undefined); assert.equal(st.session.currentCustomerId, undefined); assert.equal(st.prefs.scoreKey, 'housing', 'UI prefs kept'); assert.equal(st.session.currentLotId, 'VJ-QB-L0079');
  assert.equal(s.getItem('vj-device-id'), 'dev_abc123'); assert.deepEqual(J(deleted).sort(), ['vj-analytics', 'ws-favorites', 'ws-pwa-queue']);
  assert.deepEqual(J(e1.storePatch).customers, []); assert.equal(e1.storePatch.currentCustomerId, null);
  const cs = { names: ['ws-shell-1', 'ws-img-1', 'foreign'], keys: async () => cs.names, delete: async nm => { cs.names = cs.names.filter(x => x !== nm); } };
  const e2 = await D.eraseLocal({ localStorage: s, indexedDB: idb, caches: cs, scope: 'ALL' });
  assert.deepEqual([...s._m.keys()], ['other-app'], 'only the panel inventory is removed'); assert.deepEqual(cs.names, ['foreign']); assert.ok(e2.deletedDatabases.includes('ws-cache'));
  // the real store restores nothing personal after the erase
  const s2 = fakeStorage({ 'ws:viva-juara:state': STATE() }); await D.eraseLocal({ localStorage: s2, scope: 'PERSONAL' });
  assert.equal(App.securityHardening.auditStorage({ 'ws:viva-juara:state': s2.getItem('ws:viva-juara:state') }).filter(f => f.code === 'CUSTOMER_NAME').length, 0, 'topic 50 storage audit agrees');
});
test('views: escaped, plain Portuguese, disclaimer, only documented data-acts, DPO "não configurado"', () => {
  const vm = D.centerVM({ scan: D.scan({ localStorage: fakeStorage({ 'ws:viva-juara:state': STATE() }) }) });
  const h = V.center(vm);
  assert.match(h, /Não é aconselhamento jurídico/); assert.match(h, /não configurado \(necessita confirmação da organização\)/);
  const acts = new Set([...h.matchAll(/data-act="([^"]+)"/g)].map(m => m[1])); assert.deepEqual([...acts].sort(), ['privacyEraseLocal', 'privacyExport']);
  assert.ok(!/DSAR|Data Subject/.test(h)); assert.ok(!h.includes('Maria'));
  const cf = V.confirmErase('ALL'); assert.match(cf, /data-act="privacyEraseConfirm" data-scope="ALL"/); assert.match(cf, /data-act="closeModal"/);
  const g = V.governance(C.compliancePackage()); assert.match(g, /Nível de maturidade: <b>L1<\/b>/); assert.match(g, /não é parecer jurídico/);
  assert.equal(V.noteHint({ warn: true, message: '<b>x</b>' }), '<p class="small" role="note">&lt;b&gt;x&lt;/b&gt;</p>');
  const pkg = C.compliancePackage(); assert.equal(pkg.notLegalAdvice, true); assert.equal(pkg.processingActivityRegister.length, BASE.registries.processingActivities.length);
});
test('docs: every document required by §565 exists, states it is not legal advice, and the data map lists every inventory entry', () => {
  const req = ['PRIVACY_ARCHITECTURE', 'PERSONAL_DATA_INVENTORY', 'DATA_CATEGORY_REGISTRY', 'PROCESSING_PURPOSE_REGISTRY', 'PROCESSING_ACTIVITY_REGISTER', 'LEGAL_BASIS_ASSESSMENT_POLICY', 'CONTROLLER_OPERATOR_MATRIX', 'CONSENT_MANAGEMENT_POLICY', 'PRIVACY_NOTICE_VERSIONING', 'COMMUNICATION_PREFERENCE_POLICY', 'DATA_SUBJECT_RIGHTS_WORKFLOW', 'SUBJECT_IDENTITY_VERIFICATION', 'RETENTION_AND_DELETION_POLICY', 'LEGAL_HOLD_POLICY', 'ANONYMIZATION_AND_PSEUDONYMIZATION', 'VENDOR_PRIVACY_REGISTER', 'DATA_SHARING_POLICY', 'INTERNATIONAL_TRANSFER_REGISTER', 'DPO_ENCARREGADO_GOVERNANCE', 'PRIVACY_RISK_ASSESSMENT', 'RIPD_MODEL', 'PRIVACY_CHANGE_GATE', 'PROFILING_AND_AUTOMATED_DECISION_POLICY', 'RECOMMENDATION_PRIVACY_POLICY', 'DOCUMENT_PRIVACY_POLICY', 'ANALYTICS_PRIVACY_POLICY', 'PWA_CACHE_PRIVACY_POLICY', 'PRIVACY_INCIDENT_RESPONSE', 'PRIVACY_LOGGING_POLICY', 'PRIVACY_TEST_MATRIX', 'LEGACY_PRIVACY_REMEDIATION_PLAN', 'RELATORIO_TOPICO_59'];
  for (const d of req) { const f = path.join(DOCS, d + '.md'); assert.ok(fs.existsSync(f), d); assert.match(fs.readFileSync(f, 'utf8'), /não é parecer jurídico|não é aconselhamento jurídico/i, d); }
  const inv = fs.readFileSync(path.join(DOCS, 'PERSONAL_DATA_INVENTORY.md'), 'utf8');
  for (const e of D.INVENTORY) assert.ok(inv.includes(e.id), e.id);
  for (const f of BASE.registries.personalFields) assert.ok(inv.includes(f.fieldKey), f.fieldKey);
});

test('permissions: topic 59 keys registered, not anonymous, granted to no role (human decision)', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'security', 'permissions.json'), 'utf8'));
  const keys = ['privacy.registry.view', 'privacy.request.manage', 'privacy.consent.manage', 'privacy.legal_hold.manage', 'privacy.retention.execute', 'customer.export_bulk'];
  const raw = fs.readFileSync(path.join(__dirname, '..', 'config', 'security', 'roles.json'), 'utf8');
  for (const k of keys) { const p = reg.permissions.find(x => x.key === k); assert.ok(p, k); assert.equal(p.anonymousAllowed, false, k); assert.ok(!raw.includes(`"${k}"`), `no role grants ${k}`); }
});
