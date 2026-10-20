# Relatório do Tópico 34 — confidence_score (modo SHADOW)

## Entregas
- `config/confidence/viva-juara.json`: metodologia `viva-juara-data-confidence` 0.1.0-draft (DRAFT, UNCALIBRATED), 13 dimensões, perfis por tipo de proveniência, tetos, faixas, `executionMode: SHADOW`, teto legado 0,35.
- `src/confidence/confidenceEngine.js` (`App.dataConfidence`): motor puro (média geométrica ponderada, tetos, faixas, status, explicação).
- `src/confidence/confidenceServices.js` (`App.dataConfidenceServices`): registro de metodologias (publicada é imutável), repositório, cache, avaliação por atributo/entidade/empreendimento, projeção, diagnóstico, `impactReport`, `checkComparable`.
- UI: `dataTrustView.confidencePanel` (ação `conf-open`, somente perfil técnico).
- Testes: `tests/confidence.test.js` (15), incluindo delta zero de negócio.
- Docs: DATA_CONFIDENCE_ARCHITECTURE, CONFIDENCE_METHODOLOGY_SPEC, CONFIDENCE_DIMENSIONS_AND_PROFILES, CONFIDENCE_PROPAGATION_POLICY, CONFIDENCE_METHOD_RELIABILITY, CONFIDENCE_UI_PROJECTION_POLICY, CONFIDENCE_SHADOW_VALIDATION_REPORT, CONFIDENCE_METHODOLOGY_IMPACT_REPORT.

## Resultado em SHADOW
COMPUTED 23.513, METHOD_UNASSESSED 27.283, NOT_APPLICABLE 15.438, INSUFFICIENT_EVIDENCE 498. Faixas: LOW 18.533 (todo o legado), MEDIUM 2.988, HIGH 498, VERY_HIGH 1.494. Score de negócio, ranking, classes, cores e preços inalterados.

> **Confiança não é probabilidade.** É indicador ordinal da qualidade da evidência, não calibrado.

## Decisões humanas
- Avaliar a confiabilidade dos métodos (hoje UNASSESSED, exceto duas fórmulas em DRAFT 0,99).
- Aprovar pesos, tetos e faixas; publicar a metodologia (sem publicação automática).
- Decidir quando, e se, sair do modo SHADOW.
- Registrar `confidence.*`.
