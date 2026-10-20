/* datastate/dataState.js — topic 37: unknown / missing / not-applicable / pending / conflicted / stale data as
   first-class semantic states, and the read-side projection that degrades gracefully.

   Five orthogonal axes, never folded into one enum:
     CanonicalDataState   KNOWN · UNKNOWN · NOT_AVAILABLE · NOT_APPLICABLE · PENDING · CONFLICTED · INVALID · ERROR · PARTIAL
     FreshnessState       CURRENT · STALE · EXPIRED · UNKNOWN · NOT_APPLICABLE        (per field/domain policy)
     DataCompletenessState COMPLETE · PARTIAL · EMPTY · NOT_APPLICABLE                  (composites/lists)
     DataAccessProjection FULL · SUMMARY_ONLY · REDACTED · HIDDEN                       (depends on the viewer)
     UiLoadState          NOT_REQUESTED · LOADING · LOADED · FAILED                     (UI only, never domain)
   ProjectedDataState = canonical states + RESTRICTED + HIDDEN, derived per viewer, never stored.

   Rules (spec 37): null is never 0, false or ''; UNKNOWN is never NOT_APPLICABLE nor a negative value; STALE keeps
   the value (KNOWN + STALE); access denial is a projection, never an "unknown" canonical state; a legacy null with no
   recoverable reason is UNKNOWN / LEGACY_UNCLASSIFIED; enum sentinels such as 'UNKNOWN' are read as UNKNOWN with no
   operational value; known zero / known false / known empty stay known when the field policy allows them.
   The canonical Lot is never modified: this module reads it (zero value delta) and adds state metadata beside it.
   Domain codes only here; pt-BR wording lives in DISPLAY (projection), not in records. No DOM, no storage. */
