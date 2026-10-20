/* intelligence/fit.js — customer Fit Score (topic 14).
   How well a lot matches ONE customer's stated preferences. It is relative to the
   profile, never a purchase probability and never a replacement for the base scores
   (which stay identical for every customer). Pure: CustomerProfile + canonical Lot +
   FitMethodologyConfig → FitScoreResult. Availability never changes the Fit.

   Pieces: CustomerProfile / CustomerPreference (schema + validation + builder),
   MatchingRegistry (named matchers, no eval), FitScoreEngine (single and batch),
   coverage (how much of the profile could be evaluated), confidence (quality of the
   inputs used), reason codes, strengths and mismatches, cache key.
   Robustness: validateConfig(cfg) checks the methodology before use; a matcher that throws
   or returns NaN/Infinity/out-of-range marks THAT preference FAILED (never a silent 0) and
   the result itself is validated (FAILED, fitScore null). profileWarnings derives
   CONTRADICTORY_PREFERENCES / PROFILE_TRADEOFF from the lots, never from invented limits. */
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
  function validateProfile(profile, cfg, opts = {}) {
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
    if (!errors.length && opts.lots) warnings.push(...profileWarnings(profile, opts.lots, cfg));
    return { ok: !errors.length, errors, warnings };
  }
  const TARGET_TYPES = new Set(['BOOLEAN', 'ENUM', 'CATEGORICAL_SET', 'NUMERIC_RANGE', 'NUMERIC_TARGET', 'MINIMUM', 'MAXIMUM']);
  /** profileWarnings(profile, lots, cfg) → warnings derived from the data (never from invented limits):
      PREFERENCE_NOT_SATISFIABLE  a target preference (budget, range, yes/no, orientation) that no lot fully meets;
      CONTRADICTORY_PREFERENCES   two target preferences each met by some lot, never by the same lot;
      PROFILE_TRADEOFF            two preferences each strongly matched by some lot, never by the same lot.
      Availability is not read (the Fit never reads it): the statement is about the lots given. Unknown data is never a match. */
  function profileWarnings(profile, lots, cfg) {
    const prefs = effectivePreferences(profile, cfg), out = [];
    if (!prefs.length || !lots || !lots.length) return out;
    const ctx = contextFor(lots), rows = prefs.map(p => {
      const d = cfg.preferences[p.key], full = [], strong = [];
      for (const l of lots) {
        const v = get(l, d.fieldKey); let m = null;
        if (v != null) { try { m = MATCHERS[d.type].run(v, p, d, ctx); } catch (e) { m = null; } }
        const okm = typeof m === 'number' && Number.isFinite(m);
        full.push(okm && m >= 1); strong.push(okm && m >= cfg.strengthMin);
      }
      return { key: p.key, target: TARGET_TYPES.has(d.type), full, strong, nFull: full.filter(Boolean).length, nStrong: strong.filter(Boolean).length };
    });
    for (const r of rows) if (r.target && !r.nFull) out.push({ code: 'PREFERENCE_NOT_SATISFIABLE', path: 'preferences', keys: [r.key], counts: { [r.key]: 0 }, lotCount: lots.length, message: `nenhum dos ${lots.length} lotes atende totalmente a ${r.key}` });
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j], both = a.target && b.target;
      const [fa, fb, na, nb] = both ? [a.full, b.full, a.nFull, b.nFull] : [a.strong, b.strong, a.nStrong, b.nStrong];
      if (!na || !nb) continue;
      let joint = 0; for (let k = 0; k < lots.length; k++) if (fa[k] && fb[k]) joint++;
      if (joint) continue;
      out.push(both ? { code: 'CONTRADICTORY_PREFERENCES', path: 'preferences', keys: [a.key, b.key], counts: { [a.key]: na, [b.key]: nb, both: 0 }, lotCount: lots.length, basis: 'FULL_MATCH', message: `nenhum lote atende ao mesmo tempo ${a.key} e ${b.key}` }
        : { code: 'PROFILE_TRADEOFF', path: 'preferences', keys: [a.key, b.key], counts: { [a.key]: na, [b.key]: nb, both: 0 }, lotCount: lots.length, basis: 'STRONG_MATCH', message: `nenhum lote é forte em ${a.key} e ${b.key} ao mesmo tempo` });
    }
    return out;
  }

  // ---------------------------------------------------------------- methodology config validation
  const SEMVER = /^\d+\.\d+\.\d+$/;
  const isNum = v => typeof v === 'number' && Number.isFinite(v), in01 = v => isNum(v) && v >= 0 && v <= 1;
  /** validateConfig(cfg) → { ok, errors, warnings }: weights, ranges, matcher types and their parameters, templates. Never throws. */
  function validateConfig(cfg) {
    const errors = [], warnings = [], E = (code, path, message) => errors.push({ code, path, message }), Wn = (code, path, message) => warnings.push({ code, path, message });
    if (!cfg || typeof cfg !== 'object') { E('INVALID_CONFIG', '', 'config ausente'); return { ok: false, errors, warnings }; }
    if (cfg.kind !== 'fit-methodology') E('INVALID_KIND', 'kind', 'kind deve ser fit-methodology');
    for (const k of ['fitMethodologyId', 'fitMethodologyVersion', 'developmentId']) if (typeof cfg[k] !== 'string' || !cfg[k]) E('MISSING_FIELD', k, `${k} obrigatório`);
    if (cfg.fitMethodologyVersion && !SEMVER.test(cfg.fitMethodologyVersion)) E('INVALID_VERSION', 'fitMethodologyVersion', 'use semver (1.0.0)');
    if (!(isNum(cfg.scale) && cfg.scale > 0)) E('INVALID_SCALE', 'scale', 'escala numérica positiva obrigatória');
    const imp = cfg.importanceMap && typeof cfg.importanceMap === 'object' ? cfg.importanceMap : (E('MISSING_FIELD', 'importanceMap', 'importanceMap obrigatório'), {});
    if (!Object.keys(imp).length) E('MISSING_FIELD', 'importanceMap', 'importanceMap vazio');
    for (const [k, w] of Object.entries(imp)) if (!(isNum(w) && w > 0)) E('INVALID_WEIGHT', 'importanceMap.' + k, `peso deve ser número positivo (${w})`);
    for (const [k, v] of Object.entries(cfg.legacyImportance || {})) if (!(v in imp)) E('INVALID_IMPORTANCE', 'legacyImportance.' + k, `importância inexistente: ${v}`);
    for (const k of ['minCoverage', 'strengthMin', 'mismatchMax']) if (!in01(cfg[k])) E('INVALID_RANGE', k, `${k} entre 0 e 1`);
    if (in01(cfg.strengthMin) && in01(cfg.mismatchMax) && !(cfg.mismatchMax < cfg.strengthMin)) E('THRESHOLD_ORDER', 'mismatchMax', 'mismatchMax deve ser menor que strengthMin');
    const conf = cfg.confidence || (E('MISSING_FIELD', 'confidence', 'confidence obrigatório'), {});
    const statuses = App.enums && App.enums.DataStatus ? Object.keys(App.enums.DataStatus) : null;
    for (const [k, v] of Object.entries(conf.byDataStatus || {})) { if (!in01(v)) E('INVALID_RANGE', 'confidence.byDataStatus.' + k, 'confiança entre 0 e 1'); if (statuses && !statuses.includes(k)) E('UNKNOWN_ENUM', 'confidence.byDataStatus.' + k, `status de dado inexistente: ${k}`); }
    if (statuses && conf.byDataStatus) for (const s of statuses) if (!(s in conf.byDataStatus)) Wn('MISSING_DATA_STATUS', 'confidence.byDataStatus', `sem confiança para ${s} (vale 0)`);
    if (conf.stalePenalty != null && !in01(conf.stalePenalty)) E('INVALID_RANGE', 'confidence.stalePenalty', 'stalePenalty entre 0 e 1');
    const lv = Array.isArray(conf.levels) ? conf.levels : (E('MISSING_FIELD', 'confidence.levels', 'níveis obrigatórios'), []);
    if (lv.some((l, i) => !in01(l.gte) || (i && l.gte >= lv[i - 1].gte))) E('THRESHOLD_ORDER', 'confidence.levels', 'níveis decrescentes entre 0 e 1');
    if (lv.length && lv[lv.length - 1].gte !== 0) E('THRESHOLD_ORDER', 'confidence.levels', 'o último nível deve começar em 0');
    const prefs = cfg.preferences && typeof cfg.preferences === 'object' ? cfg.preferences : (E('MISSING_FIELD', 'preferences', 'preferences obrigatório'), {});
    for (const [k, d] of Object.entries(prefs)) {
      const p = 'preferences.' + k;
      if (!d || typeof d !== 'object') { E('INVALID_PREFERENCE', p, 'definição ausente'); continue; }
      if (!MatchingRegistry.has(d.type)) E('UNKNOWN_MATCHER', p + '.type', `matcher não registrado: ${d.type}`);
      if (!d.fieldKey || (App.model && !App.model.field(d.fieldKey))) E('UNKNOWN_FIELD_KEY', p + '.fieldKey', `fieldKey fora do registro: ${d.fieldKey}`);
      if (!d.label) Wn('MISSING_LABEL', p + '.label', 'preferência sem rótulo');
      if (d.type === 'SCORE_PREFERENCE' && !(isNum(d.scaleMax) && d.scaleMax > 0)) E('MISSING_PARAM', p + '.scaleMax', 'scaleMax positivo obrigatório');
      if (d.type === 'PROXIMITY' || d.type === 'AVOIDANCE') {
        if (!isNum(d.idealM) || !isNum(d.zeroAtM)) E('MISSING_PARAM', p, 'idealM e zeroAtM obrigatórios');
        else if (d.type === 'PROXIMITY' ? !(d.idealM < d.zeroAtM) : !(d.zeroAtM < d.idealM)) E('INVALID_RANGE', p, d.type === 'PROXIMITY' ? 'idealM deve ser menor que zeroAtM' : 'zeroAtM deve ser menor que idealM');
      }
      if ((d.type === 'MAXIMUM' || d.type === 'MINIMUM') && d.toleranceRatio != null && !(isNum(d.toleranceRatio) && d.toleranceRatio >= 0)) E('INVALID_PARAM', p + '.toleranceRatio', 'tolerância não negativa');
      if (d.type === 'NUMERIC_RANGE' && d.toleranceM2 != null && !(isNum(d.toleranceM2) && d.toleranceM2 >= 0)) E('INVALID_PARAM', p + '.toleranceM2', 'tolerância não negativa');
      if (d.type === 'BOOLEAN' && d.target != null && typeof d.target !== 'boolean') E('INVALID_PARAM', p + '.target', 'alvo booleano');
      if (d.type === 'ENUM') for (const [t, m] of Object.entries(d.similarity || {})) for (const [v, x] of Object.entries(m || {})) if (!in01(x)) E('INVALID_RANGE', `${p}.similarity.${t}.${v}`, 'similaridade entre 0 e 1');
      if (d.type === 'RELATIVE_HIGHER' && d.fieldKey !== 'geometry.areaM2') Wn('MISSING_CONTEXT_RANGE', p, 'RELATIVE_HIGHER só tem faixa para geometry.areaM2: a preferência ficará sem avaliação');
    }
    (cfg.templates || []).forEach((t, i) => {
      for (const [k, v] of Object.entries(t.preferences || {})) {
        if (!(k in prefs)) E('UNKNOWN_PREFERENCE', `templates[${i}].preferences.${k}`, `preferência inexistente: ${k}`);
        if (!(v in imp)) E('INVALID_IMPORTANCE', `templates[${i}].preferences.${k}`, `importância inexistente: ${v}`);
      }
    });
    return { ok: !errors.length, errors, warnings };
  }
  /** minimum coverage of the methodology (Quick View: "poucos dados para este perfil"); null when the config has none (never invented) */
  const minCoverage = devOrCfg => { const c = typeof devOrCfg === 'string' ? cfgOf(devOrCfg) : devOrCfg; return c && in01(c.minCoverage) ? c.minCoverage : null; };
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
    const ctx = { ranges, commercialFreshness: opts.commercialFreshness || null, priceTableVersion: opts.priceTableVersion || null, analysisVersion: opts.analysisVersion || null, generatedAt: opts.generatedAt || null };
    if (opts.dataRevision != null) ctx.dataRevision = opts.dataRevision;
    return ctx;
  }
  function cacheKey(profile, lot, cfg, ctx, usesPrice) {
    const k = [profile.id, profile.profileVersion, lot.identity.id, ctx.analysisVersion || 'analysis?', usesPrice ? (ctx.priceTableVersion || 'price?') : '-', cfg.fitMethodologyVersion];
    if (ctx.dataRevision != null) k.push('rev' + ctx.dataRevision); // data revision: a new price with the same table version is a new result
    return k.join('|');
  }
  function levelOf(cfg, v) { return v == null ? 'UNKNOWN' : cfg.confidence.levels.find(l => v >= l.gte).level; }

  /** fitLot(profile, lot, cfg, ctx) → FitScoreResult */
  function fitLot(profile, lot, cfg, ctx) {
    const prefs = effectivePreferences(profile, cfg), W = cfg.importanceMap;
    const base = { customerProfileId: profile.id, customerProfileVersion: profile.profileVersion, lotId: lot.identity.id, code: lot.identity.code,
      versions: { fitMethodologyVersion: cfg.fitMethodologyVersion, profileVersion: profile.profileVersion, lotAnalysisVersion: ctx.analysisVersion || null, priceTableVersion: null }, generatedAt: ctx.generatedAt || null };
    if (!prefs.length) return Object.freeze({ ...base, status: 'INSUFFICIENT_PROFILE', fitScore: null, coverage: 0, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: [], domainMatches: [], strengths: [], mismatches: [], neutral: [], warnings: [{ code: 'EMPTY_PROFILE' }], missingInputs: [], cacheKey: null });
    let num = 0, den = 0, wAll = 0, confNum = 0, usesPrice = false; const matches = [], missing = [], warnings = [], failed = [];
    for (const p of prefs) {
      const d = cfg.preferences[p.key], w = W[p.importance], v = get(lot, d.fieldKey), prov = App.model.getFieldProvenance(lot, d.fieldKey);
      wAll += w;
      const mr = { preferenceId: p.id, key: p.key, fieldKey: d.fieldKey, preferenceType: d.type, domain: d.domain, rawLotValue: v ?? null, targetValue: p.target ?? d.target ?? null,
        matchScore: null, importance: p.importance, weight: w, weightedContribution: null, dataStatus: prov.status, confidence: prov.confidence || null, reasonCode: null };
      if (v == null) { mr.reasonCode = 'FIT_MISSING_LOT_DATA'; missing.push(d.fieldKey); matches.push(mr); continue; }
      let m, threw = null;
      try { m = MATCHERS[d.type].run(v, p, d, ctx); } catch (e) { threw = e || new Error('erro no matcher'); }
      if (threw || (m != null && !(typeof m === 'number' && Number.isFinite(m) && m >= 0 && m <= 1))) { // never a silent 0: that preference FAILED, out of the average, coverage drops
        mr.reasonCode = threw ? 'FIT_MATCHER_FAILED' : 'FIT_INVALID_MATCH'; mr.status = 'FAILED'; mr.error = threw ? String(threw.message || threw) : `resultado inválido (${m})`;
        failed.push(p.key); warnings.push({ code: 'MATCHER_FAILED', key: p.key, fieldKey: d.fieldKey, reasonCode: mr.reasonCode }); matches.push(mr); continue;
      }
      if (m == null) { mr.reasonCode = 'FIT_MISSING_CONTEXT'; missing.push(d.fieldKey); matches.push(mr); continue; }
      if (d.usesPrice) usesPrice = true;
      let q = cfg.confidence.byDataStatus[prov.status] ?? 0;
      if (d.usesPrice && ctx.commercialFreshness === 'STALE') { q *= cfg.confidence.stalePenalty; warnings.push({ code: 'STALE_PRICE', fieldKey: d.fieldKey }); }
      mr.matchScore = m; mr.weightedContribution = w * m;
      mr.reasonCode = m >= cfg.strengthMin ? 'FIT_STRONG_MATCH' : m <= cfg.mismatchMax ? 'FIT_MISMATCH' : 'FIT_PARTIAL_MATCH';
      num += w * m; den += w; confNum += w * q; matches.push(mr);
    }
    const coverage = wAll ? den / wAll : 0;
    if (!Number.isFinite(wAll) || !Number.isFinite(den) || !Number.isFinite(num)) // a non-numeric weight would silently turn into "no evaluable preference"
      return Object.freeze({ ...base, status: 'FAILED', fitScore: null, coverage: 0, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: matches, domainMatches: [], strengths: [], mismatches: [], neutral: [],
        warnings: [...warnings, { code: 'INVALID_FIT_RESULT', fitScore: 'NaN', coverage: String(coverage), confidence: 'NaN' }], missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice), failedPreferences: failed });
    if (!den) return Object.freeze({ ...base, status: failed.length ? 'FAILED' : 'PARTIAL', fitScore: null, coverage, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: matches, domainMatches: [], strengths: [], mismatches: [], neutral: [], warnings: failed.length ? [...warnings, { code: 'NO_EVALUABLE_PREFERENCE' }] : [{ code: 'NO_EVALUABLE_PREFERENCE' }], missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice), ...(failed.length ? { failedPreferences: failed } : {}) });
    const fit = cfg.scale * num / den, confValue = confNum / den;
    // result validation: NaN, Infinity or out of range is FAILED (fitScore null), never a number shown as a score
    if (!(Number.isFinite(fit) && fit >= -1e-9 && fit <= cfg.scale + 1e-9 && Number.isFinite(coverage) && coverage >= 0 && coverage <= 1 + 1e-12 && Number.isFinite(confValue) && confValue >= -1e-12 && confValue <= 1 + 1e-12))
      return Object.freeze({ ...base, status: 'FAILED', fitScore: null, coverage: Number.isFinite(coverage) ? coverage : 0, confidence: { value: null, level: 'UNKNOWN' }, preferenceMatches: matches, domainMatches: [], strengths: [], mismatches: [], neutral: [],
        warnings: [...warnings, { code: 'INVALID_FIT_RESULT', fitScore: Number.isFinite(fit) ? fit : String(fit), coverage: Number.isFinite(coverage) ? coverage : String(coverage), confidence: Number.isFinite(confValue) ? confValue : String(confValue) }], missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice), failedPreferences: failed });
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
      strengths, mismatches, neutral, warnings, missingInputs: [...new Set(missing)], cacheKey: cacheKey(profile, lot, cfg, ctx, usesPrice), ...(failed.length ? { failedPreferences: failed } : {}) });
  }
  /** batch: one context for all lots (single and batch agree by construction) */
  function fitLots(profile, lots, cfg, opts = {}) {
    const v = validateProfile(profile, cfg);
    if (!v.ok) { const e = new Error('perfil inválido: ' + v.errors.map(x => x.code).join(', ')); e.code = 'INVALID_PROFILE'; e.errors = v.errors; throw e; }
    const ctx = opts.context || contextFor(opts.allLots || lots, opts);
    return lots.map(l => fitLot(profile, l, cfg, ctx));
  }
  /** fingerprint of the lot data the profile reads (values + provenance status of the used fieldKeys, and lot ids):
      a new price with the same priceTableVersion is a different key; an availability change is not (the Fit never reads it) */
  function dataFingerprint(profile, lots, cfg) {
    const keys = [...new Set(effectivePreferences(profile, cfg).map(p => cfg.preferences[p.key].fieldKey))], parts = [];
    for (const l of lots) { parts.push(l.identity.id); for (const k of keys) { const v = get(l, k), pr = l.provenance && l.provenance[k]; parts.push(v == null ? '~' : typeof v === 'object' ? JSON.stringify(v) : String(v), pr ? pr.status : ''); } }
    return App.methodology.checksum(keys.join(',') + '#' + parts.join('|'));
  }
  /** memoized batch keyed by profile version + versions + data revision + data fingerprint (availability changes do not invalidate it) */
  function cache() {
    const m = new Map();
    return { get(profile, lots, cfg, opts = {}) { const k = [profile.id, profile.profileVersion, cfg.fitMethodologyVersion, opts.analysisVersion, opts.priceTableVersion, opts.commercialFreshness, lots.length, opts.dataRevision ?? '-', dataFingerprint(profile, lots, cfg)].join('|'); if (!m.has(k)) { if (m.size > 20) m.clear(); m.set(k, new Map(fitLots(profile, lots, cfg, opts).map(r => [r.lotId, r]))); } return m.get(k); }, size: () => m.size, keyOf: (profile, lots, cfg, opts = {}) => [profile.id, profile.profileVersion, cfg.fitMethodologyVersion, opts.analysisVersion, opts.priceTableVersion, opts.commercialFreshness, lots.length, opts.dataRevision ?? '-', dataFingerprint(profile, lots, cfg)].join('|') };
  }
  const label = () => 'Compatibilidade com o perfil';
  return Object.freeze({ SOURCES, TYPES, STATUS, MatchingRegistry, cfgOf, validateProfile, validateConfig, profileWarnings, minCoverage, effectivePreferences, buildProfile, isEmpty, profileCompleteness, contextFor, fitLot, fitLots, cache, dataFingerprint, label });
})();
