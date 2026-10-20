# Closing Domain

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `ClosingCase`: OPEN, DOCUMENTS_PENDING, UNDER_REVIEW, CONTRACT_PREPARATION, READY_FOR_SIGNATURE, SIGNING, COMPLETED, FAILED, CANCELLED.
- Abre a partir de proposta aceita (idempotente; um fechamento aberto por proposta — índice único).
- Concluir venda (`completeSale`) grava `SaleOutcome` WON + fechamento COMPLETED + lote SOLD na mesma transação, apenas se `saleCompletion.requiredConditions` estiver configurado e satisfeito. WON nunca é inferido.
- Cancelamento exige `closingCancellation.availabilityAfterCancel` configurado.
