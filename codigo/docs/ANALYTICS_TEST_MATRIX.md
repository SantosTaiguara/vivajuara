# Matriz de testes — camada semântica (tópico 44)

Arquivo: `plat/tests/analytics.test.js` (34 testes no total, compartilhado com o tópico 45). Executar: `cd plat/tests && npm test`.

| Teste | Cobre |
|---|---|
| semantic registry: contracts pass | contratos, numerador/denominador, 0/0 null, base de tempo, eventos citados existem |
| AnalyticsJourneyWinRate + AnalyticsZeroDenominator | 6/10 = 60%; 0 fechadas → N/A |
| AnalyticsShareOpenRate + AnalyticsShareTimeToFirstOpen | coorte de emissão; reaberturas e prévias de bot não contam |
| AnalyticsStageConversion + AnalyticsTimeInStage | A→B sobre quem entrou em A (dedupe); versão do modelo de estágios |
| AnalyticsMedianTimeToFirstContact + AnalyticsLateArrivingEvent | eventos de sistema excluídos; contato atrasado entra pelo occurredAt |
| AnalyticsRecommendationToVisit + …WinAssociation + AnalyticsSourceWinRate | associação, sem linguagem causal |
| AnalyticsCampaignCohort | ganho tardio fica na coorte; coortes imaturas sinalizadas |
| product metrics from the local buffer | sessões, lotes vistos, distintos, taxas com denominador explícito |
| AnalyticsPresentationCompletionRate | coorte de iniciadas ∩ conclusão explícita |
| AnalyticsJourneyFunnel + product funnel | uma entidade por etapa, primeira conquista, conversões |
| AnalyticsTimezoneBoundary + daily series | 01:30 UTC do dia 11 é dia 10 em São Paulo |
| AnalyticsBackfillIdempotent + AnalyticsMetricVersionChange + AnalyticsCrossTenantIsolation | idempotência, versão, isolamento por tenant |
| data quality metrics and states | drop/quarentena/amostragem; estados de qualidade |
| "Métricas locais" view model | só modo Técnico, aviso de não envio, destinos desligados, KPIs bloqueados como "não disponível" |
| generated docs and TypeScript types are up to date | catálogo gerado igual ao registro |

Não testável aqui: agregados no Postgres, views materializadas, jobs de backfill no servidor (sem banco neste ambiente).
