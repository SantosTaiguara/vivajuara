# Escalas das camadas do mapa (ScaleDefinition)

Tópico 18. Implementação em `plat/src/map/layers.js` (`scaleFor`, `buildFitScale`, `valueOf`, `tokenFor`), com as faixas e cores de `plat/src/services/layers.js` (`DEFS[].build`, `niceBreaks`, `binsFrom`, `pickRamp`, `levelLayer`). A legenda (tópico 19) e o tooltip usam a mesma escala e o mesmo resolvedor de faixa.

## 1. ScaleDefinition

| Campo | Conteúdo |
|---|---|
| `layerId`, `type` | camada; `CATEGORICAL`, `QUANTILE`, `FIXED_BINS` ou `THRESHOLD` |
| `domainSource` | `FULL_DEVELOPMENT` (calculada sobre todos os lotes) ou `FIXED_CONFIG` (faixas fixas da metodologia ou da política) |
| `dataVersion`, `setting`, `cacheKey` | versão de dado que invalida a escala, parâmetro (`scoreKey`) e chave do cache |
| `status`, `error` | `READY` ou `ERROR` (`INVALID_SCALE`, `SCALE_BUILD_FAILED`) |
| `title`, `note`, `neutral` | título (ex.: "Score Moradia"), nota da camada e indicação de mapa neutro |
| `items[]` | `{ key, label, min, max, includeMin: true, includeMax: false, color, token, order }` |
| `byKey` | `Map key -> item` |
| `resolve(lot, raw)` | o resolvedor de faixa compartilhado (é o `value()` de `services/layers.js`; na camada Fit, compara `raw` com os limites) |

Intervalos numéricos são `[min, max)`: `min` incluído, `max` excluído. Limite aberto (`-Infinity`/`Infinity`) vira `null`. As camadas Portaria e Clube trazem só rótulo, sem `min`/`max` numéricos, porque `services/layers.js` não grava limites nesses itens.

## 2. Domínio e estabilidade

- A escala é construída sobre o empreendimento inteiro (`lots` = todos os lotes carregados), nunca sobre o resultado do filtro. Filtro só escurece (`dim`). Teste: `the scale is built on the full dataset: a filter dims lots but never changes bins or colours` (camadas Preço, Área, Score e Ruído).
- Chave do cache: `[developmentId, layerId, setting, versão ou 'rev:'+dataRevision, número de lotes]`. A versão vem de `ctx.dataVersions[def.scale.versionKey]`: `static` (Área, Sol, Mata, Portaria, Clube), `commercial` (Preço, Preço por m²), `analysis` (Classe, Score, Ruído, Privacidade, Trânsito), `availability` (Disponibilidade, `'rev' + availabilityRevision`) e `fit` (`fitMethodologyVersion`).
- Base do mapa (Planta, Aérea, Híbrido) não muda faixas nem cores.
- Modo de escala filtrada (domínio = lotes filtrados) não existe; o padrão é o único modo.

## 3. Algoritmo das faixas por quantil (Preço e Área)

`niceBreaks(vals, step, n = 5)` em `services/layers.js`: ordena os valores não nulos; para `i = 1..4` pega o valor na posição `floor(i * total / 5)`, arredonda para o múltiplo de `step` mais próximo e mantém o corte se for maior que o mínimo, menor ou igual ao máximo e ainda não repetido. `binsFrom` monta as faixas entre `-Infinity`, os cortes e `Infinity`. Portanto podem sair menos de 5 faixas.

`step`: R$ 10.000 no Preço (`roundTo: 10000`), 10 m² na Área (`roundTo: 10`). Cores: `pickRamp(GREEN, n)` escolhe `n` tons espaçados da rampa verde; com 1 faixa usa `GREEN[3]`.

## 4. Faixas do Viva Juara (498 lotes)

Valores de `scaleFor` e da legenda, com os dados atuais (`staticVersion 2026-10-06.1`, `analysisVersion 2026-10-06`, `priceTableVersion 2026-10-06`).

