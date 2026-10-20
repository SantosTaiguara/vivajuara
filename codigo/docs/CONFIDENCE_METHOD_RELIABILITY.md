# Confiabilidade de métodos (Tópico 34)

`MethodReliabilityAssessment { methodId, methodVersion, assessmentStatus: UNASSESSED | DRAFT | VALIDATED | CALIBRATED, baseReliability?,
applicabilityRules?, knownLimitations?, calibrationRef?, validationDatasetRef?, assessedAt?, assessedBy?, version }`.

**Não se inventa confiabilidade.** Método sem avaliação = `UNASSESSED` ⇒ perfis que exigem avaliação retornam `METHOD_UNASSESSED` (score null).
`baseReliability` não é acurácia sem dataset de validação.

| Método | Versão | Status | Observação |
|---|---|---|---|
| `lot_price_per_m2_times_area` | 1 | DRAFT (proposta 0,99, teto 0,7 enquanto DRAFT) | fórmula determinística reproduzida nos 498 lotes |
| `down_payment_percent_of_price` | 1 | DRAFT (proposta 0,99) | percentual vem do evento (não confirmado) |
| `plan_geometry_measurement`, `plan_vectorization` | 1 | UNASSESSED | precisão declarada ~0,3 m, não validada |
| `analysis_model`, `analysis_rules`, `analysis_ranking` | 2026-10-06 | UNASSESSED | modelo comparativo; sem verdade de referência |
| `solar_orientation` | 1 | UNASSESSED | não considera sombras |
| `lot_id_rule`, `lot_display_code_rule` | 1.0 | UNASSESSED | |
| `availability_revision_sequence`, `availability_freshness_policy` | 1 / 29.1.0 | UNASSESSED | |
| `br_decimal_to_number`, `area_string_to_decimal` | 1.0.0 / 1 | UNASSESSED | normalizadores |

Efeito em shadow: 27.283 resultados `METHOD_UNASSESSED` (8 métodos). Governança: avaliação por especialista com registro de quem/quando,
limitações conhecidas e, quando houver, dataset de validação; avaliação nova = nova `version` da avaliação.
