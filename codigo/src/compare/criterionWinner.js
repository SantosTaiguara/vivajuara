/* compare/criterionWinner.js — topic 25: winner per criterion, as a separate evaluation over the topic-24 snapshot.
   App.compare.evaluation: WinnerSemantics · CriterionEvaluationDefinition · TiePolicy · MarginPolicy · DataSufficiencyPolicy ·
     Stale/Conflict/Confidence policies · ComparisonEvaluationPolicyRegistry (config/compare/<dev>.json) · ContextualPreferenceResolver ·
     CriterionEvaluationProfiles · dependency registry · ComparisonEvaluationService (evaluate) → CriterionEvaluationResult with
     CandidateCriterionAssessment, PairwiseDelta, WinnerExplanation → ComparisonEvaluationSnapshot · ComparativeHighlightSelector.
   App.compare.viewModel: ComparisonViewModel / EvaluatedComparisonViewModel (text in pt-BR is produced here, never in the domain).

   Golden rules: no winner without registered semantics, enough valid values, compatible units/versions, a valid policy and a
   material difference. No generic max/min. Ties are never broken by lot id or at random. Raw precision (money in cents) is
   compared, never the rounded display. A single valid value never wins. Conflicted data never wins. Unknown is never 0.
   There is no overall best lot and the count of wins is never a ranking. Policy errors fail closed (no highlight). */
