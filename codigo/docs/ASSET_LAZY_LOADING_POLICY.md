# Política de lazy loading de assets (Tópico 47)

- **Planta / aérea** (webp grandes): crítico apenas a camada visível; a outra carrega ao trocar a camada. A medição mostrou planta.webp baixada 3× (3,8 MB) — corrigido com dedup em `AssetCache.get` (mapa `inflight`). Bytes na primeira visita: 6,98 MB → 4,56 MB.
- **Fotos da galeria**: `imageAttrs({width,height})` → `loading="lazy" decoding="async" fetchpriority="low"` + dimensões explícitas.
- **Skeleton**: `App.loadingView.skeleton(kind)` com `aria-busy="true"` e status `polite`; sem valores falsos; respeita `prefers-reduced-motion` (`presentation/loading.css`).
- **Service Worker**: imagens CACHE_FIRST (fotos da galeria em runtime cache); ver CACHE_STRATEGY_MATRIX.md.
- Pendente: runtime cache de `/img/` não é versionado (decisão no tópico 49).
