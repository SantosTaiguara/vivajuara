# Matriz de estratégias (Tópico 48)

| Estratégia | Leitura | Rede | Escrita | Recursos |
|---|---|---|---|---|
| IMMUTABLE_VERSIONED | HIT se versão/checksum batem | só em MISS | stage→commit | geometria, bootstrap, planta/aérea, analysis-input |
| NETWORK_FIRST | rede; offline → cópia STALE rotulada | sempre | após validar | preço, manifest, disponibilidade |
| SWR | devolve cópia e revalida em segundo plano | background | após 200 | routes, img_list |
| MEMORY_ONLY | L1 | conforme loader | só memória | cliente, share, quick view |
| NETWORK_ONLY | — | sempre | nunca | /api/ futuro |
| NO_CACHE | — | sempre | nunca; purga se encontrado | tokens, tipos desconhecidos |

## Service Worker (gerado por `scripts/cacheRules.js`)
| Regra | Padrão | Estratégia SW |
|---|---|---|
| never-api | `/api/` | BYPASS |
| images | webp/png/jpg/svg/woff | CACHE_FIRST (fotos `/img/` em runtime) |
| static-json | routes.json, img_list.json | NETWORK_FIRST |
| data-json | demais `.json` | NETWORK_ONLY (offline pela camada de dados) |
Navegação: NETWORK_FIRST com shell offline. Requisições com Authorization ou `no-store` e respostas não-OK/opacas/`private` nunca são guardadas.
