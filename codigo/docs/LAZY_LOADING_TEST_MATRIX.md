# Matriz de testes — lazy loading (Tópico 47)

Arquivo: `tests/lazyload.test.js` (27 testes).

| Área | Testes |
|---|---|
| ResourceKey | tenant obrigatório, sem "current", URL não é identidade, serialização canônica `rk1|` |
| Registry/DAG | descritores reais, ciclo detectado, níveis paralelos |
| Planos | cold, warm, deep link, seções, comparação, cliente, apresentação, share (proibidos) |
| Coordinator | dedup, seleção rápida, proteção de obsoleto, troca de camada, preempção/ordem, retry (403/404/5xx), troca de tenant, versão incompatível, opcional falhando, execute paralelo |
| Readiness/Prefetch | capacidades, Save-Data, conexão lenta, restritos |
| UI pura | skeleton acessível, `resourceStatus`, `imageAttrs` |
| Budget | `analyzeBundle`, `checkBudget` |
| Wiring offline.js | primeira visita paralela, reuso no boot, dedup de asset (cachesApi falso) |
| Inventário | legado catalogado |

Medição de ponta a ponta: Playwright (ver LAZY_LOADING_BASELINE_REPORT.md).
