/* documents/documentDomain.js — Document Domain (topic 32): model, policies and validation.
   DOCUMENT ≠ FILE. A Document is the business artifact (official plan, price table, folder…);
   a DocumentVersion is an immutable step of its content once published; a FileAsset is bytes
   (the original is the source, previews/OCR/extracted text are derived representations).
     Document ─┬─ Version 1 ── FileAsset(s) ── Representations (preview, page image, text…)
               └─ Version 2 …        currentPublishedVersionId ≠ latestVersionId
   Topic 33 points at evidence through DocumentSourceRef = exact DocumentVersion + DocumentLocator.
   Pure: no DOM, no network, no clock (callers pass `now`), no randomness. */
App.documents = (() => {
  const I = App.integrity;
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const DocumentClassification = E('PUBLIC', 'ORGANIZATION_INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'); // never role names (no BROKER_ONLY)
  const DocumentAuthority = E('OFFICIAL_PRIMARY', 'OFFICIAL_SECONDARY', 'INTERNAL_APPROVED', 'INTERNAL_ANALYSIS', 'MARKETING', 'EXTERNAL_REFERENCE', 'UNKNOWN');
  const DocumentLifecycleStatus = E('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'REJECTED');
  const VersionStatus = E('DRAFT', 'UPLOADED', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED');
  const UploadStatus = E('UPLOADING', 'UPLOADED', 'FAILED', 'QUARANTINED', 'DELETED_TEMPORARY');
  const SecurityScanStatus = E('PENDING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS', 'NOT_SCANNED');
  const ScopeType = E('ORGANIZATION', 'DEVELOPMENT', 'PHASE', 'BLOCK', 'LOT', 'RESOURCE', 'MIXED_EXPLICIT');
  const RelationType = E('APPLIES_TO', 'REFERENCES', 'SUPPORTS', 'REPLACES', 'SUPERSEDES', 'ATTACHMENT_OF', 'DERIVED_FROM', 'GENERATED_FROM', 'RELATED_TO');
  const RepresentationType = E('ORIGINAL', 'PDF_PREVIEW', 'THUMBNAIL', 'PAGE_IMAGE', 'EXTRACTED_TEXT', 'STRUCTURED_EXTRACTION', 'SEARCH_INDEX_PAYLOAD', 'OTHER_DERIVED');
  const ExtractionStatus = E('PENDING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'NOT_SUPPORTED');
  const DocumentOrigin = E('UPLOAD', 'IMPORT', 'CONNECTOR', 'EXTERNAL_URL', 'SYSTEM_GENERATED', 'USER_GENERATED', 'MIGRATED_LEGACY');
  const StorageMode = E('MANAGED_COPY', 'EXTERNAL_REFERENCE', 'GENERATED_INTERNAL');
  const DuplicatePolicy = E('REJECT_EXACT_DUPLICATE', 'ALLOW_WITH_WARNING', 'LINK_EXISTING_ASSET', 'REQUIRE_REVIEW');
  const BatchStatus = E('UPLOADED', 'SCANNING', 'NORMALIZING', 'VALIDATING', 'READY_FOR_REVIEW', 'PUBLISHED', 'PARTIAL', 'FAILED', 'REJECTED');
  const ResolutionMode = E('CURRENT_PUBLISHED', 'AS_OF_EFFECTIVE_DATE', 'EXPLICIT_VERSION', 'LATEST_DRAFT_ADMIN');
  const SearchMode = E('METADATA', 'FULL_TEXT', 'STRUCTURED', 'HYBRID');
  const RetentionClass = E('STANDARD', 'RECORD', 'TEMPORARY', 'LONG_TERM', 'LEGAL_HOLD');
  const AccessMode = E('METADATA_ONLY', 'PREVIEW', 'DOWNLOAD');
  const ViewMode = E('CLIENT', 'BROKER', 'TECHNICAL', 'AUDIT');
  const PERMISSIONS = Object.freeze({ READ: 'document.read', DOWNLOAD: 'document.download', UPLOAD: 'document.upload', UPDATE: 'document.update', MANAGE: 'document.manage',
    VALIDATE: 'document.validate', PUBLISH: 'document.publish', ARCHIVE: 'document.archive', READ_CONFIDENTIAL: 'document.read.confidential', READ_RESTRICTED: 'document.read.restricted' });
  const EVENTS = E('DocumentCreated', 'DocumentVersionUploaded', 'DocumentVersionValidated', 'DocumentVersionPublished', 'DocumentVersionSuperseded', 'DocumentArchived',
    'DocumentExtractionCompleted', 'DocumentIndexUpdated', 'DocumentAccessDenied', 'DocumentDownloaded');
  const ERRORS = E('DOCUMENT_NOT_FOUND', 'DOCUMENT_VERSION_NOT_FOUND', 'DOCUMENT_ACCESS_DENIED', 'TENANT_MISMATCH', 'INVALID_DOCUMENT_TYPE', 'INVALID_SCOPE', 'PRIMARY_FILE_MISSING',
    'UNSUPPORTED_MEDIA_TYPE', 'FILE_TOO_LARGE', 'UPLOAD_FAILED', 'SECURITY_SCAN_FAILED', 'MALWARE_SUSPECTED', 'CHECKSUM_MISMATCH', 'DUPLICATE_VERSION', 'VERSION_CONFLICT',
    'PUBLISHED_VERSION_IMMUTABLE', 'EXTRACTION_FAILED', 'PREVIEW_FAILED', 'INDEXING_FAILED', 'STORAGE_ERROR', 'SIGNED_URL_FAILED', 'RETENTION_POLICY_BLOCKED',
    'CROSS_TENANT_RELATION', 'RELATION_CYCLE', 'REQUIRES_REVIEW', 'SIGNED_URL_EXPIRED', 'INVALID_REQUEST');
  const VALIDATION_ERRORS = E('DOCUMENT_ID_MISSING', 'TENANT_MISMATCH', 'DEVELOPMENT_MISMATCH', 'INVALID_DOCUMENT_TYPE', 'TITLE_MISSING', 'PRIMARY_FILE_MISSING', 'INVALID_MEDIA_TYPE',
    'FILE_TOO_LARGE', 'MALWARE_DETECTED', 'CHECKSUM_MISMATCH', 'VERSION_SEQUENCE_INVALID', 'PUBLISHED_VERSION_MUTATION', 'INVALID_EFFECTIVE_DATES', 'INVALID_SCOPE', 'DUPLICATE_VERSION',
    'CROSS_TENANT_RELATION', 'SCRIPTABLE_CONTENT', 'MEDIA_TYPE_MISMATCH', 'SECURITY_SCAN_REQUIRED', 'MANAGED_COPY_REQUIRED', 'INVALID_CLASSIFICATION', 'INVALID_AUTHORITY');
  const VALIDATION_WARNINGS = E('MISSING_ISSUE_DATE', 'UNKNOWN_AUTHORITY', 'EXTRACTION_PARTIAL', 'PREVIEW_UNAVAILABLE', 'EXTERNAL_SOURCE_MUTABLE', 'DUPLICATE_CONTENT', 'LOW_EXTRACTION_QUALITY',
    'MISSING_OPTIONAL_METADATA', 'MEDIA_TYPE_UNVERIFIED', 'SECURITY_NOT_SCANNED');
  const CONTENT_BOUND = Object.freeze(['documentId', 'organizationId', 'versionNumber', 'primaryFileAssetId', 'fileAssetIds', 'contentChecksum', 'sourceChecksum', 'sourceEffectiveFrom', 'sourceEffectiveTo',
    'issuedAt', 'supersedesVersionId', 'authority', 'scope', 'issuerRef']);
  const MESSAGES = Object.freeze({ DOCUMENT_NOT_FOUND: 'Documento não encontrado.', DOCUMENT_ACCESS_DENIED: 'Sem permissão para este documento.', PUBLISHED_VERSION_IMMUTABLE: 'Versão publicada não pode ser alterada: envie uma nova versão.',
    CROSS_TENANT_RELATION: 'Relação com recurso de outra organização não é permitida.', RETENTION_POLICY_BLOCKED: 'A política de retenção impede a exclusão.', SIGNED_URL_EXPIRED: 'O link de download expirou.',
    REQUIRES_REVIEW: 'Não foi possível identificar o documento com segurança: revisão manual.', DUPLICATE_VERSION: 'Conteúdo idêntico à versão existente.', MALWARE_SUSPECTED: 'Arquivo suspeito: em quarentena.' });

  const err = (code, message, extra = {}) => Object.freeze({ ok: false, code, message: message || MESSAGES[code] || code, ...extra });
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const iso = t => t == null ? null : typeof t === 'string' ? t : new Date(t).toISOString();
  const validId = s => typeof s === 'string' && /^[a-z][a-z0-9_-]{2,120}$/i.test(s);

  // ------------------------------------------------------------------ configuration (per development, from plat/config/documents)
  const configOf = devId => (App.configs && App.configs.documents && App.configs.documents[devId]) || null;
  /** DocumentTypeRegistry: configured, extensible, never one type per filename and never hardcoded to a development */
  function typeRegistry(devId) {
    const map = new Map(((configOf(devId) || {}).documentTypes || []).map(t => [t.code, Object.freeze({ ...t })]));
    return Object.freeze({ get: c => map.get(c) || null, has: c => map.has(c), list: () => [...map.values()], label: c => (map.get(c) || {}).label || c,
      register(def) { if (!def || !/^[A-Z][A-Z0-9_]{2,40}$/.test(def.code || '')) return err('INVALID_DOCUMENT_TYPE', 'código de tipo inválido'); if (map.has(def.code)) return err('INVALID_DOCUMENT_TYPE', 'tipo já existe'); map.set(def.code, Object.freeze({ extensible: true, ...def })); return { ok: true }; } });
  }
  const DEFAULT_FILE_POLICY = Object.freeze({ version: '1.0.0', allowedMediaTypes: Object.freeze(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']), maxSizeBytes: 50 * 1048576, requireSecurityScan: true,
    allowExternalReference: false, requireManagedCopyForAuthorityLevels: Object.freeze(['OFFICIAL_PRIMARY', 'OFFICIAL_SECONDARY']), scriptableBehavior: 'BLOCK', parserLimits: Object.freeze({ maxArchiveEntries: 2000, maxUncompressedBytes: 524288000, maxCompressionRatio: 100, maxPdfPages: 2000 }),
    equivalentMediaTypes: Object.freeze({}) });
  const filePolicy = devId => freeze({ ...DEFAULT_FILE_POLICY, ...((configOf(devId) || {}).filePolicy || {}) });
  const duplicatePolicy = devId => DuplicatePolicy[(configOf(devId) || {}).duplicatePolicy] || 'REQUIRE_REVIEW';
  const DEFAULT_ACCESS_POLICY = freeze({ version: '1.0.0', classificationRules: {
    PUBLIC: { readPermission: PERMISSIONS.READ, downloadPermission: PERMISSIONS.DOWNLOAD, anonymousRead: false, clientVisible: true, hideExistence: false, auditDownload: false },
    ORGANIZATION_INTERNAL: { readPermission: PERMISSIONS.READ, downloadPermission: PERMISSIONS.DOWNLOAD, anonymousRead: false, clientVisible: false, hideExistence: false, auditDownload: false },
    CONFIDENTIAL: { readPermission: PERMISSIONS.READ_CONFIDENTIAL, downloadPermission: PERMISSIONS.DOWNLOAD, anonymousRead: false, clientVisible: false, hideExistence: false, auditDownload: true },
    RESTRICTED: { readPermission: PERMISSIONS.READ_RESTRICTED, downloadPermission: PERMISSIONS.DOWNLOAD, anonymousRead: false, clientVisible: false, hideExistence: true, auditDownload: true } },
    publicAccessRules: { requirePublishedVersion: true }, downloadRules: { signedUrlTtlMs: 300000, maxTtlMs: 900000 },
    offlineRules: { cacheMetadata: true, cachePrivateContent: false, cachePublicContent: true, clearOnTenantSwitch: true, clearOnLogout: true }, auditRules: { auditClassifications: ['CONFIDENTIAL', 'RESTRICTED'], auditPublication: true } });
  const accessPolicy = devId => (configOf(devId) || {}).accessPolicy ? freeze(clone(configOf(devId).accessPolicy)) : DEFAULT_ACCESS_POLICY;
  /** DocumentRetentionPolicy per classification; unknown classification → the strictest (no hard delete) */
  function retentionPolicy(devId, classification) {
    const list = (configOf(devId) || {}).retentionPolicies || [];
    return freeze(list.find(p => p.classification === classification) || { classification, retentionClass: 'RECORD', minRetentionDays: null, allowHardDelete: false, legalHoldSupported: true, version: '1.0.0' });
  }

  // ------------------------------------------------------------------ factories (every tenant-owned record carries organizationId)
  function scope(o = {}) {
    const t = ScopeType[o.scopeType] ? o.scopeType : null;
    return freeze({ organizationId: o.organizationId || null, developmentId: o.developmentId || null, phaseIds: o.phaseIds ? [...o.phaseIds] : null, blockIds: o.blockIds ? [...o.blockIds] : null,
      lotIds: o.lotIds ? [...o.lotIds] : null, resourceRefs: o.resourceRefs ? clone(o.resourceRefs) : null, scopeType: t });
  }
  function validateScope(s, doc) {
    const out = [];
    if (!s || !s.scopeType) out.push('INVALID_SCOPE');
    else if (s.organizationId && doc && s.organizationId !== doc.organizationId) out.push('TENANT_MISMATCH');
    else if (s.scopeType !== 'ORGANIZATION' && !s.developmentId) out.push('INVALID_SCOPE');
    else if (s.scopeType === 'LOT' && !(s.lotIds && s.lotIds.length)) out.push('INVALID_SCOPE');
    else if (s.scopeType === 'BLOCK' && !(s.blockIds && s.blockIds.length)) out.push('INVALID_SCOPE');
    else if (s.scopeType === 'PHASE' && !(s.phaseIds && s.phaseIds.length)) out.push('INVALID_SCOPE');
    return out;
  }
  /** createDocument(input, { now, actor }) → Document — id is immutable and never derived from a filename */
  function createDocument(o, { now, actor } = {}) {
    const id = o.id || I.stableId('doc', o.organizationId, o.documentType, o.title, o.documentCode || null, iso(now));
    return freeze({ id, organizationId: o.organizationId, developmentId: o.developmentId || null, documentCode: o.documentCode || null, documentType: o.documentType, title: o.title, description: o.description || null,
      scope: scope({ organizationId: o.organizationId, developmentId: o.developmentId, ...(o.scope || {}) }), classification: o.classification || 'ORGANIZATION_INTERNAL', authority: o.authority || 'UNKNOWN',
      lifecycleStatus: DocumentLifecycleStatus[o.lifecycleStatus] ? o.lifecycleStatus : 'DRAFT', currentPublishedVersionId: o.currentPublishedVersionId || null, latestVersionId: o.latestVersionId || null,
      issuerRef: o.issuerRef || null, sourceSystemRef: o.sourceSystemRef || null, origin: DocumentOrigin[o.origin] ? o.origin : 'UPLOAD', storageMode: StorageMode[o.storageMode] ? o.storageMode : null,
      tags: [...(o.tags || [])], createdAt: o.createdAt || iso(now), updatedAt: o.updatedAt || o.createdAt || iso(now), createdBy: o.createdBy || actor || null, metadata: clone(o.metadata || {}), revision: o.revision || 1 });
  }
  function createFileAsset(o, { now, actor } = {}) {
    return freeze({ id: o.id, organizationId: o.organizationId, storageProvider: o.storageProvider || 'MEMORY', storageKey: o.storageKey || null, originalFilename: o.originalFilename || null,
      mediaType: o.mediaType || null, detectedMediaType: o.detectedMediaType || null, sizeBytes: o.sizeBytes != null ? o.sizeBytes : null, contentChecksum: o.contentChecksum || null,
      uploadStatus: UploadStatus[o.uploadStatus] ? o.uploadStatus : 'UPLOADING', securityScanStatus: SecurityScanStatus[o.securityScanStatus] ? o.securityScanStatus : 'PENDING',
      createdAt: o.createdAt || iso(now), createdBy: o.createdBy || actor || null, encryptionState: o.encryptionState || null, metadata: clone(o.metadata || {}) });
  }
  function createVersion(o, { now, actor } = {}) {
    return freeze({ id: o.id, organizationId: o.organizationId, documentId: o.documentId, versionNumber: o.versionNumber, versionLabel: o.versionLabel || null,
      lifecycleStatus: VersionStatus[o.lifecycleStatus] ? o.lifecycleStatus : 'UPLOADED', sourceEffectiveFrom: o.sourceEffectiveFrom || null, sourceEffectiveTo: o.sourceEffectiveTo || null,
      issuedAt: o.issuedAt || null, uploadedAt: o.uploadedAt || iso(now), validatedAt: o.validatedAt || null, publishedAt: o.publishedAt || null, supersedesVersionId: o.supersedesVersionId || null,
      primaryFileAssetId: o.primaryFileAssetId || null, fileAssetIds: [...(o.fileAssetIds || (o.primaryFileAssetId ? [o.primaryFileAssetId] : []))], contentChecksum: o.contentChecksum || null,
      sourceChecksum: o.sourceChecksum || null, extractionRef: o.extractionRef || null, validationSummary: o.validationSummary ? clone(o.validationSummary) : null,
      uploadedBy: o.uploadedBy || actor || null, validatedBy: o.validatedBy || null, publishedBy: o.publishedBy || null, notes: o.notes || null,
      authority: o.authority || null, scope: o.scope ? clone(o.scope) : null, issuerRef: o.issuerRef || null, metadata: clone(o.metadata || {}) });
  }
  function createRepresentation(o, { now } = {}) {
    return freeze({ id: o.id, organizationId: o.organizationId, documentVersionId: o.documentVersionId, type: RepresentationType[o.type] ? o.type : 'OTHER_DERIVED', fileAssetId: o.fileAssetId || null,
      contentRef: o.contentRef || o.assetPath || null, generatorId: o.generatorId || null, generatorVersion: o.generatorVersion || null, generatedAt: o.generatedAt || iso(now), status: o.status || 'AVAILABLE',
      quality: o.quality != null ? o.quality : null, derived: o.type !== 'ORIGINAL', authoritative: false, metadata: clone(o.metadata || {}) });
  }
  function createExtractionResult(o, { now } = {}) {
    return freeze({ id: o.id, organizationId: o.organizationId, documentVersionId: o.documentVersionId, extractorId: o.extractorId, extractorVersion: o.extractorVersion || null,
      status: ExtractionStatus[o.status] ? o.status : 'PENDING', outputType: o.outputType || null, outputRef: o.outputRef || null, quality: o.quality != null ? o.quality : null,
      method: o.method || null, warnings: [...(o.warnings || [])], errors: [...(o.errors || [])], generatedAt: o.generatedAt || iso(now) });
  }
  /** DocumentLocator: exact region. pageNumber is human 1-based; spreadsheets use sheetName + cellRange; geospatial uses metadata.featureId/layerRef */
  function locator(o = {}) {
    return freeze({ pageNumber: Number.isInteger(o.pageNumber) ? o.pageNumber : null, pageRange: o.pageRange ? [...o.pageRange] : null, sectionHeading: o.sectionHeading || null, sheetName: o.sheetName || null,
      cellRange: o.cellRange || null, tableName: o.tableName || null, rowRef: o.rowRef != null ? String(o.rowRef) : null, blockId: o.blockId || null, coordinates: o.coordinates ? clone(o.coordinates) : null,
      textAnchor: o.textAnchor || null, metadata: clone(o.metadata || {}) });
  }
  function validateLocator(l) {
    if (!l) return [];
    const out = [];
    if (l.pageNumber != null && !(Number.isInteger(l.pageNumber) && l.pageNumber >= 1)) out.push('pageNumber deve ser inteiro ≥ 1');
    if (l.pageRange && !(l.pageRange.length === 2 && l.pageRange.every(n => Number.isInteger(n) && n >= 1) && l.pageRange[0] <= l.pageRange[1])) out.push('pageRange inválido');
    if (l.cellRange && !l.sheetName) out.push('cellRange exige sheetName');
    if (l.cellRange && !/^[A-Z]{1,3}\d{1,7}(:[A-Z]{1,3}\d{1,7})?$/.test(l.cellRange)) out.push('cellRange inválido');
    return out;
  }
  /** locatorSpecificity(l) → EXACT_CELL | EXACT_FEATURE | EXACT_ROW | PAGE | SECTION | NONE (input of topic 34) */
  function locatorSpecificity(l) {
    if (!l) return 'NONE';
    if (l.sheetName && l.cellRange) return 'EXACT_CELL';
    if (l.metadata && (l.metadata.featureId || l.metadata.layerRef)) return 'EXACT_FEATURE';
    if (l.rowRef || l.tableName) return 'EXACT_ROW';
    if (l.pageNumber || l.pageRange || l.coordinates) return 'PAGE';
    if (l.sectionHeading || l.textAnchor) return 'SECTION';
    return 'NONE';
  }
  /** DocumentSourceRef: always an exact version (never "the current document") */
  function sourceRef(doc, version, o = {}) {
    if (!doc || !version || version.documentId !== doc.id) return null;
    return freeze({ documentId: doc.id, documentVersionId: version.id, organizationId: doc.organizationId, locator: o.locator ? locator(o.locator) : null, authority: version.authority || doc.authority,
      classification: doc.classification, checksum: version.contentChecksum || null, sourceEffectiveAt: version.sourceEffectiveFrom || null, versionStatus: version.lifecycleStatus });
  }
  function relation(o, { now } = {}) {
    return freeze({ id: o.id || I.stableId('rel', o.organizationId, o.documentId, o.documentVersionId || null, o.relationType, o.targetType, o.targetId), organizationId: o.organizationId, documentId: o.documentId,
      documentVersionId: o.documentVersionId || null, relationType: o.relationType, targetType: o.targetType, targetId: o.targetId, createdAt: o.createdAt || iso(now), metadata: clone(o.metadata || {}) });
  }
  const externalDocumentRef = (o = {}) => freeze({ provider: o.provider || null, externalId: o.externalId || null, url: o.url || null, etag: o.etag || null, lastModified: o.lastModified || null,
    accessedAt: o.accessedAt || null, snapshotChecksum: o.snapshotChecksum || null });

  // ------------------------------------------------------------------ DocumentValidationService
  /** checkFile(asset, policy, { bytes }) → { errors, warnings, checks } — the declared extension/MIME is never trusted alone */
  function checkFile(asset, policy, o = {}) {
    const errors = [], warnings = [], checks = {};
    if (!asset) { errors.push('PRIMARY_FILE_MISSING'); return { errors, warnings, checks }; }
    const eq = policy.equivalentMediaTypes || {}, norm = m => m && (eq[m] || m);
    const det = o.bytes ? I.detectMediaType(o.bytes) : asset.detectedMediaType ? { mediaType: asset.detectedMediaType, scriptable: /html|svg|executable|ole-storage/.test(asset.detectedMediaType) } : null;
    checks.declaredMediaType = asset.mediaType; checks.detectedMediaType = det ? det.mediaType : null;
    if (det && det.scriptable) errors.push('SCRIPTABLE_CONTENT');
    if (!det || !det.mediaType) warnings.push('MEDIA_TYPE_UNVERIFIED');
    else if (asset.mediaType && norm(asset.mediaType) !== det.mediaType && asset.mediaType !== det.mediaType) errors.push('MEDIA_TYPE_MISMATCH');
    const effective = det && det.mediaType ? det.mediaType : asset.mediaType;
    if (!effective || !policy.allowedMediaTypes.some(m => m === effective || norm(m) === effective)) errors.push('INVALID_MEDIA_TYPE');
    if (asset.sizeBytes != null && asset.sizeBytes > policy.maxSizeBytes) errors.push('FILE_TOO_LARGE');
    if (asset.securityScanStatus === 'MALICIOUS' || asset.securityScanStatus === 'SUSPICIOUS' || asset.uploadStatus === 'QUARANTINED') errors.push('MALWARE_DETECTED');
    else if (asset.securityScanStatus !== 'CLEAN') warnings.push('SECURITY_NOT_SCANNED');
    if (o.bytes && asset.contentChecksum && 'sha256:' + I.sha256(o.bytes) !== asset.contentChecksum) errors.push('CHECKSUM_MISMATCH');
    if (asset.storageProvider === 'EXTERNAL_REFERENCE') { warnings.push('EXTERNAL_SOURCE_MUTABLE'); if (!policy.allowExternalReference) errors.push('INVALID_MEDIA_TYPE'); }
    return { errors, warnings, checks };
  }
  /** validateVersion({ document, version, assets, versions, tenant, devId, bytes, stage }) → DocumentValidationResult
      stage 'PUBLISH' adds the publish preconditions (scan clean, managed copy for official authority). */
  function validateVersion(q) {
    const { document: d, version: v } = q, devId = q.devId || (d && d.developmentId), policy = q.policy || filePolicy(devId), types = typeRegistry(devId);
    const errors = new Set(), warnings = new Set(), metadataChecks = {}, fileChecks = {}, scopeChecks = {}, versionChecks = {}, securityChecks = {};
    if (!d || !d.id) errors.add('DOCUMENT_ID_MISSING');
    if (!d) return freeze({ valid: false, errors: [...errors], warnings: [], metadataChecks, fileChecks, scopeChecks, versionChecks, securityChecks, policyVersion: policy.version });
    if (q.tenant && d.organizationId !== q.tenant.organizationId) errors.add('TENANT_MISMATCH');
    if (v && v.organizationId !== d.organizationId) errors.add('TENANT_MISMATCH');
    if (q.tenant && q.tenant.activeDevelopmentId && d.developmentId && d.developmentId !== q.tenant.activeDevelopmentId && q.strictDevelopment) errors.add('DEVELOPMENT_MISMATCH');
    if (!types.has(d.documentType)) errors.add('INVALID_DOCUMENT_TYPE');
    if (!d.title || !String(d.title).trim()) errors.add('TITLE_MISSING');
    if (!DocumentClassification[d.classification]) errors.add('INVALID_CLASSIFICATION');
    if (!DocumentAuthority[d.authority]) errors.add('INVALID_AUTHORITY'); else if (d.authority === 'UNKNOWN') warnings.add('UNKNOWN_AUTHORITY');
    validateScope(d.scope, d).forEach(c => errors.add(c)); scopeChecks.scopeType = d.scope && d.scope.scopeType;
    if (!d.description) warnings.add('MISSING_OPTIONAL_METADATA');
    if (v) {
      if (v.documentId !== d.id) errors.add('VERSION_SEQUENCE_INVALID');
      const others = (q.versions || []).filter(x => x.id !== v.id && x.documentId === d.id);
      const expected = others.length ? Math.max(...others.map(x => x.versionNumber)) + 1 : 1;
      versionChecks.versionNumber = v.versionNumber; versionChecks.expected = q.existing ? null : expected;
      if (!Number.isInteger(v.versionNumber) || v.versionNumber < 1 || others.some(x => x.versionNumber === v.versionNumber)) errors.add('VERSION_SEQUENCE_INVALID');
      if (others.some(x => x.contentChecksum && x.contentChecksum === v.contentChecksum && x.lifecycleStatus !== 'REJECTED')) errors.add('DUPLICATE_VERSION');
      if (v.sourceEffectiveFrom && v.sourceEffectiveTo && v.sourceEffectiveTo < v.sourceEffectiveFrom) errors.add('INVALID_EFFECTIVE_DATES');
      if (!v.issuedAt) warnings.add('MISSING_ISSUE_DATE');
      const assets = q.assets || [], primary = assets.find(a => a.id === v.primaryFileAssetId);
      if (!v.primaryFileAssetId || !primary) errors.add('PRIMARY_FILE_MISSING');
      else {
        if (primary.organizationId !== d.organizationId) errors.add('TENANT_MISMATCH');
        const f = checkFile(primary, policy, { bytes: q.bytes }); f.errors.forEach(x => errors.add(x)); f.warnings.forEach(x => warnings.add(x)); Object.assign(fileChecks, f.checks);
        if (v.contentChecksum && primary.contentChecksum && v.contentChecksum !== primary.contentChecksum) errors.add('CHECKSUM_MISMATCH');
        securityChecks.scan = primary.securityScanStatus; securityChecks.upload = primary.uploadStatus;
        if (q.stage === 'PUBLISH') {
          if (policy.requireSecurityScan && primary.securityScanStatus !== 'CLEAN') errors.add('SECURITY_SCAN_REQUIRED');
          if ((policy.requireManagedCopyForAuthorityLevels || []).includes(d.authority) && primary.storageProvider === 'EXTERNAL_REFERENCE') errors.add('MANAGED_COPY_REQUIRED');
          if (q.previewAvailable === false) warnings.add('PREVIEW_UNAVAILABLE');
        }
      }
      for (const x of q.extractions || []) { if (x.status === 'PARTIAL') warnings.add('EXTRACTION_PARTIAL'); if (x.quality != null && x.quality < 0.6) warnings.add('LOW_EXTRACTION_QUALITY'); }
      if (q.duplicateContent) warnings.add('DUPLICATE_CONTENT');
    }
    metadataChecks.title = !!d.title; metadataChecks.type = d.documentType; metadataChecks.authority = d.authority; metadataChecks.classification = d.classification;
    return freeze({ valid: errors.size === 0, errors: [...errors], warnings: [...warnings], metadataChecks, fileChecks, scopeChecks, versionChecks, securityChecks, policyVersion: policy.version });
  }
  /** a published version's content is immutable; only operational metadata may change (index/preview status) */
  function checkVersionPatch(version, patch) {
    if (!version || !['PUBLISHED', 'SUPERSEDED', 'ARCHIVED'].includes(version.lifecycleStatus)) return { ok: true };
    const touched = Object.keys(patch || {}).filter(k => CONTENT_BOUND.includes(k) && JSON.stringify(patch[k]) !== JSON.stringify(version[k]));
    return touched.length ? err('PUBLISHED_VERSION_IMMUTABLE', null, { fields: touched }) : { ok: true };
  }

  // ------------------------------------------------------------------ DocumentAccessPolicy (classification qualifies; authorization decides)
  /** decide(doc, { action, version, access, policy }) → { allowed, reason, hideExistence }
      access = { organizationId, mode, can(permissionKey, resource) } — permission keys only, never role names. */
  function decide(doc, o = {}) {
    const access = o.access || {}, pol = o.policy || accessPolicy(doc && doc.developmentId), rule = doc && pol.classificationRules[doc.classification];
    const D = (reason, hide = false) => freeze({ allowed: false, reason, hideExistence: hide });
    if (!doc || !rule) return D('DOCUMENT_NOT_FOUND', true);
    if (!access.organizationId || access.organizationId !== doc.organizationId) return D('TENANT_MISMATCH', true); // cross-tenant: never confirm existence
    const res = { organizationId: doc.organizationId, developmentId: doc.developmentId || undefined };
    const can = k => typeof access.can === 'function' && access.can(k, res) === true;
    const v = o.version, published = v ? v.lifecycleStatus === 'PUBLISHED' : !!doc.currentPublishedVersionId;
    if (access.mode === 'CLIENT' && (!rule.clientVisible || !published || doc.lifecycleStatus === 'ARCHIVED')) return D('NOT_CLIENT_SAFE', rule.hideExistence);
    const action = o.action || 'READ';
    if (action === 'READ_DRAFT') return can(PERMISSIONS.MANAGE) || can(PERMISSIONS.VALIDATE) ? freeze({ allowed: true, reason: 'ALLOWED', hideExistence: false }) : D('NO_GRANT', rule.hideExistence);
    const readOk = can(rule.readPermission) || (rule.anonymousRead && published && (!pol.publicAccessRules || !pol.publicAccessRules.requirePublishedVersion || published));
    if (!readOk) return D('NO_GRANT', rule.hideExistence);
    if (v && v.lifecycleStatus !== 'PUBLISHED' && !(can(PERMISSIONS.MANAGE) || can(PERMISSIONS.VALIDATE) || ((access.mode === 'TECHNICAL' || access.mode === 'AUDIT') && ['SUPERSEDED', 'ARCHIVED'].includes(v.lifecycleStatus)))) return D('VERSION_NOT_ACCESSIBLE', false);
    if (action === 'DOWNLOAD' && !can(rule.downloadPermission)) return D('NO_GRANT', false);
    if (action === 'TECHNICAL' && !(access.mode === 'TECHNICAL' || access.mode === 'AUDIT')) return D('MODE_NOT_TECHNICAL', false);
    return freeze({ allowed: true, reason: 'ALLOWED', hideExistence: false, audit: action === 'DOWNLOAD' && !!rule.auditDownload });
  }

  return Object.freeze({ DocumentClassification, DocumentAuthority, DocumentLifecycleStatus, VersionStatus, UploadStatus, SecurityScanStatus, ScopeType, RelationType, RepresentationType,
    ExtractionStatus, DocumentOrigin, StorageMode, DuplicatePolicy, BatchStatus, ResolutionMode, SearchMode, RetentionClass, AccessMode, ViewMode, PERMISSIONS, EVENTS, ERRORS,
    VALIDATION_ERRORS, VALIDATION_WARNINGS, CONTENT_BOUND, MESSAGES, err, freeze, clone, iso, validId,
    configOf, typeRegistry, filePolicy, duplicatePolicy, accessPolicy, retentionPolicy, DEFAULT_FILE_POLICY, DEFAULT_ACCESS_POLICY,
    scope, validateScope, createDocument, createFileAsset, createVersion, createRepresentation, createExtractionResult, locator, validateLocator, locatorSpecificity, sourceRef, relation, externalDocumentRef,
    checkFile, validateVersion, checkVersionPatch, decide });
})();
