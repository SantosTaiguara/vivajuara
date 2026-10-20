# Feedback do cliente

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- `recordFeedback(session, { lotId, feedbackType, criterionId?, note? })`: LIKED, DISLIKED, TOO_EXPENSIVE, LOCATION_NOT_PREFERRED, SIZE_NOT_PREFERRED, PAYMENT_NOT_PREFERRED, NEEDS_MORE_INFO, WANTS_VISIT, WANTS_SIMULATION, OTHER. A nota é interna e não entra no histórico.
- Feedback **não altera o perfil**. `suggestPreferences(feedbacks)` só sugere quando o corretor marcou o critério (`criterionId`) e o mesmo critério aparece em pelo menos `feedbackSuggestion.threshold` (2) feedbacks negativos. A sugestão nasce `PENDING`, inativa, com origem `SYSTEM_SUGGESTED_UNCONFIRMED`.
- `resolveSuggestion(s, true)` devolve o patch explícito do painel (ex.: `{ preferences: { gate: 2 } }`); quem aplica é a tela, após o clique do corretor. Sem aprendizado silencioso.
- Feedback pode mudar a seleção, mas o resultado da recomendação continua histórico.
