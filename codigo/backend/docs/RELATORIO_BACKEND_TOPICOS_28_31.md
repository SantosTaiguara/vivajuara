# Relatório — backend, tópicos 28 a 31 (API 1.3.0)

Data: 2026-10-08. Escopo: `plat/backend/**` e `plat/tests/backend/**`. Nenhum arquivo do frontend (`plat/src`) foi alterado.

## 1. Invariantes preservadas

- IDs dos 498 lotes, geometria, scores, metodologia e preços não mudaram. A tabela única é a `lancamento-2026-10`, R$ 1.196/m², 2026-10-06.
- A disponibilidade dos 498 lotes segue `UNKNOWN`. UNKNOWN nunca é contado como AVAILABLE nem como FRESH.
- null ≠ 0: variação sem base comparável é `null` com motivo, e lacuna de preço não é zero.
- Nenhum texto de "valorização", "rentabilidade" ou "retorno". O histórico fala em "preço de tabela" e suas `caveats` negam explicitamente esses sentidos.
- APIs públicas compatíveis. O `viva-juara` é `PUBLIC` e os anônimos recebem os mesmos dados. A única mudança aditiva é `DevelopmentDto.organizationId` e `visibility`.
- `ADMIN_API_TOKEN` continua funcionando, como credencial de plataforma (SYSTEM).

## 2. Migrações

| Migração | Conteúdo | Down |
|---|---|---|
| `008_organizations_tenancy.sql` | ver abaixo | `down/008_organizations_tenancy.down.sql` |
| `009_iam.sql` | ver abaixo | `down/009_iam.down.sql` |

**008 — organizações e tenancy:**

- tabelas `organizations` (seed `org_house7` / `house-7` / House 7 Imóveis, `legacy_tenant_key = house7`) e `organization_domains`;
- `developments.organization_id` e `visibility`, com backfill pelo mapa explícito (aborta se houver tenant desconhecido);
- slug único por organização;
- trigger de defaults;
- `organization_id` NOT NULL + FK composta + índice + trigger em 11 tabelas do empreendimento.

**009 — IAM:**

- `users` (sem PII), `organization_memberships`, `roles` (8 modelos), `role_assignments` (FKs compostas), `auth_tokens` (só sha256);
- `audit_log` + `organization_id`, `actor_type`, `permission_key`, `outcome`, com trigger append-only.

## 3. Endpoints novos

| Rota | Permissão | Tópico |
|---|---|---|
| `GET /api/v1/me` | pública (contexto do principal) | 30 |
| `GET /api/v1/iam/registry` | pública | 30 |
| `GET /api/v1/admin/audit-events` | `admin.audit.view` (própria organização) | 30/31 |
| `GET /api/v1/developments/{id}/lots/{lotId}/price-history` | `lot.price_history.view` | 28 |
| `GET /api/v1/developments/{id}/pricing/history` | `lot.price_history.view` | 28 |
| `GET /api/v1/developments/{id}/availability/manifest` | `lot.availability.view` | 29 |

Todas as rotas existentes ganharam política em `routePolicies.js`: negação por padrão, e o servidor não sobe com rota sem política.

Erros novos:

- `PERMISSION_DENIED` 403;
- `TENANT_CONTEXT_REQUIRED` 400;
- `ORGANIZATION_NOT_FOUND` 404.

A semântica 401 × 403 × 404 está em `API_ERRORS.md`. `openapi.json` foi regenerado (34 paths) e o changelog 1.3.0 foi registrado.

## 4. Permissões e roles

São 15 chaves:

- `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`;
- `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage`;
- `analysis.preview`, `availability.write`, `price_table.publish`, `admin.audit.view`;
- `platform.cross_tenant`.

Roles:

- OWNER_ADMIN
- COMMERCIAL_MANAGER
- PRICING_MANAGER
- INVENTORY_MANAGER
- BROKER
- MARKETING
- ANALYST
- VIEWER

