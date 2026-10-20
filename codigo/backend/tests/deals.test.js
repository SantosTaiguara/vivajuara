'use strict';
/* Topic 57 — proposal, negotiation, approval, reservation, closing, contract, signature, sale outcome. DB-FREE:
   memory DealsStore (serialized transactions with rollback), the SHARED availability state machine (App.availability),
   the real price rule (App.pricing.formula, table 2026-10-06, R$ 1.196/m²) over dash/lots.json areas, an injectable server
   clock and a fake signature provider. Policies below are TEST FIXTURES, not business decisions: the shipped
   config/deals/viva-juara.json has every decision null (necessita confirmação). Run: node --test tests/deals.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createAppContext } = require('../src/shared/domain/sharedDomain');
const D = require('../src/modules/deals/deals.domain');
const policyMod = require('../src/modules/deals/deals.policy');
const repo = require('../src/modules/deals/deals.repository');
const { createDealsService } = require('../src/modules/deals/deals.service');
const ctl = require('../src/modules/deals/deals.controller');
const oas = require('../src/modules/deals/deals.openapi');

const PLAT = path.resolve(__dirname, '..', '..');
const App = createAppContext({ srcDir: path.join(PLAT, 'src') });
const DEV = 'viva-juara', ORG = 'org_house7', OTHER_ORG = 'org_other';
const LOTS = JSON.parse(fs.readFileSync(path.resolve(PLAT, '..', 'dash', 'lots.json'), 'utf8'));
const AREA = Object.fromEntries(LOTS.map(l => [l.did, l.a]));
const TABLE = App.config.DEVELOPMENTS[0].priceTables[0];
const L250 = 'VJ-QB-L0016', L250B = 'VJ-QB-L0017', L250C = 'VJ-QB-L0018';
const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const H = 3600e3, DAY = 24 * H;

/** pricing port: CURRENT published table; list price = App.pricing.formula.lotPrice (the existing rule), in cents */
function pricingPort() {
  const port = { table: { id: TABLE.id, version: TABLE.version, pricePerM2: TABLE.pricePerM2 },
    async quote(devId, lotId) {
      if (devId !== DEV || AREA[lotId] == null) return null;
      const price = App.pricing.formula.lotPrice(AREA[lotId], port.table.pricePerM2);
      return price == null ? null : { developmentId: devId, lotId, priceTableId: port.table.id, priceTableVersion: port.table.version, listPriceMinor: Math.round(price * 100), currency: 'BRL' };
    } };
  return port;
}
const CONFIGURED = { // test fixture
  organizationId: ORG, developmentId: DEV,
  authorityMatrix: { proposal: 'PLATFORM_MASTER', negotiation: 'PLATFORM_MASTER', reservation: 'PLATFORM_MASTER', availability: 'PLATFORM_MASTER', contract: 'PLATFORM_MASTER', signature: 'EXTERNAL_MASTER', journey: 'PLATFORM_MASTER' },
  workflow: { policyId: 'wf-test', version: '1', proposalRequiredBeforeReservation: false, reservationRequiredBeforeProposal: false, acceptedProposalRequiredForClosing: true, reservationRequiredForClosing: true },
  proposalConcurrency: { mode: 'MULTIPLE_PROPOSALS_ALLOWED', priorityRule: 'MANUAL' },
  submission: { requiredCustomerFields: ['name'], requiredProposalFields: ['financingMode'], requireFinancialSimulation: false, requireAvailabilityFreshness: false },
  approval: { policyId: 'apr-test', version: '1', rules: [], requesterCannotApprove: true },
  reservation: { maxDurationSeconds: 3 * 24 * 3600, extension: { allowed: true, maxExtensionSeconds: 24 * 3600, maxExtensions: 1, reasonRequired: true } },
  closingChecklist: { policyId: 'chk-test', version: '1', items: [{ code: 'ID_DOC', category: 'CUSTOMER_DOCUMENT', required: true }, { code: 'EXTRA_DOC', category: 'OTHER', required: false }] },
  closingReadiness: { policyId: 'rdy-test', version: '1', readyForSignature: ['REQUIRED_CHECKLIST_VALIDATED', 'CONTRACT_ISSUED'] },
  saleCompletion: { policyId: 'won-test', version: '1', requiredConditions: ['ACCEPTED_PROPOSAL', 'RESERVATION_CONVERTED', 'REQUIRED_CHECKLIST_VALIDATED', 'CONTRACT_FULLY_SIGNED'] },
  closingCancellation: { policyId: 'cnl-test', version: '1', availabilityAfterCancel: 'AVAILABLE' },
  contractTemplates: [{ templateId: 'tpl-test', templateVersion: '1', approvedAt: '2026-10-01T00:00:00Z', approvedBy: 'legal-test', contractType: 'SALE', mandatoryVariables: ['buyerRef', 'lotId', 'priceMinor'], optionalVariables: ['coBuyerRef'] }]
};
const merge = (a, b) => { const o = JSON.parse(JSON.stringify(a)); for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' ? merge(o[k], v) : v; return o; };

/** fake e-signature provider: HMAC-signed webhooks (secret generated per run, never a real credential) */
function fakeSigner() {
  const secret = crypto.randomBytes(32);
  let n = 0;
  const sign = body => crypto.createHmac('sha256', secret).update(body).digest('hex');
  return { sign, secret,
    async createEnvelope() { n++; return { externalEnvelopeId: `ext-env-${n}` }; }, async getStatus() { return null; }, async cancelEnvelope() {},
    async verifyWebhook(raw, headers) {
      const sig = headers['x-signature'] || '';
      const ok = sig.length === 64 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(raw)));
      return ok ? { ok: true, event: JSON.parse(raw) } : { ok: false };
    } };
}

function setup({ policy = CONFIGURED, lots = {} } = {}) {
  let t = T0, seq = 0;
  const logs = [], counters = {};
  const initial = Object.fromEntries(Object.keys(AREA).map(id => [id, { developmentId: DEV, status: 'UNKNOWN', revision: 0, updatedAt: null, sourceId: null, reservedUntil: null, proposalId: null, reason: null, notes: null }]));
  for (const [id, v] of Object.entries(lots)) Object.assign(initial[id], { updatedAt: D.iso(T0 - H), sourceId: 'official-test', ...v });
  const store = repo.createMemoryDealsStore({ App, availability: initial });
  const pricing = pricingPort();
  const people = { cust_000000000001: { id: 'cust_000000000001', organizationId: ORG, presentFields: ['name'], name: 'Maria Silva Teste' }, cust_000000000002: { id: 'cust_000000000002', organizationId: ORG, presentFields: ['name'], name: 'João Teste' } };
  const signer = fakeSigner();
  const logger = { info: (m, o) => logs.push(['info', m, o]), warn: (m, o) => logs.push(['warn', m, o]), error: (m, o) => logs.push(['error', m, o]) };
  const metrics = { inc: k => { counters[k] = (counters[k] || 0) + 1; }, observe: () => {} };
  const deals = createDealsService({ store, policies: policyMod.staticPolicyPort(policy), pricing, customers: { async find(org, id) { const c = people[id]; return c && c.organizationId === org ? c : null; } },
    signatureProviders: { fakesign: signer }, now: () => t, idGen: p => `${p}_${String(++seq).padStart(12, '0')}`, logger, metrics });
  return { deals, store, pricing, signer, logs, counters, advance: ms => { t += ms; }, now: () => t };
}
const ALL = [...ctl.DEALS_PERMISSIONS.map(p => p.key)];
const broker = (perms = ALL.filter(k => !['commercial_approval.decide', 'sale.complete', 'closing.validate_documents'].includes(k))) => ({ actorId: 'user_broker1', actorType: 'USER', organizationId: ORG, permissions: perms });
const manager = () => ({ actorId: 'user_manager1', actorType: 'USER', organizationId: ORG, permissions: ALL });
const outsider = () => ({ actorId: 'user_other1', actorType: 'USER', organizationId: OTHER_ORG, permissions: ALL });
const TERMS = (o = {}) => ({ offerPriceMinor: 29_900_000, currency: 'BRL', financingMode: 'DIRECT_INSTALLMENT', installmentCount: 144, validityDate: D.iso(T0 + 2 * DAY), conditions: [{ code: 'DOC_IDENTIFICATION', type: 'DOCUMENTATION', description: 'Documento de identificação', required: true }], notes: 'cliente pediu desconto — nota interna', ...o });
const AVAIL = { status: 'AVAILABLE', revision: 5 };
const code = c => e => { assert.equal(e.code, c, `${e.code} ${JSON.stringify(e.details)}`); return true; };
let K = 0; const key = () => `idem-key-${++K}-abcdef`;

