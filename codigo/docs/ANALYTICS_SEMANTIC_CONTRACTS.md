# Contratos semânticos de métricas (tópico 44)

Cada métrica em `config/analytics/metrics.json → metrics` declara: `code`, `name`, `description`, `domain`, `entity`, `measureType` (COUNT, DISTINCT_COUNT, RATE, RATIO, AVERAGE, DURATION, PERCENTILE…), `expressionRef` (calculadora fechada), `params`, `numeratorMetricRef`/`denominatorMetricRef` (taxas), `timestampBasis`, `zeroDenominatorPolicy`, `dimensionsAllowed`, `version`, `status` (DRAFT / PUBLISHED / DEPRECATED), `caveats`, `associationOnly`, `lineage`.

O catálogo completo, com fórmula, base de tempo e disponibilidade, é gerado em `ANALYTICS_METRIC_CATALOG.md`.

## Regras verificadas por `contractErrors` (teste `semantic registry: contracts pass`)
1. Código único, `snake_case`, versão inteira.
2. `expressionRef` pertence ao conjunto fechado de calculadoras; não há fórmula livre, SQL ou `eval`.
3. Toda taxa (`RATE`) tem numerador e denominador explícitos, ambos métricas registradas.
4. `zeroDenominatorPolicy = NULL`: 0/0 é **N/A**, nunca 0 nem 100%.
5. `timestampBasis` explícito (ex.: ganho por `closedAt`, abertura de share por coorte de `issuedAt`).
6. Métrica PUBLISHED não pode ter `expressionRef = blocked` (ex.: `cost_per_win` fica DRAFT até existir fonte de custo).
7. Dimensões permitidas existem no registro.
8. Eventos citados em `params.events` existem no catálogo do tópico 45.
9. Linhagem declarada (fatos de origem → transformações).

## Versionamento
- Mudança de fórmula, denominador, janela ou base de tempo = nova versão. Agregados guardam `metricVersion`.
- Consultas podem fixar versão (`metricVersions`); versão divergente → `UNSUPPORTED_METRIC_VERSION`.
- `bundle()` devolve o pacote semântico (versões de métricas, funis, dimensões e transformação) gravado em cada resultado.

## Rótulos de valor
| Qualidade | Rótulo exibido |
|---|---|
| VALID | calculado |
| DEGRADED | calculado com ressalva |
| INCOMPLETE | dados incompletos |
| STALE | desatualizado |
| BLOCKED | não disponível |

Nenhuma métrica local é "confirmada": ela mede o uso registrado neste aparelho. Métricas comerciais só poderão ser "confirmadas" depois da validação humana das definições (decisão D8).

## Redação
- Métricas `associationOnly` (ex.: `recommendation_to_visit_rate`) mostram "associação/sequência — não é efeito causal". `causalWordingIssues(texto)` acusa "causou", "gerou", "aumentou as vendas" etc.
- `pricingWordingIssues(texto)` acusa promessa de valorização ou retorno; preço é sempre "preço de tabela" e não é métrica.
