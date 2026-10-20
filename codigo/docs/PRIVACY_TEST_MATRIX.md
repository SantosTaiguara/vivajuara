# Matriz de testes de privacidade

> Gerado por `node scripts/privacyDocs.js` a partir de `tests/privacy.test.js` e `backend/tests/privacy.test.js`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

| Cenário (§449–467) | Teste |
|---|---|
| PrivacyConsentMarketingGranted | golden PrivacyConsentMarketingGranted |
| PrivacyConsentWithdrawn | golden PrivacyConsentWithdrawn |
| PrivacyAccessRequest | golden PrivacyAccessRequest |
| PrivacyCorrectionRequest | golden PrivacyCorrectionRequest |
| PrivacyDeletionRequestNoLegalHold | golden PrivacyDeletionRequestNoLegalHold |
| PrivacyDeletionRequestWithTransactionRetention | golden …WithTransactionRetention |
| PrivacyLegalHoldBlocksDeletion | golden PrivacyLegalHoldBlocksDeletion |
| PrivacyDeletedSubjectNotReimported | golden PrivacyDeletedSubjectNotReimported |
| PrivacyAnalyticsRejectsEmail | golden PrivacyAnalyticsRejectsEmail (política do tópico 45) |
| PrivacyShareProjectionNoInternalNotes | golden (lotCard real) |
| PrivacyCrossTenantRightsDenied | golden + backend (serviço e rotas) |
| PrivacyInternationalTransferRequiresMechanism | golden |
| PrivacyIncidentNotificationDeadline | golden |
| PrivacyExpiredConsentNotUsed | golden |
| PrivacySensitiveCriterionRejected | golden (critérios reais de config/customer) |
| PrivacyOfflineCustomerDataNotPersisted | golden |
| PrivacyVendorTerminationPurgesAccess | golden |
| PrivacyMinorCustomerReview | golden |
| PrivacyDocumentExtractionAllowlist | golden |

Unitários: registros nulos por padrão, base nunca inferida, fronteira de finalidade, coleta progressiva, máquina de estados da solicitação, verificação proporcional, retenção/dry-run, mascaramento, logs, PII em URL/chave, change gate, exceções, métricas sem identidade. Fitness: toda chave de armazenamento do código está no inventário. Aparelho: varredura, exportação, eliminação PERSONAL/ALL. Docs: os 31 documentos existem e o inventário cobre cada entrada.

Backend (sem Postgres): serviço com repositório em memória (isolamento, revisão, append-only de consentimento, idempotência), rotas com router falso, cobertura das rotas pelo fragmento OpenAPI e pela matriz de permissões, migração 013 com down.

Pendentes (precisam de servidor/E2E): integração customer/documents/connectors reais, purge de cache/índice, E2E de solicitação e incidente.
