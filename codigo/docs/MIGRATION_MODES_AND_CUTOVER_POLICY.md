# Modos de migração e política de cutover

## Modos

| Modo | Usuário vê | Novo caminho | Uso |
|---|---|---|---|
| LEGACY_ONLY | legado | não roda | antes do baseline |
| SHADOW | legado | roda em paralelo; resultado comparado e registrado (sem dado sensível no log) | confiança (`confidence/*`), Rule Engine (`ruleEngineAlerts` OFF), API × JSON (fase 3.2), financeiro no backend (3.7) |
| CANARY | novo para um grupo representativo de corretores | — | backend autoritativo de disponibilidade |
| NEW_WITH_FALLBACK | novo, com volta automática contada | — | apiSource com fallback ao JSON estático |
| NEW_ONLY | novo | — | estado atual da maioria das capacidades do cliente |
| LEGACY_REMOVED | novo | legado apagado | onda 9 |

```ts
interface MigrationFeatureFlag { key: string; capabilityId: string; mode: MigrationMode; owner: string; createdAt: string; sunsetPhase: string; fallbackMetric: string; }
```

Flags atuais: `features.ruleEngineAlerts` (SHADOW, CAP-28, sunset 9.2), confiança em sombra (CAP-11, sunset 9.2). Toda flag de migração nova nasce com fase de retirada.

## Critérios de cutover (por capacidade)

1. `tests` verdes, incluindo `architecture52`, `preservation54`, `roadmap55`.
2. Golden sem diferença, ou diferenças cobertas por exceção aprovada.
3. Em SHADOW: taxa de divergência = 0 para P0 durante a janela de observação.
4. P0: signoff (`MIGRATION_SIGNOFF_TEMPLATE.md`). Implementado em `App.governance.capabilities.cutoverGate`.
5. Rollback definido e testado.
6. Suporte avisado (nota de migração: "movido para…", nunca "removido" quando só mudou de lugar).

## Exemplos

- **Filter Engine**: resultado novo = resultado legado nos 28 cenários golden; diferença só com exceção.
- **FinancialService no backend**: SHADOW contra `services/finance.js`; delta 0 (tolerância 1e-6) em todos os planos e cenários golden; P0 → signoff de produto.
- **Novo renderer**: golden `layers`/`map` iguais + t18 = 0 + orçamento de performance; paleta não muda no mesmo release.
- **Disponibilidade no backend**: só com feed real; CANARY; UNKNOWN continua UNKNOWN onde a fonte não informa.

## Fallback

Fallback é contado (`ROADMAP_MIGRATION_METRICS.md`) e não mascara bug: fallback recorrente reabre a fase.

## A A/B test

Não usar A/B quando o objetivo é só validar paridade técnica: usar SHADOW.
