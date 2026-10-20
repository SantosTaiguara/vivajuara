# Erros da API `/api/v1`

Fonte de verdade: `ERROR_CATALOG` em [`src/shared/http/errors.js`](../src/shared/http/errors.js), publicado também em `openapi.json` (`x-error-catalog` e `components.schemas.ApiError.properties.code.enum`). O teste `tests/backend/api.openapi.test.js` falha se este documento deixar de listar um código do catálogo ou se uma rota documentar um código/status fora dele.

## Formato (ApiError)

Toda resposta de erro (4xx/5xx) tem **o mesmo corpo**, `Content-Type: application/json`, `Cache-Control: no-store`, **sem** `ETag`, e o cabeçalho `X-Request-Id`:

```json
{
  "code": "INVALID_FILTER",
  "message": "Parâmetros de consulta inválidos",
  "details": [
    { "field": "minPrice", "reason": "range_inverted", "issue": "range_inverted", "min": 400000, "max": 300000, "pairedWith": "maxPrice" }
  ],
  "requestId": "e3652d73-237c-4813-83ba-59998ca6c543",
  "traceId": "e3652d73-237c-4813-83ba-59998ca6c543",
  "timestamp": "2026-10-07T15:56:57.971Z"
}
```

| Campo | Regra |
|---|---|
| `code` | Código semântico estável (tabela abaixo). Clientes decidem pelo `code`; um código desconhecido deve cair no tratamento genérico do status HTTP. |
| `message` | Texto legível em pt-BR, para exibição/diagnóstico. **Não** é contrato: pode mudar sem versão nova. |
| `details` | `null`, uma lista de problemas `[{ field, reason, ... }]` (validação) ou um objeto de contexto (`{ lotId }`, `{ developmentId }`…). `issue` é alias de `reason` mantido para clientes v1.0. |
| `requestId` | Igual ao cabeçalho `X-Request-Id`. Use-o para correlacionar com o log do servidor. |
| `traceId` | **Deprecated** — alias de `requestId` mantido do contrato v1.0. Removido em `/api/v2`. |
| `timestamp` | ISO 8601 UTC (`…Z`) do momento do erro. |

Campos extras de nível superior existem apenas onde documentado: `currentRevision` em `REVISION_CONFLICT`.

Cabeçalhos de erro além de `X-Request-Id`: `Retry-After` (429, todo 503 e `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`), `Allow` (405), `WWW-Authenticate: Bearer realm="plat-api"` (401). O token administrativo nunca aparece em corpo de erro nem no log.

Garantias (§56, §88): nunca há stack trace, SQL, nome de tabela, caminho de arquivo, mensagem do driver do banco ou segredo no corpo; o detalhe técnico vai só para o log (JSON, com `requestId`, `route` como template e `errorCode`). Um erro nunca é cacheável (`no-store`, sem `ETag`).

## Status × código

