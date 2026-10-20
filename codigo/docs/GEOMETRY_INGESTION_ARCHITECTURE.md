# Arquitetura de ingestão de geometria

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `describeSource`: CRS declarado ≠ verificado → `UNKNOWN` (revisão); raster/BASE_MAP → `GEOMETRY_RASTER_NOT_GEOMETRY`.
- `validateFeatures`: BLOCKING para polígono vazio, coordenada não finita, anel inválido, área zero, autointerseção, geometria duplicada; ERROR para sobreposição (índice espacial); WARNING fora dos limites esperados.
- `matchFeatures`: por quadra/lote, ID de origem ou espacial; só vínculos determinísticos de alta confiança são aprovados automaticamente; o resto vai para revisão.
- `repairRecord`: reparo é registro separado (checksum de origem e reparado); a geometria de origem nunca é alterada.
- `buildArtifacts`: manifesto via `geo.geometry.buildBundle`, CRS `PIXEL_SPACE` para a planta de Viva Juara, índice espacial e `MapLotIndex`.
- **Nunca se fabrica WGS84**: coordenada de planta continua `PIXEL_SPACE`, sem `epsgCode`.
