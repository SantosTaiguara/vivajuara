# Política de qualidade de dados (tópico 44)

Toda série devolvida por `App.semanticLayer.query` traz `metadata.quality[metricCode] = { status, issueCodes, label, coverage? }`. O estado final é o pior encontrado na ordem VALID < DEGRADED < STALE < INCOMPLETE < BLOCKED.

| Código | Estado | Quando |
|---|---|---|
| `NOT_PUBLISHED` | BLOCKED | métrica DRAFT ou DEPRECATED |
| `REQUIRES_BACKEND` / motivo do bloqueio | BLOCKED | fato não existe no aparelho |
| `PRODUCER_NOT_WIRED` | BLOCKED | nenhum evento de origem foi emitido por um produtor conectado |
| `BUFFER_TRUNCATED` | INCOMPLETE | o buffer descartou eventos dentro do período |
| `CONSENT_DENIED` | INCOMPLETE | consentimento recusado; dados locais foram apagados |
| `SAMPLED_SOURCE` | DEGRADED | algum evento de origem é amostrado |
| `QUARANTINED_SOURCE_EVENTS` | DEGRADED | há eventos de origem em quarentena |
| `LOW_COVERAGE_<DIM>` | DEGRADED | menos de 80% das linhas têm a dimensão conhecida |
| (reservado) | STALE | estado previsto para frescor de fontes do servidor; o buffer local é sempre atual, então hoje não é emitido |

## Regras
- BLOCKED zera a exibição: `value = null`, sem numerador/denominador, rótulo "não disponível". Nunca 0.
- `null` nunca vira 0; UNKNOWN nunca vira categoria conhecida.
- Métricas de qualidade do próprio rastreador (`analytics_event_drop_rate`, `analytics_quarantine_rate`, `analytics_sampled_out_rate`) vêm dos contadores de saúde do tópico 45 e aparecem na visão "Métricas locais".
- `metadata.freshness` informa a idade do último evento; `metadata.generatedAt` e `timezone` acompanham todo resultado.
