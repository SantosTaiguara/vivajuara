# DecisionCriterionRegistry

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

`criterionRegistry(devId)` monta a lista de critérios a partir do que já existe, sem duplicar:

- Prioridades: catálogo do Fit (`config/fit/<dev>.json`): `supportedAs: PREFERENCE`.
- Exigências: catálogo da recomendação (`config/recommendation/<dev>.json`): `supportedAs: CONSTRAINT` (ou BOTH quando o mesmo id existe nos dois).
- Somente exibição: `criteria.displayOnly` da política de decisão (preço por m², situação comercial).
- Categoria: `criteria.categoryByPrefix` (BUDGET, GEOMETRY, LOCATION, ENVIRONMENT, COMMERCIAL, INVESTMENT, LIFESTYLE, DATA_QUALITY) com ajustes em `criteria.overrides`.
- `clientSafe: false` para scores técnicos (Moradia, Família, Premium): não viram texto para o cliente.

Todo `fieldKey` é validado contra o registro de campos (`App.model.field`); `unknownFields` precisa ser vazio (teste). O construtor de exigências (`forConstraintBuilder`) só oferece exigências registradas: não há expressão livre.
