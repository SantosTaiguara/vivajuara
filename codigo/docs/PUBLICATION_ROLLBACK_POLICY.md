# Política de rollback de publicação

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`rollbackPlan`/`rollback`: o ponteiro volta para uma publicação anterior (motivo + `expectedPointerRevision`, permissão `development_onboarding.rollback`). Lotes/geometria/config voltam junto com o ponteiro; preço volta para a versão de tabela referenciada; **disponibilidade não é revertida automaticamente** (é estado operacional vivo). Histórico em `publicationHistory`, nunca apagado.
