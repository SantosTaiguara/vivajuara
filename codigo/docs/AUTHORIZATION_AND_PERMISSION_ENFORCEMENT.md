# Autorização e aplicação de permissões

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Regra formal (§4): Principal autenticado + Tenant + Membership + Permission + Resource scope + Domain capability ⇒ ALLOW/DENY.
Decisões possíveis: `ALLOW · DENY · REQUIRES_STEP_UP · REQUIRES_APPROVAL` (`App.authz.EFFECT`, `App.securityHardening.DECISION`).

## Onde é aplicada
- **Backend (autoridade)**: `app.js` recusa subir se uma rota não tem política (`routePolicies.js`) nem é `public`; `tenancy.checkRoute` + `tenancy.guard`
  antes de ler corpo/parâmetros; HIGH/CRITICAL auditados (sucesso e negação).
- **Frontend (UX)**: `App.authz.guard/feature/action/route` sobre o `PermissionRegistry` (`config/security/permissions.json`); ação de UI sem contrato em
  `features.json` é negada (`UNMAPPED_ACTION`). Sem `if (role === 'ADMIN')` espalhado: sempre `authorize(principal, permission, resource)`.
- Authorization ≠ Domain Capability: `finalAction(domainCapability, decision)` exige as duas.

## Permissões propostas (D50-5, não registradas)
`customer.export`, `analytics.export`, `document.download`, `customer.sensitive.read`, `assignment.manage`, `organization.settings.manage`, `share.revoke`,
`secret.rotate` — listadas em `highRiskActions.json.proposedPermissions`. Enquanto não existirem no registro do frontend **e** do backend,
`evaluateHighRisk` responde `PERMISSION_NOT_REGISTERED` (fail closed). Registrar exige aprovação humana e atualização dos dois registros + PERMISSION_REGISTRY.md.

## Testes
`security.test.js` (tópicos 30/31: registro, deny by default, escopo, cross-tenant, sessão expirada/revogada, step-up) e `security50.test.js`
(cross-tenant, masking, high-risk, localStorage nunca autoriza).
