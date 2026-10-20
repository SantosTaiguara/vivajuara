# Commercial Test Matrix

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

| Arquivo | Testes | Cobertura |
|---|---|---|
| `backend/tests/deals.test.js` | 23 | cenários de ouro (proposta aceita, contraproposta, expirada/retirada, aprovação de desconto, preço mudou, disponibilidade defasada, proposta única ativa, reserva com vencedor único/concorrente, guards, idempotência, expiração, prorrogação, liberação, autoridade externa, fechamento→contrato→assinatura→venda, cancelamento, WON não configurado, perdas, cross-tenant), privacidade, migração/SQL, HTTP+OpenAPI, paridade frontend |
| `tests/deals.test.js` | 6 | domínio somente leitura, registro de permissões sem role, chips/contagem pelo relógio do servidor, selo do lote sem identidade, visitante não vê nada, política null |

Testes PostgreSQL reais (migração 011 aplicada) ficam para o ambiente com banco.
