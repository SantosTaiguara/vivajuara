# Reconciliação de identidade de lotes

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`canonical.reconcile(drafts, existing)` → `EXACT`, `HIGH_CONFIDENCE`, `AMBIGUOUS`, `NEW`, `CONFLICT`, mais `missingExisting`.
- Renumeração (ex.: 327 → 327A) nunca é casada automaticamente: abre `ReviewItem` LOT_IDENTITY.
- `lineageEvent` (RENAMED/RENUMBERED/RETIRED) exige `approvedBy`; SPLIT/MERGED: não suportados nesta versão (recusados).
- Lote existente ausente na nova fonte → remoção CRITICAL que exige classificação (`classifyRemoval`), nunca exclusão silenciosa.
