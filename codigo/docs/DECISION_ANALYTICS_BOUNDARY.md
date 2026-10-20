# Fronteira de analytics da decisão

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- `analyticsPayload(result, extra)` gera só agregados: status, etapa, objetivo, contagens (elegíveis, em revisão, seleção) e prontidão. Sem perfil, orçamento, id de cliente ou nota.
- Eventos sugeridos (precisam entrar no registro `config/analytics/events.json`, decisão do coordenador): `decision_session_started`, `recommendation_generated`, `shortlist_created`, `candidate_compared`, `presentation_created`.
- Observabilidade: o resultado traz `durationMs` do orquestrador.
- Correlação não é causa: "recomendado → vendido" não é afirmado sem metodologia. Sem rótulo por cliente. Nada sai do aparelho (analytics local, tópico 47).
