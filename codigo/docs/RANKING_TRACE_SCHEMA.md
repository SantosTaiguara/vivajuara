# Esquema do trace de ranking e da explicação

Tópico 16. Estruturas devolvidas por `plat/src/intelligence/explanation.js`: `rankingTrace`, `explainLot`, `rankChange` e `explainTechnical`. Todas são derivadas do `RecommendationResult` (`plat/src/intelligence/recommendation.js`) ou do `LotAnalysisResult` (`plat/src/intelligence/engine.js`); nenhuma é persistida (ficam em memória, no MVP).

Convenções: números sem arredondamento (o arredondamento é feito na apresentação); `null` significa não disponível e nunca é convertido em 0.

## 1. RankingTrace

`rankingTrace(result) → RankingTrace[]`, um por item de `recommendations` seguido de `reviewCandidates` (na ordem do resultado).

| Campo | Tipo | Origem | Observação |
|---|---|---|---|
| `candidateLotId` | texto | `item.lotId` | |
| `initialEligibility` | `ELIGIBLE` \| `REVIEW` \| `null` | `item.eligibility` (saída de `systemEligibility`) | hoje sempre `REVIEW` (disponibilidade UNKNOWN) |
| `constraintStatus` | lista | `item.constraintResults` | `{ constraintId, status, reasonCode }`; status `PASS`, `UNKNOWN` (FAIL/ERROR excluem o lote antes de entrar) |
| `fitScore` | número 0–100 \| `null` | `item.fitScore` | `null` com perfil só de restrições |
| `fitCoverage` | número 0–1 | `item.coverage` | 1 quando não há Fit |
| `fitConfidence` | número 0–1 \| `null` | `item.confidence` | valor numérico (o nível está em `explainLot.confidence`) |
| `rankingKeys` | lista | fixo | `[fitScore DESC, coverage DESC, confidence DESC, lotId ASC]`, cada um com `value` |
| `tieBreakValues` | objeto | | `{ coverage, confidence, lotId }` |
| `finalRank` | inteiro | `item.rank` | a revisão tem numeração própria, a partir de 1 |
| `tier` | `PRIMARY` \| `STRONG_MATCH` \| `ALTERNATIVE` \| `REVIEW_REQUIRED` | `item.tier` | |

Exemplo verificado (estado atual, perfil Privacidade Essencial + Silêncio Importante, orçamento até 500000, área mínima 300):

```json
{ "candidateLotId": "VJ-QB-L0080", "initialEligibility": "REVIEW",
  "constraintStatus": [ { "constraintId": "c-areaMin", "status": "PASS", "reasonCode": null },
                        { "constraintId": "c-budgetMax", "status": "PASS", "reasonCode": null } ],
  "fitScore": 93.33333333333333, "fitCoverage": 1, "fitConfidence": 0.6999999999999998,
  "rankingKeys": [ { "key": "fitScore", "value": 93.33333333333333, "direction": "DESC" },
                   { "key": "coverage", "value": 1, "direction": "DESC" },
                   { "key": "confidence", "value": 0.6999999999999998, "direction": "DESC" },
                   { "key": "lotId", "value": "VJ-QB-L0080", "direction": "ASC" } ],
  "tieBreakValues": { "coverage": 1, "confidence": 0.6999999999999998, "lotId": "VJ-QB-L0080" },
  "finalRank": 1, "tier": "REVIEW_REQUIRED" }
```

O trace não é UI: nenhum componente o exibe. Serve para auditoria e testes.

## 2. ExplanationResult (`explainLot`)

