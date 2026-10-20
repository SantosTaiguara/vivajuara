# Modelo de publicação do empreendimento

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `buildCandidate`: recusa DRY_RUN, batch obsoleto, batch não READY e gate com bloqueios; idempotente por checksum; cria aprovação `PENDING`.
- `decideApproval`: separação de funções = **necessita confirmação** (null) → leitura estrita: aprovador ≠ solicitante (`PUBLICATION_SEPARATION_OF_DUTIES`).
- `activate`: ponteiro atômico com `expectedPointerRevision` (aba desatualizada → `PUBLICATION_CONFLICT`), verificação de checksum, idempotente; falha do `activator` mantém o ponteiro anterior.
- Prévia com marca d'água **DADOS NÃO PUBLICADOS**; `onboardingReport` com `reportChecksum`; `operationalHandoff`.
