'use strict';
/* OpenAPI 3.0 fragment of the topic 57 routes (docs/openapi.deals.json). Kept apart from docs/openapi.json on purpose:
   the main contract must list exactly the routes registered in src/app.js (tests/backend/api.openapi.test.js) and these
   routes are not wired yet. When the coordinator wires registerDealsRoutes, merge `paths` into scripts/lib/openapiDoc.js.
   Usage: node src/modules/deals/deals.openapi.js [--check] */
const fs = require('fs');
const path = require('path');
const { ERRORS } = require('./deals.domain');
const { DEALS_ROUTE_POLICIES } = require('./deals.controller');

const FILE = path.resolve(__dirname, '..', '..', '..', 'docs', 'openapi.deals.json');
const SUMMARY = {
  'POST /api/v1/proposals': ['Cria proposta em rascunho (cliente cadastrado + lote; preço de tabela vigente como referência)', 201, ['CUSTOMER_NOT_FOUND', 'LOT_NOT_FOUND', 'COMMERCIAL_AUTHORITY_NOT_CONFIGURED', 'COMMERCIAL_AUTHORITY_EXTERNAL']],
  'GET /api/v1/proposals/:proposalId': ['Proposta + versões imutáveis + negociação + diffs + aviso de preço atual diferente', 200, ['PROPOSAL_NOT_FOUND']],
  'PATCH /api/v1/proposals/:proposalId/draft': ['Edita o rascunho (expectedRevision)', 200, ['PROPOSAL_NOT_FOUND', 'REVISION_CONFLICT', 'PROPOSAL_VERSION_IMMUTABLE']],
  'POST /api/v1/proposals/:proposalId/submit': ['Valida e emite a versão (pricing + availability snapshot refs, checksum). Idempotency-Key obrigatório', 200, ['PROPOSAL_INVALID', 'COMMERCIAL_APPROVAL_REQUIRED', 'PROPOSAL_CONCURRENCY_CONFLICT', 'POLICY_NOT_CONFIGURED', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'REVISION_CONFLICT', 'INVALID_PROPOSAL_TRANSITION']],
  'POST /api/v1/proposals/:proposalId/review': ['Coloca em análise', 200, ['PROPOSAL_EXPIRED', 'INVALID_PROPOSAL_TRANSITION', 'REVISION_CONFLICT']],
  'POST /api/v1/proposals/:proposalId/counter': ['Contraproposta = nova versão emitida; anterior SUPERSEDED (nunca editada)', 200, ['PROPOSAL_VERSION_CONFLICT', 'PROPOSAL_EXPIRED', 'PROPOSAL_INVALID', 'COMMERCIAL_APPROVAL_REQUIRED', 'REVISION_CONFLICT']],
  'POST /api/v1/proposals/:proposalId/accept': ['Registra aceite da versão exata (método + evidências). Não reserva o lote. Idempotency-Key obrigatório', 200, ['PROPOSAL_NOT_ACCEPTABLE', 'PROPOSAL_VERSION_CONFLICT', 'PROPOSAL_EXPIRED', 'COMMERCIAL_APPROVAL_REQUIRED', 'LOT_NOT_AVAILABLE', 'IDEMPOTENCY_KEY_REQUIRED']],
  'POST /api/v1/proposals/:proposalId/reject': ['Recusa com código de motivo', 200, ['REASON_CODE_REQUIRED', 'INVALID_PROPOSAL_TRANSITION']],
  'POST /api/v1/proposals/:proposalId/withdraw': ['Retirada com código de motivo (versões preservadas)', 200, ['REASON_CODE_REQUIRED', 'INVALID_PROPOSAL_TRANSITION']],
  'POST /api/v1/proposals/:proposalId/approvals': ['Pede aprovação comercial (termos exatos por checksum)', 200, ['POLICY_NOT_CONFIGURED', 'PROPOSAL_NOT_FOUND']],
  'POST /api/v1/commercial-approvals/:approvalId/decide': ['Decide aprovação (separação de funções por política)', 200, ['APPROVAL_SELF_DECISION_FORBIDDEN', 'POLICY_NOT_CONFIGURED', 'APPROVAL_NOT_FOUND', 'REVISION_CONFLICT']],
  'GET /api/v1/proposals/:proposalId/presentation': ['ProposalPresentationSnapshot client-safe (sem margem, limiar, nota interna)', 200, ['PROPOSAL_NOT_ACCEPTABLE']],
  'POST /api/v1/proposals/:proposalId/lost': ['Registra perda (LOST) antes do fechamento; libera reserva viva do mesmo cliente', 200, ['REASON_CODE_REQUIRED', 'INVALID_CLOSING_TRANSITION']],
  'POST /api/v1/reservations': ['Reserva atômica: lock → AVAILABLE + expectedAvailabilityRevision → Reservation ACTIVE + Availability RESERVED. Idempotency-Key obrigatório', 201, ['LOT_ALREADY_RESERVED', 'AVAILABILITY_REVISION_CONFLICT', 'LOT_AVAILABILITY_UNKNOWN', 'LOT_NOT_AVAILABLE', 'RESERVATION_EXPIRY_INVALID', 'POLICY_NOT_CONFIGURED', 'COMMERCIAL_AUTHORITY_NOT_CONFIGURED', 'COMMERCIAL_AUTHORITY_EXTERNAL', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED']],
  'GET /api/v1/reservations/:reservationId': ['Reserva + extensões + serverTime (contagem regressiva pelo relógio do servidor)', 200, ['RESERVATION_NOT_FOUND']],
  'POST /api/v1/reservations/:reservationId/extend': ['Extensão formal (política, aprovação, motivo)', 200, ['RESERVATION_EXTENSION_NOT_ALLOWED', 'RESERVATION_EXPIRED', 'COMMERCIAL_APPROVAL_REQUIRED', 'POLICY_NOT_CONFIGURED', 'REVISION_CONFLICT']],
  'POST /api/v1/reservations/:reservationId/release': ['Libera (motivo); lote volta a AVAILABLE', 200, ['REASON_CODE_REQUIRED', 'INVALID_RESERVATION_TRANSITION', 'REVISION_CONFLICT']],
  'POST /api/v1/reservations/:reservationId/cancel': ['Cancelamento administrativo (motivo)', 200, ['REASON_CODE_REQUIRED', 'INVALID_RESERVATION_TRANSITION']],
  'POST /api/v1/closing-cases': ['Abre fechamento a partir da proposta aceita; reserva → CONVERTED (lote segue RESERVED)', 201, ['CLOSING_REQUIREMENTS_INCOMPLETE', 'RESERVATION_EXPIRED', 'POLICY_NOT_CONFIGURED', 'IDEMPOTENCY_KEY_REQUIRED']],
  'GET /api/v1/closing-cases/:closingId': ['Fechamento + checklist + contratos + prontidão', 200, ['CLOSING_NOT_FOUND']],
  'POST /api/v1/closing-cases/:closingId/checklist/:itemId/validate': ['Atualiza item do checklist (RECEIVED exige documentId; VALIDATED exige RECEIVED)', 200, ['CHECKLIST_ITEM_NOT_FOUND', 'CLOSING_REQUIREMENTS_INCOMPLETE', 'REVISION_CONFLICT']],
  'POST /api/v1/closing-cases/:closingId/contracts': ['Gera ContractRecord/Version de modelo aprovado (variáveis estruturadas, sem cláusula inferida)', 201, ['CONTRACT_TEMPLATE_NOT_APPROVED', 'CONTRACT_VARIABLES_UNRESOLVED', 'CONTRACT_NOT_READY']],
  'POST /api/v1/contracts/:contractId/issue': ['Emite a versão (imutável) quando a prontidão para assinatura é atendida', 200, ['CLOSING_REQUIREMENTS_INCOMPLETE', 'CONTRACT_VERSION_IMMUTABLE', 'CONTRACT_NOT_READY', 'POLICY_NOT_CONFIGURED']],
  'POST /api/v1/contracts/:contractId/signature': ['Envia ao provedor de assinatura (adapter)', 200, ['CONTRACT_NOT_READY', 'VALIDATION_ERROR']],
  'POST /api/v1/closing-cases/:closingId/complete': ['Conclui a venda: SaleOutcome WON + ClosingCase COMPLETED + Availability SOLD na mesma transação', 200, ['SALE_COMPLETION_REQUIREMENTS_NOT_MET', 'SALE_ALREADY_COMPLETED', 'AVAILABILITY_REVISION_CONFLICT', 'LOT_AVAILABILITY_UNKNOWN', 'POLICY_NOT_CONFIGURED', 'IDEMPOTENCY_KEY_REQUIRED']],
  'POST /api/v1/closing-cases/:closingId/cancel': ['Cancela/falha o fechamento; disponibilidade conforme ClosingCancellationPolicy', 200, ['REASON_CODE_REQUIRED', 'SALE_ALREADY_COMPLETED', 'POLICY_NOT_CONFIGURED']]
};

function build() {
  const paths = {};
  for (const [k, pol] of Object.entries(DEALS_ROUTE_POLICIES)) {
    const [method, tpl] = k.split(' '), p = tpl.replace(/:([A-Za-z]+)/g, '{$1}');
    const [summary, ok, codes] = SUMMARY[k];
    const params = [...tpl.matchAll(/:([A-Za-z]+)/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z]{2,8}_[A-Za-z0-9]{8,40}$' } }));
    if (method !== 'GET') params.push({ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' }, description: 'Obrigatório em submit, accept, reservations, closing-cases e complete.' });
    const responses = { [ok]: { description: 'OK', headers: { 'Cache-Control': { schema: { type: 'string', example: 'no-store' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/DealEnvelope' } } } } };
    const all = [...new Set(['VALIDATION_ERROR', 'PERMISSION_DENIED', ...codes])];
    for (const c of all) { const st = ERRORS[c].status; responses[st] = responses[st] || { description: '', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } }; responses[st].description = [responses[st].description, c].filter(Boolean).join(', '); }
    paths[p] = paths[p] || {};
    paths[p][method.toLowerCase()] = { tags: ['deals'], summary, 'x-permission': pol.permission, parameters: params, security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      ...(method !== 'GET' ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Comando (ver docs/COMMERCIAL_TRANSACTION_ARCHITECTURE.md); expectedRevision obrigatório em mutações de agregado existente.' } } } } } : {}), responses };
  }
  return { openapi: '3.0.3', info: { title: 'Plataforma — fragmento Tópico 57 (propostas, reservas, fechamento)', version: '57.1.0', description: 'Rotas ainda NÃO registradas em src/app.js (integração pendente). Códigos de erro estáveis em x-error-catalog.' },
    paths, components: { schemas: { DealEnvelope: { type: 'object', properties: { data: { type: 'object' }, meta: { type: 'object', properties: { requestId: { type: 'string' } } } } },
      ApiError: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } },
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Host-plat_session' }, bearerAuth: { type: 'http', scheme: 'bearer' } } },
    'x-error-catalog': Object.fromEntries(Object.entries(ERRORS).map(([c, e]) => [c, { status: e.status, description: e.message }])) };
}
const render = () => JSON.stringify(build(), null, 2) + '\n';
if (require.main === module) {
  const out = render();
  if (process.argv.includes('--check')) { const same = fs.existsSync(FILE) && fs.readFileSync(FILE, 'utf8') === out; process.stdout.write(same ? 'docs/openapi.deals.json is up to date\n' : 'docs/openapi.deals.json is OUT OF DATE\n'); process.exit(same ? 0 : 1); }
  fs.writeFileSync(FILE, out); process.stdout.write(`wrote docs/openapi.deals.json (${Object.keys(build().paths).length} paths)\n`);
}
module.exports = { build, render, FILE, SUMMARY };
