# Carregamento progressivo dos dados do lote (Tópico 47)

Camadas por lote:
1. **Índice do mapa** (`mapLotIndex`): id, quadra, número, código de exibição, classe — o mínimo para desenhar e buscar.
2. **Quick view**: área, preço (com rótulo), score/classe — vem de lots.json + commercial.json já carregados.
3. **Detalhe técnico** ("Como o score foi calculado"): analysis-input.json, **sob demanda**, com skeleton `App.loadingView.skeleton('technical')`.
4. **Imagens**: lazy (`loading="lazy"`, `decoding="async"`, width/height para evitar CLS) via `imageAttrs`.

Regras: valor ausente aparece como "não disponível", nunca 0; preço usa `App.cache.core.priceDisplay` (rótulo obrigatório quando não confirmado); disponibilidade usa `availabilityDisplay` (UNKNOWN → "Status não confirmado").

Decisão pendente: dividir lots.json (70 campos por lote) num arquivo de índice publicado separadamente reduziria o crítico, mas altera os arquivos do artefato estático — ver RELATORIO_TOPICO_47.md.
