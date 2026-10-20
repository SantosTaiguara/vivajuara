# Arquitetura do Document Domain (Tópico 32)

**Princípio:** documento ≠ arquivo. Um `Document` é o artefato de negócio (planta oficial, tabela de preço, folder, apresentação);
uma `DocumentVersion` é um passo imutável do seu conteúdo depois de publicado; um `FileAsset` são bytes. Prévias, imagens de página,
OCR e texto extraído são `DocumentRepresentation` **derivadas** (`authoritative: false`) — o original continua sendo a fonte.

```
Document ─┬─ Version 1 ── FileAsset(s) ── Representations (preview, page image, texto…)
          └─ Version 2 …      currentPublishedVersionId ≠ latestVersionId
DocumentSourceRef = Document + DocumentVersion exata + DocumentLocator (página, planilha/célula, linha, seção, feature)
```

## Módulos (frontend, sem rede, sem relógio implícito)

| Arquivo | Namespace | Papel |
|---|---|---|
| `src/documents/integrity.js` | `App.integrity` | SHA-256 (verificado contra `node:crypto`), serialização canônica, `fingerprint` (`fp1:`), `stableId`, detecção de MIME por *magic bytes*. Compartilhado com os tópicos 33 e 34. |
| `src/documents/documentDomain.js` | `App.documents` | Enums, registro de tipos (configurável), políticas de arquivo/duplicidade/acesso/retenção, fábricas, `DocumentLocator`, `sourceRef`, validação de versão, imutabilidade (`checkVersionPatch`), decisão de acesso (`decide`). |
| `src/documents/documentServices.js` | `App.documentServices` | Store (porta, em memória), Repository *tenant-aware*, Storage (namespace por organização, quarentena, token de download curto), Ingestão, Publicação, Resolver de versão, Busca filtrada por autorização, Preview, Snapshot, documento gerado, coleção, pacote para cliente, retenção/arquivamento, eventos, catálogo legado, ViewModels e DTOs. |
| `config/documents/viva-juara.json` | `App.configs.documents` | Tipos, políticas e o inventário dos documentos legados (gerado por `scripts/documents/buildLegacyInventory.js`). |
| `src/presentation/dataTrustView.js` | `App.dataTrustView.relatedDocuments` | Lista "Documentos relacionados (n)" para Quick View e Detalhes. |

## Fluxo de ingestão
`stage → scan (porta) → detectar MIME → hash → identificar documento → versão → validar → extrair (porta)` — a versão termina em
`UPLOADED`/`READY_FOR_REVIEW`, **nunca** publicada automaticamente. Publicar exige `VALIDATED`, scan `CLEAN` e cópia gerenciada para
autoridade oficial; a versão anterior vira `SUPERSEDED` (continua auditável) e o ponteiro `currentPublishedVersionId` troca numa única
atribuição. O evento `DocumentVersionPublished` leva `previousVersionId` — é o gancho do Tópico 33 (análise de impacto).

## Regras invariantes implementadas
- Todo registro tem `organizationId`; documento de outra organização é "não encontrado" (não confirma existência).
- Nome de arquivo nunca identifica documento (`matchDocument` → `REVIEW`), nem é chave de storage.
- Versão publicada é imutável (`PUBLISHED_VERSION_IMMUTABLE`); só metadados operacionais (índice/preview) mudam.
- Busca aplica tenant + autorização **antes** de título, trecho ou contagem.
- Download: autoriza, audita e emite token curto (300 s padrão, 900 s máx.); referência externa nunca é baixável.
- Eventos e logs sem conteúdo, sem nomes de arquivo, sem PII.
- Exclusão física bloqueada para publicado/referenciado (`RETENTION_POLICY_BLOCKED`).

## Backend (contrato; não implementado aqui)
Ver `DOCUMENT_AND_VERSION_SCHEMA.md` (DDL proposta) e `DOCUMENT_STORAGE_SECURITY.md` (storage, scan, URLs assinadas).
O frontend usa a mesma interface do Store/Storage; o backend substitui as portas por Postgres + object storage.
