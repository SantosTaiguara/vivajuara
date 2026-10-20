# Dimensões de qualidade (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. O scorecard é dimensional; não há nota ponderada (pesos seriam política inventada).
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Dimensão | Status (dados atuais) | Regras |
|---|---|---|
| COMPLETENESS | DEGRADED | 6 |
| VALIDITY | HEALTHY | 5 |
| UNIQUENESS | HEALTHY | 3 |
| CONSISTENCY | HEALTHY | 3 |
| REFERENTIAL_INTEGRITY | HEALTHY | 3 |
| FRESHNESS | UNKNOWN |  |
| TIMELINESS | UNKNOWN |  |
| PROVENANCE_COVERAGE | DEGRADED | 2 |
| VERSION_COMPATIBILITY | HEALTHY | 3 |
| DOMAIN_COHERENCE | HEALTHY | 3 |
| GEOMETRY_INTEGRITY | HEALTHY | 2 |
| AUTHORITY_AGREEMENT | UNKNOWN |  |
