# Modelo de IngestionBatch

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `intake.createBatch` calcula `fingerprint` (`ifp1:`) a partir de checksums das fontes, versões dos mapeamentos e `pipelineVersion`.
- **Idempotência**: mesmo fingerprint num batch não terminal → `BATCH_DUPLICATE` com `refs.batchId` (antes de qualquer processamento). Postgres: índice único parcial `(organization_id, fingerprint)`.
- Tipos: `INITIAL` e as atualizações incrementais (`LOT_MASTER_UPDATE`, `GEOMETRY_UPDATE`, `PRICING_UPDATE`, `AVAILABILITY_UPDATE`, `DOCUMENT_UPDATE`, `ANALYSIS_INPUT_UPDATE`, `CONFIG_UPDATE`).
- Modos de execução: `DRY_RUN` (nunca cria candidato nem toca ponteiros), `VALIDATE_ONLY`, `BUILD_CANDIDATE`, `PUBLISH` (ainda exige aprovação + ativação explícitas; `autoPublish: false`).
- Uma nova versão de fonte marca batches abertos que a usavam como `SUPERSEDED` (`SOURCE_REPLACED`). Batch obsoleto não publica.
- Progresso por estágio/checkpoint: `pipelineProgress` (PARSED, MAPPED, NORMALIZED, VALIDATED, ARTIFACTS_BUILT).
