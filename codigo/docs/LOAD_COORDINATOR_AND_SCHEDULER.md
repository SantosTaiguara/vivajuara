# LoadCoordinator e LoadScheduler (Tópico 47)

Módulo: `src/loading/coordinator.js` (`App.loading.coordinator`).

## Componentes
- **LoadCoordinator**({organizationId, developmentId, loaders, cache, budget, retry, hooks, sleep}) — ponto único de carregamento. `request(descriptor, {scope, trigger})` **nunca lança**: devolve `ResourceLoadResult {status: OK|STALE|ERROR|CANCELLED|FORBIDDEN, value, freshness, error}`.
- **InFlightResourceRegistry** — deduplicação por `serializeResourceKey`; contagem de referências; a requisição de rede só é abortada quando o último interessado cancela.
- **LoadScheduler**(budget) — filas `high` / `normal` / `idle` com limites (`DEFAULT_BUDGET`: 6 high, 3 normal, 1 especulativo, 40 na fila). Ao saturar, especulativos são descartados primeiro (preempção).
- **LoadScopeRegistry** — escopos (rota, painel do lote, popover). `replace(scope)` incrementa a revisão; resultados de revisões antigas são descartados.
- **ResourceStateRegistry** — estado por chave para diagnóstico (`diagnostics()`).
- `execute(descriptors)` — executa os níveis do DAG em paralelo; recursos opcionais que falham não derrubam o plano.
- `switchContext(org, dev)` — cancela tudo do contexto anterior (troca de tenant/empreendimento).

## Integração com cache
Quando `cache` (CacheManager) é fornecido: `cache.load(cacheKey, args => loader({etag,lastModified}), policy)` — o coordenador não conhece estratégia de cache; o CacheManager decide HIT/STALE/revalidação.

## Telemetria
`hooks.telemetry(evt)` recebe apenas metadados (tipo, status, duração, bytes) — nunca valores, IDs de cliente ou URLs com parâmetros.
