/* filters/filters.js — three-level filter system (topic 17).
   FilterRegistry (QUICK / ADVANCED / TECHNICAL definitions on canonical fieldKeys),
   FilterState (what the UI edits: flat keys, persisted per development) → FilterCompiler
   → FilterQuery (versioned, normalized, stable hash, dropped conditions listed) → FilterEngine
   (matched and unmatched ids, warnings, self-excluding facets, FilterImpact per condition,
   zero-result diagnostics, "why not", range stats). The engine never removes lots: the map
   dims what does not match; the selected lot and the comparison are kept. It never
   changes the CustomerProfile or the recommendation: a filter becomes a
   RecommendationScope only through an explicit user action. No eval, whitelisted operators.
   Unknown data never matches a value: a lot without the value only passes when the user
   picks "não informado" (value UNKNOWN, or includeUnknown for that filter). */
App.filters = (() => {
  const get = App.model.get, QUERY_VERSION = 1, STATE_VERSION = 1, MAX_LINK_LENGTH = 1500, MAX_TEXT_LENGTH = 40;
  const LV = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'], CLS = ['A_PLUS', 'A', 'B', 'C', 'D'];
  const OPS = Object.freeze({
    IN: (v, x) => x.includes(v), EQ: (v, x) => v === x, BETWEEN: (v, x) => (x.min == null || v >= x.min) && (x.max == null || v <= x.max),
    LTE: (v, x) => v <= x, GTE: (v, x) => v >= x, IS_TRUE: v => v === true, IS_FALSE: v => v === false,
    ORDINAL_MAX: (v, x, d) => d.order.indexOf(v) >= 0 && d.order.indexOf(v) <= d.order.indexOf(x),
    ORDINAL_MIN: (v, x, d) => d.order.indexOf(v) >= 0 && d.order.indexOf(v) >= d.order.indexOf(x),
    NOT_CONTAINS_TYPE: (v, x) => Array.isArray(v) && !v.some(a => x.includes(a.type)),
    TEXT_MATCH: () => false // evaluated by textMatch (needs the lot, not only the value)
  });
  const NULL_POLICIES = Object.freeze(['EXCLUDE_UNKNOWN', 'INCLUDE_UNKNOWN', 'SEPARATE_UNKNOWN', 'IGNORE_CONDITION']);
  const UNKNOWN = 'UNKNOWN';
  // cost: identity/status first, then numbers, then derived/user context (cheap filters first)
  const DEFS = [
    // ---- QUICK
    { id: 'statuses', stateKeys: ['statuses'], fieldKey: 'availability.status', level: 'QUICK', group: 'Comercial', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'SEPARATE_UNKNOWN', options: () => App.enums.AVAILABILITY_ORDER, clientVisible: true, mobilePriority: 1, cost: 0, dynamicType: 'AVAILABILITY', facet: true },
    { id: 'onlyOfferable', stateKeys: ['onlyOfferable'], fieldKey: 'availability.status', level: 'QUICK', group: 'Comercial', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'OFFERABLE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 2, cost: 0, dynamicType: 'AVAILABILITY' },
    { id: 'block', stateKeys: ['block'], fieldKey: 'identity.blockId', level: 'QUICK', group: 'Localização', controlType: 'SELECT', dataType: 'ENUM', operator: 'EQ', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 3, cost: 0, facet: true },
    { id: 'price', stateKeys: ['priceMin', 'priceMax'], fieldKey: 'commercial.price', level: 'QUICK', group: 'Comercial', controlType: 'RANGE', dataType: 'MONEY', unit: 'BRL', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 1, cost: 1, dynamicType: 'COMMERCIAL' },
    { id: 'area', stateKeys: ['areaMin', 'areaMax'], fieldKey: 'geometry.areaM2', level: 'QUICK', group: 'Geometria', controlType: 'RANGE', dataType: 'AREA', unit: 'm²', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 2, cost: 1 },
    { id: 'classMin', stateKeys: ['classMin'], fieldKey: 'intelligence.class', level: 'QUICK', group: 'Análise', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MIN', order: CLS.slice().reverse(), nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, mobilePriority: 4, cost: 1, facet: true },
    { id: 'noCorner', stateKeys: ['noCorner'], fieldKey: 'geometry.isCorner', level: 'QUICK', group: 'Geometria', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IS_FALSE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 4, cost: 1 },
    // ---- ADVANCED
    { id: 'shapes', stateKeys: ['shapes'], fieldKey: 'geometry.shape', level: 'ADVANCED', group: 'Geometria', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'SEPARATE_UNKNOWN', options: () => ['RECTANGULAR', 'SQUARE', 'TRAPEZOIDAL', 'IRREGULAR', 'UNKNOWN'], clientVisible: true, cost: 2, facet: true, unknownOption: true },
    { id: 'greenBehind', stateKeys: ['greenBehind'], fieldKey: 'surroundings.hasGreenRear', level: 'ADVANCED', group: 'Vizinhança', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IS_TRUE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 2 },
    { id: 'rearOrientation', stateKeys: ['rearOrientation'], fieldKey: 'environmental.orientationRear', level: 'ADVANCED', group: 'Conforto', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], clientVisible: true, cost: 2, facet: true },
    { id: 'noiseMax', stateKeys: ['noiseMax'], fieldKey: 'environmental.noiseLevel', level: 'ADVANCED', group: 'Conforto', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MAX', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [...LV, UNKNOWN], clientVisible: true, cost: 2, estimated: true, facet: true, unknownOption: true },
    { id: 'privacyMin', stateKeys: ['privacyMin'], fieldKey: 'environmental.privacyLevel', level: 'ADVANCED', group: 'Conforto', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MIN', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [...LV, UNKNOWN], clientVisible: true, cost: 2, estimated: true, facet: true, unknownOption: true },
    { id: 'trafficMax', stateKeys: ['trafficMax'], fieldKey: 'mobility.estimatedTraffic', level: 'ADVANCED', group: 'Mobilidade', controlType: 'SELECT', dataType: 'ORDINAL', operator: 'ORDINAL_MAX', order: LV, nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [...LV, UNKNOWN], clientVisible: true, cost: 2, estimated: true, facet: true, unknownOption: true },
    { id: 'gateMaxM', stateKeys: ['gateMaxM'], fieldKey: 'mobility.routeDistanceToGateM', level: 'ADVANCED', group: 'Localização', controlType: 'SELECT', dataType: 'DISTANCE', unit: 'm', operator: 'LTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [200, 400, 650], clientVisible: true, cost: 2 },
    { id: 'clubMaxM', stateKeys: ['clubMaxM'], fieldKey: 'mobility.routeDistanceToLeisureM', level: 'ADVANCED', group: 'Localização', controlType: 'SELECT', dataType: 'DISTANCE', unit: 'm', operator: 'LTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [250, 500, 750], clientVisible: true, cost: 2 },
    { id: 'noNoiseAlert', stateKeys: ['noNoiseAlert'], fieldKey: 'intelligence.alerts', level: 'ADVANCED', group: 'Conforto', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'NOT_CONTAINS_TYPE', fixedValue: ['NOISE'], nullPolicy: 'INCLUDE_UNKNOWN', clientVisible: true, cost: 3 },
    { id: 'favoritesOnly', stateKeys: ['favoritesOnly'], fieldKey: null, level: 'ADVANCED', group: 'Meus lotes', controlType: 'CHECKBOX', dataType: 'BOOLEAN', operator: 'IN_USER_SET', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 0, dynamicType: 'USER_CONTEXT' },
    // ---- TECHNICAL (broker only)
    { id: 'scoreMin', stateKeys: ['scoreKey', 'scoreMin'], fieldKey: 'intelligence.scores', level: 'TECHNICAL', group: 'Scores', controlType: 'SCORE', dataType: 'SCORE', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, cost: 1 },
    { id: 'alertsExclude', stateKeys: ['alertsExclude'], fieldKey: 'intelligence.alerts', level: 'TECHNICAL', group: 'Alertas', controlType: 'CHIPS', dataType: 'ENUM', operator: 'NOT_CONTAINS_TYPE', nullPolicy: 'INCLUDE_UNKNOWN', options: () => Object.keys(App.rules.ALERTS).filter(k => k !== 'OTHER'), clientVisible: false, cost: 3 },
    { id: 'fitMin', stateKeys: ['fitMin'], fieldKey: null, level: 'TECHNICAL', group: 'Cliente', controlType: 'SELECT', dataType: 'PERCENT', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [50, 60, 70, 80], clientVisible: false, cost: 4, dynamicType: 'FIT', min: 0, max: 100 },
    { id: 'dataStatus', stateKeys: ['dataStatusField', 'dataStatus'], fieldKey: null, level: 'TECHNICAL', group: 'Qualidade do dado', controlType: 'PROVENANCE', dataType: 'ENUM', operator: 'PROVENANCE_IN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: false, cost: 3 },
    // ---- added after the first release (appended: registry order = link order, so older links serialize identically)
    { id: 'q', stateKeys: ['q'], fieldKey: 'identity.code', level: 'QUICK', group: 'Localização', controlType: 'SEARCH', dataType: 'TEXT', operator: 'TEXT_MATCH', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, mobilePriority: 0, cost: 0 },
    { id: 'pricePerM2', stateKeys: ['pricePerM2Min', 'pricePerM2Max'], fieldKey: 'commercial.pricePerM2', level: 'ADVANCED', group: 'Comercial', controlType: 'RANGE', dataType: 'MONEY', unit: 'BRL/m²', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 1, dynamicType: 'COMMERCIAL' },
    { id: 'frontage', stateKeys: ['frontMin', 'frontMax'], fieldKey: 'geometry.frontM', level: 'ADVANCED', group: 'Geometria', controlType: 'RANGE', dataType: 'DISTANCE', unit: 'm', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 1 },
    { id: 'depth', stateKeys: ['depthMin', 'depthMax'], fieldKey: 'geometry.averageDepthM', level: 'ADVANCED', group: 'Geometria', controlType: 'RANGE', dataType: 'DISTANCE', unit: 'm', operator: 'BETWEEN', nullPolicy: 'EXCLUDE_UNKNOWN', clientVisible: true, cost: 1 },
    { id: 'fitCoverageMin', stateKeys: ['fitCoverageMin'], fieldKey: null, level: 'TECHNICAL', group: 'Cliente', controlType: 'SELECT', dataType: 'PERCENT', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [50, 75, 100], clientVisible: false, cost: 4, dynamicType: 'FIT', min: 0, max: 100 },
    { id: 'fitConfidenceMin', stateKeys: ['fitConfidenceMin'], fieldKey: null, level: 'TECHNICAL', group: 'Cliente', controlType: 'SELECT', dataType: 'PERCENT', operator: 'GTE', nullPolicy: 'EXCLUDE_UNKNOWN', options: () => [50, 60, 85], clientVisible: false, cost: 4, dynamicType: 'FIT', min: 0, max: 100 },
    { id: 'freshness', stateKeys: ['freshness'], fieldKey: 'availability.freshness', level: 'TECHNICAL', group: 'Qualidade do dado', controlType: 'CHIPS', dataType: 'ENUM', operator: 'IN', nullPolicy: 'SEPARATE_UNKNOWN', options: () => ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN'], clientVisible: false, cost: 0, facet: true, unknownOption: true }
  ];
  DEFS.forEach((d, i) => { d.sortOrder = i; Object.freeze(d); });
  const BY = Object.fromEntries(DEFS.map(d => [d.id, d]));
  /** "também não informado" for the filters that offer it: a list of filterIds (state key includeUnknown) */
  const UNKNOWN_OPTION_IDS = Object.freeze(DEFS.filter(d => d.unknownOption).map(d => d.id));
  const STATE_KEYS = [...DEFS.flatMap(d => d.stateKeys), 'includeUnknown'];
  const LIST_KEYS = ['statuses', 'shapes', 'rearOrientation', 'alertsExclude', 'dataStatus', 'freshness', 'includeUnknown'], BOOL_KEYS = ['onlyOfferable', 'noCorner', 'greenBehind', 'noNoiseAlert', 'favoritesOnly'];
  const NUMERIC_KEYS = new Set(['priceMin', 'priceMax', 'areaMin', 'areaMax', 'gateMaxM', 'clubMaxM', 'scoreMin', 'fitMin', 'pricePerM2Min', 'pricePerM2Max', 'frontMin', 'frontMax', 'depthMin', 'depthMax', 'fitCoverageMin', 'fitConfidenceMin']);
  const EMPTY = Object.freeze(Object.fromEntries(STATE_KEYS.map(k => [k, LIST_KEYS.includes(k) ? [] : BOOL_KEYS.includes(k) ? false : null])));
  const isSet = v => v != null && v !== false && v !== '' && !(Array.isArray(v) && !v.length);
  const levelsFor = mode => mode === 'client' ? ['QUICK', 'ADVANCED'] : ['QUICK', 'ADVANCED', 'TECHNICAL'];
  const visible = (d, mode) => mode === 'client' ? d.clientVisible : true;
  /** quick filters in display order: desktop by registry order, mobile by mobilePriority (then registry order) */
  const quickFilterOrder = (mode, isMobile) => DEFS.filter(d => d.level === 'QUICK' && visible(d, mode)).sort((a, b) => (isMobile ? (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99) : 0) || a.sortOrder - b.sortOrder).map(d => d.id);

  // ---------------------------------------------------------------- compiler & validation
  const hashOf = q => App.methodology.checksum({ v: q.version, d: q.developmentId, c: q.conditions.map(c => c.includeUnknown ? [c.filterId, c.value, 'U'] : [c.filterId, c.value]) });
  /** FilterState → { query, errors } (invalid conditions are reported and left out, never "fail open").
      query.dropped lists every condition the user set that is NOT applied (invalid, partly invalid, or hidden in this mode). */
  function compile(state, ctx = {}) {
    const s = { ...EMPTY, ...(state || {}) }, errors = [], conds = [], dropped = [];
    const drop = (d, code, extra = {}) => dropped.push({ filterId: d.id, code, stateKeys: d.stateKeys, applied: false, ...extra });
    const err = (d, code, extra = {}) => { errors.push({ code, filterId: d.id, ...extra }); drop(d, code, extra.values ? { values: extra.values } : {}); };
    const withUnknown = new Set(Array.isArray(s.includeUnknown) ? s.includeUnknown : []);
    for (const id of withUnknown) if (!UNKNOWN_OPTION_IDS.includes(id)) { errors.push({ code: 'INVALID_ENUM', filterId: 'includeUnknown', values: [id] }); dropped.push({ filterId: 'includeUnknown', code: 'INVALID_ENUM', stateKeys: ['includeUnknown'], applied: false, values: [id] }); }
    for (const d of DEFS) {
      const vals = d.stateKeys.map(k => s[k]); if (!vals.some(isSet)) continue;
      if (ctx.mode && !visible(d, ctx.mode)) { drop(d, 'HIDDEN_IN_MODE'); continue; }
      let value;
      if (d.controlType === 'RANGE') {
        const [min, max] = vals.map(v => (v == null || v === '' ? null : +v));
        if ([min, max].some(v => v != null && !(Number.isFinite(v) && v >= 0))) { err(d, 'INVALID_FILTER_VALUE'); continue; }
        if (min != null && max != null && min > max) { err(d, 'INVALID_RANGE'); continue; }
        value = { min, max };
      } else if (d.id === 'scoreMin') {
        const [key, min] = vals; if (!isSet(min)) continue;
        if (!['housing', 'investment', 'family', 'premium', 'overall'].includes(key || 'overall') || !(+min >= 0 && +min <= 100)) { err(d, 'INVALID_FILTER_VALUE'); continue; }
        value = { key: key || 'overall', min: +min };
      } else if (d.id === 'dataStatus') {
        const [field, statuses] = vals; if (!field || !isSet(statuses)) continue;
        if (!App.model.field(field)) { err(d, 'INVALID_FIELD_KEY'); continue; }
        value = { fieldKey: field, statuses: [...statuses].sort() };
      } else if (d.id === 'q') {
        const t = typeof vals[0] === 'string' || typeof vals[0] === 'number' ? String(vals[0]).trim() : null;
        if (!t || t.length > MAX_TEXT_LENGTH) { err(d, 'INVALID_FILTER_VALUE'); continue; }
        value = t;
      } else value = vals[0];
      if (d.operator === 'IN' && !Array.isArray(value) && d.controlType === 'CHIPS') { err(d, 'INVALID_FILTER_VALUE'); continue; }
      let partial = null;
      if (d.options && Array.isArray(value)) { const ok = d.options(); const bad = value.filter(v => !ok.includes(v)); if (bad.length) { errors.push({ code: 'INVALID_ENUM', filterId: d.id, values: bad }); value = value.filter(v => ok.includes(v)); if (!value.length) { drop(d, 'INVALID_ENUM', { values: bad }); continue; } partial = bad; } value = [...value].sort(); }
      if (d.order && !d.order.includes(value) && !(d.unknownOption && value === UNKNOWN)) { err(d, 'INVALID_ENUM', { values: [value] }); continue; }
      if (['gateMaxM', 'clubMaxM'].includes(d.id)) { value = +value; if (!Number.isFinite(value)) { err(d, 'INVALID_FILTER_VALUE'); continue; } }
      if (d.dataType === 'PERCENT') { value = +value; if (!(Number.isFinite(value) && value >= d.min && value <= d.max)) { err(d, 'INVALID_FILTER_VALUE'); continue; } }
      const c = { filterId: d.id, fieldKey: d.fieldKey, operator: d.operator, value: d.fixedValue && value === true ? d.fixedValue : value, nullPolicy: d.nullPolicy, level: d.level };
      if (withUnknown.has(d.id)) c.includeUnknown = true;
      conds.push(c);
      if (partial) dropped.push({ filterId: d.id, code: 'PARTIALLY_APPLIED', stateKeys: d.stateKeys, applied: 'PARTIAL', values: partial });
    }
    conds.sort((a, b) => a.filterId < b.filterId ? -1 : 1); // stable serialization: same meaning, same hash
    const query = { version: QUERY_VERSION, developmentId: ctx.developmentId || 'viva-juara', conditions: conds, scope: null, unknownPolicy: 'PER_FILTER', createdAt: null, dropped };
    query.hash = hashOf(query);
    return { query, errors };
  }

  // ---------------------------------------------------------------- query migration
  /** FilterQueryMigrationRegistry: version N → N+1. 0 = unversioned query (conditions without operator / nullPolicy / level). */
  const QUERY_MIGRATIONS = Object.freeze({
    0: q => ({ ...q, version: 1, scope: q.scope ?? null, unknownPolicy: q.unknownPolicy || 'PER_FILTER', createdAt: q.createdAt ?? null,
      conditions: (q.conditions || []).map(c => { const d = BY[c.filterId]; return d ? { filterId: c.filterId, fieldKey: d.fieldKey, operator: d.operator, value: c.value, nullPolicy: d.nullPolicy, level: d.level, ...(c.includeUnknown ? { includeUnknown: true } : {}) } : { ...c }; }) })
  });
  /** migrateQuery(query) → { ok, query, migrated, steps, errors, warnings }. A newer version is refused (never applied half-understood). */
  function migrateQuery(q) {
    if (!q || typeof q !== 'object' || !Array.isArray(q.conditions)) return { ok: false, query: null, migrated: false, steps: [], errors: [{ code: 'INVALID_QUERY' }], warnings: [] };
    let v = q.version == null ? 0 : q.version;
    if (!Number.isInteger(v) || v > QUERY_VERSION || v < 0) return { ok: false, query: null, migrated: false, steps: [], errors: [{ code: 'UNSUPPORTED_QUERY_VERSION', version: q.version }], warnings: [] };
    let cur = q; const steps = [];
    while (v < QUERY_VERSION) { const m = QUERY_MIGRATIONS[v]; if (!m) return { ok: false, query: null, migrated: false, steps, errors: [{ code: 'UNSUPPORTED_QUERY_VERSION', version: q.version }], warnings: [] }; cur = m(cur); steps.push(`${v}→${v + 1}`); v++; }
    const dropped = [...(cur.dropped || [])], conditions = [];
    for (const c of cur.conditions) { if (BY[c.filterId]) conditions.push(c); else dropped.push({ filterId: c.filterId, code: 'INVALID_FILTER_VALUE', stateKeys: [], applied: false }); }
    const out = { ...cur, conditions: conditions.slice().sort((a, b) => a.filterId < b.filterId ? -1 : 1), dropped, developmentId: cur.developmentId || 'viva-juara' };
    out.hash = hashOf(out);
    return { ok: true, query: out, migrated: steps.length > 0, steps, errors: [], warnings: steps.length ? [{ code: 'QUERY_MIGRATED', from: q.version ?? 0, to: QUERY_VERSION }] : [] };
  }
  /** persisted FilterState migration (STATE_VERSION): no change of keys so far; unknown keys are dropped and reported */
  function migrateState(state, fromVersion = STATE_VERSION) {
    if (fromVersion > STATE_VERSION) return { ok: false, state: {}, dropped: Object.keys(state || {}), errors: [{ code: 'UNSUPPORTED_QUERY_VERSION', version: fromVersion }] };
    const out = {}, dropped = [];
    for (const [k, v] of Object.entries(state || {})) if (STATE_KEYS.includes(k)) out[k] = v; else dropped.push(k);
    return { ok: true, state: out, dropped, errors: [] };
  }

  // ---------------------------------------------------------------- engine
  /** value provider: the only place that reads the lot for a condition (derived/dynamic values included) */
  function valueOf(c, lot, ctx) {
    if (c.filterId === 'favoritesOnly') return ctx.favorites ? ctx.favorites.has(lot.identity.id) : null;
    if (c.filterId === 'fitMin') { const f = ctx.fit && ctx.fit.get(lot.identity.id); return f ? f.fitScore : null; }
    if (c.filterId === 'fitCoverageMin') { const f = ctx.fit && ctx.fit.get(lot.identity.id); return f && f.fitScore != null && Number.isFinite(f.coverage) ? 100 * f.coverage : null; }
    if (c.filterId === 'fitConfidenceMin') { const f = ctx.fit && ctx.fit.get(lot.identity.id); return f && f.confidence && f.confidence.value != null ? 100 * f.confidence.value : null; }
    if (c.filterId === 'scoreMin') return lot.intelligence.scores[c.value.key];
    if (c.filterId === 'dataStatus') return App.model.getFieldProvenance(lot, c.value.fieldKey).status;
    if (c.filterId === 'classMin') return lot.intelligence.class === 'UNKNOWN' ? null : lot.intelligence.class;
    return get(lot, c.fieldKey);
  }
  /** text search on lot / block code: the same grammar as the search box (App.services.search), evaluated per lot */
  function textMatch(q, lot, ctx) {
    const S = App.services && App.services.search;
    if (S && S.parse) {
      const r = S.parse(q, { blocks: ctx.blocks || [lot.identity.blockId], all: [lot], byCode: new Map([[lot.identity.code, lot]]) });
      return r.lots.some(l => l === lot);
    }
    const t = String(q).toUpperCase().replace(/\s+/g, '');
    return lot.identity.code.toUpperCase().startsWith(t) || String(lot.identity.displayCode || '').toUpperCase().replace(/\s+/g, '') === t;
  }
  const isUnknown = v => v == null || v === UNKNOWN;
  /** test(condition, lot, ctx) → true | false (null policy applied) */
  function test(c, lot, ctx) {
    const d = BY[c.filterId], v = valueOf(c, lot, ctx);
    if (c.operator === 'IN_USER_SET') return !c.value || v === true;
    if (c.operator === 'OFFERABLE') return !c.value || App.availability.isOfferable(lot.availability.status, ctx.policy);
    if (c.operator === 'TEXT_MATCH') return textMatch(c.value, lot, ctx);
    if (d && d.unknownOption) { // "não informado" is an explicit choice; otherwise unknown never matches a value
      if (c.value === UNKNOWN) return isUnknown(v);
      if (c.includeUnknown && isUnknown(v)) return true;
      if (v == null && Array.isArray(c.value) && c.value.includes(UNKNOWN)) return true;
    }
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
  const planOf = conditions => conditions.slice().sort((a, b) => BY[a.filterId].cost - BY[b.filterId].cost || (a.filterId < b.filterId ? -1 : 1));
  /** one pass over the lots evaluating every condition: per lot the number of failed conditions and the single failed index (facets, impacts) */
  function evaluate(lots, plan, ctx) {
    const firstFail = new Int32Array(lots.length), failCount = new Int32Array(lots.length), onlyFail = new Int32Array(lots.length);
    lots.forEach((l, i) => {
      let n = 0, first = -1, only = -1;
      for (let k = 0; k < plan.length; k++) if (!test(plan[k], l, ctx)) { n++; if (first < 0) first = k; only = k; }
      failCount[i] = n; firstFail[i] = first < 0 ? plan.length : first; onlyFail[i] = n === 1 ? only : -1;
    });
    return { firstFail, failCount, onlyFail };
  }
  const facetDefs = ids => DEFS.filter(x => x.facet && (!ids || ids.includes(x.id)));
  /** self-excluding facet counts from an evaluation (lots that pass every OTHER condition) */
  function facetCounts(lots, plan, ev, ids) {
    const out = {};
    for (const d of facetDefs(ids)) {
      const own = plan.findIndex(c => c.filterId === d.id), counts = {};
      lots.forEach((l, i) => {
        if (!(ev.failCount[i] === 0 || (own >= 0 && ev.failCount[i] === 1 && ev.onlyFail[i] === own))) return;
        const v = get(l, d.fieldKey); const k = v == null ? UNKNOWN : v; counts[k] = (counts[k] || 0) + 1;
      });
      out[d.id] = counts;
    }
    return out;
  }
  const emptyResult = (lots, query, warnings, status) => ({ status, matchedIds: new Set(), unmatchedLotIds: new Set((lots || []).map(l => l.identity.id)), total: lots.length, unmatchedCount: lots.length, warnings, hash: query && query.hash || null, plan: [], facets: {}, diagnostics: { zeroResult: false, impacts: [], suggestions: [], dropped: (query && query.dropped) || [] }, elapsedMs: null });
  /** run(lots, query, ctx) → FilterResult. ctx = { policy, favorites, fit, freshness: { commercial, availability }, developmentId, facets?: false }
      FilterResult { status OK | PARTIAL | INVALID, hash, matchedIds, unmatchedLotIds, total, unmatchedCount, warnings, plan, facets, diagnostics, elapsedMs } */
  function run(lots, query, ctx = {}) {
    const t0 = ctx.now ? ctx.now() : 0, warnings = [];
    if (!query || query.version !== QUERY_VERSION) {
      const m = migrateQuery(query);
      if (!m.ok) return emptyResult(lots, query, m.errors, 'INVALID');
      query = m.query; warnings.push(...m.warnings);
    }
    if (query.developmentId && ctx.developmentId && query.developmentId !== ctx.developmentId) return { ...emptyResult(lots, query, [{ code: 'WRONG_DEVELOPMENT' }], 'INVALID'), matchedIds: new Set() };
    const plan = planOf(query.conditions);
    for (const c of plan) {
      const d = BY[c.filterId], k = STALE_SENSITIVE[d.dynamicType];
      if (k && ctx.freshness && ctx.freshness[k] && ctx.freshness[k].status === 'STALE') warnings.push({ code: k === 'commercial' ? 'STALE_PRICE' : 'STALE_AVAILABILITY', filterId: c.filterId });
      if (d.estimated) warnings.push({ code: 'ESTIMATED_FIELD', filterId: c.filterId });
      if (d.dynamicType === 'FIT' && !ctx.fit) warnings.push({ code: 'FIT_UNAVAILABLE', filterId: c.filterId });
    }
    const ev = evaluate(lots, plan, ctx), matched = new Set(), unmatched = new Set();
    lots.forEach((l, i) => (ev.failCount[i] ? unmatched : matched).add(l.identity.id));
    // FilterImpact per condition, in plan order (diagnostic only: never changes the result, never relaxes anything)
    const impacts = plan.map((c, k) => {
      let before = 0, after = 0, unique = 0;
      for (let i = 0; i < lots.length; i++) { if (ev.firstFail[i] >= k) before++; if (ev.firstFail[i] > k) after++; if (ev.onlyFail[i] === k) unique++; }
      return { filterId: c.filterId, beforeCount: before, afterCount: after, rejectedCount: before - after, uniqueRejectedCount: unique, resultIfRemoved: matched.size + unique };
    });
    const zero = matched.size === 0 && plan.length > 0;
    const suggestions = zero ? impacts.filter(x => x.resultIfRemoved > 0).sort((a, b) => b.resultIfRemoved - a.resultIfRemoved || (a.filterId < b.filterId ? -1 : 1)).map(x => ({ code: 'FILTER_REMOVAL_SUGGESTION', filterId: x.filterId, resultCount: x.resultIfRemoved })) : [];
    let facets = {};
    if (ctx.facets !== false) {
      const counts = facetCounts(lots, plan, ev);
      for (const d of facetDefs()) {
        const c = counts[d.id], cond = query.conditions.find(x => x.filterId === d.id), sel = cond ? (Array.isArray(cond.value) ? cond.value : [cond.value]) : [];
        const opts = d.options ? d.options() : Object.keys(c).sort();
        facets[d.id] = { counts: c, options: [...new Set([...opts, ...Object.keys(c)])].map(v => ({ value: v, count: c[v] || 0, selected: sel.includes(v) })), unknownCount: c[UNKNOWN] || 0 };
      }
    }
    const dropped = query.dropped || [];
    const out = { status: dropped.length ? 'PARTIAL' : 'OK', hash: query.hash, matchedIds: matched, unmatchedLotIds: unmatched, total: lots.length, unmatchedCount: lots.length - matched.size, warnings, plan: plan.map(c => c.filterId),
      facets, diagnostics: { code: zero ? 'ZERO_RESULTS' : null, zeroResult: zero, impacts, suggestions, dropped, audience: 'BROKER' }, elapsedMs: ctx.now ? ctx.now() - t0 : null };
    return out;
  }
  /** which conditions a lot fails (shown as "fora do filtro porque…") */
  const whyNot = (lot, query, ctx = {}) => query.conditions.filter(c => !test(c, lot, ctx)).map(c => ({ filterId: c.filterId, fieldKey: c.fieldKey, value: valueOf(c, lot, ctx), unknown: valueOf(c, lot, ctx) == null }));
  /** self-excluding facets: counts of each option over the lots that pass every OTHER condition */
  function facets(lots, query, ctx = {}, ids) { const plan = planOf(query.conditions); return facetCounts(lots, plan, evaluate(lots, plan, ctx), ids); }
  /** domain bounds for range controls (from the data, never hard-coded) */
  function rangeStats(lots, fieldKey) { const v = lots.map(l => get(l, fieldKey)).filter(x => x != null); return v.length ? { min: Math.min(...v), max: Math.max(...v), count: v.length, unknown: lots.length - v.length } : { min: null, max: null, count: 0, unknown: lots.length }; }

  // ---------------------------------------------------------------- URL serialization
  const SHORT = { statuses: 'st', onlyOfferable: 'of', block: 'q', priceMin: 'p0', priceMax: 'p1', areaMin: 'a0', areaMax: 'a1', classMin: 'c', noCorner: 'nc', shapes: 'sh', greenBehind: 'g', rearOrientation: 'ro',
    noiseMax: 'nz', privacyMin: 'pv', trafficMax: 'tr', gateMaxM: 'gm', clubMaxM: 'cm', noNoiseAlert: 'na', favoritesOnly: 'fv', scoreKey: 'sk', scoreMin: 'sm', alertsExclude: 'ax', fitMin: 'ft', dataStatusField: 'df', dataStatus: 'ds',
    q: 'tx', pricePerM2Min: 'pm0', pricePerM2Max: 'pm1', frontMin: 'fr0', frontMax: 'fr1', depthMin: 'dp0', depthMax: 'dp1', fitCoverageMin: 'fc', fitConfidenceMin: 'fq', freshness: 'fs', includeUnknown: 'iu' };
  const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
  /** compact, stable: keys in registry order, lists sorted. favorites are personal and never go in a link */
  function serialize(state) {
    const s = { ...EMPTY, ...(state || {}) }, parts = [];
    for (const k of STATE_KEYS) { if (k === 'favoritesOnly') continue; const v = s[k]; if (!isSet(v)) continue; parts.push(SHORT[k] + ':' + (Array.isArray(v) ? [...v].sort().join(',') : v === true ? '1' : encodeURIComponent(String(v)))); }
    return parts.join(';');
  }
  /** serializeChecked(state, { maxLength }) → { value, length, ok, code }: the link guard (the caller decides; nothing is cut silently) */
  function serializeChecked(state, opts = {}) {
    const value = serialize(state), max = opts.maxLength || MAX_LINK_LENGTH;
    return value.length <= max ? { value, length: value.length, ok: true, code: null, maxLength: max } : { value: null, length: value.length, ok: false, code: 'LINK_TOO_LONG', maxLength: max };
  }
  /** parse(str) → { state, dropped, errors } (unknown or malformed parts are dropped and reported; an over-long link is refused) */
  function parse(str) {
    const state = {}, dropped = [], raw0 = String(str || '');
    if (raw0.length > 4 * MAX_LINK_LENGTH) return { state: {}, dropped: [raw0.slice(0, 40) + '…'], errors: [{ code: 'LINK_TOO_LONG', length: raw0.length }] };
    for (const part of raw0.split(';').filter(Boolean)) {
      const i = part.indexOf(':'), k = LONG[part.slice(0, i)];
      if (i < 0 || !k) { dropped.push(part); continue; }
      let raw; try { raw = decodeURIComponent(part.slice(i + 1)); } catch (e) { dropped.push(part); continue; }
      const kind = EMPTY[k], numeric = NUMERIC_KEYS.has(k);
      if (numeric && !(raw !== '' && Number.isFinite(+raw))) { dropped.push(part); continue; }
      state[k] = Array.isArray(kind) ? raw.split(',').filter(Boolean) : kind === false ? raw === '1' : numeric ? +raw : raw;
    }
    return { state: Object.fromEntries(Object.entries(state).filter(([, v]) => v != null)), dropped, errors: [] };
  }
  const activeCount = state => compile(state).query.conditions.length;
  const isActive = state => activeCount(state) > 0;
  /** remove one filter (chip ×) */
  const without = (state, filterId) => { const s = { ...(state || {}) }; for (const k of BY[filterId].stateKeys) delete s[k]; if (Array.isArray(s.includeUnknown)) s.includeUnknown = s.includeUnknown.filter(x => x !== filterId); return s; };
  return Object.freeze({ QUERY_VERSION, STATE_VERSION, MAX_LINK_LENGTH, DEFS, BY, STATE_KEYS, EMPTY, NULL_POLICIES, UNKNOWN_OPTION_IDS, QUERY_MIGRATIONS: Object.keys(QUERY_MIGRATIONS).map(Number), OPERATORS: Object.keys(OPS), levelsFor, visible, quickFilterOrder,
    compile, migrateQuery, migrateState, run, test, whyNot, facets, rangeStats, serialize, serializeChecked, parse, activeCount, isActive, without, isSet });
})();
