'use strict';
/* DealsService — application services of topic 57 (server-side authorization, tenant scoping, policies, atomicity).
   Ports (all injected; DB-free tests use the memory implementations):
     store       DealsStore (deals.repository.js): transactions, aggregates, idempotency, audit, outbox, availability lock
     policies    { getPolicy(orgId, devId) } → resolved org policy (deals.policy.js; null values = necessita confirmação)
     pricing     { quote(devId, lotId) } → { developmentId, lotId, priceTableId, priceTableVersion, listPriceMinor, currency } | null
                 (the CURRENT published price table; the list price is copied, never recomputed here)
     customers   { find(orgId, customerId) } → { id, organizationId, presentFields: [] } | null (persisted Customer, §127)
     signatureProviders { [provider]: { createEnvelope, getStatus, cancelEnvelope, verifyWebhook } } (adapter, §100–§102)
     now()       SERVER clock in ms (injectable; the browser clock is never trusted, §74, §200)
     idGen(prefix) opaque ids (prop_…, never phone/CPF/name/lotId, §13)
     logger, metrics  ids and codes only — never names, notes, terms or documents (§178, §406)
   Principal: { actorId, actorType: 'USER'|'SYSTEM', organizationId, permissions: string[] } (effective permissions in the
   development scope, resolved by IAM). Nothing here trusts frontend state (§317). */
const crypto = require('crypto');
const D = require('./deals.domain');
const { requirePolicy, authorityOf } = require('./deals.policy');
const { checksumOf } = require('../../shared/domain/checksum');

const { fail, DealError } = D;
const IDEM_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PERM = Object.freeze({
  PROPOSAL_READ: 'proposal.read', PROPOSAL_CREATE: 'proposal.create', PROPOSAL_UPDATE_DRAFT: 'proposal.update_draft', PROPOSAL_SUBMIT: 'proposal.submit', PROPOSAL_WITHDRAW: 'proposal.withdraw',
  PROPOSAL_REVIEW: 'proposal.review', PROPOSAL_COUNTER: 'proposal.counter', PROPOSAL_ACCEPT: 'proposal.accept', PROPOSAL_REJECT: 'proposal.reject',
  RESERVATION_READ: 'reservation.read', RESERVATION_CREATE: 'reservation.create', RESERVATION_EXTEND: 'reservation.extend', RESERVATION_RELEASE: 'reservation.release', RESERVATION_CANCEL: 'reservation.cancel',
  CLOSING_READ: 'closing.read', CLOSING_MANAGE: 'closing.manage', CLOSING_VALIDATE_DOCUMENTS: 'closing.validate_documents', CONTRACT_GENERATE: 'contract.generate', CONTRACT_ISSUE: 'contract.issue',
  SIGNATURE_MANAGE: 'signature.manage', SALE_COMPLETE: 'sale.complete', SALE_CANCEL: 'sale.cancel', APPROVAL_REQUEST: 'commercial_approval.request', APPROVAL_DECIDE: 'commercial_approval.decide'
});
const NOT_FOUND = { proposal: 'PROPOSAL_NOT_FOUND', reservation: 'RESERVATION_NOT_FOUND', closing: 'CLOSING_NOT_FOUND', contract: 'CONTRACT_NOT_FOUND', approval: 'APPROVAL_NOT_FOUND', commercialCase: 'PROPOSAL_NOT_FOUND' };
const UNAVAILABLE_FOR_SALE = new Set(['SOLD', 'UNAVAILABLE', 'BLOCKED']);

function defaultIdGen(prefix) { return `${prefix}_${crypto.randomBytes(16).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 22).padEnd(22, '0')}`; }
const noopMetrics = { inc() {}, observe() {} };
const noopLogger = { info() {}, warn() {}, error() {} };

