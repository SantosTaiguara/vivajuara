# Relatório — Tópicos 30 (usuários, permissões, autorização) e 31 (multi-tenant) — frontend

Data: 2026-10-08. Backend (roles/permissões/organizações no Postgres, guards de API, `GET /api/v1/me`) foi implementado em paralelo pelo worker de backend; este relatório cobre o painel. Arquitetura: `AUTHORIZATION_ARCHITECTURE.md`, `PERMISSION_REGISTRY.md` (gerado do config), `MULTI_TENANT_ARCHITECTURE.md`.

> **Limitação explícita (critério 429):** enquanto o painel for estático, permissões na interface reduzem erro operacional, mas não constituem barreira de segurança autoritativa para dados/writes críticos. A fronteira de segurança é o backend.

## O que foi implementado

**Arquivos criados**
- `config/security/permissions.json` — PermissionRegistry + matriz de risco (15 chaves, espelho exato do registro do backend; policyVersion `iam-2026-10-08.1`).
- `config/security/roles.json` — 9 role templates (PUBLIC_VISITOR … OWNER_ADMIN).
- `config/security/features.json` — Feature (23), Action (todos os `data-act` do painel), Route e Seção → permissão.
- `config/security/organizations.json` — organização-base `org_house7` (House 7 Imóveis, AGENCY) dona de `viva-juara` (PUBLIC); TenantAccessPolicy; mapa do id legado `house7`.
- `src/security/organization.js` (`App.tenancy`), `src/security/permissions.js` (`App.permissions`), `src/security/authorization.js` (`App.authz`).
- `src/presentation/securityView.js` (`App.securityView`), `src/presentation/security.css`.
- `tests/security.test.js` — 34 testes.
- Docs: os três acima e este relatório.

**Arquivo alterado**: `scripts/configBundle.js` — `'security'` incluído na lista de subpastas de config (uma palavra).

**Tópico 30 — critérios técnicos atendidos no frontend**: User/UserStatus/UserProfile (contrato; dados no backend), IdentityProviderAdapter (`ServerSessionProvider`, `DevIdentityProvider`), AuthenticatedPrincipal, AuthSession (status/expiração), PrincipalContext, Role, Permission, PermissionRegistry, RolePermissionGrant (ALLOW-only), RoleAssignment (do `/me`), ResourceScope (ORGANIZATION/DEVELOPMENT), AuthorizationRequest/Decision, AuthorizationPolicy/PolicyEvaluator (ids de condição, sem eval), AuthorizationService, PermissionGuard (`can/guard`), RouteGuard (`route`), ActionGuard (`action`), AccessControlViewModel (`viewModel`), capacidade de domínio × permissão (`finalAction`), deny by default, escopo por empreendimento, permissões críticas mapeadas, AuditEvent/AuditLogService (diagnóstico, sem PII), SecurityEvent, nenhum role check em componente (teste estático), nenhuma autoridade em localStorage (teste com localStorage/hash/store envenenados), dev auth bloqueado em produção, write crítico offline bloqueado, mascaramento de cliente (`maskCustomer`, obrigação `maskSensitiveFields`), contrato `/me` pronto, RoleAssignmentPolicy sem escalonamento.

**Tópico 31 — no frontend**: Organization, OrganizationSettings e Branding (foundation no config), Membership (do `/me`), TenantContext, TenantResolver (sem fallback para a primeira organização), TenantAccessPolicy, organização derivável de Development/Lot/preço/disponibilidade/perfil, backfill dos 498 lotes verificado, troca de organização com limpeza de estado sensível, chaves de cache com organização, repositório tenant-scoped + leak detector (estrito em dev/teste, fail closed em produção), OWNER_ADMIN ≠ plataforma, links sem organização como token.

**Golden scenarios cobertos**: BrokerReadOnlyCommercial, BrokerCannotPublishPricing, PricingManagerPublishesVersion, InventoryManagerUpdatesAvailability, ViewerReadOnly, Marketing sem perfil de cliente, SuspendedUserDenied, WrongDevelopmentDenied, AvailabilityCapabilityAndPermission, CriticalActionAudit, OfflineCriticalWriteDenied, SingleTenantMigration, TwoOrganizationsSamePlatform, UserMultipleMemberships, OrganizationSwitch, CrossTenantDirectIdDenied, SuspendedOrganization, PlatformAdminExplicitCrossTenant.

**Regressão**: o contexto padrão (sem backend) é o visitante público, e todas as ações atuais do painel continuam permitidas nele (teste varre todos os `data-act` e o `switch` de `app.js`). Nenhum dado, preço, status, score ou cor do mapa mudou.

## O que ficou pendente e por quê

- **Login real**: depende da escolha do IdP (decisão humana). `login()` responde `IDP_PENDING_DECISION`; não há login falso.
- **Integração na UI** (arquivos do lead): chip, guards nos botões, migração da chave de localStorage — ver instruções de integração.
- **Permissões do catálogo do tópico 30 sem funcionalidade** (`pricing.import/validate/rollback`, `availability.reserve/release/markSold/override`, `customer.*` de servidor, `document.*`, `analytics.*`, `user.*`, `role.manage`, `assignment.manage`, exportações): não registradas — o tópico manda não implementar permissões sem uso e o backend é a fonte do registro. Ficam como próximos passos; `canAssign` falha fechado até existir `assignment.manage`.
- **Tópicos 26/27** não fornecidos: `price_table.publish` cobre publicar/ativar; separação import/validate/publish/activate (quatro olhos) depende do domínio de PriceTableVersion.
- **Auditoria autoritativa** e eventos de segurança persistidos: backend (o frontend só tem log diagnóstico em memória).
- **IndexedDB/Service Worker por organização**: hoje só guardam JSON públicos de um empreendimento PUBLIC; namespace com `scopedKey` quando houver respostas autenticadas.
- **Custom domain, white-label, billing/entitlement, impersonação**: só foundation (fora de escopo pelo próprio tópico).

## Decisões humanas necessárias

1. **Provedor de identidade** (Auth0, Clerk, Supabase, Entra, Google Workspace, OIDC próprio) e política de sessão (duração, MFA para CRITICAL).
2. **Roles reais e concessões por pessoa**: os templates são iniciais; quem da House 7 altera disponibilidade, quem publica tabela, se corretor vê histórico de preço.
3. **O painel continua público?** Hoje qualquer pessoa com o link é "visitante" com mapa, preços de tabela, simulação, comparação, modo técnico e perfil local. Confirmar se `viva-juara` segue PUBLIC e se o modo técnico deve sair do acesso público (os dados já estão no arquivo estático; escondê-lo não protege nada).
4. **Organizações**: confirmar que a House 7 (imobiliária) é a dona dos dados do Viva Juara ou se a loteadora será organização própria (compartilhamento de empreendimento exigiria modelo explícito).
5. **Política de organização suspensa** (somente leitura assumido) e prazo de validade do contexto de acesso (5 min assumido).
6. **Exportações e links externos com token/revogação**: criar chaves no backend antes de construir.
