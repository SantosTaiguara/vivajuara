# Especificação da metodologia de confiança (Tópico 34)

Metodologia vigente: **`viva-juara-data-confidence` `0.1.0-draft`**, `status: DRAFT`, `calibrationStatus: UNCALIBRATED`,
`executionMode: SHADOW`. **Todos os números são propostas a aprovar** — nenhum foi validado por especialista nem calibrado.

## Estrutura (`ConfidenceMethodologyConfig`)
`id, version, checksum (sha256 canônico, sem status/publishedAt), status, scale {min 0, max 1, displayMultiplier 100}, bands[],
defaultAggregationMethod, evaluationProfiles{kind → dimensions{dim: peso}, requireMethodAssessment}, evidenceStateRules, sourceAuthorityRules,
currentnessRules, locatorSpecificityRules, consistencyRules, calibrationQualityRules, manualSupportRules, legacyTraceabilityRules,
methodAssessmentRules, conflictPolicy, dependencyPolicy, multiSourcePolicy, legacyPolicy, manualAssertionPolicy, overridePolicy,
fieldPolicies (padrões por campo/domínio), methodAssessments[]`.

## Faixas propostas
`VERY_LOW [0, 0.2)`, `LOW [0.2, 0.4)`, `MEDIUM [0.4, 0.6)`, `HIGH [0.6, 0.8)`, `VERY_HIGH [0.8, 1]` — limites `minInclusive`/`maxExclusive`
(última `maxInclusive`), sem sobreposição e cobrindo a escala (validado). Nenhum limiar está no componente de UI.

## Agregação
Padrão `WEIGHTED_GEOMETRIC_MEAN` (um fator crítico baixo não é mascarado por vários altos); pesos normalizados sobre as dimensões aplicáveis;
dimensão inexistente é `NOT_APPLICABLE`/`MISSING` e sai da conta (nunca vira 0). Peso total zero → erro. Depois: bônus de concordância
independente (≤ 0,05) e **tetos** (menor teto vence; cada teto aparece no trace e na explicação).

## Validador (`validateMethodology`)
Status/calibração válidos; faixas sem lacuna/sobreposição; dimensões conhecidas; pesos finitos e ≥ 0; peso total > 0; regras com `reasonCode`
e notas em [0,1]; tetos em [0,1]; políticas de conflito/dependência válidas; `UNASSESSED` sem `baseReliability`; versão publicada com checksum
íntegro. Só metodologia `VALIDATED` pode ser publicada, com `confidence.methodology.manage`; publicação nunca é automática.

## Ciclo
DRAFT (shadow) → revisão de distribuição (`CONFIDENCE_SHADOW_VALIDATION_REPORT.md`) → revisão de especialista → VALIDATED →
relatório de impacto → PUBLISHED (imutável; mudança = nova versão).
