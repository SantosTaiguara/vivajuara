# Commercial Audit Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Toda escrita grava auditoria na mesma transação (`RESERVATION_CREATE`, `RESERVATION_EXTEND`, `RESERVATION_RELEASE`, `RESERVATION_EXPIRE`, `PROPOSAL_*`, `CLOSING_*`, `SALE_COMPLETE`, …) com ator, organização, entidade, revisão e requestId.
- Sem PII: nem nome do cliente, nem notas, nem termos livres (testado).
- Eventos de segurança: `CROSS_TENANT_COMMERCIAL_ACCESS`, `PERMISSION_DENIED`.
- Tabelas append-only protegidas por trigger.
