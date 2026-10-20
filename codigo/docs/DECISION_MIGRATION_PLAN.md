# Plano de migração da decisão

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Incremental. Nada do fluxo atual é removido: mapa, filtros manuais, comparação sem cliente, simulação a partir do lote, solar, detalhe técnico e proveniência continuam iguais.

| Fase | Situação |
|---|---|
| 1. Contexto do cliente ativo | pronto (`buildContext` com e sem Customer) |
| 2. Encontrar usa o perfil | pronto (mesmas entradas do painel) |
| 3. Resultado + explicações | pronto (orquestrador sobre o motor existente) |
| 4. Seleção | pronto (domínio + sugestão) |
| 5. Comparação ligada | `comparisonContext` + `decCompareShortlist` (receita) |
| 6. Financeiro ligado | pronto (`FinancialCompatibility`) |
| 7. Persistência da sessão | só em memória; servidor fica como contrato |
| 8. Jornada + apresentação + feedback | apresentação e feedback prontos no domínio; eventos de jornada: contrato |
| 9. Próximo passo | pronto |

Primeiro incremento visível: com o cliente selecionado, painel "O que mostrar a este cliente — e por quê" no Encontrar, sem persistir a sessão.

## Servidor (contrato, não implementado)

`POST /api/v1/decisions`, `GET /api/v1/decisions/:id`, `PATCH /api/v1/decisions/:id/context`, `POST /api/v1/decisions/:id/recommendations`, `POST|PATCH /api/v1/decisions/:id/shortlist`, `POST /api/v1/decisions/:id/feedback`, `POST /api/v1/decisions/:id/refresh`, `GET /api/v1/decisions/:id/summary`. `expectedRevision` em toda edição; idempotência na criação; escopo por organização, atribuição do cliente e empreendimento. DTOs = os objetos de `App.decision.domain` (sessão, seleção, override, feedback, snapshot). Os testes de banco não rodam neste ambiente.

## Roteiro (tópico 55)

Onda 4 (Inteligência): orquestrador e read models. Onda 5 (Cliente/Jornada): sessão persistida e eventos de jornada. Onda 6 (Apresentação/Compartilhamento): apresentação a partir da seleção e link seguro.
