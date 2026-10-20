# Commercial Integration Strategy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Outbox (`deal_outbox`): eventos de domínio (ProposalSubmitted, ReservationActivated, ReservationExpired, SaleCompleted, …) e JourneyEvent para o tópico de jornada.
- `notificationIntent` registra intenção de aviso (sem canal decidido).
- CRM/ERP externos: via `externalCommand` quando a autoridade for EXTERNAL_MASTER.
- Integração HTTP: ver `docs/RELATORIO_TOPICO_57.md` (receita).
