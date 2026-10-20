# MULTI_TENANT_ARCHITECTURE — organizações e isolamento (tópico 31, frontend)

> Consolida, do lado do frontend, TENANT_DATA_OWNERSHIP_MATRIX, TENANT_CONTEXT_RESOLUTION, TENANT_CACHE_ISOLATION, TENANT_FILE_STORAGE_ISOLATION, TENANT_API_CONTRACTS, CROSS_TENANT_SECURITY_POLICY, SINGLE_TO_MULTI_TENANT_MIGRATION_REPORT e MULTI_TENANT_ISOLATION_TEST_MATRIX. Banco (organization_id NOT NULL, índices, RLS) é do backend.

## 1. Princípio

Uma plataforma, várias organizações isoladas. **Organização ≠ empreendimento.** Acesso = principal autenticado E membership na organização E escopo E permissão E regra de domínio. Organização que não pode ser resolvida com segurança → DENY. Acesso entre organizações → DENY (exceção só para principal SYSTEM com `platform.cross_tenant`, que mesmo assim não vira concessão de dados da organização).

## 2. Organização-base (migração single → multi-tenant)

| Campo | Valor |
|---|---|
| `id` | `org_house7` (seed fixo do backend; tratado como opaco) |
| `slug` | `house-7` (navegação; **nunca** fronteira de segurança) |
| `displayName` | House 7 Imóveis |
| `kind` | AGENCY (imobiliária que opera o empreendimento) |
| `legalName`, `planCode`, branding | não informados (null) |
| settings | pt-BR, America/Sao_Paulo, BRL |
| empreendimento | `viva-juara` → `org_house7`, visibilidade PUBLIC |

`App.config.TENANT.id = 'house7'` (legado) é mapeado para `org_house7` por `legacyTenantIds`. Se o registro e o `App.config` discordarem sobre o dono de um empreendimento, `organizationOfDevelopment` devolve null (fail closed). Lotes não precisaram de backfill no frontend: cada lote carrega `identity.developmentId`, e a organização é derivada sem ambiguidade (498/498 lotes → `org_house7`, verificado em teste com o leak detector em modo estrito). Os ids de lote não mudam.

## 3. Matriz de posse dos dados (`App.tenancy.OWNERSHIP_MATRIX`)

| Classe | Entidades |
|---|---|
| GLOBAL | PermissionRegistry, RoleTemplate, templates de metodologia de score, LayerRegistry, catálogo de reason codes |
| TENANT_OWNED | Organization, OrganizationSettings, OrganizationBranding, OrganizationMembership, RoleAssignment, CustomerProfile, Share, AuditEvent, AnalyticsEvent, Development |
| DEVELOPMENT_OWNED | DevelopmentConfig, Lot, PriceTable, PriceTableVersion, AvailabilitySnapshot, AnalysisSnapshot, Document, Asset |
| DERIVED | ComparisonSession, FitResult, RecommendationResult, FinancialSimulation, RankingTrace (escopo = organização + empreendimento das entradas) |
| PUBLIC | PublicShareProjection, PublicDevelopmentView (projeções explícitas) |

## 4. TenantContext e TenantResolver

`TenantContext` (imutável): `{ organizationId, organizationSlug, membershipId, activeDevelopmentId, principalId, resolvedBy, resolvedAt, accessPolicyRevision, readOnly, metadata }`. `resolvedBy`: `ROUTE, SUBDOMAIN, CUSTOM_DOMAIN, USER_SELECTION, SERVER_SESSION, SYSTEM_JOB, SERVICE_PRINCIPAL, PUBLIC_DEVELOPMENT`.

`App.tenancy.resolveTenant({ candidate, memberships, principalType, activeDevelopmentId })`:
- sem candidato → `TENANT_UNRESOLVED` (**não existe fallback para a primeira organização**); exceção: visitante anônimo de um empreendimento PUBLIC — a organização é derivada do recurso, não escolhida;
- formato inválido → `TENANT_INVALID`; inexistente → `TENANT_NOT_FOUND`;
- DISABLED/ARCHIVED → `ORG_DISABLED`; SUSPENDED → contexto `readOnly` (TenantAccessPolicy `suspendedTenantBehavior: READ_ONLY`);
- empreendimento ativo de outra organização → `TENANT_MISMATCH`;
- usuário sem membership ACTIVE → `NO_MEMBERSHIP` (role sem membership não dá acesso).

No navegador, a organização ativa é **seleção de UX**; quem decide é o servidor (`X-Organization-Id` é só seletor técnico, validado contra memberships).

