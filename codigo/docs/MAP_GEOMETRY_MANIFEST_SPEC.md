# GeometryManifest e GeometryBundle (Tópico 46 §7–§11, §31–§33)

Gerado por `App.geo.geometry.buildBundle({ organizationId, developmentId, dev, lots, sourceGeometryVersion })`, a partir dos lotes já carregados (não faz fetch).

## GeometryManifest
| Campo | Valor no Viva Juara | Observação |
|---|---|---|
| organizationId | `house7` (`dev.tenantId`) | chave multi-tenant |
| developmentId | `viva-juara` | |
| sourceGeometryVersion | `2026-10-06.1` (`staticDataVersion`) | versão da fonte canônica |
| renderGeometryVersion | `2026-10-06.1+quantize-0.1@1.0.0` | muda se o algoritmo de render mudar, sem mudar a fonte |
| coordinateReference | `{ type: PIXEL_SPACE, units: PIXEL, metersPerUnit: 0.4846 (estimado), epsgCode: undefined }` | nunca finge WGS84 |
| transform | `plan-to-svg@1.0.0`, IDENTITY | alinhamento versionado |
| featureCount | 498 | |
| developmentBounds | `{0,0,2247,1587}` | |
| lodLevels | LOD0 (tol 1,5), LOD1 (0,5), LOD2 (fidelidade total) | `lodPolicy.enabled = false` |
| spatialIndexVersion | `str-rtree@1.0.0` | |
| labelAnchorAlgorithm | `centroid-if-inside-else-polylabel@1.0.0` | |
| sourceChecksum / renderChecksum | FNV-1a 32 bits hex | determinísticos; não são hash de segurança |
| generatedAt | `null` no cliente | preenchido pelo pipeline de build quando existir |

## Feature (LotGeometryFeature + RenderGeometryFeature)
`{ featureIndex, lotId, geometryState: VALID|MISSING|INVALID|CONFLICTED, ring, bbox{minX,minY,maxX,maxY}, centroid, labelAnchor, labelAnchorSource, canonicalAreaUnits2, canonicalGeometryRef: "lot:<id>#geometry.polygon", pathData, sourceKey }`
- `featureIndex` é interno (posição no array); nunca é ID persistente. Todo hit carrega o `lotId` canônico.
- `pathData` é byte a byte o `d` que o mapa sempre desenhou (`toFixed(1)`), verificado nos testes.
- Lote sem polígono: `MISSING`, `ring: null`; nenhum polígono é inventado. Coordenada não finita: `INVALID`.

## Formato físico
Continua JSON (dentro de `lots.json`). Medido: montar o bundle leva ≈17 ms (desktop) / ≈44–52 ms (CPU 4×), fora do caminho crítico (depois da primeira pintura). Não há gargalo de rede/parse que justifique binário, TopoJSON ou MVT.

## Chaves para os Tópicos 47/48
`App.geo.repository.keyOf(org, dev, renderGeometryVersion)` → `house7/viva-juara/2026-10-06.1+quantize-0.1@1.0.0`. Manifest, bundle, índice e níveis de raster podem ser cacheados por essa chave mais `renderChecksum`.
