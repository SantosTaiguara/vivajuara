/* observability/obsSignals.js — topic 51: MetricsClient (registry-only names, controlled labels, cardinality budget,
   p50/p95/p99), TracerClient (spans, W3C ids, TraceSamplingPolicy with errors always kept), Web Vitals / long tasks,
   collectors that REUSE what already exists (geo/perf.js map timings, LoadCoordinator diagnostics, CacheManager
   metrics, security events), health checks (live / ready / connectivity / dependencies), data-freshness signals,
   SLO evaluation (error budget, burn rate) and local operational alert evaluation (never paging, never sent).
   Everything stays in this tab. Unknown is never 0: a signal without data is "não disponível". */
App.observability = App.observability || {};
App.observability.signals = (() => {
  const C = App.observability.core;
  const safe = (f, d = null) => { try { return f(); } catch (e) { return d; } };
  const nowMs = o => (o && o.now != null ? (typeof o.now === 'function' ? o.now() : +new Date(o.now)) : Date.now());
  const reg = () => C.registry(), pol = () => C.policy();
  const DataLabel = Object.freeze({ CONFIRMED: 'confirmado', CALCULATED: 'calculado', ESTIMATED: 'estimado', NOT_AVAILABLE: 'não disponível', NEEDS_CONFIRMATION: 'necessita confirmação' });

  // ---------------------------------------------------------------- MetricsClient (§45–53)
  const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : null;
  /** validateLabels(def, labels) → { ok, labels, reason } — only registered labels; forbidden/high-cardinality keys rejected; values controlled */
  function validateLabels(def, labels = {}) {
    const r = reg(), forb = (r.forbiddenLabels || []).map(x => x.toLowerCase()), out = {};
    for (const [k, v] of Object.entries(labels || {})) {
      if (forb.includes(k.toLowerCase())) return { ok: false, reason: 'FORBIDDEN_LABEL', label: k };
      if (!def.allowedLabels.includes(k)) return { ok: false, reason: 'UNKNOWN_LABEL', label: k };
      const s = v == null ? 'UNKNOWN' : String(v), vals = (r.labelValues || {})[k], pat = (r.labelPatterns || {})[k];
      if (vals) out[k] = vals.includes(s) ? s : vals.includes('OTHER') ? 'OTHER' : vals.includes('UNKNOWN') ? 'UNKNOWN' : null;
      else if (pat) out[k] = new RegExp(pat).test(s) ? s : null;
      else out[k] = null;
      if (out[k] == null) return { ok: false, reason: 'INVALID_VALUE', label: k };
    }
    return { ok: true, labels: out };
  }
  /** createMetrics({ registry }) → { counter, gauge, observe, snapshot, summary, value, rejected } */
  function createMetrics(o = {}) {
    const series = new Map(), rejected = {}, maxSeries = (pol().metrics || {}).maxSeriesPerMetric || 50, reservoir = (pol().buffers || {}).histogramReservoir || 200;
    const defs = () => o.registry || reg().metrics || {};
    const reject = reason => { rejected[reason] = (rejected[reason] || 0) + 1; C.telemetry.dropped.METRIC++; return false; };
    const key = (name, labels) => name + '{' + Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',') + '}';
    function upsert(name, type, labels) {
      const def = defs()[name];
      if (!def) return reject('UNREGISTERED_METRIC');
      if (def.type !== type) return reject('WRONG_TYPE');
      const v = validateLabels(def, labels); if (!v.ok) return reject(v.reason);
      const k = key(name, v.labels);
      if (!series.has(k)) {
        let n = 0; for (const s of series.values()) if (s.name === name) n++;
        if (n >= maxSeries) return reject('CARDINALITY_EXCEEDED');
        series.set(k, { name, type, labels: v.labels, value: 0, count: 0, sum: 0, samples: [], updatedAt: null });
      }
      return series.get(k);
    }
    const counter = (name, labels = {}, n = 1) => safe(() => { const s = upsert(name, 'COUNTER', labels); if (!s) return false; if (!(n >= 0)) return reject('INVALID_VALUE'); s.value += n; s.updatedAt = Date.now(); return true; }, false);
    const gauge = (name, labels = {}, v) => safe(() => { if (v == null || !Number.isFinite(+v)) return reject('INVALID_VALUE'); const s = upsert(name, 'GAUGE', labels); if (!s) return false; s.value = +v; s.updatedAt = Date.now(); return true; }, false);
    const observe = (name, labels = {}, v) => safe(() => { if (v == null || !Number.isFinite(+v) || +v < 0) return reject('INVALID_VALUE'); const s = upsert(name, 'HISTOGRAM', labels); if (!s) return false; s.count++; s.sum += +v; s.samples.push(+v); if (s.samples.length > reservoir) s.samples.shift(); s.updatedAt = Date.now(); return true; }, false);
    /** summary of one histogram series or of all its series: n, p50/p95/p99, max — never a lone average; < min samples → percentiles null */
    function summary(name, labels = null) {
      const min = (pol().metrics || {}).minSamplesForPercentiles || 5;
      const all = [...series.values()].filter(s => s.name === name && s.type === 'HISTOGRAM' && (!labels || Object.entries(labels).every(([k, v]) => s.labels[k] === v)));
      const xs = all.flatMap(s => s.samples).sort((a, b) => a - b), n = all.reduce((a, s) => a + s.count, 0);
      if (!n) return { n: 0, p50: null, p95: null, p99: null, max: null, label: DataLabel.NOT_AVAILABLE };
      const enough = xs.length >= min;
      return { n, p50: quantile(xs, 0.5), p95: enough ? quantile(xs, 0.95) : null, p99: enough ? quantile(xs, 0.99) : null, max: xs[xs.length - 1], label: DataLabel.CALCULATED, fewSamples: !enough };
    }
    /** value(name, labels?) → counter sum / last gauge value, or null when the series never existed (null is never 0) */
    function value(name, labels = null) {
      const all = [...series.values()].filter(s => s.name === name && (!labels || Object.entries(labels).every(([k, v]) => s.labels[k] === v)));
      if (!all.length) return null;
      return all[0].type === 'GAUGE' ? all.reduce((m, s) => (!m || s.updatedAt >= m.updatedAt ? s : m), null).value : all.reduce((a, s) => a + (s.type === 'HISTOGRAM' ? s.count : s.value), 0);
    }
    const snapshot = () => [...series.values()].map(s => ({ name: s.name, type: s.type, labels: { ...s.labels }, value: s.type === 'HISTOGRAM' ? null : s.value, count: s.count || null, sum: s.type === 'HISTOGRAM' ? s.sum : null }));
    return { counter, gauge, observe, summary, value, snapshot, rejected: () => ({ ...rejected }), seriesCount: name => [...series.values()].filter(s => !name || s.name === name).length, clear: () => series.clear() };
  }

  // ---------------------------------------------------------------- TracerClient (§64–76)
  /** sampleDecision({ name, hasError, organizationId }, policy) → { sampled, rate, reason }: errors always (§73), high-risk higher, debug override */
  function sampleDecision(x, o = {}) {
    const s = pol().sampling || {}, p = { ...(s.local || { defaultRate: 1, errorRate: 1, highRiskOperationRate: 1 }), ...(o.sampling || {}) }, rnd = o.random || Math.random;
    if (x.hasError) return { sampled: p.errorRate == null ? true : rnd() < p.errorRate || p.errorRate >= 1, rate: p.errorRate == null ? 1 : p.errorRate, reason: 'ERROR' };
    const ov = C.activeOverride(o);
    if (ov && ov.traceSamplingRate != null && (!ov.organizationId || ov.organizationId === x.organizationId)) return { sampled: rnd() < ov.traceSamplingRate, rate: ov.traceSamplingRate, reason: 'DIAGNOSTIC_OVERRIDE' };
    if (p.tenantDebugOverrides && x.organizationId && p.tenantDebugOverrides[x.organizationId] != null) { const r = p.tenantDebugOverrides[x.organizationId]; return { sampled: rnd() < r, rate: r, reason: 'TENANT_OVERRIDE' }; }
    const hr = (s.highRiskSpans || []).includes(x.name), rate = hr ? p.highRiskOperationRate : p.defaultRate;
    return { sampled: rate >= 1 || rnd() < rate, rate, reason: hr ? 'HIGH_RISK' : 'DEFAULT' };
  }
  /** createTracer({ now, contextProvider, sampling, random, registry }) → { startSpan, traces, sweep, active } — decision at the root's end, so an error anywhere keeps the trace */
  function createTracer(o = {}) {
    const max = (pol().buffers || {}).spans || 200, maxDur = (pol().sampling || {}).maxSpanDurationMs || 300000;
    const kept = C.createBuffer(max, () => 0), open = new Map(), pending = new Map(); let droppedAttrs = 0, unregistered = 0, notSampled = 0;
    const defs = () => o.registry || reg().spans || {};
    function filterAttrs(def, attrs = {}) {
      const out = {}, allow = def ? [...def.allowedAttributes, ...(def.highCardinalityAttributesAllowed || [])] : [];
      for (const [k, v] of Object.entries(attrs || {})) {
        if (!allow.includes(k) || C.isBlockedKey(k, C.redactionPolicy()) || v == null) { droppedAttrs++; continue; }
        if (typeof v === 'string') { if (C.detectSensitive(v).length) { droppedAttrs++; continue; } out[k] = v.slice(0, 80); }
        else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v; else droppedAttrs++;
      }
      return out;
    }
    function startSpan(name, so = {}) {
      const def = defs()[name]; if (!def) unregistered++;
      const parent = so.parent || null, base = safe(() => (o.contextProvider || C.defaultContext)(), {}) || {};
      const traceId = parent ? parent.traceId : C.newTraceId(), spanId = C.newSpanId(), t0 = nowMs(o);
      const span = { name, kind: so.kind || (def && def.kind) || 'INTERNAL', traceId, spanId, parentSpanId: parent ? parent.spanId : null, links: (so.links || []).filter(l => l && l.traceId && l.spanId).map(l => ({ traceId: l.traceId, spanId: l.spanId })),
        startTime: new Date(t0).toISOString(), endTime: null, startMs: t0, durationMs: null, status: 'UNSET', registered: !!def,
        attributes: filterAttrs(def, { route_code: base.routeCode, device_class: base.deviceClass, app_version: base.appVersion, environment: base.environment, ...(so.attributes || {}) }),
        organizationId: base.organizationId || null, correlationId: so.correlationId || base.correlationId || null, requestId: so.requestId || null, errorCode: null };
      open.set(spanId, span);
      const rootId = parent ? (parent.rootSpanId || parent.spanId) : spanId; span.rootSpanId = rootId;
      if (!pending.has(rootId)) pending.set(rootId, []);
      const api = {
        traceId, spanId, rootSpanId: rootId, get span() { return span; },
        context: () => C.createContext(base, { traceId, spanId, requestId: span.requestId, correlationId: span.correlationId }),
        setAttribute: (k, v) => { Object.assign(span.attributes, filterAttrs(def, { [k]: v })); return api; },
        recordError: err => { const n = C.normalizeError(err, { withStack: false }); span.status = 'ERROR'; span.errorCode = n.code; return api; },
        child: (n2, co = {}) => startSpan(n2, { ...co, parent: { traceId, spanId, rootSpanId: rootId } }),
        end: (status, attrs) => { if (span.endTime) return span; const t1 = nowMs(o); span.endTime = new Date(t1).toISOString(); span.durationMs = Math.max(0, t1 - t0);
          if (status) span.status = status; else if (span.status === 'UNSET') span.status = 'OK'; if (attrs) api.setAttribute && Object.entries(attrs).forEach(([k, v]) => api.setAttribute(k, v));
          open.delete(spanId); finish(span); return span; }
      };
      return api;
    }
    function finish(span) {
      const list = pending.get(span.rootSpanId); if (!list) return;
      list.push(span);
      if (span.spanId !== span.rootSpanId) return; // children wait for the root
      pending.delete(span.rootSpanId);
      const hasError = list.some(s => s.status === 'ERROR'), d = sampleDecision({ name: span.name, hasError, organizationId: span.organizationId }, o);
      if (!d.sampled) { notSampled++; C.telemetry.dropped.SPAN += list.length; return; }
      for (const s of list) { const { startMs, ...rest } = s; kept.push(Object.freeze({ ...rest, attributes: { ...s.attributes }, sampling: d.reason })); }
    }
    /** sweep() — spans open longer than maxSpanDurationMs are closed (never keep a trace open for hours, §70) */
    function sweep() { const t = nowMs(o); let n = 0; for (const s of [...open.values()]) if (t - s.startMs > maxDur) { s.attributes.truncated = true; s.endTime = new Date(t).toISOString(); s.durationMs = t - s.startMs; s.status = s.status === 'ERROR' ? 'ERROR' : 'UNSET'; open.delete(s.spanId); finish(s); n++; } return n; }
    /** run(name, fn, so) — span around a sync/async function; errors mark the span and are rethrown (the tracer never hides them) */
    function run(name, fn, so = {}) {
      const sp = startSpan(name, so);
      try { const r = fn(sp); if (r && typeof r.then === 'function') return r.then(v => { sp.end(); return v; }, e => { sp.recordError(e).end('ERROR'); throw e; }); sp.end(); return r; }
      catch (e) { sp.recordError(e).end('ERROR'); throw e; }
    }
    const byTrace = traceId => kept.list().filter(s => s.traceId === traceId);
    return { startSpan, run, sweep, spans: () => kept.list(), byTrace, openCount: () => open.size, stats: () => ({ kept: kept.size(), droppedAttributes: droppedAttrs, unregistered, notSampled }), clear: () => { kept.clear(); open.clear(); pending.clear(); } };
  }

  // ---------------------------------------------------------------- Web Vitals + long tasks (§77–79), feature-detected, local only
  /** createPerfCollector({ metrics, contextProvider }) → { start, stop, vitals } — LCP, CLS (no recent input), INP (largest interaction), long tasks */
  function createPerfCollector(o = {}) {
    const obs = [], v = { lcpMs: null, cls: null, inpMs: null, longTasks: 0, longTaskMaxMs: null };
    const labels = () => { const c = safe(() => (o.contextProvider || C.defaultContext)(), {}) || {}; return { device_class: c.deviceClass || 'UNKNOWN', route_code: c.routeCode || 'OTHER' }; };
    const PO = o.PerformanceObserver || (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null);
    function watch(type, cb, extra = {}) { if (!PO) return false; try { const ob = new PO(l => safe(() => l.getEntries().forEach(cb))); ob.observe({ type, buffered: true, ...extra }); obs.push(ob); return true; } catch (e) { return false; } }
    function start() {
      const m = o.metrics, on = [];
      on.push(watch('largest-contentful-paint', e => { v.lcpMs = Math.round(e.startTime); }));
      on.push(watch('layout-shift', e => { if (!e.hadRecentInput) v.cls = +((v.cls || 0) + e.value).toFixed(4); }));
      on.push(watch('event', e => { if (e.interactionId && (v.inpMs == null || e.duration > v.inpMs)) v.inpMs = Math.round(e.duration); }, { durationThreshold: 40 }));
      on.push(watch('longtask', e => { v.longTasks++; v.longTaskMaxMs = Math.max(v.longTaskMaxMs || 0, Math.round(e.duration)); if (m) m.observe('longtask_duration_ms', { route_code: labels().route_code }, e.duration); }));
      return on.filter(Boolean).length;
    }
    /** flush() — records the current vitals once (call on visibilitychange→hidden or when the view opens) */
    function flush() { const m = o.metrics; if (!m) return { ...v }; const l = labels(); if (v.lcpMs != null) m.observe('web_vitals_lcp_ms', l, v.lcpMs); if (v.inpMs != null) m.observe('web_vitals_inp_ms', l, v.inpMs); if (v.cls != null) m.observe('web_vitals_cls', l, v.cls); return { ...v }; }
    function stop() { obs.forEach(ob => safe(() => ob.disconnect())); obs.length = 0; }
    return { start, stop, flush, vitals: () => ({ ...v }) };
  }
  /** navigationTiming() → route boot timings from the Navigation Timing API (ms since navigation start) or nulls */
  function navigationTiming(perf = typeof performance !== 'undefined' ? performance : null) {
    const n = safe(() => perf.getEntriesByType('navigation')[0]);
    if (!n) return { ttfbMs: null, domContentLoadedMs: null, loadMs: null, transferBytes: null, label: DataLabel.NOT_AVAILABLE };
    const r = x => (x > 0 ? Math.round(x) : null);
    return { ttfbMs: r(n.responseStart), domContentLoadedMs: r(n.domContentLoadedEventEnd), loadMs: r(n.loadEventEnd), transferBytes: n.transferSize || null, label: DataLabel.CONFIRMED };
  }

  // ---------------------------------------------------------------- collectors: reuse existing diagnostics, do not re-measure
  /** fromMapDiagnostics(d) → map timings from geo/perf.js recorder (App.MapView.diagnostics()), p50/p95 already computed there */
  function fromMapDiagnostics(d) {
    if (!d) return { available: false, label: DataLabel.NOT_AVAILABLE };
    const t = d.timings || {}, st = k => t[k] ? { n: t[k].n, p50: +(+t[k].p50).toFixed(1), p95: +(+t[k].p95).toFixed(1), last: +(+t[k].last).toFixed(1) } : null;
    return { available: true, label: DataLabel.CALCULATED, rendererType: d.rendererType || 'SVG', readiness: d.readiness || null, featureCount: d.featureCount || null, initMs: d.initMs ?? null,
      geometryLoadMs: d.geometryLoadMs ?? null, firstRenderMs: d.firstRenderMs ?? null, indexBuildMs: d.indexBuildMs ?? null, layerSwitch: st('map_layer_switch'), hitTest: st('map_hit_test'), render: st('map_render'),
      longTasks: Array.isArray(d.longTasks) ? d.longTasks.length : null, warnings: (d.warnings || []).slice(0, 5) };
  }
  /** fromLoadingDiagnostics(d) → topic 47 counters (LoadCoordinator.diagnostics()) */
  function fromLoadingDiagnostics(d) {
    if (!d) return { available: false, label: DataLabel.NOT_AVAILABLE };
    const l = d.lazy || {}, p = d.prefetch || {};
    return { available: true, label: DataLabel.CALCULATED, queued: d.queue ? d.queue.queued : null, active: d.queue ? d.queue.active : null, deduplicated: l.deduplicatedRequestCount ?? null, cancelled: l.cancelledRequestCount ?? null,
      staleDiscarded: l.staleResultDiscardCount ?? null, optionalFailures: l.optionalFailureCount ?? null, prefetchHitRate: p.hitRate ?? null, prefetchWasteRate: p.wasteRate ?? null, warnings: (l.warnings || []).slice() };
  }
  /** fromCacheInspect(d) → topic 48 summary (CacheManager.inspect()): counts, sizes, states — never content */
  function fromCacheInspect(d) {
    if (!d) return { available: false, label: DataLabel.NOT_AVAILABLE };
    return { available: true, label: DataLabel.CALCULATED, memoryEntries: d.memoryEntryCount ?? null, persistentEntries: d.persistentEntryCount ?? null, persistentBytes: d.estimatedPersistentBytes ?? null,
      staleHits: d.staleHitCount ?? null, corruption: d.corruptionCount ?? null, evictions: d.evictionCount ?? null, degraded: !!d.persistentDegraded, warnings: (d.warnings || []).slice(0, 5) };
  }
  /** fromSecurityEvents(events) → aggregated categories only (§88–89, §204): never the event, the user or the token */
  function fromSecurityEvents(events) {
    const by = {}; for (const e of events || []) if (e && e.type) by[e.type] = (by[e.type] || 0) + 1;
    return { available: Array.isArray(events), label: Array.isArray(events) ? DataLabel.CALCULATED : DataLabel.NOT_AVAILABLE, byType: by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  }

  // ---------------------------------------------------------------- data freshness (§196–199) — reads lifecycle's FreshnessState, never recomputes
  /** freshnessSignals({ freshnessState, versions, now }) → per channel: status, ageMs, expectedMaxAgeMs, alert (only when a limit was decided) */
  function freshnessSignals(inp = {}, o = {}) {
    const t = nowMs(o), fs = inp.freshnessState || {}, def = reg().freshnessSignals || {};
    const ch = (name, s) => {
      const d = def[name] || {}, ref = s && (s.lastSuccessfulSyncAt || null), ageMs = ref ? Math.max(0, t - Date.parse(ref)) : null;
      const status = s && s.status ? s.status : 'UNKNOWN', limit = d.expectedMaxAgeMs ?? null;
      return { channel: name, status, ageMs, lastConfirmedAt: ref, sourceUpdatedAt: (s && s.sourceUpdatedAt) || null, source: (s && s.source) || null, expectedMaxAgeMs: limit,
        label: ref ? DataLabel.CALCULATED : DataLabel.NOT_AVAILABLE, limitLabel: limit == null ? DataLabel.NEEDS_CONFIRMATION : DataLabel.CONFIRMED,
        stale: limit != null && (ageMs == null || ageMs > limit), alert: limit != null && (ageMs == null || ageMs > limit) ? 'availability_feed_stale' : null, decision: d.decision || null };
    };
    const v = inp.versions || {};
    return { AVAILABILITY: ch('AVAILABILITY', fs.availability), PRICING: ch('PRICING', fs.commercial),
      ANALYSIS: { channel: 'ANALYSIS', status: v.analysisVersion ? 'VERSIONED' : 'UNKNOWN', version: v.analysisVersion || null, ageMs: null, label: v.analysisVersion ? DataLabel.CONFIRMED : DataLabel.NOT_AVAILABLE, expectedMaxAgeMs: null, limitLabel: DataLabel.NEEDS_CONFIRMATION, stale: false, alert: null } };
  }

  // ---------------------------------------------------------------- health checks (§106–115): live / ready / connectivity / dependencies
  const HealthStatus = Object.freeze({ OK: 'OK', DEGRADED: 'DEGRADED', DOWN: 'DOWN', UNKNOWN: 'UNKNOWN' });
  /** liveness() — minimal: the script runs (never tests dependencies) */
  const liveness = () => ({ check: 'LIVE', status: 'OK', label: 'O painel está em execução.' });
  /** readiness({ lotCount, mapReadiness, configOk }) — can this tab serve the user? */
  function readiness(x = {}) {
    const checks = [
      { id: 'lots', ok: x.lotCount > 0, unknown: x.lotCount == null, label: x.lotCount != null ? `${x.lotCount} lotes carregados` : 'Lotes: não disponível' },
      { id: 'map', ok: ['INTERACTIVE', 'FULLY_ENHANCED'].includes(x.mapReadiness), unknown: !x.mapReadiness, label: x.mapReadiness ? `Mapa: ${x.mapReadiness === 'INTERACTIVE' || x.mapReadiness === 'FULLY_ENHANCED' ? 'interativo' : 'carregando'}` : 'Mapa: não disponível' },
      { id: 'config', ok: x.configOk !== false, unknown: x.configOk == null, label: x.configOk === false ? 'Configuração inválida' : 'Configuração carregada' }
    ];
    const down = checks.some(c => !c.unknown && !c.ok && c.id !== 'map'), degraded = checks.some(c => !c.unknown && !c.ok) || checks.some(c => c.unknown);
    return { check: 'READY', status: down ? 'DOWN' : degraded ? (checks.every(c => c.unknown) ? 'UNKNOWN' : 'DEGRADED') : 'OK', checks };
  }
  /** connectivity(state) — topic 49 signal (ONLINE / OFFLINE / DEGRADED / UNKNOWN), minimal */
  function connectivity(state) {
    const s = String(state || 'UNKNOWN').toUpperCase();
    return { check: 'CONNECTIVITY', state: ['ONLINE', 'OFFLINE', 'DEGRADED'].includes(s) ? s : 'UNKNOWN', status: s === 'ONLINE' ? 'OK' : s === 'OFFLINE' || s === 'DEGRADED' ? 'DEGRADED' : 'UNKNOWN' };
  }
  /** dependencies({ dataOrigin, backend, swRegistered, persistentDegraded, storageSupported }) — what the tab depends on */
  function dependencies(x = {}) {
    const d = (id, status, label) => ({ id, status, label });
    return [
      d('DATA_SOURCE', x.dataOrigin == null ? 'UNKNOWN' : x.dataOrigin === 'REMOTE' || x.dataOrigin === 'NETWORK' ? 'OK' : 'DEGRADED', x.dataOrigin == null ? 'Origem dos dados: não disponível' : `Origem dos dados: ${({ REMOTE: 'servidor', NETWORK: 'servidor', CACHE: 'cópia deste aparelho', BUNDLED: 'cópia embutida no painel' })[x.dataOrigin] || x.dataOrigin}`),
      d('LOCAL_STORAGE_DB', x.backend == null ? 'UNKNOWN' : x.backend === 'indexeddb' ? 'OK' : 'DEGRADED', x.backend == null ? 'Armazenamento local: não disponível' : x.backend === 'indexeddb' ? 'Armazenamento local disponível' : 'Armazenamento local limitado (só memória)'),
      d('PERSISTENT_CACHE', x.persistentDegraded == null ? 'UNKNOWN' : x.persistentDegraded ? 'DEGRADED' : 'OK', x.persistentDegraded == null ? 'Cache persistente: não disponível' : x.persistentDegraded ? 'Cache persistente degradado' : 'Cache persistente ok'),
      d('SERVICE_WORKER', x.swRegistered == null ? 'UNKNOWN' : x.swRegistered ? 'OK' : 'DEGRADED', x.swRegistered == null ? 'Modo offline: não disponível' : x.swRegistered ? 'Modo offline registrado' : 'Modo offline não registrado')
    ];
  }

  // ---------------------------------------------------------------- SLO, error budget, burn rate (§116–123) — targets are PROPOSED
  /** evaluateSlo(slo, { good, total }) → sli, budget, burn rate; INSUFFICIENT_DATA below min samples (never "100%") */
  function evaluateSlo(slo, x = {}) {
    const min = (pol().metrics || {}).minSamplesForSlo || 20, total = x.total ?? null, good = x.good ?? null;
    const base = { sloId: slo.sloId, target: slo.target, window: slo.window, owner: slo.owner, targetLabel: slo.status === 'PROPOSED_NEEDS_BASELINE' ? DataLabel.NEEDS_CONFIRMATION : DataLabel.CONFIRMED };
    if (total == null || good == null || total < min) return { ...base, status: 'INSUFFICIENT_DATA', sli: null, label: DataLabel.NOT_AVAILABLE, samples: total };
    const bad = total - good, sli = good / total, allowed = (1 - slo.target) * total, burnRate = (1 - slo.target) > 0 ? (bad / total) / (1 - slo.target) : null;
    return { ...base, status: sli >= slo.target ? 'MEETING' : 'BREACHING', sli: +sli.toFixed(5), label: DataLabel.CALCULATED, samples: total, errorBudget: { allowed: +allowed.toFixed(2), consumed: bad, remaining: +(allowed - bad).toFixed(2), remainingRatio: allowed > 0 ? +Math.max(0, 1 - bad / allowed).toFixed(4) : null }, burnRate: burnRate == null ? null : +burnRate.toFixed(3) };
  }
  /** burnRateAlert(burnShort, burnLong) — multi-window: page only if both windows burn fast (no short spike paging, §123) */
  const burnRateAlert = (short, long, o = {}) => short != null && long != null && short >= (o.fast || 14.4) && long >= (o.fast || 14.4) ? 'HIGH' : short != null && long != null && short >= (o.slow || 6) && long >= (o.slow || 6) ? 'WARNING' : null;

  // ---------------------------------------------------------------- local operational alerts (§124–144): evaluated for the view only; never paging, never sent
  /** evaluateLocalAlerts({ metrics, freshness, now }, state) → alerts that would fire, with cooldown and min samples; HIGH/CRITICAL need a runbook */
  function evaluateLocalAlerts(x = {}, state = { last: {} }, o = {}) {
    const defs = reg().alerts || {}, rbs = reg().runbooks || {}, m = x.metrics, t = nowMs(o), out = [];
    const val = (n, l) => (m ? m.value(n, l) : null);
    const checks = {
      frontend_error_spike: () => ({ v: val('frontend_errors_total'), fire: v => v >= (defs.frontend_error_spike.minSamples || 10) }),
      cache_corruption_spike: () => ({ v: val('cache_corruption_total'), fire: v => v >= (defs.cache_corruption_spike.minSamples || 5) }),
      tenant_scope_violation: () => ({ v: val('tenant_scope_violation_total'), fire: v => v >= 1 }),
      sync_failure_spike: () => ({ v: val('offline_sync_failure_total'), fire: v => v >= (defs.sync_failure_spike.minSamples || 3) }),
      sw_update_failure_spike: () => ({ v: val('sw_lifecycle_total', { sw_event: 'UPDATE_FAILED' }), fire: v => v >= (defs.sw_update_failure_spike.minSamples || 2) }),
      telemetry_export_failing: () => ({ v: val('telemetry_export_failures_total'), fire: v => v > 0 }),
      map_interactive_degraded: () => { const s = m ? m.summary('map_interactive_duration_ms') : null; return { v: s && s.p95, fire: v => v != null && s.n >= (defs.map_interactive_degraded.minSamples || 5) && v > (defs.map_interactive_degraded.thresholdMs || 3000) }; },
      availability_feed_stale: () => { const f = x.freshness && x.freshness.AVAILABILITY; return { v: f ? f.ageMs : null, fire: () => !!(f && f.stale), needsDecision: !f || f.expectedMaxAgeMs == null }; }
    };
    for (const [id, f] of Object.entries(checks)) {
      const def = defs[id]; if (!def) continue;
      const r = f(); if (r.needsDecision) { out.push({ alertId: id, severity: def.severity, state: 'NEEDS_DECISION', value: r.v, runbookRef: def.runbookRef }); continue; }
      if (r.v == null || !r.fire(r.v)) { out.push({ alertId: id, severity: def.severity, state: r.v == null ? 'NO_DATA' : 'OK', value: r.v, runbookRef: def.runbookRef }); continue; }
      const last = state.last[id], cooling = last != null && t - last < def.cooldownSeconds * 1000;
      if (!cooling) state.last[id] = t;
      out.push({ alertId: id, severity: def.severity, state: cooling ? 'FIRING_COOLDOWN' : 'FIRING', value: r.v, runbookRef: def.runbookRef, runbook: rbs[def.runbookRef] ? rbs[def.runbookRef].title : null, owner: def.owner, paging: false });
    }
    return out;
  }

  return Object.freeze({ DataLabel, validateLabels, createMetrics, quantile, sampleDecision, createTracer, createPerfCollector, navigationTiming,
    fromMapDiagnostics, fromLoadingDiagnostics, fromCacheInspect, fromSecurityEvents, freshnessSignals, HealthStatus, liveness, readiness, connectivity, dependencies,
    evaluateSlo, burnRateAlert, evaluateLocalAlerts });
})();
