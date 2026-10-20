# Arquitetura do backend V2

Plataforma de Inteligência Comercial para Loteamentos — empreendimento de referência: **Viva Juara (498 lotes)**.
Tópico 9: introduzir um backend **sem reescrever o produto**. A regra é *substituir a fonte de dados sem substituir o produto*.

## 1. Decisão de stack

| Item | Escolha | Por quê |
|---|---|---|
| Runtime | **Node.js 22** (CommonJS) | O frontend já é JavaScript puro; o backend **carrega os mesmos módulos de domínio** (`plat/src`: normalizador legado, LotComposer, LotFactory, máquina de estados de disponibilidade). Nenhuma regra é reescrita em outra linguagem. |
| HTTP | `node:http` + roteador próprio (~50 linhas) | Sem framework: superfície pequena, nenhuma dependência além do driver do banco. |
| Banco | **PostgreSQL 16** | Integridade, transações, versionamento, JSONB validado e caminho natural para PostGIS. |
| Driver | `pg` (única dependência) | Queries 100% parametrizadas; pool de conexões configurável. |
| Migrations | Runner próprio (`src/shared/db/migrator.js`) | Arquivos SQL versionados, tabela `schema_migrations` com checksum, advisory lock, scripts *down* para dev/staging. |
| Testes | `node:test` | Sem dependências extras. |

Não foram adotados ORM, Express, Redis, fila nem microserviços: a complexidade atual não justifica (§195–197).

## 2. Monólito modular em camadas

```
plat/
├── src/                       ← frontend (inalterado) + data/apiSource.js (novo)
└── backend/
    ├── src/
    │   ├── server.js          ← processo: config → servidor → shutdown gracioso
    │   ├── app.js             ← composition root: serviços + controllers + pipeline HTTP
    │   ├── modules/
    │   │   ├── developments/  controller · service · repository
    │   │   ├── lots/          controller · service · repository · dto
    │   │   ├── analysis/      controller · service · repository · dto (+ prévia: IntelligenceEngine no servidor)
    │   │   ├── commercial/    controller · service · repository · dto (+ publicação de tabela de preço)
    │   │   ├── availability/  controller · service · repository · dto (+ comando de escrita, stream SSE)
    │   │   ├── assets/        controller · service · repository
    │   │   ├── iam/           PermissionRegistry · AuthenticationService · decide() · RoutePermissionMatrix · /me (tópico 30)
    │   │   ├── tenancy/       TenantResolver · TenantGuard · dono do recurso (tópico 31)
    │   │   ├── pricing-history/ domínio puro + repository + controller (tópico 28)
    │   │   └── imports/       ImportDevelopmentDataService
    │   └── shared/
    │       ├── config/        variáveis de ambiente (+ .env local opcional)
    │       ├── db/            pool, transações, migrator, audit_log
    │       ├── domain/        carga do domínio compartilhado (vm) + checksums
    │       ├── http/          roteador, erros padronizados, respostas/ETag/gzip, middlewares, guarda de escrita, idempotência
    │       ├── logging/       logger JSON estruturado
    │       └── validation/    validação de parâmetros e de comandos (whitelist)
    ├── migrations/            001…009 (+ down/)
    ├── scripts/               migrate.js · import.js · shadow-compare.js · openapi.js · iam.js (dev/test)
    └── docs/                  este arquivo, DATA_MIGRATION_V2.md, DEPLOYMENT_V2.md, openapi.json
```

Responsabilidades (§200–205):

