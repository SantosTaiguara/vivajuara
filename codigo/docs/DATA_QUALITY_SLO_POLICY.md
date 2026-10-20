# Política de SLOs de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. Estrutura sem metas: target null = NOT_CONFIGURED; o baseline observado é informativo.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| SLO | Métrica | Meta | Baseline observado | Status |
|---|---|---|---|---|
| SLO-LOT-ID-UNIQUENESS | lot_id_uniqueness_rate | **null — necessita confirmação** | 1 | NOT_CONFIGURED |
| SLO-GEOMETRY-VALID | published_lots_valid_geometry_rate | **null — necessita confirmação** | 1 | NOT_CONFIGURED |
| SLO-AVAILABILITY-FRESHNESS | availability_known_and_fresh_rate | **null — necessita confirmação** | 0 | NOT_CONFIGURED |
| SLO-PRICING-COVERAGE | lots_with_current_price_rate | **null — necessita confirmação** | 1 | NOT_CONFIGURED |
| SLO-ANALYSIS-CURRENT | lots_with_current_analysis_rate | **null — necessita confirmação** | 1 | NOT_CONFIGURED |

Alertas: [object Object].
