/* intelligence/recommendation.js — RecommendationEngine (topic 15).
   Hard constraints decide who CAN be recommended; the Fit Score (topic 14) orders who
   SHOULD come first. A hard constraint is never turned into a big weight, is never
   relaxed automatically, and a lot never disappears from the dataset: it is either
   recommended (tier), sent to review (critical data unknown or stale) or excluded with
   a reason code. Availability UNKNOWN is never treated as AVAILABLE.

   Pipeline: 0 validation → 1 candidate universe (development + explicit scope) →
   2 system eligibility (availability policy, short-circuit) → 3 hard constraints
   (cheap first) → 4 data quality gating (stale/offline) → 5 Fit → 6 ranking
   (fit, coverage, confidence, lotId) → 7 tiers. Pure and deterministic. */
App.recommendation = (() => {
  const get = App.model.get;
  const OPERATORS = Object.freeze({
    EQ: (v, e) => v === e, NEQ: (v, e) => v !== e, GT: (v, e) => v > e, GTE: (v, e) => v >= e, LT: (v, e) => v < e, LTE: (v, e) => v <= e,
    BETWEEN: (v, e) => (e.min == null || v >= e.min) && (e.max == null || v <= e.max), IN: (v, e) => Array.isArray(e) && e.includes(v), NOT_IN: (v, e) => Array.isArray(e) && !e.includes(v),
    EXISTS: v => v != null, NOT_EXISTS: v => v == null, IS_TRUE: v => v === true, IS_FALSE: v => v === false
  });
  const ON_UNKNOWN = Object.freeze(['EXCLUDE', 'REVIEW_REQUIRED', 'ALLOW_WITH_WARNING']);
  const TIERS = Object.freeze(['PRIMARY', 'STRONG_MATCH', 'ALTERNATIVE', 'REVIEW_REQUIRED']);
  const ConstraintEvaluatorRegistry = Object.freeze({ has: op => Object.prototype.hasOwnProperty.call(OPERATORS, op), list: () => Object.keys(OPERATORS) });
  const policyOf = devId => App.configs && App.configs.recommendation && App.configs.recommendation[devId];

  /** CustomerConstraint from the catalog: { key, expectedValue, onUnknown? } → full constraint */
  function constraint(key, expectedValue, policy, extra = {}) {
    const d = policy.constraints[key]; if (!d) return null;
    return { id: `c-${key}`, key, metricKey: d.metricKey, operator: d.operator, expectedValue, onUnknown: extra.onUnknown || d.onUnknown || policy.defaultOnUnknown, source: extra.source || 'EXPLICIT_USER', enabled: true, descriptionKey: 'constraint.' + key, metadata: {} };
  }
  function validateConstraints(list, policy) {
    const errors = [], warnings = [], seen = new Map();
    (list || []).forEach((c, i) => {
      const p = `constraints[${i}]`;
      if (!App.model.field(c.metricKey)) errors.push({ code: 'INVALID_METRIC_KEY', path: p, message: `campo fora do registro: ${c.metricKey}` });
      if (!ConstraintEvaluatorRegistry.has(c.operator)) errors.push({ code: 'INVALID_OPERATOR', path: p, message: `operador não registrado: ${c.operator}` });
      if (!ON_UNKNOWN.includes(c.onUnknown)) errors.push({ code: 'INVALID_ON_UNKNOWN', path: p, message: 'política para dado desconhecido inválida' });
      if (['LT', 'LTE', 'GT', 'GTE'].includes(c.operator) && !Number.isFinite(c.expectedValue)) errors.push({ code: 'TYPE_MISMATCH', path: p, message: 'valor numérico obrigatório' });
      if (['IN', 'NOT_IN'].includes(c.operator) && !(Array.isArray(c.expectedValue) && c.expectedValue.length)) errors.push({ code: 'TYPE_MISMATCH', path: p, message: 'lista obrigatória' });
      const k = c.metricKey + '|' + c.operator; if (seen.has(k)) warnings.push({ code: 'DUPLICATE_CONSTRAINT', path: p, message: 'restrição repetida: vale a última' }); seen.set(k, c);
    });
    const en = (list || []).filter(c => c.enabled !== false);
    const lo = en.filter(c => c.metricKey === 'geometry.areaM2' && c.operator === 'GTE').map(c => c.expectedValue), hi = en.filter(c => c.metricKey === 'geometry.areaM2' && c.operator === 'LTE').map(c => c.expectedValue);
    if (lo.length && hi.length && Math.max(...lo) > Math.min(...hi)) errors.push({ code: 'HARD_CONSTRAINT_CONFLICT', path: 'constraints', message: 'área mínima maior que a área máxima' });
    return { ok: !errors.length, errors, warnings };
  }
  /** cheap first: identity/status, then price/area, booleans/enums, location */
  const COST = { identity: 0, commercial: 1, geometry: 1, surroundings: 2, environmental: 3, location: 3, mobility: 3 };
  const effective = list => { const m = new Map(); for (const c of list || []) if (c.enabled !== false) m.set(c.metricKey + '|' + c.operator, c); return [...m.values()].sort((a, b) => (COST[a.metricKey.split('.')[0]] ?? 9) - (COST[b.metricKey.split('.')[0]] ?? 9) || a.id.localeCompare(b.id)); };

  function evaluateConstraint(c, lot, policy, ctx) {
    const d = policy.constraints[c.key] || {}, v = get(lot, c.metricKey), prov = App.model.getFieldProvenance(lot, c.metricKey);
    const base = { constraintId: c.id, key: c.key, metricKey: c.metricKey, operator: c.operator, expectedValue: c.expectedValue, actualValue: v ?? null, dataStatus: prov.status };
    if (v == null || prov.status === 'UNKNOWN' || prov.status === 'CONFLICTED') return { ...base, status: 'UNKNOWN', reasonCode: prov.status === 'CONFLICTED' ? 'CONFLICTED_DATA' : (d.unknownCode || 'CRITICAL_DATA_UNKNOWN'), onUnknown: c.onUnknown };
    let pass;
    try { pass = OPERATORS[c.operator](v, c.expectedValue); } catch (e) { return { ...base, status: 'ERROR', reasonCode: 'CONSTRAINT_ERROR' }; }
    if (!pass) return { ...base, status: 'FAIL', reasonCode: d.failCode || 'CONSTRAINT_FAILED' };
    if (d.commercial && ctx.commercialFreshness === 'STALE') return { ...base, status: 'PASS', stale: true, reasonCode: 'STALE_COMMERCIAL_DATA' };
    return { ...base, status: 'PASS', reasonCode: null };
  }
  /** system eligibility from the availability policy (topic 8). UNKNOWN → review, never eligible. */
  function systemEligibility(lot, policy, ctx) {
    const s = lot.availability.status, allowed = new Set(policy.allowedAvailabilityStatuses);
    if (policy.proposalFollowsAvailabilityPolicy && ctx.availabilityPolicy && ctx.availabilityPolicy.proposalCountsAsOfferable) allowed.add('PROPOSAL');
    if (s === 'UNKNOWN') return policy.unknownAvailabilityPolicy === 'EXCLUDE' ? { status: 'INELIGIBLE', reasonCode: 'AVAILABILITY_UNKNOWN' } : { status: 'REVIEW', reasonCode: 'AVAILABILITY_UNKNOWN' };
    if (!allowed.has(s)) return { status: 'INELIGIBLE', reasonCode: s === 'SOLD' ? 'SOLD' : s === 'RESERVED' ? 'RESERVED' : s === 'BLOCKED' ? 'BLOCKED' : s === 'PROPOSAL' ? 'IN_PROPOSAL' : 'STATUS_NOT_AVAILABLE' };
    if (ctx.availabilityFreshness === 'STALE' && policy.staleCommercialPolicy !== 'ALLOW_WITH_WARNING') return policy.staleCommercialPolicy === 'EXCLUDE' ? { status: 'INELIGIBLE', reasonCode: 'STALE_AVAILABILITY' } : { status: 'REVIEW', reasonCode: 'STALE_AVAILABILITY' };
    return { status: 'ELIGIBLE', reasonCode: null };
  }
  const cmp = (a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || b.coverage - a.coverage || (b.confidence ?? -1) - (a.confidence ?? -1) || (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0);
  function cacheKey(req, policy, fitCfg) {
    const v = req.dataVersions || {};
    return [req.developmentId, req.profile.id, req.profile.profileVersion, v.staticVersion, v.analysisVersion, v.priceTableVersion, v.availabilityRevision, fitCfg.fitMethodologyVersion, policy.version,
      App.methodology.checksum(effective(req.constraints).map(c => [c.metricKey, c.operator, c.expectedValue, c.onUnknown])), req.scope ? App.methodology.checksum(req.scope) : 'all', req.offline ? 'off' : 'on', req.commercialFreshness || '-'].join('|');
  }

  /** recommend(request) → RecommendationResult. request = { developmentId, profile, constraints, lots, scope?, policy, fitCfg, availabilityPolicy, commercialFreshness, availabilityFreshness, offline, dataVersions } */
  function recommend(req) {
    const policy = req.policy, fitCfg = req.fitCfg, lots = req.lots || [];
    const key = cacheKey(req, policy, fitCfg), requestId = 'rec-' + App.methodology.checksum(key);
    const base = { requestId, cacheKey: key, developmentId: req.developmentId, customerProfileId: req.profile.id, customerProfileVersion: req.profile.profileVersion,
      recommendationPolicyVersion: policy.version, fitMethodologyVersion: fitCfg.fitMethodologyVersion, generatedAt: req.generatedAt || null, dataVersions: req.dataVersions || {} };
    const empty = (status, extra = {}) => Object.freeze({ ...base, status, candidateCount: 0, eligibleCount: 0, reviewRequiredCount: 0, ineligibleCount: 0, outOfScopeCount: 0, recommendations: [], reviewCandidates: [], exclusionSummary: {}, constraintImpact: [], warnings: [], diagnostics: [], ...extra });
    // phase 0 — validation
    const vp = App.fit.validateProfile(req.profile, fitCfg), vc = validateConstraints(req.constraints, policy);
    if (!vp.ok || !vc.ok) return empty('INVALID_PROFILE', { diagnostics: [...vp.errors, ...vc.errors] });
    const constraints = effective(req.constraints);
    if (App.fit.isEmpty(req.profile) && !constraints.length) return empty('INSUFFICIENT_PROFILE');
    // phase 1 — candidate universe (explicit scope only)
    const inScope = l => !req.scope || ((!req.scope.lotIds || req.scope.lotIds.includes(l.identity.id)) && (!req.scope.blockIds || req.scope.blockIds.includes(l.identity.blockId)));
    const candidates = lots.filter(l => l.identity && l.identity.developmentId === req.developmentId && inScope(l));
    const outOfScope = lots.length - candidates.length;
    const ctx = { commercialFreshness: req.commercialFreshness || null, availabilityFreshness: req.availabilityFreshness || null, availabilityPolicy: req.availabilityPolicy || null };
    const fitCtx = App.fit.contextFor(lots, { commercialFreshness: req.commercialFreshness, priceTableVersion: (req.dataVersions || {}).priceTableVersion, analysisVersion: (req.dataVersions || {}).analysisVersion });
    const exclusion = {}, impact = new Map(constraints.map(c => [c.id, { constraintId: c.id, key: c.key, rejectedCount: 0, unknownCount: 0 }]));
    const excl = code => { exclusion[code] = (exclusion[code] || 0) + 1; };
    const scored = [], review = [], warnings = new Set();
    let ineligible = 0, lowFit = 0;
    for (const lot of candidates) {
      // phase 2 — system eligibility (short-circuit: SOLD etc. never reach constraints or Fit)
      const sys = systemEligibility(lot, policy, ctx);
      if (sys.status === 'INELIGIBLE') { ineligible++; excl(sys.reasonCode); continue; }
      const reviewReasons = sys.status === 'REVIEW' ? [sys.reasonCode] : [], warns = [];
      // phase 3 — hard constraints
      let failed = null; const results = [];
      for (const c of constraints) {
        const r = evaluateConstraint(c, lot, policy, ctx); results.push(r);
        if (r.status === 'FAIL' || r.status === 'ERROR') { failed = r; impact.get(c.id).rejectedCount++; break; }
        if (r.status === 'UNKNOWN') { impact.get(c.id).unknownCount++;
          if (r.onUnknown === 'EXCLUDE') { failed = r; break; } if (r.onUnknown === 'REVIEW_REQUIRED') reviewReasons.push(r.reasonCode); else warns.push(r.reasonCode); }
        if (r.stale) { if (policy.staleCommercialPolicy === 'EXCLUDE') { failed = r; break; } if (policy.staleCommercialPolicy === 'REVIEW_REQUIRED') reviewReasons.push('STALE_COMMERCIAL_DATA'); else warns.push('STALE_COMMERCIAL_DATA'); }
      }
      if (failed) { ineligible++; excl(failed.reasonCode); continue; }
      // phase 4 — data quality gating (offline: commercial confirmation required)
      if (req.offline && policy.offlinePolicy === 'COMMERCIAL_CONFIRMATION_REQUIRED') { warnings.add('COMMERCIAL_CONFIRMATION_REQUIRED'); }
      // phase 5 — Fit (only for lots still eligible or reviewable)
      const fit = App.fit.isEmpty(req.profile) ? null : App.fit.fitLot(req.profile, lot, fitCfg, fitCtx);
      const item = { lotId: lot.identity.id, code: lot.identity.code, fitScore: fit ? fit.fitScore : null, coverage: fit ? fit.coverage : 1, confidence: fit ? fit.confidence.value : null, fitConfidence: fit ? fit.confidence.level : 'UNKNOWN',
        keyReasonCodes: [], constraintSummary: { passed: results.filter(r => r.status === 'PASS').length, unknown: results.filter(r => r.status === 'UNKNOWN').map(r => r.reasonCode), total: constraints.length }, constraintResults: results,
        eligibility: sys.status,
        commercialFreshness: ctx.commercialFreshness, availabilityStatus: lot.availability.status, warnings: warns, reviewReasons, fit };
      if (fit && fit.fitScore != null && fit.coverage < policy.minFitCoverage) reviewReasons.push('LOW_FIT_COVERAGE');
      if (fit && fit.confidence.value != null && fit.confidence.value < policy.minFitConfidence) reviewReasons.push('LOW_FIT_CONFIDENCE');
      if (reviewReasons.length) { review.push(item); continue; }
      if (fit && (fit.fitScore == null || fit.fitScore < policy.minimumFitScore)) { lowFit++; excl('LOW_FIT'); continue; }
      scored.push(item);
    }
    // phase 6 — ranking (no hidden boost, no randomness)
    scored.sort(cmp); review.sort(cmp);
    // phase 7 — tiers (never force a PRIMARY)
    const recs = []; let primary = 0;
    for (const it of scored) {
      if (recs.length >= policy.shortlistSize) break;
      const strong = it.fitScore != null && it.fitScore >= policy.strongMatchFitScore; // without preferences nothing is ranked as PRIMARY
      const tier = strong && primary < policy.primaryTierSize ? (primary++, 'PRIMARY') : strong ? 'STRONG_MATCH' : 'ALTERNATIVE';
      const hasFit = it.fitScore != null; // without a Fit there is no "most compatible" and no profile coverage to report
      const codes = [recs.length === 0 && hasFit ? 'TOP_FIT' : null, 'MEETS_ALL_REQUIRED_CONSTRAINTS', hasFit && it.coverage >= 0.999 ? 'HIGH_PROFILE_COVERAGE' : null, it.fitConfidence === 'HIGH' ? 'HIGH_DATA_CONFIDENCE' : null,
        ...(it.fit ? it.fit.strengths.slice(0, 3).map(s => 'MATCH_' + s.key.replace(/[A-Z]/g, c => '_' + c).toUpperCase()) : [])].filter(Boolean);
      recs.push({ ...it, rank: recs.length + 1, tier, keyReasonCodes: codes });
    }
    const reviewCandidates = policy.reviewBucketEnabled ? review.slice(0, policy.reviewLimit).map((it, i) => ({ ...it, rank: i + 1, tier: 'REVIEW_REQUIRED', keyReasonCodes: [...new Set(it.reviewReasons)] })) : [];
    const status = !recs.length ? (scored.length || lowFit ? 'NO_STRONG_RECOMMENDATION' : 'NO_ELIGIBLE_LOTS') : primary ? 'SUCCESS' : 'NO_STRONG_RECOMMENDATION';
    return Object.freeze({ ...base, status, candidateCount: candidates.length, eligibleCount: scored.length + lowFit, reviewRequiredCount: review.length, ineligibleCount: ineligible, outOfScopeCount: outOfScope, lowFitCount: lowFit,
      recommendations: recs, reviewCandidates, reviewTotal: review.length, exclusionSummary: policy.exclusionSummaryEnabled ? exclusion : {}, constraintImpact: [...impact.values()].sort((a, b) => b.rejectedCount - a.rejectedCount || a.key.localeCompare(b.key)),
      warnings: [...warnings], diagnostics: [...vp.warnings, ...vc.warnings] });
  }
  /** ids that should stand out on the map (recommended first, else the review shortlist) */
  const mapIds = r => r ? (r.recommendations.length ? r.recommendations : r.reviewCandidates).map(x => x.lotId) : [];
  return Object.freeze({ OPERATORS: Object.keys(OPERATORS), ON_UNKNOWN, TIERS, ConstraintEvaluatorRegistry, policyOf, constraint, validateConstraints, evaluateConstraint, systemEligibility, recommend, cacheKey, mapIds, compare: cmp });
})();
