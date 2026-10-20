# Gate de qualidade do onboarding

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`quality.evaluate(dataset, { exceptions })` roda os providers registrados e devolve `checks`, `summary` e `gate { publishable, blockers, errors, warnings, providers, providerErrors }`.
- Provider embutido `onboarding-builtin`: COMPLETENESS, VALIDITY, UNIQUENESS, CONSISTENCY, REFERENTIAL_INTEGRITY, GEOMETRY_INTEGRITY, COMMERCIAL_COHERENCE, PROVENANCE_COVERAGE, SECURITY.PII_NOT_INGESTED.
- **Interface para o tópico 61**: `App.onboarding.quality.registerProvider({ id, version, evaluate(dataset) → checks[] })` (devolve `unregister`). Falha de provider → gate fechado (`providerErrors`).
- BLOCKING nunca é dispensável; `errorsBlockPublish: true`; exceção (`createException`) só para ERROR/WARNING com motivo e responsável.
- Viva Juara (golden): 24 verificações PASS, 0 bloqueios, proveniência 100%.
