# Ingestão e deduplicação

## Cliente (implementado)
| Modo | Uso | Chave |
|---|---|---|
| `EVENT_ID` (padrão) | retry do mesmo envelope | `eventId` |
| `IDEMPOTENCY_KEY` | Domain Bridge / servidor | `idDoEventoDeDomínio\|nome\|vN` |
| `SESSION_ONCE` | `app_opened`, `map_viewed`, `presentation_started`, `presentation_step_viewed` (por etapa), `presentation_completed` | nome + campos da chave |
| `ENTITY_WINDOW` | `filter_applied`, `customer_constraint_changed` (1 s), `layer_opacity_changed` (1,5 s), `desktop_panel_resized` (2 s) | nome + sessão + campos |
| `ON_CHANGE` (extensão) | `lot_selected`: reseleção do mesmo lote (re-render, efeito duplicado) não conta; A→B→A conta 3 | nome + sessão + lote |
`lot_selected` nunca é deduplicado por lote de forma ingênua. Chaves guardadas em LRU (5000) por organização.

## Domain Event Analytics Bridge
Registro explícito (`App.eventTracking.DOMAIN_MAPPINGS`): `PresentationSnapshotCreated`, `PresentationStarted`, `PresentationStepViewed`, `PresentationFeedbackRecorded`, `PresentationCompleted`, `FavoriteAdded`, `FavoriteRemoved`, `JourneyClosedWon`, `ShareGrantIssued`, `share_opened`, `share_feedback_submitted`. Nem todo evento de domínio vira analytics (`PresentationEnded` → `NOT_MAPPED`). Transformadores levam só refs opacas e códigos (nunca notas, texto livre, tokens). Prévia de robô em `share_opened` → `EXCLUDED`. Reingestão é idempotente (`App.analytics.syncDomainEvents()` pode ser chamado sempre).

## Servidor (contrato — não implementado aqui, sem backend/Postgres)
`POST /api/v1/analytics/events` com `{ events: AnalyticsEventEnvelope[], clientBatchId }` → `{ accepted: eventId[], duplicated: eventId[], rejected: [{ eventId, reason }], serverReceivedAt }`.
Etapas: autenticar origem → **derivar o tenant da sessão** (app interno) ou do `ShareGrant/ShareAccessSession` (runtime público) — nunca confiar no `organizationId` do navegador → validar envelope e contrato (mesmo `events.json`) → privacidade → dedupe (`eventId`, `idempotencyKey`) → `RawAnalyticsEvent` append-only (`receivedAt`, `ingestionStatus ACCEPTED|DUPLICATE|QUARANTINED`) → rotear destinos → responder. Evento aceito é imutável; correção é a jusante. Endpoints privilegiados: `GET …/catalog`, `…/health`, `…/quarantine`, `POST …/reprocess` (permissões `analytics.events.*`, D6). Nenhum endpoint de raw event para usuário comum.
