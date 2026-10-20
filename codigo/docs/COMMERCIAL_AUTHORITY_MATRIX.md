# Commercial Authority Matrix

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

Domínios: proposal, negotiation, reservation, availability, contract, signature, journey. Modo por domínio: PLATFORM_MASTER, EXTERNAL_MASTER, REFERENCE_ONLY — todos `null` (`COMMERCIAL_AUTHORITY_NOT_CONFIGURED`).
- EXTERNAL_MASTER em reserva → PENDING_EXTERNAL_CONFIRMATION + `externalCommand`; disponibilidade local intocada até confirmação.
- REFERENCE_ONLY → `COMMERCIAL_AUTHORITY_EXTERNAL`.
- Proibido mestre duplo (reserva na plataforma com disponibilidade externa): `NO_DUAL_MASTER`.
