# Arquitetura de cache (Tópico 48)

Módulos: `src/cache/cacheCore.js` (`App.cache.core`, puro: chaves, políticas, frescor, invalidação, taxonomia) e `src/cache/cacheManager.js` (`App.cache.manager`: L1 memória, L2 IndexedDB `ws-cache-l2`, coerência entre abas, manutenção). O Service Worker (`src/sw.template.js`) recebe as regras geradas da mesma taxonomia (`scripts/cacheRules.js`).

## Camadas físicas (`CacheTaxonomy`, 12 entradas)
| Cache | Conteúdo | Persistente | Dono |
|---|---|---|---|
| L1 memória (MemoryCacheStore, LRU) | qualquer recurso permitido; MEMORY_ONLY | não | CacheManager |
| L2 IndexedDB `ws-cache-l2` | públicos versionados, envelope com checksum | sim | CacheManager |
| IndexedDB `ws-cache` v1 (6 stores) | dados offline legados | sim | data/offline.js (inalterado) |
| Cache Storage `ws-shell-<versão>` | shell + precache | sim | SW |
| Cache Storage `ws-runtime-v1` | routes/img_list, fotos /img/ | sim | SW |
| Cache Storage de assets | planta/aérea por checksum | sim | AssetCache |
| DataCache (lifecycle.js) | derivados em memória | não | lifecycle |
| HTTP cache do navegador | conforme headers do host | — | navegador |

**Nunca cacheado** (`NEVER_CACHED`): tokens/credenciais, headers Authorization, dados de cliente/proposta em disco, links de share privados em disco, auditoria, qualquer resposta `no-store/private`.

## Fluxo
`LoadCoordinator.request` → `CacheManager.load(cacheKey, loader, policy)` → L1 → L2 (verifica checksum/schema) → `readDecision` (HIT / STALE_REVALIDATE / MISS) → loader com ETag → stage→commit → broadcast de metadados.
