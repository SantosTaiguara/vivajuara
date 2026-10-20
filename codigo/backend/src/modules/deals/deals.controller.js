'use strict';
/* HTTP adapter of topic 57 (NOT wired into src/app.js yet — integration step for the coordinator, see
   docs/RELATORIO_TOPICO_57.md). Same conventions as the other modules: route templates, Idempotency-Key header for
   critical writes, expectedRevision in the body, stable error codes (DealError → ApiError), Cache-Control no-store
   (transactional entities are never served from a long-lived cache, §265–§268).
   DEALS_ROUTE_POLICIES: the RoutePermissionMatrix rows to merge into modules/iam/routePolicies.js; the keys must first be
   added to modules/iam/permissions.js (DEALS_PERMISSIONS below), with NO role grant until a human decides (§47, §439). */
const { E, AppError } = require('../../shared/http/errors');
const { DealError } = require('./deals.domain');
const { PERM } = require('./deals.service');
const { grantedKeys } = require('../iam/authorization');

const DEALS_PERMISSIONS = Object.freeze([
  ['proposal.read', 'MEDIUM', 'Ler propostas, versões e negociação (dados CONFIDENTIAL).'], ['proposal.create', 'MEDIUM', 'Criar proposta (rascunho) a partir de cliente/lote/decisão.'],
  ['proposal.update_draft', 'MEDIUM', 'Editar rascunho de proposta (expectedRevision).'], ['proposal.submit', 'HIGH', 'Emitir/enviar proposta (versão imutável).'],
  ['proposal.withdraw', 'HIGH', 'Registrar retirada de proposta (motivo).'], ['proposal.review', 'MEDIUM', 'Colocar proposta em análise.'],
  ['proposal.counter', 'HIGH', 'Emitir contraproposta (nova versão).'], ['proposal.accept', 'HIGH', 'Registrar aceite de versão exata.'], ['proposal.reject', 'HIGH', 'Recusar proposta (motivo).'],
  ['reservation.read', 'MEDIUM', 'Ler reservas e quadro de reservas.'], ['reservation.create', 'HIGH', 'Criar reserva atômica (expectedAvailabilityRevision + Idempotency-Key).'],
  ['reservation.extend', 'HIGH', 'Estender reserva (política/aprovação).'], ['reservation.release', 'HIGH', 'Liberar reserva (motivo).'], ['reservation.cancel', 'HIGH', 'Cancelar reserva (administrativo).'],
  ['closing.read', 'MEDIUM', 'Ler fechamento, checklist e prontidão.'], ['closing.manage', 'HIGH', 'Abrir fechamento e registrar documentos recebidos.'],
  ['closing.validate_documents', 'HIGH', 'Validar/recusar documentos e registrar confirmação manual.'], ['contract.generate', 'HIGH', 'Gerar contrato a partir de modelo aprovado (sem cláusulas inferidas).'],
  ['contract.issue', 'CRITICAL', 'Emitir versão imutável de contrato.'], ['signature.manage', 'HIGH', 'Enviar contrato ao provedor de assinatura.'],
  ['sale.complete', 'CRITICAL', 'Concluir venda (WON + lote SOLD, atômico).'], ['sale.cancel', 'CRITICAL', 'Cancelar/registrar perda de negócio.'],
  ['commercial_approval.request', 'MEDIUM', 'Pedir aprovação comercial (desconto, prazo, extensão).'], ['commercial_approval.decide', 'HIGH', 'Decidir aprovação comercial (separação de funções por política).']
].map(([key, riskLevel, description]) => Object.freeze({ key, riskLevel, description })));

