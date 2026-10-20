# Migração do pipeline legado (Tópico 40)

## Inventário

Busca por `lead`, `pipeline`, `stage`, `status`, `followup`, `timeline`, `interaction`, `activity`, `history`, `source`, `origin`, `campaign`, `contacted`, `proposal`, `visit`, `won`, `lost` em `src/`, `config/` e `backend/src`:

- **Nenhum pipeline comercial, etapa de lead, follow-up, motivo de perda, origem/campanha ou histórico de atendimento existe hoje.** Ocorrências encontradas são de outros domínios: `PIPELINE` do motor de análise (`intelligence/engine.js`), pipeline da Recommendation, `status` de disponibilidade dos lotes (todos UNKNOWN), "lead" num comentário de `pricingView.js`.
- O único dado comercial por cliente é `state.customers[].lots` (lotes guardados), que o tópico 39 migra para favoritos de contexto CUSTOMER — **não** é mapeado para etapa (§402).
- Lifecycle do cliente não é mapeado para etapa (§401).

Consequência: o "Stage Model V1" não codifica um pipeline existente; é o template técnico do spec, publicado com `requiresHumanValidation: true`. Nenhuma jornada é criada automaticamente para os clientes legados.

## Ferramentas para quando houver base legada (ex.: export de CRM)

- `inventory(records, { stageField, stageMap })` → `LegacyJourneyInventoryItem` com `migrationMappingCertainty` (não é Data Confidence do tópico 34) e `requiresHumanReview`.
- `migrateLegacy(records, { organizationId, model, stageMap, sourceMap, existingIds, migrationVersion })`:
  - etapa só por mapa explícito; desconhecida → `unresolvedStages` (não migrada);
  - baseline única `MIGRATED_TO_STAGE` com `legacyCurrentStage` e `historyUnavailable: true` — sem transições anteriores fabricadas;
  - `createdAt` desconhecido → data da importação + `createdAtUnknown`;
  - origem sem mapa → `UNKNOWN`;
  - follow-up válido → `JourneyNextAction` (vencido aparece OVERDUE por derivação);
  - WON/LOST só com evidência explícita e coerente com a etapa (motivo de perda do registro); senão `outcomeAmbiguities`;
  - notas não viram eventos (`rawNotesExcluded`);
  - vários registros ativos do mesmo cliente+empreendimento → `JourneyDuplicateCandidate` (revisão humana, sem merge);
  - ids determinísticos + `migrationVersion` → idempotente (`alreadyMigrated`).
- `JourneyMigrationReport`: legacyRecordsFound, journeysCreated, alreadyMigrated, stageMappings, unresolvedStages, lossReasonsMapped, sourceMappings, ownersMapped, followUpsMigrated, historyUnavailableCount, duplicateActiveJourneyCandidates, outcomeAmbiguities, rawNotesExcluded, manualReviewRequired, migrationVersion.

Exemplo do spec (§489) coberto no teste `JourneyLegacyMigrationWithoutHistory`: "Negociação" → NEGOTIATING com baseline e `historyUnavailable`.
