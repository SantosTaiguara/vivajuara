# Diff e impacto entre versões (Tópico 35)

`diff(fromId, toId)` → `AnalysisVersionDiff { changedEntityCount, changedAttributeCount, moduleDiffs[{ moduleId, fromModuleVersion, toModuleVersion, reused, changedOutput }], attributeDiffSummary, causeSummary }`. Causas só a partir dos metadados de execução (snapshots e refs): INPUT_CHANGED, METHODOLOGY_CHANGED, ENGINE_CHANGED, LEGACY_MIGRATION; mudança sem metadado que a explique = UNKNOWN (sem causalidade inventada).

`impact(candidateId, currentId)` → `AnalysisImpactReport { changedEntityCount, classTransitionCounts ("A→B": n), criticalFieldChangeCount, largestChanges (maior delta de score e de posição no ranking geral, ordem determinística, top 20), rankingShiftSummary, causeSummary }`. Exigido antes de publicar sobre uma versão atual (`requireImpactReview`). Complementa o impact report de metodologia do Tópico 13 (`App.methodology.impact`), sem duplicar cálculo de score.

UI técnica: mostrar resumo (contagens, transições, maiores mudanças) com detalhe sob demanda, nunca a grade 498×70 por padrão.
