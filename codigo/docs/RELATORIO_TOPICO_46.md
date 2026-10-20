# Relatório — Tópico 46: Performance geoespacial do mapa

## Resumo
O mapa continua sendo SVG: o benchmark não justificou Canvas/WebGL, vector tiles nem LOD. O gargalo medido era outro: cada escrita de `viewBox` fazia o Chrome refazer o layout de todos os ~1.000 textos SVG, entre 25 e 45 ms por movimento em zoom próximo e cerca de 80 ms com CPU 4× mais lenta. O pan passou a transladar um grupo de câmera, com uma escrita por quadro e sem leitura de layout nos handlers. Resultado: o layout no pan caiu de 1.740 para 40 ms (desktop) e de 8.904 para 162 ms (CPU 4×), e os quadros acima de 33 ms foram de 126 para 5. A troca de camada ficou 35–50% mais rápida, sem 498 transições simultâneas. Geometria, IDs, cores (`t18.js` TOTAL DIFF 0), classes, aria-labels, ordem Z, rótulos visíveis, POIs e lote selecionado não mudaram (33.691 pontos de hit comparados antes e depois; 498/498 centróides idênticos).

## Itens do §156
- **Renderer/bibliotecas:** SVG puro, sem bibliotecas. **Formato:** JSON (`Lot.geometry.polygon`), 498 lotes e 3.652 vértices. **CRS:** `PIXEL_SPACE` da planta (2247 × 1587), `metersPerUnit` estimado, sem EPSG. **Transforms:** identidade planta→SVG (versionada); câmera = `viewBox` + translação de `#gCam`.
- **DOM:** 1.587 nós (498 paths, 1.040 textos). **Loops por quadro antes:** escrita de viewBox (layout de todos os textos), 2 layouts forçados por `pointermove`, `innerHTML` da escala e dos pins. **Cálculos em runtime:** nenhum cálculo geoespacial no render; centróide e bbox já vinham pré-calculados.
- **GeometryManifest, versões, bbox/centróide/âncora, validação, compatibilidade, índice, hit test, viewport, LOD, precisão, bundle, repositório, adapter:** ver `MAP_GEOMETRY_MANIFEST_SPEC.md`, `MAP_SPATIAL_INDEX_AND_HIT_TESTING.md`, `MAP_RENDERER_ADAPTER_SPEC.md`, `MAP_GEOMETRY_LOD_POLICY.md`. Validação do Viva Juara: 0 erros, 0 avisos.
- **Hit testing:** continua o nativo do SVG (§21). O serviço espacial roda em sombra e concorda em 99,96% dos pontos; as divergências são pontos sobre arestas compartilhadas. A tolerância de toque fica desligada.
- **Viewport culling:** feições, não (498 paths não pesam); rótulos, sim (em zoom médio/próximo).
- **Feature state / dirty update / camadas / filtro / Recommendation / Comparison:** continuam vindo do `MapRenderModel` (Tópico 18); o mapa só aplica as diferenças. Uma geometria só; overlays são classes.
- **Rótulos/câmera/raster/workers:** ver os documentos de política. Workers não foram usados: o pipeline inteiro leva cerca de 17 ms (60 ms a 4×) e roda depois da primeira pintura; o round-trip não compensaria (§67).
- **Budgets/aparelhos/diagnóstico:** `MAP_PERFORMANCE_BUDGETS.md`, `MAP_PERFORMANCE_TEST_MATRIX.md`, `App.MapView.diagnostics()` (só dados técnicos, nada sai da aba).
- **Memória/cancelamento/multi-tenant/segurança:** `destroy()`; proteção de carga obsoleta (`createLoadGuard`); chaves `org/dev/versão`; resolução entre tenants recusada. Sem PII, sem envio a terceiros, nenhum evento de analytics por quadro.
- **Testes:** `tests/geo46.test.js`, com 18 testes. Paridade, funcional e benchmark no navegador estão descritos no relatório de baseline.

## Arquivos
Criados: `src/geo/{geometry,spatialIndex,hitTest,camera,perf,repository}.js`, `src/presentation/map46.css`, `tests/geo46.test.js` e 13 documentos `docs/MAP_*.md`, além deste relatório.
Alterado: `src/presentation/map.js` (arquivo deste tópico).

## Mudanças de comportamento (visíveis, deliberadas)
1. Trocar camada não anima mais a cor de mais de 60 lotes de uma vez (troca instantânea; seleção e mudanças pequenas mantêm a transição de 0,15 s).
2. Arrastar o mapa não seleciona mais o texto dos rótulos. Antes, a seleção podia transformar o arraste seguinte num arraste nativo de texto, e o mapa parava.

## Gargalos não resolvidos
- Zoom (wheel/pinch) a 4×: quadro p95 de 100 a 133 ms, porque cada passo de escala refaz o layout dos textos visíveis. Opção: transform CSS durante o gesto (decisão de UX).
- A latência restante de seleção e troca de camada está nos painéis (`app.js`/`panels.js`).
- Pirâmide do raster (MEDIUM/LOW) não existe; mobile carrega a planta inteira.
- Não houve teste em Safari/iOS nem em aparelhos reais.

## Decisões humanas
1. Aceitar a troca de camada sem animação (flag `bulkNoTransition`).
2. Ligar a tolerância de toque (`HitTestTolerancePolicy.fallbackEnabled`, hoje desligada).
3. Zoom por transform CSS durante o gesto.
4. Gerar níveis de raster no build (ferramenta e tamanhos) para o Tópico 47.
5. Retirar as flags `App.MapView.FLAGS` depois de validar em aparelhos.
6. `metersPerUnit` (escala) segue estimado: confirmar com o levantamento oficial.
