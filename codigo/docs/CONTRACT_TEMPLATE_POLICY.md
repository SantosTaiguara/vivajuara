# Contract Template Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Lista `contractTemplates` vazia por padrão: nenhum contrato pode ser gerado até o jurídico da organização aprovar modelos (necessita confirmação).
- Cada modelo: `templateId`, `templateVersion`, `approvedAt`, `approvedBy`, `requiredVariables`.
- Não é orientação jurídica.
