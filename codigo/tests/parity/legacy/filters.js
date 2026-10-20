/* filters/filters.js — three-level filter system (topic 17).
   FilterRegistry (QUICK / ADVANCED / TECHNICAL definitions on canonical fieldKeys),
   FilterState (what the UI edits: flat keys, persisted per development) → FilterCompiler
   → FilterQuery (versioned, normalized, stable hash) → FilterEngine (matched ids, warnings,
   self-excluding facets, "why not", range stats). The engine never removes lots: the map
   dims what does not match; the selected lot and the comparison are kept. It never
   changes the CustomerProfile or the recommendation: a filter becomes a
   RecommendationScope only through an explicit user action. No eval, whitelisted operators. */
App.filters = (() => {
  const get = App.model.get, QUERY_VERSION = 1, STATE_VERSION = 1;
  const LV = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'], CLS = ['A_PLUS', 'A', 'B', 'C', 'D'];
  const OPS = Object.freeze({
    IN: (v, x) => x.includes(v), EQ: (v, x) => v === x, BETWEEN: (v, x) => (x.min == null || v >= x.min) && (x.max == null || v <= x.max),
    LTE: (v, x) => v <= x, GTE: (v, x) => v >= x, IS_TRUE: v => v === true, IS_FALSE: v => v === false,
    ORDINAL_MAX: (v, x, d) => d.order.indexOf(v) >= 0 && d.order.indexOf(v) <= d.order.indexOf(x),
    ORDINAL_MIN: (v, x, d) => d.order.indexOf(v) >= 0 && d.order.indexOf(v) >= d.order.indexOf(x),
    NOT_CONTAINS_TYPE: (v, x) => Array.isArray(v) && !v.some(a => x.includes(a.type))
  });
  const NULL_POLICIES = Object.freeze(['EXCLUDE_UNKNOWN', 'INCLUDE_UNKNOWN', 'SEPARATE_UNKNOWN', 'IGNORE_CONDITION']);
  // cost: identity/status first, then numbers, then derived/user context (cheap filters first)
  const DEFS = [
    // ---- QUICK
    { id: 'statuses', stateKeys: ['statuses'], fieldKey: 'availability.status', level: 'QUICK', group: 'Comercial', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'SEPARATE_UNKNOWN', options: () => App.enums.AVAILABILITY_ORDER, clientVisible: true, mobilePriority: 1, cost: 0, dynamicType: 'AVAILABILITY', facet: true },
    { id: 'onlyOfferable', stateKeys: ['onlyOfferable'], fieldKey: 'availability.status', level: 'QUICK', group: 'Comercial', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'OFFERABLE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 2, cost: 0, dynamicType: 'AVAILABILITY' },
    { id: 'block', stateKeys: ['block'], fieldKey: 'identity.blockId', level: 'QUICK', group: 'Localização', controlType: 'SELECT', dataType: 'ENUM', operator: 'EQ', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 3, cost: 0, facet: true },
    { id: 'price', stateKeys: ['priceMin', 'priceMax'], fieldKey: 'commercial.price', level: 'QUICK', group: 'Comercial', controlType: 'RANGE', dataType: 'MONEY', unit: 'BRL', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 1, cost: 1, dynamicType: 'COMMERCIAL' },
    { id: 'area', stateKeys: ['areaMin', 'areaMax'], fieldKey: 'geometry.areaM2', level: 'QUICK', group: 'Geometria', controlType: 'RANGE', dataType: 'AREA', unit: 'm²', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 2, cost: 1 },
    { id: 'classMin', stateKeys: ['classMin'], fieldKey: 'intelligence.class', level: 'QUICK', group: 'Análise', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MIN', order: CLS.slice().reverse(), nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, mobilePriority: 4, cost: 1 },
    { id: 'noCorner', stateKeys: ['noCorner'], fieldKey: 'geometry.isCorner', level: 'QUICK', group: 'Geometria', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IS_FALSE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 4, cost: 1 },
    // ---- ADVANCED
    { id: 'shapes', stateKeys: ['shapes'], fieldKey: 'geometry.shape', level: 'ADVANCED', group: 'Geometria', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'SEPARATE_UNKNOWN', options: () => ['RECTANGULAR', 'SQUARE', 'TRAPEZOIDAL', 'IRREGULAR', 'UNKNOWN'], clientVisible: true, cost: 2, facet: true },
    { id: 'greenBehind', stateKeys: ['greenBehind'], fieldKey: 'surroundings.hasGreenRear', level: 'ADVANCED', group: 'Vizinhança', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IS_TRUE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 2 },
    { id: 'rearOrientation', stateKeys: ['rearOrientation'], fieldKey: 'environmental.orientationRear', level: 'ADVANCED', group: 'Conforto', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], clientVisible: true, cost: 2, facet: true },
    { id: 'noiseMax', stateKeys: ['noiseMax'], fieldKey: 'environmental.noiseLevel', level: 'ADVANCED', group: 'Conforto', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MAX', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 2, estimated: true },
    { id: 'privacyMin', stateKeys: ['privacyMin'], fieldKey: 'environmental.privacyLevel', level: 'ADVANCED', group: 'Conforto', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MIN', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 2, estimated: true },
    { id: 'trafficMax', stateKeys: ['trafficMax'], fieldKey: 'mobility.estimatedTraffic', level: 'ADVANCED', group: 'Mobilidade', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MAX', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 2, estimated: true },
    { id: 'gateMaxM', stateKeys: ['gateMaxM'], fieldKey: 'mobility.routeDistanceToGateM', level: 'ADVANCED', group: 'Localização', controlType: 'SELECT', dataType: 'DISTANCE', unit: 'm', operator: 'LTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [200, 400, 650], clientVisible: true, cost: 2 },
    { id: 'clubMaxM', stateKeys: ['clubMaxM'], fieldKey: 'mobility.routeDistanceToLeisureM', level: 'ADVANCED', group: 'Localização', controlType: 'SELECT', dataType: 'DISTANCE', unit: 'm', operator: 'LTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [250, 500, 750], clientVisible: true, cost: 2 },
    { id: 'noNoiseAlert', stateKeys: ['noNoiseAlert'], fieldKey: 'intelligence.alerts', level: 'ADVANCED', group: 'Conforto', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'NOT_CONTAINS_TYPE', fixedValue: ['NOISE'], nullPolicy: 'INCLUDE_UNKNOWN', clientVisible: true, cost: 3 },
    { id: 'favoritesOnly', stateKeys: ['favoritesOnly'], fieldKey: null, level: 'ADVANCED', group: 'Meus lotes', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IN_USER_SET', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 0, dynamicType: 'USER_CONTEXT' },
    // ---- TECHNICAL (broker only)
    { id: 'scoreMin', stateKeys: ['scoreKey', 'scoreMin'], fieldKey: 'intelligence.scores', level: 'TECHNICAL', group: 'Scores', controlType: 'SCORE', dataType: 'SCORE', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, cost: 1 },
    { id: 'alertsExclude', stateKeys: ['alertsExclude'], fieldKey: 'intelligence.alerts', level: 'TECHNICAL', group: 'Alertas', controlType: 'CHIPS', dataType: 'ENUM', operator: 'NOT_CONTAINS_TYPE', nullPolicy: 'INCLUDE_UNKNOWN', options: () => Object.keys(App.rules.ALERTS).filter(k => k !== 'OTHER'), clientVisible: false, cost: 3 },
    { id: 'fitMin', stateKeys: ['fitMin'], fieldKey: null, level: 'TECHNICAL', group: 'Cliente', controlType: 'SELECT', dataType: 'PERCENT', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [50, 60, 70, 80], clientVisible: false, cost: 4, dynamicType: 'FIT' },
    { id: 'dataStatus', stateKeys: ['dataStatusField', 'dataStatus'], fieldKey: null, level: 'TECHNICAL', group: 'Qualidade do dado', controlType: 'PROVENANCE', dataType: 'ENUM', operator: 'PROVENANCE_IN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, cost: 3 }
  ];
  DEFS.forEach((d, i) => { d.sortOrder = i; Object.freeze(d); });
  const BY = Object.fromEntries(DEFS.map(d => [d.id, d]));
  const STATE_KEYS = DEFS.flatMap(d => d.stateKeys);
  const EMPTY = Object.freeze(Object.fromEntries(STATE_KEYS.map(k => [k, ['statuses', 'shapes', 'rearOrientation', 'alertsExclude', 'dataStatus'].includes(k) ? [] : ['onlyOfferable', 'noCorner', 'greenBehind', 'noNoiseAlert', 'favoritesOnly'].includes(k) ? false : null])));
  const isSet = v => v != null && v !== false && v !== '' && !(Array.isArray(v) && !v.length);
  const levelsFor = mode => mode === 'client' ? ['QUICK', 'ADVANCED'] : ['QUICK', 'ADVANCED', 'TECHNICAL'];
  const visible = (d, mode) => mode === 'client' ? d.clientVisible : true;

  // ---------------------------------------------------------------- compiler & validation
  /** FilterState → { query, errors } (invalid conditions are reported and left out, never "fail open") */
  function compile(state, ctx = {}) {
    const s = { ...EMPTY, ...(state || {}) }, errors = [], conds = [];
    for (const d of DEFS) {
      if (ctx.mode && !visible(d, ctx.mode)) continue;
      const vals = d.stateKeys.map(k => s[k]); if (!vals.some(isSet)) continue;
      let value;
      if (d.id === 'price' || d.id === 'area') {
        const [min, max] = vals.map(v => (v == null || v === '' ? null : +v));
        if ([min, max].some(v => v != null && !(Number.isFinite(v) && v >= 0))) { errors.push({ code: 'INVALID_FILTER_VALUE', filterId: d.id }); continue; }
        if (min != null && max != null && min > max) { errors.push({ code: 'INVALID_RANGE', filterId: d.id }); continue; }
        value = { min, max };
      } else if (d.id === 'scoreMin') {
        const [key, min] = vals; if (!isSet(min)) continue;
        if (!['housing', 'investment', 'family', 'premium', 'overall'].includes(key || 'overall') || !(+min >= 0 && +min <= 100)) { errors.push({ code: 'INVALID_FILTER_VALUE', filterId: d.id }); continue; }
        value = { key: key || 'overall', min: +min };
      } else if (d.id === 'dataStatus') {
        const [field, statuses] = vals; if (!field || !isSet(statuses)) continue;
        if (!App.model.field(field)) { errors.push({ code: 'INVALID_FIELD_KEY', filterId: d.id }); continue; }
        value = { fieldKey: field, statuses: [...statuses].sort() };
      } else value = vals[0];
      if (d.operator === 'IN' && !Array.isArray(value) && d.controlType === 'CHIPS') { errors.push({ code: 'INVALID_FILTER_VALUE', filterId: d.id }); continue; }
      if (d.options && Array.isArray(value)) { const ok = d.options(); const bad = value.filter(v => !ok.includes(v)); if (bad.length) { errors.push({ code: 'INVALID_ENUM', filterId: d.id, values: bad }); value = value.filter(v => ok.includes(v)); if (!value.length) continue; } value = [...value].sort(); }
      if (d.order && !d.order.includes(value)) { errors.push({ code: 'INVALID_ENUM', filterId: d.id, values: [value] }); continue; }
      if (['gateMaxM', 'clubMaxM', 'fitMin'].includes(d.id)) { value = +value; if (!Number.isFinite(value)) { errors.push({ code: 'INVALID_FILTER_VALUE', filterId: d.id }); continue; } }
      conds.push({ filterId: d.id, fieldKey: d.fieldKey, operator: d.operator, value: d.fixedValue && value === true ? d.fixedValue : value, nullPolicy: d.nullPolicy, level: d.level });
    }
    conds.sort((a, b) => a.filterId < b.filterId ? -1 : 1); // stable serialization: same meaning, same hash
    const query = { version: QUERY_VERSION, developmentId: ctx.developmentId || 'viva-juara', conditions: conds, scope: null, unknownPolicy: 'PER_FILTER', createdAt: null };
    query.hash = App.methodology.checksum({ v: query.version, d: query.developmentId, c: conds.map(c => [c.filterId, c.value]) });
    return { query, errors };
  }

  // ---------------------------------------------------------------- engine
  /** value provider: the only place that reads the lot for a condition (derived/dynamic values included) */
  function valueOf(c, lot, ctx) {
    if (c.filterId === 'favoritesOnly') return ctx.favorites ? ctx.favorites.has(lot.identity.id) : null;
    if (c.filterId === 'fitMin') { const f = ctx.fit && ctx.fit.get(lot.identity.id); return f ? f.fitScore : null; }
    if (c.filterId === 'scoreMin') return lot.intelligence.scores[c.value.key];
    if (c.filterId === 'dataStatus') return App.model.getFieldProvenance(lot, c.value.fieldKey).status;
    if (c.filterId === 'classMin') return lot.intelligence.class === 'UNKNOWN' ? null : lot.intelligence.class;
    return get(lot, c.fieldKey);
  }
  /** test(condition, lot, ctx) → true | false (null policy applied) */
  function test(c, lot, ctx) {
    const d = BY[c.filterId], v = valueOf(c, lot, ctx);
    if (c.operator === 'IN_USER_SET') return !c.value || v === true;
    if (c.operator === 'OFFERABLE') return !c.value || App.availability.isOfferable(lot.availability.status, ctx.policy);
    if (v == null) return c.nullPolicy === 'INCLUDE_UNKNOWN' || c.nullPolicy === 'IGNORE_CONDITION';
    switch (c.operator) {
      case 'BETWEEN': return OPS.BETWEEN(v, c.value);
      case 'IS_TRUE': return !c.value || v === true;
      case 'IS_FALSE': return !c.value || v === false;
      case 'NOT_CONTAINS_TYPE': return OPS.NOT_CONTAINS_TYPE(v, c.value);
      case 'GTE': return v >= (c.filterId === 'scoreMin' ? c.value.min : c.value);
      case 'PROVENANCE_IN': return c.value.statuses.includes(v);
      default: return OPS[c.operator](v, c.value, d);
    }
  }
  const STALE_SENSITIVE = { COMMERCIAL: 'commercial', AVAILABILITY: 'availability' };
  /** run(lots, query, ctx) → FilterResult. ctx = { policy, favorites, fit, freshness: { commercial, availability }, developmentId } */
  function run(lots, query, ctx = {}) {
    const t0 = ctx.now ? ctx.now() : 0, warnings = [];
    if (query.developmentId && ctx.developmentId && query.developmentId !== ctx.developmentId) return { status: 'INVALID', matchedIds: new Set(), total: lots.length, warnings: [{ code: 'WRONG_DEVELOPMENT' }], hash: query.hash };
    const plan = query.conditions.slice().sort((a, b) => BY[a.filterId].cost - BY[b.filterId].cost || (a.filterId < b.filterId ? -1 : 1));
    for (const c of plan) {
      const d = BY[c.filterId], k = STALE_SENSITIVE[d.dynamicType];
      if (k && ctx.freshness && ctx.freshness[k] && ctx.freshness[k].status === 'STALE') warnings.push({ code: k === 'commercial' ? 'STALE_PRICE' : 'STALE_AVAILABILITY', filterId: c.filterId });
      if (d.estimated) warnings.push({ code: 'ESTIMATED_FIELD', filterId: c.filterId });
      if (d.dynamicType === 'FIT' && !ctx.fit) warnings.push({ code: 'FIT_UNAVAILABLE', filterId: c.filterId });
    }
    const matched = new Set();
    for (const l of lots) { let ok = true; for (const c of plan) if (!test(c, l, ctx)) { ok = false; break; } if (ok) matched.add(l.identity.id); }
    return { status: 'OK', hash: query.hash, matchedIds: matched, total: lots.length, unmatchedCount: lots.length - matched.size, warnings, plan: plan.map(c => c.filterId), elapsedMs: ctx.now ? ctx.now() - t0 : null };
  }
  /** which conditions a lot fails (shown as "fora do filtro porque…") */
  const whyNot = (lot, query, ctx = {}) => query.conditions.filter(c => !test(c, lot, ctx)).map(c => ({ filterId: c.filterId, fieldKey: c.fieldKey, value: valueOf(c, lot, ctx), unknown: valueOf(c, lot, ctx) == null }));
  /** self-excluding facets: counts of each option over the lots that pass every OTHER condition */
  function facets(lots, query, ctx = {}, ids) {
    const out = {};
    for (const d of DEFS.filter(x => x.facet && (!ids || ids.includes(x.id)))) {
      const others = query.conditions.filter(c => c.filterId !== d.id), counts = {};
      for (const l of lots) {
        if (!others.every(c => test(c, l, ctx))) continue;
        const v = get(l, d.fieldKey); const k = v == null ? 'UNKNOWN' : v; counts[k] = (counts[k] || 0) + 1;
      }
      out[d.id] = counts;
    }
    return out;
  }
  /** domain bounds for range controls (from the data, never hard-coded) */
  function rangeStats(lots, fieldKey) { const v = lots.map(l => get(l, fieldKey)).filter(x => x != null); return v.length ? { min: Math.min(...v), max: Math.max(...v), count: v.length, unknown: lots.length - v.length } : { min: null, max: null, count: 0, unknown: lots.length }; }

  // ---------------------------------------------------------------- URL serialization
  const SHORT = { statuses: 'st', onlyOfferable: 'of', block: 'q', priceMin: 'p0', priceMax: 'p1', areaMin: 'a0', areaMax: 'a1', classMin: 'c', noCorner: 'nc', shapes: 'sh', greenBehind: 'g', rearOrientation: 'ro',
    noiseMax: 'nz', privacyMin: 'pv', trafficMax: 'tr', gateMaxM: 'gm', clubMaxM: 'cm', noNoiseAlert: 'na', favoritesOnly: 'fv', scoreKey: 'sk', scoreMin: 'sm', alertsExclude: 'ax', fitMin: 'ft', dataStatusField: 'df', dataStatus: 'ds' };
  const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
  /** compact, stable: keys in registry order, lists sorted. favorites are personal and never go in a link */
  function serialize(state) {
    const s = { ...EMPTY, ...(state || {}) }, parts = [];
    for (const k of STATE_KEYS) { if (k === 'favoritesOnly') continue; const v = s[k]; if (!isSet(v)) continue; parts.push(SHORT[k] + ':' + (Array.isArray(v) ? [...v].sort().join(',') : v === true ? '1' : encodeURIComponent(String(v)))); }
    return parts.join(';');
  }
  /** parse(str) → { state, dropped } (unknown or malformed parts are dropped and reported) */
  function parse(str) {
    const state = {}, dropped = [];
    for (const part of String(str || '').split(';').filter(Boolean)) {
      const i = part.indexOf(':'), k = LONG[part.slice(0, i)], raw = decodeURIComponent(part.slice(i + 1));
      if (i < 0 || !k) { dropped.push(part); continue; }
      const kind = EMPTY[k], numeric = /^(priceMin|priceMax|areaMin|areaMax|gateMaxM|clubMaxM|scoreMin|fitMin)$/.test(k);
      if (numeric && !(raw !== '' && Number.isFinite(+raw))) { dropped.push(part); continue; }
      state[k] = Array.isArray(kind) ? raw.split(',').filter(Boolean) : kind === false ? raw === '1' : numeric ? +raw : raw;
    }
    return { state: Object.fromEntries(Object.entries(state).filter(([, v]) => v != null)), dropped };
  }
  const activeCount = state => compile(state).query.conditions.length;
  const isActive = state => activeCount(state) > 0;
  /** remove one filter (chip ×) */
  const without = (state, filterId) => { const s = { ...(state || {}) }; for (const k of BY[filterId].stateKeys) delete s[k]; return s; };
  return Object.freeze({ QUERY_VERSION, STATE_VERSION, DEFS, BY, STATE_KEYS, EMPTY, NULL_POLICIES, OPERATORS: Object.keys(OPS), levelsFor, visible, compile, run, test, whyNot, facets, rangeStats, serialize, parse, activeCount, isActive, without, isSet });
})();
