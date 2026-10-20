# AUTHORIZATION_ARCHITECTURE — identidade, autenticação e autorização (tópico 30, frontend)

> Consolida o que o tópico 30 pede em IDENTITY_ACCESS_ARCHITECTURE, ROLE_AND_ASSIGNMENT_MODEL, AUTHORIZATION_POLICY, AUDIT_LOG_POLICY, AUTH_SESSION_SECURITY e AUTH_MIGRATION_REPORT (lado do frontend). O registro de permissões e as matrizes estão em `PERMISSION_REGISTRY.md` (gerado). O isolamento entre organizações está em `MULTI_TENANT_ARCHITECTURE.md`.

## 1. Princípio e limite

**O frontend nunca é a autoridade.** Permissões na interface reduzem erro operacional, mas não constituem barreira de segurança autoritativa para dados/writes críticos. O servidor revalida toda ação protegida:

```
autenticar → resolver organização → validar membership → autorizar (permission + scope) → regra de domínio → executar → auditar
```

No navegador, `App.authz` decide apenas **o que mostrar** (UX e negação antecipada). Esconder um botão não é segurança. Por padrão tudo é negado (deny by default): sem concessão explícita num escopo compatível, a resposta é DENY.

## 2. Módulos

| Arquivo | Global | Responsabilidade |
|---|---|---|
| `config/security/permissions.json` | `App.configs.security.permissions` | PermissionRegistry + matriz de risco (espelho do backend) |
| `config/security/roles.json` | `…roles` | Role templates (PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN) |
| `config/security/features.json` | `…features` | Matrizes Feature/Action/Route/Seção → permissão |
| `config/security/organizations.json` | `…organizations` | Organização-base, posse dos empreendimentos, TenantAccessPolicy |
| `src/security/organization.js` | `App.tenancy` | Organization, TenantContext, TenantResolver, leak detector, chaves de cache (tópico 31) |
| `src/security/permissions.js` | `App.permissions` | Índice e validação do registro, KEYS, risco, matrizes, doc gerada |
| `src/security/authorization.js` | `App.authz` | PrincipalContext, PolicyEvaluator, AuthorizationService, guards, view model, auditoria, providers |
| `src/presentation/securityView.js` | `App.securityView` | Chip de organização/papel, estado "acesso negado", banner de sessão, botões protegidos |
| `src/presentation/security.css` | — | Estilos (somente tokens de `styles.css`, alvo de toque ≥ 44 px) |

Ordem de carga: depois de `config/presentation.js`, antes de `utils/i18n`. Nada depende de módulo posterior no carregamento; `App.store`/`App.api` são lidos só no momento da chamada.

## 3. Modelo (contratos)

- **User / UserProfile / UserStatus** (`ACTIVE, INVITED, SUSPENDED, DISABLED, ARCHIVED`): vivem no backend. O frontend recebe só `principal { type, id, displayName, status, authenticationMethod }` — e-mail/telefone nunca são necessários na interface.
- **AuthenticatedPrincipal**: `principal` + `session { status, expiresAt }` + `assuranceLevel` (preparado para MFA). `PRINCIPAL_TYPE`: `ANONYMOUS, USER, SERVICE, SYSTEM`.
- **AuthSession** (`SESSION_STATUS`: `NONE, ACTIVE, EXPIRED, REVOKED, INVALID`): mantida pelo servidor em cookie HttpOnly/SameSite. O SPA **não armazena token** (nem em localStorage, nem em memória persistente); a requisição a `/me` usa `credentials: 'include'` e não envia `Authorization`.
- **PrincipalContext** (imutável): `{ source, principal, session, tenant (TenantContext), memberships, roles, roleAssignments, grants[{key, organizationId, developmentId|null}], policyVersion, etag, loadedAt, expiresAt, warnings }`.
- **Role / RolePermissionGrant / RoleAssignment / ResourceScope**: templates em `roles.json`; atribuições e escopos reais vêm do servidor (`roleAssignments[{role, organizationId, developmentId}]`). Escopos usados: `ORGANIZATION` e `DEVELOPMENT` (sem granularidade de lote). Só concessões ALLOW (sem DENY explícito — precedência simples).
- **AuthorizationRequest**: `{ permission, resource{ organizationId?, developmentId?, identity.developmentId? }, context{ domainCapability, connectivity, reasonProvided, now, stepUpForCritical } }`.
- **AuthorizationDecision**: `{ effect (ALLOW|DENY|REQUIRES_STEP_UP|REQUIRES_APPROVAL), allowed, permissionKey, reason, reasons, message, matchedGrants, obligations, policyVersion, organizationId, developmentId, evaluatedAt, authoritative:false }`.
- **Obrigações**: `writeAuditEvent` (HIGH/CRITICAL), `requireReason`, `revalidateResourceState` (writes online), `maskSensitiveFields` (dados de cliente).