| Código | HTTP | Quando |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Parâmetro de rota malformado (`lotId`, `developmentId`, `priceTableId`), parâmetro de consulta **desconhecido** (allowlist por rota), corpo inválido (tipo, obrigatório, campo desconhecido — inclusive `__proto__`/`constructor`), `X-Request-Id`/cabeçalho inválido. |
| `INVALID_FILTER` | 400 / 422 | Filtros, ordenação e paginação de `/lots`, `/lots/search`, `/developments`. **400** quando malformado (tipo errado, formato, valor vazio, parâmetro repetido, texto longo demais); **422** quando bem formado mas semanticamente inválido (valor fora do enum, abaixo do mínimo/acima do máximo, lista longa demais, `min > max`, `sortBy` fora da whitelist). |
| `INVALID_FIELD_KEY` | 422 | `fieldKey` bem formado mas inexistente no Field Registry (`/lots/{lotId}/provenance?fieldKey=`). |
| `UNAUTHORIZED` | 401 | **Não autenticado** ("quem é você?" sem resposta): rota de escrita/administrativa sem `Authorization: Bearer <token>`; ou, em qualquer rota (inclusive leitura e `GET /me`) quando o servidor tem um provedor de credenciais configurado, cabeçalho `Authorization` com outro esquema, token desconhecido, expirado, revogado ou de usuário não `ACTIVE`. Verificado **antes** de ler parâmetros e corpo. Sem `Authorization` uma leitura de empreendimento PUBLIC segue anônima (200). |
| `CSRF_TOKEN_INVALID` | 403 | Escrita (POST/PATCH) autenticada pelo **cookie de sessão** do login Google sem `X-CSRF-Token` válido. O token vem de `GET /api/v1/auth/session` e só pode ser lido por origens permitidas. Credenciais `Authorization: Bearer` não usam cookie e não precisam dele. Em rota pública não protegida (ex.: `POST /lots/batch-summary`) a requisição sem token roda como anônima em vez de falhar. |
| `LOGIN_FAILED` | 400 | Retorno do Google inválido: state ausente/expirado/diferente, `code` ausente, troca do code recusada, ID token inválido (assinatura, `iss`, `aud`, `exp`/`iat`) ou nonce reutilizado. Com URL de retorno configurada, o navegador volta ao painel com `?login=erro` em vez deste JSON. Motivo detalhado só na auditoria (`AUTH_LOGIN_DENIED`) e no log. |
| `LOGIN_DENIED` | 403 | Conta Google autenticada, mas recusada pela política: e-mail não verificado, domínio (`hd`) fora de `ALLOWED_HD` ou usuário suspenso/desativado. No painel: `?login=negado`. |
| `PERMISSION_DENIED` | 403 | **Autenticado, mas sem permissão** ("o que você pode fazer?" negado): a permissão da rota (`details.permission`, ex.: `price_table.publish`, `availability.write`, `admin.audit.view`) não está concedida ao principal no escopo do recurso (organização ou empreendimento). Negação por padrão. Negações de permissões HIGH/CRITICAL ficam no `audit_log` (`outcome = DENIED`). |
| `TENANT_CONTEXT_REQUIRED` | 400 | Rota de organização (`GET /admin/audit-events`) sem organização ativa: usuário com mais de uma membership precisa enviar `X-Organization-Id`. |
| `ORGANIZATION_NOT_FOUND` | 404 | `X-Organization-Id` inexistente ou sem membership ativa do principal — mesma resposta nos dois casos (não revela se a organização existe). |
| `WRITES_DISABLED` | 403 | Escrita desligada no ambiente: `ADMIN_API_TOKEN` não configurado (**padrão**) ou `WRITES_ENABLED=false` (chave de desligamento). Vale para `PATCH /lots/{lotId}/availability`, `POST /developments/{developmentId}/price-tables` e `POST /developments/{developmentId}/analysis/preview`, mesmo com token no pedido. |
| `CORS_ORIGIN_DENIED` | 403 | Preflight de origem fora de `CORS_ORIGINS`. |
| `NOT_FOUND` | 404 | Rota inexistente. |
| `DEVELOPMENT_NOT_FOUND` | 404 | `developmentId` bem formado, mas inexistente **ou** pertencente a outra organização / privado sem acesso do principal (isolamento multi-tenant: a resposta é idêntica, a existência não vaza). |
| `LOT_NOT_FOUND` | 404 | `lotId` bem formado, mas inexistente. |
| `PRICE_TABLE_NOT_FOUND` | 404 | Tabela inexistente, em rascunho (DRAFT), de outro empreendimento, ou empreendimento sem tabela corrente. |
| `ANALYSIS_INPUT_NOT_FOUND` | 404 | `POST …/analysis/preview`: o empreendimento não tem medições de entrada do motor (`analysis-input.json`) importadas. |
| `ANALYSIS_NOT_FOUND` | 404 | Empreendimento sem versão de análise publicada (somente nos endpoints **dedicados** à análise; os demais respondem com falha parcial — ver abaixo). |
| `STATIC_VERSION_NOT_FOUND` | 404 | Empreendimento sem versão estática publicada (não há lotes para responder). |
| `METHOD_NOT_ALLOWED` | 405 | Método não suportado na rota; o cabeçalho `Allow` lista os aceitos. |
| `REVISION_CONFLICT` | 409 | `expectedRevision` diferente da revisão atual (concorrência otimista). Traz `currentRevision` no nível superior. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | `Idempotency-Key` já usada (dentro da validade, pela mesma credencial) com outra requisição: método, caminho, consulta ou corpo diferentes. `details`: `{ idempotencyKey, method, route, expiresAt }`. Gere uma chave nova. |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 | A primeira execução com a mesma `Idempotency-Key` ainda não terminou. `Retry-After: 1`; repita com a mesma chave e o mesmo corpo para receber a resposta armazenada. |
| `PRICE_TABLE_VERSION_EXISTS` | 409 | `POST …/price-tables` com `version` (ou `id`) já existente: versões publicadas são imutáveis. `details.existing` lista as tabelas em conflito. Em `dryRun=true` não é erro: `data.wouldConflict = true`. |
| `PAYLOAD_TOO_LARGE` | 413 | Corpo acima de `BODY_LIMIT_BYTES` (padrão 16 KB). A conexão é fechada. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Corpo sem `Content-Type: application/json`. |
| `INVALID_AVAILABILITY_TRANSITION` | 422 | Transição de status recusada pela máquina de estados compartilhada (`App.availability`). `details.reason` traz o motivo original (`INVALID_TRANSITION`). |
| `INVALID_STATE` | 422 | O estado de disponibilidade resultante seria inválido pela validação compartilhada (`App.availability.validateState`; ex.: `reservedUntil` fora de `RESERVED`, data inválida). |
| `FIELD_NOT_ALLOWED` | 422 | Campo do comando não se aplica ao status informado. |
| `INVALID_PRICE_TABLE` | 422 | Tabela de preço bem formada mas inválida: lote inexistente (`lot_not_found`) ou repetido (`duplicate_lot`), lotes sem preço numa tabela só por lote (`lots_without_price`), `validUntil` anterior a `validFrom` (`before_valid_from`), `sourceId` inexistente (`unknown_source`), empreendimento sem tabela corrente com planos para copiar (`no_payment_plans`) ou **qualquer campo de geometria/área** no corpo (`immutable_field`: `areaM2`, `polygon`, `centroid`, …) — tabela de preço nunca altera geometria nem área. |
| `INVALID_METHODOLOGY` | 422 | `POST …/analysis/preview`: metodologia candidata reprovada por `App.methodology.validate` (`details[].reason` = código original: `NEGATIVE_WEIGHT`, `WEIGHT_SUM`, `UNKNOWN_NORMALIZER`, `CYCLE`, …) ou de outro empreendimento (`DEVELOPMENT_MISMATCH`). |
| `RATE_LIMITED` | 429 | Limite por IP excedido. Cabeçalho `Retry-After` (segundos). |
| `INTERNAL_ERROR` | 500 | Erro inesperado **ou violação do contrato de saída** (DTO que não passa no schema publicado — ver API_ARCHITECTURE §6). Nenhum corpo parcial é enviado. |
| `DATABASE_UNAVAILABLE` | 503 | Banco indisponível. Cabeçalho `Retry-After`. |
| `AUTH_NOT_CONFIGURED` | 503 | `GET /auth/google/start` ou `/callback` num ambiente sem login Google configurado (`GOOGLE_CLIENT_ID` vazio). |
| `NOT_READY` | 503 | `/health/ready` com banco indisponível. Cabeçalho `Retry-After`. |
| `REQUEST_TIMEOUT` | 503 | A requisição excedeu `REQUEST_TIMEOUT_MS`. Cabeçalho `Retry-After`. |
| `INTELLIGENCE_UNAVAILABLE` | 503 | `POST …/analysis/preview` num servidor sem o motor de inteligência carregado (`plat/src/intelligence/*.js` com erro ou ausentes) ou sem metodologia publicada em `plat/config/scoring/<empreendimento>`. Cabeçalho `Retry-After`. |
| `STREAM_LIMIT_REACHED` | 503 | `GET …/availability/stream` com `SSE_MAX_CLIENTS` conexões abertas no processo. Cabeçalho `Retry-After`; o `EventSource` reconecta sozinho. |

