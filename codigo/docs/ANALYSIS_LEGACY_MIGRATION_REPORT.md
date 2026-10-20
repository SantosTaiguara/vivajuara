# Migração do baseline legado (Tópico 35)

## Saídas analíticas inventariadas
Notas de 11 critérios, scores housing/investment/family/premium/overall, overallRaw, classe (percentil), rankings (5 tipos), níveis (ruído, privacidade, liquidez, geometria), descritores (forma, fundos, vista, trânsito, hierarquia, portaria, orientação e sol), destaques, perfis ideais, alertas (agora Rule Engine no Tópico 36, preservados aqui como saída legada), confiança.

## Versões existentes encontradas
`dev.staticDataVersion 2026-10-06.1`, `dev.analysisVersion 2026-10-06`, `lot.metadata.dataVersions { staticVersion, analysisVersion, priceTableVersion, availabilityRevision }`, `methodologyVersion 1.0.0` + checksum (Tópico 13), `ENGINE_VERSION 1.0.0` e versão 1.0 de cada módulo (Tópico 12), `inputVersion measurements-2026-10-06` + sha256 do export, `result.analysisVersion = "1.0.0+<checksum>"`.

## Baseline
`legacyBaseline(lots)` cria a versão `MIGRATED_LEGACY` a partir dos valores publicados (sem recalcular), reprodutibilidade PARTIAL. A candidata `COMPUTED` vem do IntelligenceEngine atual sobre `analysis-input.json`. Paridade: ver ANALYSIS_PARITY_REPORT.md — **zero divergências**. Nenhuma fórmula, peso, limite, classe, ranking ou preço foi alterado.

## Lacunas de reprodutibilidade
Versão de runtime e artefato do engine não registrados no build do navegador; documentos-fonte sem id de versão; o export das medições é gerado fora da plataforma (`scripts/measurements/export_analysis_input.py`).

## Pontos para validação humana
Quem publica (papel com `analysis.publish`); se a candidata substitui o baseline como versão atual; política de "análise desatualizada" para clientes; registrar commit/artefato no build.
