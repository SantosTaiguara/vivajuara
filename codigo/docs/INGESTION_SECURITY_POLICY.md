# Política de segurança da ingestão

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- `inspectUpload` antes de qualquer parser: tipo por fonte, tamanho máximo, macros (VBA), executáveis, MIME declarado ≠ magic bytes, arquivo compactado sem listagem, zip-slip, taxa de compressão (via `securityHardening.checkArchive`).
- Varredura de malware obrigatória (scanner injetado); infectado → `REJECTED` + `MALWARE_DETECTED`.
- Isolamento por organização: recurso de outra organização → `CROSS_TENANT_DENIED` (HTTP 404) + evento de segurança.
- Negação por padrão: 8 chaves `development_onboarding.*`, sem concessão a papéis; localStorage nunca autoriza.
- PII: colunas detectadas não são mapeadas (`PII_FIELD_NOT_ALLOWED`); logs/auditoria só com IDs; nenhum envio a terceiros.
- Limites técnicos de upload por tipo: valores provisórios no código, **necessita confirmação** técnica.
