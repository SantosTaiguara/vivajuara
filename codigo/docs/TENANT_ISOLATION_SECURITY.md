# Isolamento multi-tenant

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Base: tópico 31 (`App.tenancy`, `backend/src/modules/tenancy`). Reforços deste tópico:

- **Tenant do navegador é seletor, nunca autoridade**: `X-Organization-Id` só escolhe entre memberships já validadas no servidor; `localStorage`/URL não concedem nada.
- **Repositórios**: toda leitura de dado tenant-owned recebe o contexto (`getCustomer(tenantContext, id)`), nunca `getCustomer(id)`.
- **Banco**: linhas tenant-owned com `organization_id NOT NULL`; únicos `UNIQUE(organization_id, …)`; FKs que não cruzam tenants quando possível.
- **RLS do Postgres**: recomendada como defesa em profundidade (não é a única barreira); se adotada, `SET LOCAL app.org_id` **por transação** (`pool.withTransaction`)
  para o contexto nunca vazar entre conexões do pool. Não ativada (decisão D50-7; não mexer em auth do Postgres neste ambiente).
- **PLATFORM_ADMIN ≠ TENANT_OWNER**: `platform.cross_tenant` é `systemOnly` e nunca entra em role de tenant (validado no registro).
- **Troca de tenant**: `App.authz.switchOrganization` → patch que zera o estado sensível (`TENANT_SENSITIVE_STATE`) antes de renderizar o novo tenant.
- **Busca**: não pode revelar existência em outro tenant (mensagens de negação não confirmam existência: `REASONS` do authz).

Testes: `security.test.js` (cross-tenant, troca, chaves por tenant), `backend/tests/tenancy.test.js` (precisa de Postgres; não roda aqui) e o cenário
`SecurityTenantCrossAccessDenied` em `security50.test.js`.
