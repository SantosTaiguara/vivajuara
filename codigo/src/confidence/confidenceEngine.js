/* confidence/confidenceEngine.js — Topic 34: data confidence ("Confiança do dado"), pure engine.
   Namespace App.dataConfidence — deliberately distinct from the legacy labels lot.intelligence.confidence
   ("Confiabilidade da análise") and geometry.measurementConfidence, and from the FieldRegistry "confidence" column.
   Internal scale 0..1, display 0..100 only when status = COMPUTED. null is never 0. NOT a probability.
   The engine fetches nothing, touches no DOM/storage/API, never alters canonical values or provenance.
   Every number (weights, scores, caps, bands) comes from the methodology config — none is hardcoded here. */
App.dataConfidence = (() => {
  const I = App.integrity;
  const E = (...k) => Object.freeze(Object.fromEntries(k.map(x => [x, x])));
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };

  const ConfidenceStatus = E('COMPUTED', 'NOT_EVALUATED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'CONFLICTED', 'INVALID_PROVENANCE', 'DEPENDENCY_UNAVAILABLE', 'METHOD_UNASSESSED', 'ERROR');
  const ConfidenceDimension = E('EVIDENCE_INTEGRITY', 'SOURCE_AUTHORITY', 'CURRENTNESS', 'CONSISTENCY', 'LOCATOR_SPECIFICITY', 'EXTRACTION_QUALITY', 'METHOD_RELIABILITY', 'DEPENDENCY_CONFIDENCE',
    'DEPENDENCY_COVERAGE', 'MODEL_APPLICABILITY', 'CALIBRATION_QUALITY', 'MANUAL_SUPPORT', 'LEGACY_TRACEABILITY');
  const DIMENSION_ORDER = Object.freeze(Object.keys(ConfidenceDimension));
  const ConfidenceBand = E('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW');
  const AggregationMethod = E('WEIGHTED_ARITHMETIC_MEAN', 'WEIGHTED_GEOMETRIC_MEAN', 'WEIGHTED_HARMONIC_MEAN', 'MINIMUM', 'CONFIGURED_FUNCTION');
  const MethodologyStatus = E('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED');
  const ExecutionMode = E('DISABLED', 'SHADOW', 'TECHNICAL_ONLY', 'PUBLISHED');
  const CalibrationStatus = E('UNCALIBRATED', 'INTERNAL_VALIDATION', 'EMPIRICALLY_CALIBRATED', 'EXTERNALLY_VALIDATED');
  const AssessmentStatus = E('UNASSESSED', 'DRAFT', 'VALIDATED', 'CALIBRATED');
  const ERRORS = E('CONFIDENCE_METHODOLOGY_NOT_FOUND', 'CONFIDENCE_PROFILE_NOT_FOUND', 'CONFIDENCE_INPUT_INVALID', 'CONFIDENCE_PROVENANCE_INVALID', 'CONFIDENCE_CONFLICT_BLOCKED', 'CONFIDENCE_DEPENDENCY_MISSING',
    'CONFIDENCE_METHOD_UNASSESSED', 'CONFIDENCE_WEIGHT_CONFIGURATION_INVALID', 'CONFIDENCE_AGGREGATION_FAILED', 'CONFIDENCE_MIXED_METHODOLOGY', 'CONFIDENCE_TENANT_MISMATCH', 'CONFIDENCE_VALUE_FINGERPRINT_MISMATCH');
  const PERMISSIONS = Object.freeze({ READ: 'confidence.read', TECHNICAL_READ: 'confidence.technical.read', METHODOLOGY_MANAGE: 'confidence.methodology.manage' });

  // ------------------------------------------------------------------ methodology validator + checksum
  const checksumOf = m => { const { checksum, status, publishedAt, ...body } = m; return I.checksumOf(body); };
  /** validateMethodology(m) → { valid, errors[] } — weights, bands (no overlap, full coverage), profiles, mappings, caps, references */
  function validateMethodology(m) {
    const errors = [], add = (code, detail) => errors.push({ code, detail });
    if (!m || !m.id || !m.version) { add('CONFIDENCE_METHODOLOGY_NOT_FOUND', 'id/version'); return { valid: false, errors }; }
    if (!MethodologyStatus[m.status]) add('CONFIDENCE_INPUT_INVALID', 'status');
    if (!CalibrationStatus[m.calibrationStatus]) add('CONFIDENCE_INPUT_INVALID', 'calibrationStatus');
    if (!AggregationMethod[m.defaultAggregationMethod] || m.defaultAggregationMethod === 'CONFIGURED_FUNCTION') add('CONFIDENCE_AGGREGATION_FAILED', 'defaultAggregationMethod');
    const bands = [...(m.bands || [])].sort((a, b) => a.minInclusive - b.minInclusive), seen = new Set();
    if (!bands.length) add('CONFIDENCE_INPUT_INVALID', 'bands');
    let cursor = m.scale ? m.scale.min : 0;
    for (const [i, b] of bands.entries()) {
      if (!ConfidenceBand[b.band] || seen.has(b.band)) add('CONFIDENCE_INPUT_INVALID', 'banda inválida/duplicada ' + b.band); seen.add(b.band);
      if (Math.abs(b.minInclusive - cursor) > 1e-9) add('CONFIDENCE_INPUT_INVALID', 'faixas com lacuna ou sobreposição em ' + b.band);
      const last = i === bands.length - 1, top = last ? b.maxInclusive : b.maxExclusive;
      if (top == null || top <= b.minInclusive) add('CONFIDENCE_INPUT_INVALID', 'limite superior de ' + b.band);
      if (last && m.scale && b.maxInclusive !== m.scale.max) add('CONFIDENCE_INPUT_INVALID', 'faixas não cobrem a escala');
      cursor = top;
    }
    const inRange = v => typeof v === 'number' && v >= 0 && v <= 1;
    for (const [kind, p] of Object.entries(m.evaluationProfiles || {})) {
      if (p.notApplicable) continue;
      const dims = Object.entries(p.dimensions || {}); if (!dims.length) add('CONFIDENCE_PROFILE_NOT_FOUND', kind);
      for (const [d, w] of dims) { if (!ConfidenceDimension[d]) add('CONFIDENCE_INPUT_INVALID', kind + ': dimensão ' + d); if (!(typeof w === 'number' && w >= 0 && Number.isFinite(w))) add('CONFIDENCE_WEIGHT_CONFIGURATION_INVALID', kind + '.' + d); }
      if (dims.length && dims.reduce((s, [, w]) => s + (w || 0), 0) <= 0) add('CONFIDENCE_WEIGHT_CONFIGURATION_INVALID', kind + ': peso total zero');
      if (p.aggregationMethod && !AggregationMethod[p.aggregationMethod]) add('CONFIDENCE_AGGREGATION_FAILED', kind);
    }
    for (const k of ['evidenceStateRules', 'sourceAuthorityRules', 'currentnessRules']) for (const [n, r] of Object.entries(m[k] || {})) {
      if (!r.reasonCode) add('CONFIDENCE_INPUT_INVALID', k + '.' + n + ': reasonCode');
      if (!r.blocking && !inRange(r.score)) add('CONFIDENCE_INPUT_INVALID', k + '.' + n + ': score');
      if (r.cap != null && !inRange(r.cap)) add('CONFIDENCE_INPUT_INVALID', k + '.' + n + ': cap'); }
    for (const k of ['legacyPolicy', 'manualAssertionPolicy', 'overridePolicy']) { const p = m[k] || {}; for (const c of ['maxScore', 'maxScoreWithoutEvidence']) if (p[c] != null && !inRange(p[c])) add('CONFIDENCE_INPUT_INVALID', k + '.' + c); }
    if (!m.conflictPolicy || !['BLOCK_SCORE', 'CAP_SCORE', 'COMPUTE_WITH_PENALTY'].includes(m.conflictPolicy.unresolvedConflictBehavior)) add('CONFIDENCE_INPUT_INVALID', 'conflictPolicy');
    if (!m.dependencyPolicy || !['BLOCK', 'PARTIAL_WITH_COVERAGE', 'IGNORE_OPTIONAL'].includes(m.dependencyPolicy.missingDependencyBehavior)) add('CONFIDENCE_INPUT_INVALID', 'dependencyPolicy');
    for (const a of m.methodAssessments || []) { if (!AssessmentStatus[a.assessmentStatus]) add('CONFIDENCE_INPUT_INVALID', 'assessment ' + a.methodId);
      if (a.assessmentStatus !== 'UNASSESSED' && !inRange(a.baseReliability)) add('CONFIDENCE_INPUT_INVALID', 'baseReliability ' + a.methodId);
      if (a.assessmentStatus === 'UNASSESSED' && a.baseReliability != null) add('CONFIDENCE_INPUT_INVALID', 'UNASSESSED não pode ter baseReliability (' + a.methodId + ')'); }
    if (m.checksum && m.status === 'PUBLISHED' && m.checksum !== checksumOf(m)) add('CONFIDENCE_INPUT_INVALID', 'metodologia publicada alterada (checksum)');
    return { valid: !errors.length, errors };
  }

  // ------------------------------------------------------------------ policy resolver (exact → subdomain → domain → global; deterministic, no hidden fallback)
  function resolveFieldPolicy(m, path) {
    const fp = m.fieldPolicies || {}, parts = path.split('.'), tried = [path];
    if (parts.length > 2) tried.push(parts.slice(0, 2).join('.') + '.*');
    tried.push(parts[0] + '.*', '*');
    for (const k of tried) if (fp[k]) return { ...fp[k], matched: k };
    return null;
  }
  const assessmentOf = (m, ref) => ref ? (m.methodAssessments || []).find(a => a.methodId === ref.methodId && a.methodVersion === ref.methodVersion) || { methodId: ref.methodId, methodVersion: ref.methodVersion, assessmentStatus: 'UNASSESSED', version: '0', implicit: true } : null;
  const bandOf = (m, s) => { if (s == null) return null; for (const b of m.bands) { const top = b.maxInclusive != null ? s <= b.maxInclusive : s < b.maxExclusive; if (s >= b.minInclusive && top) return b.band; } return null; };
  const bandLabel = (m, band) => { const b = (m.bands || []).find(x => x.band === band); return b ? b.labelKey : null; };

  // ------------------------------------------------------------------ aggregation
  function aggregate(method, items) {
    const tw = items.reduce((s, x) => s + x.weight, 0); if (!(tw > 0)) return { ok: false, code: 'CONFIDENCE_WEIGHT_CONFIGURATION_INVALID' };
    let v;
    if (method === 'WEIGHTED_ARITHMETIC_MEAN') v = items.reduce((s, x) => s + x.weight * x.score, 0) / tw;
    else if (method === 'WEIGHTED_GEOMETRIC_MEAN') v = items.some(x => x.score <= 0) ? 0 : Math.exp(items.reduce((s, x) => s + x.weight * Math.log(x.score), 0) / tw);
    else if (method === 'WEIGHTED_HARMONIC_MEAN') v = items.some(x => x.score <= 0) ? 0 : tw / items.reduce((s, x) => s + x.weight / x.score, 0);
    else if (method === 'MINIMUM') v = Math.min(...items.map(x => x.score));
    else return { ok: false, code: 'CONFIDENCE_AGGREGATION_FAILED' };
    if (!Number.isFinite(v)) return { ok: false, code: 'CONFIDENCE_AGGREGATION_FAILED' };
    return { ok: true, value: v, totalWeight: tw };
  }
  const round6 = v => Math.round(v * 1e6) / 1e6;

  /** validateInput(input) → error codes */
  function validateInput(x) {
    const out = [];
    for (const k of ['organizationId', 'entityType', 'entityId', 'attributePath', 'valueFingerprint', 'provenanceKind', 'evidenceState', 'currentness']) if (x == null || x[k] == null) out.push(k);
    if (x && (!x.evaluationContext || !x.evaluationContext.asOf || !x.evaluationContext.methodologyVersion)) out.push('evaluationContext');
    return out;
  }

  // ------------------------------------------------------------------ ConfidenceEngine.evaluate
  /** evaluate(input: ConfidenceInput, methodology) → AttributeConfidenceResult (deterministic: same input + methodology ⇒ same result) */
  function evaluate(x, m) {
    const asOf = x && x.evaluationContext ? x.evaluationContext.asOf : null;
    const dims = [], limiting = [], warnings = [], caps = [], blocking = [];
    const limit = (code, severity, dimension, details) => { if (!limiting.some(l => l.code === code)) limiting.push({ code, dimension: dimension || null, severity, messageKey: 'confidence.limit.' + code, ...(details ? { technicalDetails: details } : {}) }); };
    const result = (status, score, profileId, extra = {}) => {
      const s = score == null ? null : round6(score), band = status === 'COMPUTED' ? bandOf(m, s) : null;
      const body = { organizationId: x.organizationId, developmentId: x.developmentId || null, entityType: x.entityType, entityId: x.entityId, attributePath: x.attributePath, valueFingerprint: x.valueFingerprint,
        provenanceId: x.provenanceId || null, methodologyId: m.id, methodologyVersion: m.version, asOf };
      return freeze({ id: I.stableId('conf', body, (x.dependencyInputs || []).map(d => d.confidenceResultId || d.valueFingerprint)), ...body, status, score: status === 'COMPUTED' ? s : null,
        displayScore: status === 'COMPUTED' && s != null ? Math.round(s * (m.scale.displayMultiplier || 100)) : null, band, dimensions: dims, limitingFactors: limiting, warnings,
        methodologyChecksum: m.checksum || checksumOf(m), methodologyStatus: m.status, calibrationStatus: m.calibrationStatus, evaluatedAt: asOf,
        dependencyConfidenceRefs: (x.dependencyInputs || []).map(d => d.confidenceResultId).filter(Boolean),
        trace: { profileId: profileId || null, dimensionOrder: DIMENSION_ORDER, applicableDimensions: dims.filter(d => d.status === 'APPLICABLE').map(d => d.dimension), skippedDimensions: dims.filter(d => d.status !== 'APPLICABLE').map(d => d.dimension),
          aggregationMethod: extra.aggregationMethod || null, preCapScore: extra.preCapScore == null ? null : round6(extra.preCapScore), appliedCaps: caps, finalScore: status === 'COMPUTED' ? s : null, blockingReasons: blocking,
          dependencyResultRefs: (x.dependencyInputs || []).map(d => d.confidenceResultId).filter(Boolean), sourceProvenanceRefs: x.provenanceId ? [x.provenanceId] : [], methodologyVersion: m.version } });
    };
    if (!m) throw Object.assign(new Error('metodologia ausente'), { code: 'CONFIDENCE_METHODOLOGY_NOT_FOUND' });
    const inv = validateInput(x); if (inv.length) return freeze({ status: 'ERROR', code: 'CONFIDENCE_INPUT_INVALID', fields: inv, score: null, displayScore: null, band: null });
    if (x.evaluationContext.methodologyVersion !== m.version) { blocking.push('CONFIDENCE_MIXED_METHODOLOGY'); return result('ERROR', null, null); }
    if (x.valueFingerprintMismatch) { blocking.push('CONFIDENCE_VALUE_FINGERPRINT_MISMATCH'); limit('VALUE_FINGERPRINT_MISMATCH', 'BLOCKING'); return result('INVALID_PROVENANCE', null, null); }
    // absence: no confidence of a missing value (never zero)
    const profile = (m.evaluationProfiles || {})[x.provenanceKind];
    if (x.provenanceKind === 'NOT_AVAILABLE' || (profile && profile.notApplicable)) { limit('VALUE_NOT_AVAILABLE', 'INFO'); return result('NOT_APPLICABLE', null, x.provenanceKind); }
    if (x.recordStatus === 'INVALIDATED') { blocking.push('PROVENANCE_INVALIDATED'); limit('INVALID_PROVENANCE', 'BLOCKING'); return result('INVALID_PROVENANCE', null, x.provenanceKind); }
    const evRule = (m.evidenceStateRules || {})[x.evidenceState];
    if (evRule && evRule.blocking) { blocking.push(evRule.reasonCode); limit(evRule.reasonCode, 'BLOCKING', 'EVIDENCE_INTEGRITY'); return result(evRule.blockingStatus || 'INSUFFICIENT_EVIDENCE', null, x.provenanceKind); }
    const fpol = resolveFieldPolicy(m, x.attributePath) || {};
    if (x.hasConflict && x.conflictState !== 'RESOLVED') {
      const beh = fpol.unresolvedConflictBehavior || m.conflictPolicy.unresolvedConflictBehavior;
      limit('UNRESOLVED_CONFLICT', beh === 'BLOCK_SCORE' ? 'BLOCKING' : 'WARNING', 'CONSISTENCY');
      if (beh === 'BLOCK_SCORE') { blocking.push('UNRESOLVED_CONFLICT'); return result('CONFLICTED', null, x.provenanceKind); }
      if (beh === 'CAP_SCORE' && m.conflictPolicy.cap != null) caps.push({ capType: 'CONFLICT', capValue: m.conflictPolicy.cap, reasonCode: 'UNRESOLVED_CONFLICT' });
    }
    if (x.hasConflict && x.conflictState === 'RESOLVED' && m.conflictPolicy.resolvedConflictBehavior === 'RETAIN_WARNING') warnings.push('CONFLICT_RESOLVED_PREVIOUSLY');
    if (!profile) { blocking.push('CONFIDENCE_PROFILE_NOT_FOUND'); return result('NOT_EVALUATED', null, null); }
    // method assessment (never invented: UNASSESSED blocks when the profile requires it)
    const asm = x.methodAssessment || null, needsMethod = !!profile.requireMethodAssessment || fpol.requireMethodAssessment;
    if (needsMethod) {
      const st = asm ? asm.assessmentStatus : 'UNASSESSED', rule = (m.methodAssessmentRules || {})[st];
      if (!asm || st === 'UNASSESSED' || rule === 'BLOCK' || (rule && rule.allow === false)) { blocking.push('METHOD_UNASSESSED'); limit('METHOD_UNASSESSED', 'BLOCKING', 'METHOD_RELIABILITY', asm ? { methodId: asm.methodId, methodVersion: asm.methodVersion } : null); return result('METHOD_UNASSESSED', null, x.provenanceKind); }
      if (rule && rule.cap != null) caps.push({ capType: 'METHOD_ASSESSMENT_' + st, capValue: rule.cap, reasonCode: 'METHOD_ASSESSMENT_' + st });
    }
    // dependencies
    const deps = x.dependencyInputs || [], required = deps.filter(d => d.required !== false);
    const usable = deps.filter(d => d.status === 'COMPUTED' && d.score != null);
    const dp = m.dependencyPolicy;
    if (required.some(d => d.status !== 'COMPUTED' || d.score == null)) {
      const bad = required.filter(d => d.status !== 'COMPUTED' || d.score == null);
      if (dp.missingDependencyBehavior === 'BLOCK' || dp.propagateBlockingStatus) { blocking.push('DEPENDENCY_UNAVAILABLE'); limit('DEPENDENCY_UNAVAILABLE', 'BLOCKING', 'DEPENDENCY_CONFIDENCE', { attributes: bad.map(d => d.attributePath + ':' + d.status) }); return result('DEPENDENCY_UNAVAILABLE', null, x.provenanceKind); }
    }
    // dimensions
    const want = profile.dimensions || {};
    const dim = (d, score, reasonCodes, status = 'APPLICABLE') => { if (!(d in want)) return; dims.push({ dimension: d, status: score == null && status === 'APPLICABLE' ? 'MISSING' : status, score: score == null ? null : round6(score), weight: want[d], reasonCodes }); };
    for (const d of DIMENSION_ORDER) {
      if (!(d in want)) continue;
      switch (d) {
        case 'EVIDENCE_INTEGRITY': dim(d, evRule ? evRule.score : null, [evRule ? evRule.reasonCode : 'EVIDENCE_STATE_UNMAPPED']); if (x.evidenceState === 'PARTIAL') limit('PARTIAL_EVIDENCE', 'WARNING', d); if (x.evidenceState === 'UNRESOLVED') limit('EVIDENCE_UNRESOLVED', 'WARNING', d); break;
        case 'SOURCE_AUTHORITY': { const obs = (x.sourceAuthorities || []).map(a => (m.sourceAuthorityRules || {})[a.authority || 'UNKNOWN'] || m.sourceAuthorityRules.UNKNOWN).filter(Boolean);
          if (!obs.length) { dim(d, null, ['SOURCE_AUTHORITY_NOT_RECORDED'], 'MISSING'); limit('SOURCE_AUTHORITY_NOT_RECORDED', 'WARNING', d); }
          else { const best = obs.reduce((a, b) => b.score > a.score ? b : a); dim(d, best.score, [best.reasonCode]); } break; } // authority never boosted by count
        case 'CURRENTNESS': { const r = (m.currentnessRules || {})[x.currentness]; dim(d, r ? r.score : null, [r ? r.reasonCode : 'CURRENTNESS_UNMAPPED']);
          if (r && r.cap != null) caps.push({ capType: 'CURRENTNESS', capValue: r.cap, reasonCode: r.reasonCode }); if (x.currentness !== 'CURRENT') limit(r ? r.reasonCode : 'CURRENTNESS_UNMAPPED', 'WARNING', d); break; }
        case 'CONSISTENCY': { const c = m.consistencyRules || {}, n = (x.sourceAuthorities || []).length, groups = new Set(x.sourceIndependenceGroups || []);
          let s = c.singleSource, rc = 'SINGLE_SOURCE';
          if (n > 1) { const independent = groups.size > 1 && groups.size === n;
            if (independent && m.multiSourcePolicy.agreementBenefitMode !== 'NONE') { s = c.independentAgreement; rc = 'INDEPENDENT_SOURCES_AGREE'; }
            else if (!x.sourceIndependenceGroups) { s = c.unknownIndependence; rc = 'SOURCE_INDEPENDENCE_UNKNOWN'; }
            else { s = c.correlatedAgreement; rc = 'CORRELATED_SOURCES_NO_BOOST'; } }
          if (n === 0) { dim(d, null, ['NO_SOURCES'], 'NOT_APPLICABLE'); break; }
          dim(d, s, [rc]); break; }
        case 'LOCATOR_SPECIFICITY': if (!x.locatorSpecificity) dim(d, null, ['NO_DOCUMENT_LOCATOR'], 'NOT_APPLICABLE'); else dim(d, (m.locatorSpecificityRules || {})[x.locatorSpecificity], ['LOCATOR_' + x.locatorSpecificity]); break;
        case 'EXTRACTION_QUALITY': if (x.extractionQuality == null) dim(d, null, ['NOT_EXTRACTED'], 'NOT_APPLICABLE'); else { dim(d, x.extractionQuality, ['EXTRACTION_QUALITY']); if (x.extractionQuality < 0.5) limit('EXTRACTION_LOW_QUALITY', 'WARNING', d); } break;
        case 'METHOD_RELIABILITY': if (!asm || asm.baseReliability == null) dim(d, null, ['METHOD_UNASSESSED'], 'MISSING'); else dim(d, asm.baseReliability, ['METHOD_' + asm.assessmentStatus]); break;
        case 'DEPENDENCY_CONFIDENCE': { if (!deps.length) { dim(d, null, ['NO_DEPENDENCIES'], 'NOT_APPLICABLE'); break; }
          const ag = aggregate(dp.aggregationMethod, usable.map(u => ({ score: u.score, weight: u.dependencyWeight == null ? 1 : u.dependencyWeight })));
          if (!ag.ok) { dim(d, null, [ag.code], 'MISSING'); break; } dim(d, ag.value, ['DEPENDENCIES_' + dp.aggregationMethod]);
          if (dp.maxAboveWeakestDependency != null && usable.length) { const weakest = Math.min(...usable.map(u => u.score)); caps.push({ capType: 'WEAKEST_DEPENDENCY', capValue: round6(Math.min(1, weakest + dp.maxAboveWeakestDependency)), reasonCode: 'DERIVED_BOUNDED_BY_INPUTS' }); } break; }
        case 'DEPENDENCY_COVERAGE': { if (!deps.length) { dim(d, null, ['NO_DEPENDENCIES'], 'NOT_APPLICABLE'); break; } const cov = usable.length / deps.length; dim(d, cov, ['COVERAGE']); if (cov < (dp.requiredCoverage == null ? 1 : dp.requiredCoverage)) limit('LOW_DEPENDENCY_COVERAGE', 'WARNING', d); break; }
        case 'MODEL_APPLICABILITY': if (x.modelApplicability == null) dim(d, null, ['APPLICABILITY_NOT_ASSESSED'], 'NOT_APPLICABLE'); else dim(d, x.modelApplicability, ['MODEL_APPLICABILITY']); break;
        case 'CALIBRATION_QUALITY': { const v = asm ? (m.calibrationQualityRules || {})[asm.assessmentStatus] : null; if (v == null) dim(d, null, ['METHOD_NOT_CALIBRATED'], 'MISSING'); else dim(d, v, ['METHOD_' + asm.assessmentStatus]); break; }
        case 'MANUAL_SUPPORT': { const sup = !!x.manualSupportingEvidence, r = m.manualSupportRules || {}; dim(d, sup ? r.withSupportingEvidence : r.withoutSupportingEvidence, [sup ? 'MANUAL_WITH_SUPPORT' : 'MANUAL_WITHOUT_SUPPORT']);
          const pol = x.provenanceKind === 'MANUAL_OVERRIDE' ? m.overridePolicy : m.manualAssertionPolicy;
          if (!sup && pol && pol.maxScoreWithoutEvidence != null) caps.push({ capType: x.provenanceKind === 'MANUAL_OVERRIDE' ? 'OVERRIDE_WITHOUT_SUPPORT' : 'MANUAL_WITHOUT_SUPPORT', capValue: pol.maxScoreWithoutEvidence, reasonCode: 'MANUAL_WITHOUT_SUPPORT' });
          if (x.provenanceKind === 'MANUAL_OVERRIDE') limit('MANUAL_OVERRIDE', 'WARNING', d); break; }
        case 'LEGACY_TRACEABILITY': { const r = m.legacyTraceabilityRules || {}; dim(d, x.legacyCandidateDocument ? r.candidateDocumentIdentified : r.noCandidate, [x.legacyCandidateDocument ? 'LEGACY_CANDIDATE_DOCUMENT' : 'LEGACY_NO_CANDIDATE']); break; }
      }
    }
    if (x.provenanceKind === 'LEGACY_DECLARED') {
      const lp = m.legacyPolicy || {}; limit('LEGACY_SOURCE_UNRESOLVED', 'WARNING', 'LEGACY_TRACEABILITY');
      if (lp.unresolvedLegacyBehavior === 'NO_SCORE') { blocking.push('LEGACY_SOURCE_UNRESOLVED'); return result('INSUFFICIENT_EVIDENCE', null, 'LEGACY_DECLARED'); }
      if (lp.maxScore != null) caps.push({ capType: 'LEGACY_UNRESOLVED', capValue: lp.maxScore, reasonCode: 'LEGACY_SOURCE_UNRESOLVED' });
      if (lp.requireReview) warnings.push('LEGACY_REVIEW_REQUIRED');
    }
    if (x.estimate) warnings.push('VALUE_IS_ESTIMATE'); // a high-confidence estimate is still an estimate
    const applicable = dims.filter(d => d.status === 'APPLICABLE' && d.score != null && d.weight > 0);
    const method = profile.aggregationMethod || m.defaultAggregationMethod;
    const ag = aggregate(method, applicable);
    if (!ag.ok) { blocking.push(ag.code); return result(applicable.length ? 'ERROR' : 'INSUFFICIENT_EVIDENCE', null, x.provenanceKind, { aggregationMethod: method }); }
    for (const d of dims) { d.normalizedWeight = d.status === 'APPLICABLE' && d.score != null ? round6(d.weight / ag.totalWeight) : null; d.contribution = d.normalizedWeight != null ? round6(d.normalizedWeight * d.score) : null; }
    let score = ag.value; const pre = score;
    if (x.provenanceKind !== 'LEGACY_DECLARED' && x.sourceAuthorities && x.sourceAuthorities.length > 1 && m.multiSourcePolicy.agreementBenefitMode === 'INDEPENDENT_SOURCES_ONLY') {
      const g = new Set(x.sourceIndependenceGroups || []); if (g.size > 1 && g.size === x.sourceAuthorities.length) score = Math.min(1, score + (m.multiSourcePolicy.maxAgreementBoost || 0)); }
    for (const c of caps) if (score > c.capValue) { score = c.capValue; c.applied = true; } else c.applied = false;
    if (score < 0 || score > 1) { if (m.scale.clampFloatingPointOnly && Math.abs(score - Math.min(1, Math.max(0, score))) < 1e-9) score = Math.min(1, Math.max(0, score)); else { blocking.push('CONFIDENCE_AGGREGATION_FAILED'); return result('ERROR', null, x.provenanceKind); } }
    if (m.status !== 'PUBLISHED') warnings.push('METHODOLOGY_' + m.status);
    if (m.calibrationStatus === 'UNCALIBRATED') warnings.push('UNCALIBRATED_NOT_A_PROBABILITY');
    return result('COMPUTED', score, x.provenanceKind, { aggregationMethod: method, preCapScore: pre });
  }

  // ------------------------------------------------------------------ explanation (consumes result/trace; never recomputes)
  const STATUS_TEXT = Object.freeze({ COMPUTED: null, NOT_EVALUATED: 'Confiança não avaliada.', INSUFFICIENT_EVIDENCE: 'Confiança não calculada: evidência insuficiente.', NOT_APPLICABLE: 'Sem confiança calculada: o dado não está disponível.',
    CONFLICTED: 'Confiança não calculada: existem fontes conflitantes para este campo.', INVALID_PROVENANCE: 'Confiança não calculada: proveniência inválida.', DEPENDENCY_UNAVAILABLE: 'Confiança não calculada: um dado de entrada não tem confiança calculada.',
    METHOD_UNASSESSED: 'Confiança não calculada: o método ainda não foi avaliado.', ERROR: 'Confiança não calculada (erro de configuração).' });
  const LIMIT_TEXT = Object.freeze({ SOURCE_SUPERSEDED: 'a fonte foi substituída por versão mais recente', UNRESOLVED_CONFLICT: 'há conflito entre fontes', LEGACY_SOURCE_UNRESOLVED: 'a fonte exata do legado não foi recuperada',
    METHOD_UNASSESSED: 'o método não foi avaliado', LOW_DEPENDENCY_COVERAGE: 'faltam dados de entrada', STALE_SOURCE: 'a fonte está desatualizada', PARTIAL_EVIDENCE: 'a evidência é parcial', EXTRACTION_LOW_QUALITY: 'a extração tem baixa qualidade',
    EVIDENCE_UNRESOLVED: 'a evidência não foi localizada', SOURCE_AUTHORITY_NOT_RECORDED: 'a autoridade da fonte não está registrada', REVIEW_REQUIRED: 'o registro está em revisão', CURRENTNESS_UNKNOWN: 'não se sabe se a fonte continua atual',
    MANUAL_OVERRIDE: 'o valor foi substituído manualmente', DEPENDENCY_UNAVAILABLE: 'um dado de entrada não tem confiança calculada', VALUE_NOT_AVAILABLE: 'o dado não está disponível' });
  function explain(r, m) {
    if (!r || !r.status) return null;
    const bl = r.band ? (bandLabel(m, r.band) || r.band) : null;
    const strongest = (r.dimensions || []).filter(d => d.status === 'APPLICABLE' && d.score != null).sort((a, b) => b.contribution - a.contribution || (a.dimension < b.dimension ? -1 : 1)).slice(0, 3).map(d => ({ dimension: d.dimension, reasonCodes: d.reasonCodes }));
    const lim = (r.limitingFactors || []).map(l => ({ code: l.code, severity: l.severity, text: LIMIT_TEXT[l.code] || l.code }));
    const caveats = [];
    if (r.warnings.includes('VALUE_IS_ESTIMATE')) caveats.push('O valor continua sendo uma estimativa.');
    if (r.warnings.some(w => /^METHODOLOGY_(DRAFT|VALIDATED)/.test(w))) caveats.push('Metodologia de confiança em rascunho (execução shadow).');
    caveats.push('Índice de confiança do dado: não é probabilidade nem garantia.');
    const text = r.status === 'COMPUTED' ? `Confiança ${String(bl).toLowerCase()}.` + (lim.length ? ' Limitações: ' + lim.map(l => l.text).join('; ') + '.' : '') : STATUS_TEXT[r.status];
    return freeze({ resultId: r.id, summaryCode: r.status === 'COMPUTED' ? 'BAND_' + r.band : r.status, band: r.band || undefined, score: r.displayScore == null ? undefined : r.displayScore, text,
      strongestFactors: strongest, limitingFactors: lim, appliedCaps: ((r.trace && r.trace.appliedCaps) || []).filter(c => c.applied).map(c => ({ capType: c.capType, capValue: c.capValue, reasonCode: c.reasonCode })), caveats });
  }

  return Object.freeze({ ConfidenceStatus, ConfidenceDimension, DIMENSION_ORDER, ConfidenceBand, AggregationMethod, MethodologyStatus, ExecutionMode, CalibrationStatus, AssessmentStatus, ERRORS, PERMISSIONS,
    checksumOf, validateMethodology, resolveFieldPolicy, assessmentOf, bandOf, bandLabel, aggregate, validateInput, evaluate, explain, STATUS_TEXT, LIMIT_TEXT });
})();
