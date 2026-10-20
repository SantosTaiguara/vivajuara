# Arquitetura do Service Worker

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

`sw.js` é gerado por `scripts/pwaBuild.js` a partir de `src/sw.template.js` e é modular (§323): classificador e resolvedor de política (`pwa/swRouting.js` embutido), tabela de rotas gerada do CachePolicyRegistry, módulo de pré-cache, leitura de pacote offline, atualização e diagnóstico (GET_VERSION). Nenhuma regra do tipo `if (url.includes('/availability')) cacheFirst()` escrita à mão (§16).

## Caches
| Cache | Dono | Conteúdo | Quando sai |
|---|---|---|---|
| ws-shell-<build> | worker | shell (index), offline.html, manifest, ícones, logo | ativação de um build novo |
| ws-img-1 | worker | galeria `img/*` por `?v=<checksum>` (máx. 60) | revisão diferente é podada na ativação |
| ws-runtime-v2 | worker | routes.json, img_list.json (rede primeiro) | revalidado a cada acesso online |
| ws-runtime-v1 | legado | cache sem versão do tópico 48 | **apagado** na ativação |
| ws-pack:<org>:<dev>:<tx>, ws-pack-index | app | pacote offline | só pelo OfflinePackManager |
| ws:<dev>:assets | app | planta/aérea por checksum (AssetCache) | nunca tocado pelo worker |
| IndexedDB ws-cache, ws-cache-l2, ws-pwa-queue | app | dados, cache L2, fila | nunca limpos por atualização (§211) |

## ServiceWorkerResourcePolicy (projeção gerada, §17)
| Rota | Tipo | Estratégia | Offline | Fonte offline | Versão exata | Classe |
|---|---|---|---|---|---|---|
| never-api | — | NO_STORE | não | NONE | não | RESTRICTED |
| mobility_routes | MOBILITY_ROUTES | NETWORK_FIRST | sim | RUNTIME_THEN_PACK | não | PUBLIC_SAFE |
| gallery_index | GALLERY_INDEX | NETWORK_FIRST | sim | RUNTIME_THEN_PACK | não | PUBLIC_SAFE |
| pricing_snapshot | PRICING_SNAPSHOT | NETWORK_ONLY | sim | DATA_LAYER | não | PUBLIC_SAFE |
| map_bootstrap | MAP_BOOTSTRAP | NETWORK_ONLY | sim | DATA_LAYER | não | PUBLIC_SAFE |
| geometry_bundle | GEOMETRY_BUNDLE | NETWORK_ONLY | sim | DATA_LAYER | sim | PUBLIC_SAFE |
| technical_analysis_input | TECHNICAL_ANALYSIS_INPUT | NETWORK_ONLY | sim | PACK | sim | PUBLIC_SAFE |
| images | GALLERY_IMAGE | CACHE_FIRST | sim | PACK | sim | PUBLIC_SAFE |
| other-json | — | NETWORK_ONLY | não | NONE | não | RESTRICTED |

- Preço, ponteiros de versão e geometria: NETWORK_ONLY no worker; a última cópia fica no IndexedDB com o rótulo de frescor (DATA_LAYER).
- Entrada de análise técnica, mapas base e galeria: versão exata do pacote offline quando a rede falha (PACK), com cabeçalhos `x-ws-offline-pack` e `x-ws-resource-version`.

## Ciclo de vida
- **install**: pré-cache; entradas obrigatórias (shell, offline.html) que falham fazem a instalação falhar e o worker anterior continua. Sem `skipWaiting()`.
- **activate**: apaga só caches próprios obsoletos, poda imagens de revisão antiga, habilita navigation preload (opcional), `clients.claim()`.
- **message**: `SKIP_WAITING` (enviado pela página após o usuário aceitar), `GET_VERSION` (serviceWorkerBuildId, cacheSchemaVersion, offlinePackSchemaVersion, apiCompatibilityVersion, queueSchemaVersion).
- **sync** (Background Sync, opcional): só acorda o app (`SYNC_REQUESTED`); o worker nunca reenvia mutações.

## Desempenho (§254–§257)
Requisições que o worker não trata (API, POST, outras origens, no-store, dados NETWORK_ONLY sem fallback) não recebem `respondWith`: zero custo extra online. Matchers são RegExp pré-compiladas.
