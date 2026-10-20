# Modelo de saúde (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Precedência por domínio: CRITICAL (findings bloqueantes) > UNKNOWN (sem regras / check falhou / frescor CLOCK desconhecido / sem fonte autoritativa / inativo) > DEGRADED > HEALTHY. Geral baseado em regras (pior relevante), sem média.

## Saúde atual — geral `UNKNOWN`
| Domínio | Status | Motivo |
|---|---|---|
| DEVELOPMENT | UNKNOWN | NO_RULES_EVALUATED |
| LOT_IDENTITY | DEGRADED | OPEN_FINDINGS |
| GEOMETRY | HEALTHY |  |
| PRICING | HEALTHY |  |
| AVAILABILITY | UNKNOWN | FRESHNESS_UNKNOWN |
| DOCUMENTS | UNKNOWN | NO_RULES_EVALUATED |
| ANALYSIS | HEALTHY |  |
| CUSTOMER | UNKNOWN | NOT_MONITORED |
| JOURNEY | UNKNOWN | NOT_MONITORED |
| COMMERCIAL_TRANSACTION | UNKNOWN | NOT_MONITORED |
| PRIVACY | UNKNOWN | NOT_MONITORED |
| INTEGRATION_REFERENCE | UNKNOWN | NOT_MONITORED |
