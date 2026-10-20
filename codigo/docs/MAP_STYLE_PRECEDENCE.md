# Precedência de estilo no mapa (LayerStyleResolver)

Tópico 18. Implementação em `plat/src/map/layers.js` (`resolveStyle`, `buildRenderModel`, `Z_ORDER`, `PRECEDENCE`), desenho em `plat/src/presentation/map.js` (`render(model)`) e regras visuais em `plat/src/presentation/styles.css`. Cada canal visual tem um dono: o preenchimento é da camada temática; o contorno é do estado de interação; a opacidade é do filtro.

## 1. Ordem de precedência

`PRECEDENCE = selected > comparison > recommendation > thematic > filterDim > base`

| Prioridade | Estado | Canal | Valor no LotVisualStyle | Classe CSS |
|---|---|---|---|---|
| 1 | selecionado | contorno | `map.selected`, 3,4, sólido, `zIndex SELECTED` | `sel` |
| 2 | comparação (1 a 4) | contorno + número | `map.comparison`, 2,4, sólido, `symbol.comparison.<n>` | `cmp` |
| 3 | recomendação | contorno + pin | `map.recommendation.primary`, 1,8, sólido; revisão: tracejado | `rec` / `rev` |
| 3 | favorito | contorno tracejado | `map.hover`, 1,6, tracejado | `fav` |
| 4 | camada temática | preenchimento | token da faixa ou do status do valor | — |
| 5 | fora do filtro | opacidade | `zIndex FILTER_DIM` | `dim` |
| 6 | base | — | `map.base.stroke` `#ffffff`, 0,6 | — |

`resolveStyle` aplica as regras nessa ordem, cada uma sobrescrevendo o contorno da anterior: preenchimento, `dim`, `stale`, favorito, recomendação, comparação, foco da legenda (`lfocus`/`lfade`), selecionado, hachura (`unk`/`conf`). O selecionado é aplicado por último no contorno e sempre vence.

## 2. Preenchimento

| Situação | Token |
|---|---|
| camada `none` | `map.unknown` |
| escala com erro | `map.noData` |
| `binKey` com item na escala | token do item |
| `UNKNOWN` sem categoria | `map.unknown` |
| `CONFLICTED` | `map.conflicted`; fora do modo cliente, `patternToken = pattern.conflicted` (classe `conf`) |
| `ERROR` | `map.error` |
| `NO_DATA` | `map.unknown` se a escala é neutra; senão `map.noData` |

`UNKNOWN` fora da camada Disponibilidade recebe `pattern.unknown` (classe `unk`, contorno pontilhado) fora do modo cliente. Na Disponibilidade, `UNKNOWN` é categoria e não leva hachura.

Opacidade do preenchimento: 0,55 na Planta, 0,8 em Aérea e Híbrido (`fillOpacity`; a variável CSS `--fo`). `layerOpacities[layerId]`, quando definido, substitui o valor; não há controle na interface para isso.

## 3. Filtro

O filtro nunca troca a cor: o lote fora do `FilterResult.matchedIds` mantém o mesmo `fill` e ganha a classe `dim`. Teste: a cor de cada lote com e sem filtro é idêntica e só os não correspondentes recebem `dim` (`plat/tests/map.test.js`). Lote escurecido continua clicável (o hit test em `map.js` usa `elementFromPoint` sobre o polígono, independente da classe).

| Regra CSS (`styles.css`) | Efeito |
|---|---|
| `svg#map .lot.dim { fill-opacity: .08 !important; stroke-opacity: .5 }` | fora do filtro |
| `svg#map .lot.sel.dim, svg#map .lot.sel.lfade { fill-opacity: .6 !important; stroke-opacity: 1 }` | selecionado fora do filtro continua visível |
| `svg#map .lot.cmp.dim { stroke-opacity: 1 }` | contorno de comparação não desbota |

Selecionado fora do filtro: contorno de seleção, preenchimento atenuado e, na Quick View, o aviso "Fora dos filtros atuais (...). O lote continua selecionável." (tópico 20).

## 4. Outros estados

