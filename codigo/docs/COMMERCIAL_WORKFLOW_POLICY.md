# Commercial Workflow Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

Chaves `workflow.*` (todas `null`): `proposalRequiredBeforeReservation`, `reservationRequiredBeforeProposal`, `acceptedProposalRequiredForClosing`, `reservationRequiredForClosing`. Enquanto `null`, a ação que depende delas é recusada (`POLICY_NOT_CONFIGURED`, `details.policy`).
