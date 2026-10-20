# Relatório — Tópico 47: Lazy loading / carregamento progressivo

## Entregue
- `src/loading/resources.js`: ResourceKey (tenant obrigatório, sem "current", URL não é identidade), ResourceRegistry com os recursos reais, DAG com detecção de ciclo, compatibilidade de versões, FAILURE_POLICY, FEATURE_MODULES, inventário do legado.
- `src/loading/coordinator.js`: LoadCoordinator (nunca lança), dedup in-flight com refcount, scheduler high/normal/idle com preempção, escopos e cancelamento, proteção contra resultado obsoleto, retry limitado (sem 401/403; 404 versionado → ponteiro 1×), troca de tenant.
- `src/loading/planner.js`: buildPlan em 8 contextos, MapReadiness, loadProgress, PrefetchIntentService, imageAttrs, orçamentos e analyzeBundle.
- `src/loading/loadingView.js` + `src/presentation/loading.css`: skeleton acessível e status de recurso com retry (UI pura).
- Ligação mínima em `src/data/offline.js`: primeira visita em paralelo (manifest ‖ lots ‖ commercial, checksums ainda verificados), reuso no boot (< 30 s, versões iguais, preço confirmado), dedup de assets.

## Medição (Playwright, mediana de 3)
fast cold 1772 → **1355 ms** (−24%); fast warm 1435 → **1076 ms**; slow4g warm 6589 → **4482 ms** (−32%); slow4g cold 21245 → 20836 ms (limitado pelo HTML inline de ~2,45 MB). Requisições cold 15 → 10; JSON 5 → 3; planta.webp 3 → 1 download. Detalhes: LAZY_LOADING_BASELINE_REPORT.md.

## Invariantes
Nenhum dado inventado; preço nunca sem rótulo de frescor; UNKNOWN nunca vira AVAILABLE; null ≠ 0; lotes/geometria/scores/preços inalterados; paridade de cores t18 = 0.

## Testes
`tests/lazyload.test.js`: 27 testes.

## Decisões humanas
1. Code splitting físico (servir .js além de index.html) — maior ganho em 4G.
2. Compressão gzip/brotli no host (HTML 2,45 MB → ~0,63 MB).
3. Publicar um índice de mapa separado de lots.json (70 campos/lote).
4. Integração do analysis-input.json e da galeria no app.js (receita entregue ao integrador).
