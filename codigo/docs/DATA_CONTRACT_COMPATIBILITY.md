# Compatibilidade de contratos (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

`workflow.contractCompatibility(old, new)` classifica: **BREAKING** (campo removido, tipo/unidade mudou, nullable→not-null invertido para o consumidor, enum reduzido) exige versão major + aprovação dos consumidores; **NON_BREAKING** (campo opcional novo, enum ampliado) exige minor; inalterado = COMPATIBLE. Contrato quebrante nunca é aplicado em silêncio; o gate do consumidor bloqueia.
