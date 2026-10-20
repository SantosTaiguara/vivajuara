# Troca de fonte de autoridade (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

`transitionSourceAuthorityChange` só aprova com relatório de cutover (`engine.authorityCutoverReport`) com decisão PASS (fonte antiga e nova reconciliadas). Domínios sem fonte autoritativa hoje: AVAILABILITY, DOCUMENTS.
