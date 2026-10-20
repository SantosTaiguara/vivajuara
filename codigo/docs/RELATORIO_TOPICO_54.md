# Relatório — Tópico 54: Preservação das forças atuais e não regressão

Data: 2026-10-12. Princípio: preservar o valor já validado, medir a paridade e só remover o legado com prova. Não houve mudança de UI, dados, IDs, geometria, scores, classes, metodologia, preço ou regras financeiras e solares.

## Capacidades e prioridade
`config/governance/capabilities.json` registra 29 capacidades: 14 P0, 14 P1 e 1 P2. Cada uma traz nível de preservação, local atual e alvo, testes golden e métricas. O validador é `src/governance/capabilityRegistry.js` (`App.governance.capabilities`), e a matriz completa está em `CAPABILITY_PRESERVATION_REGISTRY.md` e `CAPABILITY_PRESERVATION_MATRIX.md`.

As forças preservadas são:
- planta oficial e os 498 lotes;
- seleção, busca, filtros, camadas e legenda;
- QuickView e ficha;
- status do dado e a regra de nunca inventar;
- scores, rankings, solar e financeiro;
- comparação, WhatsApp, uso local rápido e resiliência;
- cores, disponibilidade, preço, alertas e a projeção client-safe.

## Legado
- **Implementações a substituir:** estão em `LEGACY_SUNSET_PLAN.md` e na onda W9.
- **Comportamentos ambíguos (KLB-01..05):** registrados em `LEGACY_BEHAVIOR_INVENTORY.md`.
  - os 498 lotes estão UNKNOWN;
  - valores sem correção pelo IGP-M;
  - empates ordenados pela ordem do dataset;
  - cálculo solar sem sombra de vizinhos;
  - `App.analytics` com dois donos.
- **Bugs conhecidos:** o alerta "área ausente" (D-ALERTS) e TD-12 (fórmula de preço em 4 arquivos), ambos em `LEGACY_FORMULA_INVENTORY.md`.

## Baseline e golden
`tests/golden/baseline.json` é a baseline `golden-viva-juara-2026-10-11`. Ela usa o dataset `2026-10-06.1|2026-10-06|2026-10-06`, 498 lotes e o relógio fixo `2026-10-11T12:00:00-03:00`.

Há 13 categorias com sha256 por categoria: dataset, lots, map, layers, filters, recommendations, finance, solar, quickview, share, comparison, search e texts. O JSON é canônico, com chaves ordenadas e arredondamento de 1e-6.

| Paridade | Fixture e cobertura |
|---|---|
| Fórmulas | `LEGACY_FORMULA_INVENTORY.md` |
| Scores e classes | `lots.golden.json`, os 498 lotes |
| Financeiro | `finance.golden.json`, 4 cenários × 21 lotes representativos |
| Solar | `solar.golden.json`, estações × momentos |
| Filtros | 28 cenários |
| Camadas e cores | `layers`; t18 = 0 |
| QuickView | campos centrais |
| Comparação | `comparison` |
| Share | `share` (cliente e corretor) |
| Geometria | `map`, com hash dos polígonos |
| Campos | `DATA_PARITY_REPORT.md` |

Recomendações reais dão NO_ELIGIBLE_LOTS, porque tudo está UNKNOWN. Por isso o golden também traz execuções sintéticas AVAILABLE, usadas só em teste, que nunca vão para a UI.

`tests/preservation54.test.js` tem 21 testes. Qualquer diferença no golden falha, a menos que esteja coberta por uma `parityException` com `pathPattern`. Para recapturar, rode `node scripts/goldenBaseline.js --update`, e só depois de registrar a exceção.

## Consistência, continuidade, performance e visual
- Consistência entre visões: `CROSS_VIEW_CONSISTENCY_MATRIX.md`. O teste cruzado automático ainda falta (fase 0.5).
- Continuidade de estado: `STATE_CONTINUITY_MATRIX.md`.
- Performance: `PERFORMANCE_BASELINE.md` e `PERFORMANCE_PARITY_REPORT.md`, com valores medidos no harness. O que não foi medido está marcado como não medido.
- Visual: `VISUAL_REGRESSION_POLICY.md`. Hoje o E2E/visual é manual (TD-10).

## Migração
- Modos (LEGACY_ONLY, SHADOW, CANARY, NEW_WITH_FALLBACK, NEW_ONLY, LEGACY_REMOVED), feature flags, canário, gates de cutover e rollback: `MIGRATION_MODES_AND_CUTOVER_POLICY.md`.
- Gate automatizado: `cutoverGate`. P0 exige signoff (`MIGRATION_SIGNOFF_TEMPLATE.md`).
- Flags atuais em sombra: `ruleEngineAlerts` (CAP-28) e a confiança (CAP-11). Ainda não há resultado de sombra agregado, porque falta telemetria aprovada (D-ANALYTICS-LEGAL).
- Suporte: a nota de migração usa "movido para…".
- Remoção: `LEGACY_REMOVAL_CHECKLIST.md`.
- Exceções de paridade: `LEGACY_PARITY_EXCEPTIONS.md`. Não há nenhuma aprovada, e nenhuma diferença intencional.

## Arquivos
**Criados:**
- `src/governance/goldenBaseline.js`
- `src/governance/capabilityRegistry.js`
- `config/governance/golden.json`
- `config/governance/capabilities.json`
- `scripts/goldenBaseline.js`
- `tests/golden/*.golden.json` (13) e `tests/golden/baseline.json`
- `tests/preservation54.test.js`
- 14 documentos: CAPABILITY_PRESERVATION_REGISTRY, LEGACY_FORMULA_INVENTORY, GOLDEN_BASELINE_SPEC, LEGACY_BEHAVIOR_INVENTORY, FEATURE_PARITY_REPORT, PERFORMANCE_BASELINE, PERFORMANCE_PARITY_REPORT, VISUAL_REGRESSION_POLICY, LEGACY_PARITY_EXCEPTIONS, MIGRATION_MODES_AND_CUTOVER_POLICY, LEGACY_REMOVAL_CHECKLIST, STATE_CONTINUITY_MATRIX, CROSS_VIEW_CONSISTENCY_MATRIX, MIGRATION_SIGNOFF_TEMPLATE
- gerados: CAPABILITY_PRESERVATION_MATRIX, GOLDEN_TEST_MATRIX, DATA_PARITY_REPORT

**Alterados:** nenhum arquivo existente.

## Riscos remanescentes
- Dataset "feliz" (tudo UNKNOWN).
- Teste visual fora do CI.
- Fórmula duplicada (TD-12).
- Sombra sem métrica agregada.

## Decisões humanas
- D-CONFIDENCE e D-ALERTS: saída do modo sombra.
- D-SALES-MIRROR: disponibilidade real; vai exigir recaptura do golden com exceção.
- D-WHATSAPP-TEXT.
