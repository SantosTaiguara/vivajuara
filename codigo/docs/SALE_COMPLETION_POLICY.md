# Sale Completion Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `saleCompletion.requiredConditions` = `null` → `completeSale` recusa com `POLICY_NOT_CONFIGURED` (testado).
- Condições possíveis: ACCEPTED_PROPOSAL, RESERVATION_CONVERTED, CHECKLIST_VALIDATED, CONTRACT_ISSUED, SIGNATURE_COMPLETED, INITIAL_PAYMENT_CONFIRMED (confirmação manual registrada, nunca pagamento processado).
- Um único WON por fechamento (índice único). LOST/CANCELLED/FAILED exigem código de motivo.
