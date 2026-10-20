# CommercialViability

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Separada do Fit. Vem de `App.availability.offerability` (tópico 29) e do estado do preço.

| offerability | CommercialViability |
|---|---|
| OFFERABLE | READY_TO_OFFER |
| NEEDS_CONFIRMATION, CONDITIONAL, UNKNOWN | NEEDS_CONFIRMATION |
| NOT_OFFERABLE (vendido, reservado, bloqueado…) | NOT_OFFERABLE |

Também traz: situação e atualidade da disponibilidade, estado do preço (calculado pela tabela), atualidade do preço, se há plano de pagamento.

Regras:
- UNKNOWN nunca é ofertável: o cartão diz "Disponibilidade sujeita a confirmação".
- Disponível mas desatualizado vira NEEDS_CONFIRMATION, nunca "disponível agora".
- Lote não ofertável não entra na seleção sugerida. Se já estava numa seleção antiga, o `liveOverlay` marca "Recomendado anteriormente — atualmente vendido" sem apagar o histórico.
