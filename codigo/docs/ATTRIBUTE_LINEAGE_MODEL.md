# Modelo de linhagem de atributos (Tópico 33)

- `AttributeDependencyRef { organizationId, entityType, entityId, attributePath, valueFingerprint, provenanceId? }` — cada entrada aponta
  para o **valor exato** (fingerprint) que alimentou o cálculo.
- `MethodRef { methodId, methodVersion, methodType, parametersHash?, configurationRefs?, implementationRef?, descriptionKey? }` — nunca só nome
  humano; versão obrigatória. Métodos legados sem versão rastreável (`kmz-v1` geoespacial/regras/rotas, `aerial-v1` interpretação visual)
  **não** ganham versão inventada: os campos migram como `LEGACY_DECLARED / PARTIAL`.
- Grafo acíclico: `wouldCycle` impede registrar um atributo que dependa (transitivamente) de si mesmo (`LINEAGE_CYCLE`).
- Profundidade padrão 2, máximo 3 na UI (`lineageViewModel`); `graph.downstream` encontra dependentes para análise de impacto.
- Configurações também são linhagem: `CONFIG_VERSION { configType, configId, configVersion, configChecksum }`.
- Saída do motor de análise: `AnalysisOutput { value, trace: { moduleId, moduleVersion, methodologyVersion, inputAttributeRefs, configRefs } }`
  → `fromAnalysisTrace` monta o registro; o módulo não conhece storage.
- Valores com versão: `valueVersionRef` = `STATIC_DATA_VERSION:2026-10-06.1` para dados estáticos, `ANALYSIS_VERSION:2026-10-06` para
  `intelligence.*`; `DataVersionRef` cobre `PRICE_TABLE_VERSION`, `AVAILABILITY_REVISION`, `DOCUMENT_VERSION`, `CUSTOM_VERSION`.

Exemplos reais da migração (lote VJ-QA-L0001):
- `commercial.price` = CALCULATED `lot_price_per_m2_times_area v1`, entradas `geometry.areaM2` + `commercial.pricePerM2`, evidência
  `PriceTableVersion lancamento-2026-10` (checksum); fórmula reproduzida para os 498 lotes (`metadata.reproducible = true`).
- `geometry.centroid` = CALCULATED `plan_vectorization v1` ← `geometry.polygon`.
- `intelligence.scores.overall` = ANALYSIS_DERIVED (estimativa) com `ANALYSIS_RESULT analysis-v1 @ 2026-10-06`, metodologia `1.0.0`.
