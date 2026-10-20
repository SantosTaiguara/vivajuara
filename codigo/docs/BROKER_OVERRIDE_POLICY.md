# Política de curadoria do corretor (BrokerDecisionOverride)

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

`applyOverride(shortlist, { action, lotId, reasonCode, note, acknowledgeWarning, toPosition }, { context, tenant, candidate, expectedRevision })`

- Ações: PROMOTE_TO_SHORTLIST, REMOVE_FROM_SHORTLIST, REORDER, MARK_FOR_REVIEW.
- Nunca altera Fit nem rank da recomendação. Altera só a seleção e a apresentação.
- Motivos: CUSTOMER_REQUESTED, BROKER_LOCAL_KNOWLEDGE, COMMERCIAL_NEGOTIATION, VISIT_CONTEXT, SPECIAL_CONDITION, OTHER. "OTHER" exige descrição. Não existe motivo "sistema errado".
- Incluir ou tirar um lote comum não pede motivo. Incluir lote sensível (fora de exigência, acima do orçamento, ou em revisão por dado pendente que não seja só a disponibilidade) exige motivo **e** confirmação (`acknowledgeWarning`). A tela pergunta: "Este lote excede o orçamento máximo informado. Deseja incluí-lo mesmo assim?" O critério não atendido continua visível (`constraintBreaches`); FAIL nunca vira PASS.
- Permissão `decision.override` (negada por padrão; liberada só no modo aparelho, em memória).
- Inclusão sensível gera um registro de auditoria sem nota e sem PII. Reordenar não é auditado.
- Apresentação: a projeção do cliente diz apenas "Esta opção está fora de um dos critérios inicialmente informados, mas foi incluída como alternativa." (se `clientSafe.showOutOfConstraintNote`).
