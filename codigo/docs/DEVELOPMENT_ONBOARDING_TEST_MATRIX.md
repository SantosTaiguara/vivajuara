# Matriz de testes do onboarding

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Frontend `tests/onboarding.test.js` (26 testes) e backend `backend/tests/onboarding.test.js` (6 testes, sem banco).

| Cenário | Teste |
|---|---|
| Golden 498 IDs + lots.json inalterado | frontend + backend (vs `prepare()`) |
| CleanDevelopment, DuplicateLotDetected, MissingRequiredField | frontend |
| GeometryUnmatched, GeometryInvalidPolygon | frontend |
| SourceConflictArea, PricingMissingDoesNotSetUnavailable, UnknownAvailabilityStatus | frontend |
| IncrementalPriceUpdate, LotRenumberingReview, SourceFileDuplicate | frontend (+ backend duplicata/imutável) |
| DryRunNoPublish, CandidatePublish, RollbackToPreviousPublication | frontend + backend |
| ExternalApiIncrementalSync, CrossTenantSourceDenied, MaliciousArchiveRejected | frontend (+ backend 404/403) |
| Parsers, mapeamento, alinhamento, provider do gate, máquinas de estado, diff incremental, observabilidade/views | frontend |
| Rotas ↔ OpenAPI ↔ registro de permissões; migration 012 up/down | backend |

Postgres não roda neste ambiente: o repositório Pg e a migration 012 foram verificados só estaticamente.
