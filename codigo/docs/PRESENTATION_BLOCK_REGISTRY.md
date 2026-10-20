# Registro de Blocos

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

`App.presentationMode.domain.BLOCK_REGISTRY` — cada bloco tem `sourceDomain`, `configSchemaRef` (`block.<TIPO>.v1`), `projectionServiceId`, `supportsLive`, `supportsSnapshot`, `clientSafeByDefault`, `requiredPermission` e `configKeys`.

| Tipo | Fonte | Projeção |
|---|---|---|
| INTRO | DEVELOPMENT | título/texto (texto seguro, ≤120/600) |
| DEVELOPMENT_OVERVIEW | DEVELOPMENT | `developmentOverview` |
| CUSTOMER_OBJECTIVE | CUSTOMER | `customerObjective` (`showBudget` opcional) |
| RECOMMENDATION_SUMMARY | RECOMMENDATION | `recommendation` |
| LOT_HIGHLIGHT | LOT | `lotCard` |
| LOT_DETAILS | LOT | `lotDetails` |
| COMPARISON | COMPARISON | `comparison` |
| FINANCIAL_SIMULATION | FINANCIAL | `financial` |
| MAP | MAP | `map` |
| LOCATION | DEVELOPMENT | texto de localização permitido |
| AVAILABILITY_STATUS | AVAILABILITY | `availability` |
| INVESTMENT_CONTEXT | LOT | `investmentContext` (sem promessa de valorização) |
| ALERTS_CLIENT_SAFE | ALERTS | `alerts` (só nível cliente) |
| NEXT_STEPS | — | `nextSteps` |
| CUSTOM | — | texto seguro, sem HTML |

## Validação
`validateBlockConfig(block)`: chave desconhecida → `UNKNOWN_CONFIG_KEY`; tipo errado → `INVALID_CONFIG_VALUE`; tipo desconhecido → `UNSUPPORTED_BLOCK`. Não existe configuração livre.

## Templates
`TEMPLATES`: INITIAL_OPTIONS, SHORTLIST, COMPARISON, INVESTMENT_REVIEW, FINANCIAL_REVIEW, VISIT_PREPARATION. `expandTemplate` / `applyTemplate` geram blocos e storyline; `perLot` limita lotes; `criticality` (CRITICAL / IMPORTANT / OPTIONAL) influencia o preflight.
