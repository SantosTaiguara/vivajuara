'use strict';
/* Topic 59 — route table, route policies, permission keys and error codes of the privacy admin API.
   NOT wired yet: the integrator adds registerPrivacyRoutes (privacy.controller.js) to src/app.js, ROUTE_POLICIES to the
   route policy table, PERMISSIONS to modules/iam/permissions.js (granted to no role until the organization decides),
   PRIVACY_ERRORS to shared/http/errors.js ERROR_CATALOG and addPrivacyPaths (privacy.openapi.js) to scripts/lib/openapiDoc.js. */
const BASE = '/api/v1/admin/privacy';
// [method, path (router syntax), summary, permission]
const ROUTES = Object.freeze([
  ['get', `${BASE}/registry`, 'Pacote de conformidade: maturidade, bloqueadores, registros (atividades, fornecedores, transferências). Não é parecer jurídico.', 'privacy.registry.view'],
  ['get', `${BASE}/metrics`, 'Métricas: solicitações abertas, vencidas e sem prazo configurado', 'privacy.registry.view'],
  ['get', `${BASE}/audit`, 'Trilha de auditoria de privacidade (códigos e ids, sem dado pessoal)', 'privacy.registry.view'],
  ['get', `${BASE}/requests`, 'Solicitações do titular (filtro status)', 'privacy.request.manage'],
  ['post', `${BASE}/requests`, 'Registrar solicitação do titular (prazo calculado só se a regra estiver validada; senão NOT_CONFIGURED)', 'privacy.request.manage'],
  ['get', `${BASE}/requests/:id`, 'Solicitação do titular', 'privacy.request.manage'],
  ['post', `${BASE}/requests/:id/verification`, 'Iniciar verificação de identidade proporcional ao risco', 'privacy.request.manage'],
  ['post', `${BASE}/requests/:id/verification/complete`, 'Concluir verificação de identidade (VERIFIED | FAILED)', 'privacy.request.manage'],
  ['post', `${BASE}/requests/:id/transition`, 'Mudar status (expectedRevision; recusa exige motivo do registro)', 'privacy.request.manage'],
  ['get', `${BASE}/consents`, 'Consentimentos vigentes de um titular (subjectRef opaco)', 'privacy.consent.manage'],
  ['post', `${BASE}/consents`, 'Registrar consentimento (finalidade específica, versão e checksum do aviso)', 'privacy.consent.manage'],
  ['post', `${BASE}/consents/:id/withdraw`, 'Revogar consentimento (histórico preservado)', 'privacy.consent.manage'],
  ['post', `${BASE}/suppressions`, 'Supressão de contato (opt-out); só o hash é guardado', 'privacy.consent.manage'],
  ['post', `${BASE}/legal-holds`, 'Criar legal hold (motivo obrigatório)', 'privacy.legal_hold.manage'],
  ['post', `${BASE}/legal-holds/:id/release`, 'Liberar legal hold', 'privacy.legal_hold.manage'],
  ['post', `${BASE}/blocks`, 'Bloqueio de tratamento de um titular', 'privacy.request.manage'],
  ['get', `${BASE}/subjects/:subjectRef/state`, 'Estado operacional do titular (ACTIVE, BLOCKED, LEGAL_HOLD, DELETED…)', 'privacy.request.manage'],
  ['post', `${BASE}/retention/dry-run`, 'Simulação de retenção (nunca apaga; retenção null = REQUIRES_REVIEW)', 'privacy.retention.execute']
]);
const ROUTE_POLICIES = Object.freeze(Object.fromEntries(ROUTES.map(([m, p, , permission]) => [`${m.toUpperCase()} ${p}`, Object.freeze({ permission })])));
// For modules/iam/permissions.js: P(key, riskLevel, description). None is granted to a role here.
const PERMISSIONS = Object.freeze([
  ['privacy.registry.view', 'MEDIUM', 'Ver registros de privacidade, maturidade, métricas e auditoria (encarregado/admin).'],
  ['privacy.request.manage', 'HIGH', 'Registrar e conduzir solicitações do titular, verificação de identidade e bloqueios.'],
  ['privacy.consent.manage', 'HIGH', 'Registrar/revogar consentimento e supressões de contato.'],
  ['privacy.legal_hold.manage', 'CRITICAL', 'Criar e liberar legal hold.'],
  ['privacy.retention.execute', 'CRITICAL', 'Executar (simular) jobs de retenção e exclusão.']
]);
// Domain refusal codes travel in details.reason with an existing catalog code; these are the new top-level ones to add.
const PRIVACY_ERRORS = Object.freeze({
  PRIVACY_RULE_DENIED: { status: 422, description: 'Regra de privacidade recusou a operação (sem base legal validada, aviso/checksum, verificação de identidade, transição, motivo de recusa…); código do domínio em details.reason.' }
});
module.exports = { BASE, ROUTES, ROUTE_POLICIES, PERMISSIONS, PRIVACY_ERRORS };
