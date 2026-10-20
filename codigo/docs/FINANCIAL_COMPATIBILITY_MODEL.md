# FinancialCompatibility

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Read model derivado do `App.services.finance.simulate`. Nenhuma fórmula aqui.

Cenário padrão (o mesmo para todos os lotes, para comparar de forma justa): entrada padrão da tabela (`downPaymentDefaultPercent`, hoje 12%) e todos os planos disponíveis do lote.

- `downPaymentCompatible`: entrada padrão ≤ capacidade de entrada informada.
- `monthlyPaymentCompatible`: algum plano com parcela mensal ≤ capacidade mensal informada (anuais não entram na parcela mensal; aviso `PLAN_HAS_ANNUAL_PARCELS`).
- `status`: COMPATIBLE (tudo o que foi informado cabe), PARTIALLY_COMPATIBLE (parte cabe), INCOMPATIBLE (nada cabe), UNKNOWN (capacidade não informada ou preço ausente).
- `bestKnownPlanId`: plano compatível de menor custo total na simulação.
- Avisos fixos: `DOWN_PAYMENT_DEFAULT_TO_CONFIRM` (entrada de tabela, condição a confirmar) e `NOMINAL_VALUES_NO_INDEXATION` (valores nominais; IGP-M não está incluído).

Orçamento como exigência ≠ compatibilidade financeira: um lote de R$ 299 mil passa no "preço até R$ 320 mil" e ainda pode ficar PARTIALLY_COMPATIBLE se a entrada de 12% passar da capacidade informada (teste).
