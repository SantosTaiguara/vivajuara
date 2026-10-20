# Atualização e currentness

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- `currentness(snapshot, refsAtuais, devId)` compara versão do perfil, tabela de preço, revisão de disponibilidade, versão da análise, metodologia do Fit e política da recomendação.
- Resultado: CURRENT, PROFILE_CHANGED, COMMERCIAL_CHANGED (preço ou disponibilidade), ANALYSIS_CHANGED, METHODOLOGY_CHANGED, UNKNOWN; `refresh` REQUIRED/SUGGEST/OPTIONAL/NONE conforme `refreshPolicy` (perfil e metodologia: REQUIRED; preço, disponibilidade e análise: SUGGEST).
- Ninguém recalcula em silêncio: o usuário escolhe atualizar (`decRefresh`). Na apresentação ao cliente vale o snapshot.
- Um novo `RecommendationResult` vira nova referência na sessão; o anterior fica em `previousResultIds`.
- `liveOverlay(shortlist, getLot, env, context)`: mostra o estado comercial atual sobre a seleção antiga, sem recalcular a recomendação. Vendido → "Recomendado anteriormente — atualmente vendido"; preço acima do orçamento → marcado.
- `replacementSuggestions(...)`: substituto PENDING para cada lote vendido ou fora do orçamento; o corretor confirma.
