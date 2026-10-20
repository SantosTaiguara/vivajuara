# Arquitetura de identidade e autorização (tópico 30)

Status: implementado no backend (API 1.4.0). Provedor de identidade: **Google (OIDC)**, decidido na W3 (ver §8 e `AUTH_GOOGLE_OIDC.md`).

## 1. Princípios

- **Negar por padrão.** Toda rota registrada precisa de uma política em `src/modules/iam/routePolicies.js` ou ser marcada explicitamente `{ public: true }` (apenas `/me` e `/iam/registry`). O servidor **não sobe** se faltar política (`createApp` valida no boot).
- **O backend decide.** O frontend usa `/me` só para esconder/desabilitar botões; isso não é segurança.
- **Autorização por permissão, nunca por código de role.** Roles são modelos que agrupam permissões; o código só consulta chaves de permissão.
- **PII mínima.** `users` guarda apenas `display_name`, status e `external_identity_id` (futuro IdP). Sem e-mail, telefone, CPF ou senha. A auditoria guarda só o id do usuário.
- **Tokens nunca em claro.** Somente `sha256(token)` é gravado (`auth_tokens.token_hash`); tokens não são logados nem devolvidos depois de emitidos.

## 2. Modelo de dados (migração 009)

| Tabela | Função |
|---|---|
| `users` | Identidade interna (uuid). Status `ACTIVE/INVITED/SUSPENDED/DISABLED/ARCHIVED`. |
| `organization_memberships` | Usuário × organização, status `INVITED/ACTIVE/SUSPENDED/REVOKED/ARCHIVED`, único por par. |
| `roles` | Modelos de role do sistema (código PK). |
| `role_assignments` | Role do usuário na organização inteira (`development_id` nulo) ou num empreendimento. FK composta (organização, usuário) → membership e (organização, empreendimento) → developments: impossível atribuir role em empreendimento de outra organização. |
| `auth_tokens` | Tokens de desenvolvimento/teste: hash hex64, `expires_at` obrigatório, `revoked_at`, `last_used_at`. |
| `audit_log` (estendida) | `organization_id`, `actor_type`, `permission_key`, `outcome` (`SUCCESS/DENIED/FAILED/CANCELLED`). **Append-only**: trigger rejeita UPDATE/DELETE. |

## 3. Registro de permissões (PermissionRegistry)

Fonte única: `src/modules/iam/permissions.js` (`POLICY_VERSION = iam-2026-10-08.1`), publicada em `GET /api/v1/iam/registry`. Chaves no formato `recurso.ação` separado por ponto.

- `publicRead`: vale para **qualquer** principal (inclusive anônimo), mas **somente** em empreendimentos `PUBLIC`.
- `systemOnly`: nunca concedida a role de organização (só o principal de plataforma).
- Ações HIGH/CRITICAL são auditadas no sucesso (pelo próprio serviço de escrita) e na negação (`AUTHZ_DENIED`, `outcome = DENIED`).
- `enforcedBy = FRONTEND`: ferramentas que rodam no cliente sobre dados públicos (comparar, simular, compartilhar, perfil de cliente). O backend não tem rota para elas; a chave existe para a UI ter uma fonte única.

## 4. Matriz role × permissão (modelos do sistema — revisão humana pendente)

| Permissão | Risco | Pública | OWNER_ADMIN | COMMERCIAL_MANAGER | PRICING_MANAGER | INVENTORY_MANAGER | BROKER | MARKETING | ANALYST | VIEWER |
|---|---|---|---|---|---|---|---|---|---|---|
| `development.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.price.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.price_history.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.availability.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.analysis.view` | LOW | sim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lot.compare` | LOW | sim | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | — |
| `lot.simulate` | LOW | sim | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | — |
| `share.create` | LOW | sim | ✓ | ✓ | — | — | ✓ | ✓ | — | — |
| `customer_profile.manage` | MEDIUM | sim | ✓ | ✓ | — | — | ✓ | — | — | — |
| `analysis.preview` | HIGH | não | ✓ | — | ✓ | — | — | — | ✓ | — |
| `availability.write` | HIGH | não | ✓ | ✓ | — | ✓ | — | — | — | — |
| `price_table.publish` | CRITICAL | não | ✓ | — | ✓ | — | — | — | — | — |
| `admin.audit.view` | HIGH | não | ✓ | ✓ | — | — | — | — | — | — |
| `platform.cross_tenant` | CRITICAL | só plataforma | — | — | — | — | — | — | — | — |

Observações: o principal de plataforma (`ADMIN_API_TOKEN`) tem todas as permissões, inclusive entre organizações. Como as permissões públicas valem para qualquer visitante em empreendimento `PUBLIC`, um ✓ em linha pública só faz diferença em empreendimentos `PRIVATE`.

## 5. Autenticação (AuthenticationService)

`src/modules/iam/authentication.js`, com dois adaptadores:

1. **SystemCredentialProvider**: `ADMIN_API_TOKEN` (e o legado `WRITE_API_KEY`) → principal `SYSTEM`, ator `admin`. A comparação continua em tempo constante sobre sha256, **sem mudança em relação à 1.2**.
2. **DevTokenProvider** (`AUTH_DEV_TOKENS=true`, **recusado em produção** pelo carregamento de config): tokens opacos `plat_dev_` + 43 caracteres base64url (256 bits), emitidos por `npm run iam -- create-user ...`. A busca é feita pelo hash; token expirado, revogado ou usuário não `ACTIVE` → 401.

Sem cabeçalho `Authorization` → principal `ANONYMOUS`. Se nenhum provedor estiver configurado, um bearer em leitura é ignorado (comportamento idêntico à 1.2).

CLI (somente dev/test):

```
npm run iam -- create-org  --id org_exemplo --slug exemplo --name "Organização Exemplo"
npm run iam -- create-user --org org_house7 --name "Corretor 1" --role BROKER --role PRICING_MANAGER@viva-juara --ttl-days 30
npm run iam -- issue-token --user <uuid>
npm run iam -- revoke-token --token plat_dev_...
```

O token é exibido **uma vez**.

## 6. Pipeline de autorização por requisição

```
escritas habilitadas? (403 WRITES_DISABLED, como na 1.2)
→ authenticate (401 em credencial inválida)
→ rota de escrita/admin sem credencial → 401
→ checkRoute(permissão): o principal tem a permissão em algum escopo? (anônimo → 401; senão → 403 PERMISSION_DENIED)
→ guard: carrega dono do recurso do banco (empreendimento ou lote da rota) e decide:
     invisível (outra organização / privado sem development.view) → 404 igual ao inexistente
     visível sem a permissão → 403 PERMISSION_DENIED (auditado se HIGH/CRITICAL)
