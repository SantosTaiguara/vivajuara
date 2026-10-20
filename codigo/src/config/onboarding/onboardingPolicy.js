/* config/onboarding/onboardingPolicy.js — topic 58: policy of the development onboarding / ingestion pipeline.
   Plain data (deep-frozen) read by src/onboarding/*. Everything development-specific lives in `developments`
   (template refs, expected counts), never in the generic pipeline code.
   Business/legal values that nobody decided yet are null with status "necessita confirmação": the code then refuses,
   asks for review or shows "não configurado" — it never substitutes an invented number.
   Technical defaults (upload size limits, parser limits) are marked "default técnico — revisar". */
App.onboardingPolicy = (() => {
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
  const PENDING = 'necessita confirmação';
  return deepFreeze({
    kind: 'onboarding-policy',
    version: '1.0.0',
    pipelineVersion: 'onboarding-pipeline@1.0.0',
    lotIdRule: { id: 'lot-id@1', pattern: '{developmentCode}-Q{blockCode}-L{lotNumber:4}', note: 'Tópico 6: empreendimento + quadra + lote com 4 dígitos (VJ-QA-L0001). Mesma identidade física → mesmo ID em qualquer reimportação e ambiente.' },

    // §64–66 null semantics: tokens that mean "no information" (→ null + state UNKNOWN). "0" is a value, never null.
    nullTokens: ['', 'n/a', 'na', '-', '—', '–', 'sem informação', 'sem informacao', 's/i', 'null', 'nulo', '?'],
    booleanTokens: { true: ['sim', 's', 'yes', 'y', 'true', 'verdadeiro', '1'], false: ['não', 'nao', 'n', 'no', 'false', 'falso', '0'] },

    // §246–251 secure intake. Detected type (magic bytes / text sniff) decides; the extension is only a hint.
    upload: {
      malwareScanRequired: true, // no scanner configured → source stays RECEIVED (quarantine) and cannot be parsed
      limitsStatus: 'default técnico — revisar',
      types: {
        CSV: { ext: ['csv', 'txt'], detected: ['text/plain'], maxBytes: 20971520 },
        TXT: { ext: ['txt'], detected: ['text/plain'], maxBytes: 5242880 },
        GEOJSON: { ext: ['geojson', 'json'], detected: ['application/json'], maxBytes: 20971520 },
        KML: { ext: ['kml'], detected: ['application/vnd.google-earth.kml+xml'], maxBytes: 20971520 },
        KMZ: { ext: ['kmz'], detected: ['application/zip'], maxBytes: 20971520, archive: 'kmz' },
        XLSX: { ext: ['xlsx'], detected: ['application/zip'], maxBytes: 20971520, archive: 'kmz' },
        PDF: { ext: ['pdf'], detected: ['application/pdf'], maxBytes: 26214400 },
        IMAGE: { ext: ['png', 'jpg', 'jpeg', 'webp'], detected: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 10485760 },
        DOCX: { ext: ['docx'], detected: ['application/zip'], maxBytes: 26214400, archive: 'kmz' },
        API: { ext: [], detected: ['application/json'], maxBytes: 20971520 },
        MANUAL_FORM: { ext: [], detected: ['application/json'], maxBytes: 1048576 },
        CAD: { ext: ['dwg', 'dxf'], detected: [], maxBytes: 0, unsupported: true },
        OTHER: { ext: ['json'], detected: ['application/json'], maxBytes: 20971520, note: 'somente JSON de registros (ex.: lots.json legado)' }
      },
      // spreadsheets with macros are never executed and are rejected at intake (§254)
      macroMarkers: ['xl/vbaProject.bin', 'vbaProject.bin', 'word/vbaProject.bin'],
      macroExtensions: ['xlsm', 'xlsb', 'xltm', 'docm', 'dotm']
    },

    // §59–63 transforms (versioned). Development-specific transforms must declare owner + developmentId.
    transformsVersion: '1.0.0',

    // §57 deterministic mapping suggestions: normalized header → FieldRegistry key. Always SUGGESTED until a human confirms.
    headerSynonyms: {
      'lote': 'identity.lotNumber', 'numero do lote': 'identity.lotNumber', 'n lote': 'identity.lotNumber', 'lot': 'identity.lotNumber', 'n': 'identity.lotNumber',
      'quadra': 'identity.blockId', 'qd': 'identity.blockId', 'block': 'identity.blockId', 'q': 'identity.blockId',
      'metragem': 'geometry.areaM2', 'area': 'geometry.areaM2', 'area m2': 'geometry.areaM2', 'area total': 'geometry.areaM2', 'a': 'geometry.areaM2',
      'preco': 'commercial.price', 'valor': 'commercial.price', 'preco de tabela': 'commercial.price', 'price': 'commercial.price',
      'status': 'availability.status', 'situacao': 'availability.status', 'disponibilidade': 'availability.status', 'st': 'availability.status',
      'codigo': 'identity.externalCode', 'codigo da loteadora': 'identity.externalCode', 'id externo': 'identity.externalCode', 'external id': 'identity.externalCode',
      'did': 'identity.id', 'frente': 'geometry.frontM', 'fundos': 'geometry.rearM', 'latitude': 'location.latitude', 'lat': 'location.latitude', 'longitude': 'location.longitude', 'lon': 'location.longitude',
      'p': 'geometry.polygon', 'poligono': 'geometry.polygon'
    },
    requiredLotFields: ['identity.blockId', 'identity.lotNumber'],

    // §131–132 availability status mapping registry. Only platform vocabulary is pre-registered (canonical names and the
    // legacy codes of domain/availability.js). Any other source value (e.g. "PRÉ-RESERVA") → AVAILABILITY_STATUS_UNKNOWN → review.
    availabilityStatusMappings: [],

    // §125–126 / §446–447: thresholds are business policy → not configured.
    priceChangeReviewThresholdPercent: null, priceChangeReviewThresholdStatus: PENDING,
    priceCoverageRequiredPercent: null, priceCoverageRequiredStatus: PENDING,
    currencyAllowed: ['BRL'],
    zeroPriceAllowed: false, // §118 zero only if semantically valid: nobody declared it valid

    // §144–145 source precedence. No tolerance is invented: different normalized values = conflict.
    sourcePrecedence: [
      { fieldKey: 'geometry.areaM2', sourcePriorities: [{ sourcePurpose: 'LOT_MASTER', priority: 1 }, { sourcePurpose: 'GEOMETRY', priority: 2 }, { sourcePurpose: 'MARKETING', priority: 9 }], conflictMode: 'REQUIRE_REVIEW' },
      { fieldKey: 'identity.blockId', sourcePriorities: [{ sourcePurpose: 'LOT_MASTER', priority: 1 }], conflictMode: 'BLOCK' },
      { fieldKey: 'identity.lotNumber', sourcePriorities: [{ sourcePurpose: 'LOT_MASTER', priority: 1 }], conflictMode: 'BLOCK' }
    ],
    defaultConflictMode: 'REQUIRE_REVIEW',
    marketingNeverOverridesTechnical: true,

    // §159–161 / §439–445 data quality gate
    errorsBlockPublish: true, // safe default (configurable per organization); BLOCKING always blocks
    qualityExceptionPolicy: {
      // waivable = an approved DataQualityException turns the FAIL into an accepted warning. BLOCKING checks are not waivable by default.
      'COMPLETENESS.MARKETING_DESCRIPTION': { waivable: true },
      'COMPLETENESS.PRICE_PRESENT': { waivable: true },
      'PROVENANCE_COVERAGE.CRITICAL_FIELDS': { waivable: false },
      'UNIQUENESS.CANONICAL_LOT_ID': { waivable: false },
      'GEOMETRY_INTEGRITY.VALID_POLYGON': { waivable: false },
      'COMMERCIAL_COHERENCE.AVAILABILITY_STATUS_KNOWN': { waivable: false }
    },

    // §239–241 approval. separationOfDuties null = not decided → the strictest reading applies (approver ≠ requester).
    approval: { requiredForPublish: true, separationOfDuties: null, separationOfDutiesStatus: PENDING },
    autoPublish: false, // §237–238: auto-ingest may be allowed later; auto-publish never without policy
    notificationPolicy: null, notificationStatus: PENDING, // §383 intents only; nothing is sent
    reviewSla: null, reviewSlaStatus: PENDING, // §381 do not invent
    rawSourceRetention: null, rawSourceRetentionStatus: PENDING, // §358
    failedBatchRetention: null, failedBatchRetentionStatus: PENDING, // §357

    // §187–191 readiness + §396–399 capability-based publish
    readiness: {
      core: ['DEVELOPMENT', 'BLOCKS', 'LOTS', 'GEOMETRY', 'MAP_LOT_INDEX'],
      commercial: ['PRICING', 'AVAILABILITY', 'PAYMENT_PLANS'],
      analytics: ['ANALYSIS_VERSION', 'SCORES', 'LAYERS']
    },
    publishStages: ['DRAFT', 'INTERNAL_PREVIEW', 'PUBLISHED_INTERNAL', 'PUBLISHED_COMMERCIAL'],
    previewWatermark: 'DADOS NÃO PUBLICADOS',

    // §256–257 accidental PII in sources: flagged for review and never mapped into the lot domain
    piiPatterns: [
      { id: 'EMAIL', re: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
      { id: 'CPF', re: '\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b' },
      { id: 'PHONE_BR', re: '\\(?\\b\\d{2}\\)?\\s?9\\d{4}-?\\d{4}\\b' }
    ],
    piiHeaderHints: ['cpf', 'email', 'e-mail', 'telefone', 'celular', 'cliente', 'comprador', 'nome do cliente', 'rg'],

    // §292–296 templates: configuration only, never data
    templates: {
      'standard-lot-development@1.0.0': {
        id: 'standard-lot-development', version: '1.0.0', developmentType: 'LOT_SUBDIVISION', listOnlyModeSupported: false,
        layers: ['availability', 'price', 'area', 'class'], documentCategories: ['REGULATION', 'MEMORIAL', 'CONTRACT_TEMPLATE', 'COMMERCIAL_TABLE', 'TECHNICAL'],
        capabilities: ['MAP', 'PRICING', 'AVAILABILITY', 'PAYMENT_PLANS', 'SOLAR_ANALYSIS', 'PRICE_HISTORY', 'AERIAL_IMAGE', 'ANALYSIS']
      }
    },

    // per-development onboarding facts (the only place a development appears by name)
    developments: {
      'viva-juara': { code: 'VJ', organizationId: 'org_house7', templateRef: 'standard-lot-development@1.0.0', lotCountExpected: 498, timezone: 'America/Sao_Paulo' }
    },

    // §259–262 metrics (names only; labels never carry raw source values)
    metrics: ['ingestion_batches_total', 'ingestion_failures_total', 'source_assets_received_total', 'mapping_conflicts_total', 'geometry_validation_failures_total', 'publication_failures_total',
      'source_parse_duration_ms', 'normalization_duration_ms', 'validation_duration_ms', 'geometry_build_duration_ms', 'publication_duration_ms',
      'unmapped_field_count', 'unmatched_geometry_count', 'data_conflict_count', 'blocking_quality_issue_count', 'provenance_coverage_percent']
  });
})();