## 4. PolicyEvaluator (ordem de avaliação)

1. Permissão desconhecida → `UNKNOWN_PERMISSION`.
2. Sem contexto → `NO_CONTEXT`.
3. Usuário não ACTIVE → `PRINCIPAL_INACTIVE`; sessão revogada/inválida → `SESSION_REVOKED`.
4. Sessão expirada → só o que o visitante poderia fazer; o resto → `SESSION_EXPIRED` (não destrói rascunhos locais).
5. Permissão de plataforma (`platform.cross_tenant`) → só principal SYSTEM (`PLATFORM_ONLY`).
6. Organização do recurso: resolvida pelo recurso, nunca escolhida pelo cliente. Conflito de ids → `TENANT_MISMATCH`; sem dono → `TENANT_UNRESOLVED`.
7. Visitante: permissão precisa ser `anonymousAllowed` (`AUTH_REQUIRED` ≈ 401) e o empreendimento PUBLIC (`NOT_PUBLIC`). Usuário: organização ativa = organização do recurso (`CROSS_TENANT`) e membership ACTIVE (`NO_MEMBERSHIP`).
8. Organização DISABLED/ARCHIVED → `ORG_DISABLED`; SUSPENDED → leitura sim, escrita `ORG_SUSPENDED`.
9. Concessão com chave e escopo compatíveis → senão `NO_GRANT` (≈ 403) ou `OUT_OF_SCOPE`.
10. Capacidade de domínio falsa (tópico 29) → `DOMAIN_CAPABILITY_FALSE`. **Ação final = autorização do usuário E capacidade de domínio E estado atual do recurso** (`App.authz.finalAction(cap, decision)`).
11. `onlineRequired` com conexão ≠ ONLINE (inclui UNKNOWN) → `OFFLINE`. Leitura continua offline.
12. Contexto de acesso vencido (TTL 5 min, ETag) → HIGH/CRITICAL negadas com `CONTEXT_STALE` até revalidar.
13. CRITICAL com `stepUpForCritical` e `assuranceLevel < 2` → `REQUIRES_STEP_UP` (gancho para MFA futuro).

Nenhuma política é string executável: condições são ids registrados (`RESOURCE_IN_SCOPE`, `USER_ACTIVE`, `TENANT_MEMBERSHIP_ACTIVE`, `REASON_REQUIRED`, `DOMAIN_CAPABILITY_TRUE`, `ONLINE_REQUIRED`, `ASSURANCE_LEVEL_AT_LEAST`). Sem `eval`.

## 5. De onde vem o contexto

| Fonte | Quando | Concessões |
|---|---|---|
| `STATIC_PUBLIC` | sem backend (`dataSource.useBackendData=false`, situação atual) | PUBLIC_VISITOR nos empreendimentos PUBLIC (viva-juara) |
| `SERVER` | `GET {apiBaseUrl}/me` | o que o servidor declarar, ∩ registro; chaves desconhecidas descartadas; chave de sistema descartada para USER |
| `DEV` | `DevIdentityProvider`, somente com `App.buildEnv` = `development`/`test` | template de role escolhido no teste |

