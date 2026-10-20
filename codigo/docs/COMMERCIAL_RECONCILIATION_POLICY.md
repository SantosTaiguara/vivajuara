# Commercial Reconciliation Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `reconcileReservations(principal, developmentId, externalSnapshot)` compara reservas vivas com o estado externo e grava `conflict` OPEN para cada divergência; nunca corrige sozinho.
- PENDING_EXTERNAL_CONFIRMATION não conta como ativa.
- Resolução de conflito: decisão humana.
