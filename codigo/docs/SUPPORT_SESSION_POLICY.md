# SUPPORT_SESSION_POLICY — Política de sessão de suporte

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Evitar impersonação; se necessária, `SupportSession` formal: motivo, organização alvo, somente leitura, aprovada por outra pessoa, com prazo. Enquanto `supportSessionMaxMinutes` for `null`, nenhuma sessão pode começar (`SUPPORT_POLICY_NOT_CONFIGURED`). Banner "Sessão de suporte ativa" sempre visível; expira sozinha; tudo auditado. Tabela `admin_support_sessions` com `CHECK` de aprovador diferente.
