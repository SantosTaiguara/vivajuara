# Política de normalização de nulos e sentinelas (Tópico 37)

## Camada raw
`observeRaw(obj, rawFieldName)` → `RawFieldObservation { rawValue, rawPresenceState, rawFieldName, sourceRef, observedAt }`
com `RawDataPresenceState`: PRESENT, MISSING_KEY, NULL_VALUE, EMPTY_STRING, SENTINEL, PARSE_ERROR.
`normalizeObservation(raw, { policy, parse })` → `NormalizedFieldObservation` (+ canonicalValue, canonicalDataState, reasonCode, policyVersion).
O estado é decidido na importação e não é reconstruído depois.

## NullNormalizationPolicy `legacy-lots-json@1` (`LEGACY_POLICY`)
| Situação | Resultado |
|---|---|
| chave ausente | UNKNOWN / LEGACY_UNCLASSIFIED |
| `null` explícito | UNKNOWN / LEGACY_UNCLASSIFIED; exceto `st` (status) → UNKNOWN / SOURCE_NOT_INGESTED |
| `""` | INVALID / VALIDATION_FAILED (não vira null silenciosamente) |
| parse falhou | INVALID / VALIDATION_FAILED |
| `fech = "Não informado – necessita confirmação"` (30 lotes) | NOT_AVAILABLE / SOURCE_NOT_PROVIDED |

Sentinelas são **por fonte e por campo**; não existe lista global. `"-"`, `"N/A"`, `"ND"`, `9999`, `-1` não foram encontrados
nos arquivos atuais (`lots.json`, `commercial.json`, `analysis-input.json`) e não são reinterpretados se aparecerem.

## Inventário dos arquivos-fonte
| Arquivo | Ocorrência | Tratamento |
|---|---|---|
| lots.json | `st = null` ×498 | status UNKNOWN (sem espelho de vendas) |
| lots.json | `nt.vent`, `nt.topo`, `nt.pc = null` ×498 | NOT_AVAILABLE com motivo por evidência do registro |
| lots.json | `al = []` ×215 | coleção vazia conhecida (alertas calculados) |
| lots.json | `fech` sentinela ×30 | NOT_AVAILABLE / SOURCE_NOT_PROVIDED |
| commercial.json | `validFrom/validUntil = null` | NOT_AVAILABLE / SOURCE_NOT_PROVIDED |

## Zeros
Zero nunca é reclassificado globalmente. Zeros encontrados: `mobility.vehiclesPassingEstimate` (17), `environmental.frontBearingDeg` (1),
`environmental.privacyScore` (1), `availability.revision` (498) — válidos; `geometry.leftDepthM` (1), `rightDepthM` (2), `rearEdgesM` (2) —
mantidos KNOWN com aviso `ZERO_REQUIRES_REVIEW` (medida da planta; revisão humana).
