# Códigos de motivo da recomendação

Tópico 15. Códigos emitidos por `plat/src/intelligence/recommendation.js` e pela política `plat/config/recommendation/viva-juara.json`. O motor devolve apenas códigos; o texto fica na apresentação (`plat/src/presentation/panels.js`, mapas `EXCL`, `SUMMARY`, `DQ`; `plat/src/map/legend.js`, `TIER_LABEL`). Os códigos da explicação aprofundada (tópico 16) estão em `EXPLANATION_REASON_CODES.md`.

Onde cada código aparece:

| Lugar | Campo |
|---|---|
| exclusão | chave de `exclusionSummary` (contagem) |
| revisão | `reviewReasons` do item e `keyReasonCodes` de `reviewCandidates` |
| aviso do item | `warnings` do item (`ALLOW_WITH_WARNING`) |
| aviso do resultado | `RecommendationResult.warnings` |
| recomendação | `keyReasonCodes` de `recommendations` |
| avaliação | `reasonCode` de cada `constraintResults[i]` |
| validação | `diagnostics[].code` |

## 1. Recomendação (`keyReasonCodes`)

Montados na fase 7 de `recommend`, nesta ordem:

| Código | Regra |
|---|---|
| `TOP_FIT` | primeiro item da shortlist, só quando há Fit calculado |
| `MEETS_ALL_REQUIRED_CONSTRAINTS` | sempre (o item passou em todas as restrições) |
| `HIGH_PROFILE_COVERAGE` | `coverage ≥ 0.999`, só quando há Fit calculado |
| `HIGH_DATA_CONFIDENCE` | `fitConfidence === 'HIGH'` (valor ≥ 0.85 em `config/fit/viva-juara.json`) |
| `MATCH_<PREFERÊNCIA>` | até 3 primeiros `fit.strengths`, chave em caixa alta com `_` (ex.: `MATCH_PRIVACY`, `MATCH_LOW_TRAFFIC`, `MATCH_PRICE_QUALITY`) |

Exemplo verificado (todos AVAILABLE em teste, Privacidade Essencial + Silêncio Importante): `["TOP_FIT", "MEETS_ALL_REQUIRED_CONSTRAINTS", "HIGH_PROFILE_COVERAGE", "MATCH_PRIVACY", "MATCH_QUIET"]`.

## 2. Exclusão — elegibilidade do sistema

`systemEligibility`, antes de qualquer restrição ou Fit:

| Código | Quando | Texto no painel (`EXCL`) |
|---|---|---|
| `SOLD` | status SOLD | vendidos |
| `RESERVED` | status RESERVED | reservados |
| `BLOCKED` | status BLOCKED | bloqueados |
| `IN_PROPOSAL` | status PROPOSAL fora da lista permitida | em proposta |
| `STATUS_NOT_AVAILABLE` | demais status fora da lista (UNAVAILABLE) | indisponíveis |
| `AVAILABILITY_UNKNOWN` | UNKNOWN com `unknownAvailabilityPolicy = EXCLUDE` (não é o caso hoje) | sem texto (mostra o código em minúsculas) |
| `STALE_AVAILABILITY` | disponibilidade STALE com `staleCommercialPolicy = EXCLUDE` (não é o caso hoje) | sem texto |

## 3. Exclusão — restrições

| Código | Restrição / origem | Texto no painel |
|---|---|---|
| `PRICE_ABOVE_MAX` | `budgetMax` FAIL | acima do orçamento |
| `AREA_BELOW_MIN` | `areaMin` FAIL | abaixo da área mínima |
| `AREA_ABOVE_MAX` | `areaMax` FAIL | acima da área máxima |
| `CORNER_LOT` | `noCorner` FAIL | de esquina |
| `REQUIRED_FEATURE_MISSING` | `greenRear` FAIL | sem a característica exigida |
| `BLOCK_NOT_ACCEPTED` | `blocks` FAIL | sem texto |
| `NOISE_ABOVE_LIMIT` | `maxNoise` FAIL | sem texto |
| `DISTANCE_ABOVE_MAX` | `maxGateRoute` FAIL | sem texto |
| `CONSTRAINT_FAILED` | FAIL de restrição sem `failCode` | sem texto |
| `CONSTRAINT_ERROR` | exceção no operador (nunca vira PASS) | sem texto |
| `UNKNOWN_AREA` | `areaMin`/`areaMax` com dado desconhecido (`onUnknown = EXCLUDE`) | sem área |
| `UNKNOWN_BLOCK` | `blocks` com dado desconhecido (`EXCLUDE`) | sem texto |
| `CONFLICTED_DATA` | proveniência CONFLICTED em restrição `EXCLUDE` | sem texto |
| `CRITICAL_DATA_UNKNOWN` | dado desconhecido em restrição `EXCLUDE` sem `unknownCode` | sem texto |
| `STALE_COMMERCIAL_DATA` | preço STALE com `staleCommercialPolicy = EXCLUDE` | sem texto |
| `LOW_FIT` | elegível, mas fit abaixo de `minimumFitScore` (50) ou nulo com perfil | com compatibilidade baixa |

