/* provenance/provenanceModel.js — Topic 33: attribute-level provenance (domain core, pure).
   Answers, for one attribute of one entity: which value (valueFingerprint), how it was obtained (ProvenanceKind),
   how strong the evidence is (EvidenceState), whether the source is still current (ProvenanceCurrentness),
   which exact sources / methods / inputs produced it. It is NOT a confidence score (Topic 34) and NOT a guarantee
   of truth: provenance says where a value came from, never that it is correct.
   Depends on App.integrity (fingerprints, ids) and App.model (FieldRegistry). No clock, no I/O. */
App.provenance = (() => {
  const I = App.integrity;
  const E = (...k) => Object.freeze(Object.fromEntries(k.map(x => [x, x])));
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

  const ProvenanceKind = E('DIRECT_SOURCE', 'NORMALIZED_SOURCE', 'CALCULATED', 'ESTIMATED', 'AGGREGATED', 'MANUAL_ASSERTION', 'MANUAL_OVERRIDE', 'ANALYSIS_DERIVED', 'LEGACY_DECLARED', 'NOT_AVAILABLE');
  const EvidenceState = E('VERIFIED', 'PARTIAL', 'UNRESOLVED', 'MISSING', 'CONFLICTED', 'ACCESS_RESTRICTED', 'INVALID');
  const ProvenanceCurrentness = E('CURRENT', 'SOURCE_SUPERSEDED', 'STALE', 'REVIEW_REQUIRED', 'UNKNOWN');
  const ProvenanceRecordStatus = E('ACTIVE', 'SUPERSEDED', 'INVALIDATED', 'REVIEW_REQUIRED', 'ARCHIVED');
  const EvidenceRefType = E('DOCUMENT_VERSION', 'IMPORT_BATCH', 'EXTERNAL_API_SNAPSHOT', 'ATTRIBUTE_DEPENDENCY', 'ANALYSIS_RESULT', 'CONFIG_VERSION', 'USER_ASSERTION', 'SYSTEM_RECORD');
  const MethodType = E('NORMALIZATION', 'FORMULA', 'GEOSPATIAL', 'ESTIMATION', 'AGGREGATION', 'CLASSIFICATION', 'SCORING', 'TRANSFORMATION', 'MANUAL');
  const NotAvailableReason = E('NOT_PROVIDED_BY_SOURCE', 'NOT_MEASURED', 'NOT_APPLICABLE', 'SOURCE_UNAVAILABLE', 'SOURCE_NOT_INGESTED', 'DERIVATION_NOT_POSSIBLE', 'CONFLICT_UNRESOLVED', 'UNKNOWN_REASON');
  /** INFORMED is a documented extension: a direct source whose evidence is only PARTIAL (e.g. price table told by the broker, no file) */
  const DisplayCode = E('CONFIRMED', 'CALCULATED', 'ESTIMATED', 'MANUAL', 'LEGACY', 'NOT_AVAILABLE', 'CONFLICT', 'REVIEW', 'INFORMED');
  const EvidenceVisibility = E('FULL', 'SUMMARY_ONLY', 'REDACTED', 'HIDDEN');
  const ConflictType = E('VALUE_MISMATCH', 'UNIT_MISMATCH', 'SOURCE_DISAGREEMENT', 'TEMPORAL_CONFLICT', 'DUPLICATE_INCONSISTENT', 'METHOD_DISAGREEMENT');
  const ConflictResolutionStatus = E('OPEN', 'AUTO_RESOLVED_BY_POLICY', 'MANUALLY_RESOLVED', 'DEFERRED', 'REJECTED_ALL');
  const ResolutionMode = E('NO_AUTO_RESOLUTION', 'AUTHORITY_ORDER', 'LATEST_AUTHORITATIVE', 'MULTI_SOURCE_AGREEMENT', 'MANUAL_REVIEW_REQUIRED', 'DOMAIN_SPECIFIC');
  const DataVersionRefType = E('STATIC_DATA_VERSION', 'ANALYSIS_VERSION', 'PRICE_TABLE_VERSION', 'AVAILABILITY_REVISION', 'DOCUMENT_VERSION', 'CUSTOM_VERSION');
  const ProjectionMode = E('CLIENT', 'BROKER', 'TECHNICAL', 'AUDIT');
  const NodeType = E('SOURCE', 'DOCUMENT', 'ATTRIBUTE', 'METHOD', 'CONFIG', 'ANALYSIS', 'ASSERTION', 'CONFLICT');
  const ERRORS = E('INVALID_ATTRIBUTE_PATH', 'ENTITY_NOT_FOUND', 'TENANT_MISMATCH', 'DEVELOPMENT_MISMATCH', 'SOURCE_NOT_FOUND', 'SOURCE_VERSION_NOT_FOUND', 'INVALID_LOCATOR', 'DEPENDENCY_NOT_FOUND',
    'METHOD_NOT_FOUND', 'METHOD_VERSION_NOT_FOUND', 'LINEAGE_CYCLE', 'CONFLICT_REFERENCE_INVALID', 'PROVENANCE_VALUE_MISMATCH',
    // structural rules of this implementation (spec §326, §501, §502, §92, §145)
    'KIND_NOT_ALLOWED', 'EVIDENCE_REQUIRED', 'METHOD_REQUIRED', 'DEPENDENCIES_REQUIRED', 'REASON_REQUIRED', 'INVALID_EVIDENCE_REF', 'SECRET_IN_EVIDENCE', 'VERIFIED_WITHOUT_EVIDENCE', 'INVALID_RECORD');
  const WARNINGS = E('LEGACY_SOURCE_UNRESOLVED', 'SOURCE_SUPERSEDED', 'PARTIAL_EVIDENCE', 'SOURCE_STALE', 'EXTRACTION_BASED', 'MANUAL_ASSERTION', 'MANUAL_OVERRIDE', 'MULTIPLE_EVIDENCE_SOURCES', 'NULL_WITHOUT_REASON');
  const EVENTS = E('AttributeProvenanceRecorded', 'AttributeProvenanceSuperseded', 'AttributeProvenanceInvalidated', 'ProvenanceConflictDetected', 'ProvenanceConflictResolved', 'ProvenanceOverrideApplied', 'SourceVersionSuperseded', 'ProvenanceReviewRequired');
  /** permission keys (Topic 30). Not yet in config/security/permissions.json → denied by default until registered */
  const PERMISSIONS = Object.freeze({ READ: 'provenance.read', TECHNICAL_READ: 'provenance.technical.read', RESOLVE_CONFLICT: 'provenance.resolveConflict', OVERRIDE: 'provenance.override' });
  const LABELS = Object.freeze({
    CLIENT: { CONFIRMED: 'Confirmado', CALCULATED: 'Calculado', ESTIMATED: 'Estimado', INFORMED: 'Informado', LEGACY: 'Informado', MANUAL: 'Informado', NOT_AVAILABLE: 'Não disponível', CONFLICT: 'Necessita confirmação', REVIEW: 'Necessita confirmação' },
    BROKER: { CONFIRMED: 'Confirmado', CALCULATED: 'Calculado', ESTIMATED: 'Estimado', INFORMED: 'Informado', LEGACY: 'Informado', MANUAL: 'Informado manualmente', NOT_AVAILABLE: 'Não disponível', CONFLICT: 'Conflito', REVIEW: 'Revisar' },
    TECHNICAL: { CONFIRMED: 'Confirmado (evidência verificada)', CALCULATED: 'Calculado', ESTIMATED: 'Estimado', INFORMED: 'Informado — evidência parcial', LEGACY: 'Legado — fonte não rastreada', MANUAL: 'Asserção manual', NOT_AVAILABLE: 'Não disponível', CONFLICT: 'Conflito aberto', REVIEW: 'Revisão necessária' } });
  const REASON_LABELS = Object.freeze({ NOT_PROVIDED_BY_SOURCE: 'a fonte não traz esse dado', NOT_MEASURED: 'não medido', NOT_APPLICABLE: 'não se aplica', SOURCE_UNAVAILABLE: 'fonte indisponível',
    SOURCE_NOT_INGESTED: 'fonte ainda não recebida', DERIVATION_NOT_POSSIBLE: 'não é possível calcular', CONFLICT_UNRESOLVED: 'fontes divergentes', UNKNOWN_REASON: 'motivo não registrado' });

  const DERIVED = new Set(['CALCULATED', 'ESTIMATED', 'AGGREGATED', 'ANALYSIS_DERIVED']);
  const SOURCE_KINDS = new Set(['DIRECT_SOURCE', 'NORMALIZED_SOURCE']);

  // ------------------------------------------------------------------ config + registries
  const configOf = devId => (App.configs && App.configs.provenance && App.configs.provenance[devId]) || null;
  /** value of an attribute path on a canonical entity (same accessor as the FieldRegistry) */
  const valueAt = (entity, path) => App.model.get ? App.model.get(entity, path) : path.split('.').reduce((o, k) => o == null ? undefined : o[k], entity);
  const fingerprint = v => I.fingerprint(v === undefined ? null : v);
  /** AttributePathRegistry — the FieldRegistry is the only source of valid paths (labels are never paths) */
  const pathRegistry = Object.freeze({
    has: p => !!App.model.field(p), field: p => App.model.field(p),
    list: () => App.model.FIELDS.filter(f => !f.virtual && f.provenanceRequired !== false).map(f => f.key),
    tracked: () => App.model.FIELDS.filter(f => !f.virtual && f.provenanceRequired !== false) });

  /** MethodRegistry — only methods with a traceable version (config) become MethodRefs */
  const MR = new Map(), FP = new Map();
  /** memoized per development (configs are immutable at runtime); clearCaches() for tests that swap configs */
  function methodRegistry(devId) { if (!MR.has(devId)) MR.set(devId, buildMethodRegistry(devId)); return MR.get(devId); }
  function buildMethodRegistry(devId) {
    const cfg = configOf(devId) || {}, list = (cfg.methods || []).map(m => freeze({ ...clone(m), methodVersion: m.methodId === 'availability_freshness_policy' && App.availability ? String(App.availability.POLICY_VERSION) : m.methodVersion }));
    const by = new Map(list.map(m => [m.methodId + '@' + m.methodVersion, m]));
    return Object.freeze({
      list: () => list, get: (id, v) => by.get(id + '@' + v) || null, hasMethod: id => list.some(m => m.methodId === id),
      /** legacy (sourceId, method) → registered method, or null when the legacy method has no traceable version */
      resolveLegacy(sourceId, legacyMethod, path) {
        const c = list.filter(m => (m.legacyMethods || []).includes(legacyMethod) && (m.legacySourceId == null || m.legacySourceId === sourceId));
        if (legacyMethod === 'price-table') return c.find(m => path === 'commercial.downPaymentDefaultValue' ? m.methodId === 'down_payment_percent_of_price' : m.methodId === 'lot_price_per_m2_times_area') || null;
        if (sourceId === 'official-plan-v1') return c.find(m => m.methodId === (legacyMethod === 'vectorized' ? 'plan_vectorization' : 'plan_geometry_measurement')) || c.find(m => m.methodId === 'plan_vectorization') || null;
        return c.find(m => m.legacySourceId === sourceId) || c.find(m => m.legacySourceId == null) || null;
      },
      ref: m => m ? methodRef(m) : null });
  }

  // ------------------------------------------------------------------ factories (EvidenceRef union, MethodRef, DependencyRef)
  function methodRef(o) {
    if (!o || !o.methodId || o.methodVersion == null) throw Object.assign(new Error('MethodRef exige methodId e methodVersion'), { code: 'METHOD_REQUIRED' });
    if (!MethodType[o.methodType]) throw Object.assign(new Error('methodType inválido'), { code: 'INVALID_RECORD' });
    return freeze({ methodId: o.methodId, methodVersion: String(o.methodVersion), methodType: o.methodType, parametersHash: o.parametersHash || (o.parameters ? I.checksumOf(o.parameters) : undefined),
      configurationRefs: o.configurationRefs ? [...o.configurationRefs] : undefined, implementationRef: o.implementationRef || undefined, descriptionKey: o.descriptionKey || undefined });
  }
  const SECRET_KEY = /(token|secret|password|apikey|api_key|authorization|signature|credential)/i;
  const hasSecret = o => o && typeof o === 'object' && Object.entries(o).some(([k, v]) => SECRET_KEY.test(k) || (typeof v === 'string' && /[?&](token|sig|signature|key)=/i.test(v)) || (v && typeof v === 'object' && hasSecret(v)));
  const ev = {
    /** documentSourceRef = App.documents.sourceRef(doc, version, { locator }) — exact version (never "current") */
    document: (documentSourceRef) => freeze({ type: 'DOCUMENT_VERSION', documentSourceRef: clone(documentSourceRef) }),
    importBatch: o => freeze({ type: 'IMPORT_BATCH', batchType: o.batchType, batchId: o.batchId, sourceRowRef: o.sourceRowRef, sourceColumnRef: o.sourceColumnRef, sourceFieldRef: o.sourceFieldRef }),
    externalApi: o => freeze({ type: 'EXTERNAL_API_SNAPSHOT', providerId: o.providerId, snapshotId: o.snapshotId, endpointRef: o.endpointRef, externalResourceId: o.externalResourceId, observedAt: o.observedAt, responseHash: o.responseHash }),
    dependency: o => freeze({ type: 'ATTRIBUTE_DEPENDENCY', ...dependencyRef(o) }),
    analysis: o => freeze({ type: 'ANALYSIS_RESULT', analysisVersion: String(o.analysisVersion), analysisResultId: o.analysisResultId, moduleId: o.moduleId, moduleVersion: String(o.moduleVersion), methodologyVersion: o.methodologyVersion }),
    config: o => freeze({ type: 'CONFIG_VERSION', configType: o.configType, configId: o.configId, configVersion: String(o.configVersion), configChecksum: o.configChecksum }),
    userAssertion: o => freeze({ type: 'USER_ASSERTION', actorUserId: o.actorUserId, assertionId: o.assertionId, reasonCode: o.reasonCode, assertedAt: o.assertedAt }),
    systemRecord: o => freeze({ type: 'SYSTEM_RECORD', recordType: o.recordType, recordId: o.recordId, recordVersion: o.recordVersion != null ? String(o.recordVersion) : undefined, checksum: o.checksum, domain: o.domain })
  };
  function dependencyRef(o) {
    return freeze({ organizationId: o.organizationId, entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, valueFingerprint: o.valueFingerprint, provenanceId: o.provenanceId || undefined });
  }
  /** validateEvidenceRef(ref) → error codes (structure only; resolution against documents happens in the validator) */
  function validateEvidenceRef(r) {
    const out = [];
    if (!r || !EvidenceRefType[r.type]) return ['INVALID_EVIDENCE_REF'];
    if (hasSecret(r)) out.push('SECRET_IN_EVIDENCE');
    if (r.type === 'DOCUMENT_VERSION') { const s = r.documentSourceRef || {}; if (!s.documentId) out.push('SOURCE_NOT_FOUND'); if (!s.documentVersionId) out.push('SOURCE_VERSION_NOT_FOUND');
      if (s.locator && App.documents && App.documents.validateLocator(s.locator).length) out.push('INVALID_LOCATOR'); }
    if (r.type === 'ATTRIBUTE_DEPENDENCY' && (!r.entityId || !r.attributePath || !r.valueFingerprint)) out.push('DEPENDENCY_NOT_FOUND');
    if (r.type === 'ANALYSIS_RESULT' && (!r.moduleId || !r.moduleVersion || !r.analysisVersion)) out.push('INVALID_EVIDENCE_REF');
    if (r.type === 'CONFIG_VERSION' && (!r.configId || !r.configVersion)) out.push('INVALID_EVIDENCE_REF');
    if (r.type === 'IMPORT_BATCH' && !r.batchId) out.push('INVALID_EVIDENCE_REF');
    if (r.type === 'EXTERNAL_API_SNAPSHOT' && (!r.providerId || !r.observedAt)) out.push('INVALID_EVIDENCE_REF');
    if (r.type === 'USER_ASSERTION' && !r.assertionId) out.push('INVALID_EVIDENCE_REF');
    if (r.type === 'SYSTEM_RECORD' && (!r.recordType || !r.recordId)) out.push('INVALID_EVIDENCE_REF');
    return out;
  }
  /** DataVersionRef union (§270) */
  const dataVersionRef = (type, value, extra = {}) => { if (!DataVersionRefType[type]) throw Object.assign(new Error('DataVersionRef inválido'), { code: 'INVALID_RECORD' }); return freeze({ type, value: value == null ? null : String(value), ...clone(extra) }); };

  // ------------------------------------------------------------------ FieldProvenancePolicy (derived from the FieldRegistry, config overrides)
  const ALL_BUT_OVERRIDE = Object.keys(ProvenanceKind).filter(k => k !== 'MANUAL_OVERRIDE');
  function fieldPolicy(path, devId) { const k = devId + '|' + path; if (!FP.has(k)) FP.set(k, buildFieldPolicy(path, devId)); return FP.get(k); }
  function buildFieldPolicy(path, devId) {
    const f = App.model.field(path); if (!f) return null;
    const over = ((configOf(devId) || {}).fieldPolicies || {})[path] || {};
    const estimate = f.status === 'ESTIMATED';
    const base = {
      attributePath: path, required: f.provenanceRequired !== false && !f.virtual,
      allowedKinds: estimate ? ['ESTIMATED', 'ANALYSIS_DERIVED', 'LEGACY_DECLARED', 'NOT_AVAILABLE'] : ALL_BUT_OVERRIDE, // an estimate stays an estimate (§444)
      requiresEvidenceRef: f.status === 'CONFIRMED', requiresMethodForDerived: true, requiresDependencies: !!(f.dependsOn && f.dependsOn.length), dependsOn: f.dependsOn ? [...f.dependsOn] : [],
      allowManualAssertion: !/^(intelligence|commercial|availability|metadata)\./.test(path) && f.domain !== 'IDENTITY', allowOverride: false, multipleSourcesAllowed: true,
      conflictPolicyRef: ((configOf(devId) || {}).resolutionPolicies || {}).byField && configOf(devId).resolutionPolicies.byField[path] || null, currentnessPolicyRef: null, registryStatus: f.status };
    const p = { ...base, ...clone(over) }; delete p.note;
    if (p.allowOverride && !p.allowedKinds.includes('MANUAL_OVERRIDE')) p.allowedKinds = [...p.allowedKinds, 'MANUAL_OVERRIDE'];
    return freeze(p);
  }
  function resolutionPolicy(path, devId) {
    const rp = (configOf(devId) || {}).resolutionPolicies || {}, f = App.model.field(path);
    const mode = (rp.byField || {})[path] || (f && (rp.byDomain || {})[f.domain]) || rp.default || 'NO_AUTO_RESOLUTION';
    return freeze({ mode: ResolutionMode[mode] ? mode : 'NO_AUTO_RESOLUTION', authorityOrder: rp.authorityOrder || ['OFFICIAL_PRIMARY', 'OFFICIAL_SECONDARY', 'INTERNAL_APPROVED'] });
  }

  // ------------------------------------------------------------------ AttributeProvenanceRecord
  /** createRecord(input) → frozen record; id is deterministic over the content (same content ⇒ same id ⇒ dedup) */
  function createRecord(o) {
    for (const k of ['organizationId', 'entityType', 'entityId', 'attributePath', 'valueFingerprint', 'provenanceKind', 'evidenceState', 'recordedAt'])
      if (o[k] == null) throw Object.assign(new Error('registro de proveniência sem ' + k), { code: 'INVALID_RECORD', field: k });
    if (!ProvenanceKind[o.provenanceKind] || !EvidenceState[o.evidenceState]) throw Object.assign(new Error('kind/evidenceState inválido'), { code: 'INVALID_RECORD' });
    const body = { organizationId: o.organizationId, developmentId: o.developmentId || null, entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, valueFingerprint: o.valueFingerprint,
      valueVersionRef: o.valueVersionRef || null, provenanceKind: o.provenanceKind, evidenceState: o.evidenceState, currentness: ProvenanceCurrentness[o.currentness] ? o.currentness : 'UNKNOWN',
      evidenceRefs: [...(o.evidenceRefs || [])], methodRef: o.methodRef || null, dependencyRefs: [...(o.dependencyRefs || [])], // nested refs are frozen in place (factories already freeze them)
      notAvailableReason: o.provenanceKind === 'NOT_AVAILABLE' ? (NotAvailableReason[o.notAvailableReason] ? o.notAvailableReason : null) : null,
      conflictRef: o.conflictRef || null, assertionRef: o.assertionRef || null, supersedesProvenanceId: o.supersedesProvenanceId || null, metadata: { ...(o.metadata || {}) } };
    const id = o.id || I.stableId('prov', body);
    return freeze({ id, ...body, recordedAt: o.recordedAt, recordedBy: o.recordedBy || null, status: ProvenanceRecordStatus[o.status] ? o.status : 'ACTIVE' });
  }

  /** displayCode(record, { currentness, conflicted }) — derived for the UI; never replaces the technical model (§140) */
  function displayCode(r, o = {}) {
    const cur = o.currentness || r.currentness, st = o.status || r.status;
    if (r.evidenceState === 'CONFLICTED' || o.conflicted) return 'CONFLICT';
    if (r.provenanceKind === 'NOT_AVAILABLE') return 'NOT_AVAILABLE';
    if (r.evidenceState === 'INVALID' || st === 'INVALIDATED' || st === 'REVIEW_REQUIRED' || cur === 'REVIEW_REQUIRED') return 'REVIEW';
    switch (r.provenanceKind) {
      case 'DIRECT_SOURCE': case 'NORMALIZED_SOURCE': return r.evidenceState === 'VERIFIED' ? 'CONFIRMED' : r.evidenceState === 'PARTIAL' ? 'INFORMED' : 'REVIEW';
      case 'CALCULATED': case 'AGGREGATED': return 'CALCULATED';
      case 'ESTIMATED': return 'ESTIMATED';
      case 'ANALYSIS_DERIVED': return r.metadata && r.metadata.estimate ? 'ESTIMATED' : 'CALCULATED';
      case 'MANUAL_ASSERTION': case 'MANUAL_OVERRIDE': return 'MANUAL';
      case 'LEGACY_DECLARED': return 'LEGACY';
    }
    return 'REVIEW';
  }
  /** ProvenanceSummary — light object for map/list/quick view (no refs, no ids beyond provenanceId) */
  function summarize(r, o = {}) {
    if (!r) return freeze({ provenanceId: null, kind: null, evidenceState: 'MISSING', currentness: 'UNKNOWN', sourceCount: 0, primaryAuthority: null, hasDetailedEvidence: false, hasConflict: false, displayCode: 'REVIEW', untracked: true });
    const currentness = o.currentness || r.currentness, status = o.status || r.status;
    const sources = r.evidenceRefs.filter(x => x.type !== 'ATTRIBUTE_DEPENDENCY');
    return freeze({ provenanceId: r.id, kind: r.provenanceKind, evidenceState: r.evidenceState, currentness, status, sourceCount: sources.length, primaryAuthority: o.primaryAuthority || (r.metadata && r.metadata.sourceAuthority) || null,
      hasDetailedEvidence: r.evidenceRefs.length > 0 || !!r.methodRef || (r.dependencyRefs || []).length > 0, hasConflict: r.evidenceState === 'CONFLICTED' || !!r.conflictRef,
      displayCode: displayCode(r, { currentness, status, conflicted: o.conflicted }), notAvailableReason: r.notAvailableReason || null, methodType: r.methodRef ? r.methodRef.methodType : null });
  }
  const labelFor = (code, mode = 'BROKER') => (LABELS[mode] || LABELS.BROKER)[code] || null;

  // ------------------------------------------------------------------ ProvenanceConsistencyValidator
  /** validateRecord(r, ctx) → { valid, errors[], warnings[] }
      ctx: { entity?, tenant?, developmentId?, policy?, methods?, resolveDocument?(ref) → { document, version } | null, getRecord?(id), currentValue? } */
  function validateRecord(r, ctx = {}) {
    const errors = [], warnings = [], add = c => { if (!errors.includes(c)) errors.push(c); }, warn = c => { if (!warnings.includes(c)) warnings.push(c); };
    if (!r) return { valid: false, errors: ['INVALID_RECORD'], warnings };
    if (!pathRegistry.has(r.attributePath)) add('INVALID_ATTRIBUTE_PATH');
    if (ctx.tenant && ctx.tenant.organizationId !== r.organizationId) add('TENANT_MISMATCH');
    if (ctx.developmentId && r.developmentId && ctx.developmentId !== r.developmentId) add('DEVELOPMENT_MISMATCH');
    if ('entity' in ctx && !ctx.entity) add('ENTITY_NOT_FOUND');
    const hasCurrent = 'currentValue' in ctx || (ctx.entity && pathRegistry.has(r.attributePath));
    if (hasCurrent) { const v = 'currentValue' in ctx ? ctx.currentValue : valueAt(ctx.entity, r.attributePath); if (fingerprint(v) !== r.valueFingerprint) add('PROVENANCE_VALUE_MISMATCH'); }
    const pol = ctx.policy || fieldPolicy(r.attributePath, ctx.developmentId || r.developmentId);
    if (pol && !pol.allowedKinds.includes(r.provenanceKind)) add('KIND_NOT_ALLOWED');
    for (const e of r.evidenceRefs) { for (const c of validateEvidenceRef(e)) add(c);
      if (e.type === 'DOCUMENT_VERSION' && ctx.resolveDocument) { const res = ctx.resolveDocument(e.documentSourceRef);
        if (!res || !res.document) add('SOURCE_NOT_FOUND'); else if (!res.version) add('SOURCE_VERSION_NOT_FOUND');
        else if (res.document.organizationId !== r.organizationId) add('TENANT_MISMATCH'); } }
    const sources = r.evidenceRefs.filter(e => e.type !== 'ATTRIBUTE_DEPENDENCY');
    if (SOURCE_KINDS.has(r.provenanceKind) && !sources.length) add('EVIDENCE_REQUIRED');
    if (r.provenanceKind === 'NORMALIZED_SOURCE' && !r.methodRef) add('METHOD_REQUIRED');
    if (r.evidenceState === 'VERIFIED' && !sources.length && !(r.dependencyRefs || []).length) add('VERIFIED_WITHOUT_EVIDENCE');
    if (r.provenanceKind === 'LEGACY_DECLARED' && r.evidenceState === 'VERIFIED') add('VERIFIED_WITHOUT_EVIDENCE'); // legacy "confirmado" never becomes verified (§491)
    if (DERIVED.has(r.provenanceKind) && pol && pol.requiresMethodForDerived && !r.methodRef && !r.evidenceRefs.some(e => e.type === 'ANALYSIS_RESULT')) add('METHOD_REQUIRED');
    if ((r.provenanceKind === 'CALCULATED' || r.provenanceKind === 'AGGREGATED') && pol && pol.requiresDependencies && !(r.dependencyRefs || []).length) add('DEPENDENCIES_REQUIRED');
    if (r.methodRef && ctx.methods) { const m = ctx.methods.list().filter(x => x.methodId === r.methodRef.methodId); if (!m.length) add('METHOD_NOT_FOUND'); else if (!m.some(x => x.methodVersion === r.methodRef.methodVersion)) add('METHOD_VERSION_NOT_FOUND'); }
    for (const d of r.dependencyRefs || []) { if (d.organizationId && d.organizationId !== r.organizationId) add('TENANT_MISMATCH');
      if (d.entityId === r.entityId && d.attributePath === r.attributePath) add('LINEAGE_CYCLE');
      if (d.provenanceId && ctx.getRecord && !ctx.getRecord(d.provenanceId)) add('DEPENDENCY_NOT_FOUND'); }
    if (r.provenanceKind === 'NOT_AVAILABLE' && !r.notAvailableReason) add('REASON_REQUIRED');
    if (r.notAvailableReason === 'UNKNOWN_REASON') warn('NULL_WITHOUT_REASON');
    if (r.conflictRef && ctx.getConflict && !ctx.getConflict(r.conflictRef)) add('CONFLICT_REFERENCE_INVALID');
    if (r.provenanceKind === 'LEGACY_DECLARED') warn('LEGACY_SOURCE_UNRESOLVED');
    if (r.evidenceState === 'PARTIAL') warn('PARTIAL_EVIDENCE');
    if (r.provenanceKind === 'MANUAL_ASSERTION') warn('MANUAL_ASSERTION');
    if (r.provenanceKind === 'MANUAL_OVERRIDE') warn('MANUAL_OVERRIDE');
    if (sources.length > 1) warn('MULTIPLE_EVIDENCE_SOURCES');
    if (r.evidenceRefs.some(e => e.type === 'DOCUMENT_VERSION' && e.documentSourceRef && e.documentSourceRef.extractionResultId)) warn('EXTRACTION_BASED');
    if (r.currentness === 'SOURCE_SUPERSEDED') warn('SOURCE_SUPERSEDED');
    if (r.currentness === 'STALE') warn('SOURCE_STALE');
    return { valid: !errors.length, errors, warnings };
  }

  // ------------------------------------------------------------------ conflicts (never resolved silently)
  /** candidate({ value, evidenceRefs, authority, observedAt, sourceVersion, unit }) */
  const candidate = o => freeze({ candidateId: o.candidateId || I.stableId('pcand', fingerprint(o.value), o.evidenceRefs || [], o.unit || null), value: clone(o.value), valueFingerprint: fingerprint(o.value), unit: o.unit || null,
    evidenceRefs: (o.evidenceRefs || []).map(clone), authority: o.authority || null, observedAt: o.observedAt || null, sourceVersion: o.sourceVersion || null, methodRef: o.methodRef ? clone(o.methodRef) : null });
  /** detectConflict({ organizationId, entityType, entityId, attributePath, candidates, policy, now }) → { agreed, conflict, selected } */
  function detectConflict(o) {
    const cands = (o.candidates || []).map(c => c.candidateId ? c : candidate(c));
    const fps = [...new Set(cands.map(c => c.valueFingerprint))], units = [...new Set(cands.map(c => c.unit).filter(Boolean))];
    if (fps.length <= 1 && units.length <= 1) return { agreed: true, conflict: null, selected: cands[0] || null, candidates: cands }; // same value: one record, multiple evidence refs
    const methods = [...new Set(cands.map(c => c.methodRef && c.methodRef.methodId + '@' + c.methodRef.methodVersion).filter(Boolean))];
    const conflictType = units.length > 1 ? 'UNIT_MISMATCH' : methods.length > 1 ? 'METHOD_DISAGREEMENT' : cands.every(c => c.evidenceRefs.length) ? 'SOURCE_DISAGREEMENT' : 'VALUE_MISMATCH';
    const pol = o.policy || { mode: 'NO_AUTO_RESOLUTION', authorityOrder: [] };
    let selected = null, status = 'OPEN';
    if (pol.mode === 'AUTHORITY_ORDER') { const rank = c => { const i = (pol.authorityOrder || []).indexOf(c.authority); return i < 0 ? 1e9 : i; };
      const sorted = [...cands].sort((a, b) => rank(a) - rank(b)); if (rank(sorted[0]) < 1e9 && rank(sorted[0]) < rank(sorted[1])) { selected = sorted[0]; status = 'AUTO_RESOLVED_BY_POLICY'; } } // equal authority ⇒ stays OPEN (§154)
    if (pol.mode === 'MANUAL_REVIEW_REQUIRED') status = 'OPEN';
    const body = { organizationId: o.organizationId, entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, candidates: cands, conflictType };
    const conflict = freeze({ id: I.stableId('pconf', body), ...body, resolutionStatus: status, selectedCandidateId: selected ? selected.candidateId : null, resolutionPolicyRef: pol.mode,
      resolvedBy: selected ? 'policy:' + pol.mode : null, resolvedAt: selected ? o.now || null : null, resolutionReason: selected ? 'AUTHORITY_ORDER' : null, createdAt: o.now || null });
    return { agreed: false, conflict, selected, candidates: cands };
  }
  /** resolveConflict(conflict, { candidateId?, status, actorUserId, reason, now }) → new frozen conflict (the old one stays in history) */
  function resolveConflict(c, o) {
    if (o.status !== 'REJECTED_ALL' && o.status !== 'DEFERRED' && !c.candidates.some(x => x.candidateId === o.candidateId)) throw Object.assign(new Error('candidato inexistente'), { code: 'CONFLICT_REFERENCE_INVALID' });
    if (!o.reason) throw Object.assign(new Error('resolução exige motivo'), { code: 'REASON_REQUIRED' });
    return freeze({ ...clone(c), resolutionStatus: o.status || 'MANUALLY_RESOLVED', selectedCandidateId: o.candidateId || null, resolvedBy: o.actorUserId ? 'user:' + o.actorUserId : null, resolvedAt: o.now, resolutionReason: o.reason });
  }

  // ------------------------------------------------------------------ manual assertion / override
  function createManualAssertion(o) {
    for (const k of ['organizationId', 'entityType', 'entityId', 'attributePath', 'assertedBy', 'assertedAt', 'reasonCode']) if (!o[k]) throw Object.assign(new Error('asserção manual sem ' + k), { code: 'INVALID_RECORD', field: k });
    const body = { organizationId: o.organizationId, entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, valueFingerprint: o.valueFingerprint || fingerprint(o.value), assertedBy: o.assertedBy, assertedAt: o.assertedAt, reasonCode: o.reasonCode };
    return freeze({ id: I.stableId('pma', body), ...body, notes: o.notes || null, supportingEvidenceRefs: (o.supportingEvidenceRefs || []).map(clone), status: 'ACTIVE' });
  }
  function createOverride(o) {
    for (const k of ['organizationId', 'replacementProvenanceId', 'actorUserId', 'reasonCode', 'createdAt']) if (!o[k]) throw Object.assign(new Error('override sem ' + k), { code: 'INVALID_RECORD', field: k });
    const body = { organizationId: o.organizationId, previousProvenanceId: o.previousProvenanceId || null, replacementProvenanceId: o.replacementProvenanceId, actorUserId: o.actorUserId, reasonCode: o.reasonCode, createdAt: o.createdAt };
    return freeze({ id: I.stableId('pov', body), ...body, reasonText: o.reasonText || null, approvedBy: o.approvedBy || null });
  }

  /** Topic 34 input contract (§373): structural facts only — no number */
  const confidenceInputs = (r, o = {}) => r ? freeze({ provenanceKind: r.provenanceKind, evidenceState: r.evidenceState, currentness: o.currentness || r.currentness, status: o.status || r.status,
    sourceAuthority: o.sourceAuthority || (r.metadata && r.metadata.sourceAuthority) || null, sourceCount: r.evidenceRefs.filter(e => e.type !== 'ATTRIBUTE_DEPENDENCY').length, hasConflict: r.evidenceState === 'CONFLICTED' || !!r.conflictRef,
    methodType: r.methodRef ? r.methodRef.methodType : null, methodRef: r.methodRef ? { methodId: r.methodRef.methodId, methodVersion: r.methodRef.methodVersion } : null, dependencyCount: (r.dependencyRefs || []).length,
    notAvailableReason: r.notAvailableReason || null, legacy: r.provenanceKind === 'LEGACY_DECLARED', estimate: r.provenanceKind === 'ESTIMATED' || !!(r.metadata && r.metadata.estimate), provenanceId: r.id, valueFingerprint: r.valueFingerprint }) : null;

  return Object.freeze({ ProvenanceKind, EvidenceState, ProvenanceCurrentness, ProvenanceRecordStatus, EvidenceRefType, MethodType, NotAvailableReason, DisplayCode, EvidenceVisibility, ConflictType, ConflictResolutionStatus,
    ResolutionMode, DataVersionRefType, ProjectionMode, NodeType, ERRORS, WARNINGS, EVENTS, PERMISSIONS, LABELS, REASON_LABELS,
    clearCaches: () => { MR.clear(); FP.clear(); }, configOf, valueAt, fingerprint, pathRegistry, methodRegistry, methodRef, evidence: ev, dependencyRef, validateEvidenceRef, dataVersionRef, fieldPolicy, resolutionPolicy,
    createRecord, displayCode, summarize, labelFor, validateRecord, candidate, detectConflict, resolveConflict, createManualAssertion, createOverride, confidenceInputs, isDerivedKind: k => DERIVED.has(k) });
})();
