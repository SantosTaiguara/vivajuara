# Registro de filtros (FilterRegistry)

Tópico 17. Definições em `DEFS` de `plat/src/filters/filters.js` (exportadas como `App.filters.DEFS` e indexadas em `App.filters.BY`). Não há configuração por empreendimento: `plat/config/filters/` não existe, embora `plat/scripts/configBundle.js` a empacotasse se existisse. Rótulos na UI em `FILTER_LABEL` de `plat/src/presentation/panels.js` e, para o Quick View, `filterLabel` de `plat/src/quickview/quickview.js`.

## 1. Estrutura de uma definição

| Campo | Conteúdo |
|---|---|
| `id` | identificador estável (também é o `filterId` da condição) |
| `stateKeys` | chaves do `FilterState` que o filtro lê (ex.: `priceMin`, `priceMax`) |
| `fieldKey` | `fieldKey` canônico do Field Registry, ou `null` quando o valor vem do contexto (favoritos, fit, proveniência) |
| `level` | `QUICK`, `ADVANCED` ou `TECHNICAL` |
| `group` | agrupamento: Comercial, Localização, Geometria, Análise, Vizinhança, Conforto, Mobilidade, Meus lotes, Scores, Alertas, Cliente, Qualidade do dado |
| `controlType` | `CHIPS`, `CHECKBOX`, `SELECT`, `RANGE`, `SCORE`, `PROVENANCE` |
| `dataType` | `ENUM`, `BOOLEAN`, `MONEY`, `AREA`, `ORDINAL`, `DISTANCE`, `SCORE`, `PERCENT` |
| `unit` | `BRL`, `m²`, `m` quando aplicável |
| `operator` | um operador da lista fechada (seção 3) |
| `nullPolicy` | `EXCLUDE_UNKNOWN`, `INCLUDE_UNKNOWN` ou `SEPARATE_UNKNOWN` |
| `options` | função que devolve as opções válidas (valida o valor no compilador) |
| `order` | ordem dos níveis ordinais |
| `fixedValue` | valor usado quando o controle é um checkbox (`noNoiseAlert` → `['NOISE']`) |
| `clientVisible` | visível no modo cliente |
| `mobilePriority` | prioridade declarada para o celular (só nos rápidos; não lida pela UI) |
| `cost` | custo no plano de execução (0 a 4) |
| `dynamicType` | `AVAILABILITY`, `COMMERCIAL`, `USER_CONTEXT`, `FIT` (aciona avisos de frescor/contexto) |
| `estimated` | o campo é estimado (aciona `ESTIMATED_FIELD`) |
| `facet` | tem contagem por opção (`facets`) |
| `sortOrder` | posição no registro (atribuída ao congelar) |

## 2. Definições

### Rápidos (`QUICK`)

| `id` | Estado | `fieldKey` | Controle | Operador | Nulos | Cliente | Custo | Extra |
|---|---|---|---|---|---|---|---|---|
| `statuses` | `statuses[]` | `availability.status` | chips | `IN` | `SEPARATE_UNKNOWN` | sim | 0 | opções `AVAILABILITY_ORDER`, faceta, `AVAILABILITY` |
| `onlyOfferable` | `onlyOfferable` | `availability.status` | checkbox | `OFFERABLE` | `EXCLUDE_UNKNOWN` | sim | 0 | `AVAILABILITY` |
| `block` | `block` | `identity.blockId` | select | `EQ` | `EXCLUDE_UNKNOWN` | sim | 0 | faceta |
| `price` | `priceMin`, `priceMax` | `commercial.price` | faixa | `BETWEEN` | `EXCLUDE_UNKNOWN` | sim | 1 | BRL, `COMMERCIAL` |
| `area` | `areaMin`, `areaMax` | `geometry.areaM2` | faixa | `BETWEEN` | `EXCLUDE_UNKNOWN` | sim | 1 | m² |
| `classMin` | `classMin` | `intelligence.class` | select | `ORDINAL_MIN` | `EXCLUDE_UNKNOWN` | não | 1 | ordem D, C, B, A, A_PLUS |
| `noCorner` | `noCorner` | `geometry.isCorner` | checkbox | `IS_FALSE` | `EXCLUDE_UNKNOWN` | sim | 1 | |

### Avançados (`ADVANCED`)