**Preço** (QUANTILE, calculado sobre a tabela atual; nota "Faixas calculadas a partir dos preços da tabela atual.")

| Faixa | Intervalo | Cor | Lotes |
|---|---|---|---|
| b0 Até R$ 300 mil | < 300.000 | `#86B068` | 159 |
| b1 R$ 300 mil a R$ 320 mil | 300.000 a < 320.000 | `#64994B` | 51 |
| b2 R$ 320 mil a R$ 360 mil | 320.000 a < 360.000 | `#477E38` | 129 |
| b3 R$ 360 mil a R$ 400 mil | 360.000 a < 400.000 | `#2D6232` | 54 |
| b4 Acima de R$ 400 mil | >= 400.000 | `#1A3F20` | 105 |

**Área** (QUANTILE; 4 faixas, porque um dos cortes arredondados não passou na regra)

| Faixa | Intervalo | Cor | Lotes |
|---|---|---|---|
| b0 Até 270 m² | < 270 | `#86B068` | 210 |
| b1 270 a 300 m² | 270 a < 300 | `#64994B` | 25 |
| b2 300 a 340 m² | 300 a < 340 | `#2D6232` | 166 |
| b3 Acima de 340 m² | >= 340 | `#1A3F20` | 97 |

**Preço por m²** (CATEGORICAL: uma categoria por valor distinto): hoje um único valor, R$ 1.196/m², cor `#2D6232`, 498 lotes, nota "A tabela atual tem o mesmo preço por m² para todos os lotes."

**Score** (FIXED_BINS, `SCORE_BINS`, as mesmas faixas para Moradia, Investimento, Família, Premium e Geral; título "Score <rótulo>"):

| Faixa | Intervalo | Cor |
|---|---|---|
| b0 Abaixo de 60 | 0 a < 60 | `#86B068` |
| b1 60 a 69 | 60 a < 70 | `#64994B` |
| b2 70 a 79 | 70 a < 80 | `#477E38` |
| b3 80 a 87 | 80 a < 88 | `#2D6232` |
| b4 88 ou mais | 88 a < 101 | `#1A3F20` |

**Compatibilidade com o cliente** (THRESHOLD, `buildFitScale`): limites de `config/recommendation/viva-juara.json`, `minimumFitScore = 50` e `strongMatchFitScore = 70`. Faixas f0 "Abaixo de 50%" (`#86B068`), f1 "50% a 69%" (`#477E38`), f2 "70% ou mais" (`#1A3F20`). Nota: "Faixas definidas pela política de recomendação (mínimo e forte aderência)." Sem os dois limites a escala fica `ERROR`.

**Categorias fixas**

| Camada | Categorias (ordem) | Cores |
|---|---|---|
| Disponibilidade | AVAILABLE, RESERVED, PROPOSAL, BLOCKED, SOLD, UNAVAILABLE, UNKNOWN (`AVAILABILITY_ORDER`) | `#2D6232`, `#eda100`, `#2a78d6`, `#5f6b61`, `#93451E`, `#a9b0a6`, `#e4e7e0` |
| Classe | A+ (5% melhores), A, B, C, D (exigem atenção) | `#2D6232`, `#64994B`, `#D8D3BF`, `#D27B47`, `#93451E` |
| Ruído, Trânsito | níveis presentes de VERY_LOW a VERY_HIGH | rampa laranja pelo índice do nível |
| Privacidade | níveis presentes de VERY_LOW a VERY_HIGH (rótulos no feminino) | rampa verde pelo índice do nível |
| Sol nos fundos | Fundos para N, NE ou NO (mais sol); leste ou oeste; S, SE ou SO (mais sombra) | `#1A3F20`, `#477E38`, `#86B068` |
| Mata nos fundos | Mata ou parque nos fundos; Outro lote ou área aberta | `#2D6232`, `#D8D3BF` |
| Portaria | Muito próximo (até 200 m de carro), Próximo (200 a 399 m), Intermediário (400 a 649 m), Distante (650 ou mais m) | `#1A3F20`, `#2D6232`, `#64994B`, `#86B068` |
| Clube | Até 249 m, 250 a 499 m, 500 a 749 m, 750 m ou mais (de carro) | `#1A3F20`, `#2D6232`, `#64994B`, `#86B068` |

