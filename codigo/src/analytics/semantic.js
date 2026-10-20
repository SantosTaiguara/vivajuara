/* analytics/semantic.js — topic 44: semantic layer (MetricRegistry, FunnelDefinition, CohortDefinition, dimensions,
   source/fact registry, quality, lineage, query service, materialization/backfill).

   Analytics answers "what happened, how often, when, in which context, with which results" — never the operational
   truth. It never recalculates Pricing, Availability, Fit, Recommendation, Comparison or Financial Simulation, never
   writes to a domain, never infers causality (association wording only) and never turns list-price changes into
   return. Every metric is a closed calculator (expressionRef) over typed inputs: no SQL, no free expressions.

   Inputs: (a) the device's local analytics buffer (topic-45 envelopes, App.eventTracking client) for PRODUCT and
   DATA_QUALITY metrics; (b) optional normalized facts (FactJourneyOutcome, FactShareGrant…) handed in by a caller for
   COMMERCIAL metrics — on the device those facts do not exist, so the metrics come back BLOCKED / "não disponível".
   Rules: 0/0 → null (N/A), never 0%; UNKNOWN/missing never becomes zero; a producer that is not wired yields "não
   disponível", not 0; distinct counts use explicit entity keys; time basis is explicit and bucketed in the
   organization's timezone; late events count when they occurred (occurredAt), not when they arrived. */
