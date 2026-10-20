# Commercial Migration Plan

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- `backend/migrations/011_deals.sql` cria 22 tabelas (`deal_*`), CHECKs de status, FKs de organização/empreendimento, índices únicos (reserva viva por lote, WON por fechamento, fechamento aberto por proposta, replay de webhook) e triggers de imutabilidade/append-only.
- `backend/migrations/down/011_deals.down.sql` remove tudo (reversível).
- Não altera tabelas existentes nem autenticação do Postgres.
- Aplicar: rodar o migrador do backend no ambiente com banco; validar com `node --test backend/tests/deals.test.js` + suíte PostgreSQL.
