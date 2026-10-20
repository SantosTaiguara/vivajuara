# Esquema de Document, DocumentVersion, FileAsset e afins (Tópico 32)

Campos implementados nas fábricas de `App.documents` (todas congeladas com `Object.freeze`).

## Document
`id` (imutável, nunca derivado de nome de arquivo), `organizationId`, `developmentId`, `documentCode`, `documentType` (registro
configurável), `title`, `description`, `scope` (`ORGANIZATION | DEVELOPMENT | PHASE | BLOCK | LOT | RESOURCE | MIXED_EXPLICIT`),
`classification` (`PUBLIC | ORGANIZATION_INTERNAL | CONFIDENTIAL | RESTRICTED` — nunca nomes de papel), `authority`
(`OFFICIAL_PRIMARY | OFFICIAL_SECONDARY | INTERNAL_APPROVED | INTERNAL_ANALYSIS | MARKETING | EXTERNAL_REFERENCE | UNKNOWN`),
`lifecycleStatus`, `currentPublishedVersionId`, `latestVersionId`, `issuerRef`, `sourceSystemRef`, `origin`, `storageMode`, `tags`,
`createdAt/updatedAt/createdBy`, `metadata`, `revision` (concorrência otimista em `publish(..., { expectedRevision })`).

## DocumentVersion
`id`, `organizationId`, `documentId`, `versionNumber` (sequencial), `versionLabel`, `lifecycleStatus`
(`DRAFT → UPLOADED → VALIDATED → PUBLISHED → SUPERSEDED | ARCHIVED`, `REJECTED`), `sourceEffectiveFrom/To` (vigência da fonte — não é
data de importação), `issuedAt`, `uploadedAt`, `validatedAt`, `publishedAt`, `supersedesVersionId`, `primaryFileAssetId`, `fileAssetIds`,
`contentChecksum` (`sha256:`), `validationSummary`, `authority`, `scope`. Campos ligados ao conteúdo (`CONTENT_BOUND`) não mudam após publicação.

## FileAsset
`id`, `organizationId`, `storageProvider` (`MANAGED | EXTERNAL_REFERENCE | MEMORY`), `storageKey` (nunca exposto em DTO), `originalFilename`
(metadado, não identidade), `mediaType` declarado, `detectedMediaType` (magic bytes), `sizeBytes`, `contentChecksum`, `uploadStatus`,
`securityScanStatus` (`PENDING | CLEAN | SUSPICIOUS | MALICIOUS | NOT_SCANNED`).

## DocumentRepresentation / DocumentExtractionResult
Representação: `type` (`PDF_PREVIEW | THUMBNAIL | PAGE_IMAGE | EXTRACTED_TEXT | STRUCTURED_EXTRACTION | …`), `generatorId/Version`,
`quality`, `derived: true`, `authoritative: false`. Extração: `extractorId/Version`, `status`, `method` (ex.: `TEXT_LAYER`, `OCR`), `quality`.

## DocumentLocator e DocumentSourceRef
Locator: `pageNumber` (1-based), `pageRange`, `sectionHeading`, `sheetName` + `cellRange` (A1), `tableName`, `rowRef`, `coordinates`,
`textAnchor`, `metadata.featureId/layerRef`. Especificidade: `EXACT_CELL > EXACT_FEATURE > EXACT_ROW > PAGE > SECTION > NONE`.
SourceRef: `documentId`, `documentVersionId`, `organizationId`, `locator`, `authority`, `classification`, `checksum`, `sourceEffectiveAt`, `versionStatus`.

## DDL proposta (backend — rascunho, não aplicado; migrations 001–009 intocadas)
```sql
create table documents (
  id text primary key, organization_id text not null references organizations(id), development_id text,
  document_code text, document_type text not null, title text not null, description text,
  scope jsonb not null, classification text not null, authority text not null, lifecycle_status text not null,
  current_published_version_id text, latest_version_id text, origin text not null, tags text[] not null default '{}',
  metadata jsonb not null default '{}', revision int not null default 1, created_at timestamptz not null, updated_at timestamptz not null,
  unique (organization_id, document_code));
create table document_versions (
  id text primary key, organization_id text not null, document_id text not null references documents(id),
  version_number int not null, lifecycle_status text not null, source_effective_from date, source_effective_to date,
  issued_at date, published_at timestamptz, supersedes_version_id text, primary_file_asset_id text not null,
  content_checksum text not null, validation_summary jsonb, unique (document_id, version_number));
create table file_assets (id text primary key, organization_id text not null, storage_provider text not null, storage_key text,
  media_type text, detected_media_type text, size_bytes bigint, content_checksum text not null, upload_status text not null, scan_status text not null);
create table document_representations (...); create table document_extractions (...); create table document_relations (...);
-- RLS: organization_id = current_setting('app.organization_id'); trigger impede UPDATE de colunas CONTENT_BOUND quando status in ('PUBLISHED','SUPERSEDED','ARCHIVED').
```
