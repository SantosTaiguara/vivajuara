# Arquitetura de carregamento progressivo (Tópico 47)

> Lazy loading decide **QUANDO** carregar. O cache (Tópico 48) decide **DE ONDE reutilizar e por quanto tempo**. O PWA/offline (Tópico 49) decide **o que fica preparado offline**. Nenhum deles é autorização.

## Princípio
Planejar explicitamente o caminho crítico e adiar somente o que não é necessário para a próxima decisão do usuário — sem "carregar tudo depois" e sem "centenas de requests".

## Contexto real da plataforma
A página publicada é um **artefato estático de página única**: `index.html` (HTML + CSS + todo o JS inline, ~2,3–2,4 MB, 86–87 módulos) e arquivos JSON/imagens ao lado (`manifest.json`, `lots.json`, `commercial.json`, `routes.json`, `img_list.json`, `analysis-input.json`, `planta.webp`, `aerea.webp`, `img/*`). Não há backend no artefato publicado; Customer/Journey vivem só em memória.

## Peças (todas puras, sem rede, exceto onde indicado)
| Peça | Arquivo | Papel |
|---|---|---|
| `LoadResourceType`, `ResourceKey`, `serializeResourceKey` | `src/loading/resources.js` | identidade semântica (tenant obrigatório, versão concreta, URL não é identidade) |
| `ResourceRegistry` / `LoadResourceDescriptor` | `src/loading/resources.js` | criticidade, prioridade, gatilho, dependências, classe de segurança, loader, URL resolvida |
| `ResourceDependencyGraph` | `src/loading/resources.js` | DAG, detecção de ciclos, níveis paralelos |
| `LoadPlanner.buildPlan` | `src/loading/planner.js` | planos por contexto (MAP_ROUTE frio/quente, LOT_SELECTION, COMPARISON, CUSTOMER, PRESENTATION, SHARE, ANALYTICS) |
| `LoadCoordinator`, `LoadScheduler`, `InFlightResourceRegistry`, `LoadScopeRegistry`, `ResourceStateRegistry` | `src/loading/coordinator.js` | executor único: dedup, cancelamento, proteção contra resposta antiga, prioridade, retry limitado, diagnóstico |
| `MapReadiness`, `loadProgress` | `src/loading/planner.js` | prontidão progressiva e capacidades do mapa |
| `PrefetchIntentService`, `prefetchDecision` | `src/loading/planner.js` | prefetch por intenção com Save-Data/conexão lenta/orçamento |
| `imageAttrs`, `BUDGETS`, `analyzeBundle`, `checkBudget` | `src/loading/planner.js` | política de imagens e orçamento de bundle (CI) |
| `App.loadingView` | `src/loading/loadingView.js` + `src/presentation/loading.css` | skeletons e mensagens locais acessíveis |
| fiação real | `src/data/offline.js` | 1ª visita em paralelo, sync de boot sem duplicar, dedup de download de imagem |

## Fluxo
```
Rota / intenção → LoadPlanner → LoadPlan → LoadCoordinator → Scheduler (IMMEDIATE/HIGH | NORMAL/LOW | IDLE)
   → loader (dedup em voo, cancelamento, retry, validação de versão, proteção contra resposta antiga)
   → CacheManager (Tópico 48, opcional) → ResourceStateRegistry → UI progressiva
```

## O que mudou no comportamento publicado
1. Primeira visita: `manifest.json`, `lots.json` e `commercial.json` saem **juntos** (antes: cascata manifest → lots → commercial).
2. A sincronização de boot logo após uma 1ª visita confirmada **reaproveita** o resultado (antes: manifest e commercial pedidos 2×).
3. `planta.webp` (1,26 MB) baixa **uma vez** (antes: 3 downloads simultâneos sem dedup).
Medições: `LAZY_LOADING_BASELINE_REPORT.md`.

## O que não mudou
Identidade, geometria, scores, classes, metodologia, preços (R$ 1.196/m², tabela 2026-10-06), regras financeiras/solares, disponibilidade (498 lotes UNKNOWN), semântica de deep link e eventos.
