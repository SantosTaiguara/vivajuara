# Política de importação canônica de lotes

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

Regra `lot-id@1` (idêntica ao `legacyAdapter`): `${codigo}-Q${quadra}-L${lote com 4 dígitos}`, código do empreendimento `VJ`.
- Lote não inteiro / quadra ausente → sem ID (`unresolved`), nunca um ID inventado.
- Duas linhas → mesmo ID → `LOT_IDENTITY_CONFLICT` (BLOCKING).
- **Golden test**: os 498 lotes de `dash/lots.json` reproduzem exatamente `did` e os IDs do `prepare()` do import existente (frontend e backend). Reimportar a mesma fonte gera os mesmos IDs.
- `lots.json` não é alterado (checksum conferido antes/depois).
