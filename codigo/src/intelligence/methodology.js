/* intelligence/methodology.js — ScoringMethodologyConfig (topic 13).
   Weights, thresholds, normalizations, rounding, classes, ranking and alert rules
   live in a JSON config (plat/config/scoring/<development>/<version>.json), not in
   code. This module validates a config, compiles it once (dependency order,
   accessors, checksum), compares two configs (diff), measures the effect of a
   candidate (impact report) and keeps the version lifecycle
   (DRAFT → VALIDATED → PUBLISHED → ARCHIVED). A published config is immutable. */
App.methodology = (() => {
  const N = App.inormalize;
  const STATUS = Object.freeze(['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED']);
  const ROUNDING = Object.freeze(['HALF_EVEN', 'NONE']);
  const AGGREGATIONS = Object.freeze(['WEIGHTED_SUM', 'WEIGHTED_AVERAGE']);
  const MISSING = Object.freeze(['BLOCK_SCORE', 'IGNORE_AND_RENORMALIZE', 'NEUTRAL', 'ZERO_CONTRIBUTION']);
  const CLASS_METHODS = Object.freeze(['PERCENTILE_BANDS']);
  const RANK_METHODS = Object.freeze(['COMPETITION']);
  const LOT_CLASSES = ['A_PLUS', 'A', 'B', 'C', 'D'];

  /** FNV-1a 32-bit over the stable JSON (same function as the offline cache) */
  function checksum(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(App.domain.stable(value));
    let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /** inputs an op reads (fieldKeys or criterion ids) */
  function stepInputs(s) {
    const out = [];
    if (s.input) out.push(s.input); if (s.inputs) out.push(...s.inputs); if (s.inputMinOf) out.push(...s.inputMinOf);
    if (s.terms) s.terms.forEach(t => t.input && out.push(t.input));
    return out;
  }
  /** topological order of criteria; throws CYCLE with the path */
  function orderCriteria(criteria) {
    const ids = new Set(criteria.map(c => c.id)), deps = new Map(criteria.map(c => [c.id, [...new Set(c.steps.flatMap(stepInputs).filter(k => ids.has(k) && k !== c.id))]]));
    const order = [], state = new Map();
    const visit = (id, path) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) { const e = new Error('dependência circular: ' + [...path, id].join(' → ')); e.code = 'CYCLE'; throw e; }
      state.set(id, 1); for (const d of deps.get(id)) visit(d, [...path, id]); state.set(id, 2); order.push(id);
    };
    for (const c of criteria) visit(c.id, []);
    return { order, deps };
  }

  /** validate(config, { metricKeys }) → { ok, errors, warnings } (codes, never throws) */
  function validate(cfg, opts = {}) {
    const errors = [], warnings = [], E = (code, path, message) => errors.push({ code, path, message }), W = (code, path, message) => warnings.push({ code, path, message });
    if (!cfg || typeof cfg !== 'object') { E('INVALID_CONFIG', '', 'config ausente'); return { ok: false, errors, warnings }; }
    if (cfg.kind !== 'scoring-methodology') E('INVALID_KIND', 'kind', 'kind deve ser scoring-methodology');
    for (const k of ['methodologyId', 'methodologyVersion', 'developmentId']) if (typeof cfg[k] !== 'string' || !cfg[k]) E('MISSING_FIELD', k, `${k} obrigatório`);
    if (cfg.methodologyVersion && !/^\d+\.\d+\.\d+$/.test(cfg.methodologyVersion)) E('INVALID_VERSION', 'methodologyVersion', 'use semver (1.0.0)');
    if (!STATUS.includes(cfg.status)) E('INVALID_STATUS', 'status', `status fora de ${STATUS.join(', ')}`);
    const metricKeys = opts.metricKeys || (App.intelligence && App.intelligence.METRIC_KEYS) || null;
    const crit = Array.isArray(cfg.criteria) ? cfg.criteria : (E('MISSING_FIELD', 'criteria', 'criteria obrigatório'), []);
    const ids = new Set();
    crit.forEach((c, i) => {
      const p = `criteria[${i}]`;
      if (!c.id || typeof c.id !== 'string') E('INVALID_CRITERION_ID', p + '.id', 'id obrigatório');
      else if (ids.has(c.id)) E('DUPLICATE_CRITERION', p + '.id', `critério repetido: ${c.id}`); else ids.add(c.id);
      if (c.fieldKey && App.model && !App.model.field(c.fieldKey)) E('UNKNOWN_FIELD_KEY', p + '.fieldKey', `fieldKey fora do registro: ${c.fieldKey}`);
      if (!Array.isArray(c.steps) || !c.steps.length) E('MISSING_STEPS', p + '.steps', 'critério sem normalização');
    });
    crit.forEach((c, i) => (c.steps || []).forEach((s, j) => {
      const p = `criteria[${i}].steps[${j}]`, op = N.get(s.op);
      if (!op) { E('UNKNOWN_NORMALIZER', p + '.op', `normalização não registrada: ${s.op}`); return; }
      for (const prm of op.params) if (s[prm] == null && !(prm === 'input' && s.inputMinOf)) E('MISSING_PARAM', `${p}.${prm}`, `parâmetro obrigatório de ${s.op}`);
      for (const k of stepInputs(s)) if (!ids.has(k) && metricKeys && !metricKeys.includes(k)) E('UNKNOWN_INPUT', p, `entrada desconhecida: ${k}`);
      for (const arr of [s.bands, s.pieces].filter(Boolean)) {
        const lim = arr.map(b => b.lt != null ? b.lt : b.lte).filter(v => v != null);
        if (lim.some((v, k) => k && v <= lim[k - 1])) E('THRESHOLD_ORDER', p, 'limites fora de ordem crescente');
        if (arr.some(b => ['delta', 'value'].some(f => f in b && !Number.isFinite(b[f])))) E('INVALID_NUMBER', p, 'valor não numérico');
      }
      if (s.map && Object.values(s.map).some(v => !Number.isFinite(v))) E('INVALID_NUMBER', p + '.map', 'mapa com valor não numérico');
      if (s.terms && s.terms.some(t => !Number.isFinite(t.weight))) E('INVALID_WEIGHT', p, 'peso não numérico');
      if (s.op === 'CAP' && !(s.min <= s.max)) E('INVALID_RANGE', p, 'CAP com min > max');
    }));
    try { orderCriteria(crit.filter(c => Array.isArray(c.steps))); } catch (e) { E('CYCLE', 'criteria', e.message); }
    const scores = Array.isArray(cfg.scores) ? cfg.scores : (E('MISSING_FIELD', 'scores', 'scores obrigatório'), []);
    const sids = new Set();
    scores.forEach((s, i) => {
      const p = `scores[${i}]`;
      if (sids.has(s.id)) E('DUPLICATE_SCORE', p + '.id', `score repetido: ${s.id}`); sids.add(s.id);
      if (s.fieldKey && App.model && !App.model.field(s.fieldKey)) E('UNKNOWN_FIELD_KEY', p + '.fieldKey', `fieldKey fora do registro: ${s.fieldKey}`);
      if (!AGGREGATIONS.includes(s.aggregation)) E('INVALID_AGGREGATION', p + '.aggregation', `agregação fora de ${AGGREGATIONS.join(', ')}`);
      if (!ROUNDING.includes(s.rounding)) E('INVALID_ROUNDING', p + '.rounding', 'arredondamento desconhecido');
      if (!MISSING.includes(s.missingPolicy)) E('INVALID_MISSING_POLICY', p + '.missingPolicy', `política fora de ${MISSING.join(', ')}`);
      if (!(s.minCoverage >= 0 && s.minCoverage <= 1)) E('INVALID_RANGE', p + '.minCoverage', 'minCoverage entre 0 e 1');
      let sum = 0;
      (s.criteria || []).forEach((c, j) => {
        if (!ids.has(c.criterion)) E('UNKNOWN_CRITERION', `${p}.criteria[${j}]`, `critério inexistente: ${c.criterion}`);
        if (!Number.isFinite(c.weight)) E('INVALID_WEIGHT', `${p}.criteria[${j}].weight`, 'peso não numérico');
        else if (c.weight < 0) E('NEGATIVE_WEIGHT', `${p}.criteria[${j}].weight`, 'peso negativo não é permitido');
        else if (c.weight === 0) W('ZERO_WEIGHT', `${p}.criteria[${j}].weight`, 'peso zero: o critério não conta');
        if (Number.isFinite(c.weight)) sum += c.weight;
      });
      if (s.aggregation === 'WEIGHTED_SUM' && Math.abs(sum - 1) > 1e-9) E('WEIGHT_SUM', p, `pesos somam ${sum}, esperado 1`);
      // ZERO_CONTRIBUTION turns a missing input into a 0 contribution: only with a written justification per criterion (on the score's criterion entry or on the criterion itself)
      if (s.missingPolicy === 'ZERO_CONTRIBUTION') (s.criteria || []).forEach((c, j) => {
        const def = crit.find(x => x.id === c.criterion), ok = v => typeof v === 'string' && v.trim().length > 0;
        if (!ok(c.justification) && !(def && ok(def.justification))) E('MISSING_JUSTIFICATION', `${p}.criteria[${j}]`, `ZERO_CONTRIBUTION exige justificativa para ${c.criterion}: dado ausente viraria contribuição 0`);
      });
    });
    const ov = cfg.overall;
    if (!ov) E('MISSING_FIELD', 'overall', 'overall obrigatório');
    else {
      let sum = 0; (ov.components || []).forEach((c, j) => { if (!sids.has(c.score)) E('UNKNOWN_SCORE', `overall.components[${j}]`, `score inexistente: ${c.score}`); if (!(c.weight >= 0)) E('INVALID_WEIGHT', `overall.components[${j}]`, 'peso inválido'); sum += c.weight || 0; });
      if (Math.abs(sum - 1) > 1e-9) E('WEIGHT_SUM', 'overall', `pesos somam ${sum}, esperado 1`);
    }
    const cl = cfg.classification;
    if (!cl || !CLASS_METHODS.includes(cl.method)) E('INVALID_CLASSIFICATION', 'classification.method', 'método de classe desconhecido');
    else {
      const b = cl.bands || [];
      if (b.map(x => x.class).join() !== LOT_CLASSES.join()) E('CLASS_BOUNDARY', 'classification.bands', 'faixas devem ser A_PLUS, A, B, C, D nesta ordem');
      const lim = b.map(x => x.below);
      if (lim[lim.length - 1] !== null) E('CLASS_BOUNDARY', 'classification.bands', 'a última faixa deve ser aberta (below: null)');
      if (lim.slice(0, -1).some((v, k) => !(v > 0 && v < 1) || (k && v <= lim[k - 1]))) E('CLASS_BOUNDARY', 'classification.bands', 'limites entre 0 e 1, crescentes');
    }
    if (!cfg.ranking || !RANK_METHODS.includes(cfg.ranking.method)) E('INVALID_RANKING', 'ranking.method', 'método de ranking desconhecido');
    else for (const [t, s] of Object.entries(cfg.ranking.scores || {})) if (!sids.has(s) && s !== 'overall') E('UNKNOWN_SCORE', 'ranking.scores.' + t, `score inexistente: ${s}`);
    for (const [k, l] of Object.entries(cfg.levels || {})) {
      if (!ids.has(l.from)) E('UNKNOWN_CRITERION', 'levels.' + k, `critério inexistente: ${l.from}`);
      const g = l.levels.map(x => x.gte); if (g[g.length - 1] !== null || g.slice(0, -1).some((v, i) => i && v >= g[i - 1])) E('THRESHOLD_ORDER', 'levels.' + k, 'níveis devem ser decrescentes e terminar em null');
    }
    for (const a of cfg.lotAdjustments || []) { if (!ids.has(a.criterion)) E('UNKNOWN_CRITERION', 'lotAdjustments', `critério inexistente: ${a.criterion}`); if (!a.reason) E('MISSING_REASON', 'lotAdjustments', `ajuste em ${a.lotCode} sem motivo`); }
    if (cfg.status === 'PUBLISHED' && !cfg.publishedAt) E('MISSING_FIELD', 'publishedAt', 'config publicada precisa de publishedAt');
    if (!cfg.changeReason) W('MISSING_CHANGE_REASON', 'changeReason', 'sem motivo da mudança');
    return { ok: !errors.length, errors, warnings };
  }

  /** compile(config) → frozen CompiledMethodology. Throws INVALID_CONFIG with the errors. */
  function compile(cfg, opts = {}) {
    const v = validate(cfg, opts);
    if (!v.ok) { const e = new Error('config inválida: ' + v.errors.map(x => `${x.code} ${x.path}`).join('; ')); e.code = 'INVALID_CONFIG'; e.errors = v.errors; throw e; }
    const { order, deps } = orderCriteria(cfg.criteria);
    const byId = new Map(cfg.criteria.map(c => [c.id, c]));
    const criteria = order.map(id => { const c = byId.get(id); return Object.freeze({ ...c, deps: deps.get(id), steps: c.steps.map(s => Object.freeze({ ...s, fn: N.get(s.op).run })) }); });
    const adjustments = new Map();
    for (const a of cfg.lotAdjustments || []) { if (!adjustments.has(a.lotCode)) adjustments.set(a.lotCode, []); adjustments.get(a.lotCode).push(Object.freeze({ ...a })); }
    const sum = checksum(cfg);
    return App.domain.deepFreeze({
      methodologyId: cfg.methodologyId, methodologyVersion: cfg.methodologyVersion, developmentId: cfg.developmentId, status: cfg.status, checksum: sum,
      criteria, criteriaById: Object.fromEntries(criteria.map(c => [c.id, c])), scores: cfg.scores, overall: cfg.overall, classification: cfg.classification,
      ranking: cfg.ranking, levels: cfg.levels || {}, alerts: cfg.alerts || [], profiles: cfg.profiles || null, metrics: cfg.metrics || {}, confidence: cfg.confidence || null,
      rounding: cfg.rounding || {}, lotAdjustments: Object.fromEntries(adjustments), warnings: v.warnings
    });
  }
  const cache = new Map();
  /** compiled config cache keyed by checksum (configs are data, so equal checksum = same methodology) */
  function compiled(cfg) { const k = checksum(cfg); if (!cache.has(k)) cache.set(k, compile(cfg)); return cache.get(k); }

  // ---------------------------------------------------------------- diff
  function label(path) {
    if (/weight$/.test(path)) return 'WEIGHT_CHANGED';
    if (/\.(lt|lte|gt|gte|below)$/.test(path)) return 'THRESHOLD_CHANGED';
    if (/\.(delta|value|map\.[^.]+|from|drop|start|span|base|amplitude|targetDeg|center)$/.test(path)) return 'PARAMETER_CHANGED';
    if (/\.op$/.test(path)) return 'NORMALIZATION_CHANGED';
    if (/rounding/.test(path)) return 'ROUNDING_CHANGED';
    if (/missingPolicy|minCoverage/.test(path)) return 'MISSING_POLICY_CHANGED';
    if (/^classification/.test(path)) return 'CLASSIFICATION_CHANGED';
    if (/^ranking/.test(path)) return 'RANKING_CHANGED';
    if (/^(status|publishedAt|createdAt|changeReason|methodologyVersion)$/.test(path)) return 'METADATA_CHANGED';
    return 'VALUE_CHANGED';
  }
  /** diff(a, b) → [{ path, kind, from, to }]. Criteria and scores are matched by id, not position. */
  function diff(a, b) {
    const out = [];
    const keyOf = x => x.id || x.lotCode || x.criterion || x.score || (x.type && !x.op ? x.type : null);
    // keyed comparison only when every item has a unique key (lot adjustments share a criterion: compared by position instead)
    const keyed = arr => { if (!(Array.isArray(arr) && arr.length && arr.every(x => x && typeof x === 'object' && keyOf(x)))) return null; const ks = arr.map(keyOf); return new Set(ks).size === ks.length ? Object.fromEntries(arr.map(x => [keyOf(x), x])) : null; };
    const walk = (x, y, path) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      const kx = keyed(x), ky = keyed(y);
      if (kx && ky && !Object.keys(kx).includes('null')) {
        for (const k of new Set([...Object.keys(kx), ...Object.keys(ky)])) {
          const p = `${path}[${k}]`;
          if (!(k in kx)) out.push({ path: p, kind: /criteria/.test(path) ? 'CRITERION_ADDED' : 'ITEM_ADDED', from: null, to: ky[k] });
          else if (!(k in ky)) out.push({ path: p, kind: /criteria/.test(path) ? 'CRITERION_REMOVED' : 'ITEM_REMOVED', from: kx[k], to: null });
          else walk(kx[k], ky[k], p);
        }
        return;
      }
      if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
        return;
      }
      out.push({ path, kind: label(path), from: x === undefined ? null : x, to: y === undefined ? null : y });
    };
    walk(a, b, '');
    return out;
  }

  // ---------------------------------------------------------------- impact
  /** impact(base, candidate, inputs, opts) → ImpactReport: what a new config would change, without publishing anything */
  function impact(baseCfg, candCfg, inputs, opts = {}) {
    const E = App.intelligence, A = E.analyzeDevelopment(inputs, { methodology: compiled(baseCfg) }), B = E.analyzeDevelopment(inputs, { methodology: compile(candCfg) });
    const ra = new Map(A.results.map(r => [r.lotId, r])), keys = ['housing', 'investment', 'family', 'premium', 'overall'];
    const scores = Object.fromEntries(keys.map(k => [k, { changed: 0, maxAbsDelta: 0, meanDelta: 0 }]));
    const classMatrix = {}, classChanges = [], rankingMoves = [], alertChanges = [];
    let changedLots = 0;
    for (const r of B.results) {
      const o = ra.get(r.lotId); let changed = false;
      for (const k of keys) { const a = o.scores[k], b = r.scores[k]; if (a !== b) { changed = true; scores[k].changed++; if (a == null || b == null) { scores[k].nullTransitions = (scores[k].nullTransitions || 0) + 1; continue; } const d = b - a; scores[k].numeric = (scores[k].numeric || 0) + 1; scores[k].maxAbsDelta = Math.max(scores[k].maxAbsDelta, Math.abs(d)); scores[k].meanDelta += d; } }
      const ck = `${o.class}→${r.class}`; classMatrix[ck] = (classMatrix[ck] || 0) + 1;
      if (o.class !== r.class) { changed = true; classChanges.push({ lotId: r.lotId, code: r.code, from: o.class, to: r.class }); }
      const ov = x => (x.rankings.find(q => q.type === 'OVERALL') || {}).position;
      if (ov(o) !== ov(r)) rankingMoves.push({ lotId: r.lotId, code: r.code, from: ov(o), to: ov(r) });
      const ta = o.alerts.map(x => x.type).join(), tb = r.alerts.map(x => x.type).join();
      if (ta !== tb) { changed = true; alertChanges.push({ lotId: r.lotId, code: r.code, from: o.alerts.map(x => x.type), to: r.alerts.map(x => x.type) }); }
      if (changed) changedLots++;
    }
    for (const k of keys) { if (scores[k].numeric) scores[k].meanDelta /= scores[k].numeric; delete scores[k].numeric; } // a score that becomes (or stops being) null is counted apart, never as 0
    const dist = res => res.reduce((m, r) => (m[r.class] = (m[r.class] || 0) + 1, m), {});
    const share = changedLots / Math.max(1, B.results.length), threshold = opts.massChangeShare ?? 0.2;
    rankingMoves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from) || x.code.localeCompare(y.code, 'pt-BR', { numeric: true }));
    return {
      base: { methodologyVersion: baseCfg.methodologyVersion, checksum: checksum(baseCfg) }, candidate: { methodologyVersion: candCfg.methodologyVersion, checksum: checksum(candCfg) },
      configDiff: diff(baseCfg, candCfg), lotCount: B.results.length, changedLots, changedShare: share, massChange: share >= threshold,
      scores, classDistribution: { base: dist(A.results), candidate: dist(B.results) }, classMatrix, classChanges, rankingMoves: rankingMoves.slice(0, opts.topMoves || 20), alertChanges
    };
  }

  // ---------------------------------------------------------------- lifecycle
  /** MethodologyRegistry: versions of one development's methodology. Published versions never change; rollback only moves the pointer. */
  function registry(initial = []) {
    const versions = new Map(), audit = [];
    let current = null;
    const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
    const log = (action, version, extra) => audit.push({ action, version, at: extra && extra.at || null, reason: extra && extra.reason || null, by: extra && extra.by || null });
    function add(cfg, meta = {}) {
      const v = cfg.methodologyVersion;
      if (versions.has(v)) { const ex = versions.get(v); if (ex.status === 'PUBLISHED' || ex.status === 'ARCHIVED') throw err('PUBLISHED_IMMUTABLE', `a versão ${v} já foi publicada e não pode ser sobrescrita`); }
      const copy = JSON.parse(JSON.stringify(cfg)); versions.set(v, copy); log('ADD', v, meta);
      if (copy.status === 'PUBLISHED') { App.domain.deepFreeze(copy); if (!current) current = v; }
      return copy;
    }
    function update(v, patch, meta = {}) {
      const c = versions.get(v); if (!c) throw err('NOT_FOUND', `versão ${v} não existe`);
      if (c.status === 'PUBLISHED' || c.status === 'ARCHIVED') throw err('PUBLISHED_IMMUTABLE', `a versão ${v} está ${c.status}: crie uma nova versão`);
      const next = { ...c, ...patch, methodologyVersion: v, status: 'DRAFT' }; versions.set(v, next); log('UPDATE', v, meta); return next;
    }
    function markValidated(v, meta = {}) {
      const c = versions.get(v); if (!c) throw err('NOT_FOUND', `versão ${v} não existe`);
      if (c.status !== 'DRAFT') throw err('INVALID_TRANSITION', `${c.status} → VALIDATED não é permitido`);
      const r = validate({ ...c, status: 'VALIDATED' }); if (!r.ok) { const e = err('INVALID_CONFIG', 'config inválida'); e.errors = r.errors; throw e; }
      c.status = 'VALIDATED'; log('VALIDATE', v, meta); return c;
    }
    function publish(v, meta = {}) {
      const c = versions.get(v); if (!c) throw err('NOT_FOUND', `versão ${v} não existe`);
      if (c.status !== 'VALIDATED') throw err('INVALID_TRANSITION', `só uma versão VALIDATED pode ser publicada (está ${c.status})`);
      if (!meta.reason && !c.changeReason) throw err('MISSING_REASON', 'publicar exige o motivo da mudança');
      c.status = 'PUBLISHED'; c.publishedAt = meta.at || c.publishedAt || null; App.domain.deepFreeze(c);
      log('PUBLISH', v, meta); current = v; return c;
    }
    function archive(v, meta = {}) {
      const c = versions.get(v); if (!c) throw err('NOT_FOUND', `versão ${v} não existe`);
      if (v === current) throw err('INVALID_TRANSITION', 'a versão atual não pode ser arquivada; aponte outra antes');
      if (c.status !== 'PUBLISHED') throw err('INVALID_TRANSITION', `só versões publicadas são arquivadas (está ${c.status})`);
      const copy = JSON.parse(JSON.stringify(c)); copy.status = 'ARCHIVED'; versions.set(v, App.domain.deepFreeze(copy)); log('ARCHIVE', v, meta); return copy;
    }
    /** rollback: points "current" at an older published version; the newer one stays as it was */
    function setCurrent(v, meta = {}) {
      const c = versions.get(v); if (!c) throw err('NOT_FOUND', `versão ${v} não existe`);
      if (c.status !== 'PUBLISHED') throw err('INVALID_TRANSITION', `só uma versão publicada pode ser a atual (está ${c.status})`);
      log('SET_CURRENT', v, meta); current = v; return c;
    }
    initial.forEach(c => add(c));
    return { add, update, markValidated, publish, archive, setCurrent, get: v => versions.get(v) || null, current: () => current ? versions.get(current) : null,
      versions: () => [...versions.values()].map(c => ({ methodologyVersion: c.methodologyVersion, status: c.status, checksum: checksum(c) })), audit: () => audit.slice() };
  }
  /** the published config bundled with the app for a development (plat/config/scoring/<dev>/current.json) */
  function current(developmentId) {
    const b = App.configs && App.configs.scoring && App.configs.scoring[developmentId];
    return b ? b.versions[b.current] : null;
  }
  return Object.freeze({ STATUS, validate, compile, compiled, checksum, diff, impact, registry, current, orderCriteria, stepInputs });
})();
