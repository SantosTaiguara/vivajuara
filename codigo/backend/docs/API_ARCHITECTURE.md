# Arquitetura da API `/api/v1`

Camada de API formal e versionada (tópico 11) sobre o backend V2 ([BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md)). Contrato máquina-legível: [`openapi.json`](openapi.json) (OpenAPI 3.0, **gerado do código**). Erros: [API_ERRORS.md](API_ERRORS.md). Histórico: [API_CHANGELOG.md](API_CHANGELOG.md).

## 1. Princípios

- **A API expõe casos de uso, não tabelas.** Cada endpoint devolve um DTO desenhado para uma tela/uso (mapa, lista, Quick View, ficha, análise, comercial, disponibilidade, proveniência), nunca a linha do banco nem o `Lot` interno sem filtro.
- **O domínio é um só.** Regras, Field Registry, enums, composição do lote, máquina de estados de disponibilidade e parser de busca são o código do frontend (`src/`) carregado no servidor (`src/shared/domain/sharedDomain.js`). O backend não reimplementa regra; os testes comparam a API com a composição canônica dos 498 lotes.
- **Valores nunca são reinterpretados.** Ids, geometria, scores, classes, rankings e preços saem exatamente como importados/compostos. `null` continua `null` (nunca `0`); disponibilidade sem dado é `UNKNOWN`, nunca `AVAILABLE`.
- **Camadas (monólito modular):** `controller` (HTTP: validação de entrada, cache, schema de resposta) → `service` (caso de uso, versões, composição) → `repository` (SQL parametrizado, whitelists) → `dto` (projeção pública). Controllers não têm SQL nem regra; repositories não têm regra.

```
src/modules/<módulo>/<módulo>.{controller,service,repository,dto}.js   módulos: developments, lots, analysis, commercial, availability, assets
src/modules/commercial/priceTablePublication.{service,dto}.js   publicação de tabela de preço (admin, dry-run)
src/modules/analysis/analysisPreview.service.js                  prévia de análise: IntelligenceEngine no servidor + impact report
src/modules/availability/availability.stream.js                  stream SSE (LISTEN/NOTIFY + poll de segurança)
src/modules/lots/lots.query.js        specs de filtro/ordenação/paginação (usadas pelo controller E pelo gerador do openapi.json)
src/shared/contracts/schemas.js       schemas dos DTOs (gerados do Field Registry + enums) → validação de saída e openapi.json
src/shared/validation/{index,schema}.js  validação de entrada (path/query/body) e validador de JSON Schema (subconjunto) para a saída
src/shared/http/{errors,respond,router,middleware}.js  catálogo de erros, envelope/ETag/cache/compressão, roteador, CORS/rate limit/request id/guarda de escrita
src/shared/http/idempotency.js + shared/db/idempotency.repository.js  Idempotency-Key das rotas administrativas
scripts/openapi.js                    gera docs/openapi.json (--check falha se estiver desatualizado)
```

## 2. Versionamento

| Conceito | Onde | Exemplo | Muda quando |
|---|---|---|---|
| Versão da API | caminho | `/api/v1` | quebra de contrato |
| Versão do contrato | `openapi.json` `info.version`, `CONTRACT_VERSION` | `1.2.0` | qualquer mudança no contrato (SemVer) |
| `schemaVersion` | snapshots, manifest | `1.0` | formato dos snapshots do frontend |
| `staticVersion` / `analysisVersion` / `priceTableVersion` | `meta.versions`, manifest | `2026-10-06.1` | publicação de dados |
| `availabilityRevision` | `meta.versions`, manifest | `0` | cada mudança de disponibilidade |

Regras dentro de `/api/v1`: só mudanças **aditivas** (endpoint, campo opcional ou novo, código de erro, parâmetro opcional). Nada é removido, renomeado ou muda de tipo/unidade/significado. Campos substituídos ficam marcados `deprecated: true` no `openapi.json` e listados no changelog; são removidos apenas em `/api/v2`, que conviveria com a v1 durante a migração do frontend. Clientes devem ignorar campos desconhecidos e tratar código de erro desconhecido pelo status HTTP.

## 3. Endpoints