### Contrato `GET /api/v1/me` (definido com o backend)

```
200 { authenticated, principal{type,id,displayName,status,authenticationMethod},
      organizationId, organization{id,slug,displayName,status,developments:[{id,slug,name,visibility}]},
      memberships[{organizationId,slug,displayName,status}], roles[], roleAssignments[{role,organizationId,developmentId}],
      permissions[] (escopo organização), developmentPermissions{devId:[keys]}, policyVersion,
      identityProvider{status,mode}, session?{status,expiresAt} }
ETag → If-None-Match (304 mantém o contexto e renova o TTL)
X-Organization-Id → seletor técnico da organização ativa (o servidor valida a membership; desconhecida → 404)
401 → sessão inválida/expirada → volta ao visitante + SecurityEvent SESSION_EXPIRED
```

Anônimo: `authenticated:false`, `organizationId:null`, `permissions` = conjunto PUBLIC_VISITOR (o frontend ainda intersecta com `anonymousAllowed`).

**Nunca concedem permissão:** localStorage, sessionStorage, URL/hash, estado do store, atributos do DOM. O teste `security.test.js` envenena todos eles e verifica que nada muda, e verifica por varredura que os módulos de segurança não leem essas fontes.

## 6. Modos de interface ≠ roles

`broker`, `client`, `technical` e o modo apresentação são **modos de UI** (o que e quanto mostrar), não papéis. Relação:

| Modo | Funcionalidade exigida | Observação |
|---|---|---|
| Corretor (`broker`) | `mode.broker` → `lot.view` | padrão |
| Cliente (`client`) | `mode.client` → `lot.view` | esconde campos técnicos (`presentationConfig.hiddenFields`) |
| Técnico (`technical`) | `mode.technical` → `lot.analysis.view` | hoje público: os dados já estão no arquivo estático; esconder não protegeria (decisão humana se isso muda) |
| Apresentação | `mode.presentation` → `lot.view` | tela limpa para o cliente |

Escolher um modo nunca amplia permissões; uma permissão negada nunca é concedida por um modo. Se uma role futura não tiver `lot.analysis.view`, o modo técnico some (`App.authz.uiMode('technical')`).

## 7. Funcionalidades existentes → permissões

| Funcionalidade atual | Permissão | Visitante (hoje) |
|---|---|---|
| Mapa, Quick View, detalhes, busca, filtros, legenda | `lot.view` | sim |
| Preço de tabela, R$/m² | `lot.price.view` | sim |
| Histórico de preço de tabela (tópico 28) | `lot.price_history.view` | sim |
| Status comercial | `lot.availability.view` | sim |
| Scores, recomendação, explicações, sol, modo técnico | `lot.analysis.view` | sim |
| Comparação | `lot.compare` | sim |
| Simulação | `lot.simulate` + `lot.price.view` | sim |
| Compartilhar (link/WhatsApp/cópia) | `share.create` | sim (link sem PII; o nome digitado só entra no texto que o próprio usuário envia) |
| Perfil de cliente (nome, preferências, lotes) | `customer_profile.manage` | sim, **somente no aparelho** |
| Atualizar dados / apagar cópia local | `development.view` / controle local | sim |
| Alterar disponibilidade (`PATCH /lots/{id}/availability`) | `availability.write` (HIGH, online, motivo) | **não** |
| Publicar tabela | `price_table.publish` (CRITICAL) | **não** |
| Preview de análise no backend | `analysis.preview` (HIGH) | **não** |
| Trilha de auditoria | `admin.audit.view` | **não** |
| Exportações | não existem hoje (não há chave; criar no backend antes de construir) | — |

## 8. Guards para a interface

