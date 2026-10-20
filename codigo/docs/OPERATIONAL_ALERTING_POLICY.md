# Política de alertas operacionais

Alertar quando **ação humana pode ser necessária**, não quando qualquer métrica muda. Um erro 500 isolado nunca dispara (teste: 1 erro → OK; 5 corrupções de cache → FIRING; em seguida → FIRING_COOLDOWN).

- Níveis: INFO (sem paging), WARNING (horário comercial), HIGH (impacto significativo), CRITICAL (usuários amplamente bloqueados ou risco relevante).
- Todo alerta tem dono, gravidade, runbook, cooldown e política de silêncio. HIGH/CRITICAL sem runbook falham a validação do registro (CI).
- Canal: vazio (`channel: null`) até a decisão O6. Nenhum alerta pagina ninguém hoje.
- Segurança CRITICAL (`tenant_scope_violation`) é `NEVER_AUTO_SILENCE`: janela de manutenção não silencia.
- Alertas de staging não paginam produção (o ambiente vai em todo sinal).
- Alertas não contêm PII (só métricas agregadas).
- Separação: o motor de regras (tópico 36) gera alertas de **domínio/dados** (ex.: lote sem preço). Estes são alertas de **aplicação/infraestrutura** (ex.: 5xx da API de preço).
- No aparelho, `signals.evaluateLocalAlerts` avalia só os alertas de escopo local, para a visão "Saúde da plataforma". Nada é enviado.
- Preferir burn rate multi-janela para SLO (`burnRateAlert(curta, longa)`: HIGH se ambas ≥ 14,4; WARNING se ambas ≥ 6). Pico curto sozinho não alerta.

## Catálogo

| Alerta | Gravidade | Métrica/consulta | Condição | Dono | Runbook | Cooldown | Escopo | Limite |
|---|---|---|---|---|---|---|---|---|
| `api_5xx_rate_high` | HIGH | api_errors_total{status_class=5xx} / api_requests_total | rate > 2% por 10 min (mín. 50 requisições) | backend-api | RB-API-5XX | 900 s | servidor | proposto |
| `api_latency_p95_high` | WARNING | api_request_duration_ms p95 | p95 > 1500 ms por 15 min | backend-api | RB-API-LATENCY | 1800 s | servidor | proposto |
| `dependency_timeout_spike` | WARNING | dependency_timeouts_total | aumento > 5x da linha de base por 10 min | backend-api | RB-API-LATENCY | 1800 s | servidor | proposto |
| `db_pool_saturation` | HIGH | db_pool_utilization | > 0.9 por 5 min | backend-dados | RB-DB-SATURATION | 900 s | servidor | proposto |
| `job_retry_exhausted` | HIGH | dead_letter_count | aumentou | backend-jobs | RB-JOB-RETRY-EXHAUSTED | 3600 s | servidor | definido |
| `cron_missed` | HIGH | job_last_success_timestamp | idade > 2x o intervalo esperado (alerta de ausência) | backend-jobs | RB-CRON-MISSED | 3600 s | servidor | definido |
| `price_publish_failure` | HIGH | price_table_publish_total{outcome=FAILURE} | >= 1 | dados-comercial | RB-PRICE-PUBLISH | 600 s | servidor | definido |
| `availability_feed_stale` | HIGH | data_freshness_age_ms{data_channel=AVAILABILITY} | idade > limite esperado (decisão O7) | dados-comercial | RB-AVAILABILITY-STALE | 3600 s | aparelho + servidor | limite a decidir (O7) |
| `availability_conflict_spike` | WARNING | availability_transition_total{outcome=CONFLICT} | > 10 em 15 min | dados-comercial | RB-AVAILABILITY-STALE | 1800 s | servidor | proposto |
| `document_scan_failures` | WARNING | document_scan_failures_total | > 5 em 30 min | backend-documentos | RB-JOB-RETRY-EXHAUSTED | 3600 s | servidor | proposto |
| `tenant_scope_violation` | CRITICAL | tenant_scope_violation_total | >= 1 | seguranca | RB-TENANT-SCOPE | 300 s | aparelho + servidor | definido |
| `cache_corruption_spike` | HIGH | cache_corruption_total | >= 5 na sessão | frontend-plataforma | RB-CACHE-CORRUPTION | 1800 s | aparelho + servidor | definido |
| `frontend_error_spike` | WARNING | frontend_errors_total | >= 10 erros na sessão (1 erro isolado nunca alerta) | frontend-plataforma | RB-FRONTEND-ERRORS | 1800 s | aparelho + servidor | definido |
| `map_interactive_degraded` | WARNING | map_interactive_duration_ms p95 | p95 > 3000 ms (mín. 5 amostras) | frontend-mapa | RB-MAP-INTERACTIVE | 3600 s | aparelho + servidor | proposto |
| `sync_failure_spike` | WARNING | offline_sync_failure_total | >= 3 na sessão | frontend-pwa | RB-PWA-SYNC | 1800 s | aparelho + servidor | definido |
| `sw_update_failure_spike` | WARNING | sw_lifecycle_total{sw_event=UPDATE_FAILED} | >= 2 na sessão | frontend-pwa | RB-PWA-SYNC | 3600 s | aparelho + servidor | definido |
| `telemetry_export_failing` | INFO | telemetry_export_failures_total | > 0 | frontend-plataforma | RB-FRONTEND-ERRORS | 3600 s | aparelho + servidor | definido |
| `synthetic_journey_failing` | HIGH | synthetic_check_success{check=SYNTHETIC_JOURNEY} | 0 em 3 execuções seguidas | backend-api | RB-SYNTHETIC | 1800 s | servidor | definido |

