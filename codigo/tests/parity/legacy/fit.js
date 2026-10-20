/* intelligence/fit.js — customer Fit Score (topic 14).
   How well a lot matches ONE customer's stated preferences. It is relative to the
   profile, never a purchase probability and never a replacement for the base scores
   (which stay identical for every customer). Pure: CustomerProfile + canonical Lot +
   FitMethodologyConfig → FitScoreResult. Availability never changes the Fit.

   Pieces: CustomerProfile / CustomerPreference (schema + validation + builder),
   MatchingRegistry (named matchers, no eval), FitScoreEngine (single and batch),
   coverage (how much of the profile could be evaluated), confidence (quality of the
   inputs used), reason codes, strengths and mismatches, cache key. */
App.fit = (() => {
  const M = App.imath, get = App.model.get;
  const SOURCES = Object.freeze(['EXPLICIT_USER', 'BROKER_INTERPRETATION', 'PROFILE_TEMPLATE', 'IMPORTED', 'INFERRED']);
  const TYPES = Object.freeze(['SCORE_PREFERENCE', 'BOOLEAN', 'ENUM', 'CATEGORICAL_SET', 'NUMERIC_RANGE', 'NUMERIC_TARGET', 'MINIMUM', 'MAXIMUM', 'PROXIMITY', 'AVOIDANCE', 'RELATIVE_HIGHER']);
  const STATUS = Object.freeze(['COMPLETE', 'PARTIAL', 'INSUFFICIENT_PROFILE', 'FAILED']);
  const cfgOf = devId => App.configs && App.configs.fit && App.configs.fit[devId];

  // ---------------------------------------------------------------- matchers (0..1)
  const lin = (x, x0, x1) => M.clamp((x - x0) / (x1 - x0), 0, 1);
  const MATCHERS = {
    SCORE_PREFERENCE: { version: '1.0', run: (v, p, d) => M.clamp(v, 0, d.scaleMax) / d.scaleMax },
    BOOLEAN: { version: '1.0', run: (v, p, d) => (v === (p.target ?? d.target) ? 1 : 0) },
    ENUM: { version: '1.0', run: (v, p, d) => { const t = p.target; if (v === t) return 1; const s = d.similarity && d.similarity[t]; return s && s[v] != null ? s[v] : 0; } },
    CATEGORICAL_SET: { version: '1.0', run: (v, p) => (Array.isArray(p.target) && p.target.includes(v) ? 1 : 0) },
    /** inside [min, max] = 1; linear decay to 0 over the tolerance outside it */
    NUMERIC_RANGE: { version: '1.0', run: (v, p, d) => { const t = p.target || {}, tol = p.tolerance ?? d.toleranceM2 ?? 0;
      if ((t.min == null || v >= t.min) && (t.max == null || v <= t.max)) return 1;
      if (!tol) return 0; const off = t.min != null && v < t.min ? t.min - v : v - t.max; return M.clamp(1 - off / tol, 0, 1); } },
    NUMERIC_TARGET: { version: '1.0', run: (v, p) => { const tol = p.tolerance || 1; return M.clamp(1 - Math.abs(v - p.target) / tol, 0, 1); } },
    MINIMUM: { version: '1.0', run: (v, p, d) => { const tol = p.tolerance ?? (d.toleranceRatio != null ? p.target * d.toleranceRatio : 0); return v >= p.target ? 1 : tol ? M.clamp(1 - (p.target - v) / tol, 0, 1) : 0; } },
    MAXIMUM: { version: '1.0', run: (v, p, d) => { const tol = p.tolerance ?? (d.toleranceRatio != null ? p.target * d.toleranceRatio : 0); return v <= p.target ? 1 : tol ? M.clamp(1 - (v - p.target) / tol, 0, 1) : 0; } },
    /** closer is better: 1 up to idealM, 0 from zeroAtM */
    PROXIMITY: { version: '1.0', run: (v, p, d) => 1 - lin(v, p.idealM ?? d.idealM, p.zeroAtM ?? d.zeroAtM) },
    /** farther is better: 0 up to zeroAtM, 1 from idealM */
    AVOIDANCE: { version: '1.0', run: (v, p, d) => lin(v, p.zeroAtM ?? d.zeroAtM, p.idealM ?? d.idealM) },
    /** position inside the development's own range (min–max of all lots), as the panel always did for "área maior" */
    RELATIVE_HIGHER: { version: '1.0', run: (v, p, d, ctx) => { const r = ctx.ranges && ctx.ranges[d.fieldKey]; if (!r) return null; return M.clamp(10 * (v - r.min) / Math.max(1, r.max - r.min), 0, 10) / 10; } }
  };
  const MatchingRegistry = Object.freeze({ has: k => Object.prototype.hasOwnProperty.call(MATCHERS, k), get: k => MATCHERS[k] || null, list: () => Object.keys(MATCHERS) });

  // ---------------------------------------------------------------- profile
  /** CustomerPreference normalization: catalog key → canonical fieldKey + type + importance */
  function validateProfile(profile, cfg) {
    const errors = [], warnings = [], E = (code, path, message) => errors.push({ code, path, message });
    if (!profile || typeof profile !== 'object') { E('INVALID_PROFILE', '', 'perfil ausente'); return { ok: false, errors, warnings }; }
    if (!profile.id) E('MISSING_FIELD', 'id', 'id obrigatório');
    if (!profile.profileVersion) E('MISSING_FIELD', 'profileVersion', 'profileVersion obrigatório');
    const seen = new Map();
    (profile.preferences || []).forEach((p, i) => {
      const path = `preferences[${i}]`, d = cfg.preferences[p.key];
      if (!d) { E('INVALID_FIELDKEY', path + '.key', `preferência fora do catálogo: ${p.key}`); return; }
      if (p.fieldKey && p.fieldKey !== d.fieldKey) E('INVALID_FIELDKEY', path + '.fieldKey', `fieldKey não confere com o catálogo (${d.fieldKey})`);
      if (App.model && !App.model.field(d.fieldKey)) E('INVALID_FIELDKEY', path + '.fieldKey', `fieldKey fora do registro: ${d.fieldKey}`);
      if (p.preferenceType && p.preferenceType !== d.type) E('TYPE_MISMATCH', path + '.preferenceType', `tipo ${p.preferenceType} ≠ ${d.type}`);
      if (!(p.importance in cfg.importanceMap)) E('INVALID_IMPORTANCE', path + '.importance', `importância fora de ${Object.keys(cfg.importanceMap).join(', ')}`);
      if (p.source && !SOURCES.includes(p.source)) E('INVALID_SOURCE', path + '.source', 'origem desconhecida');
      const t = p.target;
      if (d.type === 'NUMERIC_RANGE') { if (!t || (t.min == null && t.max == null)) E('INVALID_TARGET', path + '.target', 'faixa sem limites'); else if (t.min != null && t.max != null && t.min > t.max) E('INVALID_RANGE', path + '.target', 'mínimo maior que o máximo'); }
      if ((d.type === 'MAXIMUM' || d.type === 'MINIMUM') && !(Number.isFinite(t) && t > 0)) E('INVALID_TARGET', path + '.target', 'valor numérico positivo obrigatório');
      if (d.type === 'ENUM' && typeof t !== 'string') E('INVALID_TARGET', path + '.target', 'valor do vocabulário obrigatório');
      if (p.tolerance != null && !(p.tolerance >= 0)) E('INVALID_TOLERANCE', path + '.tolerance', 'tolerância negativa');
      if (seen.has(p.key)) warnings.push({ code: 'DUPLICATE_PREFERENCE', path, message: `preferência repetida (${p.key}): vale a última` });
      seen.set(p.key, i);
    });
    const b = (profile.preferences || []).find(p => p.key === 'budget'), ar = (profile.preferences || []).find(p => p.key === 'areaRange');
    if (b && ar && ar.target && ar.target.min != null && Number.isFinite(b.target) && cfg.minPricePerM2 && b.target < ar.target.min * cfg.minPricePerM2) warnings.push({ code: 'CONTRADICTORY_PREFERENCES', path: 'preferences', message: 'orçamento abaixo do preço da área mínima' });
    return { ok: !errors.length, errors, warnings };
  }
  /** effective preferences: enabled, last one wins per key, deterministic order (catalog order) */
  function effectivePreferences(profile, cfg) {
    const last = new Map(); for (const p of profile.preferences || []) if (p.enabled !== false) last.set(p.key, p);
    return Object.keys(cfg.preferences).filter(k => last.has(k)).map(k => last.get(k));
  }
  /** ProfileBuilder: UI state → CustomerProfile. Numeric UI weights (1–3) map through legacyImportance; no hidden defaults. */
  function buildProfile({ id = 'working-profile', name = null, developmentId = 'viva-juara', preferences = {}, budgetMax = null, areaMin = null, areaMax = null, templateId = null, source = 'EXPLICIT_USER', updatedAt = null } = {}, cfg = cfgOf(developmentId)) {
    const prefs = [];
    const tpl = templateId && cfg.templates.find(t => t.id === templateId);
    for (const [k, w] of Object.entries(preferences || {})) {
      if (!w) continue; const importance = typeof w === 'string' ? w : cfg.legacyImportance[String(w)];
      const d = cfg.preferences[k]; if (!d || !importance) continue;
      const fromTpl = tpl && tpl.preferences[k] === importance;
      prefs.push({ id: `pref-${k}`, key: k, fieldKey: d.fieldKey, preferenceType: d.type, target: d.target ?? null, importance, enabled: true, source: fromTpl ? 'PROFILE_TEMPLATE' : source });
    }
    if (budgetMax != null) prefs.push({ id: 'pref-budget', key: 'budget', fieldKey: cfg.preferences.budget.fieldKey, preferenceType: 'MAXIMUM', target: budgetMax, importance: 'HIGH', enabled: true, source });
    if (areaMin != null || areaMax != null) prefs.push({ id: 'pref-areaRange', key: 'areaRange', fieldKey: cfg.preferences.areaRange.fieldKey, preferenceType: 'NUMERIC_RANGE', target: { min: areaMin, max: areaMax }, importance: 'MEDIUM', enabled: true, source });
    const body = { developmentId, preferences: prefs.map(p => ({ key: p.key, target: p.target, importance: p.importance, enabled: p.enabled })) };
    return { id, name, developmentId, createdAt: null, updatedAt, profileVersion: App.methodology.checksum(body), templateId: tpl ? tpl.id : null, preferences: prefs, constraints: [], budget: budgetMax != null ? { max: budgetMax, currency: 'BRL' } : null, notes: null, metadata: { questionsAnswered: prefs.length } };
  }
  const isEmpty = profile => !profile || !(profile.preferences || []).some(p => p.enabled !== false);
  /** how much of the questionnaire is filled (≠ coverage, which is about lot data) */
  const profileCompleteness = (profile, cfg) => Math.min(1, effectivePreferences(profile, cfg).length / 5);

  // ---------------------------------------------------------------- engine
  /** ranges of the development (for RELATIVE_HIGHER): computed once per batch, never per filter */
  function contextFor(lots, opts = {}) {
    const ranges = {}; const vals = lots.map(l => l.geometry.areaM2).filter(v => v != null);
    if (vals.length) ranges['geometry.areaM2'] = { min: Math.min(...vals), max: Math.max(...vals) };
    return { ranges, commercialFreshness: opts.commercialFreshness || null, priceTableVersion: opts.priceTableVersion || null, analysisVersion: opts.analysisVersion || null, generatedAt: opts.generatedAt || null };
  }
  function cacheKey(profile, lot, cfg, ctx, usesPrice) {
    return [profile.id, profile.profileVersion, lot.identity.id, ctx.analysisVersion || 'analysis?', usesPrice ? (ctx.priceTableVersion || 'price?') : '-', cfg.fitMethodologyVersion].join('|');
  }
  function levelOf(cfg, v) { return v == null ? 'UNKNOWN' : cfg.confidence.levels.find(l => v >= l.gte).level; }

  /** fitLot(profile, lot, cfg, ctx) → FitScoreResult */
  function fitLot(profile, lot, cfg, ctx) {
    const prefs = effectivePreferences(profile, cfg), W = cfg.importanceMap;
    const base = { customerProfileId: profile.id, customerProfileVersion: profile.profileVersion, lotId: lot.identity.id, code: lot.identity.code,
      versions: { fitMethodologyVersion: cfg.fitMethodologyVersion, profileVersion: profile.profileVersion, lotAnalysisVersion: ctx.analysisVersion || null, priceTableVersion: null }, generatedAt: ctx.generatedAt || null };
    if (!prefs.length) return Object.freeze({ ...base, status: 'INSUFFICIENT_PROFILE', fitScore: null, coverage: 0, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: [], domainMatches: [], strengths: [], mismatches: [], neutral: [], warnings: [{ code: 'EMPTY_PROFILE' }], missingInputs: [], cacheKey: null });
    let num = 0, den = 0, wAll = 0, confNum = 0, usesPrice = false; const matches = [], missing = [], warnings = [];
    for (const p of prefs) {
      const d = cfg.preferences[p.key], w = W[p.importance], v = get(lot, d.fieldKey), prov = App.model.getFieldProvenance(lot, d.fieldKey);
      wAll += w;
      const mr = { preferenceId: p.id, key: p.key, fieldKey: d.fieldKey, preferenceType: d.type, domain: d.domain, rawLotValue: v ?? null, targetValue: p.target ?? d.target ?? null,
        matchScore: null, importance: p.importance, weight: w, weightedContribution: null, dataStatus: prov.status, confidence: prov.confidence || null, reasonCode: null };
      if (v == null) { mr.reasonCode = 'FIT_MISSING_LOT_DATA'; missing.push(d.fieldKey); matches.push(mr); continue; }
      const m = MATCHERS[d.type].run(v, p, d, ctx);
      if (m == null) { mr.reasonCode = 'FIT_MISSING_CONTEXT'; missing.push(d.fieldKey); matches.push(mr); continue; }
      if (d.usesPrice) usesPrice = true;
      let q = cfg.confidence.byDataStatus[prov.status] ?? 0;
      if (d.usesPrice && ctx.commercialFreshness === 'STALE') { q *= cfg.confidence.stalePenalty; warnings.push({ code: 'STALE_PRICE', fieldKey: d.fieldKey }); }
      mr.matchScore = m; mr.weightedContribution = w * m;
      mr.reasonCode = m >= cfg.strengthMin ? 'FIT_STRONG_MATCH' : m <= cfg.mismatchMax ? 'FIT_MISMATCH' : 'FIT_PARTIAL_MATCH';
      num += w * m; den += w; confNum += w * q; matches.push(mr);
    }
    const coverage = wAll ? den / wAll : 0;
    if (!den) return Object.freeze({ ...base, status: 'PARTIAL', fitScore: null, coverage, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: matches, domainMatches: [], strengths: [], mismatches: [], neutral: [], warnings: [{ code: 'NO_EVALUABLE_PREFERENCE' }], missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice) });
    const fit = cfg.scale * num / den, confValue = confNum / den;
    if (coverage < cfg.minCoverage) warnings.push({ code: 'LOW_COVERAGE', coverage });
    const dom = {}; for (const m of matches.filter(x => x.matchScore != null)) { const e = dom[m.domain] || (dom[m.domain] = { domain: m.domain, num: 0, den: 0 }); e.num += m.weight * m.matchScore; e.den += m.weight; }
    const ok = matches.filter(m => m.matchScore != null);
    const strengths = ok.filter(m => m.matchScore >= cfg.strengthMin).sort((a, b) => b.weightedContribution - a.weightedContribution || a.key.localeCompare(b.key)).slice(0, 5);
    const mismatches = ok.filter(m => m.matchScore <= cfg.mismatchMax).sort((a, b) => b.weight * (1 - b.matchScore) - a.weight * (1 - a.matchScore) || a.key.localeCompare(b.key)).slice(0, 5);
    const neutral = ok.filter(m => m.matchScore > cfg.mismatchMax && m.matchScore < cfg.strengthMin);
    if (usesPrice) base.versions.priceTableVersion = ctx.priceTableVersion || null;
    return Object.freeze({ ...base, status: coverage < 1 ? 'PARTIAL' : 'COMPLETE', fitScore: fit, coverage, confidence: { value: confValue, level: levelOf(cfg, confValue) },
      preferenceMatches: matches.sort((a, b) => (b.weightedContribution ?? -1) - (a.weightedContribution ?? -1) || a.key.localeCompare(b.key)),
      domainMatches: Object.values(dom).map(e => ({ domain: e.domain, score: cfg.scale * e.num / e.den })).sort((a, b) => a.domain.localeCompare(b.domain)),
      strengths, mismatches, neutral, warnings, missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice) });
  }
  /** batch: one context for all lots (single and batch agree by construction) */
  function fitLots(profile, lots, cfg, opts = {}) {
    const v = validateProfile(profile, cfg);
    if (!v.ok) { const e = new Error('perfil inválido: ' + v.errors.map(x => x.code).join(', ')); e.code = 'INVALID_PROFILE'; e.errors = v.errors; throw e; }
    const ctx = opts.context || contextFor(opts.allLots || lots, opts);
    return lots.map(l => fitLot(profile, l, cfg, ctx));
  }
  /** memoized batch keyed by profile version + data revision (availability changes do not invalidate it) */
  function cache() {
    const m = new Map();
    return { get(profile, lots, cfg, opts = {}) { const k = [profile.id, profile.profileVersion, cfg.fitMethodologyVersion, opts.analysisVersion, opts.priceTableVersion, opts.commercialFreshness, lots.length].join('|'); if (!m.has(k)) { if (m.size > 20) m.clear(); m.set(k, new Map(fitLots(profile, lots, cfg, opts).map(r => [r.lotId, r]))); } return m.get(k); }, size: () => m.size };
  }
  const label = () => 'Compatibilidade com o perfil';
  return Object.freeze({ SOURCES, TYPES, STATUS, MatchingRegistry, cfgOf, validateProfile, effectivePreferences, buildProfile, isEmpty, profileCompleteness, contextFor, fitLot, fitLots, cache, label });
})();
