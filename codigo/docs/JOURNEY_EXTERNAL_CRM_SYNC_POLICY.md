# CRM externo e jornada (Tópico 40)

- `JourneyExternalRef { provider, externalJourneyId?, externalLeadId?, externalOpportunityId?, authorityMode }` (mesmos modos do Customer).
- `JourneyStageMappingPolicy { provider, internalStageId, externalStageCode, direction IMPORT|EXPORT|BIDIRECTIONAL, conflictMode INTERNAL_WINS|EXTERNAL_WINS|MANUAL_REVIEW }` — `stageMappingPolicies: []` na configuração (nenhum mapeamento inventado).
- `applyExternalStage(journey, { provider, externalStageCode, externalEventId })`:
  - repetição do mesmo evento → `DUPLICATE` (idempotência por `provider:externalEventId`);
  - etapa externa sem mapeamento → `JourneySyncConflict` `UNMAPPED_EXTERNAL_STAGE` (nunca mapeada para etapa arbitrária);
  - autoridade interna / REFERENCE_ONLY / INTERNAL_WINS → conflito `IGNORED`;
  - HYBRID ou MANUAL_REVIEW → conflito `OPEN`;
  - EXTERNAL_MASTER + EXTERNAL_WINS → transição normal (precisa ser válida no grafo), ator `INTEGRATION`, fonte `CRM_SYNC`.
- Conflitos sem PII (só ids de etapa e código externo).
- Exportação para CRM não implementada (sem API oficial).

## API proposta (backend não implementado)

```
POST  /api/v1/organizations/{orgId}/customers/{customerId}/journeys
GET   /customers/{customerId}/journeys                     (SUMMARY)
GET   /journeys/{journeyId}
POST  /journeys/{journeyId}/stage-transitions   { toStageId, reasonCode?, note?, expectedRevision, idempotencyKey }
POST  /journeys/{journeyId}/pause | /resume | /outcome
GET   /journeys/{journeyId}/timeline?cursor=
POST  /journeys/{journeyId}/touchpoints
POST  /journeys/{journeyId}/next-actions ; PATCH /journeys/{journeyId}/next-actions/{actionId}
POST  /journeys/{journeyId}/links
GET   /journey-stage-models/current
```
DTOs = `summary()`, `timeline()` items, `allowedMoves()`, `createNextAction().nextAction`, `closeOutcome().outcome`, `createAcquisition().acquisition`, `recordTouchpoint().touchpoint`, sugestões, `linkArtifact().link`. Tabelas sugeridas: `customer_journeys`, `journey_stage_model_definitions`, `journey_stage_model_versions`, `journey_stage_transitions`, `journey_events` (payload JSONB validado pelo registro; índice `journey_id, occurred_at DESC`; único por idempotency key), `journey_touchpoints`, `journey_next_actions`, `journey_action_suggestions`, `journey_stage_suggestions`, `journey_outcomes`, `journey_pause_records`, `journey_artifact_links`, `journey_acquisition_contexts`, `journey_assignments`, `journey_external_refs`, `journey_sync_conflicts`.
