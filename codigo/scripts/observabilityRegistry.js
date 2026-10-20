// Topic 51: source of the ObservabilityRegistry. Edit here, then run from plat/:
//   node scripts/observabilityRegistry.js config/observability/registry.json docs/OBSERVABILITY_REGISTRY.json
// Writes the FULL registry (docs, backend, CI) and the BROWSER copy (local signals only, no descriptions; bundled by configBundle.js).
const fs = require('fs');
const out = process.argv[2];
const FE = 'ACTIVE_LOCAL', BE = 'CONTRACT_ONLY';
const m = (name, type, unit, allowedLabels, owner, alertable, status, description) => [name, { name, type, unit, allowedLabels, owner, alertable, status, description }];
const metrics = Object.fromEntries([
  // frontend, measured on this device
  m('frontend_errors_total', 'COUNTER', '1', ['error_category', 'component', 'route_code'], 'frontend-plataforma', true, FE, 'Erros capturados no navegador (ErrorReporter), agrupados por categoria e componente.'),
  m('frontend_error_boundary_fallback_total', 'COUNTER', '1', ['component'], 'frontend-plataforma', true, FE, 'Vezes que uma área crítica caiu no fallback local (Error Boundary).'),
  m('route_boot_duration_ms', 'HISTOGRAM', 'ms', ['route_code', 'device_class'], 'frontend-plataforma', false, FE, 'Tempo até a rota ficar pronta (shell pronto).'),
  m('map_interactive_duration_ms', 'HISTOGRAM', 'ms', ['device_class', 'renderer_type'], 'frontend-mapa', true, FE, 'Tempo até o mapa aceitar interação (tópico 46).'),
  m('map_geometry_load_duration_ms', 'HISTOGRAM', 'ms', ['device_class', 'renderer_type'], 'frontend-mapa', false, FE, 'Carga da geometria dos lotes.'),
  m('map_first_render_duration_ms', 'HISTOGRAM', 'ms', ['device_class', 'renderer_type'], 'frontend-mapa', false, FE, 'Primeiro desenho do mapa.'),
  m('map_layer_switch_duration_ms', 'HISTOGRAM', 'ms', ['device_class', 'renderer_type'], 'frontend-mapa', false, FE, 'Troca de camada do mapa.'),
  m('map_hit_test_duration_ms', 'HISTOGRAM', 'ms', ['device_class', 'renderer_type'], 'frontend-mapa', false, FE, 'Teste de clique (hit test) do mapa.'),
  m('quickview_load_duration_ms', 'HISTOGRAM', 'ms', ['device_class'], 'frontend-plataforma', true, FE, 'Tempo até o QuickView do lote ficar pronto.'),
  m('quickview_error_total', 'COUNTER', '1', ['error_category'], 'frontend-plataforma', true, FE, 'Falhas ao montar o QuickView.'),
  m('quickview_stale_discard_total', 'COUNTER', '1', [], 'frontend-plataforma', false, FE, 'Resultados de QuickView descartados por serem de um lote anterior.'),
  m('web_vitals_lcp_ms', 'HISTOGRAM', 'ms', ['device_class', 'route_code'], 'frontend-plataforma', false, FE, 'Largest Contentful Paint (Core Web Vital; não é KPI de negócio).'),
  m('web_vitals_inp_ms', 'HISTOGRAM', 'ms', ['device_class', 'route_code'], 'frontend-plataforma', false, FE, 'Interaction to Next Paint (aproximação local pela maior interação observada).'),
  m('web_vitals_cls', 'HISTOGRAM', 'score', ['device_class', 'route_code'], 'frontend-plataforma', false, FE, 'Cumulative Layout Shift (sem deslocamentos causados por input recente).'),
  m('longtask_duration_ms', 'HISTOGRAM', 'ms', ['route_code'], 'frontend-mapa', false, FE, 'Tarefas longas (> 50 ms) da thread principal.'),
  m('resource_load_duration_ms', 'HISTOGRAM', 'ms', ['resource_type'], 'frontend-plataforma', false, FE, 'Carga de recursos pelo LoadCoordinator (tópico 47).'),
  m('resource_load_failures_total', 'COUNTER', '1', ['resource_type', 'error_category'], 'frontend-plataforma', true, FE, 'Falhas de carga de recurso.'),
  m('stale_result_discard_total', 'COUNTER', '1', [], 'frontend-plataforma', false, FE, 'Resultados descartados por contexto antigo (tópico 47).'),
  m('cancelled_load_total', 'COUNTER', '1', [], 'frontend-plataforma', false, FE, 'Cargas canceladas (troca de contexto, navegação).'),
  m('resource_dedup_total', 'COUNTER', '1', [], 'frontend-plataforma', false, FE, 'Requisições deduplicadas (single-flight).'),
  m('prefetch_hit_rate', 'GAUGE', 'ratio', [], 'frontend-plataforma', false, FE, 'Fração dos prefetches aproveitados.'),
  m('prefetch_waste_rate', 'GAUGE', 'ratio', [], 'frontend-plataforma', false, FE, 'Fração dos prefetches desperdiçados.'),
  m('cache_hits_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Acertos de cache (tópico 48).'),
  m('cache_misses_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Faltas de cache.'),
  m('cache_stale_hits_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Acertos com cópia vencida (stale) servida com rótulo.'),
  m('cache_corruption_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', true, FE, 'Entradas de cache corrompidas (checksum) removidas.'),
  m('cache_evictions_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Remoções por cota/política.'),
  m('cache_revalidations_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Revalidações (ETag/304).'),
  m('cache_write_failures_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', true, FE, 'Falhas de gravação no armazenamento persistente.'),
  m('cache_entries', 'GAUGE', '1', ['storage_tier'], 'frontend-plataforma', false, FE, 'Entradas guardadas por camada.'),
  m('connectivity_changes_total', 'COUNTER', '1', ['connectivity_state'], 'frontend-pwa', false, FE, 'Mudanças de conectividade observadas.'),
  m('sw_lifecycle_total', 'COUNTER', '1', ['sw_event'], 'frontend-pwa', true, FE, 'Ciclo de vida do Service Worker (tópico 49).'),
  m('offline_sync_pending', 'GAUGE', '1', [], 'frontend-pwa', false, FE, 'Mutações aguardando sincronização.'),
  m('offline_sync_failure_total', 'COUNTER', '1', [], 'frontend-pwa', true, FE, 'Falhas de sincronização offline.'),
  m('offline_sync_conflict_total', 'COUNTER', '1', [], 'frontend-pwa', true, FE, 'Conflitos de sincronização offline.'),
  m('authorization_denied_total', 'COUNTER', '1', ['permission_group'], 'seguranca', true, FE, 'Negações de autorização agregadas por grupo de permissão (sem usuário).'),
  m('share_access_denied_total', 'COUNTER', '1', ['reason_category'], 'frontend-plataforma', true, FE, 'Acessos a link compartilhado negados, por categoria (sem token).'),
  m('tenant_scope_violation_total', 'COUNTER', '1', [], 'seguranca', true, FE, 'Tentativas bloqueadas de cruzar organização (deve ser zero).'),
  m('tenant_context_missing_total', 'COUNTER', '1', [], 'seguranca', true, FE, 'Operações sem contexto de organização (deve ser zero).'),
  m('version_mismatch_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Versões de recurso incompatíveis detectadas.'),
  m('resource_compatibility_failure_total', 'COUNTER', '1', ['resource_type'], 'frontend-plataforma', false, FE, 'Recursos recusados por incompatibilidade.'),
  m('data_freshness_age_ms', 'GAUGE', 'ms', ['data_channel'], 'dados-comercial', true, FE, 'Idade da última confirmação de cada canal de dado (não é atualidade de cache).'),
  m('telemetry_drop_total', 'COUNTER', '1', ['signal'], 'frontend-plataforma', false, FE, 'Telemetria descartada (buffer cheio, amostragem, limite de taxa).'),
  m('telemetry_export_failures_total', 'COUNTER', '1', ['sink'], 'frontend-plataforma', false, FE, 'Falhas ao entregar telemetria a um destino (nunca bloqueia o usuário).'),
  m('telemetry_queue_depth', 'GAUGE', '1', ['signal'], 'frontend-plataforma', false, FE, 'Itens no buffer local de telemetria.'),
  m('metric_series_rejected_total', 'COUNTER', '1', ['reason'], 'frontend-plataforma', false, FE, 'Séries de métrica recusadas (label proibido, cardinalidade, métrica não registrada).'),
  // backend contracts (no server here)
  m('api_requests_total', 'COUNTER', '1', ['endpoint_group', 'method', 'status_class'], 'backend-api', false, BE, 'RED: taxa de requisições.'),
  m('api_errors_total', 'COUNTER', '1', ['endpoint_group', 'method', 'status_class', 'error_category'], 'backend-api', true, BE, 'RED: erros.'),
  m('api_request_duration_ms', 'HISTOGRAM', 'ms', ['endpoint_group', 'method', 'status_class'], 'backend-api', true, BE, 'RED: duração (p50/p95/p99).'),
  m('api_request_size_bytes', 'HISTOGRAM', 'By', ['endpoint_group', 'method'], 'backend-api', false, BE, 'Tamanho da requisição.'),
  m('api_response_size_bytes', 'HISTOGRAM', 'By', ['endpoint_group', 'method'], 'backend-api', false, BE, 'Tamanho da resposta.'),
  m('rate_limit_rejections_total', 'COUNTER', '1', ['endpoint_group'], 'backend-api', true, BE, 'Rejeições por rate limit.'),
  m('db_query_duration_ms', 'HISTOGRAM', 'ms', ['query_group'], 'backend-dados', true, BE, 'Latência de consultas (sem SQL com valores).'),
  m('db_pool_utilization', 'GAUGE', 'ratio', [], 'backend-dados', true, BE, 'Uso do pool de conexões.'),
  m('db_timeouts_total', 'COUNTER', '1', ['query_group'], 'backend-dados', true, BE, 'Timeouts de banco.'),
  m('db_deadlocks_total', 'COUNTER', '1', [], 'backend-dados', true, BE, 'Deadlocks.'),
  m('db_slow_queries_total', 'COUNTER', '1', ['query_group'], 'backend-dados', false, BE, 'Consultas acima do limite configurável.'),
  m('db_transaction_rollbacks_total', 'COUNTER', '1', [], 'backend-dados', false, BE, 'Rollbacks.'),
  m('db_migration_duration_ms', 'HISTOGRAM', 'ms', ['outcome'], 'backend-dados', true, BE, 'Migrações de schema (início/fim/falha).'),
  m('dependency_request_duration_ms', 'HISTOGRAM', 'ms', ['dependency', 'outcome'], 'backend-api', false, BE, 'Latência de dependências externas.'),
  m('dependency_timeouts_total', 'COUNTER', '1', ['dependency', 'timeout_kind'], 'backend-api', true, BE, 'Timeouts (cliente, servidor, dependência).'),
  m('circuit_breaker_state', 'GAUGE', '1', ['dependency'], 'backend-api', true, BE, '0 fechado, 1 meio-aberto, 2 aberto.'),
  m('jobs_enqueued_total', 'COUNTER', '1', ['job_type'], 'backend-jobs', false, BE, 'Jobs enfileirados.'),
  m('jobs_started_total', 'COUNTER', '1', ['job_type'], 'backend-jobs', false, BE, 'Jobs iniciados.'),
  m('jobs_succeeded_total', 'COUNTER', '1', ['job_type'], 'backend-jobs', false, BE, 'Jobs concluídos.'),
  m('jobs_failed_total', 'COUNTER', '1', ['job_type'], 'backend-jobs', true, BE, 'Jobs que falharam.'),
  m('jobs_retried_total', 'COUNTER', '1', ['job_type'], 'backend-jobs', false, BE, 'Retentativas.'),
  m('job_duration_ms', 'HISTOGRAM', 'ms', ['job_type'], 'backend-jobs', false, BE, 'Duração do job.'),
  m('job_queue_delay_ms', 'HISTOGRAM', 'ms', ['job_type'], 'backend-jobs', true, BE, 'Espera na fila.'),
  m('jobs_in_queue', 'GAUGE', '1', ['job_type'], 'backend-jobs', true, BE, 'Profundidade da fila.'),
  m('dead_letter_count', 'GAUGE', '1', ['job_type'], 'backend-jobs', true, BE, 'Itens em dead letter.'),
  m('job_last_success_timestamp', 'GAUGE', 's', ['job_type'], 'backend-jobs', true, BE, 'Heartbeat: último sucesso de job periódico (alerta de ausência).'),
  m('price_table_validation_duration_ms', 'HISTOGRAM', 'ms', [], 'dados-comercial', false, BE, 'Validação de tabela de preço.'),
  m('price_table_publish_total', 'COUNTER', '1', ['outcome'], 'dados-comercial', true, BE, 'Publicações de tabela de preço.'),
  m('availability_transition_total', 'COUNTER', '1', ['outcome'], 'dados-comercial', true, BE, 'Transições de disponibilidade (sucesso/conflito/falha).'),
  m('availability_revision_lag_ms', 'GAUGE', 'ms', [], 'dados-comercial', true, BE, 'Atraso do feed de revisões de disponibilidade.'),
  m('document_scan_duration_ms', 'HISTOGRAM', 'ms', [], 'backend-documentos', false, BE, 'Varredura de documentos.'),
  m('document_scan_failures_total', 'COUNTER', '1', ['failure_category'], 'backend-documentos', true, BE, 'Falhas de varredura.'),
  m('share_access_validation_duration_ms', 'HISTOGRAM', 'ms', [], 'backend-api', false, BE, 'Validação de acesso a link (sem token).'),
  m('analysis_run_duration_ms', 'HISTOGRAM', 'ms', ['outcome'], 'backend-analise', false, BE, 'Execução de análise (tópico 35).'),
  m('rule_evaluation_duration_ms', 'HISTOGRAM', 'ms', [], 'backend-analise', false, BE, 'Avaliação do motor de regras (tópico 36).'),
  m('analytics_events_ingested_total', 'COUNTER', '1', ['outcome'], 'backend-analytics', false, BE, 'Ingestão de eventos de produto (saúde do pipeline, não métrica de produto).'),
  m('analytics_pipeline_lag_ms', 'GAUGE', 'ms', [], 'backend-analytics', true, BE, 'Atraso do pipeline de analytics.'),
  m('health_check_status', 'GAUGE', '1', ['check'], 'backend-api', true, BE, '1 ok, 0 falha, por verificação de saúde.'),
  m('synthetic_check_success', 'GAUGE', '1', ['check'], 'backend-api', true, BE, 'Resultado do monitoramento sintético (usuário de teste, nunca cliente real).')
]);
const labelValues = {
  device_class: ['MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN'],
  renderer_type: ['SVG', 'CANVAS', 'WEBGL', 'NATIVE'],
  route_code: ['MAP', 'LOT', 'DETAILS', 'COMPARE', 'FAVORITES', 'CUSTOMER', 'PRESENTATION', 'SHARED', 'OTHER'],
  error_category: ['VALIDATION', 'AUTHENTICATION', 'AUTHORIZATION', 'NOT_FOUND', 'CONFLICT', 'DEPENDENCY', 'NETWORK', 'DATA_INTEGRITY', 'INTERNAL'],
  component: ['MapRenderer', 'QuickView', 'Comparison', 'CustomerWorkspace', 'PresentationRuntime', 'SharedRuntime', 'AnalyticsDashboard', 'DocumentViewer', 'Legend', 'Panels', 'Data', 'Cache', 'Loading', 'Pwa', 'Share', 'Security', 'Global', 'Observability'],
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  status_class: ['2xx', '3xx', '4xx', '5xx', 'NETWORK'],
  storage_tier: ['MEMORY', 'INDEXED_DB', 'CACHE_STORAGE', 'LOCAL_STORAGE'],
  connectivity_state: ['ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN'],
  sw_event: ['INSTALL', 'ACTIVATE', 'UPDATE_AVAILABLE', 'UPDATE_FAILED', 'OFFLINE_BOOT'],
  reason_category: ['EXPIRED', 'REVOKED', 'INVALID', 'NOT_FOUND', 'RATE_LIMITED', 'OTHER'],
  data_channel: ['AVAILABILITY', 'PRICING', 'ANALYSIS', 'STATIC'],
  signal: ['LOG', 'ERROR', 'SPAN', 'METRIC'],
  sink: ['LOCAL', 'CONSOLE', 'REMOTE'],
  outcome: ['SUCCESS', 'FAILURE', 'CONFLICT'],
  reason: ['UNREGISTERED_METRIC', 'FORBIDDEN_LABEL', 'UNKNOWN_LABEL', 'CARDINALITY_EXCEEDED', 'INVALID_VALUE', 'WRONG_TYPE'],
  timeout_kind: ['CLIENT', 'SERVER', 'DEPENDENCY'],
  check: ['LIVE', 'READY', 'CONNECTIVITY', 'DATABASE', 'STORAGE', 'AUTH_PROVIDER', 'QUEUE', 'LOGIN_PAGE', 'MAP_BOOTSTRAP', 'PUBLIC_SHARE', 'SYNTHETIC_JOURNEY']
};
const labelPatterns = { resource_type: '^[A-Z][A-Z0-9_]{1,40}$', permission_group: '^[a-z][a-z_]{1,30}$', endpoint_group: '^[a-z][a-z0-9_.]{1,40}$', query_group: '^[a-z][a-z0-9_.]{1,40}$', job_type: '^[A-Z][A-Z0-9_]{1,40}$', dependency: '^[a-z][a-z0-9_]{1,30}$', failure_category: '^[A-Z][A-Z0-9_]{1,30}$' };
const forbiddenLabels = ['customerId', 'customer_id', 'customerName', 'lotId', 'lot_id', 'lotCode', 'userId', 'user_id', 'principalId', 'requestId', 'request_id', 'correlationId', 'traceId', 'trace_id', 'spanId', 'shareId', 'share_id', 'token', 'email', 'phone', 'name', 'url', 'path', 'query', 'organizationId', 'organization_id', 'tenantId', 'tenant_id', 'message', 'errorMessage'];
const sp = (name, kind, owner, allowedAttributes, highCardinalityAttributesAllowed, status, description) => [name, { name, kind, owner, allowedAttributes, highCardinalityAttributesAllowed, status, description }];
const CA = ['route_code', 'device_class', 'app_version', 'environment', 'connectivity_state'];
const spans = Object.fromEntries([
  sp('app.boot', 'INTERNAL', 'frontend-plataforma', [...CA, 'renderer_type', 'load_origin'], [], FE, 'Do início do script até o shell pronto.'),
  sp('map.bootstrap', 'INTERNAL', 'frontend-mapa', [...CA, 'renderer_type', 'feature_count', 'readiness', 'geometry_version'], [], FE, 'Bootstrap do mapa: geometria, índice, primeiro desenho, interativo.'),
  sp('map.layer_switch', 'INTERNAL', 'frontend-mapa', [...CA, 'renderer_type', 'layer'], [], FE, 'Troca de camada.'),
  sp('quickview.load', 'INTERNAL', 'frontend-plataforma', [...CA, 'stale_discarded', 'data_state'], ['lot.id'], FE, 'QuickView: lote → preço → disponibilidade → análise → view model.'),
  sp('recommendation.generate', 'INTERNAL', 'frontend-plataforma', [...CA, 'candidate_count', 'profile'], [], FE, 'Geração de recomendação.'),
  sp('comparison.load', 'INTERNAL', 'frontend-plataforma', [...CA, 'candidate_count'], [], FE, 'Carga da comparação.'),
  sp('finance.simulate', 'INTERNAL', 'frontend-plataforma', [...CA, 'scenario_count'], [], FE, 'Simulação financeira (sem valores do cliente).'),
  sp('share.access', 'INTERNAL', 'frontend-plataforma', [...CA, 'reason_category', 'outcome'], [], FE, 'Abertura de link compartilhado (nunca o token).'),
  sp('offline.sync', 'INTERNAL', 'frontend-pwa', [...CA, 'pending_count', 'outcome'], [], FE, 'Sincronização offline.'),
  sp('analytics.query', 'INTERNAL', 'frontend-plataforma', [...CA, 'range'], [], FE, 'Consulta das métricas locais.'),
  sp('resource.load', 'CLIENT', 'frontend-plataforma', [...CA, 'resource_type', 'cache_status', 'priority', 'outcome'], [], FE, 'Carga de um recurso pelo LoadCoordinator.'),
  sp('http.client', 'CLIENT', 'frontend-plataforma', [...CA, 'endpoint_group', 'method', 'status_class'], ['http.request_id'], FE, 'Chamada HTTP de mesma origem (traceparent só para origens aprovadas).'),
  sp('http.server', 'SERVER', 'backend-api', ['endpoint_group', 'method', 'status_class', 'environment', 'app_version'], ['http.request_id', 'organization.id'], BE, 'Requisição no servidor: auth → tenant → autorização → serviço → resposta.'),
  sp('repository.query', 'INTERNAL', 'backend-dados', ['query_group', 'outcome'], [], BE, 'Repositório/banco, sem payload nem SQL com valores.'),
  sp('price.publish', 'INTERNAL', 'dados-comercial', ['outcome', 'step'], ['price_table.id'], BE, 'Publicação de tabela: step-up → validação → conflito de versão → transação → audit → evento.'),
  sp('availability.mutate', 'INTERNAL', 'dados-comercial', ['outcome', 'transition'], ['lot.id'], BE, 'Transição de disponibilidade.'),
  sp('document.scan', 'CONSUMER', 'backend-documentos', ['outcome', 'failure_category'], ['document.id'], BE, 'Upload/varredura de documento.'),
  sp('job.consume', 'CONSUMER', 'backend-jobs', ['job_type', 'attempt', 'outcome'], ['job.id'], BE, 'Consumo de job (span ligado ao request que o criou, nunca aberto por horas).'),
  sp('job.enqueue', 'PRODUCER', 'backend-jobs', ['job_type'], ['job.id'], BE, 'Enfileiramento de job.')
]);
const er = (code, category, retryable, userSafeMessageKey, severity, httpStatus) => [code, { code, category, retryable, userSafeMessageKey, severity, ...(httpStatus ? { httpStatus } : {}) }];
const errors = Object.fromEntries([
  er('VALIDATION_FAILED', 'VALIDATION', false, 'errors.validation', 'LOW', 400),
  er('AUTHENTICATION_REQUIRED', 'AUTHENTICATION', false, 'errors.auth', 'MEDIUM', 401),
  er('AUTHORIZATION_DENIED', 'AUTHORIZATION', false, 'errors.denied', 'MEDIUM', 403),
  er('TENANT_SCOPE_DENIED', 'AUTHORIZATION', false, 'errors.denied', 'HIGH', 403),
  er('RESOURCE_NOT_FOUND', 'NOT_FOUND', false, 'errors.notFound', 'LOW', 404),
  er('AVAILABILITY_REVISION_CONFLICT', 'CONFLICT', true, 'errors.conflict', 'MEDIUM', 409),
  er('PRICE_TABLE_VERSION_CONFLICT', 'CONFLICT', true, 'errors.conflict', 'MEDIUM', 409),
  er('RESOURCE_VERSION_MISMATCH', 'CONFLICT', true, 'errors.conflict', 'MEDIUM', 409),
  er('API_SERVER_ERROR', 'DEPENDENCY', true, 'errors.server', 'HIGH', 500),
  er('API_REQUEST_FAILED', 'DEPENDENCY', true, 'errors.server', 'MEDIUM'),
  er('RATE_LIMITED', 'DEPENDENCY', true, 'errors.rateLimited', 'LOW', 429),
  er('DEPENDENCY_TIMEOUT', 'DEPENDENCY', true, 'errors.timeout', 'HIGH', 504),
  er('REQUEST_TIMEOUT', 'NETWORK', true, 'errors.timeout', 'MEDIUM'),
  er('NETWORK_UNAVAILABLE', 'NETWORK', true, 'errors.network', 'LOW'),
  er('REQUEST_ABORTED', 'NETWORK', false, 'errors.generic', 'LOW'),
  er('DATA_PARSE_FAILED', 'DATA_INTEGRITY', true, 'errors.data', 'MEDIUM'),
  er('DATA_INTEGRITY_VIOLATION', 'DATA_INTEGRITY', false, 'errors.data', 'HIGH'),
  er('CACHE_CORRUPT_ENTRY', 'DATA_INTEGRITY', true, 'errors.data', 'MEDIUM'),
  er('STORAGE_QUOTA_EXCEEDED', 'DEPENDENCY', false, 'errors.storage', 'MEDIUM'),
  er('STORAGE_UNAVAILABLE', 'DEPENDENCY', false, 'errors.storage', 'MEDIUM'),
  er('MAP_GEOMETRY_LOAD_FAILED', 'DEPENDENCY', true, 'errors.map', 'HIGH'),
  er('MAP_RENDER_FAILED', 'INTERNAL', true, 'errors.map', 'HIGH'),
  er('DOCUMENT_SCAN_FAILED', 'DEPENDENCY', true, 'errors.generic', 'MEDIUM'),
  er('SHARE_ACCESS_DENIED', 'AUTHORIZATION', false, 'errors.share', 'LOW', 403),
  er('PWA_SYNC_FAILED', 'NETWORK', true, 'errors.sync', 'MEDIUM'),
  er('PWA_SYNC_CONFLICT', 'CONFLICT', false, 'errors.sync', 'MEDIUM', 409),
  er('SW_UPDATE_FAILED', 'DEPENDENCY', true, 'errors.generic', 'LOW'),
  er('PRICE_TABLE_PUBLISH_FAILED', 'INTERNAL', true, 'errors.server', 'HIGH'),
  er('FRONTEND_UNEXPECTED', 'INTERNAL', false, 'errors.generic', 'MEDIUM'),
  er('INTERNAL_UNEXPECTED', 'INTERNAL', false, 'errors.generic', 'HIGH', 500)
]);
const userMessages = {
  'errors.generic': 'Algo não funcionou nesta parte do painel. O restante continua disponível.',
  'errors.network': 'Sem conexão no momento. O painel segue com a cópia deste aparelho, quando houver.',
  'errors.timeout': 'A resposta demorou demais. Tente de novo em instantes.',
  'errors.server': 'O servidor não conseguiu concluir a operação. Tente de novo em instantes.',
  'errors.rateLimited': 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  'errors.auth': 'Sua sessão precisa ser renovada. Entre de novo.',
  'errors.denied': 'Você não tem acesso a esta informação.',
  'errors.notFound': 'Não encontramos o que foi pedido.',
  'errors.conflict': 'Os dados mudaram enquanto você trabalhava. Atualize e tente de novo.',
  'errors.validation': 'Alguns dados não estão no formato esperado.',
  'errors.storage': 'Não foi possível guardar dados neste aparelho. O painel continua funcionando.',
  'errors.data': 'Parte dos dados não pôde ser lida. Usamos a última versão válida, quando existe.',
  'errors.map': 'Parte do mapa não pôde ser exibida. Os lotes continuam acessíveis pela busca.',
  'errors.share': 'Este link não está mais disponível.',
  'errors.sync': 'Não foi possível sincronizar agora. Suas alterações ficam guardadas para a próxima tentativa.'
};
const ev = (code, level, component, description) => [code, { code, level, component, description }];
const logEvents = Object.fromEntries([
  ev('APP_BOOT_COMPLETED', 'INFO', 'Global', 'Shell pronto (com tempo e origem dos dados).'),
  ev('ROUTE_READY', 'DEBUG', 'Global', 'Rota pronta (timing semântico de navegação SPA).'),
  ev('MAP_INTERACTIVE', 'INFO', 'MapRenderer', 'Mapa interativo (com prontidão e tempos).'),
  ev('MAP_GEOMETRY_LOAD_FAILED', 'ERROR', 'MapRenderer', 'Geometria não carregou; mapa em modo degradado.'),
  ev('MAP_LABEL_OVERLAY_DEGRADED', 'WARN', 'MapRenderer', 'Rótulos falharam; geometria base continua.'),
  ev('FRONTEND_ERROR_CAPTURED', 'ERROR', 'Global', 'Erro capturado pelo ErrorReporter (primeira ocorrência do grupo na janela).'),
  ev('ERROR_BOUNDARY_FALLBACK', 'WARN', 'Global', 'Área crítica exibiu fallback local.'),
  ev('UNHANDLED_REJECTION', 'ERROR', 'Global', 'Promise rejeitada sem tratamento.'),
  ev('API_REQUEST_FAILED', 'ERROR', 'Data', 'Chamada à API falhou (código, status, requestId; sem corpo).'),
  ev('RESOURCE_LOAD_FAILED', 'WARN', 'Loading', 'Recurso não carregou após as tentativas.'),
  ev('STALE_RESULT_DISCARDED', 'DEBUG', 'Loading', 'Resultado de contexto antigo descartado.'),
  ev('CACHE_CORRUPT_ENTRY', 'WARN', 'Cache', 'Entrada com checksum inválido removida e buscada de novo.'),
  ev('CACHE_WRITE_FAILED', 'WARN', 'Cache', 'Gravação persistente falhou (cota ou indisponível).'),
  ev('CONNECTIVITY_CHANGED', 'INFO', 'Pwa', 'Conectividade mudou.'),
  ev('SW_STATE_CHANGED', 'INFO', 'Pwa', 'Service Worker instalou/ativou/tem atualização.'),
  ev('PWA_SYNC_FAILED', 'WARN', 'Pwa', 'Sincronização offline falhou.'),
  ev('PWA_SYNC_CONFLICT', 'WARN', 'Pwa', 'Conflito de sincronização offline.'),
  ev('PRICE_TABLE_PUBLISH_FAILED', 'ERROR', 'Data', 'Publicação de tabela falhou (contrato de servidor).'),
  ev('AVAILABILITY_REVISION_CONFLICT', 'WARN', 'Data', 'Conflito de revisão de disponibilidade.'),
  ev('DOCUMENT_SCAN_FAILED', 'ERROR', 'DocumentViewer', 'Varredura de documento falhou (contrato de servidor).'),
  ev('SHARE_ACCESS_DENIED', 'INFO', 'Share', 'Acesso a link negado (categoria, nunca o token).'),
  ev('DATA_FRESHNESS_STALE', 'WARN', 'Data', 'Canal de dado sem confirmação dentro do limite esperado.'),
  ev('HEALTH_DEGRADED', 'WARN', 'Observability', 'Uma verificação de saúde ficou degradada.'),
  ev('TELEMETRY_BUFFER_PRESSURE', 'WARN', 'Observability', 'Buffer local cheio: telemetria de baixa prioridade descartada.'),
  ev('DIAGNOSTIC_OVERRIDE_ENABLED', 'INFO', 'Observability', 'Modo de diagnóstico temporário ligado (motivo, aprovador, validade).'),
  ev('DIAGNOSTIC_OVERRIDE_EXPIRED', 'INFO', 'Observability', 'Modo de diagnóstico expirou.'),
  ev('DIAGNOSTIC_SNAPSHOT_GENERATED', 'INFO', 'Observability', 'Diagnóstico técnico gerado para suporte (sanitizado).'),
  ev('OPERATIONAL_CHANGE', 'INFO', 'Observability', 'Mudança operacional: versão, configuração, flag, ativação de preço/análise.'),
  ev('SECURITY_SIGNAL_AGGREGATED', 'INFO', 'Security', 'Contagem agregada de sinal de segurança (sem o evento inteiro).'),
  ev('LEGACY_CONSOLE_ERROR', 'ERROR', 'Global', 'Erro que antes ia só para console.error (migração).')
]);
const rb = (id, title, steps, dashboardRef) => [id, { id, title, steps, dashboardRef }];
const runbooks = Object.fromEntries([
  rb('RB-API-LATENCY', 'Latência da API', ['verificar deploy recente (marcador de release)', 'verificar latência do banco', 'verificar chamadas a dependências', 'verificar saturação', 'olhar traces p95/p99', 'rollback ou escalar'], 'DASH-PLATFORM'),
  rb('RB-API-5XX', 'Taxa de 5xx', ['identificar endpoint_group e versão', 'abrir trace de um requestId afetado', 'verificar dependências e banco', 'rollback se começou após deploy', 'escalar ao dono'], 'DASH-PLATFORM'),
  rb('RB-MAP-INTERACTIVE', 'Mapa interativo degradado', ['marcador de release do frontend', 'tamanho da geometria', 'taxa de acerto de cache', 'tempo do raster', 'classe de dispositivo', 'tarefas longas', 'métricas do renderizador'], 'DASH-MAP'),
  rb('RB-AVAILABILITY-STALE', 'Disponibilidade sem atualização', ['feed de revisões', 'fonte upstream', 'fila', 'última ingestão com sucesso', 'revisão atual', 'bloquear ações se necessário'], 'DASH-COMMERCIAL'),
  rb('RB-PRICE-PUBLISH', 'Falha ao publicar tabela de preço', ['ver erro e requestId', 'verificar conflito de versão', 'verificar transação e audit', 'não reativar ponteiro manualmente sem aprovação', 'escalar ao dono comercial'], 'DASH-COMMERCIAL'),
  rb('RB-CACHE-CORRUPTION', 'Pico de cache corrompido', ['tipo de recurso afetado', 'versão do build', 'checksums do manifesto', 'limpar partição se sistêmico', 'refetch'], 'DASH-PWA'),
  rb('RB-JOB-RETRY-EXHAUSTED', 'Job esgotou tentativas', ['abrir item da dead letter', 'ver causa e attempt', 'corrigir causa', 'reprocessar com idempotência', 'confirmar heartbeat'], 'DASH-PIPELINES'),
  rb('RB-CRON-MISSED', 'Job periódico não rodou', ['último sucesso (heartbeat)', 'agendador', 'fila', 'executar manualmente se seguro'], 'DASH-PIPELINES'),
  rb('RB-DB-SATURATION', 'Pool do banco saturado', ['consultas lentas', 'transações longas', 'deadlocks', 'tráfego anômalo', 'escalar'], 'DASH-PLATFORM'),
  rb('RB-TENANT-SCOPE', 'Violação de escopo de organização', ['acionar segurança (dono)', 'identificar padrão por SecurityEvent', 'bloquear origem se necessário', 'não silenciar automaticamente'], 'DASH-SECURITY'),
  rb('RB-PWA-SYNC', 'Falhas de sincronização offline', ['versão do SW', 'estado do pacote offline', 'conflitos', 'conectividade', 'endpoint de sync'], 'DASH-PWA'),
  rb('RB-SYNTHETIC', 'Monitoramento sintético falhando', ['qual etapa falhou', 'saúde dos endpoints', 'deploy recente', 'confirmar com usuário de teste (nunca cliente real)'], 'DASH-PLATFORM'),
  rb('RB-FRONTEND-ERRORS', 'Pico de erros no navegador', ['grupo (fingerprint) e release', 'componente e rota', 'reproduzir com o diagnóstico técnico', 'corrigir ou desligar a feature'], 'DASH-MAP')
]);
const al = (alertId, metricOrQuery, condition, severity, owner, runbookRef, cooldownSeconds, autoResolve, scope, extra = {}) => [alertId, { alertId, metricOrQuery, condition, severity, owner, runbookRef, cooldownSeconds, autoResolve, scope, channel: null, silencePolicy: severity === 'CRITICAL' && owner === 'seguranca' ? 'NEVER_AUTO_SILENCE' : 'MAINTENANCE_WINDOW', ...extra }];
const alerts = Object.fromEntries([
  al('api_5xx_rate_high', 'api_errors_total{status_class=5xx} / api_requests_total', 'rate > 2% por 10 min (mín. 50 requisições)', 'HIGH', 'backend-api', 'RB-API-5XX', 900, true, 'BACKEND', { minSamples: 50, thresholdStatus: 'PROPOSED' }),
  al('api_latency_p95_high', 'api_request_duration_ms p95', 'p95 > 1500 ms por 15 min', 'WARNING', 'backend-api', 'RB-API-LATENCY', 1800, true, 'BACKEND', { thresholdStatus: 'PROPOSED' }),
  al('dependency_timeout_spike', 'dependency_timeouts_total', 'aumento > 5x da linha de base por 10 min', 'WARNING', 'backend-api', 'RB-API-LATENCY', 1800, true, 'BACKEND', { thresholdStatus: 'PROPOSED' }),
  al('db_pool_saturation', 'db_pool_utilization', '> 0.9 por 5 min', 'HIGH', 'backend-dados', 'RB-DB-SATURATION', 900, true, 'BACKEND', { thresholdStatus: 'PROPOSED' }),
  al('job_retry_exhausted', 'dead_letter_count', 'aumentou', 'HIGH', 'backend-jobs', 'RB-JOB-RETRY-EXHAUSTED', 3600, false, 'BACKEND'),
  al('cron_missed', 'job_last_success_timestamp', 'idade > 2x o intervalo esperado (alerta de ausência)', 'HIGH', 'backend-jobs', 'RB-CRON-MISSED', 3600, true, 'BACKEND'),
  al('price_publish_failure', 'price_table_publish_total{outcome=FAILURE}', '>= 1', 'HIGH', 'dados-comercial', 'RB-PRICE-PUBLISH', 600, false, 'BACKEND'),
  al('availability_feed_stale', 'data_freshness_age_ms{data_channel=AVAILABILITY}', 'idade > limite esperado (decisão O7)', 'HIGH', 'dados-comercial', 'RB-AVAILABILITY-STALE', 3600, true, 'LOCAL_AND_BACKEND', { thresholdMs: null, thresholdStatus: 'NEEDS_DECISION' }),
  al('availability_conflict_spike', 'availability_transition_total{outcome=CONFLICT}', '> 10 em 15 min', 'WARNING', 'dados-comercial', 'RB-AVAILABILITY-STALE', 1800, true, 'BACKEND', { thresholdStatus: 'PROPOSED' }),
  al('document_scan_failures', 'document_scan_failures_total', '> 5 em 30 min', 'WARNING', 'backend-documentos', 'RB-JOB-RETRY-EXHAUSTED', 3600, true, 'BACKEND', { thresholdStatus: 'PROPOSED' }),
  al('tenant_scope_violation', 'tenant_scope_violation_total', '>= 1', 'CRITICAL', 'seguranca', 'RB-TENANT-SCOPE', 300, false, 'LOCAL_AND_BACKEND', { minSamples: 1 }),
  al('cache_corruption_spike', 'cache_corruption_total', '>= 5 na sessão', 'HIGH', 'frontend-plataforma', 'RB-CACHE-CORRUPTION', 1800, true, 'LOCAL_AND_BACKEND', { minSamples: 5 }),
  al('frontend_error_spike', 'frontend_errors_total', '>= 10 erros na sessão (1 erro isolado nunca alerta)', 'WARNING', 'frontend-plataforma', 'RB-FRONTEND-ERRORS', 1800, true, 'LOCAL_AND_BACKEND', { minSamples: 10 }),
  al('map_interactive_degraded', 'map_interactive_duration_ms p95', 'p95 > 3000 ms (mín. 5 amostras)', 'WARNING', 'frontend-mapa', 'RB-MAP-INTERACTIVE', 3600, true, 'LOCAL_AND_BACKEND', { minSamples: 5, thresholdMs: 3000, thresholdStatus: 'PROPOSED' }),
  al('sync_failure_spike', 'offline_sync_failure_total', '>= 3 na sessão', 'WARNING', 'frontend-pwa', 'RB-PWA-SYNC', 1800, true, 'LOCAL_AND_BACKEND', { minSamples: 3 }),
  al('sw_update_failure_spike', 'sw_lifecycle_total{sw_event=UPDATE_FAILED}', '>= 2 na sessão', 'WARNING', 'frontend-pwa', 'RB-PWA-SYNC', 3600, true, 'LOCAL_AND_BACKEND', { minSamples: 2 }),
  al('telemetry_export_failing', 'telemetry_export_failures_total', '> 0', 'INFO', 'frontend-plataforma', 'RB-FRONTEND-ERRORS', 3600, true, 'LOCAL_AND_BACKEND', { minSamples: 1 }),
  al('synthetic_journey_failing', 'synthetic_check_success{check=SYNTHETIC_JOURNEY}', '0 em 3 execuções seguidas', 'HIGH', 'backend-api', 'RB-SYNTHETIC', 1800, true, 'BACKEND')
]);
const slo = (sloId, service, sli, target, window, owner, severityOnBreach, extra = {}) => [sloId, { sloId, service, sli, target, window, owner, severityOnBreach, status: 'PROPOSED_NEEDS_BASELINE', ...extra }];
const slos = Object.fromEntries([
  slo('slo_api_critical_success', 'backend-api', 'fração de requisições críticas sem 5xx', 0.999, '28d', 'backend-api', 'HIGH', { goodMetric: 'api_requests_total{status_class!=5xx}', totalMetric: 'api_requests_total' }),
  slo('slo_quickview_latency', 'frontend-plataforma', 'fração de QuickViews prontos abaixo do limite', 0.95, '28d', 'frontend-plataforma', 'WARNING', { thresholdMs: null, histogram: 'quickview_load_duration_ms' }),
  slo('slo_map_boot_success', 'frontend-mapa', 'fração de boots do mapa que chegam a INTERACTIVE', 0.99, '28d', 'frontend-mapa', 'HIGH', { histogram: 'map_interactive_duration_ms' }),
  slo('slo_share_access_success', 'backend-api', 'fração de acessos válidos a links que abrem', 0.995, '28d', 'backend-api', 'WARNING'),
  slo('slo_sync_success', 'frontend-pwa', 'fração de sincronizações concluídas', 0.99, '28d', 'frontend-pwa', 'WARNING'),
  slo('slo_availability_freshness', 'dados-comercial', 'fração do tempo com feed de disponibilidade dentro do limite', 0.99, '28d', 'dados-comercial', 'HIGH', { thresholdMs: null })
]);
const owner = (service, teamOrOwner, runbookRef, dashboardRef) => ({ service, teamOrOwner, runbookRef, dashboardRef, onCallPolicyRef: null, personStatus: 'NEEDS_DECISION' });
const ownership = [
  owner('frontend-plataforma', 'frontend-plataforma', 'RB-FRONTEND-ERRORS', 'DASH-MAP'), owner('frontend-mapa', 'frontend-mapa', 'RB-MAP-INTERACTIVE', 'DASH-MAP'),
  owner('frontend-pwa', 'frontend-pwa', 'RB-PWA-SYNC', 'DASH-PWA'), owner('backend-api', 'backend-api', 'RB-API-5XX', 'DASH-PLATFORM'),
  owner('backend-dados', 'backend-dados', 'RB-DB-SATURATION', 'DASH-PLATFORM'), owner('backend-jobs', 'backend-jobs', 'RB-JOB-RETRY-EXHAUSTED', 'DASH-PIPELINES'),
  owner('backend-documentos', 'backend-documentos', 'RB-JOB-RETRY-EXHAUSTED', 'DASH-PIPELINES'), owner('backend-analise', 'backend-analise', 'RB-JOB-RETRY-EXHAUSTED', 'DASH-PIPELINES'),
  owner('backend-analytics', 'backend-analytics', 'RB-JOB-RETRY-EXHAUSTED', 'DASH-PIPELINES'), owner('dados-comercial', 'dados-comercial', 'RB-AVAILABILITY-STALE', 'DASH-COMMERCIAL'),
  owner('seguranca', 'seguranca', 'RB-TENANT-SCOPE', 'DASH-SECURITY')
];
const dashboards = {
  'DASH-PLATFORM': { title: 'Visão geral da plataforma', panels: ['api_requests_total', 'api_errors_total', 'api_request_duration_ms', 'jobs_failed_total', 'db_pool_utilization', 'health_check_status'] },
  'DASH-MAP': { title: 'Experiência do mapa', panels: ['map_interactive_duration_ms', 'map_geometry_load_duration_ms', 'map_layer_switch_duration_ms', 'quickview_load_duration_ms', 'frontend_errors_total', 'web_vitals_lcp_ms', 'longtask_duration_ms'] },
  'DASH-COMMERCIAL': { title: 'Serviços comerciais críticos', panels: ['availability_transition_total', 'availability_revision_lag_ms', 'price_table_publish_total', 'data_freshness_age_ms', 'share_access_denied_total'] },
  'DASH-PIPELINES': { title: 'Pipelines de dados', panels: ['analysis_run_duration_ms', 'document_scan_failures_total', 'analytics_pipeline_lag_ms', 'rule_evaluation_duration_ms', 'jobs_in_queue', 'dead_letter_count'] },
  'DASH-PWA': { title: 'PWA e offline', panels: ['sw_lifecycle_total', 'offline_sync_pending', 'offline_sync_failure_total', 'connectivity_changes_total', 'cache_corruption_total', 'cache_stale_hits_total'] },
  'DASH-SECURITY': { title: 'Operações de segurança', panels: ['authorization_denied_total', 'tenant_scope_violation_total', 'rate_limit_rejections_total', 'share_access_denied_total'] }
};
const freshnessSignals = {
  AVAILABILITY: { metric: 'availability_feed_last_update', source: 'repo.getFreshnessState().availability', expectedMaxAgeMs: null, decision: 'O7' },
  PRICING: { metric: 'pricing_current_pointer_age', source: 'repo.getFreshnessState().commercial', expectedMaxAgeMs: null, decision: 'O7' },
  ANALYSIS: { metric: 'analysis_current_version_age', source: 'repo.getDataVersions().analysisVersion', expectedMaxAgeMs: null, decision: 'O7' }
};
const errorBoundaries = ['MapRenderer', 'QuickView', 'Comparison', 'CustomerWorkspace', 'PresentationRuntime', 'SharedRuntime', 'AnalyticsDashboard', 'DocumentViewer', 'Legend', 'Panels'];
const syntheticChecks = [
  { id: 'SYN-LOGIN-PAGE', check: 'LOGIN_PAGE', steps: ['GET / responde 200'], status: 'CONTRACT_ONLY' },
  { id: 'SYN-MAP-BOOTSTRAP', check: 'MAP_BOOTSTRAP', steps: ['manifesto e geometria respondem', 'checksum confere'], status: 'CONTRACT_ONLY' },
  { id: 'SYN-PUBLIC-SHARE', check: 'PUBLIC_SHARE', steps: ['link de teste conhecido abre o shell público'], status: 'CONTRACT_ONLY' },
  { id: 'SYN-HEALTH', check: 'LIVE', steps: ['GET /health/live 200', 'GET /health/ready 200'], status: 'CONTRACT_ONLY' },
  { id: 'SYN-JOURNEY', check: 'SYNTHETIC_JOURNEY', steps: ['login de usuário sintético', 'abrir empreendimento', 'bootstrap do mapa', 'QuickView de lote conhecido'], status: 'CONTRACT_ONLY', note: 'nunca usar cliente real' }
];
const reg = { version: '1.0.0', note: 'ObservabilityRegistry (tópico 51 §311–315): nomes de logs, métricas, spans, erros, alertas e SLOs. Um só catálogo para frontend, backend e docs. ACTIVE_LOCAL = medido neste aparelho; CONTRACT_ONLY = contrato para o servidor (sem servidor aqui).',
  logEvents, metrics, labelValues, labelPatterns, forbiddenLabels, spans, errors, userMessages, alerts, runbooks, slos, ownership, dashboards, freshnessSignals, errorBoundaries, syntheticChecks };