`Retry-After` em 503 vale `RETRY_AFTER_SECONDS` (padrão 5); em 429, o tempo restante da janela do rate limit.

## Razões (`details[].reason`)

| reason | Status | Significado |
|---|---|---|
| `unknown` | 400 `VALIDATION_ERROR` | Parâmetro de consulta fora da allowlist (`allowed` lista os aceitos). |
| `format` | 400 `VALIDATION_ERROR` | Identificador fora do padrão (`expected`). |
| `unknown_field`, `required`, `not_nullable`, `type`, `min_items`, `max_items`, `invalid_items`, `enum`, `min`, `max`, `maxLength` | 400 `VALIDATION_ERROR` | Validação de corpo. |
| `not_positive`, `not_finite`, `max_2_decimals`, `max_4_decimals`, `range`, `exactly_one_of` | 400 `VALIDATION_ERROR` | Corpo de `POST …/price-tables` / `…/analysis/preview`: valor monetário zero/negativo, não finito (ex.: `1e400`), com mais de 2 casas; fração fora de 0..1; item de `lotPrices` sem exatamente um de `price`/`pricePerM2`. `Idempotency-Key` e `Last-Event-ID` malformados usam `format`. |
| `immutable_field`, `lot_not_found`, `duplicate_lot`, `lots_without_price`, `before_valid_from`, `unknown_source`, `no_payment_plans` | 422 `INVALID_PRICE_TABLE` | Ver `INVALID_PRICE_TABLE`. |
| `invalid_type`, `invalid_format`, `empty`, `empty_item`, `repeated`, `too_long` | 400 `INVALID_FILTER` | Filtro malformado. |
| `invalid_enum`, `below_min`, `above_max`, `too_many_items`, `range_inverted` | 422 `INVALID_FILTER` | Filtro semanticamente inválido. |