async function acceptedProposal(s, lotId = L250, customerId = 'cust_000000000001', terms = TERMS()) {
  const b = broker(), m = manager();
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId, lotId, proposalType: 'BROKER_MEDIATED', terms });
  let r = await s.deals.submitProposal(b, c.proposal.id, { expectedRevision: c.proposal.revision, idempotencyKey: key() });
  r = await s.deals.startReview(m, c.proposal.id, { expectedRevision: r.proposal.revision });
  r = await s.deals.acceptProposal(m, c.proposal.id, { expectedRevision: r.proposal.revision, proposalVersionId: r.proposal.currentVersionId, method: 'BROKER_RECORDED', evidenceRefs: ['doc:ack-1'], idempotencyKey: key() });
  return r;
}

// ============================================================================ policy defaults (necessita confirmação)
test('shipped policy: every business decision is null and actions that need it are refused with a clear code', async () => {
  const file = await policyMod.createFilePolicyPort(path.join(PLAT, 'config', 'deals')).getPolicy(ORG, DEV);
  assert.equal(file.status, 'NECESSITA_CONFIRMACAO');
  const pending = policyMod.pendingKeys(file);
  for (const k of ['authorityMatrix.reservation', 'saleCompletion.requiredConditions', 'approval.rules', 'reservation.maxDurationSeconds', 'closingChecklist.items', 'proposalConcurrency.mode', 'businessTimezone']) assert.ok(pending.includes(k), k);
  const s = setup({ policy: { organizationId: ORG, developmentId: DEV }, lots: { [L250]: AVAIL } });
  await assert.rejects(s.deals.createProposal(broker(), { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() }), code('COMMERCIAL_AUTHORITY_NOT_CONFIGURED'));
  await assert.rejects(s.deals.createReservation(broker(), { developmentId: DEV, lotId: L250, customerId: 'cust_000000000001', expectedAvailabilityRevision: 5, expiresAt: D.iso(T0 + H), idempotencyKey: key() }), code('COMMERCIAL_AUTHORITY_NOT_CONFIGURED'));
  // only the authority known: the next missing decision is named
  const s2 = setup({ policy: { authorityMatrix: CONFIGURED.authorityMatrix }, lots: { [L250]: AVAIL } });
  const c = await s2.deals.createProposal(broker(), { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  await assert.rejects(s2.deals.submitProposal(broker(), c.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), e => e.code === 'POLICY_NOT_CONFIGURED' && e.details.policy === 'submission.requiredCustomerFields');
  await assert.rejects(s2.deals.createReservation(broker(), { developmentId: DEV, lotId: L250, customerId: 'cust_000000000001', expectedAvailabilityRevision: 5, expiresAt: D.iso(T0 + H), idempotencyKey: key() }), e => e.code === 'POLICY_NOT_CONFIGURED' && e.details.policy === 'workflow.proposalRequiredBeforeReservation');
  const caps = await s2.deals.capabilities(broker(), { developmentId: DEV, lotId: L250B });
  assert.equal(caps.canCreateReservation, false);
  assert.ok(caps.reasonCodes.includes('LOT_AVAILABILITY_UNKNOWN') && caps.reasonCodes.some(r => r.startsWith('POLICY_NOT_CONFIGURED:')));
  assert.throws(() => policyMod.resolvePolicy({ proposalConcurrency: { mode: 'FIRST_COME' } }), /invalid deals policy/);
});

// ============================================================================ proposals
test('ProposalStandardAccepted: price comes from the current table (R$ 1.196/m² → 250 m² = R$ 299.000), immutable issued version, acceptance never reserves', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const r = await acceptedProposal(s);
  const { proposal, version } = r;
  assert.equal(proposal.status, 'ACCEPTED'); assert.equal(version.status, 'ACCEPTED');
  assert.equal(version.pricing.listPriceMinor, 29_900_000); assert.equal(version.pricing.priceTableVersion, '2026-10-06');
  assert.equal(version.pricingSnapshotRef, `pricetable:${DEV}:lancamento-2026-10@2026-10-06:${L250}`);
  assert.equal(version.availabilitySnapshotRef, `availability:${DEV}:${L250}@r5:AVAILABLE`);
  assert.equal(version.checksum, D.versionChecksum(version));
  assert.equal(r.acceptance.legalEffect, 'NOT_ASSUMED');
  assert.equal(s.store.lot(L250).status, 'AVAILABLE', 'acceptance does not reserve the lot');
  assert.equal(s.store.rows('reservation').length, 0);
  const got = await s.deals.getProposal(broker(), proposal.id);
  assert.equal(got.negotiationEvents.map(e => e.eventType).join(), 'PROPOSAL_SUBMITTED,TERMS_ACCEPTED');
  assert.ok(s.store.audit.some(a => a.action === 'PROPOSAL_SUBMIT') && s.store.audit.some(a => a.action === 'PROPOSAL_ACCEPT'));
  assert.deepEqual(s.store.outbox.filter(e => e.type === 'JourneyEvent').map(e => e.payload.eventType), ['PROPOSAL_CREATED', 'PROPOSAL_SUBMITTED', 'PROPOSAL_ACCEPTED']);
  await assert.rejects(s.deals.updateDraft(broker(), proposal.id, { expectedRevision: proposal.revision, terms: TERMS({ offerPriceMinor: 1 }) }), code('PROPOSAL_VERSION_IMMUTABLE'));
});

test('ProposalCounterOfferAccepted: counter = new issued version, previous SUPERSEDED untouched, diff visible, only the current version is acceptable', async () => {
  const s = setup({ lots: { [L250]: AVAIL } }), b = broker(), m = manager();
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'CUSTOMER_OFFER', terms: TERMS({ offerPriceMinor: 28_500_000 }) });
  let r = await s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  const v1 = r.version;
  r = await s.deals.startReview(m, c.proposal.id, { expectedRevision: r.proposal.revision });
  const ctr = await s.deals.counterProposal(m, c.proposal.id, { expectedRevision: r.proposal.revision, expectedVersionId: v1.id, source: 'SELLER', terms: TERMS({ offerPriceMinor: 29_200_000 }) });
  assert.equal(ctr.proposal.status, 'COUNTERED'); assert.equal(ctr.version.versionNumber, 2); assert.equal(ctr.version.supersedesVersionId, v1.id);
  assert.deepEqual(ctr.diff.changedFields.find(f => f.field === 'terms.offerPriceMinor'), { field: 'terms.offerPriceMinor', before: 28_500_000, after: 29_200_000 });
  const got = await s.deals.getProposal(b, c.proposal.id);
  const old = got.versions.find(v => v.id === v1.id);
  assert.equal(old.status, 'SUPERSEDED'); assert.equal(old.checksum, v1.checksum); assert.deepEqual(old.terms, v1.terms);
  await assert.rejects(s.deals.acceptProposal(m, c.proposal.id, { expectedRevision: ctr.proposal.revision, proposalVersionId: v1.id, method: 'BROKER_RECORDED', evidenceRefs: ['doc:x'], idempotencyKey: key() }), code('PROPOSAL_VERSION_CONFLICT'));
  const acc = await s.deals.acceptProposal(m, c.proposal.id, { expectedRevision: ctr.proposal.revision, proposalVersionId: ctr.version.id, method: 'BROKER_RECORDED', evidenceRefs: ['doc:x'], idempotencyKey: key() });
  assert.equal(acc.version.id, ctr.version.id); assert.equal(acc.version.terms.offerPriceMinor, 29_200_000);
  assert.ok(got.negotiationEvents.some(e => e.eventType === 'COUNTER_PROPOSED'));
});

