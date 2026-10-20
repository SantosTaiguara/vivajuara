# Política de mapeamento de campos

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `FieldMappingRule` aponta para um campo **não virtual** do FieldRegistry (`App.model`); alvo desconhecido → `FIELD_MAPPING_UNKNOWN_TARGET`.
- `FieldMappingSet` versionado; `updateMappingSet` exige `expectedRevision` (`MAPPING_REVISION_CONFLICT`).
- `validateMappingSet`: transformação desconhecida, campo de origem inexistente, PII não permitida, alvo ambíguo (duas origens → mesmo alvo), campo obrigatório ausente por finalidade (`requiredLotFields`).
- Semântica: vazio/`-`/`N/D` → nulo (não disponível); `0` ≠ nulo; "desconhecido" ≠ falso; decimal ambíguo (`1.234`) → `AMBIGUOUS_DECIMAL` em revisão.
- Cada valor normalizado carrega `IngestionProvenance` (fonte, `recordRef`, regra, transformação, versão).