Todas as rotas abaixo são prefixadas por `/api/v1` (exceto `/health`). Cache: **E** = estático (`public, max-age=86400, stale-while-revalidate=604800`), **V** = versionado (`public, max-age=300, must-revalidate`), **D** = dinâmico (`no-cache`), **N** = `no-store`. Todas as respostas GET com ETag respondem `304` a um `If-None-Match` válido sem montar o corpo. **A** = rota administrativa (§8.1: `Authorization: Bearer <ADMIN_API_TOKEN>`, `Idempotency-Key`).

| Método | Rota | Cache | Corpo (200) | Uso |
|---|---|---|---|---|
| GET | `/health` | N | `Health` | liveness, sem banco |
| GET | `/health/live` | N | `Live` | liveness mínima (`{ status: 'ok' }`, sem versão nem topologia; tópico 51) |
| GET | `/health/ready` | N | `Ready` | readiness (banco + migração) |
| GET | `/developments` | D | `{ data: DevelopmentDto[], meta }` (paginado, `pageSize` ≤ 100) | lista de empreendimentos |
| GET | `/developments/{developmentId}` | D | `{ data: DevelopmentDto, meta }` | resumo + versões correntes |
| GET | `/developments/{developmentId}/config` | V | `DevelopmentConfigDto` (formato 1.0) | configuração do app |
| GET | `/developments/{developmentId}/manifest` | D | `{ data: ManifestDto, meta }` | quais versões estão correntes (revalidação barata) |
| GET | `/developments/{developmentId}/sources` | V | `{ data: SourceDto[], meta }` | catálogo de fontes |
| GET | `/developments/{developmentId}/map-lots` | D | `{ developmentId, versions, count, lots: MapLotDto[] }` | mapa: todos os lotes, sem paginação |
| GET | `/developments/{developmentId}/lots` | D | `{ data: LotQuickViewDto[], meta }` | lista filtrável/ordenável/paginada |
| GET | `/developments/{developmentId}/lots/search` | D | `{ data: LotQuickViewDto[], meta }` | busca por código (`q`, `limit` ≤ 50) |
| GET | `/developments/{developmentId}/lots/static` | E | `StaticSnapshot` | snapshot do frontend |
| GET | `/developments/{developmentId}/analysis/current` | V | `AnalysisSnapshot` | snapshot do frontend |
| GET | `/developments/{developmentId}/commercial/current` | V | `CommercialSnapshot` | snapshot do frontend |
| GET | `/developments/{developmentId}/commercial/price-tables/current` | V | `PriceTableDto` (formato 1.0) | tabela corrente com planos |
| GET | `/developments/{developmentId}/price-tables/{priceTableId}` | V | `{ data: PriceTableDto, meta }` | tabela publicada/arquivada por id |
| POST | `/developments/{developmentId}/price-tables` | N, **A** | `201 { data: PriceTablePublicationDto, meta }` (+ `Location`); `?dryRun=true` → `200`, nada gravado | publica nova versão de tabela de preço (§10) |
| POST | `/developments/{developmentId}/analysis/preview` | N, **A** | `{ data: AnalysisPreviewDto, meta }` | relatório de impacto de metodologia candidata, sem publicar (§11) |
| GET | `/developments/{developmentId}/availability` | D | `AvailabilitySnapshot` | snapshot do frontend |
| GET | `/developments/{developmentId}/availability/stream` | N | `text/event-stream` (eventos `AvailabilityStreamEvent`) | mudanças de disponibilidade em tempo real (§12) |
| GET | `/developments/{developmentId}/assets` | V | `AssetsResponse` | metadados de assets |
| POST | `/lots/batch-summary` | N | `{ data: LotQuickViewDto[], meta: { requested, found, notFound } }` | comparação/favoritos (1–100 ids) |
| GET | `/lots/{lotId}` | D | `{ data: LotDetailDto, meta, lot*, versions* }` | ficha (`*` deprecated, formato 1.0) |
| GET | `/lots/{lotId}/summary` | D | `{ data: LotQuickViewDto, meta }` | Quick View |
| GET | `/lots/{lotId}/analysis` | V | `{ data: LotAnalysisDto, meta }` | scores, classe, alertas, destaques, ranking |
| GET | `/lots/{lotId}/commercial` | V | `{ data: LotCommercialDto, meta }` | preço e planos aplicáveis |
| GET | `/lots/{lotId}/availability` | D | `{ data: AvailabilityDto, meta }` | status público do lote |
| PATCH | `/lots/{lotId}/availability` | N, **A** | `UpdateAvailabilityResponse` | escrita controlada — **desligada sem `ADMIN_API_TOKEN`** (padrão) |
| GET | `/lots/{lotId}/availability/history` | D | `AvailabilityHistoryResponse` | histórico |
| GET | `/lots/{lotId}/provenance` | D | `{ data: LotProvenanceDto, meta }` | proveniência (todas as chaves ou `?fieldKey=`) |
| GET | `/me` | `private, no-store` | `{ data: MeDto, meta }` | principal atual, organização ativa, permissões (§13) — 1.3.0 |
| GET | `/auth/google/start` | `no-store` | 302 → Google (`{ data: AuthRedirectDto }`) | início do login Google (Authorization Code + PKCE) — 1.4.0 |
| GET | `/auth/google/callback` | `no-store` | 302 → painel (ou `{ data: AuthSessionDto }`) | retorno do Google, cria a sessão por cookie — 1.4.0 |
| GET | `/auth/session` | `no-store` | `{ data: AuthSessionDto, meta }` | estado da sessão + token CSRF — 1.4.0 |
| POST | `/auth/logout` | `no-store` | `{ data: { revoked }, meta }` | encerra a sessão (X-CSRF-Token) — 1.4.0 |
| GET | `/iam/registry` | V | `{ data: IamRegistryDto, meta }` | PermissionRegistry + roles (§13) — 1.3.0 |
| GET | `/admin/audit-events` | N, autenticado | `{ data: AuditEventDto[], meta }` | auditoria da organização (`admin.audit.view`) — 1.3.0 |
| GET | `/developments/{developmentId}/lots/{lotId}/price-history` | D | `{ data: LotPriceHistoryDto, meta }` | histórico do preço de tabela do lote (§14) — 1.3.0 |
| GET | `/developments/{developmentId}/pricing/history` | D | `{ data: DevelopmentPriceHistoryDto, meta }` | versões e mudanças do empreendimento (§14) — 1.3.0 |
| GET | `/developments/{developmentId}/availability/manifest` | D | `{ data: AvailabilityManifestDto, meta }` | revisão/checksum/contagens sem preço (§15) — 1.3.0 |