test('ProposalExpired (server clock) + ProposalWithdrawn (reason code, history kept)', async () => {
  const s = setup({ lots: { [L250]: AVAIL } }), b = broker(), m = manager();
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  let r = await s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  r = await s.deals.startReview(m, c.proposal.id, { expectedRevision: r.proposal.revision });
  s.advance(3 * DAY);
  await assert.rejects(s.deals.acceptProposal(m, c.proposal.id, { expectedRevision: r.proposal.revision, proposalVersionId: r.proposal.currentVersionId, method: 'BROKER_RECORDED', evidenceRefs: ['doc:x'], idempotencyKey: key() }), code('PROPOSAL_EXPIRED'));
  assert.deepEqual(await s.deals.runExpiry({ organizationId: ORG }), { reservationsExpired: 0, proposalsExpired: 1, skipped: 0 });
  assert.deepEqual(await s.deals.runExpiry({ organizationId: ORG }), { reservationsExpired: 0, proposalsExpired: 0, skipped: 0 }, 'idempotent');
  assert.equal((await s.deals.getProposal(b, c.proposal.id)).proposal.status, 'EXPIRED');
  // withdrawal
  const w = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000002', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS({ validityDate: D.iso(s.now() + DAY) }) });
  await s.deals.submitProposal(b, w.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  await assert.rejects(s.deals.withdrawProposal(b, w.proposal.id, { expectedRevision: 2 }), code('REASON_CODE_REQUIRED'));
  const wd = await s.deals.withdrawProposal(b, w.proposal.id, { expectedRevision: 2, reasonCode: 'CUSTOMER_WITHDREW' });
  assert.equal(wd.proposal.status, 'WITHDRAWN');
  assert.equal((await s.deals.getProposal(b, w.proposal.id)).versions.length, 1, 'versions are never deleted');
});

test('ProposalDiscountApprovalRequired: beyond threshold → COMMERCIAL_APPROVAL_REQUIRED; self-approval forbidden; after approval submit proceeds; price table untouched', async () => {
  const pol = merge(CONFIGURED, { approval: { rules: [{ code: 'DISC_GT_5', conditionType: 'DISCOUNT_PERCENT_GT', threshold: 5, requiredApprovalPermission: 'commercial_approval.decide', requireReason: true }] } });
  const s = setup({ policy: pol, lots: { [L250]: AVAIL } }), b = broker(), m = manager();
  const before = await s.pricing.quote(DEV, L250);
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'CUSTOMER_OFFER', terms: TERMS({ offerPriceMinor: 26_910_000 }) }); // 10% below list
  assert.equal(c.version.pricing.requestedDiscountPercent, 10);
  await assert.rejects(s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), e => e.code === 'COMMERCIAL_APPROVAL_REQUIRED' && e.details.required[0].ruleCode === 'DISC_GT_5');
  const { approval } = await s.deals.requestApproval(b, c.proposal.id, { approvalType: 'DISCOUNT', reason: 'Cliente à vista' });
  assert.equal(approval.status, 'PENDING'); assert.equal(approval.ruleCode, 'DISC_GT_5');
  const selfish = { ...m, actorId: 'user_broker1' };
  await assert.rejects(s.deals.decideApproval(selfish, approval.id, { expectedRevision: 1, decision: 'APPROVED' }), code('APPROVAL_SELF_DECISION_FORBIDDEN'));
  await assert.rejects(s.deals.decideApproval(b, approval.id, { expectedRevision: 1, decision: 'APPROVED' }), code('PERMISSION_DENIED'));
  await s.deals.decideApproval(m, approval.id, { expectedRevision: 1, decision: 'APPROVED', reason: 'ok' });
  const r = await s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  assert.equal(r.version.pricing.approvedDiscountMinor, 2_990_000); assert.equal(r.version.pricing.listPriceMinor, 29_900_000);
  assert.deepEqual(r.version.approvalRefs, [approval.id]);
  assert.deepEqual(await s.pricing.quote(DEV, L250), before, 'PriceTable is never mutated for one customer');
  assert.ok(s.store.audit.some(a => a.action === 'DISCOUNT_APPROVAL'));
});

test('ProposalPriceChangedAfterIssue: issued at R$ 299.000, new table → historical version stays, UI overlay warns', async () => {
  const s = setup({ lots: { [L250]: AVAIL } }), b = broker();
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  const r = await s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  s.pricing.table = { id: 'tabela-teste-2', version: 'teste-2', pricePerM2: 1240 }; // hypothetical later table (test only)
  const got = await s.deals.getProposal(b, c.proposal.id);
  assert.equal(got.versions[0].pricing.listPriceMinor, 29_900_000); assert.equal(got.versions[0].terms.offerPriceMinor, 29_900_000); assert.equal(got.versions[0].checksum, r.version.checksum);
  assert.deepEqual(got.currentPriceOverlay, { currentListPriceMinor: 31_000_000, currentPriceTableVersion: 'teste-2', differsFromProposal: true });
  // a DRAFT built on the old table cannot be issued silently
  const d = await setupDraftOnOldTable();
  await assert.rejects(d.s.deals.submitProposal(b, d.id, { expectedRevision: 1, idempotencyKey: key() }), e => e.code === 'PROPOSAL_INVALID' && e.details.blockingErrors.includes('PRICE_TABLE_VERSION_CHANGED'));
  async function setupDraftOnOldTable() {
    const s2 = setup({ lots: { [L250]: AVAIL } });
    const c2 = await s2.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
    s2.pricing.table = { id: 'tabela-teste-2', version: 'teste-2', pricePerM2: 1240 };
    return { s: s2, id: c2.proposal.id };
  }
});