| `id` | Estado | `fieldKey` | Controle | Operador | Nulos | Cliente | Custo | Extra |
|---|---|---|---|---|---|---|---|---|
| `shapes` | `shapes[]` | `geometry.shape` | chips | `IN` | `SEPARATE_UNKNOWN` | sim | 2 | opções RECTANGULAR, SQUARE, TRAPEZOIDAL, IRREGULAR, UNKNOWN; faceta |
| `greenBehind` | `greenBehind` | `surroundings.hasGreenRear` | checkbox | `IS_TRUE` | `EXCLUDE_UNKNOWN` | sim | 2 | |
| `rearOrientation` | `rearOrientation[]` | `environmental.orientationRear` | chips | `IN` | `EXCLUDE_UNKNOWN` | sim | 2 | N, NE, E, SE, S, SW, W, NW; faceta |
| `noiseMax` | `noiseMax` | `environmental.noiseLevel` | select | `ORDINAL_MAX` | `EXCLUDE_UNKNOWN` | sim | 2 | ordem VERY_LOW…VERY_HIGH; estimado |
| `privacyMin` | `privacyMin` | `environmental.privacyLevel` | select | `ORDINAL_MIN` | `EXCLUDE_UNKNOWN` | sim | 2 | estimado |
| `trafficMax` | `trafficMax` | `mobility.estimatedTraffic` | select | `ORDINAL_MAX` | `EXCLUDE_UNKNOWN` | sim | 2 | estimado |
| `gateMaxM` | `gateMaxM` | `mobility.routeDistanceToGateM` | select | `LTE` | `EXCLUDE_UNKNOWN` | sim | 2 | m; opções 200, 400, 650 |
| `clubMaxM` | `clubMaxM` | `mobility.routeDistanceToLeisureM` | select | `LTE` | `EXCLUDE_UNKNOWN` | sim | 2 | m; opções 250, 500, 750 |
| `noNoiseAlert` | `noNoiseAlert` | `intelligence.alerts` | checkbox | `NOT_CONTAINS_TYPE` | `INCLUDE_UNKNOWN` | sim | 3 | valor fixo `['NOISE']` |
| `favoritesOnly` | `favoritesOnly` | `null` | checkbox | `IN_USER_SET` | `EXCLUDE_UNKNOWN` | sim | 0 | `USER_CONTEXT`; nunca vai no link |

### Técnicos (`TECHNICAL`, só modo corretor)

| `id` | Estado | `fieldKey` | Controle | Operador | Nulos | Custo | Extra |
|---|---|---|---|---|---|---|---|
| `scoreMin` | `scoreKey`, `scoreMin` | `intelligence.scores` | score | `GTE` | `EXCLUDE_UNKNOWN` | 1 | chave `housing`, `investment`, `family`, `premium` ou `overall` (padrão); mínimo 0–100; UI 60, 70, 80, 88 |
| `alertsExclude` | `alertsExclude[]` | `intelligence.alerts` | chips | `NOT_CONTAINS_TYPE` | `INCLUDE_UNKNOWN` | 3 | tipos de `App.rules.ALERTS` menos `OTHER`: EASEMENT, BUILDING_RESTRICTION, TECHNICAL_AREA, AVENUE, NOISE, TRAFFIC, PRIVACY, GEOMETRY, AFTERNOON_SUN |
| `fitMin` | `fitMin` | `null` (fit do contexto) | select | `GTE` | `EXCLUDE_UNKNOWN` | 4 | 50, 60, 70, 80; `FIT` |
| `dataStatus` | `dataStatusField`, `dataStatus[]` | `null` (proveniência do campo escolhido) | proveniência | `PROVENANCE_IN` | `EXCLUDE_UNKNOWN` | 3 | campo precisa existir no Field Registry |

Total: 21 filtros (7 rápidos, 10 avançados, 4 técnicos).

## 3. Operadores