Os formatos marcados "1.0" e os snapshots não usam envelope de propósito: são o contrato do `ApiLotSource` do frontend (`src/data/apiSource.js`) e não mudaram.

### 3.1 DTOs por caso de uso

| DTO | Conteúdo | Não contém |
|---|---|---|
| `MapLotDto` | identidade, área, `availabilityStatus` (+ `status` deprecated), preço, R$/m², classe, `overallScore`, `polygon`, `centroid`, `thematicValues` (scores por perfil e atributos de camada temática) | provenance, alertas, rankings, planos, notas internas |
| `LotQuickViewDto` | identidade, dimensões, esquina, status, preço/moeda/versão da tabela, classe, scores, critérios, ruído/privacidade/tráfego, distância à portaria, fundo verde, destaques, alertas, `analysisVersion` | geometria, provenance completa |
| `LotDetailDto` | seções canônicas do Field Registry (`identity`, `geometry`, `location`, `surroundings`, `mobility`, `environmental`, `construction`, `commercial`, `intelligence`), `availability` pública, `provenanceSummary`, `metadata` | `availability.notes`, `availability.proposalId`, provenance por campo (fica em `/provenance`) |
| `LotAnalysisDto` | scores, classe, critérios, alertas, destaques, rankings, `analysisVersion` | — |
| `LotCommercialDto` | preço, R$/m², entrada padrão, planos aplicáveis (`availablePlans` ∩ planos da tabela), tabela/versão/vigência | — |
| `AvailabilityDto` | `lotId, status, updatedAt, revision, reservedUntil, freshnessSource` | `notes`, `proposalId` |
| `LotProvenanceDto` | `lotId` + por `fieldKey`: domínio, status, confiança, fonte, método, precisão, data, notas da fonte, `lotSpecific` | — |

Os schemas das seções do lote são **gerados do Field Registry** (`App.model.FIELDS`) e dos enums (`App.enums`): um campo novo no registry aparece no contrato sem edição manual, e `npm run openapi:check` acusa a diferença.

## 4. Formato das respostas

**Envelope** (endpoints novos): `{ "data": …, "meta": { "apiVersion": "v1", "requestId", "generatedAt", … } }`. `meta` de recurso traz `versions` e `unavailableLayers`; de coleção, `total, page, pageSize, totalPages, sortBy, sortDirection, filters` (somente os filtros informados); de busca, `q, kind (lot|block|multi|none), total, limit, truncated`; do batch, `requested, found, notFound`.

