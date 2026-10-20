# Modelo de regra (DataQualityRule) (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Campos: `id, code, name, description, dataDomainId, scope, dimension, severity (INFO|WARNING|ERROR|BLOCKING), executionMode (ON_PUBLISH|SCHEDULED|EVENT_DRIVEN|ON_DEMAND), evaluatorRef, thresholdConfig, ownerRef, version, status, enforcementMode (SHADOW|WARNING|ENFORCED), priority, cost, platformMandatory, dependsOn`.

Regras: versão imutável (revisão cria nova versão DRAFT em SHADOW); promoção um passo por vez com dry-run; ENFORCED exige owner e, se o dry-run falhar em algo, aprovação de outra pessoa; SHADOW/INFO nunca afetam a decisão; regra com erro de execução = CHECK_FAILED (UNKNOWN), nunca PASS.

## Regras efetivas (Viva Juara)
| Regra | Domínio | Dimensão | Severidade | Modo (config → efetivo) | Execução | Avaliador | Owner | Escopo |
|---|---|---|---|---|---|---|---|---|
| `DQ-LOT-001` | LOT_IDENTITY | UNIQUENESS | BLOCKING | ENFORCED → undefined | ON_PUBLISH | UNIQUE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-LOT-002` | LOT_IDENTITY | COMPLETENESS | BLOCKING | ENFORCED → undefined | ON_WRITE | NOT_NULL | SYSTEM:platform-invariant | PLATFORM |
| `DQ-LOT-004` | LOT_IDENTITY | UNIQUENESS | BLOCKING | ENFORCED → undefined | ON_PUBLISH | UNIQUE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-TEN-001` | LOT_IDENTITY | REFERENTIAL_INTEGRITY | BLOCKING | ENFORCED → undefined | ON_WRITE | TENANT_SCOPE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-TEN-002` | LOT_IDENTITY | REFERENTIAL_INTEGRITY | BLOCKING | ENFORCED → undefined | ON_WRITE | CROSS_TENANT | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-001` | AVAILABILITY | VALIDITY | BLOCKING | ENFORCED → undefined | ON_WRITE | ENUM | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-002` | AVAILABILITY | COMPLETENESS | WARNING | WARNING → undefined | SCHEDULED | KNOWN_STATUS | **null — necessita confirmação** | PLATFORM |
| `DQ-AVAIL-003` | AVAILABILITY | PROVENANCE_COVERAGE | ERROR | ENFORCED → undefined | ON_WRITE | AVAILABILITY_SOURCE_TIMESTAMP | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-004` | AVAILABILITY | FRESHNESS | BLOCKING | ENFORCED → undefined | EVENT_DRIVEN | FRESHNESS | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-005` | AVAILABILITY | DOMAIN_COHERENCE | BLOCKING | ENFORCED → undefined | ON_WRITE | REVISION_MONOTONIC | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-006` | AVAILABILITY | DOMAIN_COHERENCE | BLOCKING | ENFORCED → undefined | ON_WRITE | AVAILABILITY_TRANSITION | SYSTEM:platform-invariant | PLATFORM |
| `DQ-AVAIL-007` | AVAILABILITY | DOMAIN_COHERENCE | BLOCKING | ENFORCED → undefined | ON_WRITE | AVAILABILITY_PRICE_INDEPENDENCE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-TX-001` | AVAILABILITY | CONSISTENCY | ERROR | ENFORCED → undefined (RULE_UNOWNED) | ON_WRITE | SOLD_WITHOUT_RESERVATION | **null — necessita confirmação** | PLATFORM |
| `DQ-GEO-012` | GEOMETRY | GEOMETRY_INTEGRITY | BLOCKING | ENFORCED → undefined | ON_PUBLISH | GEOMETRY_VALID | SYSTEM:platform-invariant | PLATFORM |
| `DQ-GEO-002` | GEOMETRY | GEOMETRY_INTEGRITY | ERROR | ENFORCED → undefined | ON_PUBLISH | GEOMETRY_SIMPLE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-GEO-003` | GEOMETRY | CONSISTENCY | ERROR | ENFORCED → undefined | ON_PUBLISH | GEOMETRY_BOUNDS | SYSTEM:platform-invariant | PLATFORM |
| `DQ-GEO-004` | GEOMETRY | VALIDITY | ERROR | ENFORCED → undefined | ON_WRITE | RANGE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-PRICE-008` | PRICING | REFERENTIAL_INTEGRITY | BLOCKING | ENFORCED → undefined | ON_PUBLISH | PRICE_LOT_REFERENCE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-PRICE-002` | PRICING | UNIQUENESS | BLOCKING | ENFORCED → undefined | ON_PUBLISH | PRICE_DUPLICATE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-PRICE-003` | PRICING | VALIDITY | BLOCKING | ENFORCED → undefined | ON_PUBLISH | PRICE_VALUE | SYSTEM:platform-invariant | PLATFORM |
| `DQ-PRICE-004` | PRICING | VERSION_COMPATIBILITY | ERROR | ENFORCED → undefined | ON_PUBLISH | PRICE_TABLE_VERSION | SYSTEM:platform-invariant | PLATFORM |
| `DQ-PRICE-005` | PRICING | COMPLETENESS | WARNING | WARNING → undefined | SCHEDULED | NOT_NULL | **null — necessita confirmação** | PLATFORM |
| `DQ-ANA-001` | ANALYSIS | VERSION_COMPATIBILITY | ERROR | ENFORCED → undefined | ON_PUBLISH | ANALYSIS_VERSION | SYSTEM:platform-invariant | PLATFORM |
| `DQ-ANA-002` | ANALYSIS | VALIDITY | ERROR | ENFORCED → undefined | ON_PUBLISH | ANALYSIS_SCORES | SYSTEM:platform-invariant | PLATFORM |
| `DQ-ANA-003` | ANALYSIS | COMPLETENESS | WARNING | WARNING → undefined | ON_PUBLISH | NOT_NULL | **null — necessita confirmação** | PLATFORM |
| `DQ-PROV-001` | LOT_IDENTITY | PROVENANCE_COVERAGE | WARNING | WARNING → undefined | SCHEDULED | REGISTRY_PROVENANCE | **null — necessita confirmação** | PLATFORM |
| `DQ-NULL-001` | GEOMETRY | COMPLETENESS | INFO | SHADOW → undefined | SCHEDULED | NULL_PROFILE | **null — necessita confirmação** | PLATFORM |
| `DQ-VOL-001` | LOT_IDENTITY | COMPLETENESS | BLOCKING | ENFORCED → undefined (RULE_UNOWNED) | ON_PUBLISH | VOLUME | **null — necessita confirmação** | DEVELOPMENT |
| `DQ-VJ-LOT-003` | LOT_IDENTITY | VALIDITY | BLOCKING | ENFORCED → undefined | ON_PUBLISH | PATTERN | SYSTEM:platform-invariant | DEVELOPMENT |
| `DQ-VJ-SCHEMA-001` | INTEGRATION_REFERENCE | VERSION_COMPATIBILITY | BLOCKING | ENFORCED → undefined | ON_PUBLISH | SCHEMA_DRIFT | SYSTEM:platform-invariant | DEVELOPMENT |
| `DQ-VJ-DIST-001` | GEOMETRY | CONSISTENCY | ERROR | WARNING → undefined | ON_PUBLISH | DISTRIBUTION_DRIFT | **null — necessita confirmação** | DEVELOPMENT |
