# Modelo de SourceAsset

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- Criado por `intake.createSourceAsset`; ID estável; `checksum = sha256:<hex>` dos bytes; `storageRef = obj://<org>/onboarding/<case>/<sha>`.
- **Imutável**: `assertImmutable` recusa mudança de checksum/bytes (`SOURCE_IMMUTABLE`); no Postgres um trigger impede alterar `checksum`/`storageRef`.
- Status: `RECEIVED → VALIDATED` (varredura CLEAN) ou `REJECTED` (inspeção/malware); `SUPERSEDED` quando uma nova versão chega (`supersedesId`), nunca sobrescrita.
- Duplicata (mesmo checksum no mesmo caso, não rejeitada) → `SOURCE_DUPLICATE` com `refs.sourceAssetId`.
- Metadados por allow-list (`sanitizeMetadata`): caminhos locais são descartados.
- Varredura obrigatória (`malwareScanRequired: true`): sem scanner configurado → `NOT_CONFIGURED` e `readyForParse` recusa (`SOURCE_SCAN_REQUIRED`).