test('ProposalStaleAvailabilityBlocked + invalid proposals are never issued + proposal requires a persisted customer', async () => {
  const pol = merge(CONFIGURED, { submission: { requireAvailabilityFreshness: true, maxAvailabilityAgeSeconds: 600 } });
  const s = setup({ policy: pol, lots: { [L250]: AVAIL, [L250B]: { status: 'SOLD', revision: 2 } } }), b = broker();
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  await assert.rejects(s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), e => e.code === 'PROPOSAL_INVALID' && e.details.blockingErrors.includes('AVAILABILITY_STALE'));
  const s2 = setup({ lots: { [L250B]: { status: 'SOLD', revision: 2 } } });
  const sold = await s2.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250B, proposalType: 'BROKER_MEDIATED', terms: TERMS({ validityDate: undefined, financingMode: undefined }) });
  await assert.rejects(s2.deals.submitProposal(b, sold.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), e => {
    for (const x of ['LOT_NOT_AVAILABLE:SOLD', 'TERMS_REQUIRED:validityDate', 'TERMS_REQUIRED:financingMode']) assert.ok(e.details.blockingErrors.includes(x), x);
    return e.code === 'PROPOSAL_INVALID';
  });
  await assert.rejects(s2.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_unknown000', lotId: L250, proposalType: 'BROKER_MEDIATED' }), code('CUSTOMER_NOT_FOUND'));
  await assert.rejects(s2.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: { offerPriceMinor: 299000.5 } }), code('VALIDATION_ERROR'));
  // UNKNOWN availability: the proposal may be drafted/issued with a warning, never as confirmed
  const s3 = setup();
  const u = await s3.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  const ru = await s3.deals.submitProposal(b, u.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  assert.equal(ru.validation.status, 'VALID_WITH_WARNINGS'); assert.ok(ru.validation.warnings.includes('AVAILABILITY_UNKNOWN_NEEDS_CONFIRMATION'));
});

test('SINGLE_ACTIVE_PROPOSAL concurrency policy: second submit on the same lot → PROPOSAL_CONCURRENCY_CONFLICT (no identity leaked)', async () => {
  const s = setup({ policy: merge(CONFIGURED, { proposalConcurrency: { mode: 'SINGLE_ACTIVE_PROPOSAL' } }), lots: { [L250]: AVAIL } }), b = broker();
  const a = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  const c = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000002', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  await s.deals.submitProposal(b, a.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  await assert.rejects(s.deals.submitProposal(b, c.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), e => e.code === 'PROPOSAL_CONCURRENCY_CONFLICT' && !JSON.stringify(e.details).includes('cust_'));
});

// ============================================================================ reservations
const RES = (o = {}) => ({ developmentId: DEV, lotId: L250, customerId: 'cust_000000000001', expectedAvailabilityRevision: 5, expiresAt: D.iso(T0 + DAY), idempotencyKey: key(), ...o });

