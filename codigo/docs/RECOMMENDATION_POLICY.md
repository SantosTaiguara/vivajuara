# Política de recomendação (RecommendationPolicy)

Tópico 15. Arquivo `plat/config/recommendation/viva-juara.json`, empacotado por `plat/scripts/configBundle.js` (pastas `fit`, `recommendation`, `filters`, `layers`, `quickview`) em `App.configs.recommendation['viva-juara']` e lido por `App.recommendation.policyOf(devId)`. O mesmo pacote serve o build de arquivo único e o harness de testes do Node.

A política é separada da metodologia do Fit (`config/fit/viva-juara.json`, `fitMethodologyVersion`) e da metodologia de scoring (`config/scoring/viva-juara/`). Cada uma tem sua versão; o resultado da recomendação carrega `recommendationPolicyVersion` e `fitMethodologyVersion`.

## 1. Identificação

| Chave | Valor |
|---|---|
| `kind` | `recommendation-policy` |
| `id` | `viva-juara-recommendation` |
| `version` | `1.0.0` |
| `developmentId` | `viva-juara` |
| `status` | `PUBLISHED` |
| `changeReason` | "Primeira política: só lote com disponibilidade confirmada é recomendado; status desconhecido vai para revisão; nenhuma restrição é relaxada automaticamente." |

## 2. Elegibilidade comercial

| Chave | Valor | Efeito no código (`systemEligibility`) |
|---|---|---|
| `allowedAvailabilityStatuses` | `["AVAILABLE"]` | só AVAILABLE é elegível |
| `proposalFollowsAvailabilityPolicy` | `true` | PROPOSAL só entra se `availabilityPolicy.proposalCountsAsOfferable` for `true`; no Viva Juara é `false` (tópico 8), então PROPOSAL é excluído (`IN_PROPOSAL`) |
| `unknownAvailabilityPolicy` | `REVIEW_REQUIRED` | UNKNOWN vai para revisão (`AVAILABILITY_UNKNOWN`); `EXCLUDE` excluiria |
| `staleCommercialPolicy` | `REVIEW_REQUIRED` | disponibilidade STALE → revisão (`STALE_AVAILABILITY`); preço STALE em restrição comercial → revisão (`STALE_COMMERCIAL_DATA`). Aceita também `EXCLUDE` e `ALLOW_WITH_WARNING` |
| `offlinePolicy` | `COMMERCIAL_CONFIRMATION_REQUIRED` | offline → aviso `COMMERCIAL_CONFIRMATION_REQUIRED` no resultado |
| `defaultOnUnknown` | `REVIEW_REQUIRED` | `onUnknown` de uma restrição sem valor próprio |

Matriz efetiva por status (política atual):

| Status | Resultado | Código |
|---|---|---|
| `AVAILABLE` | elegível (se FRESH ou UNKNOWN de frescor; STALE → revisão) | — |
| `RESERVED` | excluído | `RESERVED` |
| `PROPOSAL` | excluído | `IN_PROPOSAL` |
| `BLOCKED` | excluído | `BLOCKED` |
| `SOLD` | excluído | `SOLD` |
| `UNAVAILABLE` | excluído | `STATUS_NOT_AVAILABLE` |
| `UNKNOWN` | revisão | `AVAILABILITY_UNKNOWN` |

Excluído significa fora da shortlist: o lote continua no mapa, na busca e na ficha.

## 3. Limiares do Fit

| Chave | Valor | Efeito |
|---|---|---|
| `minFitCoverage` | `0.5` | cobertura abaixo → revisão (`LOW_FIT_COVERAGE`) |
| `minFitConfidence` | `0.5` | confiança (valor numérico do Fit) abaixo → revisão (`LOW_FIT_CONFIDENCE`) |
| `minimumFitScore` | `50` | fit abaixo (ou nulo com perfil) → fora da shortlist (`LOW_FIT`); o lote continua elegível e conta em `eligibleCount` |
| `strongMatchFitScore` | `70` | a partir daqui: PRIMARY (até `primaryTierSize`) ou STRONG_MATCH |

