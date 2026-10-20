# Observabilidade da ingestão

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Workspace expõe `metrics()` (`ingestion_batches_total`, `ingestion_failures_total`, `source_assets_received_total`, `mapping_conflicts_total`, `geometry_validation_failures_total`, `publication_failures_total`…), `logs()` estruturados só com IDs (`sourceAssetId`, `batchId`, `developmentDraftId`), `audit()` (ator, ação, alvo, resultado) e `securityEvents()` (UNAUTHORIZED_SOURCE_UPLOAD, UNAUTHORIZED_PUBLICATION, CROSS_TENANT_IMPORT_ATTEMPT, MALICIOUS_ARCHIVE_REJECTED). Sem conteúdo de arquivo nem PII. Backend persiste auditoria em `onboarding_audit_events` (append-only).
