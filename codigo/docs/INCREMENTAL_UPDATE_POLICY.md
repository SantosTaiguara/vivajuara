# Política de atualização incremental

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`ingestionDiff` gera `FieldChange` com severidade; lote removido = CRITICAL e exige `classifyRemoval` (vendido fora do sistema, erro de fonte, retirado…). `classifyUpdate` roteia cada mudança ao domínio dono; `recomputePlan` usa o grafo reverso de `dependsOn` do FieldRegistry para dizer o que recalcular (sem recalcular score aqui). `publicationDiff` compara publicações.
