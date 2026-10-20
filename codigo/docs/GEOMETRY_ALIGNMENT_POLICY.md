# Política de alinhamento de geometria

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`fitAffine` estima transformação a partir de pontos de controle e devolve resíduos com status `PROPOSED`. `transformPoints` recusa transformação não `APPROVED`. Aprovação (`approveAlignment`) exige permissão `development_onboarding.review_geometry` e fica auditada. Limite de resíduo aceitável: **necessita confirmação** (null) → toda transformação exige revisão humana.
