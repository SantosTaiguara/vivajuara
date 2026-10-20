# DEVELOPMENT_OPERATIONS_BACKOFFICE — Operações de empreendimentos

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Área Empreendimentos (`backoffice.developments.view`). Publicar/reverter empreendimento (`publication.publish`/`publication.rollback`, CRITICAL; rollback com step-up) dependem das permissões e handlers do tópico 58. Reversão ativa a versão anterior e não reverte domínios dinâmicos (disponibilidade, reservas). Detalhes técnicos só no modo técnico.
