# Especificação do snapshot de entrada (Tópico 35)

`App.versioning.inputSnapshot(def, fontes, { organizationId, developmentId, at })` → `AnalysisInputSnapshot` congelado:
`{ id "snap:<checksum>", organizationId, developmentId, analysisDefinitionId, staticDataVersion, versionedDataRefs, dynamicDataRefs, documentVersionRefs, externalSnapshotRefs, configVersionRefs, methodologyRefs, provenanceRevision, entitySetRef, entityCount, engineBuildRef, moduleGraphChecksum, dependencyFingerprints[], generatedAt, checksum }`.

Somente as dependências declaradas em `def.dependencyDomains` entram. Para LOT_INTELLIGENCE_BASE:

| Domínio | Ref | Entra? |
|---|---|---|
| STATIC_DATA_VERSION | `2026-10-06.1` | sim |
| MEASUREMENT_INPUT | `measurements-2026-10-06` + sha256 do export + checksum das 498 entradas | sim |
| SCORING_METHODOLOGY | `viva-juara-scoring` 1.0.0 + checksum | sim |
| ENGINE_BUILD | engine 1.0.0 + versões de módulo (runtime/artefato quando informados) | sim |
| PRICE_TABLE_VERSION | — | **não** (a metodologia não lê preço; verificado em teste) |
| AVAILABILITY_REVISION | — | **não** |

Por isso uma mudança de disponibilidade (1042 → 1043) ou de tabela de preço deixa a análise `CURRENT_INPUTS`. Uma definição que declare PRICE_TABLE_VERSION passa a ver a mudança (teste com definição sintética).

`dependencyFingerprints[]` (`AnalysisDependencyFingerprint`): por módulo, `inputFingerprint` (partes da entrada que ele lê), `configFingerprint`/`methodologyFingerprint` (seção da metodologia que o configura), `upstreamModuleFingerprint`, `computationKey` (hash de tudo isso + versão do módulo; módulos CROSS_ENTITY incluem o conjunto de entidades).
