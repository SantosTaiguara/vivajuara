# Backfill e reprocessamento (tópico 44)

## API
- `App.semanticLayer.materialize(query, { events | client, facts, now })` → lista de `MetricAggregate` `{ metricCode, metricVersion, organizationId, periodStart, periodEnd, grain, dimensions, value, numerator, denominator, qualityStatus, computedAt, sourceWatermark }`.
- `App.semanticLayer.backfill({ query, events, facts, dryRun, now })` → `{ dryRun, transformationVersion, semanticBundle, inputEvents, uniqueEvents, aggregates, audit }`.

## Garantias
- **Idempotente**: eventos deduplicados por `eventId` (`uniqueEvents`) antes do cálculo; a mesma entrada duas vezes gera os mesmos agregados.
- **Dry-run por padrão**: `dryRun` é verdadeiro salvo `dryRun: false` explícito. Hoje não existe armazenamento de agregados; o resultado é devolvido, não gravado.
- **Versionado**: cada agregado leva `metricVersion`; o lote leva `transformationVersion` e o pacote semântico. Nova versão de métrica não sobrescreve agregados da versão anterior.
- **Evento atrasado**: entra no período do seu `occurredAt` (não do `capturedAt`); reprocessar o período o inclui.
- **Tenant**: backfill sempre por organização; auditoria registra quando e para qual organização.
- Precisão bruta nos agregados; arredondamento só na UI.

## Diferido (precisa de backend)
Tabela de agregados, views materializadas, job agendado, watermark de servidor e trilha de auditoria persistente no Postgres. O contrato acima é o que o backend deve respeitar.
