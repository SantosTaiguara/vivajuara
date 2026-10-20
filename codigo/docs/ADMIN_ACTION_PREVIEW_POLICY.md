# ADMIN_ACTION_PREVIEW_POLICY — Política de prévia de ação

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

- Ações HIGH/CRITICAL exigem prévia (`requiresPreview`; a validação da config falha se uma CRITICAL não tiver prévia ou motivo).
- `AdminActionPreview` traz allowed, warnings, blockers, affectedEntities, estados atual/proposto, aprovações exigidas, `expectedRevision`, `previewToken`, `expiresAt` e o aviso "Esta ação será registrada na auditoria".
- `previewToken` = HMAC(previewKey, hash do comando | ator | organização | expiração). Sem `previewKey` → `PREVIEW_UNAVAILABLE`. Validade técnica padrão 300 s (decisão aberta).
- Execute revalida tudo; a prévia nunca é autorização. Token de outro ator, de outro corpo ou vencido → `PREVIEW_MISMATCH` / `PREVIEW_EXPIRED`.
- Confirmação proporcional: exclusão crítica (`tenant.delete`) exige digitar o identificador; nada de "DELETE" para tudo.
