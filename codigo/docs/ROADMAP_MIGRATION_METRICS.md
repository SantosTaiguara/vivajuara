# Métricas de migração

"% concluído" sozinho engana. O indicador principal é **capacidades migradas com segurança**.

```ts
interface MigrationHealth {
  criticalCapabilitiesMigrated: number;  // P0 em NEW_ONLY com golden igual
  criticalCapabilitiesTotal: number;
  openCriticalRegressions: number;
  openMajorRegressions: number;
  parityMismatchCount: number;           // diferenças no golden sem exceção
  legacyFallbackRate?: number;           // só quando houver fallback contado
  securityBlockers: number;
}
```

## Valores de hoje (2026-10-12, medidos do código)

| Métrica | Valor | Fonte |
|---|---|---|
| Capacidades P0 | 14 (todas NEW_ONLY no cliente) | `config/governance/capabilities.json` |
| Capacidades P1 / P2 | 14 / 1 | idem |
| Diferenças no golden | 0 | `tests/preservation54.test.js` |
| Exceções de paridade | 0 | `capabilities.json` `parityExceptions` |
| Paridade de cor do mapa | 0 | t18 |
| Violações de arquitetura conhecidas | 23 (ratchet; nenhuma nova) | `config/governance/architecture.json` `knownViolations` |
| Fases DONE / total | ver `roadmap.waveStatus` | `roadmap.json` |
| Fases BLOCKED | 3 (3.3, 3.5, 5.8) | idem |
| Decisões abertas | 15 | `ROADMAP_DECISION_LOG.md` |
| Taxa de fallback | não medida (sem telemetria aprovada: D-ANALYTICS-LEGAL) | — |
| Regressões P0/P1 abertas | não há registro formal; usar issues | — |

Valores não medidos ficam "não medido", nunca 0.

Métricas de execução: `phases_done`, `blocked_phases`, `critical_gaps_open` (GAP-ARCH críticos), `parity_mismatches`, `legacy_fallback`, `P0_regressions`.
