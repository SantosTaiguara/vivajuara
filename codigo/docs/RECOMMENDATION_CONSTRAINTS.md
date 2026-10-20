# Catálogo de restrições obrigatórias (hard constraints)

Tópico 15. Catálogo em `plat/config/recommendation/viva-juara.json` (chave `constraints`), avaliação em `plat/src/intelligence/recommendation.js` (`constraint`, `validateConstraints`, `evaluateConstraint`, `ConstraintEvaluatorRegistry`), montagem a partir do estado em `plat/src/state/selectors.js` (`constraintList`) e controles em `plat/src/presentation/panels.js` (`profileSection`, "Exigências (eliminatórias)").

## 1. Exigência e preferência

| | Exigência (`CustomerConstraint`) | Preferência (`CustomerPreference`, tópico 14) |
|---|---|---|
| Efeito | elimina, manda para revisão ou passa | só ordena (Fit) |
| Estado da UI | `st.constraints` | `st.preferences` |
| Texto no painel | "Exigências eliminam lotes da recomendação; prioridades só ordenam. Nada aqui altera os filtros do mapa." | |

Uma exigência nunca é convertida em peso. Ela também nunca é relaxada automaticamente: se nada sobra, o resultado mostra quais restrições eliminaram mais lotes (`constraintImpact`).

## 2. Entidade

`constraint(key, expectedValue, policy, extra)` monta, a partir da definição do catálogo:

```
CustomerConstraint { id: 'c-<key>', key, metricKey, operator, expectedValue, onUnknown, source, enabled: true, descriptionKey: 'constraint.<key>', metadata: {} }
```

- `onUnknown`: o de `extra`, senão o da definição, senão `policy.defaultOnUnknown` (`REVIEW_REQUIRED`).
- `source`: `EXPLICIT_USER` por padrão.
- Chave fora do catálogo → `null` (descartada por `constraintList`).

## 3. Catálogo do Viva Juara

Valores copiados de `config/recommendation/viva-juara.json`.

| Chave | Rótulo | `metricKey` | Operador | `onUnknown` | Código de falha | Código de desconhecido | Comercial | Controle na UI |
|---|---|---|---|---|---|---|---|---|
| `budgetMax` | Preço até | `commercial.price` | `LTE` | `REVIEW_REQUIRED` | `PRICE_ABOVE_MAX` | `UNKNOWN_PRICE` | sim | "Orçamento máximo" (`PRICE_STEPS`: 300000 a 800000) |
| `areaMin` | Área mínima | `geometry.areaM2` | `GTE` | `EXCLUDE` | `AREA_BELOW_MIN` | `UNKNOWN_AREA` | não | "Área mínima (m²)" |
| `areaMax` | Área máxima | `geometry.areaM2` | `LTE` | `EXCLUDE` | `AREA_ABOVE_MAX` | `UNKNOWN_AREA` | não | "Área máxima (m²)" |
| `noCorner` | Sem esquina | `geometry.isCorner` | `IS_FALSE` | `REVIEW_REQUIRED` | `CORNER_LOT` | `UNKNOWN_CORNER` | não | "Não aceita esquina" |
| `greenRear` | Mata ou parque nos fundos | `surroundings.hasGreenRear` | `IS_TRUE` | `REVIEW_REQUIRED` | `REQUIRED_FEATURE_MISSING` | `UNKNOWN_REAR` | não | "Exige mata ou parque nos fundos" |
| `blocks` | Quadras aceitas | `identity.blockId` | `IN` | `EXCLUDE` | `BLOCK_NOT_ACCEPTED` | `UNKNOWN_BLOCK` | não | não há |
| `maxNoise` | Ruído no máximo | `environmental.noiseLevel` | `IN` | `REVIEW_REQUIRED` | `NOISE_ABOVE_LIMIT` | `UNKNOWN_NOISE` | não | não há |
| `maxGateRoute` | Portaria a no máximo | `mobility.routeDistanceToGateM` | `LTE` | `REVIEW_REQUIRED` | `DISTANCE_ABOVE_MAX` | `UNKNOWN_DISTANCE` | não | não há |

Notas:

- `maxNoise` usa `IN`: o chamador precisa passar a lista de níveis aceitos (por exemplo `['VERY_LOW', 'LOW']`); não existe operador ordinal "até" neste catálogo.
- `noCorner` e `greenRear` recebem `true` da UI; os operadores `IS_FALSE`/`IS_TRUE` ignoram o valor esperado.
- `blocks`, `maxNoise` e `maxGateRoute` só entram por código ou por estado salvo (o `sanitize` aceita qualquer chave do catálogo).

## 4. Situação dos campos usados (498 lotes)

Verificado com `App.model.get` e `App.model.getFieldProvenance`:

| `metricKey` | Valores nulos | Proveniência |
|---|---|---|
| `commercial.price` | 0 | calculado (498) |
| `geometry.areaM2` | 0 | confirmado (498) |
| `geometry.isCorner` | 0 | calculado (498); 54 esquinas |
| `surroundings.hasGreenRear` | 0 | calculado (493), não disponível (5) |
| `identity.blockId` | 0 | confirmado (498) |
| `environmental.noiseLevel` | 0 | estimado (498) |
| `mobility.routeDistanceToGateM` | 0 | calculado (498) |

A proveniência conta: nos 5 lotes com `hasGreenRear` de proveniência `UNKNOWN`, a exigência `greenRear` resulta em `UNKNOWN` (e vai para revisão) mesmo havendo valor no campo.

## 5. Operadores registrados