test('ReservationSingleWinner / ReservationConcurrentConflict: two brokers, same expected revision → one ACTIVE, one LOT_ALREADY_RESERVED', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const results = await Promise.allSettled([s.deals.createReservation(broker(), RES()), s.deals.createReservation({ ...broker(), actorId: 'user_broker2' }, RES({ customerId: 'cust_000000000002' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const lost = results.find(r => r.status === 'rejected');
  assert.equal(lost.reason.code, 'LOT_ALREADY_RESERVED'); assert.ok(!JSON.stringify(lost.reason.details).includes('cust_'), 'never who holds the lot');
  const lot = s.store.lot(L250);
  assert.equal(lot.status, 'RESERVED'); assert.equal(lot.revision, 6); assert.equal(lot.reservedUntil, D.iso(T0 + DAY));
  assert.equal(s.store.rows('reservation').filter(r => r.status === 'ACTIVE').length, 1);
  assert.equal(s.counters.reservation_conflict_total, 1); assert.equal(s.counters.reservation_created_total, 1);
  assert.ok(s.store.audit.some(a => a.action === 'RESERVATION_CREATE'));
});

test('reservation guards: stale revision → AVAILABILITY_REVISION_CONFLICT; UNKNOWN lot → LOT_AVAILABILITY_UNKNOWN; SOLD → LOT_NOT_AVAILABLE; expiry beyond policy max → RESERVATION_EXPIRY_INVALID; rollback leaves no trace', async () => {
  const s = setup({ lots: { [L250]: AVAIL, [L250B]: { status: 'SOLD', revision: 3 } } });
  await assert.rejects(s.deals.createReservation(broker(), RES({ expectedAvailabilityRevision: 4 })), e => e.code === 'AVAILABILITY_REVISION_CONFLICT' && e.details.currentRevision === 5);
  await assert.rejects(s.deals.createReservation(broker(), RES({ lotId: L250C, expectedAvailabilityRevision: 0 })), code('LOT_AVAILABILITY_UNKNOWN'));
  await assert.rejects(s.deals.createReservation(broker(), RES({ lotId: L250B, expectedAvailabilityRevision: 3 })), code('LOT_NOT_AVAILABLE'));
  await assert.rejects(s.deals.createReservation(broker(), RES({ expiresAt: D.iso(T0 + 4 * DAY) })), code('RESERVATION_EXPIRY_INVALID'));
  await assert.rejects(s.deals.createReservation(broker(), RES({ expiresAt: undefined })), code('RESERVATION_EXPIRY_INVALID'));
  await assert.rejects(s.deals.createReservation(broker(), RES({ lotId: 'VJ-QZ-L9999' })), code('LOT_NOT_FOUND'));
  assert.equal(s.store.rows('reservation').length, 0); assert.equal(s.store.lot(L250).status, 'AVAILABLE'); assert.equal(s.store.audit.length, 0);
  // every one of the 498 real lots is UNKNOWN today: none can be reserved
  const s2 = setup();
  for (const id of Object.keys(AREA).slice(0, 25)) await assert.rejects(s2.deals.createReservation(broker(), RES({ lotId: id, expectedAvailabilityRevision: 0 })), code('LOT_AVAILABILITY_UNKNOWN'));
  assert.equal(Object.keys(AREA).length, 498);
});

test('ReservationIdempotentCreate: same Idempotency-Key → same reservation (replay), other body → IDEMPOTENCY_KEY_REUSED, no key → IDEMPOTENCY_KEY_REQUIRED', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const cmd = RES();
  const a = await s.deals.createReservation(broker(), cmd);
  const b = await s.deals.createReservation(broker(), cmd);
  assert.equal(b.reservation.id, a.reservation.id); assert.equal(b.idempotentReplay, true);
  assert.equal(s.store.rows('reservation').length, 1);
  await assert.rejects(s.deals.createReservation(broker(), { ...cmd, expiresAt: D.iso(T0 + 2 * DAY) }), code('IDEMPOTENCY_KEY_REUSED'));
  await assert.rejects(s.deals.createReservation(broker(), { ...cmd, idempotencyKey: undefined }), code('IDEMPOTENCY_KEY_REQUIRED'));
});

test('ReservationExpiresAndReleasesLot: worker uses server time, Reservation EXPIRED + Availability AVAILABLE, idempotent, no orphan RESERVED', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const { reservation } = await s.deals.createReservation(broker(), RES({ expiresAt: D.iso(T0 + H) }));
  assert.deepEqual(await s.deals.runExpiry({ organizationId: ORG }), { reservationsExpired: 0, proposalsExpired: 0, skipped: 0 });
  s.advance(H + 1);
  assert.equal((await s.deals.runExpiry({ organizationId: ORG })).reservationsExpired, 1);
  assert.equal((await s.deals.getReservation(broker(), reservation.id)).reservation.status, 'EXPIRED');
  assert.equal(s.store.lot(L250).status, 'AVAILABLE'); assert.equal(s.store.lot(L250).reservedUntil, null);
  assert.equal((await s.deals.runExpiry({ organizationId: ORG })).reservationsExpired, 0, 'idempotent');
  assert.ok(s.store.outbox.some(e => e.type === 'JourneyEvent' && e.payload.eventType === 'RESERVATION_EXPIRED'));
  await assert.rejects(s.deals.extendReservation(broker(), reservation.id, { expectedRevision: 2, newExpiresAt: D.iso(T0 + 3 * H), reason: 'x' }), code('INVALID_RESERVATION_TRANSITION'));
  // a policy may send an expired lot to BLOCKED (manual review) instead
  const s2 = setup({ policy: merge(CONFIGURED, { reservation: { availabilityAfterExpiry: 'BLOCKED' } }), lots: { [L250]: AVAIL } });
  await s2.deals.createReservation(broker(), RES({ expiresAt: D.iso(T0 + H) })); s2.advance(2 * H); await s2.deals.runExpiry({ organizationId: ORG });
  assert.equal(s2.store.lot(L250).status, 'BLOCKED');
});

test('ReservationExtendedWithApproval + ReservationReleaseManual', async () => {
  const pol = merge(CONFIGURED, { approval: { rules: [{ code: 'EXT_APPROVAL', conditionType: 'RESERVATION_EXTENSION', requiredApprovalPermission: 'commercial_approval.decide', requireReason: true }] } });
  const s = setup({ policy: pol, lots: { [L250]: AVAIL } }), b = broker(), m = manager();
  const acc = await acceptedProposal(s);
  const { reservation } = await s.deals.createReservation(b, RES({ proposalId: acc.proposal.id }));
  await assert.rejects(s.deals.extendReservation(b, reservation.id, { expectedRevision: 1, newExpiresAt: D.iso(T0 + DAY + 6 * H), reason: 'aguardando documentos' }), code('COMMERCIAL_APPROVAL_REQUIRED'));
  const { approval } = await s.deals.requestApproval(b, acc.proposal.id, { approvalType: 'RESERVATION_EXTENSION', reservationId: reservation.id, reason: 'aguardando documentos' });
  await s.deals.decideApproval(m, approval.id, { expectedRevision: 1, decision: 'APPROVED' });
  await assert.rejects(s.deals.extendReservation(b, reservation.id, { expectedRevision: 1, newExpiresAt: D.iso(T0 + 3 * DAY), reason: 'x' }), code('RESERVATION_EXTENSION_NOT_ALLOWED'));
  await assert.rejects(s.deals.extendReservation(b, reservation.id, { expectedRevision: 1, newExpiresAt: D.iso(T0 + DAY + 6 * H) }), code('VALIDATION_ERROR'));
  const ext = await s.deals.extendReservation(b, reservation.id, { expectedRevision: 1, newExpiresAt: D.iso(T0 + DAY + 6 * H), reason: 'aguardando documentos' });
  assert.equal(ext.reservation.expiresAt, D.iso(T0 + DAY + 6 * H)); assert.equal(ext.extension.previousExpiresAt, D.iso(T0 + DAY)); assert.equal(ext.extension.approvedBy, 'user_manager1');
  assert.equal(s.store.lot(L250).reservedUntil, D.iso(T0 + DAY + 6 * H));
  await assert.rejects(s.deals.extendReservation(b, reservation.id, { expectedRevision: 2, newExpiresAt: D.iso(T0 + DAY + 8 * H), reason: 'y' }), code('RESERVATION_EXTENSION_NOT_ALLOWED'), 'maxExtensions = 1');
  await assert.rejects(s.deals.releaseReservation(b, reservation.id, { expectedRevision: 1, reasonCode: 'ADMINISTRATIVE' }), code('REVISION_CONFLICT'));
  await assert.rejects(s.deals.releaseReservation(b, reservation.id, { expectedRevision: 2 }), code('REASON_CODE_REQUIRED'));
  const rel = await s.deals.releaseReservation(b, reservation.id, { expectedRevision: 2, reasonCode: 'CUSTOMER_WITHDREW' });
  assert.equal(rel.reservation.status, 'RELEASED'); assert.equal(s.store.lot(L250).status, 'AVAILABLE');
  for (const a of ['RESERVATION_CREATE', 'RESERVATION_EXTEND', 'RESERVATION_RELEASE']) assert.ok(s.store.audit.some(x => x.action === a), a);
});

test('external reservation authority: PENDING_EXTERNAL_CONFIRMATION + external command, local availability untouched until confirmed; reconciliation records conflicts', async () => {
  const s = setup({ policy: merge(CONFIGURED, { authorityMatrix: { reservation: 'EXTERNAL_MASTER', availability: 'EXTERNAL_MASTER' } }), lots: { [L250]: AVAIL } });
  const { reservation } = await s.deals.createReservation(broker(), RES());
  assert.equal(reservation.status, 'PENDING_EXTERNAL_CONFIRMATION'); assert.equal(s.store.lot(L250).status, 'AVAILABLE');
  assert.equal(s.store.rows('externalCommand')[0].type, 'CREATE_RESERVATION');
  const rec = await s.deals.reconcileReservations(broker(), DEV, []);
  assert.equal(rec.conflicts.length, 0, 'pending is not active: no mismatch yet');
  const ok = await s.deals.confirmExternalReservation(broker(), reservation.id, { expectedRevision: 1, confirmed: true, externalId: 'EXT-123' });
  assert.equal(ok.reservation.status, 'ACTIVE');
  const rec2 = await s.deals.reconcileReservations(broker(), DEV, [{ lotId: L250B, status: 'RESERVED' }]);
  assert.equal(rec2.conflicts.length, 2); assert.ok(rec2.conflicts.every(c => c.status === 'OPEN'));
  const s2 = setup({ policy: merge(CONFIGURED, { authorityMatrix: { reservation: 'REFERENCE_ONLY' } }), lots: { [L250]: AVAIL } });
  await assert.rejects(s2.deals.createReservation(broker(), RES()), code('COMMERCIAL_AUTHORITY_EXTERNAL'));
  const s3 = setup({ policy: merge(CONFIGURED, { authorityMatrix: { availability: 'EXTERNAL_MASTER' } }), lots: { [L250]: AVAIL } });
  await assert.rejects(s3.deals.createReservation(broker(), RES()), e => e.code === 'COMMERCIAL_AUTHORITY_EXTERNAL' && e.details.reason === 'NO_DUAL_MASTER');
});

// ============================================================================ closing, contract, signature, sale
async function closingReady(s) {
  const b = broker(), m = manager();
  const acc = await acceptedProposal(s);
  const { reservation } = await s.deals.createReservation(b, RES({ proposalId: acc.proposal.id }));
  const o = await s.deals.openClosingCase(b, { proposalId: acc.proposal.id, idempotencyKey: key() });
  return { acc, reservation, ...o, b, m };
}

test('ClosingDocumentsPending → contract (approved template only, merge fields) → ClosingCannotCompleteWithMissingRequirement → signature partial/complete (webhook replay) → ClosingCompletedMarksSold', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const { closing, checklist, reservation, b, m, acc } = await closingReady(s);
  assert.equal(closing.status, 'DOCUMENTS_PENDING'); assert.equal(closing.acceptedProposalVersionId, acc.version.id);
  assert.equal((await s.deals.getReservation(b, reservation.id)).reservation.status, 'CONVERTED'); assert.equal(s.store.lot(L250).status, 'RESERVED', 'not SOLD too early');
  const id = checklist.find(i => i.code === 'ID_DOC');
  await assert.rejects(s.deals.updateChecklistItem(m, closing.id, id.id, { expectedRevision: 1, status: 'VALIDATED' }), code('CLOSING_REQUIREMENTS_INCOMPLETE'), 'upload ≠ validation');
  const rcv = await s.deals.updateChecklistItem(b, closing.id, id.id, { expectedRevision: 1, status: 'RECEIVED', documentId: 'doc_000000000123' });
  await assert.rejects(s.deals.updateChecklistItem(b, closing.id, id.id, { expectedRevision: 2, status: 'VALIDATED' }), code('PERMISSION_DENIED'), 'broker without closing.validate_documents');
  const bv = broker([...broker().permissions, 'closing.validate_documents']);
  const val = await s.deals.updateChecklistItem({ ...bv, actorId: 'user_backoffice' }, closing.id, id.id, { expectedRevision: rcv.item.revision, status: 'VALIDATED', validationNote: 'conferido' });
  assert.equal(val.closing.status, 'UNDER_REVIEW'); assert.equal(val.readiness.progress.done, 1); assert.equal(val.readiness.progress.total, 1);
  // contract: no approved template → refused; missing merge field → refused; no clause is generated
  await assert.rejects(s.deals.createContract(b, closing.id, { expectedClosingRevision: val.closing.revision, template: { templateId: 'tpl-x', templateVersion: '9' }, documentVersionId: 'docv_00000001', variables: {} }), code('CONTRACT_TEMPLATE_NOT_APPROVED'));
  await assert.rejects(s.deals.createContract(b, closing.id, { expectedClosingRevision: val.closing.revision, template: { templateId: 'tpl-test', templateVersion: '1' }, documentVersionId: 'docv_00000001', variables: { buyerRef: 'cust_000000000001', lotId: L250 } }), e => e.code === 'CONTRACT_VARIABLES_UNRESOLVED' && e.details.missingVariables.includes('priceMinor'));
  const vars = { buyerRef: 'cust_000000000001', lotId: L250, priceMinor: 29_900_000 };
  const ct = await s.deals.createContract(b, closing.id, { expectedClosingRevision: val.closing.revision, template: { templateId: 'tpl-test', templateVersion: '1' }, documentVersionId: 'docv_00000001', variables: vars });
  assert.equal(ct.version.generatedFromProposalVersionId, acc.version.id); assert.equal(ct.version.termsChecksum, acc.version.checksum); assert.equal(ct.version.template.templateVersion, '1');
  assert.deepEqual(ct.version.resolvedVariables, ['buyerRef', 'lotId', 'priceMinor']); assert.equal(ct.version.priceMinor, undefined, 'values are not stored in the contract record');
  const iss = await s.deals.issueContract(m, ct.contract.id, { expectedRevision: 1, contractVersionId: ct.version.id });
  assert.equal(iss.version.status, 'ISSUED'); assert.equal(iss.contract.status, 'READY_FOR_SIGNATURE');
  // ContractCorrection: V1 preserved, V2 created and issued
  const cor = await s.deals.correctContract(b, ct.contract.id, { expectedRevision: iss.contract.revision, documentVersionId: 'docv_00000002', variables: vars });
  assert.equal(cor.version.versionNumber, 2); assert.equal(s.store.rows('contractVersion').find(v => v.id === ct.version.id).status, 'SUPERSEDED');
  const iss2 = await s.deals.issueContract(m, ct.contract.id, { expectedRevision: cor.contract.revision, contractVersionId: cor.version.id });
  assert.equal(iss2.version.status, 'ISSUED');
  // sale cannot complete before the signature evidence
  const lot = () => s.store.lot(L250);
  await assert.rejects(s.deals.completeSale(m, closing.id, { expectedClosingRevision: iss2.closing.revision, expectedAvailabilityRevision: lot().revision, completionEvidenceRefs: ['doc:x'], idempotencyKey: key() }),
    e => e.code === 'SALE_COMPLETION_REQUIREMENTS_NOT_MET' && e.details.blockingItems.includes('SIGNATURE_INCOMPLETE'));
  const { envelope } = await s.deals.sendForSignature(m, ct.contract.id, { provider: 'fakesign', expectedRevision: iss2.contract.revision });
  const hook = ev => { const raw = JSON.stringify(ev); return s.deals.handleSignatureWebhook({ provider: 'fakesign', rawBody: raw, headers: { 'x-signature': s.signer.sign(raw) } }); };
  await assert.rejects(s.deals.handleSignatureWebhook({ provider: 'fakesign', rawBody: '{"eventId":"e0"}', headers: { 'x-signature': 'f'.repeat(64) } }), code('SIGNATURE_WEBHOOK_INVALID'));
  assert.ok(s.logs.some(l => l[2] && l[2].securityEvent === 'SIGNATURE_WEBHOOK_INVALID'));
  await hook({ eventId: 'e1', externalEnvelopeId: envelope.externalEnvelopeId, status: 'PARTIALLY_SIGNED' }); // ClosingSignaturePartial
  assert.equal(s.store.rows('contract')[0].status, 'PARTIALLY_SIGNED');
  let cl = (await s.deals.getClosing(m, closing.id)).closing;
  await assert.rejects(s.deals.completeSale(m, closing.id, { expectedClosingRevision: cl.revision, expectedAvailabilityRevision: lot().revision, completionEvidenceRefs: ['doc:x'], idempotencyKey: key() }), code('SALE_COMPLETION_REQUIREMENTS_NOT_MET'));
  await hook({ eventId: 'e2', externalEnvelopeId: envelope.externalEnvelopeId, status: 'COMPLETED' }); // ClosingSignatureCompleted
  const replay = await hook({ eventId: 'e2', externalEnvelopeId: envelope.externalEnvelopeId, status: 'COMPLETED' });
  assert.equal(replay.duplicate, true);
  assert.equal(s.store.audit.filter(a => a.action === 'SIGNATURE_COMPLETION').length, 1, 'no duplicate transition');
  assert.equal(s.store.rows('contractVersion').find(v => v.id === cor.version.id).status, 'SIGNED');
  await assert.rejects(s.deals.correctContract(b, ct.contract.id, { expectedRevision: s.store.rows('contract')[0].revision, documentVersionId: 'docv_3', variables: vars }), code('CONTRACT_VERSION_IMMUTABLE'));
  // atomicity: wrong availability revision → nothing changes
  cl = (await s.deals.getClosing(m, closing.id)).closing;
  await assert.rejects(s.deals.completeSale(m, closing.id, { expectedClosingRevision: cl.revision, expectedAvailabilityRevision: 1, completionEvidenceRefs: ['doc:x'], idempotencyKey: key() }), code('AVAILABILITY_REVISION_CONFLICT'));
  assert.equal(s.store.rows('saleOutcome').length, 0); assert.equal(lot().status, 'RESERVED');
  await assert.rejects(s.deals.completeSale(b, closing.id, { expectedClosingRevision: cl.revision, expectedAvailabilityRevision: lot().revision, completionEvidenceRefs: ['doc:x'], idempotencyKey: key() }), code('PERMISSION_DENIED'));
  const k = key();
  const done = await s.deals.completeSale(m, closing.id, { expectedClosingRevision: cl.revision, expectedAvailabilityRevision: lot().revision, completionEvidenceRefs: ['doc:signed-envelope'], idempotencyKey: k });
  assert.equal(done.closing.status, 'COMPLETED'); assert.equal(done.outcome.outcome, 'WON'); assert.equal(done.availability.status, 'SOLD'); assert.equal(lot().status, 'SOLD');
  assert.equal(done.outcome.completionPolicyRef, 'won-test@1');
  const again = await s.deals.completeSale(m, closing.id, { expectedClosingRevision: cl.revision, expectedAvailabilityRevision: done.availability.revision - 1, completionEvidenceRefs: ['doc:signed-envelope'], idempotencyKey: k });
  assert.equal(again.idempotentReplay, true);
  await assert.rejects(s.deals.completeSale(m, closing.id, { expectedClosingRevision: done.closing.revision, expectedAvailabilityRevision: lot().revision, completionEvidenceRefs: ['x'], idempotencyKey: key() }), code('SALE_ALREADY_COMPLETED'));
  await assert.rejects(s.deals.cancelClosing(m, closing.id, { expectedRevision: done.closing.revision, reasonCode: 'OTHER' }), code('SALE_ALREADY_COMPLETED'));
  assert.equal(s.store.rows('saleOutcome').length, 1);
  // sold lot cannot receive a new reservation
  await assert.rejects(s.deals.createReservation(b, RES({ expectedAvailabilityRevision: lot().revision, customerId: 'cust_000000000002' })), code('LOT_NOT_AVAILABLE'));
  const phases = s.store.rows('commercialCase').map(c => c.phase);
  assert.deepEqual(phases, ['COMPLETED']);
  assert.ok(s.store.outbox.some(e => e.type === 'SaleCompleted')); assert.ok(s.store.outbox.some(e => e.type === 'JourneyEvent' && e.payload.eventType === 'SALE_WON'));
});

test('ClosingCancelledReleasesLot (policy AVAILABLE) and requires a configured cancellation policy', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const { closing, m } = await closingReady(s);
  await assert.rejects(s.deals.cancelClosing(m, closing.id, { expectedRevision: closing.revision }), code('REASON_CODE_REQUIRED'));
  const r = await s.deals.cancelClosing(m, closing.id, { expectedRevision: closing.revision, reasonCode: 'FINANCING_FAILED' });
  assert.equal(r.closing.status, 'CANCELLED'); assert.equal(r.outcome.outcome, 'CANCELLED'); assert.equal(s.store.lot(L250).status, 'AVAILABLE');
  assert.ok(s.store.rows('proposalVersion').length >= 1, 'history kept');
  const s2 = setup({ policy: merge(CONFIGURED, { closingCancellation: { availabilityAfterCancel: null } }), lots: { [L250]: AVAIL } });
  const c2 = await closingReady(s2);
  await assert.rejects(s2.deals.cancelClosing(c2.m, c2.closing.id, { expectedRevision: c2.closing.revision, reasonCode: 'OTHER' }), e => e.code === 'POLICY_NOT_CONFIGURED' && e.details.policy === 'closingCancellation.availabilityAfterCancel');
  assert.equal(s2.store.lot(L250).status, 'RESERVED');
});

