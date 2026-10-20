# Segurança de ações de alto risco

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Política (config/security/highRiskActions.json, `evaluateHighRisk(code, ctx)`)
Ações: `PRICING_PUBLISH`, `PRICING_ACTIVATE`, `AVAILABILITY_OVERRIDE`, `USER_ROLE_CHANGE`, `ORG_SETTINGS_CHANGE`, `SHARE_BULK_EXPORT`, `SECRET_ROTATION`, `DOCUMENT_RESTRICTED_DOWNLOAD`, `PROVENANCE_CONFLICT_RESOLVE`.

Para cada ação, o JSON define:
- permissões exigidas
- força de autenticação mínima (`AUTH_STRENGTH`: SESSION < RECENT_LOGIN < MFA)
- motivo obrigatório
- aprovação dupla (quem pede ≠ quem aprova)
- idempotência
- evento de segurança

O resultado é ALLOW, DENY ou STEP_UP_REQUIRED, com motivos.

## Fail closed
- Permissões que ainda não existem no PermissionRegistry negam (`customer.export`, `analytics.export`, `document.download`, `customer.sensitive.read`, `assignment.manage`, `organization.settings.manage`, `share.revoke`, `secret.rotate`). Elas continuam negadas até a decisão **D50-5** registrá-las no frontend **e** no backend.
- Ação desconhecida → DENY. Contexto sem organização → DENY.
- O frontend só esconde ou desabilita. A decisão final é sempre do servidor (`localStorage` nunca autoriza).

## Regras de negócio preservadas
- Publicar/ativar preço não altera a tabela vigente (R$ 1.196/m², tabela 2026-10-06) sem o fluxo completo.
- `AVAILABILITY_OVERRIDE` exige proveniência. Os 498 lotes seguem UNKNOWN até haver confirmação.
