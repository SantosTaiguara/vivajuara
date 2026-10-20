# DOCUMENT_OPERATIONS_BACKOFFICE — Operações de documentos

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Área Documentos (`backoffice.documents.view`) e fila "Documentos aguardando validação" (provider `documents`, ainda sem adapter → "não integrado"). Estados separados: enviado, verificado, recebido, validado, rejeitado. Substituição cria nova versão; contrato assinado é imutável. Upload só pelo pipeline seguro do tópico de documentos.