| Estado | Regra | Classe |
|---|---|---|
| valor comercial desatualizado (`STALE`) em parte dos lotes | `symbol.stale`, contorno tracejado | `stale` |
| todos os lotes `STALE` (`layerAllStale`) | sem marca por lote; a legenda avisa "Dados comerciais sem confirmação nesta sessão: mostrando o último valor conhecido." | — |
| foco de item da legenda | lotes do item ficam com contorno; os demais desbotam | `lfocus` / `lfade` |
| hover (desktop) | não passa pelo modelo; CSS `@media (hover:hover) { .lot:hover { stroke: #13261a; stroke-width: 1.6 } }` | — |

## 5. Ordem de desenho (z-order)

`Z_ORDER`: BASE_MAP < STATIC_REFERENCES < THEMATIC_FILL < FILTER_DIM < CONTEXT_OVERLAYS < RECOMMENDATION_COMPARISON < HOVER < SELECTED < LABELS < TOOLTIP.

No SVG (`shell.html`), os grupos seguem `#gBg` (base) < `#gLots` (lotes) < `#gOvl` < `#gRoute` (rota) < `#gLbl` (números e áreas) < `#gBlk` (letras das quadras) < `#gPoi` (pontos de referência); por cima ficam os pins HTML (`.pins`) e o tooltip (`#tip`). Dentro de `#gLots`, `render(model)` move para o fim os lotes com `cmp`, `rec` ou `rev` e, por último, o selecionado, que fica acima de todos.

Rótulos por zoom (`map.js`, `setVB`): `data-z = far` (fator < 1,7), `mid` (< 4) ou `near`. Em `far` só as letras das quadras e os pontos principais; em `mid` aparecem os números dos lotes e os pontos `z1`; em `near`, números e áreas, sem as letras das quadras.

## 6. Pins

`recommendationFeatures(rec, 5)`: até 5 pins numerados. Com recomendações, o primeiro é `TOP_1` (quando o tier é `PRIMARY`) e os seguintes `TOP_2_5`, título "<n>º na recomendação". Sem nenhuma recomendação elegível, até 5 candidatos de revisão com título "<n>º para revisar (status a confirmar)" (classe `pin top rev`, borda tracejada). No Viva Juara, sem espelho de vendas, todo resultado de recomendação vem como revisão. Os pins de comparação ("Comparação <n>") substituem o pin de recomendação do mesmo lote.

## 7. Texto acessível e tooltip

Cada polígono recebe `aria-label` com `ariaLabelParts`: "Quadra <q>, lote <n>", "situação: <status>" e "<camada>: <valor>" (`valueText`). Exemplo real (B79, camada Preço): "Quadra B, lote 79, situação: Status não confirmado, Preço: R$ 348.969". Na camada Disponibilidade a situação aparece duas vezes (situação e valor da camada).

Tooltip (desktop, `ML.tooltip`): título do lote, "<área> · <status>" e, fora de Disponibilidade e `none`, "<título da escala>: <valor>", com " (último valor conhecido)" se o valor está `STALE`. `app.js` acrescenta "<n>% compatível" quando há recomendação. Textos de valor: "não disponível" (sem dado), "desconhecido", "fontes divergentes" (no modo cliente, "não disponível"), "não foi possível ler".

## 8. O que o renderer aplica

`render(model)` aplica `fill`, `fillOpacity` (só quando difere da base), as classes `dim sel cmp fav rec rev lfocus lfade stale conf unk` e o `aria-label`. Espessura, cor e tracejado do contorno vêm das classes CSS, que reproduzem os valores do modelo, com duas diferenças: `.lot.rev` usa espessura 1,5 (`stroke-dasharray: 4 2`) contra 1,8 no modelo, e `.lot.sel` força `fill-opacity: .95`, que não está no `LotVisualStyle`.

## 9. Não implementado / pendências

- Hover e destaque de resultado de busca fora do `LotVisualStyle`. Desde 08/10/2026 os dois destaques existem, como classes aplicadas pelo mapa (`lhov` para a legenda, `srch` para a busca).
- `strokeToken`, `strokeWidth`, `strokePattern` e `symbolToken` do modelo não são lidos pelo renderer (o CSS é a fonte efetiva do traço).
- Adaptação de contraste por base (Planta x Aérea) além da opacidade.
- O caminho "Sol agora" usa `map.paint`/`setMarks` e não segue esta precedência formal (ver `MAP_LAYER_ARCHITECTURE.md`).
