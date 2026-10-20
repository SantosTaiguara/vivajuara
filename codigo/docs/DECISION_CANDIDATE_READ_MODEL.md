# DecisionCandidate (read model)

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

| Campo | Conteúdo |
|---|---|
| `eligibility` | ELIGIBLE, REVIEW_REQUIRED ou INELIGIBLE |
| `recommendationRank` / `reviewRank` | posição analítica (lista principal ou lista de revisão), separada da ordem curada |
| `tier` | PRIMARY, STRONG_MATCH, ALTERNATIVE, REVIEW_REQUIRED (do motor) |
| `fitScore`, `fitCoverage`, `fitConfidence` | copiados do resultado, nunca recalculados |
| `keyReasons` (até 3) / `allReasons` | `DecisionReason`: WITHIN_BUDGET (HARD_CONSTRAINT_PASS) primeiro, depois prioridades atendidas (CUSTOMER_PREFERENCE_MATCH), outras exigências atendidas e, em investimento, "menor ticket entre as opções listadas" (CONTEXTUAL_ADVANTAGE). Cada razão traz fatos com o estado do dado (estimado, calculado, confirmado) |
| `keyTradeoffs` (até 2) / `allTradeoffs` | `DecisionTradeoff`: PREFERENCE_MISMATCH / LOCATION_TRADEOFF, DATA_UNCERTAINTY (dado pendente, não avaliado, estimado), COMMERCIAL_LIMITATION (disponibilidade), FINANCIAL_TRADEOFF. O aviso de disponibilidade aparece sempre no cartão e não ocupa as duas vagas de pontos de atenção |
| `commercialSnapshot` | preço de tabela + estado do dado, área, situação comercial |
| `commercialViability` | ver COMMERCIAL_VIABILITY_MODEL.md |
| `financialCompatibility` | ver FINANCIAL_COMPATIBILITY_MODEL.md |
| `dataQualitySummary` | "Dados suficientes", "Alguns dados estimados" ou "Informação pendente" |
| `objectiveContext` | moradia: privacidade, ruído, orientação, percurso ao clube, mata nos fundos; investimento: ticket, preço por m², condições de tabela e aviso de que variação de tabela não é promessa de valorização; indefinido: convite a definir o objetivo |

`forLot(result, lotId, env)` monta o candidato de um lote excluído (INELIGIBLE, com `exclusionReasonCode`) para o aviso de curadoria e para o Quick View.
