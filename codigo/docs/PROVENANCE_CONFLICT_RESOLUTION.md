# Conflitos de proveniência e resolução (Tópico 33)

- `reportCandidates(t, { entityType, entityId, attributePath, candidates[] })`: candidatos com o mesmo fingerprint (e unidade) **concordam**
  → um registro com várias evidências (aviso `MULTIPLE_EVIDENCE_SOURCES`; quantidade de fontes não é qualidade). Divergência →
  `ProvenanceConflict` (`VALUE_MISMATCH | UNIT_MISMATCH | SOURCE_DISAGREEMENT | TEMPORAL_CONFLICT | DUPLICATE_INCONSISTENT | METHOD_DISAGREEMENT`).
- Política padrão por campo: **`NO_AUTO_RESOLUTION`** (config `resolutionPolicies.default`). Modos suportados: `AUTHORITY_ORDER`
  (só resolve se a autoridade for estritamente maior; empate fica `OPEN`), `MANUAL_REVIEW_REQUIRED`; demais modos reservados.
- Conflito aberto: o registro corrente vai para `REVIEW_REQUIRED`; evento `ProvenanceConflictDetected`; o valor canônico **não muda**.
- Resolução manual: permissão `provenance.resolveConflict`, motivo obrigatório, histórico do conflito preservado (`conflictHistory`).
  Aplicar o candidato escolhido ao valor canônico é tarefa do pipeline de dados, com validação em shadow (Tópico 33 não altera valores).
- Exemplo funcional (teste `ConflictingAreaSources`): Planta V3 = 250, Planilha V5 = 255 → `OPEN` até resolução.
