# Contract Domain

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `Contract` + `ContractVersion` (imutável; trigger `deal_contract_version_immutable`).
- A plataforma **não gera cláusulas**: só usa modelo aprovado (`contractTemplates[].approvedAt`) e variáveis obrigatórias (`CONTRACT_TEMPLATE_NOT_APPROVED`, `CONTRACT_VARIABLES_UNRESOLVED`). Guarda nomes das variáveis, não valores pessoais.
- Correção = nova versão; emitida não muda.
