'use strict';
// Topic 51 — platform observability. Golden scenarios named after the spec (§310), plus "no PII in telemetry" (§303–305).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, C, S, P, repo;
const FULL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'OBSERVABILITY_REGISTRY.json'), 'utf8'));
const DEV = 'viva-juara';
const loadObs = A => { for (const f of ['observability/obsCore.js', 'observability/obsSignals.js', 'observability/obsPlatform.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(A); };
test.before(async () => {
  App = load(); loadObs(App);
  C = App.observability.core; S = App.observability.signals; P = App.observability.platform;
  repo = App.repos.LotRepository(DEV); await repo.load();
});
const fresh = (o = {}) => { P.reset(); return P.provider({ fresh: true, ...o }); };
const plain = x => JSON.parse(JSON.stringify(x ?? null));
// a customer-shaped fixture full of things that must never reach a log, metric, trace or snapshot
const PII = { name: 'Maria Souza Lima', email: 'maria.souza@example.com', phone: '(47) 99876-5432', cpf: '123.456.789-09', token: 'shr_9f8e7d6c5b4a39281706f5e4d3c2b1a0', note: 'cliente quer pagar à vista',
  bearer: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc', shareUrl: 'https://painel.example.com/s/AbCdEfGh12345678?token=zzz', password: 'S3nh@Forte!' };
const LEAKS = [/maria/i, /souza/i, /example\.com/i, /99876/, /5432\b/, /123\.456\.789/, /shr_9f8e/, /pagar à vista/, /eyJhbGci/, /AbCdEfGh1234/, /token=zzz/, /S3nh@/];
const assertNoLeak = (obj, where) => { const s = JSON.stringify(obj); for (const re of LEAKS) assert.ok(!re.test(s), `${where} vazou ${re}: ${s.slice(0, 400)}`); };

// ====================================================================== registry and CI validation (§311–316)
test('registry: bundled with the configs and valid for every CI check (owners, runbooks, labels, PII, naming, boundaries)', () => {
  assert.ok(App.configs.observability && App.configs.observability.registry && App.configs.observability.policy, 'configBundle inclui config/observability');
  assert.deepEqual(plain(P.validateRegistry().errors), [], 'cópia do navegador sem erros');
  assert.deepEqual(plain(P.validateRegistry(FULL).errors), [], 'registro completo sem erros');
  assert.equal(C.registry().scope, 'BROWSER'); assert.ok(Object.values(C.registry().metrics).every(m => m.status === 'ACTIVE_LOCAL'), 'o navegador só carrega o que mede');
  for (const k of Object.keys(C.registry().metrics)) assert.ok(FULL.metrics[k], `${k} existe no registro completo`);
  const reg = FULL;
  for (const [k, a] of Object.entries(reg.alerts)) if (['HIGH', 'CRITICAL'].includes(a.severity)) assert.ok(reg.runbooks[a.runbookRef], `${k} tem runbook`);
  for (const m of Object.values(reg.metrics)) { assert.ok(m.owner && m.description, m.name); assert.ok(!m.allowedLabels.some(l => /lot|customer|user|request|trace|token|email/i.test(l)), `${m.name} sem label de alta cardinalidade/PII`); }
  assert.ok(Object.keys(reg.metrics).length >= 80 && Object.keys(reg.spans).length >= 15 && Object.keys(reg.errors).length >= 25);
});
test('registry validation catches: metric without owner, forbidden label, HIGH alert without runbook, PII span attribute, security critical auto-silence', () => {
  const reg = JSON.parse(JSON.stringify(FULL));
  reg.metrics.bad_total = { name: 'bad_total', type: 'COUNTER', allowedLabels: ['lotId'], owner: '', description: 'x', alertable: false };
  reg.alerts.no_rb = { ...reg.alerts.api_5xx_rate_high, alertId: 'no_rb', runbookRef: 'RB-NOPE' };
  reg.spans['x.span'] = { name: 'x.span', owner: 'o', allowedAttributes: ['customer.email'], highCardinalityAttributesAllowed: [] };
  reg.alerts.tenant_scope_violation = { ...reg.alerts.tenant_scope_violation, silencePolicy: 'MAINTENANCE_WINDOW' };
  const codes = P.validateRegistry(reg).errors.map(e => e.code);
  for (const c of ['MISSING_OWNER', 'FORBIDDEN_LABEL', 'ALERT_WITHOUT_RUNBOOK', 'PII_SPAN_ATTRIBUTE', 'SECURITY_AUTO_SILENCE']) assert.ok(codes.includes(c), c);
});

// ====================================================================== ObsLogRedactionAuthorizationHeader + no PII
test('ObsLogRedactionAuthorizationHeader: headers, cookies, tokens, bodies, notes, CPF and URLs never reach the log', () => {
  const p = fresh();
  const ev = p.logger.error('API_REQUEST_FAILED', `falha para ${PII.email} com ${PII.bearer}`, {
    headers: { Authorization: PII.bearer, Cookie: 'sid=abc123', 'Set-Cookie': 'x=1' }, password: PII.password, shareToken: PII.token, csrfToken: 'c', requestBody: { customer: PII }, responseBody: '…',
    url: PII.shareUrl, customerNote: PII.note, cpf: PII.cpf, customerId: 'cus_77', status: 500, errorCode: 'API_SERVER_ERROR', route: 'GET /v1/lots/:id' });
  assertNoLeak(ev, 'log'); assertNoLeak(p.logger.entries(), 'buffer');
  assert.equal(ev.metadata.status, 500); assert.equal(ev.metadata.route, 'GET /v1/lots/:id'); assert.equal(ev.metadata.customerId, '[mascarado]');
  assert.ok(!('headers' in ev.metadata && ev.metadata.headers.Authorization), 'Authorization removido');
  assert.equal(ev.errorCode, 'API_SERVER_ERROR'); assert.equal(ev.eventCode, 'API_REQUEST_FAILED'); assert.equal(ev.registered, true);
  assert.match(ev.message, /\[email\]/); assert.ok(ev.correlationId && ev.correlationId.startsWith('cor_'));
});
test('redaction limits: truncates long strings, deep objects and long arrays; sanitizeUrl drops query/hash and share tokens', () => {
  const r = C.redact({ s: 'lorem ipsum '.repeat(90), a: Array.from({ length: 50 }, (_, i) => i), d: { a: { b: { c: { d: { e: 1 } } } } } });
  assert.ok(r.value.s.length <= 301); assert.equal(r.value.a.length, 21); assert.equal(r.value.d.a.b.c, '[profundidade]'); assert.ok(r.report.truncated >= 3);
  assert.equal(C.sanitizeUrl('https://x.example/s/AbCdEfGh12345678?token=1#lote=3'), '/s/:token');
  assert.equal(C.sanitizeUrl('/v1/lots/VJ-QA-L0001?x=1'), '/v1/lots/VJ-QA-L0001');
});
test('no PII in any telemetry: logs, error groups, spans, metric labels, snapshot, view model and OTLP mapping', () => {
  const p = fresh();
  const e = new Error(`Falhou para ${PII.name} <${PII.email}> tel ${PII.phone} cpf ${PII.cpf} link ${PII.shareUrl}`); e.cause = new Error(`token ${PII.token}`);
  const r = p.errors.capture(e, { component: 'QuickView' });
  p.errors.captureMessage(`nota: ${PII.note} ${PII.email}`, 'LOW', { component: 'CustomerWorkspace' });
  const sp = p.tracer.startSpan('quickview.load', { attributes: { 'lot.id': 'VJ-QA-L0001', email: PII.email, data_state: PII.email, profile: PII.name } }); sp.end();
  assert.equal(p.metrics.counter('frontend_errors_total', { error_category: 'INTERNAL', component: 'QuickView', route_code: PII.email }), true);
  assert.ok(p.metrics.snapshot().some(x => x.labels.route_code === 'OTHER'), 'valor fora do vocabulário vira OTHER');
  assert.equal(p.metrics.counter('cache_hits_total', { resource_type: PII.email }), false, 'valor fora do padrão recusado');
  P.instrument.shareDenied('EXPIRED'); P.instrument.security('AUTHZ_DENIED', { permissionKey: 'customer.read', userId: PII.email });
  const snap = P.supportSnapshot({ devInfo: { versions: repo.getDataVersions(), freshness: repo.getFreshnessState(), connectivity: 'ONLINE', origin: 'BUNDLED', customer: PII, note: PII.note } });
  const vm = P.viewModel({ allowed: true, devInfo: { customer: PII } });
  for (const [where, x] of [['logs', p.logger.entries()], ['groups', p.errors.groups()], ['spans', p.tracer.spans()], ['metrics', p.metrics.snapshot()], ['snapshot', snap], ['vm', vm], ['html', P.html(vm)], ['otlp', p.logger.entries().map(P.toOtlpLog)], ['otlpSpan', p.tracer.spans().map(P.toOtlpSpan)], ['capture', r]])
    assertNoLeak(x, where);
  assert.equal(p.tracer.spans()[0].attributes['lot.id'], 'VJ-QA-L0001', 'lot.id é permitido em trace (alta cardinalidade só em trace/log)');
  assert.ok(!('email' in p.tracer.spans()[0].attributes));
});

// ====================================================================== ids, context, propagation (§14–20)
test('ObsCorrelationIdPropagation: requestId ≠ correlationId ≠ traceId; correlation crosses requests; traceparent only to approved origins', () => {
  const base = C.defaultContext(), r1 = C.requestContext(base), r2 = C.requestContext(base);
  assert.match(r1.requestId, /^req_[0-9a-f]{16}$/); assert.notEqual(r1.requestId, r2.requestId); assert.equal(r1.correlationId, r2.correlationId); assert.equal(r1.correlationId, base.correlationId);
  const tp = C.traceparent({ traceId: C.newTraceId(), spanId: C.newSpanId() }), parsed = C.parseTraceparent(tp);
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/); assert.ok(parsed && parsed.sampled);
  assert.equal(C.parseTraceparent('00-' + '0'.repeat(32) + '-' + '1'.repeat(16) + '-01'), null); assert.equal(C.parseTraceparent('garbage'), null);
  const ctx = { ...r1, traceId: parsed.traceId, spanId: C.newSpanId() };
  assert.deepEqual(Object.keys(C.headersFor(ctx, '/v1/lots')).sort(), ['traceparent', 'x-correlation-id', 'x-request-id']);
  assert.deepEqual(plain(C.headersFor(ctx, 'https://www.google-analytics.com/collect')), {}, 'nunca para terceiros');
  assert.deepEqual(plain(C.headersFor(ctx, 'https://api.vivajuara.example/v1', { selfOrigin: 'https://painel.vivajuara.example' })), {});
  assert.ok(C.headersFor(ctx, 'https://api.vivajuara.example/v1', { approvedOrigins: ['https://api.vivajuara.example'] }).traceparent);
  assert.deepEqual(plain(C.headersFor(ctx, '//evil.example/x')), {});
  const c2 = C.createContext({ developmentId: DEV, email: PII.email, url: PII.shareUrl });
  assert.ok(!('email' in c2) && !('url' in c2), 'o contexto não aceita campos fora do contrato');
});
test('environment separation: localhost → development, staging hosts → staging, otherwise production; console only in development', () => {
  assert.equal(C.environment({ hostname: 'localhost' }), 'development'); assert.equal(C.environment({ hostname: 'painel-staging.example.com' }), 'staging');
  assert.equal(C.environment({ hostname: 'painel.example.com' }), 'production');
  const calls = []; const orig = console.info; console.info = (...a) => calls.push(a);
  try {
    C.createLogger({ environment: 'production' }).info('APP_BOOT_COMPLETED', 'x'); assert.equal(calls.length, 0, 'produção não usa console');
    C.createLogger({ environment: 'development' }).info('APP_BOOT_COMPLETED', `y ${PII.email}`); assert.equal(calls.length, 1); assertNoLeak(calls, 'console');
  } finally { console.info = orig; }
  assert.equal(C.createLogger({ environment: 'production' }).debug('ROUTE_READY', 'x'), null, 'DEBUG desligado em produção');
});

// ====================================================================== error taxonomy + reporter
test('ApplicationError taxonomy: stable codes from status/name, retryability, user-safe message, cause chain (ObsDocumentScanFailure)', () => {
  const T = [[{ status: 500 }, 'API_SERVER_ERROR'], [{ status: 504 }, 'DEPENDENCY_TIMEOUT'], [{ status: 401 }, 'AUTHENTICATION_REQUIRED'], [{ status: 403 }, 'AUTHORIZATION_DENIED'], [{ status: 404 }, 'RESOURCE_NOT_FOUND'],
    [{ status: 409 }, 'RESOURCE_VERSION_MISMATCH'], [{ status: 429 }, 'RATE_LIMITED'], [Object.assign(new TypeError('Failed to fetch')), 'NETWORK_UNAVAILABLE'], [{ name: 'AbortError' }, 'REQUEST_ABORTED'],
    [{ name: 'QuotaExceededError' }, 'STORAGE_QUOTA_EXCEEDED'], [new SyntaxError('Unexpected token < in JSON at position 0'), 'DATA_PARSE_FAILED'], [{ code: 'CHECKSUM_MISMATCH' }, 'CACHE_CORRUPT_ENTRY'], [new Error('boom'), 'FRONTEND_UNEXPECTED']];
  for (const [e, code] of T) assert.equal(C.classify(e), code, JSON.stringify(e));
  const scan = C.appError('DOCUMENT_SCAN_FAILED', { cause: C.appError('DEPENDENCY_TIMEOUT', { dependency: 'antivirus-api' }), metadata: { documentBody: 'conteúdo', documentId: 'doc_1' } });
  const n = C.normalizeError(scan);
  assert.equal(n.code, 'DOCUMENT_SCAN_FAILED'); assert.equal(n.category, 'DEPENDENCY'); assert.equal(n.retryable, true); assert.equal(n.causeChain[0].code, 'DEPENDENCY_TIMEOUT');
  assert.equal(scan.dependency, undefined); assert.equal(scan.cause.dependency, 'antivirusapi'); assert.ok(!('documentBody' in scan.metadata));
  assert.equal(C.appError('NOPE').code, 'INTERNAL_UNEXPECTED');
  const um = C.userMessage('API_SERVER_ERROR'); assert.ok(um && !/500|stack|Error/.test(um));
});
test('ObsApi500ErrorCapture: requestId generated → ApplicationError code → ERROR log → reporter → metric → user-safe response with support code', () => {
  const p = fresh(), req = C.requestContext();
  const err = Object.assign(new Error('Internal Server Error at db.query(select * from lots)'), { status: 500 });
  const r = p.errors.capture(err, { component: 'Data', requestId: req.requestId, eventCode: 'API_REQUEST_FAILED' });
  assert.equal(r.code, 'API_SERVER_ERROR'); assert.match(r.supportCode, /^VJ-[A-Z0-9]{6}$/); assert.equal(r.requestId, req.requestId); assert.equal(r.retryable, true);
  assert.ok(!/select|db\.query|stack/i.test(r.userMessage), 'mensagem do usuário não expõe detalhe interno');
  const log = p.logger.entries().find(e => e.eventCode === 'API_REQUEST_FAILED'); assert.ok(log); assert.equal(log.level, 'ERROR'); assert.equal(log.requestId, req.requestId); assert.equal(log.errorCode, 'API_SERVER_ERROR');
  assert.equal(p.metrics.value('frontend_errors_total', { error_category: 'DEPENDENCY', component: 'Data' }), 1);
  assert.equal(C.supportCode(r.errorId), r.supportCode, 'código de suporte é derivado do errorId (busca do suporte)');
});
test('fingerprint ignores the dynamic message; same group dedupes inside the window (one log line), other component is another group', () => {
  let t = 1_000_000; const p = fresh({ now: () => t });
  const mk = msg => { const e = new TypeError(msg); e.stack = `TypeError: ${msg}\n    at renderLegend (https://painel.example.com/index.html?v=3:120:15)\n    at x (index.html:9:1)`; return e; };
  const a = p.errors.capture(mk('lote 1 falhou'), { component: 'Legend' }), b = p.errors.capture(mk('lote 2 falhou'), { component: 'Legend' });
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(b.duplicate, true);
  const g = p.errors.groups().find(x => x.fingerprint === a.fingerprint); assert.equal(g.count, 2); assert.equal(g.topFrame, 'renderLegend@index.html:120');
  assert.equal(p.logger.entries().filter(e => e.eventCode === 'FRONTEND_ERROR_CAPTURED').length, 1, 'tempestade de erro não vira tempestade de log');
  t += 61_000; assert.equal(p.errors.capture(mk('lote 3'), { component: 'Legend' }).duplicate, false, 'fora da janela registra de novo');
  assert.notEqual(p.errors.capture(mk('x'), { component: 'QuickView' }).fingerprint, a.fingerprint);
  assert.equal(p.errors.capture(new Error('ResizeObserver loop limit exceeded')), null, 'ruído conhecido do navegador ignorado');
});
test('reporter never recurses and never throws: a failing metrics client that reports again is dropped and counted', () => {
  const before = C.telemetry.recursiveDropped; let rep;
  const metrics = { counter() { rep.capture(new Error('inner')); throw new Error('metrics down'); } };
  rep = C.createErrorReporter({ metrics, logger: C.createLogger({ sinks: [{ kind: 'REMOTE', write() { throw new Error('provider down'); } }] }) });
  const r = rep.capture(new Error('outer'));
  assert.ok(r && r.supportCode); assert.equal(C.telemetry.recursiveDropped, before + 1);
});
test('ObsTelemetryBackendUnavailableNonBlocking: sink failures are counted, the user flow continues; the REMOTE sink is off and refuses to send', () => {
  const before = C.telemetry.exportFailures.REMOTE;
  const lg = C.createLogger({ sinks: [{ kind: 'REMOTE', write() { throw new Error('ECONNREFUSED'); } }] });
  let out; assert.doesNotThrow(() => { out = lg.error('API_REQUEST_FAILED', 'x'); });
  assert.ok(out); assert.equal(C.telemetry.exportFailures.REMOTE, before + 1);
  const rs = P.createRemoteSink(); assert.equal(rs.enabled, false); assert.equal(rs.send({}).code, 'REMOTE_SINK_DISABLED');
  assert.ok(P.sinkStatus().find(s => s.kind === 'REMOTE').enabled === false);
});
test('bounded buffers drop low priority first: DEBUG/INFO go before ERROR/FATAL (no infinite queue)', () => {
  const b = C.createBuffer(3);
  for (const level of ['ERROR', 'DEBUG', 'INFO', 'FATAL', 'INFO', 'WARN']) b.push({ level });
  assert.deepEqual(b.list().map(x => x.level), ['ERROR', 'FATAL', 'WARN']); assert.equal(b.dropped(), 3);
});

// ====================================================================== metrics (§45–53)
test('ObsHighCardinalityLabelRejected: unregistered metric, forbidden/unknown label, uncontrolled value and cardinality budget are rejected', () => {
  const p = fresh(), m = p.metrics;
  assert.equal(m.counter('lots_clicked_total', {}), false);
  assert.equal(m.counter('cache_hits_total', { lotId: 'VJ-QA-L0001' }), false);
  assert.equal(m.counter('cache_hits_total', { customerName: 'x' }), false);
  assert.equal(m.counter('cache_hits_total', { colour: 'red' }), false);
  assert.equal(m.observe('resource_load_duration_ms', { resource_type: 'lote 327 maria' }, 10), false);
  assert.equal(m.observe('map_interactive_duration_ms', { device_class: 'IPHONE_15' }, 10), true, 'classe desconhecida vira UNKNOWN');
  assert.equal(m.gauge('cache_hits_total', {}, 1), false, 'tipo errado');
  for (let i = 0; i < 60; i++) m.counter('cache_hits_total', { resource_type: 'TYPE_' + i });
  assert.equal(m.seriesCount('cache_hits_total'), 50);
  const rj = m.rejected(); for (const k of ['UNREGISTERED_METRIC', 'FORBIDDEN_LABEL', 'UNKNOWN_LABEL', 'INVALID_VALUE', 'CARDINALITY_EXCEEDED', 'WRONG_TYPE']) assert.ok(rj[k] >= 1, k);
});
test('histograms report percentiles (never a lone average); few samples → no p95; never-seen series is null, not 0', () => {
  const m = fresh().metrics;
  assert.equal(m.value('quickview_error_total'), null);
  assert.equal(m.summary('quickview_load_duration_ms').label, 'não disponível');
  for (let i = 1; i <= 3; i++) m.observe('quickview_load_duration_ms', { device_class: 'DESKTOP' }, i);
  assert.equal(m.summary('quickview_load_duration_ms').p95, null);
  for (let i = 4; i <= 100; i++) m.observe('quickview_load_duration_ms', { device_class: i % 2 ? 'MOBILE' : 'DESKTOP' }, i);
  const s = m.summary('quickview_load_duration_ms'); assert.deepEqual([s.n, s.p50, s.p95, s.p99, s.max], [100, 50, 95, 99, 100]);
  assert.equal(m.summary('quickview_load_duration_ms', { device_class: 'MOBILE' }).n, 48);
  assert.equal(m.observe('quickview_load_duration_ms', {}, null), false, 'null não vira 0');
});

// ====================================================================== tracing (§64–76)
test('ObsTraceSamplingErrorAlwaysCaptured: with defaultRate 0 a healthy trace is dropped and an error trace is kept whole', () => {
  const p = fresh({ sampling: { defaultRate: 0, errorRate: 1, highRiskOperationRate: 0 } });
  const ok = p.tracer.startSpan('comparison.load'); ok.child('resource.load').end(); ok.end();
  assert.equal(p.tracer.spans().length, 0);
  const root = p.tracer.startSpan('map.bootstrap'); const ch = root.child('resource.load', { attributes: { resource_type: 'MAP_GEOMETRY' } });
  ch.recordError(Object.assign(new Error('x'), { status: 503 })).end(); root.end();
  const kept = p.tracer.spans(); assert.equal(kept.length, 2); assert.ok(kept.every(s => s.traceId === root.traceId && s.sampling === 'ERROR'));
  assert.equal(kept.find(s => s.name === 'resource.load').parentSpanId, root.spanId); assert.equal(kept.find(s => s.name === 'resource.load').errorCode, 'API_SERVER_ERROR');
  assert.equal(S.sampleDecision({ name: 'price.publish' }, { sampling: { defaultRate: 0, highRiskOperationRate: 1 } }).reason, 'HIGH_RISK');
});
test('ObsApiRequestTrace + ObsPricePublishTrace + async job linking: spans carry W3C ids, steps, links; open spans are swept', async () => {
  let t = 0; const p = { tracer: S.createTracer({ now: () => t, registry: FULL.spans }) };
  const v = await p.tracer.run('http.client', async sp => { t += 120; sp.setAttribute('endpoint_group', 'lots.quick_view'); sp.setAttribute('status_class', '2xx'); return 7; }, { requestId: 'req_x' });
  assert.equal(v, 7); const http = p.tracer.spans()[0]; assert.equal(http.durationMs, 120); assert.equal(http.kind, 'CLIENT'); assert.equal(http.attributes.endpoint_group, 'lots.quick_view');
  const pub = p.tracer.startSpan('price.publish', { attributes: { step: 'VALIDATION', 'price_table.id': 'PT13' } });
  const job = p.tracer.startSpan('job.consume', { links: [{ traceId: pub.traceId, spanId: pub.spanId }], attributes: { job_type: 'PRICE_EVENT_PUBLISH', attempt: 1 } });
  assert.notEqual(job.traceId, pub.traceId, 'job assíncrono abre trace novo ligado (não mantém trace aberto)'); job.end(); pub.end();
  assert.equal(p.tracer.spans().find(s => s.name === 'job.consume').links[0].traceId, pub.traceId);
  assert.equal(p.tracer.spans().find(s => s.name === 'price.publish').attributes.step, 'VALIDATION');
  await assert.rejects(p.tracer.run('analytics.query', async () => { throw new Error('q'); }));
  assert.equal(p.tracer.spans().find(s => s.name === 'analytics.query').status, 'ERROR');
  p.tracer.startSpan('offline.sync'); t += 10 * 60 * 1000; assert.equal(p.tracer.sweep(), 1); assert.equal(p.tracer.spans().find(s => s.name === 'offline.sync').attributes.truncated, true);
});

// ====================================================================== frontend/map/quickview/cache/pwa/security instrumentation
test('ObsQuickViewLatencyMetric + ObsMapInteractiveMetric: instrumentation reuses geo/perf.js diagnostics and labels only controlled dimensions', () => {
  const p = fresh();
  for (let i = 0; i < 6; i++) P.instrument.quickView(80 + i);
  P.instrument.quickView(null, { staleDiscarded: true }); P.instrument.quickView(null, { error: new TypeError('Failed to fetch') });
  assert.equal(p.metrics.summary('quickview_load_duration_ms').n, 6); assert.equal(p.metrics.value('quickview_stale_discard_total'), 1); assert.equal(p.metrics.value('quickview_error_total', { error_category: 'NETWORK' }), 1);
  const diag = { rendererType: 'SVG', readiness: 'INTERACTIVE', initMs: 640.5, firstRenderMs: 90, geometryLoadMs: 30, featureCount: 498, timings: { map_layer_switch: { n: 3, p50: 4, p95: 9, last: 5 } } };
  P.instrument.mapReady(diag);
  assert.equal(p.metrics.summary('map_interactive_duration_ms', { renderer_type: 'SVG' }).n, 1);
  const m = S.fromMapDiagnostics(diag); assert.equal(m.layerSwitch.p95, 9); assert.equal(S.fromMapDiagnostics(null).label, 'não disponível');
  assert.ok(p.logger.entries().some(e => e.eventCode === 'MAP_INTERACTIVE'));
});
test('ObsCacheHitMetric + ObsCacheCorruptionError: cache snapshot as gauges; corruption logs WARN and the local alert needs 5 (one isolated error never alerts)', () => {
  const p = fresh();
  const cs = P.instrument.cacheSnapshot({ memoryEntryCount: 4, persistentEntryCount: 2, estimatedPersistentBytes: 1000, staleHitCount: 1, corruptionCount: 0, evictionCount: 0, persistentDegraded: false, rows: [{ resourceId: 'secret' }] });
  assert.equal(cs.memoryEntries, 4); assert.ok(!('rows' in cs), 'diagnóstico de cache: contagens, nunca conteúdo');
  assert.equal(p.metrics.value('cache_entries', { storage_tier: 'INDEXED_DB' }), 2);
  P.instrument.cacheCorruption('PRICING_SNAPSHOT');
  assert.ok(p.logger.entries().some(e => e.eventCode === 'CACHE_CORRUPT_ENTRY' && e.level === 'WARN'));
  const st = { last: {} }, alert = () => S.evaluateLocalAlerts({ metrics: p.metrics }, st).find(a => a.alertId === 'cache_corruption_spike');
  assert.equal(alert().state, 'OK');
  for (let i = 0; i < 4; i++) P.instrument.cacheCorruption('PRICING_SNAPSHOT');
  assert.equal(alert().state, 'FIRING'); assert.equal(alert().state, 'FIRING_COOLDOWN', 'cooldown evita ruído');
  p.errors.capture(new Error('isolado')); assert.equal(S.evaluateLocalAlerts({ metrics: p.metrics }, { last: {} }).find(a => a.alertId === 'frontend_error_spike').state, 'OK');
  assert.ok(S.evaluateLocalAlerts({ metrics: p.metrics }, { last: {} }).every(a => a.paging === undefined || a.paging === false), 'nada vira paging no aparelho');
});
test('ObsPwaOfflineSyncFailure + connectivity + SW lifecycle are counted with controlled labels', () => {
  const p = fresh();
  P.instrument.syncResult({ pending: 3, failed: true }); P.instrument.syncResult({ conflict: true }); P.instrument.connectivity('offline'); P.instrument.sw('UPDATE_AVAILABLE'); P.instrument.sw('NOT_A_STATE');
  assert.equal(p.metrics.value('offline_sync_pending'), 3); assert.equal(p.metrics.value('offline_sync_failure_total'), 1); assert.equal(p.metrics.value('offline_sync_conflict_total'), 1);
  assert.equal(p.metrics.value('connectivity_changes_total', { connectivity_state: 'OFFLINE' }), 1); assert.equal(p.metrics.value('sw_lifecycle_total', { sw_event: 'UPDATE_AVAILABLE' }), 1);
  assert.ok(p.logger.entries().some(e => e.eventCode === 'PWA_SYNC_FAILED'));
});
test('ObsShareDeniedWithoutTokenLeak: denial counted by reason category; the token and the link never appear', () => {
  const p = fresh();
  P.instrument.shareDenied('EXPIRED'); P.instrument.shareDenied(PII.token);
  assert.equal(p.metrics.value('share_access_denied_total', { reason_category: 'EXPIRED' }), 1); assert.equal(p.metrics.value('share_access_denied_total', { reason_category: 'OTHER' }), 1);
  p.errors.capture(Object.assign(new Error(`link expirado ${PII.shareUrl}`), { code: 'SHARE_ACCESS_DENIED' }), { component: 'SharedRuntime' });
  assertNoLeak([p.logger.entries(), p.errors.groups(), p.metrics.snapshot()], 'share');
});
test('ObsTenantScopeViolationSecurityMetric: aggregated counter, CRITICAL local alert owned by security, never auto-silenced; events aggregated by type only', () => {
  const p = fresh();
  P.instrument.security('TENANT_SCOPE_VIOLATION'); P.instrument.security('AUTHZ_DENIED', { permissionKey: 'pricing.publish' });
  assert.equal(p.metrics.value('tenant_scope_violation_total'), 1); assert.equal(p.metrics.value('authorization_denied_total', { permission_group: 'pricing' }), 1);
  const a = S.evaluateLocalAlerts({ metrics: p.metrics }, { last: {} }).find(x => x.alertId === 'tenant_scope_violation');
  assert.equal(a.state, 'FIRING'); assert.equal(a.severity, 'CRITICAL'); assert.equal(C.registry().alerts.tenant_scope_violation.silencePolicy, 'NEVER_AUTO_SILENCE');
  const agg = S.fromSecurityEvents([{ type: 'AUTHZ_DENIED', actorUserId: 'u1', data: { email: PII.email } }, { type: 'AUTHZ_DENIED' }]);
  assert.deepEqual(plain(agg.byType), { AUTHZ_DENIED: 2 }); assertNoLeak(agg, 'security');
});
test('ObsAvailabilityConflictMetric / ObsJobRetryExhausted (contracts): registered metrics accept only controlled outcomes; DLQ alert is HIGH with runbook', () => {
  fresh(); const m = S.createMetrics({ registry: FULL.metrics });
  assert.equal(m.counter('availability_transition_total', { outcome: 'CONFLICT' }), true); assert.equal(m.counter('availability_transition_total', { outcome: 'LOT_327' }), false);
  assert.equal(m.counter('jobs_failed_total', { job_type: 'DOCUMENT_SCAN' }), true); assert.equal(m.counter('jobs_failed_total', { job_type: 'cus_123 maria' }), false);
  const reg = FULL; assert.equal(reg.alerts.job_retry_exhausted.severity, 'HIGH'); assert.ok(reg.runbooks[reg.alerts.job_retry_exhausted.runbookRef]);
  assert.equal(reg.metrics.dead_letter_count.status, 'CONTRACT_ONLY'); assert.ok(reg.alerts.cron_missed.condition.includes('ausência'));
});

// ====================================================================== error boundaries + global handlers
test('ObsFrontendErrorBoundaryFallback: local fallback with support code and safe message; the error is reported, never silent', () => {
  const p = fresh();
  const out = P.guard('QuickView', () => { throw new Error('Cannot read properties of undefined (reading pricePerM2) at quickview.js:88'); }, info => C.fallbackHtml(info));
  assert.match(out, /Código do erro: <b>VJ-[A-Z0-9]{6}<\/b>/); assert.ok(!/pricePerM2|quickview\.js|undefined/.test(out), 'sem detalhe interno para o usuário');
  assert.equal(p.metrics.value('frontend_error_boundary_fallback_total', { component: 'QuickView' }), 1);
  assert.ok(p.logger.entries().some(e => e.eventCode === 'ERROR_BOUNDARY_FALLBACK')); assert.equal(p.errors.groups()[0].component, 'QuickView');
  assert.equal(P.guard('QuickView', () => 42), 42);
  assert.equal(C.boundary('WhateverArea', () => { throw new Error('x'); }, { reporter: p.errors }).area, 'Global');
});
test('global handlers: window error + unhandledrejection are captured through listeners (window.onerror untouched) and can be removed', () => {
  const p = fresh(), L = {}; const win = { onerror: 'original', addEventListener: (t, f) => { L[t] = f; }, removeEventListener: t => { delete L[t]; } };
  const un = C.installGlobalHandlers(win, p.errors);
  L.error({ message: 'x', error: new RangeError('bad range') }); L.unhandledrejection({ reason: Object.assign(new Error('nope'), { status: 503 }) }); L.unhandledrejection({ reason: 'texto' });
  L.error({ message: 'ResizeObserver loop completed with undelivered notifications.' }); L.error({});
  const codes = p.errors.groups().map(g => g.code).sort(); assert.deepEqual(codes, ['API_SERVER_ERROR', 'FRONTEND_UNEXPECTED', 'FRONTEND_UNEXPECTED']);
  assert.ok(p.logger.entries().some(e => e.eventCode === 'UNHANDLED_REJECTION')); assert.equal(win.onerror, 'original');
  un(); assert.deepEqual(Object.keys(L), []);
});

// ====================================================================== health, freshness, SLO
test('ObsHealthLiveReady: live is minimal; ready needs lots + config; connectivity and dependencies say "não disponível" when unknown', () => {
  assert.deepEqual(plain(S.liveness()).status, 'OK');
  assert.equal(S.readiness({ lotCount: 498, mapReadiness: 'INTERACTIVE', configOk: true }).status, 'OK');
  assert.equal(S.readiness({ lotCount: 498, mapReadiness: 'GEOMETRY_READY', configOk: true }).status, 'DEGRADED');
  assert.equal(S.readiness({ lotCount: 0, mapReadiness: 'INTERACTIVE', configOk: true }).status, 'DOWN');
  assert.equal(S.readiness({}).status, 'UNKNOWN');
  assert.equal(S.connectivity('online').status, 'OK'); assert.equal(S.connectivity(undefined).state, 'UNKNOWN');
  const d = S.dependencies({}); assert.ok(d.every(x => x.status === 'UNKNOWN' && /não disponível/.test(x.label)));
  assert.equal(S.dependencies({ dataOrigin: 'BUNDLED' })[0].status, 'DEGRADED');
});
test('data freshness: reads the repository FreshnessState; availability stays "não confirmado"; no limit decided → no alert, "necessita confirmação"', () => {
  const fr = S.freshnessSignals({ freshnessState: repo.getFreshnessState(), versions: repo.getDataVersions() });
  assert.notEqual(fr.AVAILABILITY.status, 'FRESH', 'disponibilidade UNKNOWN nunca aparece como atual');
  assert.equal(fr.AVAILABILITY.limitLabel, 'necessita confirmação'); assert.equal(fr.AVAILABILITY.alert, null);
  const p = fresh(); assert.equal(S.evaluateLocalAlerts({ metrics: p.metrics, freshness: fr }, { last: {} }).find(a => a.alertId === 'availability_feed_stale').state, 'NEEDS_DECISION');
  const reg = C.registry(), saved = reg.freshnessSignals.AVAILABILITY.expectedMaxAgeMs;
  try { reg.freshnessSignals.AVAILABILITY.expectedMaxAgeMs = 3600000;
    const f2 = S.freshnessSignals({ freshnessState: { availability: { status: 'STALE', lastSuccessfulSyncAt: '2026-10-01T00:00:00Z' } } }, { now: Date.parse('2026-10-12T00:00:00Z') });
    assert.equal(f2.AVAILABILITY.stale, true); assert.equal(f2.AVAILABILITY.alert, 'availability_feed_stale'); assert.equal(f2.AVAILABILITY.ageMs, 11 * 86400000);
    const f3 = S.freshnessSignals({ freshnessState: { availability: { status: 'UNKNOWN', lastSuccessfulSyncAt: null } } });
    assert.equal(f3.AVAILABILITY.stale, true, 'ausência de evento também alerta quando há limite (§198)'); assert.equal(f3.AVAILABILITY.ageMs, null);
  } finally { reg.freshnessSignals.AVAILABILITY.expectedMaxAgeMs = saved; }
});
test('SLO: targets are proposed ("necessita confirmação"); too few samples → não disponível; error budget and burn rate; multi-window burn alerts', () => {
  const slo = C.registry().slos.slo_api_critical_success;
  const none = S.evaluateSlo(slo, { good: 5, total: 5 }); assert.equal(none.status, 'INSUFFICIENT_DATA'); assert.equal(none.sli, null); assert.equal(none.targetLabel, 'necessita confirmação');
  const r = S.evaluateSlo(slo, { good: 998, total: 1000 });
  assert.equal(r.status, 'BREACHING'); assert.equal(r.burnRate, 2); assert.equal(r.errorBudget.allowed, 1); assert.equal(r.errorBudget.consumed, 2); assert.equal(r.errorBudget.remainingRatio, 0);
  assert.equal(S.evaluateSlo(slo, { good: 1000, total: 1000 }).status, 'MEETING');
  assert.equal(S.burnRateAlert(20, 1), null, 'pico curto não alerta'); assert.equal(S.burnRateAlert(20, 15), 'HIGH'); assert.equal(S.burnRateAlert(7, 6.5), 'WARNING');
});

// ====================================================================== release markers, support diagnostics, override
test('ObsDeployMarkerRegression: release marker on every error group; a new version is an operational change event', () => {
  const p = fresh();
  P.setRelease({ appVersion: 'v-aaa', buildId: 'b1' }); p.errors.capture(new Error('a'), { component: 'Legend' });
  P.setRelease({ appVersion: 'v-bbb', buildId: 'b2' }); p.errors.capture(new RangeError('b'), { component: 'Legend' });
  const rel = p.errors.groups().map(g => g.release).sort(); assert.deepEqual(rel, ['v-aaa', 'v-bbb']);
  const vm = P.viewModel({ allowed: true }); assert.ok(vm.changes.filter(c => c.eventType === 'DEPLOYMENT').length >= 2); assert.equal(vm.changes[0].versionRef, 'v-bbb');
  const ch = P.recordChange('price activation', { versionRef: 'PT13', metadata: { approvedBy: PII.email, note: PII.note } }); assert.equal(ch.eventType, 'PRICEACTIVATION'); assertNoLeak(ch, 'change');
});
test('ObsSupportDiagnosticSnapshot + ObsMultiTabPwaIssueDiagnostic: versions, cache/PWA summaries and error refs only — no customer, token or URL', () => {
  const p = fresh(); p.errors.capture(new Error('x'), { component: 'MapRenderer' });
  const devInfo = { versions: repo.getDataVersions(), freshness: repo.getFreshnessState(), connectivity: 'OFFLINE', origin: 'CACHE', backend: 'indexeddb', sw: { registered: true, version: 'abc123' }, sync: { pending: 2 }, offlineReady: true, estimate: { usage: 1000, quota: 10000 }, customer: PII, shareLink: PII.shareUrl };
  const s = P.supportSnapshot({ devInfo, mapDiagnostics: { readiness: 'INTERACTIVE', initMs: 500, rendererType: 'SVG' }, cacheInspect: { memoryEntryCount: 3, persistentEntryCount: 1, persistentDegraded: false } });
  for (const k of ['generatedAt', 'environment', 'appVersion', 'activeVersions', 'cacheSummary', 'pwaSummary', 'recentErrorRefs', 'warnings', 'routeCode', 'deviceClass']) assert.ok(k in s, k);
  assert.equal(s.pwaSummary.connectivity, 'OFFLINE'); assert.equal(s.pwaSummary.pendingSync, 2); assert.equal(s.pwaSummary.swRegistered, true); assert.equal(s.activeVersions.swVersion, 'abc123');
  assert.ok(s.warnings.some(w => /conexão/.test(w)) && s.warnings.some(w => /cópia/.test(w))); assert.equal(s.recentErrorRefs.length, 1); assert.match(s.recentErrorRefs[0], /^FRONTEND_UNEXPECTED·MapRenderer·fp_/);
  assertNoLeak(s, 'snapshot'); assertNoLeak(P.diagnosticText({ devInfo }), 'diagnosticText');
  assert.ok(!JSON.stringify(s).includes('"customer"'));
});
test('TenantDiagnosticOverride: needs reason + approver, at most 1 h, expires by itself; DEBUG logs only while active', () => {
  let t = Date.parse('2026-10-12T10:00:00Z'); const o = { now: () => t };
  assert.equal(C.setDiagnosticOverride({ enabledUntil: '2026-10-12T10:30:00Z', approvedBy: 'x' }, o).code, 'REASON_REQUIRED');
  assert.equal(C.setDiagnosticOverride({ enabledUntil: '2026-10-12T10:30:00Z', reason: 'r' }, o).code, 'APPROVER_REQUIRED');
  assert.equal(C.setDiagnosticOverride({ enabledUntil: '2026-10-13T10:30:00Z', reason: 'r', approvedBy: 'a' }, o).code, 'TOO_LONG');
  const ok = C.setDiagnosticOverride({ organizationId: 'org-house7', enabledUntil: '2026-10-12T10:30:00Z', reason: `suporte ${PII.email}`, approvedBy: PII.name, extraLogLevel: 'DEBUG', traceSamplingRate: 1 }, o);
  assert.ok(ok.ok); assertNoLeak(ok.override, 'override');
  const lg = C.createLogger({ environment: 'production', now: o.now }); assert.ok(lg.debug('ROUTE_READY', 'x'));
  t += 31 * 60 * 1000; assert.equal(lg.debug('ROUTE_READY', 'x'), null, 'debug não fica permanente'); assert.equal(C.activeOverride(o), null);
});

// ====================================================================== view model + markup ("Saúde da plataforma")
test('"Saúde da plataforma": technical-only view model; unknown values say "não disponível" (never 0); markup escapes and has the actions', () => {
  fresh();
  assert.equal(P.viewModel({ allowed: false }).allowed, false); assert.match(P.html(P.viewModel({ allowed: false })), /modo Técnico/);
  const vm = P.viewModel({ allowed: true, lotCount: repo.lotsSync().length, devInfo: { versions: repo.getDataVersions(), freshness: repo.getFreshnessState(), connectivity: 'ONLINE', origin: 'BUNDLED' } });
  assert.equal(vm.title, 'Saúde da plataforma'); assert.deepEqual(plain(vm.acts), { refresh: 'obsRefresh', copy: 'obsCopyDiagnostic', clear: 'obsClear' });
  assert.equal(vm.health.find(h => h.id === 'READY').status, 'DEGRADED', 'sem mapa no Node: pronto parcial');
  assert.equal(vm.freshness[0].statusText, 'não confirmado'); assert.equal(vm.freshness[0].limit, 'necessita confirmação');
  assert.ok(vm.performance.every(r => r.value === 'não disponível' ? r.label === 'não disponível' : true)); assert.ok(!vm.performance.some(r => r.value === '0 ms'));
  assert.ok(vm.slos.every(s => s.statusText === 'não disponível'), 'SLO sem amostra não é 100%');
  assert.deepEqual(plain(vm.decisions.map(d => d.id)), ['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8']);
  const h = P.html(vm);
  for (const a of ['obsRefresh', 'obsCopyDiagnostic', 'obsClear']) assert.ok(h.includes(`data-act="${a}"`), a);
  assert.ok(!/undefined|NaN|\[object/.test(h)); assert.ok(h.includes('Nada é enviado'));
  P.provider().errors.capture(new Error('<img src=x onerror=alert(1)>'), { component: 'Panels' });
  assert.ok(!P.html(P.viewModel({ allowed: true })).includes('<img'));
  P.clear(); assert.equal(P.viewModel({ allowed: true }).errors.length, 0);
});
test('OTLP mapping is a pure contract: severity numbers, W3C ids, attributes without objects; obs modules never call the network', () => {
  const p = fresh(); const ev = p.logger.error('API_REQUEST_FAILED', 'x', { errorCode: 'API_SERVER_ERROR' }, { requestId: 'req_1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
  const o = P.toOtlpLog(ev); assert.equal(o.severityNumber, 17); assert.equal(o.traceId, 'a'.repeat(32)); assert.ok(o.attributes.find(a => a.key === 'request.id').value.stringValue === 'req_1');
  for (const f of ['obsCore.js', 'obsSignals.js', 'obsPlatform.js']) { const src = fs.readFileSync(path.join(SRC, 'observability', f), 'utf8'); assert.ok(!/\bfetch\s*\(|sendBeacon|XMLHttpRequest|WebSocket|gtag|fbq|Sentry|datadog/i.test(src), f); }
});
test('separation: observability does not write Product Analytics events, Audit events or SecurityEvents', () => {
  const a0 = App.analytics.client.recent().length, au0 = App.authz.audit.events().length, se0 = App.authz.securityEvents().length;
  fresh(); P.instrument.security('TENANT_SCOPE_VIOLATION'); P.report(new Error('x'), 'Panels'); P.instrument.quickView(10);
  assert.equal(App.analytics.client.recent().length, a0); assert.equal(App.authz.audit.events().length, au0); assert.equal(App.authz.securityEvents().length, se0);
});

// ====================================================================== legacy inventory + console hygiene
test('legacy inventory: every item is typed and has a migration action; no console call in src passes a token, password, cookie or request body', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'OBSERVABILITY_LEGACY_INVENTORY.json'), 'utf8'));
  assert.ok(inv.items.length >= 10);
  for (const it of inv.items) { assert.ok(['LOG', 'METRIC', 'TRACE', 'ERROR_REPORT', 'HEALTH_CHECK', 'ALERT', 'DIAGNOSTIC', 'UNKNOWN'].includes(it.type)); assert.ok(['KEEP', 'STANDARDIZE', 'REDACT', 'REMOVE', 'REPLACE', 'REVIEW'].includes(it.migrationAction)); assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(it.severity)); }
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  for (const f of walk(SRC)) { const s = fs.readFileSync(f, 'utf8'); assert.ok(!/console\.\w+\([^)]*\b(token|password|senha|cookie|authorization|req\.body|request\.body)\b/i.test(s), path.relative(SRC, f)); }
});

// ====================================================================== backend helpers (pure; DB-free)
test('backend telemetry helpers: traceparent, correlation from headers, field redaction, RED metrics by route template (never raw path), /health/live minimal', () => {
  const T = require('../backend/src/shared/observability/telemetry.js');
  const tp = T.formatTraceparent({ traceId: T.newTraceId(), spanId: T.newSpanId() }); assert.ok(T.parseTraceparent(tp));
  const c = T.contextFromHeaders({ traceparent: tp, 'x-correlation-id': 'cor_abcdef12' }, 'req_1'); assert.equal(c.traceId, T.parseTraceparent(tp).traceId); assert.equal(c.correlationId, 'cor_abcdef12'); assert.notEqual(c.traceId, c.requestId);
  assert.match(T.contextFromHeaders({ 'x-correlation-id': '<script>' }, 'r').correlationId, /^cor_/);
  const red = T.redactFields({ authorization: PII.bearer, password: 'x', email: PII.email, userId: 'u1', route: 'GET /v1/lots/:id', note: `${PII.email}`, conn: 'postgres://u:p@h/db', nested: { refreshToken: 'r' } });
  assert.deepEqual(red, { userId: '[mascarado]', route: 'GET /v1/lots/:id', conn: '[removido]', nested: {} });
  assert.equal(T.endpointGroup('GET /v1/developments/:id/lots/:lotId'), 'developments.lots');
  const m = T.createRedMetrics(); m.record({ route: 'GET /v1/lots/:id', method: 'GET', status: 200, durationMs: 10 }); m.record({ route: 'GET /v1/lots/:id', method: 'GET', status: 503, durationMs: 90 });
  const prom = m.prometheus(); assert.match(prom, /api_requests_total\{endpoint_group="lots",method="GET",status_class="2xx"\} 1/); assert.match(prom, /api_errors_total\{endpoint_group="lots",method="GET",status_class="5xx"\} 1/);
  assert.ok(!/VJ-|:id/.test(prom)); assert.deepEqual(T.liveBody(), { status: 'ok' });
});

test('documentation required by §328 exists (pt-BR), plus the topic report', () => {
  const docs = ['OBSERVABILITY_ARCHITECTURE', 'OBSERVABILITY_CONTEXT_AND_CORRELATION', 'STRUCTURED_LOGGING_POLICY', 'LOG_REDACTION_POLICY', 'APPLICATION_ERROR_TAXONOMY', 'METRICS_REGISTRY', 'DISTRIBUTED_TRACING_POLICY', 'FRONTEND_OBSERVABILITY',
    'API_AND_DATABASE_OBSERVABILITY', 'JOB_AND_QUEUE_OBSERVABILITY', 'MAP_OBSERVABILITY', 'CACHE_LAZY_PWA_OBSERVABILITY', 'SECURITY_OBSERVABILITY_BOUNDARY', 'HEALTH_CHECK_POLICY', 'SLO_AND_ERROR_BUDGET_POLICY', 'OPERATIONAL_ALERTING_POLICY',
    'OBSERVABILITY_DASHBOARDS', 'SUPPORT_DIAGNOSTICS', 'RELEASE_AND_CHANGE_OBSERVABILITY', 'OBSERVABILITY_COST_AND_RETENTION', 'OBSERVABILITY_LEGACY_MIGRATION_REPORT', 'OBSERVABILITY_TEST_MATRIX', 'RELATORIO_TOPICO_51'];
  for (const d of docs) assert.ok(fs.statSync(path.join(__dirname, '..', 'docs', d + '.md')).size > 500, d);
});
