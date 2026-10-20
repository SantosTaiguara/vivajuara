# Dimensões e perfis de avaliação (Tópico 34)

| Dimensão | Fonte do valor (config) | Aplica-se quando |
|---|---|---|
| EVIDENCE_INTEGRITY | `evidenceStateRules` (VERIFIED 1,0 · PARTIAL 0,6 · UNRESOLVED 0,3 · MISSING/CONFLICTED/INVALID bloqueiam) | sempre que no perfil |
| SOURCE_AUTHORITY | `sourceAuthorityRules` (OFFICIAL_PRIMARY 1,0 … UNKNOWN 0,3); melhor autoridade, **sem somar fontes**; autoridade não registrada = UNKNOWN | há fonte |
| CURRENTNESS | `currentnessRules` (CURRENT 1,0; SOURCE_SUPERSEDED 0,5 teto 0,6; STALE/REVIEW 0,4 teto 0,5; UNKNOWN 0,6) | sempre |
| CONSISTENCY | fonte única 0,8; concordância independente 1,0; correlacionadas/independência desconhecida 0,8 (sem bônus) | há fonte |
| LOCATOR_SPECIFICITY | `EXACT_CELL/FEATURE 1,0 · EXACT_ROW 0,9 · PAGE 0,7 · SECTION 0,6 · NONE 0,4` | evidência de documento |
| EXTRACTION_QUALITY | qualidade do extrator (ex.: OCR) | valor extraído; fonte estruturada = não aplicável |
| METHOD_RELIABILITY | `baseReliability` da avaliação do método | método avaliado |
| DEPENDENCY_CONFIDENCE | agregação geométrica das entradas | há entradas |
| DEPENDENCY_COVERAGE | entradas com confiança / entradas | há entradas |
| MODEL_APPLICABILITY | informado pela avaliação do modelo | quando informado |
| CALIBRATION_QUALITY | DRAFT 0,5 · VALIDATED 0,7 · CALIBRATED 1,0 | método avaliado |
| MANUAL_SUPPORT | com evidência 0,8 · sem 0,3 | asserção/override manual |
| LEGACY_TRACEABILITY | documento candidato identificado 0,5 · sem candidato 0,3 | LEGACY_DECLARED |

## Perfis (por ProvenanceKind)
- DIRECT_SOURCE: integridade 3, autoridade 3, atualidade 2, consistência 1, locator 1, extração 1.
- NORMALIZED_SOURCE: idem + confiabilidade do método de normalização 1 (exige avaliação).
- CALCULATED: confiança das entradas 3, cobertura 2, método 2, atualidade 1, integridade 1 (exige avaliação).
- ESTIMATED: entradas 2, cobertura 1, método 3, aplicabilidade 1, calibração 2, atualidade 1 (exige avaliação). **Estimativa com confiança alta continua estimativa.**
- AGGREGATED: entradas 3, cobertura 2, método 1. ANALYSIS_DERIVED: como ESTIMATED sem aplicabilidade.
- MANUAL_ASSERTION / MANUAL_OVERRIDE: suporte 3, integridade 2, atualidade 1 + teto sem evidência (0,4 / 0,3). Cargo do usuário não aumenta score.
- LEGACY_DECLARED: rastreabilidade 3, integridade 2, atualidade 1 + teto legado **0,35** (nunca alta por padrão).
- NOT_AVAILABLE: `NOT_APPLICABLE`, score null.

Política por campo (`fieldPolicies`, resolução exata → subdomínio → domínio → `*`): campos críticos = `geometry.areaM2`, `commercial.*`,
`availability.*` (usados no diagnóstico de "campos críticos com confiança baixa").
