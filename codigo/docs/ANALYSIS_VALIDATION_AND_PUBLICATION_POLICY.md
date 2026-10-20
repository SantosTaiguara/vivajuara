# Validação e política de publicação (Tópico 35)

`validate(versionId)` → `AnalysisValidationReport { status PASS|PASS_WITH_WARNINGS|FAIL, checks[], criticalErrorCount, warningCount, validatorVersion }`. Checagens: ENTITY_COUNT, UNIQUE_ENTITY_IDS, NO_NAN_OR_INFINITY, SCORE_RANGE (0–100), ENUMS_VALID (classe), REQUIRED_OUTPUTS, METHODOLOGY_REFS (com checksum), ENGINE_BUILD_REF, TENANT_OWNERSHIP, INPUT_SNAPSHOT_CONSISTENCY, MODULE_CHECKSUMS, DETERMINISTIC_REUSE, ENTITY_ERRORS, PARTIAL_ENTITIES (aviso). PASS → VALIDATED e congelada; FAIL → REJECTED (preservada para auditoria).

Política padrão (`config/versioning/viva-juara.json`): `requireValidationPass`, `maxCriticalErrors 0`, `maxEntityErrors 0`, `maxPartialEntities 0`, `allowPartialPublication false`, `allowAutomaticPublication false`, `requireImpactReview true` (quando já existe versão atual), `requireParityForMigration true`.

`decision(id, meta)` → `AnalysisPublicationDecision { allowed, currentVersionId, candidateVersionId, validationStatus, impactReviewStatus, blockers, warnings }`. Bloqueios: NOT_VALIDATED, VALIDATION_NOT_PASSED, PARTIAL_PUBLICATION_NOT_ALLOWED, ANALYSIS_CURRENT_VERSION_CONFLICT, FORBIDDEN (`analysis.publish`), MISSING_REASON, IMPACT_REVIEW_REQUIRED, PARITY_REQUIRED. Autorização não substitui validação e vice-versa.

`publish()` não recalcula nem altera saídas: congela a versão como PUBLISHED, move o ponteiro com revisão, grava a ativação e o evento. `activate()` (rollback, `analysis.activate`, motivo obrigatório) reativa uma versão publicada antiga; nada é apagado. `archive()` não arquiva a versão atual.