```js
App.authz.can('lot.price.view', lot)                       // boolean
App.authz.guard('availability.write', lot, { domainCapability: caps.canReserve, reasonProvided: !!motivo })
                                                           // { allowed, effect, reason, message, obligations, decision }
App.authz.feature('availability.edit', lot)                // { visible, enabled, deny:'hide'|'disable', message, ariaLabel }
App.authz.action(dataAct, element.dataset, lot)            // ActionGuard para data-act; ação sem contrato → negada
App.authz.route('compare') / App.authz.section('commercial', lot) / App.authz.uiMode('technical')
App.authz.viewModel()                                      // AccessControlViewModel
App.authz.subscribe(fn)                                    // contexto mudou (login, logout, troca de organização)
App.securityView.contextChip(vm) / deniedState(g) / sessionBanner(vm) / attrs(f) / button(f, {...})
```

Ocultar quando a opção não é relevante ao papel (ex.: publicar tabela) — não vaza a existência da função. Desabilitar com explicação quando o usuário precisa entender (ex.: alterar disponibilidade offline): controle continua focável (`aria-disabled`, sem `disabled`), com `aria-label` = mensagem ("Alterar disponibilidade exige permissão e conexão com o servidor.").

## 9. Auditoria e eventos de segurança

- **AuditEvent** `{ id, actorUserId, actorPrincipalType, action, permissionKey, resourceType, resourceId, organizationId (obrigatório), developmentId, timestamp, outcome (SUCCESS|DENIED|FAILED|CANCELLED), reasonCode, requestId, correlationId, beforeRef, afterRef, versionRefs, policyVersion, metadata, redactedFields, authoritative:false }`.
- Referências, nunca dados: chaves como `name, customerName, email, phone, cpf, token, password, authorization, cookie` são removidas recursivamente e listadas em `redactedFields`.
- No frontend o log é **diagnóstico** (memória, 200 eventos, não persistido). A trilha autoritativa e append-only é do backend. Consulta local só da organização ativa.
- **SecurityEvent**: `LOGIN_SUCCESS, LOGIN_FAILURE, SESSION_EXPIRED, SESSION_REVOKED, AUTHZ_DENIED (HIGH/CRITICAL), MFA_REQUIRED, SUSPICIOUS_ACCESS, ROLE_CHANGED, USER_SUSPENDED, TENANT_SWITCHED, TENANT_LEAK_BLOCKED, CONTEXT_REJECTED, DEV_AUTH_BLOCKED`. Audit log ≠ analytics de produto (`App.analytics` não recebe nada disso).

## 10. Sessão, offline e ambiente

- Expiração da sessão: ações protegidas negadas, leitura pública continua, rascunhos locais preservados; reautenticar antes de enviar.
- Offline: leitura em cache permitida; toda permissão `onlineRequired` negada (conexão `UNKNOWN` também conta como não-online).
- `DevIdentityProvider` lança erro (e registra `DEV_AUTH_BLOCKED`) quando `App.buildEnv` não é explicitamente `development`/`test`. O build publicado não define `App.buildEnv` → produção → bloqueado (fail closed).
- `ServerSessionProvider.login()` devolve `IDP_PENDING_DECISION`: não existe login falso.

## 11. RoleAssignmentPolicy

`App.authz.canAssign({ targetUserId, roleCode, organizationId, developmentId })`: nega autoatribuição (`SELF_ESCALATION`), nega role com qualquer permissão que o atribuidor não tenha no mesmo escopo (`PRIVILEGE_ESCALATION`) e, como o registro do backend ainda não tem permissão de gestão de atribuições, falha fechado (`ASSIGNMENT_MANAGE_NOT_REGISTERED`).

## 12. Inventário legado (migração do app sem login)

- Não havia usuário, login nem role no frontend. A única credencial é `ADMIN_API_TOKEN` do backend (Bearer do operador, nunca no frontend).
- `localStorage` guarda só preferências e sessão de UI (`ws:{dev}:state`: filtros, favoritos, clientes locais, viewport, modo). Nunca foi e não passa a ser fonte de status, preço, identidade ou permissão.
- "Cliente" no painel é um perfil local do corretor (nome digitado + preferências + lotes). Não é usuário e não é autenticação.
- Modos broker/client/technical/presentation continuam modos de UI.
