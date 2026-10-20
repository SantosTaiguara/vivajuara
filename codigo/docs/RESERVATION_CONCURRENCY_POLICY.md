# Reservation Concurrency Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Uma reserva viva por lote: índice único parcial `deal_reservations_one_live_per_lot` + lock de linha do lote.
- Duas requisições simultâneas: exatamente uma vence; a outra recebe `LOT_ALREADY_RESERVED` ou `AVAILABILITY_REVISION_CONFLICT` (testado).
- Repetição com a mesma `Idempotency-Key` devolve a mesma resposta; mesma chave com outro comando → `IDEMPOTENCY_KEY_REUSED`.
