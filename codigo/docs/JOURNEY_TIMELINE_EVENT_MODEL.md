# Timeline e eventos (Tópico 40)

## JourneyEvent

`{ id, organizationId, journeyId, customerId, type, category, occurredAt, recordedAt, actorType, actorRef?, source, subjectRef?, summaryCode, payload, visibility, idempotencyKey?, correlationId? }` — congelado, append-only (`appendEvent` é idempotente por `idempotencyKey`).

Regras em `makeEvent`: tipo do registro (`UNKNOWN_EVENT_TYPE`); fonte permitida pelo tipo; `actorType: CUSTOMER` só com prova (`CUSTOMER_ACTOR_UNPROVEN`); payload só com as chaves do registro (`PAYLOAD_KEY_NOT_ALLOWED`); conteúdo bruto (`message`, `body`, `transcript`, `recording`, `fileName`, `matrix`, `price`, `status`…) recusado (`RAW_CONTENT_NOT_ALLOWED`); strings com telefone/e-mail recusadas (`CONTAINS_CONTACT_DATA`); `occurredAt` futuro recusado; visibilidade padrão `INTERNAL`, `CLIENT_SAFE` só para tipos `clientVisible`.

## Registro de tipos (32, `eventTypes`)

Cada tipo: `code`, `category`, `title` (pt-BR), `allowedSources`, `clientVisible`, `countsAsMeaningfulActivity`, `customerTouch`, `brokerAction`, `stageSuggestion`, `actionSuggestion`, `retentionClass`, `payload { required, allowed }`. Ex.: `CUSTOMER_CONTACTED` (toque do cliente; sugere CONTACTED), `RECOMMENDATION_GENERATED` (não conta como atividade), `RECOMMENDATION_PRESENTED` (cliente; sugere SHORTLISTED), `VISIT_COMPLETED` (sugere VISITED e follow-up em 24 h), `CRM_SYNC_COMPLETED` (técnico; nunca "último contato"), `MIGRATED_TO_STAGE` (baseline de migração).

## Ingestão (`ingestionPolicies`)

Domain event → política → resolve jornada (explícita, ou única ACTIVE do cliente no empreendimento; ambígua/ausente → `UNRESOLVED`) → tenant/cliente conferidos → deduplicação (`<tipo>:<id>`; `COALESCE_BY_SUBJECT` para atualizações de comparação) → payload minimizado → evento + sugestões. Ignorados: `LotHovered`, `LotClicked`, `QuickViewOpened`, `MapPanned`, `FilterChanged`, `ComparisonCandidatesReordered`, qualquer tipo sem política, favorito fora do contexto CUSTOMER, apresentação não confirmada.

## Projeção (`timeline`)

Ordem por `occurredAt` (evento tardio entra no lugar certo; `recordedAt` só em TECHNICAL), paginação por cursor, textos por template do registro (sem HTML), correções aplicadas na projeção (`corrected: true`) e original preservado. Modos: BROKER/MANAGER (INTERNAL, ASSIGNED_TEAM, CLIENT_SAFE), CLIENT_SAFE (só tipos/eventos client-safe, sem ator), TECHNICAL (tudo, inclusive payload e idempotência).

## Atividade

`activitySummary` → `lastMeaningfulEventAt`, `lastCustomerTouchAt`, `lastBrokerActionAt` pelos flags do registro (sync técnico não conta). Tempo em etapa é derivável das transições (não persistido).
