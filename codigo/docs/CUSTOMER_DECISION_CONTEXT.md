# CustomerDecisionContext

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

Projeção operacional para decidir naquele momento. **Não é o Customer.**

`buildContext({ organizationId, developmentId, customer?, ui?, adHoc?, budget?, commercial?, journey?, dataVersions })` devolve um objeto congelado com:

| Campo | Origem |
|---|---|
| `customerId`, `customerProfileVersionId` | só quando há Customer persistido (id opaco; e-mail ou telefone como id é recusado) |
| `adHocProfileId` | perfil temporário (sem Customer), nunca vira Customer sozinho |
| `objective` | HOUSING / INVESTMENT / UNDECIDED. `objectiveInformed` diz se foi informado. Preset sem objetivo claro (ex.: "premium") vira UNDECIDED, nunca é adivinhado |
| `constraints[]` | exigências (`key`, `metricKey`, `operator`, `expectedValue`, `origin`: CUSTOMER_EXPLICIT, BROKER_CONFIRMED, IMPORTED_CONFIRMED) |
| `preferences[]` | prioridades (`key`, `fieldKey`, `importance`, `source`) |
| `budgetProfile` | `CustomerBudgetProfile` em centavos (`maxMinor`); `source` CUSTOMER_DECLARED, BROKER_RECORDED, ESTIMATED ou UNKNOWN. Estimado continua estimado |
| `commercialContext` | revisão de disponibilidade e versão da tabela; prazo, flexibilidade, urgência e estágio quando informados (sem valor inventado: não informado = UNKNOWN ou null) |
| `recommendationPolicyVersion`, `fitMethodologyVersion`, `decisionPolicyVersion`, `contextRef` | versões e referência determinística (checksum sem PII) |

## Sem e com Customer

- Sem Customer: usa o estado atual do painel (`st.preferences`, `st.constraints`, `st.objective`). É o modo de "atendimento rápido".
- Com Customer: usa a versão exata do perfil (`App.customer.domain.toUiState(version)`), o orçamento declarado (`budgetProfile` da versão) e a origem de cada exigência.

## Paridade

`engineInputs(context)` monta o `CustomerProfile` e as restrições exatamente como `state/selectors.js`. O teste de paridade compara `profileVersion`, restrições, rank, tier e Fit com o resultado do seletor.

## Validação

`validate(context)`: INVALID (exigências em conflito ou perfil inválido), INSUFFICIENT_CONTEXT (nenhuma prioridade e nenhuma exigência), READY_WITH_WARNINGS (perfil parcial, sem orçamento, orçamento estimado, objetivo não informado), READY. Perfil parcial não bloqueia: a tela diz "Recomendação baseada em perfil parcial".
