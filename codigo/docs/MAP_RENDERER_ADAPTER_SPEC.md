# MapRendererAdapter (Tópico 46 §34–§37, §40–§47)

## Contrato
`initialize · setGeometryBundle · setViewport · updateFeatureStates · updateLayerStyles · setLabels · destroy` (`App.geo.repository.RENDERER_ADAPTER_METHODS`).

## Implementação atual: SVG (`presentation/map.js`)
| Contrato | MapView (SVG) | Comportamento |
|---|---|---|
| setGeometryBundle | `init(lots)` | cria 498 paths + rótulos **uma vez**; pipeline geoespacial depois da 1ª pintura |
| setViewport | `setViewport / fitAll / focusLot / panBy / zoomBy` | câmera lógica; escrita imediata (programática) |
| updateFeatureStates / updateLayerStyles | `render(MapRenderModel)` | compara fill/opacidade/classes/aria por lote e escreve só o que mudou |
| setLabels | CSS por `data-z` + culling | sem recriar texto |
| destroy | `destroy()` | aborta listeners (AbortController), desconecta ResizeObserver e PerformanceObserver, cancela rAF/timers, libera mapas, índice e modelo |
Extras técnicos: `hitTestAt(x, y, pointerType)`, `viewportQuery(bufferRatio)`, `geometry()`, `diagnostics()`, `uncullLabels()`. `App.geo.repository.svgAdapter(view)` expõe o MapView no formato do contrato, sem alterá-lo.

## Estado estático × dinâmico
- **Estático por versão:** atributo `d`, posição dos rótulos, POIs, bbox, índice.
- **Dinâmico:** `style.fill`, `style.fillOpacity`, classes (`dim sel cmp fav rec rev lfocus lfade stale conf unk`), `aria-label`, ordem Z (cmp/rec/rev acima, selecionado no topo), pins HTML.
- `MapFeatureVisualState` = classes do `MapRenderModel` (Tópico 18); o renderer não calcula score, Fit, Recommendation, Comparison, filtro, preço ou disponibilidade.

## Atualização suja (§42)
`render()` registra `lastRender = { dirtyFill, dirtyClass, dirtyAria, moved }`. Seleção de um lote: 1–2 classes e 1 movimento DOM; mudança de disponibilidade em 3 lotes: 3 fills. Troca de camada: até 498 fills, **zero** paths recriados (teste funcional: atributo `d` idêntico nas 14 camadas).

## Uma geometria primária (§44/§45)
Um único conjunto de 498 paths; camadas trocam só o estilo; Comparison/Recommendation/seleção são classes nos mesmos paths, sem cópias de polígono.

## Isolamento
Os módulos `geo/*` não conhecem SVG (sem DOM). Só `map.js` sabe de `path`, `viewBox` e `#gCam`. Trocar para Canvas/WebGL exige um novo adapter; os módulos de domínio e o índice ficam como estão.

## Flags de migração (`App.MapView.FLAGS`)
`cameraTranslate`, `labelCulling`, `bulkNoTransition`, `shadowHitTest`, todos `true`. Cada um volta ao comportamento anterior isoladamente. Remover as flags depois da validação em aparelhos reais (§125: sem branches eternos).