- **Controller**: somente HTTP — valida parâmetros/query (allowlist), chama o serviço, escolhe a política de cache. Nenhum SQL.
- **Service (Application)**: `GetDevelopmentConfig`, `GetStaticSnapshot`, `GetMapLots`, `GetLotDetail`, `GetCurrentAnalysis`, `GetCommercialSnapshot`, `GetCurrentPriceTable`, `GetAvailability`, `UpdateAvailability`, `GetAssets`, `ImportDevelopmentData`.
- **Domain**: o mesmo código do frontend (`App.lifecycle`, `App.domain.LotFactory`, `App.availability`, `App.legacy`, e desde o contrato 1.2 o `IntelligenceEngine` — `App.intelligence`, `App.methodology`, `App.inormalize`, `App.analysisText` — com `App.configs.scoring` de `plat/config/scoring`), carregado em um contexto `vm` por `shared/domain/sharedDomain.js` (`BACKEND_ORDER`). Regra crítica com uma única especificação nos dois lados (§167).
- **Repository**: SQL parametrizado; recebe `db` (pool ou cliente de transação), então os serviços controlam a transação.
- **DTO / Validator**: contratos de saída e comandos de entrada com whitelist de campos (proteção contra mass assignment, §158).

Fluxo obrigatório (§5): `Frontend → API → Application Service → Repository → PostgreSQL`. O frontend nunca acessa o banco.

## 3. API `/api/v1`

Contrato completo em [`openapi.json`](openapi.json) (gerado do código: `npm run openapi`). **A camada de API formal (tópico 11) — todos os endpoints, envelope, versionamento, filtros, DTOs por caso de uso, validação de saída e desempenho — está em [API_ARCHITECTURE.md](API_ARCHITECTURE.md); erros em [API_ERRORS.md](API_ERRORS.md); mudanças em [API_CHANGELOG.md](API_CHANGELOG.md).** A tabela abaixo lista só os endpoints da 1.0. Todos os endpoints são escopados por `developmentId` ou por `lotId` (que pertence a um único empreendimento).

| Método | Rota | Domínio / cache | Retorno |
|---|---|---|---|
| GET | `/health` | público, `no-store` | liveness (não toca no banco) |
| GET | `/health/ready` | público, `no-store` | readiness: banco + versão do schema |
| GET | `/api/v1/developments/{id}/config` | versionado (`max-age=300, must-revalidate`) + ETag | DevelopmentConfigDto (mesmo formato do `config/developments.js`, reconstruído do banco) |
| GET | `/api/v1/developments/{id}/map-lots` | dinâmico (`no-cache`) + ETag | `{ developmentId, versions, count, lots: MapLotDto[] }` |
| GET | `/api/v1/developments/{id}/lots/static` | estático (`max-age=86400, stale-while-revalidate=604800`) + ETag | **StaticSnapshot** |
| GET | `/api/v1/developments/{id}/analysis/current` | versionado + ETag | **AnalysisSnapshot** |
| GET | `/api/v1/developments/{id}/commercial/current` | versionado + ETag | **CommercialSnapshot** |
| GET | `/api/v1/developments/{id}/commercial/price-tables/current` | versionado + ETag | PriceTableDto com planos |
| GET | `/api/v1/developments/{id}/availability` | dinâmico (`no-cache`) + ETag por revisão | **AvailabilitySnapshot** |
| GET | `/api/v1/developments/{id}/assets` | versionado + ETag | metadados de assets (sem binários) |
| GET | `/api/v1/lots/{id}` | dinâmico + ETag | `{ data: LotDetailDto, meta, lot, versions }` (`lot`/`versions` deprecated desde 1.1.0) |
| GET | `/api/v1/lots/{id}/availability/history` | dinâmico | histórico de status |
| PATCH | `/api/v1/lots/{id}/availability` | `no-store` | comando de escrita (desabilitado sem `ADMIN_API_TOKEN`) |

Contrato 1.2 (detalhes em API_ARCHITECTURE §8–§12): `POST /api/v1/developments/{id}/price-tables` (publicação/dry-run de tabela), `POST /api/v1/developments/{id}/analysis/preview` (impacto de metodologia, sem publicar), `GET /api/v1/developments/{id}/availability/stream` (SSE), `Idempotency-Key` nas rotas administrativas.

### 3.1 Snapshots = contrato do frontend

