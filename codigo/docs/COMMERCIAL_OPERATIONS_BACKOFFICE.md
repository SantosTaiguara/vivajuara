# COMMERCIAL_OPERATIONS_BACKOFFICE — Operações comerciais

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Área Comercial alimentada pelo provider `deals` (tópico 57): filas de aprovações, propostas, reservas próximas de expirar e closings bloqueados.

Ações: `commercial.approval.decide` (`backoffice.approval.decide`), `reservation.release`, `reservation.extend`, `sale.complete` (CRITICAL, step-up, só no computador, abre prontidão — nunca botão de tabela). As permissões `reservation.*` e `sale.complete` ainda não existem no registro → as ações ficam ocultas e o servidor nega. Nenhuma edição direta de dados comerciais.