`ConstraintEvaluatorRegistry` (lista fechada, sem `eval`):

| Operador | Regra |
|---|---|
| `EQ`, `NEQ` | `v === e`, `v !== e` |
| `GT`, `GTE`, `LT`, `LTE` | comparação numérica |
| `BETWEEN` | `e.min`/`e.max` opcionais (faixa aberta) |
| `IN`, `NOT_IN` | `e` precisa ser lista |
| `EXISTS`, `NOT_EXISTS` | `v != null` / `v == null` |
| `IS_TRUE`, `IS_FALSE` | `v === true` / `v === false` |

## 6. Avaliação (`evaluateConstraint`)

Ordem de decisão para cada lote:

1. Lê o valor (`App.model.get`) e a proveniência (`getFieldProvenance`).
2. Valor nulo, proveniência `UNKNOWN` ou `CONFLICTED` → status `UNKNOWN`, código `CONFLICTED_DATA` (conflito) ou o `unknownCode` da definição (senão `CRITICAL_DATA_UNKNOWN`).
3. Exceção no operador → `ERROR` (`CONSTRAINT_ERROR`). ERROR nunca é tratado como PASS: exclui o lote.
4. Operador falso → `FAIL` com o `failCode` (senão `CONSTRAINT_FAILED`).
5. Restrição comercial com `commercialFreshness = STALE` → `PASS` com `stale: true` e `STALE_COMMERCIAL_DATA`.
6. Caso contrário → `PASS`.

Resultado (`ConstraintEvaluation`): `{ constraintId, key, metricKey, operator, expectedValue, actualValue, dataStatus, status, reasonCode, onUnknown?, stale? }`.

Tratamento no pipeline (`recommend`, fase 3):

| Resultado | Efeito |
|---|---|
| `FAIL` / `ERROR` | lote excluído; para de avaliar; `rejectedCount++` |
| `UNKNOWN` + `EXCLUDE` | lote excluído com o código de desconhecido; `unknownCount++` |
| `UNKNOWN` + `REVIEW_REQUIRED` | segue; código entra em `reviewReasons` |
| `UNKNOWN` + `ALLOW_WITH_WARNING` | segue elegível; código entra em `warnings` do item |
| `PASS` stale | conforme `staleCommercialPolicy` (exclui, revisão ou aviso) |

A avaliação para no primeiro FAIL: `exclusionSummary` conta o primeiro motivo, não todos.

## 7. Ordem de avaliação

`effective(list)` remove desativadas, aplica "vale a última" por `metricKey|operator` e ordena por custo (`COST` pelo domínio do `metricKey`): `identity` 0; `commercial`, `geometry` 1; `surroundings` 2; `environmental`, `location`, `mobility` 3; empate pelo `id`. Antes disso, `systemEligibility` já descartou SOLD, RESERVED, BLOCKED, PROPOSAL e UNAVAILABLE sem avaliar nenhuma restrição.

## 8. Validação (`validateConstraints`)

| Código | Tipo | Regra |
|---|---|---|
| `INVALID_METRIC_KEY` | erro | `metricKey` fora do Field Registry (`App.model.field`) |
| `INVALID_OPERATOR` | erro | operador fora do registro |
| `INVALID_ON_UNKNOWN` | erro | fora de `EXCLUDE`, `REVIEW_REQUIRED`, `ALLOW_WITH_WARNING` |
| `TYPE_MISMATCH` | erro | `LT/LTE/GT/GTE` sem número finito; `IN/NOT_IN` sem lista não vazia |
| `HARD_CONSTRAINT_CONFLICT` | erro | maior `geometry.areaM2 GTE` > menor `geometry.areaM2 LTE` |
| `DUPLICATE_CONSTRAINT` | aviso | mesmo `metricKey|operator` repetido; vale a última |

Qualquer erro → resultado `INVALID_PROFILE` (sem ranking). A UI mostra "Perfil inválido: revise as exigências (por exemplo, área mínima maior que a máxima)."

## 9. Do estado da UI à restrição

`constraintList(st.constraints)` em `selectors.js`: para cada `[chave, valor]` com valor diferente de `null`, `false` e `''`, chama `App.recommendation.constraint(chave, valor, recPolicy)`. O handler `data-cons` em `app.js` remove a chave quando o campo é limpo ou o checkbox é desmarcado. As exigências são persistidas por empreendimento junto com as preferências (`store.save`) e nunca são criadas a partir dos filtros do mapa.

## 10. Não implementado / pendências

- Status `NOT_APPLICABLE` e campo `freshness`/`diagnostics` por avaliação: não existem.
- Implementado em 08/10/2026: a validação detecta limites contraditórios em qualquer métrica (mínimo acima do máximo, `IN` sem valor aceito por `NOT_IN`, sim e não ao mesmo tempo). `constraintConflicts` avisa, a partir dos dados, quando nenhum lote que atende às demais exigências atende a uma delas (`BUDGET_BELOW_CHEAPEST_MATCH`, `BUDGET_BELOW_CHEAPEST_LOT`, `CONSTRAINT_UNSATISFIABLE`), sem afrouxar nada (`autoRelaxed: false`).
- Exigências de parcela/financiamento, topografia e solar: não estão no catálogo.
- Restrições derivadas caras, condicionais e grupos OU: não implementados.
- `blocks`, `maxNoise` e `maxGateRoute` sem controle na interface.
- Implementado em 08/10/2026: botão "Salvar como exigência do cliente" no painel de filtros (modo corretor) copia preço máximo, área, sem esquina e fundos verdes para as exigências. Os filtros nunca mudam o perfil sozinhos.