## 5. Resolução da organização de um recurso

`App.tenancy.resolveOrganizationId(r)` aceita `{ organizationId }`, `{ developmentId }` ou um Lot canônico (`identity.developmentId`). Dois ids informados e inconsistentes (`organizationId` ≠ dono do `developmentId`) → conflito → `TENANT_MISMATCH`. Um id de lote sozinho nunca prova posse. Conhecer o id de outra organização nunca basta (teste `CrossTenantDirectIdDenied`).

## 6. Troca de organização

`await App.authz.switchOrganization(orgId, { initialState })`:
1. exige membership ACTIVE no contexto atual;
2. chama `/me` com `X-Organization-Id` (o servidor revalida);
3. só com sucesso devolve `statePatch` = reset de `App.tenancy.TENANT_SENSITIVE_STATE` (developmentId, lote atual, comparação, cliente, clientes, favoritos, filtros, preferências, exigências, simulação, viewport…); preferências globais de UI (tema, layout) ficam;
4. emite `TENANT_SWITCHED`. A UI aplica o patch e mostra estado de carregamento antes de qualquer dado novo (nada da organização anterior fica na tela).

## 7. Caches, IndexedDB, localStorage, arquivos

- `App.tenancy.scopedKey(orgOrCtx, ...partes)` → `org:{orgId}:...`; lança erro sem organização. `org:org_house7:lot:L0327` ≠ `org:org_imobx:lot:L0327`.
- `storageKey(org, dev)` → `ws:org:{org}:dev:{dev}:state`. A chave legada `ws:{dev}:state` (sem organização) deve ser migrada pelo store (ver integração) — hoje só contém preferências de UI e perfis locais do aparelho.
- IndexedDB (`data/offline.js`) e Service Worker cacheiam hoje apenas JSON públicos do empreendimento PUBLIC. Ao ligar o backend autenticado, respostas tenant-sensitive devem usar `scopedKey` e não podem ser reaproveitadas entre organizações; logout limpa o cache sensível.
- Arquivos/assets: caminho `organizations/{orgId}/developments/{devId}/…` no storage; caminho não é segurança — URL assinada só após autorização (backend).

## 8. Repositórios tenant-aware

`App.tenancy.scopeRepository(repo, tenantContext, { strict })` embrulha os métodos de leitura (`getLotById`, `getLotsByIds`, `lotsSync`, `getLots`, `searchLots`, …): sem contexto → erro; linhas de outra organização são descartadas (produção) ou lançam `TENANT_LEAK` (modo estrito, dev/teste). `assertSameTenant(ctx, recurso, { strict })` é o leak detector.

## 9. Compartilhamento

O link atual é `shareUrl#token` com ids de lote e estado de UI — sem PII e sem organização como token. Link externo futuro: registro `Share { organizationId, createdBy, scope, snapshotRefs, tokenHash, expiresAt, revokedAt }` com token opaco no servidor; o link público expõe só a projeção explícita, nunca a organização inteira.

## 10. Feature flags, entitlement, permissão

`DevelopmentConfig.features` são flags de produto (por empreendimento). Flag ≠ permissão ≠ plano. Acesso final a uma função = flag ligada E organização com direito E usuário autorizado; a UI deve checar a flag e `App.authz.feature(...)`.

## 11. Contrato de API (com o backend)

- Rotas atuais `/api/v1/developments/{id}/…`: o servidor deriva a organização pelo empreendimento e valida o principal. Dados de empreendimento ganham `organizationId` e `visibility`.
- Organização inexistente/de outro tenant → 404 (não revela existência); 401 não autenticado; 403 `PERMISSION_DENIED` autenticado sem permissão.

## 12. Matriz de testes de isolamento (frontend, `tests/security.test.js`)

| Cenário | Coberto |
|---|---|
| SingleTenantMigration (498 lotes → org_house7) | sim |
| TwoOrganizationsSamePlatform / CrossTenantDirectIdDenied | sim |
| UserMultipleMemberships / OrganizationSwitch (estado limpo, prefs mantidas) | sim |
| Membership revogada / role sem membership | sim |
| Organização SUSPENDED (só leitura) / DISABLED | sim |
| Ids inconsistentes (org + empreendimento) | sim |
| Colisão de cache entre organizações | sim |
| Repositório sem contexto / linha de outra organização | sim |
| Auditoria só da própria organização | sim |
| PlatformAdminExplicitCrossTenant (OWNER_ADMIN ≠ superadmin) | sim |
| RLS, pool de conexões, jobs, webhooks, busca, export, rate limit | backend |
