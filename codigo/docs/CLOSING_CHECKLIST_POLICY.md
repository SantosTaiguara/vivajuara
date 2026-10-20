# Closing Checklist Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Itens vêm de `closingChecklist.items` (`null` → fechamento não abre).
- Upload ≠ validação: VALIDATED exige RECEIVED + `documentId` e a permissão `closing.validate_documents`.
- Prontidão (`closingReadiness`) lista `blockingItems` (CHECKLIST, CONTRACT_NOT_ISSUED, SIGNATURE_INCOMPLETE, …) e progresso por contagem; nenhum conteúdo de documento é exposto.
