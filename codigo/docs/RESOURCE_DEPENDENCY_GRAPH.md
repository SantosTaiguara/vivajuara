# Grafo de dependências de recursos (Tópico 47)

`ResourceDependencyGraph(descriptors)` (`src/loading/resources.js`):
- nós = chaves serializadas; arestas = `descriptor.dependencies` (uma dependência sem versão casa com o nó do mesmo tipo);
- `cycles()` lista ciclos (teste: o registro real não tem nenhum; um ciclo sintético é detectado);
- `missing()` lista dependências inexistentes (teste: nenhuma);
- `levels(subset)` devolve **níveis paralelos** — recursos de um mesmo nível começam juntos; lança `DEPENDENCY_CYCLE` se houver ciclo.

## Grafo do mapa (real)
```
ORGANIZATION_CONTEXT
  └─ DEVELOPMENT_CONFIG (embutido)
       ├─ MAP_BOOTSTRAP (manifest.json) ── AVAILABILITY_SNAPSHOT (se anunciado)
       ├─ GEOMETRY_BUNDLE (lots.json) ── LOT_QUICK_VIEW, LOT_DETAIL_SECTION, SEARCH_INDEX, TECHNICAL_ANALYSIS_INPUT
       └─ PRICING_SNAPSHOT (commercial.json) ── LOT_QUICK_VIEW, LOT_PRICE_HISTORY, FINANCIAL_SIMULATION_RESULT
BASE_MAP_MEDIUM / BASE_MAP_HIGH: sem dependência (podem chegar depois da geometria)
```
`GEOMETRY_BUNDLE` **não** depende de `MAP_BOOTSTRAP` para ser pedido — só para ser validado (versão/checksum). Por isso o plano frio tem os três documentos em **um único nível** (teste `LazyMapColdBoot`). Antes, o código fazia manifest → lots → commercial em sequência; agora `JsonRemote.prefetch()` dispara lots e commercial junto com o manifest e a validação continua na mesma ordem.

## Evitar cascata artificial
`LoadCoordinator.execute(plan)` inicia cada recurso assim que **as suas** dependências terminam (não nível a nível): teste `execute(plan)` comprova os três pedidos em voo antes de qualquer resposta.
