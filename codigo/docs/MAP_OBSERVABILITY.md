# Observabilidade do mapa

Reaproveita o tópico 46 (`src/geo/perf.js`): o mapa já mede `map_geometry_load`, `map_geometry_decode`, `map_index_build`, `map_first_render`, `map_layer_switch`, `map_hit_test`, `map_filter_visual_update`, `map_render` em anel de 120 amostras, observa long tasks e expõe `App.MapView.diagnostics()`. A observabilidade **não mede de novo**: `signals.fromMapDiagnostics(diag)` lê esse diagnóstico.

| Métrica | Origem | Labels |
|---|---|---|
| map_interactive_duration_ms | `instrument.mapReady(diag)` — ms desde a navegação até INTERACTIVE | device_class, renderer_type |
| map_first_render_duration_ms | `diag.firstRenderMs` | device_class, renderer_type |
| map_geometry_load_duration_ms | `diag.geometryLoadMs` | device_class, renderer_type |
| map_layer_switch_duration_ms | `instrument.layerSwitch(ms, diag)` ou p95 do recorder | device_class, renderer_type |
| map_hit_test_duration_ms | p95 do recorder | device_class, renderer_type |
| longtask_duration_ms | PerformanceObserver | route_code |

Prontidão progressiva (geo/perf.js): SHELL_READY → BASE_MAP_READY → GEOMETRY_READY → INTERACTIVE → FULLY_ENHANCED. `readiness` da "Saúde da plataforma" usa esse estado.

- renderer_type controlado: SVG, CANVAS, WEBGL, NATIVE (hoje sempre SVG).
- device_class: MOBILE, TABLET, DESKTOP, UNKNOWN.
- lotId nunca é label; pode ir em span `quickview.load` (`lot.id`).
- Falha do pipeline geoespacial (map.js linha 151, hoje `console.error`) deve ser `report(e, 'MapRenderer')` com código MAP_RENDER_FAILED; falha da geometria, MAP_GEOMETRY_LOAD_FAILED. A geometria base continua; rótulos degradados registram MAP_LABEL_OVERLAY_DEGRADED.
- Alerta local `map_interactive_degraded`: p95 > 3000 ms com ≥ 5 amostras (proposto).
- Runbook RB-MAP-INTERACTIVE: marcador de release, tamanho da geometria, acerto de cache, raster, classe de dispositivo, tarefas longas, métricas do renderizador.
- Paridade de cores do mapa: inalterada (t18 TOTAL DIFF 0); nenhum arquivo do mapa foi editado.
