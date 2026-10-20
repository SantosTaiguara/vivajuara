# Observabilidade de API e banco (contratos)

O servidor (`backend/`) já tem: logger JSON (`src/shared/logging/logger.js`), `X-Request-Id` aceito ou gerado (`requestIdOf`), um log `request` por requisição com requestId, rota-modelo, status, duração e errorCode, corpo de erro `{ code, message, details, requestId, traceId, timestamp }` sem pilha, `/health` e `/health/ready`.

Este tópico **não altera** `backend/src/app.js` (os testes de banco não rodam aqui; senha do Postgres pendente). Entrega um helper puro, testado: `backend/src/shared/observability/telemetry.js`.

## RED (Rate, Errors, Duration)

| Métrica | Labels |
|---|---|
| api_requests_total | endpoint_group, method, status_class |
| api_errors_total | endpoint_group, method, status_class, error_category |
| api_request_duration_ms (p50/p95/p99) | endpoint_group, method, status_class |
| api_request_size_bytes / api_response_size_bytes | endpoint_group, method |
| rate_limit_rejections_total | endpoint_group |

`endpoint_group` vem do **modelo da rota** (`GET /v1/developments/:id/lots/:lotId` → `developments.lots`), nunca do caminho real (sem IDs de lote em label). `createRedMetrics().prometheus()` produz o texto para um `/metrics` **protegido** (decisão O1).

## Ligação sugerida no servidor (quando aprovado)

```js
const T = require('./shared/observability/telemetry');
const red = T.createRedMetrics();
// no início da requisição: const octx = T.contextFromHeaders(req.headers, requestId); res.setHeader('traceparent', T.formatTraceparent(octx));
// no 'finish': red.record({ route, method: req.method, status: res.statusCode, durationMs: duration });
//              logger[level]('request', T.redactFields({ requestId, correlationId: octx.correlationId, traceId: octx.traceId, method, route, statusCode, duration, errorCode }));
```

## Banco

Métricas de contrato: `db_query_duration_ms{query_group}`, `db_pool_utilization`, `db_timeouts_total`, `db_deadlocks_total`, `db_slow_queries_total{query_group}`, `db_transaction_rollbacks_total`, `db_migration_duration_ms{outcome}`. SQL nunca é logado com valores; `query_group` é um nome controlado (ex.: `lots.by_id`). Limite de consulta lenta configurável (a definir). Spans `repository.query` sem payload.

## Dependências externas

`dependency_request_duration_ms{dependency,outcome}`, `dependency_timeouts_total{dependency,timeout_kind=CLIENT|SERVER|DEPENDENCY}`, `circuit_breaker_state{dependency}` (0 fechado, 1 meio-aberto, 2 aberto). Dependências: auth provider, storage, e-mail, webhook, fonte geoespacial, terceiros — nome controlado `[a-z0-9_]`.

## Erros da API

Padrão já cumprido: `errorCode`, `message`, `requestId`, sem pilha para o cliente (§43–44). Pendência: `traceId` do corpo é alias do requestId (compatibilidade v1); quando houver tracing, o W3C traceId deve ser distinto.
