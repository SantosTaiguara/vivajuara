# Esquema de FilterState, FilterQuery e FilterResult

Tópico 17. Estruturas de `plat/src/filters/filters.js`: `EMPTY`/`STATE_KEYS` (estado), `compile` (query), `run` (resultado), `serialize`/`parse` (link). Versões: `QUERY_VERSION = 1`, `STATE_VERSION = 1` (declarada; o estado salvo usa a versão do store, `STATE_VERSION = 3` em `plat/src/state/store.js`).

## 1. FilterState

O que a UI edita (`st.activeFilters`): chaves planas, uma ou duas por filtro. `EMPTY` define o valor neutro de cada chave.

| Chave | Tipo | Neutro | Filtro |
|---|---|---|---|
| `statuses` | lista de `AvailabilityStatus` | `[]` | `statuses` |
| `onlyOfferable` | booleano | `false` | `onlyOfferable` |
| `block` | texto (quadra) | `null` | `block` |
| `priceMin`, `priceMax` | número ≥ 0 | `null` | `price` |
| `areaMin`, `areaMax` | número ≥ 0 | `null` | `area` |
| `classMin` | `A_PLUS`, `A`, `B`, `C`, `D` | `null` | `classMin` |
| `noCorner` | booleano | `false` | `noCorner` |
| `shapes` | lista de formatos | `[]` | `shapes` |
| `greenBehind` | booleano | `false` | `greenBehind` |
| `rearOrientation` | lista N…NW | `[]` | `rearOrientation` |
| `noiseMax`, `privacyMin`, `trafficMax` | nível `VERY_LOW`…`VERY_HIGH` | `null` | idem |
| `gateMaxM`, `clubMaxM` | metros | `null` | idem |
| `noNoiseAlert` | booleano | `false` | `noNoiseAlert` |
| `favoritesOnly` | booleano | `false` | `favoritesOnly` |
| `scoreKey`, `scoreMin` | chave de score, 0–100 | `null` | `scoreMin` |
| `alertsExclude` | lista de tipos de alerta | `[]` | `alertsExclude` |
| `fitMin` | 50, 60, 70, 80 (aceita qualquer número finito) | `null` | `fitMin` |
| `dataStatusField`, `dataStatus` | `fieldKey` + lista de status de proveniência | `null`, `[]` | `dataStatus` |

Valor "definido" (`isSet`): diferente de `null`, `false`, `''` e lista vazia. Um filtro sem nenhuma chave definida não gera condição.

## 2. FilterCondition

```
FilterCondition { filterId, fieldKey, operator, value, nullPolicy, level }
```

| Filtro | Forma de `value` |
|---|---|
| `price`, `area` | `{ min, max }` (cada lado pode ser `null`) |
| `scoreMin` | `{ key, min }` (`key` padrão `overall`) |
| `dataStatus` | `{ fieldKey, statuses (ordenados) }` |
| listas (`statuses`, `shapes`, `rearOrientation`, `alertsExclude`) | lista ordenada, só valores válidos |
| `noNoiseAlert` | `['NOISE']` (`fixedValue`) |
| `gateMaxM`, `clubMaxM`, `fitMin` | número |
| checkboxes | `true` |
| demais | o valor do estado |

Não há campo `enabled`: condição desativada simplesmente não é gerada.

## 3. FilterQuery

```
FilterQuery { version: 1, developmentId, conditions: FilterCondition[], scope: null, unknownPolicy: 'PER_FILTER', createdAt: null, hash }
```

- `conditions` ordenadas por `filterId`: o mesmo significado sempre produz a mesma query.
- `hash = App.methodology.checksum({ v, d, c: [[filterId, value], …] })`, 8 caracteres hexadecimais. Valores de lista são ordenados antes, então a ordem dos cliques não muda o hash.
- `developmentId`: o do contexto; sem contexto, `viva-juara`.
- `scope` é sempre `null` (o escopo de recomendação é outra estrutura, criada por ação explícita) e `createdAt` é sempre `null` (determinismo).
- No modo cliente, `compile` ignora filtros com `clientVisible = false` (técnicos e `classMin`), mesmo que estejam no estado.

Exemplo verificado (`{ areaMin: 300, statuses: ['UNKNOWN'] }`):

```json
{ "version": 1, "developmentId": "viva-juara",
  "conditions": [
    { "filterId": "area", "fieldKey": "geometry.areaM2", "operator": "BETWEEN", "value": { "min": 300, "max": null }, "nullPolicy": "EXCLUDE_UNKNOWN", "level": "QUICK" },
    { "filterId": "statuses", "fieldKey": "availability.status", "operator": "IN", "value": ["UNKNOWN"], "nullPolicy": "SEPARATE_UNKNOWN", "level": "QUICK" } ],
  "scope": null, "unknownPolicy": "PER_FILTER", "createdAt": null, "hash": "6f3309e0" }
```

## 4. Validação (`compile → errors`)

| Código | Quando | Efeito |
|---|---|---|
| `INVALID_FILTER_VALUE` | preço/área negativo ou não numérico; score fora de 0–100 ou chave inválida; distância/fit não numérico; lista esperada e valor escalar | condição descartada |
| `INVALID_RANGE` | `min > max` em preço ou área | condição descartada |
| `INVALID_ENUM` | valor fora de `options` (lista) ou de `order` (ordinal) | lista: valores inválidos removidos (`values`), condição mantida se sobrar algum; ordinal: condição descartada |
| `INVALID_FIELD_KEY` | `dataStatusField` fora do Field Registry | condição descartada |

