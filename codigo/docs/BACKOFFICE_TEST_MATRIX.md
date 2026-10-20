# BACKOFFICE_TEST_MATRIX — Matriz de testes do backoffice

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

| Cenário (§399) | Teste |
|---|---|
| AdminHomeShowsOnlyAuthorizedQueues | frontend + backend |
| AdminCommercialApprovalAccepted / SeparationOfDuties | frontend |
| AdminReasonRegistry, sem backend, offline | frontend |
| AdminAvailabilityOverrideRevisionConflict | frontend + backend (atribuição) |
| AdminConfigVersionPublish / rollback | frontend + backend |
| AdminUserPermissionEscalationPreview | frontend |
| AdminCrossTenantDenied | frontend + backend |
| AdminBulkExportAudited (parte cliente) | frontend |
| AdminSupportSessionExpires | frontend + backend |
| AdminIntegrationRetrySafeJob / AdminUnsafeJobReplayBlocked | frontend |
| AdminFeatureFlagSunsetWarning | frontend |
| AdminEmergencyShareDisable | frontend + backend |
| step-up obrigatório | frontend + backend |
| HTTP: autenticação iam, CSRF, no-store, erro sem stack | backend |

Pendentes (dependem de outros tópicos/handlers): AdminReservationReleaseRequiresReason, AdminPriceTablePublishPreview, AdminDataConflictResolution, AdminDevelopmentPublication, AdminPrivacyRequestAccessFlow, AdminPrivacyDeletionDryRun, E2E no navegador.