test('WON is never inferred: without a configured SaleCompletionPolicy the sale is refused (POLICY_NOT_CONFIGURED)', async () => {
  const s = setup({ policy: merge(CONFIGURED, { saleCompletion: { requiredConditions: null } }), lots: { [L250]: AVAIL } });
  const { closing, m } = await closingReady(s);
  await assert.rejects(s.deals.completeSale(m, closing.id, { expectedClosingRevision: closing.revision, expectedAvailabilityRevision: s.store.lot(L250).revision, completionEvidenceRefs: ['x'], idempotencyKey: key() }),
    e => e.code === 'POLICY_NOT_CONFIGURED' && e.details.policy === 'saleCompletion.requiredConditions');
  assert.equal(s.store.lot(L250).status, 'RESERVED');
});

test('SaleLostAfterProposal + SaleLostAfterReservation: outcome LOST with reason code, reservation released, journey continues', async () => {
  const s = setup({ lots: { [L250]: AVAIL, [L250B]: { status: 'AVAILABLE', revision: 9 } } }), b = broker();
  const p1 = await s.deals.createProposal(b, { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  await s.deals.submitProposal(b, p1.proposal.id, { expectedRevision: 1, idempotencyKey: key() });
  await assert.rejects(s.deals.recordLost(b, p1.proposal.id, { expectedRevision: 2, reasonCode: 'BECAUSE' }), code('REASON_CODE_REQUIRED'));
  const l1 = await s.deals.recordLost(b, p1.proposal.id, { expectedRevision: 2, reasonCode: 'PRICE', note: 'achou caro' });
  assert.equal(l1.outcome.outcome, 'LOST'); assert.equal(l1.proposal.status, 'CANCELLED');
  const acc = await acceptedProposal(s, L250B, 'cust_000000000002');
  await s.deals.createReservation(b, RES({ lotId: L250B, customerId: 'cust_000000000002', proposalId: acc.proposal.id, expectedAvailabilityRevision: 9 }));
  assert.equal(s.store.lot(L250B).status, 'RESERVED');
  const cur = (await s.deals.getProposal(b, acc.proposal.id)).proposal;
  const l2 = await s.deals.recordLost(b, acc.proposal.id, { expectedRevision: cur.revision, reasonCode: 'CREDIT' });
  assert.equal(l2.reservation.status, 'RELEASED'); assert.equal(s.store.lot(L250B).status, 'AVAILABLE');
  assert.deepEqual(s.store.outbox.filter(e => e.payload && e.payload.eventType === 'SALE_LOST').map(e => e.payload.reasonCode), ['PRICE', 'CREDIT']);
});

// ============================================================================ security & privacy
test('CrossTenantProposalDenied (404 = same as missing, security event) + UnauthorizedReservationDenied', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const c = await s.deals.createProposal(broker(), { developmentId: DEV, customerId: 'cust_000000000001', lotId: L250, proposalType: 'BROKER_MEDIATED', terms: TERMS() });
  await assert.rejects(s.deals.getProposal(outsider(), c.proposal.id), code('PROPOSAL_NOT_FOUND'));
  await assert.rejects(s.deals.getProposal(outsider(), 'prop_999999999999'), code('PROPOSAL_NOT_FOUND'));
  await assert.rejects(s.deals.submitProposal(outsider(), c.proposal.id, { expectedRevision: 1, idempotencyKey: key() }), code('PROPOSAL_NOT_FOUND'));
  assert.ok(s.logs.some(l => l[2] && l[2].securityEvent === 'CROSS_TENANT_COMMERCIAL_ACCESS'));
  const viewer = broker(['proposal.read', 'reservation.read']);
  await assert.rejects(s.deals.createReservation(viewer, RES()), code('PERMISSION_DENIED'));
  assert.ok(s.logs.some(l => l[2] && l[2].securityEvent === 'UNAUTHORIZED_RESERVATION_OVERRIDE'));
  await assert.rejects(s.deals.createReservation({ organizationId: ORG, permissions: ALL }, RES()), code('PERMISSION_DENIED'), 'no actor = no write');
  assert.equal(s.store.lot(L250).status, 'AVAILABLE');
});

test('privacy: no customer name, notes or terms in logs, audit, outbox; lot state never exposes who reserved; client-safe snapshot hides internal data', async () => {
  const s = setup({ lots: { [L250]: AVAIL } });
  const r = await acceptedProposal(s);
  await s.deals.createReservation(broker(), RES({ proposalId: r.proposal.id }));
  const dump = JSON.stringify([s.logs, s.store.audit, s.store.outbox]);
  for (const bad of ['Maria', 'Silva', 'nota interna', 'desconto', '29900000', 'offerPriceMinor']) assert.ok(!dump.includes(bad), bad);
  const st = await s.deals.lotCommercialState(broker(['lot.view']), DEV, L250);
  assert.deepEqual([st.availabilityStatus, st.reservedUntil, st.activeProposalCount], ['RESERVED', null, null]);
  const st2 = await s.deals.lotCommercialState(broker(), DEV, L250);
  assert.equal(st2.activeProposalCount, 1); assert.ok(!JSON.stringify(st2).includes('cust_'));
  const snap = await s.deals.getPresentationSnapshot(broker(), r.proposal.id);
  assert.equal(snap.proposalVersionId, r.version.id); assert.equal(snap.clientSafeTerms.offerPriceMinor, 29_900_000);
  const sj = JSON.stringify(snap);
  for (const bad of ['notes', 'nota interna', 'approval', 'listPriceMinor', 'requestedDiscount', 'cust_']) assert.ok(!sj.includes(bad), bad);
  const board = await s.deals.reservationBoard(broker(['reservation.read']), DEV);
  assert.equal(board[0].customerId, null, 'customer ref only with proposal.read');
});

// ============================================================================ persistence contract, HTTP, OpenAPI
test('migration 011: every TABLES column exists in its CREATE TABLE; down script drops every table; Pg store SQL uses the same columns', async () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '011_deals.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '011_deals.down.sql'), 'utf8');
  for (const t of Object.values(repo.TABLES)) {
    const m = up.match(new RegExp(`CREATE TABLE ${t.table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(m, t.table);
    for (const c of ['id', 'organization_id', 'revision', 'data', 'created_at', 'updated_at', ...Object.values(t.cols)]) assert.match(m[1], new RegExp(`\\n  ${c}\\s`), `${t.table}.${c}`);
    assert.ok(down.includes(`DROP TABLE IF EXISTS ${t.table};`), t.table);
  }
  for (const x of ['deal_reservations_one_live_per_lot', 'deal_proposal_version_immutable', 'deal_contract_version_immutable', 'deal_signature_webhook_events_replay', 'deal_sale_outcomes_one_won', 'deal_idempotency', 'deal_outbox']) assert.ok(up.includes(x), x);
  const queries = [];
  const client = { query: async (sql, vals) => { queries.push([sql, vals]); return { rows: [], rowCount: 1 }; }, release() {} };
  const pg = repo.createPgDealsStore({ connect: async () => client }, { App });
  await pg.transaction(async tx => {
    await tx.insert('reservation', { id: 'resv_000000000001', organizationId: ORG, developmentId: DEV, lotId: L250, customerId: 'cust_000000000001', proposalId: null, status: 'ACTIVE', expiresAt: D.iso(T0) });
    await tx.update('reservation', { id: 'resv_000000000001', organizationId: ORG, developmentId: DEV, lotId: L250, status: 'RELEASED' }, 1);
    await tx.find('reservation', { organizationId: ORG, lotId: L250, status: ['ACTIVE'] });
  });
  const ins = queries.find(q => q[0].startsWith('INSERT INTO deal_reservations'));
  assert.match(ins[0], /\(id, organization_id, development_id, lot_id, customer_id, proposal_id, status, expires_at, revision, data\)/);
  assert.match(queries.find(q => q[0].startsWith('UPDATE deal_reservations'))[0], /WHERE id = \$1 AND revision = \$2/);
  assert.match(queries.find(q => q[0].startsWith('SELECT data, revision FROM deal_reservations'))[0], /organization_id = \$1 AND lot_id = \$2 AND status = ANY\(\$3\)/);
  assert.equal(queries[0][0].startsWith('BEGIN'), true); assert.equal(queries.at(-1)[0], 'COMMIT');
});

test('HTTP adapter + OpenAPI fragment: every route policy has a handler and an operation; DealError → stable ApiError; SYSTEM principal; fragment up to date', async () => {
  const routes = [];
  const router = { get: (t, h, m) => routes.push(['GET', t, h, m]), post: (t, h, m) => routes.push(['POST', t, h, m]), patch: (t, h, m) => routes.push(['PATCH', t, h, m]) };
  const s = setup({ lots: { [L250]: AVAIL } });
  ctl.registerDealsRoutes(router, { deals: s.deals });
  assert.deepEqual(routes.map(r => `${r[0]} ${r[1]}`).sort(), Object.keys(ctl.DEALS_ROUTE_POLICIES).sort());
  const doc = oas.build();
  const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map(m => `${m.toUpperCase()} ${p.replace(/\{([^}]+)\}/g, ':$1')}`)).sort();
  assert.deepEqual(documented, Object.keys(ctl.DEALS_ROUTE_POLICIES).sort());
  assert.equal(fs.readFileSync(oas.FILE, 'utf8'), oas.render(), 'run node src/modules/deals/deals.openapi.js');
  for (const p of ctl.DEALS_PERMISSIONS) assert.ok(/^[a-z_]+\.[a-z_]+$/.test(p.key) && ['MEDIUM', 'HIGH', 'CRITICAL'].includes(p.riskLevel), p.key);
  const http = ctl.toHttp(new D.DealError('LOT_ALREADY_RESERVED', { lotId: L250 }));
  assert.equal(http.status, 409); assert.equal(http.code, 'LOT_ALREADY_RESERVED');
  const sys = ctl.dealsPrincipal({ principal: { type: 'SYSTEM', actorId: 'admin' } }, ORG);
  assert.equal(sys.permissions.length, ctl.DEALS_PERMISSIONS.length);
  const user = ctl.dealsPrincipal({ principal: { type: 'USER', status: 'ACTIVE', actorId: 'u1', memberships: [{ organizationId: ORG, status: 'ACTIVE' }], assignments: [{ roleCode: 'OWNER_ADMIN', organizationId: ORG, developmentId: null }] } }, ORG, DEV);
  // decision 2026-10-18 (Edmilson): OWNER_ADMIN holds every deals key; any other role holds none (round5Wiring.test.js)
  assert.deepEqual(user.permissions, ctl.DEALS_PERMISSIONS.map(p => p.key), 'OWNER_ADMIN holds every deals permission (decision 2026-10-18)');
  const broker = ctl.dealsPrincipal({ principal: { type: 'USER', status: 'ACTIVE', actorId: 'u2', memberships: [{ organizationId: ORG, status: 'ACTIVE' }], assignments: [{ roleCode: 'COMMERCIAL_MANAGER', organizationId: ORG, developmentId: null }] } }, ORG, DEV);
  assert.deepEqual(broker.permissions, [], 'no other role grants a deals permission (deny by default)');
  // handler end-to-end through the adapter (SYSTEM principal)
  const h = routes.find(r => r[0] === 'GET' && r[1] === '/api/v1/proposals/:proposalId')[2];
  await assert.rejects(h({ req: { method: 'GET', headers: {} }, params: { proposalId: 'prop_000000000999' }, principal: { type: 'SYSTEM', actorId: 'admin' }, access: { organizationId: ORG }, requestId: 'r1' }), e => e.status === 404 && e.code === 'PROPOSAL_NOT_FOUND');
});

test('frontend read-only domain mirrors the backend enums, chips and error codes (no drift)', () => {
  const ctx = { App: {} };
  new Function('App', fs.readFileSync(path.join(PLAT, 'src', 'deals', 'dealsDomain.js'), 'utf8'))(ctx.App);
  const F = ctx.App.deals.domain;
  for (const k of ['ProposalStatus', 'ReservationStatus', 'ClosingStatus', 'ContractStatus', 'EnvelopeStatus', 'SaleOutcomeType', 'LostReason', 'CancelReason', 'CasePhase']) assert.deepEqual([...Object.keys(F[k])], Object.keys(D[k]), k);
  assert.deepEqual([...F.ERROR_CODES].sort(), Object.keys(D.ERRORS).sort());
  assert.deepEqual([...F.PERMISSIONS].sort(), ctl.DEALS_PERMISSIONS.map(p => p.key).sort());
});
