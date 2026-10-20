# Análise de causa raiz (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

`recordRootCause`: categoria (SOURCE_ERROR, MAPPING_ERROR, PIPELINE_BUG, RULE_GAP, HUMAN_PROCESS, EXTERNAL, UNKNOWN), descrição, fatores contribuintes, lacuna de detecção, ações de prevenção; sempre `blameless: true` (sem nomes de pessoas como causa). Postmortem: o que aconteceu, impacto, causa, por que a detecção falhou, o que corrigiu, prevenção.
