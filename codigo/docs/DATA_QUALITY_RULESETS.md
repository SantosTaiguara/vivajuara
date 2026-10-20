# Rule sets e quality gates (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Rule set | Domínio | Versão | Regras |
|---|---|---|---|
| `RS-PLATFORM-INTEGRITY` | LOT_IDENTITY | 1.0.0 | DQ-LOT-001, DQ-LOT-002, DQ-LOT-004, DQ-TEN-001, DQ-TEN-002, DQ-PROV-001 |
| `RS-GEOMETRY` | GEOMETRY | 1.0.0 | DQ-GEO-012, DQ-GEO-002, DQ-GEO-003, DQ-GEO-004, DQ-NULL-001 |
| `RS-AVAILABILITY` | AVAILABILITY | 1.0.0 | DQ-AVAIL-001, DQ-AVAIL-002, DQ-AVAIL-003, DQ-AVAIL-005, DQ-AVAIL-006, DQ-AVAIL-007, DQ-TX-001 |
| `RS-PRICING` | PRICING | 1.0.0 | DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004, DQ-PRICE-005 |
| `RS-ANALYSIS` | ANALYSIS | 1.0.0 | DQ-ANA-001, DQ-ANA-002, DQ-ANA-003 |

## Gates
| Gate | Ação | Obrigatórias | Opcionais | Warnings permitidos | Exceções |
|---|---|---|---|---|---|
| `QG-ONBOARDING-BATCH` | ONBOARDING_BATCH | DQ-LOT-001, DQ-LOT-002, DQ-LOT-004, DQ-TEN-001, DQ-TEN-002, DQ-AVAIL-001, DQ-AVAIL-003, DQ-AVAIL-005, DQ-AVAIL-006, DQ-AVAIL-007, DQ-TX-001, DQ-GEO-012, DQ-GEO-002, DQ-GEO-003, DQ-GEO-004, DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004, DQ-VOL-001, DQ-VJ-LOT-003, DQ-VJ-SCHEMA-001, DQ-VJ-DIST-001 | DQ-AVAIL-002, DQ-PRICE-005, DQ-ANA-001, DQ-ANA-002, DQ-ANA-003, DQ-PROV-001, DQ-NULL-001 | **null — necessita confirmação** | sim (se política permitir) |
| `QG-DEVELOPMENT-PUBLICATION` | DEVELOPMENT_PUBLICATION | DQ-LOT-001, DQ-LOT-002, DQ-LOT-004, DQ-TEN-001, DQ-TEN-002, DQ-AVAIL-001, DQ-AVAIL-003, DQ-AVAIL-007, DQ-TX-001, DQ-GEO-012, DQ-GEO-002, DQ-GEO-003, DQ-GEO-004, DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004, DQ-ANA-001, DQ-ANA-002, DQ-VOL-001, DQ-VJ-LOT-003 | DQ-AVAIL-002, DQ-PRICE-005, DQ-ANA-003, DQ-PROV-001, DQ-NULL-001 | **null — necessita confirmação** | sim (se política permitir) |
| `QG-PRICE-TABLE-ACTIVATION` | PRICE_TABLE_ACTIVATION | DQ-LOT-001, DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004 | DQ-PRICE-005 | **null — necessita confirmação** | não |
| `QG-ANALYSIS-ACTIVATION` | ANALYSIS_ACTIVATION | DQ-LOT-001, DQ-ANA-001, DQ-ANA-002 | DQ-ANA-003 | **null — necessita confirmação** | sim (se política permitir) |
| `QG-RESERVATION` | RESERVATION | DQ-AVAIL-001, DQ-AVAIL-004, DQ-TX-001 |  | **null — necessita confirmação** | não |
| `QG-PROPOSAL-SUBMIT` | PROPOSAL_SUBMIT | DQ-AVAIL-001, DQ-AVAIL-004, DQ-PRICE-003, DQ-PRICE-004 |  | **null — necessita confirmação** | não |
| `QG-PUBLIC-SHARE` | PUBLIC_SHARE | DQ-LOT-001, DQ-AVAIL-001, DQ-PRICE-003, DQ-PRICE-004 |  | **null — necessita confirmação** | não |
| `QG-RESTORE-VALIDATION` | RESTORE_VALIDATION | DQ-LOT-001, DQ-LOT-002, DQ-LOT-004, DQ-TEN-001, DQ-TEN-002, DQ-AVAIL-001, DQ-AVAIL-003, DQ-AVAIL-007, DQ-TX-001, DQ-GEO-012, DQ-GEO-002, DQ-GEO-004, DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004, DQ-ANA-001, DQ-ANA-002, DQ-VOL-001, DQ-VJ-LOT-003 | DQ-AVAIL-002, DQ-PROV-001 | **null — necessita confirmação** | não |
| `QG-MIGRATION-VALIDATION` | MIGRATION_VALIDATION | DQ-LOT-001, DQ-LOT-002, DQ-LOT-004, DQ-TEN-001, DQ-TEN-002, DQ-AVAIL-001, DQ-AVAIL-003, DQ-AVAIL-007, DQ-TX-001, DQ-GEO-012, DQ-GEO-002, DQ-GEO-004, DQ-PRICE-008, DQ-PRICE-002, DQ-PRICE-003, DQ-PRICE-004, DQ-ANA-001, DQ-ANA-002, DQ-VOL-001, DQ-VJ-LOT-003 | DQ-AVAIL-002, DQ-PROV-001 | **null — necessita confirmação** | não |

## Decisão
CHECK_FAILED em obrigatória → BLOCK (ENFORCED) ou REVIEW; falha BLOCKING ENFORCED → BLOCK; ERROR ou BLOCKING em WARNING → REVIEW; drift de schema não-quebrante → REVIEW; exceção só vale se ativa e permitida pela política (senão NOT_WAIVABLE); actionCode desconhecido, política inválida ou organização divergente → BLOCK.
