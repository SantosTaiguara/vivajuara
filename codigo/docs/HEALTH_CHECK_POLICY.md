# Política de health checks

## Servidor (contrato + o que já existe)

| Endpoint | Hoje | Contrato |
|---|---|---|
| `/health/live` | não existe | mínimo `{ status: 'ok' }` (`telemetry.liveBody()`), sem versão nem dependências |
| `/health` | existe, público, mostra versão e writesEnabled | manter por compatibilidade; mover detalhes para `/health/details` |
| `/health/ready` | existe: consulta `schema_migrations` | pode verificar recursos críticos (banco); 503 `NOT_READY` |
| `/health/details` | não existe | **protegido** (ops), dependências e versões; nunca topologia/segredos em público |
| `/health/connectivity` | não existe | mínimo e rápido para o tópico 49 (204 sem corpo) |

Health check indica a condição atual; não substitui monitoramento. Métrica de contrato `health_check_status{check}` e checks sintéticos em OBSERVABILITY_DASHBOARDS.md.

## Navegador ("Saúde da plataforma")

- `liveness()` → OK enquanto o script roda.
- `readiness({ lotCount, mapReadiness, configOk })` → OK / DEGRADED / DOWN / UNKNOWN (sem lotes = DOWN; mapa carregando = DEGRADED).
- `connectivity(state)` → ONLINE / OFFLINE / DEGRADED / UNKNOWN.
- `dependencies(...)` → origem dos dados (servidor, cópia do aparelho, cópia embutida), armazenamento local, cache persistente, modo offline. Sem informação → "não disponível".

## Atualidade dos dados (≠ validade do cache)

`signals.freshnessSignals({ freshnessState: repo.getFreshnessState(), versions: repo.getDataVersions() })` lê o FreshnessState do `data/lifecycle.js` (não recalcula):

| Canal | Fonte | Limite esperado |
|---|---|---|
| Disponibilidade | `freshnessState.availability.lastSuccessfulSyncAt` | **necessita confirmação** (O7) |
| Preço (tabela) | `freshnessState.commercial` | **necessita confirmação** (O7) |
| Análise | `versions.analysisVersion` | versionado, sem idade |

Os 498 lotes estão com disponibilidade não confirmada: o canal aparece "não confirmado", nunca "atual". Sem limite decidido não há alerta (estado NEEDS_DECISION). Com limite, a **ausência** de confirmação também dispara `availability_feed_stale` (§198, testado com limite simulado).