## Falha parcial não é erro

Se a camada de análise ou a comercial não estiver publicada, `map-lots`, `/lots`, `/lots/search`, `/lots/{lotId}`, `/summary` e `batch-summary` respondem **200** com `class: "UNKNOWN"` e scores/preços `null` — nunca `0`; em `/lots`, `/lots/search`, `/lots/{lotId}` e `/summary`, `meta.unavailableLayers` lista as camadas ausentes (`["analysis"]`, `["commercial"]`) e em `map-lots` o ponteiro correspondente em `versions` vem `null`. Disponibilidade sem dado é sempre `UNKNOWN`, nunca `AVAILABLE`.

## Escrita, idempotência e stream (contrato 1.2)

Ordem de verificação numa rota administrativa: rota/método → **guarda de escrita** (403 `WRITES_DISABLED`) → **autenticação** (401 `UNAUTHORIZED`) → **permissão da rota** (403 `PERMISSION_DENIED`) → **dono do recurso + escopo/tenant** (404 do recurso quando é de outra organização; 403 `PERMISSION_DENIED` quando visível mas sem permissão no escopo) → `Idempotency-Key` (formato 400; corpo lido uma vez, 413/415/400) → reenvio armazenado ou 409 de idempotência → parâmetros e corpo do comando (400/422) → regra de negócio (404/409/422). Somente respostas 2xx ficam armazenadas; um erro libera a chave (o cliente corrige e repete com a mesma chave). Erros do stream SSE só acontecem **antes** de abrir o fluxo (400/404/503 em JSON); depois disso o fluxo é encerrado sem corpo de erro e o cliente reconecta com `Last-Event-ID`.

## Mudanças em relação à v1.0

Ver [API_CHANGELOG.md](API_CHANGELOG.md): os 404 passaram a ter código semântico (`LOT_NOT_FOUND`, `DEVELOPMENT_NOT_FOUND`, …) e `INVALID_TRANSITION` passou a `INVALID_AVAILABILITY_TRANSITION`. Clientes que tratavam `NOT_FOUND` devem tratar **qualquer 404** como "não encontrado".

## 401 × 403 × 404 (tópicos 30/31, API 1.3.0)

| Situação | Resposta |
|---|---|
| Sem `Authorization`, leitura de empreendimento PUBLIC | 200 (principal anônimo) |
| Sem `Authorization`, rota que exige autenticação (escrita, `/admin/*`) ou recurso PRIVATE | 401 `UNAUTHORIZED` (recurso PRIVATE: 404, ver abaixo) |
| Token inválido / expirado / revogado / usuário suspenso | 401 `UNAUTHORIZED` |
| Autenticado, sem a permissão em nenhum escopo | 403 `PERMISSION_DENIED` |
| Autenticado, empreendimento da própria organização, sem a permissão naquele escopo | 403 `PERMISSION_DENIED` |
| Empreendimento/lote de outra organização (ou PRIVATE sem `development.view`) | 404 `DEVELOPMENT_NOT_FOUND` / `LOT_NOT_FOUND` — idêntico a inexistente |
| `X-Organization-Id` sem membership | 404 `ORGANIZATION_NOT_FOUND` |

## Módulos da rodada 5 (tópicos 57–63) — somente com a flag ligada