| Campo | Tipo | Conteúdo |
|---|---|---|
| `scope` | `RECOMMENDATION` | |
| `status` | `COMPLETE` \| `PARTIAL` \| `UNAVAILABLE` | `COMPLETE` se o Fit é `COMPLETE` |
| `subjectLotIds` | `[lotId]` | |
| `rank`, `tier`, `fitScore` | | do item |
| `summaryReasonCodes` | lista sem repetição | ver `EXPLANATION_REASON_CODES.md` |
| `positiveFactors`, `negativeFactors` | `ExplanationFactor[]` | cortados pela política (3 e 2) |
| `allPositive`, `allNegative` | inteiro | totais antes do corte |
| `constraintFactors` | lista | uma entrada por restrição avaliada |
| `dataQualityFactors` | lista | `{ factorType: 'DATA_QUALITY', metricKey, reasonCode, dataStatus }` |
| `tieBreakFactors`, `comparisonFactors`, `rankChangeFactors` | lista | sempre vazias (o par a par e a mudança de posição têm funções próprias) |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` \| `UNKNOWN` | nível do Fit (`item.fitConfidence`) |
| `coverage` | 0–1 | |
| `preferenceTable` | lista | `{ key, fieldKey, target, actual, match, importance, contribution, dataStatus }` por preferência |
| `versions` | objeto | `recommendationPolicyVersion`, `fitMethodologyVersion`, `explanationPolicyVersion`, `profileVersion` |
| `generatedAt` | | do resultado (`null` no selector) |
| `diagnostics` | lista | sempre vazia |

Com `status UNAVAILABLE`: só `scope`, `status`, `subjectLotIds`, `summaryReasonCodes ['NOT_IN_RESULTS']`, listas vazias, `confidence`/`coverage` `null`, `versions`, `generatedAt`, `diagnostics`.

### ExplanationFactor (positivo e negativo)

| Campo | Conteúdo |
|---|---|
| `factorType` | `POSITIVE` ou `NEGATIVE` |
| `metricKey` | `fieldKey` canônico da preferência (ex.: `environmental.privacyScore`) |
| `preferenceKey` | chave da preferência (ex.: `privacy`) |
| `reasonCode` | `FIT_STRONG_MATCH` ou `FIT_MISMATCH` |
| `actualValue`, `targetValue` | valor bruto do lote e alvo (`null` quando a preferência não tem alvo) |
| `normalizedValue` | `matchScore` (0–1) |
| `contribution` | pontos de fit: `100 × peso × match / Σ pesos avaliados` |
| `lost` | só em `NEGATIVE`: `100 × peso × (1 − match) / Σ pesos avaliados` |
| `importance` | `LOW` \| `MEDIUM` \| `HIGH` |
| `direction` | `FOR` ou `AGAINST` |
| `evidence`, `dataStatus`, `confidence` | proveniência do campo (`CONFIRMED`, `CALCULATED`, `ESTIMATED` …) e confiança declarada |

### Fator de restrição

`{ factorType: CONSTRAINT_PASS | CONSTRAINT_FAIL | CONSTRAINT_UNKNOWN, metricKey, reasonCode, actualValue, targetValue, dataStatus }`; em PASS o `reasonCode` é `CONSTRAINT_PASSED` (ou `STALE_COMMERCIAL_DATA`).

## 3. RankChangeExplanation (`rankChange`)

`rankChange(prev, curr) → lista`, só com os lotes cuja posição ou tier mudou. Posição em revisão conta como `null` (a revisão não disputa a shortlist).

| Campo | Conteúdo |
|---|---|
| `lotId` | |
| `previousRank`, `currentRank` | posição na shortlist ou `null` (revisão / fora) |
| `rankDelta` | `previousRank − currentRank` (positivo = subiu) ou `null` |
| `previousTier`, `currentTier` | tier ou `null` |
| `changeReasons` | códigos (`PROFILE_CHANGED`, `FIT_INCREASED`, `LEFT_RESULTS` …) |
| `changedInputs` | `['customerProfile']` quando o perfil mudou, senão `[]` |
| `changedPolicies` | `POLICY_CHANGED`, `METHODOLOGY_CHANGED` |
| `changedVersions` | chaves de `dataVersions` que diferem |

Ordem: posição atual crescente (fora da shortlist por último), depois `lotId`.

## 4. Explicação técnica (`explainTechnical`)

| Campo | Conteúdo |
|---|---|
| `scope`, `status` | `TECHNICAL`; `COMPLETE` ou `UNAVAILABLE` |
| `scoreId` | `housing` (padrão), `investment`, `family`, `premium` … |
| `value`, `raw` | score publicado e valor bruto antes do arredondamento (ex.: 69 e 69,47) |
| `factors` | `{ factorType: 'CONTRIBUTION', criterionId, metricKey, value (nota 0–10), weight, contribution, reasons[] }`, por contribuição decrescente |
| `strongest`, `weakest` | 2 primeiros e 2 últimos `criterionId` |
| `meanShare` | `100 / nº de critérios` |
| `classBand` | `{ class, position, total, topShare }` pelo `overallRaw` do empreendimento, ou `null` |
| `methodologyVersion` | versão da metodologia de scoring |

## 5. Não implementado / pendências

- Persistência do trace e snapshot de auditoria: não existem (o trace fica em memória e não é guardado).
- Implementado em 08/10/2026: o `RecommendationResult` lista cada lote excluído em `excluded` (etapa, regra, métrica, valor real e esperado). Não há `RankingTrace` completo para eles.
- Implementado em 08/10/2026: `diagnostics` da explicação informa política padrão em uso, falta de Fit, cobertura parcial e fatores cortados.
- Nomes de confiança divergem: `RankingTrace.fitConfidence` é o valor numérico; `ExplanationResult.confidence` é o nível. Necessita confirmação se devem ser unificados.
- `rankingKeys` é fixo no código; não lê `tieBreakers` da política.
