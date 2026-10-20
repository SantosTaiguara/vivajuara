# Registro de métricas

Fonte: `scripts/observabilityRegistry.js`, que gera `docs/OBSERVABILITY_REGISTRY.json` (completo: aparelho + contratos de servidor) e `config/observability/registry.json` (cópia do navegador: só o que é medido no aparelho, sem descrições). Mudar no script, não aqui. 85 métricas: 46 medidas no aparelho, 39 contratos de servidor.

## Regras (MetricsClient)

- Só nomes registrados (`UNREGISTERED_METRIC` é recusado e contado em `metric_series_rejected_total`).
- Tipos: COUNTER (`_total`), GAUGE, HISTOGRAM (unidade no nome). Tipo errado é recusado.
- Labels só da lista `allowedLabels`; valores de vocabulário controlado (`labelValues`) ou padrão (`labelPatterns`). Valor fora do vocabulário vira OTHER/UNKNOWN quando existe; senão é recusado.
- Proibidos como label (`forbiddenLabels`): customerId, customer_id, customerName, lotId, lot_id, lotCode, userId, user_id, principalId, requestId, request_id, correlationId, traceId, trace_id, spanId, shareId, share_id, token, email, phone, name, url, path, query, organizationId, organization_id, tenantId, tenant_id, message, errorMessage. Esses campos podem ir em log/trace, nunca em label agregada.
- Orçamento de cardinalidade: 50 séries por métrica (`maxSeriesPerMetric`).
- Histogramas guardam até 200 amostras por série e informam n, p50, p95, p99 e máximo. Com menos de 5 amostras, p95/p99 ficam vazios. Média sozinha nunca é exibida.
- Série que nunca existiu devolve null ("não disponível"), nunca 0.

## Vocabulários controlados

- `device_class`: MOBILE, TABLET, DESKTOP, UNKNOWN
- `renderer_type`: SVG, CANVAS, WEBGL, NATIVE
- `route_code`: MAP, LOT, DETAILS, COMPARE, FAVORITES, CUSTOMER, PRESENTATION, SHARED, OTHER
- `error_category`: VALIDATION, AUTHENTICATION, AUTHORIZATION, NOT_FOUND, CONFLICT, DEPENDENCY, NETWORK, DATA_INTEGRITY, INTERNAL
- `component`: MapRenderer, QuickView, Comparison, CustomerWorkspace, PresentationRuntime, SharedRuntime, AnalyticsDashboard, DocumentViewer, Legend, Panels, Data, Cache, Loading, Pwa, Share, Security, Global, Observability
- `method`: GET, POST, PUT, PATCH, DELETE
- `status_class`: 2xx, 3xx, 4xx, 5xx, NETWORK
- `storage_tier`: MEMORY, INDEXED_DB, CACHE_STORAGE, LOCAL_STORAGE
- `connectivity_state`: ONLINE, OFFLINE, DEGRADED, UNKNOWN
- `sw_event`: INSTALL, ACTIVATE, UPDATE_AVAILABLE, UPDATE_FAILED, OFFLINE_BOOT
- `reason_category`: EXPIRED, REVOKED, INVALID, NOT_FOUND, RATE_LIMITED, OTHER
- `data_channel`: AVAILABILITY, PRICING, ANALYSIS, STATIC
- `signal`: LOG, ERROR, SPAN, METRIC
- `sink`: LOCAL, CONSOLE, REMOTE
- `outcome`: SUCCESS, FAILURE, CONFLICT
- `reason`: UNREGISTERED_METRIC, FORBIDDEN_LABEL, UNKNOWN_LABEL, CARDINALITY_EXCEEDED, INVALID_VALUE, WRONG_TYPE
- `timeout_kind`: CLIENT, SERVER, DEPENDENCY
- `check`: LIVE, READY, CONNECTIVITY, DATABASE, STORAGE, AUTH_PROVIDER, QUEUE, LOGIN_PAGE, MAP_BOOTSTRAP, PUBLIC_SHARE, SYNTHETIC_JOURNEY
- `resource_type`: padrão `^[A-Z][A-Z0-9_]{1,40}$`
- `permission_group`: padrão `^[a-z][a-z_]{1,30}$`
- `endpoint_group`: padrão `^[a-z][a-z0-9_.]{1,40}$`
- `query_group`: padrão `^[a-z][a-z0-9_.]{1,40}$`
- `job_type`: padrão `^[A-Z][A-Z0-9_]{1,40}$`
- `dependency`: padrão `^[a-z][a-z0-9_]{1,30}$`
- `failure_category`: padrão `^[A-Z][A-Z0-9_]{1,30}$`

