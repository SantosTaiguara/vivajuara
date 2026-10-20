# Registro de transformações

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Embutidas (`mapping.createTransformRegistry`): `identity`, `trimString`, `upperTrim`, `parseBrazilianDecimal`, `parseDecimal`, `parseCurrencyBRL` (centavos inteiros), `normalizeBoolean`, `normalizeLotCode`, `normalizeBlockCode`, `convertHectareToSqm`, `excelSerialDate`, `parseDateBR`, `polygonPoints`.
Transformações customizadas exigem `owner` e `developmentId`, são versionadas e entram no fingerprint do batch. Nenhuma transformação inventa valor: falha → nulo + issue.
