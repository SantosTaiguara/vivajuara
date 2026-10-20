# Modelo de Run e Version (Tópico 35)

## AnalysisRun (tentativa de execução)
`{ id, organizationId, developmentId, analysisDefinitionId, requestedBy, requestReason, inputSnapshotId, executionPlanId, engineBuildRef, methodologyRefs, status, startedAt, completedAt, generatedDraftVersionId, executionStats, warnings, errors }`
Status: QUEUED, PLANNING, RUNNING, SUCCEEDED, PARTIAL, FAILED, CANCELLED. SUCCEEDED não significa publicada. FAILED/CANCELLED não mudam ponteiro nenhum. Run recusa entradas que divergem do snapshot (`INPUT_SNAPSHOT_MISMATCH`, `METHODOLOGY_SNAPSHOT_MISMATCH`): nada de misturar versões no meio da execução.

## AnalysisVersion (resultado materializado)
`{ id (opaco), organizationId, developmentId, analysisDefinitionId, sequence, label "A<n>" (não é chave), origin, lifecycleStatus, inputSnapshotId, methodologyRefs, engineBuildRef, moduleResultRefs, resultSetRef, manifestRef, manifest, validationReportRef, contentChecksum, reproducibilityStatus, createdFromRunId, createdAt, validatedAt/By, publishedAt/By, supersedesVersionId, archivedAt, determinism }`
Origem: COMPUTED, MIGRATED_LEGACY, IMPORTED, REBUILT, RECOVERED.

**Modelo de ciclo de vida escolhido** (spec §259–265): `lifecycleStatus` ∈ DRAFT, VALIDATED, PUBLISHED, ARCHIVED, REJECTED. CURRENT / SUPERSEDED / NEVER_ACTIVE são derivados do ponteiro e do histórico de ativação (`currentStatus(id)`), então uma versão antiga pode ser reativada sem "voltar" de SUPERSEDED para PUBLISHED.

## AnalysisVersionPointer
`{ organizationId, analysisDefinitionId, currentPublishedVersionId, latestVersionId, revision, updatedAt }` — `latest ≠ current`. Mudança só por `publish`/`activate` com `expectedCurrentVersionId` (concorrência otimista → `ANALYSIS_CURRENT_VERSION_CONFLICT`).

## AnalysisVersionActivationEvent
`{ analysisDefinitionId, versionId, previousVersionId, activatedAt, deactivatedAt, actor, reason, action PUBLISH|ACTIVATE, pointerRevision }` — base do modo AS_OF (uma versão pode ter vários intervalos).

## ResultSet, EntityResult, Manifest
`AnalysisResultSet { entityType, entityCount, moduleResultRefs, outputSchemaVersion "lot-analysis-result/1.0", entities[], checksum }`; `AnalysisEntityResult { entityId, outputs, resultStatus READY|PARTIAL|NOT_COMPUTABLE|ERROR, warnings }`; `AnalysisManifest { counts por status, inputSnapshotChecksum, resultSetChecksum, versionChecksum, moduleVersions, methodologyVersions }`. Checksums sobre valores canônicos (números crus), nunca strings de exibição.

## API (contratos para o backend)
GET `/analysis/{def}/current`, `/versions`, `/versions/{id}`, `/versions/{id}/manifest`, `/versions/{id}/results?entityIds=`, `/runs/{id}`, `/versions/{a}/diff/{b}`, `/versions/{id}/impact`, `/snapshots/{id}`; POST `/runs` (AnalysisRunRequest INCREMENTAL|FULL_REBUILD|VALIDATION_RERUN), `/versions/{id}/validate`, `/versions/{id}/publish` `{ expectedCurrentVersionId, reason }`, `/versions/{id}/activate`. Permissões sugeridas: `analysis.read.technical`, `analysis.run`, `analysis.publish`, `analysis.activate` (auditoria obrigatória). Sem chave de storage na API.
