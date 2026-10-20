/* deals/dealsDomain.js — topic 57, read-only frontend mirror of the commercial domain (backend/src/modules/deals).
   The browser NEVER creates, reserves or closes anything: the backend is the only authority (deny by default).
   This file only names states, error codes and permissions, and formats what the API returns (chips, countdown).
   Kept in lockstep with the backend by backend/tests/deals.test.js (parity test). */
App.deals = App.deals || {};
App.deals.domain = (() => {
  const E = (...k) => Object.freeze(Object.fromEntries(k.map(x => [x, x])));
  const ProposalStatus = E('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CANCELLED');
  const ReservationStatus = E('PENDING', 'PENDING_EXTERNAL_CONFIRMATION', 'ACTIVE', 'EXPIRED', 'RELEASED', 'CONVERTED', 'CANCELLED');
  const ClosingStatus = E('OPEN', 'DOCUMENTS_PENDING', 'UNDER_REVIEW', 'CONTRACT_PREPARATION', 'READY_FOR_SIGNATURE', 'SIGNING', 'COMPLETED', 'FAILED', 'CANCELLED');
  const ContractStatus = E('DRAFT', 'UNDER_REVIEW', 'READY_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'FULLY_SIGNED', 'CANCELLED', 'VOIDED');
  const EnvelopeStatus = E('CREATED', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED');
  const SaleOutcomeType = E('WON', 'LOST', 'CANCELLED', 'FAILED');
  const LostReason = E('PRICE', 'PAYMENT', 'CUSTOMER_WITHDREW', 'LOT_UNAVAILABLE', 'DOCUMENTATION', 'CREDIT', 'COMPETITOR', 'NO_RESPONSE', 'OTHER');
  const CancelReason = E('CUSTOMER_WITHDREW', 'DOCUMENTATION_FAILED', 'FINANCING_FAILED', 'SELLER_CANCELLED', 'LEGAL_ISSUE', 'COMMERCIAL_CONFLICT', 'OTHER');
  const CasePhase = E('DECISION', 'PROPOSAL', 'NEGOTIATION', 'RESERVATION', 'CLOSING', 'COMPLETED', 'CLOSED');
  /** stable error taxonomy (codes only; messages come from the API) */
  const ERROR_CODES = Object.freeze(["VALIDATION_ERROR","IDEMPOTENCY_KEY_REQUIRED","IDEMPOTENCY_KEY_REUSED","PERMISSION_DENIED","APPROVAL_SELF_DECISION_FORBIDDEN","PROPOSAL_NOT_FOUND","RESERVATION_NOT_FOUND","CLOSING_NOT_FOUND","CONTRACT_NOT_FOUND","APPROVAL_NOT_FOUND","CHECKLIST_ITEM_NOT_FOUND","LOT_NOT_FOUND","CUSTOMER_NOT_FOUND","POLICY_NOT_CONFIGURED","COMMERCIAL_AUTHORITY_NOT_CONFIGURED","COMMERCIAL_AUTHORITY_EXTERNAL","PRICE_CONTEXT_INVALID","PROPOSAL_INVALID","PROPOSAL_EXPIRED","PROPOSAL_VERSION_CONFLICT","PROPOSAL_NOT_ACCEPTABLE","PROPOSAL_CONCURRENCY_CONFLICT","INVALID_PROPOSAL_TRANSITION","PROPOSAL_VERSION_IMMUTABLE","COMMERCIAL_APPROVAL_REQUIRED","REASON_CODE_REQUIRED","REVISION_CONFLICT","LOT_NOT_AVAILABLE","LOT_AVAILABILITY_UNKNOWN","LOT_ALREADY_RESERVED","AVAILABILITY_REVISION_CONFLICT","AVAILABILITY_STALE","RESERVATION_EXPIRED","RESERVATION_EXPIRY_INVALID","RESERVATION_EXTENSION_NOT_ALLOWED","INVALID_RESERVATION_TRANSITION","CLOSING_REQUIREMENTS_INCOMPLETE","INVALID_CLOSING_TRANSITION","CONTRACT_TEMPLATE_NOT_APPROVED","CONTRACT_VARIABLES_UNRESOLVED","CONTRACT_NOT_READY","CONTRACT_VERSION_IMMUTABLE","SIGNATURE_INCOMPLETE","SIGNATURE_WEBHOOK_INVALID","SALE_COMPLETION_REQUIREMENTS_NOT_MET","SALE_ALREADY_COMPLETED"]);
  const ERROR_MESSAGES = Object.freeze({"VALIDATION_ERROR":"Comando inválido.","IDEMPOTENCY_KEY_REQUIRED":"Escrita crítica exige Idempotency-Key.","IDEMPOTENCY_KEY_REUSED":"Idempotency-Key já usada com outro comando.","PERMISSION_DENIED":"Sem permissão para esta ação comercial.","APPROVAL_SELF_DECISION_FORBIDDEN":"Quem pediu a aprovação não pode decidi-la (separação de funções).","PROPOSAL_NOT_FOUND":"Proposta inexistente.","RESERVATION_NOT_FOUND":"Reserva inexistente.","CLOSING_NOT_FOUND":"Fechamento inexistente.","CONTRACT_NOT_FOUND":"Contrato inexistente.","APPROVAL_NOT_FOUND":"Pedido de aprovação inexistente.","CHECKLIST_ITEM_NOT_FOUND":"Item do checklist inexistente.","LOT_NOT_FOUND":"Lote inexistente neste empreendimento.","CUSTOMER_NOT_FOUND":"Proposta transacional exige cliente cadastrado (persistido).","POLICY_NOT_CONFIGURED":"Política comercial não configurada pela organização (necessita confirmação).","COMMERCIAL_AUTHORITY_NOT_CONFIGURED":"Autoridade do domínio comercial não definida (CommercialAuthorityMatrix necessita confirmação).","COMMERCIAL_AUTHORITY_EXTERNAL":"Este domínio é mantido por sistema externo: a plataforma não grava o estado oficial.","PRICE_CONTEXT_INVALID":"Sem preço de tabela vigente para o lote.","PROPOSAL_INVALID":"Proposta inválida: veja blockingErrors.","PROPOSAL_EXPIRED":"Proposta expirada: reemita uma nova versão ou nova proposta.","PROPOSAL_VERSION_CONFLICT":"A versão informada não é a versão corrente da proposta.","PROPOSAL_NOT_ACCEPTABLE":"A proposta não pode ser aceita neste estado.","PROPOSAL_CONCURRENCY_CONFLICT":"Já existe proposta ativa para este lote (política de concorrência).","INVALID_PROPOSAL_TRANSITION":"Transição de proposta não permitida.","PROPOSAL_VERSION_IMMUTABLE":"Versão emitida é imutável: crie nova versão.","COMMERCIAL_APPROVAL_REQUIRED":"Condição exige aprovação comercial antes de prosseguir.","REASON_CODE_REQUIRED":"Informe um código de motivo do registro.","REVISION_CONFLICT":"O registro foi alterado por outra operação; recarregue e tente novamente.","LOT_NOT_AVAILABLE":"Lote não está disponível para reserva.","LOT_AVAILABILITY_UNKNOWN":"Disponibilidade do lote sem informação: confirme com a fonte oficial antes de reservar.","LOT_ALREADY_RESERVED":"Lote já reservado.","AVAILABILITY_REVISION_CONFLICT":"A disponibilidade mudou desde a leitura (expectedAvailabilityRevision): recarregue.","AVAILABILITY_STALE":"Disponibilidade desatualizada para ação crítica: atualize antes.","RESERVATION_EXPIRED":"Reserva expirada.","RESERVATION_EXPIRY_INVALID":"Prazo da reserva inválido ou acima do máximo da política.","RESERVATION_EXTENSION_NOT_ALLOWED":"Extensão de reserva não permitida pela política.","INVALID_RESERVATION_TRANSITION":"Transição de reserva não permitida.","CLOSING_REQUIREMENTS_INCOMPLETE":"Requisitos do fechamento incompletos.","INVALID_CLOSING_TRANSITION":"Transição de fechamento não permitida.","CONTRACT_TEMPLATE_NOT_APPROVED":"Modelo de contrato não aprovado/versionado pela organização.","CONTRACT_VARIABLES_UNRESOLVED":"Variáveis obrigatórias do modelo não resolvidas.","CONTRACT_NOT_READY":"Contrato não está pronto para esta operação.","CONTRACT_VERSION_IMMUTABLE":"Versão de contrato emitida/assinada é imutável: crie nova versão.","SIGNATURE_INCOMPLETE":"Assinatura não confirmada pelo provedor.","SIGNATURE_WEBHOOK_INVALID":"Webhook de assinatura com verificação inválida.","SALE_COMPLETION_REQUIREMENTS_NOT_MET":"Requisitos da conclusão de venda não atendidos.","SALE_ALREADY_COMPLETED":"Venda concluída não pode ser reaberta nem alterada."});
  /** permission keys (config/security/permissions.json); no role grants them yet — decision pending */
  const PERMISSIONS = Object.freeze(["proposal.read","proposal.create","proposal.update_draft","proposal.submit","proposal.withdraw","proposal.review","proposal.counter","proposal.accept","proposal.reject","reservation.read","reservation.create","reservation.extend","reservation.release","reservation.cancel","closing.read","closing.manage","closing.validate_documents","contract.generate","contract.issue","signature.manage","sale.complete","sale.cancel","commercial_approval.request","commercial_approval.decide"]);
  const LABEL = Object.freeze({
    proposal: { DRAFT: 'Rascunho', SUBMITTED: 'Enviada', UNDER_REVIEW: 'Em análise', COUNTERED: 'Contraproposta', ACCEPTED: 'Aceita', REJECTED: 'Recusada', EXPIRED: 'Expirada', WITHDRAWN: 'Retirada', CANCELLED: 'Cancelada' },
    reservation: { PENDING: 'Pendente', PENDING_EXTERNAL_CONFIRMATION: 'Aguardando confirmação externa', ACTIVE: 'Ativa', EXPIRED: 'Expirada', RELEASED: 'Liberada', CONVERTED: 'Convertida em fechamento', CANCELLED: 'Cancelada' },
    closing: { OPEN: 'Aberto', DOCUMENTS_PENDING: 'Documentos pendentes', UNDER_REVIEW: 'Em conferência', CONTRACT_PREPARATION: 'Preparando contrato', READY_FOR_SIGNATURE: 'Pronto para assinatura', SIGNING: 'Em assinatura', COMPLETED: 'Concluído', FAILED: 'Não concluído', CANCELLED: 'Cancelado' },
    contract: { DRAFT: 'Rascunho', UNDER_REVIEW: 'Em revisão', READY_FOR_SIGNATURE: 'Pronto para assinatura', PARTIALLY_SIGNED: 'Parcialmente assinado', FULLY_SIGNED: 'Assinado', CANCELLED: 'Cancelado', VOIDED: 'Anulado' },
    envelope: { CREATED: 'Criado', SENT: 'Enviado', PARTIALLY_SIGNED: 'Parcialmente assinado', COMPLETED: 'Concluído', DECLINED: 'Recusado', EXPIRED: 'Expirado', CANCELLED: 'Cancelado' },
    outcome: { WON: 'Venda concluída', LOST: 'Perdida', CANCELLED: 'Cancelada', FAILED: 'Não concluída' },
    phase: { DECISION: 'Decisão', PROPOSAL: 'Proposta', NEGOTIATION: 'Negociação', RESERVATION: 'Reserva', CLOSING: 'Fechamento', COMPLETED: 'Concluído', CLOSED: 'Encerrado' }
  });
  const TONE = { ACCEPTED: 'ok', ACTIVE: 'ok', COMPLETED: 'ok', FULLY_SIGNED: 'ok', WON: 'ok', CONVERTED: 'ok',
    REJECTED: 'bad', EXPIRED: 'bad', CANCELLED: 'bad', FAILED: 'bad', VOIDED: 'bad', DECLINED: 'bad', LOST: 'bad', WITHDRAWN: 'bad', RELEASED: 'muted' };
  /** chip(kind, status) → { label, tone }; unknown status is shown as such, never guessed */
  function chip(kind, status) {
    const t = LABEL[kind] || {};
    return t[status] ? { label: t[status], tone: TONE[status] || 'info' } : { label: 'Status não reconhecido', tone: 'warn' };
  }
  /** countdown(expiresAt, serverTime) — remaining time from the SERVER clock the API returned (never Date.now()) */
  function countdown(expiresAt, serverTime) {
    const e = Date.parse(expiresAt), s = Date.parse(serverTime);
    if (!Number.isFinite(e) || !Number.isFinite(s)) return { known: false, expired: null, ms: null, text: 'Prazo não informado' };
    const ms = e - s; if (ms <= 0) return { known: true, expired: true, ms: 0, text: 'Prazo encerrado' };
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), d = Math.floor(h / 24);
    return { known: true, expired: false, ms, text: d >= 1 ? `${d} d ${h % 24} h restantes` : h >= 1 ? `${h} h ${m} min restantes` : `${Math.max(1, m)} min restantes` };
  }
  /** lotBadge(lotCommercialState) — what a lot card may say; never who reserved, never a price other than the table */
  function lotBadge(st) {
    if (!st || !st.availabilityStatus || st.availabilityStatus === 'UNKNOWN') return { label: 'Disponibilidade não confirmada', tone: 'warn' };
    if (st.availabilityStatus === 'RESERVED') return { label: 'Reservado', tone: 'info' };
    if (st.availabilityStatus === 'SOLD') return { label: 'Vendido', tone: 'muted' };
    if (st.availabilityStatus === 'AVAILABLE') return { label: st.activeProposalCount > 0 ? 'Disponível · em negociação' : 'Disponível', tone: 'ok' };
    return { label: 'Indisponível', tone: 'muted' };
  }
  /** money(minor) — BRL from integer minor units; null stays "não informado" (null is never 0) */
  const money = minor => Number.isInteger(minor) ? (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'não informado';
  const errorMessage = code => ERROR_MESSAGES[code] || 'Não foi possível concluir a ação comercial.';
  return Object.freeze({ ProposalStatus, ReservationStatus, ClosingStatus, ContractStatus, EnvelopeStatus, SaleOutcomeType, LostReason, CancelReason, CasePhase, ERROR_CODES, PERMISSIONS, LABEL, chip, countdown, lotBadge, money, errorMessage });
})();