const P = (method, path, permission, resource = null) => [`${method} ${path}`, { permission, resource }];
const DEALS_ROUTE_POLICIES = Object.freeze(Object.fromEntries([
  P('POST', '/api/v1/proposals', PERM.PROPOSAL_CREATE), P('GET', '/api/v1/proposals/:proposalId', PERM.PROPOSAL_READ), P('PATCH', '/api/v1/proposals/:proposalId/draft', PERM.PROPOSAL_UPDATE_DRAFT),
  P('POST', '/api/v1/proposals/:proposalId/submit', PERM.PROPOSAL_SUBMIT), P('POST', '/api/v1/proposals/:proposalId/review', PERM.PROPOSAL_REVIEW), P('POST', '/api/v1/proposals/:proposalId/counter', PERM.PROPOSAL_COUNTER),
  P('POST', '/api/v1/proposals/:proposalId/accept', PERM.PROPOSAL_ACCEPT), P('POST', '/api/v1/proposals/:proposalId/reject', PERM.PROPOSAL_REJECT), P('POST', '/api/v1/proposals/:proposalId/withdraw', PERM.PROPOSAL_WITHDRAW),
  P('POST', '/api/v1/proposals/:proposalId/approvals', PERM.APPROVAL_REQUEST), P('POST', '/api/v1/commercial-approvals/:approvalId/decide', PERM.APPROVAL_DECIDE),
  P('GET', '/api/v1/proposals/:proposalId/presentation', PERM.PROPOSAL_READ), P('POST', '/api/v1/proposals/:proposalId/lost', PERM.SALE_CANCEL),
  P('POST', '/api/v1/reservations', PERM.RESERVATION_CREATE), P('GET', '/api/v1/reservations/:reservationId', PERM.RESERVATION_READ), P('POST', '/api/v1/reservations/:reservationId/extend', PERM.RESERVATION_EXTEND),
  P('POST', '/api/v1/reservations/:reservationId/release', PERM.RESERVATION_RELEASE), P('POST', '/api/v1/reservations/:reservationId/cancel', PERM.RESERVATION_CANCEL),
  P('POST', '/api/v1/closing-cases', PERM.CLOSING_MANAGE), P('GET', '/api/v1/closing-cases/:closingId', PERM.CLOSING_READ),
  P('POST', '/api/v1/closing-cases/:closingId/checklist/:itemId/validate', PERM.CLOSING_MANAGE), P('POST', '/api/v1/closing-cases/:closingId/contracts', PERM.CONTRACT_GENERATE),
  P('POST', '/api/v1/contracts/:contractId/issue', PERM.CONTRACT_ISSUE), P('POST', '/api/v1/contracts/:contractId/signature', PERM.SIGNATURE_MANAGE),
  P('POST', '/api/v1/closing-cases/:closingId/complete', PERM.SALE_COMPLETE), P('POST', '/api/v1/closing-cases/:closingId/cancel', PERM.SALE_CANCEL)
]));

/** DealError → ApiError (stable code + status; details never contain PII) */
function toHttp(e) {
  if (e && e.dealError) return new AppError(e.status, e.code, e.message, e.details || null);
  return e;
}

/** principal for the deals service: effective permission keys in (organization, development) scope (IAM grants) */
function dealsPrincipal(ctx, organizationId, developmentId = null) {
  const pr = ctx.principal || {};
  const all = DEALS_PERMISSIONS.map(p => p.key);
  if (pr.type === 'SYSTEM') return { actorId: pr.actorId || 'admin', actorType: 'SYSTEM', organizationId, permissions: all };
  const granted = grantedKeys(pr, organizationId, developmentId);
  return { actorId: pr.actorId, actorType: 'USER', organizationId, permissions: all.filter(k => granted.has(k)) };
}
const orgOf = ctx => (ctx.access && ctx.access.organizationId) || (ctx.principal && (ctx.principal.memberships || []).filter(m => m.status === 'ACTIVE').length === 1 ? ctx.principal.memberships.find(m => m.status === 'ACTIVE').organizationId : null);

