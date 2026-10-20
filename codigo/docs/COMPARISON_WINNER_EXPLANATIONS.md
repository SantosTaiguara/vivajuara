# Explicações e reason codes (Tópico 25)

O domínio devolve fatos (`marginSummary`, `reasonCodes`, `suppressionReasons`, `caveats`); as frases são montadas em `App.compare.viewModel.rowTexts`. Nunca "é melhor", "vale mais", "rentabilidade", "retorno" ou promessa de valorização.

## Reason codes

`LOWEST_VALUE`, `HIGHEST_VALUE`, `CLOSE_TO_TARGET`, `WITHIN_TARGET_RANGE`, `HIGHEST_ORDERED_CATEGORY`, `PREFERRED_BOOLEAN_VALUE`, `ONLY_VALID_CANDIDATE_SUPPRESSED`, `TIED_TOP_VALUE`, `ALL_TIED`, `NO_MATERIAL_DIFFERENCE`, `STALE_SUPPRESSION`, `CONFLICT_SUPPRESSION`, `LOW_CONFIDENCE_SUPPRESSION`, `PARTIAL_DATA_SUPPRESSION`, `INSUFFICIENT_DATA`, `CONTEXT_REQUIRED`, `NOT_ORDERED`, `INFORMATIONAL_ONLY`, `VERSION_MISMATCH`, `EVALUATION_ERROR`.

Motivos de supressão: `INSUFFICIENT_VALID_VALUES`, `MISSING_CONTEXT`, `STALE_DATA`, `CONFLICTED_DATA`, `LOW_CONFIDENCE`, `NON_ORDERED_METRIC`, `NO_MATERIAL_DIFFERENCE`, `VERSION_MISMATCH`, `POLICY_DISABLED`, `NOT_APPLICABLE`, `UNKNOWN_SEMANTICS`, `PARTIAL_DATA`, `INVALID_VALUE`.

## Textos por status

| Status | Corretor / técnico | Cliente / apresentação |
|---|---|---|
| WINNER | "QF L6 possui o menor preço de tabela entre os lotes comparados, R$ 21 mil abaixo de QA L1." | igual (badge "Destaque") |
| WINNER parcial | "… entre os 3 lotes com dados." + "Comparação parcial: 3 de 4 lotes com dados." | suprimido |
| TIE (topo) | "Empate entre QA L1 e QB L2." (badge "Empate") | sem badge |
| TIE (todos) | "Empate técnico em Preço/m²." | sem texto |
| NO_CLEAR_WINNER | "Sem diferença relevante em X entre os lotes. Ligeira vantagem de QA L1." | "Sem diferença relevante em X entre os lotes." |
| INSUFFICIENT_DATA | "Não é possível destacar um lote neste critério porque faltam dados." | — |
| CONTEXT_REQUIRED | "Este atributo depende da preferência do cliente." / Fit: "Disponível quando há um perfil de cliente." | — |
| SUPPRESSED | "Não foi possível destacar um lote devido a dados desatualizados / dados divergentes / baixa confiabilidade da estimativa / falta de dados em parte dos lotes / versões de dados diferentes." | — |
| ERROR | "Destaque indisponível para este critério." | — |
| NON_ORDERED / INFORMATIONAL | técnico: "Atributo descritivo, sem ordem de preferência." / "Informativo, sem destaque." | — |

## Ressalvas (`caveats`)

Preço de tabela ("não inclui condições de negociação"), depende do perfil, compatibilidade não é probabilidade de compra, estimativa da análise, não é promessa de valorização, classe relativa aos lotes do empreendimento, valor desatualizado ("Valor sujeito a confirmação." para cliente), comparação parcial.
Cliente vê ressalvas só em linhas com destaque; corretor em todas as avaliadas, exceto CONTEXT_REQUIRED/NOT_COMPARABLE.

## Células e acessibilidade

`cellState`: WINNER, CO_WINNER, CLOSE, NORMAL, WEAKER (só corretor/técnico; anunciado "Valor menos favorável neste critério", nunca "ruim"), NO_DATA, STALE, CONFLICTED, SUPPRESSED.
O `aria-label` da célula inclui critério, lote, valor, nota de frescor e o destaque ("Destaque neste critério: QF L6 possui o menor preço de tabela."). Cor nunca é o único sinal.

## Modo técnico

`policyText`: "Regra: menor valor preferível · empate: até R$ 0,01 · margem: ≥ 2,0% · confiança mínima: baixa · confiança do resultado: alta · política 1.0.0 · motivos: … · preferência: <rationaleCode>".

## Compartilhar

`shareFacts(evaluation, { names })` devolve só linhas WINNER claras, com frase segura ("QF L6: menor preço de tabela"), sem notas, scores, Fit ou dados do cliente.
