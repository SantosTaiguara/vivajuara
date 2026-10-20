# Relatório do Tópico 32 — Documentos como entidades

## Entregas
- `src/documents/integrity.js` (`App.integrity`): SHA-256 puro, serialização canônica, fingerprint `fp1:`, ids estáveis, detecção de tipo de mídia. Compartilhado com os tópicos 33 e 34.
- `src/documents/documentDomain.js` (`App.documents`): Document, DocumentVersion (imutável após publicação), ciclo de vida DRAFT/PENDING_REVIEW/PUBLISHED/SUPERSEDED/REVOKED/ARCHIVED, classificação, autoridade, política de acesso `decide()` com negação por padrão.
- `src/documents/documentServices.js` (`App.documentServices`): repositório, ingestão (checksum, varredura simulada, quarentena), publicação com supersessão da versão anterior, eventos `DocumentVersionPublished`, busca e URLs de acesso sem PII nem segredo.
- `scripts/documents/buildLegacyInventory.js` e `config/documents/viva-juara.json`: 10 documentos e 63 itens inventariados (DOCUMENT 27, DERIVED 22, UI_ASSET 3, GENERATED 9, TEMPORARY 1, UNKNOWN 1) a partir do que o app já referencia (planta oficial em PDF, materiais de lançamento, `img_list`, dados de planta).
- UI: `src/presentation/dataTrustView.js` (`relatedDocuments`, ações `doc-preview`, `doc-download`) e `dataTrust.css`.
- Testes: `tests/documents.test.js` (12).
- Docs: DOCUMENT_DOMAIN_ARCHITECTURE, DOCUMENT_AND_VERSION_SCHEMA (com rascunho de DDL), DOCUMENT_STORAGE_SECURITY, DOCUMENT_INGESTION_PIPELINE, DOCUMENT_ACCESS_POLICY, DOCUMENT_SEARCH_INDEXING, DOCUMENT_EXTRACTION_AND_REPRESENTATIONS, DOCUMENT_RETENTION_POLICY, DOCUMENT_LEGACY_MIGRATION_REPORT.

## Invariantes respeitados
- Nenhum documento legado foi marcado como verificado: os vínculos ficam em REQUIRES_REVIEW e a classificação/autoridade é provisória.
- A planta legada não pode ser publicada sem localizador de armazenamento gerenciado (teste cobre o bloqueio).
- Sem segredos no frontend; localStorage não concede acesso; URLs não carregam PII.

## Adiado para backend (só contratos)
Armazenamento gerenciado, antivírus real, URLs assinadas, OCR/extração, índice de busca e retenção executada no servidor.

## Decisões humanas
- Confirmar vínculos legados REQUIRES_REVIEW e a classificação/autoridade provisória.
- Ingerir os originais em armazenamento gerenciado, varrer e publicar a planta com localizador.
- Decidir o tratamento do item `implantacao-2` (UNKNOWN).
- Registrar o arquivo da tabela de preços e o evento de lançamento como documentos.
- Registrar as permissões `document.*` e os papéis.
