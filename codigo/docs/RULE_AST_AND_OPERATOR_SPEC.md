# AST de regras, operandos e operadores (Tópico 36)

## Nós (`RuleConditionNode`)

| type | Campos | Semântica |
|---|---|---|
| LOGICAL | operator AND/OR/NOT, children | lógica de Kleene: AND = FALSE se algum FALSE, senão ERROR, senão UNKNOWN; OR = TRUE se algum TRUE, senão ERROR, senão UNKNOWN; NOT inverte TRUE/FALSE e preserva o resto |
| COMPARISON | left, operator, right | operando sem valor → UNKNOWN; operando ERROR (ex.: NaN) → ERROR |
| EXISTS | operand, expected | presença conhecida → TRUE/FALSE; fonte não fornecida → UNKNOWN |
| PREDICATE | predicateId, args, config | só predicados registrados |

Profundidade máxima 32. Qualquer outro `type` é erro de validação (`UNKNOWN_NODE_TYPE`).

## Operadores (registry fechado)

EQ, NEQ, GT, GTE, LT, LTE, BETWEEN (lista [min,max], inclusivo), IN, NOT_IN. GT/GTE/LT/LTE só para NUMBER/DATETIME; IN/NOT_IN/BETWEEN exigem lista à direita.

## Operandos

| type | Origem | Validação |
|---|---|---|
| ATTRIBUTE | `attributePath` do Field Registry (`App.model.field`) | caminho inexistente → `UNKNOWN_FIELD` |
| METRIC | `metricId` do RuleMetricRegistry (versionado, com domínio e fieldKey) | não registrado → `UNKNOWN_METRIC` |
| CONFIG | `key` em `RuleVersion.parameters` (limites ficam na versão) | ausente → `UNKNOWN_CONFIG_KEY` |
| LITERAL | `value` + `valueType` | tipo conferido |
| CONTEXT | AS_OF, AUDIENCE, CUSTOMER_BUDGET_MAX | CUSTOMER_* só em regra de contexto CUSTOMER |
| ITEM | campo do item, só dentro de template de lista | fora de lista → erro |

### Métricas registradas (v1.0)

ANALYSIS_NOTE_QUIET/PRIVACY/GEOMETRY (notas sem arredondamento), STRONG_AFTERNOON_SUN/SIDE, DISTANCE_TECHNICAL_AREA_M, DISTANCE_EXTERNAL_ROAD_M, ADJACENT_PROJECTED_EASEMENT, ESTIMATED_TRAFFIC, FRONT_WIDTH_M, SHAPE_CLASS, IS_CORNER, HAS_TWO_FRONTS, REAR_CLASS, AREA_M2, NOISE_SOURCES (domínio ANALYSIS → LOT_INTELLIGENCE_BASE); COMMERCIAL_FRESHNESS_TRACKED, COMMERCIAL_FRESHNESS (domínio PRICING). Os valores vêm do `LotAnalysisResult` (campo aditivo `metrics` do IntelligenceEngine) e do Lot canônico — montados fora do motor por `App.alerts.facts`.

### Predicados

- `IS_NOT_CONFIRMED_FRESH(v)`: TRUE para tudo que não é `FRESH`, inclusive `null` — a ausência de confirmação **é** a condição (semântica explícita, não "null = false").
- `IS_OFFERABLE(status)`: `App.availability.isOfferable`; status ausente → UNKNOWN; UNKNOWN nunca é ofertável.

## Severidade

`STATIC { severity }` ou `THRESHOLD_BASED { operand, bands: [{ lt, severity }…] }`. Enum da plataforma mantido: INFO / ATTENTION / IMPORTANT / CRITICAL.

## Templates de mensagem (`AlertMessageTemplate`)

Por público (`DEFAULT`, `BROKER`, `CLIENT`, `TECHNICAL`), lista de segmentos: `{text}`, `{value, format, map?, default?, enum?}`, `{when, then, else}` (usa o mesmo AST), `{list, separator, item}`, `{group, format}`. Formatadores registrados: RAW, LOWER, FIXED_0, FIXED_1 (semântica Python, `App.imath.toFixedPy`), MAP, I18N_LOWER, AGE (usa `context.asOf`). Texto com `<` ou `>` é recusado. Valor ausente vira "não disponível", nunca 0.
