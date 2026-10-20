# LoadPlan e LoadPlanner (Tópico 47)

Módulo: `src/loading/planner.js` (`App.loading.planner`). Puro, sem DOM, sem rede.

## Contrato
`buildPlan({context, organizationId, developmentId, manifest, structuralCached, backgroundLayer, lotId, openSection, presentationStep, candidateIds, customerId, share, saveData, now})` → `LoadPlan` (puro: monta, não carrega):

| Campo | Significado |
|---|---|
| `context` | APP_BOOT, MAP_ROUTE, LOT_SELECTION, COMPARISON_ROUTE, CUSTOMER_ROUTE, PRESENTATION_ROUTE, SHARE_ROUTE, ANALYTICS_ROUTE |
| `required[]` | ResourceKeys necessárias para os `readinessTargets` |
| `deferred[]` | carregadas depois do interativo (manifest/preço no warm, análise, imagens) |
| `speculative[]` | prefetch; zerado com `saveData` |
| `readinessTargets[]` | níveis de MapReadiness que o plano atende |
| `notes[]` | explicação legível da decisão |

## Regras
1. **Cold MAP_ROUTE** exige `MAP_BOOTSTRAP`, `GEOMETRY_BUNDLE` (versão = `staticVersion+analysisVersion`) e `PRICING_SNAPSHOT`. Preço é crítico porque o painel do lote não pode exibir preço sem rótulo de frescor.
2. **Warm MAP_ROUTE** (`structuralCached`) exige apenas a geometria do cache versionado; manifest e preço vão para `deferred` e são revalidados após INTERACTIVE (NETWORK_FIRST). Enquanto não confirmado, o preço aparece com o rótulo "necessita confirmação" — nunca como confirmado.
3. Criticidade ≠ prioridade: um recurso pode ser crítico com prioridade `normal` (ex.: preço) e um não crítico pode ter prioridade `high` por intenção do usuário (clique).
4. Disponibilidade: o plano nunca a transforma em AVAILABLE. Sem feed, o estado permanece `UNKNOWN` ("Status não confirmado").
5. SHARE_ROUTE: `SHARE_FORBIDDEN` (cliente, jornada, recomendação, analytics, documentos, permissões) — o planner lança `SHARE_SCOPE` em vez de incluir silenciosamente.
6. `descriptorsOf(plan)` achata o plano para o `LoadCoordinator.execute`.

## Orçamentos
`BUDGETS.MAP_ROUTE`: JS inicial ≤ 2,6 MB (bruto, inline), dados críticos ≤ 760 KB, ≤ 3 requisições de dados até o interativo, 0 requisições duplicadas. `analyzeBundle(html)` + `checkBudget()` são usados no teste e no relatório de linha de base.
