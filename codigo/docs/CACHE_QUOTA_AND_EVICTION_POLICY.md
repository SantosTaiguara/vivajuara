# Quota e despejo (Tópico 48)

- `DEFAULT_BUDGET`: 50 MB no total; por tipo: BASE_MAP_HIGH 8 MB, GALLERY_IMAGE 10 MB, TECHNICAL_ANALYSIS_INPUT 2 MB; marca alta 90 %, baixa 70 %.
- `sizeOf(value)` estima bytes (exato para Blob/ArrayBuffer); `quotaEstimate()` usa `navigator.storage.estimate()` quando existe.
- `evictionCandidates(entries)` calcula um score: versão não atual (+4), prefetch nunca usado (+6), `evictionPriority` HIGH (+3, ex.: aérea, fotos), idade e tamanho somam; classe de retenção pesa contra. Entradas fixadas (`pin`) e chaves ativas na tela ficam fora. A versão **atual** de geometria/índice (LONG_LIVED_VERSIONED) é último recurso (−20), para o offline continuar funcionando.
- `evictToLowWatermark()` roda em `maintenance('QUOTA_PRESSURE'|'IDLE')`.
