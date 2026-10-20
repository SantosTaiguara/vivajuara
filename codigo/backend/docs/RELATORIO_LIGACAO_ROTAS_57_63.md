# Relatório — ligação das rotas dos tópicos 57, 58, 59, 60, 61 e 63 no servidor

Data: 2026-10-18. Escopo: somente `plat/backend` (mais a adição de dois nomes em `plat/config/security/secretsCatalog.json`). Isto não é parecer jurídico.

## 1. Decisão registrada

- **2026-10-18, Edmilson (dono), repassada pelo coordenador:** o papel `OWNER_ADMIN` recebe **todas** as permissões da rodada 5 quando o servidor for ligado. **Nenhum outro papel recebe nenhuma.**
- As regras comerciais estão **em espera**: todos os valores de política que eram `null` (regras comerciais, prazos de reserva, definição de WON, retenção, bases legais, limites de aprovação, SLOs…) **continuam `null`**. Cada módulo continua recusando a ação que depende deles (`POLICY_NOT_CONFIGURED`, `ADMIN_COMMAND_REJECTED`, `PRIVACY_RULE_DENIED`, "não configurado").
- O registro da decisão está no código: `src/modules/iam/round5.js` → `ROUND5_ROLE_DECISION` e `permissions.js` → `TEMPLATE_EXPLICIT_HOLDERS` (só `OWNER_ADMIN`). `validateRegistry()` falha se qualquer outro papel tiver uma chave da rodada 5 no template.

## 2. Permissões

- 77 chaves (`proposal.*`, `reservation.*`, `closing.*`, `contract.*`, `signature.*`, `sale.*`, `commercial_approval.*`, `development_onboarding.*`, `privacy.*`, `customer.export_bulk`, `backoffice.*`, `data_quality.*`, `data_governance.*`, `development.location_environment.*`, `development.location.validate`) registradas em `permissions.js` com `explicitGrantOnly: true` e `feature: FEATURE_*`. Risco e descrição vêm do espelho `config/security/permissions.json` (um teste garante que as listas são iguais).
- `OWNER_ADMIN` = conjunto anterior **inalterado** + as 77 chaves (por decisão, não pela regra genérica "todas as chaves"). Os outros 7 papéis estão **byte-idênticos** ao código anterior (snapshot `tests/fixtures/iamRoleSnapshot.pre_r5.json`, gerado antes de qualquer alteração).
- `KEYS`, `PUBLIC_VISITOR`, permissões efetivas do principal `SYSTEM` e `GET /api/v1/iam/registry` não mudam com todas as flags desligadas. `GET /me` e `/iam/registry` só listam uma chave da rodada 5 quando o módulo dela está ligado.
- **Credencial de plataforma (`ADMIN_API_TOKEN`, principal `SYSTEM`) → 403 nas rotas da rodada 5**: ela não tem papel, e a decisão só nomeou `OWNER_ADMIN`. Para operar, use uma sessão de usuário com `OWNER_ADMIN`. (Decisão em aberto, se quiserem mudar.)
- Concessões explícitas a outros papéis (futuras): arquivo `config/iam/role-grants.json` (entregue vazio), lido na inicialização (inválido = servidor não sobe), por organização, com `decisionRef` obrigatório.

## 3. Flags de módulo (todas DESLIGADAS por padrão)

| Flag (env) | Módulo | Rotas | Permissão de rota |
|---|---|---|---|
| `FEATURE_DEALS` | 57 propostas, reservas, fechamento | 26 | chave própria de cada rota (`DEALS_ROUTE_POLICIES`) |
| `FEATURE_ONBOARDING` | 58 onboarding de empreendimento | 20 | `development_onboarding.*` |
| `FEATURE_PRIVACY` | 59 privacidade | 18 | `privacy.*` |
| `FEATURE_BACKOFFICE` | 60 backoffice | 6 | `backoffice.access` (o serviço ainda checa a chave de cada ação) |
| `FEATURE_DATA_QUALITY` | 61 qualidade de dados | 14 | `data_quality.*` |
| `FEATURE_SURROUNDINGS` | 63 Entorno (Google Maps) | 3 | `development.location_environment.read` |

- Desligada: nada do módulo é carregado, registrado ou agendado. Rotas e `docs/openapi.json` (paths, components, info, tags) **idênticos** ao anterior (teste com hash do contrato anterior). A única diferença no `openapi.json` é a extensão `x-error-catalog`, que ganhou os códigos novos marcados com `x-feature-flag` (o teste existente exige `x-error-catalog` = `ERROR_CATALOG`).
- Ligada: rotas existem atrás do pipeline normal (escrita habilitada → autenticação → permissão da rota → handler). Anônimo → 401; outros papéis → 403 `PERMISSION_DENIED`; `ADMIN_API_TOKEN` → 403; `OWNER_ADMIN` passa o portão e cai nas regras do módulo.
- Composição: `src/featureModules.js` (novo). Onboarding, privacidade e qualidade recebem `{ actorId, organizationId, permissions }` derivado do principal IAM (organização = `X-Organization-Id` validado contra as memberships, ou a única membership; permissões = chaves concedidas daquele módulo). Os erros simples desses adaptadores viram `ApiError` 4xx catalogados (antes virariam 500).
- Job de expiração de reservas/propostas (`deals.runExpiry`): registrado **só com `FEATURE_DEALS=1`**, relógio do servidor, uma varredura por organização ACTIVE/TRIAL, sem sobreposição, a cada `DEALS_EXPIRY_INTERVAL_MS` (padrão 60000; `0` = não agenda). Falha é registrada no log, nunca derruba o processo.

