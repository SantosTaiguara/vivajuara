# Arquitetura de contratos de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Contrato | Produtor | Consumidores | Domínio | Versão schema | Campos |
|---|---|---|---|---|---|
| DC-PRICING-FINANCIAL | pricing | financial, proposal, share | PRICING | 1.0.0 | commercial.price, commercial.pricePerM2, commercial.priceTableVersion, commercial.currency |
| DC-AVAILABILITY-RECOMMENDATION | availability | recommendation, decision, map, share | AVAILABILITY | 1.0.0 | availability.status, availability.revision, availability.updatedAt |
| DC-LOT-STATIC-MAP | lot | map, quickview, compare, filters | LOT_IDENTITY | 1.0.0 | identity.id, identity.code, geometry.areaM2, geometry.polygon |
| DC-ANALYSIS-RECOMMENDATION | analysis | recommendation, compare, quickview | ANALYSIS | 1.0.0 | intelligence.scores.overall, intelligence.class, intelligence.analysisVersion |