// full registry (docs, backend, CI) + browser copy (local signals only, no descriptions) to keep the page budget
const full = { ...reg, scope: 'FULL' };
fs.writeFileSync(process.argv[3], JSON.stringify(full, null, 1) + '\n');
const strip = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => !keys.includes(kk)))]));
const pick = (o, f) => Object.fromEntries(Object.entries(o).filter(([, v]) => f(v)));
const bAlerts = pick(alerts, a => a.scope !== 'BACKEND');
const usedRb = new Set(Object.values(bAlerts).map(a => a.runbookRef));
const browser = { version: reg.version, scope: 'BROWSER', note: 'Cópia do navegador: só sinais medidos no aparelho (ACTIVE_LOCAL), sem descrições. Registro completo: docs/OBSERVABILITY_REGISTRY.json.',
  logEvents: strip(logEvents, ['description']), metrics: strip(pick(metrics, m => m.status === 'ACTIVE_LOCAL'), ['description']), labelValues, labelPatterns, forbiddenLabels,
  spans: strip(pick(spans, x => x.status === 'ACTIVE_LOCAL'), ['description']), errors, userMessages, alerts: bAlerts, runbooks: pick(runbooks, r => usedRb.has(r.id)), slos, freshnessSignals, errorBoundaries };
fs.writeFileSync(out, JSON.stringify(browser) + '\n');
console.log('metrics', Object.keys(metrics).length, 'spans', Object.keys(spans).length, 'errors', Object.keys(errors).length, 'alerts', Object.keys(alerts).length, 'events', Object.keys(logEvents).length);
