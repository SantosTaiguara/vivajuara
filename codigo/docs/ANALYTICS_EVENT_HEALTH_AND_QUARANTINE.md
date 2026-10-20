# Saúde dos eventos e quarentena

## AnalyticsEventHealthSummary (`client.health()`)
`captured`, `accepted`, `duplicated`, `quarantined`, `sampledOut`, `notCaptured` (consentimento), `dropped` + `droppedByReason` (`LOCAL_BUFFER_OVERFLOW`, `OUTBOX_OVERFLOW`, `RETRY_EXHAUSTED`, `EXPIRED`, `OFFLINE_EXPIRED`, `QUARANTINE_OVERFLOW`, `INTERNAL_ERROR`), `propertiesDropped`, `purgedByConsent`, `sent`, `acceptedRemote`, `duplicatedRemote`, `rejectedRemote`, `deliveryFailures`, `lastDeliveryLagMs`, `truncatedBefore`, taxas (`acceptRate`, `duplicateRate`, `quarantineRate`, `dropRate`, `sampledOutRate`), destinos remotos ligados. Alimenta as métricas `analytics_event_drop_rate`, `analytics_quarantine_rate`, `analytics_sampled_out_rate` (tópico 44, domínio DATA_QUALITY).

## Quarentena (`client.quarantined(org)`)
Motivos: `UNKNOWN_EVENT`, `UNSUPPORTED_VERSION`, `NOT_PUBLISHED`, `PRODUCER_NOT_ALLOWED`, `TENANT_MISMATCH`, `TENANT_UNRESOLVED`, `SCHEMA_INVALID`, `INVALID_ENUM`, `PRIVACY_VIOLATION`, `PAYLOAD_TOO_LARGE`, `INVALID_TIMESTAMP`, `SERVER_REJECTED`. Cada registro guarda nome, versão, motivo, **caminhos** dos problemas, fonte e horário — nunca o valor ofensivo. Limite 200 por organização (excedente contado). Fluxo: diagnosticar → corrigir/migrar → reprocessar (servidor).

## Autodiagnóstico
`client.diagnostics()`: `analytics_transport_failure`, `analytics_buffer_overflow`, `analytics_schema_rejection`, `analytics_persistence_failure` — observabilidade do rastreador, separada dos eventos de produto. Alta taxa de inválidos deve virar Security Event no servidor (fora do escopo do cliente).

## Debug
`client.debugRecent(n)`: nome, versão, destinos; payload só fora de produção. A visão “Métricas locais” só aparece no modo Técnico.
