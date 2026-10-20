# OBSERVABILITY_OPERATIONS — Operações de observabilidade

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Projeção operacional (não substitui Grafana/Sentry). Jobs: retry só para job retry-safe/idempotente; replay da DLQ só com análise de idempotência SAFE, prévia e motivo (`UNSAFE_REPLAY_BLOCKED`). Erros mostram o que houve, o que fazer e o ID da requisição, nunca stack. Métricas do serviço: admin_command_total, admin_command_failed_total, support_session_total, config_publish_total, bulk_export_total — sem rótulos de usuário.
