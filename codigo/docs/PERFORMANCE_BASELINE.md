# Baseline de performance

Não se define orçamento sem baseline (tópico 54 §84). Os números abaixo já foram medidos nos tópicos 46 e 47, com ferramenta e ambiente registrados; este documento os consolida como `PerformanceBaseline` da migração.

| Métrica | Valor de referência | Ambiente | Fonte |
|---|---|---|---|
| Interativo (mapa com lotes e cores), frio | 2.167 ms, 15 requisições, 6,98 MB | Playwright + Chromium, 1400×900, sem limitação | `LAZY_LOADING_BASELINE_REPORT.md` |
| Interativo, frio, 4G lento + CPU 4× | 20.816 ms | idem, ≈1,6 Mbps, 150 ms RTT | idem |
| Interativo, quente (SW + IndexedDB) | 1.520 ms (fast) · 5.766 ms (slow4g) | idem | idem |
| Troca de camada até o próximo quadro | p50 27 ms · p95 34 ms (1×); p50 95 ms · p95 147 ms (4×) | 1400 px | `MAP_PERFORMANCE_BASELINE_REPORT.md` |
| Clique → destaque `.sel` | p50 32 ms · p95 49 ms (1×); p50 162 ms · p95 260 ms (4×) | idem | idem |
| Hit test | nativo p95 0,1 ms (1×) / ~1 ms (4×); serviço espacial p95 0,3–0,5 ms | idem | idem |
| Marcas técnicas | `map_first_render` 19–21 ms (1×) / 120–143 ms (4×); `map_geometry_decode` 14–33 / 57–60 ms; `map_index_build` 2–3 / 10–13 ms; `map_layer_switch` 4–8 / 20 ms | `geo/perf.js` | idem |
| Captura do golden (Node, 13 categorias) | ≈1,6 s | harness Node local | `scripts/goldenBaseline.js` |

```ts
interface PerformanceBaseline { metric: string; value: number; unit: 'ms'|'MB'|'req'; percentile?: 'p50'|'p95'; environment: string; appVersion: string; measuredAt: string; sourceRef: string; }
interface RegressionBudget { metric: string; baseline: number; maxRegressionPct: number; action: 'BLOCK'|'REVIEW'; }
```

## Orçamentos propostos (a aprovar)

| Métrica | Máx. regressão | Ação |
|---|---|---|
| Clique → destaque p95 | +10% | BLOCK (CAP-03 P0) |
| Troca de camada p95 | +15% | REVIEW |
| Interativo frio (fast) | +10% | REVIEW |
| Hit test p95 | +100% (ainda < 1 ms) | REVIEW |

Comparar sempre no mesmo ambiente e com a versão do baseline registrada; máquinas diferentes não se comparam.
