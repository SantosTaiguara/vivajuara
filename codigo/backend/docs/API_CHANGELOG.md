# Changelog da API

Versionamento: a **versão da API** está no caminho (`/api/v1`); a **versão do contrato** (`info.version` do `openapi.json`, `CONTRACT_VERSION` em `src/shared/contracts/schemas.js`) segue SemVer dentro de v1. Mudanças aditivas (endpoint, campo, código de erro novo, parâmetro opcional) sobem o minor; nada é removido ou muda de tipo/significado dentro de `/api/v1`. Quebras vão para `/api/v2`. Política completa em [API_ARCHITECTURE.md §2](API_ARCHITECTURE.md#2-versionamento).

Não confundir: versão da API (`v1`) ≠ `schemaVersion` dos snapshots (`1.0`) ≠ `staticVersion` ≠ `analysisVersion` ≠ `priceTableVersion` ≠ `availabilityRevision`.

## 1.4.0 — 2026-10-16 (login Google OIDC + sessão por cookie, fase W3)

Decisões: provedor de identidade = **Google** (OIDC); organização = **`org_house7`**. Mudanças aditivas: clientes sem cookie e com `Authorization: Bearer` continuam idênticos (dev tokens seguem recusados em produção). Nenhum dado de lote, preço, score ou disponibilidade mudou.

### Adicionado

- `GET /api/v1/auth/google/start` (302 para o Google; state, nonce e PKCE S256 cifrados em cookie HttpOnly de 10 min), `GET /api/v1/auth/google/callback` (troca do code, verificação RS256 do ID token com o JWKS do Google: `iss`, `aud`, `exp`/`iat`, nonce de uso único, `email_verified`, `hd` opcional), `GET /api/v1/auth/session` (estado + `csrfToken`), `POST /api/v1/auth/logout`.
- Sessão no servidor (migração 010: `auth_sessions`, `auth_used_nonces`, `organization_invitations`): cookie `__Host-plat_session` (ou `plat_session` com `COOKIE_DOMAIN`) HttpOnly + Secure + SameSite=Lax, id opaco de 256 bits (só o sha256 é gravado), expiração por inatividade e absoluta, rotação a cada login.
- CSRF: escrita autenticada pelo cookie exige `X-CSRF-Token` → senão `403 CSRF_TOKEN_INVALID`. CORS com `Access-Control-Allow-Credentials: true` para as origens de `CORS_ORIGINS` quando o login está ativo; `X-CSRF-Token` aceito no preflight.
- Mapeamento do principal: conta Google sem convite = autenticada **sem** permissão de organização; convite por e-mail (`npm run iam -- invite --email … --org org_house7 --role …`) vira membership + role no login seguinte.
- `MeDto.principal.authenticationMethod` aceita `GOOGLE_OIDC`; `MeDto.identityProvider` = `{ status: CONFIGURED | NOT_CONFIGURED, mode: GOOGLE_OIDC | DEV_TOKEN | NONE }` (`PENDING_DECISION` não é mais emitido).
- Códigos de erro: `CSRF_TOKEN_INVALID` (403), `LOGIN_FAILED` (400), `LOGIN_DENIED` (403), `AUTH_NOT_CONFIGURED` (503). Esquemas `AuthRedirectResponse`, `AuthSessionResponse`, `AuthLogoutResponse`; esquema de segurança `cookieAuth`.
- Auditoria: `AUTH_LOGIN`, `AUTH_LOGIN_DENIED`, `AUTH_LOGOUT` (somente ids e código do motivo; nunca e-mail, nome ou token).

## Operacional (fora de `/api/v1`, sem mudança de contrato) — 2026-10-12 (tópicos 50/51, patches B2/B3)

- `GET /health/live` (schema `Live`): liveness mínima `{ "status": "ok" }`, sem versão nem dependências. `/health` e `/health/ready` não mudaram.
- Rate limit por categoria (`config/security/rateLimits.json`): além do limite global por IP, rotas de escrita/admin, busca, prévia de análise, exportação, upload, login e troca de token de compartilhamento têm limites próprios. Resposta continua `429 RATE_LIMITED` + `Retry-After` (mensagem genérica, sem citar a política).
- Respostas trazem `X-Correlation-Id`; o servidor aceita `traceparent` (W3C) e `X-Correlation-Id` em formato seguro. O `traceId` do corpo de erro continua sendo alias do `requestId`.
- Logs: redação central (credenciais, tokens, CPF, e-mail, telefone, notas) e sem `stack` em produção.

## 1.3.0 — 2026-10-08 (usuários e permissões, multi-tenant, histórico de preço, manifesto de disponibilidade)

Mudanças aditivas para clientes de empreendimentos PUBLIC (viva-juara continua respondendo os mesmos dados sem token). Ids, geometria, scores, classes, metodologia, preços (R$ 1.196/m², tabela 2026-10-06) e status (498 lotes UNKNOWN) não mudaram.

### Adicionado

- Endpoints:
  - `GET /api/v1/me` — principal atual (`MeDto`): tipo (`ANONYMOUS`/`USER`/`SYSTEM`), organização ativa, memberships, roles, `roleAssignments`, `permissions` efetivas, `developmentPermissions`, `publicPermissions`, `policyVersion`, estado do IdP (`PENDING_DECISION`). Sem token → 200 anônimo; token inválido → 401. Cabeçalho opcional `X-Organization-Id`.
  - `GET /api/v1/iam/registry` — PermissionRegistry (chaves, risco, escopos, `publicRead`), templates de role e permissões públicas.
  - `GET /api/v1/admin/audit-events` — auditoria da organização ativa (`admin.audit.view`), paginação por `?before=`.
  - `GET /api/v1/developments/{developmentId}/lots/{lotId}/price-history` — histórico do preço de tabela publicado do lote (`LotPriceHistoryDto`).
  - `GET /api/v1/developments/{developmentId}/pricing/history` — versões e mudanças do empreendimento pela cesta dos mesmos lotes (`DevelopmentPriceHistoryDto`).
  - `GET /api/v1/developments/{developmentId}/availability/manifest` — revisão, checksum, contagens por status/atualidade, sem preço (`AvailabilityManifestDto`).
- `DevelopmentDto.organizationId` (id opaco, ex.: `org_house7`) e `DevelopmentDto.visibility` (`PUBLIC`/`PRIVATE`).
- Autorização por rota (RoutePermissionMatrix, negação por padrão) e isolamento por organização: recurso de outra organização ou PRIVATE sem acesso responde 404 igual a inexistente; listagens (`GET /developments`, `POST /lots/batch-summary`) só trazem o que o principal pode ver.
- Credenciais: além de `ADMIN_API_TOKEN` (principal SYSTEM, inalterado), tokens de usuário `plat_dev_…` do DevTokenProvider com `AUTH_DEV_TOKENS=true` (somente desenvolvimento/teste; recusado em produção). Só o sha256 do token é armazenado. Emissão: `node scripts/iam.js`.
- Códigos de erro: `PERMISSION_DENIED` (403), `ORGANIZATION_NOT_FOUND` (404), `TENANT_CONTEXT_REQUIRED` (400).
- Schemas: `MeDto`/`MeResponse`, `PermissionDto`, `IamRegistryDto`/`Response`, `AuditEventDto`, `AuditMeta`, `AuditEventListResponse`, `PriceHistoryPoint`, `PriceInterval`, `PriceChangeEvent`, `LotPriceHistorySummary`, `PriceHistoryQuality`, `LotPriceHistoryDto`/`Response`, `DevelopmentPriceVersion`, `DevelopmentPriceChange`, `DevelopmentPriceHistoryDto`/`Response`, `AvailabilityManifestDto`/`Response`.
- CORS aceita `X-Organization-Id`; com algum provedor de credencial configurado as respostas trazem `Vary: Origin, Authorization, X-Organization-Id`; representações de empreendimento PRIVATE nunca são `public` (`Cache-Control: private, no-store`).
- Banco (migrations 008–009): `organizations` (+ organização base `org_house7` / `house-7` / "House 7 Imóveis"), `organization_domains` (fundação), `developments.organization_id` + `visibility`, `organization_id NOT NULL` com FK composta `(organization_id, development_id)` em lots, blocks, static_versions, sources, assets, analysis_versions, analysis_input_versions, price_tables, lot_availability, availability_history, import_runs; slug único por organização; `users`, `organization_memberships`, `roles`, `role_assignments`, `auth_tokens`; `audit_log.organization_id`, `actor_type`, `permission_key`, `outcome` e audit append-only.

### Alterado (compatível, mas observe)

- Quando o servidor tem uma credencial configurada (`ADMIN_API_TOKEN` ou `AUTH_DEV_TOKENS`), um cabeçalho `Authorization` inválido passa a responder 401 também em leituras (antes era ignorado). Sem credencial configurada o cabeçalho segue ignorado em leituras.
- Rotas de escrita: usuário autenticado sem a permissão → 403 `PERMISSION_DENIED`; recurso de outra organização → 404. A checagem de dono do recurso roda antes da validação do corpo: `PATCH` num lote inexistente responde 404 mesmo com corpo inválido.
- `audit_log`: campos de texto livre (`notes`) não são mais copiados para `old_value`/`new_value` (apenas `notesPresent`).

## 1.2.0 — 2026-10-08 (escrita administrativa, idempotência, publicação de tabela, prévia de análise, stream)

Somente mudanças aditivas: nenhum campo existente mudou de nome, tipo, unidade ou significado; ids, geometria, scores, classes, metodologia e preços da tabela corrente (R$ 1.196/m²) não mudaram.

### Adicionado

- Endpoints:
  - `POST /api/v1/developments/{developmentId}/price-tables` (admin) — publica uma nova versão de tabela de preço (`PublishPriceTableRequest`: `pricePerM2` e/ou `lotPrices`, `validFrom`/`validUntil` anuláveis, `version`, `changeReason`). Preço = área × R$/m² arredondado ao centavo, a mesma regra do frontend (`App.repos.CommercialRepository.commercialFor`); preço por lote deriva o R$/m² como `App.domain.updateLotCommercial`. Publicar cria versão imutável `PUBLISHED` (`publishedBy: "admin"`, `publishedAt`), copia os planos da tabela corrente, grava o preço de todos os lotes, arquiva a anterior (`ARCHIVED`, continua legível em `GET …/price-tables/{priceTableId}`) e move o ponteiro corrente — numa transação. `201` + `Location`. `?dryRun=true` devolve o mesmo cálculo com o diff por lote (`PriceTableDiff`) e não grava nada (`200`).
  - `POST /api/v1/developments/{developmentId}/analysis/preview` (admin) — roda o `IntelligenceEngine` do frontend no servidor sobre as medições armazenadas e devolve `App.methodology.impact(publicada, candidata)` (`AnalysisPreviewDto`), sem publicar; `publishedParity` confirma que a metodologia publicada reproduz a análise publicada armazenada.
  - `GET /api/v1/developments/{developmentId}/availability/stream` — Server-Sent Events: um evento `availability` (`id` = `availabilityRevision`, `data` = `AvailabilityStreamEvent`) a cada mudança de disponibilidade, só com campos públicos; `Last-Event-ID`/`?lastEventId=`, heartbeat, `retry:`.
- Autenticação das rotas de escrita: `Authorization: Bearer <ADMIN_API_TOKEN>` (sha256 + `crypto.timingSafeEqual`); sem `ADMIN_API_TOKEN` no servidor toda escrita responde `403 WRITES_DISABLED`. O `PATCH /lots/{lotId}/availability` passa pela mesma guarda. `audit_log.actor_id = "admin"`.
- `Idempotency-Key` (cabeçalho opcional) nas três rotas administrativas: mesma chave + mesma requisição → resposta armazenada reenviada com `Idempotent-Replayed: true`; corpo diferente → `409 IDEMPOTENCY_KEY_REUSED`; em execução → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`. Validade `IDEMPOTENCY_TTL_SECONDS` (padrão 24 h).
- Códigos de erro: `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `PRICE_TABLE_VERSION_EXISTS` (409), `INVALID_PRICE_TABLE`, `INVALID_METHODOLOGY` (422), `ANALYSIS_INPUT_NOT_FOUND` (404), `INTELLIGENCE_UNAVAILABLE`, `STREAM_LIMIT_REACHED` (503). Razões novas em `details[].reason` (ver API_ERRORS.md).
- Schemas: `PublishPriceTableRequest`, `PriceTablePublicationDto`/`Response`, `PriceTableDiff`, `PriceDiffItem`, `AnalysisPreviewRequest`, `AnalysisPreviewDto`/`Response`, `ImpactReport`, `MethodologyRef`, `PublishedParity`, `AvailabilityStreamEvent`. Componentes `IdempotencyKey`, `LastEventId`, cabeçalhos `Location` e `IdempotentReplayed`.
- Cabeçalhos: `WWW-Authenticate` no 401; CORS passa a aceitar `Idempotency-Key` e `Last-Event-ID` e expõe `Location` e `Idempotent-Replayed`.
- Banco (migrations 004–007): `idempotency_keys`; `price_tables.published_by`, `archived_at`, `change_reason`, `pricing_mode` (e `price_per_m2` anulável para tabela só por lote); `analysis_input_versions`/`lot_analysis_inputs` + `developments.current_analysis_input_version`; gatilho `NOTIFY plat_availability` na revisão de disponibilidade.
- Importador: guarda `analysis-input.json` (medições do motor, por `inputVersion`, imutável) quando presente; arquivo divergente dos lotes estáticos é rejeitado com aviso, sem afetar o resto.

### Alterado (compatível, mas observe)

- Escrita: a chave passou a ser `ADMIN_API_TOKEN`. `WRITES_ENABLED=true` **sem credencial** deixou de liberar escrita sem autenticação fora de produção (agora `403 WRITES_DISABLED`). `WRITES_ENABLED=true` + `WRITE_API_KEY` segue aceito como credencial legada (**deprecated**; ator `null` no `audit_log`); `WRITES_ENABLED=false` com token configurado desliga a escrita (chave de desligamento).
- A guarda de escrita roda antes da validação de parâmetros: um `PATCH` não autenticado com `lotId` malformado responde 401/403 (antes, 400).
- `openapi.json`: `/health/ready` passa a documentar `503 NOT_READY` (o gerador sobrescrevia a lista de 503).

### Pendente (decisão humana)

- `GET /api/v1/developments/{developmentId}/availability` (snapshot v1.0) e `GET /lots/{lotId}/availability/history` continuam expondo `proposalId` e `notes`, como na 1.0. Os DTOs públicos novos (`AvailabilityDto`, stream SSE, ficha) não expõem. Remover/proteger esses campos é quebra de contrato do `ApiLotSource` e aguarda decisão.

## 1.1.0 — 2026-10-07 (camada de API formal)

### Adicionado

- Endpoints:
  - `GET /api/v1/developments` (paginado) e `GET /api/v1/developments/{developmentId}` — `DevelopmentDto`.
  - `GET /api/v1/developments/{developmentId}/manifest` — versões correntes de todas as camadas (`ManifestDto`), para o cliente decidir o que revalidar.
  - `GET /api/v1/developments/{developmentId}/sources` — catálogo de fontes (mesmo conteúdo de `config.sources`).
  - `GET /api/v1/developments/{developmentId}/lots` — lista paginada com filtros canônicos (`status`, `block`, `minArea`/`maxArea`, `minPrice`/`maxPrice`, `class`, `minHousingScore`, `noiseLevel`, `privacyLevel`, `corner`, `search`), ordenação por whitelist (`code`, `price`, `areaM2`, `housingScore`, `distanceToGateM`) e `page`/`pageSize` (≤ 100).
  - `GET /api/v1/developments/{developmentId}/lots/search?q=` — busca com o parser central do frontend (`App.services.search.parse`): `79`, `B79`, `Q B L79`, `VJ-QB-L0079`, `QB`…
  - `POST /api/v1/lots/batch-summary` — até 100 ids por chamada (comparação, favoritos), ordem preservada, ids inexistentes em `meta.notFound`.
  - `GET /api/v1/lots/{lotId}/summary` — Quick View (`LotQuickViewDto`).
  - `GET /api/v1/lots/{lotId}/analysis` — scores, classe, critérios, alertas, destaques, ranking e `analysisVersion`.
  - `GET /api/v1/lots/{lotId}/commercial` — preço, tabela/versão e planos aplicáveis ao lote.
  - `GET /api/v1/lots/{lotId}/availability` — `AvailabilityDto` público (sem `notes`/`proposalId`).
  - `GET /api/v1/lots/{lotId}/provenance[?fieldKey=]` — proveniência por atributo (auditoria técnica).
  - `GET /api/v1/developments/{developmentId}/price-tables/{priceTableId}` — tabela publicada/arquivada por id.
- Envelope `{ data, meta }` nos endpoints novos; `meta` traz `apiVersion`, `requestId`, `generatedAt` e, conforme o recurso, `versions`, paginação, filtros aplicados e `unavailableLayers`.
- `GET /api/v1/lots/{lotId}`: campos novos `data` (`LotDetailDto` por seções, sem campos internos, com `provenanceSummary`) e `meta`.
- `map-lots`: cada lote ganhou `availabilityStatus` e `thematicValues` (scores por perfil, `noiseLevel`, `privacyLevel`, `estimatedTraffic`, `gateProximity`, `hasGreenRear`, `orientationRear`, `routeDistanceToLeisureM`, `frontBearingDeg`) para colorir o mapa sem baixar a análise completa.
- Erros: campos `requestId` e `timestamp`; `details[].reason`; códigos `INVALID_FILTER` (400/422), `INVALID_FIELD_KEY`, `DEVELOPMENT_NOT_FOUND`, `LOT_NOT_FOUND`, `PRICE_TABLE_NOT_FOUND`, `ANALYSIS_NOT_FOUND`, `STATIC_VERSION_NOT_FOUND`, `INVALID_AVAILABILITY_TRANSITION`. `409 REVISION_CONFLICT` traz `currentRevision`.
- `Retry-After` em todo 503 (`DATABASE_UNAVAILABLE`, `NOT_READY`, `REQUEST_TIMEOUT`) além do 429.
- Compressão brotli (preferida quando aceita), além de gzip.
- `GET /health`: campo `timestamp`.
- `PATCH /lots/{lotId}/availability` (continua **desabilitado por padrão**): a resposta ganhou `status`, `revision` e `updatedAt` no nível superior.
- Validação de saída: toda resposta com schema declarado é validada contra o contrato publicado antes de sair (fora de produção por padrão; `VALIDATE_RESPONSES`).
- `openapi.json` gerado a partir do código (`npm run openapi`; `npm run openapi:check` no CI) e testado contra as rotas registradas.

### Alterado (compatível, mas observe)

- Os 404 agora usam códigos semânticos (`LOT_NOT_FOUND`, `DEVELOPMENT_NOT_FOUND`, `PRICE_TABLE_NOT_FOUND`, `ANALYSIS_NOT_FOUND`, `STATIC_VERSION_NOT_FOUND`); `NOT_FOUND` ficou só para rota inexistente. O status HTTP não mudou.
- `INVALID_TRANSITION` → `INVALID_AVAILABILITY_TRANSITION` (o código antigo segue em `details.reason`). O status (422) não mudou. Só afeta a escrita, que está desligada por padrão.
- Filtros/ordenação/paginação inválidos em endpoints de lista respondem `INVALID_FILTER` (400 malformado / 422 semântico); parâmetro desconhecido continua `400 VALIDATION_ERROR`.

### Deprecated (removidos somente em `/api/v2`)

- `traceId` nos erros → use `requestId`.
- `lot` e `versions` no nível superior de `GET /lots/{lotId}` → use `data` e `meta.versions`.
- `status` em `map-lots` → use `availabilityStatus`.
- `details[].issue` → use `details[].reason`.

### Sem mudança

- Snapshots (`/lots/static`, `/analysis/current`, `/commercial/current`, `/availability`), `/config`, `/assets`, `/commercial/price-tables/current` e `/lots/{lotId}/availability/history`: mesmo formato da 1.0 (contrato do `ApiLotSource` do frontend). Nenhum valor de dado (ids, geometria, scores, classes, rankings, preços) mudou.

## 1.0.0-alpha

Primeira versão (tópico 9): snapshots por camada, `map-lots`, `/lots/{lotId}`, `/config`, `/assets`, histórico e `PATCH` de disponibilidade, erros `{ code, message, details, traceId }`, ETag/304 e classes de cache.