Os quatro endpoints de snapshot devolvem **exatamente** o formato de `App.lifecycle.snapshot()`:

```json
{ "kind": "static|analysis|commercial|availability", "schemaVersion": "1.0", "developmentId": "viva-juara",
  "<chave de versão>": "...", "...metadados...": "...", "lots": { "VJ-QB-L0079": { "...parte do Lot desta camada...": {} } } }
```

Chaves de versão: static → `staticDataVersion`, analysis → `analysisVersion`, commercial → `priceTableVersion`, availability → `revision`.
Por isso o `LotComposer` e o `LotRepository` do frontend funcionam **sem alteração** com a origem API (`ApiLotSource`). O frontend valida cada snapshot com `App.lifecycle.validateSnapshot` antes de usá-lo.

### 3.2 DTOs

- **MapLotDto** (ex-LotSummaryDto; mapa, payload enxuto): `id, code, blockId, blockNumber, lotNumber, areaM2, status (deprecated), availabilityStatus, price, pricePerM2, class, overallScore, polygon, centroid, thematicValues` — 498 lotes ≈ 316 KB (42 KB gzip, 38 KB brotli) desde a 1.1.0, obtidos em **uma única query** (lots + análise corrente + preço corrente + disponibilidade; sem N+1).
- **LotDetailDto**: seções públicas do **Lot canônico** composto no servidor por `App.lifecycle.composeOne` + `App.domain.LotFactory.create` (o mesmo código do navegador), em `data`; `lot` (Lot completo) e `versions` seguem no nível superior para clientes 1.0.
- **DevelopmentConfigDto**: configuração do empreendimento + `sources`, `priceTables`, `currentPriceTableId`, `staticDataVersion`, `analysisVersion` e `versions` vindos do banco.
- **PriceTableDto**: tabela com planos; os planos são devolvidos sem perda (coluna `rules` JSONB).
- **AssetDto**: `id, key, type, version, storageKey, contentType, sizeBytes, checksum, uploadedAt, url`.
- **UpdateAvailabilityRequest** (comando): `{ status, expectedRevision, reason?, reservedUntil?, proposalId?, notes? }` — campos desconhecidos são rejeitados.

Tamanhos medidos localmente (sem/com gzip): static 1,23 MB / 88 KB · analysis 1,02 MB / 44 KB · commercial 148 KB / 4,5 KB · availability 93 KB / 1,8 KB · map-lots 170 KB / 34 KB na 1.0 (316 KB / 42 KB na 1.1.0, com `thematicValues`) · config 7,5 KB / 3,2 KB · ficha de um lote 5,6 KB na 1.0 (≈ 11 KB na 1.1.0, com `data` + `lot`). Nenhum binário ou base64 trafega em JSON (§107). A geometria **não** é simplificada (§109).

### 3.3 Cache e ETag

- ETags fracas (`W/"…"`) calculadas a partir dos **ponteiros de versão** (uma query leve), então um `If-None-Match` válido responde `304` sem montar o corpo.
- Estático: cache longo; versionado: revalida a cada 5 min; dinâmico (`availability`, `map-lots`, ficha): `no-cache` (sempre revalida, normalmente `304`). Cache estático nunca impede atualização dinâmica (§175).
- `Vary: Origin, Accept-Encoding`; brotli (preferido) ou gzip quando o cliente aceita e o corpo passa de 1 KB.

### 3.4 Erros, logs e rastreamento

