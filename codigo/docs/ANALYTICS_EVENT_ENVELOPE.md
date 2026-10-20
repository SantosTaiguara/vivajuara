# Envelope de evento (`analytics-envelope/1`)

```ts
interface AnalyticsEventEnvelope {
  eventId: string;              // UUID v4 (crypto.randomUUID quando houver)
  eventName: string; eventVersion: number;
  organizationId: string;       // sempre do ContextProvider (tenant autoritativo); o payload não pode trocar
  occurredAt: string;           // quando aconteceu (ctx.occurredAt para eventos tardios / domínio)
  capturedAt: string;           // quando o cliente registrou — nunca sobrescreve occurredAt
  actor: { actorType: 'USER'|'ANONYMOUS'|'SYSTEM'; userId?; anonymousId?; customerId? };
  session: { productSessionId; presentationSessionId?; shareAccessSessionId?; journeyId? };
  navigation: { routeCode?; navigationSource? };      // código sanitizado, nunca URL
  device: { deviceClass: 'DESKTOP'|'TABLET'|'MOBILE'|'EXTERNAL_DISPLAY'|'UNKNOWN'; viewportClass?; inputMode?; locale?; timezone? };
  app: { appVersion; buildId?; environment: 'PRODUCTION'|'STAGING'|'DEVELOPMENT'|'TEST'; platform: 'WEB'|'PWA'; featureFlags? };
  entity: { developmentId?; lotId?; lotRef?; customerId?; journeyId?; comparisonId?; recommendationResultId?; presentationSnapshotId?; shareGrantId?; financialSimulationId? };
  payload: { ...propriedades tipadas do catálogo };
  privacy: { consentState; piiClass; purposeCodes };
  source: 'WEB_CLIENT'|'SERVER'|'DOMAIN_BRIDGE'|'SHARE_RUNTIME'|'PRESENTATION_RUNTIME'|'INTEGRATION';
  idempotencyKey?; correlationId?; causationId?;
  schemaVersion: 'analytics-envelope/1';
  category; eventClass; priority; sequenceNumber;  // auxiliares locais (ordem do produtor, nunca sequência global)
}
```

Regras:
- `receivedAt`, `ingestedAt` e `processedAt` são do servidor (contrato em `ANALYTICS_INGESTION_AND_DEDUPLICATION.md`).
- `customerId`/`journeyId` só entram em eventos de classe `PSEUDONYMOUS`; eventos `NONE` nunca os carregam.
- `anonymousId` só existe sem usuário autenticado e vale para a sessão de produto (sem ID persistente, D5).
- `lotRef` é o código curto do lote (não é PII).
- Tokens de compartilhamento/autenticação nunca entram: não há campo para eles e os detectores de valor rejeitam (`BEARER`, `JWT`, `LONG_SECRET`, `/s/<token>`).
- Tamanho máximo do envelope: 4096 bytes (`PAYLOAD_TOO_LARGE` → quarentena).
