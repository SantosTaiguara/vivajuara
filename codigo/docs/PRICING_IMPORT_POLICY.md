# Política de importação de preços

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `priceCandidates`: preço ausente ≠ indisponível; negativo, zero (`zeroPriceAllowed: false`), duplicado, lote inexistente e moeda ≠ BRL viram issues.
- `priceDiff` vs. tabela atual (R$ 1.196/m², tabela 2026-10-06); limiar de variação para revisão = **necessita confirmação** (null) → **toda** variação exige revisão.
- Saída é um comando para o domínio de preço (`pricingCommand`, `touchesLotIdentity: false`) gerando nova `PriceTableVersion`; o onboarding não grava preço. "Preço de tabela", nunca promessa de valorização.
