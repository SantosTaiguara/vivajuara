# Signature Provider Integration

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Porta `signatureProviders` injetada no serviço; nenhum provedor real configurado (sem segredos no repositório).
- Envelope: CREATED, SENT, PARTIALLY_SIGNED, COMPLETED, DECLINED, EXPIRED, CANCELLED.
- Webhook verificado pela porta (`SIGNATURE_WEBHOOK_INVALID`), replay bloqueado por `webhookEvent` único (provedor + id do evento).
- Sem processamento de pagamento.
