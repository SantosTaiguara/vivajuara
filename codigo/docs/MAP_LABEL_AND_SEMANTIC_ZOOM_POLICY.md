# Rótulos e zoom semântico (Tópico 46 §52–§54, §141)

## Zoom semântico (inalterado)
| Bucket (`svg#map[data-z]`) | k = largura fit / largura atual | Mostra |
|---|---|---|
| far | k < 1,7 | letras de quadra grandes; POIs principais |
| mid | 1,7 ≤ k < 4 | número do lote, letras de quadra menores, POIs secundários |
| near | k ≥ 4 | número + área do lote, POIs; sem letras de quadra |
Os limiares estão em `App.geo.camera.ZOOM_BUCKETS` e são verificados contra o `map.js` nos testes.

## MapLabelPolicy
`{ minZoomForLotLabel: 1.7, minZoomForAreaLabel: 4, maxZoomForBlockLabel: 4, maxVisibleLabels: null, hideCollidingLabels: false, prioritizeSelected/Compared/Recommended: true }`.
`labelPlan()` devolve os rótulos por prioridade (selecionado → comparados → recomendados → demais), para um renderer futuro com teto de rótulos. Hoje não há teto nem colisão: o desenho é o mesmo de antes.

## Culling (novo, sem mudança visual)
Em mid/near, rótulos de lote cujo bbox está fora do viewport expandido em 60% por lado recebem `display:none`. O conjunto é recalculado quando a câmera sai da área coberta ou a escala muda (consulta O(log n + k) no índice). Teste visual: o conjunto de rótulos visíveis na tela é idêntico antes/depois (101 rótulos a 1400 px, 104 a 390 px). Em far não há culling (o CSS já esconde rótulos de lote).

## Custo medido
Cada escrita de `viewBox` refaz o layout de todos os `text` SVG exibidos (Chrome: `FindSvgTextChunks`, `SvgTextLayoutAlgorithm`, shaping). Por isso o pan usa translação e o culling limita o que entra no layout num passo de zoom.

## Colisão
Não implementada: os rótulos já são dimensionados pelo menor lado do lote (5,5–10 unidades) e não colidem em zoom médio/próximo. `measureText` nunca é chamado.
