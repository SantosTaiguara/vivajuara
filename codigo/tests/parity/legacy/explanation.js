/* intelligence/explanation.js — ExplanationEngine (topic 16).
   A view over the evidence the engines already produced (RecommendationResult,
   FitScoreResult, LotAnalysisResult). It never recalculates a ranking or a score:
   if the evidence is missing it says so (PARTIAL / UNAVAILABLE) instead of guessing.
   Returns reason codes and numbers only; wording lives in the presentation layer.

   - rankingTrace(result)            RankingTrace per ranked candidate
   - explainLot(result, lotId)       factors (positive, negative, constraints, data quality)
   - comparePair(result, a, b)       decisive and offsetting factors, tie-break used
   - rankChange(prev, curr)          who moved and which inputs/versions changed
   - explainTechnical(analysis)      base score contributions and class band */
App.explanation = (() => {
  const policyOf = devId => (App.recommendation.policyOf(devId) || {}).explanation || { version: '1.0.0', maxPositiveFactors: 3, maxNegativeFactors: 2, minContribution: 1, equivalenceEpsilon: 0.5 };
  const ESTIMATED = new Set(['ESTIMATED', 'TO_CONFIRM', 'UNKNOWN', 'CONFLICTED']);
  const allRanked = r => [...(r.recommendations || []), ...(r.reviewCandidates || [])];
  const find = (r, id) => allRanked(r).find(x => x.lotId === id) || null;

  function rankingTrace(r) {
    return allRanked(r).map(x => ({
      candidateLotId: x.lotId, initialEligibility: x.eligibility || null,
      constraintStatus: (x.constraintResults || []).map(c => ({ constraintId: c.constraintId, status: c.status, reasonCode: c.reasonCode })),
      fitScore: x.fitScore, fitCoverage: x.coverage, fitConfidence: x.confidence,
      rankingKeys: [{ key: 'fitScore', value: x.fitScore, direction: 'DESC' }, { key: 'coverage', value: x.coverage, direction: 'DESC' }, { key: 'confidence', value: x.confidence, direction: 'DESC' }, { key: 'lotId', value: x.lotId, direction: 'ASC' }],
      tieBreakValues: { coverage: x.coverage, confidence: x.confidence, lotId: x.lotId }, finalRank: x.rank, tier: x.tier
    }));
  }
  /** factor from a PreferenceMatchResult; contribution in Fit points (0–100 scale) */
  function factorOf(m, den, scale, type) {
    return { factorType: type, metricKey: m.fieldKey, preferenceKey: m.key, reasonCode: m.reasonCode, actualValue: m.rawLotValue, targetValue: m.targetValue, normalizedValue: m.matchScore,
      contribution: m.weightedContribution == null ? null : scale * m.weightedContribution / den, importance: m.importance, direction: type === 'NEGATIVE' ? 'AGAINST' : 'FOR',
      evidence: { dataStatus: m.dataStatus }, dataStatus: m.dataStatus, confidence: m.confidence };
  }
  function explainLot(r, lotId, opts = {}) {
    const pol = opts.policy || policyOf(r.developmentId), x = find(r, lotId), scale = 100;
    const versions = { recommendationPolicyVersion: r.recommendationPolicyVersion, fitMethodologyVersion: r.fitMethodologyVersion, explanationPolicyVersion: pol.version, profileVersion: r.customerProfileVersion };
    if (!x) return Object.freeze({ scope: 'RECOMMENDATION', status: 'UNAVAILABLE', subjectLotIds: [lotId], summaryReasonCodes: ['NOT_IN_RESULTS'], positiveFactors: [], negativeFactors: [], constraintFactors: [], dataQualityFactors: [], tieBreakFactors: [], comparisonFactors: [], rankChangeFactors: [], confidence: null, coverage: null, versions, generatedAt: r.generatedAt, diagnostics: [] });
    const fit = x.fit, ok = fit ? fit.preferenceMatches.filter(m => m.matchScore != null) : [], den = ok.reduce((a, m) => a + m.weight, 0) || 1;
    const pos = ok.filter(m => m.reasonCode === 'FIT_STRONG_MATCH').map(m => factorOf(m, den, scale, 'POSITIVE')).filter(f => f.contribution >= pol.minContribution)
      .sort((a, b) => b.contribution - a.contribution || a.preferenceKey.localeCompare(b.preferenceKey));
    const neg = ok.filter(m => m.reasonCode === 'FIT_MISMATCH').map(m => ({ ...factorOf(m, den, scale, 'NEGATIVE'), lost: scale * m.weight * (1 - m.matchScore) / den }))
      .sort((a, b) => b.lost - a.lost || a.preferenceKey.localeCompare(b.preferenceKey));
    const cons = (x.constraintResults || []).map(c => ({ factorType: c.status === 'PASS' ? 'CONSTRAINT_PASS' : c.status === 'FAIL' ? 'CONSTRAINT_FAIL' : 'CONSTRAINT_UNKNOWN', metricKey: c.metricKey, reasonCode: c.reasonCode || 'CONSTRAINT_PASSED', actualValue: c.actualValue, targetValue: c.expectedValue, dataStatus: c.dataStatus }));
    const dq = [];
    if (x.availabilityStatus === 'UNKNOWN') dq.push({ factorType: 'DATA_QUALITY', metricKey: 'availability.status', reasonCode: 'AVAILABILITY_UNKNOWN', dataStatus: 'UNKNOWN' });
    for (const code of x.reviewReasons || []) if (code !== 'AVAILABILITY_UNKNOWN') dq.push({ factorType: 'DATA_QUALITY', metricKey: null, reasonCode: code, dataStatus: null });
    for (const m of fit ? fit.preferenceMatches : []) {
      if (m.matchScore == null) dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, reasonCode: 'PREFERENCE_NOT_EVALUATED', dataStatus: m.dataStatus });
      else if (ESTIMATED.has(m.dataStatus)) dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, reasonCode: 'ESTIMATED_INPUT', dataStatus: m.dataStatus });
    }
    for (const w of fit ? fit.warnings : []) if (w.code === 'STALE_PRICE') dq.push({ factorType: 'DATA_QUALITY', metricKey: w.fieldKey, reasonCode: 'STALE_PRICE', dataStatus: 'STALE' });
    const summary = [x.tier === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : x.rank === 1 && x.tier === 'PRIMARY' ? 'TOP_FIT' : 'TIER_' + x.tier, ...(x.keyReasonCodes || []).filter(c => c !== 'TOP_FIT')];
    return Object.freeze({ scope: 'RECOMMENDATION', status: fit ? (fit.status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL') : 'PARTIAL', subjectLotIds: [lotId], rank: x.rank, tier: x.tier, fitScore: x.fitScore,
      summaryReasonCodes: [...new Set(summary)], positiveFactors: pos.slice(0, opts.all ? 99 : pol.maxPositiveFactors), negativeFactors: neg.slice(0, opts.all ? 99 : pol.maxNegativeFactors),
      allPositive: pos.length, allNegative: neg.length, constraintFactors: cons, dataQualityFactors: dq, tieBreakFactors: [], comparisonFactors: [], rankChangeFactors: [],
      confidence: x.fitConfidence, coverage: x.coverage, preferenceTable: fit ? fit.preferenceMatches.map(m => ({ key: m.key, fieldKey: m.fieldKey, target: m.targetValue, actual: m.rawLotValue, match: m.matchScore, importance: m.importance, contribution: m.weightedContribution == null ? null : scale * m.weightedContribution / den, dataStatus: m.dataStatus })) : [],
      versions, generatedAt: r.generatedAt, diagnostics: [] });
  }
  /** why A is above B: per-preference delta of Fit points (the deltas add up to fitA − fitB) */
  function comparePair(r, aId, bId, opts = {}) {
    const pol = opts.policy || policyOf(r.developmentId), A = find(r, aId), B = find(r, bId);
    if (!A || !B) return Object.freeze({ status: 'UNAVAILABLE', higherLotId: null, lowerLotId: null, decisiveFactors: [], offsettingFactors: [], tieBreakUsed: null, dataQualityDifferences: [], summaryReasonCodes: ['NOT_IN_RESULTS'] });
    const [hi, lo] = (A.tier === 'REVIEW_REQUIRED') === (B.tier === 'REVIEW_REQUIRED') ? (App.recommendation.compare(A, B) <= 0 ? [A, B] : [B, A]) : A.tier === 'REVIEW_REQUIRED' ? [B, A] : [A, B];
    const contrib = x => { const ok = x.fit ? x.fit.preferenceMatches.filter(m => m.matchScore != null) : [], den = ok.reduce((a, m) => a + m.weight, 0) || 1; return new Map(ok.map(m => [m.key, { c: 100 * m.weightedContribution / den, m }])); };
    const ch = contrib(hi), cl = contrib(lo), keys = [...new Set([...ch.keys(), ...cl.keys()])];
    const deltas = keys.map(k => ({ preferenceKey: k, metricKey: (ch.get(k) || cl.get(k)).m.fieldKey, higherValue: ch.has(k) ? ch.get(k).m.rawLotValue : null, lowerValue: cl.has(k) ? cl.get(k).m.rawLotValue : null,
      delta: (ch.has(k) ? ch.get(k).c : 0) - (cl.has(k) ? cl.get(k).c : 0), comparable: ch.has(k) && cl.has(k) }));
    const decisive = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta || a.preferenceKey.localeCompare(b.preferenceKey)).slice(0, 3);
    const offsetting = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta || a.preferenceKey.localeCompare(b.preferenceKey)).slice(0, 3);
    let tieBreakUsed = null; const codes = [];
    if (hi.tier !== lo.tier && (hi.tier === 'REVIEW_REQUIRED' || lo.tier === 'REVIEW_REQUIRED')) codes.push('DIFFERENT_ELIGIBILITY');
    else if (Math.abs((hi.fitScore ?? 0) - (lo.fitScore ?? 0)) >= pol.equivalenceEpsilon) codes.push('HIGHER_FIT');
    else if ((hi.fitScore ?? null) !== (lo.fitScore ?? null)) codes.push('EQUIVALENT_FOR_PROFILE'); // ordered by a Fit difference below the equivalence margin: no tie-break was used
    else if (hi.coverage !== lo.coverage) { tieBreakUsed = { key: 'coverage', higher: hi.coverage, lower: lo.coverage }; codes.push('TIE_BREAK_COVERAGE'); }
    else if (hi.confidence !== lo.confidence) { tieBreakUsed = { key: 'confidence', higher: hi.confidence, lower: lo.confidence }; codes.push('TIE_BREAK_CONFIDENCE'); }
    else { tieBreakUsed = { key: 'lotId' }; codes.push('EQUIVALENT_FOR_PROFILE'); } // never "better because of a smaller id"
    const dq = [hi, lo].map(x => ({ lotId: x.lotId, availabilityStatus: x.availabilityStatus, coverage: x.coverage, confidence: x.fitConfidence, reviewReasons: x.reviewReasons || [] }));
    return Object.freeze({ status: 'COMPLETE', higherLotId: hi.lotId, lowerLotId: lo.lotId, fitDelta: (hi.fitScore ?? 0) - (lo.fitScore ?? 0), decisiveFactors: decisive, offsettingFactors: offsetting, tieBreakUsed, dataQualityDifferences: dq, summaryReasonCodes: codes });
  }
  /** which lots moved between two results, and which inputs/versions changed */
  function rankChange(prev, curr) {
    if (!prev || !curr) return [];
    const p = new Map(allRanked(prev).map(x => [x.lotId, x])), c = new Map(allRanked(curr).map(x => [x.lotId, x]));
    const changedVersions = Object.keys({ ...prev.dataVersions, ...curr.dataVersions }).filter(k => (prev.dataVersions || {})[k] !== (curr.dataVersions || {})[k]);
    const changedPolicies = [['recommendationPolicyVersion', 'POLICY_CHANGED'], ['fitMethodologyVersion', 'METHODOLOGY_CHANGED']].filter(([k]) => prev[k] !== curr[k]).map(([, code]) => code);
    const profileChanged = prev.customerProfileVersion !== curr.customerProfileVersion;
    const out = [];
    for (const id of new Set([...p.keys(), ...c.keys()])) {
      const a = p.get(id), b = c.get(id), pr = a ? (a.tier === 'REVIEW_REQUIRED' ? null : a.rank) : null, cr = b ? (b.tier === 'REVIEW_REQUIRED' ? null : b.rank) : null;
      if (pr === cr && (a && a.tier) === (b && b.tier)) continue;
      const reasons = [];
      if (profileChanged) reasons.push('PROFILE_CHANGED');
      if (a && b && a.fitScore !== b.fitScore) reasons.push(b.fitScore > a.fitScore ? 'FIT_INCREASED' : 'FIT_DECREASED');
      if (a && b && a.availabilityStatus !== b.availabilityStatus) reasons.push('AVAILABILITY_CHANGED');
      if (!a) reasons.push('ENTERED_RESULTS'); if (!b) reasons.push('LEFT_RESULTS');
      if (changedVersions.length) reasons.push('DATA_VERSION_CHANGED');
      reasons.push(...changedPolicies);
      if (!reasons.length) reasons.push('OTHER_LOTS_MOVED');
      out.push({ lotId: id, previousRank: pr, currentRank: cr, rankDelta: pr != null && cr != null ? pr - cr : null, previousTier: a ? a.tier : null, currentTier: b ? b.tier : null,
        changeReasons: reasons, changedInputs: profileChanged ? ['customerProfile'] : [], changedPolicies, changedVersions });
    }
    return out.sort((x, y) => (x.currentRank ?? 1e9) - (y.currentRank ?? 1e9) || x.lotId.localeCompare(y.lotId));
  }
  /** base score explanation from a LotAnalysisResult (topic 12): contributions per criterion and the class band */
  function explainTechnical(a, scoreId = 'housing', ref) {
    if (!a || !a.criteriaResults || !a.criteriaResults[scoreId]) return Object.freeze({ scope: 'TECHNICAL', status: 'UNAVAILABLE', scoreId, factors: [] });
    const c = a.criteriaResults[scoreId], mean = 100 / c.criteria.length;
    const factors = c.criteria.map(x => ({ factorType: 'CONTRIBUTION', criterionId: x.criterionId, metricKey: x.fieldKey, value: x.value, weight: x.weight, contribution: x.contribution,
      reasons: (x.reasons || []).filter(s => s.reason).map(s => ({ reasonCode: s.reason, delta: s.delta, input: s.input })) })).sort((p, q) => q.contribution - p.contribution || p.criterionId.localeCompare(q.criterionId));
    let classBand = null;
    if (ref && ref.overall && a.overallRaw != null) {
      const sorted = ref.overall.filter(o => o.overallRaw != null).map(o => o.overallRaw).sort((x, y) => y - x), better = sorted.filter(v => v > a.overallRaw).length;
      classBand = { class: a.class, position: better + 1, total: sorted.length, topShare: (better + 1) / sorted.length };
    }
    return Object.freeze({ scope: 'TECHNICAL', status: 'COMPLETE', scoreId, value: c.value, raw: c.raw, factors, strongest: factors.slice(0, 2).map(f => f.criterionId), weakest: factors.slice(-2).map(f => f.criterionId), meanShare: mean, classBand, methodologyVersion: a.methodologyVersion });
  }
  return Object.freeze({ policyOf, rankingTrace, explainLot, comparePair, rankChange, explainTechnical });
})();
