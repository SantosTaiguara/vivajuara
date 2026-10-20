# Relatório de migração da observabilidade legada

Inventário completo (LegacyObservabilityInventory): `docs/OBSERVABILITY_LEGACY_INVENTORY.json` (17 itens). Busca em `plat/src` e `plat/backend/src` por console.*, captureException, Sentry, Datadog, NewRelic, OpenTelemetry, trace, span, metric, prometheus, health, requestId, correlationId, logger, pino, winston.

## Antes

| Pilar | Situação encontrada |
|---|---|
| Logs (navegador) | 34 chamadas `console.*`: 21 `console.error(e)` no app.js, 1 no map.js, erros de assinantes em store/offline/repositories/loading; `console.warn/info` só com `App.debug` (apiSource, repositories, lifecycle). Nenhum `console.log`. Nenhuma chamada passa token, senha, cookie ou corpo (teste). |
| Logs (servidor) | logger JSON estruturado, sem eventCode estável nem redaction central; log `request` por requisição (INFO). |
| Métricas | ricas, mas espalhadas: geo/perf.js (mapa), LoadCoordinator (carga), CacheManager (cache), analytics (produto). Nenhum registro único, nenhuma métrica de servidor. |
| Tracing | nenhum. `traceId` do servidor é alias do requestId. |
| Erros | sem reporter, sem fingerprint, sem código de suporte. |
| Health | `/health` (público, com versão) e `/health/ready` (banco). |
| Alertas / SLO / runbooks | nenhum. |
| SDK de terceiros | nenhum. |

## Depois

| Pilar | Situação |
|---|---|
| Contexto e IDs | ObservabilityContext, requestId/correlationId/traceId/spanId/errorId/supportCode distintos; propagação só para mesma origem. |
| Logs | StructuredLogger com eventCode registrado, níveis por ambiente, redaction, buffer com prioridade, console só em development. |
| Erros | taxonomia de 30 códigos, ErrorReporter com fingerprint/dedupe/limite, Error Boundaries, handlers globais. |
| Métricas | registro de 85 métricas com donos e labels controlados; coletores que reaproveitam geo/perf.js, LoadCoordinator e CacheManager. |
| Tracing | tracer W3C com amostragem que sempre guarda erros; 19 spans registrados. |
| Saúde | live/ready/conectividade/dependências e atualidade dos dados no aparelho; contrato de /health/live, /health/details, /health/connectivity. |
| SLO/alertas | 6 SLOs propostos, 18 alertas com runbook (13 runbooks), avaliação local sem paging. |
| Suporte | snapshot sanitizado e botão "Copiar diagnóstico técnico". |
| Servidor | helper puro testado (traceparent, correlação, redaction, RED, Prometheus, live). |

## Ações por item

| Item | Ação | Estado |
|---|---|---|
| app.js `console.error(e)` (21×) | REPLACE por `App.observability.platform.report(e, area)` | pendente: arquivo do coordenador (receita no relatório) |
| map.js geo pipeline | REPLACE por `report(e, 'MapRenderer')` | pendente: arquivo do mapa não editado |
| assinantes (store, offline, repositories, loading) | REPLACE quando os módulos forem tocados | pendente, risco baixo |
| apiSource logError | STANDARDIZE como API_REQUEST_FAILED | pendente |
| repositories lotes rejeitados | REVIEW → métrica de qualidade de dado | pendente |
| lifecycle.note, geo/perf.js, coordinator, cacheManager | KEEP (reaproveitados) | feito |
| analytics, audit, securityEvent | KEEP (domínios separados) | feito |
| backend logger e log de request | STANDARDIZE com telemetry.js | contrato + helper |
| backend traceId = requestId | REVIEW (manter alias só no corpo) | contrato |
| backend /health público com versão | STANDARDIZE (/health/details protegido) | contrato |

Nada inseguro foi encontrado que exigisse remoção imediata (nenhum log de corpo, token ou credencial).