**Datas:** instantes em ISO 8601 UTC com `Z` (`2026-10-07T15:56:52.139Z`); datas sem hora em `YYYY-MM-DD`; identificadores de versão de dados são strings opacas (`2026-10-06.1`), não datas a interpretar.

**Números:** JSON number, nunca string formatada. Unidades no nome do campo (`areaM2`, `routeDistanceToGateM`, `pricePerM2`, `frontBearingDeg`); dinheiro em unidades da moeda (`price: 348968.88`, com `currency: "BRL"` ao lado), sem arredondamento além do dado de origem; scores 0–100, critérios 0–10. Formatação (`R$ 348.968,88`) é responsabilidade do cliente.

**Nulos e ausências:** campo do contrato está sempre presente; sem valor ⇒ `null`. Listas vazias são `[]`.

**Cabeçalhos:** `X-Request-Id` em toda resposta (aceito do cliente se casar com `^[A-Za-z0-9._:-]{8,64}$`, senão um UUID novo; o mesmo valor vai em `meta.requestId` e nos erros); `ETag` fraca + `Cache-Control` por classe; `Vary: Origin, Accept-Encoding`; `Content-Encoding: br` ou `gzip` acima de 1 KB quando aceito (brotli preferido); `Retry-After` em 429/503.

## 5. Filtros, ordenação e paginação (`/developments/{developmentId}/lots`)

| Parâmetro | Tipo | Campo canônico |
|---|---|---|
| `status` | lista de `AvailabilityStatus` | `availability.status` (sem registro ⇒ `UNKNOWN`) |
| `block` | lista de quadras (`A,B`) | `identity.blockId` |
| `minArea`, `maxArea` | número (m²) | `geometry.areaM2` |
| `minPrice`, `maxPrice` | número (moeda) | `commercial.price` |
| `class` | lista de `LotClass` | `intelligence.class` |
| `minHousingScore` | 0–100 | `intelligence.scores.housing` |
| `noiseLevel`, `privacyLevel` | lista de níveis | `environmental.*` (sem dado ⇒ `UNKNOWN`) |
| `corner` | `true`/`false` | `geometry.isCorner` |
| `search` | texto ≤ 64 | parser central de busca |
| `sortBy` | `code` (padrão), `price`, `areaM2`, `housingScore`, `distanceToGateM` | `distanceToGateM` = `mobility.routeDistanceToGateM` |
| `sortDirection` | `asc` (padrão) / `desc` | nulos sempre por último; desempate estável por quadra, número, id |
| `page`, `pageSize` | inteiros; `pageSize` 1–100, padrão 50 | página além do fim ⇒ `data: []` com `total` correto |

Listas aceitam valores separados por vírgula (`status=AVAILABLE,RESERVED`). Filtros e ordenação são **whitelists** mapeadas para expressões SQL fixas; o valor do usuário só entra como parâmetro (`$n`). Filtros com mínimo > máximo, valor fora do enum ou fora da faixa ⇒ `422 INVALID_FILTER`; malformados ⇒ `400 INVALID_FILTER`; parâmetro desconhecido ⇒ `400 VALIDATION_ERROR`. O ETag depende da consulta canônica (parâmetros normalizados) e das versões.

## 6. Validação

- **Entrada:** path params por regex (`developmentId`, `lotId` `VJ-QB-L0079`, `priceTableId`); query por allowlist + spec tipada (`parseQuery`); corpo por schema estrito (campos desconhecidos rejeitados, inclusive `__proto__`), `Content-Type: application/json` e limite de 16 KB.
- **Saída (§62):** toda rota declara o schema da resposta; com `VALIDATE_RESPONSES` (ligado fora de produção, e nos testes) a resposta é validada contra o mesmo schema publicado no `openapi.json` antes de ser enviada. Uma violação vira `500 INTERNAL_ERROR` + log `response contract violation` (nunca corpo parcial). Em produção pode ser ligada por variável de ambiente; o custo medido é baixo, mas o padrão é desligado para não transformar um campo inesperado em indisponibilidade.
- **Testes de contrato:** `tests/backend/contract.js` valida respostas reais contra `components.schemas` do `openapi.json`; `api.openapi.test.js` garante que o arquivo é idêntico ao gerado, que rotas e documentação batem nos dois sentidos, que todo `$ref` resolve e que os códigos de erro documentados existem no catálogo.

