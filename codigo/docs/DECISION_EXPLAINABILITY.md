# Explicabilidade da decisão

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- As razões e os pontos de atenção vêm de `App.explanation.explainLot` sobre o mesmo `RecommendationResult`: o "porquê" deriva do mesmo cálculo, nunca de um cálculo paralelo.
- `DecisionExplanation` (`services.explanation(candidate, result)`): razões, pontos de atenção, resumo das exigências, resumo financeiro, incertezas e `versionRefs`.
- Fatos antes do score: o cartão mostra preço de tabela, área, situação comercial e as razões; a compatibilidade (%) aparece depois, só para o corretor.
- Níveis: corretor L1/L2 (razões, pontos de atenção, fatos com estado do dado); cliente L0/L1 (frases simples, sem score, sem códigos); técnico L3 continua no "Por quê?" existente (`data-act="explain"`).
- Linguagem: nunca "o melhor lote". Usa "Principal recomendação para este contexto", "Melhor compatibilidade com o perfil informado", "maior aderência aos critérios de investimento informados". Sem ROI, sem rentabilidade, sem valorização garantida (teste com expressão regular e com o scanner da apresentação).
- Exclusões explicadas: o motivo e os valores (ex.: preço acima do teto) vêm do `ExcludedLotDetail`. Dado ausente aparece como "Falta informação para confirmar", nunca como incompatibilidade.
- Sem combinação forte: "Nenhuma opção atende bem aos critérios atuais". Nada é afrouxado.