Limites marcados como "proposto" precisam de linha de base real (decisão O5). Donos são lógicos; pessoas e plantão: decisão O6.

## Runbooks

### RB-API-LATENCY — Latência da API

Painel: DASH-PLATFORM

1. verificar deploy recente (marcador de release)
2. verificar latência do banco
3. verificar chamadas a dependências
4. verificar saturação
5. olhar traces p95/p99
6. rollback ou escalar
### RB-API-5XX — Taxa de 5xx

Painel: DASH-PLATFORM

1. identificar endpoint_group e versão
2. abrir trace de um requestId afetado
3. verificar dependências e banco
4. rollback se começou após deploy
5. escalar ao dono
### RB-MAP-INTERACTIVE — Mapa interativo degradado

Painel: DASH-MAP

1. marcador de release do frontend
2. tamanho da geometria
3. taxa de acerto de cache
4. tempo do raster
5. classe de dispositivo
6. tarefas longas
7. métricas do renderizador
### RB-AVAILABILITY-STALE — Disponibilidade sem atualização

Painel: DASH-COMMERCIAL

1. feed de revisões
2. fonte upstream
3. fila
4. última ingestão com sucesso
5. revisão atual
6. bloquear ações se necessário
### RB-PRICE-PUBLISH — Falha ao publicar tabela de preço

Painel: DASH-COMMERCIAL

1. ver erro e requestId
2. verificar conflito de versão
3. verificar transação e audit
4. não reativar ponteiro manualmente sem aprovação
5. escalar ao dono comercial
### RB-CACHE-CORRUPTION — Pico de cache corrompido

Painel: DASH-PWA

1. tipo de recurso afetado
2. versão do build
3. checksums do manifesto
4. limpar partição se sistêmico
5. refetch
### RB-JOB-RETRY-EXHAUSTED — Job esgotou tentativas

Painel: DASH-PIPELINES

1. abrir item da dead letter
2. ver causa e attempt
3. corrigir causa
4. reprocessar com idempotência
5. confirmar heartbeat
### RB-CRON-MISSED — Job periódico não rodou

Painel: DASH-PIPELINES

1. último sucesso (heartbeat)
2. agendador
3. fila
4. executar manualmente se seguro
### RB-DB-SATURATION — Pool do banco saturado

Painel: DASH-PLATFORM

1. consultas lentas
2. transações longas
3. deadlocks
4. tráfego anômalo
5. escalar
### RB-TENANT-SCOPE — Violação de escopo de organização

Painel: DASH-SECURITY

1. acionar segurança (dono)
2. identificar padrão por SecurityEvent
3. bloquear origem se necessário
4. não silenciar automaticamente
### RB-PWA-SYNC — Falhas de sincronização offline

Painel: DASH-PWA

1. versão do SW
2. estado do pacote offline
3. conflitos
4. conectividade
5. endpoint de sync
### RB-SYNTHETIC — Monitoramento sintético falhando

Painel: DASH-PLATFORM

1. qual etapa falhou
2. saúde dos endpoints
3. deploy recente
4. confirmar com usuário de teste (nunca cliente real)
### RB-FRONTEND-ERRORS — Pico de erros no navegador

Painel: DASH-MAP

1. grupo (fingerprint) e release
2. componente e rota
3. reproduzir com o diagnóstico técnico
4. corrigir ou desligar a feature
