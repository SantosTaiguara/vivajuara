# Commercial Approval Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Regras em `approval.rules` (`null` → submissão recusada). Cada regra: `code`, `conditionType` (DISCOUNT, PRICE_OVERRIDE, RESERVATION_EXTENSION, …), limite, `requiredApprovalPermission`.
- A aprovação aponta para o checksum dos termos (`termsChecksum`): mudar os termos invalida a aprovação.
- Separação de funções: `approval.requesterCannotApprove` (`APPROVAL_SELF_DECISION_FORBIDDEN`). Valor padrão `null` → decisão recusada até configurar.
- Limites de desconto/alçada **não** são inventados: necessitam confirmação.
