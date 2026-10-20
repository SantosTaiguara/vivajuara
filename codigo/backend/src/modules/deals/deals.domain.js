'use strict';
/* Topic 57 — commercial transaction domain (Proposal, Negotiation, Approval, Reservation, Closing, Contract, Signature,
   SaleOutcome). PURE: no I/O, no clock (every function receives `now`), no id generation (ids are passed in).

   Separations kept on purpose (spec §2–§7):
     Proposal ≠ Reservation ≠ Availability ≠ Contract ≠ SaleOutcome ≠ Journey.
     Each aggregate owns its own lifecycle (no mega status, §155–§156); CommercialCase is a projection only (§159).
   Prices: the list price is ALWAYS the one delivered by the pricing port (current published price table — today
   R$ 1.196/m², table 2026-10-06, "preço de tabela"); this module never computes a price, it only copies it into the
   ProposalPricingBreakdown and compares minor units. A proposal discount never touches the price table (§306–§307).
   Business/legal policy values (reservation duration, WON definition, approval thresholds, checklist, concurrency
   policy, authority matrix…) come from org config and are null by default ("necessita confirmação"): the functions
   below report POLICY_NOT_CONFIGURED instead of guessing (see deals.policy.js). This is not legal advice. */
const { checksumOf } = require('../../shared/domain/checksum');

const En = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));

