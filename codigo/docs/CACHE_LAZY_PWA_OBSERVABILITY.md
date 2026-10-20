# Observabilidade de cache, carregamento progressivo e PWA

## Carregamento (tópico 47)

`LoadCoordinator.diagnostics()` já entrega fila, deduplicação, cancelamentos, descartes por contexto antigo, falhas opcionais e taxa de prefetch. `signals.fromLoadingDiagnostics(d)` resume; `instrument.loadingSnapshot(d)` grava `prefetch_hit_rate` e `prefetch_waste_rate`; `instrument.resource(type, ms | { error })` grava `resource_load_duration_ms{resource_type}` e `resource_load_failures_total{resource_type,error_category}`. Contadores: `stale_result_discard_total`, `cancelled_load_total`, `resource_dedup_total`.

Integração sugerida: passar `hooks.telemetry` ao `LoadCoordinator` e encaminhar os eventos de fim de carga para `instrument.resource`.

## Cache (tópico 48)

`CacheManager.inspect()` (contagens, tamanhos, estados, sem conteúdo) → `signals.fromCacheInspect(d)` / `instrument.cacheSnapshot(d)` (`cache_entries{storage_tier}`). Linhas com resourceId nunca são copiadas (teste). Corrupção: `instrument.cacheCorruption(type)` → `cache_corruption_total{resource_type}` + WARN `CACHE_CORRUPT_ENTRY`; o CacheManager já remove e busca de novo. Alerta `cache_corruption_spike` com ≥ 5 na sessão (HIGH, RB-CACHE-CORRUPTION).

Atualidade de cache (TTL) ≠ atualidade do dado: a segunda está em HEALTH_CHECK_POLICY.md.

## PWA (tópico 49)

`instrument.sw(event)` (INSTALL, ACTIVATE, UPDATE_AVAILABLE, UPDATE_FAILED, OFFLINE_BOOT) → `sw_lifecycle_total{sw_event}`; `instrument.connectivity(state)` → `connectivity_changes_total{connectivity_state}`; `instrument.syncResult({ pending, failed, conflict })` → `offline_sync_pending`, `offline_sync_failure_total`, `offline_sync_conflict_total` + logs `PWA_SYNC_FAILED` / `PWA_SYNC_CONFLICT`. Alertas locais: `sync_failure_spike` (≥ 3), `sw_update_failure_spike` (≥ 2).

O diagnóstico de suporte inclui o resumo PWA: SW registrado e versão, pronto para offline, conectividade, pendências de sync e origem dos dados (cenário `ObsMultiTabPwaIssueDiagnostic`).

Nenhum arquivo do tópico 49 (sw.template.js, offline.js) foi editado aqui; os pontos de chamada estão na receita de integração do relatório.
