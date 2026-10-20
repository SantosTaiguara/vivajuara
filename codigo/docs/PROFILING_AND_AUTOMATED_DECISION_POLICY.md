# Perfilamento e decisão automatizada

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/policies.json` (profiling). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

O sistema sugere, o corretor decide (§155). `humanInTheLoop = true` só com evidência (§157; a validação falha sem ela). Perfilamento sensível proibido por padrão. Revisão de decisão automatizada existe como tipo de solicitação (`AUTOMATED_DECISION_REVIEW`).

| Id | Finalidade | Entradas | Saídas | Método | Humano no circuito | Evidência | Só automatizada | Impacto |
|---|---|---|---|---|---|---|---|---|
| PROF_LOT_FIT | LOT_RECOMMENDATION | CUSTOMER_PREFERENCE, FINANCIAL_DECLARED | fitScore, recommendationTier | RULE_BASED | sim | O corretor escolhe o que mostrar; incluir lote fora do perfil pede motivo (tópico 56). | não | Ordena sugestões de lotes; não recusa atendimento nem preço. |