| Operador | Regra (`OPS` / `test`) |
|---|---|
| `IN` | valor do lote na lista |
| `EQ` | igualdade estrita |
| `BETWEEN` | `min`/`max` opcionais, inclusivos |
| `LTE`, `GTE` | comparação; `scoreMin` compara com `value.min` |
| `IS_TRUE`, `IS_FALSE` | checkbox marcado exige `true`/`false` |
| `ORDINAL_MAX`, `ORDINAL_MIN` | posição na `order` da definição; valor fora da ordem não corresponde |
| `NOT_CONTAINS_TYPE` | a lista de alertas do lote não contém nenhum dos tipos |
| `OFFERABLE` | `App.availability.isOfferable(status, policy)` (UNKNOWN nunca é ofertável) |
| `IN_USER_SET` | id do lote no conjunto de favoritos |
| `PROVENANCE_IN` | status de proveniência do campo escolhido na lista |

## 4. Provedor de valor (`valueOf`)

| Filtro | Valor lido |
|---|---|
| `favoritesOnly` | `ctx.favorites.has(id)` |
| `fitMin` | `ctx.fit.get(id).fitScore` (ou `null` sem perfil) |
| `scoreMin` | `lot.intelligence.scores[key]` |
| `dataStatus` | `App.model.getFieldProvenance(lot, fieldKey).status` |
| `classMin` | `lot.intelligence.class`, com `UNKNOWN` lido como `null` |
| demais | `App.model.get(lot, fieldKey)` |

## 5. Situação dos campos (498 lotes)

Verificado com `App.model.get`, `getFieldProvenance` e `rangeStats`:

| Campo | Nulos | Proveniência | Faixa / distribuição |
|---|---|---|---|
| `commercial.price` | 0 | calculado | 299000 a 911304,16 |
| `geometry.areaM2` | 0 | confirmado | 250 a 761,96 |
| `mobility.routeDistanceToGateM` | 0 | calculado | 19 a 850 |
| `mobility.routeDistanceToLeisureM` | 0 | calculado | 68 a 878 |
| `availability.status` | 0 | não disponível | UNKNOWN 498 (sem espelho de vendas) |
| `intelligence.class` | 0 | estimado | A_PLUS 25, A 100, B 199, C 125, D 49 |
| `intelligence.alerts` | 0 (lista, pode ser vazia) | não verificada | 29 lotes com alerta NOISE |
| `geometry.shape` | 0 | calculado 444, não disponível 54 | RECTANGULAR 380, UNKNOWN 54, TRAPEZOIDAL 49, IRREGULAR 14, SQUARE 1 |
| `environmental.noiseLevel` | 0 | estimado | VERY_LOW 276, LOW 132, MEDIUM 61, HIGH 25, VERY_HIGH 4 |
| `environmental.privacyLevel` | 0 | estimado | VERY_LOW 17, LOW 151, MEDIUM 197, HIGH 81, VERY_HIGH 52 |
| `mobility.estimatedTraffic` | 0 | estimado | VERY_LOW 66, LOW 117, MEDIUM 163, HIGH 98, VERY_HIGH 54 |
| `surroundings.hasGreenRear` | 0 | calculado 493, não disponível 5 | sim 83, não 415 |
| `geometry.isCorner` | 0 | calculado | esquina 54 |

`geometry.shape` guarda o texto `UNKNOWN` em 54 lotes: é um valor, não nulo, e aparece na faceta. O filtro `greenBehind` lê o valor e não a proveniência (os 5 lotes de proveniência não disponível entram pelo valor), ao contrário da exigência `greenRear` da recomendação, que manda esses 5 para revisão.

## 6. Não implementado / pendências

- Registro configurável por empreendimento (`config/filters/`): não existe.
- Campos da especificação ausentes do registro: `labelKey`/`descriptionKey` (rótulos ficam em `panels.js`), `operators` múltiplos por filtro, `defaultOperator`, `brokerVisible`, `dependencies`, `formatter`, `filterable`.
- Política `IGNORE_CONDITION` existe em `NULL_POLICIES`, mas nenhum filtro a usa.
- `mobilePriority` é lido por `quickFilterOrder` desde 08/10/2026, mas o painel ainda não usa essa ordem.
- Implementado em 08/10/2026: preço por m², testada (frente), profundidade, cobertura e confiança do Fit, frescor e busca textual como condição.
- Filtros sugeridos e não implementados: plano de pagamento, fundos, tipo de vizinho, hierarquia viária, topografia e restrições construtivas, versão de dados.
- Implementado em 08/10/2026: o painel oferece "não informado" para formato, ruído, privacidade, trânsito e frescor.