function registerDealsRoutes(router, { deals }) {
  const NONE = 'no-store';
  const wrap = fn => async ctx => {
    try {
      const org = orgOf(ctx);
      if (!org) throw E.badRequest('Organização ativa não resolvida (X-Organization-Id)', null);
      const body = ['POST', 'PATCH'].includes(ctx.req.method) ? (await ctx.readBody()) || {} : {};
      const key = ctx.req.headers['idempotency-key'];
      const out = await fn({ ...ctx, body: { ...body, ...(key ? { idempotencyKey: key } : {}) }, org, P: dev => dealsPrincipal(ctx, org, dev || body.developmentId || null) });
      return { status: out && out.__status ? out.__status : 200, body: { data: out, meta: { requestId: ctx.requestId } }, cache: NONE };
    } catch (e) { throw toHttp(e); }
  };
  const o = ctx => ({ requestId: ctx.requestId });
  const route = (method, path, fn) => router[method.toLowerCase()](path, wrap(fn), { write: method !== 'GET', idempotent: method !== 'GET' });
  route('POST', '/api/v1/proposals', async c => ({ ...(await deals.createProposal(c.P(), c.body, o(c))), __status: 201 }));
  route('GET', '/api/v1/proposals/:proposalId', c => deals.getProposal(c.P(), c.params.proposalId));
  route('PATCH', '/api/v1/proposals/:proposalId/draft', c => deals.updateDraft(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/submit', c => deals.submitProposal(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/review', c => deals.startReview(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/counter', c => deals.counterProposal(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/accept', c => deals.acceptProposal(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/reject', c => deals.rejectProposal(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/withdraw', c => deals.withdrawProposal(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/proposals/:proposalId/approvals', c => deals.requestApproval(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/commercial-approvals/:approvalId/decide', c => deals.decideApproval(c.P(), c.params.approvalId, c.body, o(c)));
  route('GET', '/api/v1/proposals/:proposalId/presentation', c => deals.getPresentationSnapshot(c.P(), c.params.proposalId));
  route('POST', '/api/v1/proposals/:proposalId/lost', c => deals.recordLost(c.P(), c.params.proposalId, c.body, o(c)));
  route('POST', '/api/v1/reservations', async c => ({ ...(await deals.createReservation(c.P(), c.body, o(c))), __status: 201 }));
  route('GET', '/api/v1/reservations/:reservationId', c => deals.getReservation(c.P(), c.params.reservationId));
  route('POST', '/api/v1/reservations/:reservationId/extend', c => deals.extendReservation(c.P(), c.params.reservationId, c.body, o(c)));
  route('POST', '/api/v1/reservations/:reservationId/release', c => deals.releaseReservation(c.P(), c.params.reservationId, c.body, o(c)));
  route('POST', '/api/v1/reservations/:reservationId/cancel', c => deals.cancelReservation(c.P(), c.params.reservationId, c.body, o(c)));
  route('POST', '/api/v1/closing-cases', async c => ({ ...(await deals.openClosingCase(c.P(), c.body, o(c))), __status: 201 }));
  route('GET', '/api/v1/closing-cases/:closingId', c => deals.getClosing(c.P(), c.params.closingId));
  route('POST', '/api/v1/closing-cases/:closingId/checklist/:itemId/validate', c => deals.updateChecklistItem(c.P(), c.params.closingId, c.params.itemId, c.body, o(c)));
  route('POST', '/api/v1/closing-cases/:closingId/contracts', async c => ({ ...(await deals.createContract(c.P(), c.params.closingId, c.body, o(c))), __status: 201 }));
  route('POST', '/api/v1/contracts/:contractId/issue', c => deals.issueContract(c.P(), c.params.contractId, c.body, o(c)));
  route('POST', '/api/v1/contracts/:contractId/signature', c => deals.sendForSignature(c.P(), c.params.contractId, c.body, o(c)));
  route('POST', '/api/v1/closing-cases/:closingId/complete', c => deals.completeSale(c.P(), c.params.closingId, c.body, o(c)));
  route('POST', '/api/v1/closing-cases/:closingId/cancel', c => deals.cancelClosing(c.P(), c.params.closingId, c.body, o(c)));
}

module.exports = { registerDealsRoutes, DEALS_ROUTE_POLICIES, DEALS_PERMISSIONS, dealsPrincipal, toHttp };