Os limiares nunca substituem as restrições: um lote com fit 95 que falha uma exigência continua excluído. Os mesmos `minimumFitScore` e `strongMatchFitScore` são lidos por `plat/src/map/layers.js` (`fitThresholds`) para a camada de compatibilidade.

## 4. Tamanho dos resultados

| Chave | Valor | Uso |
|---|---|---|
| `primaryTierSize` | `3` | máximo de PRIMARY |
| `shortlistSize` | `10` | máximo de `recommendations` |
| `reviewLimit` | `25` | máximo de `reviewCandidates` devolvidos; o total vai em `reviewTotal` |
| `reviewBucketEnabled` | `true` | sem ele, `reviewCandidates = []` |
| `exclusionSummaryEnabled` | `true` | sem ele, `exclusionSummary = {}` |

A interface não fixa esses números: lê o que vem no resultado. O painel mostra 8 da revisão e um botão para ver os 25; o mapa numera os 5 primeiros (`recommendationFeatures`, limite próprio da camada).

## 5. Ordenação

| Chave | Valor | Situação |
|---|---|---|
| `rankingStrategy` | `FIT_COVERAGE_CONFIDENCE` | declarativo |
| `tieBreakers` | `["fitScore", "coverage", "confidence", "lotId"]` | declarativo |

O comparador `App.recommendation.compare` implementa exatamente essa ordem (fit DESC, cobertura DESC, confiança DESC, `lotId` ASC), mas está fixo no código: alterar `rankingStrategy` ou `tieBreakers` no JSON não muda a ordenação. Não há score de negócio, boost, prioridade de estoque ou aleatoriedade.

## 6. Catálogo de restrições

A chave `constraints` define as 8 restrições suportadas (`budgetMax`, `areaMin`, `areaMax`, `noCorner`, `greenRear`, `blocks`, `maxNoise`, `maxGateRoute`). Detalhes em `RECOMMENDATION_CONSTRAINTS.md`. Uma restrição que não está no catálogo não pode ser criada (`constraint` devolve `null`), e o `sanitize` do store descarta chaves desconhecidas do estado salvo.

## 7. Política de explicação

Bloco `explanation` (lido por `App.explanation.policyOf`, tópico 16):

| Chave | Valor | Uso |
|---|---|---|
| `version` | `1.0.0` | `versions.explanationPolicyVersion` |
| `maxPositiveFactors` | `3` | fatores a favor em `explainLot` |
| `maxNegativeFactors` | `2` | fatores contra em `explainLot` |
| `minContribution` | `1` | contribuição mínima (pontos de fit) para um fator positivo |
| `equivalenceEpsilon` | `0.5` | diferença de fit abaixo da qual dois lotes são tratados como empatados na explicação par a par |
| `clientLevels` | `["L0", "L1"]` | declarativo (sem leitura no código) |
| `brokerLevels` | `["L0", "L1", "L2", "L3"]` | declarativo (sem leitura no código) |

## 8. Versionamento e invalidação

`policy.version` entra na `cacheKey` e no `requestId`; `rankChange` do tópico 16 aponta `POLICY_CHANGED` quando duas execuções têm versões diferentes. Não existe registro de versões anteriores da política (há só o arquivo atual), nem relatório de impacto antes de publicar, ao contrário do scoring (`config/scoring/viva-juara/current.json` + versões).

## 9. Não implementado / pendências

- Histórico de versões e relatório de impacto da política: não existem.
- `rankingStrategy` e `tieBreakers` não são lidos pelo código. Desde 08/10/2026, `clientLevels` e `brokerLevels` são lidos pelo viewModel da explicação.
- Política por modo (cliente/corretor) e prioridade comercial explícita e auditável: não implementadas.
- `minFitConfidence` é aplicado como critério de revisão para todos os tiers, não só para PRIMARY. A confiança mínima por tier depende de decisão.
- Decisões humanas pendentes: se PROPOSAL pode ser recomendado; se UNKNOWN deve ser excluído ou continuar em revisão quando houver espelho parcial; prazo a partir do qual preço e status ficam STALE (hoje sem limite configurado).