## 7. Desempenho

- **Sem N+1:** cada endpoint executa um número **constante** de comandos SQL, independente de página, lote ou tamanho do batch (teste `api.performance.test.js`, com um pool que conta comandos):

  | Endpoint | SQL |
  |---|---|
  | `map-lots`, `/lots` (qualquer `pageSize`) | 2 (ponteiros de versão + uma consulta read-model) |
  | `/lots?search=`, `/lots/search` | 3 (+ índice de identidade para o parser) |
  | `POST /lots/batch-summary` (1 ou 100 ids) | 1 |
  | `/developments`, `/developments/{developmentId}`, `/manifest` | 1 |
  | `/lots/{lotId}/summary` | 3 |
  | `/lots/{lotId}`, `/analysis`, `/provenance` | 6 (uma por camada, filtrada pelo lote) |
  | `/lots/{lotId}/commercial` | 7 (+ planos) |

- **Read model em uma consulta:** lista/mapa usam uma CTE (`lots` + análise corrente + preço corrente + disponibilidade) que devolve página e `total` no mesmo comando, com `NULLS LAST` e desempate determinístico.
- **Payload do mapa** (498 lotes, medido no teste): ≈ 316 KB sem compressão, ≈ 42 KB gzip, ≈ 38 KB brotli (≈ 650 B/lote); o teste limita 450 KB / 120 KB e ≤ 16 chaves por lote, e proíbe seções pesadas (provenance, alertas, rankings…). A geometria não é simplificada.
- **Latência local** (warm, sequencial, 25 amostras): `map-lots` p50 ≈ 54 ms / p95 ≈ 60 ms; `/lots` p50 ≈ 53 ms; ficha e Quick View p50 ≈ 6 ms; manifest ≈ 2 ms. Carga de 120 requisições com 20 simultâneas: todas 200 e com os mesmos dados. Os limites do teste são folgados (p95 < 2 s) para não falhar por máquina lenta; os números são impressos como diagnóstico.

## 8. Segurança

Igual à baseline do backend (BACKEND_ARCHITECTURE §3.5): CORS por allowlist (métodos `GET, HEAD, POST, PATCH, OPTIONS`; cabeçalhos `Content-Type, If-None-Match, Authorization, X-Request-Id, Idempotency-Key, Last-Event-ID`), rate limit por IP, timeout por requisição, limite de corpo, cabeçalhos de segurança, SQL parametrizado, sem segredos no código ou na documentação. Leituras são públicas (inclusive o stream SSE); o `POST /lots/batch-summary` é uma **leitura** (não altera estado), segue público e ignora `Idempotency-Key`. A ficha pública, o `AvailabilityDto` e o stream não expõem `notes` nem `proposalId`.

**Pendente (decisão humana):** o snapshot v1.0 `GET /developments/{developmentId}/availability` e `GET /lots/{lotId}/availability/history` ainda devolvem `proposalId` e `notes` (contrato do `ApiLotSource`); foram mantidos como estão até a decisão.

### 8.1 Rotas administrativas (escrita)

| Rota | Efeito |
|---|---|
| `PATCH /lots/{lotId}/availability` | muda o status (máquina de estados compartilhada) |
| `POST /developments/{developmentId}/price-tables` | publica tabela de preço (ou `dryRun`) |
| `POST /developments/{developmentId}/analysis/preview` | roda o motor e devolve o impacto (não grava, mas consome CPU: protegido) |

- **Guarda única** (`shared/http/middleware.js#authorizeWrite`, chamada pelo pipeline em `app.js` para toda rota `{ write: true }`/`{ admin: true }`, **antes** de parâmetros e corpo): sem credencial configurada → `403 WRITES_DISABLED`; `Authorization` ausente, de outro esquema ou com token errado → `401 UNAUTHORIZED` (+ `WWW-Authenticate: Bearer`). O token apresentado e o configurado são comparados como **sha256** com `crypto.timingSafeEqual` (mesmo tamanho sempre, tempo constante). A configuração guarda só o hash; o token nunca é logado nem ecoado.
- **Credenciais**: `ADMIN_API_TOKEN` (ator `"admin"`, gravado em `audit_log.actor_id`, `price_tables.published_by` e no escopo da idempotência). Legado: `WRITES_ENABLED=true` + `WRITE_API_KEY` (deprecated, ator `null`). `WRITES_ENABLED=false` desliga tudo mesmo com token. Em produção o token precisa de ≥ 32 caracteres e `WRITES_ENABLED=true` sem token impede a partida.
- **Corpo**: `PATCH` de disponibilidade mantém `BODY_LIMIT_BYTES` (16 KB); `price-tables` e `analysis/preview` aceitam até `ADMIN_BODY_LIMIT_BYTES` (256 KB: 498 preços por lote, metodologia completa).

