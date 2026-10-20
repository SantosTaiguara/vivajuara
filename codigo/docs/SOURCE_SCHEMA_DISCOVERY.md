# Descoberta de schema

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

`parsers.discoverSchema` lista campos, amostras (no máximo poucas), tipo inferido (`inferType`), taxa de nulos e tokens nulos (`nullTokens`).
`mapping.suggest` propõe alvos do FieldRegistry por código legado e sinônimos (`headerSynonyms`) — **sempre `SUGGESTED`**; só regras `CONFIRMED` são aplicadas. Colunas com indício de PII (`piiHeaderHints`, padrões EMAIL/CPF/PHONE_BR) são sinalizadas por nome e contagem, nunca pelo valor.