Códigos emitidos apenas pelas rotas de um módulo cuja flag `FEATURE_*` está ligada (todas desligadas por padrão; ver [RELATORIO_LIGACAO_ROTAS_57_63.md](RELATORIO_LIGACAO_ROTAS_57_63.md)). Com todas as flags desligadas o servidor nunca os emite. No `openapi.json` aparecem em `x-error-catalog` com `x-feature-flag`; o enum completo de `ApiError.code` e as rotas estão em `openapi.features.json`.

Permissões dessas rotas: concessão explícita — OWNER_ADMIN (decisão de 2026-10-18), demais papéis 403 `PERMISSION_DENIED`, anônimo 401 `UNAUTHORIZED`, `ADMIN_API_TOKEN` (principal de plataforma, sem papel) 403. Política de negócio/jurídica nula → recusa com código do módulo (ex.: `POLICY_NOT_CONFIGURED`).

### FEATURE_DEALS

| Código | HTTP | Significado |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Escrita crítica exige Idempotency-Key. |
| `APPROVAL_SELF_DECISION_FORBIDDEN` | 403 | Quem pediu a aprovação não pode decidi-la (separação de funções). |
| `PROPOSAL_NOT_FOUND` | 404 | Proposta inexistente. |
| `RESERVATION_NOT_FOUND` | 404 | Reserva inexistente. |
| `CLOSING_NOT_FOUND` | 404 | Fechamento inexistente. |
| `CONTRACT_NOT_FOUND` | 404 | Contrato inexistente. |
| `APPROVAL_NOT_FOUND` | 404 | Pedido de aprovação inexistente. |
| `CHECKLIST_ITEM_NOT_FOUND` | 404 | Item do checklist inexistente. |
| `CUSTOMER_NOT_FOUND` | 422 | Proposta transacional exige cliente cadastrado (persistido). |
| `POLICY_NOT_CONFIGURED` | 422 | Política comercial não configurada pela organização (necessita confirmação). |
| `COMMERCIAL_AUTHORITY_NOT_CONFIGURED` | 422 | Autoridade do domínio comercial não definida (CommercialAuthorityMatrix necessita confirmação). |
| `COMMERCIAL_AUTHORITY_EXTERNAL` | 409 | Este domínio é mantido por sistema externo: a plataforma não grava o estado oficial. |
| `PRICE_CONTEXT_INVALID` | 422 | Sem preço de tabela vigente para o lote. |
| `PROPOSAL_INVALID` | 422 | Proposta inválida: veja blockingErrors. |
| `PROPOSAL_EXPIRED` | 422 | Proposta expirada: reemita uma nova versão ou nova proposta. |
| `PROPOSAL_VERSION_CONFLICT` | 409 | A versão informada não é a versão corrente da proposta. |
| `PROPOSAL_NOT_ACCEPTABLE` | 422 | A proposta não pode ser aceita neste estado. |
| `PROPOSAL_CONCURRENCY_CONFLICT` | 409 | Já existe proposta ativa para este lote (política de concorrência). |
| `INVALID_PROPOSAL_TRANSITION` | 422 | Transição de proposta não permitida. |
| `PROPOSAL_VERSION_IMMUTABLE` | 409 | Versão emitida é imutável: crie nova versão. |
| `COMMERCIAL_APPROVAL_REQUIRED` | 422 | Condição exige aprovação comercial antes de prosseguir. |
| `REASON_CODE_REQUIRED` | 422 | Informe um código de motivo do registro. |
| `LOT_NOT_AVAILABLE` | 409 | Lote não está disponível para reserva. |
| `LOT_AVAILABILITY_UNKNOWN` | 409 | Disponibilidade do lote sem informação: confirme com a fonte oficial antes de reservar. |
| `LOT_ALREADY_RESERVED` | 409 | Lote já reservado. |
| `AVAILABILITY_REVISION_CONFLICT` | 409 | A disponibilidade mudou desde a leitura (expectedAvailabilityRevision): recarregue. |
| `AVAILABILITY_STALE` | 409 | Disponibilidade desatualizada para ação crítica: atualize antes. |
| `RESERVATION_EXPIRED` | 409 | Reserva expirada. |
| `RESERVATION_EXPIRY_INVALID` | 422 | Prazo da reserva inválido ou acima do máximo da política. |
| `RESERVATION_EXTENSION_NOT_ALLOWED` | 422 | Extensão de reserva não permitida pela política. |
| `INVALID_RESERVATION_TRANSITION` | 422 | Transição de reserva não permitida. |
| `CLOSING_REQUIREMENTS_INCOMPLETE` | 422 | Requisitos do fechamento incompletos. |
| `INVALID_CLOSING_TRANSITION` | 422 | Transição de fechamento não permitida. |
| `CONTRACT_TEMPLATE_NOT_APPROVED` | 422 | Modelo de contrato não aprovado/versionado pela organização. |
| `CONTRACT_VARIABLES_UNRESOLVED` | 422 | Variáveis obrigatórias do modelo não resolvidas. |
| `CONTRACT_NOT_READY` | 422 | Contrato não está pronto para esta operação. |
| `CONTRACT_VERSION_IMMUTABLE` | 409 | Versão de contrato emitida/assinada é imutável: crie nova versão. |
| `SIGNATURE_INCOMPLETE` | 422 | Assinatura não confirmada pelo provedor. |
| `SIGNATURE_WEBHOOK_INVALID` | 401 | Webhook de assinatura com verificação inválida. |
| `SALE_COMPLETION_REQUIREMENTS_NOT_MET` | 422 | Requisitos da conclusão de venda não atendidos. |
| `SALE_ALREADY_COMPLETED` | 409 | Venda concluída não pode ser reaberta nem alterada. |

