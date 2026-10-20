# Reservation Domain

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `Reservation`: PENDING, PENDING_EXTERNAL_CONFIRMATION, ACTIVE, EXPIRED, RELEASED, CONVERTED, CANCELLED.
- Criação atômica: lock do lote, checagem na ordem LOT_NOT_FOUND → LOT_ALREADY_RESERVED → LOT_AVAILABILITY_UNKNOWN → LOT_NOT_AVAILABLE → AVAILABILITY_REVISION_CONFLICT, transição AVAILABLE → RESERVED pela máquina compartilhada, auditoria e outbox.
- Exige `expectedAvailabilityRevision`, `idempotencyKey` e `expiresAt` dentro de `reservation.maxDurationSeconds` (`null` → recusado).
- Lote UNKNOWN nunca é reservável. Estado público do lote nunca revela quem reservou.
- Conversão em fechamento: reserva → CONVERTED, lote continua RESERVED até a venda.