function createDealsService({ store, policies, pricing, customers = { async find() { return null; } }, signatureProviders = {}, now = () => Date.now(), idGen = defaultIdGen, logger = noopLogger, metrics = noopMetrics }) {
  const nowIso = () => D.iso(now());
  const has = (p, perm) => !!(p && Array.isArray(p.permissions) && p.permissions.includes(perm));
  function securityEvent(type, p, extra = {}) { logger.warn('security event', { securityEvent: type, actorId: p && p.actorId, organizationId: p && p.organizationId, ...extra }); }
  function authorize(p, perm, extra = {}) {
    if (!p || !p.organizationId || !p.actorId) fail('PERMISSION_DENIED', { permission: perm, reason: 'AUTH_REQUIRED' });
    if (!has(p, perm)) {
      securityEvent(perm.startsWith('reservation.') || perm.startsWith('sale.') ? 'UNAUTHORIZED_RESERVATION_OVERRIDE' : 'UNAUTHORIZED_PROPOSAL_ACCESS', p, { permission: perm, ...extra });
      fail('PERMISSION_DENIED', { permission: perm });
    }
  }
  /** tenant-scoped load: another organization's id answers exactly like a missing one (§263–§264) */
  async function load(tx, kind, id, p) {
    const e = typeof id === 'string' && D.ID_RE.test(id) ? await tx.get(kind, id) : null;
    if (!e) fail(NOT_FOUND[kind] || 'VALIDATION_ERROR', { id });
    if (e.organizationId !== p.organizationId) { securityEvent('CROSS_TENANT_COMMERCIAL_ACCESS', p, { kind }); fail(NOT_FOUND[kind], { id }); }
    return e;
  }
  const expectRevision = (e, expected, kind) => { if (!Number.isInteger(expected)) fail('VALIDATION_ERROR', [{ field: 'expectedRevision', issue: 'required_integer' }]); if (e.revision !== expected) fail('REVISION_CONFLICT', { kind, id: e.id, expectedRevision: expected, currentRevision: e.revision }); };
  async function audit(tx, p, action, entityType, e, data = {}, requestId = null) {
    await tx.audit({ actorId: p.actorId, actorType: p.actorType || 'USER', action, entityType, entityId: e.id, developmentId: e.developmentId || null, organizationId: p.organizationId, requestId, data, outcome: 'SUCCESS' });
  }
  async function emit(tx, p, type, aggregateType, e, payload = {}) { await tx.outbox({ organizationId: p.organizationId, type, aggregateType, aggregateId: e.id, payload, occurredAt: nowIso() }); }
  async function journey(tx, p, eventType, refs) { await emit(tx, p, 'JourneyEvent', 'commercialCase', { id: refs.commercialCaseId || refs.proposalId || refs.reservationId }, { eventType, ...refs }); } // refs only, never terms (§121)
  async function idempotent(tx, p, name, key, payload, fn) {
    if (typeof key !== 'string' || !IDEM_RE.test(key)) fail('IDEMPOTENCY_KEY_REQUIRED', { command: name });
    const scope = `${p.organizationId}:${p.actorId}:${name}`, hash = checksumOf(payload);
    const ex = await tx.idemGet(scope, key);
    if (ex) { if (ex.hash !== hash) fail('IDEMPOTENCY_KEY_REUSED', { command: name }); return { ...ex.response, idempotentReplay: true }; }
    const out = await fn();
    await tx.idemPut(scope, key, { hash, response: out });
    return out;
  }
  const timed = async (metric, fn) => { const t0 = now(); try { return await fn(); } finally { metrics.observe(metric, Math.max(0, now() - t0)); } };
  const run = (command, p, requestId, fn) => store.transaction(fn).then(out => { logger.info('deal command', { command, requestId, actorId: p && p.actorId, outcome: 'OK' }); return out; },
    e => { logger.info('deal command', { command, requestId, actorId: p && p.actorId, outcome: 'ERROR', code: e.code || 'INTERNAL' }); throw e; });
  const policyOf = (p, devId) => policies.getPolicy(p.organizationId, devId);
  const writable = (pol, domain) => { const m = authorityOf(pol, domain); if (m === 'REFERENCE_ONLY' || m === 'EXTERNAL_MASTER') fail('COMMERCIAL_AUTHORITY_EXTERNAL', { domain, mode: m }); return m; };
  const reasonOf = (code, registry) => { if (!code || !registry[code]) fail('REASON_CODE_REQUIRED', { allowed: Object.keys(registry) }); return code; };
  const expired = (e, field) => e[field] != null && Date.parse(e[field]) <= now();

  // ------------------------------------------------------------------------- commercial case projection (read model)
  async function refreshCase(tx, p, { caseId, proposal, reservation, closing, outcome, base }) {
    let c = caseId ? await tx.get('commercialCase', caseId) : null;
    const phase = D.projectPhase({ proposal, reservation, closing, outcome });
    if (!c) {
      c = { id: idGen('ccase'), organizationId: p.organizationId, developmentId: base.developmentId, customerId: base.customerId, lotId: base.lotId, decisionSessionId: base.decisionSessionId || null,
        proposalId: proposal ? proposal.id : null, reservationId: reservation ? reservation.id : null, closingCaseId: closing ? closing.id : null, phase, updatedAt: nowIso() };
      return tx.insert('commercialCase', c);
    }
    return tx.update('commercialCase', { ...c, proposalId: proposal ? proposal.id : c.proposalId, reservationId: reservation ? reservation.id : c.reservationId, closingCaseId: closing ? closing.id : c.closingCaseId, phase, updatedAt: nowIso() }, c.revision);
  }
  async function caseFor(tx, p, { proposalId, reservationId }) {
    const rows = proposalId ? await tx.find('commercialCase', { organizationId: p.organizationId, proposalId }) : [];
    if (rows.length) return rows[0];
    const r2 = reservationId ? (await tx.find('commercialCase', { organizationId: p.organizationId })).filter(c => c.reservationId === reservationId) : [];
    return r2[0] || null;
  }

  // ------------------------------------------------------------------------- proposals
  async function createProposal(p, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_CREATE);
    const pol = await policyOf(p, cmd.developmentId);
    writable(pol, 'proposal');
    if (!D.ProposalType[cmd.proposalType]) fail('VALIDATION_ERROR', [{ field: 'proposalType', issue: 'enum' }]);
    const source = cmd.source || 'BROKER'; if (!D.VersionSource[source]) fail('VALIDATION_ERROR', [{ field: 'source', issue: 'enum' }]);
    const customer = await customers.find(p.organizationId, cmd.customerId);
    if (!customer || customer.organizationId !== p.organizationId) fail('CUSTOMER_NOT_FOUND', { customerId: cmd.customerId });
    const quote = await pricing.quote(cmd.developmentId, cmd.lotId);
    const { terms, issues } = D.normalizeTerms(cmd.terms || { conditions: [] });
    if (!terms) fail('VALIDATION_ERROR', issues);
    if (issues.length) fail('VALIDATION_ERROR', issues); // a draft may be incomplete, never malformed (§130)
    return run('createProposal', p, requestId, async tx => {
      const lot = await tx.lockLot(cmd.developmentId, cmd.lotId);
      if (!lot) fail('LOT_NOT_FOUND', { lotId: cmd.lotId });
      const at = nowIso(), id = idGen('prop'), vid = idGen('pver');
      const version = { id: vid, organizationId: p.organizationId, proposalId: id, versionNumber: 1, status: 'DRAFT', terms, pricing: D.pricingBreakdown(quote, terms), pricingSnapshotRef: quote ? D.pricingSnapshotRef(quote) : null,
        availabilitySnapshotRef: D.availabilitySnapshotRef(cmd.developmentId, cmd.lotId, lot), financialSimulationRef: cmd.financialSimulationRef || null, source, createdBy: p.actorId, createdAt: at, validUntil: terms.validityDate || null, supersedesVersionId: null };
      version.checksum = D.versionChecksum(version);
      const proposal = { id, organizationId: p.organizationId, developmentId: cmd.developmentId, customerId: customer.id, decisionSessionId: cmd.decisionSessionId || null, lotId: cmd.lotId,
        status: 'DRAFT', currentVersionId: vid, proposalType: cmd.proposalType, parties: [{ customerId: customer.id, role: 'BUYER' }], createdBy: p.actorId, createdAt: at, updatedAt: at, expiresAt: null, reservationId: null, negotiationId: null };
      const saved = await tx.insert('proposal', proposal);
      await tx.insert('proposalVersion', version);
      const c = await refreshCase(tx, p, { proposal: saved, base: proposal });
      await emit(tx, p, 'ProposalCreated', 'proposal', saved, { lotId: saved.lotId });
      await journey(tx, p, 'PROPOSAL_CREATED', { commercialCaseId: c.id, proposalId: id, customerId: customer.id, lotId: cmd.lotId });
      metrics.inc('proposal_created_total');
      return { proposal: saved, version, commercialCaseId: c.id };
    });
  }

  async function updateDraft(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_UPDATE_DRAFT);
    const { terms, issues } = D.normalizeTerms(cmd.terms);
    if (!terms || issues.length) fail('VALIDATION_ERROR', issues);
    return run('updateDraft', p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      if (pr.status !== 'DRAFT') fail('PROPOSAL_VERSION_IMMUTABLE', { status: pr.status });
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      if (v.status !== 'DRAFT') fail('PROPOSAL_VERSION_IMMUTABLE', { versionStatus: v.status });
      const quote = await pricing.quote(pr.developmentId, pr.lotId);
      const nv = { ...v, terms, pricing: D.pricingBreakdown(quote, terms), pricingSnapshotRef: quote ? D.pricingSnapshotRef(quote) : null, financialSimulationRef: cmd.financialSimulationRef ?? v.financialSimulationRef, validUntil: terms.validityDate || null };
      nv.checksum = D.versionChecksum(nv);
      const savedV = await tx.update('proposalVersion', nv, v.revision);
      const saved = await tx.update('proposal', { ...pr, updatedAt: nowIso() }, pr.revision);
      return { proposal: saved, version: savedV };
    });
  }

  /** approvals required by the configured rules for a version, and which are still missing */
  async function missingApprovals(tx, p, pol, proposal, version, extra = {}) {
    const rules = requirePolicy(pol, 'approval.rules');
    const required = D.requiredApprovals(rules, version.pricing, version.terms, extra);
    const approvals = await tx.find('approval', { organizationId: p.organizationId, proposalId: proposal.id, status: 'APPROVED' });
    const tc = checksumOf(version.terms); // approvals target the exact terms (draft, issued or counter terms)
    const mine = approvals.filter(a => a.termsChecksum === tc);
    const missing = required.filter(r => !mine.some(a => a.approvalType === r.approvalType && a.ruleCode === r.ruleCode));
    return { required, missing, approvals: mine };
  }

  async function issueChecks(tx, p, pol, pr, version, { lot, quote }) {
    const sub = { requiredCustomerFields: requirePolicy(pol, 'submission.requiredCustomerFields'), requiredProposalFields: requirePolicy(pol, 'submission.requiredProposalFields'),
      requireFinancialSimulation: requirePolicy(pol, 'submission.requireFinancialSimulation'), requireAvailabilityFreshness: requirePolicy(pol, 'submission.requireAvailabilityFreshness'),
      maxAvailabilityAgeSeconds: pol.submission.maxAvailabilityAgeSeconds };
    const customer = await customers.find(p.organizationId, pr.customerId);
    const ageS = lot && lot.updatedAt ? Math.floor((now() - Date.parse(lot.updatedAt)) / 1000) : null;
    const { terms, issues } = D.normalizeTerms(version.terms);
    const res = D.validateForIssue({ proposal: pr, terms, termIssues: issues, customer: customer && customer.organizationId === p.organizationId ? customer : null, submissionPolicy: sub, quote, availability: lot, now: now(), availabilityAgeSeconds: ageS,
      versionRefs: { pricingSnapshotRef: quote ? D.pricingSnapshotRef(quote) : null, availabilitySnapshotRef: lot ? D.availabilitySnapshotRef(pr.developmentId, pr.lotId, lot) : null, financialSimulationRef: version.financialSimulationRef || null } });
    // historical price table only if the policy permits (§134): by default the draft must match the CURRENT table
    if (quote && version.pricing && version.pricing.priceTableVersion !== quote.priceTableVersion) res.blockingErrors.push('PRICE_TABLE_VERSION_CHANGED');
    if (res.blockingErrors.length) fail('PROPOSAL_INVALID', { ...res, status: 'INVALID' });
    return res;
  }

  async function concurrencyCheck(tx, p, pol, pr) {
    const mode = requirePolicy(pol, 'proposalConcurrency.mode');
    if (mode === 'MULTIPLE_PROPOSALS_ALLOWED') return;
    if (mode === 'SINGLE_ACTIVE_PROPOSAL') {
      const others = (await tx.find('proposal', { organizationId: p.organizationId, lotId: pr.lotId, status: ['SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED'] })).filter(x => x.id !== pr.id);
      if (others.length) fail('PROPOSAL_CONCURRENCY_CONFLICT', { mode, activeProposals: others.length }); // count only: no other customer's identity
    }
    if (mode === 'RESERVATION_REQUIRED') {
      const live = (await tx.find('reservation', { organizationId: p.organizationId, lotId: pr.lotId, status: ['ACTIVE'] })).filter(r => r.customerId === pr.customerId);
      if (!live.length) fail('PROPOSAL_CONCURRENCY_CONFLICT', { mode, reason: 'RESERVATION_REQUIRED' });
    }
  }

  async function submitProposal(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_SUBMIT);
    return timed('proposal_submit_duration_ms', () => run('submitProposal', p, requestId, async tx => idempotent(tx, p, 'submitProposal', cmd.idempotencyKey, { proposalId, expectedRevision: cmd.expectedRevision }, async () => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      D.assertTransition('proposal', pr.status, 'SUBMITTED');
      const pol = await policyOf(p, pr.developmentId);
      writable(pol, 'proposal');
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      const [lot, quote] = [await tx.lockLot(pr.developmentId, pr.lotId), await pricing.quote(pr.developmentId, pr.lotId)];
      const validation = await issueChecks(tx, p, pol, pr, v, { lot, quote });
      await concurrencyCheck(tx, p, pol, pr);
      const { missing, approvals } = await missingApprovals(tx, p, pol, pr, v);
      if (missing.length) fail('COMMERCIAL_APPROVAL_REQUIRED', { required: missing.map(m => ({ ruleCode: m.ruleCode, approvalType: m.approvalType })) });
      const at = nowIso();
      const discountApproval = approvals.find(a => a.approvalType === 'DISCOUNT');
      const issued = { ...v, status: 'ISSUED', pricing: { ...D.pricingBreakdown(quote, v.terms), approvedDiscountMinor: discountApproval ? v.pricing.requestedDiscountMinor : null }, pricingSnapshotRef: validation.versionRefs.pricingSnapshotRef,
        availabilitySnapshotRef: validation.versionRefs.availabilitySnapshotRef, validUntil: v.terms.validityDate, issuedAt: at, approvalRefs: approvals.map(a => a.id) };
      issued.checksum = D.versionChecksum(issued);
      const savedV = await tx.update('proposalVersion', issued, v.revision);
      const neg = await tx.insert('negotiation', { id: idGen('neg'), organizationId: p.organizationId, developmentId: pr.developmentId, customerId: pr.customerId, lotId: pr.lotId, proposalId: pr.id, status: 'OPEN', currentProposalVersionId: v.id, openedAt: at, closedAt: null });
      await tx.insert('negotiationEvent', { id: idGen('nevt'), organizationId: p.organizationId, negotiationId: neg.id, eventType: 'PROPOSAL_SUBMITTED', proposalVersionId: v.id, actorType: actorKind(p), actorId: p.actorId, occurredAt: at });
      const saved = await tx.update('proposal', { ...pr, status: 'SUBMITTED', negotiationId: neg.id, expiresAt: issued.validUntil, updatedAt: at }, pr.revision);
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: saved, base: saved });
      await audit(tx, p, 'PROPOSAL_SUBMIT', 'proposal', saved, { versionId: v.id, versionNumber: v.versionNumber, checksum: issued.checksum, priceTableVersion: issued.pricing.priceTableVersion, availabilityRef: issued.availabilitySnapshotRef }, requestId);
      if (discountApproval) await audit(tx, p, 'DISCOUNT_APPROVAL_APPLIED', 'proposal_version', savedV, { approvalId: discountApproval.id }, requestId);
      await emit(tx, p, 'ProposalSubmitted', 'proposal', saved, { versionId: v.id });
      await journey(tx, p, 'PROPOSAL_SUBMITTED', { commercialCaseId: c && c.id, proposalId: pr.id, customerId: pr.customerId, lotId: pr.lotId });
      metrics.inc('proposal_submitted_total');
      return { proposal: saved, version: savedV, validation };
    })));
  }
  const actorKind = p => (p.actorType === 'SYSTEM' ? 'SYSTEM' : p.commercialRole && D.ActorType[p.commercialRole] ? p.commercialRole : 'BROKER');

  async function startReview(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_REVIEW);
    return run('startReview', p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      if (expired(pr, 'expiresAt')) fail('PROPOSAL_EXPIRED', { expiresAt: pr.expiresAt });
      D.assertTransition('proposal', pr.status, 'UNDER_REVIEW');
      return { proposal: await tx.update('proposal', { ...pr, status: 'UNDER_REVIEW', updatedAt: nowIso() }, pr.revision) };
    });
  }

  async function counterProposal(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_COUNTER);
    const { terms, issues } = D.normalizeTerms(cmd.terms);
    if (!terms || issues.length) fail('VALIDATION_ERROR', issues);
    const source = cmd.source || 'SELLER'; if (!D.VersionSource[source]) fail('VALIDATION_ERROR', [{ field: 'source', issue: 'enum' }]);
    return run('counterProposal', p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      if (cmd.expectedVersionId !== pr.currentVersionId) fail('PROPOSAL_VERSION_CONFLICT', { currentVersionId: pr.currentVersionId });
      if (expired(pr, 'expiresAt')) fail('PROPOSAL_EXPIRED', { expiresAt: pr.expiresAt });
      D.assertTransition('proposal', pr.status, 'COUNTERED');
      const pol = await policyOf(p, pr.developmentId);
      writable(pol, 'proposal');
      const prev = await tx.get('proposalVersion', pr.currentVersionId);
      const [lot, quote] = [await tx.lockLot(pr.developmentId, pr.lotId), await pricing.quote(pr.developmentId, pr.lotId)];
      const at = nowIso();
      const nv = { id: idGen('pver'), organizationId: p.organizationId, proposalId: pr.id, versionNumber: prev.versionNumber + 1, status: 'DRAFT', terms, pricing: D.pricingBreakdown(quote, terms), pricingSnapshotRef: quote ? D.pricingSnapshotRef(quote) : null,
        availabilitySnapshotRef: lot ? D.availabilitySnapshotRef(pr.developmentId, pr.lotId, lot) : null, financialSimulationRef: cmd.financialSimulationRef || null, source, createdBy: p.actorId, createdAt: at, validUntil: terms.validityDate || null, supersedesVersionId: prev.id };
      await issueChecks(tx, p, pol, pr, nv, { lot, quote });
      const { missing, approvals } = await missingApprovals(tx, p, pol, pr, nv);
      if (missing.length) fail('COMMERCIAL_APPROVAL_REQUIRED', { required: missing.map(m => ({ ruleCode: m.ruleCode, approvalType: m.approvalType })), hint: 'requestApproval with these counter terms first' });
      Object.assign(nv, { status: 'ISSUED', issuedAt: at, approvalRefs: approvals.map(a => a.id) });
      nv.checksum = D.versionChecksum(nv);
      D.assertTransition('proposalVersion', prev.status, 'SUPERSEDED');
      await tx.update('proposalVersion', { ...prev, status: 'SUPERSEDED' }, prev.revision); // terms untouched (immutable)
      const savedV = await tx.insert('proposalVersion', nv);
      const saved = await tx.update('proposal', { ...pr, status: 'COUNTERED', currentVersionId: nv.id, expiresAt: nv.validUntil, updatedAt: at }, pr.revision);
      if (pr.negotiationId) {
        const neg = await tx.get('negotiation', pr.negotiationId);
        await tx.update('negotiation', { ...neg, currentProposalVersionId: nv.id }, neg.revision);
        await tx.insert('negotiationEvent', { id: idGen('nevt'), organizationId: p.organizationId, negotiationId: neg.id, eventType: 'COUNTER_PROPOSED', proposalVersionId: nv.id, actorType: source === 'CUSTOMER' ? 'CUSTOMER' : actorKind(p), actorId: p.actorId, occurredAt: at });
      }
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: saved, base: saved });
      await audit(tx, p, 'PROPOSAL_COUNTER', 'proposal', saved, { versionId: nv.id, versionNumber: nv.versionNumber, supersedes: prev.id, checksum: nv.checksum }, requestId);
      await emit(tx, p, 'ProposalCountered', 'proposal', saved, { versionId: nv.id });
      await journey(tx, p, 'COUNTER_RECEIVED', { commercialCaseId: c && c.id, proposalId: pr.id, customerId: pr.customerId, lotId: pr.lotId });
      return { proposal: saved, version: savedV, diff: D.diffVersions(prev, nv) };
    });
  }

  async function acceptProposal(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.PROPOSAL_ACCEPT);
    if (!D.AcceptanceMethod[cmd.method]) fail('VALIDATION_ERROR', [{ field: 'method', issue: 'enum' }]);
    if (!Array.isArray(cmd.evidenceRefs) || !cmd.evidenceRefs.length || cmd.evidenceRefs.some(x => typeof x !== 'string' || x.length > 200)) fail('VALIDATION_ERROR', [{ field: 'evidenceRefs', issue: 'at_least_one_ref' }]);
    return run('acceptProposal', p, requestId, async tx => idempotent(tx, p, 'acceptProposal', cmd.idempotencyKey, { proposalId, v: cmd.proposalVersionId, m: cmd.method, e: cmd.evidenceRefs, r: cmd.expectedRevision }, async () => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      if (!['UNDER_REVIEW', 'COUNTERED'].includes(pr.status)) fail(pr.status === 'EXPIRED' ? 'PROPOSAL_EXPIRED' : 'PROPOSAL_NOT_ACCEPTABLE', { status: pr.status });
      if (cmd.proposalVersionId !== pr.currentVersionId) fail('PROPOSAL_VERSION_CONFLICT', { currentVersionId: pr.currentVersionId });
      if (expired(pr, 'expiresAt')) fail('PROPOSAL_EXPIRED', { expiresAt: pr.expiresAt });
      const pol = await policyOf(p, pr.developmentId);
      writable(pol, 'proposal');
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      const { missing } = await missingApprovals(tx, p, pol, pr, v);
      if (missing.length) fail('COMMERCIAL_APPROVAL_REQUIRED', { required: missing.map(m => ({ ruleCode: m.ruleCode, approvalType: m.approvalType })) });
      const lot = await tx.lockLot(pr.developmentId, pr.lotId);
      if (!lot || UNAVAILABLE_FOR_SALE.has(lot.status)) fail('LOT_NOT_AVAILABLE', { status: lot ? lot.status : null });
      const liveOther = (await tx.find('reservation', { organizationId: p.organizationId, lotId: pr.lotId, status: [...D.LIVE_RESERVATION] })).filter(r => r.customerId !== pr.customerId);
      if (liveOther.length) fail('LOT_NOT_AVAILABLE', { reason: 'RESERVED_FOR_ANOTHER_CONTEXT' });
      const customer = await customers.find(p.organizationId, pr.customerId);
      if (!customer) fail('CUSTOMER_NOT_FOUND', {});
      const at = nowIso();
      const savedV = await tx.update('proposalVersion', { ...v, status: 'ACCEPTED' }, v.revision);
      const acc = await tx.insert('acceptance', { id: idGen('pacc'), organizationId: p.organizationId, proposalId: pr.id, proposalVersionId: v.id, method: cmd.method, actorRef: cmd.actorRef || null, acceptedAt: at, evidenceRefs: cmd.evidenceRefs, recordedBy: p.actorId,
        legalEffect: 'NOT_ASSUMED' }); // broker-recorded acceptance is not a legal signature (§175)
      const saved = await tx.update('proposal', { ...pr, status: 'ACCEPTED', updatedAt: at }, pr.revision);
      if (pr.negotiationId) {
        const neg = await tx.get('negotiation', pr.negotiationId);
        await tx.insert('negotiationEvent', { id: idGen('nevt'), organizationId: p.organizationId, negotiationId: neg.id, eventType: 'TERMS_ACCEPTED', proposalVersionId: v.id, actorType: actorKind(p), actorId: p.actorId, occurredAt: at });
        await tx.update('negotiation', { ...neg, status: 'AGREEMENT_REACHED', currentProposalVersionId: v.id, closedAt: at }, neg.revision);
      }
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: saved, base: saved });
      await audit(tx, p, 'PROPOSAL_ACCEPT', 'proposal', saved, { versionId: v.id, checksum: v.checksum, method: cmd.method, acceptanceId: acc.id }, requestId);
      await emit(tx, p, 'ProposalAccepted', 'proposal', saved, { versionId: v.id });
      await journey(tx, p, 'PROPOSAL_ACCEPTED', { commercialCaseId: c && c.id, proposalId: pr.id, customerId: pr.customerId, lotId: pr.lotId });
      metrics.inc('proposal_accepted_total');
      return { proposal: saved, version: savedV, acceptance: acc }; // never auto-reserves (§51, §390)
    }));
  }

  async function closeProposal(p, proposalId, cmd, { to, perm, registry, action, journeyType, metric, requestId }) {
    authorize(p, perm);
    reasonOf(cmd.reasonCode, registry);
    return run(action, p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      D.assertTransition('proposal', pr.status, to);
      const at = nowIso();
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      if (to === 'REJECTED' && v.status === 'ISSUED') await tx.update('proposalVersion', { ...v, status: 'REJECTED' }, v.revision);
      const saved = await tx.update('proposal', { ...pr, status: to, closeReasonCode: cmd.reasonCode, updatedAt: at }, pr.revision); // versions are kept (§310)
      if (pr.negotiationId) {
        const neg = await tx.get('negotiation', pr.negotiationId);
        if (D.canTransition('negotiation', neg.status, to === 'REJECTED' ? 'FAILED' : 'CANCELLED')) {
          await tx.insert('negotiationEvent', { id: idGen('nevt'), organizationId: p.organizationId, negotiationId: neg.id, eventType: to === 'REJECTED' ? 'TERMS_REJECTED' : 'CANCELLED', proposalVersionId: v.id, actorType: actorKind(p), actorId: p.actorId, occurredAt: at, metadata: { reasonCode: cmd.reasonCode } });
          await tx.update('negotiation', { ...neg, status: to === 'REJECTED' ? 'FAILED' : 'CANCELLED', closedAt: at }, neg.revision);
        }
      }
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: saved, base: saved });
      await audit(tx, p, action, 'proposal', saved, { reasonCode: cmd.reasonCode, versionId: v.id }, requestId);
      if (journeyType) await journey(tx, p, journeyType, { commercialCaseId: c && c.id, proposalId: pr.id, customerId: pr.customerId, lotId: pr.lotId, reasonCode: cmd.reasonCode });
      if (metric) metrics.inc(metric);
      return { proposal: saved };
    });
  }
  const rejectProposal = (p, id, cmd = {}, o = {}) => closeProposal(p, id, cmd, { to: 'REJECTED', perm: PERM.PROPOSAL_REJECT, registry: D.RejectReason, action: 'PROPOSAL_REJECT', metric: 'proposal_rejected_total', requestId: o.requestId });
  const withdrawProposal = (p, id, cmd = {}, o = {}) => closeProposal(p, id, cmd, { to: 'WITHDRAWN', perm: PERM.PROPOSAL_WITHDRAW, registry: D.LostReason, action: 'PROPOSAL_WITHDRAW', requestId: o.requestId });

  // ------------------------------------------------------------------------- approvals
  async function requestApproval(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.APPROVAL_REQUEST);
    if (!D.ApprovalType[cmd.approvalType]) fail('VALIDATION_ERROR', [{ field: 'approvalType', issue: 'enum' }]);
    if (typeof cmd.reason !== 'string' || !cmd.reason.trim() || cmd.reason.length > 500) fail('VALIDATION_ERROR', [{ field: 'reason', issue: 'text_1_500' }]);
    return run('requestApproval', p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      const pol = await policyOf(p, pr.developmentId);
      const rules = requirePolicy(pol, 'approval.rules');
      // the approval targets exact terms: the current version, or the counter terms sent in cmd.terms (by checksum)
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      let terms = v.terms, pricingB = v.pricing, versionId = v.id;
      if (cmd.terms) {
        const n = D.normalizeTerms(cmd.terms); if (!n.terms || n.issues.length) fail('VALIDATION_ERROR', n.issues);
        terms = n.terms; pricingB = D.pricingBreakdown(await pricing.quote(pr.developmentId, pr.lotId), terms); versionId = null;
      }
      const termsChecksum = checksumOf(terms);
      const required = D.requiredApprovals(rules, pricingB, terms, { extension: cmd.approvalType === 'RESERVATION_EXTENSION' }).filter(r => r.approvalType === cmd.approvalType);
      const rule = required[0] || null;
      const pending = (await tx.find('approval', { organizationId: p.organizationId, proposalId: pr.id, status: 'PENDING' })).find(a => a.termsChecksum === termsChecksum && a.approvalType === cmd.approvalType && (a.reservationId || null) === (cmd.reservationId || null));
      if (pending) return { approval: pending, existing: true };
      const a = await tx.insert('approval', { id: idGen('appr'), organizationId: p.organizationId, developmentId: pr.developmentId, proposalId: pr.id, proposalVersionId: versionId, termsChecksum, discountRequestedMinor: pricingB ? pricingB.requestedDiscountMinor : null, reservationId: cmd.reservationId || null, approvalType: cmd.approvalType,
        ruleCode: rule ? rule.ruleCode : null, requiredApprovalPermission: rule ? rule.requiredApprovalPermission : PERM.APPROVAL_DECIDE, requireStepUp: rule ? rule.requireStepUp : false,
        status: 'PENDING', requestedBy: p.actorId, requestedAt: nowIso(), decidedBy: null, decidedAt: null, reason: cmd.reason, policyRef: pol.approval.policyId ? `${pol.approval.policyId}@${pol.approval.version}` : null });
      await tx.insert('notificationIntent', { id: idGen('ntf'), organizationId: p.organizationId, type: 'APPROVAL_REQUIRED', recipientRef: `permission:${a.requiredApprovalPermission}`, channelPreference: null, templateDataRef: `approval:${a.id}`, createdAt: nowIso() });
      await audit(tx, p, 'COMMERCIAL_APPROVAL_REQUEST', 'approval', a, { approvalType: a.approvalType, ruleCode: a.ruleCode, proposalVersionId: versionId, termsChecksum }, requestId);
      return { approval: a, existing: false };
    });
  }

  async function decideApproval(p, approvalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.APPROVAL_DECIDE);
    if (!['APPROVED', 'REJECTED'].includes(cmd.decision)) fail('VALIDATION_ERROR', [{ field: 'decision', issue: 'enum' }]);
    return run('decideApproval', p, requestId, async tx => {
      const a = await load(tx, 'approval', approvalId, p);
      expectRevision(a, cmd.expectedRevision, 'approval');
      D.assertTransition('approval', a.status, cmd.decision);
      if (a.requiredApprovalPermission && a.requiredApprovalPermission !== PERM.APPROVAL_DECIDE) authorize(p, a.requiredApprovalPermission);
      const pol = await policyOf(p, a.developmentId);
      const separation = requirePolicy(pol, 'approval.requesterCannotApprove');
      if (separation && a.requestedBy === p.actorId) fail('APPROVAL_SELF_DECISION_FORBIDDEN', {});
      if (a.requireStepUp && !p.stepUp) fail('PERMISSION_DENIED', { reason: 'STEP_UP_REQUIRED' });
      const saved = await tx.update('approval', { ...a, status: cmd.decision, decidedBy: p.actorId, decidedAt: nowIso(), decisionReasonPresent: !!cmd.reason }, a.revision);
      await audit(tx, p, a.approvalType === 'DISCOUNT' ? 'DISCOUNT_APPROVAL' : a.approvalType === 'MANUAL_OVERRIDE' ? 'MANUAL_PRICE_OVERRIDE' : 'COMMERCIAL_APPROVAL_DECIDE', 'approval', saved, { decision: cmd.decision, approvalType: a.approvalType, ruleCode: a.ruleCode }, requestId);
      return { approval: saved };
    });
  }

  // ------------------------------------------------------------------------- reservations
  async function createReservation(p, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.RESERVATION_CREATE, { lotId: cmd.lotId });
    try {
      return await timed('reservation_create_duration_ms', () => run('createReservation', p, requestId, async tx => idempotent(tx, p, 'createReservation', cmd.idempotencyKey,
        { d: cmd.developmentId, l: cmd.lotId, c: cmd.customerId, pr: cmd.proposalId || null, r: cmd.expectedAvailabilityRevision, e: cmd.expiresAt }, async () => {
          const pol = await policyOf(p, cmd.developmentId);
          const mode = authorityOf(pol, 'reservation');
          if (mode === 'REFERENCE_ONLY') fail('COMMERCIAL_AUTHORITY_EXTERNAL', { domain: 'reservation', mode });
          const avMode = authorityOf(pol, 'availability');
          if (mode === 'PLATFORM_MASTER' && avMode !== 'PLATFORM_MASTER') fail('COMMERCIAL_AUTHORITY_EXTERNAL', { domain: 'availability', mode: avMode, reason: 'NO_DUAL_MASTER' }); // §348
          const proposalFirst = requirePolicy(pol, 'workflow.proposalRequiredBeforeReservation');
          const maxS = requirePolicy(pol, 'reservation.maxDurationSeconds');
          if (!D.isIso(cmd.expiresAt)) fail('RESERVATION_EXPIRY_INVALID', { field: 'expiresAt', issue: 'required_iso_utc' }); // §59: expiresAt mandatory
          const exp = Date.parse(cmd.expiresAt);
          if (exp <= now() || exp - now() > maxS * 1000) fail('RESERVATION_EXPIRY_INVALID', { maxDurationSeconds: maxS });
          const expected = Number(cmd.expectedAvailabilityRevision);
          if (cmd.expectedAvailabilityRevision == null || !Number.isInteger(expected) || expected < 0) fail('VALIDATION_ERROR', [{ field: 'expectedAvailabilityRevision', issue: 'required' }]);
          const customer = await customers.find(p.organizationId, cmd.customerId);
          if (!customer) fail('CUSTOMER_NOT_FOUND', {});
          let proposal = null;
          if (cmd.proposalId) proposal = await load(tx, 'proposal', cmd.proposalId, p);
          if (proposalFirst && (!proposal || proposal.status !== 'ACCEPTED')) fail('PROPOSAL_NOT_ACCEPTABLE', { reason: 'ACCEPTED_PROPOSAL_REQUIRED_BEFORE_RESERVATION' });
          if (proposal && (proposal.lotId !== cmd.lotId || proposal.customerId !== cmd.customerId || proposal.developmentId !== cmd.developmentId)) fail('VALIDATION_ERROR', [{ field: 'proposalId', issue: 'lot_or_customer_mismatch' }]);
          // ---- atomic: load current Availability → validate → create Reservation → Availability RESERVED → commit (§61)
          const lot = await tx.lockLot(cmd.developmentId, cmd.lotId);
          if (!lot) fail('LOT_NOT_FOUND', { lotId: cmd.lotId });
          const live = await tx.find('reservation', { organizationId: p.organizationId, lotId: cmd.lotId, status: [...D.LIVE_RESERVATION] });
          if (live.length || lot.status === 'RESERVED') fail('LOT_ALREADY_RESERVED', { lotId: cmd.lotId }); // never who holds it (§164)
          if (lot.status === 'UNKNOWN') fail('LOT_AVAILABILITY_UNKNOWN', { lotId: cmd.lotId }); // UNKNOWN is never AVAILABLE
          if (lot.status !== 'AVAILABLE') fail('LOT_NOT_AVAILABLE', { lotId: cmd.lotId, status: lot.status });
          if (lot.revision !== expected) fail('AVAILABILITY_REVISION_CONFLICT', { lotId: cmd.lotId, expectedAvailabilityRevision: expected, currentRevision: lot.revision });
          const at = nowIso();
          const r = { id: idGen('resv'), organizationId: p.organizationId, developmentId: cmd.developmentId, lotId: cmd.lotId, customerId: customer.id, proposalId: proposal ? proposal.id : null, proposalVersionId: proposal ? proposal.currentVersionId : null,
            status: mode === 'PLATFORM_MASTER' ? 'ACTIVE' : 'PENDING_EXTERNAL_CONFIRMATION', reservedAt: mode === 'PLATFORM_MASTER' ? at : null, expiresAt: D.iso(exp), createdBy: p.actorId, createdAt: at,
            availabilityRevisionAtCreate: String(lot.revision), currentRevision: String(lot.revision), releaseReason: null, convertedToClosingId: null, extensionCount: 0 };
          if (mode === 'PLATFORM_MASTER') { const next = await tx.transitionLot(cmd.developmentId, cmd.lotId, 'RESERVED', { at, reservedUntil: r.expiresAt, requestId }); r.currentRevision = String(next.revision); }
          const saved = await tx.insert('reservation', r);
          if (mode !== 'PLATFORM_MASTER') await tx.insert('externalCommand', { id: idGen('xcmd'), organizationId: p.organizationId, type: 'CREATE_RESERVATION', aggregateId: saved.id, idempotencyKey: `resv:${saved.id}`, status: 'PENDING', attempts: 0, createdAt: at });
          if (proposal) await tx.update('proposal', { ...proposal, reservationId: saved.id, updatedAt: at }, proposal.revision);
          const c = await caseFor(tx, p, { proposalId: proposal && proposal.id });
          await refreshCase(tx, p, { caseId: c && c.id, proposal, reservation: saved, base: saved });
          await audit(tx, p, 'RESERVATION_CREATE', 'reservation', saved, { lotId: saved.lotId, status: saved.status, expiresAt: saved.expiresAt, availabilityRevisionAtCreate: saved.availabilityRevisionAtCreate }, requestId);
          await emit(tx, p, 'ReservationCreated', 'reservation', saved, { lotId: saved.lotId, status: saved.status });
          await journey(tx, p, 'RESERVATION_STARTED', { commercialCaseId: c && c.id, reservationId: saved.id, customerId: saved.customerId, lotId: saved.lotId });
          metrics.inc('reservation_created_total');
          return { reservation: saved };
        })));
    } catch (e) {
      if (['LOT_ALREADY_RESERVED', 'AVAILABILITY_REVISION_CONFLICT'].includes(e.code)) metrics.inc('reservation_conflict_total');
      throw e;
    }
  }

  async function extendReservation(p, reservationId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.RESERVATION_EXTEND);
    return run('extendReservation', p, requestId, async tx => {
      const r = await load(tx, 'reservation', reservationId, p);
      expectRevision(r, cmd.expectedRevision, 'reservation');
      const pol = await policyOf(p, r.developmentId);
      writable(pol, 'reservation');
      const allowed = requirePolicy(pol, 'reservation.extension.allowed');
      if (!allowed) fail('RESERVATION_EXTENSION_NOT_ALLOWED', { reason: 'POLICY_FORBIDS' });
      const maxExt = requirePolicy(pol, 'reservation.extension.maxExtensionSeconds'), maxCount = requirePolicy(pol, 'reservation.extension.maxExtensions');
      if (r.status !== 'ACTIVE') fail('INVALID_RESERVATION_TRANSITION', { status: r.status });
      if (expired(r, 'expiresAt')) fail('RESERVATION_EXPIRED', { expiresAt: r.expiresAt });
      if (pol.reservation.extension.reasonRequired && (typeof cmd.reason !== 'string' || !cmd.reason.trim())) fail('VALIDATION_ERROR', [{ field: 'reason', issue: 'required' }]);
      if ((r.extensionCount || 0) >= maxCount) fail('RESERVATION_EXTENSION_NOT_ALLOWED', { reason: 'MAX_EXTENSIONS', maxExtensions: maxCount });
      if (!D.isIso(cmd.newExpiresAt)) fail('VALIDATION_ERROR', [{ field: 'newExpiresAt', issue: 'iso_utc' }]);
      const prevMs = Date.parse(r.expiresAt), nextMs = Date.parse(cmd.newExpiresAt);
      if (nextMs <= prevMs || nextMs - prevMs > maxExt * 1000) fail('RESERVATION_EXTENSION_NOT_ALLOWED', { reason: 'EXTENSION_RANGE', maxExtensionSeconds: maxExt });
      // approval rule (RESERVATION_EXTENSION) when configured
      const rules = requirePolicy(pol, 'approval.rules');
      let approvedBy = null;
      if (rules.some(x => x.conditionType === 'RESERVATION_EXTENSION')) {
        const ok = (await tx.find('approval', { organizationId: p.organizationId, approvalType: 'RESERVATION_EXTENSION', status: 'APPROVED' })).find(a => a.reservationId === r.id && !a.consumedBy);
        if (!ok) fail('COMMERCIAL_APPROVAL_REQUIRED', { required: [{ approvalType: 'RESERVATION_EXTENSION' }] });
        approvedBy = ok.decidedBy;
        await tx.update('approval', { ...ok, consumedBy: `extension:${r.id}:${(r.extensionCount || 0) + 1}` }, ok.revision);
      }
      const lot = await tx.lockLot(r.developmentId, r.lotId); // fresh availability state (§68)
      if (!lot || lot.status !== 'RESERVED') fail('LOT_NOT_AVAILABLE', { status: lot ? lot.status : null });
      const at = nowIso(), newExpiresAt = D.iso(nextMs);
      const next = await tx.transitionLot(r.developmentId, r.lotId, 'RESERVED', { at, reservedUntil: newExpiresAt, requestId });
      const ext = await tx.insert('reservationExtension', { id: idGen('rext'), organizationId: p.organizationId, reservationId: r.id, previousExpiresAt: r.expiresAt, newExpiresAt, reason: cmd.reason || null, approvedBy, createdBy: p.actorId, createdAt: at });
      const saved = await tx.update('reservation', { ...r, expiresAt: newExpiresAt, currentRevision: String(next.revision), extensionCount: (r.extensionCount || 0) + 1 }, r.revision);
      await audit(tx, p, 'RESERVATION_EXTEND', 'reservation', saved, { previousExpiresAt: r.expiresAt, newExpiresAt, approvedBy, extensionId: ext.id }, requestId);
      await emit(tx, p, 'ReservationExtended', 'reservation', saved, { newExpiresAt });
      metrics.inc('reservation_extension_total');
      return { reservation: saved, extension: ext };
    });
  }

  async function endReservation(p, reservationId, cmd, { to, perm, action, event, requestId }) {
    authorize(p, perm);
    reasonOf(cmd.reasonCode, D.ReleaseReason);
    return run(action, p, requestId, async tx => {
      const r = await load(tx, 'reservation', reservationId, p);
      expectRevision(r, cmd.expectedRevision, 'reservation');
      D.assertTransition('reservation', r.status, to);
      const pol = await policyOf(p, r.developmentId);
      writable(pol, 'reservation');
      const at = nowIso();
      let rev = r.currentRevision;
      if (r.status === 'ACTIVE') {
        const lot = await tx.lockLot(r.developmentId, r.lotId);
        if (lot && lot.status === 'RESERVED') rev = String((await tx.transitionLot(r.developmentId, r.lotId, 'AVAILABLE', { at, requestId })).revision);
      }
      const saved = await tx.update('reservation', { ...r, status: to, releaseReason: cmd.reasonCode, releasedAt: at, releasedBy: p.actorId, currentRevision: rev }, r.revision);
      const c = await caseFor(tx, p, { proposalId: r.proposalId, reservationId: r.id });
      if (c) await refreshCase(tx, p, { caseId: c.id, reservation: saved, base: saved });
      await audit(tx, p, action, 'reservation', saved, { reasonCode: cmd.reasonCode }, requestId);
      await emit(tx, p, event, 'reservation', saved, { reasonCode: cmd.reasonCode });
      return { reservation: saved };
    });
  }
  const releaseReservation = (p, id, cmd = {}, o = {}) => endReservation(p, id, cmd, { to: 'RELEASED', perm: PERM.RESERVATION_RELEASE, action: 'RESERVATION_RELEASE', event: 'ReservationReleased', requestId: o.requestId });
  const cancelReservation = (p, id, cmd = {}, o = {}) => endReservation(p, id, cmd, { to: 'CANCELLED', perm: PERM.RESERVATION_CANCEL, action: 'RESERVATION_CANCEL', event: 'ReservationCancelled', requestId: o.requestId });

  /** external authority answer for a PENDING_EXTERNAL_CONFIRMATION reservation (§349–§351, §411–§412) */
  async function confirmExternalReservation(p, reservationId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.RESERVATION_CREATE);
    return run('confirmExternalReservation', p, requestId, async tx => {
      const r = await load(tx, 'reservation', reservationId, p);
      expectRevision(r, cmd.expectedRevision, 'reservation');
      if (r.status !== 'PENDING_EXTERNAL_CONFIRMATION') fail('INVALID_RESERVATION_TRANSITION', { status: r.status });
      const to = cmd.confirmed === true ? 'ACTIVE' : 'CANCELLED';
      const saved = await tx.update('reservation', { ...r, status: to, reservedAt: to === 'ACTIVE' ? nowIso() : null, externalReference: cmd.externalId ? { system: cmd.system || 'external', id: String(cmd.externalId) } : null, releaseReason: to === 'CANCELLED' ? 'COMMERCIAL_CONFLICT' : null }, r.revision);
      for (const x of await tx.find('externalCommand', { organizationId: p.organizationId, aggregateId: r.id })) await tx.update('externalCommand', { ...x, status: to === 'ACTIVE' ? 'CONFIRMED' : 'FAILED', attempts: x.attempts + 1 }, x.revision);
      await audit(tx, p, to === 'ACTIVE' ? 'RESERVATION_EXTERNAL_CONFIRMED' : 'RESERVATION_EXTERNAL_REJECTED', 'reservation', saved, {}, requestId);
      if (to === 'ACTIVE') await emit(tx, p, 'ReservationActivated', 'reservation', saved, {});
      return { reservation: saved };
    });
  }

  // ------------------------------------------------------------------------- expiration worker (server time only)
  /** runExpiry({ organizationId }) — idempotent: each item in its own transaction, re-read under revision (§70–§72, §141) */
  async function runExpiry({ organizationId, requestId = null } = {}) {
    const sys = { actorId: 'system:deals-expiry', actorType: 'SYSTEM', organizationId, permissions: [] };
    const out = { reservationsExpired: 0, proposalsExpired: 0, skipped: 0 };
    const t = now();
    const due = await store.transaction(async tx => ({
      reservations: (await tx.find('reservation', { organizationId, status: 'ACTIVE' })).filter(r => Date.parse(r.expiresAt) <= t).map(r => r.id),
      proposals: (await tx.find('proposal', { organizationId, status: ['SUBMITTED', 'UNDER_REVIEW', 'COUNTERED'] })).filter(x => x.expiresAt && Date.parse(x.expiresAt) <= t).map(x => x.id)
    }));
    for (const id of due.reservations) {
      const done = await store.transaction(async tx => {
        const r = await tx.get('reservation', id);
        if (!r || r.status !== 'ACTIVE' || Date.parse(r.expiresAt) > now()) return false; // converted/released/extended meanwhile
        const pol = await policies.getPolicy(organizationId, r.developmentId);
        const target = pol.reservation.availabilityAfterExpiry || 'AVAILABLE';
        const lot = await tx.lockLot(r.developmentId, r.lotId);
        let rev = r.currentRevision;
        if (lot && lot.status === 'RESERVED') rev = String((await tx.transitionLot(r.developmentId, r.lotId, target, { at: D.iso(now()), reason: target === 'BLOCKED' ? 'COMMERCIAL_HOLD' : null, requestId })).revision);
        const saved = await tx.update('reservation', { ...r, status: 'EXPIRED', expiredAt: D.iso(now()), currentRevision: rev }, r.revision);
        const c = await caseFor(tx, sys, { proposalId: r.proposalId, reservationId: r.id });
        if (c) await refreshCase(tx, sys, { caseId: c.id, reservation: saved, base: saved });
        await audit(tx, sys, 'RESERVATION_EXPIRE', 'reservation', saved, { availabilityAfter: lot && lot.status === 'RESERVED' ? target : lot ? lot.status : null }, requestId);
        await emit(tx, sys, 'ReservationExpired', 'reservation', saved, {});
        await journey(tx, sys, 'RESERVATION_EXPIRED', { commercialCaseId: c && c.id, reservationId: r.id, customerId: r.customerId, lotId: r.lotId });
        await tx.insert('notificationIntent', { id: idGen('ntf'), organizationId, type: 'RESERVATION_EXPIRED', recipientRef: `user:${r.createdBy}`, channelPreference: null, templateDataRef: `reservation:${r.id}`, createdAt: D.iso(now()) });
        return true;
      });
      if (done) { out.reservationsExpired++; metrics.inc('reservation_expired_total'); } else out.skipped++;
    }
    for (const id of due.proposals) {
      const done = await store.transaction(async tx => {
        const pr = await tx.get('proposal', id);
        if (!pr || !['SUBMITTED', 'UNDER_REVIEW', 'COUNTERED'].includes(pr.status) || !pr.expiresAt || Date.parse(pr.expiresAt) > now()) return false;
        const saved = await tx.update('proposal', { ...pr, status: 'EXPIRED', updatedAt: D.iso(now()) }, pr.revision); // reservation NOT released (§309)
        const c = await caseFor(tx, sys, { proposalId: pr.id });
        if (c) await refreshCase(tx, sys, { caseId: c.id, proposal: saved, base: saved });
        await audit(tx, sys, 'PROPOSAL_EXPIRE', 'proposal', saved, {}, requestId);
        await emit(tx, sys, 'ProposalExpired', 'proposal', saved, {});
        return true;
      });
      if (done) { out.proposalsExpired++; metrics.inc('proposal_expired_total'); } else out.skipped++;
    }
    return out;
  }

  // ------------------------------------------------------------------------- closing
  async function openClosingCase(p, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.CLOSING_MANAGE);
    return run('openClosingCase', p, requestId, async tx => idempotent(tx, p, 'openClosingCase', cmd.idempotencyKey, { pr: cmd.proposalId, r: cmd.reservationId || null }, async () => {
      const pr = await load(tx, 'proposal', cmd.proposalId, p);
      const pol = await policyOf(p, pr.developmentId);
      requirePolicy(pol, 'workflow.acceptedProposalRequiredForClosing');
      const resvRequired = requirePolicy(pol, 'workflow.reservationRequiredForClosing');
      const items = requirePolicy(pol, 'closingChecklist.items');
      if (pr.status !== 'ACCEPTED') fail('CLOSING_REQUIREMENTS_INCOMPLETE', { blockingItems: ['PROPOSAL_NOT_ACCEPTED'] }); // ClosingCase always freezes an accepted version (§81)
      const open = (await tx.find('closing', { organizationId: p.organizationId, proposalId: pr.id })).filter(c => D.OPEN_CLOSING.has(c.status) || c.status === 'COMPLETED');
      if (open.length) fail('CLOSING_REQUIREMENTS_INCOMPLETE', { blockingItems: ['CLOSING_ALREADY_OPEN'] });
      let resv = null;
      const resvId = cmd.reservationId || pr.reservationId;
      if (resvId) resv = await load(tx, 'reservation', resvId, p);
      if (resvRequired && !resv) fail('CLOSING_REQUIREMENTS_INCOMPLETE', { blockingItems: ['RESERVATION_REQUIRED'] });
      if (resv) {
        if (resv.lotId !== pr.lotId) fail('VALIDATION_ERROR', [{ field: 'reservationId', issue: 'lot_mismatch' }]);
        if (resv.status !== 'ACTIVE' || expired(resv, 'expiresAt')) fail(resv.status === 'EXPIRED' || expired(resv, 'expiresAt') ? 'RESERVATION_EXPIRED' : 'INVALID_RESERVATION_TRANSITION', { status: resv.status });
      }
      const at = nowIso(), id = idGen('clos');
      const checklist = items.map(it => ({ id: idGen('chk'), organizationId: p.organizationId, closingCaseId: id, code: it.code, category: it.category, required: it.required, status: 'PENDING', documentId: null, validatedBy: null, validatedAt: null }));
      const closing = { id, organizationId: p.organizationId, developmentId: pr.developmentId, customerId: pr.customerId, lotId: pr.lotId, proposalId: pr.id, acceptedProposalVersionId: pr.currentVersionId, reservationId: resv ? resv.id : null,
        status: checklist.some(i => i.required) ? 'DOCUMENTS_PENDING' : 'OPEN', openedAt: at, completedAt: null, checklistPolicyRef: pol.closingChecklist.policyId ? `${pol.closingChecklist.policyId}@${pol.closingChecklist.version}` : null };
      const saved = await tx.insert('closing', closing);
      for (const i of checklist) await tx.insert('checklistItem', i);
      let savedResv = null;
      if (resv) { D.assertTransition('reservation', resv.status, 'CONVERTED'); savedResv = await tx.update('reservation', { ...resv, status: 'CONVERTED', convertedToClosingId: id }, resv.revision); } // Availability stays RESERVED (§239–§240)
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: pr, reservation: savedResv, closing: saved, base: saved });
      await audit(tx, p, 'CLOSING_OPEN', 'closing', saved, { acceptedProposalVersionId: saved.acceptedProposalVersionId, reservationId: saved.reservationId }, requestId);
      await emit(tx, p, 'ClosingCaseOpened', 'closing', saved, {});
      if (savedResv) await emit(tx, p, 'ReservationConverted', 'reservation', savedResv, { closingCaseId: id });
      await journey(tx, p, 'CLOSING_OPENED', { commercialCaseId: c && c.id, closingCaseId: id, customerId: pr.customerId, lotId: pr.lotId });
      if (saved.status === 'DOCUMENTS_PENDING') {
        await journey(tx, p, 'DOCUMENTS_PENDING', { commercialCaseId: c && c.id, closingCaseId: id, customerId: pr.customerId, lotId: pr.lotId });
        await tx.insert('notificationIntent', { id: idGen('ntf'), organizationId: p.organizationId, type: 'DOCUMENTS_MISSING', recipientRef: `user:${p.actorId}`, channelPreference: null, templateDataRef: `closing:${id}`, createdAt: at });
      }
      metrics.inc('closing_opened_total');
      return { closing: saved, checklist, reservation: savedResv };
    }));
  }

  async function updateChecklistItem(p, closingId, itemId, cmd = {}, { requestId = null } = {}) {
    if (!D.ChecklistStatus[cmd.status]) fail('VALIDATION_ERROR', [{ field: 'status', issue: 'enum' }]);
    authorize(p, ['VALIDATED', 'REJECTED', 'WAIVED', 'NOT_APPLICABLE'].includes(cmd.status) ? PERM.CLOSING_VALIDATE_DOCUMENTS : PERM.CLOSING_MANAGE);
    return run('updateChecklistItem', p, requestId, async tx => {
      const cl = await load(tx, 'closing', closingId, p);
      if (!D.OPEN_CLOSING.has(cl.status)) fail(cl.status === 'COMPLETED' ? 'SALE_ALREADY_COMPLETED' : 'INVALID_CLOSING_TRANSITION', { status: cl.status });
      const it = await tx.get('checklistItem', itemId);
      if (!it || it.closingCaseId !== cl.id) fail('CHECKLIST_ITEM_NOT_FOUND', {});
      expectRevision(it, cmd.expectedRevision, 'checklistItem');
      if (cmd.status === 'RECEIVED' && !cmd.documentId) fail('VALIDATION_ERROR', [{ field: 'documentId', issue: 'required_for_RECEIVED' }]);
      if (cmd.status === 'VALIDATED' && (it.status !== 'RECEIVED' || !it.documentId)) fail('CLOSING_REQUIREMENTS_INCOMPLETE', { blockingItems: [`CHECKLIST:${it.code}:NOT_RECEIVED`] }); // upload ≠ validation (§89)
      const at = nowIso();
      const saved = await tx.update('checklistItem', { ...it, status: cmd.status, documentId: cmd.documentId || it.documentId, validationNotePresent: !!cmd.validationNote, validatedBy: ['VALIDATED', 'REJECTED', 'WAIVED'].includes(cmd.status) ? p.actorId : it.validatedBy, validatedAt: ['VALIDATED', 'REJECTED', 'WAIVED'].includes(cmd.status) ? at : it.validatedAt }, it.revision);
      await audit(tx, p, 'CLOSING_CHECKLIST_UPDATE', 'checklist_item', { ...saved, developmentId: cl.developmentId }, { code: it.code, status: cmd.status }, requestId);
      const all = await tx.find('checklistItem', { organizationId: p.organizationId, closingCaseId: cl.id });
      let closing = cl;
      if (cl.status === 'DOCUMENTS_PENDING' && all.filter(i => i.required).every(i => ['VALIDATED', 'WAIVED', 'NOT_APPLICABLE'].includes(i.status))) {
        closing = await tx.update('closing', { ...cl, status: 'UNDER_REVIEW' }, cl.revision);
        await emit(tx, p, 'ClosingDocumentsCompleted', 'closing', closing, {});
      }
      return { item: saved, closing, readiness: D.closingReadiness({ checklist: all, closing, requiredConditions: ['REQUIRED_CHECKLIST_VALIDATED'] }) };
    });
  }

  /** manual confirmation recorded by the organization (actor, time, evidence) — never a payment processing (§76, §226) */
  async function recordManualConfirmation(p, closingId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.CLOSING_VALIDATE_DOCUMENTS);
    if (!D.CODE_RE.test(cmd.code || '')) fail('VALIDATION_ERROR', [{ field: 'code', issue: 'code' }]);
    if (!Array.isArray(cmd.evidenceRefs) || !cmd.evidenceRefs.length) fail('VALIDATION_ERROR', [{ field: 'evidenceRefs', issue: 'at_least_one_ref' }]);
    return run('recordManualConfirmation', p, requestId, async tx => {
      const cl = await load(tx, 'closing', closingId, p);
      if (!D.OPEN_CLOSING.has(cl.status)) fail('INVALID_CLOSING_TRANSITION', { status: cl.status });
      const m = await tx.insert('manualConfirmation', { id: idGen('mconf'), organizationId: p.organizationId, closingCaseId: cl.id, code: cmd.code, confirmedBy: p.actorId, confirmedAt: nowIso(), evidenceRefs: cmd.evidenceRefs, method: 'MANUAL_ORGANIZATION_CONFIRMATION' });
      await audit(tx, p, 'CLOSING_MANUAL_CONFIRMATION', 'closing', cl, { code: cmd.code, confirmationId: m.id }, requestId);
      return { confirmation: m };
    });
  }

  // ------------------------------------------------------------------------- contracts & signature
  async function createContract(p, closingId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.CONTRACT_GENERATE);
    return run('createContract', p, requestId, async tx => {
      const cl = await load(tx, 'closing', closingId, p);
      expectRevision(cl, cmd.expectedClosingRevision, 'closing');
      if (!D.OPEN_CLOSING.has(cl.status)) fail('INVALID_CLOSING_TRANSITION', { status: cl.status });
      const pol = await policyOf(p, cl.developmentId);
      writable(pol, 'contract');
      const ref = cmd.template || {};
      const tpl = (pol.contractTemplates || []).find(t => t.templateId === ref.templateId && t.templateVersion === ref.templateVersion);
      if (!tpl || !tpl.approvedAt || !tpl.approvedBy) fail('CONTRACT_TEMPLATE_NOT_APPROVED', { templateId: ref.templateId || null, templateVersion: ref.templateVersion || null });
      if (typeof cmd.documentVersionId !== 'string' || !cmd.documentVersionId) fail('VALIDATION_ERROR', [{ field: 'documentVersionId', issue: 'required' }]); // body = Document Domain version from the approved template
      if ((await tx.find('contract', { organizationId: p.organizationId, closingCaseId: cl.id })).some(c => !['CANCELLED', 'VOIDED'].includes(c.status))) fail('CONTRACT_NOT_READY', { reason: 'CONTRACT_ALREADY_EXISTS' });
      const pv = await tx.get('proposalVersion', cl.acceptedProposalVersionId);
      const val = D.validateContractGeneration(tpl, cmd.variables || {}, pv);
      if (!val.valid) fail('CONTRACT_VARIABLES_UNRESOLVED', val);
      const at = nowIso(), cid = idGen('ctr'), vid = idGen('cver');
      const version = { id: vid, organizationId: p.organizationId, contractId: cid, versionNumber: 1, documentVersionId: cmd.documentVersionId, generatedFromProposalVersionId: pv.id, termsChecksum: pv.checksum,
        template: { templateId: tpl.templateId, templateVersion: tpl.templateVersion, approvedAt: tpl.approvedAt, approvedBy: tpl.approvedBy }, resolvedVariables: Object.keys(cmd.variables || {}).sort(), status: 'DRAFT', createdAt: at, createdBy: p.actorId };
      const contract = await tx.insert('contract', { id: cid, organizationId: p.organizationId, developmentId: cl.developmentId, closingCaseId: cl.id, contractType: String(cmd.contractType || tpl.contractType || 'SALE'), status: 'DRAFT', currentVersionId: vid, createdAt: at, updatedAt: at });
      const savedV = await tx.insert('contractVersion', version);
      const closing = await tx.update('closing', { ...cl, status: D.canTransition('closing', cl.status, 'CONTRACT_PREPARATION') ? 'CONTRACT_PREPARATION' : cl.status }, cl.revision);
      await audit(tx, p, 'CONTRACT_GENERATE', 'contract', contract, { versionId: vid, templateId: tpl.templateId, templateVersion: tpl.templateVersion }, requestId); // never the contract body (§178)
      return { contract, version: savedV, closing, validation: val };
    });
  }

  async function issueContract(p, contractId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.CONTRACT_ISSUE);
    return run('issueContract', p, requestId, async tx => {
      const ct = await load(tx, 'contract', contractId, p);
      expectRevision(ct, cmd.expectedRevision, 'contract');
      if (cmd.contractVersionId !== ct.currentVersionId) fail('CONTRACT_NOT_READY', { reason: 'NOT_CURRENT_VERSION', currentVersionId: ct.currentVersionId });
      const v = await tx.get('contractVersion', ct.currentVersionId);
      if (v.status !== 'DRAFT') fail('CONTRACT_VERSION_IMMUTABLE', { status: v.status });
      const cl = await tx.get('closing', ct.closingCaseId);
      const pol = await policyOf(p, cl.developmentId);
      const conds = requirePolicy(pol, 'closingReadiness.readyForSignature');
      const checklist = await tx.find('checklistItem', { organizationId: p.organizationId, closingCaseId: cl.id });
      const ready = D.closingReadiness({ checklist, closing: cl, contractVersion: { ...v, status: 'ISSUED' }, requiredConditions: conds });
      if (ready.status === 'NOT_READY') fail('CLOSING_REQUIREMENTS_INCOMPLETE', ready);
      const at = nowIso();
      const savedV = await tx.update('contractVersion', { ...v, status: 'ISSUED', issuedAt: at, issuedBy: p.actorId }, v.revision);
      const saved = await tx.update('contract', { ...ct, status: 'READY_FOR_SIGNATURE', updatedAt: at }, ct.revision);
      const closing = await tx.update('closing', { ...cl, status: D.canTransition('closing', cl.status, 'READY_FOR_SIGNATURE') ? 'READY_FOR_SIGNATURE' : cl.status }, cl.revision);
      await audit(tx, p, 'CONTRACT_ISSUE', 'contract', saved, { versionId: v.id, versionNumber: v.versionNumber, termsChecksum: v.termsChecksum }, requestId);
      await emit(tx, p, 'ContractIssued', 'contract', saved, { versionId: v.id });
      const c = await caseFor(tx, p, { proposalId: cl.proposalId });
      await journey(tx, p, 'CONTRACT_READY', { commercialCaseId: c && c.id, closingCaseId: cl.id, customerId: cl.customerId, lotId: cl.lotId });
      return { contract: saved, version: savedV, closing };
    });
  }

  /** approved correction: V(n) preserved (SUPERSEDED), V(n+1) DRAFT; a signed version is never overwritten (§233, §325) */
  async function correctContract(p, contractId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.CONTRACT_GENERATE);
    return run('correctContract', p, requestId, async tx => {
      const ct = await load(tx, 'contract', contractId, p);
      expectRevision(ct, cmd.expectedRevision, 'contract');
      const v = await tx.get('contractVersion', ct.currentVersionId);
      if (v.status === 'SIGNED' || ['PARTIALLY_SIGNED', 'FULLY_SIGNED'].includes(ct.status)) fail('CONTRACT_VERSION_IMMUTABLE', { status: v.status, contractStatus: ct.status }); // amendment = future
      if (typeof cmd.documentVersionId !== 'string' || !cmd.documentVersionId) fail('VALIDATION_ERROR', [{ field: 'documentVersionId', issue: 'required' }]);
      const cl = await tx.get('closing', ct.closingCaseId);
      const pol = await policyOf(p, cl.developmentId);
      const tpl = (pol.contractTemplates || []).find(t => t.templateId === v.template.templateId && t.templateVersion === v.template.templateVersion);
      if (!tpl || !tpl.approvedAt) fail('CONTRACT_TEMPLATE_NOT_APPROVED', {});
      const val = D.validateContractGeneration(tpl, cmd.variables || {}, { id: v.generatedFromProposalVersionId });
      if (!val.valid) fail('CONTRACT_VARIABLES_UNRESOLVED', val);
      const at = nowIso();
      if (v.status === 'ISSUED') await tx.update('contractVersion', { ...v, status: 'SUPERSEDED' }, v.revision);
      else if (v.status === 'DRAFT') await tx.update('contractVersion', { ...v, status: 'SUPERSEDED' }, v.revision);
      const nv = await tx.insert('contractVersion', { ...v, id: idGen('cver'), versionNumber: v.versionNumber + 1, documentVersionId: cmd.documentVersionId, resolvedVariables: Object.keys(cmd.variables || {}).sort(), status: 'DRAFT', createdAt: at, createdBy: p.actorId, supersedesVersionId: v.id, revision: 1, issuedAt: undefined, issuedBy: undefined });
      const saved = await tx.update('contract', { ...ct, status: 'DRAFT', currentVersionId: nv.id, updatedAt: at }, ct.revision);
      if (cl.status === 'READY_FOR_SIGNATURE') await tx.update('closing', { ...cl, status: 'CONTRACT_PREPARATION' }, cl.revision);
      await audit(tx, p, 'CONTRACT_CORRECTION', 'contract', saved, { previousVersionId: v.id, versionId: nv.id }, requestId);
      return { contract: saved, version: nv };
    });
  }

  async function sendForSignature(p, contractId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.SIGNATURE_MANAGE);
    const provider = signatureProviders[cmd.provider];
    if (!provider) fail('VALIDATION_ERROR', [{ field: 'provider', issue: 'not_configured' }]); // provider is a human decision (not configured by default)
    const prep = await store.transaction(async tx => {
      const ct = await load(tx, 'contract', contractId, p);
      expectRevision(ct, cmd.expectedRevision, 'contract');
      if (ct.status !== 'READY_FOR_SIGNATURE') fail('CONTRACT_NOT_READY', { status: ct.status });
      const v = await tx.get('contractVersion', ct.currentVersionId);
      if (v.status !== 'ISSUED') fail('CONTRACT_NOT_READY', { versionStatus: v.status });
      return { ct, v };
    });
    const ext = await provider.createEnvelope({ contractVersionId: prep.v.id, documentVersionId: prep.v.documentVersionId, idempotencyKey: `env:${prep.v.id}` }); // adapter only: no SDK in the domain
    return run('sendForSignature', p, requestId, async tx => {
      const ct = await load(tx, 'contract', contractId, p);
      expectRevision(ct, cmd.expectedRevision, 'contract');
      const env = await tx.insert('envelope', { id: idGen('env'), organizationId: p.organizationId, provider: cmd.provider, externalEnvelopeId: String(ext.externalEnvelopeId), contractVersionId: prep.v.id, contractId: ct.id, status: 'SENT', createdAt: nowIso(), completedAt: null });
      const cl = await tx.get('closing', ct.closingCaseId);
      if (D.canTransition('closing', cl.status, 'SIGNING')) await tx.update('closing', { ...cl, status: 'SIGNING' }, cl.revision);
      await audit(tx, p, 'SIGNATURE_SENT', 'contract', ct, { envelopeId: env.id, provider: cmd.provider }, requestId);
      return { envelope: env };
    });
  }

  /** signature webhook: verification → replay protection (provider + event id) → tenant mapping by our envelope → forward-only transition (§102, §324) */
  async function handleSignatureWebhook({ provider: name, rawBody, headers = {}, requestId = null }) {
    const provider = signatureProviders[name];
    const v = provider && typeof provider.verifyWebhook === 'function' ? await provider.verifyWebhook(rawBody, headers) : { ok: false };
    if (!v || !v.ok || !v.event) { logger.warn('security event', { securityEvent: 'SIGNATURE_WEBHOOK_INVALID', provider: name || null, requestId }); fail('SIGNATURE_WEBHOOK_INVALID', {}); }
    const ev = v.event;
    if (!D.EnvelopeStatus[ev.status] || typeof ev.eventId !== 'string' || typeof ev.externalEnvelopeId !== 'string') fail('VALIDATION_ERROR', [{ field: 'event', issue: 'shape' }]);
    return store.transaction(async tx => {
      const envs = await tx.find('envelope', { provider: name, externalEnvelopeId: ev.externalEnvelopeId });
      if (envs.length !== 1) fail('SIGNATURE_WEBHOOK_INVALID', { reason: 'UNKNOWN_ENVELOPE' });
      const env = envs[0], sys = { actorId: `system:signature:${name}`, actorType: 'SYSTEM', organizationId: env.organizationId, permissions: [] };
      if ((await tx.find('webhookEvent', { provider: name, externalEventId: ev.eventId })).length) return { duplicate: true, envelope: env };
      await tx.insert('webhookEvent', { id: idGen('whk'), organizationId: env.organizationId, provider: name, externalEventId: ev.eventId, receivedAt: nowIso(), status: ev.status });
      if (env.status === ev.status || !D.canTransition('envelope', env.status, ev.status)) return { duplicate: false, ignored: true, envelope: env };
      const at = nowIso();
      const savedEnv = await tx.update('envelope', { ...env, status: ev.status, completedAt: ev.status === 'COMPLETED' ? at : env.completedAt }, env.revision);
      const ct = await tx.get('contract', env.contractId);
      if (ev.status === 'COMPLETED' || ev.status === 'PARTIALLY_SIGNED') {
        const to = ev.status === 'COMPLETED' ? 'FULLY_SIGNED' : 'PARTIALLY_SIGNED';
        if (D.canTransition('contract', ct.status, to)) await tx.update('contract', { ...ct, status: to, updatedAt: at }, ct.revision);
        if (to === 'FULLY_SIGNED') {
          const cv = await tx.get('contractVersion', env.contractVersionId);
          await tx.update('contractVersion', { ...cv, status: 'SIGNED', signedAt: at, signatureEvidenceRef: `envelope:${env.id}` }, cv.revision);
          await audit(tx, sys, 'SIGNATURE_COMPLETION', 'contract', ct, { envelopeId: env.id, eventId: ev.eventId }, requestId);
          await emit(tx, sys, 'ContractSigned', 'contract', ct, { versionId: cv.id });
          const cl = await tx.get('closing', ct.closingCaseId);
          const c = await caseFor(tx, sys, { proposalId: cl.proposalId });
          await journey(tx, sys, 'CONTRACT_SIGNED', { commercialCaseId: c && c.id, closingCaseId: cl.id, customerId: cl.customerId, lotId: cl.lotId });
          await tx.insert('notificationIntent', { id: idGen('ntf'), organizationId: env.organizationId, type: 'SIGNATURE_COMPLETED', recipientRef: `closing:${cl.id}`, channelPreference: null, templateDataRef: `contract:${ct.id}`, createdAt: at });
        }
      }
      return { duplicate: false, envelope: savedEnv };
    });
  }

  // ------------------------------------------------------------------------- sale completion / outcome
  async function completeSale(p, closingId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.SALE_COMPLETE);
    return timed('closing_complete_duration_ms', () => run('completeSale', p, requestId, async tx => idempotent(tx, p, 'completeSale', cmd.idempotencyKey,
      { c: closingId, cr: cmd.expectedClosingRevision, ar: cmd.expectedAvailabilityRevision, e: cmd.completionEvidenceRefs }, async () => {
        const cl = await load(tx, 'closing', closingId, p);
        if (cl.status === 'COMPLETED') fail('SALE_ALREADY_COMPLETED', {});
        expectRevision(cl, cmd.expectedClosingRevision, 'closing');
        if (!D.OPEN_CLOSING.has(cl.status)) fail('INVALID_CLOSING_TRANSITION', { status: cl.status });
        const pol = await policyOf(p, cl.developmentId);
        const required = requirePolicy(pol, 'saleCompletion.requiredConditions'); // WON definition (§106): never hardcoded
        const avMode = authorityOf(pol, 'availability');
        if (avMode !== 'PLATFORM_MASTER') fail('COMMERCIAL_AUTHORITY_EXTERNAL', { domain: 'availability', mode: avMode });
        if (!Array.isArray(cmd.completionEvidenceRefs) || !cmd.completionEvidenceRefs.length) fail('VALIDATION_ERROR', [{ field: 'completionEvidenceRefs', issue: 'at_least_one_ref' }]);
        if (p.stepUpRequired && !p.stepUp) fail('PERMISSION_DENIED', { reason: 'STEP_UP_REQUIRED' });
        const [checklist, contracts, proposal, reservation, manual] = [
          await tx.find('checklistItem', { organizationId: p.organizationId, closingCaseId: cl.id }), await tx.find('contract', { organizationId: p.organizationId, closingCaseId: cl.id }),
          await tx.get('proposal', cl.proposalId), cl.reservationId ? await tx.get('reservation', cl.reservationId) : null, await tx.find('manualConfirmation', { organizationId: p.organizationId, closingCaseId: cl.id })];
        const contract = contracts.find(c => !['CANCELLED', 'VOIDED'].includes(c.status)) || null;
        const contractVersion = contract ? await tx.get('contractVersion', contract.currentVersionId) : null;
        const envelope = contractVersion ? (await tx.find('envelope', { organizationId: p.organizationId, contractVersionId: contractVersion.id })).find(e => e.status === 'COMPLETED') || null : null;
        const ready = D.closingReadiness({ checklist, contract, contractVersion, envelope, closing: cl, reservation, proposal, requiredConditions: required, manualConfirmations: manual });
        if (ready.status === 'NOT_READY') fail('SALE_COMPLETION_REQUIREMENTS_NOT_MET', ready);
        const lot = await tx.lockLot(cl.developmentId, cl.lotId);
        if (!lot) fail('LOT_NOT_FOUND', {});
        if (lot.status === 'UNKNOWN') fail('LOT_AVAILABILITY_UNKNOWN', {});
        if (lot.status === 'SOLD' || !['RESERVED', 'AVAILABLE', 'PROPOSAL'].includes(lot.status)) fail('LOT_NOT_AVAILABLE', { status: lot.status });
        if (lot.revision !== Number(cmd.expectedAvailabilityRevision)) fail('AVAILABILITY_REVISION_CONFLICT', { currentRevision: lot.revision });
        const at = nowIso();
        // SaleOutcome + ClosingCase + Availability in ONE transaction (§118)
        const outcome = await tx.insert('saleOutcome', { id: idGen('sale'), organizationId: p.organizationId, closingCaseId: cl.id, proposalId: cl.proposalId, outcome: 'WON', reasonCode: null, selectedLotId: cl.lotId, finalCommercialTermsRef: `proposalVersion:${cl.acceptedProposalVersionId}`,
          completionPolicyRef: pol.saleCompletion.policyId ? `${pol.saleCompletion.policyId}@${pol.saleCompletion.version}` : null, completionEvidenceRefs: cmd.completionEvidenceRefs, occurredAt: at, recordedBy: p.actorId });
        const closing = await tx.update('closing', { ...cl, status: 'COMPLETED', completedAt: at }, cl.revision);
        const next = await tx.transitionLot(cl.developmentId, cl.lotId, 'SOLD', { at, requestId });
        const c = await caseFor(tx, p, { proposalId: cl.proposalId });
        await refreshCase(tx, p, { caseId: c && c.id, closing, outcome, base: closing });
        await audit(tx, p, 'SALE_COMPLETE', 'closing', closing, { saleOutcomeId: outcome.id, availabilityRevision: next.revision, completionPolicyRef: outcome.completionPolicyRef }, requestId);
        await emit(tx, p, 'SaleCompleted', 'closing', closing, { saleOutcomeId: outcome.id, lotId: cl.lotId });
        await journey(tx, p, 'SALE_WON', { commercialCaseId: c && c.id, closingCaseId: cl.id, customerId: cl.customerId, lotId: cl.lotId });
        metrics.inc('closing_completed_total');
        return { closing, outcome, availability: { lotId: cl.lotId, status: next.status, revision: next.revision } };
      })));
  }

  /** cancel / fail an open closing: history kept, Availability per ClosingCancellationPolicy (§241–§244) */
  async function cancelClosing(p, closingId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.SALE_CANCEL);
    reasonOf(cmd.reasonCode, D.CancelReason);
    const to = cmd.outcome === 'FAILED' ? 'FAILED' : 'CANCELLED';
    return run('cancelClosing', p, requestId, async tx => {
      const cl = await load(tx, 'closing', closingId, p);
      if (cl.status === 'COMPLETED') fail('SALE_ALREADY_COMPLETED', {});
      expectRevision(cl, cmd.expectedRevision, 'closing');
      D.assertTransition('closing', cl.status, to);
      const pol = await policyOf(p, cl.developmentId);
      const target = requirePolicy(pol, 'closingCancellation.availabilityAfterCancel');
      const at = nowIso();
      const closing = await tx.update('closing', { ...cl, status: to, closedAt: at, closeReasonCode: cmd.reasonCode }, cl.revision);
      const outcome = await tx.insert('saleOutcome', { id: idGen('sale'), organizationId: p.organizationId, closingCaseId: cl.id, proposalId: cl.proposalId, outcome: to === 'FAILED' ? 'FAILED' : 'CANCELLED', reasonCode: cmd.reasonCode, selectedLotId: cl.lotId, occurredAt: at, recordedBy: p.actorId });
      const lot = await tx.lockLot(cl.developmentId, cl.lotId);
      if (lot && lot.status === 'RESERVED') await tx.transitionLot(cl.developmentId, cl.lotId, target, { at, reason: target === 'BLOCKED' ? 'COMMERCIAL_HOLD' : null, requestId });
      const c = await caseFor(tx, p, { proposalId: cl.proposalId });
      await refreshCase(tx, p, { caseId: c && c.id, closing, outcome, base: closing });
      await audit(tx, p, 'SALE_CANCEL', 'closing', closing, { reasonCode: cmd.reasonCode, availabilityAfter: lot && lot.status === 'RESERVED' ? target : lot ? lot.status : null }, requestId);
      await emit(tx, p, 'SaleLost', 'closing', closing, { reasonCode: cmd.reasonCode });
      await journey(tx, p, 'SALE_LOST', { commercialCaseId: c && c.id, closingCaseId: cl.id, customerId: cl.customerId, lotId: cl.lotId, reasonCode: cmd.reasonCode });
      metrics.inc('closing_failed_total');
      return { closing, outcome };
    });
  }

  /** LOST before any closing (after proposal or after reservation): cancels the live proposal/reservation, records the
      outcome; the customer journey continues (§108–§112). */
  async function recordLost(p, proposalId, cmd = {}, { requestId = null } = {}) {
    authorize(p, PERM.SALE_CANCEL);
    reasonOf(cmd.reasonCode, D.LostReason);
    return run('recordLost', p, requestId, async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      expectRevision(pr, cmd.expectedRevision, 'proposal');
      if ((await tx.find('closing', { organizationId: p.organizationId, proposalId: pr.id })).some(c => D.OPEN_CLOSING.has(c.status) || c.status === 'COMPLETED')) fail('INVALID_CLOSING_TRANSITION', { reason: 'USE_CANCEL_CLOSING' });
      const at = nowIso();
      let saved = pr;
      if (D.canTransition('proposal', pr.status, 'CANCELLED')) saved = await tx.update('proposal', { ...pr, status: 'CANCELLED', closeReasonCode: cmd.reasonCode, updatedAt: at }, pr.revision);
      let resv = null;
      for (const r of await tx.find('reservation', { organizationId: p.organizationId, lotId: pr.lotId, status: [...D.LIVE_RESERVATION] })) {
        if (r.customerId !== pr.customerId) continue;
        const lot = await tx.lockLot(r.developmentId, r.lotId);
        if (r.status === 'ACTIVE' && lot && lot.status === 'RESERVED') await tx.transitionLot(r.developmentId, r.lotId, 'AVAILABLE', { at, requestId });
        resv = await tx.update('reservation', { ...r, status: r.status === 'ACTIVE' ? 'RELEASED' : 'CANCELLED', releaseReason: 'CUSTOMER_WITHDREW', releasedAt: at, releasedBy: p.actorId }, r.revision);
        await audit(tx, p, 'RESERVATION_RELEASE', 'reservation', resv, { reasonCode: 'CUSTOMER_WITHDREW', via: 'recordLost' }, requestId);
      }
      const outcome = await tx.insert('saleOutcome', { id: idGen('sale'), organizationId: p.organizationId, closingCaseId: null, proposalId: pr.id, outcome: 'LOST', reasonCode: cmd.reasonCode, selectedLotId: pr.lotId, occurredAt: at, recordedBy: p.actorId });
      const c = await caseFor(tx, p, { proposalId: pr.id });
      await refreshCase(tx, p, { caseId: c && c.id, proposal: saved, reservation: resv, outcome, base: saved });
      await audit(tx, p, 'SALE_CANCEL', 'proposal', saved, { reasonCode: cmd.reasonCode, outcome: 'LOST' }, requestId);
      await journey(tx, p, 'SALE_LOST', { commercialCaseId: c && c.id, proposalId: pr.id, customerId: pr.customerId, lotId: pr.lotId, reasonCode: cmd.reasonCode });
      return { proposal: saved, reservation: resv, outcome };
    });
  }

  // ------------------------------------------------------------------------- reconciliation (external authority)
  /** compare platform reservations with the external authority; conflicts are recorded, never overwritten (§353–§356) */
  async function reconcileReservations(p, developmentId, external = [], { requestId = null } = {}) {
    authorize(p, PERM.RESERVATION_READ);
    return run('reconcileReservations', p, requestId, async tx => {
      const ours = await tx.find('reservation', { organizationId: p.organizationId, developmentId, status: [...D.LIVE_RESERVATION] });
      const extBy = new Map(external.map(x => [x.lotId, x]));
      const conflicts = [];
      for (const r of ours) {
        const x = extBy.get(r.lotId);
        const extActive = !!(x && ['RESERVED', 'ACTIVE'].includes(x.status));
        if ((r.status === 'ACTIVE') !== extActive) conflicts.push(await tx.insert('conflict', { id: idGen('ccon'), organizationId: p.organizationId, domain: 'RESERVATION', localState: { reservationId: r.id, lotId: r.lotId, status: r.status }, externalState: x ? { lotId: x.lotId, status: x.status } : null, status: 'OPEN', detectedAt: nowIso(), resolvedAt: null }));
      }
      for (const x of external) if (['RESERVED', 'ACTIVE'].includes(x.status) && !ours.some(r => r.lotId === x.lotId)) conflicts.push(await tx.insert('conflict', { id: idGen('ccon'), organizationId: p.organizationId, domain: 'RESERVATION', localState: null, externalState: { lotId: x.lotId, status: x.status }, status: 'OPEN', detectedAt: nowIso(), resolvedAt: null }));
      return { checked: ours.length, conflicts };
    });
  }

  // ------------------------------------------------------------------------- reads (permission-scoped)
  async function getProposal(p, proposalId) {
    authorize(p, PERM.PROPOSAL_READ);
    return store.transaction(async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      const versions = (await tx.find('proposalVersion', { organizationId: p.organizationId, proposalId: pr.id })).sort((a, b) => a.versionNumber - b.versionNumber);
      const events = pr.negotiationId ? await tx.find('negotiationEvent', { organizationId: p.organizationId, negotiationId: pr.negotiationId }) : [];
      const approvals = await tx.find('approval', { organizationId: p.organizationId, proposalId: pr.id });
      const quote = await pricing.quote(pr.developmentId, pr.lotId);
      const cur = versions.find(v => v.id === pr.currentVersionId);
      // §33: the UI may warn that the current list price differs — the historical version is never modified
      const currentPriceOverlay = quote && cur && cur.pricing ? { currentListPriceMinor: quote.listPriceMinor, currentPriceTableVersion: quote.priceTableVersion, differsFromProposal: quote.listPriceMinor !== cur.pricing.listPriceMinor || quote.priceTableVersion !== cur.pricing.priceTableVersion } : null;
      const diffs = versions.slice(1).map((v, i) => D.diffVersions(versions[i], v));
      return { proposal: pr, versions, negotiationEvents: events, approvals: approvals.map(a => ({ ...a, reason: undefined, reasonPresent: !!a.reason })), currentPriceOverlay, diffs };
    });
  }
  async function getPresentationSnapshot(p, proposalId) {
    authorize(p, PERM.PROPOSAL_READ);
    return store.transaction(async tx => {
      const pr = await load(tx, 'proposal', proposalId, p);
      const v = await tx.get('proposalVersion', pr.currentVersionId);
      if (!['ISSUED', 'ACCEPTED'].includes(v.status)) fail('PROPOSAL_NOT_ACCEPTABLE', { reason: 'NOT_ISSUED' });
      return D.presentationSnapshot(pr, v, { generatedAt: nowIso(), lotSnapshotRef: v.availabilitySnapshotRef });
    });
  }
  async function getReservation(p, id) { authorize(p, PERM.RESERVATION_READ); return store.transaction(async tx => { const r = await load(tx, 'reservation', id, p); return { reservation: r, extensions: await tx.find('reservationExtension', { organizationId: p.organizationId, reservationId: r.id }), serverTime: nowIso() }; }); }
  async function getClosing(p, id) {
    authorize(p, PERM.CLOSING_READ);
    return store.transaction(async tx => {
      const cl = await load(tx, 'closing', id, p);
      const checklist = await tx.find('checklistItem', { organizationId: p.organizationId, closingCaseId: cl.id });
      const contracts = await tx.find('contract', { organizationId: p.organizationId, closingCaseId: cl.id });
      const pol = await policyOf(p, cl.developmentId);
      return { closing: cl, checklist, contracts, readiness: D.closingReadiness({ checklist, closing: cl, requiredConditions: pol.saleCompletion.requiredConditions }), outcome: (await tx.find('saleOutcome', { organizationId: p.organizationId, closingCaseId: cl.id }))[0] || null };
    });
  }
  /** reservation board (§257–§258): soonest expiration first; customer ref only with proposal.read */
  async function reservationBoard(p, developmentId) {
    authorize(p, PERM.RESERVATION_READ);
    return store.transaction(async tx => (await tx.find('reservation', { organizationId: p.organizationId, developmentId, status: [...D.LIVE_RESERVATION] }))
      .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
      .map(r => ({ reservationId: r.id, lotId: r.lotId, status: r.status, expiresAt: r.expiresAt, createdBy: r.createdBy, customerId: has(p, PERM.PROPOSAL_READ) ? r.customerId : null })));
  }
  /** lot commercial state for map / QuickView (§163–§164, §252): never another customer's identity */
  async function lotCommercialState(p, developmentId, lotId) {
    return store.transaction(async tx => {
      const lot = await tx.lockLot(developmentId, lotId);
      if (!lot) fail('LOT_NOT_FOUND', { lotId });
      const out = { lotId, availabilityStatus: lot.status, availabilityRevision: lot.revision, reservedUntil: null, activeProposalCount: null, serverTime: nowIso() };
      if (has(p, PERM.RESERVATION_READ) && p.organizationId) {
        const live = (await tx.find('reservation', { organizationId: p.organizationId, lotId, status: ['ACTIVE'] }))[0];
        out.reservedUntil = live ? live.expiresAt : null;
      }
      if (has(p, PERM.PROPOSAL_READ) && p.organizationId) out.activeProposalCount = (await tx.find('proposal', { organizationId: p.organizationId, lotId, status: ['SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED'] })).length;
      return out;
    });
  }

  /** CommercialCapabilityResolver (§185–§187): permission + resource state + workflow policy + freshness + approval state */
  async function capabilities(p, { developmentId, lotId, proposalId = null, reservationId = null, closingId = null }) {
    const reasonCodes = [];
    const pol = await policies.getPolicy(p.organizationId, developmentId);
    const cfg = key => { try { requirePolicy(pol, key); return true; } catch (e) { reasonCodes.push(`POLICY_NOT_CONFIGURED:${key}`); return false; } };
    const auth = d => { const m = pol.authorityMatrix[d]; if (m == null) { reasonCodes.push(`COMMERCIAL_AUTHORITY_NOT_CONFIGURED:${d}`); return false; } if (m === 'REFERENCE_ONLY' || m === 'EXTERNAL_MASTER') { reasonCodes.push(`COMMERCIAL_AUTHORITY_EXTERNAL:${d}`); return false; } return true; };
    const perm = k => { if (has(p, k)) return true; reasonCodes.push(`NO_PERMISSION:${k}`); return false; };
    return store.transaction(async tx => {
      const lot = lotId ? await tx.lockLot(developmentId, lotId) : null;
      const pr = proposalId ? await tx.get('proposal', proposalId) : null;
      const r = reservationId ? await tx.get('reservation', reservationId) : null;
      const cl = closingId ? await tx.get('closing', closingId) : null;
      const own = e => !e || e.organizationId === p.organizationId;
      if (![pr, r, cl].every(own)) return { canCreateProposal: false, canSubmitProposal: false, canAcceptProposal: false, canCreateReservation: false, canExtendReservation: false, canReleaseReservation: false, canOpenClosing: false, canIssueContract: false, canCompleteSale: false, reasonCodes: ['NOT_FOUND'] };
      let lotOk = true;
      if (lot && lot.status === 'UNKNOWN') { reasonCodes.push('LOT_AVAILABILITY_UNKNOWN'); lotOk = false; }
      else if (lot && lot.status === 'SOLD') { reasonCodes.push('LOT_SOLD'); lotOk = false; }
      else if (lot && lot.status !== 'AVAILABLE') { reasonCodes.push(`LOT_${lot.status}`); lotOk = false; }
      const cap = {
        canCreateProposal: perm(PERM.PROPOSAL_CREATE) & auth('proposal') && (!lot || lot.status !== 'SOLD'),
        canSubmitProposal: !!pr && pr.status === 'DRAFT' && perm(PERM.PROPOSAL_SUBMIT) & cfg('submission.requiredCustomerFields') & cfg('approval.rules') & cfg('proposalConcurrency.mode'),
        canAcceptProposal: !!pr && ['UNDER_REVIEW', 'COUNTERED'].includes(pr.status) && !expired(pr, 'expiresAt') && perm(PERM.PROPOSAL_ACCEPT),
        canCreateReservation: perm(PERM.RESERVATION_CREATE) & auth('reservation') & auth('availability') & cfg('reservation.maxDurationSeconds') & cfg('workflow.proposalRequiredBeforeReservation') && lotOk,
        canExtendReservation: !!r && r.status === 'ACTIVE' && !expired(r, 'expiresAt') && perm(PERM.RESERVATION_EXTEND) & cfg('reservation.extension.allowed') && !!pol.reservation.extension.allowed,
        canReleaseReservation: !!r && r.status === 'ACTIVE' && perm(PERM.RESERVATION_RELEASE),
        canOpenClosing: !!pr && pr.status === 'ACCEPTED' && perm(PERM.CLOSING_MANAGE) & cfg('closingChecklist.items') & cfg('workflow.reservationRequiredForClosing'),
        canIssueContract: !!cl && D.OPEN_CLOSING.has(cl.status) && perm(PERM.CONTRACT_ISSUE) & cfg('closingReadiness.readyForSignature') && (pol.contractTemplates || []).some(t => t.approvedAt),
        canCompleteSale: !!cl && D.OPEN_CLOSING.has(cl.status) && perm(PERM.SALE_COMPLETE) & cfg('saleCompletion.requiredConditions') & auth('availability')
      };
      for (const k of Object.keys(cap)) cap[k] = !!cap[k];
      return { ...cap, reasonCodes: [...new Set(reasonCodes)] };
    });
  }

  return {
    PERM, createProposal, updateDraft, submitProposal, startReview, counterProposal, acceptProposal, rejectProposal, withdrawProposal, requestApproval, decideApproval,
    createReservation, extendReservation, releaseReservation, cancelReservation, confirmExternalReservation, runExpiry,
    openClosingCase, updateChecklistItem, recordManualConfirmation, createContract, issueContract, correctContract, sendForSignature, handleSignatureWebhook,
    completeSale, cancelClosing, recordLost, reconcileReservations,
    getProposal, getPresentationSnapshot, getReservation, getClosing, reservationBoard, lotCommercialState, capabilities
  };
}

module.exports = { createDealsService, PERM, DealError };
