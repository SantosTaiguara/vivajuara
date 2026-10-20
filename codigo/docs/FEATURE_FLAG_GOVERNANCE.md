# FEATURE_FLAG_GOVERNANCE — Governança de feature flags

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`reviewFlag(def)`: id, escopo (GLOBAL/ORGANIZATION/DEVELOPMENT/USER), dono, propósito e risco obrigatórios; flag de migração sem sunset = erro; sem data = aviso; vencida = aviso. O aviso antecipado de sunset depende de `featureFlagSunsetWarningDays` (null). Flags HIGH/CRITICAL exigem permissão restrita (`backoffice.flag.manage`). Mudança auditada.
