# Reuso de módulos e invalidação (Tópico 35)

`moduleGraph()` deriva o `AnalysisModuleGraph` do próprio pipeline do engine (`App.intelligence.MODULES`): 14 nós, arestas por `requires/produces`, DAG verificado (`CYCLE`), checksum.

| Módulo | Escopo | Lê | Depende de |
|---|---|---|---|
| geometry, location, mobility, environmental, surroundings | ENTITY_LOCAL | seção da entrada (+ metrics.* da metodologia) | — |
| criteria | ENTITY_LOCAL | notas (config criteria, lotAdjustments, confidence) | 5 módulos base |
| levels, scoring, overall, profiles, alerts, highlights | ENTITY_LOCAL | config da seção | criteria / scoring / … |
| classification, ranking | **CROSS_ENTITY** | conjunto inteiro | overall / scoring |

`repository.plan(def, snapshot, { previousVersionId, forceRebuild })` compara `computationKey` com os `AnalysisModuleResultSet` (VALID) da versão anterior: REUSE ou RECOMPUTE com motivos INPUT_CHANGED, METHODOLOGY_CHANGED, MODULE_VERSION_CHANGED, UPSTREAM_CHANGED, NO_REUSABLE_RESULT, FORCED_REBUILD. O planner não executa nada.

Exemplo testado: muda só `location.distanceToParkingM` de um lote → geometry, mobility, environmental, surroundings reutilizados; location recalculado (INPUT_CHANGED) e tudo a jusante (UPSTREAM_CHANGED), inclusive ranking (cross-entity).

Execução: o engine roda o pipeline inteiro (≈0,5 s para 498 lotes); o reuso é registrado no nível de artefato — a nova versão referencia o module result set antigo, e o runner confere que a saída recalculada tem o mesmo checksum (`DETERMINISM_MISMATCH` caso contrário). Recalcular só alguns lotes de um módulo local fica preparado (escopo marcado), não implementado: o engine atual não executa módulos isolados. A invalidação a jusante é conservadora (usa a chave do módulo de cima, não a saída).

`refreshPlan(versionId, fontesAtuais, def)` → módulos afetados, reutilizáveis e ação recomendada (NO_ACTION / RECOMPUTE / REVIEW); nunca recalcula nem publica sozinho.
