# USER_ACCESS_ADMINISTRATION — Administração de usuários e acessos

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`governance.accessChangePreview(userId, atuais, propostas, escopos)` → concedidas, revogadas, novas de alto risco, capacidades efetivas; chave inexistente recusada; permissão de plataforma sinalizada (`systemOnlyBlocked`). `permission.change` é CRITICAL, com step-up e segunda aprovação (política `null` = exigida). `session.revoke` (`backoffice.session.revoke`). Ciclo INVITED/ACTIVE/SUSPENDED/DISABLED vem do IAM; prefere-se desativar a apagar.