App.semanticLayer = (() => {
  const cfg = () => (App.configs && App.configs.analytics) || {};
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const getPath = (o, p) => String(p).split('.').reduce((a, k) => a == null ? undefined : a[k], o);
  const Quality = Object.freeze({ VALID: 'VALID', DEGRADED: 'DEGRADED', INCOMPLETE: 'INCOMPLETE', STALE: 'STALE', BLOCKED: 'BLOCKED' });
  const QUALITY_LABEL = Object.freeze({ VALID: 'calculado', DEGRADED: 'calculado com ressalva', INCOMPLETE: 'dados incompletos', STALE: 'desatualizado', BLOCKED: 'não disponível' });
  const MEASURES = ['COUNT', 'DISTINCT_COUNT', 'SUM', 'AVERAGE', 'MEDIAN', 'RATE', 'PERCENTILE', 'DURATION', 'RATIO'];
  const EXPRESSIONS = ['count_events', 'distinct_entities', 'ratio', 'rate', 'cohort_rate', 'avg_field', 'session_duration_percentile', 'health_rate', 'facts_rate', 'facts_cohort_rate', 'facts_count', 'facts_duration_percentile', 'stage_conversion', 'stage_duration', 'facts_sequence_rate', 'blocked'];
  const DOMAINS = ['COMMERCIAL', 'PRODUCT', 'MARKETING', 'OPERATIONS', 'DATA_QUALITY'];
  const GRAINS = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'TOTAL'];
  const CAUSAL_RE = /\b(caus(ou|a|aram|ado)|gerad[ao]s? pela|graças (à|ao)|aumentou (as )?vendas|impacto causal|efeito causal da|caused|drove|increased sales)\b/i;
  const PRICING_RE = /\b(roi|rentabilidade|valoriza(ção|r|rá)|retorno realizado|lucro)\b/i;
  /** causal/pricing wording guards (topic 44 §300–303, §157, §467) */
  const causalWordingIssues = text => CAUSAL_RE.test(String(text || '')) ? ['CAUSAL_CLAIM'] : [];
  const pricingWordingIssues = text => PRICING_RE.test(String(text || '')) ? ['PRICING_RETURN_CLAIM'] : [];

  // ================================================================== time (organization timezone; storage stays UTC)
  const fmts = new Map();
  const fmt = tz => { if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })); return fmts.get(tz); };
  const localDate = (ms, tz) => fmt(tz).format(new Date(ms)); // YYYY-MM-DD
  const dayMs = ds => Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10));
  const addDays = (ds, n) => new Date(dayMs(ds) + n * 86400000).toISOString().slice(0, 10);
  function isoWeek(ds) { const d = new Date(dayMs(ds)), wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd + 3); const y = d.getUTCFullYear(), j4 = new Date(Date.UTC(y, 0, 4)); const w = 1 + Math.round(((d - j4) / 86400000 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7); return `${y}-W${String(w).padStart(2, '0')}`; }
  /** DimDate for a local date string */
  function dimDate(ds) { const dow = (new Date(dayMs(ds)).getUTCDay() + 6) % 7 + 1, m = +ds.slice(5, 7); return { date: ds, day: +ds.slice(8, 10), week: isoWeek(ds), month: ds.slice(0, 7), quarter: `${ds.slice(0, 4)}-Q${Math.ceil(m / 3)}`, year: +ds.slice(0, 4), dayOfWeek: dow, isWeekend: dow >= 6 }; }
  const bucketKey = (ds, grain) => grain === 'TOTAL' ? 'TOTAL' : grain === 'WEEK' ? isoWeek(ds) : grain === 'MONTH' ? ds.slice(0, 7) : grain === 'QUARTER' ? dimDate(ds).quarter : ds;
  function timezoneOf(org) {
    const reg = (App.configs && App.configs.security && App.configs.security.organizations) || {};
    const o = (reg.organizations || []).find(x => x.id === org);
    return (o && o.settings && o.settings.timezone) || ((cfg().policy || {}).analytics || {}).timezoneFallback || 'America/Sao_Paulo';
  }
  const toMs = v => v == null ? NaN : typeof v === 'number' ? v : Date.parse(v);

  // ================================================================== registry + contract checks
  function build(src = cfg().metrics || {}) {
    const metrics = new Map((src.metrics || []).map(m => [m.code, Object.freeze(clone(m))]));
    const funnels = new Map((src.funnels || []).map(f => [f.code, Object.freeze(clone(f))]));
    const cohorts = new Map((src.cohorts || []).map(c => [c.code, Object.freeze(clone(c))]));
    const dims = new Map((src.dimensions || []).map(d => [d.code, Object.freeze(clone(d))]));
    const facts = new Map((src.facts || []).map(f => [f.code, Object.freeze(clone(f))]));
    const sources = new Map((src.sources || []).map(s => [s.sourceCode, Object.freeze(clone(s))]));
    const bundle = () => ({ metricRegistryVersion: src.metricRegistryVersion, funnelRegistryVersion: src.funnelRegistryVersion, dimensionRegistryVersion: src.dimensionRegistryVersion, transformationVersion: src.transformationVersion,
      eventCatalogVersion: App.eventTracking && App.eventTracking.registry ? App.eventTracking.registry.current().version : null });
    function contractErrors() {
      const errs = [], E = (code, ref, msg) => errs.push({ code, ref, message: msg || '' }), codes = new Set();
      for (const m of src.metrics || []) {
        if (codes.has(m.code)) E('DUPLICATE_METRIC', m.code); codes.add(m.code);
        if (!/^[a-z][a-z0-9_]*$/.test(m.code)) E('BAD_METRIC_CODE', m.code);
        if (!m.name || !m.description) E('MISSING_DEFINITION', m.code);
        if (!DOMAINS.includes(m.domain)) E('BAD_DOMAIN', m.code, m.domain);
        if (!m.entity) E('MISSING_ENTITY', m.code);
        if (!MEASURES.includes(m.measureType)) E('BAD_MEASURE', m.code, m.measureType);
        if (!EXPRESSIONS.includes(m.expressionRef)) E('BAD_EXPRESSION', m.code, m.expressionRef);
        if (!m.timestampBasis) E('MISSING_TIMESTAMP_BASIS', m.code);
        if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) E('BAD_VERSION', m.code);
        if (!['DRAFT', 'VALIDATED', 'PUBLISHED', 'DEPRECATED'].includes(m.status)) E('BAD_STATUS', m.code);
        if (!m.nullPolicy || !m.zeroDenominatorPolicy) E('MISSING_POLICY', m.code);
        if (['RATE', 'RATIO'].includes(m.measureType)) {
          if (m.zeroDenominatorPolicy !== 'NULL') E('RATE_ZERO_DENOMINATOR_NOT_NULL', m.code, '0/0 deve ser NULL');
          if (['rate', 'ratio', 'cohort_rate'].includes(m.expressionRef) && (!metrics.has(m.numeratorMetricRef) || !metrics.has(m.denominatorMetricRef))) E('IMPLICIT_DENOMINATOR', m.code, 'numerador/denominador explícitos');
        }
        for (const d of m.dimensionsAllowed || []) if (!dims.has(d)) E('UNKNOWN_DIMENSION', m.code, d);
        if (!m.lineage || !Array.isArray(m.lineage.sourceFacts)) E('MISSING_LINEAGE', m.code);
        else for (const f of m.lineage.sourceFacts) if (!facts.has(f) && !sources.has(f)) E('UNKNOWN_LINEAGE_SOURCE', m.code, f);
        if (causalWordingIssues(`${m.name} ${m.description}`).length) E('CAUSAL_WORDING', m.code);
        if (pricingWordingIssues(`${m.name} ${m.description}`).length) E('PRICING_WORDING', m.code);
        if (/_to_(visit|win|proposal)_rate$/.test(m.code) && !m.associationOnly) E('ASSOCIATION_NOT_DECLARED', m.code);
        if (m.status === 'PUBLISHED' && m.expressionRef === 'blocked') E('PUBLISHED_BLOCKED', m.code);
      }
      for (const f of src.funnels || []) {
        if (!['JOURNEY', 'CUSTOMER', 'SHARE_GRANT', 'PRESENTATION', 'SESSION'].includes(f.entityKey)) E('BAD_FUNNEL_ENTITY', f.code);
        if (!['STRICT', 'NON_STRICT'].includes(f.orderMode)) E('BAD_FUNNEL_ORDER', f.code);
        (f.steps || []).forEach((s, i) => { if (s.order !== i + 1) E('FUNNEL_STEP_ORDER', f.code, s.code); if (!['JOURNEY_STAGE', 'DOMAIN_EVENT', 'ANALYTICS_EVENT', 'RESOURCE_CREATED'].includes(s.source)) E('BAD_STEP_SOURCE', f.code, s.code); });
        if (!f.revisitRule) E('FUNNEL_WITHOUT_REVISIT_RULE', f.code);
      }
      for (const c of src.cohorts || []) if (!c.entityType || !c.cohortTimeBasis || !c.version) E('BAD_COHORT', c.code);
      return errs;
    }
    /** source events a local metric reads (for wiring/quality) */
    function sourceEvents(m) {
      if (!m) return [];
      if (m.params && m.params.events) return m.params.events;
      if (m.params && m.params.toEvents) return m.params.toEvents;
      return [m.numeratorMetricRef, m.denominatorMetricRef].filter(Boolean).flatMap(r => sourceEvents(metrics.get(r)));
    }
    const isLocal = m => !/^facts_|^stage_|^blocked$/.test(m.expressionRef);
    return { src, metrics, funnels, cohorts, dims, facts, sources, bundle, contractErrors, sourceEvents, isLocal, metric: c => metrics.get(c) || null, list: () => [...metrics.values()] };
  }
  let cached = null, cachedSrc = null;
  const current = () => { const s = cfg().metrics; if (!cached || cachedSrc !== s) { cached = build(s || {}); cachedSrc = s; } return cached; };

  // ================================================================== calculators
  const R = () => current();
  const ET = () => App.eventTracking;
  const isProductEvent = e => (e.eventClass || 'PRODUCT') === 'PRODUCT';
  function matchWhere(row, where) {
    for (const w of where || []) { const v = getPath(row, w.field); if (w.in && !w.in.includes(v)) return false; if (w.notIn && w.notIn.includes(v)) return false; }
    return true;
  }
  function selectEvents(evs, p = {}) {
    const names = p.events || [];
    return evs.filter(e => (names.includes(e.eventName) || (names.includes('*PRODUCT') && isProductEvent(e))) && matchWhere(e, p.where));
  }
  const distinct = (rows, key) => { const s = new Set(); for (const r of rows) { const v = getPath(r, key); if (v != null && v !== '') s.add(String(v)); } return s; };
  /** percentiles: exact, linear interpolation between closest ranks (documented method) */
  function percentile(xs, p) { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y), i = (p / 100) * (a.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }
  const rateOf = (n, d) => d ? n / d : null; // 0/0 → null (N/A), never 0%

  /** compute(m, ctx) → { value, numerator, denominator, extra, entities } — ctx: { events (in range), allEvents, facts, range, health, params } */
  function compute(m, ctx) {
    const p = { ...(m.params || {}), ...((ctx.params || {})[m.code] || {}) };
    switch (m.expressionRef) {
      case 'count_events': { const n = selectEvents(ctx.events, p).length; return { value: n }; }
      case 'distinct_entities': { const s = distinct(selectEvents(ctx.events, p), p.key); return { value: s.size, entities: s }; }
      case 'ratio': case 'rate': {
        const n = compute(R().metric(m.numeratorMetricRef), ctx), d = compute(R().metric(m.denominatorMetricRef), ctx);
        return { value: n.value == null || d.value == null ? null : rateOf(n.value, d.value), numerator: n.value, denominator: d.value };
      }
      case 'cohort_rate': {
        const dm = R().metric(m.denominatorMetricRef), nm = R().metric(m.numeratorMetricRef);
        const cohort = distinct(selectEvents(ctx.events, dm.params), p.key || dm.params.key), done = distinct(selectEvents(ctx.allEvents, nm.params), p.key || nm.params.key);
        const n = [...cohort].filter(k => done.has(k)).length;
        return { value: rateOf(n, cohort.size), numerator: n, denominator: cohort.size };
      }
      case 'avg_field': { const xs = selectEvents(ctx.events, p).map(e => getPath(e, p.field)).filter(v => typeof v === 'number' && Number.isFinite(v)); return { value: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, numerator: xs.length ? xs.reduce((a, b) => a + b, 0) : null, denominator: xs.length }; }
      case 'session_duration_percentile': {
        const bySess = new Map();
        for (const e of ctx.allEvents) { if (!isProductEvent(e)) continue; const s = e.session && e.session.productSessionId; if (!s) continue; const t = toMs(e.occurredAt); const r = bySess.get(s) || { start: Infinity, first: Infinity }; r.start = Math.min(r.start, t); if ((p.toEvents || []).includes(e.eventName)) r.first = Math.min(r.first, t); bySess.set(s, r); }
        const xs = []; let censored = 0;
        for (const r of bySess.values()) { if (!(r.start >= ctx.range.fromMs && r.start < ctx.range.toMs)) continue; if (r.first === Infinity) { censored++; continue; } xs.push((r.first - r.start) / 1000); }
        return { value: percentile(xs, 50), denominator: xs.length, extra: { p50: percentile(xs, 50), p75: percentile(xs, 75), p90: percentile(xs, 90), n: xs.length, censored } };
      }
      case 'health_rate': { const h = ctx.health || {}; const n = h[p.numerator], d = h[p.denominator]; return n == null || d == null ? { value: null } : { value: rateOf(n, d), numerator: n, denominator: d }; }
      case 'blocked': return { value: null, blocked: m.blockedReason || 'BLOCKED' };
      default: return computeFacts(m, p, ctx);
    }
  }
  // ---------------------------------------------------------------- fact-based (commercial) calculators
  function factRows(ctx, name) {
    const rows = (ctx.facts || {})[name]; if (!Array.isArray(rows)) return null;
    const ok = rows.filter(r => r.organizationId == null || r.organizationId === ctx.organizationId); // never aggregate across tenants
    ctx.crossTenantExcluded = (ctx.crossTenantExcluded || 0) + (rows.length - ok.length);
    return ok.filter(r => matchWhere(r, ctx.filtersAsWhere));
  }
  const inRange = (ctx, v) => { const t = toMs(v); return t >= ctx.range.fromMs && t < ctx.range.toMs; };
  function computeFacts(m, p, ctx) {
    const need = (...names) => { const out = names.map(n => factRows(ctx, n)); return out.some(x => x == null) ? null : out; };
    switch (m.expressionRef) {
      case 'facts_rate': {
        const r = need(p.fact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        const rows = r[0].filter(x => inRange(ctx, x[p.time]));
        const d = distinct(rows.filter(x => matchWhere(x, p.denominatorWhere)), p.key), n = distinct(rows.filter(x => matchWhere(x, p.numeratorWhere)), p.key);
        const nn = [...n].filter(k => d.has(k)).length; return { value: rateOf(nn, d.size), numerator: nn, denominator: d.size, rows };
      }
      case 'facts_count': { const r = need(p.fact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' }; const rows = r[0].filter(x => inRange(ctx, x[p.time]) && matchWhere(x, p.where)); return { value: distinct(rows, p.key).size, rows }; }
      case 'facts_cohort_rate': {
        const r = need(p.cohortFact, p.eventFact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        const cohortRows = r[0].filter(x => inRange(ctx, x[p.cohortTime])), cohort = distinct(cohortRows, p.key), hit = distinct(r[1].filter(x => matchWhere(x, p.eventWhere)), p.key);
        const n = [...cohort].filter(k => hit.has(k)).length; return { value: rateOf(n, cohort.size), numerator: n, denominator: cohort.size, rows: cohortRows };
      }
      case 'facts_duration_percentile': {
        const r = need(p.startFact, p.endFact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        const start = new Map(); for (const x of r[0]) { const k = x[p.key], t = toMs(x[p.startTime]); if (k == null || !Number.isFinite(t)) continue; if (!start.has(k) || t < start.get(k)) start.set(k, t); }
        const xs = []; let censored = 0;
        for (const [k, t0] of start) { if (!(t0 >= ctx.range.fromMs && t0 < ctx.range.toMs)) continue; const ends = r[1].filter(x => x[p.key] === k && matchWhere(x, p.endWhere)).map(x => toMs(x[p.endTime])).filter(t => t >= t0); if (!ends.length) { censored++; continue; } xs.push((Math.min(...ends) - t0) / 1000); }
        return { value: percentile(xs, 50), denominator: xs.length, extra: { p50: percentile(xs, 50), p75: percentile(xs, 75), p90: percentile(xs, 90), n: xs.length, censored } };
      }
      case 'stage_conversion': {
        const r = need(p.fact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        if (!p.fromStage || !p.toStage) return { value: null, blocked: 'PARAMS_REQUIRED' };
        const rows = r[0].filter(x => !p.stageModelVersionId || x.stageModelVersionId === p.stageModelVersionId); // never mix stage models
        const entered = new Map(); for (const x of rows) if (x.toStageId === p.fromStage && inRange(ctx, x.occurredAt)) { const t = toMs(x.occurredAt); if (!entered.has(x[p.key]) || t < entered.get(x[p.key])) entered.set(x[p.key], t); }
        const moved = new Set(rows.filter(x => x.fromStageId === p.fromStage && x.toStageId === p.toStage && entered.has(x[p.key]) && toMs(x.occurredAt) >= entered.get(x[p.key])).map(x => x[p.key]));
        return { value: rateOf(moved.size, entered.size), numerator: moved.size, denominator: entered.size };
      }
      case 'stage_duration': {
        const r = need(p.fact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        if (!p.stageId) return { value: null, blocked: 'PARAMS_REQUIRED' };
        const byJ = new Map(); for (const x of r[0].filter(x => !p.stageModelVersionId || x.stageModelVersionId === p.stageModelVersionId)) { const a = byJ.get(x[p.key]) || []; a.push(x); byJ.set(x[p.key], a); }
        const xs = [], asOf = ctx.range.toMs;
        for (const list of byJ.values()) {
          list.sort((a, b) => toMs(a.occurredAt) - toMs(b.occurredAt));
          list.forEach((x, i) => {
            if (x.toStageId !== p.stageId) return; const next = list[i + 1];
            if (p.mode === 'COMPLETED' && next && inRange(ctx, next.occurredAt)) xs.push((toMs(next.occurredAt) - toMs(x.occurredAt)) / 1000);
            if (p.mode === 'CURRENT' && !next && toMs(x.occurredAt) <= asOf) xs.push((asOf - toMs(x.occurredAt)) / 1000);
          });
        }
        return { value: percentile(xs, 50), denominator: xs.length, extra: { p50: percentile(xs, 50), p75: percentile(xs, 75), p90: percentile(xs, 90), n: xs.length } };
      }
      case 'facts_sequence_rate': {
        const r = need(p.fromFact, p.toFact); if (!r) return { value: null, blocked: 'REQUIRES_BACKEND' };
        const from = new Map(); for (const x of r[0]) if (inRange(ctx, x[p.fromTime])) { const t = toMs(x[p.fromTime]); if (!from.has(x[p.key]) || t < from.get(x[p.key])) from.set(x[p.key], t); }
        const hit = new Set(r[1].filter(x => matchWhere(x, p.toWhere) && from.has(x[p.key]) && toMs(x[p.toTime]) >= from.get(x[p.key])).map(x => x[p.key]));
        return { value: rateOf(hit.size, from.size), numerator: hit.size, denominator: from.size };
      }
      default: return { value: null, blocked: 'UNKNOWN_EXPRESSION' };
    }
  }

  // ================================================================== quality (MetricQualityResult)
  function quality(m, res, ctx) {
    const issues = [], ev = ET() && ET().registry ? ET().registry.current() : null, h = ctx.health || {};
    let status = Quality.VALID, coverage;
    const worst = s => { const o = ['VALID', 'DEGRADED', 'STALE', 'INCOMPLETE', 'BLOCKED']; if (o.indexOf(s) > o.indexOf(status)) status = s; };
    if (m.status !== 'PUBLISHED') { issues.push('NOT_PUBLISHED'); worst(Quality.BLOCKED); }
    if (res.blocked) { issues.push(res.blocked); worst(Quality.BLOCKED); }
    if (R().isLocal(m) && m.domain !== 'DATA_QUALITY') {
      const names = R().sourceEvents(m).filter(n => n !== '*PRODUCT');
      if (names.length && ctx.wired && !names.some(n => ctx.wired.has(n))) { issues.push('PRODUCER_NOT_WIRED'); worst(Quality.BLOCKED); }
      if (ev && names.some(n => { const d = ev.latest(n); return d && d.sampling && d.sampling.mode !== 'NONE'; })) { issues.push('SAMPLED_SOURCE'); worst(Quality.DEGRADED); }
      if (h.truncatedBefore && toMs(h.truncatedBefore) >= ctx.range.fromMs) { issues.push('BUFFER_TRUNCATED'); worst(Quality.INCOMPLETE); }
      if (ctx.consentState === 'DENIED') { issues.push('CONSENT_DENIED'); worst(Quality.INCOMPLETE); }
      if (ctx.quarantinedNames && names.some(n => ctx.quarantinedNames.has(n))) { issues.push('QUARANTINED_SOURCE_EVENTS'); worst(Quality.DEGRADED); }
    }
    if (res.rows && ctx.dimensions && ctx.dimensions.length) { // attribution coverage (e.g. 62% campaign → DEGRADED)
      for (const d of ctx.dimensions) { const dim = R().dims.get(d); if (!dim || !dim.facts) continue; const known = res.rows.filter(x => getPath(x, dim.field) != null && getPath(x, dim.field) !== 'UNKNOWN').length; coverage = res.rows.length ? known / res.rows.length : null; if (coverage != null && coverage < 0.8) { issues.push('LOW_COVERAGE_' + d.toUpperCase()); worst(Quality.DEGRADED); } }
    }
    if (ctx.crossTenantExcluded) issues.push('CROSS_TENANT_ROWS_EXCLUDED');
    return { metricCode: m.code, status, coverage: coverage == null ? undefined : coverage, freshnessSeconds: ctx.freshnessSeconds, issueCodes: issues, evaluatedAt: new Date(ctx.nowMs).toISOString(), label: QUALITY_LABEL[status] };
  }

  // ================================================================== AnalyticsQueryService
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });
  /** dedupe input envelopes by eventId (backfill/re-run safe, §286–289) */
  const uniqueEvents = evs => { const seen = new Set(), out = []; for (const e of evs || []) { if (!e || !e.eventId || seen.has(e.eventId)) continue; seen.add(e.eventId); out.push(e); } return out; };
  function prepare(q, o) {
    if (!q || !q.organizationId) throw err('TENANT_REQUIRED', 'organizationId obrigatório (nenhuma consulta sem tenant).');
    const fromMs = toMs(q.timeRange && q.timeRange.from), toMsV = toMs(q.timeRange && q.timeRange.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMsV) || toMsV <= fromMs) throw err('INVALID_TIME_RANGE', 'timeRange {from,to} inválido.');
    const grain = q.grain || 'TOTAL'; if (!GRAINS.includes(grain)) throw err('INVALID_GRAIN', grain);
    const client = o.client || null;
    let all = o.events != null ? o.events : client ? client.events({ organizationId: q.organizationId }) : [];
    all = uniqueEvents(all).filter(e => e.organizationId === q.organizationId);
    const health = o.health || (client ? client.health() : {});
    const wired = o.wired || (client && client.wired ? client.wired() : null);
    const quarantinedNames = new Set(((o.quarantine || (client ? client.quarantined(q.organizationId) : [])) || []).map(x => x.eventName));
    const lastAt = all.reduce((a, e) => Math.max(a, toMs(e.capturedAt) || 0), 0), nowMs = o.now ? o.now() : Date.now();
    const filtersAsWhere = (q.filters || []).map(f => { const d = R().dims.get(f.dimension); if (!d) throw err('UNKNOWN_DIMENSION', f.dimension); return { field: d.field, in: f.in }; });
    return { q, tz: q.timezone || timezoneOf(q.organizationId), range: { fromMs, toMs: toMsV }, grain, all: all.filter(e => matchWhere(e, filtersAsWhere)), health, wired, quarantinedNames, facts: o.facts || null, nowMs,
      freshnessSeconds: lastAt ? Math.max(0, Math.round((nowMs - lastAt) / 1000)) : null, consentState: client ? client.consentState() : o.consentState, filtersAsWhere };
  }
  function bucketsOf(P) {
    if (P.grain === 'TOTAL') return [{ key: 'TOTAL', start: localDate(P.range.fromMs, P.tz), end: localDate(P.range.toMs - 1, P.tz) }];
    const out = new Map(); let d = localDate(P.range.fromMs, P.tz); const last = localDate(P.range.toMs - 1, P.tz);
    while (d <= last) { const k = bucketKey(d, P.grain); if (!out.has(k)) out.set(k, { key: k, start: d, end: d }); else out.get(k).end = d; d = addDays(d, 1); }
    return [...out.values()];
  }
  function evalMetric(m, P, events, rangeOverride, dimensions) {
    const range = rangeOverride || P.range;
    const ctx = { events: events.filter(e => { const t = toMs(e.occurredAt); return t >= range.fromMs && t < range.toMs; }), allEvents: P.all, facts: P.facts, range, health: P.health, params: P.q.params, organizationId: P.q.organizationId, filtersAsWhere: P.filtersAsWhere };
    return { res: compute(m, ctx), ctx };
  }
  /** query(q, o) → AnalyticsQueryResult. q: { organizationId, metricCodes, timeRange{from,to}, grain, dimensions?, filters?[{dimension,in}], comparisonPeriod?, metricVersions?, params? }
      o: { client | events, facts, health, wired, now } */
  function query(q, o = {}) {
    const P = prepare(q, o), reg = R(), series = [], quality0 = {}, versions = {};
    for (const code of q.metricCodes || []) {
      const m = reg.metric(code); if (!m) throw err('UNKNOWN_METRIC', code);
      if (q.metricVersions && q.metricVersions[code] && q.metricVersions[code] !== m.version) throw err('UNSUPPORTED_METRIC_VERSION', `${code}@${q.metricVersions[code]}`);
      for (const d of q.dimensions || []) { if (!reg.dims.has(d)) throw err('UNKNOWN_DIMENSION', d); if (!(m.dimensionsAllowed || []).includes(d)) throw err('DIMENSION_NOT_ALLOWED', `${code}:${d}`); }
      versions[code] = m.version;
      const points = bucketsOf(P).map(b => {
        const r = P.grain === 'TOTAL' ? P.range : { fromMs: Math.max(P.range.fromMs, zonedStart(b.start, P.tz)), toMs: Math.min(P.range.toMs, zonedStart(addDays(b.end, 1), P.tz)) };
        const { res } = evalMetric(m, P, P.all, r);
        return { periodStart: b.start, periodEnd: b.end, key: b.key, value: res.value, numerator: res.numerator, denominator: res.denominator, extra: res.extra };
      });
      const tot = evalMetric(m, P, P.all, null), qual = quality(m, tot.res, { ...tot.ctx, wired: P.wired, quarantinedNames: P.quarantinedNames, consentState: P.consentState, freshnessSeconds: P.freshnessSeconds, nowMs: P.nowMs, dimensions: q.dimensions });
      const groups = (q.dimensions || []).length ? groupBy(m, P, q.dimensions) : null;
      let comparison = null;
      if (q.comparisonPeriod) { const prev = previousRange(P.range, q.comparisonPeriod); const pr = evalMetric(m, P, P.all, prev).res; comparison = { period: q.comparisonPeriod, from: new Date(prev.fromMs).toISOString(), to: new Date(prev.toMs).toISOString(), value: pr.value, delta: tot.res.value != null && pr.value != null ? tot.res.value - pr.value : null, equalWindow: prev.toMs - prev.fromMs === P.range.toMs - P.range.fromMs }; }
      const blocked = qual.status === 'BLOCKED';
      series.push({ metricCode: code, metricVersion: m.version, name: m.name, domain: m.domain, entity: m.entity, measureType: m.measureType, unit: m.unit || null, grain: P.grain,
        points: blocked ? points.map(x => ({ ...x, value: null, numerator: undefined, denominator: undefined })) : points,
        total: { value: blocked ? null : tot.res.value, numerator: blocked ? undefined : tot.res.numerator, denominator: blocked ? undefined : tot.res.denominator, extra: blocked ? undefined : tot.res.extra }, groups, comparison,
        sourceType: R().isLocal(m) ? 'ANALYTICAL_LOCAL' : 'ANALYTICAL', valueLabel: qual.label });
      quality0[code] = qual;
    }
    return { series, metadata: { metricVersions: versions, freshness: P.freshnessSeconds == null ? null : `${P.freshnessSeconds}s`, quality: quality0, generatedAt: new Date(P.nowMs).toISOString(), timezone: P.tz, semanticBundle: reg.bundle(), organizationId: q.organizationId } };
  }
  /** local midnight of a date string in tz → UTC ms (search within ±14h; exact for whole-hour offsets like Brazil) */
  function zonedStart(ds, tz) { let g = dayMs(ds); for (let h = -14; h <= 14; h++) { const t = g + h * 3600000; if (localDate(t, tz) === ds && localDate(t - 3600000, tz) !== ds) return t; } return g; }
  function previousRange(r, mode) {
    const len = r.toMs - r.fromMs;
    if (mode === 'previous_week') return { fromMs: r.fromMs - 7 * 86400000, toMs: r.toMs - 7 * 86400000 };
    if (mode === 'previous_year') return { fromMs: r.fromMs - 365 * 86400000, toMs: r.toMs - 365 * 86400000 };
    return { fromMs: r.fromMs - len, toMs: r.fromMs }; // previous_period: same length immediately before (equal windows)
  }
  /** group by dimension values; UNKNOWN stays UNKNOWN (never redistributed); small sensitive groups are suppressed */
  function groupBy(m, P, dimensions) {
    const pol = (cfg().policy || {}).privacy || {}, minN = pol.minimumGroupSize || 5;
    const dims = dimensions.map(d => R().dims.get(d)), facts = dims.some(d => d.facts);
    if (facts) { // commercial: group fact rows by the dimension
      const p = m.params || {}, rows = P.facts && P.facts[p.fact]; if (!rows) return [];
      const keys = new Set(rows.map(r => dims.map(d => getPath(r, d.field) == null ? 'UNKNOWN' : String(getPath(r, d.field))).join('|')));
      return [...keys].sort().map(k => {
        const parts = k.split('|'), where = dims.map((d, i) => ({ field: d.field, in: [parts[i] === 'UNKNOWN' ? undefined : parts[i]] }));
        const sub = { ...P.facts, [p.fact]: rows.filter(r => dims.every((d, i) => (getPath(r, d.field) == null ? 'UNKNOWN' : String(getPath(r, d.field))) === parts[i])) };
        const res = compute(m, { events: [], allEvents: [], facts: sub, range: P.range, organizationId: P.q.organizationId, params: P.q.params });
        const small = dims.some(d => d.sensitive) && pol.suppressSmallBuckets !== false && (res.denominator != null ? res.denominator : res.value) < minN;
        return { dimensions: Object.fromEntries(dims.map((d, i) => [d.code, parts[i]])), value: small ? null : res.value, numerator: small ? undefined : res.numerator, denominator: small ? undefined : res.denominator, suppressed: small || undefined, where };
      });
    }
    const inR = P.all.filter(e => { const t = toMs(e.occurredAt); return t >= P.range.fromMs && t < P.range.toMs; });
    const keyOf = e => dims.map(d => getPath(e, d.field) == null ? 'UNKNOWN' : String(getPath(e, d.field))).join('|');
    const keys = new Set(selectEvents(inR, (m.params || {}).events ? m.params : { events: R().sourceEvents(m) }).map(keyOf));
    return [...keys].sort().map(k => {
      const sub = inR.filter(e => keyOf(e) === k), res = compute(m, { events: sub, allEvents: P.all, facts: P.facts, range: P.range, health: P.health, organizationId: P.q.organizationId });
      const small = dims.some(d => d.sensitive) && (res.value || 0) < minN;
      return { dimensions: Object.fromEntries(dims.map((d, i) => [d.code, k.split('|')[i]])), value: small ? null : res.value, numerator: small ? undefined : res.numerator, denominator: small ? undefined : res.denominator, suppressed: small || undefined };
    });
  }

  // ================================================================== funnels
  /** funnel(code, q, o) → { steps[{code,label,count,conversionFromPrevious,conversionFromFirst,dropOff}], entityKey, quality } — each step deduplicated by the entity key; first achievement */
  function funnel(code, q, o = {}) {
    const f = R().funnels.get(code); if (!f) throw err('UNKNOWN_FUNNEL', code);
    const P = prepare(q, o);
    let byEntity = new Map(); // entity → step order → first time
    const put = (k, order, t) => { if (k == null) return; const m = byEntity.get(k) || new Map(); if (!m.has(order) || t < m.get(order)) m.set(order, t); byEntity.set(k, m); };
    if (f.availability === 'REQUIRES_BACKEND') {
      const rows = P.facts && P.facts.FactJourneyStageTransition;
      if (!rows) return { code, name: f.name, entityKey: f.entityKey, version: f.version, steps: f.steps.map(s => ({ code: s.code, label: s.label, count: null, conversionFromPrevious: null, conversionFromFirst: null, dropOff: null })), quality: { status: 'BLOCKED', issueCodes: ['REQUIRES_BACKEND'], label: QUALITY_LABEL.BLOCKED } };
      for (const r of rows.filter(r => r.organizationId == null || r.organizationId === q.organizationId)) for (const s of f.steps) if ((s.stageCategories || []).includes(r.toStageCategory)) put(r[f.key], s.order, toMs(r.occurredAt));
    } else {
      for (const e of P.all) for (const s of f.steps) if (selectEvents([e], { events: s.events }).length) put(getPath(e, f.key), s.order, toMs(e.occurredAt));
    }
    // entities enter through step 1 inside the range; conversions may land later (window: session/lifetime)
    const counts = f.steps.map(() => 0);
    for (const m of byEntity.values()) {
      const t1 = m.get(1); if (t1 == null || !(t1 >= P.range.fromMs && t1 < P.range.toMs)) continue;
      let prevT = t1; counts[0]++;
      for (let i = 1; i < f.steps.length; i++) {
        const t = m.get(i + 1); if (t == null) break;
        if (f.orderMode === 'STRICT' && t < prevT) break;
        counts[i]++; prevT = f.orderMode === 'STRICT' ? t : prevT;
      }
    }
    const steps = f.steps.map((s, i) => ({ code: s.code, label: s.label, count: counts[i], conversionFromPrevious: i ? rateOf(counts[i], counts[i - 1]) : null, conversionFromFirst: i ? rateOf(counts[i], counts[0]) : null, dropOff: i ? counts[i - 1] - counts[i] : null }));
    const wiredIssue = f.availability === 'LOCAL' && P.wired && !f.steps.slice(1).some(s => (s.events || []).some(n => P.wired.has(n)));
    return { code, name: f.name, entityKey: f.entityKey, version: f.version, orderMode: f.orderMode, steps, quality: wiredIssue ? { status: 'BLOCKED', issueCodes: ['PRODUCER_NOT_WIRED'], label: QUALITY_LABEL.BLOCKED } : { status: 'VALID', issueCodes: [], label: QUALITY_LABEL.VALID }, note: 'Etapas não se somam: a mesma entidade aparece em várias etapas.' };
  }

  // ================================================================== cohorts
  /** cohort(code, q, o) → rows per cohort bucket. Late outcomes stay attributed to the original cohort. */
  function cohort(code, q, o = {}) {
    const c = R().cohorts.get(code); if (!c) throw err('UNKNOWN_COHORT', code);
    const P = prepare({ grain: 'DAY', ...q }, o), g = q.grain || (code === 'journeys_by_acquisition_week' ? 'WEEK' : code === 'shares_by_issue_month' ? 'MONTH' : 'DAY');
    if (code === 'sessions_by_start_day') {
      const start = new Map(), viewed = new Set();
      for (const e of P.all) { if (!isProductEvent(e)) continue; const s = e.session && e.session.productSessionId, t = toMs(e.occurredAt); if (!s) continue; if (!start.has(s) || t < start.get(s)) start.set(s, t); if (e.eventName === 'lot_selected') viewed.add(s); }
      const rows = new Map();
      for (const [s, t] of start) { if (!(t >= P.range.fromMs && t < P.range.toMs)) continue; const k = bucketKey(localDate(t, P.tz), g); const r = rows.get(k) || { cohort: k, size: 0, withLotView: 0 }; r.size++; if (viewed.has(s)) r.withLotView++; rows.set(k, r); }
      return { code, version: c.version, timezone: P.tz, rows: [...rows.values()].sort((a, b) => a.cohort < b.cohort ? -1 : 1).map(r => ({ ...r, lotViewRate: rateOf(r.withLotView, r.size) })) };
    }
    if (code === 'journeys_by_acquisition_week') {
      const acq = P.facts && P.facts.FactCustomerAcquisition, out = P.facts && P.facts.FactJourneyOutcome;
      if (!acq || !out) return { code, version: c.version, rows: [], quality: { status: 'BLOCKED', issueCodes: ['REQUIRES_BACKEND'] } };
      const won = new Set(out.filter(x => x.outcomeType === 'CLOSED_WON').map(x => x.journeyId)), rows = new Map();
      for (const a of acq) { const t = toMs(a.acquiredAt); if (!(t >= P.range.fromMs && t < P.range.toMs)) continue; const k = bucketKey(localDate(t, P.tz), g); const r = rows.get(k) || { cohort: k, acquired: 0, won: 0, ageDays: Math.floor((P.nowMs - t) / 86400000) }; r.acquired++; if (won.has(a.journeyId)) r.won++; r.ageDays = Math.min(r.ageDays, Math.floor((P.nowMs - t) / 86400000)); rows.set(k, r); }
      return { code, version: c.version, timezone: P.tz, rows: [...rows.values()].sort((a, b) => a.cohort < b.cohort ? -1 : 1).map(r => ({ ...r, wonOfAcquired: rateOf(r.won, r.acquired), immature: r.ageDays < 30 })), caveat: 'Ganhas ÷ adquiridas na coorte (não é journey_win_rate). Coortes com menos de 30 dias ainda não amadureceram.' };
    }
    return { code, version: c.version, rows: [], quality: { status: 'BLOCKED', issueCodes: ['REQUIRES_BACKEND'] } };
  }

  // ================================================================== materialization / backfill (idempotent, versioned, dry-run)
  /** materialize(q, o) → MetricAggregate[] (numerator/denominator kept; value at raw precision) */
  function materialize(q, o = {}) {
    const r = query(q, o), evs = o.events ? uniqueEvents(o.events) : null;
    const watermark = evs && evs.length ? evs.reduce((a, e) => e.capturedAt > a ? e.capturedAt : a, '') : null;
    return r.series.flatMap(s => s.points.map(p => ({ metricCode: s.metricCode, metricVersion: s.metricVersion, organizationId: q.organizationId, periodStart: p.periodStart, periodEnd: p.periodEnd, grain: s.grain, dimensions: {}, value: p.value, numerator: p.numerator, denominator: p.denominator, qualityStatus: r.metadata.quality[s.metricCode].status, computedAt: r.metadata.generatedAt, sourceWatermark: watermark })));
  }
  /** backfill({ query, events, facts, dryRun }) → { dryRun, transformationVersion, inputEvents, uniqueEvents, aggregates } — same input twice ⇒ same aggregates */
  function backfill(job = {}) {
    const evs = job.events || [], aggregates = materialize(job.query, { ...job, events: evs });
    return { dryRun: job.dryRun !== false, transformationVersion: R().src.transformationVersion, semanticBundle: R().bundle(), inputEvents: evs.length, uniqueEvents: uniqueEvents(evs).length, aggregates, audit: { at: new Date(job.now ? job.now() : Date.now()).toISOString(), organizationId: job.query && job.query.organizationId } };
  }

  // ================================================================== presentation formatting (UI rounds; calculation keeps raw precision)
  const nf = (d) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  function formatValue(m, v) {
    if (v == null) return 'N/A';
    if (m.measureType === 'RATE') return `${nf(1).format(v * 100)}%`;
    if (m.unit === 'SECONDS') { const s = Math.round(v); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`; }
    if (m.measureType === 'RATIO' || m.measureType === 'AVERAGE') return nf(1).format(v);
    return nf(0).format(v);
  }
  /** metricCard(m) → info popover content: name, definition, time basis, version, entity, caveats */
  const metricInfo = m => ({ code: m.code, name: m.name, definition: m.description, timeBasis: m.timestampBasis, version: m.version, entity: m.entity, numerator: m.numeratorMetricRef || null, denominator: m.denominatorMetricRef || null, zeroDenominator: m.zeroDenominatorPolicy, caveats: m.caveats || [], associationOnly: !!m.associationOnly, lineage: m.lineage });
  /** legacyInventory() → LegacyMetricInventoryItem[] — the panel had no KPI/dashboard formulas before topic 44 */
  const legacyInventory = () => [
    { location: 'src/state/store.js:151 (App.analytics.log)', label: 'log em memória de eventos (100 últimos)', formulaDescription: 'nenhuma: só lista', sourceTables: [], denominatorKnown: false, timeBasisKnown: true, tenantScoped: false, piiRisk: true, semanticConfidence: 'HIGH', migrationAction: 'REDEFINE', notes: 'Substituído pelo buffer local por organização com validação/privacidade; o campo log continua para compatibilidade.' },
    { location: 'src/presentationmode/runtime.js (outcome)', label: 'PresentationOutcomeSummary', formulaDescription: 'resumo da sessão (etapas vistas, reações)', sourceTables: ['sessão em memória'], denominatorKnown: true, timeBasisKnown: true, tenantScoped: true, piiRisk: false, semanticConfidence: 'HIGH', migrationAction: 'KEEP', notes: 'Resumo operacional da sessão, não é métrica analítica; presentation_completion_rate usa o fato explícito.' },
    { location: 'src/favorites/favorites.js (statusSummary)', label: 'contagens de favoritos', formulaDescription: 'estado atual', sourceTables: ['FavoriteRecord'], denominatorKnown: true, timeBasisKnown: false, tenantScoped: true, piiRisk: false, semanticConfidence: 'MEDIUM', migrationAction: 'KEEP', notes: 'KPI operacional (estado atual); favorites_added é a métrica analítica.' }
  ];
  return Object.freeze({ Quality, QUALITY_LABEL, build, current, query, funnel, cohort, materialize, backfill, compute, percentile, localDate, dimDate, isoWeek, timezoneOf, formatValue, metricInfo, causalWordingIssues, pricingWordingIssues, legacyInventory, uniqueEvents });
})();
