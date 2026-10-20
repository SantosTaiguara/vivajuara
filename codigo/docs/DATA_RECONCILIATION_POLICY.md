# Política de reconciliação (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. automaticCorrection é NEVER para identidade e geometria (validação recusa a política).
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Política | Domínio | Fonte autoritativa | Chaves | Campos | Correção automática | Cadência |
|---|---|---|---|---|---|---|
| RP-AVAILABILITY | AVAILABILITY | **null — necessita confirmação** | identity.id | availability.status, availability.revision | NEVER | **null — necessita confirmação** |
| RP-LOT-IDENTITY | LOT_IDENTITY | official-plan-v1 | identity.id | identity.code, identity.blockId, identity.lotNumber | NEVER | **null — necessita confirmação** |
| RP-GEOMETRY | GEOMETRY | official-plan-v1 | identity.id | geometry.areaM2 | NEVER | **null — necessita confirmação** |
| RP-PRICING | PRICING | price-table-v1 | identity.id | commercial.price, commercial.priceTableVersion | NEVER | **null — necessita confirmação** |
| RP-SPATIAL-INDEX | GEOMETRY | official-plan-v1 | identity.id | spatialIndexVersion | SAFE_ONLY | **null — necessita confirmação** |

SAFE_ONLY só para artefato derivado (índice espacial), regenerável a partir da fonte. Divergência gera finding; nunca sobrescreve silenciosamente.