O resumo de exclusões só aparece no modo corretor ("Fora da recomendação: …"). `EXCL` também tem `LOW_COVERAGE`, que o motor não emite.

## 4. Revisão (`reviewReasons`)

Um item com qualquer um destes códigos vai para `reviewCandidates` (tier `REVIEW_REQUIRED`), nunca para `recommendations`:

| Código | Quando |
|---|---|
| `AVAILABILITY_UNKNOWN` | status UNKNOWN (hoje: os 498 lotes) |
| `STALE_AVAILABILITY` | disponibilidade STALE (`staleCommercialPolicy = REVIEW_REQUIRED`) |
| `STALE_COMMERCIAL_DATA` | restrição comercial (`budgetMax`) com preço STALE |
| `UNKNOWN_PRICE` | `budgetMax` sem preço utilizável |
| `UNKNOWN_CORNER` | `noCorner` sem dado de esquina |
| `UNKNOWN_REAR` | `greenRear` sem dado de fundos (hoje: 5 lotes com proveniência não disponível) |
| `UNKNOWN_NOISE` | `maxNoise` sem dado de ruído |
| `UNKNOWN_DISTANCE` | `maxGateRoute` sem distância |
| `CONFLICTED_DATA` | proveniência CONFLICTED em restrição `REVIEW_REQUIRED` |
| `CRITICAL_DATA_UNKNOWN` | dado desconhecido em restrição sem `unknownCode` |
| `LOW_FIT_COVERAGE` | `coverage < minFitCoverage` (0.5) |
| `LOW_FIT_CONFIDENCE` | confiança do Fit `< minFitConfidence` (0.5) |

A lista do painel diz "Para revisar · status a confirmar com a loteadora" e o selo do Quick View diz "Nº para revisar (status a confirmar)", independentemente do código. Para os códigos que não são de disponibilidade, essa frase é imprecisa (ver pendências).

## 5. Avisos

| Código | Nível | Quando |
|---|---|---|
| código de desconhecido (`UNKNOWN_*`, `CONFLICTED_DATA`) | item | restrição com `onUnknown = ALLOW_WITH_WARNING` |
| `STALE_COMMERCIAL_DATA` | item | `staleCommercialPolicy = ALLOW_WITH_WARNING` |
| `COMMERCIAL_CONFIRMATION_REQUIRED` | resultado | offline com `offlinePolicy = COMMERCIAL_CONFIRMATION_REQUIRED` |

## 6. Avaliação de restrição (`constraintResults[i].reasonCode`)

`null` em PASS; `STALE_COMMERCIAL_DATA` em PASS stale; o `failCode` em FAIL; o `unknownCode` (ou `CONFLICTED_DATA`, `CRITICAL_DATA_UNKNOWN`) em UNKNOWN; `CONSTRAINT_ERROR` em ERROR.

## 7. Validação (`diagnostics`)

Restrições (`validateConstraints`): `INVALID_METRIC_KEY`, `INVALID_OPERATOR`, `INVALID_ON_UNKNOWN`, `TYPE_MISMATCH`, `HARD_CONSTRAINT_CONFLICT` (erros) e `DUPLICATE_CONSTRAINT` (aviso). Perfil (`App.fit.validateProfile`, tópico 14): `INVALID_FIELDKEY`, `INVALID_IMPORTANCE`, `INVALID_RANGE`, `INVALID_SOURCE`, `INVALID_TARGET`, `INVALID_TOLERANCE`, `TYPE_MISMATCH`, `MISSING_FIELD`, `CONTRADICTORY_PREFERENCES`, `DUPLICATE_PREFERENCE`.

## 8. Tiers e status

Tiers (`App.recommendation.TIERS`): `PRIMARY`, `STRONG_MATCH`, `ALTERNATIVE`, `REVIEW_REQUIRED`. Rótulos: painel "Melhores opções", "Forte aderência", "Alternativas", "Para revisar"; legenda "Melhor opção", "Forte aderência", "Alternativa", "Revisar (status a confirmar)".

Status do resultado: `SUCCESS`, `NO_STRONG_RECOMMENDATION`, `NO_ELIGIBLE_LOTS`, `INSUFFICIENT_PROFILE`, `INVALID_PROFILE`.

## 9. Não implementado / pendências

- Implementado em 08/10/2026: catálogo `App.reasonCodes` com categoria, severidade, modos e rótulos de cliente e corretor para cada código emitido. Alguns mapas de `panels.js` (`DQ`, `CONS`, `PAIR`) ainda são usados no popover de lote ranqueado.
- Códigos sugeridos pela especificação e não emitidos: `PRICE_WITHIN_BUDGET`, `AREA_MATCH`, `PRIVACY_MATCH` (o equivalente é `MATCH_<PREFERÊNCIA>`), `UNKNOWN_TOPOGRAPHY` (não há restrição de topografia).
- Implementado em 08/10/2026: cada candidato em revisão tem um motivo principal e uma categoria (disponibilidade, dado comercial, dado de exigência, dado do perfil); a lista de recomendação e a explicação usam esse motivo. O rótulo da Quick View ("Nº para revisar (status a confirmar)") ainda não foi ajustado.
