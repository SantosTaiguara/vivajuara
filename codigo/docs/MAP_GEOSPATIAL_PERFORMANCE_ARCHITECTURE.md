# Arquitetura de performance geoespacial do mapa (Tópico 46)

## Renderer atual (inventário)
- **Renderer:** SVG puro (`presentation/map.js`, `App.MapView`), sem biblioteca de mapas, sem Canvas/WebGL.
- **Geometria:** `Lot.geometry.polygon` (498 lotes, 3.652 vértices, ~7,3 por lote; anel fechado), carregada de `lots.json` pela camada de dados. Centróide e bbox (`geometry.centroid`, `geometry.bounds`) já vêm pré-calculados pelo adapter legado (`data/legacyAdapter.js → polygonStats`).
- **Coordenadas:** pixels da planta oficial rasterizada (2247 × 1587), y para baixo. `metersPerUnit = 0,4846` (estimado, de `config/developments.js`). Não há EPSG nem georreferenciamento: o descritor diz `PIXEL_SPACE` e não inventa WGS84.
- **Transformações:** planta → SVG = identidade (a imagem é desenhada em 0,0 com o próprio tamanho); SVG → tela = `viewBox` (`preserveAspectRatio` padrão, xMidYMid meet) + translação do grupo de câmera `#gCam` durante o arraste.
- **DOM:** 1.587 nós SVG: 498 `path.lot`, 1.040 `text` (número e área por lote + letras de quadra + POIs), 27 POIs, 2 `image`.

## Camadas (spec §5/§150)
```
Lot.geometry.polygon (CANÔNICA, intocada)
   └─ geo/geometry.js  → validação, bbox, centróide, âncora de rótulo, LOD (derivado), adjacência, manifest/bundle
        └─ geo/spatialIndex.js → R-tree estática empacotada (STR)
             ├─ geo/hitTest.js  → MapHitTestService (sombra do hit nativo), tolerância, classificador de gestos
             └─ geo/camera.js   → câmera mundo↔tela, consulta de viewport, política de rótulos/zoom semântico
   geo/perf.js       → budgets, marcas técnicas, observador de long tasks, MapDiagnostics
   geo/repository.js → MapGeometryRepository (FullBundle), chaves multi-tenant, proteção de carga obsoleta, BaseMapAsset, contrato do RendererAdapter
presentation/map.js → adapter SVG: geometria estática, estado dinâmico (fill/classes/aria), rótulos, câmera, interação
```

## Separações exigidas (§157)
| Conceito | Onde vive | Muda com |
|---|---|---|
| Geometria canônica | `Lot.geometry.polygon` | nova versão estática dos dados |
| Geometria de render | `pathData` (0,1 unidade, igual ao `d` de sempre) | `renderGeometryVersion` |
| Índice espacial | `App.geo.spatialIndex` | versão de render |
| Estado de feição | classes `sel/cmp/rec/rev/dim/...` aplicadas pelo `MapRenderModel` (Tópico 18) | seleção, filtro, comparação, recomendação |
| Valor de camada / estilo | `fill` resolvido em `map/layers.js` | troca de camada, dados |
| Rótulo | `#gLbl` (CSS por `data-z`) + culling fora do viewport | zoom/câmera |
| Câmera | `vb` lógico + `viewBox` confirmado + `translate` em `#gCam` | gesto/programa |
| Raster base | `#gBg` (planta/aérea) | troca de fundo |
| Interação | hit nativo do navegador (alvo do evento); serviço espacial em sombra | ponteiro |
| Métrica espacial analítica | motor de inteligência (inalterado) | metodologia |

## O que mudou no runtime (medido, ver MAP_PERFORMANCE_BASELINE_REPORT.md)
1. **Pan por translação:** gravar `viewBox` faz o Chrome refazer o layout de todos os textos SVG (≈25 ms por movimento no zoom próximo, ≈80 ms com CPU 4× mais lenta); transladar `#gCam` custa ≈0,2 ms. O `viewBox` é gravado quando a escala muda, 350 ms após o fim do arraste e antes de qualquer clique (o hit-test do clique é sempre sobre o mesmo `viewBox` de antes).
2. **Uma escrita de câmera por quadro** (pointermove/wheel/pinch coalescidos em `requestAnimationFrame`) e **sem leitura de layout nos handlers** (retângulos em cache, invalidados por ResizeObserver, resize, scroll e início de cada gesto).
3. **Culling de rótulos** fora do viewport com margem (60%) em zoom médio/próximo.
4. **Troca de camada sem 498 transições simultâneas** (classe `bulk` por dois quadros quando mais de 60 lotes mudam de cor).
5. **Ordem Z sem movimentos inúteis:** o passe de ordem só move nós quando a cauda do grupo não está na ordem final (resultado idêntico).
6. **Sem seleção de texto ao arrastar** (`selectstart` cancelado no SVG). Um rótulo selecionado transformava o próximo arraste num arraste nativo de texto (`pointercancel`); a translação deixou isso visível.
7. **Pipeline geoespacial depois da primeira pintura** (`setTimeout 0`): o mapa fica `INTERACTIVE` antes; o índice chega em `FULLY_ENHANCED`. Falha no pipeline não derruba o mapa.

## O que não mudou (delta semântico zero)
IDs, geometria, cores (`t18.js` TOTAL DIFF 0), classes, aria-labels, ordem Z do DOM, lote selecionado por clique (20.152 + 13.539 pontos testados), rótulos visíveis, popups de POI por clique e teclado, filtros, Recommendation, Comparison, preços e disponibilidade.
