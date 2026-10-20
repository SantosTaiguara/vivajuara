# AVAILABILITY_OPERATIONS_BACKOFFICE — Operações de disponibilidade

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`availability.override` usa a permissão existente `availability.write`: motivo estruturado, `expectedRevision` obrigatória (nunca um dropdown simples), expiração opcional e futura (`governance.validateOverride`). Aviso "Override manual ativo até HH:MM UTC" (`overrideWarning`). Conflito R5/R6 → "O registro mudou desde que você abriu", com sua versão, versão atual e diff. Os 498 lotes seguem com disponibilidade não confirmada.
