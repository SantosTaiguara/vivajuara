# Modelo de estado de atributo (Tópico 37)

## Contratos
- `AttributeDataStateRecord` (sidecar, `createRecord`): id, organizationId, developmentId, entityType, entityId, attributePath,
  canonicalState, reasonCode, valueFingerprint (FNV-1a), dataVersionRef, completeness, freshness, asOf, recordedAt, sourceRef, metadata. Só códigos, nenhum texto de UI.
- `AttributeDataStateIndex` (`createIndex(organizationId)`): organization → entity → attributePath → record. Escrita/leitura de outro tenant → `TENANT_MISMATCH` (DENY). Gera `DataStateTransitionEvent` somente quando estado/motivo mudam (nunca para loading de UI).
- Valores KNOWN não-nulos dispensam registro (derivados com segurança após validação); null exige estado explícito — fornecido pelo índice ou pela classificação por evidência.
- `ResolvedAttributeValue`: attributePath, value, canonicalState, projectedState, reasonCode, freshness, completeness, access, provenanceSummary, confidenceSummary (com `opts.provenance`), dataVersionRef, connectivity, display.
- `AttributeValueDto` (`toDto(r, 'VALUE_ONLY'|'SUMMARY'|'TECHNICAL')`): sempre `state` junto do valor; RESTRICTED → `{value:null, projectedState:'RESTRICTED'}`; HIDDEN → campo omitido.

## Registro de motivos (`REASONS`)
SOURCE_NOT_PROVIDED, SOURCE_NOT_INGESTED, SOURCE_UNAVAILABLE, NOT_MEASURED, DERIVATION_NOT_POSSIBLE, MISSING_REQUIRED_INPUT,
NOT_APPLICABLE_BY_DOMAIN, PENDING_IMPORT, PENDING_ANALYSIS, PENDING_PUBLICATION, CONFLICT_UNRESOLVED, VALIDATION_FAILED,
PROCESSING_FAILED, LEGACY_UNCLASSIFIED, UNSUPPORTED_SOURCE, OUTSIDE_SCOPE, UNKNOWN_REASON — cada um com estados permitidos,
rótulos CLIENT/BROKER/TECHNICAL e visibilidade. `NOT_AVAILABLE_REASON_ALIGNMENT` é o mapeamento 1:1 com o `NotAvailableReason`
do Tópico 33 (o catálogo do 33 ainda não existe no código; quando existir, não criar segundo código para a mesma semântica).

## FieldDataStatePolicy (extensão do Field Registry por referência)
`fieldPolicy(key)` deriva de `App.model` (tipo, nullable, status) + tabelas explícitas: allowedStates, nullRequiresExplicitState,
allowKnownZero (number exceto preço/área/entrada), allowKnownFalse (boolean), allowKnownEmptyString=false, allowKnownEmptyCollection (array),
freshnessDomain, políticas de filtro (EXCLUDE), ordenação (LAST), comparação (NO_DATA), compartilhamento.
`fieldRegistryRefs(key)` dá os ids (dataStatePolicyId, nullNormalizationPolicyId, freshnessPolicyId, …) — o registro não é duplicado.
`validatePolicy` (DataStatePolicyValidator) acusa: estado inválido, known-zero em não-número, known-false em não-booleano,
display de unknown mostrando valor, filtro inválido, sentinela com estado/motivo inválidos; aviso para NOT_APPLICABLE em campo sempre aplicável.

## Validador de invariantes (`validateState`)
Erros: DATA_STATE_MISSING, KNOWN_VALUE_MISSING, UNKNOWN_WITH_OPERATIONAL_VALUE, NOT_APPLICABLE_WITH_VALUE,
CONFLICTED_WITH_UNRESOLVED_OPERATIONAL_VALUE, INVALID_WITH_OPERATIONAL_VALUE, STATE_NOT_ALLOWED_FOR_FIELD, REASON_REQUIRED,
UNKNOWN_REASON_CODE, VALUE_STATE_FINGERPRINT_MISMATCH. Avisos: LEGACY_UNCLASSIFIED_NULL, PARTIAL_COMPOSITE_VALUE, ZERO_REQUIRES_REVIEW
(+ STALE_KNOWN_VALUE, UNKNOWN_FRESHNESS, ACCESS_REDACTED catalogados).

## Adaptadores especializados
- Pricing (`commercial.price|pricePerM2|downPaymentDefaultValue`): > 0 KNOWN; número ≤ 0 INVALID; conflito → CONFLICTED; sob consulta / sem tabela → NOT_AVAILABLE/SOURCE_NOT_PROVIDED; sem área → MISSING_REQUIRED_INPUT.
- Availability (`availability.status`): o status comercial continua sendo o valor; UNKNOWN/null → UNKNOWN/SOURCE_NOT_INGESTED; `dataState: CONFLICTED` → CONFLICTED. A máquina de estados do Tópico 29 não é tocada.

## Camadas
Canonical Data → Data State → (Provenance, Confidence consomem) → Read Model/Projection. Data State não consome Confidence.
Persistência futura: tabela `attribute_data_states` (colunas do §285), versionada por revisão; Pricing/Availability usam suas próprias revisões (sem EAV genérico). Não implementado no backend neste tópico (contrato apenas).
