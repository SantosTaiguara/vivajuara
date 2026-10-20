# Política de ingestão de documentos

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Fontes `REGULATION`/`LEGAL` são registradas como SourceAsset e entram no candidato como `documentExtractions` (versão do documento + extrator). O onboarding **não interpreta cláusulas**; extração estruturada fica a cargo do domínio de documentos e de revisão humana. DOCX exige extrator injetado (não instalado).
