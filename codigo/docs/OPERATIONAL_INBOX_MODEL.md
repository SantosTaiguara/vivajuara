# OPERATIONAL_INBOX_MODEL — Modelo da caixa operacional

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

`App.backoffice.inbox.build({ context, now })` agrega `OperationalInboxItem` (§22) dos providers das filas visíveis.

Regras: item de outra organização, com PII no título/descrição (CPF, e-mail, telefone), de fila não visível ou de provider diferente é descartado; `actionRoute` só com ids seguros; dedupe por id (mais recente vence); RESOLVED/DISMISSED saem; `overdue` vem do servidor (nunca é calculado no navegador).

Seções da home (§21): Urgente (CRITICAL ou atrasado), Aprovações pendentes, Prazos, Falhas; depois "Áreas indisponíveis". A inbox é projeção (`isProjection: true`), não fonte de verdade; resolver um item executa o comando do domínio de origem.