App.dataState = (() => {
  const M = App.model;
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const CanonicalDataState = E('KNOWN', 'UNKNOWN', 'NOT_AVAILABLE', 'NOT_APPLICABLE', 'PENDING', 'CONFLICTED', 'INVALID', 'ERROR', 'PARTIAL');
  const ProjectedDataState = E(...Object.keys(CanonicalDataState), 'RESTRICTED', 'HIDDEN');
  const FreshnessState = E('CURRENT', 'STALE', 'EXPIRED', 'UNKNOWN', 'NOT_APPLICABLE');
  const DataCompletenessState = E('COMPLETE', 'PARTIAL', 'EMPTY', 'NOT_APPLICABLE');
  const DataAccessProjection = E('FULL', 'SUMMARY_ONLY', 'REDACTED', 'HIDDEN');
  const UiLoadState = E('NOT_REQUESTED', 'LOADING', 'LOADED', 'FAILED');
  const RawDataPresenceState = E('PRESENT', 'MISSING_KEY', 'NULL_VALUE', 'EMPTY_STRING', 'SENTINEL', 'PARSE_ERROR');
  const FilterEvaluation = E('MATCH', 'NO_MATCH', 'UNKNOWN', 'NOT_APPLICABLE', 'ERROR');
  const FilterUnknownPolicy = E('EXCLUDE', 'INCLUDE', 'INCLUDE_WITH_WARNING', 'SEPARATE_BUCKET');
  const UnknownSortPolicy = E('LAST', 'FIRST', 'SEPARATE', 'ERROR');
  const ConstraintStatus = E('PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE', 'ERROR');
  const DisplayMode = E('CLIENT', 'BROKER', 'TECHNICAL');
  const DetailLevel = E('VALUE_ONLY', 'SUMMARY', 'TECHNICAL');
  const ErrorCode = E('DATA_STATE_MISSING', 'KNOWN_VALUE_MISSING', 'UNKNOWN_WITH_OPERATIONAL_VALUE', 'NOT_APPLICABLE_WITH_VALUE', 'CONFLICTED_WITH_UNRESOLVED_OPERATIONAL_VALUE',
    'INVALID_WITH_OPERATIONAL_VALUE', 'STATE_NOT_ALLOWED_FOR_FIELD', 'REASON_REQUIRED', 'UNKNOWN_REASON_CODE', 'VALUE_STATE_FINGERPRINT_MISMATCH', 'TENANT_MISMATCH', 'UNKNOWN_STATE');
  const WarningCode = E('LEGACY_UNCLASSIFIED_NULL', 'STALE_KNOWN_VALUE', 'PARTIAL_COMPOSITE_VALUE', 'UNKNOWN_FRESHNESS', 'ACCESS_REDACTED', 'ZERO_REQUIRES_REVIEW');
  const S = CanonicalDataState;
  const NULL_STATES = new Set([S.UNKNOWN, S.NOT_AVAILABLE, S.NOT_APPLICABLE, S.CONFLICTED, S.INVALID, S.ERROR]);

  // ------------------------------------------------------------------ DataStateReasonRegistry
  // Aligned with the "NotAvailableReason" vocabulary of topic 33 (that catalogue is not in this codebase yet: when it
  // lands, NOT_AVAILABLE_REASON_ALIGNMENT is the explicit 1:1 mapping, no second code for the same meaning).
  const R = (code, allowed, client, broker, description, vis = {}) => Object.freeze({ code, allowedStates: Object.freeze(allowed), labels: Object.freeze({ CLIENT: client, BROKER: broker, TECHNICAL: code }),
    description, clientVisible: vis.client !== false, brokerVisible: vis.broker !== false, technicalVisible: true });
  const REASONS = Object.freeze(Object.fromEntries([
    R('SOURCE_NOT_PROVIDED', ['NOT_AVAILABLE', 'UNKNOWN'], 'Informação ainda não disponível', 'A fonte não fornece este dado', 'O material recebido não traz o dado.'),
    R('SOURCE_NOT_INGESTED', ['NOT_AVAILABLE', 'UNKNOWN', 'PENDING'], 'Informação ainda não disponível', 'Fonte ainda não integrada', 'Existe fonte prevista, mas ela ainda não foi carregada na plataforma.'),
    R('SOURCE_UNAVAILABLE', ['NOT_AVAILABLE', 'UNKNOWN'], 'Informação temporariamente indisponível', 'Fonte indisponível no momento', 'A fonte existe e falhou ao responder.'),
    R('NOT_MEASURED', ['NOT_AVAILABLE'], 'Informação ainda não disponível', 'Ainda não medido', 'O levantamento que produziria o dado não foi feito.'),
    R('DERIVATION_NOT_POSSIBLE', ['NOT_AVAILABLE'], 'Informação não disponível', 'Não calculável com os dados atuais', 'Não há metodologia ou insumos para derivar o valor.'),
    R('MISSING_REQUIRED_INPUT', ['NOT_AVAILABLE', 'UNKNOWN'], 'Informação não disponível', 'Falta um dado de entrada', 'Um insumo obrigatório do cálculo está ausente.'),
    R('NOT_APPLICABLE_BY_DOMAIN', ['NOT_APPLICABLE'], 'Não se aplica', 'Não se aplica a este lote', 'A regra de domínio define que o atributo não se aplica.'),
    R('PENDING_IMPORT', ['PENDING'], 'Em atualização', 'Importação em processamento', 'Uma importação aceita ainda está sendo processada.'),
    R('PENDING_ANALYSIS', ['PENDING'], 'Em atualização', 'Análise em processamento', 'Uma nova análise está sendo calculada.'),
    R('PENDING_PUBLICATION', ['PENDING'], 'Em atualização', 'Aguardando publicação', 'O dado existe, mas ainda não foi publicado.'),
    R('CONFLICT_UNRESOLVED', ['CONFLICTED'], 'Informação a confirmar', 'Fontes divergentes — confirmar', 'Há evidências incompatíveis sem resolução formal.'),
    R('VALIDATION_FAILED', ['INVALID'], 'Informação não disponível', 'Dado inválido — revisar', 'O valor existe, mas falhou na validação.'),
    R('PROCESSING_FAILED', ['ERROR'], 'Informação temporariamente indisponível', 'Falha ao processar', 'A produção do dado falhou com insumos válidos.'),
    R('LEGACY_UNCLASSIFIED', ['UNKNOWN'], 'Informação não disponível', 'Dado não informado na base', 'Nulo herdado da base antiga, sem motivo recuperável.'),
    R('UNSUPPORTED_SOURCE', ['NOT_AVAILABLE', 'INVALID'], 'Informação não disponível', 'Fonte não suportada', 'O formato da fonte não é suportado pelo adaptador.'),
    R('OUTSIDE_SCOPE', ['NOT_APPLICABLE', 'NOT_AVAILABLE'], 'Não se aplica', 'Fora do escopo do material', 'O atributo fica fora do escopo do material recebido.'),
    R('UNKNOWN_REASON', ['UNKNOWN'], 'Informação não disponível', 'Motivo desconhecido', 'Motivo não identificado.')
  ].map(r => [r.code, r])));
  const NOT_AVAILABLE_REASON_ALIGNMENT = Object.freeze(Object.fromEntries(Object.keys(REASONS).map(k => [k, k])));

  // ------------------------------------------------------------------ display labels (pt-BR, spec §370–§374)
  const LABELS = Object.freeze({
    CLIENT: { UNKNOWN: 'Informação não disponível', NOT_AVAILABLE: 'Informação ainda não disponível', NOT_APPLICABLE: 'Não se aplica', PENDING: 'Em atualização', CONFLICTED: 'Informação a confirmar',
      INVALID: 'Informação não disponível', ERROR: 'Informação temporariamente indisponível', PARTIAL: 'Informação parcial', RESTRICTED: 'Informação restrita' },
    BROKER: { UNKNOWN: 'Dado desconhecido', NOT_AVAILABLE: 'Não disponível', NOT_APPLICABLE: 'Não se aplica', PENDING: 'Em atualização', CONFLICTED: 'Dados divergentes — confirmar',
      INVALID: 'Dado inválido — revisar', ERROR: 'Falha ao processar', PARTIAL: 'Dado parcial', RESTRICTED: 'Acesso restrito' },
    TECHNICAL: Object.fromEntries([...Object.keys(ProjectedDataState)].map(k => [k, k]))
  });
  const COMPACT = Object.freeze({ CLIENT: 'N/D', BROKER: 'N/D', TECHNICAL: 'N/D' });
  const FRESHNESS_TEXT = Object.freeze({ STALE: { CLIENT: 'Confirmar condição atual', BROKER: 'Desatualizado — confirmar', TECHNICAL: 'STALE' },
    EXPIRED: { CLIENT: 'Confirmar condição atual', BROKER: 'Informação vencida — confirmar antes de usar', TECHNICAL: 'EXPIRED' } });
  const SEMANTIC_TOKEN = Object.freeze({ KNOWN: 'ds-known', UNKNOWN: 'ds-nodata', NOT_AVAILABLE: 'ds-nodata', NOT_APPLICABLE: 'ds-na', PENDING: 'ds-pending', CONFLICTED: 'ds-warning',
    INVALID: 'ds-warning', ERROR: 'ds-error', PARTIAL: 'ds-partial', RESTRICTED: 'ds-restricted', HIDDEN: 'ds-hidden' });
  const ICON = Object.freeze({ UNKNOWN: 'circle-dashed', NOT_AVAILABLE: 'circle-dashed', NOT_APPLICABLE: 'minus', PENDING: 'clock', CONFLICTED: 'alert-triangle', INVALID: 'alert-triangle', ERROR: 'alert-octagon', PARTIAL: 'circle-half', RESTRICTED: 'lock' });
  /** DataStateDisplayPolicy per mode (§366) */
  const DISPLAY_POLICIES = Object.freeze({
    CLIENT: Object.freeze({ mode: 'CLIENT', labels: LABELS.CLIENT, showReasonCodes: false, showFreshness: true, showProvenance: false, showConfidence: false, unknownActionIds: [], conflictedActionIds: [], staleActionIds: [] }),
    BROKER: Object.freeze({ mode: 'BROKER', labels: LABELS.BROKER, showReasonCodes: false, showFreshness: true, showProvenance: true, showConfidence: true, unknownActionIds: ['requestConfirmation'], conflictedActionIds: ['viewSource', 'requestConfirmation'], staleActionIds: ['refresh'] }),
    TECHNICAL: Object.freeze({ mode: 'TECHNICAL', labels: LABELS.TECHNICAL, showReasonCodes: true, showFreshness: true, showProvenance: true, showConfidence: true, unknownActionIds: ['viewSource'], conflictedActionIds: ['viewSource', 'openConflict'], staleActionIds: ['refresh'] })
  });
  const modeOf = m => { const u = String(m || 'BROKER').toUpperCase(); return u === 'CLIENT' || u === 'PRESENTATION' ? 'CLIENT' : u === 'TECHNICAL' ? 'TECHNICAL' : 'BROKER'; };

  // ------------------------------------------------------------------ FieldDataStatePolicy (FieldRegistry extension by reference)
  /* Explicit, evidence-backed classifications of the nulls this dataset has (LEGACY_NULL_MIGRATION_REPORT.md). Each one
     cites the Field Registry text or a sibling field that supports it; everything not listed here falls back to
     UNKNOWN / LEGACY_UNCLASSIFIED. `when(lot)` makes a classification conditional on evidence present in the lot. */
  const regulationMissing = lot => M.get(lot, 'construction.regulationStatus') === 'UNAVAILABLE';
  const availabilityUnfed = lot => M.get(lot, 'availability.status') === 'UNKNOWN';
  const NULL_CLASSIFICATION = Object.freeze({
    'identity.blockNumber': { state: 'NOT_APPLICABLE', reason: 'NOT_APPLICABLE_BY_DOMAIN', certainty: 'HIGH', evidence: 'Registro: quadras identificadas por letra (status NOT_APPLICABLE).' },
    'construction.frontSetbackM': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'construction.regulationStatus = UNAVAILABLE (regulamento não recebido).' },
    'construction.rearSetbackM': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.sideSetbackM': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.occupationRate': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.permeabilityRate': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.buildingCoefficient': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.maxFloors': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', when: regulationMissing, evidence: 'Idem (regulamento construtivo).' },
    'construction.constructivePotential': { state: 'NOT_AVAILABLE', reason: 'MISSING_REQUIRED_INPUT', certainty: 'HIGH', when: regulationMissing, evidence: 'Registro: "Sem regulamento não há metodologia".' },
    'construction.topography': { state: 'NOT_AVAILABLE', reason: 'NOT_MEASURED', certainty: 'MEDIUM', review: true, evidence: 'Registro: "Falta levantamento planialtimétrico".' },
    'construction.slopePercent': { state: 'NOT_AVAILABLE', reason: 'NOT_MEASURED', certainty: 'MEDIUM', review: true, evidence: 'Registro: "Falta levantamento planialtimétrico".' },
    'construction.drainage': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'MEDIUM', review: true, evidence: 'Registro: "Falta projeto de drenagem".' },
    'environmental.ventilation': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'MEDIUM', review: true, evidence: 'Registro: "Sem dados de vento".' },
    'geometry.perimeterM': { state: 'NOT_AVAILABLE', reason: 'DERIVATION_NOT_POSSIBLE', certainty: 'HIGH', evidence: 'Registro: "sem metodologia aprovada para o traço da planta".' },
    'geometry.irregularityLevel': { state: 'NOT_AVAILABLE', reason: 'DERIVATION_NOT_POSSIBLE', certainty: 'HIGH', evidence: 'Registro: "Não calculado: sem metodologia própria".' },
    'location.streetId': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', evidence: 'Registro: "A planta só traz ruas projetadas".' },
    'location.streetName': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'MEDIUM', review: true, evidence: 'Sem nome oficial de rua no material (ruas projetadas).' },
    'location.distanceToAppM': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', evidence: 'Registro: "Não há APP delimitada no material recebido".' },
    'commercial.validFrom': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', evidence: 'commercial.json: priceTables[].validFrom = null explícito ("validade não informada").' },
    'commercial.validUntil': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', certainty: 'HIGH', evidence: 'commercial.json: priceTables[].validUntil = null explícito.' },
    'availability.updatedAt': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Sem espelho de vendas integrado (status UNKNOWN em todos os lotes).' },
    'availability.sourceId': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Idem.' },
    'availability.reason': { state: 'UNKNOWN', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Sem status não se sabe se há motivo; não é NOT_APPLICABLE.' },
    'availability.reservedUntil': { state: 'UNKNOWN', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Idem.' },
    'availability.proposalId': { state: 'UNKNOWN', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Idem.' },
    'availability.notes': { state: 'UNKNOWN', reason: 'SOURCE_NOT_INGESTED', certainty: 'HIGH', when: availabilityUnfed, evidence: 'Idem.' }
  });
  /** availability fields that only apply to some statuses (domain rule, topic 29) */
  const STATUS_SCOPED = Object.freeze({ 'availability.reservedUntil': ['RESERVED'], 'availability.proposalId': ['PROPOSAL', 'RESERVED', 'SOLD'] });
  // fields whose 0 is not a value (§121): price 0 is INVALID unless a policy says otherwise
  const NO_ZERO = new Set(['commercial.price', 'commercial.pricePerM2', 'geometry.areaM2', 'commercial.downPaymentDefaultValue']);
  // fields where 0 is a valid known value but worth a human look in the inventory (geometry measured from a drawing)
  const ZERO_REVIEW = new Set(['geometry.leftDepthM', 'geometry.rightDepthM', 'geometry.rearEdgesM', 'geometry.frontEdgesM', 'geometry.frontM', 'geometry.rearM']);
  // per-field sentinel mapping for enum codes that mean "no value" (never a global list, §139)
  const ENUM_UNKNOWN_SENTINEL = 'UNKNOWN';
  // enum fields where the code UNKNOWN is itself a value of another axis (freshness / confidence), not a missing datum
  const ENUM_UNKNOWN_IS_VALUE = new Set(['availability.freshness', 'intelligence.confidence', 'geometry.measurementConfidence']);
  const SENTINEL_REASON = Object.freeze({ 'geometry.shape': { state: 'UNKNOWN', reason: 'SOURCE_NOT_PROVIDED' }, 'surroundings.rearCondition': { state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED' }, 'availability.status': { state: 'UNKNOWN', reason: 'SOURCE_NOT_INGESTED' } });
  const freshnessDomainOf = key => key.startsWith('commercial.') ? 'commercial' : key.startsWith('availability.') ? 'availability' : null;
  const policyCache = new Map();
  /** fieldPolicy(attributePath) → FieldDataStatePolicy (derived from the Field Registry entry + the explicit tables above) */
  function fieldPolicy(key) {
    if (policyCache.has(key)) return policyCache.get(key);
    const f = M.field(key), type = f ? f.type : 'unknown', cls = NULL_CLASSIFICATION[key];
    const allowed = new Set(['KNOWN', 'UNKNOWN', 'CONFLICTED', 'INVALID', 'ERROR', 'PENDING']);
    if (cls) allowed.add(cls.state); if (f && f.status === 'NOT_APPLICABLE') allowed.add('NOT_APPLICABLE'); if (STATUS_SCOPED[key]) allowed.add('NOT_APPLICABLE');
    if (f && f.nullable) allowed.add('NOT_AVAILABLE'); if (type === 'array' || type === 'geometry') allowed.add('PARTIAL');
    if (SENTINEL_REASON[key]) allowed.add(SENTINEL_REASON[key].state);
    const p = Object.freeze({
      attributePath: key, fieldType: type, allowedStates: Object.freeze([...allowed]), nullRequiresExplicitState: true,
      allowKnownZero: type === 'number' && !NO_ZERO.has(key), allowKnownFalse: type === 'boolean', allowKnownEmptyString: false, allowKnownEmptyCollection: type === 'array',
      enumUnknownSentinel: !ENUM_UNKNOWN_IS_VALUE.has(key) && !!(f && f.enum && App.enums[f.enum] && App.enums[f.enum].UNKNOWN), defaultUnknownReason: 'LEGACY_UNCLASSIFIED',
      freshnessDomain: freshnessDomainOf(key), staleDisplayPolicy: 'SHOW_VALUE_WITH_WARNING', unknownDisplayPolicy: 'LABEL', filterUnknownPolicy: 'EXCLUDE',
      comparisonUnknownPolicy: 'NO_DATA', shareUnknownPolicy: freshnessDomainOf(key) ? 'SHOW_CAVEAT' : 'SHOW_LABEL', unknownSortPolicy: 'LAST',
      requiresReasonForStates: Object.freeze(['NOT_AVAILABLE', 'NOT_APPLICABLE', 'PENDING', 'CONFLICTED', 'INVALID', 'ERROR']), version: '1.0.0'
    });
    policyCache.set(key, p); return p;
  }
  /** FieldRegistry extension: policy ids by reference (§426) — the registry entry itself is not duplicated */
  const fieldRegistryRefs = key => Object.freeze({ dataStatePolicyId: `ds:${key}@1.0.0`, nullNormalizationPolicyId: 'legacy-lots-json@1', freshnessPolicyId: freshnessDomainOf(key) ? `fresh:${freshnessDomainOf(key)}` : 'fresh:none',
    unknownFilterPolicyId: 'filter-unknown:EXCLUDE', unknownSortPolicyId: 'sort-unknown:LAST', clientDisplayPolicyId: 'display:CLIENT' });
  /** DataStatePolicyValidator (§433) → { ok, errors, warnings } */
  function validatePolicy(p) {
    const errors = [], warnings = [], ok = Object.keys(S);
    for (const s of p.allowedStates || []) if (!ok.includes(s)) errors.push({ code: 'INVALID_STATE', state: s });
    if (p.allowKnownZero && p.fieldType && p.fieldType !== 'number') errors.push({ code: 'KNOWN_ZERO_FOR_NON_NUMBER', attributePath: p.attributePath });
    if (p.allowKnownFalse && p.fieldType && p.fieldType !== 'boolean') errors.push({ code: 'KNOWN_FALSE_FOR_NON_BOOLEAN', attributePath: p.attributePath });
    if (p.unknownDisplayPolicy === 'SHOW_VALUE') errors.push({ code: 'UNKNOWN_DISPLAY_SHOWS_VALUE', attributePath: p.attributePath });
    if (p.filterUnknownPolicy && !FilterUnknownPolicy[p.filterUnknownPolicy]) errors.push({ code: 'INVALID_FILTER_POLICY', attributePath: p.attributePath });
    const f = M.field(p.attributePath); if (f && !f.nullable && (p.allowedStates || []).includes('NOT_APPLICABLE') && f.status !== 'NOT_APPLICABLE') warnings.push({ code: 'NOT_APPLICABLE_ON_ALWAYS_APPLIES', attributePath: p.attributePath });
    for (const [k, m] of Object.entries(p.sentinelMappings || {})) { if (!S[m.canonicalState]) errors.push({ code: 'INVALID_SENTINEL_STATE', sentinel: k }); if (!REASONS[m.reasonCode]) errors.push({ code: 'UNKNOWN_REASON_CODE', sentinel: k }); }
    return { ok: !errors.length, errors, warnings };
  }

  // ------------------------------------------------------------------ raw layer: presence + NullNormalizationPolicy (§128–§147)
  const LEGACY_POLICY = Object.freeze({ sourceType: 'legacy-lots-json', fieldMappingId: 'LEGACY_FIELD_MAPPING@1', missingKeyBehavior: 'UNKNOWN:LEGACY_UNCLASSIFIED', explicitNullBehavior: 'UNKNOWN:LEGACY_UNCLASSIFIED',
    emptyStringBehavior: 'INVALID:VALIDATION_FAILED', parseErrorBehavior: 'INVALID:VALIDATION_FAILED', version: '1',
    // per raw field; '-' or 'N/A' are NOT global sentinels
    sentinelMappings: Object.freeze({ fech: Object.freeze({ 'Não informado – necessita confirmação': Object.freeze({ canonicalState: 'NOT_AVAILABLE', reasonCode: 'SOURCE_NOT_PROVIDED' }) }),
      st: Object.freeze({}) }),
    nullMappings: Object.freeze({ st: Object.freeze({ canonicalState: 'UNKNOWN', reasonCode: 'SOURCE_NOT_INGESTED' }) }) });
  const splitB = s => { const [a, b] = String(s).split(':'); return { canonicalState: a, reasonCode: b }; };
  /** observeRaw(obj, rawFieldName, { sourceRef, policy }) → RawFieldObservation */
  function observeRaw(obj, name, o = {}) {
    const has = obj != null && Object.prototype.hasOwnProperty.call(obj, name), v = has ? obj[name] : undefined, pol = o.policy || LEGACY_POLICY;
    const sentinels = (pol.sentinelMappings || {})[name] || {};
    const presence = !has ? 'MISSING_KEY' : v === null ? 'NULL_VALUE' : v === '' ? 'EMPTY_STRING' : typeof v === 'string' && Object.prototype.hasOwnProperty.call(sentinels, v) ? 'SENTINEL' : (typeof v === 'number' && !Number.isFinite(v)) ? 'PARSE_ERROR' : 'PRESENT';
    return Object.freeze({ rawValue: has ? v : undefined, rawPresenceState: presence, rawFieldName: name, sourceRef: o.sourceRef || pol.sourceType, observedAt: o.observedAt || null });
  }
  /** normalizeObservation(raw, { policy, parse }) → NormalizedFieldObservation (+ raw) — state decided at import, never rebuilt later */
  function normalizeObservation(raw, o = {}) {
    const pol = o.policy || LEGACY_POLICY, name = raw.rawFieldName; let out;
    switch (raw.rawPresenceState) {
      case 'PRESENT': { let val = raw.rawValue, st = 'KNOWN', reason;
        if (o.parse) { try { val = o.parse(raw.rawValue); } catch (e) { val = null; st = 'INVALID'; reason = 'VALIDATION_FAILED'; } }
        out = { canonicalValue: val, canonicalDataState: st, reasonCode: reason }; break; }
      case 'SENTINEL': { const m = pol.sentinelMappings[name][raw.rawValue]; out = { canonicalValue: null, canonicalDataState: m.canonicalState, reasonCode: m.reasonCode }; break; }
      case 'NULL_VALUE': { const m = (pol.nullMappings || {})[name] || splitB(pol.explicitNullBehavior); out = { canonicalValue: null, canonicalDataState: m.canonicalState, reasonCode: m.reasonCode }; break; }
      case 'MISSING_KEY': out = { canonicalValue: null, ...splitB(pol.missingKeyBehavior) }; out.canonicalDataState = out.canonicalState; delete out.canonicalState; break;
      case 'EMPTY_STRING': { const b = splitB(pol.emptyStringBehavior); out = b.canonicalState === 'KNOWN' ? { canonicalValue: '', canonicalDataState: 'KNOWN' } : { canonicalValue: null, canonicalDataState: b.canonicalState, reasonCode: b.reasonCode }; break; }
      default: { const b = splitB(pol.parseErrorBehavior); out = { canonicalValue: null, canonicalDataState: b.canonicalState, reasonCode: b.reasonCode }; }
    }
    return Object.freeze({ ...raw, ...out, policyVersion: pol.version });
  }

  // ------------------------------------------------------------------ fingerprint + records + invariant validator
  const stable = v => v == null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  function fingerprint(v) { const s = stable(v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  let seq = 0;
  /** createRecord(fields) → AttributeDataStateRecord (sidecar; the entity stays typed and clean) */
  function createRecord(r) {
    return Object.freeze({ id: r.id || `dsr_${(++seq).toString(36)}_${fingerprint([r.entityId, r.attributePath, r.canonicalState, r.recordedAt])}`, organizationId: r.organizationId, developmentId: r.developmentId || null,
      entityType: r.entityType || 'LOT', entityId: r.entityId, attributePath: r.attributePath, canonicalState: r.canonicalState, reasonCode: r.reasonCode || null,
      valueFingerprint: r.valueFingerprint || null, dataVersionRef: r.dataVersionRef || null, completeness: r.completeness || null, freshness: r.freshness || null,
      asOf: r.asOf || null, recordedAt: r.recordedAt || new Date().toISOString(), sourceRef: r.sourceRef || null, metadata: r.metadata ? Object.freeze({ ...r.metadata }) : null });
  }
  const isNullish = v => v === null || v === undefined;
  /** validateState(value, state, { attributePath, reasonCode, record }) → { ok, errors, warnings } (DataStateInvariantValidator) */
  function validateState(value, state, o = {}) {
    const errors = [], warnings = [], p = o.attributePath ? fieldPolicy(o.attributePath) : null, e = code => errors.push({ code, attributePath: o.attributePath || null, state });
    if (!state) { e(isNullish(value) ? 'DATA_STATE_MISSING' : 'DATA_STATE_MISSING'); return { ok: false, errors, warnings }; }
    if (!S[state]) { e('UNKNOWN_STATE'); return { ok: false, errors, warnings }; }
    if (p && !p.allowedStates.includes(state)) e('STATE_NOT_ALLOWED_FOR_FIELD');
    if (o.reasonCode && !REASONS[o.reasonCode]) e('UNKNOWN_REASON_CODE');
    else if (o.reasonCode && !REASONS[o.reasonCode].allowedStates.includes(state)) e('STATE_NOT_ALLOWED_FOR_FIELD');
    if (p && p.requiresReasonForStates.includes(state) && !o.reasonCode) e('REASON_REQUIRED');
    if (state === 'KNOWN') {
      if (isNullish(value)) e('KNOWN_VALUE_MISSING');
      else if (p && value === 0 && !p.allowKnownZero && p.fieldType === 'number') e('KNOWN_VALUE_MISSING');
      else if (p && value === '' && !p.allowKnownEmptyString) e('KNOWN_VALUE_MISSING');
      else if (p && Array.isArray(value) && !value.length && !p.allowKnownEmptyCollection) e('KNOWN_VALUE_MISSING');
      if (p && value === 0 && ZERO_REVIEW.has(p.attributePath)) warnings.push({ code: 'ZERO_REQUIRES_REVIEW', attributePath: p.attributePath });
    }
    if (state === 'UNKNOWN' && !isNullish(value)) e('UNKNOWN_WITH_OPERATIONAL_VALUE');
    if (state === 'NOT_AVAILABLE' && !isNullish(value)) e('UNKNOWN_WITH_OPERATIONAL_VALUE');
    if (state === 'NOT_APPLICABLE' && !isNullish(value)) e('NOT_APPLICABLE_WITH_VALUE');
    if (state === 'CONFLICTED' && !isNullish(value)) e('CONFLICTED_WITH_UNRESOLVED_OPERATIONAL_VALUE');
    if ((state === 'INVALID' || state === 'ERROR') && !isNullish(value)) e('INVALID_WITH_OPERATIONAL_VALUE');
    if (state === 'PARTIAL') warnings.push({ code: 'PARTIAL_COMPOSITE_VALUE', attributePath: o.attributePath || null });
    if (state === 'UNKNOWN' && o.reasonCode === 'LEGACY_UNCLASSIFIED') warnings.push({ code: 'LEGACY_UNCLASSIFIED_NULL', attributePath: o.attributePath || null });
    if (o.record && o.record.valueFingerprint && !isNullish(value) && o.record.valueFingerprint !== fingerprint(value)) e('VALUE_STATE_FINGERPRINT_MISMATCH');
    return { ok: !errors.length, errors, warnings };
  }

  // ------------------------------------------------------------------ AttributeDataStateIndex (organization → entity → attributePath → record)
  /** createIndex(organizationId) — every read/write is tenant-checked; cross-tenant → DENY (§469–§472) */
  function createIndex(organizationId) {
    if (!organizationId) throw new Error('organizationId obrigatório');
    const byEntity = new Map(), history = [];
    const key = (type, id) => `${type}|${id}`;
    function put(rec) {
      if (rec.organizationId !== organizationId) return { ok: false, code: 'TENANT_MISMATCH' };
      const k = key(rec.entityType || 'LOT', rec.entityId), m = byEntity.get(k) || new Map(), prev = m.get(rec.attributePath) || null;
      m.set(rec.attributePath, rec); byEntity.set(k, m);
      const ev = prev && prev.canonicalState === rec.canonicalState && prev.reasonCode === rec.reasonCode ? null : transitionEvent(prev, rec);
      if (ev) history.push(ev);
      return { ok: true, record: rec, transition: ev };
    }
    const get = (entityId, path, { organizationId: org = organizationId, entityType = 'LOT' } = {}) => org !== organizationId ? { denied: true, code: 'TENANT_MISMATCH' } : ((byEntity.get(key(entityType, entityId)) || new Map()).get(path) || null);
    return Object.freeze({ organizationId, put, get, size: () => [...byEntity.values()].reduce((n, m) => n + m.size, 0), transitions: () => history.slice(),
      entries: () => [...byEntity.values()].flatMap(m => [...m.values()]) });
  }
  /** DataStateTransitionEvent (domain/version changes only; never UI loading) */
  const transitionEvent = (prev, rec) => Object.freeze({ organizationId: rec.organizationId, developmentId: rec.developmentId, entityType: rec.entityType, entityId: rec.entityId, attributePath: rec.attributePath,
    fromState: prev ? prev.canonicalState : null, toState: rec.canonicalState, fromReasonCode: prev ? prev.reasonCode : null, toReasonCode: rec.reasonCode, dataVersionRef: rec.dataVersionRef, occurredAt: rec.recordedAt });

  // ------------------------------------------------------------------ freshness + specialized adapters (pricing, availability)
  const LEGACY_FRESHNESS = Object.freeze({ FRESH: 'CURRENT', STALE: 'STALE', EXPIRED: 'EXPIRED', UNKNOWN: 'UNKNOWN' });
  function freshnessOf(lot, key, o = {}) {
    const d = freshnessDomainOf(key); if (!d) return 'NOT_APPLICABLE';
    const raw = (o.freshness && o.freshness[d]) || (lot && lot.metadata && lot.metadata.freshness && lot.metadata.freshness[d]);
    return LEGACY_FRESHNESS[raw] || 'UNKNOWN';
  }
  /** DataStateAdapter for prices (§293): a missing price is never R$ 0; why it is missing is said when known */
  const pricingAdapter = Object.freeze({ id: 'pricing', supports: (t, p) => t === 'LOT' && /^commercial\.(price|pricePerM2|downPaymentDefaultValue)$/.test(p),
    resolveState({ lot, attributePath, value }) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { canonicalState: 'KNOWN' };
      if (typeof value === 'number') return { canonicalState: 'INVALID', reasonCode: 'VALIDATION_FAILED', value: null };
      const c = lot && lot.commercial;
      if (c && c.conflict) return { canonicalState: 'CONFLICTED', reasonCode: 'CONFLICT_UNRESOLVED' };
      if (c && c.onRequest) return { canonicalState: 'NOT_AVAILABLE', reasonCode: 'SOURCE_NOT_PROVIDED' };
      if (!c || !c.priceTableId) return { canonicalState: 'NOT_AVAILABLE', reasonCode: 'SOURCE_NOT_PROVIDED' };
      if (attributePath === 'commercial.price' && M.get(lot, 'geometry.areaM2') == null) return { canonicalState: 'NOT_AVAILABLE', reasonCode: 'MISSING_REQUIRED_INPUT' };
      return { canonicalState: 'UNKNOWN', reasonCode: 'UNKNOWN_REASON' };
    } });
  /** DataStateAdapter for availability (§294): the commercial status stays the value; this only says whether it is known */
  const availabilityAdapter = Object.freeze({ id: 'availability', supports: (t, p) => t === 'LOT' && p === 'availability.status',
    resolveState({ lot, value }) {
      const ds = lot && lot.availability && lot.availability.dataState;
      if (ds === 'CONFLICTED') return { canonicalState: 'CONFLICTED', reasonCode: 'CONFLICT_UNRESOLVED', value: null };
      if (value == null || value === 'UNKNOWN') return { canonicalState: 'UNKNOWN', reasonCode: 'SOURCE_NOT_INGESTED', value: null };
      return { canonicalState: 'KNOWN' };
    } });
  const ADAPTERS = [pricingAdapter, availabilityAdapter];

  // ------------------------------------------------------------------ DataStateResolutionService / AttributeValueResolver
  /** canonicalStateOf(lot, key, o) → { value, canonicalState, reasonCode, completeness, warnings, classification } — user-independent */
  function canonicalStateOf(lot, key, o = {}) {
    const p = fieldPolicy(key), stored = M.get(lot, key), lotId = lot && lot.identity && lot.identity.id;
    const rec = o.index ? o.index.get(lotId, key, { organizationId: o.organizationId || o.index.organizationId }) : null;
    if (rec && rec.denied) return { value: null, canonicalState: 'ERROR', reasonCode: 'PROCESSING_FAILED', denied: true };
    if (rec) { // explicit state record wins (pending / conflicted / invalid … set by imports or reviews)
      const opVal = rec.canonicalState === 'KNOWN' || rec.canonicalState === 'PARTIAL' ? (stored === undefined ? null : stored) : null;
      return { value: opVal, canonicalState: rec.canonicalState, reasonCode: rec.reasonCode, completeness: rec.completeness, record: rec, freshnessOverride: rec.freshness };
    }
    const ad = ADAPTERS.find(a => a.supports('LOT', key));
    if (ad) { const r = ad.resolveState({ lot, attributePath: key, value: stored }); return { value: 'value' in r ? r.value : (r.canonicalState === 'KNOWN' ? stored : null), canonicalState: r.canonicalState, reasonCode: r.reasonCode || null, adapter: ad.id }; }
    if (stored === undefined || stored === null) {
      const scoped = STATUS_SCOPED[key], status = M.get(lot, 'availability.status');
      if (scoped && status && status !== 'UNKNOWN' && !scoped.includes(status)) return { value: null, canonicalState: 'NOT_APPLICABLE', reasonCode: 'NOT_APPLICABLE_BY_DOMAIN' };
      const c = NULL_CLASSIFICATION[key];
      if (c && (!c.when || c.when(lot))) return { value: null, canonicalState: c.state, reasonCode: c.reason, classification: c };
      return { value: null, canonicalState: 'UNKNOWN', reasonCode: 'LEGACY_UNCLASSIFIED' };
    }
    if (p.enumUnknownSentinel && stored === ENUM_UNKNOWN_SENTINEL) { const m = SENTINEL_REASON[key]; return { value: null, canonicalState: m ? m.state : 'UNKNOWN', reasonCode: m ? m.reason : 'LEGACY_UNCLASSIFIED', sentinel: stored }; }
    if (stored === '' && !p.allowKnownEmptyString) return { value: null, canonicalState: 'INVALID', reasonCode: 'VALIDATION_FAILED' };
    if (stored === 0 && p.fieldType === 'number' && !p.allowKnownZero) return { value: null, canonicalState: 'INVALID', reasonCode: 'VALIDATION_FAILED' };
    if (typeof stored === 'number' && !Number.isFinite(stored)) return { value: null, canonicalState: 'INVALID', reasonCode: 'VALIDATION_FAILED' };
    const completeness = Array.isArray(stored) ? (stored.length ? 'COMPLETE' : 'EMPTY') : undefined;
    return { value: stored, canonicalState: 'KNOWN', reasonCode: null, completeness };
  }
  /** defaultAccess(mode) — access policy by audience; the real decision comes from the security layer when given (o.access) */
  const CLIENT_HIDDEN = new Set(['availability.notes', 'availability.sourceId', 'availability.proposalId', 'availability.revision']);
  const accessOf = (key, o) => { if (typeof o.access === 'function') return o.access(key) || 'FULL'; if (o.access && o.access[key]) return o.access[key]; return modeOf(o.mode) === 'CLIENT' && CLIENT_HIDDEN.has(key) ? 'HIDDEN' : 'FULL'; };
  /** resolve(lot, attributePath, opts) → ResolvedAttributeValue | null (null = HIDDEN: the field does not exist for this viewer)
      opts = { mode: CLIENT|BROKER|TECHNICAL|client|broker|…, access, index, organizationId, freshness, offline, provenance:true, confidence } */
  function resolve(lot, key, o = {}) {
    const c = canonicalStateOf(lot, key, o), access = accessOf(key, o);
    if (access === 'HIDDEN') return o.keepHidden ? Object.freeze({ attributePath: key, value: null, canonicalState: null, projectedState: 'HIDDEN', freshness: null, display: hiddenDisplay() }) : null;
    const freshness = c.canonicalState === 'KNOWN' || c.canonicalState === 'PARTIAL' ? (c.freshnessOverride || freshnessOf(lot, key, o)) : (freshnessDomainOf(key) ? (c.freshnessOverride || 'UNKNOWN') : 'NOT_APPLICABLE');
    const restricted = access === 'REDACTED';
    const projected = restricted ? 'RESTRICTED' : c.canonicalState;
    const prov = o.provenance && M.getFieldProvenance ? M.getFieldProvenance(lot, key) : null;
    const out = {
      attributePath: key, value: restricted ? null : c.value, canonicalState: restricted && o.revealCanonicalWhenRestricted !== true ? null : c.canonicalState, projectedState: projected,
      reasonCode: restricted ? null : (c.reasonCode || undefined), freshness: restricted ? null : freshness, completeness: c.completeness, access,
      provenanceSummary: prov && !restricted ? Object.freeze({ status: prov.status, sourceId: prov.sourceId, method: prov.method }) : undefined,
      confidenceSummary: prov && !restricted && prov.confidence ? Object.freeze({ level: prov.confidence }) : undefined,
      dataVersionRef: lot && lot.metadata ? lot.metadata.dataVersions || undefined : undefined, connectivity: o.offline ? Object.freeze({ offline: true }) : undefined
    };
    out.display = display(out, o);
    return Object.freeze(out);
  }
  /** resolveMany(lot, keys, opts) → { [key]: ResolvedAttributeValue } (HIDDEN keys absent) */
  function resolveMany(lot, keys, o = {}) { const r = {}; for (const k of keys) { const v = resolve(lot, k, o); if (v) r[k] = v; } return r; }
  /** helpers that never look at truthiness (§127) */
  const isKnownValue = r => !!r && (r.projectedState === 'KNOWN' || r.projectedState === 'PARTIAL') && r.value !== null && r.value !== undefined;
  const isUsable = r => isKnownValue(r) && r.freshness !== 'EXPIRED';

  // ------------------------------------------------------------------ display projection (AttributeDisplayProjection)
  const hiddenDisplay = () => Object.freeze({ primaryText: '', stateLabel: null, showValue: false, showReason: false, semanticToken: 'ds-hidden', iconToken: null, ariaText: '', actionIds: [] });
  /** display(resolved, { mode, format, label, compact }) — pt-BR text; format(value) is the field formatter (App.fmt …) */
  function display(r, o = {}) {
    const mode = modeOf(o.mode), pol = DISPLAY_POLICIES[mode], st = r.projectedState, fmt = o.format || defaultFormat(r.attributePath);
    if (st === 'HIDDEN') return hiddenDisplay();
    const known = st === 'KNOWN' || (st === 'PARTIAL' && r.value != null);
    const stateLabel = known && st === 'KNOWN' ? null : (o.compact ? COMPACT[mode] : pol.labels[st]);
    const fr = known ? FRESHNESS_TEXT[r.freshness] : null;
    const reason = !known && r.reasonCode && REASONS[r.reasonCode] ? REASONS[r.reasonCode] : null;
    const secondaryText = fr ? fr[mode] : (reason && mode !== 'CLIENT' ? (mode === 'TECHNICAL' ? `${r.canonicalState} / ${r.reasonCode}` : reason.labels.BROKER) : (mode === 'CLIENT' && reason && st !== 'NOT_APPLICABLE' && st !== 'PENDING' ? null : undefined));
    const primaryText = known ? fmt(r.value) : stateLabel;
    const actions = !known ? (st === 'CONFLICTED' ? pol.conflictedActionIds : st === 'NOT_APPLICABLE' ? [] : pol.unknownActionIds) : fr ? pol.staleActionIds : [];
    const label = o.label || (M.field(r.attributePath) || {}).label || r.attributePath;
    const ariaText = `${label}: ${known ? primaryText : String(stateLabel).toLowerCase()}${fr ? '. Informação desatualizada; confirmar condição atual' : ''}.`;
    return Object.freeze({ primaryText, secondaryText: secondaryText || undefined, stateLabel: stateLabel || (fr ? fr[mode] : null), iconToken: known ? (fr ? 'clock' : null) : ICON[st] || null,
      semanticToken: known ? (fr ? 'ds-stale' : 'ds-known') : SEMANTIC_TOKEN[st], showValue: known, showReason: !known && (mode !== 'CLIENT' || pol.showReasonCodes) && !!reason, actionIds: (actions || []).slice(), ariaText });
  }
  function defaultFormat(key) {
    const F = App.fmt, f = M.field(key) || {};
    return v => {
      if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
      if (Array.isArray(v)) return v.length ? v.map(x => typeof x === 'object' ? (x.label || x.type || JSON.stringify(x)) : (f.enum ? App.i18n.t(f.enum, x, x) : x)).join(', ') : 'Nenhum';
      if (typeof v === 'number') { if (f.unit === 'BRL') return F.formatBRL(v); if (f.unit === 'BRL/m²') return F.formatPricePerM2(v); if (f.unit === 'm²') return F.formatSquareMeters(v); if (f.unit === 'm') return F.formatMeters(v, 1); return F.number(v, Number.isInteger(v) ? 0 : 1); }
      if (f.enum && App.i18n) return App.i18n.t(f.enum, v, String(v));
      return String(v);
    };
  }
  /** UiLoadState is kept beside the resolved value, never inside it: withLoad returns a view pair (§46–§50) */
  const withLoad = (resolved, uiLoadState) => Object.freeze({ resolved, uiLoadState: UiLoadState[uiLoadState] || 'NOT_REQUESTED', skeleton: uiLoadState === 'LOADING', loadMessage: uiLoadState === 'FAILED' ? 'Não foi possível carregar agora.' : null });

  // ------------------------------------------------------------------ filters, constraints, sort, comparison, rules (§199–§262, §394–§402)
  /** evaluateRange(resolved, { min, max }) → FilterEvaluation — unknown is UNKNOWN, never 0 */
  function evaluateRange(r, { min = null, max = null } = {}) {
    if (!r) return 'UNKNOWN';
    if (r.projectedState === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
    if (r.projectedState === 'ERROR') return 'ERROR';
    if (!isKnownValue(r) || typeof r.value !== 'number') return 'UNKNOWN';
    return (min == null || r.value >= min) && (max == null || r.value <= max) ? 'MATCH' : 'NO_MATCH';
  }
  /** evaluateEquals(resolved, expected) → FilterEvaluation (booleans/enums; unknown is never false) */
  function evaluateEquals(r, expected) {
    if (!r) return 'UNKNOWN'; if (r.projectedState === 'NOT_APPLICABLE') return 'NOT_APPLICABLE'; if (r.projectedState === 'ERROR') return 'ERROR';
    if (!isKnownValue(r)) return 'UNKNOWN';
    return Array.isArray(expected) ? (expected.includes(r.value) ? 'MATCH' : 'NO_MATCH') : r.value === expected ? 'MATCH' : 'NO_MATCH';
  }
  /** applyFilterPolicy(evaluation, policy) → { included, warning, bucket } — the reason (UNKNOWN) is kept for diagnostics */
  function applyFilterPolicy(ev, policy = 'EXCLUDE') {
    if (ev === 'MATCH') return { included: true, evaluation: ev, warning: false, bucket: 'MATCH' };
    if (ev === 'NO_MATCH' || ev === 'ERROR') return { included: false, evaluation: ev, warning: false, bucket: ev };
    if (policy === 'INCLUDE') return { included: true, evaluation: ev, warning: false, bucket: 'MATCH' };
    if (policy === 'INCLUDE_WITH_WARNING') return { included: true, evaluation: ev, warning: true, bucket: 'MATCH' };
    if (policy === 'SEPARATE_BUCKET') return { included: false, evaluation: ev, warning: false, bucket: 'SEM_DADO' };
    return { included: false, evaluation: ev, warning: false, bucket: ev };
  }
  /** facetCounts(resolvedList) → { known, unknown, notAvailable, notApplicable, conflicted, pending, invalid, error, partial, restricted, total } — nothing disappears */
  function facetCounts(list) {
    const c = { total: 0, known: 0, unknown: 0, notAvailable: 0, notApplicable: 0, conflicted: 0, pending: 0, invalid: 0, error: 0, partial: 0, restricted: 0 };
    const K = { KNOWN: 'known', UNKNOWN: 'unknown', NOT_AVAILABLE: 'notAvailable', NOT_APPLICABLE: 'notApplicable', CONFLICTED: 'conflicted', PENDING: 'pending', INVALID: 'invalid', ERROR: 'error', PARTIAL: 'partial', RESTRICTED: 'restricted' };
    for (const r of list) { if (!r || r.projectedState === 'HIDDEN') continue; c.total++; c[K[r.projectedState]]++; } // HIDDEN never counted (no leak)
    return c;
  }
  /** evaluateConstraint(resolved, operator, expected) → PASS | FAIL | UNKNOWN | NOT_APPLICABLE | ERROR (topic 15 semantics; policy decides afterwards) */
  function evaluateConstraint(r, op, expected) {
    if (!r || r.projectedState === 'RESTRICTED') return 'UNKNOWN';
    if (r.projectedState === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
    if (r.projectedState === 'ERROR') return 'ERROR';
    if (!isKnownValue(r)) return 'UNKNOWN';
    const v = r.value, ok = { '>=': v >= expected, '<=': v <= expected, '>': v > expected, '<': v < expected, '==': v === expected, '!=': v !== expected, IN: Array.isArray(expected) && expected.includes(v) }[op];
    return ok === undefined ? 'ERROR' : ok ? 'PASS' : 'FAIL';
  }
  /** toRuleOperand(resolved) → RuleOperandEvaluation { status, value } — UNKNOWN propagates, never literal null (§259–§261) */
  const toRuleOperand = r => !r ? Object.freeze({ status: 'UNKNOWN', value: null, dataState: 'HIDDEN' }) : isKnownValue(r) ? Object.freeze({ status: 'KNOWN', value: r.value, dataState: r.projectedState, freshness: r.freshness })
    : Object.freeze({ status: r.projectedState === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : r.projectedState === 'ERROR' ? 'ERROR' : 'UNKNOWN', value: null, dataState: r.projectedState, reasonCode: r.reasonCode || null });
  /** comparator(dir, { unknown: LAST|FIRST, tieBreaker }) over items { resolved, id } — no numeric sentinel (no ±Infinity) */
  function comparator(dir = 'asc', o = {}) {
    const policy = o.unknown || 'LAST', tb = o.tieBreaker || ((a, b) => String(a.id).localeCompare(String(b.id), 'pt-BR', { numeric: true })), sgn = dir === 'desc' ? -1 : 1;
    return (a, b) => {
      const ka = isKnownValue(a.resolved), kb = isKnownValue(b.resolved);
      if (ka && kb) { const d = a.resolved.value < b.resolved.value ? -1 : a.resolved.value > b.resolved.value ? 1 : 0; return d ? d * sgn : tb(a, b); }
      if (ka !== kb) { if (policy === 'ERROR') throw new Error('UNKNOWN_SORT_VALUE'); return (ka ? -1 : 1) * (policy === 'FIRST' ? -1 : 1); }
      return tb(a, b);
    };
  }
  /** sortWithUnknown(items, dir, opts) → { known: [], unknown: [] } when SEPARATE, otherwise a sorted copy */
  function sortWithUnknown(items, dir, o = {}) {
    if (o.unknown === 'SEPARATE') { const known = items.filter(i => isKnownValue(i.resolved)).sort(comparator(dir, { ...o, unknown: 'LAST' })), unknown = items.filter(i => !isKnownValue(i.resolved)).sort(comparator(dir, { ...o, unknown: 'LAST' })); return { known, unknown }; }
    return items.slice().sort(comparator(dir, o));
  }
  /** comparability(resolvedList, { minValid }) → { status: COMPARABLE | INSUFFICIENT_DATA, validCount, noDataIds } — unknown never wins/loses numerically */
  function comparability(entries, { minValid = 2 } = {}) {
    const valid = entries.filter(e => isUsable(e.resolved)), noData = entries.filter(e => !isUsable(e.resolved)).map(e => e.id);
    return Object.freeze({ status: valid.length >= minValid ? 'COMPARABLE' : 'INSUFFICIENT_DATA', validCount: valid.length, noDataIds: Object.freeze(noData) });
  }
  /** toComparisonValueStatus(resolved) → topic 24 ValueStatus (VALID | NO_DATA | UNKNOWN | NOT_APPLICABLE | CONFLICTED | ERROR) */
  const toComparisonValueStatus = r => !r ? 'NO_DATA' : isKnownValue(r) ? 'VALID' : ({ UNKNOWN: 'UNKNOWN', NOT_AVAILABLE: 'NO_DATA', NOT_APPLICABLE: 'NOT_APPLICABLE', CONFLICTED: 'CONFLICTED', ERROR: 'ERROR', INVALID: 'ERROR', PENDING: 'NO_DATA', RESTRICTED: 'NO_DATA', PARTIAL: 'NO_DATA' })[r.projectedState] || 'NO_DATA';

  // ------------------------------------------------------------------ derived values (§181–§190)
  /** derive(inputs: { name: resolved }, fn, DerivedStatePolicy) → AnalysisOutput — a missing input is never replaced by 0 */
  const DEFAULT_DERIVED_POLICY = Object.freeze({ requiredInputStatesAllowed: ['KNOWN'], onRequiredUnknown: 'NOT_AVAILABLE', onRequiredConflict: 'NOT_AVAILABLE', onRequiredInvalid: 'NOT_AVAILABLE', onOptionalMissing: 'IGNORE', version: '1.0.0' });
  function derive(inputs, fn, policy = DEFAULT_DERIVED_POLICY, o = {}) {
    const trace = { policyVersion: policy.version, inputs: {} };
    for (const [k, r] of Object.entries(inputs)) {
      trace.inputs[k] = r ? r.projectedState : 'HIDDEN';
      if (isKnownValue(r) && policy.requiredInputStatesAllowed.includes(r.projectedState)) continue;
      if ((o.optional || []).includes(k)) continue;
      const st = !r || r.projectedState === 'UNKNOWN' || r.projectedState === 'NOT_AVAILABLE' || r.projectedState === 'RESTRICTED' ? policy.onRequiredUnknown : r.projectedState === 'CONFLICTED' ? policy.onRequiredConflict : policy.onRequiredInvalid;
      return Object.freeze({ value: null, dataState: st, reasonCode: 'MISSING_REQUIRED_INPUT', trace: Object.freeze({ ...trace, blockedBy: k }) });
    }
    try { const v = fn(Object.fromEntries(Object.entries(inputs).map(([k, r]) => [k, isKnownValue(r) ? r.value : null]))); if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return Object.freeze({ value: null, dataState: 'ERROR', reasonCode: 'PROCESSING_FAILED', trace: Object.freeze(trace) }); return Object.freeze({ value: v, dataState: 'KNOWN', trace: Object.freeze(trace) }); }
    catch (e) { return Object.freeze({ value: null, dataState: 'ERROR', reasonCode: 'PROCESSING_FAILED', trace: Object.freeze(trace) }); }
  }

  // ------------------------------------------------------------------ share / export / API DTO / map (§248–§281, §403–§408, §214–§223)
  const DEFAULT_SHARE_POLICY = Object.freeze({ unknownBehavior: 'SHOW_LABEL', notAvailableBehavior: 'SHOW_LABEL', notApplicableBehavior: 'OMIT', conflictedBehavior: 'SHOW_WARNING', staleBehavior: 'ALLOW_WITH_CAVEAT' });
  const CRITICAL_SHARE_POLICY = Object.freeze({ unknownBehavior: 'SHOW_CAVEAT', notAvailableBehavior: 'SHOW_LABEL', notApplicableBehavior: 'OMIT', conflictedBehavior: 'BLOCK_SHARE', staleBehavior: 'ALLOW_WITH_CAVEAT' });
  /** shareLine(label, resolved, { policy, format }) → { text | null, blocked } — client-safe text, never a false claim ("Recuo frontal: 0 m") */
  function shareLine(label, r, o = {}) {
    const key = r && r.attributePath, pol = o.policy || (key && freshnessDomainOf(key) ? CRITICAL_SHARE_POLICY : DEFAULT_SHARE_POLICY);
    if (!r || r.projectedState === 'HIDDEN' || r.projectedState === 'RESTRICTED') return { text: null, blocked: false };
    const fmt = o.format || defaultFormat(key);
    if (isKnownValue(r)) {
      if (r.freshness === 'STALE' || r.freshness === 'EXPIRED') { if (pol.staleBehavior === 'BLOCK') return { text: null, blocked: true }; return { text: `${label}: ${fmt(r.value)}${pol.staleBehavior === 'ALLOW_WITH_CAVEAT' ? ' (confirmar condição atual)' : ''}`, blocked: false }; }
      return { text: `${label}: ${fmt(r.value)}`, blocked: false };
    }
    const st = r.projectedState;
    if (st === 'NOT_APPLICABLE') return pol.notApplicableBehavior === 'OMIT' ? { text: null, blocked: false } : { text: `${label}: não se aplica`, blocked: false };
    if (st === 'CONFLICTED') return pol.conflictedBehavior === 'BLOCK_SHARE' ? { text: null, blocked: true } : pol.conflictedBehavior === 'OMIT' ? { text: null, blocked: false } : { text: `${label}: informação a confirmar`, blocked: false };
    const b = st === 'NOT_AVAILABLE' ? pol.notAvailableBehavior : pol.unknownBehavior;
    if (b === 'OMIT') return { text: null, blocked: false };
    return { text: `${label}: informação ainda não disponível${b === 'SHOW_CAVEAT' ? ' — confirmar com o corretor' : ''}`, blocked: false };
  }
  /** exportCells(resolved, { technical }) → technical: { value, state, reason } (machine codes) · client: { value: text } */
  function exportCells(r, o = {}) {
    if (!r) return o.technical ? null : null;
    if (o.technical) return { value: isKnownValue(r) ? r.value : '', state: r.projectedState, reason: r.reasonCode || '', freshness: r.freshness || '' };
    return { value: r.display ? (r.display.showValue ? r.display.primaryText : r.display.stateLabel) : '' };
  }
  /** toDto(resolved, detailLevel) → AttributeValueDto | undefined (HIDDEN → field omitted) — never an ambiguous null */
  function toDto(r, level = 'SUMMARY') {
    if (!r || r.projectedState === 'HIDDEN') return undefined;
    if (r.projectedState === 'RESTRICTED') return Object.freeze({ attributePath: r.attributePath, value: null, projectedState: 'RESTRICTED' });
    const base = { attributePath: r.attributePath, value: r.value === undefined ? null : r.value, state: r.projectedState };
    if (level === 'VALUE_ONLY') return Object.freeze(base);
    Object.assign(base, r.reasonCode ? { reasonCode: r.reasonCode } : {}, r.freshness ? { freshness: r.freshness } : {}, r.completeness ? { completeness: r.completeness } : {});
    if (level === 'TECHNICAL') Object.assign(base, { canonicalState: r.canonicalState, provenanceSummary: r.provenanceSummary || null, confidenceSummary: r.confidenceSummary || null, dataVersionRef: r.dataVersionRef || null });
    return Object.freeze(base);
  }
  /** MapNoDataStyle: neutral, distinguishable (pattern + legend text), never the lowest bucket */
  const MAP_NO_DATA_STYLE = Object.freeze({ UNKNOWN: { token: 'map-nodata', pattern: 'hatch', legend: 'Sem dado' }, NOT_AVAILABLE: { token: 'map-nodata', pattern: 'hatch', legend: 'Sem dado' },
    NOT_APPLICABLE: { token: 'map-na', pattern: 'none', legend: 'Não se aplica' }, CONFLICTED: { token: 'map-conflict', pattern: 'cross', legend: 'Dados divergentes' },
    PENDING: { token: 'map-nodata', pattern: 'dots', legend: 'Em atualização' }, INVALID: { token: 'map-conflict', pattern: 'cross', legend: 'Dado inválido' }, ERROR: { token: 'map-nodata', pattern: 'hatch', legend: 'Sem dado' },
    RESTRICTED: { token: 'map-nodata', pattern: 'hatch', legend: 'Sem dado' } });
  /** mapBucket(resolved, binOf) → { bucket, style } — binOf(value) for known values only */
  const mapBucket = (r, binOf) => isKnownValue(r) ? { bucket: binOf(r.value), style: null, noData: false } : { bucket: null, style: MAP_NO_DATA_STYLE[r ? r.projectedState : 'UNKNOWN'] || MAP_NO_DATA_STYLE.UNKNOWN, noData: true };
  /** legendCounts(resolvedList) → { withData, noData, conflicted, notApplicable } */
  function legendCounts(list) { const f = facetCounts(list); return { withData: f.known + f.partial, noData: f.unknown + f.notAvailable + f.pending + f.error + f.invalid + f.restricted, conflicted: f.conflicted, notApplicable: f.notApplicable }; }
  /** cacheKey — canonical results can be shared inside a tenant; projected ones carry the audience/permission scope */
  const cacheKey = ({ organizationId, developmentId, entityId, attributePath, dataVersionRef, projectionScope }) => [organizationId, developmentId, entityId, attributePath, fingerprint(dataVersionRef || null), projectionScope ? 'proj:' + projectionScope : 'canonical'].join('|');

  // ------------------------------------------------------------------ diagnostics, coverage, legacy inventory, impact report (§319–§364)
  const TRACKED = () => M.getStoredFields().filter(f => f.type !== 'geometry').map(f => f.key);
  /** coverage(lots, keys?) → FieldDataStateCoverage[] */
  function coverage(lots, keys = TRACKED(), o = {}) {
    return keys.map(k => { const countsByState = {}, countsByReason = {}; for (const l of lots) { const c = canonicalStateOf(l, k, o); countsByState[c.canonicalState] = (countsByState[c.canonicalState] || 0) + 1; if (c.reasonCode) countsByReason[c.reasonCode] = (countsByReason[c.reasonCode] || 0) + 1; }
      return Object.freeze({ attributePath: k, totalEntities: lots.length, countsByState: Object.freeze(countsByState), countsByReason: Object.freeze(countsByReason) }); });
  }
  /** diagnostics(lots, { organizationId, developmentId, now }) → DataStateDiagnostics (technical only, not a KPI) */
  function diagnostics(lots, o = {}) {
    const d = { organizationId: o.organizationId || null, developmentId: o.developmentId || (lots[0] && lots[0].identity.developmentId) || null, trackedAttributeCount: 0, knownCount: 0, unknownCount: 0, notAvailableCount: 0,
      notApplicableCount: 0, pendingCount: 0, conflictedCount: 0, invalidCount: 0, errorCount: 0, partialCount: 0, staleKnownCount: 0, legacyUnclassifiedCount: 0, stateMissingCount: 0, generatedAt: o.now || new Date().toISOString() };
    const K = { KNOWN: 'knownCount', UNKNOWN: 'unknownCount', NOT_AVAILABLE: 'notAvailableCount', NOT_APPLICABLE: 'notApplicableCount', PENDING: 'pendingCount', CONFLICTED: 'conflictedCount', INVALID: 'invalidCount', ERROR: 'errorCount', PARTIAL: 'partialCount' };
    for (const l of lots) for (const k of TRACKED()) { const c = canonicalStateOf(l, k, o); d.trackedAttributeCount++; if (!c.canonicalState) { d.stateMissingCount++; continue; } d[K[c.canonicalState]]++; if (c.reasonCode === 'LEGACY_UNCLASSIFIED') d.legacyUnclassifiedCount++; if (c.canonicalState === 'KNOWN' && freshnessOf(l, k, o) === 'STALE') d.staleKnownCount++; }
    return Object.freeze(d);
  }
  /** legacyNullInventory(lots) → LegacyNullInventoryItem[] — nulls, enum sentinels, zeros and empty collections found, with the proposed classification */
  function legacyNullInventory(lots) {
    const items = new Map(), add = (k, rep, c, extra = {}) => { const id = k + '|' + rep; const it = items.get(id) || { entityType: 'LOT', attributePath: k, occurrenceCount: 0, rawRepresentations: [rep], currentInterpretation: null,
      proposedCanonicalState: c.canonicalState, proposedReasonCode: c.reasonCode || null, migrationClassificationCertainty: (c.classification && c.classification.certainty) || (c.reasonCode === 'LEGACY_UNCLASSIFIED' ? 'LOW' : 'HIGH'),
      requiresHumanReview: !!(c.classification && c.classification.review) || c.reasonCode === 'LEGACY_UNCLASSIFIED' || !!extra.review, notes: (c.classification && c.classification.evidence) || extra.notes || null }; it.occurrenceCount++; items.set(id, it); };
    for (const l of lots) for (const k of TRACKED()) {
      const v = M.get(l, k), c = canonicalStateOf(l, k);
      if (v === null || v === undefined) add(k, v === null ? 'null' : 'missing', c);
      else if (c.sentinel) add(k, JSON.stringify(c.sentinel), c, { notes: 'Código de enum UNKNOWN lido como estado, sem valor operacional.' });
      else if (v === 0) add(k, '0', c, { review: ZERO_REVIEW.has(k), notes: ZERO_REVIEW.has(k) ? 'Zero mantido como valor conhecido; medida da planta pede revisão humana (não reclassificado).' : 'Zero mantido como valor conhecido (policy allowKnownZero).' });
      else if (Array.isArray(v) && !v.length) add(k, '[]', c, { notes: 'Coleção vazia conhecida (allowKnownEmptyCollection).' });
    }
    return [...items.values()].map(i => Object.freeze({ ...i, currentInterpretation: i.rawRepresentations[0] === 'null' ? 'nulo genérico (exibido como "Não disponível" pelos formatadores)' : i.rawRepresentations[0] === '0' ? 'valor numérico zero' : i.rawRepresentations[0] === '[]' ? 'lista vazia' : 'código UNKNOWN do enum' }));
  }
  /** parity(lots) → { checked, unchanged, mismatches } — every KNOWN value read by the resolver equals the canonical value (zero delta) */
  function parity(lots, keys = TRACKED()) {
    let checked = 0, unchanged = 0; const mismatches = [];
    for (const l of lots) for (const k of keys) { const v = M.get(l, k), c = canonicalStateOf(l, k); if (c.canonicalState !== 'KNOWN') continue; checked++; if (stable(c.value) === stable(v)) unchanged++; else mismatches.push({ lotId: l.identity.id, attributePath: k }); }
    return { checked, unchanged, mismatches };
  }
  /** impactReport(lots, extras) → DataStateImpactReport */
  function impactReport(lots, x = {}) {
    const inv = legacyNullInventory(lots), p = parity(lots);
    return Object.freeze({ totalFieldsReviewed: TRACKED().length, knownValuesUnchanged: p.unchanged, nullsClassified: inv.filter(i => i.rawRepresentations[0] === 'null' && i.proposedReasonCode !== 'LEGACY_UNCLASSIFIED').reduce((n, i) => n + i.occurrenceCount, 0),
      legacySentinelsClassified: inv.filter(i => i.rawRepresentations[0].startsWith('"')).reduce((n, i) => n + i.occurrenceCount, 0), filtersAffected: x.filtersAffected || 0, comparisonsAffected: x.comparisonsAffected || 0,
      scoreInputsAffected: x.scoreInputsAffected || 0, shareOutputsAffected: x.shareOutputsAffected || 0, unresolvedMappings: inv.filter(i => i.requiresHumanReview).length, generatedAt: x.now || new Date().toISOString() });
  }

  return Object.freeze({
    CanonicalDataState, ProjectedDataState, FreshnessState, DataCompletenessState, DataAccessProjection, UiLoadState, RawDataPresenceState, FilterEvaluation, FilterUnknownPolicy, UnknownSortPolicy,
    ConstraintStatus, DisplayMode, DetailLevel, ErrorCode, WarningCode, REASONS, NOT_AVAILABLE_REASON_ALIGNMENT, LABELS, DISPLAY_POLICIES, NULL_CLASSIFICATION, LEGACY_POLICY, MAP_NO_DATA_STYLE,
    DEFAULT_SHARE_POLICY, CRITICAL_SHARE_POLICY, DEFAULT_DERIVED_POLICY, NULL_STATES,
    fieldPolicy, fieldRegistryRefs, validatePolicy, observeRaw, normalizeObservation, fingerprint, createRecord, validateState, createIndex, transitionEvent,
    adapters: Object.freeze({ pricing: pricingAdapter, availability: availabilityAdapter }), freshnessOf, canonicalStateOf, resolve, resolveMany, isKnownValue, isUsable, display, withLoad,
    evaluateRange, evaluateEquals, applyFilterPolicy, facetCounts, evaluateConstraint, toRuleOperand, comparator, sortWithUnknown, comparability, toComparisonValueStatus, derive,
    shareLine, exportCells, toDto, mapBucket, legendCounts, cacheKey, coverage, diagnostics, legacyNullInventory, parity, impactReport
  });
})();
