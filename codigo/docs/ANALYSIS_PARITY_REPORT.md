# Relatório de paridade da análise (Tópico 35)

Baseline `MIGRATED_LEGACY` (valores publicados em lots.json, análise 2026-10-06) × candidata `COMPUTED` (IntelligenceEngine 1.0.0, metodologia 1.0.0, entradas `measurements-2026-10-06`). Reproduzido por `tests/versioning.test.js`.

| Campo | Valor |
|---|---|
| comparedEntityCount | 498 |
| comparedAttributeCount | 8466 |
| exactMatchCount | 5535 |
| toleranceMatchCount | 2931 |
| mismatchCount | 0 |
| validação da candidata | PASS (14 checagens, 0 erros) |
| checksum do result set | 5c5db8a2 |
| snapshot de entrada | snap:5a3d2cf9 |

Atributos comparados por lote: scores (5), classe, rankings (5 tipos), tipos de destaque, alertas (tipo+severidade), confiança — **exatos**; 11 notas de critério comparadas na precisão publicada (1 casa decimal) — contadas como *toleranceMatch* (normalização de precisão, não diferença semântica).

Resultado: **zero divergências**. A candidata pode ser publicada como versão atual depois da revisão humana (política: `requireParityForMigration`, sem publicação automática).
