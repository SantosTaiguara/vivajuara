# Reservation Expiry Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Worker `runExpiry({organizationId})` usa somente o relógio do servidor (injetável em teste); o navegador nunca expira nada.
- Cada item em transação própria, relido sob revisão; idempotente.
- Disponibilidade após expirar: `reservation.availabilityAfterExpiry` (padrão da especificação AVAILABLE; BLOCKED com motivo COMMERCIAL_HOLD é opção).
- Prorrogação: `reservation.extension.*` (`null` → `RESERVATION_EXTENSION_NOT_ALLOWED`/`POLICY_NOT_CONFIGURED`), motivo obrigatório, aprovação quando a regra exigir.
- Proposta expirada não libera reserva.
