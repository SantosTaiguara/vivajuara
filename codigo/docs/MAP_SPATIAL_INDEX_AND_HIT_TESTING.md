# Índice espacial e hit testing (Tópico 46 §18–§25, §116, §152)

## SpatialIndex (`geo/spatialIndex.js`)
- R-tree estática empacotada (bulk load STR, nó de 16), sem dependência; imutável por versão de render.
- `search(bounds)`, `queryPoint(point, tolerance)`, `nearest(point, k)`; resultados ordenados por `featureIndex` e sempre com `lotId`.
- Construção: 498 itens em ≈2,5 ms (desktop) / ≈10–13 ms (CPU 4×); profundidade 3.
- Correção: igual à varredura bruta em 1.500 consultas de retângulo + 1.500 de ponto (dados reais) e em datasets sintéticos de 1.000 / 5.000 / 10.000 feições (teste `geo46.test.js`). Falso positivo de bbox é aceito; falso negativo, não.

## MapHitTestService (`geo/hitTest.js`)
Fluxo: ponto de tela → transformação inversa da câmera (CTM desenhada) → candidatos por bbox (raio = maior meia-espessura de contorno) → teste exato (ponto-em-polígono + faixa do contorno) → resultado `EXACT | EDGE_NEAR | AMBIGUOUS | NONE`.

Reproduz a regra do hit nativo do SVG: vence o lote **mais acima na ordem de pintura** cujo preenchimento **ou contorno** cobre o ponto. Contorno: meia-espessura real do lote (`getComputedStyle`, inclui `.sel` 3,4 e `:hover`); ordem: posição no `#gLots`. Sem ordem informada: o maior `featureIndex` (desenhado depois). Recommendation, Fit, ranking ou preço nunca entram no desempate (teste dedicado).

## Decisão: o SVG continua decidindo (spec §21)
O clique continua usando `document.elementFromPoint` (alvo nativo), como antes; a seleção é exatamente a de antes. O serviço roda **em sombra** a cada clique (uma consulta, ≈0,2–0,6 ms) e grava concordância em `MapView.diagnostics().hitShadow`. Uso atual do serviço: diagnóstico, consulta de viewport, culling de rótulos; uso futuro: renderer Canvas/WebGL, tolerância de toque.

## Paridade medida (Playwright, `g46_parity.js`)
| Largura | Pontos (centróides + vértices recuados + meios de aresta) | Nativo antes × depois | Serviço × nativo |
|---|---|---|---|
| 1400 × 900 | 20.152 em 6 estados de câmera (fit, zoom 5, pan em andamento, pan assentado, zoom 11, com seleção) | 1 diferença (ponto exatamente sobre aresta, durante pan não assentado; um clique sempre confirma o `viewBox` antes do hit, então não afeta seleção) | 20.143 / 20.152 (99,96%) |
| 390 × 844 | 13.539 | 0 | 13.534 / 13.539 |
| Centróides | 498 / 498 lotes cobertos | 0 diferenças | 498 / 498 (Node: centróide e âncora de cada lote acertam o próprio lote) |
As divergências do serviço são pontos sobre arestas compartilhadas (frações de pixel): o Chrome aplica a própria tolerância ao contorno.

## Tolerância (HitTestTolerancePolicy)
`{ pointerPx: 0, touchPx: 10, penPx: 4, fallbackEnabled: false, ambiguityEpsPx: 1 }`. Hit exato sempre vence. O fallback por tolerância está **desligado**: hoje um toque no vão entre lotes não seleciona nada (comportamento preservado). Ligar é decisão de produto.

## Gestos (MapGestureClassifier)
`TAP | PAN | PINCH | WHEEL_ZOOM | DOUBLE_TAP`. Limiar de pan por modo de entrada `{ mouse: 6, pen: 6, touch: 6 }`, o mesmo 6 px de antes, agora num lugar só. Só TAP/DOUBLE_TAP selecionam; DOUBLE_TAP se comporta como TAP (sem zoom por duplo toque hoje).

## Complexidade
viewport query e hit test O(log n + k); troca de camada O(n) só em estilo; atualização suja O(m) em escritas DOM (comparações O(n) baratas); mudança de câmera O(1) durante pan.
