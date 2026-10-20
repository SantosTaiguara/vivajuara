# Commercial Transaction Architecture

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

## Princípio
Proposta ≠ Reserva ≠ Disponibilidade ≠ Contrato ≠ Resultado de venda. Cada um tem entidade, máquina de estados, revisão e auditoria próprias (`deals.domain.js` → `MACHINES`).

## Camadas
| Camada | Arquivo | Papel |
|---|---|---|
| Domínio puro | `deals.domain.js` | enums, erros, máquinas de estado, snapshots, checksum, prontidão |
| Política | `deals.policy.js` | política da organização (tudo `null` por padrão) |
| Serviço | `deals.service.js` | comandos atômicos, idempotentes, auditados; leituras |
| Persistência | `deals.repository.js` | memória (testes) e PostgreSQL (migração 011), mesma interface |
| HTTP | `deals.controller.js` | 26 rotas, permissões, `DealError → ApiError` (não ligado ainda ao `app.js`) |
| Contrato | `backend/docs/openapi.deals.json` | fragmento OpenAPI gerado por `deals.openapi.js` |
| Frontend | `src/deals/dealsDomain.js`, `dealsView.js` | somente leitura e marcação; nenhuma escrita |

## Transações
Toda escrita crítica roda em uma transação: entidade + disponibilidade (via `App.availability.transition`) + auditoria + outbox + idempotência. Falha → rollback total.