- Formato único (1.1.0): `{ code, message, details, requestId, traceId, timestamp }` — sem stack trace, SQL ou caminhos internos (§56, §88). Catálogo completo em [API_ERRORS.md](API_ERRORS.md).
- Códigos: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `WRITES_DISABLED`/`CORS_ORIGIN_DENIED` 403, `NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405, `REVISION_CONFLICT`/`IDEMPOTENCY_KEY_REUSED`/`IDEMPOTENCY_REQUEST_IN_PROGRESS`/`PRICE_TABLE_VERSION_EXISTS` 409, `INVALID_PRICE_TABLE`/`INVALID_METHODOLOGY` 422, `ANALYSIS_INPUT_NOT_FOUND` 404, `INTELLIGENCE_UNAVAILABLE`/`STREAM_LIMIT_REACHED` 503, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `INVALID_AVAILABILITY_TRANSITION`/`INVALID_STATE`/`FIELD_NOT_ALLOWED`/`INVALID_FIELD_KEY` 422, `INVALID_FILTER` 400/422, 404 semânticos (`LOT_NOT_FOUND`, `DEVELOPMENT_NOT_FOUND`, …), `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `DATABASE_UNAVAILABLE`/`REQUEST_TIMEOUT`/`NOT_READY` 503.
- `X-Request-Id`: aceito do cliente (se bem formado) ou gerado; devolvido em toda resposta e usado como `traceId`.
- Log JSON por requisição: `timestamp, level, requestId, method, route (template, sem ids), statusCode, duration, errorCode`. Corpos de requisição e segredos nunca são logados (§97).

### 3.5 Segurança (baseline)

