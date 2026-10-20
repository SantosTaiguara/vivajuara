# Códigos de motivo da explicação

Tópico 16. Códigos emitidos por `plat/src/intelligence/explanation.js` e textos correspondentes em `plat/src/presentation/panels.js` (mapas `SUMMARY`, `DQ`, `PAIR`). Os códigos herdados do motor de recomendação (exclusão, revisão, `keyReasonCodes`) estão em `RECOMMENDATION_REASON_CODES.md`; os do Fit vêm de `plat/src/intelligence/fit.js`.

O motor só devolve códigos; o texto é escolhido pela apresentação e depende do modo. Um código sem texto não aparece para o usuário (ver pendências).

## 1. Tipos de fator (`factorType`)

| Tipo | Emitido por | Conteúdo |
|---|---|---|
| `POSITIVE` | `explainLot` | preferência com `FIT_STRONG_MATCH` e contribuição ≥ 1 ponto |
| `NEGATIVE` | `explainLot` | preferência com `FIT_MISMATCH`, com `lost` (pontos perdidos) |
| `CONSTRAINT_PASS` | `explainLot` | restrição atendida |
| `CONSTRAINT_FAIL` | `explainLot` | restrição violada (não ocorre em itens listados: FAIL exclui o lote) |
| `CONSTRAINT_UNKNOWN` | `explainLot` | restrição sem dado (lote em revisão ou com aviso) |
| `DATA_QUALITY` | `explainLot` | disponibilidade, motivo de revisão, dado ausente ou estimado, preço STALE |
| `CONTRIBUTION` | `explainTechnical` | critério do score técnico |

`NEUTRAL`, `TIE_BREAK` e `RANK_CHANGE`, previstos na especificação, não são emitidos como `factorType`; o desempate aparece em `comparePair.tieBreakUsed` e a mudança de posição em `rankChange`.

## 2. Resumo do lote (`summaryReasonCodes`)

Primeiro código, conforme o tier, e depois os `keyReasonCodes` do item (sem repetir `TOP_FIT`):

| Código | Quando | Texto (`SUMMARY`) |
|---|---|---|
| `TOP_FIT` | 1º da lista e PRIMARY | "É o lote mais compatível com o perfil." |
| `TIER_PRIMARY` | PRIMARY não 1º | "Está entre as melhores opções para o perfil." |
| `TIER_STRONG_MATCH` | STRONG_MATCH | "Tem forte aderência ao perfil." |
| `TIER_ALTERNATIVE` | ALTERNATIVE | "É uma alternativa razoável para o perfil." |
| `REVIEW_REQUIRED` | em revisão | "Combina com o perfil, mas a disponibilidade precisa ser confirmada antes de oferecer." |
| `NOT_IN_RESULTS` | lote fora de `recommendations` e `reviewCandidates` | "Este lote não está na recomendação atual." |

Hoje, sem espelho de vendas, todo lote listado está em revisão: o resumo é sempre `REVIEW_REQUIRED` seguido de `AVAILABILITY_UNKNOWN` (verificado).

## 3. Códigos de fator de preferência

Vêm de `PreferenceMatchResult.reasonCode` (Fit, tópico 14):

| Código | Regra (`config/fit/viva-juara.json`) | Uso na explicação |
|---|---|---|
| `FIT_STRONG_MATCH` | `matchScore ≥ strengthMin` (0.75) | candidato a fator positivo |
| `FIT_PARTIAL_MATCH` | entre 0.4 e 0.75 | só na `preferenceTable` |
| `FIT_MISMATCH` | `matchScore ≤ mismatchMax` (0.4) | candidato a fator negativo |
| `FIT_MISSING_LOT_DATA` | campo nulo no lote | vira `PREFERENCE_NOT_EVALUATED` |
| `FIT_MISSING_CONTEXT` | matcher sem contexto | vira `PREFERENCE_NOT_EVALUATED` |

Os rótulos das preferências vêm de `fitCfg.preferences[key].label` (por exemplo "Privacidade", "Silêncio"); o popover nunca mostra a chave interna se houver rótulo.

## 4. Fatores de restrição

`constraintFactors[i].reasonCode`: `CONSTRAINT_PASSED` em PASS (ou `STALE_COMMERCIAL_DATA` em PASS com preço STALE); nos demais, o código da avaliação (`UNKNOWN_PRICE`, `UNKNOWN_REAR`, `CONFLICTED_DATA` etc., ver `RECOMMENDATION_REASON_CODES.md`). O popover do corretor lista as que não são PASS na seção "Exigências", com o código cru.

## 5. Qualidade do dado (`dataQualityFactors`)