### 8.2 Idempotência (`Idempotency-Key`)

- Opcional nas três rotas acima; formato `^[A-Za-z0-9._:-]{8,128}$` (senão `400 VALIDATION_ERROR`, `field: "Idempotency-Key"`).
- Registro em `idempotency_keys` (migration 004), chave primária `(principal, key)`: método, rota (template), **hash da requisição** (sha256 do JSON canônico de método + caminho + consulta ordenada + corpo — a ordem das chaves do corpo não importa), estado, status, cabeçalhos repetíveis (`Location`) e o corpo da resposta como texto (reenvio idêntico byte a byte), `expires_at = now() + IDEMPOTENCY_TTL_SECONDS` (padrão 86400, mínimo 60).
- Fluxo: reivindica a chave (`INSERT … ON CONFLICT DO UPDATE WHERE expirada`) → executa → guarda a resposta **2xx**. Repetição com o mesmo hash → resposta armazenada + `Idempotent-Replayed: true` (o comando não roda de novo); hash diferente → `409 IDEMPOTENCY_KEY_REUSED`; registro ainda `IN_PROGRESS` → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` + `Retry-After: 1`. Erro na execução libera a chave (nada foi gravado). Registro `IN_PROGRESS` abandonado (processo caiu) é retomado após `max(30 s, 2 × REQUEST_TIMEOUT_MS)`; a versão única da tabela e o `expectedRevision` impedem dupla aplicação mesmo nesse caso. Expirados são apagados de forma oportunista (no máximo 1×/min).

## 9. Fora do escopo desta versão

- IdP definitivo (OIDC), convites, gestão de usuários/roles por HTTP, MFA/step-up, webhooks e WebSocket: dependem de decisão/tópicos futuros (o modelo de usuários e o isolamento por organização existem desde 1.3.0, §13). Publicação de nova versão de análise (`POST …/analysis-versions`) também: a prévia (§11) mede o impacto, mas não publica.
- `GET /lots/{lotId}/fields/{fieldKey}/provenance`: o spec oferece como alternativa; usamos `/lots/{lotId}/provenance?fieldKey=` para não fragmentar a API (§31).
- Cliente gerado a partir do `openapi.json`: o frontend continua com o `ApiLotSource` escrito à mão (sem dependências novas).

## 10. Publicação de tabela de preço (`POST /developments/{developmentId}/price-tables`)

Corpo (`PublishPriceTableRequest`, campos desconhecidos rejeitados):

```json
{ "version": "2026-11-01", "pricePerM2": 1250, "validFrom": "2026-11-01", "validUntil": null,
  "lotPrices": [{ "lotId": "VJ-QB-L0079", "price": 399999.99 }, { "lotId": "VJ-QA-L0001", "pricePerM2": 1400 }],
  "changeReason": "Reajuste de novembro" }