A matriz completa está em `IAM_ARCHITECTURE.md` §4.

## 5. Testes

Arquivos novos em `backend/tests/`:

| Arquivo | Testes puros (sem banco) | Testes com banco |
|---|---|---|
| `iam.test.js` | 10 | 10 |
| `tenancy.test.js` | — | 9 |
| `priceHistory.test.js` | 8 | 4 |
| `availabilityIndependence.test.js` | 2 | 4 |

Ajustes em testes existentes:

- `tests/backend/api.v1.endpoints.test.js`: o DTO agora traz `organizationId` e `visibility`.
- `tests/backend/migrations.test.js`: lista de tabelas novas.

**Situação de verificação:**

- O PostgreSQL local exige senha SCRAM para o usuário `postgres`, e essa senha não está disponível neste ambiente. A alteração da autenticação foi negada e não foi contornada.
- Suíte completa: 175 testes. **34 passam**: os 14 que já passavam sem banco + os 20 novos testes puros. 114 falham e 27 são cancelados, **todos** com `PostgreSQL not reachable`.
- Ficaram **não verificados**:
  - os 27 testes novos com banco;
  - toda a suíte de integração anterior;
  - `npm run migrate:check`;
  - a sintaxe SQL das migrações 008/009 contra um PostgreSQL real.
- Verificado:
  - `node --check` em todos os arquivos;
  - `npm run openapi:check` ("up to date");
  - `api.openapi.test.js` (5/5);
  - smoke test do app com pool falso: o servidor sobe com a matriz de rotas completa, e `/me` (anônimo, sistema, 401) e `/iam/registry` respondem e passam na validação de schema de resposta.

Para verificar, rode `npm test` e `npm run migrate:check` com um PostgreSQL 16 acessível (`TEST_DATABASE_ADMIN_URL`, `DATABASE_URL`).

## 6. Pendências e lacunas

- **Tópico 27 ausente.** O histórico reaproveita o modelo de versões da migração 005.
- Não implementados no histórico: CAGR, inflação, série promocional, `asOfKnowledgeDate` e preços de transação.
- **RLS não habilitado.** O plano está em `MULTI_TENANCY.md` §6; o isolamento hoje é na aplicação + FKs compostas.
- Sem API HTTP de gestão de usuários e roles; há só a CLI `npm run iam`, para dev/test. Sem roles customizadas.
- O snapshot de disponibilidade existente ainda expõe `notes` e `proposalId` publicamente (contrato 1.2 mantido). Avaliar se deve virar dado privado.
- Resolução de organização por domínio (`organization_domains`) e branding por organização ainda não estão ligados.

## 7. Decisões humanas necessárias

1. **Provedor de identidade** (OIDC gerenciado × Keycloak × link mágico). Até lá só há tokens de dev, recusados em produção.
2. **Revisão da matriz role × permissão** (modelos iniciais).
3. **Visibilidade `PUBLIC` do viva-juara.** Hoje é necessária para o painel estático. Tornar `PRIVATE` exigiria login no painel.
4. **Ferramentas de cliente públicas.** `customer_profile.manage` e `share.create` estão concedidas a qualquer visitante, porque rodam no cliente sobre dados públicos e sem PII no servidor. Confirmar.
5. **Permissão de override para reabrir lote `SOLD`.** Não foi criada; a máquina de estados atual se mantém.
6. Política de frescor da disponibilidade. Hoje `freshnessPolicy` é nula: o dado confirmado é FRESH sem limite de tempo.

## 8. Frontend (para os workers de `plat/src`)

- `/me` é a fonte de verdade do `AccessControlViewModel`. O contrato está em `IAM_ARCHITECTURE.md` §7, e as chaves de permissão já foram adotadas literalmente pelo security-fe.
- `DevelopmentDto` tem `organizationId` (`org_house7`) e `visibility` (`PUBLIC`).
- Nenhuma mudança obrigatória no painel estático: leituras anônimas inalteradas.
