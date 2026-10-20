# EMERGENCY_CONTROL_POLICY — Política de controles de emergência

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Tipos: DISABLE_PUBLIC_SHARE, DISABLE_RESERVATION_WRITES, DISABLE_EXTERNAL_SYNC, FORCE_LOGOUT_TENANT. Cada controle exige motivo, ator, escopo, início e **expiração** (nunca indefinido; coluna NOT NULL). Ativar é CRITICAL com step-up. Desativar o Share público mantém o app interno ativo. Outros módulos consultam `isControlActive(org, tipo)`. Faixa de destaque no console.
