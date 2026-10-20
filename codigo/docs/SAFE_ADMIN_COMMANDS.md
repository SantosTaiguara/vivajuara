# SAFE_ADMIN_COMMANDS — Comandos administrativos seguros

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`AdminCommandEnvelope { commandId, actionCode, organizationId, resourceRef, expectedRevision?, idempotencyKey?, reason?, payload, approvalRef? }`.

Pipeline no servidor (§140): autenticar (iam) → resolver tenant (membership ativa; outro tenant = 404) → autorizar (`backoffice.access` + permissão da ação) → política (motivo estruturado, step-up, segunda aprovação) → `DomainCommandHandler.load` → `expectedRevision` (diferente = 409 `REVISION_CONFLICT` com `currentRevision` e diff) → token de prévia → `validate` (bloqueios = 422) → idempotência (mesma chave+corpo reenvia; corpo diferente = 409 `IDEMPOTENCY_KEY_REUSED`) → `apply` → auditoria minimizada → eventos.

Sem handler registrado = `ACTION_NOT_SUPPORTED`; não existe "editar banco". Handlers próprios: `workitem.assign`, `config.publish`, `config.rollback`, `support_session.start/end`, `emergency.activate/release`. Os demais (reserva, venda, preço, privacidade, publicação) são registrados pelos módulos donos com `registerHandler`.

Códigos de motivo (§149): DATA_CORRECTION, CUSTOMER_REQUEST, COMMERCIAL_EXCEPTION, SECURITY_RESPONSE, PRIVACY_REQUEST, ROLLBACK, SYSTEM_RECOVERY, OTHER (exige texto). O texto livre não é gravado nem logado.
