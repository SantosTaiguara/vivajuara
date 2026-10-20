# PRIVACY_OPERATIONS_BACKOFFICE — Operações de privacidade

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Área Privacidade (`backoffice.privacy.view`, HIGH) com provider `privacy` (59): solicitações de titulares e incidentes. Resumos sem dados sensíveis. `privacy.request.complete` só depois de verificação de identidade e gates (decisão no domínio 59); `privacy.bulk_export` exige step-up. Prazos legais vêm do servidor/política, nunca do navegador. Não é aconselhamento jurídico.
