# Arquitetura da Jornada do Cliente (Tópico 40)

Código: `src/journey/journeyDomain.js` (`App.journey.domain`), `src/journey/journeyServices.js` (`App.journey.services`), painel em `src/customer/customerView.js`. Configuração: `config/journey/policy.json` (`App.configs.journey.policy`). Testes: `tests/journey.test.js`.

`CustomerJourney` = jornada comercial de **um** Customer em relação a **um** empreendimento/intenção. Um cliente pode ter várias (por empreendimento, por tipo, históricas).

```
Snapshot mutável da jornada (currentStageId, lifecycle, revision)
+ JourneyEvent append-only (timeline)
+ JourneyStageTransition append-only (histórico de etapa)
```
Sem framework de event sourcing.

## Separações

| | |
|---|---|
| Customer ≠ Journey | identidade/perfil vs processo comercial |
| `CustomerLifecycleStatus` ≠ `JourneyLifecycleStatus` | cliente ACTIVE pode ter jornada CLOSED_LOST |
| Lifecycle (ACTIVE, PAUSED, CLOSED_WON, CLOSED_LOST, ARCHIVED) ≠ Stage | macroestado vs etapa fina configurável |
| Journey ≠ Recommendation / Favorite / Comparison / Simulation / Document / Proposal / Reservation | só referências (`JourneyArtifactLink`, `subjectRef`) |
| Timeline ≠ Analytics | hover/clique/pan/filtro nunca entram (ingestão os ignora) |
| Timeline ≠ Audit | `audit()` dos serviços é separado e sem PII |

## Entidades

`CustomerJourney`, `JourneyStageModelDefinition`, `JourneyStageModelVersion`, `JourneyStageDefinition`, `JourneyStageTransitionDefinition`, `JourneyStageTransition`, `JourneyEvent`, `JourneyEventTypeRegistry`, `JourneyEventIngestionPolicy`, `JourneyAcquisitionContext`/`JourneyAttributionTouch`, `JourneySourceRegistry`, `JourneyTouchpoint`, `JourneyNextAction` (+ read state derivado), `JourneyActionSuggestion`, `JourneyStageSuggestion`, `JourneyAttentionState`, `JourneyOutcome`, `JourneyLossReasonRegistry`, `JourneyPauseRecord`, `JourneyArtifactLink`, `JourneySubjectRef`, `JourneyTimelineProjection`, `JourneyEventCorrection`, `JourneyAssignment`, `JourneyAutomationPolicy`, `JourneyAgingPolicy`, `JourneyOfflinePolicy`, `JourneyUniquenessPolicy`, `JourneyExternalRef`/`JourneyStageMappingPolicy`/`JourneySyncConflict`, `JourneyQuery`/`JourneyBoardReadModel`/`JourneySummaryReadModel`, `ActiveJourneyContext`, `LegacyJourneyInventoryItem`, `JourneyDuplicateCandidate`, `JourneyStageModelImpactReport`, `JourneyStageMigrationPlan`.

## Serviços (`App.journey.services.services(store, { principal, can, connectivity, customerAssignments })`)

`application` (create, get, pause, resume, link, resolveActive), `stage` (transition, acceptSuggestion, dismissSuggestion, history), `outcome` (close), `timeline` (record touchpoint, presentOption, correct, page), `nextAction` (create, complete, cancel, acceptSuggestion, suggestions), `ingestion` (ingest), `attribution` (capture, latest), `crm` (applyStage, conflicts), `board`. Repositório `JourneyRepository` com compare-and-set de revisão: transição = validar → inserir transição → atualizar etapa → revisão+1 → evento, tudo ou nada. Armazenamento só em memória (`JourneyStore.clear()` em logout/troca de organização).

## Integrações

Recommendation (`RecommendationGenerated` ≠ `RecommendationPresented`, este só com `presentationConfirmed`), Favoritos (só contexto CUSTOMER), Comparação (criação + atualizações coalescidas em 60 min; reordenação ignorada), Simulação (`FinancialSimulationCreated`), Documentos (ref; nome de arquivo nunca copiado), Reserva (ref; nunca altera disponibilidade nem fecha a jornada sozinha), Perfil (`CustomerPreferenceProfileUpdated` → `PROFILE_UPDATED` com sugestão de etapa PROFILED, sem auto-transição). Mapa: chip "Maria · Negociação"; QuickView: "Registrar como opção apresentada" (ação explícita; abrir o lote não registra nada).

## Para o Tópico 41

`customerId`, `journeyId`, `profileVersionId` (via evento PROFILE_UPDATED/snapshot), refs de favoritos/comparações/recomendações/simulações (`links`), timeline `CLIENT_SAFE` (`timeline(j, { mode: 'CLIENT_SAFE' })`).
