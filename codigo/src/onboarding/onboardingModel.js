/* onboarding/onboardingModel.js — topic 58: bounded context `development-onboarding` (vocabulary + state machines).
   Enums of the spec, the error taxonomy (§265, with explicit retryability §266), the server-side state machines of
   DevelopmentOnboardingCase (§430–433), IngestionBatch (§24), ReviewItem (§164), DataConflict (§147),
   DevelopmentPublication (§199) and PublicationApproval (§240), deterministic ids and PipelineProgress (§272).
   Pure: no clock (callers pass `at`), no randomness (ids are stable hashes of their inputs), no I/O.
   Depends on App.integrity (sha256, canonicalSerialize, stableId). */
App.onboarding = App.onboarding || {};
App.onboarding.model = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const I = App.integrity;

  const CaseStatus = E('DRAFT', 'SOURCE_INTAKE', 'MAPPING', 'VALIDATING', 'REVIEW_REQUIRED', 'READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');
  const SourceType = E('PDF', 'XLSX', 'CSV', 'KML', 'KMZ', 'GEOJSON', 'CAD', 'IMAGE', 'DOCX', 'TXT', 'API', 'MANUAL_FORM', 'OTHER');
  const SourcePurpose = E('LOT_MASTER', 'GEOMETRY', 'PRICING', 'AVAILABILITY', 'REGULATION', 'MARKETING', 'LEGAL', 'ANALYSIS_INPUT', 'BASE_MAP', 'OTHER');
  const SourceStatus = E('RECEIVED', 'VALIDATED', 'REJECTED', 'SUPERSEDED', 'ARCHIVED');
  const AuthorityDomain = E('LOT_IDENTITY', 'GEOMETRY', 'PRICING', 'AVAILABILITY', 'REGULATION', 'OTHER');
  const AuthorityLevel = E('PRIMARY', 'SECONDARY', 'REFERENCE');
  const BatchType = E('INITIAL', 'INCREMENTAL', 'CORRECTION', 'RECONCILIATION', 'REIMPORT');
  const BatchStatus = E('CREATED', 'INGESTING', 'NORMALIZING', 'VALIDATING', 'REVIEW_REQUIRED', 'READY', 'PUBLISHED', 'FAILED', 'ROLLED_BACK', 'SUPERSEDED', 'CANCELLED');
  const MappingConfidence = E('CONFIRMED', 'SUGGESTED', 'UNVERIFIED');
  const MatchType = E('EXACT', 'HIGH_CONFIDENCE', 'AMBIGUOUS', 'NEW', 'CONFLICT');
  const DuplicateClass = E('DUPLICATE_RECORD', 'POSSIBLE_SPLIT', 'POSSIBLE_MERGE', 'SOURCE_ERROR', 'UNKNOWN');
  const LineageEventType = E('CREATED', 'RENUMBERED', 'SPLIT', 'MERGED', 'RETIRED');
  const CoordinateRefType = E('LOCAL_PLAN', 'PIXEL_SPACE', 'NORMALIZED_LOCAL', 'EPSG', 'UNKNOWN');
  const GeometryType = E('POLYGON', 'MULTIPOLYGON', 'LINE', 'POINT', 'MIXED');
  const GeometryMatchMethod = E('SOURCE_ID', 'BLOCK_LOT', 'SPATIAL', 'MANUAL');
  const Confidence3 = E('HIGH', 'MEDIUM', 'LOW');
  const ConflictStatus = E('OPEN', 'RESOLVED', 'ACCEPTED_DIFFERENCE');
  const ConflictMode = E('BLOCK', 'PREFER_HIGHER_AUTHORITY', 'REQUIRE_REVIEW');
  const DqCategory = E('COMPLETENESS', 'VALIDITY', 'UNIQUENESS', 'CONSISTENCY', 'REFERENTIAL_INTEGRITY', 'GEOMETRY_INTEGRITY', 'COMMERCIAL_COHERENCE', 'PROVENANCE_COVERAGE');
  const DqSeverity = E('INFO', 'WARNING', 'ERROR', 'BLOCKING');
  const DqResult = E('PASS', 'FAIL', 'NOT_APPLICABLE');
  const DqSummaryStatus = E('PASS', 'PASS_WITH_WARNINGS', 'FAIL');
  const ReviewCategory = E('FIELD_MAPPING', 'DATA_CONFLICT', 'LOT_IDENTITY', 'GEOMETRY_MATCH', 'GEOMETRY_ALIGNMENT', 'PRICE_DIFF', 'STATUS_MAPPING', 'DOCUMENT_EXTRACTION', 'QUALITY_EXCEPTION', 'SECURITY');
  const ReviewSeverity = E('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  const ReviewStatus = E('OPEN', 'RESOLVED', 'ACCEPTED', 'REJECTED');
  const CorrectionScope = E('SOURCE_RECORD', 'LOT', 'FIELD', 'BATCH');
  const PublicationStatus = E('CANDIDATE', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'REJECTED');
  const ApprovalStatus = E('PENDING', 'APPROVED', 'REJECTED');
  const RollbackMode = E('POINTER_SWITCH', 'REIMPORT', 'NO_AUTOMATIC_ROLLBACK', 'MANUAL_RECONCILIATION');
  const ChangeSeverity = E('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  const RemovalClass = E('RETIRED', 'MERGED', 'SOURCE_MISSING', 'SOURCE_ERROR');
  const RunMode = E('DRY_RUN', 'BUILD_CANDIDATE', 'PUBLISH');
  const UpdateCategory = E('LOT_MASTER_UPDATE', 'GEOMETRY_UPDATE', 'PRICING_UPDATE', 'AVAILABILITY_UPDATE', 'DOCUMENT_UPDATE', 'ANALYSIS_INPUT_UPDATE', 'CONFIG_UPDATE');
  const Readiness = E('READY', 'PARTIAL', 'NOT_READY');
  const SyncStatus = E('HEALTHY', 'DEGRADED', 'FAILED');
  const Freshness = E('FRESH', 'STALE', 'UNKNOWN');
  const DataState = E('CONFIRMED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN', 'NEEDS_CONFIRMATION', 'NOT_APPLICABLE');

  // §265 error taxonomy + §266 explicit retryability (+ security events §517)
  const ERRORS = Object.freeze({
    SOURCE_FILE_UNSUPPORTED: { retryable: false, message: 'Formato de fonte não suportado (o sistema não finge suporte).' },
    SOURCE_PARSE_FAILED: { retryable: true, message: 'Falha ao interpretar a fonte (pode ser transitória).' },
    SOURCE_SCHEMA_INVALID: { retryable: false, message: 'Estrutura da fonte inválida.' },
    SOURCE_DUPLICATE: { retryable: false, message: 'Arquivo idêntico (mesmo checksum) já registrado neste onboarding.' },
    SOURCE_REJECTED: { retryable: false, message: 'Fonte rejeitada na entrada (segurança ou formato).' },
    SOURCE_SCAN_REQUIRED: { retryable: true, message: 'Varredura de malware obrigatória ainda não concluída (scanner não configurado ou pendente).' },
    SOURCE_IMMUTABLE: { retryable: false, message: 'Arquivo original é imutável: envie uma nova versão.' },
    FIELD_MAPPING_MISSING: { retryable: false, message: 'Campo obrigatório sem mapeamento confirmado.' },
    FIELD_MAPPING_AMBIGUOUS: { retryable: false, message: 'Mapeamento ambíguo: dois campos de origem para o mesmo destino.' },
    FIELD_MAPPING_UNKNOWN_TARGET: { retryable: false, message: 'Campo de destino fora do FieldRegistry.' },
    MAPPING_REVISION_CONFLICT: { retryable: false, message: 'O mapeamento mudou desde a sua leitura (revisão esperada diferente).' },
    LOT_IDENTITY_CONFLICT: { retryable: false, message: 'Conflito de identidade de lote.' },
    LOT_DUPLICATE: { retryable: false, message: 'Lote duplicado.' },
    GEOMETRY_INVALID: { retryable: false, message: 'Geometria inválida.' },
    GEOMETRY_UNMATCHED: { retryable: false, message: 'Geometria sem lote correspondente.' },
    GEOMETRY_ALIGNMENT_FAILED: { retryable: false, message: 'Alinhamento de geometria sem transformação validada.' },
    GEOMETRY_RASTER_NOT_GEOMETRY: { retryable: false, message: 'Imagem raster não é geometria de lote.' },
    PRICE_IMPORT_CONFLICT: { retryable: false, message: 'Conflito na importação de preços.' },
    AVAILABILITY_STATUS_UNKNOWN: { retryable: false, message: 'Status de origem sem mapeamento: nunca adivinhado.' },
    DATA_QUALITY_BLOCKER: { retryable: false, message: 'Há bloqueios de qualidade de dados.' },
    PUBLICATION_VALIDATION_FAILED: { retryable: false, message: 'Validação da publicação falhou (checksum ou artefatos).' },
    PUBLICATION_CONFLICT: { retryable: true, message: 'Outra publicação está em andamento ou a revisão esperada mudou.' },
    PUBLICATION_APPROVAL_REQUIRED: { retryable: false, message: 'Publicação exige aprovação.' },
    PUBLICATION_SEPARATION_OF_DUTIES: { retryable: false, message: 'Quem pede a publicação não pode aprová-la.' },
    BATCH_DUPLICATE: { retryable: false, message: 'Lote de ingestão idêntico (mesmas fontes, mapeamento e versão de pipeline).' },
    BATCH_OBSOLETE: { retryable: false, message: 'Lote de ingestão obsoleto (substituído): não pode publicar.' },
    INVALID_TRANSITION: { retryable: false, message: 'Transição de estado não permitida.' },
    CASE_CANCELLED: { retryable: false, message: 'Onboarding cancelado não publica.' },
    PERMISSION_DENIED: { retryable: false, message: 'Sem permissão.' },
    CROSS_TENANT_DENIED: { retryable: false, message: 'Recurso de outra organização.' },
    POLICY_NOT_CONFIGURED: { retryable: false, message: 'Política não configurada (necessita confirmação).' },
    VALIDATION_ERROR: { retryable: false, message: 'Requisição inválida.' },
    NOT_FOUND: { retryable: false, message: 'Não encontrado.' }
  });
  const SECURITY_EVENTS = E('UNAUTHORIZED_SOURCE_UPLOAD', 'CROSS_TENANT_IMPORT_ATTEMPT', 'MALICIOUS_ARCHIVE_REJECTED', 'UNAUTHORIZED_PUBLICATION', 'MACRO_FILE_REJECTED', 'SPOOFED_MIME_REJECTED');

  /** fail(code, details, refs) → frozen error result (support code carries batch/source ids, §516) */
  function fail(code, details = null, refs = {}) {
    const e = ERRORS[code] || { retryable: false, message: code };
    return Object.freeze({ ok: false, code, message: e.message, retryable: e.retryable, details, refs: Object.freeze({ ...refs }) });
  }
  const ok = (value, extra = {}) => Object.freeze({ ok: true, value, ...extra });

  // ------------------------------------------------------------------ state machines (server-side; UI never sets status §429)
  const MACHINES = Object.freeze({
    case: Object.freeze({
      DRAFT: ['SOURCE_INTAKE', 'CANCELLED'],
      SOURCE_INTAKE: ['MAPPING', 'FAILED', 'CANCELLED'],
      MAPPING: ['VALIDATING', 'SOURCE_INTAKE', 'FAILED', 'CANCELLED'],
      VALIDATING: ['REVIEW_REQUIRED', 'READY_TO_PUBLISH', 'FAILED', 'CANCELLED', 'MAPPING'],
      REVIEW_REQUIRED: ['VALIDATING', 'MAPPING', 'FAILED', 'CANCELLED'],
      READY_TO_PUBLISH: ['PUBLISHING', 'VALIDATING', 'MAPPING', 'CANCELLED'],
      PUBLISHING: ['PUBLISHED', 'READY_TO_PUBLISH', 'REVIEW_REQUIRED', 'FAILED'], // §433 publish failure → ready/review
      PUBLISHED: ['MAPPING'], // maintenance batches re-enter the pipeline (§456–457)
      FAILED: ['SOURCE_INTAKE', 'MAPPING', 'VALIDATING', 'CANCELLED'], // §431 retry
      CANCELLED: [] // §432
    }),
    batch: Object.freeze({
      CREATED: ['INGESTING', 'FAILED', 'SUPERSEDED', 'CANCELLED'],
      INGESTING: ['NORMALIZING', 'FAILED', 'SUPERSEDED', 'CANCELLED'],
      NORMALIZING: ['VALIDATING', 'FAILED', 'SUPERSEDED', 'CANCELLED'],
      VALIDATING: ['REVIEW_REQUIRED', 'READY', 'FAILED', 'SUPERSEDED', 'CANCELLED'],
      REVIEW_REQUIRED: ['VALIDATING', 'NORMALIZING', 'FAILED', 'SUPERSEDED', 'CANCELLED'],
      READY: ['PUBLISHED', 'VALIDATING', 'NORMALIZING', 'SUPERSEDED', 'CANCELLED'],
      PUBLISHED: ['ROLLED_BACK'],
      FAILED: ['INGESTING', 'NORMALIZING', 'VALIDATING', 'SUPERSEDED', 'CANCELLED'], // resume from checkpoint §275
      ROLLED_BACK: [], SUPERSEDED: [], CANCELLED: []
    }),
    review: Object.freeze({ OPEN: ['RESOLVED', 'ACCEPTED', 'REJECTED'], RESOLVED: [], ACCEPTED: [], REJECTED: [] }),
    conflict: Object.freeze({ OPEN: ['RESOLVED', 'ACCEPTED_DIFFERENCE'], RESOLVED: [], ACCEPTED_DIFFERENCE: [] }),
    publication: Object.freeze({ CANDIDATE: ['PUBLISHED', 'REJECTED'], PUBLISHED: ['SUPERSEDED', 'ROLLED_BACK'], SUPERSEDED: ['PUBLISHED'], ROLLED_BACK: ['PUBLISHED'], REJECTED: [] }),
    approval: Object.freeze({ PENDING: ['APPROVED', 'REJECTED'], APPROVED: [], REJECTED: [] })
  });
  const canTransition = (machine, from, to) => !!(MACHINES[machine] && (MACHINES[machine][from] || []).includes(to));
  /** transition(machine, entity, to, { at, by, expectedRevision }) → ok(newEntity) | fail(INVALID_TRANSITION | MAPPING_REVISION_CONFLICT) */
  function transition(machine, entity, to, { at = null, by = null, expectedRevision } = {}) {
    if (!entity) return fail('NOT_FOUND');
    if (expectedRevision != null && entity.revision != null && String(expectedRevision) !== String(entity.revision)) return fail('PUBLICATION_CONFLICT', `revisão esperada ${expectedRevision}, atual ${entity.revision}`);
    if (!canTransition(machine, entity.status, to)) return fail(machine === 'case' && entity.status === 'CANCELLED' ? 'CASE_CANCELLED' : 'INVALID_TRANSITION', `${machine}: ${entity.status} → ${to}`);
    const history = [...(entity.statusHistory || []), Object.freeze({ from: entity.status, to, at, by })];
    return ok(Object.freeze({ ...entity, status: to, updatedAt: at || entity.updatedAt || null, revision: nextRevision(entity.revision), statusHistory: Object.freeze(history) }));
  }
  const nextRevision = r => String((parseInt(r, 10) || 0) + 1);

  // ------------------------------------------------------------------ ids (deterministic; never a filename or a path)
  const id = (prefix, ...parts) => I.stableId(prefix, ...parts);
  const checksum = v => I.checksumOf(v);

  // ------------------------------------------------------------------ stages, checkpoints, progress (§264, §272, §276)
  const STAGES = Object.freeze(['UPLOAD', 'SCAN', 'PARSE', 'SCHEMA_DISCOVERY', 'MAP', 'NORMALIZE', 'CANONICALIZE', 'GEOMETRY', 'COMMERCIAL', 'VALIDATE', 'QUALITY', 'BUILD_ARTIFACTS', 'REVIEW', 'PUBLISH']);
  const CHECKPOINTS = Object.freeze(['PARSED', 'MAPPED', 'NORMALIZED', 'VALIDATED', 'ARTIFACTS_BUILT']);
  /** progress from real stage records only (§270–271): currentStageProgress stays undefined when unknown */
  function pipelineProgress(batchId, stageRecords = []) {
    const done = stageRecords.filter(s => s.status === 'DONE').map(s => s.stage);
    const running = stageRecords.find(s => s.status === 'RUNNING');
    const failed = stageRecords.find(s => s.status === 'FAILED');
    const current = (running || failed || {}).stage || (done.length ? done[done.length - 1] : 'UPLOAD');
    const p = { batchId, currentStage: current, completedStages: done, pendingStages: STAGES.filter(s => !done.includes(s) && s !== current), failedStage: failed ? failed.stage : null };
    if (running && typeof running.progress === 'number' && running.progress >= 0 && running.progress <= 1) p.currentStageProgress = running.progress;
    return Object.freeze(p);
  }

  /** labels pt-BR for UI and reports */
  const LABELS = Object.freeze({
    case: { DRAFT: 'Rascunho', SOURCE_INTAKE: 'Recebendo fontes', MAPPING: 'Mapeamento', VALIDATING: 'Validando', REVIEW_REQUIRED: 'Revisão necessária', READY_TO_PUBLISH: 'Pronto para publicar', PUBLISHING: 'Publicando', PUBLISHED: 'Publicado', FAILED: 'Falhou', CANCELLED: 'Cancelado' },
    severity: { BLOCKING: 'Bloqueios', ERROR: 'Erros', WARNING: 'Avisos', INFO: 'Informações' }
  });

  return Object.freeze({ CaseStatus, SourceType, SourcePurpose, SourceStatus, AuthorityDomain, AuthorityLevel, BatchType, BatchStatus, MappingConfidence, MatchType, DuplicateClass,
    LineageEventType, CoordinateRefType, GeometryType, GeometryMatchMethod, Confidence3, ConflictStatus, ConflictMode, DqCategory, DqSeverity, DqResult, DqSummaryStatus,
    ReviewCategory, ReviewSeverity, ReviewStatus, CorrectionScope, PublicationStatus, ApprovalStatus, RollbackMode, ChangeSeverity, RemovalClass, RunMode, UpdateCategory,
    Readiness, SyncStatus, Freshness, DataState, ERRORS, SECURITY_EVENTS, MACHINES, STAGES, CHECKPOINTS, LABELS,
    fail, ok, canTransition, transition, nextRevision, id, checksum, pipelineProgress });
})();
