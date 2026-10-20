/* intelligence/recommendation.js — RecommendationEngine (topic 15).
   Hard constraints decide who CAN be recommended; the Fit Score (topic 14) orders who
   SHOULD come first. A hard constraint is never turned into a big weight, is never
   relaxed automatically, and a lot never disappears from the dataset: it is either
   recommended (tier), sent to review (critical data unknown or stale) or excluded with
   a reason code. Availability UNKNOWN is never treated as AVAILABLE.

   Pipeline: 0 validation → 1 candidate universe (development + explicit scope) →
   2 system eligibility (availability policy, short-circuit) → 3 hard constraints
   (cheap first) → 4 data quality gating (stale/offline) → 5 Fit → 6 ranking
   (fit, coverage, confidence, lotId) → 7 tiers. Pure and deterministic.
   Besides the ranking the result carries the evidence for every lot that did not make it:
   `excluded` (ExcludedLotDetail per excluded lot: stage, reason code, metric, actual vs expected
   value, constraint label), `overflow` (eligible / review lots beyond the list sizes),
   `reviewSummary` and a primary review reason per review candidate, data-derived constraint
   conflicts (`conflicts`, warnings only: nothing is relaxed) and lot-level `diagnostics`
   (invalid lot, other development, outside the explicit scope). */
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
    // logical conflicts on one metric: lower bound above upper bound (GTE/GT × LTE/LT/BETWEEN), BETWEEN min > max, IN with nothing accepted by NOT_IN
    const metrics = [...new Set(en.map(c => c.metricKey))];
    for (const mk of metrics) {
      const cs = en.filter(c => c.metricKey === mk), num = v => Number.isFinite(v);
      const lo = [...cs.filter(c => (c.operator === 'GTE' || c.operator === 'GT') && num(c.expectedValue)).map(c => c.expectedValue), ...cs.filter(c => c.operator === 'BETWEEN' && c.expectedValue && num(c.expectedValue.min)).map(c => c.expectedValue.min)];
      const hi = [...cs.filter(c => (c.operator === 'LTE' || c.operator === 'LT') && num(c.expectedValue)).map(c => c.expectedValue), ...cs.filter(c => c.operator === 'BETWEEN' && c.expectedValue && num(c.expectedValue.max)).map(c => c.expectedValue.max)];
      const strict = cs.some(c => c.operator === 'GT' || c.operator === 'LT');
      if (lo.length && hi.length && (Math.max(...lo) > Math.min(...hi) || (strict && Math.max(...lo) === Math.min(...hi)))) errors.push({ code: 'HARD_CONSTRAINT_CONFLICT', path: 'constraints', message: mk === 'geometry.areaM2' ? 'área mínima maior que a área máxima' : `limite mínimo maior que o máximo em ${mk}`, metricKey: mk });
      const inc = cs.find(c => c.operator === 'IN' && Array.isArray(c.expectedValue)), exc = cs.find(c => c.operator === 'NOT_IN' && Array.isArray(c.expectedValue));
      if (inc && exc && inc.expectedValue.every(v => exc.expectedValue.includes(v))) errors.push({ code: 'HARD_CONSTRAINT_CONFLICT', path: 'constraints', message: `nenhum valor aceito em ${mk}`, metricKey: mk });
      if (cs.some(c => c.operator === 'IS_TRUE') && cs.some(c => c.operator === 'IS_FALSE')) errors.push({ code: 'HARD_CONSTRAINT_CONFLICT', path: 'constraints', message: `sim e não exigidos ao mesmo tempo em ${mk}`, metricKey: mk });
    }
    return { ok: !errors.length, errors, warnings };
  }
  /** data-derived conflicts (warnings only, never relaxed): a constraint that no lot meeting all the OTHER constraints meets
      (e.g. a budget below the cheapest lot of the accepted area). Only known values count; availability is not read. */
  function constraintConflicts(constraints, lots, policy) {
    const out = [], known = (c, l) => { const v = get(l, c.metricKey); if (v == null) return null; try { return OPERATORS[c.operator](v, c.expectedValue) === true; } catch (e) { return null; } };
    if (!constraints.length || !lots.length) return out;
    const pass = constraints.map(c => lots.map(l => known(c, l)));
    constraints.forEach((c, i) => {
      const idx = lots.map((l, k) => k).filter(k => constraints.every((o, j) => j === i || pass[j][k] === true));
      if (!idx.length || idx.some(k => pass[i][k] === true)) return;
      const vals = idx.map(k => get(lots[k], c.metricKey)).filter(v => typeof v === 'number' && Number.isFinite(v));
      const best = !vals.length ? null : ['LTE', 'LT'].includes(c.operator) ? Math.min(...vals) : ['GTE', 'GT'].includes(c.operator) ? Math.max(...vals) : null;
      const isBudget = c.metricKey === 'commercial.price' && ['LTE', 'LT'].includes(c.operator), d = policy.constraints[c.key] || {};
      out.push({ code: isBudget ? (constraints.length > 1 ? 'BUDGET_BELOW_CHEAPEST_MATCH' : 'BUDGET_BELOW_CHEAPEST_LOT') : 'CONSTRAINT_UNSATISFIABLE', severity: 'WARNING', path: 'constraints', constraintId: c.id, constraintKey: c.key, metricKey: c.metricKey, operator: c.operator,
        expectedValue: c.expectedValue, bestAvailableValue: best, matchingOtherConstraintsCount: idx.length, otherConstraintKeys: constraints.filter((o, j) => j !== i).map(o => o.key), constraintLabel: d.label || null, autoRelaxed: false,
        message: isBudget ? `orçamento abaixo do lote mais barato que atende às demais exigências${best != null ? ` (${best})` : ''}` : `nenhum lote que atende às demais exigências atende a ${c.key}` });
    });
    return out;
  }
  /** which part of the review a reason belongs to (so the UI does not call everything "status a confirmar") */
  const REVIEW_CATEGORY_ORDER = Object.freeze(['AVAILABILITY', 'COMMERCIAL_DATA', 'CONSTRAINT_DATA', 'FIT_DATA']);
  function reviewCategoryOf(code, policy) {
    if (code === 'AVAILABILITY_UNKNOWN' || code === 'STALE_AVAILABILITY') return 'AVAILABILITY';
    if (code === 'STALE_COMMERCIAL_DATA') return 'COMMERCIAL_DATA';
    if (code === 'LOW_FIT_COVERAGE' || code === 'LOW_FIT_CONFIDENCE' || code === 'FIT_FAILED') return 'FIT_DATA';
    const d = Object.values((policy && policy.constraints) || {}).find(x => x.unknownCode === code);
    return d && d.commercial ? 'COMMERCIAL_DATA' : 'CONSTRAINT_DATA';
  }
  /** primary review reason: availability first, then commercial data, then constraint data, then Fit data (first pushed within a category) */
  function primaryReviewReason(reasons, policy) {
    let best = null, rank = 99;
    for (const r of reasons || []) { const k = REVIEW_CATEGORY_ORDER.indexOf(reviewCategoryOf(r, policy)); if (k < rank) { rank = k; best = r; } }
    return best;
  }
  const allowedStatuses = (policy, ctx) => { const a = new Set(policy.allowedAvailabilityStatuses); if (policy.proposalFollowsAvailabilityPolicy && ctx.availabilityPolicy && ctx.availabilityPolicy.proposalCountsAsOfferable) a.add('PROPOSAL'); return a; };
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
    if (ctx.availabilityFreshness === 'EXPIRED') return policy.staleCommercialPolicy === 'EXCLUDE' ? { status: 'INELIGIBLE', reasonCode: 'STALE_AVAILABILITY' } : { status: 'REVIEW', reasonCode: 'STALE_AVAILABILITY' }; // topic 29: expired is never a warning-only pass
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
    const empty = (status, extra = {}) => Object.freeze({ ...base, status, candidateCount: 0, eligibleCount: 0, reviewRequiredCount: 0, ineligibleCount: 0, outOfScopeCount: 0, recommendations: [], reviewCandidates: [], exclusionSummary: {}, constraintImpact: [], warnings: [], diagnostics: [],
      excluded: [], conflicts: [], reviewSummary: { byPrimaryReason: {}, byCategory: {} }, overflow: { eligibleLotIds: [], reviewLotIds: [] }, ...extra });
    // phase 0 — validation
    const vp = App.fit.validateProfile(req.profile, fitCfg), vc = validateConstraints(req.constraints, policy);
    if (!vp.ok || !vc.ok) return empty('INVALID_PROFILE', { diagnostics: [...vp.errors, ...vc.errors] });
    const constraints = effective(req.constraints);
    if (App.fit.isEmpty(req.profile) && !constraints.length) return empty('INSUFFICIENT_PROFILE');
    // phase 1 — candidate universe (explicit scope only)
    const inScope = l => !req.scope || ((!req.scope.lotIds || req.scope.lotIds.includes(l.identity.id)) && (!req.scope.blockIds || req.scope.blockIds.includes(l.identity.blockId)));
    const lotDiag = [], scopeOut = [], candidates = [];
    lots.forEach((l, index) => {
      if (!l || !l.identity || !l.identity.id) { lotDiag.push({ code: 'INVALID_LOT', severity: 'WARNING', lotId: null, index, reason: 'MISSING_IDENTITY' }); return; }
      if (l.identity.developmentId !== req.developmentId) { lotDiag.push({ code: 'OTHER_DEVELOPMENT', severity: 'WARNING', lotId: l.identity.id, index, developmentId: l.identity.developmentId ?? null }); return; }
      if (!l.availability) { lotDiag.push({ code: 'INVALID_LOT', severity: 'WARNING', lotId: l.identity.id, index, reason: 'MISSING_AVAILABILITY' }); return; }
      if (!inScope(l)) { scopeOut.push(l.identity.id); return; }
      candidates.push(l);
    });
    if (scopeOut.length) lotDiag.push({ code: 'OUT_OF_SCOPE', severity: 'INFO', reason: 'EXPLICIT_SCOPE', count: scopeOut.length, lotIds: scopeOut });
    const outOfScope = lots.length - candidates.length;
    const profileWarns = App.fit.isEmpty(req.profile) ? [] : App.fit.profileWarnings(req.profile, candidates, fitCfg), conflicts = constraintConflicts(constraints, candidates, policy);
    const ctx = { commercialFreshness: req.commercialFreshness || null, availabilityFreshness: req.availabilityFreshness || null, availabilityPolicy: req.availabilityPolicy || null };
    const fitCtx = App.fit.contextFor(lots, { commercialFreshness: req.commercialFreshness, priceTableVersion: (req.dataVersions || {}).priceTableVersion, analysisVersion: (req.dataVersions || {}).analysisVersion });
    const exclusion = {}, impact = new Map(constraints.map(c => [c.id, { constraintId: c.id, key: c.key, rejectedCount: 0, unknownCount: 0 }]));
    const excl = code => { exclusion[code] = (exclusion[code] || 0) + 1; };
    const scored = [], review = [], warnings = new Set(), excluded = [], allowed = Object.freeze([...allowedStatuses(policy, ctx)]);
    let ineligible = 0, lowFit = 0;
    for (const lot of candidates) {
      // phase 2 — system eligibility (short-circuit: SOLD etc. never reach constraints or Fit)
      const sys = systemEligibility(lot, policy, ctx);
      if (sys.status === 'INELIGIBLE') {
        ineligible++; excl(sys.reasonCode);
        const stale = sys.reasonCode === 'STALE_AVAILABILITY';
        excluded.push({ lotId: lot.identity.id, code: lot.identity.code, stage: 'SYSTEM_ELIGIBILITY', reasonCode: sys.reasonCode, constraintId: null, constraintKey: null, metricKey: stale ? 'availability.freshness' : 'availability.status', operator: stale ? 'EQ' : 'IN',
          actualValue: stale ? 'STALE' : lot.availability.status, expectedValue: stale ? 'FRESH' : allowed, constraintLabel: null, dataStatus: App.model.getFieldProvenance(lot, 'availability.status').status, availabilityStatus: lot.availability.status, constraintResults: [] });
        continue;
      }
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
      if (failed) {
        ineligible++; excl(failed.reasonCode);
        excluded.push({ lotId: lot.identity.id, code: lot.identity.code, stage: 'HARD_CONSTRAINT', reasonCode: failed.reasonCode, constraintId: failed.constraintId, constraintKey: failed.key, metricKey: failed.metricKey, operator: failed.operator,
          actualValue: failed.actualValue, expectedValue: failed.expectedValue, constraintLabel: (policy.constraints[failed.key] || {}).label || null, constraintStatus: failed.status, dataStatus: failed.dataStatus, availabilityStatus: lot.availability.status, constraintResults: results });
        continue;
      }
      // phase 4 — data quality gating (offline: commercial confirmation required)
      if (req.offline && policy.offlinePolicy === 'COMMERCIAL_CONFIRMATION_REQUIRED') { warnings.add('COMMERCIAL_CONFIRMATION_REQUIRED'); }
      // phase 5 — Fit (only for lots still eligible or reviewable)
      const fit = App.fit.isEmpty(req.profile) ? null : App.fit.fitLot(req.profile, lot, fitCfg, fitCtx);
      const item = { lotId: lot.identity.id, code: lot.identity.code, fitScore: fit ? fit.fitScore : null, coverage: fit ? fit.coverage : 1, confidence: fit ? fit.confidence.value : null, fitConfidence: fit ? fit.confidence.level : 'UNKNOWN',
        keyReasonCodes: [], constraintSummary: { passed: results.filter(r => r.status === 'PASS').length, unknown: results.filter(r => r.status === 'UNKNOWN').map(r => r.reasonCode), total: constraints.length }, constraintResults: results,
        eligibility: sys.status,
        commercialFreshness: ctx.commercialFreshness, availabilityStatus: lot.availability.status, warnings: warns, reviewReasons, fit };
      if (fit && fit.status === 'FAILED') reviewReasons.push('FIT_FAILED'); // a failed calculation is never a low Fit
      if (fit && fit.fitScore != null && fit.coverage < policy.minFitCoverage) reviewReasons.push('LOW_FIT_COVERAGE');
      if (fit && fit.confidence.value != null && fit.confidence.value < policy.minFitConfidence) reviewReasons.push('LOW_FIT_CONFIDENCE');
      if (reviewReasons.length) { review.push(item); continue; }
      if (fit && (fit.fitScore == null || fit.fitScore < policy.minimumFitScore)) {
        lowFit++; excl('LOW_FIT');
        excluded.push({ lotId: lot.identity.id, code: lot.identity.code, stage: 'FIT_THRESHOLD', reasonCode: 'LOW_FIT', constraintId: null, constraintKey: null, metricKey: null, operator: 'GTE', actualValue: fit.fitScore, expectedValue: policy.minimumFitScore,
          constraintLabel: null, dataStatus: null, availabilityStatus: lot.availability.status, constraintResults: results, fitScore: fit.fitScore, coverage: fit.coverage, confidence: fit.confidence.value, fitConfidence: fit.confidence.level, warnings: warns, fit });
        continue;
      }
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
    const reviewSummary = { byPrimaryReason: {}, byCategory: {} };
    for (const it of review) { const p = primaryReviewReason(it.reviewReasons, policy), c = reviewCategoryOf(p, policy); reviewSummary.byPrimaryReason[p] = (reviewSummary.byPrimaryReason[p] || 0) + 1; reviewSummary.byCategory[c] = (reviewSummary.byCategory[c] || 0) + 1; }
    const reviewCandidates = policy.reviewBucketEnabled ? review.slice(0, policy.reviewLimit).map((it, i) => { const p = primaryReviewReason(it.reviewReasons, policy); return { ...it, rank: i + 1, tier: 'REVIEW_REQUIRED', keyReasonCodes: [...new Set(it.reviewReasons)], primaryReviewReason: p, reviewCategory: reviewCategoryOf(p, policy) }; }) : [];
    const status = !recs.length ? (scored.length || lowFit ? 'NO_STRONG_RECOMMENDATION' : 'NO_ELIGIBLE_LOTS') : primary ? 'SUCCESS' : 'NO_STRONG_RECOMMENDATION';
    const overflow = { eligibleLotIds: scored.slice(recs.length).map(x => x.lotId), reviewLotIds: review.slice(reviewCandidates.length).map(x => x.lotId) };
    return Object.freeze({ ...base, status, candidateCount: candidates.length, eligibleCount: scored.length + lowFit, reviewRequiredCount: review.length, ineligibleCount: ineligible, outOfScopeCount: outOfScope, lowFitCount: lowFit,
      recommendations: recs, reviewCandidates, reviewTotal: review.length, exclusionSummary: policy.exclusionSummaryEnabled ? exclusion : {}, constraintImpact: [...impact.values()].sort((a, b) => b.rejectedCount - a.rejectedCount || a.key.localeCompare(b.key)),
      warnings: [...warnings], diagnostics: [...vp.warnings, ...vc.warnings, ...profileWarns, ...conflicts, ...lotDiag], excluded, conflicts, reviewSummary, overflow });
  }
  /** ids that should stand out on the map (recommended first, else the review shortlist) */
  const mapIds = r => r ? (r.recommendations.length ? r.recommendations : r.reviewCandidates).map(x => x.lotId) : [];
  /** ExcludedLotDetail of one lot (or null when the lot was not excluded) */
  const excludedOf = (r, lotId) => (r && r.excluded || []).find(x => x.lotId === lotId) || null;
  return Object.freeze({ OPERATORS: Object.keys(OPERATORS), ON_UNKNOWN, TIERS, REVIEW_CATEGORIES: REVIEW_CATEGORY_ORDER, ConstraintEvaluatorRegistry, policyOf, constraint, validateConstraints, constraintConflicts, evaluateConstraint, systemEligibility,
    reviewCategoryOf, primaryReviewReason, recommend, cacheKey, mapIds, excludedOf, compare: cmp });
})();