## 4. Contratos

- `ERROR_CATALOG`: +59 códigos (deals 41 novos, `PRIVACY_RULE_DENIED`, `CONFLICT` do onboarding, `ADMIN_COMMAND_REJECTED`, 15 do Entorno), cada um com `feature`. Códigos já existentes reaproveitados com o mesmo status. `docs/API_ERRORS.md` ganhou a seção "Módulos da rodada 5". O enum de `ApiError.code` no `openapi.json` continua o anterior; o enum completo fica no documento de features.
- `npm run openapi` gera `docs/openapi.json` (todas as flags desligadas) **e** `docs/openapi.features.json` (122 paths: base + 87 operações da rodada 5, cada uma com `x-feature-flag` e `x-disabled-by-default: true`). `npm run openapi:check` confere os dois. `docs/openapi.deals.json` segue gerado pelo próprio módulo.
- `secretsCatalog.json`: nomes `GOOGLE_MAPS_API_KEY` e `GOOGLE_MAPS_BROWSER_KEY` (sem valores). `.env.example`: flags, intervalo do job e os dois nomes, comentados.

## 5. Como ligar um módulo (passos humanos)

1. Banco: `npm run migrate` aplica 011–016 (não foi possível rodar aqui: sem senha do Postgres).
2. Ambiente: `FEATURE_DEALS=1` (ou a flag do módulo) e reiniciar o servidor.
3. Acesso: a pessoa precisa do papel `OWNER_ADMIN` na organização, por convite: `npm run iam -- invite --email <e-mail> --org org_house7 --role OWNER_ADMIN` (próximo login Google).
4. Outro papel, só depois de nova decisão humana: `npm run iam -- grant --role COMMERCIAL_MANAGER --permission proposal.read --org org_house7 --decision "<quem decidiu, quando>" --confirm` e reiniciar. Sem `--confirm` a chave da rodada 5 é recusada; uma chave comum (do template) é recusada sempre; `OWNER_ADMIN` é recusado (já tem). `npm run iam -- list-grants`, `revoke-grant`, `role --role X`.
5. Entorno: também `GOOGLE_MAPS_API_KEY` no gerenciador de segredos (ausente → `GOOGLE_MAPS_NOT_CONFIGURED`) e a coordenada oficial validada.

## 6. Testes (sem banco)

- Novo `tests/round5Wiring.test.js` (7 testes): snapshot dos papéis; 77 chaves em sincronia com o espelho; matriz de decisão (OWNER_ADMIN permite, demais negam, concessões por organização); flags desligadas = rotas/OpenAPI/registry anteriores e nenhum job; flags ligadas = rotas iguais ao `openapi.features.json`, e em **todas as 87 rotas** anônimo 401, COMMERCIAL_MANAGER/BROKER/VIEWER 403, `ADMIN_API_TOKEN` 403, OWNER_ADMIN passa o portão sem 500 (cai em 503 `DATABASE_UNAVAILABLE` / validação, pois não há banco); job só com `FEATURE_DEALS`; `$ref` e códigos do documento de features válidos.
- Ajustados por causa da decisão: `tests/deals.test.js` (OWNER_ADMIN tem as 24 chaves de deals; outro papel nenhuma) e `tests/backoffice.test.js` (OWNER_ADMIN vê o console; outro papel IAM não).
- Resultados: round5Wiring 7/7, authGoogle 19/19, deals 23/23, onboarding 6/6, privacy 8/8, backoffice 11/11, dataquality 7/7, securityB2B3 8/8, iam (parte pura) 10/10, `tests/backend/api.openapi.test.js` 5/5, `openapi:check` ok. surroundings 22/23: a falha (`center` deixou de ser `null`) vem de `src/config/surroundings/surroundings.config.js`, alterado hoje 14:50 por outro agente (frontend), não por esta ligação.
- Suítes com Postgres (`iam` parte 2, `tenancy`, `admin.auth`, `api.errors`…) **não rodam aqui** (sem senha; a autenticação do Postgres não foi tocada).

## 7. Pendências / decisões em aberto

- `ADMIN_API_TOKEN` negado nas rotas da rodada 5 (ver §2).
- Deals: porta de clientes do servidor não existe ainda (criar proposta → `CUSTOMER_NOT_FOUND`); preço vem da tabela publicada corrente (`lot_prices.metadata.commercial.price`), `null` quando ausente; assinatura eletrônica sem provedor.
- Backoffice: `previewKey` nulo → prévias recusadas (`PREVIEW_UNAVAILABLE`) até decidir a chave dedicada; step-up/MFA inexistente.
- Onboarding: sem antivírus/extrator/ativador configurados (fontes ficam `NOT_CONFIGURED`).
- Todas as políticas nulas listadas nos relatórios 57–63 seguem nulas (regras comerciais em espera por decisão do dono).
- Backup das tabelas 011–016 (lacuna do tópico 62).
