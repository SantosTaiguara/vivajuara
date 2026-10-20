# Resposta a incidentes de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. Política de severidade: PROPOSTA — necessita confirmação.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Nível | Definição |
|---|---|
| SEV1 | Preço ou disponibilidade errados usados em transação ao vivo. |
| SEV2 | Degradação significativa do conjunto de dados afetando recomendações. |
| SEV3 | Problema parcial de qualidade com contorno. |
| SEV4 | Anomalia menor, não crítica. |

Fluxo: OPEN → INVESTIGATING → MITIGATING → RESOLVED → CLOSED. RESOLVED exige todas as ações DONE e verificação passando; materiais (SEV1/SEV2) exigem RCA + prevenção; CLOSED de SEV1/SEV2 exige postmortem blameless. `suggestSeverity` sugere, humano decide.
