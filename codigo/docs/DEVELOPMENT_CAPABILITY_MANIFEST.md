# Manifesto de capacidades do empreendimento

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`publication.capabilityManifest` / `readiness` / `featureReadiness`: cada capacidade (mapa, preço, disponibilidade, documentos, análise) só é declarada pronta com dados que passaram no gate. Capacidade não pronta não aparece na UI (sem controles mortos); `emptyState(developmentId)` descreve o estado vazio. Análise: não incluída nesta publicação.
