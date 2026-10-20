# DATA_OPERATIONS_BACKOFFICE — Operações de dados

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Área Dados com providers `onboarding` (58) e `dataquality` (61): onboarding, mapeamentos, publicações pendentes, conflitos e bloqueios de qualidade. `data_conflict.resolve` usa `provenance.resolveConflict` (ResolveDataConflictCommand). `data.repair` exige tipo, alvo, motivo, evidência e dry-run (`validateRepair`); `derived.rebuild` distingue REBUILD_DERIVED de MUTATE_SOURCE. Não há "Fix All".
