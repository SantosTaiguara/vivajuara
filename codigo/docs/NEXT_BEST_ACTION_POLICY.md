# Próximo passo sugerido (NextBestAction)

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Recomendação operacional ao corretor. Nada é automático: `requiresHumanConfirmation: true` em todas, `automation` vem de `actionPolicy` (SUGGEST_ONLY ou USER_CONFIRMATION_REQUIRED). Reserva, proposta e envio de mensagem nunca são disparados.

Ordem:
1. Contexto inválido ou vazio → revisar critérios (CONFIRM_PREFERENCE).
2. Orçamento não informado, estimado ou a confirmar → CONFIRM_BUDGET.
3. Nenhum candidato → CONFIRM_PREFERENCE + sugestões de resolução.
4. Etapa Decidir: confirmar disponibilidade (se algum finalista não está confirmado), depois simular ou preparar apresentação.
5. Demais etapas: seleção com 2+ lotes → COMPARE; já comparado → SIMULATE; já simulado → PREPARE_PRESENTATION; e REQUEST_STATUS_CONFIRMATION quando algum lote da seleção não está confirmado.
6. Feedback "quer visitar" → SCHEDULE_VISIT.

Sugestões de resolução (`DecisionResolutionSuggestion`): REVIEW_CONSTRAINTS, INCREASE_BUDGET, REDUCE_MIN_AREA, WAIT_FOR_AVAILABILITY, COLLECT_MORE_PROFILE_DATA. Todas exigem confirmação; nenhuma é aplicada.
