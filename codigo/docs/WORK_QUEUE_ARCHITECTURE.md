# WORK_QUEUE_ARCHITECTURE — Arquitetura das filas de trabalho

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`WorkQueueDefinition` em `backofficeConfig.workQueues` (13 filas: aprovações, propostas, reservas expirando, closings bloqueados, onboarding, mapeamentos, publicações, conflitos, qualidade, documentos, titulares, incidentes, falhas de integração).

- Filtros allowlist (`queryPolicies.filters`: status/severity/assignedTo/domain/type com eq/in; createdAt/dueAt com gte/lte). Sem SQL nem expressão livre.
- Ordenação allowlist; nulos no fim; página padrão 25, máximo 100 (técnico). Paginação por cursor do provider.
- Ações da fila aparecem só se a permissão existe no registro e é concedida; offline → desabilitada com motivo; celular → ações não móveis desabilitadas.
- Bulk (`BulkActionPolicy`): só `workitem.assign` habilitado, mas `maxItems = null` → recusa `BULK_LIMIT_NOT_CONFIGURED` até decisão.
- Atribuição ≠ autorização (`checkAssigneeCanAct` sinaliza `ACCESS_CONFIGURATION_ISSUE`); `WorkClaim` informa e expira.