```

- `pricePerM2` só: todos os lotes = `Math.round(áreaM2 × pricePerM2 × 100) / 100` (regra do frontend, chamada pelo próprio `App.repos.CommercialRepository.commercialFor`; a área é a `geometry.areaM2` estática armazenada). `lotPrices` só: **todo** lote precisa constar (`PER_LOT`). Os dois: `lotPrices` sobrepõe (`MIXED`). Preço por lote deriva `pricePerM2 = round(preço / área, 2)` e a entrada padrão como `App.domain.updateLotCommercial`.
- Validação estrita: números JSON positivos, finitos, ≤ 2 casas (`pricePerM2` ≤ 1.000.000, preço ≤ 1e11); datas `YYYY-MM-DD` reais; `validUntil ≥ validFrom`; todo `lotId` existe no empreendimento e aparece uma vez; `sourceId` existe em `/sources`; **nenhum campo de geometria/área** (`areaM2`, `polygon`, `centroid`, … → `422 immutable_field`). A tabela nunca escreve em `lots`; o snapshot comercial gerado passa por `App.lifecycle.validateSnapshot` antes de gravar.
- Publicação (uma transação, `SELECT … FOR UPDATE` no empreendimento): `version`/`id` novos (`id` padrão `<developmentId>-<version>`; repetido → `409 PRICE_TABLE_VERSION_EXISTS`) → `price_tables` `PUBLISHED` com `published_by = "admin"`, `published_at`, `change_reason`, `pricing_mode`, checksum → planos copiados da tabela corrente (e `downPaymentDefault` dela, salvo informado) → `lot_prices` de todos os lotes → tabela anterior `ARCHIVED` (`archived_at`; linhas intactas, `GET …/price-tables/{priceTableId}` continua respondendo) → ponteiro `current_price_table_id` → `audit_log` `PRICE_TABLE_PUBLISH`. Leitores veem a tabela antiga ou a nova inteira, nunca uma mistura; ETags de `commercial/*`, `manifest`, `map-lots` e fichas mudam com o ponteiro.
- `?dryRun=true`: mesma validação e cálculo, sem escrita; devolve `priceTable` com `status: "DRAFT"`, `publication.publishedAt: null`, `wouldConflict` e o diff.
- Diff (`PriceTableDiff`): para cada um dos lotes `{ lotId, code, areaM2, currentPrice, currentPricePerM2, proposedPrice, proposedPricePerM2, delta, deltaPercent, changed, source }` + `changed/unchanged/increased/decreased/newlyPriced` e totais.

## 11. Prévia de análise (`POST /developments/{developmentId}/analysis/preview`)

- O backend carrega `plat/src/intelligence/{math,normalization,methodology,engine,textAdapter}.js` na lista `BACKEND_ORDER` de `shared/domain/sharedDomain.js` (mesma ordem do frontend; módulos opcionais: se falharem, só esta rota responde `503 INTELLIGENCE_UNAVAILABLE`) e injeta `App.configs.scoring` lido de `plat/config/scoring/<empreendimento>/` (`current.json` + `<x.y>.json`, mesmo formato do bundle do navegador; `SHARED_CONFIG_DIR`).
- Entradas: as medições `LotAnalysisInput` importadas de `analysis-input.json` (`analysis_input_versions` / `lot_analysis_inputs`, precisão total), convertidas para o *realm* do motor (`toRealm`). Sem entradas → `404 ANALYSIS_INPUT_NOT_FOUND`.
- Corpo (`AnalysisPreviewRequest`): `{}` (candidata = publicada, impacto zero) ou `{ methodology, massChangeShare?, topMoves? }`. A candidata passa por `App.methodology.validate` (`422 INVALID_METHODOLOGY` com os códigos originais) e precisa ser do mesmo empreendimento.
- Resposta (`AnalysisPreviewDto`): `published: false`, `engineVersion`, `inputVersion`, `analysisVersion`, `base`/`candidate` (`methodologyVersion`, checksum), `impact` = `App.methodology.impact(publicada, candidata, entradas)` (scores alterados, distribuição e matriz de classes, mudanças de classe, ranking e alertas, `massChange`) e `publishedParity` (metodologia publicada × análise publicada armazenada: scores, classe, rankings, destaques, alertas — 498/498 idênticos hoje). Nada é gravado (nem `audit_log`).
- Paridade testada (`backend/tests/analysisPreview.test.js`): o resultado do motor no backend é idêntico ao do frontend para os 498 lotes e regenera os 45 campos publicados do `lots.json` (`App.analysisText.parity`), espelhando `tests/intelligence.test.js`. Custo medido: ≈ 0,3 s por prévia (duas execuções do motor), síncrono no processo — rota administrativa.

## 12. Stream de disponibilidade (`GET /developments/{developmentId}/availability/stream`)

- `text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`. Primeira linha `retry: <SSE_RETRY_MS>`; comentário `: heartbeat <ISO>` a cada `SSE_HEARTBEAT_MS` (15 s).
- Evento: `id: <availabilityRevision>` · `event: availability` · `data: AvailabilityStreamEvent` = `{ developmentId, availabilityRevision, previousRevision, updatedAt, changedLots, resync, reason, lots: AvailabilityDto[] }` — somente campos públicos (`lotId, status, updatedAt, revision, reservedUntil, freshnessSource`; nunca `proposalId`/`notes`). Revisão e lotes saem do mesmo comando SQL (mesmo snapshot).
- Detecção: a migration 007 cria um gatilho em `developments.availability_revision` que faz `pg_notify('plat_availability', {developmentId, revision})`; o `PATCH` já incrementa essa revisão dentro da transação, então a notificação só sai no **COMMIT** (rollback e 409 não geram evento). Um único cliente do pool fica em `LISTEN` enquanto houver conexões abertas (liberado quando a última fecha; reconexão automática). Rede de segurança: verificação da revisão a cada `SSE_POLL_INTERVAL_MS` (5 s; `0` desliga; `SSE_LISTEN=false` usa só o poll).
- Retomada: `Last-Event-ID` (o `EventSource` envia ao reconectar) ou `?lastEventId=`: eventos com os lotes alterados desde essa revisão; igual à atual → nada; ausente → evento `reason: "INITIAL"`, `resync: true` com a revisão atual; à frente da atual → `REVISION_AHEAD`; mais de `SSE_MAX_LOTS_PER_EVENT` (500) lotes → `TOO_MANY_CHANGES`. `resync: true` = recarregue `GET …/availability`.
- Desconexão: `close` do cliente limpa timers e assinaturas; consumidor lento (> 1 MB pendente) é desconectado; `SSE_MAX_CLIENTS` (200) por processo → `503 STREAM_LIMIT_REACHED`; o desligamento do servidor encerra os fluxos abertos. Escala horizontal: cada instância tem seu próprio `LISTEN` (o NOTIFY chega a todas).

## 13. Identidade, permissões e organizações (1.3.0, tópicos 30/31)

Detalhes em [IAM_ARCHITECTURE.md](IAM_ARCHITECTURE.md) e [MULTI_TENANCY.md](MULTI_TENANCY.md).

- Pipeline de toda rota: rota/método → escrita habilitada? (403 `WRITES_DISABLED`) → **autenticação** (anônimo sem `Authorization`; 401 para credencial inválida) → **permissão da rota** (`src/modules/iam/routePolicies.js`; rota sem política e não marcada pública impede o servidor de subir) → **dono do recurso** lido do banco (`:developmentId` ou `:lotId`) → **decisão** (`src/modules/iam/authorization.js#decide`) → handler.
- Leituras de empreendimento `PUBLIC` são públicas (viva-juara); `PRIVATE` exige membership ativa + role com a permissão. Recurso de outra organização = 404 idêntico a inexistente.
- `GET /me` é o contrato do frontend (forma em IAM_ARCHITECTURE.md). Permissões no formato `recurso.ação` (`lot.price.view`, `price_table.publish`, `availability.write`, `customer_profile.manage`, `admin.audit.view`…).
- Credenciais: `ADMIN_API_TOKEN` = principal SYSTEM (plataforma, todas as organizações, ator `"admin"`, sem mudança para clientes 1.2); tokens `plat_dev_…` de usuário com `AUTH_DEV_TOKENS=true` (somente dev/test, recusado em produção). Escopo da idempotência: `admin` ou `user:<uuid>`.

## 14. Histórico de preço (1.3.0, tópico 28)

Somente leitura, derivado das versões publicadas e imutáveis (`price_tables` `PUBLISHED`/`ARCHIVED` + `lot_prices`); nunca editado, nunca nova fonte de preço. Série em degraus, sem interpolação; versão sem preço para o lote = ponto `MISSING` (lacuna, evento `REMOVED`), nunca zero nem queda. Variação absoluta/percentual nominal só com ≥ 2 versões comparáveis (mesmo `priceType` `LIST_PRICE` e moeda); senão `null` + `notCalculableReason`. Empreendimento: cesta dos mesmos lotes + mediana (sem média ingênua, sem efeito de mix). Texto sempre "preço de tabela"; nunca valorização do ativo, rentabilidade ou retorno. Detalhes: [PRICE_HISTORY_API.md](PRICE_HISTORY_API.md).

## 15. Disponibilidade independente do preço (1.3.0, tópico 29)

`GET /developments/{developmentId}/availability/manifest` é montado só do domínio Availability (revisão própria, checksum de `lotId:status:revision` ordenado por lote, contagens por status/atualidade/qualidade). Publicar tabela de preço não altera revisão, linhas nem manifesto de disponibilidade; mudar disponibilidade não cria versão de preço nem altera `lot_prices` (testes em `tests/availabilityIndependence.test.js`). UNKNOWN nunca é contado como AVAILABLE.
