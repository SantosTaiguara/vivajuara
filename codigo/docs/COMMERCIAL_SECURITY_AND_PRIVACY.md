# Commercial Security And Privacy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Deny by default; `localStorage` nunca é autorização; o visitante público não vê nenhum bloco comercial (`dealsView.panel` → '').
- Acesso entre organizações responde 404 (igual a inexistente) e registra evento de segurança.
- Dados CONFIDENTIAL: termos, notas, aprovações. Snapshot ao cliente omite dados internos.
- Logs/outbox/métricas sem PII; identificadores opacos.
- Nenhum segredo em código, testes ou docs.
