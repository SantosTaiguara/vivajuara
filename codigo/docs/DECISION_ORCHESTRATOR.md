# DecisionOrchestrator

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

`App.decision.services.orchestrate(input)`

Entrada: `{ context, lots, recommendation?, freshness, dataVersions, priceTable, availabilityPolicy, offline?, mode?, shortlist?, progress? }`.

Passos:
1. Valida o contexto.
2. Usa o `RecommendationResult` do seletor quando ele é do mesmo `profileVersion`; caso contrário recalcula com `App.recommendation.recommend` e avisa `RESULT_CONTEXT_MISMATCH_RECOMPUTED`.
3. Monta um `DecisionCandidate` para cada recomendado (ELIGIBLE) e cada candidato em revisão (REVIEW_REQUIRED).
4. Sugere a seleção: elegíveis pela ordem analítica; quando não há elegível suficiente, candidatos em revisão **só por disponibilidade** (configurável), rotulados "sujeito a confirmação".
5. Calcula prontidão, próximos passos, sugestões de resolução, portfólio e resumo de qualidade.

Saída (`DecisionOrchestratorResult`): `recommendationResultId`, `status` (CONFIRMED_OPTIONS, OPTIONS_PENDING_CONFIRMATION, NO_STRONG_MATCH, NO_ELIGIBLE_LOTS, INSUFFICIENT_CONTEXT, INVALID_CONTEXT), `candidateSummaries`, `suggestedShortlistIds`, `shortlistIds`, `nextBestAction`, `nextActions`, `readiness`, `validation`, `resolutionSuggestions`, `counts`, `exclusions`, `portfolio`, `quality`, `versionRefs`, `warnings`, `engineResult`, `generatedAt`.

Não faz: preço, score, disponibilidade, cronograma financeiro, impulso comercial oculto, multiplicação Fit × confiança × atualidade. A curadoria do corretor fica fora do motor determinístico.

Com os dados de hoje (498 lotes com disponibilidade UNKNOWN), o status é `OPTIONS_PENDING_CONFIRMATION`: as opções combinam com o perfil, mas precisam de confirmação antes de serem oferecidas.