CORS por allowlist (`CORS_ORIGINS`, `*` proibido em produção) · rate limit em memória por IP (`/health` isento) · timeout por requisição · limite de corpo (16 KB) · `Content-Type` obrigatório em escrita · cabeçalhos `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP `default-src 'none'`, HSTS em produção · queries parametrizadas · nenhuma credencial no frontend nem no repositório · escrita desligada enquanto `ADMIN_API_TOKEN` não estiver configurado e, quando ligada, protegida por `Authorization: Bearer <ADMIN_API_TOKEN>` (sha256 + `timingSafeEqual`, ≥ 32 caracteres em produção; `WRITE_API_KEY` legado/deprecated) até existir autenticação de usuários (§91, §194). Limite de corpo de 256 KB (`ADMIN_BODY_LIMIT_BYTES`) só para publicação de tabela e prévia de análise. Endpoints públicos hoje: todos os GET de empreendimentos `PUBLIC`; desde a 1.3.0 toda rota passa por autorização com negação por padrão (ver §9).

## 4. Banco de dados

Modelo **híbrido** (§24): colunas para o que é filtrado/indexado, JSONB para o restante da camada.

| Tabela | Conteúdo |
|---|---|
| `developments` | id, `tenant_id` (preparado, sem tenant fixo no schema), code, name, slug, status, currency, locale, `config` JSONB, ponteiros `current_static_version`, `current_analysis_version_id`, `current_price_table_id`, contador `availability_revision` |
| `sources` | fontes de dados (planta oficial, KMZ, tabela de preço, …) + fontes de sistema (`lots.json`, `availability-api`) |
| `assets` | metadados (tipo, `storage_key`, versão, sha256, tamanho); binários ficam no object storage |
| `static_versions` | cada `staticDataVersion` publicada com checksum, nº de lotes e checksum do arquivo importado |
| `blocks` | quadras por empreendimento |
| `lots` | id, block, code, lot_number, área, lat/lon (colunas) + `static` JSONB (camada estática sem polígono) + `geometry` JSONB (GeoJSON Polygon em unidades da planta, precisão total) + `checksum` + `geometry_checksum` + `static_version` |
| `analysis_versions` / `lot_analysis` | versões de análise (DRAFT/PUBLISHED/ARCHIVED, imutáveis após publicação) e a camada analítica por lote (JSONB + `class`, `overall_score` indexáveis) |
| `price_tables` / `payment_plans` / `lot_prices` | tabela versionada (status, vigência, fonte; `published_by`, `archived_at`, `change_reason`, `pricing_mode` desde a migration 005), planos (colunas + `rules` sem perda) e preço por lote |
| `lot_availability` | status, revision, updated_at, source_id, reserved_until, proposal_id, reason, notes, provenance — com CHECKs coerentes com a máquina de estados |
| `availability_history` | toda transição (de → para, revisão, momento, fonte, request id) |
| gatilho `developments_availability_revision_notify` | `NOTIFY plat_availability` a cada nova `availability_revision` (migration 007; entregue no COMMIT) → stream SSE |
| `audit_log` | ação, entidade, antes/depois, request id; `actor_id = "admin"` para escritas com `ADMIN_API_TOKEN` (nulo para importação e para a chave legada) |
| `idempotency_keys` | `Idempotency-Key` por credencial: hash da requisição, resposta armazenada, validade (migration 004) |
| `analysis_input_versions` / `lot_analysis_inputs` | medições de entrada do motor (`analysis-input.json`) por `inputVersion`, imutáveis; ponteiro `developments.current_analysis_input_version` (migration 006) |
| `import_runs` | relatório completo de cada importação real |
| `schema_migrations` | controle de migrations (versão, checksum, tempo) |

Índices (§102): PK de `lots.id`; `lots(development_id)`, `lots(block_id)`, `lots(development_id, area_m2)`; `lot_availability(status)` e `(development_id, status)`; `lot_prices` por `(price_table_id, lot_id)` e `lot_id`; `lot_analysis` por `(analysis_version_id, lot_id)`, `lot_id`, `(analysis_version_id, class)`; `price_tables(development_id, status)`; `analysis_versions(development_id, status)`; `availability_history(lot_id, changed_at)`; `audit_log(entity_type, entity_id)` e `(created_at)`.

**PostGIS (passo futuro, §11/§103):** o servidor local não tem PostGIS. Os polígonos já estão em GeoJSON (`geometry`), então a migração futura é: `CREATE EXTENSION postgis; ALTER TABLE lots ADD COLUMN geom geometry(Polygon, 0); UPDATE lots SET geom = ST_GeomFromGeoJSON(geometry::text); CREATE INDEX … USING GIST (geom);` — sem alterar contratos. Cálculos geoespaciais continuam no pipeline técnico até haver necessidade.

## 5. Frontend: repositório de API e fallback

Arquivo novo `plat/src/data/apiSource.js` registra `App.api`:

- **ApiClient**: base URL de `dataSource.apiBaseUrl` (nunca fixa em componente), timeout (padrão 10 s, `dataSource.timeoutMs`), **uma** retentativa controlada só para GET (erro de rede, timeout, 5xx, 429), nenhuma para PATCH; erros normalizados (`ApiError { code, status, message, details, traceId }`); log central em `App.api.errorLog` + `App.lifecycle.note('api error')`.
- **ApiLotSource(dev, { fallback })**: implementa `{ kind: 'api', loadLayers() }` buscando os 4 snapshots em paralelo e validando cada um.
- **ApiAvailabilityRepository / ApiCommercialRepository / ApiDevelopmentRepository**: wrappers finos para polling, histórico e o comando de escrita.

`App.repos.createLotRepository` já escolhe a origem pela feature flag. Chaves esperadas em `DevelopmentConfig.dataSource`:

```js
dataSource: { useBackendData: false, apiBaseUrl: 'https://api.exemplo.com/api/v1', fallbackToJson: true, timeoutMs: 10000 }
```

Política de falha por domínio (§139, §177, §214):

| Falha | Comportamento |
|---|---|
| static (estrutural) | se `fallbackToJson` → carrega **todo** o dataset do `lots.json` publicado (nunca mistura camadas API + JSON) e registra aviso `API_FALLBACK_JSON`; senão erro explícito |
| analysis | camada nula, estado `error`: classe `UNKNOWN`, scores nulos; mapa carrega |
| commercial | camada nula: preço nulo; mapa carrega |
| availability | camada nula: todos os lotes `UNKNOWN` (nunca `AVAILABLE`); mapa carrega |

O fallback para JSON deve ficar ligado só durante a transição e em ambientes definidos (§45); divergências não são escolhidas silenciosamente — ficam no log de erros/avisos (§138).

## 6. Fases de migração (§182–192) — situação

| Fase | Situação |
|---|---|
| 1. API client/repositories no frontend | **feito** (`apiSource.js`) |
| 2. Backend skeleton (health + config) | **feito** |
| 3. Schema + migrations | **feito** (001–007) |
| 4. Importador | **feito** (dry-run, backup, idempotente) |
| 5. Endpoints read-only | **feito** |
| 6. Shadow compare JSON/API | **feito** — 498/498 idênticos |
| 7. Migrar leitura para API (cutover) | **pendente de hospedagem** — ligar `useBackendData` por ambiente |
| 8. Availability dinâmica | **feito** (snapshot dinâmico + revisão + ETag + stream SSE com LISTEN/NOTIFY) |
| 9. Price tables dinâmicas | **feito** (`POST …/price-tables` com dry-run; versão imutável, ponteiro corrente atômico) |
| 10. Escrita controlada | `PATCH availability` e publicação de tabela prontos, **desligados** sem `ADMIN_API_TOKEN`; `Idempotency-Key` |
| 11. Desligar fallback JSON | após período estável em produção |

## 7. Deploy

Resumo: um único processo Node (monólito modular) atrás de HTTPS, PostgreSQL gerenciado, assets em object storage/CDN. Detalhes, CI/CD, rollback, backup/restore e baseline de segurança em [`DEPLOYMENT_V2.md`](DEPLOYMENT_V2.md). Migração de dados e reconciliação em [`DATA_MIGRATION_V2.md`](DATA_MIGRATION_V2.md).

## 8. Fora do escopo deste tópico

IdP real (decisão pendente; ver `IAM_ARCHITECTURE.md`), API de gestão de usuários, RLS no PostgreSQL (plano em `MULTI_TENANCY.md`), editor de geometria, upload de arquivos, publicação de nova versão de análise (`POST …/analysis-versions`; a prévia mede o impacto sem publicar), Redis, filas, métricas e Sentry (pontos de integração documentados). Nenhuma regra de UX, score, classe, solar, comparação ou recomendação foi alterada.

## 9. Tópicos 28–31 (API 1.3.0)

- **Pipeline HTTP** (`app.js`):
  1. escritas habilitadas?
  2. `authenticate` (ANONYMOUS / USER / SYSTEM)
  3. permissão da rota (`routePolicies.js`, negação por padrão; o servidor não sobe com rota sem política)
  4. dono do recurso carregado do banco
  5. `decide()` puro
  6. handler

  Invisível → 404 idêntico ao inexistente. Visível sem permissão → 403 `PERMISSION_DENIED`. Detalhes em [`IAM_ARCHITECTURE.md`](IAM_ARCHITECTURE.md).
- **Tenancy** (migração 008): `organizations` (House 7 Imóveis = `org_house7`), `organization_id` NOT NULL com FK composta em toda tabela do empreendimento, triggers que preenchem a organização em INSERT (importador inalterado) e `visibility` PUBLIC/PRIVATE. Detalhes em [`MULTI_TENANCY.md`](MULTI_TENANCY.md).
- **IAM** (migração 009): `users` (sem PII além do nome de exibição), memberships, roles, assignments, `auth_tokens` (só hash) e `audit_log` estendida e append-only.
- **Histórico de preço**: leitura derivada das versões publicadas, domínio puro, variação só com ≥ 2 versões comparáveis. Detalhes em [`PRICE_HISTORY_API.md`](PRICE_HISTORY_API.md).
- **Disponibilidade independente de preço**: `GET …/availability/manifest` (revisão própria, checksum, contagens, frescor). O módulo de disponibilidade não referencia tabelas de preço e vice-versa; isso é verificado por teste estático e de banco.
- Relatório: [`RELATORIO_BACKEND_TOPICOS_28_31.md`](RELATORIO_BACKEND_TOPICOS_28_31.md).