### FEATURE_PRIVACY

| Código | HTTP | Significado |
|---|---|---|
| `PRIVACY_RULE_DENIED` | 422 | Regra de privacidade recusou a operação (sem base legal validada, aviso/checksum, verificação de identidade, transição, motivo de recusa…); código do domínio em details.reason. Não é parecer jurídico. |

### FEATURE_ONBOARDING

| Código | HTTP | Significado |
|---|---|---|
| `CONFLICT` | 409 | Conflito de estado/revisão/duplicata no onboarding (código do domínio em details.reason: SOURCE_DUPLICATE, REVISION_CONFLICT, IDEMPOTENCY…). |

### FEATURE_BACKOFFICE

| Código | HTTP | Significado |
|---|---|---|
| `ADMIN_COMMAND_REJECTED` | 422 | Comando administrativo recusado pela política (ação desconhecida/não suportada, política nula = necessita confirmação, bloqueio); motivo em details.reasonCode. |

### FEATURE_SURROUNDINGS

| Código | HTTP | Significado |
|---|---|---|
| `GOOGLE_MAPS_NOT_CONFIGURED` | 503 | Entorno ainda não configurado para este empreendimento. |
| `GOOGLE_MAPS_LOCATION_UNVERIFIED` | 409 | Coordenada oficial do empreendimento ainda não validada. |
| `GOOGLE_PLACES_UNAVAILABLE` | 503 | Dados do entorno temporariamente indisponíveis. |
| `GOOGLE_PLACES_QUOTA_EXCEEDED` | 503 | Dados do entorno temporariamente indisponíveis. |
| `GOOGLE_PLACES_INVALID_REQUEST` | 502 | Dados do entorno temporariamente indisponíveis. |
| `GOOGLE_ROUTES_UNAVAILABLE` | 503 | Não foi possível calcular o trajeto agora. |
| `GOOGLE_ROUTES_QUOTA_EXCEEDED` | 503 | Não foi possível calcular o trajeto agora. |
| `GOOGLE_PROVIDER_AUTH_ERROR` | 503 | Dados do entorno temporariamente indisponíveis. |
| `GOOGLE_PROVIDER_RATE_LIMIT` | 503 | Dados do entorno temporariamente indisponíveis. |
| `LOCATION_CATEGORY_UNSUPPORTED` | 422 | Categoria de entorno não suportada. |
| `LOCATION_RADIUS_INVALID` | 422 | Raio não permitido. Use 2, 4, 6 ou 8 km. |
| `LOCATION_PLACE_NOT_IN_SCOPE` | 422 | Este local não foi retornado por uma busca do entorno deste empreendimento. Refaça a busca. |
| `LOCATION_POLICY_NOT_CONFIGURED` | 409 | Política de validação de coordenada ainda não definida. |
| `LOCATION_CHANGE_INVALID` | 422 | Alteração de coordenada inválida. |
| `LOCATION_RATE_LIMITED` | 429 | Muitas consultas ao entorno; tente novamente em instantes. |
