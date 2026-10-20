# Arquitetura de proveniência por atributo (Tópico 33)

Para **um atributo de uma entidade**, a plataforma responde: qual valor (`valueFingerprint`), como foi obtido (`ProvenanceKind`),
quão forte é a evidência (`EvidenceState`), se a fonte continua atual (`ProvenanceCurrentness`), quais fontes exatas, métodos e entradas.

> **Proveniência não é garantia de verdade.** Ela diz de onde o valor veio e como foi produzido; não diz que o valor está correto.
> Também não é score de confiança (Tópico 34): nenhum número sai deste tópico.

## Módulos
| Arquivo | Namespace | Conteúdo |
|---|---|---|
| `src/provenance/provenanceModel.js` | `App.provenance` | Enums, `EvidenceRef` (união discriminada), `MethodRef`, `AttributeDependencyRef`, `DataVersionRef`, `AttributePathRegistry` (= FieldRegistry), `MethodRegistry`, `FieldProvenancePolicy`, `ProvenanceResolutionPolicy`, `createRecord` (id determinístico), `displayCode`/`summarize`, `ProvenanceConsistencyValidator`, conflitos, `ManualAssertionRecord`, `ProvenanceOverrideRecord`, contrato de entrada do Tópico 34. |
| `src/provenance/provenanceServices.js` | `App.provenanceServices` | `AttributeProvenanceIndex` (histórico append-only + transições de status), Repository (TenantContext obrigatório), Service, Builder (`RawFieldObservation → NormalizedFieldObservation → record`, normalizadores versionados), Graph (linhagem, ciclos, profundidade), SourceDependencyIndex, `ProvenanceImpactAnalysis`, Manifest/Coverage/Diagnostics, `ProvenanceProjectionService`, `ProvenanceLineageViewModel`, adapters de Pricing/Availability/Analysis, Cache, Snapshot, eventos, batch query. |
| `src/provenance/legacyProvenance.js` | `App.provenanceMigration` | Migração dos rótulos legados (zero-delta). |
| `config/provenance/viva-juara.json` | `App.configs.provenance` | Métodos com versão rastreável, motivos de ausência por campo, políticas de resolução e ajustes de política por campo. |

## Decisões
- **Records ficam fora de `lots.json`.** O lote continua igual; o índice de proveniência é paralelo e carregado sob demanda.
- **Histórico não é sobrescrito:** um novo registro aponta `supersedesProvenanceId`; o anterior vira `SUPERSEDED` por transição registrada.
- **Currentness é resolvida na leitura** (documento com versão publicada mais nova → `SOURCE_SUPERSEDED`), sem alterar o registro.
- **Publicação de nova versão de documento** → `onDocumentVersionPublished`: registros diretos, vínculos candidatos e dependentes
  (transitivos) vão para `REVIEW_REQUIRED`; **nada é recalculado**.
- **Pricing e Availability mantêm a própria proveniência**; adapters projetam no formato padrão (`ProvenanceSummary`).
- Desempenho: 66.732 registros (498 lotes × 134 atributos) migrados em ~3–4 s e importados em <1 s em Node; no navegador recomenda-se
  calcular por lote sob demanda ou em *worker*. Mapa usa só o `displayCode` (summary leve); linhagem detalhada é lazy (profundidade ≤ 3).

## Backend (contrato)
Tabelas propostas: `attribute_provenance(id, organization_id, development_id, entity_type, entity_id, attribute_path, value_fingerprint,
kind, evidence_state, currentness, method_ref jsonb, not_available_reason, supersedes_id, status, recorded_at, metadata jsonb)`,
`provenance_evidence(provenance_id, ordinal, ref jsonb)`, `provenance_dependency(provenance_id, dep_entity_type, dep_entity_id,
dep_attribute_path, dep_value_fingerprint, dep_provenance_id)`, `provenance_conflict(...)`, `provenance_status_transition(...)`.
Índices: `(organization_id, entity_type, entity_id, attribute_path, recorded_at desc)`, `(organization_id, (ref->>'documentId'))`,
`(organization_id, dep_entity_id, dep_attribute_path)`. Unicidade conceitual: um registro `ACTIVE` por `(org, entity, path)`. RLS por organização.
API: `GET /organizations/{org}/entities/{type}/{id}/provenance/{path}`, `POST /…/provenance:batchQuery { entityIds, attributePaths, detailLevel }`.
