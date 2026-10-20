# Política de reprodutibilidade (Tópico 35)

`reproducibility(versionId)` → `{ status FULL|PARTIAL|NON_REPRODUCIBLE|NOT_EVALUATED, missingRefs, runtimeUncertainty, externalMutableSourceRefs, note }`.

- **NON_REPRODUCIBLE**: falta snapshot, referência de medições ou de metodologia.
- **PARTIAL**: falta versão do runtime ou checksum/commit do artefato do engine. Versões calculadas no navegador hoje ficam PARTIAL (o build não carrega commit/artefato).
- **FULL**: entradas, metodologia, engine, runtime e artefato identificados. Os documentos-fonte (PDF da planta, KMZ, imagem aérea) são citados por id de fonte, sem id de versão de documento — registrado em `missingRefs` como DOCUMENT_VERSION_IDS e na nota.
- **Baseline legado (MIGRATED_LEGACY)**: sempre PARTIAL — lots.json não referencia método e entradas exatas; nunca chamado de FULL.

Determinismo: `determinismCheck(inputs, cfg)` roda o engine duas vezes (ordem normal e invertida) e compara checksums canônicos — determinístico e independente de ordem. Perfil de precisão `exact` (tolerância 0); só as notas do baseline são comparadas na precisão publicada (1 casa).