// ------------------------------------------------------------------------------------------------ enums
const ProposalStatus = En('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CANCELLED');
const ProposalVersionStatus = En('DRAFT', 'ISSUED', 'SUPERSEDED', 'ACCEPTED', 'REJECTED');
const ProposalType = En('CUSTOMER_OFFER', 'BROKER_MEDIATED', 'SELLER_COUNTER', 'COMMERCIAL_OFFER');
const VersionSource = En('CUSTOMER', 'BROKER', 'SELLER', 'SYSTEM_TEMPLATE');
const FinancingMode = En('DIRECT_INSTALLMENT', 'BANK_FINANCING', 'CASH', 'MIXED', 'OTHER');
const ConditionType = En('DOCUMENTATION', 'FINANCING', 'PAYMENT', 'LEGAL', 'COMMERCIAL', 'OTHER');
const ConditionStatus = En('PENDING', 'SATISFIED', 'WAIVED', 'FAILED', 'NOT_APPLICABLE');
const NegotiationStatus = En('OPEN', 'PAUSED', 'AGREEMENT_REACHED', 'FAILED', 'CANCELLED');
const NegotiationEventType = En('PROPOSAL_SUBMITTED', 'COUNTER_PROPOSED', 'TERMS_ACCEPTED', 'TERMS_REJECTED', 'NOTE_ADDED', 'PAUSED', 'RESUMED', 'AGREEMENT_REACHED', 'CANCELLED');
const ActorType = En('CUSTOMER', 'BROKER', 'MANAGER', 'SELLER', 'SYSTEM');
const ApprovalType = En('DISCOUNT', 'SPECIAL_PRICE', 'PAYMENT_TERM', 'RESERVATION_EXTENSION', 'MANUAL_OVERRIDE', 'OTHER');
const ApprovalStatus = En('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');
const ApprovalConditionType = En('DISCOUNT_PERCENT_GT', 'DISCOUNT_AMOUNT_GT', 'PAYMENT_TERM_SPECIAL', 'PRICE_OVERRIDE', 'RESERVATION_EXTENSION');
const AcceptanceMethod = En('BROKER_RECORDED', 'CLIENT_PORTAL', 'DIGITAL_SIGNATURE', 'EXTERNAL_PROVIDER');
// PENDING_EXTERNAL_CONFIRMATION (§350): only when the reservation authority is EXTERNAL_MASTER / HYBRID
const ReservationStatus = En('PENDING', 'PENDING_EXTERNAL_CONFIRMATION', 'ACTIVE', 'EXPIRED', 'RELEASED', 'CONVERTED', 'CANCELLED');
const ClosingStatus = En('OPEN', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CONTRACT_PREPARATION', 'READY_FOR_SIGNATURE', 'SIGNING', 'COMPLETED', 'FAILED', 'CANCELLED');
const ChecklistCategory = En('CUSTOMER_DOCUMENT', 'COMMERCIAL', 'FINANCIAL', 'LEGAL', 'CONTRACT', 'SIGNATURE', 'OTHER');
const ChecklistStatus = En('PENDING', 'RECEIVED', 'VALIDATED', 'REJECTED', 'WAIVED', 'NOT_APPLICABLE');
const ContractStatus = En('DRAFT', 'UNDER_REVIEW', 'READY_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'FULLY_SIGNED', 'CANCELLED', 'VOIDED');
const ContractVersionStatus = En('DRAFT', 'ISSUED', 'SUPERSEDED', 'SIGNED');
const EnvelopeStatus = En('CREATED', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED');
const SaleOutcomeType = En('WON', 'LOST', 'CANCELLED', 'FAILED');
const CasePhase = En('DECISION', 'PROPOSAL', 'NEGOTIATION', 'RESERVATION', 'CLOSING', 'COMPLETED', 'CLOSED');
const AuthorityMode = En('PLATFORM_MASTER', 'EXTERNAL_MASTER', 'HYBRID', 'REFERENCE_ONLY');
const ConcurrencyMode = En('MULTIPLE_PROPOSALS_ALLOWED', 'SINGLE_ACTIVE_PROPOSAL', 'RESERVATION_REQUIRED');
const PriorityRule = En('FIRST_SUBMITTED', 'FIRST_ACCEPTED', 'MANUAL');
const ExternalCommandType = En('CREATE_RESERVATION', 'CANCEL_RESERVATION', 'CREATE_CONTRACT');
const ExternalCommandStatus = En('PENDING', 'SENT', 'CONFIRMED', 'FAILED', 'RETRYING');
const ConflictDomain = En('RESERVATION', 'AVAILABILITY', 'CONTRACT', 'SIGNATURE');
const AssignmentRole = En('OWNER', 'COLLABORATOR', 'APPROVER', 'VIEWER');
const PartyRole = En('BUYER', 'CO_BUYER', 'LEGAL_REPRESENTATIVE');
/** registries named by the spec (§109, §243). Free text is only a complementary note. */
const LostReason = En('PRICE', 'PAYMENT', 'CUSTOMER_WITHDREW', 'LOT_UNAVAILABLE', 'DOCUMENTATION', 'CREDIT', 'COMPETITOR', 'NO_RESPONSE', 'OTHER');
const CancelReason = En('CUSTOMER_WITHDREW', 'DOCUMENTATION_FAILED', 'FINANCING_FAILED', 'SELLER_CANCELLED', 'LEGAL_ISSUE', 'COMMERCIAL_CONFLICT', 'OTHER');
const RejectReason = En('PRICE', 'PAYMENT_TERMS', 'LOT_UNAVAILABLE', 'DOCUMENTATION', 'POLICY', 'OTHER');
const ReleaseReason = En('CUSTOMER_WITHDREW', 'PROPOSAL_REJECTED', 'PROPOSAL_EXPIRED', 'ADMINISTRATIVE', 'COMMERCIAL_CONFLICT', 'OTHER');
/** conditions a SaleCompletionPolicy may require (the policy chooses; nothing is required by default) */
const SaleCondition = En('ACCEPTED_PROPOSAL', 'RESERVATION_CONVERTED', 'REQUIRED_CHECKLIST_VALIDATED', 'CONTRACT_ISSUED', 'CONTRACT_FULLY_SIGNED', 'INITIAL_PAYMENT_CONFIRMED_MANUALLY');
/** conditions a ClosingReadinessPolicy may require for READY_FOR_SIGNATURE */
const SignatureReadinessCondition = En('REQUIRED_CHECKLIST_VALIDATED', 'CONTRACT_ISSUED');
const DataClassification = Object.freeze({ PROPOSAL: 'CONFIDENTIAL', RESERVATION: 'CONFIDENTIAL', CONTRACT: 'RESTRICTED', SIGNATURE_EVIDENCE: 'RESTRICTED', CLOSING_DOCUMENTS: 'RESTRICTED' });

// ------------------------------------------------------------------------------------------------ errors
/** Stable error taxonomy (§192–§193): clients branch on `code`, never on the message. */
const ERRORS = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'Comando inválido.' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Escrita crítica exige Idempotency-Key.' },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'Idempotency-Key já usada com outro comando.' },
  PERMISSION_DENIED: { status: 403, message: 'Sem permissão para esta ação comercial.' },
  APPROVAL_SELF_DECISION_FORBIDDEN: { status: 403, message: 'Quem pediu a aprovação não pode decidi-la (separação de funções).' },
  PROPOSAL_NOT_FOUND: { status: 404, message: 'Proposta inexistente.' },
  RESERVATION_NOT_FOUND: { status: 404, message: 'Reserva inexistente.' },
  CLOSING_NOT_FOUND: { status: 404, message: 'Fechamento inexistente.' },
  CONTRACT_NOT_FOUND: { status: 404, message: 'Contrato inexistente.' },
  APPROVAL_NOT_FOUND: { status: 404, message: 'Pedido de aprovação inexistente.' },
  CHECKLIST_ITEM_NOT_FOUND: { status: 404, message: 'Item do checklist inexistente.' },
  LOT_NOT_FOUND: { status: 404, message: 'Lote inexistente neste empreendimento.' },
  CUSTOMER_NOT_FOUND: { status: 422, message: 'Proposta transacional exige cliente cadastrado (persistido).' },
  POLICY_NOT_CONFIGURED: { status: 422, message: 'Política comercial não configurada pela organização (necessita confirmação).' },
  COMMERCIAL_AUTHORITY_NOT_CONFIGURED: { status: 422, message: 'Autoridade do domínio comercial não definida (CommercialAuthorityMatrix necessita confirmação).' },
  COMMERCIAL_AUTHORITY_EXTERNAL: { status: 409, message: 'Este domínio é mantido por sistema externo: a plataforma não grava o estado oficial.' },
  PRICE_CONTEXT_INVALID: { status: 422, message: 'Sem preço de tabela vigente para o lote.' },
  PROPOSAL_INVALID: { status: 422, message: 'Proposta inválida: veja blockingErrors.' },
  PROPOSAL_EXPIRED: { status: 422, message: 'Proposta expirada: reemita uma nova versão ou nova proposta.' },
  PROPOSAL_VERSION_CONFLICT: { status: 409, message: 'A versão informada não é a versão corrente da proposta.' },
  PROPOSAL_NOT_ACCEPTABLE: { status: 422, message: 'A proposta não pode ser aceita neste estado.' },
  PROPOSAL_CONCURRENCY_CONFLICT: { status: 409, message: 'Já existe proposta ativa para este lote (política de concorrência).' },
  INVALID_PROPOSAL_TRANSITION: { status: 422, message: 'Transição de proposta não permitida.' },
  PROPOSAL_VERSION_IMMUTABLE: { status: 409, message: 'Versão emitida é imutável: crie nova versão.' },
  COMMERCIAL_APPROVAL_REQUIRED: { status: 422, message: 'Condição exige aprovação comercial antes de prosseguir.' },
  REASON_CODE_REQUIRED: { status: 422, message: 'Informe um código de motivo do registro.' },
  REVISION_CONFLICT: { status: 409, message: 'O registro foi alterado por outra operação; recarregue e tente novamente.' },
  LOT_NOT_AVAILABLE: { status: 409, message: 'Lote não está disponível para reserva.' },
  LOT_AVAILABILITY_UNKNOWN: { status: 409, message: 'Disponibilidade do lote sem informação: confirme com a fonte oficial antes de reservar.' },
  LOT_ALREADY_RESERVED: { status: 409, message: 'Lote já reservado.' },
  AVAILABILITY_REVISION_CONFLICT: { status: 409, message: 'A disponibilidade mudou desde a leitura (expectedAvailabilityRevision): recarregue.' },
  AVAILABILITY_STALE: { status: 409, message: 'Disponibilidade desatualizada para ação crítica: atualize antes.' },
  RESERVATION_EXPIRED: { status: 409, message: 'Reserva expirada.' },
  RESERVATION_EXPIRY_INVALID: { status: 422, message: 'Prazo da reserva inválido ou acima do máximo da política.' },
  RESERVATION_EXTENSION_NOT_ALLOWED: { status: 422, message: 'Extensão de reserva não permitida pela política.' },
  INVALID_RESERVATION_TRANSITION: { status: 422, message: 'Transição de reserva não permitida.' },
  CLOSING_REQUIREMENTS_INCOMPLETE: { status: 422, message: 'Requisitos do fechamento incompletos.' },
  INVALID_CLOSING_TRANSITION: { status: 422, message: 'Transição de fechamento não permitida.' },
  CONTRACT_TEMPLATE_NOT_APPROVED: { status: 422, message: 'Modelo de contrato não aprovado/versionado pela organização.' },
  CONTRACT_VARIABLES_UNRESOLVED: { status: 422, message: 'Variáveis obrigatórias do modelo não resolvidas.' },
  CONTRACT_NOT_READY: { status: 422, message: 'Contrato não está pronto para esta operação.' },
  CONTRACT_VERSION_IMMUTABLE: { status: 409, message: 'Versão de contrato emitida/assinada é imutável: crie nova versão.' },
  SIGNATURE_INCOMPLETE: { status: 422, message: 'Assinatura não confirmada pelo provedor.' },
  SIGNATURE_WEBHOOK_INVALID: { status: 401, message: 'Webhook de assinatura com verificação inválida.' },
  SALE_COMPLETION_REQUIREMENTS_NOT_MET: { status: 422, message: 'Requisitos da conclusão de venda não atendidos.' },
  SALE_ALREADY_COMPLETED: { status: 409, message: 'Venda concluída não pode ser reaberta nem alterada.' }
});
class DealError extends Error {
  constructor(code, details = null, message = null) {
    const def = ERRORS[code] || { status: 500, message: 'Erro interno' };
    super(message || def.message);
    this.code = code; this.status = def.status; this.details = details; this.dealError = true;
  }
}
const fail = (code, details, message) => { throw new DealError(code, details, message); };

// ------------------------------------------------------------------------------------------------ state machines
const PROPOSAL_TRANSITIONS = Object.freeze({
  DRAFT: ['SUBMITTED', 'WITHDRAWN', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN', 'CANCELLED', 'EXPIRED'],
  UNDER_REVIEW: ['ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN', 'CANCELLED', 'EXPIRED'],
  COUNTERED: ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'WITHDRAWN', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['CANCELLED'], // acceptance is not a contract; administrative cancellation keeps the history
  REJECTED: [], EXPIRED: [], WITHDRAWN: [], CANCELLED: [] // reissue = new version / new proposal (§143, §443)
});
const PROPOSAL_VERSION_TRANSITIONS = Object.freeze({ DRAFT: ['ISSUED'], ISSUED: ['SUPERSEDED', 'ACCEPTED', 'REJECTED'], SUPERSEDED: [], ACCEPTED: [], REJECTED: [] });
const RESERVATION_TRANSITIONS = Object.freeze({
  PENDING: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  PENDING_EXTERNAL_CONFIRMATION: ['ACTIVE', 'CANCELLED'], // external rejection = compensation → CANCELLED (§412)
  ACTIVE: ['EXPIRED', 'RELEASED', 'CONVERTED', 'CANCELLED'],
  EXPIRED: [], RELEASED: [], CONVERTED: [], CANCELLED: []
});
const CLOSING_TRANSITIONS = Object.freeze({
  OPEN: ['DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CONTRACT_PREPARATION', 'FAILED', 'CANCELLED'],
  DOCUMENTS_PENDING: ['UNDER_REVIEW', 'CONTRACT_PREPARATION', 'FAILED', 'CANCELLED'],
  UNDER_REVIEW: ['DOCUMENTS_PENDING', 'CONTRACT_PREPARATION', 'FAILED', 'CANCELLED'],
  CONTRACT_PREPARATION: ['DOCUMENTS_PENDING', 'READY_FOR_SIGNATURE', 'FAILED', 'CANCELLED'],
  READY_FOR_SIGNATURE: ['CONTRACT_PREPARATION', 'SIGNING', 'FAILED', 'CANCELLED'],
  SIGNING: ['READY_FOR_SIGNATURE', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [], // reopening a completed sale is prohibited (§246)
  FAILED: [], CANCELLED: [] // reopen = new case (§247)
});
const CONTRACT_TRANSITIONS = Object.freeze({
  DRAFT: ['UNDER_REVIEW', 'READY_FOR_SIGNATURE', 'CANCELLED', 'VOIDED'],
  UNDER_REVIEW: ['DRAFT', 'READY_FOR_SIGNATURE', 'CANCELLED', 'VOIDED'],
  READY_FOR_SIGNATURE: ['UNDER_REVIEW', 'PARTIALLY_SIGNED', 'FULLY_SIGNED', 'CANCELLED', 'VOIDED'],
  PARTIALLY_SIGNED: ['FULLY_SIGNED', 'CANCELLED', 'VOIDED'],
  FULLY_SIGNED: ['VOIDED'], CANCELLED: [], VOIDED: []
});
const ENVELOPE_TRANSITIONS = Object.freeze({
  CREATED: ['SENT', 'CANCELLED'], SENT: ['PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED'],
  PARTIALLY_SIGNED: ['COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED'], COMPLETED: [], DECLINED: [], EXPIRED: [], CANCELLED: []
});
const NEGOTIATION_TRANSITIONS = Object.freeze({ OPEN: ['PAUSED', 'AGREEMENT_REACHED', 'FAILED', 'CANCELLED'], PAUSED: ['OPEN', 'FAILED', 'CANCELLED'], AGREEMENT_REACHED: [], FAILED: [], CANCELLED: [] });
const APPROVAL_TRANSITIONS = Object.freeze({ PENDING: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'], APPROVED: [], REJECTED: [], CANCELLED: [], EXPIRED: [] });
const MACHINES = Object.freeze({ proposal: [PROPOSAL_TRANSITIONS, 'INVALID_PROPOSAL_TRANSITION'], proposalVersion: [PROPOSAL_VERSION_TRANSITIONS, 'PROPOSAL_VERSION_IMMUTABLE'],
  reservation: [RESERVATION_TRANSITIONS, 'INVALID_RESERVATION_TRANSITION'], closing: [CLOSING_TRANSITIONS, 'INVALID_CLOSING_TRANSITION'], contract: [CONTRACT_TRANSITIONS, 'CONTRACT_NOT_READY'],
  envelope: [ENVELOPE_TRANSITIONS, 'SIGNATURE_INCOMPLETE'], negotiation: [NEGOTIATION_TRANSITIONS, 'VALIDATION_ERROR'], approval: [APPROVAL_TRANSITIONS, 'VALIDATION_ERROR'] });
const canTransition = (machine, from, to) => (MACHINES[machine][0][from] || []).includes(to);
/** assertTransition(machine, from, to) — throws the machine's stable code */
function assertTransition(machine, from, to) {
  if (!canTransition(machine, from, to)) fail(MACHINES[machine][1], { machine, from, to });
}
const ACTIVE_PROPOSAL = new Set(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED']);
const LIVE_RESERVATION = new Set(['PENDING', 'PENDING_EXTERNAL_CONFIRMATION', 'ACTIVE']);
const OPEN_CLOSING = new Set(['OPEN', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CONTRACT_PREPARATION', 'READY_FOR_SIGNATURE', 'SIGNING']);

// ------------------------------------------------------------------------------------------------ helpers
const isInt = v => Number.isInteger(v);
const isMinor = v => Number.isSafeInteger(v) && v >= 0;
const isIso = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(v) && !Number.isNaN(Date.parse(v));
const iso = ms => new Date(ms).toISOString();
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ID_RE = /^[a-z]{2,8}_[A-Za-z0-9]{8,40}$/;
const SAFE_TEXT_MAX = 2000;

/** normalizeTerms(raw) → { terms, issues } — structured terms only; notes never replace structured fields (§28, §43) */
function normalizeTerms(raw) {
  const issues = [], I = (field, issue) => issues.push({ field, issue });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { terms: null, issues: [{ field: 'terms', issue: 'required' }] };
  const KNOWN = ['offerPriceMinor', 'currency', 'downPaymentMinor', 'paymentPlanId', 'paymentPlanVersion', 'installmentCount', 'monthlyPaymentTargetMinor',
    'discountRequestedPercent', 'discountRequestedMinor', 'validityDate', 'financingMode', 'conditions', 'notes'];
  for (const k of Object.keys(raw)) if (!KNOWN.includes(k)) I(k, 'unknown_field');
  const t = { offerPriceMinor: raw.offerPriceMinor ?? null, currency: raw.currency ?? null, conditions: [] };
  if (t.offerPriceMinor != null && !isMinor(t.offerPriceMinor)) I('offerPriceMinor', 'minor_units_integer');
  if (t.currency != null && !/^[A-Z]{3}$/.test(t.currency)) I('currency', 'iso4217');
  for (const k of ['downPaymentMinor', 'monthlyPaymentTargetMinor', 'discountRequestedMinor']) if (raw[k] != null) { if (!isMinor(raw[k])) I(k, 'minor_units_integer'); else t[k] = raw[k]; }
  if (raw.installmentCount != null) { if (!isInt(raw.installmentCount) || raw.installmentCount < 1 || raw.installmentCount > 600) I('installmentCount', 'range_1_600'); else t.installmentCount = raw.installmentCount; }
  if (raw.discountRequestedPercent != null) { if (typeof raw.discountRequestedPercent !== 'number' || !(raw.discountRequestedPercent >= 0 && raw.discountRequestedPercent < 100)) I('discountRequestedPercent', 'range_0_100'); else t.discountRequestedPercent = raw.discountRequestedPercent; }
  for (const k of ['paymentPlanId', 'paymentPlanVersion']) if (raw[k] != null) { if (typeof raw[k] !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(raw[k])) I(k, 'format'); else t[k] = raw[k]; }
  if (raw.validityDate != null) { if (!isIso(raw.validityDate)) I('validityDate', 'iso_utc'); else t.validityDate = raw.validityDate; }
  if (raw.financingMode != null) { if (!FinancingMode[raw.financingMode]) I('financingMode', 'enum'); else t.financingMode = raw.financingMode; }
  if (raw.notes != null) { if (typeof raw.notes !== 'string' || raw.notes.length > SAFE_TEXT_MAX) I('notes', 'text_max_2000'); else t.notes = raw.notes; }
  if (raw.conditions != null && !Array.isArray(raw.conditions)) I('conditions', 'array');
  for (const [i, c] of (Array.isArray(raw.conditions) ? raw.conditions : []).entries()) {
    if (!c || typeof c !== 'object') { I(`conditions[${i}]`, 'object'); continue; }
    if (!CODE_RE.test(c.code || '')) I(`conditions[${i}].code`, 'code_format');
    if (!ConditionType[c.type]) I(`conditions[${i}].type`, 'enum');
    if (typeof c.description !== 'string' || !c.description.trim() || c.description.length > 500) I(`conditions[${i}].description`, 'text_1_500');
    if (typeof c.required !== 'boolean') I(`conditions[${i}].required`, 'boolean');
    const status = c.status == null ? 'PENDING' : c.status;
    if (!ConditionStatus[status]) I(`conditions[${i}].status`, 'enum');
    t.conditions.push({ code: c.code, type: c.type, description: c.description, required: c.required, status });
  }
  if (t.downPaymentMinor != null && t.offerPriceMinor != null && t.downPaymentMinor > t.offerPriceMinor) I('downPaymentMinor', 'greater_than_offer');
  return { terms: Object.freeze(t), issues };
}

/** ProposalPricingBreakdown (§137): listed price from the price table quote, never overwritten (§136) */
function pricingBreakdown(quote, terms, approvedDiscountMinor = null) {
  if (!quote || !isMinor(quote.listPriceMinor)) return null;
  const offer = terms && isMinor(terms.offerPriceMinor) ? terms.offerPriceMinor : null;
  const requested = offer == null ? null : Math.max(0, quote.listPriceMinor - offer);
  return Object.freeze({ listPriceMinor: quote.listPriceMinor, offerPriceMinor: offer, requestedDiscountMinor: requested,
    requestedDiscountPercent: requested == null || !quote.listPriceMinor ? null : Math.round(requested / quote.listPriceMinor * 10000) / 100,
    approvedDiscountMinor, priceTableId: quote.priceTableId, priceTableVersion: quote.priceTableVersion, currency: quote.currency });
}
const pricingSnapshotRef = q => `pricetable:${q.developmentId}:${q.priceTableId}@${q.priceTableVersion}:${q.lotId}`;
const availabilitySnapshotRef = (devId, lotId, a) => `availability:${devId}:${lotId}@r${a.revision}:${a.status}`;

/** ProposalVersion checksum: over terms + refs + version identity (immutable once ISSUED) */
const versionChecksum = v => checksumOf({ proposalId: v.proposalId, versionNumber: v.versionNumber, terms: v.terms, pricing: v.pricing, pricingSnapshotRef: v.pricingSnapshotRef,
  availabilitySnapshotRef: v.availabilitySnapshotRef, financialSimulationRef: v.financialSimulationRef || null, source: v.source, validUntil: v.validUntil || null, supersedesVersionId: v.supersedesVersionId || null });

/** approval evaluation (§44–§48, §138): which configured rules the version triggers. rules = null → not configured. */
function requiredApprovals(rules, breakdown, terms, { extension = false } = {}) {
  if (rules == null) return null;
  const out = [];
  for (const r of rules) {
    let hit = false;
    if (r.conditionType === 'DISCOUNT_PERCENT_GT') hit = breakdown && breakdown.requestedDiscountPercent != null && r.threshold != null && breakdown.requestedDiscountPercent > r.threshold;
    else if (r.conditionType === 'DISCOUNT_AMOUNT_GT') hit = breakdown && breakdown.requestedDiscountMinor != null && r.threshold != null && breakdown.requestedDiscountMinor > r.threshold;
    else if (r.conditionType === 'PAYMENT_TERM_SPECIAL') hit = !!(terms && (terms.financingMode === 'OTHER' || (terms.conditions || []).some(c => c.type === 'PAYMENT' && c.code.startsWith('SPECIAL_'))));
    else if (r.conditionType === 'PRICE_OVERRIDE') hit = !!(breakdown && breakdown.offerPriceMinor != null && breakdown.offerPriceMinor > breakdown.listPriceMinor); // above list = manual override
    else if (r.conditionType === 'RESERVATION_EXTENSION') hit = !!extension;
    if (hit) out.push({ ruleCode: r.code, approvalType: { DISCOUNT_PERCENT_GT: 'DISCOUNT', DISCOUNT_AMOUNT_GT: 'DISCOUNT', PAYMENT_TERM_SPECIAL: 'PAYMENT_TERM', PRICE_OVERRIDE: 'MANUAL_OVERRIDE', RESERVATION_EXTENSION: 'RESERVATION_EXTENSION' }[r.conditionType],
      requiredApprovalPermission: r.requiredApprovalPermission, requireReason: !!r.requireReason, requireStepUp: !!r.requireStepUp });
  }
  return out;
}

/** ProposalValidationResult (§34–§36) */
function validateForIssue({ proposal, terms, termIssues = [], customer, submissionPolicy, quote, availability, now, availabilityAgeSeconds = null, versionRefs = {} }) {
  const blockingErrors = [], warnings = [];
  if (!customer) blockingErrors.push('CUSTOMER_NOT_FOUND');
  else for (const f of submissionPolicy.requiredCustomerFields || []) if (!customer.presentFields || !customer.presentFields.includes(f)) blockingErrors.push(`CUSTOMER_FIELD_MISSING:${f}`);
  if (!quote) blockingErrors.push('PRICE_CONTEXT_INVALID');
  if (!availability) blockingErrors.push('AVAILABILITY_CONTEXT_MISSING');
  else if (availability.status === 'UNKNOWN') warnings.push('AVAILABILITY_UNKNOWN_NEEDS_CONFIRMATION');
  else if (['SOLD', 'UNAVAILABLE', 'BLOCKED'].includes(availability.status)) blockingErrors.push(`LOT_NOT_AVAILABLE:${availability.status}`);
  if (submissionPolicy.requireAvailabilityFreshness) {
    if (submissionPolicy.maxAvailabilityAgeSeconds == null) blockingErrors.push('POLICY_NOT_CONFIGURED:submission.maxAvailabilityAgeSeconds');
    else if (availabilityAgeSeconds == null || availabilityAgeSeconds > submissionPolicy.maxAvailabilityAgeSeconds) blockingErrors.push('AVAILABILITY_STALE');
  }
  for (const i of termIssues) blockingErrors.push(`TERMS_INVALID:${i.field}:${i.issue}`);
  if (terms) {
    if (terms.offerPriceMinor == null) blockingErrors.push('TERMS_REQUIRED:offerPriceMinor');
    if (!terms.currency) blockingErrors.push('TERMS_REQUIRED:currency');
    else if (quote && terms.currency !== quote.currency) blockingErrors.push('TERMS_CURRENCY_MISMATCH');
    for (const f of submissionPolicy.requiredProposalFields || []) if (terms[f] == null) blockingErrors.push(`TERMS_REQUIRED:${f}`);
    if (!terms.validityDate) blockingErrors.push('TERMS_REQUIRED:validityDate'); // validUntil explicit (§140)
    else if (Date.parse(terms.validityDate) <= now) blockingErrors.push('TERMS_VALIDITY_IN_PAST');
    if (submissionPolicy.requireFinancialSimulation && !versionRefs.financialSimulationRef) blockingErrors.push('FINANCIAL_SIMULATION_REQUIRED');
    if (quote && terms.offerPriceMinor != null && terms.offerPriceMinor !== quote.listPriceMinor) warnings.push('OFFER_DIFFERS_FROM_LIST_PRICE');
  } else blockingErrors.push('TERMS_REQUIRED');
  if (proposal && quote && proposal.lotId !== quote.lotId) blockingErrors.push('LOT_MISMATCH');
  const status = blockingErrors.length ? 'INVALID' : warnings.length ? 'VALID_WITH_WARNINGS' : 'VALID';
  return Object.freeze({ status, blockingErrors, warnings, versionRefs: Object.freeze({ ...versionRefs }) });
}

/** ProposalVersionDiff (§367): structured term changes between two versions (permission-scoped by the caller) */
function diffVersions(from, to) {
  const flat = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o || {})) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = Array.isArray(v) ? JSON.stringify(v) : v; } return out; };
  const a = flat({ terms: from.terms, validUntil: from.validUntil || null }), b = flat({ terms: to.terms, validUntil: to.validUntil || null });
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changedFields = fields.filter(f => (a[f] ?? null) !== (b[f] ?? null)).map(f => ({ field: f, before: a[f] ?? null, after: b[f] ?? null }));
  return Object.freeze({ fromVersionId: from.id, toVersionId: to.id, changedFields });
}

/** ClosingReadiness (§235–§238) over the configured checklist + contract state for a target */
function closingReadiness({ checklist, contract, contractVersion, envelope, closing, reservation, proposal, requiredConditions, manualConfirmations = [] }) {
  const blockingItems = [], warnings = [];
  if (requiredConditions == null) return Object.freeze({ status: 'NOT_READY', blockingItems: ['POLICY_NOT_CONFIGURED'], warnings, notConfigured: true });
  const reqItems = (checklist || []).filter(i => i.required);
  const doneRequired = reqItems.filter(i => ['VALIDATED', 'WAIVED', 'NOT_APPLICABLE'].includes(i.status));
  for (const cond of requiredConditions) {
    if (cond === 'REQUIRED_CHECKLIST_VALIDATED') { for (const i of reqItems) if (!doneRequired.includes(i)) blockingItems.push(`CHECKLIST:${i.code}:${i.status}`); }
    else if (cond === 'CONTRACT_ISSUED') { if (!contractVersion || !['ISSUED', 'SIGNED'].includes(contractVersion.status)) blockingItems.push('CONTRACT_NOT_ISSUED'); }
    else if (cond === 'CONTRACT_FULLY_SIGNED') { if (!contract || contract.status !== 'FULLY_SIGNED' || !envelope || envelope.status !== 'COMPLETED') blockingItems.push('SIGNATURE_INCOMPLETE'); }
    else if (cond === 'ACCEPTED_PROPOSAL') { if (!proposal || proposal.status !== 'ACCEPTED' || closing.acceptedProposalVersionId !== proposal.currentVersionId) blockingItems.push('PROPOSAL_NOT_ACCEPTED'); }
    else if (cond === 'RESERVATION_CONVERTED') { if (!reservation || reservation.status !== 'CONVERTED') blockingItems.push('RESERVATION_NOT_CONVERTED'); }
    else if (cond === 'INITIAL_PAYMENT_CONFIRMED_MANUALLY') { if (!manualConfirmations.some(m => m.code === 'INITIAL_PAYMENT' && m.confirmedBy && m.confirmedAt && (m.evidenceRefs || []).length)) blockingItems.push('INITIAL_PAYMENT_NOT_CONFIRMED'); }
    else blockingItems.push(`UNKNOWN_CONDITION:${cond}`);
  }
  for (const i of (checklist || []).filter(i => !i.required && i.status === 'PENDING')) warnings.push(`OPTIONAL_PENDING:${i.code}`);
  const status = blockingItems.length ? 'NOT_READY' : warnings.length ? 'READY_WITH_WARNINGS' : 'READY';
  return Object.freeze({ status, blockingItems, warnings, progress: { done: doneRequired.length, total: reqItems.length } }); // count-based, never a fake percentage (§374)
}

/** ContractGenerationValidation (§231): template must be approved & versioned; every mandatory merge field resolved. No clause is generated. */
function validateContractGeneration(template, variables, proposalVersion) {
  const missingVariables = [], invalidVariables = [];
  for (const v of template.mandatoryVariables || []) { const x = variables[v]; if (x == null || x === '') missingVariables.push(v); }
  for (const [k, x] of Object.entries(variables || {})) if (!(template.mandatoryVariables || []).includes(k) && !(template.optionalVariables || []).includes(k)) invalidVariables.push(k);
  return Object.freeze({ missingVariables, invalidVariables, templateVersion: template.templateVersion, proposalVersion: proposalVersion ? proposalVersion.id : null, valid: !missingVariables.length && !invalidVariables.length });
}

/** CommercialCase phase projection (§157–§160) — convenience read model, never the source of truth */
function projectPhase({ proposal, reservation, closing, outcome }) {
  if (outcome) return outcome.outcome === 'WON' ? 'COMPLETED' : 'CLOSED';
  if (closing) return OPEN_CLOSING.has(closing.status) ? 'CLOSING' : closing.status === 'COMPLETED' ? 'COMPLETED' : 'CLOSED';
  if (reservation && LIVE_RESERVATION.has(reservation.status)) return 'RESERVATION';
  if (proposal) {
    if (['COUNTERED', 'UNDER_REVIEW'].includes(proposal.status)) return 'NEGOTIATION';
    if (ACTIVE_PROPOSAL.has(proposal.status)) return 'PROPOSAL';
    return 'CLOSED';
  }
  return 'DECISION';
}

/** ProposalPresentationSnapshot (§169, §382–§384): client-safe terms only — no internal discount margin, approval
    threshold, broker note or internal risk. Customer identity is not part of it either. */
function presentationSnapshot(proposal, version, { generatedAt, lotSnapshotRef }) {
  const t = version.terms;
  const clientSafeTerms = { offerPriceMinor: t.offerPriceMinor, currency: t.currency, downPaymentMinor: t.downPaymentMinor ?? null, installmentCount: t.installmentCount ?? null,
    paymentPlanId: t.paymentPlanId ?? null, financingMode: t.financingMode ?? null, conditions: (t.conditions || []).map(c => ({ code: c.code, type: c.type, description: c.description, required: c.required })) };
  const body = { proposalId: proposal.id, proposalVersionId: version.id, versionNumber: version.versionNumber, clientSafeTerms, validity: version.validUntil, lotSnapshotRef, generatedAt };
  return Object.freeze({ ...body, checksum: checksumOf(body) });
}

module.exports = {
  ProposalStatus, ProposalVersionStatus, ProposalType, VersionSource, FinancingMode, ConditionType, ConditionStatus, NegotiationStatus, NegotiationEventType, ActorType,
  ApprovalType, ApprovalStatus, ApprovalConditionType, AcceptanceMethod, ReservationStatus, ClosingStatus, ChecklistCategory, ChecklistStatus, ContractStatus,
  ContractVersionStatus, EnvelopeStatus, SaleOutcomeType, CasePhase, AuthorityMode, ConcurrencyMode, PriorityRule, ExternalCommandType, ExternalCommandStatus,
  ConflictDomain, AssignmentRole, PartyRole, LostReason, CancelReason, RejectReason, ReleaseReason, SaleCondition, SignatureReadinessCondition, DataClassification,
  ERRORS, DealError, fail, MACHINES, PROPOSAL_TRANSITIONS, RESERVATION_TRANSITIONS, CLOSING_TRANSITIONS, CONTRACT_TRANSITIONS, ENVELOPE_TRANSITIONS,
  canTransition, assertTransition, ACTIVE_PROPOSAL, LIVE_RESERVATION, OPEN_CLOSING,
  isIso, isMinor, iso, ID_RE, CODE_RE, normalizeTerms, pricingBreakdown, pricingSnapshotRef, availabilitySnapshotRef, versionChecksum, requiredApprovals,
  validateForIssue, diffVersions, closingReadiness, validateContractGeneration, projectPhase, presentationSnapshot
};
