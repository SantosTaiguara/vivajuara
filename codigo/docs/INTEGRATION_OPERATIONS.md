# INTEGRATION_OPERATIONS — Operações de integrações

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`IntegrationHealth` (HEALTHY/DEGRADED/FAILED/DISABLED) com modo de autoridade visível; "sync wins" nunca sem política. Segredos: `GET /api/v1/admin/backoffice/secrets-status` devolve só `{ name, status }` (CONFIGURED/MISSING) para DATABASE_URL, ADMIN_API_TOKEN, WRITE_API_KEY, GOOGLE_CLIENT_SECRET, SESSION_SECRET, SHARE_TOKEN_PEPPER. O frontend (`secretsView`) descarta qualquer outro campo. `integration.resync` é idempotente.