→ handler (listagens filtram item a item com a mesma decisão)
```

`decide(ctx, permissionKey, resource)` (`authorization.js`) é **pura**: sem I/O, com saída `{ effect, reasons, matchedAssignments, notFound, obligations, policyVersion, evaluatedAt }`. Ação final = capacidade de domínio **E** autorização (`finalAction`).

Semântica 401 × 403 × 404: ver `docs/API_ERRORS.md` §"401 × 403 × 404".

## 7. Contrato `GET /api/v1/me` (fonte de verdade para o frontend)

Resposta `MeResponse` (cache `private, no-store`, `Vary: Authorization, X-Organization-Id`):

| Campo | Significado |
|---|---|
| `authenticated` | `false` para anônimo. |
| `principal` | `{ type: ANONYMOUS/USER/SYSTEM, id, displayName, status, authenticationMethod }`. |
| `organizationId`, `organization` | Organização ativa: `X-Organization-Id` validado contra as memberships, ou membership única. `organization.developments` lista `{ id, slug, name, visibility }`. |
| `organizationSelectionRequired` | `true` quando há mais de uma membership ativa e nenhum cabeçalho. |
| `tenantResolvedBy` | `HEADER_SELECTOR`, `SINGLE_MEMBERSHIP` ou `null`. |
| `memberships` | Memberships ativas `{ organizationId, slug, displayName, status }`. |
| `roles`, `roleAssignments` | Resumo para a UI. A autorização usa só `permissions`. |
| `permissions` | Permissões efetivas na organização ativa. Anônimo ou sem organização: as públicas. Sistema: todas. |
| `publicPermissions` | Permissões de qualquer visitante em empreendimento `PUBLIC`. |
| `developmentPermissions` | `{ developmentId: [chaves extras] }` de roles com escopo de empreendimento. |
| `policyVersion` | Versão do registro. |
| `session.expiresAt` | Expiração do token (null para anônimo/sistema). |
| `identityProvider` | `{ status: 'CONFIGURED', mode: 'GOOGLE_OIDC' }` com login Google ligado; senão `{ status: 'NOT_CONFIGURED', mode: 'DEV_TOKEN' / 'NONE' }`. |

O id da organização de referência é fixo: `org_house7` (slug `house-7`).

## 8. Provedor de identidade: Google (decidido na W3)

O D-IDP foi decidido: o login é com Google (OIDC, Authorization Code + PKCE), e a API mantém uma sessão opaca por cookie. Os pontos de encaixe previstos foram usados assim:

- `users.external_identity_id = 'google:' + sha256(sub)`;
- `authentication.js` recebe um adaptador de sessão (`modules/auth`) que devolve o mesmo `PrincipalContext`. O bearer continua com precedência;
- `/me.identityProvider` reporta `CONFIGURED`/`GOOGLE_OIDC`.

Os papéis só vêm por convite (`organization_invitations`, CLI `npm run iam -- invite`), e não há autoprovisionamento. Os tokens de dev continuam servindo só para desenvolvimento e teste. Em produção, as credenciais aceitas são a sessão Google e o `ADMIN_API_TOKEN` (principal de plataforma). Fluxo, configuração e segurança estão em `AUTH_GOOGLE_OIDC.md`; o passo a passo do Google Cloud Console está em `GUIA_GOOGLE_CLOUD_OAUTH.md`.

## 9. Fora do escopo (pendente)

- API HTTP de gestão de usuários e roles (hoje só via CLI).
- Roles customizadas por organização: a tabela já aceita `role_type = CUSTOM`, mas não há fluxo.
- MFA (delegado ao Google) e rate limit por usuário.
- Permissão de override para reabrir lote vendido: decisão humana.
