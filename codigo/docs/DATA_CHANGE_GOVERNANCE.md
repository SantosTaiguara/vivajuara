# Governança de mudanças de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Mudança de regra, contrato, schema, fonte ou política = ChangeRequest: DRAFT → REVIEW → APPROVED → APPLIED (ou REJECTED). Exige impacto avaliado; aprovador ≠ solicitante; mudança quebrante exige plano de migração. Regras novas entram em SHADOW.
