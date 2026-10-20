# Shortlist (seleção para o cliente)

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- Ranking é resultado analítico; seleção é curadoria. Os dois ficam separados: cada `ShortlistCandidate` guarda `recommendationRank`/`reviewRank` (analítico) e `curatedPosition` (ordem curada).
- `createShortlist(session, result)` usa a sugestão do orquestrador: `defaultSize` 3, `maxSize` 5 (configuráveis em `shortlistPolicy`).
- `source`: RECOMMENDATION, BROKER_CURATED, CUSTOMER_SELECTED ou MIXED, conforme quem mexeu.
- Notas (`note`) podem conter dado pessoal: ficam internas, fora do histórico, da auditoria e da apresentação.
- Concorrência otimista por `revision`.
- `DecisionPortfolio` (resumo): faixa de preço, número de quadras, tipos de ponto de atenção, opções muito parecidas (mesma quadra, área a até 5% e Fit a até 2 pontos), lacunas ("nenhuma opção com disponibilidade confirmada", "todas na mesma quadra").
- Diversidade automática (`diversityPolicy`) existe na política, desligada: quando ligada, alternativa de outra localização seria rotulada "Alternativa", nunca como #2.
