# Commercial Capability Matrix

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

`capabilities(principal, {developmentId, lotId, proposalId, reservationId, closingId})` combina permissão + estado do recurso + política + autoridade e devolve `canCreateProposal`, `canSubmitProposal`, `canAcceptProposal`, `canCreateReservation`, `canExtendReservation`, `canReleaseReservation`, `canOpenClosing`, `canIssueContract`, `canCompleteSale` e `reasonCodes` (ex.: `POLICY_NOT_CONFIGURED:reservation.maxDurationSeconds`, `LOT_AVAILABILITY_UNKNOWN`, `NO_PERMISSION:sale.complete`). O frontend só exibe; o backend decide de novo em cada comando.
