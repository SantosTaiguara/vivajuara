# Inventário legado e migração (Tópico 46 §128–§129)

| Local | Concern | Por quadro | Varre todos | Muta geometria | Store global | Custo medido antes | Ação | Severidade | Situação |
|---|---|---|---|---|---|---|---|---|---|
| `map.js setVB` (pan/wheel/pinch) | CAMERA | sim | sim (layout de ~1.000 textos SVG) | não | não | 25–45 ms/mov. near (1×), ~80 ms (4×) | OPTIMIZE | CRITICAL | translação de `#gCam`, viewBox só ao mudar escala/assentar |
| `map.js toSvg/scale/toScreen` | CAMERA | sim | não | não | não | 2 layouts forçados por `pointermove` | OPTIMIZE | HIGH | cache de retângulos + matemática de câmera |
| `map.js scale()` | RENDER | sim | não | não | não | innerHTML por movimento | OPTIMIZE | LOW | escreve só quando muda |
| `map.js svg.dataset.z` | LABEL | sim | invalida estilo de todos os rótulos | não | não | — | OPTIMIZE | MEDIUM | escreve só quando o bucket muda |
| `styles.css .lot{transition:fill .15s}` na troca de camada | RENDER | 150 ms após a troca | 498 transições | não | não | estilo 526 ms / 28 trocas | OPTIMIZE | HIGH | classe `bulk` (sem transição se > 60 recolores) |
| `map.js render()` ordem Z | RENDER | não | sim (O(n) comparações) | não | não | `appendChild` de todo cmp/rec a cada render | OPTIMIZE | MEDIUM | só move se a ordem final ainda não está lá |
| `map.js drawPins` | RENDER | sim (rAF) | não | não | não | innerHTML por quadro | OPTIMIZE | LOW | escreve só quando muda |
| arraste sobre rótulos | EVENT | sim | não | não | não | seleção de texto → `pointercancel` no arraste seguinte | REPLACE | HIGH | `selectstart` cancelado no SVG |
| `map.js init` | GEOMETRY | não | sim, 1 vez | não | não | ≈22 ms | KEEP | LOW | paths criados uma vez |
| hover (`pointermove` → `closest('.lot')`) | HIT_TEST | sim | não (hit nativo) | não | só `hoverLotId` silencioso ao trocar de lote | ≈0 | KEEP | LOW | inalterado |
| clique (`elementFromPoint`) | HIT_TEST | não | não | não | não | ≈0,1 ms | KEEP | LOW | inalterado + sombra espacial |
| centróide/bbox | GEOMETRY | não | — | não | não | pré-calculado no adapter | MOVE_TO_PREPROCESS (já estava) | LOW | bundle reaproveita |
| `app.js onViewport → backLotBtn/lotInView` | STATE | sim (rAF) | não | não | `mapViewport` com debounce 300 ms | — | KEEP | LOW | agora sem layout forçado (isVisible por matemática) |
| scores/filtros/recomendação | ANALYSIS | não | — | não | — | fora do renderer | KEEP | — | o mapa só consome o `MapRenderModel` |

## Migração
1. Os módulos `geo/*` são aditivos; `map.js` funciona sem eles (modo nativo, sem índice/culling/diagnóstico).
2. Flags em `App.MapView.FLAGS` permitem reverter cada mecanismo.
3. Shadow benchmark: hit do serviço × nativo em cada clique (`diagnostics().hitShadow`); paridade nativa antes × depois medida em 33.691 pontos.
4. Limpeza: remover as flags depois de validar em aparelhos reais.
