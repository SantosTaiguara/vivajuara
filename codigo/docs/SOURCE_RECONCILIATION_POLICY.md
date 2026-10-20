# Política de reconciliação de fontes externas

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`reconcileSource` compara uma fonte externa com o publicado e só **relata** divergências (`writesApplied: 0`). Conectores (`registerConnector`) exigem `authRef` no formato `secretref://…` (nunca segredo em claro). Webhook (`ingestWebhook`): assinatura verificada obrigatória, proteção contra replay, vira SourceAsset, `autoPublished: false`. Falhas de sync em `syncState`. Nenhum conector real foi configurado.
