# AUDIT_VIEWER_POLICY — Política do visualizador de auditoria

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Somente leitura (`admin.audit.view`, endpoint existente). `auditView` projeta só campos de referência (sem metadata, antes/depois, PII) e filtra por ator, domínio, ação, recurso e período. Exportar auditoria é CRITICAL (`backoffice.audit.export`). Comandos administrativos gravam no `audit_log` append-only com ação `ADMIN_<CODIGO>`, motivo em código e revisões; negações também são auditadas.
