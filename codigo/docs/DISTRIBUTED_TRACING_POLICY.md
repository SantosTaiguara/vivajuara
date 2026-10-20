# Política de tracing distribuído

Implementação: `signals.createTracer()` (`startSpan`, `run`, `child`, `sweep`). TraceSpan: name, kind (CLIENT/SERVER/INTERNAL/PRODUCER/CONSUMER), traceId, spanId, parentSpanId, links, startTime, endTime, durationMs, status (OK/ERROR/UNSET), attributes, errorCode, correlationId, requestId.

## Regras

- Só spans registrados (`registry.spans`). Atributos fora de `allowedAttributes` + `highCardinalityAttributesAllowed`, chaves bloqueadas ou valores com cara de PII são descartados e contados.
- IDs W3C (`traceparent` versão 00). Propagação só para mesma origem ou origens aprovadas (lista vazia).
- **Amostragem decidida no fim do span raiz**: se qualquer span do trace terminou em ERROR, o trace inteiro é guardado (100% dos erros, teste `ObsTraceSamplingErrorAlwaysCaptured` com taxa padrão 0).
- TraceSamplingPolicy: aparelho `defaultRate 1, errorRate 1, highRiskOperationRate 1` (buffer de 200 spans, só memória); contrato de servidor `defaultRate 0,1, errorRate 1, highRiskOperationRate 0,5`. Spans de alto risco: price.publish, availability.mutate, share.access, offline.sync. Override por organização só via TenantDiagnosticOverride temporário.
- Async: job abre trace novo com `links` para o span de origem. Span aberto além de 5 min é fechado por `sweep()` com `truncated: true`.
- `run(name, fn)` marca ERROR e **relança** o erro: o tracer nunca esconde falha.
- Audit não é amostrado: é outro domínio e não passa pelo tracer.
- Exemplars (métrica → trace) ficam para o provedor (decisão O1).

## Fluxos prioritários e onde instrumentar

| Fluxo | Span | Onde (integração) |
|---|---|---|
| boot do painel | app.boot | app.js, início/fim do boot |
| mapa | map.bootstrap / map.layer_switch | presentation/map.js (já mede com geo/perf.js) |
| QuickView | quickview.load | app.js ao abrir o lote |
| recomendação, comparação, simulação | recommendation.generate / comparison.load / finance.simulate | app.js |
| link compartilhado | share.access | share runtime (sem token) |
| sync offline | offline.sync | data/offline.js |
| métricas locais | analytics.query | painel técnico |
| carga de recurso | resource.load | LoadCoordinator (hook `telemetry`) |
| HTTP | http.client / http.server | apiSource.js / backend app.js |
| preço, disponibilidade, documento, jobs | price.publish, availability.mutate, document.scan, job.enqueue/consume | servidor (contrato) |

## Exemplo — QuickView no servidor (contrato)

```text
http.server GET /v1/lots/:id/quick-view
  ├─ auth → tenant → authorization (atributos: outcome)
  ├─ repository.query lots (query_group=lots.by_id)
  ├─ pricing / availability / analysis resolvers
  └─ view model compose
```

## Catálogo de spans

| Span | Tipo | Dono | Atributos | Alta cardinalidade permitida | Onde |
|---|---|---|---|---|---|
| `app.boot` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, renderer_type, load_origin | — | aparelho |
| `map.bootstrap` | INTERNAL | frontend-mapa | route_code, device_class, app_version, environment, connectivity_state, renderer_type, feature_count, readiness, geometry_version | — | aparelho |
| `map.layer_switch` | INTERNAL | frontend-mapa | route_code, device_class, app_version, environment, connectivity_state, renderer_type, layer | — | aparelho |
| `quickview.load` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, stale_discarded, data_state | lot.id | aparelho |
| `recommendation.generate` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, candidate_count, profile | — | aparelho |
| `comparison.load` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, candidate_count | — | aparelho |
| `finance.simulate` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, scenario_count | — | aparelho |
| `share.access` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, reason_category, outcome | — | aparelho |
| `offline.sync` | INTERNAL | frontend-pwa | route_code, device_class, app_version, environment, connectivity_state, pending_count, outcome | — | aparelho |
| `analytics.query` | INTERNAL | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, range | — | aparelho |
| `resource.load` | CLIENT | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, resource_type, cache_status, priority, outcome | — | aparelho |
| `http.client` | CLIENT | frontend-plataforma | route_code, device_class, app_version, environment, connectivity_state, endpoint_group, method, status_class | http.request_id | aparelho |
| `http.server` | SERVER | backend-api | endpoint_group, method, status_class, environment, app_version | http.request_id, organization.id | servidor |
| `repository.query` | INTERNAL | backend-dados | query_group, outcome | — | servidor |
| `price.publish` | INTERNAL | dados-comercial | outcome, step | price_table.id | servidor |
| `availability.mutate` | INTERNAL | dados-comercial | outcome, transition | lot.id | servidor |
| `document.scan` | CONSUMER | backend-documentos | outcome, failure_category | document.id | servidor |
| `job.consume` | CONSUMER | backend-jobs | job_type, attempt, outcome | job.id | servidor |
| `job.enqueue` | PRODUCER | backend-jobs | job_type | job.id | servidor |
