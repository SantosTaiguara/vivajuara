# Multi-tenancy (tópico 31)

Status: implementado no backend (migração 008, API 1.3.0). Modelo: **banco e schema compartilhados + `organization_id`** em toda tabela de dados de cliente. RLS planejado, **não habilitado** (§6).

## 1. Organização de referência

| Campo | Valor |
|---|---|
| id | `org_house7` (fixo, usado pelo frontend e pelos testes) |
| slug | `house-7` |
| nome | House 7 Imóveis |
| `legacy_tenant_key` | `house7` (valor antigo de `developments.tenant_id` / `tenantId` da config compartilhada) |
| `settings.defaultDevelopmentVisibility` | `PUBLIC` |
| empreendimento | `viva-juara` (`visibility = PUBLIC`) |

O backfill só usa o mapa explícito (`tenant_id` nulo ou `house7` → `org_house7`). Se sobrar algum empreendimento com `tenant_id` desconhecido, a migração **aborta** (sem fusão automática).

## 2. Matriz de propriedade (ownership)

| Tabela | Dono | Como `organization_id` é garantido |
|---|---|---|
| `organizations`, `organization_domains` | — (raiz) | — |
| `developments` | organização | coluna NOT NULL; trigger `plat_development_defaults` resolve a organização pelo `tenant_id` legado (falha fechada) e a visibilidade pelo default da organização |
| `lots`, `blocks`, `static_versions`, `sources`, `assets`, `analysis_versions`, `analysis_input_versions`, `price_tables`, `lot_availability`, `availability_history`, `import_runs` | organização do empreendimento | NOT NULL + FK composta `(organization_id, development_id) → developments(organization_id, id)` + trigger BEFORE INSERT que copia do empreendimento |
| `lot_analysis`, `lot_analysis_inputs`, `lot_prices`, `payment_plans` | herdado via FK do pai (`analysis_versions` / `price_tables`) | consultas sempre filtradas pelo pai |
| `audit_log` | organização (nullable para eventos de plataforma) | trigger preenche pelo empreendimento |
| `users` | global (pessoa) | acesso só via `organization_memberships` |
| `organization_memberships`, `role_assignments`, `auth_tokens` | organização / usuário | FKs compostas |
| `roles` | sistema | `role_type = SYSTEM` ⇔ `organization_id IS NULL` |
| `idempotency_keys`, `schema_migrations` | plataforma | chave por principal |

Slug do empreendimento: **único por organização** (`UNIQUE (organization_id, slug)`); o único global foi removido.

## 3. Resolução de tenant e isolamento

- O dono de um recurso vem **do banco** (empreendimento ou lote da rota), nunca do cliente (`tenancy.repository.js`).
- `X-Organization-Id` é só um **seletor** para rotas de organização (`/me`, `/admin/audit-events`). Ele é validado contra as memberships ativas: formato inválido → 400; sem membership → 404 `ORGANIZATION_NOT_FOUND`. O seletor nunca amplia o acesso a um recurso.
- Acesso a recurso de outra organização (ou privado e invisível) → **404 idêntico ao inexistente** (`DEVELOPMENT_NOT_FOUND` / `LOT_NOT_FOUND`). Não há vazamento de existência.
- Listagens (`GET /developments`, `POST /lots/batch-summary`) filtram por item. Ids invisíveis aparecem em `meta.notFound`, como os inexistentes.
- Empreendimento `PRIVATE` → `Cache-Control: private, no-store` e `Vary: Authorization, X-Organization-Id`.
- O `TenantContext` é por requisição (retornado), nunca global.

## 4. Compatibilidade

- `viva-juara` é `PUBLIC`: leitores anônimos recebem exatamente os mesmos dados da 1.2. Isso é testado comparando o JSON antes/depois e com principais anônimo, de outra organização e de plataforma.
- `DevelopmentDto` ganhou `organizationId` e `visibility` (aditivo).
- O código de inserção existente (importador) não mudou: os triggers preenchem `organization_id`.

## 5. Testes

`tests/tenancy.test.js`: uma segunda organização `org_test_b` com empreendimento `PRIVATE` `dev-b` (mesmo slug `viva-juara`) e o lote `TB-QA-L0001`. Cobre:

- backfill completo;
- 404 cruzado em leitura e escrita;
- listagem filtrada;
- batch-summary;
- FK composta;
- slug por organização;
- `tenant_id` desconhecido falhando fechado;
- seletor `X-Organization-Id`;
- usuário com duas memberships.

## 6. Plano de RLS (não habilitado)

Defesa em profundidade para a fase seguinte:

1. Role de aplicação sem `BYPASSRLS`.
2. `SET LOCAL app.organization_ids = '{...}'` por transação, a partir do `TenantContext`.
3. `ENABLE ROW LEVEL SECURITY` + política `USING (organization_id = ANY (current_setting('app.organization_ids')::text[]) OR <empreendimento PUBLIC>)` nas tabelas da §2.
4. Role separada para migrações e importação.
5. Testes rodando com a role restrita.

Não foi habilitado agora porque exige mudar o pool (contexto por transação) e as consultas públicas de empreendimento `PUBLIC`. O isolamento atual é garantido na aplicação + FKs compostas.

## 7. Pendências

- Cadastro de organizações via API (hoje: `npm run iam -- create-org`).
- Domínios por organização: `organization_domains` existe, mas a resolução por host não está ligada.
- Branding por organização: há colunas, mas não são usadas.
- Decisão humana: manter `viva-juara` `PUBLIC` (hoje é necessário para o painel estático).
