# Plano de migração do onboarding

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

1. Integrador: adicionar módulos ao ORDER/build e as chaves de permissão ao backend (`modules/iam/permissions.js`) — sem concessão até decisão.
2. Aplicar migration 012 (tabelas próprias; não toca lots/preço/disponibilidade). Reverso: `down/012_development_onboarding.down.sql`.
3. Configurar scanner de malware e extrator (KMZ/XLSX/DOCX) — pré-requisito para aceitar essas fontes.
4. Ligar rotas (`registerOnboardingRoutes`, `ROUTE_POLICIES`) e `addOnboardingPaths` no `openapiDoc.js`; regenerar OpenAPI.
5. Reimportar Viva Juara em DRY_RUN a partir de `lots.json` e conferir o golden (mesmos 498 IDs) antes de qualquer BUILD_CANDIDATE.
6. Só depois: `activator` real que entrega comandos aos domínios (preço/disponibilidade) — decisão humana.
`scripts/import.js` e `modules/imports` permanecem o caminho atual até o passo 6.
