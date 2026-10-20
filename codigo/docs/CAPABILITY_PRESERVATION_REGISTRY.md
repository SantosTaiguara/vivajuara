# CapabilityPreservationRegistry

Fonte: `config/governance/capabilities.json` (registro `2026-10-11.1`, 29 capacidades). Código: `src/governance/capabilityRegistry.js` (`App.governance.capabilities`). Teste: `tests/preservation54.test.js`. Matriz legível: [CAPABILITY_PRESERVATION_MATRIX.md](CAPABILITY_PRESERVATION_MATRIX.md) (gerada).

## Modelo

```ts
interface PreservedCapabilityDefinition {
  capabilityId: string;            // CAP-NN-NOME, estável
  name: string;
  category: 'MAP'|'SEARCH'|'FILTER'|'LAYER'|'LOT_CONTEXT'|'COMPARISON'|'RECOMMENDATION'|'FINANCIAL'|'SOLAR'|'PROVENANCE'|'CLIENT'|'SHARE'|'DOCUMENT'|'PERFORMANCE'|'OFFLINE'|'DATA_QUALITY'|'CALCULATION'|'OTHER';
  priority: 'P0'|'P1'|'P2'|'P3';
  preservationLevel: 'EXACT_PARITY'|'SEMANTIC_PARITY'|'UX_CONTINUITY'|'PERFORMANCE_PARITY'|'DATA_PARITY'|'IMPROVE_ONLY';
  currentBehavior: string; valueReason: string;
  currentLocation: string[];       // arquivos reais de plat/src (validado pelo teste)
  targetLocation: string;
  goldenTests: string[];           // 'golden:<categoria>' | 'test:<arquivo>.test.js' (validados)
  metrics: string[];
  allowedImplementationChanges: string[];
  forbiddenRegressions: string[];
  migrationMode: 'LEGACY_ONLY'|'SHADOW'|'CANARY'|'NEW_WITH_FALLBACK'|'NEW_ONLY'|'LEGACY_REMOVED';
  status: 'PRESERVED'|'AT_RISK'|'REGRESSED'|'IMPROVED'|'RETIRED_APPROVED';
  legacyClassification: 'PRESERVE_AS_IS_TEMPORARILY'|'PRESERVE_BEHAVIOR_REIMPLEMENT'|'REFACTOR_IN_PLACE'|'REPLACE_WITH_ADAPTER'|'DEPRECATE'|'REMOVE';
  migrationOwner?: string; deprecationTarget?: string;
}
```

Mais `parityExceptions` (ParityException: capabilityId, legacyBehavior, correction, reason, approvedBy, approvedAt, pathPattern do golden, evidenceRefs) e `knownLegacyBehaviors` (INTENDED/BUG/AMBIGUOUS/UNVERIFIED).

## Regras validadas por `validate()`

- IDs únicos; prioridade, nível, categoria, modo, status e classificação dentro dos enums.
- P0 e P1 têm ao menos um golden ou teste; EXACT_PARITY (exceto performance) tem golden.
- Referências `golden:` existem entre as 13 categorias; `test:` existem em `tests/`.
- Só P3 pode ser `RETIRED_APPROVED`.
- ParityException só vale com `approvedBy` + `approvedAt` + razão do enum + `pathPattern` + evidência.

## Uso

```js
const C = App.governance.capabilities, REG = /* capabilities.json */;
C.touchedBy(REG, ['services/finance.js'])      // → [{ capabilityId: 'CAP-16-FINANCEIRO', priority: 'P0', … }]
C.cutoverGate(REG, 'CAP-16-FINANCEIRO', { testsPassing: true, goldenDrift: 0, signoff: { by, at } }) // → { allowed, blockers }
```

`cutoverGate` bloqueia: testes vermelhos, golden não executado, diferença em EXACT/DATA_PARITY sem exceção, P0 sem signoff (`MIGRATION_SIGNOFF_TEMPLATE.md`), P0 com divergência em sombra.

## Distribuição atual

P0: 14 (planta, 498 lotes, seleção, busca, QuickView, status do dado, não inventar, scores, financeiro, velocidade local, disponibilidade, preço, alertas, client-safe) · P1: 14 · P2: 1 · P3: 0. Status: todas `PRESERVED` em 2026-10-11 (golden gravado nessa data).
