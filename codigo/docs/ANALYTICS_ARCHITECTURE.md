# Arquitetura de Analytics — camada semântica (tópico 44)

**Princípio:** toda métrica tem definição única, versionada e testável. Nenhum KPI é calculado ad hoc em tela, relatório ou planilha. Analytics **lê** fatos; não decide estado de negócio, não altera jornada, preço, disponibilidade nem recomendação.

## Camadas
```
fontes (buffer local de eventos — tópico 45; domínio: jornada, share, recomendação — servidor)
  → fatos (FactProductEvent, FactProductSession, FactJourney*, FactShare*, FactRecommendation)
  → dimensões (registro fechado; UNKNOWN nunca redistribuído)
  → métricas (expressionRef fechado; numerador/denominador explícitos; 0/0 = null)
  → funis / coortes
  → AnalyticsQueryService (tenant obrigatório, só dimensões/filtros do registro, versão fixada)
  → MetricQualityResult (VALID / DEGRADED / INCOMPLETE / STALE / BLOCKED)
  → visão "Métricas locais" (modo Técnico) — formatação só na UI
```

## Módulos
| Arquivo | Global | Papel |
|---|---|---|
| `config/analytics/metrics.json` | `App.configs.analytics.metrics` | fonte única: fontes, fatos, dimensões, métricas, funis, coortes, dashboard |
| `src/analytics/semantic.js` | `App.semanticLayer` | registro + contratos, calculadoras fechadas, qualidade, query, funil, coorte, materialize/backfill, fuso, guardas de redação |
| `src/analytics/metricsView.js` | `App.metricsView` | view model + HTML da visão "Métricas locais" |
| `src/analytics/facade.js` | `App.analytics.view/html/semantic` | ponto de integração com a UI |
| `scripts/analyticsDocs.js` | — | gera `ANALYTICS_METRIC_CATALOG.md` a partir do registro (teste falha se desatualizado) |

## O que roda no aparelho e o que não roda
- **Calculado no aparelho** (`sourceType = ANALYTICAL_LOCAL`): métricas de uso do produto e de qualidade de dados, a partir do buffer local do tópico 45, por organização.
- **Não disponível no aparelho** (`BLOCKED` / `REQUIRES_BACKEND`): métricas comerciais (ganho, perda, conversão de estágio, tempo até primeiro contato, abertura de share, recomendação → visita). As calculadoras existem e são testadas com fatos de fixture; em produção dependem de fatos servidos pelo backend, que ainda não existe. Na tela aparecem como **"não disponível"**, nunca como 0.
- Produtor não conectado (evento do catálogo que nenhum ponto do app ainda emite) → `PRODUCER_NOT_WIRED` → "não disponível".

## Garantias
- Sem tenant → `TENANT_REQUIRED`. Buffers e consultas isolados por `organizationId`.
- Dimensão ou filtro fora do registro → `UNKNOWN_DIMENSION` / `DIMENSION_NOT_ALLOWED`.
- Versão pedida diferente da publicada → `UNSUPPORTED_METRIC_VERSION`.
- Fuso da organização (`America/Sao_Paulo` por padrão) define dia, semana ISO e mês.
- Arredondamento só na apresentação (`formatValue`); agregados guardam precisão bruta e numerador/denominador.
- Nenhuma métrica usa preço de lote, campo de cliente ou PII. Preço é sempre "preço de tabela" e não entra em analytics.
- Redação: `causalWordingIssues` bloqueia "causou/gerou/aumentou" em métricas de associação; `pricingWordingIssues` bloqueia "valorização/garantido" em textos.
