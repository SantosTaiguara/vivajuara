# APPROVAL_CENTER — Approval Center

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`App.backoffice.approvals.list()` agrega `ApprovalTask` dos providers (sem PII no resumo). Não substitui o domínio: a decisão é o comando `commercial.approval.decide` (motivo obrigatório, prévia, revisão).

Separação de funções: `requesterCannotApprove` é `null` (necessita confirmação) e é tratado como **verdadeiro** → `SELF_APPROVAL_FORBIDDEN`. No backend, mudança de configuração aprovada pelo próprio solicitante é bloqueada (`SEPARATION_OF_DUTIES`, também `CHECK` no banco). Vazio: "Nenhuma aprovação pendente." 
