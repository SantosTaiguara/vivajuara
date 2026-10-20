# PRICING_OPERATIONS_BACKOFFICE — Operações de preço

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

Ação `price_table.publish` (permissão existente, CRITICAL, step-up, motivo, prévia, só no computador). Fluxo: candidata → validação → diff → aprovação → publicação; tabela publicada é imutável ("Criar nova versão"). A publicação continua no domínio existente (`POST /developments/:id/price-tables`); o handler do backoffice para ela é trabalho do integrador. Nenhum preço foi alterado (R$ 1.196/m², tabela de 06/10/2026).
