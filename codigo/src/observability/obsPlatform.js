/* observability/obsPlatform.js — topic 51: the ObservabilityProvider of this tab (logger + metrics + tracer + errors behind
   one vendor-neutral boundary), sinks (LOCAL on; CONSOLE only in development; REMOTE off — decision O1), OTLP-shaped
   export mapping (contract only), ObservabilityRegistry validation (the CI checks), OperationalChangeEvent timeline,
   SupportDiagnosticSnapshot ("Copiar diagnóstico técnico"), instrumentation helpers for QuickView / map / loading /
   cache / PWA / share / security, and the technical view model + markup "Saúde da plataforma".

   Nothing leaves the device. The snapshot carries versions, counts, states and error references — never customer data,
   tokens, URLs or lot prices. Auto-installs the global error handlers in a browser (listeners only, idempotent). */
App.observability = App.observability || {};
App.observability.platform = (() => {
  const C = App.observability.core, S = App.observability.signals;
  const safe = (f, d = null) => { try { return f(); } catch (e) { return d; } };
  const nowMs = o => (o && o.now != null ? (typeof o.now === 'function' ? o.now() : +new Date(o.now)) : Date.now());
  const esc = C.esc, DL = S.DataLabel;

  // ---------------------------------------------------------------- sinks (§8–9, §217–219): adapters, never a vendor SDK in the domain
  const SinkKind = Object.freeze({ LOCAL: 'LOCAL', CONSOLE: 'CONSOLE', REMOTE: 'REMOTE' });
  /** RemoteSink — present only as a contract: disabled by policy, refuses to send, counts nothing as delivered */
  function createRemoteSink() {
    const cfg = ((C.policy().sinks || {}).REMOTE) || {};
    return Object.freeze({ kind: SinkKind.REMOTE, enabled: false, endpoint: null, decision: cfg.decision || 'O1', reason: 'Destino remoto desligado por política: nada sai do aparelho.',
      write() { /* intentionally a no-op: no fetch, no beacon, no third party */ }, send: () => ({ ok: false, code: 'REMOTE_SINK_DISABLED', decision: cfg.decision || 'O1' }) });
  }
  const sinkStatus = () => { const p = C.policy().sinks || {}; return Object.keys(SinkKind).map(k => ({ kind: k, enabled: k === 'REMOTE' ? false : k === 'CONSOLE' ? 'development' : true, note: (p[k] && p[k].note) || '' })); };

  // ---------------------------------------------------------------- OTLP-shaped mapping (contract for O1; pure, already redacted inputs)
  const SEV = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 };
  const attrs = o => Object.entries(o || {}).filter(([, v]) => v != null && typeof v !== 'object').map(([key, v]) => ({ key, value: typeof v === 'number' ? (Number.isInteger(v) ? { intValue: v } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } }));
  const toOtlpLog = ev => ({ timeUnixNano: String(Date.parse(ev.timestamp) * 1e6), severityNumber: SEV[ev.level] || 9, severityText: ev.level, body: { stringValue: ev.message },
    traceId: ev.traceId || undefined, spanId: ev.spanId || undefined, attributes: attrs({ 'event.code': ev.eventCode, 'service.name': ev.service, component: ev.component, 'deployment.environment': ev.environment, 'service.version': ev.appVersion,
      'organization.id': ev.organizationId, 'development.id': ev.developmentId, 'request.id': ev.requestId, 'correlation.id': ev.correlationId, 'route.code': ev.routeCode, 'error.code': ev.errorCode }) });
  const toOtlpSpan = s => ({ traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId || undefined, name: s.name, kind: { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 }[s.kind] || 1,
    startTimeUnixNano: String(Date.parse(s.startTime) * 1e6), endTimeUnixNano: s.endTime ? String(Date.parse(s.endTime) * 1e6) : undefined, status: { code: s.status === 'ERROR' ? 2 : s.status === 'OK' ? 1 : 0 },
    attributes: attrs({ ...s.attributes, 'error.code': s.errorCode, 'correlation.id': s.correlationId }), links: (s.links || []).map(l => ({ traceId: l.traceId, spanId: l.spanId })) });

  // ---------------------------------------------------------------- ObservabilityRegistry validation (§311–316: the CI checks)
  /** validateRegistry(reg) → { ok, errors[], warnings[] } — duplicate/forbidden labels, owners, runbooks, PII keys, naming.
      Runs on the browser copy (default) and, in CI, on the full registry docs/OBSERVABILITY_REGISTRY.json (scope FULL). */
  function validateRegistry(reg = C.registry()) {
    const errors = [], warnings = [], E = (code, ref, msg) => errors.push({ code, ref, message: msg }), W = (code, ref, msg) => warnings.push({ code, ref, message: msg });
    const forb = (reg.forbiddenLabels || []).map(x => x.toLowerCase()), rbs = reg.runbooks || {}, piiKey = k => C.isBlockedKey(k, C.redactionPolicy()) && !['name'].includes(k);
    const metrics = reg.metrics || {}, names = new Set();
    for (const [k, m] of Object.entries(metrics)) {
      if (k !== m.name) E('METRIC_NAME_MISMATCH', k, 'chave ≠ name');
      if (names.has(m.name)) E('DUPLICATE_METRIC', k, 'nome duplicado'); names.add(m.name);
      if (!/^[a-z][a-z0-9_]*$/.test(m.name)) E('METRIC_NAMING', k, 'use snake_case');
      if (m.type === 'COUNTER' && !/_total$/.test(m.name)) E('COUNTER_SUFFIX', k, 'contador termina em _total');
      if (m.type === 'HISTOGRAM' && !/_(ms|bytes|cls)$/.test(m.name)) W('HISTOGRAM_UNIT_SUFFIX', k, 'histograma sem unidade no nome');
      if (!['COUNTER', 'GAUGE', 'HISTOGRAM'].includes(m.type)) E('METRIC_TYPE', k, 'tipo inválido');
      if (!m.owner) E('MISSING_OWNER', k, 'métrica sem dono'); if (!m.description && reg.scope !== 'BROWSER') E('MISSING_DESCRIPTION', k, 'métrica sem descrição');
      for (const l of m.allowedLabels || []) { if (forb.includes(l.toLowerCase())) E('FORBIDDEN_LABEL', k, `label proibido ${l}`); if (piiKey(l)) E('PII_LABEL', k, `label com cara de PII ${l}`); if (!(reg.labelValues || {})[l] && !(reg.labelPatterns || {})[l]) E('UNCONTROLLED_LABEL', k, `label ${l} sem vocabulário controlado`); }
    }
    for (const [k, a] of Object.entries(reg.alerts || {})) {
      if (!a.owner) E('ALERT_WITHOUT_OWNER', k, 'alerta sem dono');
      if (['HIGH', 'CRITICAL'].includes(a.severity) && !rbs[a.runbookRef]) E('ALERT_WITHOUT_RUNBOOK', k, 'HIGH/CRITICAL sem runbook');
      if (a.runbookRef && !rbs[a.runbookRef]) E('UNKNOWN_RUNBOOK', k, a.runbookRef);
      if (!['INFO', 'WARNING', 'HIGH', 'CRITICAL'].includes(a.severity)) E('ALERT_SEVERITY', k, a.severity);
      if (!(a.cooldownSeconds > 0)) E('ALERT_COOLDOWN', k, 'sem cooldown');
      if (a.owner === 'seguranca' && a.severity === 'CRITICAL' && a.silencePolicy !== 'NEVER_AUTO_SILENCE') E('SECURITY_AUTO_SILENCE', k, 'security critical não pode ser silenciado automaticamente');
      const m0 = String(a.metricOrQuery || '').match(/^[a-z_]+/); if (m0 && !metrics[m0[0]] && !['availability_feed_last_update'].includes(m0[0])) E('ALERT_UNKNOWN_METRIC', k, m0[0]);
    }
    for (const [k, s] of Object.entries(reg.spans || {})) {
      if (!s.owner) E('SPAN_WITHOUT_OWNER', k, 'span sem dono');
      for (const at of [...(s.allowedAttributes || []), ...(s.highCardinalityAttributesAllowed || [])]) if (piiKey(at.replace(/\./g, '_'))) E('PII_SPAN_ATTRIBUTE', k, at);
    }
    for (const [k, s] of Object.entries(reg.slos || {})) { if (!s.owner) E('SLO_WITHOUT_OWNER', k, ''); if (!(s.target > 0 && s.target < 1)) E('SLO_TARGET', k, 'meta entre 0 e 1'); }
    for (const [k, e] of Object.entries(reg.errors || {})) { if (!(reg.userMessages || {})[e.userSafeMessageKey]) E('ERROR_WITHOUT_USER_MESSAGE', k, e.userSafeMessageKey); if (!/^[A-Z][A-Z0-9_]+$/.test(k)) E('ERROR_CODE_FORMAT', k, ''); }
    for (const [k, e] of Object.entries(reg.logEvents || {})) if (!C.LEVELS.includes(e.level)) E('LOG_EVENT_LEVEL', k, e.level);
    const crit = ['MapRenderer', 'QuickView', 'Comparison', 'PresentationRuntime', 'SharedRuntime'];
    for (const area of crit) if (!(reg.errorBoundaries || []).includes(area)) E('CRITICAL_COMPONENT_WITHOUT_BOUNDARY', area, '');
    for (const need of ['map_interactive_duration_ms', 'quickview_load_duration_ms', 'frontend_errors_total', 'cache_corruption_total', 'offline_sync_failure_total', ...(reg.scope === 'BROWSER' ? [] : ['api_request_duration_ms', 'jobs_failed_total'])])
      if (!metrics[need]) E('CRITICAL_COMPONENT_WITHOUT_METRIC', need, '');
    return { ok: !errors.length, errors, warnings };
  }

  // ---------------------------------------------------------------- the provider of this tab (singleton) — ObservabilityProvider { logger, metrics, tracer, errors }
  let P = null, uninstall = null, perf = null, alertState = { last: {} }, changes = null;
  function provider(o = {}) {
    if (P && !o.fresh) return P;
    const metrics = S.createMetrics();
    const sinks = [];
    const logger = C.createLogger({ service: (C.policy().service) || 'web-panel', sinks, now: o.now, environment: o.environment });
    const errors = C.createErrorReporter({ logger, metrics, now: o.now });
    const tracer = S.createTracer({ now: o.now, sampling: o.sampling, random: o.random });
    changes = C.createBuffer((C.policy().buffers || {}).changeEvents || 50, () => 0);
    P = Object.freeze({ logger, metrics, tracer, errors, remote: createRemoteSink() });
    return P;
  }
  /** install(win) — global error handlers + Web Vitals observers (idempotent); returns the provider */
  function install(win = typeof window !== 'undefined' ? window : null, o = {}) {
    const p = provider(o);
    if (!uninstall && win && typeof win.addEventListener === 'function') {
      uninstall = C.installGlobalHandlers(win, p.errors);
      perf = S.createPerfCollector({ metrics: p.metrics }); perf.start();
      safe(() => win.addEventListener('visibilitychange', () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') perf.flush(); }));
    }
    return p;
  }
  const installed = () => !!uninstall;

  // ---------------------------------------------------------------- report(e, component) — drop-in for `console.error(e)` (legacy migration)
  /** report(error, component, ctx) → { supportCode, userMessage, … }; console only in development (already redacted) */
  function report(error, component = 'Global', ctx = {}) { return safe(() => provider().errors.capture(error, { ...ctx, component })); }
  const guard = (area, fn, fallback) => C.boundary(area, fn, { reporter: provider().errors, metrics: provider().metrics, logger: provider().logger, fallback });

  // ---------------------------------------------------------------- instrumentation helpers (call sites in app.js/map.js; all non-blocking)
  const ctxLabels = () => { const c = C.defaultContext(); return { device_class: c.deviceClass || 'UNKNOWN', route_code: c.routeCode || 'OTHER' }; };
  const rendererOf = d => (['SVG', 'CANVAS', 'WEBGL'].includes(d && d.rendererType) ? d.rendererType : 'SVG');
  const instrument = Object.freeze({
    /** appBoot(ms, { loadOrigin }) — shell ready */
    appBoot(ms, x = {}) { const p = provider(), l = ctxLabels(); p.metrics.observe('route_boot_duration_ms', l, ms); p.logger.info('APP_BOOT_COMPLETED', 'painel pronto', { durationMs: Math.round(ms), loadOrigin: x.loadOrigin || null }); },
    routeReady(routeCode, ms) { const p = provider(); p.metrics.observe('route_boot_duration_ms', { route_code: routeCode, device_class: ctxLabels().device_class }, ms); p.logger.debug('ROUTE_READY', 'rota pronta', { routeCode, durationMs: Math.round(ms) }); },
    /** mapReady(diagnostics, { sinceNavigationMs }) — call once when the map becomes interactive; map_interactive = ms since navigation
        start (performance.now() by default); first render / geometry come from geo/perf.js diagnostics (not re-measured) */
    mapReady(d, x = {}) { if (!d) return; const p = provider(), l = { device_class: ctxLabels().device_class, renderer_type: rendererOf(d) };
      const since = x.sinceNavigationMs != null ? x.sinceNavigationMs : safe(() => (typeof performance !== 'undefined' ? performance.now() : null));
      if (since != null) p.metrics.observe('map_interactive_duration_ms', l, since); if (d.firstRenderMs != null) p.metrics.observe('map_first_render_duration_ms', l, d.firstRenderMs); if (d.geometryLoadMs != null) p.metrics.observe('map_geometry_load_duration_ms', l, d.geometryLoadMs);
      p.logger.info('MAP_INTERACTIVE', 'mapa interativo', { readiness: d.readiness || null, initMs: d.initMs ?? null, featureCount: d.featureCount || null }); },
    layerSwitch(ms, d) { provider().metrics.observe('map_layer_switch_duration_ms', { device_class: ctxLabels().device_class, renderer_type: rendererOf(d) }, ms); },
    /** quickView(ms, { error, staleDiscarded }) */
    quickView(ms, x = {}) { const p = provider(); if (x.staleDiscarded) return p.metrics.counter('quickview_stale_discard_total', {});
      if (x.error) { const n = C.normalizeError(x.error, { withStack: false }); p.metrics.counter('quickview_error_total', { error_category: n.category }); return report(x.error, 'QuickView'); }
      if (ms != null) p.metrics.observe('quickview_load_duration_ms', { device_class: ctxLabels().device_class }, ms); },
    resource(type, ms, x = {}) { const p = provider(); if (x.error) { const n = C.normalizeError(x.error, { withStack: false }); p.metrics.counter('resource_load_failures_total', { resource_type: type, error_category: n.category }); p.logger.warn('RESOURCE_LOAD_FAILED', 'recurso não carregou', { resourceType: type, errorCode: n.code }); } else if (ms != null) p.metrics.observe('resource_load_duration_ms', { resource_type: type }, ms); },
    /** loadingSnapshot(diagnostics) / cacheSnapshot(inspect) — gauges from topics 47/48 (no re-measuring) */
    loadingSnapshot(d) { const s = S.fromLoadingDiagnostics(d), p = provider(); if (!s.available) return s; if (s.prefetchHitRate != null) p.metrics.gauge('prefetch_hit_rate', {}, s.prefetchHitRate); if (s.prefetchWasteRate != null) p.metrics.gauge('prefetch_waste_rate', {}, s.prefetchWasteRate); return s; },
    cacheSnapshot(d) { const s = S.fromCacheInspect(d), p = provider(); if (!s.available) return s; if (s.memoryEntries != null) p.metrics.gauge('cache_entries', { storage_tier: 'MEMORY' }, s.memoryEntries); if (s.persistentEntries != null) p.metrics.gauge('cache_entries', { storage_tier: 'INDEXED_DB' }, s.persistentEntries); return s; },
    cacheCorruption(type) { const p = provider(); p.metrics.counter('cache_corruption_total', { resource_type: type }); p.logger.warn('CACHE_CORRUPT_ENTRY', 'entrada corrompida removida', { resourceType: type, errorCode: 'CACHE_CORRUPT_ENTRY' }); },
    connectivity(state) { const s = S.connectivity(state), p = provider(); p.metrics.counter('connectivity_changes_total', { connectivity_state: s.state }); p.logger.info('CONNECTIVITY_CHANGED', 'conectividade mudou', { state: s.state }); return s; },
    sw(event) { const p = provider(); p.metrics.counter('sw_lifecycle_total', { sw_event: event }); p.logger.info('SW_STATE_CHANGED', 'service worker', { event }); },
    syncResult(x = {}) { const p = provider(); if (x.pending != null) p.metrics.gauge('offline_sync_pending', {}, x.pending); if (x.failed) { p.metrics.counter('offline_sync_failure_total', {}); p.logger.warn('PWA_SYNC_FAILED', 'sincronização falhou', { errorCode: 'PWA_SYNC_FAILED' }); } if (x.conflict) { p.metrics.counter('offline_sync_conflict_total', {}); p.logger.warn('PWA_SYNC_CONFLICT', 'conflito de sincronização', { errorCode: 'PWA_SYNC_CONFLICT' }); } },
    /** shareDenied(reasonCategory) — never the token, never the URL */
    shareDenied(reason) { const p = provider(), r = ['EXPIRED', 'REVOKED', 'INVALID', 'NOT_FOUND', 'RATE_LIMITED'].includes(reason) ? reason : 'OTHER'; p.metrics.counter('share_access_denied_total', { reason_category: r }); p.logger.info('SHARE_ACCESS_DENIED', 'acesso a link negado', { reasonCategory: r }); },
    /** security(type, { permissionKey }) — aggregated category only (topic 50 owns the SecurityEvent) */
    security(type, x = {}) { const p = provider();
      if (type === 'AUTHZ_DENIED') p.metrics.counter('authorization_denied_total', { permission_group: String(x.permissionKey || 'unknown').split('.')[0].toLowerCase().replace(/[^a-z_]/g, '') || 'unknown' });
      else if (type === 'TENANT_SCOPE_VIOLATION') p.metrics.counter('tenant_scope_violation_total', {});
      else if (type === 'TENANT_CONTEXT_MISSING') p.metrics.counter('tenant_context_missing_total', {});
      p.logger.info('SECURITY_SIGNAL_AGGREGATED', 'sinal de segurança agregado', { type: String(type).slice(0, 40) }); },
    versionMismatch(type) { provider().metrics.counter('version_mismatch_total', { resource_type: type }); }
  });

  // ---------------------------------------------------------------- OperationalChangeEvent (§188–190): release, config, flag, price/analysis activation
  function recordChange(eventType, x = {}, o = {}) {
    provider();
    const ev = Object.freeze({ eventType: String(eventType).toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 40), occurredAt: new Date(nowMs(o)).toISOString(), environment: C.environment(o), versionRef: x.versionRef ? String(x.versionRef).slice(0, 64) : null,
      correlationId: x.correlationId || null, metadata: C.redact(x.metadata || {}).value });
    changes.push(ev); provider().logger.info('OPERATIONAL_CHANGE', `mudança operacional ${ev.eventType}`, { eventType: ev.eventType, versionRef: ev.versionRef });
    return ev;
  }
  /** setRelease(r) — release marker; records a DEPLOYMENT change when the version changes */
  function setRelease(r = {}) { const before = C.release().appVersion, now = C.setRelease(r); if (now.appVersion && now.appVersion !== before) recordChange('DEPLOYMENT', { versionRef: now.appVersion, metadata: { buildId: now.buildId } }); return now; }

  // ---------------------------------------------------------------- SupportDiagnosticSnapshot (§158–160, §264–269)
  /** inputs (all optional, from app.js devInfo()): { devInfo, lotCount, mapDiagnostics, loadingDiagnostics, cacheInspect } */
  function supportSnapshot(x = {}, o = {}) {
    const p = provider(), c = C.defaultContext(), di = x.devInfo || {}, v = di.versions || {};
    const nav = typeof navigator !== 'undefined' ? navigator : null, ua = (nav && nav.userAgent) || '';
    const browserClass = /Edg\//.test(ua) ? 'EDGE' : /Chrome\//.test(ua) ? 'CHROMIUM' : /Firefox\//.test(ua) ? 'FIREFOX' : /Safari\//.test(ua) ? 'SAFARI' : 'UNKNOWN';
    const warnings = [];
    const fr = S.freshnessSignals({ freshnessState: di.freshness, versions: v }, o);
    if (fr.AVAILABILITY.status === 'UNKNOWN') warnings.push('Disponibilidade não confirmada (status desconhecido).');
    if (di.origin && di.origin !== 'REMOTE') warnings.push('Dados servidos da cópia deste aparelho ou embutida.');
    if (di.connectivity && String(di.connectivity).toUpperCase() !== 'ONLINE') warnings.push('Sem conexão confirmada.');
    const snap = { generatedAt: new Date(nowMs(o)).toISOString(), environment: c.environment, appVersion: c.appVersion, buildId: c.buildId || null, organizationId: c.organizationId || null, developmentId: c.developmentId || null,
      routeCode: c.routeCode, browserClass, deviceClass: c.deviceClass,
      activeVersions: Object.fromEntries(Object.entries({ staticDataVersion: v.staticDataVersion, analysisVersion: v.analysisVersion, priceTableVersion: v.priceTableVersion, availabilityRevision: v.availabilityRevision ?? v.revision, swVersion: di.sw && di.sw.version }).filter(([, x2]) => x2 != null).map(([k, x2]) => [k, String(x2).slice(0, 40)])),
      cacheSummary: { ...S.fromCacheInspect(x.cacheInspect), backend: di.backend || null, usageBytes: di.estimate && di.estimate.usage != null ? di.estimate.usage : null, quotaBytes: di.estimate && di.estimate.quota != null ? di.estimate.quota : null },
      pwaSummary: { swRegistered: di.sw ? !!di.sw.registered : null, offlineReady: di.offlineReady ?? null, connectivity: S.connectivity(di.connectivity).state, pendingSync: di.sync && di.sync.pending != null ? di.sync.pending : null, dataOrigin: di.origin || null },
      freshness: { availability: fr.AVAILABILITY.status, pricing: fr.PRICING.status },
      map: (({ available, readiness, initMs, firstRenderMs, rendererType }) => ({ available, readiness, initMs, firstRenderMs, rendererType }))(S.fromMapDiagnostics(x.mapDiagnostics)),
      recentErrorRefs: p.errors.groups().slice(0, 10).map(g => `${g.code}·${g.component}·${g.fingerprint}·${C.supportCode(g.lastErrorId)}×${g.count}`),
      telemetry: { logs: p.logger.size(), droppedLogs: p.logger.dropped(), recursiveDropped: C.telemetry.recursiveDropped, remoteSink: 'OFF' },
      warnings };
    p.logger.info('DIAGNOSTIC_SNAPSHOT_GENERATED', 'diagnóstico técnico gerado', { routeCode: snap.routeCode });
    return Object.freeze(C.redact(snap, { policy: { maxObjectDepth: 6 } }).value);
  }
  /** diagnosticText(x) → text for "Copiar diagnóstico técnico" (sanitized JSON; no token, no URL, no customer) */
  const diagnosticText = (x = {}, o = {}) => 'Diagnóstico técnico — painel Viva Juara (sem dados de clientes)\n' + JSON.stringify(supportSnapshot(x, o), null, 1);

  // ---------------------------------------------------------------- "Saúde da plataforma" (technical mode)
  const ACTS = Object.freeze({ refresh: 'obsRefresh', copy: 'obsCopyDiagnostic', clear: 'obsClear' });
  const fmtMs = v => (v == null ? DL.NOT_AVAILABLE : v >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} s` : `${Math.round(v)} ms`);
  const fmtAge = ms => (ms == null ? DL.NOT_AVAILABLE : ms < 3600000 ? `${Math.round(ms / 60000)} min` : ms < 172800000 ? `${Math.round(ms / 3600000)} h` : `${Math.round(ms / 86400000)} dias`);
  const ST = { OK: 'ok', DEGRADED: 'degradado', DOWN: 'fora do ar', UNKNOWN: DL.NOT_AVAILABLE, FRESH: 'atual', STALE: 'desatualizado', EXPIRED: 'vencido', VERSIONED: 'versionado', MEETING: 'dentro da meta', BREACHING: 'fora da meta', INSUFFICIENT_DATA: DL.NOT_AVAILABLE, FIRING: 'disparado', FIRING_COOLDOWN: 'disparado (em espera)', NO_DATA: DL.NOT_AVAILABLE, NEEDS_DECISION: DL.NEEDS_CONFIRMATION };
  /** setAccessCheck(fn) — composition root injects the technical-mode decision (App.authz); never read here directly */
  let accessCheck = null;
  const setAccessCheck = fn => { accessCheck = typeof fn === 'function' ? fn : null; return !!accessCheck; };
  /** viewModel(x) — x as in supportSnapshot; allowed only in technical mode (mode.technical) */
  function viewModel(x = {}, o = {}) {
    const allowed = x.allowed != null ? !!x.allowed : safe(() => !!(accessCheck && accessCheck()), false); // deny by default until the composition root injects the check (GAP-ARCH-24)
    if (!allowed) return { allowed: false, message: 'Disponível apenas no modo Técnico.' };
    const p = provider(), di = x.devInfo || {}, m = p.metrics;
    const fr = S.freshnessSignals({ freshnessState: di.freshness, versions: di.versions }, o);
    const map = S.fromMapDiagnostics(x.mapDiagnostics), nt = S.navigationTiming(o.performance), vit = perf ? perf.vitals() : { lcpMs: null, cls: null, inpMs: null, longTasks: 0, longTaskMaxMs: null };
    const ready = S.readiness({ lotCount: x.lotCount ?? null, mapReadiness: map.readiness || (map.available ? 'INTERACTIVE' : null), configOk: !!(App.configs && App.configs.observability) });
    const deps = S.dependencies({ dataOrigin: di.origin ?? null, backend: di.backend ?? null, swRegistered: di.sw ? !!di.sw.registered : null, persistentDegraded: x.cacheInspect ? !!x.cacheInspect.persistentDegraded : null });
    const conn = S.connectivity(di.connectivity);
    const reg = C.registry(), slos = Object.values(reg.slos || {}).map(s => {
      const h = s.histogram ? m.summary(s.histogram) : null;
      return { ...S.evaluateSlo(s, { good: null, total: h ? h.n : null }), sli: s.sli, service: s.service };
    });
    const alerts = S.evaluateLocalAlerts({ metrics: m, freshness: fr }, alertState, o);
    const val = r => ({ ...r, stateText: ST[r.state] || r.state });
    const v = reg.validation || validateRegistry(reg);
    return {
      allowed: true, title: 'Saúde da plataforma', acts: ACTS,
      banner: 'Diagnóstico técnico deste aparelho. Nada é enviado: logs, erros e medições ficam só nesta aba e somem ao fechar. Não substitui o monitoramento do servidor.',
      context: (({ environment, appVersion, buildId, routeCode, deviceClass }) => ({ environment, appVersion, buildId: buildId || DL.NOT_AVAILABLE, routeCode, deviceClass }))(C.defaultContext()),
      health: [ { id: 'LIVE', label: 'Painel em execução', status: 'OK', statusText: ST.OK },
        { id: 'READY', label: 'Pronto para uso', status: ready.status, statusText: ST[ready.status], detail: ready.checks.map(c => c.label).join(' · ') },
        { id: 'CONNECTIVITY', label: 'Conectividade', status: conn.status, statusText: { ONLINE: 'online', OFFLINE: 'offline', DEGRADED: 'instável', UNKNOWN: DL.NOT_AVAILABLE }[conn.state] },
        ...deps.map(d => ({ id: d.id, label: d.label, status: d.status, statusText: ST[d.status] })) ],
      freshness: ['AVAILABILITY', 'PRICING', 'ANALYSIS'].map(k => { const f = fr[k]; return { channel: { AVAILABILITY: 'Disponibilidade', PRICING: 'Preço (tabela)', ANALYSIS: 'Análise' }[k], status: f.status, statusText: f.status === 'UNKNOWN' ? 'não confirmado' : (ST[f.status] || f.status), age: k === 'ANALYSIS' ? (f.version ? `versão ${f.version}` : DL.NOT_AVAILABLE) : fmtAge(f.ageMs), ageLabel: f.label, limit: f.expectedMaxAgeMs == null ? DL.NEEDS_CONFIRMATION : fmtAge(f.expectedMaxAgeMs) }; }),
      performance: [
        { name: 'Resposta do servidor (TTFB)', value: fmtMs(nt.ttfbMs), label: nt.ttfbMs == null ? DL.NOT_AVAILABLE : DL.CONFIRMED },
        { name: 'Página carregada (DOMContentLoaded)', value: fmtMs(nt.domContentLoadedMs), label: nt.domContentLoadedMs == null ? DL.NOT_AVAILABLE : DL.CONFIRMED },
        (s => ({ name: 'Mapa interativo (desde a abertura)', value: s.n ? fmtMs(s.p50) : DL.NOT_AVAILABLE, label: s.n ? `${DL.CALCULATED}, ${s.n} medição(ões)` : DL.NOT_AVAILABLE }))(m.summary('map_interactive_duration_ms')),
        { name: 'Montagem do mapa', value: fmtMs(map.initMs), label: map.initMs == null ? DL.NOT_AVAILABLE : DL.CALCULATED },
        { name: 'Primeiro desenho do mapa', value: fmtMs(map.firstRenderMs), label: map.firstRenderMs == null ? DL.NOT_AVAILABLE : DL.CALCULATED },
        { name: 'Troca de camada (p95)', value: map.layerSwitch ? fmtMs(map.layerSwitch.p95) : DL.NOT_AVAILABLE, label: map.layerSwitch ? `${DL.CALCULATED}, ${map.layerSwitch.n} medições` : DL.NOT_AVAILABLE },
        { name: 'Clique no mapa (p95)', value: map.hitTest ? fmtMs(map.hitTest.p95) : DL.NOT_AVAILABLE, label: map.hitTest ? `${DL.CALCULATED}, ${map.hitTest.n} medições` : DL.NOT_AVAILABLE },
        { name: 'QuickView (p95)', value: (s => s.p95 != null ? fmtMs(s.p95) : s.n ? `${fmtMs(s.p50)} (p50)` : DL.NOT_AVAILABLE)(m.summary('quickview_load_duration_ms')), label: m.summary('quickview_load_duration_ms').n ? `${DL.CALCULATED}, ${m.summary('quickview_load_duration_ms').n} medições` : DL.NOT_AVAILABLE },
        { name: 'LCP (maior conteúdo visível)', value: fmtMs(vit.lcpMs), label: vit.lcpMs == null ? DL.NOT_AVAILABLE : DL.CONFIRMED },
        { name: 'INP (resposta à interação)', value: fmtMs(vit.inpMs), label: vit.inpMs == null ? DL.NOT_AVAILABLE : DL.ESTIMATED },
        { name: 'CLS (deslocamento de layout)', value: vit.cls == null ? DL.NOT_AVAILABLE : String(vit.cls).replace('.', ','), label: vit.cls == null ? DL.NOT_AVAILABLE : DL.CONFIRMED },
        { name: 'Tarefas longas', value: vit.longTaskMaxMs == null ? DL.NOT_AVAILABLE : `${vit.longTasks} (maior ${fmtMs(vit.longTaskMaxMs)})`, label: vit.longTaskMaxMs == null ? DL.NOT_AVAILABLE : DL.CONFIRMED } ],
      loading: S.fromLoadingDiagnostics(x.loadingDiagnostics), cache: S.fromCacheInspect(x.cacheInspect),
      errors: p.errors.groups().slice(0, 10).map(g => ({ code: g.code, category: g.category, component: g.component, count: g.count, lastSeen: g.lastSeen, supportCode: C.supportCode(g.lastErrorId), release: g.release || DL.NOT_AVAILABLE })),
      alerts: alerts.map(val), slos: slos.map(s => ({ ...s, statusText: ST[s.status] || s.status })),
      telemetry: { logs: p.logger.size(), droppedLogs: p.logger.dropped(), errorGroups: p.errors.groups().length, spans: p.tracer.stats().kept, metricSeries: m.seriesCount(), rejectedSeries: Object.values(m.rejected()).reduce((a, b) => a + b, 0), recursiveDropped: C.telemetry.recursiveDropped, sinks: sinkStatus() },
      registry: { metrics: Object.keys(reg.metrics || {}).length, spans: Object.keys(reg.spans || {}).length, errors: Object.keys(reg.errors || {}).length, alerts: Object.keys(reg.alerts || {}).length, slos: Object.keys(reg.slos || {}).length, valid: v.ok, problems: v.errors.length },
      changes: changes ? changes.list().slice(-5).reverse().map(c => ({ eventType: c.eventType, occurredAt: c.occurredAt, versionRef: c.versionRef })) : [],
      decisions: ((C.policy().decisions) || []).map(d => ({ id: d.id, title: d.title, current: d.current, needs: d.needs }))
    };
  }
  const btn = (act, label) => `<button class="btn" data-act="${esc(act)}">${esc(label)}</button>`;
  const tbl = (caption, head, rows) => `<table class="am-t"><caption>${esc(caption)}</caption><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
  /** html(vm) → markup (reuses the "Métricas locais" classes am, am-t, am-bar, am-d; no new CSS required) */
  function html(vm) {
    if (!vm || !vm.allowed) return `<section class="am obs" aria-label="Saúde da plataforma"><h3>Saúde da plataforma</h3><p class="small">${esc(vm && vm.message || 'Indisponível.')}</p></section>`;
    const f = vm.telemetry;
    return `<section class="am obs" aria-label="Saúde da plataforma">
<h3>${esc(vm.title)}</h3><p class="am-banner">${esc(vm.banner)}</p>
<div class="am-bar">${btn(vm.acts.refresh, 'Atualizar')}${btn(vm.acts.copy, 'Copiar diagnóstico técnico')}</div>
<p class="small">Ambiente ${esc(vm.context.environment)} · versão ${esc(vm.context.appVersion)} · build ${esc(vm.context.buildId)} · tela ${esc(vm.context.routeCode)} · ${esc(vm.context.deviceClass)}</p>
${tbl('Estado agora', ['Verificação', 'Situação', 'Detalhe'], vm.health.map(h => [h.label, h.statusText, h.detail || '']))}
${tbl('Atualidade dos dados (não é a validade do cache)', ['Canal', 'Situação', 'Última confirmação', 'Limite esperado'], vm.freshness.map(r => [r.channel, r.statusText, r.age, r.limit]))}
${tbl('Desempenho neste aparelho', ['Medida', 'Valor', 'Origem'], vm.performance.map(r => [r.name, r.value, r.label]))}
${vm.errors.length ? tbl('Erros agrupados (sem mensagens de usuário)', ['Código', 'Área', 'Ocorrências', 'Código de suporte', 'Última vez'], vm.errors.map(e => [e.code, e.component, e.count, e.supportCode, e.lastSeen])) : '<p class="small">Nenhum erro capturado nesta aba.</p>'}
${tbl('Alertas operacionais (avaliados só aqui, sem envio)', ['Alerta', 'Gravidade', 'Situação', 'Runbook'], vm.alerts.map(a => [a.alertId, a.severity, a.stateText, a.runbookRef]))}
<details class="am-d"><summary>Objetivos de nível de serviço (propostos)</summary>${tbl('SLOs — metas a confirmar com o negócio', ['SLO', 'Indicador', 'Meta', 'Situação'], vm.slos.map(s => [s.sloId, s.sli, `${(s.target * 100).toFixed(1).replace('.', ',')}% (${s.targetLabel})`, s.statusText]))}</details>
<details class="am-d"><summary>Telemetria local</summary>${tbl('Buffers desta aba', ['Item', 'Valor'], [['Logs no buffer', f.logs], ['Logs descartados (baixa prioridade)', f.droppedLogs], ['Grupos de erro', f.errorGroups], ['Spans guardados', f.spans], ['Séries de métrica', f.metricSeries], ['Séries recusadas (cardinalidade/labels)', f.rejectedSeries], ['Capturas recursivas evitadas', f.recursiveDropped]])}${tbl('Destinos', ['Destino', 'Situação'], f.sinks.map(s => [s.kind, s.enabled === true ? 'ligado (memória)' : s.enabled === false ? 'desligado' : 'só em desenvolvimento']))}<p class="small">Registro: ${esc(vm.registry.metrics)} métricas, ${esc(vm.registry.spans)} spans, ${esc(vm.registry.errors)} códigos de erro, ${esc(vm.registry.alerts)} alertas, ${esc(vm.registry.slos)} SLOs · ${vm.registry.valid ? 'válido' : esc(vm.registry.problems) + ' problema(s)'}.</p></details>
${vm.changes.length ? `<details class="am-d"><summary>Mudanças operacionais</summary>${tbl('Linha do tempo', ['Tipo', 'Quando', 'Versão'], vm.changes.map(c => [c.eventType, c.occurredAt, c.versionRef || '—']))}</details>` : ''}
<details class="am-d"><summary>Decisões em aberto (${esc(vm.decisions.length)})</summary><ul>${vm.decisions.map(d => `<li><b>${esc(d.id)} · ${esc(d.title)}</b> — ${esc(d.current)} <i>${esc(d.needs)}</i></li>`).join('')}</ul></details>
<div class="am-bar">${btn(vm.acts.clear, 'Limpar diagnóstico desta aba')}</div>
</section>`;
  }
  /** clear() — empties logs, error groups, spans and metrics of this tab (the "Limpar" button) */
  function clear() { if (!P) return; P.logger.clear(); P.errors.clear(); P.tracer.clear(); P.metrics.clear(); if (changes) changes.clear(); alertState = { last: {} }; }
  /** reset() — test helper: drops the singleton (does not uninstall browser listeners) */
  function reset() { P = null; alertState = { last: {} }; changes = null; }

  // browser: install once at load (listeners only); Node/vm harness has no addEventListener → no-op
  safe(() => { if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function' && typeof document !== 'undefined') install(window); });

  return Object.freeze({ setAccessCheck, SinkKind, createRemoteSink, sinkStatus, toOtlpLog, toOtlpSpan, validateRegistry, provider, install, installed, report, guard, instrument, recordChange, setRelease,
    supportSnapshot, diagnosticText, ACTS, viewModel, html, clear, reset });
})();