## Catálogo

| Métrica | Tipo | Unidade | Labels | Dono | Alertável | Estado | Descrição |
|---|---|---|---|---|---|---|---|
| `frontend_errors_total` | COUNTER | 1 | error_category, component, route_code | frontend-plataforma | sim | medido no aparelho | Erros capturados no navegador (ErrorReporter), agrupados por categoria e componente. |
| `frontend_error_boundary_fallback_total` | COUNTER | 1 | component | frontend-plataforma | sim | medido no aparelho | Vezes que uma área crítica caiu no fallback local (Error Boundary). |
| `route_boot_duration_ms` | HISTOGRAM | ms | route_code, device_class | frontend-plataforma | não | medido no aparelho | Tempo até a rota ficar pronta (shell pronto). |
| `map_interactive_duration_ms` | HISTOGRAM | ms | device_class, renderer_type | frontend-mapa | sim | medido no aparelho | Tempo até o mapa aceitar interação (tópico 46). |
| `map_geometry_load_duration_ms` | HISTOGRAM | ms | device_class, renderer_type | frontend-mapa | não | medido no aparelho | Carga da geometria dos lotes. |
| `map_first_render_duration_ms` | HISTOGRAM | ms | device_class, renderer_type | frontend-mapa | não | medido no aparelho | Primeiro desenho do mapa. |
| `map_layer_switch_duration_ms` | HISTOGRAM | ms | device_class, renderer_type | frontend-mapa | não | medido no aparelho | Troca de camada do mapa. |
| `map_hit_test_duration_ms` | HISTOGRAM | ms | device_class, renderer_type | frontend-mapa | não | medido no aparelho | Teste de clique (hit test) do mapa. |
| `quickview_load_duration_ms` | HISTOGRAM | ms | device_class | frontend-plataforma | sim | medido no aparelho | Tempo até o QuickView do lote ficar pronto. |
| `quickview_error_total` | COUNTER | 1 | error_category | frontend-plataforma | sim | medido no aparelho | Falhas ao montar o QuickView. |
| `quickview_stale_discard_total` | COUNTER | 1 | — | frontend-plataforma | não | medido no aparelho | Resultados de QuickView descartados por serem de um lote anterior. |
| `web_vitals_lcp_ms` | HISTOGRAM | ms | device_class, route_code | frontend-plataforma | não | medido no aparelho | Largest Contentful Paint (Core Web Vital; não é KPI de negócio). |
| `web_vitals_inp_ms` | HISTOGRAM | ms | device_class, route_code | frontend-plataforma | não | medido no aparelho | Interaction to Next Paint (aproximação local pela maior interação observada). |
| `web_vitals_cls` | HISTOGRAM | score | device_class, route_code | frontend-plataforma | não | medido no aparelho | Cumulative Layout Shift (sem deslocamentos causados por input recente). |
| `longtask_duration_ms` | HISTOGRAM | ms | route_code | frontend-mapa | não | medido no aparelho | Tarefas longas (> 50 ms) da thread principal. |
| `resource_load_duration_ms` | HISTOGRAM | ms | resource_type | frontend-plataforma | não | medido no aparelho | Carga de recursos pelo LoadCoordinator (tópico 47). |
| `resource_load_failures_total` | COUNTER | 1 | resource_type, error_category | frontend-plataforma | sim | medido no aparelho | Falhas de carga de recurso. |
| `stale_result_discard_total` | COUNTER | 1 | — | frontend-plataforma | não | medido no aparelho | Resultados descartados por contexto antigo (tópico 47). |
| `cancelled_load_total` | COUNTER | 1 | — | frontend-plataforma | não | medido no aparelho | Cargas canceladas (troca de contexto, navegação). |
| `resource_dedup_total` | COUNTER | 1 | — | frontend-plataforma | não | medido no aparelho | Requisições deduplicadas (single-flight). |
| `prefetch_hit_rate` | GAUGE | ratio | — | frontend-plataforma | não | medido no aparelho | Fração dos prefetches aproveitados. |
| `prefetch_waste_rate` | GAUGE | ratio | — | frontend-plataforma | não | medido no aparelho | Fração dos prefetches desperdiçados. |
| `cache_hits_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Acertos de cache (tópico 48). |
| `cache_misses_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Faltas de cache. |
| `cache_stale_hits_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Acertos com cópia vencida (stale) servida com rótulo. |
| `cache_corruption_total` | COUNTER | 1 | resource_type | frontend-plataforma | sim | medido no aparelho | Entradas de cache corrompidas (checksum) removidas. |
| `cache_evictions_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Remoções por cota/política. |
| `cache_revalidations_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Revalidações (ETag/304). |
| `cache_write_failures_total` | COUNTER | 1 | resource_type | frontend-plataforma | sim | medido no aparelho | Falhas de gravação no armazenamento persistente. |
| `cache_entries` | GAUGE | 1 | storage_tier | frontend-plataforma | não | medido no aparelho | Entradas guardadas por camada. |
| `connectivity_changes_total` | COUNTER | 1 | connectivity_state | frontend-pwa | não | medido no aparelho | Mudanças de conectividade observadas. |
| `sw_lifecycle_total` | COUNTER | 1 | sw_event | frontend-pwa | sim | medido no aparelho | Ciclo de vida do Service Worker (tópico 49). |
| `offline_sync_pending` | GAUGE | 1 | — | frontend-pwa | não | medido no aparelho | Mutações aguardando sincronização. |
| `offline_sync_failure_total` | COUNTER | 1 | — | frontend-pwa | sim | medido no aparelho | Falhas de sincronização offline. |
| `offline_sync_conflict_total` | COUNTER | 1 | — | frontend-pwa | sim | medido no aparelho | Conflitos de sincronização offline. |
| `authorization_denied_total` | COUNTER | 1 | permission_group | seguranca | sim | medido no aparelho | Negações de autorização agregadas por grupo de permissão (sem usuário). |
| `share_access_denied_total` | COUNTER | 1 | reason_category | frontend-plataforma | sim | medido no aparelho | Acessos a link compartilhado negados, por categoria (sem token). |
| `tenant_scope_violation_total` | COUNTER | 1 | — | seguranca | sim | medido no aparelho | Tentativas bloqueadas de cruzar organização (deve ser zero). |
| `tenant_context_missing_total` | COUNTER | 1 | — | seguranca | sim | medido no aparelho | Operações sem contexto de organização (deve ser zero). |
| `version_mismatch_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Versões de recurso incompatíveis detectadas. |
| `resource_compatibility_failure_total` | COUNTER | 1 | resource_type | frontend-plataforma | não | medido no aparelho | Recursos recusados por incompatibilidade. |
| `data_freshness_age_ms` | GAUGE | ms | data_channel | dados-comercial | sim | medido no aparelho | Idade da última confirmação de cada canal de dado (não é atualidade de cache). |
| `telemetry_drop_total` | COUNTER | 1 | signal | frontend-plataforma | não | medido no aparelho | Telemetria descartada (buffer cheio, amostragem, limite de taxa). |
| `telemetry_export_failures_total` | COUNTER | 1 | sink | frontend-plataforma | não | medido no aparelho | Falhas ao entregar telemetria a um destino (nunca bloqueia o usuário). |
| `telemetry_queue_depth` | GAUGE | 1 | signal | frontend-plataforma | não | medido no aparelho | Itens no buffer local de telemetria. |
| `metric_series_rejected_total` | COUNTER | 1 | reason | frontend-plataforma | não | medido no aparelho | Séries de métrica recusadas (label proibido, cardinalidade, métrica não registrada). |
| `api_requests_total` | COUNTER | 1 | endpoint_group, method, status_class | backend-api | não | contrato de servidor | RED: taxa de requisições. |
| `api_errors_total` | COUNTER | 1 | endpoint_group, method, status_class, error_category | backend-api | sim | contrato de servidor | RED: erros. |
| `api_request_duration_ms` | HISTOGRAM | ms | endpoint_group, method, status_class | backend-api | sim | contrato de servidor | RED: duração (p50/p95/p99). |
| `api_request_size_bytes` | HISTOGRAM | By | endpoint_group, method | backend-api | não | contrato de servidor | Tamanho da requisição. |
| `api_response_size_bytes` | HISTOGRAM | By | endpoint_group, method | backend-api | não | contrato de servidor | Tamanho da resposta. |
| `rate_limit_rejections_total` | COUNTER | 1 | endpoint_group | backend-api | sim | contrato de servidor | Rejeições por rate limit. |
| `db_query_duration_ms` | HISTOGRAM | ms | query_group | backend-dados | sim | contrato de servidor | Latência de consultas (sem SQL com valores). |
| `db_pool_utilization` | GAUGE | ratio | — | backend-dados | sim | contrato de servidor | Uso do pool de conexões. |
| `db_timeouts_total` | COUNTER | 1 | query_group | backend-dados | sim | contrato de servidor | Timeouts de banco. |
| `db_deadlocks_total` | COUNTER | 1 | — | backend-dados | sim | contrato de servidor | Deadlocks. |
| `db_slow_queries_total` | COUNTER | 1 | query_group | backend-dados | não | contrato de servidor | Consultas acima do limite configurável. |
| `db_transaction_rollbacks_total` | COUNTER | 1 | — | backend-dados | não | contrato de servidor | Rollbacks. |
| `db_migration_duration_ms` | HISTOGRAM | ms | outcome | backend-dados | sim | contrato de servidor | Migrações de schema (início/fim/falha). |
| `dependency_request_duration_ms` | HISTOGRAM | ms | dependency, outcome | backend-api | não | contrato de servidor | Latência de dependências externas. |
| `dependency_timeouts_total` | COUNTER | 1 | dependency, timeout_kind | backend-api | sim | contrato de servidor | Timeouts (cliente, servidor, dependência). |
| `circuit_breaker_state` | GAUGE | 1 | dependency | backend-api | sim | contrato de servidor | 0 fechado, 1 meio-aberto, 2 aberto. |
| `jobs_enqueued_total` | COUNTER | 1 | job_type | backend-jobs | não | contrato de servidor | Jobs enfileirados. |
| `jobs_started_total` | COUNTER | 1 | job_type | backend-jobs | não | contrato de servidor | Jobs iniciados. |
| `jobs_succeeded_total` | COUNTER | 1 | job_type | backend-jobs | não | contrato de servidor | Jobs concluídos. |
| `jobs_failed_total` | COUNTER | 1 | job_type | backend-jobs | sim | contrato de servidor | Jobs que falharam. |
| `jobs_retried_total` | COUNTER | 1 | job_type | backend-jobs | não | contrato de servidor | Retentativas. |
| `job_duration_ms` | HISTOGRAM | ms | job_type | backend-jobs | não | contrato de servidor | Duração do job. |
| `job_queue_delay_ms` | HISTOGRAM | ms | job_type | backend-jobs | sim | contrato de servidor | Espera na fila. |
| `jobs_in_queue` | GAUGE | 1 | job_type | backend-jobs | sim | contrato de servidor | Profundidade da fila. |
| `dead_letter_count` | GAUGE | 1 | job_type | backend-jobs | sim | contrato de servidor | Itens em dead letter. |
| `job_last_success_timestamp` | GAUGE | s | job_type | backend-jobs | sim | contrato de servidor | Heartbeat: último sucesso de job periódico (alerta de ausência). |
| `price_table_validation_duration_ms` | HISTOGRAM | ms | — | dados-comercial | não | contrato de servidor | Validação de tabela de preço. |
| `price_table_publish_total` | COUNTER | 1 | outcome | dados-comercial | sim | contrato de servidor | Publicações de tabela de preço. |
| `availability_transition_total` | COUNTER | 1 | outcome | dados-comercial | sim | contrato de servidor | Transições de disponibilidade (sucesso/conflito/falha). |
| `availability_revision_lag_ms` | GAUGE | ms | — | dados-comercial | sim | contrato de servidor | Atraso do feed de revisões de disponibilidade. |
| `document_scan_duration_ms` | HISTOGRAM | ms | — | backend-documentos | não | contrato de servidor | Varredura de documentos. |
| `document_scan_failures_total` | COUNTER | 1 | failure_category | backend-documentos | sim | contrato de servidor | Falhas de varredura. |
| `share_access_validation_duration_ms` | HISTOGRAM | ms | — | backend-api | não | contrato de servidor | Validação de acesso a link (sem token). |
| `analysis_run_duration_ms` | HISTOGRAM | ms | outcome | backend-analise | não | contrato de servidor | Execução de análise (tópico 35). |
| `rule_evaluation_duration_ms` | HISTOGRAM | ms | — | backend-analise | não | contrato de servidor | Avaliação do motor de regras (tópico 36). |
| `analytics_events_ingested_total` | COUNTER | 1 | outcome | backend-analytics | não | contrato de servidor | Ingestão de eventos de produto (saúde do pipeline, não métrica de produto). |
| `analytics_pipeline_lag_ms` | GAUGE | ms | — | backend-analytics | sim | contrato de servidor | Atraso do pipeline de analytics. |
| `health_check_status` | GAUGE | 1 | check | backend-api | sim | contrato de servidor | 1 ok, 0 falha, por verificação de saúde. |
| `synthetic_check_success` | GAUGE | 1 | check | backend-api | sim | contrato de servidor | Resultado do monitoramento sintético (usuário de teste, nunca cliente real). |