App.compare = App.compare || {};
App.compare.evaluation = (() => {
  const D = App.compare.domain;
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const WinnerSemantics = E('HIGHER_IS_PREFERRED', 'LOWER_IS_PREFERRED', 'ORDERED_ENUM', 'BOOLEAN_TRUE_PREFERRED', 'BOOLEAN_FALSE_PREFERRED', 'TARGET_RANGE_PREFERRED', 'TARGET_VALUE_PREFERRED', 'CONTEXTUAL_PREFERENCE', 'NON_ORDERED', 'INFORMATIONAL', 'NO_WINNER');
  const EvaluationStatus = E('WINNER', 'TIE', 'NO_CLEAR_WINNER', 'NOT_COMPARABLE', 'INSUFFICIENT_DATA', 'CONTEXT_REQUIRED', 'SUPPRESSED', 'ERROR');
  const AssessmentState = E('BEST', 'CO_BEST', 'CLOSE', 'NEUTRAL', 'WEAKER', 'NO_DATA', 'UNKNOWN', 'CONFLICTED', 'STALE_REVIEW', 'NOT_APPLICABLE');
  const TieType = E('EXACT', 'ABSOLUTE_TOLERANCE', 'RELATIVE_TOLERANCE', 'ABSOLUTE_OR_RELATIVE', 'TARGET_DISTANCE', 'CUSTOM');
  const BelowThreshold = E('TIE', 'NO_CLEAR_WINNER', 'SUPPRESS_HIGHLIGHT');
  const EvaluationStalePolicy = E('ALLOW_WITH_WARNING', 'SUPPRESS_WINNER', 'EXCLUDE_STALE_CANDIDATE', 'REQUIRE_REFRESH');
  const EvaluationConflictPolicy = E('SUPPRESS_METRIC', 'EXCLUDE_CONFLICTED', 'ALLOW_WITH_WARNING');
  const EvaluationConfidence = E('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');
  const SuppressionReason = E('INSUFFICIENT_VALID_VALUES', 'MISSING_CONTEXT', 'STALE_DATA', 'CONFLICTED_DATA', 'LOW_CONFIDENCE', 'NON_ORDERED_METRIC', 'NO_MATERIAL_DIFFERENCE', 'VERSION_MISMATCH', 'POLICY_DISABLED', 'NOT_APPLICABLE', 'UNKNOWN_SEMANTICS', 'PARTIAL_DATA', 'INVALID_VALUE');
  const ComparativeAdvantage = E('CLEAR', 'SLIGHT', 'NONE', 'TIED', 'UNKNOWN');
  const CellState = E('WINNER', 'CO_WINNER', 'CLOSE', 'NORMAL', 'WEAKER', 'NO_DATA', 'STALE', 'CONFLICTED', 'SUPPRESSED');
  const ReasonCode = E('LOWEST_VALUE', 'HIGHEST_VALUE', 'CLOSE_TO_TARGET', 'WITHIN_TARGET_RANGE', 'HIGHEST_ORDERED_CATEGORY', 'PREFERRED_BOOLEAN_VALUE', 'ONLY_VALID_CANDIDATE_SUPPRESSED', 'TIED_TOP_VALUE', 'ALL_TIED',
    'NO_MATERIAL_DIFFERENCE', 'STALE_SUPPRESSION', 'CONFLICT_SUPPRESSION', 'LOW_CONFIDENCE_SUPPRESSION', 'PARTIAL_DATA_SUPPRESSION', 'INSUFFICIENT_DATA', 'CONTEXT_REQUIRED', 'NOT_ORDERED', 'INFORMATIONAL_ONLY', 'VERSION_MISMATCH', 'EVALUATION_ERROR');
  const ErrorType = E('INVALID_METRIC_POLICY', 'MISSING_ORDER_MAP', 'MISSING_CONTEXT', 'INSUFFICIENT_DATA', 'UNIT_MISMATCH', 'INVALID_VALUE', 'VERSION_MISMATCH', 'EVALUATION_ERROR');
  const CONF_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  /** precision policy (centralized): values are compared raw; money in integer cents; float comparisons with EPS */
  const PRECISION = Object.freeze({ EPS: 1e-9, MONEY_FACTOR: 100 });
  const ORDERED = new Set(['HIGHER_IS_PREFERRED', 'LOWER_IS_PREFERRED', 'ORDERED_ENUM', 'BOOLEAN_TRUE_PREFERRED', 'BOOLEAN_FALSE_PREFERRED', 'TARGET_RANGE_PREFERRED', 'TARGET_VALUE_PREFERRED']);
  const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const AUDIENCES = new Set(['client', 'presentation', 'broker', 'technical']);

  // ---------------------------------------------------------------- ComparisonEvaluationPolicyRegistry
  const EMPTY_REG = Object.freeze({ evaluationPolicyVersion: null, criteria: {}, tiePolicies: {}, marginPolicies: {}, dataSufficiencyPolicies: {}, stalePolicies: {}, conflictPolicies: {}, confidencePolicies: {}, contextualResolvers: {}, evaluationProfiles: {}, dependencies: {}, highlights: { max: {} } });
  const regCache = new Map();
  /** registry(devId, override?) → validated registry; invalid criteria are kept with `invalid` so they fail closed */
  function registry(devId, override) {
    if (!override && regCache.has(devId)) return regCache.get(devId);
    const raw = override || (App.configs && App.configs.compare && App.configs.compare[devId]) || EMPTY_REG, reg = { ...EMPTY_REG, ...raw, errors: [] };
    const criteria = {};
    for (const [id, c] of Object.entries(raw.criteria || {})) {
      const errs = [];
      if (!WinnerSemantics[c.winnerSemantics]) errs.push('UNKNOWN_SEMANTICS');
      if (ORDERED.has(c.winnerSemantics) || c.winnerSemantics === 'CONTEXTUAL_PREFERENCE') {
        for (const [k, coll] of [['tiePolicyId', 'tiePolicies'], ['marginPolicyId', 'marginPolicies'], ['dataSufficiencyPolicyId', 'dataSufficiencyPolicies']]) if (!c[k] || !(reg[coll] || {})[c[k]]) errs.push('MISSING_' + k);
        if (c.winnerSemantics === 'ORDERED_ENUM' && !c.orderMap) errs.push('MISSING_ORDER_MAP');
        if (c.winnerSemantics === 'CONTEXTUAL_PREFERENCE' && !(reg.contextualResolvers || {})[c.contextualResolverId]) errs.push('MISSING_RESOLVER');
      }
      criteria[id] = Object.freeze({ ...c, invalid: errs.length ? errs : null });
      if (errs.length) reg.errors.push({ metricId: id, errors: errs });
    }
    reg.criteria = criteria;
    const out = Object.freeze(reg);
    if (!override) regCache.set(devId, out);
    return out;
  }
  /** CriterionEvaluationDefinition: the metric's policy, with the evaluation profile's overrides (no field key duplicated) */
  function definitionOf(metricId, reg, evaluationProfileId) {
    const base = reg.criteria[metricId]; if (!base) return null;
    const ov = (((reg.evaluationProfiles || {})[evaluationProfileId] || {}).metricPolicyOverrides || {})[metricId] || {};
    const c = { ...base, ...ov };
    return Object.freeze({ metricId, winnerSemantics: c.winnerSemantics, direction: c.winnerSemantics === 'LOWER_IS_PREFERRED' ? 'LOWER' : c.winnerSemantics === 'HIGHER_IS_PREFERRED' ? 'HIGHER' : null, orderMap: c.orderMap || null,
      targetRange: c.targetRange || null, targetValue: c.targetValue ?? null, contextualResolverId: c.contextualResolverId || null, marginPolicyId: c.marginPolicyId || null, tiePolicyId: c.tiePolicyId || null,
      dataSufficiencyPolicyId: c.dataSufficiencyPolicyId || null, confidencePolicyId: c.confidencePolicyId || 'default', stalePolicyId: c.stalePolicyId || 'none', conflictPolicyId: c.conflictPolicyId || 'default',
      clientModeBehavior: 'CLEAR_ONLY', brokerModeBehavior: 'SHOW_SLIGHT_WITH_CAVEAT', technicalModeBehavior: 'SHOW_POLICY_DETAILS', explanationTemplateId: c.explanationTemplateId || null,
      customerContextRequired: !!c.customerContextRequired, phrase: c.phrase || null, phraseTarget: c.phraseTarget || null, caveats: c.caveats || [], dedupGroup: c.dedupGroup || null, highlight: c.highlight !== false,
      validRange: c.validRange || null, invalid: base.invalid, note: c.note || null, version: reg.evaluationPolicyVersion });
  }

  // ---------------------------------------------------------------- ContextualPreferenceResolver (no silent default)
  /** resolvePreference(def, ctx) → ResolvedCriterionPreference | null. ctx = { contextMode, customerProfile, evaluationProfileId, reg }.
      Uses only the customer's explicit preferences (never hard constraints, never the customer's identity). */
  function resolvePreference(def, ctx) {
    const resolver = (ctx.reg.contextualResolvers || {})[def.contextualResolverId]; if (!resolver) return null;
    const prefs = ((ctx.customerProfile && ctx.customerProfile.preferences) || []).filter(p => p && p.enabled !== false);
    for (const r of resolver.rules || []) {
      let target = null, source = null;
      if (r.preferenceKey) { const p = prefs.find(x => x.key === r.preferenceKey); if (!p) continue; source = 'CUSTOMER_PREFERENCE'; if (r.targetFrom === 'preferenceRange') { const t = p.target || {}; if (!Number.isFinite(t.min) && !Number.isFinite(t.max)) continue; target = { min: Number.isFinite(t.min) ? t.min : null, max: Number.isFinite(t.max) ? t.max : null }; } }
      if (r.contextModes) { if (!r.contextModes.includes(ctx.contextMode)) continue; source = source || 'COMPARISON_CONTEXT'; }
      if (r.evaluationProfileId) { if (r.evaluationProfileId !== ctx.evaluationProfileId) continue; source = source || 'EVALUATION_PROFILE'; }
      if (!source) continue; // a rule without a condition would be a silent default
      return Object.freeze({ winnerSemantics: r.winnerSemantics, targetRange: r.winnerSemantics === 'TARGET_RANGE_PREFERRED' ? target : null, targetValue: r.targetValue ?? null, orderMap: r.orderMap || null, valueMap: r.valueMap || null, tiePolicyId: r.tiePolicyId || null, marginPolicyId: r.marginPolicyId || null,
        rationaleCode: r.rationaleCode || null, source, version: ctx.reg.evaluationPolicyVersion });
    }
    return null;
  }

  // ---------------------------------------------------------------- per-criterion evaluation
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  function validValue(m, def, v) {
    if (['MONEY', 'AREA', 'DISTANCE', 'SCORE', 'PERCENTAGE', 'NUMBER'].includes(m.valueType) && !isNum(v)) return false;
    if (m.valueType === 'MONEY' && v < 0) return false;
    if (m.valueType === 'AREA' && v <= 0) return false;
    if (m.valueType === 'DISTANCE' && v < 0) return false;
    if (def.validRange && (v < def.validRange[0] || v > def.validRange[1])) return false;
    return true;
  }
  /** x: the value in "difference space" (raw, money in cents); g: goodness (higher = preferred for this criterion) */
  function keyOf(m, sem, rp, def, v, ctx) {
    const money = m.valueType === 'MONEY', num = x => money ? Math.round(x * PRECISION.MONEY_FACTOR) : x;
    switch (sem) {
      case 'HIGHER_IS_PREFERRED': return validValue(m, def, v) ? { x: num(v), g: num(v) } : null;
      case 'LOWER_IS_PREFERRED': return validValue(m, def, v) ? { x: num(v), g: -num(v) } : null;
      case 'ORDERED_ENUM': { const om = (rp && rp.orderMap) || def.orderMap, o = om ? om[v] : undefined; return isNum(o) ? { x: o, g: o, ordinal: o } : null; }
      case 'BOOLEAN_TRUE_PREFERRED': case 'BOOLEAN_FALSE_PREFERRED': {
        let b;
        if (rp && rp.valueMap === 'offerable') b = App.availability.isOfferable(v, ctx.availabilityPolicy); // UNKNOWN never reaches here (it is an UNKNOWN value)
        else if (typeof v === 'boolean') b = v; else return null;
        const pref = sem === 'BOOLEAN_TRUE_PREFERRED' ? b : !b; return { x: pref ? 1 : 0, g: pref ? 1 : 0 };
      }
      case 'TARGET_RANGE_PREFERRED': {
        const t = (rp && rp.targetRange) || def.targetRange; if (!t || !validValue(m, def, v)) return null;
        const d = t.min != null && v < t.min ? t.min - v : t.max != null && v > t.max ? v - t.max : 0; return { x: d, g: -d, distanceToTarget: d };
      }
      case 'TARGET_VALUE_PREFERRED': {
        const t = rp && rp.targetValue != null ? rp.targetValue : def.targetValue; if (!isNum(t) || !validValue(m, def, v)) return null;
        const d = Math.abs(v - t); return { x: d, g: -d, distanceToTarget: d };
      }
      default: return null;
    }
  }
  const relOf = (diff, base) => base === 0 ? null : diff / Math.abs(base);
  function tied(tp, diff, base) {
    const EPS = PRECISION.EPS, rel = relOf(diff, base);
    switch (tp.type) {
      case 'EXACT': return diff <= EPS;
      case 'ABSOLUTE_TOLERANCE': return diff <= (tp.absoluteTolerance || 0) + EPS;
      case 'RELATIVE_TOLERANCE': return diff <= EPS || (rel != null && rel * 100 <= (tp.relativeTolerancePct || 0) + EPS);
      case 'ABSOLUTE_OR_RELATIVE': return diff <= (tp.absoluteTolerance || 0) + EPS || (rel != null && rel * 100 <= (tp.relativeTolerancePct || 0) + EPS);
      case 'TARGET_DISTANCE': return diff <= (tp.targetDistanceTolerance || 0) + EPS;
      default: return null; // CUSTOM / unknown: fail closed
    }
  }
  function material(mp, diff, base) {
    const EPS = PRECISION.EPS, rel = relOf(diff, base), checks = [];
    if (mp.minimumAbsoluteDifference != null) checks.push(diff + EPS >= mp.minimumAbsoluteDifference);
    if (mp.minimumRelativeDifferencePct != null) checks.push(rel != null && rel * 100 + EPS >= mp.minimumRelativeDifferencePct);
    if (mp.minimumOrdinalStep != null) checks.push(diff + EPS >= mp.minimumOrdinalStep);
    if (mp.targetDistanceDifference != null) checks.push(diff + EPS >= mp.targetDistanceDifference);
    return checks.every(Boolean); // every configured threshold must be met (conservative)
  }
  const capConf = (c, cap) => CONF_RANK[c] > CONF_RANK[cap] ? cap : c;
  const moneyBack = (m, x) => m.valueType === 'MONEY' ? x / PRECISION.MONEY_FACTOR : x;

  /** evaluateCriterion(metricDef, values[], ctx) → CriterionEvaluationResult. Never mutates inputs. */
  function evaluateCriterion(m, values, ctx) {
    const audience = ctx.audience, def = definitionOf(m.id, ctx.reg, ctx.evaluationProfileId);
    const res = { metricId: m.id, evaluationStatus: null, winnerSemantics: def ? def.winnerSemantics : null, resolvedSemantics: null, resolvedPreference: null, winnerCandidateIds: [], assessments: [], tieState: 'NONE',
      marginSummary: null, dataSufficiency: { validCandidates: 0, totalCandidates: values.length, partial: false, requireAll: false }, evaluationConfidence: 'UNKNOWN', comparativeAdvantage: 'UNKNOWN',
      explanation: null, suppressionReasons: [], caveats: [], versionRefs: [...new Set(values.map(v => v.versionRef).filter(Boolean))], error: null, pairwiseDeltas: [],
      policy: def ? { tiePolicyId: def.tiePolicyId, marginPolicyId: def.marginPolicyId, dataSufficiencyPolicyId: def.dataSufficiencyPolicyId, stalePolicyId: def.stalePolicyId, conflictPolicyId: def.conflictPolicyId, confidencePolicyId: def.confidencePolicyId, version: def.version } : null,
      priority: m.priority, highlight: def ? def.highlight : false, phraseTarget: def ? def.phraseTarget : null, dedupGroup: def ? def.dedupGroup || (m.fieldKeyOf ? m.fieldKeyOf(ctx.context || {}) : m.fieldKey) : null, phrase: def ? def.phrase : null };
    const baseAssess = v => ({ candidateId: v.candidateId, metricId: m.id, rawValue: v.rawValue, comparableValue: null, ordinalValue: null, deltaToBest: null, relativeDeltaToBest: null, distanceToTarget: null, rankWithinCriterion: null,
      assessmentState: v.valueStatus === 'NO_DATA' || v.valueStatus === 'ERROR' ? 'NO_DATA' : v.valueStatus === 'UNKNOWN' ? 'UNKNOWN' : v.valueStatus === 'CONFLICTED' ? 'CONFLICTED' : v.valueStatus === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'NEUTRAL',
      freshness: v.freshness, confidence: v.confidence, provenanceStatus: v.provenanceSummary ? v.provenanceSummary.status : null, reasons: [] });
    const finish = (status, reasons = [], reasonCode = null, extra = {}) => {
      res.evaluationStatus = status; res.suppressionReasons = [...new Set([...res.suppressionReasons, ...reasons])];
      if (!res.assessments.length) res.assessments = values.map(baseAssess);
      if (!['WINNER', 'TIE', 'NO_CLEAR_WINNER'].includes(status)) { res.winnerCandidateIds = []; res.comparativeAdvantage = status === 'NOT_COMPARABLE' ? 'NONE' : 'UNKNOWN'; res.evaluationConfidence = 'UNKNOWN'; }
      res.explanation = Object.freeze({ metricId: m.id, winnerCandidateIds: res.winnerCandidateIds.slice(), reasonCode: reasonCode || status, templateId: (def && def.explanationTemplateId) || reasonCode || status, facts: Object.freeze(extra.facts || {}),
        comparisonPhraseKey: 'compare.phrase.' + m.id, caveats: res.caveats.slice(), evidenceRefs: [res.dedupGroup].filter(Boolean) });
      res.assessments = res.assessments.map(a => { const o = { ...a }; delete o.g; delete o.usable; return Object.freeze(o); });
      return Object.freeze(res);
    };
    try {
      if (!def) return finish('NOT_COMPARABLE', ['UNKNOWN_SEMANTICS'], 'INFORMATIONAL_ONLY');
      if (def.invalid) { res.error = { type: def.invalid.includes('MISSING_ORDER_MAP') ? 'MISSING_ORDER_MAP' : 'INVALID_METRIC_POLICY', details: def.invalid }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      let sem = def.winnerSemantics, rp = null;
      if (sem === 'NON_ORDERED') return finish('NOT_COMPARABLE', ['NON_ORDERED_METRIC'], 'NOT_ORDERED');
      if (sem === 'INFORMATIONAL' || sem === 'NO_WINNER') return finish('NOT_COMPARABLE', ['POLICY_DISABLED'], 'INFORMATIONAL_ONLY');
      if ((def.customerContextRequired || m.customerContextRequired) && !ctx.hasCustomer) { res.caveats.push('PROFILE_DEPENDENT'); return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED'); }
      if (values.length && values.every(v => v.comparableState === 'CONTEXT_MISSING')) return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED');
      if (sem === 'CONTEXTUAL_PREFERENCE') {
        rp = resolvePreference(def, ctx);
        if (!rp) { res.caveats.push('PROFILE_DEPENDENT'); return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED'); }
        sem = rp.winnerSemantics; res.resolvedPreference = rp;
      }
      res.resolvedSemantics = sem;
      if (!ORDERED.has(sem)) return finish('NOT_COMPARABLE', ['UNKNOWN_SEMANTICS'], 'INFORMATIONAL_ONLY');
      if (sem === 'ORDERED_ENUM' && !((rp && rp.orderMap) || def.orderMap)) { res.error = { type: 'MISSING_ORDER_MAP' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      const reg = ctx.reg, target = sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED';
      const tp = reg.tiePolicies[(rp && rp.tiePolicyId) || (target && rp ? 'target' : def.tiePolicyId)], mp = reg.marginPolicies[(rp && rp.marginPolicyId) || (target && rp ? 'target' : def.marginPolicyId)], sp = reg.dataSufficiencyPolicies[def.dataSufficiencyPolicyId];
      const stp = (reg.stalePolicies || {})[def.stalePolicyId] || null, cp = (reg.conflictPolicies || {})[def.conflictPolicyId] || { type: 'SUPPRESS_METRIC' }, confp = (reg.confidencePolicies || {})[def.confidencePolicyId] || null;
      if (!tp || !mp || !sp || !TieType[tp.type]) { res.error = { type: 'INVALID_METRIC_POLICY' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      res.policy = { ...res.policy, tie: tp, margin: mp, sufficiency: sp, stale: stp, conflict: cp, confidence: confp, resolvedSemantics: sem };
      // units must match (normalization happens upstream, never here)
      const units = new Set(values.filter(v => v.valueStatus === 'VALID').map(v => v.unit == null ? '∅' : v.unit));
      if (units.size > 1) { res.error = { type: 'UNIT_MISMATCH' }; return finish('SUPPRESSED', ['INVALID_VALUE'], 'EVALUATION_ERROR'); }
      // assessments
      let staleSuppress = false, lowConf = false, conflicted = false, invalid = false, usedStale = false;
      const minConf = confp && confp.minimum ? confp.minimum[audience] : null;
      const assess = values.map(v => {
        const a = baseAssess(v); a.usable = false;
        if (v.valueStatus === 'CONFLICTED') { conflicted = true; a.reasons.push('CONFLICTED_DATA'); return a; }
        if (v.valueStatus !== 'VALID') return a;
        if (sp.allowEstimated === false && a.provenanceStatus === 'ESTIMATED') { a.assessmentState = 'NOT_APPLICABLE'; a.reasons.push('ESTIMATED_NOT_ALLOWED'); return a; }
        const k = keyOf(m, sem, rp, def, v.rawValue, ctx);
        if (!k) { if (sem === 'ORDERED_ENUM') { a.assessmentState = 'UNKNOWN'; a.reasons.push('NOT_IN_ORDER_MAP'); } else { invalid = true; a.assessmentState = 'NOT_APPLICABLE'; a.reasons.push('INVALID_VALUE'); } return a; }
        a.comparableValue = k.x; a.ordinalValue = k.ordinal ?? null; a.distanceToTarget = k.distanceToTarget ?? null; a.g = k.g;
        if (v.freshness === 'STALE' || v.freshness === 'EXPIRED') {
          const action = !stp ? 'ALLOW_WITH_WARNING' : v.freshness === 'EXPIRED' ? stp.expired : stp[audience];
          a.reasons.push('STALE_VALUE');
          if (action === 'SUPPRESS_WINNER' || action === 'REQUIRE_REFRESH' || sp.allowStale === false) { staleSuppress = true; if (action === 'REQUIRE_REFRESH') { a.assessmentState = 'STALE_REVIEW'; return a; } }
          else if (action === 'EXCLUDE_STALE_CANDIDATE') { a.assessmentState = 'STALE_REVIEW'; return a; }
          else usedStale = true;
        }
        if (minConf && a.confidence && CONF_RANK[a.confidence] < CONF_RANK[minConf]) { lowConf = true; a.reasons.push('LOW_CONFIDENCE'); }
        a.usable = true; return a;
      });
      res.assessments = assess;
      const usable = assess.filter(a => a.usable);
      res.dataSufficiency = { validCandidates: usable.length, totalCandidates: values.length, partial: usable.length < values.length, requireAll: !!(sp.requireAllCandidates || (sp.requireAllCandidatesFor || []).includes(audience)) };
      if (invalid) return finish('SUPPRESSED', ['INVALID_VALUE'], 'EVALUATION_ERROR');
      if (conflicted && cp.type === 'SUPPRESS_METRIC') { res.caveats.push('CONFLICTED_DATA'); return finish('SUPPRESSED', ['CONFLICTED_DATA'], 'CONFLICT_SUPPRESSION'); }
      if (usable.length < (sp.minValidCandidates || 2)) return finish('INSUFFICIENT_DATA', ['INSUFFICIENT_VALID_VALUES'], usable.length === 1 ? 'ONLY_VALID_CANDIDATE_SUPPRESSED' : 'INSUFFICIENT_DATA', { facts: { validCandidateCount: usable.length, totalCandidateCount: values.length } });
      if (res.dataSufficiency.partial && res.dataSufficiency.requireAll) { res.caveats.push('PARTIAL_DATA'); return finish('SUPPRESSED', ['PARTIAL_DATA', 'INSUFFICIENT_VALID_VALUES'], 'PARTIAL_DATA_SUPPRESSION', { facts: { validCandidateCount: usable.length, totalCandidateCount: values.length } }); }
      if (staleSuppress) { res.caveats.push('STALE_VALUE'); return finish('SUPPRESSED', ['STALE_DATA'], 'STALE_SUPPRESSION'); }
      if (lowConf) return finish('SUPPRESSED', ['LOW_CONFIDENCE'], 'LOW_CONFIDENCE_SUPPRESSION');
      if (sp.requireSameVersion && m.versionCoherence) { const refs = new Set(usable.map(a => values.find(v => v.candidateId === a.candidateId).versionRef).filter(Boolean)); if (refs.size > 1) return finish('SUPPRESSED', ['VERSION_MISMATCH'], 'VERSION_MISMATCH'); }
      if (res.dataSufficiency.partial) res.caveats.push('PARTIAL_DATA');
      if (usedStale) res.caveats.push('STALE_VALUE');
      for (const c of def.caveats || []) if (!res.caveats.includes(c)) res.caveats.push(c);
      // ordering: by goodness only (candidate order keeps output stable; lot id never breaks a tie)
      const bestG = Math.max(...usable.map(a => a.g)), best = usable.find(a => Math.abs(a.g - bestG) <= PRECISION.EPS);
      const diffTo = (a, b) => Math.abs(a.comparableValue - b.comparableValue);
      const baseOf = a => sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED' ? 0 : a.comparableValue;
      const tieRes = a => tied(tp, diffTo(best, a), baseOf(best));
      if (usable.some(a => tieRes(a) === null)) { res.error = { type: 'INVALID_METRIC_POLICY' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      const coBest = usable.filter(a => tieRes(a));
      for (const a of usable) { a.rankWithinCriterion = 1 + usable.filter(b => b.g > a.g + PRECISION.EPS).length; a.deltaToBest = moneyBack(m, a.comparableValue - best.comparableValue); a.relativeDeltaToBest = relOf(a.comparableValue - best.comparableValue, best.comparableValue); }
      let status, reasonCode, facts = { validCandidateCount: usable.length, totalCandidateCount: values.length, unit: m.unit };
      const winnerCode = { HIGHER_IS_PREFERRED: 'HIGHEST_VALUE', LOWER_IS_PREFERRED: 'LOWEST_VALUE', ORDERED_ENUM: 'HIGHEST_ORDERED_CATEGORY', BOOLEAN_TRUE_PREFERRED: 'PREFERRED_BOOLEAN_VALUE', BOOLEAN_FALSE_PREFERRED: 'PREFERRED_BOOLEAN_VALUE',
        TARGET_RANGE_PREFERRED: 'WITHIN_TARGET_RANGE', TARGET_VALUE_PREFERRED: 'CLOSE_TO_TARGET' }[sem];
      if (coBest.length === usable.length) {
        status = 'TIE'; res.tieState = 'ALL_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'ALL_TIED'; res.winnerCandidateIds = coBest.map(a => a.candidateId);
        coBest.forEach(a => { a.assessmentState = 'CO_BEST'; });
      } else if (coBest.length >= 2) {
        status = 'TIE'; res.tieState = 'TOP_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'TIED_TOP_VALUE'; res.winnerCandidateIds = coBest.map(a => a.candidateId);
        usable.forEach(a => { a.assessmentState = coBest.includes(a) ? 'CO_BEST' : 'WEAKER'; });
      } else {
        const others = usable.filter(a => a !== best), runner = others.reduce((r, a) => (r == null || a.g > r.g + PRECISION.EPS ? a : r), null);
        const diff = diffTo(best, runner), base = sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED' ? 0 : runner.comparableValue, isMat = material(mp, diff, base);
        res.marginSummary = { absoluteDifference: moneyBack(m, diff), relativeDifferencePct: relOf(diff, base) == null ? null : relOf(diff, base) * 100, material: isMat, runnerUpCandidateId: runner.candidateId };
        facts = { ...facts, winnerCandidateId: best.candidateId, winnerValue: best.rawValue, runnerUpCandidateId: runner.candidateId, runnerUpValue: runner.rawValue, absoluteDifference: res.marginSummary.absoluteDifference,
          relativeDifferencePct: res.marginSummary.relativeDifferencePct, target: rp ? rp.targetRange || rp.targetValue : def.targetRange || def.targetValue };
        if (isMat) {
          status = 'WINNER'; res.comparativeAdvantage = 'CLEAR'; reasonCode = winnerCode === 'WITHIN_TARGET_RANGE' && best.distanceToTarget > 0 ? 'CLOSE_TO_TARGET' : winnerCode; res.winnerCandidateIds = [best.candidateId];
          usable.forEach(a => { a.assessmentState = a === best ? 'BEST' : 'WEAKER'; });
        } else {
          const below = BelowThreshold[mp.resultBelowThreshold] || 'NO_CLEAR_WINNER';
          const close = usable.filter(a => !material(mp, diffTo(best, a), base === 0 ? 0 : a.comparableValue));
          if (below === 'SUPPRESS_HIGHLIGHT') return finish('SUPPRESSED', ['NO_MATERIAL_DIFFERENCE'], 'NO_MATERIAL_DIFFERENCE', { facts });
          if (below === 'TIE') { status = 'TIE'; res.tieState = close.length === usable.length ? 'ALL_TIED' : 'TOP_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'TIED_TOP_VALUE'; res.winnerCandidateIds = close.map(a => a.candidateId); usable.forEach(a => { a.assessmentState = close.includes(a) ? 'CO_BEST' : 'WEAKER'; }); }
          else { status = 'NO_CLEAR_WINNER'; res.comparativeAdvantage = 'SLIGHT'; reasonCode = 'NO_MATERIAL_DIFFERENCE'; res.suppressionReasons.push('NO_MATERIAL_DIFFERENCE'); res.slightAdvantageCandidateId = best.candidateId; usable.forEach(a => { a.assessmentState = close.includes(a) ? 'CLOSE' : 'WEAKER'; }); }
        }
      }
      // confidence of the result: inputs, missing data, freshness, margin and context certainty
      let conf = 'HIGH';
      for (const a of usable) if (a.confidence && CONF_RANK[a.confidence] < CONF_RANK[conf]) conf = a.confidence;
      if (res.dataSufficiency.partial || usedStale || status === 'NO_CLEAR_WINNER' || (rp && rp.source === 'EVALUATION_PROFILE')) conf = capConf(conf, 'MEDIUM');
      res.evaluationConfidence = conf;
      // PairwiseDelta: each candidate against the reference (best, or the selected candidate) — not N²
      const refId = ctx.referenceCandidateId && usable.some(a => a.candidateId === ctx.referenceCandidateId) ? ctx.referenceCandidateId : best.candidateId, ref = usable.find(a => a.candidateId === refId);
      res.pairwiseDeltas = usable.filter(a => a !== ref).map(a => {
        const d = a.comparableValue - ref.comparableValue, ad = Math.abs(d), rel = relOf(d, ref.comparableValue);
        return Object.freeze({ metricId: m.id, candidateA: ref.candidateId, candidateB: a.candidateId, rawDelta: moneyBack(m, d), absoluteDelta: moneyBack(m, ad), relativeDeltaPct: rel == null ? null : rel * 100,
          direction: Math.abs(a.g - ref.g) <= PRECISION.EPS ? 'EQUAL' : a.g > ref.g ? 'B_PREFERRED' : 'A_PREFERRED', comparable: true,
          materiality: tied(tp, ad, baseOf(ref)) ? 'WITHIN_TIE' : material(mp, ad, sem.startsWith('TARGET') ? 0 : a.comparableValue) ? 'MATERIAL' : 'BELOW_MARGIN' });
      });
      return finish(status, [], reasonCode, { facts });
    } catch (e) {
      res.error = { type: 'EVALUATION_ERROR', message: String(e && e.message || e) };
      res.assessments = values.map(baseAssess);
      return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR');
    }
  }

  // ---------------------------------------------------------------- ComparisonEvaluationService → ComparisonEvaluationSnapshot
  const cache = new Map(), LOG = [];
  /** evaluate(snapshot, { audience, customerProfile, evaluationProfileId, metricIds, previous, referenceCandidateId, reg, now }) */
  function evaluate(snap, opts = {}) {
    const audience = AUDIENCES.has(opts.audience) ? opts.audience : 'broker', reg = opts.reg || registry(snap.developmentId);
    const evaluationProfileId = opts.evaluationProfileId || snap.metricProfileId, ctxMode = snap.contextRef.mode;
    const hasCustomer = !!snap.contextRef.customerProfileVersion, prefsOk = hasCustomer && !!opts.customerProfile; // Fit comes from upstream; preferences only resolve contextual metrics
    const prefsKey = prefsOk ? D.hash((opts.customerProfile.preferences || []).filter(p => p.enabled !== false).map(p => [p.key, p.target ?? null])) : null;
    const contextHash = D.hash({ ctx: snap.contextRef.hash, audience, evaluationProfileId, prefsKey, ref: opts.referenceCandidateId || null });
    const metricIds = (opts.metricIds || snap.metricOrder).filter(id => snap.valuesByMetric[id] && D.metric(id) && D.visibleFor(D.metric(id), audience));
    const key = [snap.hash, reg.evaluationPolicyVersion, contextHash, (D.profile(snap.metricProfileId) || {}).version, D.hash(metricIds), D.hash(metricIds.map(id => snap.valuesByMetric[id].map(v => [v.rawValue, v.valueStatus, v.freshness, v.confidence])))].join('|');
    if (!opts.noCache && cache.has(key)) return Object.freeze({ ...cache.get(key), recomputedMetricIds: [] }); // same inputs + same policies = same result
    const ctx = { audience, reg, evaluationProfileId, contextMode: ctxMode, hasCustomer, customerProfile: prefsOk ? { preferences: opts.customerProfile.preferences || [] } : null,
      availabilityPolicy: App.availability.policyOf((App.config && App.config.DEVELOPMENTS && App.config.DEVELOPMENTS[snap.developmentId]) || null), referenceCandidateId: opts.referenceCandidateId || null, context: snap.context };
    const prev = opts.previous && opts.previous.developmentId === snap.developmentId ? opts.previous : null;
    const metricResults = {}, inputKeys = {}, recomputed = [];
    for (const id of metricIds) {
      const deps = ((reg.dependencies || {})[id] || []).map(k => [k, snap.dataVersions[k] ?? null]);
      const values = snap.valuesByMetric[id];
      const ik = D.hash({ v: values.map(v => [v.candidateId, v.rawValue, v.valueStatus, v.freshness, v.confidence, v.versionRef, v.comparableState]), deps, contextHash, pv: reg.evaluationPolicyVersion });
      inputKeys[id] = ik;
      if (prev && prev.inputKeys && prev.inputKeys[id] === ik && prev.metricResults[id]) { metricResults[id] = prev.metricResults[id]; continue; }
      metricResults[id] = evaluateCriterion(D.metric(id), values, ctx); recomputed.push(id);
      LOG.push({ metricId: id, evaluationStatus: metricResults[id].evaluationStatus, policyVersion: reg.evaluationPolicyVersion, suppressionReasons: metricResults[id].suppressionReasons.slice(), candidateCount: values.length });
      if (LOG.length > 200) LOG.shift();
    }
    const results = metricIds.map(id => metricResults[id]);
    const evaluable = results.filter(r => r.evaluationStatus !== 'NOT_COMPARABLE' && r.evaluationStatus !== 'CONTEXT_REQUIRED');
    const errors = results.filter(r => r.evaluationStatus === 'ERROR');
    const status = !snap.candidateIds.length ? 'SUPPRESSED' : errors.length && errors.length === evaluable.length ? 'ERROR' : evaluable.length && evaluable.every(r => ['SUPPRESSED', 'INSUFFICIENT_DATA', 'ERROR'].includes(r.evaluationStatus)) ? 'SUPPRESSED'
      : evaluable.some(r => ['SUPPRESSED', 'INSUFFICIENT_DATA', 'ERROR'].includes(r.evaluationStatus) || r.dataSufficiency.partial) ? 'PARTIAL' : 'READY';
    const counts = {}; for (const r of results) counts[r.evaluationStatus] = (counts[r.evaluationStatus] || 0) + 1;
    const out = Object.freeze({ id: 'cmpe_' + D.hash({ s: snap.hash, c: contextHash, p: reg.evaluationPolicyVersion, m: metricIds }), comparisonSnapshotId: snap.id, comparisonSnapshotHash: snap.hash, developmentId: snap.developmentId,
      candidateIds: snap.candidateIds.slice(), metricOrder: metricIds, metricResults: Object.freeze(metricResults), inputKeys: Object.freeze(inputKeys), recomputedMetricIds: recomputed,
      generatedAt: opts.now || snap.generatedAt, evaluationPolicyVersion: reg.evaluationPolicyVersion, evaluationProfileId, audience, contextHash, status,
      summary: Object.freeze({ counts, candidateSummaries: candidateSummaries(snap.candidateIds, results) }), registryErrors: reg.errors || [] });
    cache.set(key, out); if (cache.size > 30) cache.delete(cache.keys().next().value);
    return out;
  }
  /** CandidateCriterionSummary: counts per lot — never turned into a ranking or an overall winner */
  function candidateSummaries(ids, results) {
    return ids.map(id => {
      const s = { candidateId: id, clearWins: 0, coWins: 0, slightAdvantages: 0, suppressedMetrics: 0, noDataMetrics: 0, clearWinMetricIds: [] };
      for (const r of results) {
        if (r.evaluationStatus === 'WINNER' && r.winnerCandidateIds.includes(id)) { s.clearWins++; s.clearWinMetricIds.push(r.metricId); }
        else if (r.evaluationStatus === 'TIE' && r.tieState === 'TOP_TIED' && r.winnerCandidateIds.includes(id)) s.coWins++;
        else if (r.evaluationStatus === 'NO_CLEAR_WINNER' && r.slightAdvantageCandidateId === id) s.slightAdvantages++;
        if (['SUPPRESSED', 'INSUFFICIENT_DATA'].includes(r.evaluationStatus)) s.suppressedMetrics++;
        const a = r.assessments.find(x => x.candidateId === id); if (a && ['NO_DATA', 'UNKNOWN'].includes(a.assessmentState)) s.noDataMetrics++;
      }
      return Object.freeze(s);
    });
  }
  /** ComparativeHighlightSelector: top facts (priority + clear advantage + confidence), deduplicated, 3–5 max, grouped by lot — no champion */
  function highlights(ev, opts = {}) {
    const audience = opts.audience || ev.audience, reg = opts.reg || registry(ev.developmentId);
    const max = opts.max || ((reg.highlights || {}).max || {})[audience] || (audience === 'client' || audience === 'presentation' ? 3 : 5);
    const safe = audience === 'client' || audience === 'presentation';
    const cand = ev.metricOrder.map(id => ev.metricResults[id]).filter(r => r.evaluationStatus === 'WINNER' && r.highlight && r.evaluationConfidence !== 'LOW' && r.evaluationConfidence !== 'UNKNOWN'
      && !(safe && (r.caveats.includes('STALE_VALUE') || r.caveats.includes('PARTIAL_DATA'))))
      .map((r, i) => ({ r, i })).sort((a, b) => (PRIORITY_RANK[a.r.priority] ?? 9) - (PRIORITY_RANK[b.r.priority] ?? 9) || CONF_RANK[b.r.evaluationConfidence] - CONF_RANK[a.r.evaluationConfidence] || a.i - b.i);
    const used = new Set(), picked = [];
    for (const { r } of cand) {
      const k = r.winnerCandidateIds[0] + '|' + (r.dedupGroup || r.metricId); if (used.has(k)) continue; // e.g. "menor preço" + "menor R$/m²" for the same lot
      used.add(k); picked.push(r); if (picked.length >= max) break;
    }
    return ev.candidateIds.map(id => ({ candidateId: id, metricIds: picked.filter(r => r.winnerCandidateIds[0] === id).map(r => r.metricId) })).filter(x => x.metricIds.length);
  }
  /** share-safe facts: only clear, fresh, complete, non-low-confidence highlights; records the policy version */
  function shareFacts(ev, { names = {}, labelOf = id => id } = {}) {
    const hs = highlights(ev, { audience: 'client' });
    const lines = hs.map(h => `${names[h.candidateId] || h.candidateId}: ${h.metricIds.map(id => phraseOf(ev.metricResults[id], labelOf(id))).join('; ')}`);
    return { lines, evaluationPolicyVersion: ev.evaluationPolicyVersion, evaluationSnapshotId: ev.id, comparisonSnapshotId: ev.comparisonSnapshotId };
  }
  const phraseOf = (r, label) => {
    let p = r.phrase || ('destaque em ' + label);
    if ((r.resolvedSemantics === 'TARGET_RANGE_PREFERRED' || r.resolvedSemantics === 'TARGET_VALUE_PREFERRED') && r.phraseTarget) p = r.phraseTarget;
    return p.replace('{label}', label);
  };

  /** Adapter for the legacy App.services.comparison.compare(items, rows): rows declare a fieldKey; winners come only from the
      registered semantics (fail closed: a row without a registered metric has no winner). */
  function legacyRowWinners(items, rows, opts = {}) {
    const devId = (items[0] && items[0].identity && items[0].identity.developmentId) || 'viva-juara', reg = registry(devId), ctx0 = D.normalizeContext({ scoreKey: opts.scoreKey });
    const byField = new Map(D.METRICS.filter(m => m.fieldKey).map(m => [m.fieldKey, m]));
    const ctx = { audience: opts.audience || 'broker', reg, evaluationProfileId: 'BROKER_STANDARD', contextMode: 'GENERAL', hasCustomer: false, customerProfile: null, availabilityPolicy: App.availability.DEFAULT_POLICY, context: ctx0 };
    return rows.map(r => {
      const m = r.fieldKey && byField.get(r.fieldKey); if (!m || items.length < 2) return [];
      try {
        const res = evaluateCriterion(m, items.map(l => D.value(m, l, ctx0, null)), ctx);
        if (res.evaluationStatus === 'WINNER' || (res.evaluationStatus === 'TIE' && res.tieState === 'TOP_TIED')) return res.winnerCandidateIds.map(id => items.findIndex(l => l.identity.id === id)).filter(i => i >= 0);
      } catch (e) { /* fail closed */ }
      return [];
    });
  }
  /** Adapter for the legacy leaders(items, criteria): analysis notes 0–10 (higher = more of the attribute, by methodology), with the note10 tie and margin */
  function legacyLeaders(items, criteria) {
    const reg = registry((items[0] && items[0].identity && items[0].identity.developmentId) || 'viva-juara'), tp = reg.tiePolicies.note10, mp = reg.marginPolicies.note10;
    if (!tp || !mp || items.length < 2) return [];
    return criteria.map(c => {
      const vals = items.map(l => { try { return c.get(l); } catch (e) { return null; } });
      if (vals.some(v => !isNum(v))) return null; // a missing value is never 0 and never loses or wins
      const best = Math.max(...vals), top = vals.map((v, i) => [v, i]).filter(([v]) => tied(tp, best - v, best));
      if (top.length !== 1) return null;
      const runner = Math.max(...vals.filter((v, i) => i !== top[0][1]));
      return material(mp, best - runner, runner) ? { label: c.label, index: top[0][1] } : null;
    }).filter(Boolean);
  }

  return Object.freeze({ WinnerSemantics, EvaluationStatus, AssessmentState, TieType, BelowThreshold, EvaluationStalePolicy, EvaluationConflictPolicy, EvaluationConfidence, SuppressionReason, ComparativeAdvantage, CellState, ReasonCode, ErrorType, PRECISION,
    registry, definitionOf, resolvePreference, evaluateCriterion, evaluate, candidateSummaries, highlights, shareFacts, phraseOf, legacyRowWinners, legacyLeaders,
    log: () => LOG.slice(), clearCache: () => { cache.clear(); regCache.clear(); } });
})();

/* ComparisonViewModel / EvaluatedComparisonViewModel: composition of the base matrix (topic 24) and the evaluation (topic 25).
   Formatting and pt-BR text happen here. The same view model feeds desktop, tablet and mobile (no breakpoint logic). */
App.compare.viewModel = (() => {
  const D = App.compare.domain, EV = App.compare.evaluation, F = App.fmt, t = App.i18n.t;
  const CAVEAT = {
    PRICE_TABLE_ONLY: () => 'Preço de tabela; não inclui condições de negociação.',
    PROFILE_DEPENDENT: () => 'Depende do perfil do cliente informado.',
    NOT_PURCHASE_PROBABILITY: () => 'Compatibilidade não é probabilidade de compra.',
    ANALYSIS_ESTIMATE: () => 'Estimativa da análise.',
    NO_APPRECIATION_PROMISE: () => 'Não é promessa de valorização.',
    RELATIVE_CLASS: () => 'Classe relativa aos lotes do empreendimento.',
    STALE_VALUE: a => a === 'client' || a === 'presentation' ? 'Valor sujeito a confirmação.' : 'Baseado na última informação disponível; confirme antes de negociar.',
    PARTIAL_DATA: (a, r) => `Comparação parcial: ${r.dataSufficiency.validCandidates} de ${r.dataSufficiency.totalCandidates} lotes com dados.`,
    CONFLICTED_DATA: () => 'Há fontes divergentes para este critério.'
  };
  const REASON_PT = { INSUFFICIENT_VALID_VALUES: 'dados insuficientes', MISSING_CONTEXT: 'depende do perfil do cliente', STALE_DATA: 'dados desatualizados', CONFLICTED_DATA: 'fontes divergentes', LOW_CONFIDENCE: 'baixa confiabilidade',
    NON_ORDERED_METRIC: 'atributo sem ordem de preferência', NO_MATERIAL_DIFFERENCE: 'diferença abaixo da margem', VERSION_MISMATCH: 'versões de dados diferentes', POLICY_DISABLED: 'sem regra de destaque', NOT_APPLICABLE: 'não se aplica',
    UNKNOWN_SEMANTICS: 'semântica não registrada', PARTIAL_DATA: 'nem todos os lotes têm dado', INVALID_VALUE: 'valor fora da faixa válida' };
  const SEM_PT = { HIGHER_IS_PREFERRED: 'maior valor preferível', LOWER_IS_PREFERRED: 'menor valor preferível', ORDERED_ENUM: 'ordem formal de categorias', BOOLEAN_TRUE_PREFERRED: '"sim" preferível', BOOLEAN_FALSE_PREFERRED: '"não" preferível',
    TARGET_RANGE_PREFERRED: 'dentro da faixa desejada', TARGET_VALUE_PREFERRED: 'mais próximo do valor desejado', CONTEXTUAL_PREFERENCE: 'depende do contexto', NON_ORDERED: 'sem ordem', INFORMATIONAL: 'informativo', NO_WINNER: 'sem destaque' };
  const CONF_PT = { HIGH: 'alta', MEDIUM: 'média', LOW: 'baixa', UNKNOWN: 'não avaliada' };

  // ---------------------------------------------------------------- formatting (presentation only)
  function statusText(code, freshness, audience) {
    const client = audience === 'client' || audience === 'presentation';
    if (code === 'UNKNOWN' || code == null) return client ? 'Disponibilidade sujeita a confirmação' : 'Status não confirmado';
    if (code === 'AVAILABLE' && freshness !== 'FRESH') return client ? 'Disponível (sujeito a confirmação)' : 'Disponível, não confirmado agora';
    return t('AvailabilityStatus', code);
  }
  function formatValue(row, v, audience, freshness) {
    switch (row.formatterId) {
      case 'money': return F.formatBRL(v);
      case 'pricePerM2': return F.formatPricePerM2(v);
      case 'area': return F.formatSquareMeters(v, 2);
      case 'distance': return F.formatMeters(v, v < 100 && v % 1 ? 1 : 0);
      case 'score': return F.formatScore(v);
      case 'note': return `${F.formatNote(v)}/10`;
      case 'ratio': return F.formatPercentage(v);
      case 'percentNumber': return `${F.number(v, v % 1 ? 1 : 0)}%`;
      case 'level': return F.formatLevel(v);
      case 'levelF': return F.formatLevel(v, true);
      case 'lotClass': return F.formatLotClass(v);
      case 'status': return statusText(v, freshness, audience);
      case 'boolean': return F.formatBool(v);
      case 'easements': return Array.isArray(v) ? (v.length ? v.map(e => e.description || '').filter(Boolean).join('; ') || `${v.length}` : 'Nenhuma indicada na planta') : String(v);
      case 'alerts': return v === 0 ? 'Nenhum' : `${F.number(v)}`;
      case 'number': return F.number(v, v % 1 ? 1 : 0);
      case 'northSun': return String(t('NorthSunSide', v)).split(':')[0].split(';')[0];
      case 'enum': return row.enumName === 'Freshness' ? t('Freshness', v) : row.enumName === 'Confidence' ? t('Confidence', v) : t(row.enumName, v, F.ND);
      case 'text': return String(v);
      default: return v == null ? F.ND : String(v);
    }
  }
  function cellText(row, c, audience) {
    if (row.metricId === 'status') return statusText(c.valueStatus === 'VALID' ? c.value : 'UNKNOWN', c.freshness, audience);
    if (c.comparableState === 'CONTEXT_MISSING') return 'Sem perfil de cliente';
    switch (c.valueStatus) {
      case 'VALID': return formatValue(row, c.value, audience, c.freshness);
      case 'NO_DATA': case 'ERROR': return row.valueType === 'MONEY' && /price/i.test(row.metricId) ? 'Preço não disponível' : 'Não disponível';
      case 'UNKNOWN': return 'Desconhecido';
      case 'CONFLICTED': return 'Verificar divergência';
      case 'NOT_APPLICABLE': return 'Não se aplica';
      default: return 'Não disponível';
    }
  }
  const staleNote = (c, audience) => !c.uiHints.stale ? null : audience === 'client' || audience === 'presentation' ? 'sujeito a confirmação' : c.uiHints.expired ? 'vencido: confirme antes de negociar' : 'última informação disponível';
  const money = v => F.formatBRLShort(v);
  function diffText(row, r) {
    const ms = r.marginSummary; if (!ms) return '';
    const v = ms.absoluteDifference;
    if (row.valueType === 'MONEY') return row.formatterId === 'pricePerM2' ? `${F.formatPricePerM2(v)} abaixo` : `${money(v)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'abaixo' : 'acima'}`;
    if (row.valueType === 'SCORE') return row.formatterId === 'note' ? `${F.formatNote(v)} ponto${v === 1 ? '' : 's'} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'abaixo' : 'acima'}` : `${F.number(v)} ponto${Math.round(v) === 1 ? '' : 's'} acima`;
    if (row.valueType === 'AREA') return r.resolvedSemantics === 'TARGET_RANGE_PREFERRED' ? '' : `${F.formatSquareMeters(v, 0)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'a menos' : 'a mais'}`;
    if (row.valueType === 'DISTANCE') return `${F.formatMeters(v)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'a menos' : 'a mais'}`;
    return '';
  }
  /** row text from facts + reason codes (the domain never writes these sentences) */
  function rowTexts(row, r, names, audience) {
    const client = audience === 'client' || audience === 'presentation', technical = audience === 'technical';
    const nm = id => names[id] || id, list = ids => ids.map(nm).join(ids.length > 2 ? ', ' : ' e ').replace(/, ([^,]*)$/, ' e $1');
    const phrase = EV.phraseOf(r, row.label);
    let explanationText = null, highlightMode = 'none';
    switch (r.evaluationStatus) {
      case 'WINNER': {
        const w = r.winnerCandidateIds[0], d = diffText(row, r), ru = r.marginSummary && r.marginSummary.runnerUpCandidateId;
        explanationText = `${nm(w)} possui ${phrase} entre os lotes comparados${d && ru ? `, ${d} de ${nm(ru)}` : ''}.`;
        if (r.dataSufficiency.partial) explanationText = `${nm(w)} possui ${phrase} entre os ${r.dataSufficiency.validCandidates} lotes com dados.`;
        highlightMode = ['P0', 'P1'].includes(r.priority) ? 'strong' : 'subtle'; break;
      }
      case 'TIE': explanationText = r.tieState === 'ALL_TIED' ? `Empate técnico em ${row.label}.` : `Empate entre ${list(r.winnerCandidateIds)}.`; highlightMode = r.tieState === 'ALL_TIED' ? 'none' : 'subtle'; break;
      case 'NO_CLEAR_WINNER': explanationText = `Sem diferença relevante em ${row.label} entre os lotes.` + (!client && r.slightAdvantageCandidateId ? ` Ligeira vantagem de ${nm(r.slightAdvantageCandidateId)}.` : ''); break;
      case 'INSUFFICIENT_DATA': explanationText = client ? null : 'Não é possível destacar um lote neste critério porque faltam dados.'; break;
      case 'CONTEXT_REQUIRED': explanationText = client ? null : row.metadata.customerContextRequired ? 'Disponível quando há um perfil de cliente.' : 'Este atributo depende da preferência do cliente.'; break;
      case 'SUPPRESSED': {
        const why = r.suppressionReasons.includes('STALE_DATA') ? 'dados desatualizados' : r.suppressionReasons.includes('CONFLICTED_DATA') ? 'dados divergentes' : r.suppressionReasons.includes('LOW_CONFIDENCE') ? 'baixa confiabilidade da estimativa'
          : r.suppressionReasons.includes('PARTIAL_DATA') ? 'falta de dados em parte dos lotes' : r.suppressionReasons.includes('VERSION_MISMATCH') ? 'versões de dados diferentes' : 'uma regra de segurança';
        explanationText = client ? null : `Não foi possível destacar um lote devido a ${why}.`; break;
      }
      case 'ERROR': explanationText = client ? null : 'Destaque indisponível para este critério.'; break;
      default: explanationText = technical ? (r.suppressionReasons.includes('NON_ORDERED_METRIC') ? 'Atributo descritivo, sem ordem de preferência.' : 'Informativo, sem destaque.') : null;
    }
    const showCaveats = client ? r.evaluationStatus === 'WINNER' : !['NOT_COMPARABLE', 'CONTEXT_REQUIRED'].includes(r.evaluationStatus);
    const caveats = showCaveats ? r.caveats.filter(c => CAVEAT[c]).map(c => CAVEAT[c](audience, r)) : [];
    const p = r.policy || {};
    const policyText = technical && p.tie ? [`Regra: ${SEM_PT[p.resolvedSemantics] || SEM_PT[r.winnerSemantics] || r.winnerSemantics}`, `empate: ${tieText(p.tie, row)}`, `margem: ${marginText(p.margin, row)}`,
      `confiança mínima: ${CONF_PT[((p.confidence || {}).minimum || {})[audience]] || 'não exigida'}`, `confiança do resultado: ${CONF_PT[r.evaluationConfidence]}`, `política ${p.version || '—'}`].join(' · ')
      + (r.suppressionReasons.length ? ` · motivos: ${r.suppressionReasons.map(x => REASON_PT[x] || x).join(', ')}` : '') + (r.resolvedPreference ? ` · preferência: ${r.resolvedPreference.rationaleCode}` : '')
      : technical ? `Regra: ${SEM_PT[r.winnerSemantics] || 'não registrada'}${r.suppressionReasons.length ? ' · motivos: ' + r.suppressionReasons.map(x => REASON_PT[x] || x).join(', ') : ''}` : null;
    if (client && r.evaluationStatus !== 'WINNER') highlightMode = 'none';
    return { explanationText, caveatText: caveats.length ? caveats.join(' ') : null, highlightMode, policyText };
  }
  const tieText = (tp, row) => tp.type === 'EXACT' ? 'só valores iguais' : tp.type === 'ABSOLUTE_TOLERANCE' ? `até ${row.valueType === 'MONEY' ? F.formatBRL(tp.absoluteTolerance, true) : F.number(tp.absoluteTolerance, tp.absoluteTolerance % 1 ? 1 : 0)}`
    : tp.type === 'RELATIVE_TOLERANCE' ? `até ${F.number(tp.relativeTolerancePct, 1)}%` : tp.type === 'ABSOLUTE_OR_RELATIVE' ? `até ${F.number(tp.absoluteTolerance)} ou ${F.number(tp.relativeTolerancePct, 1)}%` : tp.type === 'TARGET_DISTANCE' ? `distância à meta até ${F.number(tp.targetDistanceTolerance)}` : tp.type;
  const marginText = (mp, row) => [mp.minimumAbsoluteDifference != null ? `≥ ${row.valueType === 'MONEY' ? F.formatBRL(mp.minimumAbsoluteDifference) : F.number(mp.minimumAbsoluteDifference, mp.minimumAbsoluteDifference % 1 ? 1 : 0)}` : null,
    mp.minimumRelativeDifferencePct != null ? `≥ ${F.number(mp.minimumRelativeDifferencePct, 1)}%` : null, mp.minimumOrdinalStep != null ? `≥ ${mp.minimumOrdinalStep} nível` : null, mp.targetDistanceDifference != null ? `≥ ${F.number(mp.targetDistanceDifference)} da meta` : null].filter(Boolean).join(' e ') || 'sem margem';
  const BADGE = { client: { WINNER: 'Destaque' }, presentation: { WINNER: 'Destaque' }, broker: { WINNER: 'Destaque', CO_WINNER: 'Empate', CLOSE: 'Ligeira vantagem' }, technical: { WINNER: 'Vencedor', CO_WINNER: 'Co-vencedor', CLOSE: 'Ligeira vantagem' } };
  function cellState(r, a, c, audience) {
    const client = audience === 'client' || audience === 'presentation';
    if (c.valueStatus === 'CONFLICTED') return 'CONFLICTED';
    if (['NO_DATA', 'UNKNOWN', 'ERROR'].includes(c.valueStatus) || c.comparableState === 'CONTEXT_MISSING') return 'NO_DATA';
    if (!r || !a) return c.uiHints.stale ? 'STALE' : 'NORMAL';
    if (r.evaluationStatus === 'SUPPRESSED') return client ? (c.uiHints.stale ? 'STALE' : 'NORMAL') : 'SUPPRESSED';
    if (r.evaluationStatus === 'WINNER') return a.assessmentState === 'BEST' ? 'WINNER' : client ? 'NORMAL' : 'WEAKER'; // "weaker" is never shown as "ruim"
    if (r.evaluationStatus === 'TIE') return r.tieState === 'TOP_TIED' && a.assessmentState === 'CO_BEST' && !client ? 'CO_WINNER' : 'NORMAL';
    if (r.evaluationStatus === 'NO_CLEAR_WINNER') return !client && r.slightAdvantageCandidateId === a.candidateId ? 'CLOSE' : 'NORMAL';
    return c.uiHints.stale ? 'STALE' : 'NORMAL';
  }

  /** build(input) → EvaluatedComparisonViewModel.
      input = { matrix, snapshot, evaluation, session, audience, profiles?: bool, filterActive?: bool } (built by App.compare.viewModel.fromState) */
  function build({ matrix, snapshot, evaluation, session, audience = 'broker' }) {
    const client = audience === 'client' || audience === 'presentation', technical = audience === 'technical';
    const pol = D.policyOf(session.developmentId), names = Object.fromEntries(matrix.candidateColumns.map(c => [c.candidateId, c.displayCode]));
    const results = evaluation ? evaluation.metricResults : {};
    const sums = evaluation ? new Map(evaluation.summary.candidateSummaries.map(s => [s.candidateId, s])) : new Map();
    const n = matrix.candidateColumns.length;
    const candidates = matrix.candidateColumns.map((c, i) => {
      const s = c.summary, av = s.availability || {}, cm = s.commercial || {}, cs = sums.get(c.candidateId);
      const statusWarn = av.status === 'UNKNOWN' || (av.status === 'AVAILABLE' && av.freshness !== 'FRESH') || av.freshness === 'STALE' || av.freshness === 'EXPIRED';
      return { id: c.candidateId, name: c.displayCode, order: i + 1, missing: c.validationState === 'MISSING',
        title: c.validationState === 'MISSING' ? 'Lote não encontrado nos dados atuais' : c.displayCode,
        statusCode: av.status || null, statusLabel: statusText(av.status, av.freshness, audience), statusWarn, offerable: av.status ? App.availability.isOfferable(av.status) : false,
        priceText: cm.price != null ? F.formatBRL(cm.price) : 'Preço não disponível', priceNote: cm.freshness && cm.freshness !== 'FRESH' ? (client ? 'Valor sujeito a confirmação' : cm.freshness === 'EXPIRED' ? 'Tabela vencida' : 'Última tabela disponível') : null,
        areaText: cm.areaM2 != null ? F.formatSquareMeters(cm.areaM2, 2) : F.ND,
        outsideFilter: s.matchesCurrentFilters === false, recommendationText: !client && s.recommendation && s.recommendation.rank != null ? `Recomendação: ${s.recommendation.rank}º${s.recommendation.tier === 'REVIEW_REQUIRED' ? ' (revisar)' : ''}` : null,
        canMoveLeft: i > 0, canMoveRight: i < n - 1,
        criterionSummary: cs ? { clearWins: cs.clearWins, coWins: cs.coWins, slightAdvantages: cs.slightAdvantages, text: cs.clearWins ? `Destaque em ${cs.clearWins} ${cs.clearWins === 1 ? 'critério' : 'critérios'}` : null } : null };
    });
    const rowEvaluations = [];
    const groups = matrix.groups.map(g => {
      const rows = matrix.rows.filter(r => r.groupId === g.id && (technical || !r.metadata.hiddenInNormalMode)).map(row => {
        const r = results[row.metricId] || null, tx = r ? rowTexts(row, r, names, audience) : { explanationText: null, caveatText: null, highlightMode: 'none', policyText: null };
        const cells = row.cells.map(c => {
          const a = r ? r.assessments.find(x => x.candidateId === c.candidateId) : null, st = cellState(r, a, c, audience), badge = tx.highlightMode === 'none' && st !== 'WINNER' ? null : (BADGE[audience] || BADGE.broker)[st] || null;
          const text = cellText(row, c, audience), note = staleNote(c, audience);
          const badgeA11y = !badge ? '' : st === 'WINNER' ? ` Destaque neste critério: ${names[c.candidateId]} possui ${EV.phraseOf(r, row.label)}.` : st === 'CO_WINNER' ? ` Empate entre ${r.winnerCandidateIds.map(id => names[id]).join(' e ')}.` : ' Ligeira vantagem neste critério.';
          return { candidateId: c.candidateId, text, note, cellState: st, badge, stale: !!c.uiHints.stale, emphasis: !!c.uiHints.emphasis,
            ariaLabel: `${row.label}, ${names[c.candidateId]}, ${text}${note ? ' (' + note + ')' : ''}.${badgeA11y}${st === 'WEAKER' ? ' Valor menos favorável neste critério.' : ''}` };
        });
        const rv = { metricId: row.metricId, status: r ? r.evaluationStatus : null, winnerCandidateIds: r ? r.winnerCandidateIds.slice() : [], cellStates: cells.map(c => c.cellState), explanationText: tx.explanationText, caveatText: tx.caveatText, highlightMode: tx.highlightMode, policyText: tx.policyText };
        rowEvaluations.push(rv);
        return { metricId: row.metricId, label: row.label, description: row.description, emphasis: row.metadata.emphasis, hiddenInNormalMode: row.metadata.hiddenInNormalMode, cells, evaluation: rv };
      });
      return { id: g.id, label: g.label, collapsedByDefault: g.collapsedByDefault, empty: !rows.length, emptyText: !rows.length ? 'Sem dados disponíveis' : null, rows };
    }).filter(g => technical || !g.empty);
    // criterion highlights (top 3–5 facts, grouped by lot; no overall best)
    const hl = evaluation ? EV.highlights(evaluation, { audience }) : [];
    const criterionHighlights = hl.map(h => ({ candidateId: h.candidateId, name: names[h.candidateId], items: h.metricIds.map(id => { const row = matrix.rows.find(r => r.metricId === id); return EV.phraseOf(results[id], row ? row.label : id); }) }));
    const sum = D.summary(session, snapshot);
    const warnings = [];
    if (snapshot.status === 'STALE') warnings.push(client ? 'Alguns valores estão sujeitos a confirmação.' : 'Há dados comerciais que podem estar desatualizados: os destaques de preço seguem a política de atualização.');
    if (snapshot.completenessSummary.partialMetricIds.length) warnings.push(D.MESSAGES.PARTIAL);
    if (snapshot.missingCandidateIds.length) warnings.push('Um lote da comparação não foi encontrado nos dados atuais.');
    if (!technical && snapshot.mixedVersion) warnings.push('Os lotes usam versões de dados diferentes; destaques afetados foram suprimidos.');
    if (technical && snapshot.mixedVersion) warnings.push(`Versões divergentes: ${snapshot.mixedVersionKeys.join(', ')}.`);
    if (candidates.some(c => c.statusWarn)) warnings.push(client ? 'Disponibilidade sujeita a confirmação.' : 'Disponibilidade sujeita a confirmação para os lotes sem status confirmado.');
    if (candidates.some(c => c.outsideFilter)) { const out = candidates.filter(c => c.outsideFilter).map(c => c.name); warnings.push(`${out.join(', ')} ${out.length === 1 ? 'está fora' : 'estão fora'} dos filtros atuais.`); }
    const fitRow = matrix.rows.find(r => r.metricId === 'fitScore');
    const fitNote = fitRow && !fitRow.metadata.contextMissing ? 'Compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.' : null;
    const comp = snapshot.completenessSummary;
    const actions = [{ id: 'share', label: 'Compartilhar comparação', act: 'shareCmp' }, { id: 'clear', label: 'Limpar comparação', act: 'cmpClear' }];
    return {
      sessionId: session.id, title: 'Comparar lotes', mode: audience, status: snapshot.status, countLabel: `${n} de ${pol.maxCandidates}`, canCompare: sum.canCompare, summaryMessage: sum.message,
      candidates, groups, rowEvaluations, candidateSummaries: evaluation ? evaluation.summary.candidateSummaries : [], criterionHighlights, highlightsNote: criterionHighlights.length ? 'Destaques por critério; não indicam um lote melhor no geral.' : null,
      warnings, fitNote, actions,
      profiles: technical || !client ? D.PROFILES.filter(p => audience === 'technical' || p.mode !== 'technical').filter(p => p.id !== 'CUSTOMER' || !client).map(p => ({ id: p.id, label: p.label, selected: p.id === session.metricProfileId })) : [],
      freshness: { commercial: snapshot.freshnessSummary.commercial, availability: snapshot.freshnessSummary.availability },
      completeness: { coverageRatio: comp.coverageRatio, text: client ? null : comp.coverageRatio == null ? null : `${Math.round(comp.coverageRatio * 100)}% dos dados exibidos disponíveis` },
      footnote: client ? 'Valores de preço são de tabela. Análises de ruído, privacidade e sol são estimativas.' : 'Destaque = vantagem clara naquele critério, segundo regra explícita; empates e diferenças pequenas não recebem destaque. Não há lote "melhor" no geral. É leitura da análise, não promessa de valorização.',
      technical: technical ? { snapshotHash: snapshot.hash, evaluationPolicyVersion: evaluation && evaluation.evaluationPolicyVersion, dataVersions: snapshot.dataVersions, recomputedMetricIds: evaluation && evaluation.recomputedMetricIds } : null,
      baseComparison: { candidates: matrix.candidateColumns, groups: matrix.groups }, evaluationPolicyVersion: evaluation ? evaluation.evaluationPolicyVersion : null
    };
  }

  /** fromState(input) → { vm, session, snapshot, matrix, evaluation, rejected }: the single call the UI needs.
      input = { developmentId, lotIds (ordered), resolve(idOrCode)→Lot, audience ('client'|'broker'|'technical'|'presentation'), metricProfileId?, scoreKey?,
                fitById? (Map), customerProfile? (CustomerProfile; only preferences/profileVersion are read), recommendation?, filter? { active, matchedIds:Set },
                activeLayerId?, previous? (the previous return value, for session identity and selective recompute), now? } */
  function fromState(input) {
    const prev = input.previous || null, audience = input.audience || 'broker';
    const cp = input.customerProfile && input.customerProfile.profileVersion && (input.customerProfile.preferences || []).some(p => p.enabled !== false) ? input.customerProfile : null;
    const profileId = input.metricProfileId || (prev && prev.session && prev.session.metricProfileId) || (audience === 'client' || audience === 'presentation' ? 'CUSTOMER' : audience === 'technical' ? 'TECHNICAL' : 'BROKER_STANDARD');
    const { session, rejected } = D.syncFromIds(prev && prev.session, input.developmentId, input.lotIds || [], { resolve: input.resolve, now: input.now, metricProfileId: profileId,
      context: { mode: input.contextMode || (cp ? (input.recommendation ? 'RECOMMENDATION' : 'CUSTOMER') : audience === 'technical' ? 'TECHNICAL' : audience === 'presentation' ? 'PRESENTATION' : 'GENERAL'), customerProfileVersion: cp ? cp.profileVersion : null,
        activeLayerId: input.activeLayerId || null, scoreKey: input.scoreKey || 'housing' } });
    if (!session.candidates.length) return { vm: null, session, snapshot: null, matrix: null, evaluation: null, rejected };
    const snapshot = D.buildSnapshot(session, { resolve: input.resolve, fitById: input.fitById || null, recommendation: input.recommendation || null, filter: input.filter || null, now: input.now });
    const matrix = D.buildMatrix(session, snapshot, { audience });
    const evaluation = session.candidates.length >= 2 ? EV.evaluate(snapshot, { audience, customerProfile: cp, evaluationProfileId: session.metricProfileId, previous: prev && prev.evaluation, now: input.now, metricIds: matrix.rows.filter(r => !r.metadata.duplicateOf && (audience === 'technical' || !r.metadata.hiddenInNormalMode)).map(r => r.metricId) }) : null; // only visible, evaluable metrics
    const vm = build({ matrix, snapshot, evaluation, session, audience });
    if (rejected.length) vm.warnings.unshift(...rejected.map(r => r.code === 'COMPARISON_LIMIT_REACHED' ? D.MESSAGES.COMPARISON_LIMIT_REACHED(D.policyOf(input.developmentId).maxCandidates) : r.code === 'DUPLICATE' ? D.MESSAGES.DUPLICATE : 'Um lote do link não existe neste empreendimento e foi ignorado.'));
    return { vm, session, snapshot, matrix, evaluation, rejected };
  }
  return Object.freeze({ build, fromState, formatValue, cellText, statusText, rowTexts });
})();
