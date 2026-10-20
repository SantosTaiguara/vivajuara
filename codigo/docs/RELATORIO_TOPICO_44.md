# Relatório — Tópico 44: Analytics (métricas, funis, camada semântica)

## Entregue
- `config/analytics/metrics.json`: 9 fontes, 9 fatos, 13 dimensões, cerca de 40 métricas, 3 funis, 3 coortes, dashboard `local_product_usage`.
- `src/analytics/semantic.js` (`App.semanticLayer`): registro com contratos, calculadoras fechadas (sem fórmula livre), qualidade VALID/DEGRADED/INCOMPLETE/STALE/BLOCKED, `query` (tenant obrigatório, dimensões e filtros só do registro, versão fixada, período de comparação), `funnel`, `cohort`, `materialize`/`backfill` idempotentes, fuso `America/Sao_Paulo`, supressão de grupos pequenos, guardas de redação causal e de preço.
- `src/analytics/metricsView.js` (`App.metricsView`): view model e HTML da visão "Métricas locais", só no modo Técnico.
- `scripts/analyticsDocs.js`: gera `ANALYTICS_METRIC_CATALOG.md`.
- Documentos: ANALYTICS_ARCHITECTURE, _SOURCE_REGISTRY, _FACTS_AND_DIMENSIONS, _SEMANTIC_CONTRACTS, _FUNNEL_AND_COHORT_MODEL, _DATA_QUALITY_POLICY, _PRIVACY_AND_ACCESS_POLICY, _BACKFILL_AND_REPROCESSING, _LEGACY_METRIC_MIGRATION_REPORT, _TEST_MATRIX, _METRIC_CATALOG (gerado).

## Situação dos valores
- Métricas de uso do produto e de qualidade de dados: **calculado** a partir do buffer local deste aparelho, por organização. Não representam o uso da empresa inteira.
- Métricas comerciais (ganho, perda, conversão de estágio, tempo até contato, abertura de share, recomendação → visita): **não disponível** no aparelho (`REQUIRES_BACKEND`). Calculadoras testadas com fixtures.
- `cost_per_win`: DRAFT, bloqueada (não há fonte de custo).
- Nenhum valor inventado. 0/0 = N/A. UNKNOWN nunca redistribuído. Preço não é métrica.

## Não alterado
IDs de lote, geometria, scores, classes, metodologia, preço de tabela (R$ 1.196/m², tabela 2026-10-06), regras financeiras e solares, disponibilidade (UNKNOWN para os 498 lotes).

## Diferido (precisa de backend ou decisão humana)
- Fatos comerciais servidos pelo backend (jornada, share, recomendação).
- Schema analítico no Postgres, tabela de agregados, views materializadas, jobs de backfill agendados.
- Permissões `analytics.view` / `analytics.export` / `analytics.viewSensitive` (D6).
- Validação humana das definições comerciais (D8). Até lá nenhuma métrica comercial é "confirmada".
- Integração da visão na UI (painel técnico) e registro das ações em `features.json` (fora da minha área).

## Testes
`tests/analytics.test.js`: 34 testes (tópicos 44 e 45). Suíte completa: 871/871.
