# Pipeline de ingestão de documentos (Tópico 32)

`ingest(t, { origin, developmentId, sourceRef, items[], duplicatePolicy }, access)` → `DocumentIngestionBatch`.

| Etapa | Implementação | Falha |
|---|---|---|
| Permissão | `document.upload` | `DOCUMENT_ACCESS_DENIED` |
| Scan | porta `scanner(bytes)` | `QUARANTINED` (`MALWARE_DETECTED`) |
| Detectar tipo | `App.integrity.detectMediaType` | `MEDIA_TYPE_MISMATCH`, `SCRIPTABLE_CONTENT` |
| Hash | SHA-256 | — |
| Identificar documento | `matchDocument`: id explícito → código → externalId → número do emissor → `newDocument` explícito | sem identificador estável → `READY_FOR_REVIEW` (`REQUIRES_REVIEW:NO_STABLE_IDENTIFIER`); **nunca** por nome/semelhança |
| Duplicidade (mesmo tenant) | `REJECT_EXACT_DUPLICATE`, `ALLOW_WITH_WARNING`, `LINK_EXISTING_ASSET`, `REQUIRE_REVIEW` (padrão) | mesma versão do mesmo documento → `DUPLICATE_VERSION` |
| Versão | número sequencial, `supersedesVersionId` | `VERSION_SEQUENCE_INVALID` |
| Validar | `App.documents.validateVersion` | lista de erros/avisos no `validationSummary` |
| Extrair / indexar | porta `extractor(bytes)`; falha não invalida o original | `EXTRACTION_FAILED` (aviso) |

Resultado por item: `READY_FOR_REVIEW | REJECTED | QUARANTINED | FAILED`; lote: `READY_FOR_REVIEW | PARTIAL | REJECTED | FAILED`.
Depois: `validateVersion` (permissão `document.validate`) → `VALIDATED`; `publish` (permissão `document.publish`) → `PUBLISHED`.

Pricing/Availability: `sourceRefFor(t, documentId, versionId, locator)` devolve o `DocumentSourceRef` exato que uma
`PriceTableVersion` ou `AvailabilityRevision` deve guardar quando os domínios passarem a aceitar a referência (hoje a tabela de preço
não tem arquivo — ver relatório de migração).
