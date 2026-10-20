# Relatório do Tópico 33 — Proveniência por atributo

## Entregas
- `config/provenance/viva-juara.json`: registro de métodos versionados, métodos legados não versionados, motivos de "não disponível" por campo, políticas de resolução (padrão NO_AUTO_RESOLUTION) e mapeamento legado.
- `src/provenance/provenanceModel.js` (`App.provenance`): tipos de proveniência, estados de evidência, atualidade calculada na leitura, referências de evidência (documento, lote de importação, API externa, dependência, análise, configuração, afirmação de usuário, registro de sistema), validação (inclui detecção de segredo e ciclo de linhagem), conflitos, afirmação manual e override.
- `src/provenance/provenanceServices.js` (`App.provenanceServices`): repositório append-only com histórico e transições de status, grafo de linhagem, análise de impacto em `DocumentVersionPublished` (marca revisão, não recalcula), projeções CLIENT/BROKER/TECHNICAL/AUDIT, cobertura e diagnóstico.
- `src/provenance/legacyProvenance.js` (`App.provenanceMigration`): migração dos 498 lotes.
- UI: `dataTrustView.badge`, `drilldown` (ações `prov-open`, `prov-history`, `prov-resolve`).
- Testes: `tests/provenance.test.js` (15).
- Docs: ATTRIBUTE_PROVENANCE_ARCHITECTURE, PROVENANCE_KIND_AND_EVIDENCE_SEMANTICS, ATTRIBUTE_LINEAGE_MODEL, PROVENANCE_CONFLICT_RESOLUTION, PROVENANCE_UI_PROJECTION_POLICY, PROVENANCE_LEGACY_MIGRATION_REPORT, PROVENANCE_COVERAGE_REPORT.

## Resultados da migração
66.732 registros (498 x 134), delta zero nos valores, 0 verificados a partir do legado. Por tipo: CALCULATED 10.351, LEGACY_DECLARED 18.533, DIRECT_SOURCE 3.984, NOT_AVAILABLE 15.438, ESTIMATED 9.462, ANALYSIS_DERIVED 8.964. Diagnóstico: 0 referências quebradas, 0 divergências, 0 conflitos; 3.486 nulos sem motivo (7 campos) em REVIEW. Preço reproduzível em todos os lotes (R$ 1.196/m² x área). Disponibilidade permanece UNKNOWN nos 498 lotes.

> Proveniência registra de onde o valor veio e como foi obtido. **Não é garantia de verdade.**

## Adiado para backend
Persistência append-only em banco, trilha de auditoria assinada, fila de revisão.

## Decisões humanas
- Motivos de ausência para os 7 campos nulos sem motivo.
- Versionar os métodos de KMZ e imagem aérea.
- Resolver revisões pendentes; registrar `provenance.*`.
