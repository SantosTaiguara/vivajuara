# Política de interação da legenda

Tópico 19. Política em `legendPolicy.interaction` de `plat/config/layers/viva-juara.json` (lida por `App.legend.policyOf`), ações de filtro em `filterActionFor` (`plat/src/map/legend.js`) e tratamento dos cliques em `plat/src/presentation/app.js` (`legendItem`, `legendFilter`, `legendToggle`, tecla Esc, toque no mapa vazio). Regra central: passar o mouse e clicar só destacam; filtrar é sempre uma ação explícita, feita pelo motor de filtros e visível como chip.

## 1. Flags da política e o que está implementado

| Flag | Valor | Comportamento real |
|---|---|---|
| `hoverHighlight` | `true` | só realce visual do botão (borda em `:hover` e `:focus-visible`); passar o mouse não destaca lotes no mapa |
| `clickFocus` | `true` | clique alterna o foco do item (`store.legendFocus`) e o mapa destaca o item |
| `clickPin` | `false` | não há fixação |
| `explicitFilterAction` | `true` | botão secundário de filtro aparece no item focado que tem mapeamento |
| `allowMultiFocus` | `false` | um item focado por vez |
| `keyboardNavigation` | `true` | itens são `<button>` nativos (Tab, Enter, Espaço) |

As flags são repassadas em `interactionMetadata`, mas `app.js` não as consulta: o comportamento acima é fixo no código.

## 2. Foco (clique)

- Clique em um item (`data-act="legendItem"`): grava `legendFocus = { layerId, itemKey }`; clicar de novo no mesmo item limpa.
- O `MapRenderModel` recebe `legendFocus`: lotes do item ganham a classe `lfocus` (contorno), os demais `lfade` (preenchimento a 0,12). O lote selecionado fora do item continua com preenchimento 0,6.
- Foco é estado visual temporário: não altera `activeFilters`, `FilterQuery`, perfil, restrições nem `recScope`. Teste: `legend focus never changes filters; the selected lot is marked in its bin`.
- Botão focado: `aria-pressed="true"`, classe `foc`.

O foco é limpo por:

| Gatilho | Onde |
|---|---|
| tecla Esc (primeira prioridade da cadeia de Esc) | `keydown` em `app.js` |
| toque em área vazia do mapa (depois de fechar o painel Encontrar, se aberto) | `onSelect(null)` |
| troca de camada no menu | evento `change` (`name="layer"`) |
| "Voltar ao padrão" nas camadas | `layersReset` |
| abrir ou recolher a legenda | `legendToggle` |
| "Limpar" filtros | `clearAll` |
| aplicar a ação de filtro do item | `legendFilter` |

`legendFocus` é transitório (`TRANSIENT` em `store.js`): nunca é salvo nem vai para o link.

## 3. Ação explícita de filtro

O botão aparece ao lado do item só quando o item está focado e tem `filterAction`. Ao clicar (`legendFilter`), `app.js` mescla o `patch` em `activeFilters`, limpa o foco, mostra "Filtro aplicado. Veja o chip em Encontrar." e registra `legend_filter_action`. A partir daí o filtro é igual a qualquer outro: compilado por `App.filters`, mostrado como chip removível no painel Encontrar e serializado no link (`f=`). Nada é escrito em restrições do cliente nem no escopo da recomendação.

Mapeamentos (`filterActionFor`), só onde o filtro reproduz exatamente os lotes do item:

| Camada | Item | Patch | Rótulo do botão |
|---|---|---|---|
| Disponibilidade | cada status | `{ statuses: [<status>] }` | "Filtrar somente esta situação" |
| Mata nos fundos | `yes` | `{ greenBehind: true }` | "Filtrar com mata nos fundos" |
| Preço | cada faixa | `{ priceMin, priceMax }` | "Aplicar esta faixa de preço" |
| Área | cada faixa | `{ areaMin, areaMax }` | "Aplicar esta faixa de área" |
| demais camadas, item "no" da Mata, baldes | — | sem ação | — |

Faixas são `[min, max)` e o filtro de preço e área é inclusivo nos dois lados. Por isso o limite superior do patch é o maior valor real dentro da faixa, não o limite da faixa; limite aberto vira `null`. Valores atuais:

| Faixa | Patch |
|---|---|
| Preço b0 Até R$ 300 mil | `priceMin null`, `priceMax 299000` |
| Preço b1 R$ 300 mil a R$ 320 mil | `300000` a `319762.56` |
| Preço b2 R$ 320 mil a R$ 360 mil | `320000` a `358800` |
| Preço b3 R$ 360 mil a R$ 400 mil | `360000` a `399882.6` |
| Preço b4 Acima de R$ 400 mil | `400000` a `null` |
| Área b0 Até 270 m² | `null` a `267.36` |
| Área b1 270 a 300 m² | `270` a `295.65` |
| Área b2 300 a 340 m² | `300` a `337.72` |
| Área b3 Acima de 340 m² | `340` a `null` |

Teste: `legend filter action selects exactly the lots of that bin (price and area)` compara o resultado do motor de filtros com os lotes da faixa no `MapRenderModel`.

No modo cliente só Disponibilidade, Preço e Área oferecem a ação; a Mata não. Item com 0 lotes fica desabilitado, não recebe foco e, portanto, não mostra a ação (hoje, "Disponível" e os outros status sem lotes).

## 4. Outras interações

- Chip "<camada> ▾" no cabeçalho da legenda: abre o menu de camadas (`openLayers`), nunca filtra.
- "Legenda" / "Recolher": grava `legendExpanded` e registra `legend_expanded` ou `legend_collapsed`.
- Seções de recomendação e de comparação são informativas (sem clique).
- Trocar Planta, Aérea ou Híbrido não altera a legenda.

## 5. Não implementado / pendências

- Implementado em 08/10/2026: passar o mouse ou o foco sobre um item destaca os lotes dele no mapa, sem filtrar (os demais ficam esmaecidos).
- Seleção de vários itens e "Aplicar filtro" em conjunto: não existe (previsto como futuro).
- Desde 08/10/2026 o status aplicado pela legenda se soma aos já escolhidos (união). Faixas de preço e área (`priceMin`/`priceMax`, `areaMin`/`areaMax`) continuam substituindo a faixa anterior.
- Foco em um balde ("Sem dado", "Desconhecido", ...) destaca exatamente os lotes do balde: o mapa usa a mesma chave do item (`#NO_DATA`, `#UNKNOWN`…; no modo cliente, `CONFLICTED` cai em `#NO_DATA`). Coberto em `tests/map.test.js`.
- O estado de foco não guarda `mode` (o tópico pede `LegendFocusState { layerId, itemId, mode }`).
- As flags da política não são lidas pela interface; mudar o arquivo de configuração não muda o comportamento.
