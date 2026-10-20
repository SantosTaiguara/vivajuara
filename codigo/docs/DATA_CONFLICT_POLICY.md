# Política de conflitos de dados

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`quality.detectConflicts` compara o mesmo campo entre fontes (ex.: PDF 250 m² × CSV 252 m²) → `DataConflict` com valores, fontes e autoridade. Nunca silencioso.
- Auto-resolução só quando a política diz `PREFER_HIGHER_AUTHORITY` e fica registrada; campos de identidade (`BLOCK`) e área (`REQUIRE_REVIEW`) exigem humano.
- `resolveConflict` exige `reason` e `resolvedBy` (permissão `resolve_conflict`); fecha o ReviewItem correspondente; auditado.
