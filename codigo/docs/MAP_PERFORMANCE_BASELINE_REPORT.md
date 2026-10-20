# Baseline e resultados de performance do mapa (Tópico 46 §76–§77)

**Método.** Chromium headless (Playwright), build do painel servido localmente; "antes" = `map.js` original, "depois" = `map.js` + `src/geo/*`. As rodadas antes/depois foram intercaladas para reduzir ruído (outras tarefas usavam a máquina ao mesmo tempo, então os números variam ±15%). Tempos de CPU do renderer via CDP `Performance.getMetrics` (soma de script/layout/estilo/task no cenário), intervalos de quadro via `requestAnimationFrame`, long tasks via `PerformanceObserver`. CPU 4× = `Emulation.setCPUThrottlingRate(4)` (aproxima notebook/Android intermediário). Script: `g46_bench.js`.

Cenários: **pan** = 3 arrastes × 60 movimentos (zoom fit); **panNear** = 2 × 60 em zoom médio/próximo (rótulos visíveis); **wheel** = 3 × (8 in + 8 out); **hover** = 200 movimentos; **layer** = 14 camadas × 2; **select** = 30 cliques em lotes.

## Desktop 1400 × 900, CPU 1×
| Cenário | Task antes → depois (ms) | Layout antes → depois | Quadro p95 | Quadros > 33 ms | Long tasks |
|---|---|---|---|---|---|
| pan | 1.702 → 919 | 498 → 29 | 16,7 → 16,7 | 0 → 0 | 0 → 0 |
| panNear | 3.036 → 701 | 1.740 → 40 | 16,8 → 16,8 | 0 → 0 | 0 → 0 |
| wheel | 1.149 → 1.375 | 639 → 789 | 16,8 → 33,3 | 2 → 2 | 0 → 2 |
| hover | 838 → 421 | 70 → 67 | 16,7 → 16,8 | 0 → 0 | 0 → 0 |
| layer | 1.577 → 818 (estilo 523 → 283) | 73 → 73 | 50 → 16,8 | 7 → 0 | 1 → 0 |
| select | 3.449 → 2.306 | 476 → 381 | 16,8 → 16,8 | 27 → 9 | 29 → 7 |
Troca de camada até o próximo quadro: p50 42 → 27 ms, p95 77 → 34 ms. Clique → `.sel`: p50 40 → 32 ms, p95 58 → 49 ms (30/30 corretos).

## Desktop 1400 × 900, CPU 4×
| Cenário | Task | Layout | Quadro p95 | > 33 ms | Long tasks (máx.) |
|---|---|---|---|---|---|
| pan | 8.814 → 3.433 | 2.769 → 114 | 50 → 16,8 | 46 → 2 | 28 → 0 |
| panNear | 15.653 → 2.882 | 8.904 → 162 | 133 → 16,8 | 126 → 5 | 123 (385 ms) → 4 (72 ms) |
| wheel | 5.464 → 5.056 | 3.128 → 2.826 | 133 → 133 | 38 → 40 | 38 → 37 |
| hover | 3.841 → 1.984 | 322 → 332 | 50 → 33 | 30 → 8 | 14 → 2 |
| layer | 5.276 → 3.207 | 256 → 277 | 183 → 133 | 44 → 32 | 39 → 25 |
| select | 14.887 → 10.556 | 1.750 → 1.643 | 33 → 16,8 | 40 → 33 | 38 → 33 |
Troca de camada: p50 155 → 95 ms, p95 232 → 147 ms. Clique → `.sel`: p50 204 → 162 ms, p95 325 → 260 ms.

## Mobile 390 × 844, CPU 4×
| Cenário | Task | Layout | Quadro p95 | > 33 ms | Long tasks |
|---|---|---|---|---|---|
| pan | 7.336 → 3.143 | 2.414 → 86 | 33 → 16,8 | 6 → 3 | 4 → 3 |
| panNear | 13.430 → 2.347 | 8.550 → 36 | 117 → 16,8 | 124 → 4 | 123 → 4 |
| wheel | 4.302 → 3.751 | 2.552 → 1.956 | 117 → 100 | 32 → 29 | 30 → 27 |
| hover | 2.406 → 772 | 0 → 0 | 33 → 16,7 | 10 → 1 | 6 → 0 |
| layer | 6.464 → 3.349 | 450 → 311 | 267 → 117 | 46 → 31 | 42 → 26 |
Troca de camada: p50 195 → 103 ms. (O cenário de seleção não roda a 390 px: o pan anterior leva o empreendimento para fora da área livre do mapa nos dois builds, igualmente.)

## Tablet/notebook 1024 × 768, CPU 1×
pan 1.302 → 998 ms (layout 399 → 27) · panNear 3.127 → 781 (layout 1.826 → 7) · wheel 1.090 → 1.155 · hover 495 → 221 · layer 1.361 → 1.079, quadros > 33 ms 9 → 1 · select 3.361 → 2.412, clique p50 36 → 28 ms.

## Inalterados / outros
- Carga até lotes coloridos: 1,5–2,0 s nos dois (sem mudança material; o pipeline geoespacial roda depois da 1ª pintura).
- Marcas técnicas (depois): `map_first_render` 19–21 ms (1×) / 120–143 ms (4×); `map_geometry_decode` 14–33 / 57–60 ms; `map_index_build` 2–3 / 10–13 ms; `map_layer_switch` (render do mapa) 4–8 / 20 ms.
- DOM: 1.586 → 1.587 nós (o `<g id="gCam">`); 498 paths, 1.040 textos. Heap JS +1–3 MB (bundle/índice).
- Hit nativo (`elementFromPoint`): p95 0,1 ms (1×) / ~1 ms (4×). Serviço espacial: p95 0,3–0,5 ms. **O hit test nunca foi gargalo.**

## Gargalos medidos
1. **Escrita de `viewBox` = layout de todo texto SVG** (CRITICAL antes): resolvido para pan; continua no **zoom** (wheel/pinch). Culling de rótulos reduz o layout a 4× (−10 a −23%), mas em 1× o custo extra de estilo empata. Pendente: zoom contínuo por transform CSS no `<svg>` com confirmação no fim do gesto (troca nitidez temporária e bordas vazias no zoom-out; decisão de UX).
2. Seleção: o resto da latência está nos painéis (`app.js`/`panels.js`), fora deste tópico.
3. Troca de camada: o resto (≈95 ms a 4×) está na montagem do modelo/legenda/painéis; o mapa gasta ≈20 ms.
