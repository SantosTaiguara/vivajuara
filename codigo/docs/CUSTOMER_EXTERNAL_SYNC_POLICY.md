# Integração externa / CRM (Tópico 39)

- `CustomerExternalRef { id, provider, externalId, authorityMode, syncStatus, lastSyncedAt?, metadata? }`. Provider livre (ex.: `KENLO`); não é Kenlo-only.
- `authorityMode` (`INTERNAL_MASTER`, `EXTERNAL_MASTER`, `HYBRID`, `REFERENCE_ONLY`) é obrigatório ao vincular (`AUTHORITY_MODE_REQUIRED`); nunca escolhido automaticamente. Ingestão sem configuração usa `REFERENCE_ONLY`.
- Um externalId por provider por cliente (outro → `EXTERNAL_REF_CONFLICT`).
- `fieldAuthority(policies, fieldPath, provider, mode)`:
  - `REFERENCE_ONLY` → interno; `INTERNAL_MASTER` → interno (salvo política de campo EXTERNAL);
  - `EXTERNAL_MASTER` → externo (salvo política de campo);
  - `HYBRID` sem política de campo → `MANUAL_REVIEW` (sem last-write-wins).
- `applyExternalChanges` aplica só o que é de autoridade externa; o resto vira `CustomerSyncConflict` com `internalValueFingerprint`/`externalValueFingerprint` (checksums), nunca o valor bruto.
- Ingestão (`ingest`): `Source → Normalize → Duplicate Check → Match/Create → ExternalRef → Domain Event`. Idempotente por `sourceSystem:sourceRecordId`; mesmo externalId → `MATCHED`; contato igual → cria e abre candidato (sem merge fuzzy); `preferenceHints` não são aplicados (`PREFERENCE_HINTS_NOT_APPLIED`).
- Sincronização real com Kenlo **não implementada** (sem documentação/API oficial).

## Contrato de API proposto (backend não implementado nesta entrega)

```
POST   /api/v1/organizations/{orgId}/customers
GET    /api/v1/organizations/{orgId}/customers            (SUMMARY, paginado)
POST   /api/v1/organizations/{orgId}/customers/search     (corpo; PII nunca na query string)
GET    /api/v1/organizations/{orgId}/customers/{customerId}
PATCH  /api/v1/organizations/{orgId}/customers/{customerId}          (If-Match: revision)
POST   …/customers/{customerId}/archive
GET|POST|PATCH …/customers/{customerId}/contact-points[/{contactId}]
GET|POST …/customers/{customerId}/assignments
GET    …/customers/{customerId}/preference-profile
POST   …/customers/{customerId}/preference-profile/versions
POST   …/customers/{customerId}/preference-profile/snapshots
GET    …/customers/{customerId}/duplicate-candidates
POST   …/customers/merge                                    (CustomerMergeCommand)
```

DTOs = formas devolvidas por `project()`/`toSummaryDto()`/`toDetailDto()`, `createProfileVersion().version`, `createSnapshot()`, `detectDuplicates()` e `merge().record`. Tabelas sugeridas: `customers`, `customer_person_details`, `customer_organization_details`, `customer_contact_points`, `customer_assignments`, `customer_communication_preferences`, `customer_privacy_profiles`, `customer_external_refs`, `customer_preference_profiles`, `customer_preference_profile_versions`, `customer_aliases`, `customer_duplicate_candidates`, `customer_merge_records` (sem EAV). Índices: organization_id, lifecycle_status, nome normalizado, assignment user, provider+external_id, contato normalizado (respeitando a política de segurança).