Nas camadas de nível (`levelLayer`) só aparecem os níveis que existem nos dados; hoje os 5 níveis estão presentes em Ruído (276, 132, 61, 25 e 4 lotes).

## 5. Status do valor (LayerValueResult)

`valueOf(def, lot, scale, ctx)` devolve `{ lotId, layerId, value, binKey, valueStatus, freshness, confidence, provenanceSummary, version }`. O valor bruto é lido do Lot (`App.model.get(lot, fieldKey)`), de `intelligence.scores[scoreKey]` ou do `FitScoreResult`; nada é recalculado.

| valueStatus | Quando | `binKey` |
|---|---|---|
| `AVAILABLE` | valor presente e faixa encontrada | a faixa |
| `UNKNOWN` | Disponibilidade `UNKNOWN`; valor `UNKNOWN` em outra camada; Classe nula | mantida só em Disponibilidade (`unknownIsCategory`) |
| `NO_DATA` | valor nulo ou fora de todas as faixas; Fit com `INSUFFICIENT_PROFILE`, `FAILED` ou `fitScore` nulo; camada `none` | `null` |
| `CONFLICTED` | valor e faixa presentes, mas a proveniência do campo é `CONFLICTED` | `null` |
| `ERROR` | exceção ao ler o lote | `null` |

`null` nunca vira 0: um preço, uma área ou um Fit ausente é `NO_DATA` ("não disponível"), nunca a faixa mais baixa. `UNKNOWN` de disponibilidade fica na categoria "Status não confirmado" e nunca na faixa "Disponível" (teste `availability layer: UNKNOWN is never drawn or counted as AVAILABLE`).

`freshness`: na Disponibilidade, `lot.availability.freshness`; nas camadas com `freshnessKey = commercial`, o status de `repo.getFreshnessState().commercial`. Hoje: comercial `FRESH`, disponibilidade `UNKNOWN` nos 498 lotes.

## 6. Cores sem faixa e tokens

| Situação | Token | Cor |
|---|---|---|
| sem dado | `map.noData` | `#cdd2c9` |
| desconhecido / mapa neutro / camada `none` | `map.unknown` | `#e4e7e0` |
| conflito | `map.conflicted` | `#cdd2c9` (+ hachura fora do modo cliente) |
| erro | `map.error` | `#cdd2c9` |

`TOKENS` (36 entradas) reúne as rampas (`map.ramp.green.0..4`, `map.ramp.orange.0..4`), classes, status, neutros, solar e contornos. `tokenFor` liga cada cor de faixa ao seu token semântico. Disponibilidade só com `UNKNOWN` gera escala `neutral` e a nota "Ainda sem espelho de vendas: nenhum lote tem status confirmado. A planta aparece limpa."

## 7. Não implementado / pendências

- Tipos `EQUAL_INTERVAL` e `CONTINUOUS` (gradiente com ticks) não são usados por nenhuma camada.
- Modo de escala sobre o resultado filtrado: não existe (é declarado como futuro no tópico).
- Os limites da camada Portaria (200, 400, 650 m) existem só no rótulo; a classe vem pronta do campo `mobility.gateProximity`.
- Com os dados atuais não há valor `CONFLICTED`. Se aparecer, o lote perde a cor da faixa e recebe `map.conflicted`; o serviço antigo pintaria a faixa. A paridade de cor (`MAP_LAYER_ARCHITECTURE.md`, seção 8) vale para os dados atuais.
