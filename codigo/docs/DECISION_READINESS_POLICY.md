# DecisionReadiness

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Status composto, **separado do Fit**. Não existe "score mágico" de confiança da decisão nem multiplicação de scores.

Eixos, cada um mostrado por si: completude do perfil, cobertura dos critérios na seleção, atualidade da disponibilidade (FRESH/STALE/UNKNOWN), atualidade do preço (CURRENT/STALE/UNKNOWN).

| Status | Quando |
|---|---|
| NOT_READY | contexto inválido, perfil vazio ou nenhum candidato |
| LOW | cobertura dos critérios abaixo de `minFitCoverage` da recomendação |
| MEDIUM | qualquer aviso: disponibilidade a confirmar, preço não confirmado, perfil parcial, orçamento estimado, sem conexão |
| HIGH | nenhum aviso |

Exemplos da especificação: Fit 95 com disponibilidade desatualizada → MEDIUM; Fit 70 com perfil incompleto → MEDIUM (testados). Hoje, com disponibilidade UNKNOWN em todos os lotes, o máximo é MEDIUM ("Pronto, com pontos a confirmar").
