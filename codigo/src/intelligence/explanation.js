/* intelligence/explanation.js — ExplanationEngine (topic 16).
   A view over the evidence the engines already produced (RecommendationResult,
   FitScoreResult, LotAnalysisResult). It never recalculates a ranking or a score:
   if the evidence is missing it says so (PARTIAL / UNAVAILABLE) instead of guessing.
   Returns reason codes and numbers only; wording comes from App.reasonCodes through
   viewModel(), the only function here that produces text.

   - rankingTrace(result)                 RankingTrace per ranked candidate
   - explainLot(result, lotId)            factors (positive, negative, constraints, exclusion, data quality);
                                          an excluded lot gets status EXCLUDED with its ExcludedLotDetail
   - comparePair(result, a, b, opts)      decisive and offsetting factors, tie-break used, comparable:false flagged
   - compareMany(result, lotIds, opts)    2–4 lots: pairwise matrix and per-preference winners (comparison screen)
   - rankChange(prev, curr)               who moved and which inputs/versions changed
   - explainTechnical(analysis)           base score contributions and class band
   - viewModel(explanation, { mode })     ExplanationViewModel: headline, factors, trade-offs, data quality, levels per mode */
App.explanation = (() => {
  const DEFAULT_POLICY = Object.freeze({ version: '1.0.0', maxPositiveFactors: 3, maxNegativeFactors: 2, minContribution: 1, equivalenceEpsilon: 0.5 });
  const policyOf = devId => (App.recommendation.policyOf(devId) || {}).explanation || DEFAULT_POLICY;
  const ESTIMATED = new Set(['ESTIMATED', 'TO_CONFIRM', 'UNKNOWN', 'CONFLICTED']);
  const allRanked = r => [...(r.recommendations || []), ...(r.reviewCandidates || [])];
  const find = (r, id) => allRanked(r).find(x => x.lotId === id) || null;
  const excludedOf = (r, id) => (r.excluded || []).find(x => x.lotId === id) || null;
  const recPolicyOf = r => App.recommendation.policyOf(r.developmentId) || {};

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
  /** positive / negative factors and the per-preference table from one FitScoreResult (shared by ranked and excluded lots) */
  function fitFactors(fit, pol) {
    const scale = 100, ok = fit ? fit.preferenceMatches.filter(m => m.matchScore != null) : [], den = ok.reduce((a, m) => a + m.weight, 0) || 1;
    const pos = ok.filter(m => m.reasonCode === 'FIT_STRONG_MATCH').map(m => factorOf(m, den, scale, 'POSITIVE')).filter(f => f.contribution >= pol.minContribution)
      .sort((a, b) => b.contribution - a.contribution || a.preferenceKey.localeCompare(b.preferenceKey));
    const neg = ok.filter(m => m.reasonCode === 'FIT_MISMATCH').map(m => ({ ...factorOf(m, den, scale, 'NEGATIVE'), lost: scale * m.weight * (1 - m.matchScore) / den }))
      .sort((a, b) => b.lost - a.lost || a.preferenceKey.localeCompare(b.preferenceKey));
    const table = fit ? fit.preferenceMatches.map(m => ({ key: m.key, fieldKey: m.fieldKey, target: m.targetValue, actual: m.rawLotValue, match: m.matchScore, importance: m.importance, contribution: m.weightedContribution == null ? null : scale * m.weightedContribution / den, dataStatus: m.dataStatus })) : [];
    return { pos, neg, table };
  }
  const constraintFactor = c => ({ factorType: c.status === 'PASS' ? 'CONSTRAINT_PASS' : c.status === 'FAIL' || c.status === 'ERROR' ? 'CONSTRAINT_FAIL' : 'CONSTRAINT_UNKNOWN', metricKey: c.metricKey, reasonCode: c.reasonCode || 'CONSTRAINT_PASSED', actualValue: c.actualValue, targetValue: c.expectedValue, dataStatus: c.dataStatus });
  /** one data-quality factor for a review/warning code, with the metric and values it refers to (never guessed: from the evidence) */
  function codeFactor(code, x, recPol, origin) {
    const f = { factorType: 'DATA_QUALITY', metricKey: null, reasonCode: code, dataStatus: null, origin };
    if (code === 'LOW_FIT_COVERAGE') return { ...f, metricKey: 'fit.coverage', actualValue: x.coverage ?? null, targetValue: recPol.minFitCoverage ?? null };
    if (code === 'LOW_FIT_CONFIDENCE') return { ...f, metricKey: 'fit.confidence', actualValue: x.confidence ?? null, targetValue: recPol.minFitConfidence ?? null };
    if (code === 'STALE_AVAILABILITY') return { ...f, metricKey: 'availability.status', actualValue: x.availabilityStatus ?? null, dataStatus: 'STALE' };
    if (code === 'STALE_COMMERCIAL_DATA') { const c = (x.constraintResults || []).find(r => r.stale); return { ...f, metricKey: c ? c.metricKey : 'commercial.price', actualValue: c ? c.actualValue : null, dataStatus: 'STALE' }; }
    if (code === 'FIT_FAILED') return { ...f, metricKey: null, actualValue: null };
    const c = (x.constraintResults || []).find(r => r.status === 'UNKNOWN' && r.reasonCode === code);
    if (c) return { ...f, metricKey: c.metricKey, constraintId: c.constraintId, constraintKey: c.key, actualValue: c.actualValue, targetValue: c.expectedValue, dataStatus: c.dataStatus };
    return f;
  }
  function dataQuality(x, fit, recPol) {
    const dq = [];
    if (x.availabilityStatus === 'UNKNOWN') dq.push({ factorType: 'DATA_QUALITY', metricKey: 'availability.status', reasonCode: 'AVAILABILITY_UNKNOWN', dataStatus: 'UNKNOWN', origin: 'AVAILABILITY' });
    for (const code of x.reviewReasons || []) if (code !== 'AVAILABILITY_UNKNOWN') dq.push(codeFactor(code, x, recPol, 'REVIEW_REASON'));
    for (const code of x.warnings || []) dq.push({ ...codeFactor(code, x, recPol, 'CONSTRAINT_WARNING'), severity: 'WARNING' });
    for (const m of fit ? fit.preferenceMatches : []) {
      if (m.status === 'FAILED') dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, preferenceKey: m.key, reasonCode: 'PREFERENCE_FAILED', dataStatus: m.dataStatus, origin: 'PREFERENCE' });
      else if (m.matchScore == null) dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, reasonCode: 'PREFERENCE_NOT_EVALUATED', dataStatus: m.dataStatus, preferenceKey: m.key, origin: 'PREFERENCE' });
      else if (m.dataStatus === 'CONFLICTED') dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, reasonCode: 'CONFLICTED_DATA', dataStatus: m.dataStatus, preferenceKey: m.key, origin: 'PREFERENCE' });
      else if (ESTIMATED.has(m.dataStatus)) dq.push({ factorType: 'DATA_QUALITY', metricKey: m.fieldKey, reasonCode: 'ESTIMATED_INPUT', dataStatus: m.dataStatus, preferenceKey: m.key, origin: 'PREFERENCE' });
    }
    for (const w of fit ? fit.warnings : []) if (w.code === 'STALE_PRICE') dq.push({ factorType: 'DATA_QUALITY', metricKey: w.fieldKey, reasonCode: 'STALE_PRICE', dataStatus: 'STALE', origin: 'FIT' });
    return dq;
  }
  function diagnosticsOf(fit, pos, neg, pol, explicitPolicy) {
    const d = [];
    if (pol === DEFAULT_POLICY && !explicitPolicy) d.push({ code: 'EXPLANATION_POLICY_DEFAULT' });
    if (!fit) d.push({ code: 'NO_FIT_EVIDENCE' });
    else if (fit.coverage < 1) d.push({ code: 'PARTIAL_COVERAGE', params: { actual: fit.coverage } });
    if (pos.length > pol.maxPositiveFactors || neg.length > pol.maxNegativeFactors) d.push({ code: 'FACTORS_TRUNCATED', params: { shownPositive: Math.min(pos.length, pol.maxPositiveFactors), totalPositive: pos.length, shownNegative: Math.min(neg.length, pol.maxNegativeFactors), totalNegative: neg.length } });
    return d;
  }
  const blank = () => ({ positiveFactors: [], negativeFactors: [], constraintFactors: [], exclusionFactors: [], dataQualityFactors: [], tieBreakFactors: [], comparisonFactors: [], rankChangeFactors: [] });

  function explainLot(r, lotId, opts = {}) {
    const pol = opts.policy || policyOf(r.developmentId), x = find(r, lotId), recPol = recPolicyOf(r);
    const versions = { recommendationPolicyVersion: r.recommendationPolicyVersion, fitMethodologyVersion: r.fitMethodologyVersion, explanationPolicyVersion: pol.version, profileVersion: r.customerProfileVersion };
    const common = { scope: 'RECOMMENDATION', developmentId: r.developmentId || null, subjectLotIds: [lotId], versions, generatedAt: r.generatedAt };
    if (!x) {
      const e = excludedOf(r, lotId);
      if (e) { // excluded: the reason, the metric and the values that excluded it; Fit factors only when the Fit was computed (LOW_FIT)
        const fit = e.fit || null, { pos, neg, table } = fitFactors(fit, pol);
        const exf = [{ factorType: 'EXCLUSION', stage: e.stage, reasonCode: e.reasonCode, metricKey: e.metricKey, operator: e.operator, actualValue: e.actualValue, targetValue: e.expectedValue, constraintId: e.constraintId, constraintKey: e.constraintKey, constraintLabel: e.constraintLabel, dataStatus: e.dataStatus }];
        const dq = dataQuality({ ...e, reviewReasons: [], warnings: e.warnings || [] }, fit, recPol);
        return Object.freeze({ ...common, ...blank(), status: 'EXCLUDED', standing: 'EXCLUDED', rank: null, tier: null, fitScore: e.fitScore ?? null, summaryReasonCodes: ['EXCLUDED', e.reasonCode], primaryReason: e.reasonCode,
          exclusion: { stage: e.stage, reasonCode: e.reasonCode, metricKey: e.metricKey, actualValue: e.actualValue, expectedValue: e.expectedValue, constraintLabel: e.constraintLabel },
          positiveFactors: pos.slice(0, opts.all ? 99 : pol.maxPositiveFactors), negativeFactors: neg.slice(0, opts.all ? 99 : pol.maxNegativeFactors), allPositive: pos.length, allNegative: neg.length,
          constraintFactors: (e.constraintResults || []).map(constraintFactor), exclusionFactors: exf, dataQualityFactors: dq, confidence: e.fitConfidence || null, coverage: e.coverage ?? null, preferenceTable: table,
          diagnostics: fit ? diagnosticsOf(fit, pos, neg, pol, !!opts.policy) : [] });
      }
      const ov = r.overflow || {}, code = (ov.eligibleLotIds || []).includes(lotId) ? 'NOT_SHORTLISTED' : (ov.reviewLotIds || []).includes(lotId) ? 'REVIEW_NOT_LISTED' : 'NOT_IN_RESULTS';
      return Object.freeze({ ...common, ...blank(), status: 'UNAVAILABLE', standing: code, summaryReasonCodes: [code], confidence: null, coverage: null, diagnostics: [] });
    }
    const fit = x.fit, { pos, neg, table } = fitFactors(fit, pol);
    const cons = (x.constraintResults || []).map(constraintFactor);
    const dq = dataQuality(x, fit, recPol);
    const summary = [x.tier === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : x.rank === 1 && x.tier === 'PRIMARY' ? 'TOP_FIT' : 'TIER_' + x.tier, ...(x.keyReasonCodes || []).filter(c => c !== 'TOP_FIT')];
    const review = x.tier === 'REVIEW_REQUIRED', primary = review ? (x.primaryReviewReason || App.recommendation.primaryReviewReason(x.reviewReasons, recPol)) : null;
    return Object.freeze({ ...common, ...blank(), status: fit ? (fit.status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL') : 'PARTIAL', standing: review ? 'REVIEW' : 'RECOMMENDED', rank: x.rank, tier: x.tier, fitScore: x.fitScore,
      summaryReasonCodes: [...new Set(summary)], primaryReason: primary, reviewCategory: review ? (x.reviewCategory || App.recommendation.reviewCategoryOf(primary, recPol)) : null,
      positiveFactors: pos.slice(0, opts.all ? 99 : pol.maxPositiveFactors), negativeFactors: neg.slice(0, opts.all ? 99 : pol.maxNegativeFactors),
      allPositive: pos.length, allNegative: neg.length, constraintFactors: cons, dataQualityFactors: dq,
      confidence: x.fitConfidence, coverage: x.coverage, preferenceTable: table, diagnostics: diagnosticsOf(fit, pos, neg, pol, !!opts.policy) });
  }

  // ---------------------------------------------------------------- pairwise
  const STANDING = { RECOMMENDED: 0, REVIEW: 1, NOT_LISTED: 2, EXCLUDED: 3 };
  /** a comparable item for a lot: ranked item, else excluded detail with its Fit (LOW_FIT), else the caller's Fit evidence (opts.fit Map) */
  function resolve(r, id, opts = {}) {
    const x = find(r, id); if (x) return { ...x, standing: x.tier === 'REVIEW_REQUIRED' ? 'REVIEW' : 'RECOMMENDED' };
    const e = excludedOf(r, id), f = e && e.fit ? e.fit : opts.fit && opts.fit.get ? opts.fit.get(id) : null;
    if (!e && !f) return null;
    const fit = f || null;
    return { lotId: id, code: (e && e.code) || (fit && fit.code) || null, rank: null, tier: null, fitScore: fit ? fit.fitScore : null, coverage: fit ? fit.coverage : null, confidence: fit ? fit.confidence.value : null, fitConfidence: fit ? fit.confidence.level : 'UNKNOWN',
      fit, availabilityStatus: e ? e.availabilityStatus : null, reviewReasons: [], standing: e ? 'EXCLUDED' : 'NOT_LISTED', exclusionReasonCode: e ? e.reasonCode : null };
  }
  const contribOf = x => { const ok = x.fit ? x.fit.preferenceMatches.filter(m => m.matchScore != null) : [], den = ok.reduce((a, m) => a + m.weight, 0) || 1; return new Map(ok.map(m => [m.key, { c: 100 * m.weightedContribution / den, m }])); };
  /** why A is above B: per-preference delta of Fit points (the deltas add up to fitA − fitB) */
  function comparePair(r, aId, bId, opts = {}) {
    const pol = opts.policy || policyOf(r.developmentId), A = resolve(r, aId, opts), B = resolve(r, bId, opts);
    if (!A || !B) return Object.freeze({ status: 'UNAVAILABLE', higherLotId: null, lowerLotId: null, decisiveFactors: [], offsettingFactors: [], tieBreakUsed: null, dataQualityDifferences: [], summaryReasonCodes: ['NOT_IN_RESULTS'], notComparableFactors: [], warnings: [] });
    const sa = STANDING[A.standing], sb = STANDING[B.standing];
    const [hi, lo] = sa === sb ? (App.recommendation.compare(A, B) <= 0 ? [A, B] : [B, A]) : sa < sb ? [A, B] : [B, A];
    const ch = contribOf(hi), cl = contribOf(lo), keys = [...new Set([...ch.keys(), ...cl.keys()])];
    const deltas = keys.map(k => {
      const comparable = ch.has(k) && cl.has(k);
      const d = { preferenceKey: k, metricKey: (ch.get(k) || cl.get(k)).m.fieldKey, higherValue: ch.has(k) ? ch.get(k).m.rawLotValue : null, lowerValue: cl.has(k) ? cl.get(k).m.rawLotValue : null,
        delta: (ch.has(k) ? ch.get(k).c : 0) - (cl.has(k) ? cl.get(k).c : 0), comparable };
      if (!comparable) { d.notComparableReason = ch.has(k) ? 'MISSING_IN_LOWER' : 'MISSING_IN_HIGHER'; d.flag = 'NOT_COMPARABLE'; } // missing data is never a low grade: the Fit renormalized that lot
      return d;
    });
    const decisive = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta || a.preferenceKey.localeCompare(b.preferenceKey)).slice(0, 3);
    const offsetting = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta || a.preferenceKey.localeCompare(b.preferenceKey)).slice(0, 3);
    let tieBreakUsed = null; const codes = [];
    if (sa !== sb) codes.push('DIFFERENT_ELIGIBILITY');
    else if (Math.abs((hi.fitScore ?? 0) - (lo.fitScore ?? 0)) >= pol.equivalenceEpsilon) codes.push('HIGHER_FIT');
    else if ((hi.fitScore ?? null) !== (lo.fitScore ?? null)) codes.push('EQUIVALENT_FOR_PROFILE'); // ordered by a Fit difference below the equivalence margin: no tie-break was used
    else if (hi.coverage !== lo.coverage) { tieBreakUsed = { key: 'coverage', higher: hi.coverage, lower: lo.coverage }; codes.push('TIE_BREAK_COVERAGE'); }
    else if (hi.confidence !== lo.confidence) { tieBreakUsed = { key: 'confidence', higher: hi.confidence, lower: lo.confidence }; codes.push('TIE_BREAK_CONFIDENCE'); }
    else { tieBreakUsed = { key: 'lotId' }; codes.push('EQUIVALENT_FOR_PROFILE'); } // never "better because of a smaller id"
    const dq = [hi, lo].map(x => ({ lotId: x.lotId, availabilityStatus: x.availabilityStatus, coverage: x.coverage, confidence: x.fitConfidence, reviewReasons: x.reviewReasons || [], standing: x.standing }));
    const notComparable = deltas.filter(d => !d.comparable).sort((a, b) => a.preferenceKey.localeCompare(b.preferenceKey));
    return Object.freeze({ status: 'COMPLETE', higherLotId: hi.lotId, lowerLotId: lo.lotId, fitDelta: (hi.fitScore ?? 0) - (lo.fitScore ?? 0), decisiveFactors: decisive, offsettingFactors: offsetting, tieBreakUsed, dataQualityDifferences: dq, summaryReasonCodes: codes,
      higherStanding: hi.standing, lowerStanding: lo.standing, notComparableFactors: notComparable, warnings: notComparable.length ? ['HAS_NOT_COMPARABLE_FACTORS'] : [] });
  }
  /** compareMany(result, lotIds, opts) → ComparisonExplanation for 2–4 lots: order, pairwise matrix and per-preference winners.
      opts.fit (Map lotId → FitScoreResult) lets lots outside the results be compared on the same profile; nothing is recalculated. */
  function compareMany(r, lotIds, opts = {}) {
    const ids = [...new Set(lotIds || [])], pol = opts.policy || policyOf(r.developmentId);
    if (ids.length < 2 || ids.length > 4) return Object.freeze({ status: 'INVALID', lotIds: ids, lots: [], order: [], matrix: [], pairs: [], preferences: [], winsByLot: {}, summaryReasonCodes: ['COMPARE_COUNT_OUT_OF_RANGE'], warnings: [] });
    const items = new Map(ids.map(id => [id, resolve(r, id, opts)]));
    const lots = ids.map(id => { const x = items.get(id); return x ? { lotId: id, code: x.code || null, available: true, standing: x.standing, rank: x.rank ?? null, tier: x.tier ?? null, fitScore: x.fitScore ?? null, coverage: x.coverage ?? null, confidence: x.confidence ?? null, fitConfidence: x.fitConfidence || 'UNKNOWN',
      availabilityStatus: x.availabilityStatus ?? null, primaryReviewReason: x.primaryReviewReason || null, exclusionReasonCode: x.exclusionReasonCode || null } : { lotId: id, code: null, available: false, standing: 'NOT_IN_RESULTS', rank: null, tier: null, fitScore: null, coverage: null, confidence: null, fitConfidence: 'UNKNOWN', availabilityStatus: null, primaryReviewReason: null, exclusionReasonCode: null }; });
    const known = ids.filter(id => items.get(id));
    const order = known.slice().sort((a, b) => { const A = items.get(a), B = items.get(b); return STANDING[A.standing] - STANDING[B.standing] || App.recommendation.compare(A, B); }).concat(ids.filter(id => !items.get(id)));
    const pairs = [], matrix = ids.map(() => ids.map(() => null));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = comparePair(r, ids[i], ids[j], opts); pairs.push({ aLotId: ids[i], bLotId: ids[j], ...p });
      if (p.status !== 'COMPLETE') continue;
      const eq = p.summaryReasonCodes.includes('EQUIVALENT_FOR_PROFILE'), cell = (me, other) => ({ relation: eq ? 'EQUIVALENT' : p.higherLotId === me ? 'HIGHER' : 'LOWER', reasonCode: p.summaryReasonCodes[0], fitDelta: p.higherLotId === me ? p.fitDelta : -p.fitDelta, otherLotId: other });
      matrix[i][j] = cell(ids[i], ids[j]); matrix[j][i] = cell(ids[j], ids[i]);
    }
    // per-preference rows: same profile keys, values and match per lot; winners by match score (ties named, missing data never a loss)
    const cfgOrder = Object.keys(((App.fit.cfgOf(r.developmentId) || {}).preferences) || {}), keySet = new Set();
    for (const id of known) for (const m of (items.get(id).fit ? items.get(id).fit.preferenceMatches : [])) keySet.add(m.key);
    const keys = [...keySet].sort((a, b) => (cfgOrder.indexOf(a) - cfgOrder.indexOf(b)) || a.localeCompare(b));
    const winsByLot = Object.fromEntries(known.map(id => [id, 0])), eps = 1e-9;
    const preferences = keys.map(k => {
      let metricKey = null, importance = null;
      const values = known.map(id => {
        const x = items.get(id), m = x.fit ? x.fit.preferenceMatches.find(q => q.key === k) : null, c = contribOf(x).get(k);
        if (m) { metricKey = m.fieldKey; importance = m.importance; }
        return { lotId: id, actual: m ? m.rawLotValue : null, target: m ? m.targetValue : null, match: m ? m.matchScore : null, contribution: c ? c.c : null, dataStatus: m ? m.dataStatus : null, evaluated: !!(m && m.matchScore != null), failed: !!(m && m.status === 'FAILED') };
      });
      const ev = values.filter(v => v.evaluated), comparable = ev.length === values.length && values.length >= 2;
      const max = ev.length ? Math.max(...ev.map(v => v.match)) : null, winners = ev.filter(v => v.match >= max - eps).map(v => v.lotId);
      const tied = ev.length >= 2 && winners.length === ev.length;
      if (!tied && ev.length >= 2) for (const w of winners) winsByLot[w]++;
      return { preferenceKey: k, metricKey, importance, values, comparable, winnerLotIds: ev.length >= 2 && !tied ? winners : [], tied, reasonCode: ev.length < 2 ? 'NOT_COMPARABLE' : tied ? 'PREFERENCE_TIED' : comparable ? 'PREFERENCE_WINNER' : 'NOT_COMPARABLE',
        notComparableLotIds: values.filter(v => !v.evaluated).map(v => v.lotId) };
    });
    const warnings = [];
    if (preferences.some(p => !p.comparable)) warnings.push('HAS_NOT_COMPARABLE_FACTORS');
    if (known.length < ids.length) warnings.push('NOT_IN_RESULTS');
    if (new Set(known.map(id => items.get(id).standing)).size > 1) warnings.push('DIFFERENT_ELIGIBILITY');
    return Object.freeze({ status: known.length === ids.length ? 'COMPLETE' : known.length >= 2 ? 'PARTIAL' : 'UNAVAILABLE', lotIds: ids, lots, order, matrix, pairs, preferences, winsByLot, equivalenceEpsilon: pol.equivalenceEpsilon,
      summaryReasonCodes: order.length && known.length >= 2 ? [comparePair(r, order[0], order[1], opts).summaryReasonCodes[0]] : ['NOT_IN_RESULTS'], warnings });
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

  // ---------------------------------------------------------------- ExplanationViewModel
  const LEVELS = Object.freeze({ L0: 'headline', L1: 'reasons', L2: 'preferenceTable', L3: 'technical' });
  /** levels a mode may see, from the explanation policy (clientLevels / brokerLevels) when present */
  function levelsFor(mode, pol) {
    const client = mode === 'client', list = pol && (client ? pol.clientLevels : pol.brokerLevels);
    return Array.isArray(list) && list.length ? { levels: list.filter(l => l in LEVELS), source: 'POLICY' } : { levels: client ? ['L0', 'L1'] : ['L0', 'L1', 'L2', 'L3'], source: 'DEFAULT' };
  }
  const PARAM_TYPE = { 'commercial.price': 'MONEY', 'commercial.pricePerM2': 'MONEY', 'geometry.areaM2': 'AREA', 'mobility.routeDistanceToGateM': 'METERS', 'mobility.routeDistanceToLeisureM': 'METERS', 'location.distanceToExternalRoadM': 'METERS', 'fit.coverage': 'PERCENT', 'fit.confidence': 'PERCENT' };
  /** viewModel(explanation, { mode, fitCfg, policy }) → ExplanationViewModel. All text comes from App.reasonCodes (client wording has no codes);
      values are formatted here, never in the engine. Sections outside the mode's levels are left out. */
  function viewModel(e, opts = {}) {
    const RC = App.reasonCodes, mode = opts.mode === 'client' ? 'client' : 'broker', fitCfg = opts.fitCfg || (e && e.developmentId ? App.fit.cfgOf(e.developmentId) : null) || {};
    const pol = opts.policy || (e && e.developmentId ? policyOf(e.developmentId) : DEFAULT_POLICY), { levels, source } = levelsFor(mode, pol), has = l => levels.includes(l);
    const prefLabel = k => ((fitCfg.preferences || {})[k] || {}).label || (mode === 'client' ? 'Preferência' : k);
    const impLabel = i => ((fitCfg.importanceLabels || {})[i]) || null;
    const L = (code, params) => RC.label(code, mode, params) || (mode === 'client' ? null : code);
    if (!e) return Object.freeze({ mode, levels, levelsSource: source, status: 'UNAVAILABLE', headline: { code: 'NOT_IN_RESULTS', text: L('NOT_IN_RESULTS') } });
    // headline from codes: review phrased by its primary reason category; exclusion by its reason
    let hc = (e.summaryReasonCodes || [])[0] || 'NOT_IN_RESULTS', hp = null;
    if (hc === 'REVIEW_REQUIRED' && e.reviewCategory) hc = 'REVIEW_' + e.reviewCategory;
    if (e.status === 'EXCLUDED') { const x = e.exclusionFactors[0] || {}; hp = { reason: L(x.reasonCode, paramsOf(x)) }; }
    const vm = { mode, levels, levelsSource: source, status: e.status, standing: e.standing || null, headline: { code: hc, text: L(hc, hp) } };
    if (has('L1')) {
      vm.positives = (e.positiveFactors || []).map(f => ({ code: RC.matchCode(f.preferenceKey), preferenceKey: f.preferenceKey, label: prefLabel(f.preferenceKey), text: L(RC.matchCode(f.preferenceKey)), contribution: f.contribution, importance: impLabel(f.importance) }));
      vm.tradeOffs = (e.negativeFactors || []).map(f => ({ code: 'TRADE_OFF', preferenceKey: f.preferenceKey, label: prefLabel(f.preferenceKey), text: L('TRADE_OFF', { label: prefLabel(f.preferenceKey), lost: f.lost }), lostPoints: f.lost, importance: impLabel(f.importance) }));
      vm.exclusions = (e.exclusionFactors || []).map(f => ({ code: f.reasonCode, stage: f.stage, label: f.constraintLabel || null, text: L(f.reasonCode, paramsOf(f)), actual: fmtValue(f.metricKey, f.actualValue), expected: fmtValue(f.metricKey, f.targetValue) }));
      const exCodes = new Set((e.exclusionFactors || []).map(f => f.reasonCode));
      vm.constraints = (e.constraintFactors || []).filter(f => f.factorType !== 'CONSTRAINT_PASS' && !exCodes.has(f.reasonCode)).map(f => ({ code: f.reasonCode, status: f.factorType, text: L(f.reasonCode, paramsOf(f)) }));
      const seen = new Set();
      vm.dataQuality = (e.dataQualityFactors || []).filter(f => { const k = f.reasonCode + '|' + (mode === 'client' ? '' : f.metricKey); if (seen.has(k)) return false; seen.add(k); return true; })
        .filter(f => RC.visibleIn(f.reasonCode, mode) || mode !== 'client')
        .map(f => { const d = RC.get(f.reasonCode); return { code: f.reasonCode, severity: f.severity || (d ? d.severity : 'INFO'), text: L(f.reasonCode, paramsOf(f)), ...(mode === 'client' ? {} : { metricKey: f.metricKey, dataStatus: f.dataStatus }), ...(f.preferenceKey ? { preferenceLabel: prefLabel(f.preferenceKey) } : {}) }; });
      vm.summary = (e.summaryReasonCodes || []).slice(1).filter(c => RC.visibleIn(c, mode)).map(c => ({ code: c, text: L(c) })).filter(x => x.text);
    }
    if (has('L2')) vm.preferenceTable = (e.preferenceTable || []).map(t => ({ preferenceKey: t.key, label: prefLabel(t.key), importance: impLabel(t.importance), match: t.match == null ? null : App.fmt.formatPercentage(t.match), contribution: t.contribution == null ? null : App.fmt.number(t.contribution, 1),
      evaluated: t.match != null, dataStatus: App.fmt.formatDataStatus(t.dataStatus), actual: fmtValue(t.fieldKey, t.actual) }));
    if (has('L3')) vm.technical = { summaryReasonCodes: e.summaryReasonCodes || [], versions: e.versions || {}, diagnostics: e.diagnostics || [], rank: e.rank ?? null, tier: e.tier ?? null, fitScore: e.fitScore ?? null, coverage: e.coverage ?? null, confidence: e.confidence ?? null };
    return Object.freeze(vm);
  }
  function fmtValue(metricKey, v) {
    if (v == null) return null;
    const t = metricKey === 'availability.status' ? (Array.isArray(v) ? 'AVAILABILITY_LIST' : 'AVAILABILITY') : PARAM_TYPE[metricKey];
    if (t) return App.reasonCodes.format(t, v);
    if (typeof v === 'boolean') return App.fmt.formatBool(v);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'number') return App.fmt.number(v, Number.isInteger(v) ? 0 : 1);
    if (typeof v === 'object') return null;
    return String(v);
  }
  /** label params from a factor (raw values; App.reasonCodes formats them by the declared type) */
  function paramsOf(f) {
    const p = { actual: f.actualValue, expected: f.targetValue, label: f.constraintLabel || null };
    if (f.reasonCode === 'LOW_FIT') { p.actual = f.actualValue; p.expected = f.targetValue; }
    return p;
  }
  return Object.freeze({ LEVELS, policyOf, levelsFor, rankingTrace, explainLot, comparePair, compareMany, rankChange, explainTechnical, viewModel });
})();