Exemplos verificados: `priceMin 500000` + `priceMax 300000` → `INVALID_RANGE`, query vazia (mesmo hash da query sem filtros), 498 lotes; `shapes ['FOO', 'SQUARE']` → `INVALID_ENUM` com `FOO` removido, 1 lote. O erro nunca derruba o mapa nem zera os resultados.

## 5. Política de nulos

Aplicada em `test` depois de `OFFERABLE` e `IN_USER_SET` (que não dependem de valor nulo):

| `nullPolicy` | Valor `null` |
|---|---|
| `EXCLUDE_UNKNOWN` | não corresponde |
| `INCLUDE_UNKNOWN` | corresponde (usado nos filtros de alerta: lote sem lista de alertas não é excluído) |
| `SEPARATE_UNKNOWN` | não corresponde à condição; na faceta, o nulo é contado na chave `UNKNOWN` |
| `IGNORE_CONDITION` | corresponde (declarado, sem uso) |

Em `availability.status` e `geometry.shape`, `UNKNOWN` é um valor de texto, não nulo: pode ser escolhido na lista (`statuses: ['UNKNOWN']` → 498 lotes hoje). `null` nunca é comparado como 0.

## 6. FilterResult (`run`)

| Campo | Conteúdo |
|---|---|
| `status` | `OK` ou `INVALID` (empreendimento diferente) |
| `hash` | `query.hash` |
| `matchedIds` | `Set` de ids (os lotes não são clonados) |
| `total`, `unmatchedCount` | totais |
| `warnings` | `{ code, filterId }`: `STALE_PRICE`, `STALE_AVAILABILITY`, `ESTIMATED_FIELD`, `FIT_UNAVAILABLE`; ou `WRONG_DEVELOPMENT` |
| `plan` | `filterId` na ordem executada (por custo) |
| `elapsedMs` | só quando o contexto fornece `now()`; senão `null` |

Contexto (`ctx`): `{ policy (disponibilidade), favorites (Set), fit (Map lotId → FitScoreResult), freshness { commercial, availability }, developmentId, now? }`. O selector `selectFilterResult` monta esse contexto; `run` não altera nenhum dos objetos recebidos.

Auxiliares:

- `whyNot(lot, query, ctx) → [{ filterId, fieldKey, value, unknown }]`;
- `facets(lots, query, ctx, ids?) → { [filterId]: { valor: contagem } }`, cada faceta ignorando a própria condição. Hoje sem filtros: `statuses { UNKNOWN: 498 }`; `shapes { RECTANGULAR: 380, UNKNOWN: 54, TRAPEZOIDAL: 49, IRREGULAR: 14, SQUARE: 1 }`;
- `rangeStats(lots, fieldKey) → { min, max, count, unknown }`.

## 7. Serialização no link

`serialize(state)` produz `chave:valor` separados por `;`, na ordem do registro, listas ordenadas e unidas por vírgula, booleano como `1`, demais com `encodeURIComponent`. `favoritesOnly` nunca é serializado. O router grava em `#<dev>…?f=<texto codificado>`.

| Estado | Curta | Estado | Curta | Estado | Curta |
|---|---|---|---|---|---|
| `statuses` | `st` | `classMin` | `c` | `gateMaxM` | `gm` |
| `onlyOfferable` | `of` | `noCorner` | `nc` | `clubMaxM` | `cm` |
| `block` | `q` | `shapes` | `sh` | `noNoiseAlert` | `na` |
| `priceMin` | `p0` | `greenBehind` | `g` | `scoreKey` | `sk` |
| `priceMax` | `p1` | `rearOrientation` | `ro` | `scoreMin` | `sm` |
| `areaMin` | `a0` | `noiseMax` | `nz` | `alertsExclude` | `ax` |
| `areaMax` | `a1` | `privacyMin` | `pv` | `fitMin` | `ft` |
| `trafficMax` | `tr` | `dataStatusField` | `df` | `dataStatus` | `ds` |

`parse(texto) → { state, dropped }`: partes sem `:`, chaves desconhecidas e números malformados vão para `dropped`. Exemplo verificado: `st:AVAILABLE;zz:1;p1:abc;nc:1` → `state { statuses: ['AVAILABLE'], noCorner: true }`, `dropped ['zz:1', 'p1:abc']`. Valores de enum inválidos que passam no `parse` são barrados depois por `compile` e por `store.sanitize`.

## 8. Não implementado / pendências

- Implementado em 08/10/2026: `FilterResult` traz `unmatchedLotIds`, `facets`, `diagnostics` e status `PARTIAL` quando algum filtro não foi aplicado. Continua sem `FilterQueryValidationResult` separado (`errors` vem junto com a query).
- Implementado em 08/10/2026: `migrateQuery` e `migrateState` convertem versões anteriores; uma versão futura é recusada (`UNSUPPORTED_QUERY_VERSION`), nunca aplicada pela metade.
- `FilterGroup` (AND/OR) e `scope` na query: não implementados.
- Tamanho do link: desde 08/10/2026 `serializeChecked` confere o limite de 1.500 caracteres, mas o uso é opcional; `serialize` continua sem limite.
- `fitMin`: desde 08/10/2026 é recusado fora da faixa 0–100, mas não é conferido contra as opções 50–80.
