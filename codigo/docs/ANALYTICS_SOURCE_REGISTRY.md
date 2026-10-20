# Registro de fontes analíticas (tópico 44)

Fonte = origem de fatos. Cada fonte declara domínio, tipo, serviço dono, timestamp principal e chave de tenant (`organizationId`). Definidas em `config/analytics/metrics.json → sources`.

| sourceCode | Domínio | Tipo | Dono | Timestamp | Disponível no aparelho |
|---|---|---|---|---|---|
| `LOCAL_EVENT_BUFFER` | PRODUCT_USAGE | ANALYTICS_EVENT_BUFFER | App.analytics (tópico 45) | occurredAt | sim |
| `TRACKER_HEALTH` | PRODUCT_USAGE | COUNTERS | App.analytics.tracker | capturedAt | sim |
| `JOURNEY_STAGE_TRANSITIONS` | JOURNEY | DOMAIN_EVENT | jornada (tópico 40) | occurredAt | não (servidor) |
| `JOURNEY_OUTCOMES` | JOURNEY | DOMAIN_EVENT | jornada (tópico 40) | closedAt | não (servidor) |
| `JOURNEY_ACQUISITION` | MARKETING | TABLE | jornada (JourneyAcquisitionContext) | acquiredAt | não (servidor) |
| `JOURNEY_TOUCHPOINTS` | JOURNEY | DOMAIN_EVENT | jornada (touchpoints) | occurredAt | não (servidor) |
| `SHARE_GRANTS` | SHARE | TABLE | share (tópico 42) | issuedAt | não (servidor) |
| `SHARE_ACCESS_SESSIONS` | SHARE | TABLE | share (ShareAccessService) | openedAt | não (servidor) |
| `RECOMMENDATION_RESULTS` | RECOMMENDATION | SNAPSHOT | recomendação (tópico 16) | generatedAt | não (servidor) |

## Regras
- Fonte sem chave de tenant é rejeitada pelos testes de contrato.
- O buffer local é a única fonte disponível hoje. Ele é **amostral do uso deste aparelho**, não do produto inteiro: os números são "calculado" sobre este aparelho/navegador, nunca "confirmado" para a empresa.
- Fontes de domínio exigem backend (ingestão first-party, decisão D2). Até lá, toda métrica que depende delas fica `BLOCKED` com `REQUIRES_BACKEND`.
- Não há fonte de terceiros (GA, Meta). Dados de marketing de terceiros não alimentam métricas (decisão D3).