| Código | Origem | Texto (`DQ`) |
|---|---|---|
| `AVAILABILITY_UNKNOWN` | `availabilityStatus === 'UNKNOWN'` (sempre listado, com `metricKey availability.status`) | "Disponibilidade não confirmada" |
| `ESTIMATED_INPUT` | preferência avaliada com proveniência `ESTIMATED`, `TO_CONFIRM`, `UNKNOWN` ou `CONFLICTED` | "Usa estimativa" |
| `PREFERENCE_NOT_EVALUATED` | preferência sem `matchScore` | "Sem dado para avaliar" |
| `STALE_PRICE` | aviso `STALE_PRICE` do Fit | "Preço não confirmado nesta sessão" |
| `STALE_COMMERCIAL_DATA` | motivo de revisão | "Dado comercial não confirmado" |
| `STALE_AVAILABILITY`, `LOW_FIT_COVERAGE`, `LOW_FIT_CONFIDENCE`, `UNKNOWN_*`, `CONFLICTED_DATA`, `CRITICAL_DATA_UNKNOWN` | motivos de revisão repassados | sem texto |

Exemplo verificado (Privacidade + Silêncio): ruído e privacidade são estimados nos 498 lotes, então o lote recebe `ESTIMATED_INPUT` para `environmental.privacyScore` e `environmental.quietScore`, além de `AVAILABILITY_UNKNOWN`. O popover mostra "Qualidade do dado: Disponibilidade não confirmada; Usa estimativa."

## 6. Par a par (`comparePair.summaryReasonCodes`)

Um único código, na ordem de decisão:

| Código | Regra | Texto (`PAIR`), após "O <lote acima> …" |
|---|---|---|
| `DIFFERENT_ELIGIBILITY` | um dos dois está em revisão e o outro não | "está na lista principal, e o outro precisa de revisão antes de ser oferecido" |
| `HIGHER_FIT` | `|fitA − fitB| ≥ equivalenceEpsilon` (0.5) | "tem compatibilidade maior" |
| `TIE_BREAK_COVERAGE` | fits iguais, coberturas diferentes | "empata na compatibilidade e tem mais dados avaliados" |
| `TIE_BREAK_CONFIDENCE` | fits e coberturas iguais, confianças diferentes | "empata e tem dados mais confiáveis" |
| `EQUIVALENT_FOR_PROFILE` | fits a menos de `equivalenceEpsilon` (0.5) um do outro, ou tudo igual e só o `lotId` separa os dois | "é equivalente para este perfil; a ordem entre os dois não indica preferência" |
| `NOT_IN_RESULTS` | um dos lotes não está nos resultados (`status UNAVAILABLE`) | o popover não mostra a seção |

Detalhes em `PAIRWISE_EXPLANATION.md`.

## 7. Mudança de posição (`rankChange.changeReasons`)

| Código | Regra |
|---|---|
| `PROFILE_CHANGED` | `customerProfileVersion` diferente |
| `FIT_INCREASED` / `FIT_DECREASED` | fit do lote mudou entre as execuções |
| `AVAILABILITY_CHANGED` | `availabilityStatus` do lote mudou |
| `ENTERED_RESULTS` / `LEFT_RESULTS` | lote entrou ou saiu de recomendados + revisão |
| `DATA_VERSION_CHANGED` | alguma chave de `dataVersions` mudou |
| `POLICY_CHANGED` | `recommendationPolicyVersion` mudou |
| `METHODOLOGY_CHANGED` | `fitMethodologyVersion` mudou |
| `OTHER_LOTS_MOVED` | nenhuma das anteriores: o lote mudou de posição porque outros mudaram |

## 8. Score técnico (`explainTechnical`)

`reasons[].reasonCode` repassa os motivos de ajuste por critério do motor de análise (tópico 12), com `delta` e `input`. O status é `COMPLETE` ou `UNAVAILABLE`.

## 9. Status da explicação

`COMPLETE`, `PARTIAL` (Fit parcial ou ausente) e `UNAVAILABLE` (lote fora dos resultados, ou score técnico sem `criteriaResults`).

## 10. Não implementado / pendências

- Implementado em 08/10/2026: `App.reasonCodes` define cada código com categoria, severidade, modos, rótulo para cliente e para corretor e parâmetros tipados; nenhum código aparece como texto na interface.
- Códigos semânticos por preferência sugeridos pela especificação (`PRICE_WITHIN_BUDGET`, `HIGH_PRIVACY_MATCH`, `TOO_FAR_FROM_GATE`, `STATUS_SOLD` etc.) não são emitidos: a explicação usa `FIT_STRONG_MATCH`/`FIT_MISMATCH` com a chave da preferência.
- Deduplicação e agrupamento semântico de fatores: não implementados (cada preferência é um fator).
- Implementado em 08/10/2026: os códigos de revisão e de restrição têm rótulo no catálogo; nenhum aparece cru.
- Os códigos do score técnico (`explainTechnical`) ainda não estão no catálogo.
