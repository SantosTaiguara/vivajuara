# Raster base (Tópico 46 §60–§65)

- `App.geo.repository.baseMapAssets(dev)` descreve `OFFICIAL_PLAN` e `AERIAL`: `assetVersion = staticDataVersion`, 2247 × 1587, `alignmentTransformRef = plan-to-svg@1.0.0` (identidade versionada; nada de ajuste espalhado em CSS).
- Níveis: `HIGH` disponível (o arquivo atual); `MEDIUM`/`LOW` **não disponível**. Gerar a pirâmide é tarefa de build (decisão humana: ferramenta e tamanhos); quando e qual nível carregar é do Tópico 47 (lazy loading), cache do Tópico 48.
- Hoje a planta entra como `<image>` SVG via o cache de assets (`offline.js`), sem mudança neste tópico. Falha de raster não derruba geometria (`onBackgroundError` → aviso; lotes navegáveis).
- `createImageBitmap`/decodificação assíncrona: não aplicável ao `<image>` SVG; fica para um renderer Canvas.
- Mobile: não carregar a resolução máxima automaticamente depende dos níveis acima, que ainda não existem (pendência registrada).
