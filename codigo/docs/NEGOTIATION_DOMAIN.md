# Negotiation Domain

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `Negotiation` + `NegotiationEvent` (append-only): submissão, análise, contraproposta, aceite, recusa, retirada.
- Recusa e retirada exigem código de motivo (`REASON_CODE_REQUIRED`); texto livre não vai para logs.
- Concorrência entre propostas do mesmo lote segue `proposalConcurrency.mode` (`null` → `POLICY_NOT_CONFIGURED`; `SINGLE_ACTIVE_PROPOSAL` → `PROPOSAL_CONCURRENCY_CONFLICT`).
