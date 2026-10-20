# Drift de schema (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Baseline `SCHEMA-VJ-LOTS-JSON` (77 campos, 2026-10-16). Campo removido / tipo mudou = BREAKING → BLOCK; campo novo / nullability ampliada = NON_BREAKING → REVIEW. Baseline só muda por ChangeRequest. Resultado atual: PASSED.
