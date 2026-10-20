# Modelo da fila de revisão

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`ReviewItem` (`quality.reviewItem`): categoria (FIELD_MAPPING, DATA_CONFLICT, LOT_IDENTITY, GEOMETRY_MATCH, GEOMETRY_ALIGNMENT, PRICE_DIFF, STATUS_MAPPING, DOCUMENT_EXTRACTION, QUALITY_EXCEPTION, SECURITY), severidade, `entityRef`, estado (`OPEN → RESOLVED | ACCEPTED | REJECTED`). `assignReview`, `resolveReview` (motivo obrigatório). Permissão por categoria: geometria → `review_geometry`; demais → `resolve_conflict`. SLA = **necessita confirmação** (null).
