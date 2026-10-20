# ADMIN_EXPORT_POLICY — Política de exportação

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Exportação é ação separada (`backoffice.export.create`), com prévia de linhas, campos, filtros e classificação (campo sem classificação = RESTRICTED). Motivo e auditoria para dados confidenciais; geração no servidor; link curto cuja validade (`exportLinkTtlMinutes`) ainda é `null` → o servidor recusa. CSV protegido contra injeção de fórmula (`csvCell`).
