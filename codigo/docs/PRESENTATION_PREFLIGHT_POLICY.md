# Política de Preflight

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

`domain.preflight(def, src, ctx)` → `{ status: PASS | PASS_WITH_WARNINGS | FAIL, blocking[], warnings[], info[], payloads, overridesApplied }`.

## Bloqueantes (exemplos)
`CROSS_TENANT`, `CUSTOMER_ACCESS_DENIED`, `JOURNEY_ACCESS_DENIED`, `NO_LOTS`, `UNSUPPORTED_BLOCK`, `INVALID_BLOCK_CONFIG`, `STORYLINE_INVALID`, `MIXED_VERSIONS`, `POLICY_VERSION_MISMATCH`, `COMPARISON_VERSION_MISMATCH`, `PII_OR_INTERNAL_DATA_EXPOSURE`, `UNSAFE_CLAIM`, `REDACTION_ERROR`, `PRICE_STALE_FINANCIAL`, `AVAILABILITY_STALE_CRITICAL`, `BLOCK_SOURCE_MISSING`.

## Avisos (exemplos)
`AVAILABILITY_UNCONFIRMED`, `AVAILABILITY_STALE`, `PRICE_STALE`, `THEME_MISSING`, bloco opcional sem fonte.

## Overrides
Só três códigos aceitam override (`OVERRIDES`): `PRICE_STALE_FINANCIAL`, `AVAILABILITY_STALE_CRITICAL`, `BLOCK_SOURCE_MISSING`. Exigem permissão `presentation.preflight.override` (nunca concedida localmente: só decisão de backend via `ctx.can`) **e** justificativa. O override é auditado e o texto mantém a ressalva.

**Não sobrescrevíveis:** vazamento de PII/dado interno (`PII_EMAIL`, `PII_CPF`, `PII_PHONE`, `PII_FIELD`, `INTERNAL_FIELD`, `INTERNAL_LOT_ID`, `TECHNICAL_PROVENANCE`, `HTML_MARKUP`), cross-tenant, alegação insegura, storyline inválida e incoerência de versão.

## Coerência de versões
`versionRefs` registra política, tabela de preço, metodologia/análise e dataset; o snapshot guarda essas referências fora de `audience`.
