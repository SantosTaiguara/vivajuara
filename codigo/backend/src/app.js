'use strict';
/* Composition root: wires shared infrastructure, module services and controllers into one
   node:http request handler (modular monolith: one deploy, separate modules). */
const http = require('http');
const { createRouter } = require('./shared/http/router');
const { E, toErrorResponse } = require('./shared/http/errors');
const { sendJson, etagOf, CACHE } = require('./shared/http/respond');
const mw = require('./shared/http/middleware');
const { createPool } = require('./shared/db/pool');
const { createLogger } = require('./shared/logging/logger');
const { getSharedApp, loadErrorsOf } = require('./shared/domain/sharedDomain');
const { buildSchemas } = require('./shared/contracts/schemas');
const { validate } = require('./shared/validation/schema');
const { createIdempotency } = require('./shared/http/idempotency');
const { createPolicyLimiter } = require('./shared/http/rateLimitPolicies');
const telemetry = require('./shared/observability/telemetry');

const { createDevelopmentsService } = require('./modules/developments/developments.service');
const { createLotsService } = require('./modules/lots/lots.service');
const { createAnalysisService } = require('./modules/analysis/analysis.service');
const { createCommercialService } = require('./modules/commercial/commercial.service');
const { createAvailabilityService } = require('./modules/availability/availability.service');
const { createAssetsService } = require('./modules/assets/assets.service');
const { createAvailabilityStream } = require('./modules/availability/availability.stream');
const { createPriceTablePublicationService } = require('./modules/commercial/priceTablePublication.service');
const { createAnalysisPreviewService } = require('./modules/analysis/analysisPreview.service');
const { registerDevelopmentRoutes } = require('./modules/developments/developments.controller');
const { registerLotRoutes } = require('./modules/lots/lots.controller');
const { registerAnalysisRoutes } = require('./modules/analysis/analysis.controller');
const { registerCommercialRoutes } = require('./modules/commercial/commercial.controller');
const { registerAvailabilityRoutes } = require('./modules/availability/availability.controller');
const { registerAssetRoutes } = require('./modules/assets/assets.controller');
const { registerIamRoutes } = require('./modules/iam/iam.controller');
const { registerPriceHistoryRoutes } = require('./modules/pricing-history/priceHistory.controller');
const { createPriceHistoryService } = require('./modules/pricing-history/priceHistory.service');
const { createAuthentication } = require('./modules/iam/authentication');
const { createAuthService } = require('./modules/auth/auth.service');
const { registerAuthRoutes } = require('./modules/auth/auth.controller');
const authRepo = require('./modules/auth/auth.repository');
const { fetchHttpClient } = require('./modules/auth/google.oidc');
const { ANONYMOUS } = require('./modules/iam/authorization');
const { createTenancyService } = require('./modules/tenancy/tenancy.service');
const { POLICIES } = require('./modules/iam/routePolicies');
const permissionRegistry = require('./modules/iam/permissions');
const { loadRoleGrants } = require('./modules/iam/roleGrants');
const { registerFeatureModules } = require('./featureModules');

const STARTED_AT = Date.now();

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** authDeps (optional, tests / local fake IdP): { http, sessions, identities, audit, now } — defaults: real fetch + Postgres */
function createApp({ config, pool, logger, App, authDeps = {} }) {
  const developments = createDevelopmentsService({ pool, App, config });
  const analysis = createAnalysisService({ pool, App, developments });
  const commercial = createCommercialService({ pool, App, developments });
  const availability = createAvailabilityService({ pool, App, config, developments });
  const lots = createLotsService({ pool, App, developments, analysis, commercial, availability });
  const assets = createAssetsService({ pool, config, developments });
  const availabilityStream = createAvailabilityStream({ pool, config, logger, developments });
  const priceTables = createPriceTablePublicationService({ pool, App, developments });
  const analysisPreview = createAnalysisPreviewService({ pool, App, developments });
  const priceHistory = createPriceHistoryService({ pool, developments });
  // W3 login: Google OIDC + server-side cookie session (repositories injectable: Postgres by default, memory in tests)
  const authSvc = createAuthService({ config, logger, now: authDeps.now, http: authDeps.http || fetchHttpClient(),
    sessions: authDeps.sessions || authRepo.createPgSessionStore(pool), identities: authDeps.identities || authRepo.createPgIdentityStore(pool),
    audit: authDeps.audit || authRepo.createPgAuditSink(pool, logger) });
  const authn = createAuthentication({ pool, config, session: authSvc });
  const tenancy = createTenancyService({ pool, logger });
  const services = { developments, analysis, commercial, availability, lots, assets, availabilityStream, priceTables, analysisPreview, priceHistory, tenancy, auth: authSvc, pool, config };
  const idempotency = createIdempotency({ pool, config, logger });

  const router = createRouter();
  // Public, unauthenticated, not rate limited: liveness and readiness.
  const PUBLIC = { public: true };
  router.get('/health', async () => ({ status: 200, body: { status: 'ok', service: 'plat-backend', version: config.serviceVersion, timestamp: new Date().toISOString(), uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000), writesEnabled: config.writesEnabled }, cache: CACHE.NONE, schema: 'Health' }), PUBLIC);
  router.get('/health/ready', async () => {
    try {
      const { rows } = await pool.query('SELECT max(version) AS schema FROM schema_migrations');
      return { status: 200, body: { status: 'ready', database: 'up', schemaVersion: rows[0].schema }, cache: CACHE.NONE };
    } catch (e) {
      throw E.unavailable('NOT_READY', 'Banco de dados indisponível');
    }
  }, PUBLIC);
  // Topic 51: minimal liveness (no version, no dependencies, no topology) for orchestrators.
  router.get('/health/live', async () => ({ status: 200, body: telemetry.liveBody(), cache: CACHE.NONE, schema: 'Live' }), PUBLIC);
  registerDevelopmentRoutes(router, services);
  registerLotRoutes(router, services, App);
  registerAnalysisRoutes(router, services);
  registerCommercialRoutes(router, services);
  registerAvailabilityRoutes(router, services);
  registerAssetRoutes(router, services);
  registerIamRoutes(router, services);
  registerAuthRoutes(router, services);
  registerPriceHistoryRoutes(router, services);
  // Round 5 (topics 57-63): each module only when its FEATURE_* flag is on (all off by default ⇒ routes unchanged).
  if (config.roleGrantsFile) permissionRegistry.installExplicitGrants(loadRoleGrants(config.roleGrantsFile));
  const features = registerFeatureModules({ router, config, pool, logger, App, services });
  Object.assign(services, features.services);

  // Deny by default (topic 30 §5): every route declares its permission (RoutePermissionMatrix) or is explicitly public.
  const registryErrors = permissionRegistry.validateRegistry();
  if (registryErrors.length) throw new Error(`invalid permission registry: ${registryErrors.join('; ')}`);
  for (const r of router.routes) {
    const p = POLICIES[`${r.method} ${r.template}`] || features.policies[`${r.method} ${r.template}`];
    if (p) { permissionRegistry.assertKnown(p.permission); r.meta = { ...r.meta, permission: p.permission, resource: p.resource }; }
    else if (r.meta.permission) permissionRegistry.assertKnown(r.meta.permission);
    else if (!r.meta.public) throw new Error(`route ${r.method} ${r.template} has no permission policy (deny by default)`);
  }

  const limiter = mw.createRateLimiter(config.rateLimit);
  // Patch B2 (topic 50): per-category policies (config/security/rateLimits.json) on top of the global per-IP limit.
  const policyLimiter = config.rateLimit.policies === false ? null : createPolicyLimiter();
  const rejectRate = rl => { throw E.tooManyRequests(rl.retryAfter); }; // generic 429 + Retry-After (policy id only in the log)

  // Output validation (§62): every route that declares a response schema is checked against the contract
  // (the same schemas published in docs/openapi.json). A violation is a server bug: 500 + log, never a silent leak.
  const schemas = buildSchemas(App);
  const checked = (schemaName, route, requestId, produce) => async () => {
    const payload = await produce();
    const errors = validate(payload, schemas[schemaName], schemas);
    if (errors.length) {
      logger.error('response contract violation', { requestId, route, schema: schemaName, errorCode: 'RESPONSE_CONTRACT_VIOLATION', errors: errors.slice(0, 5) });
      throw new Error(`response contract violation (${schemaName})`);
    }
    return payload;
  };

  async function handler(req, res) {
    const t0 = process.hrtime.bigint();
    const requestId = mw.requestIdOf(req);
    // Topic 51: requestId ≠ correlationId ≠ traceId (W3C traceparent accepted only in a valid format; ids never carry PII)
    const trace = telemetry.contextFromHeaders(req.headers, requestId);
    let route = 'unmatched', errorCode = null, rateLimitPolicy = null;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', trace.correlationId);
    mw.securityHeaders(res, { hsts: config.isProduction });
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      errorCode = 'REQUEST_TIMEOUT';
      const { status, body } = toErrorResponse(E.timeout(), requestId);
      res.removeHeader('ETag');
      res.setHeader('Retry-After', String(config.retryAfterSeconds));
      sendJson(req, res, status, body, { cache: CACHE.NONE, compression: false }).catch(() => {});
    }, config.requestTimeoutMs);
    res.on('finish', () => {
      clearTimeout(timer);
      const duration = Number(process.hrtime.bigint() - t0) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request', { requestId, correlationId: trace.correlationId, traceId: trace.traceId, method: req.method, route, statusCode: res.statusCode, duration: Math.round(duration * 10) / 10, errorCode, ...(rateLimitPolicy ? { rateLimitPolicy } : {}) });
    });
    try {
      const url = new URL(req.url, 'http://localhost');
      const cors = mw.applyCors(req, res, config.corsOrigins, { credentials: authSvc.enabled });
      if (cors.preflight) { res.statusCode = 204; res.end(); return; }
      const ip = mw.clientIp(req, config.trustProxy); // B1: right-most X-Forwarded-For hop behind a trusted proxy
      if (!url.pathname.startsWith('/health')) {
        const rl = limiter.check(ip);
        if (!rl.ok) { rateLimitPolicy = 'global.ip'; throw E.tooManyRequests(rl.retryAfter); }
      }
      const { route: r, params } = router.match(req.method, url.pathname);
      route = `${r.method} ${r.template}`;
      const rlPolicies = policyLimiter && (!r.meta.public || r.meta.rateLimited) ? policyLimiter.classify(r.method, r.template, r.meta) : [];
      const rlDims = { ip, endpoint: route, organization: req.headers['x-organization-id'], shareToken: params.token || params.shareToken || null };
      if (rlPolicies.length) { const rl = policyLimiter.check(rlPolicies, rlDims, 'pre'); if (!rl.ok) { rateLimitPolicy = rl.policyId; rejectRate(rl); } }
      // Pipeline (topics 30/31): writes enabled? → authenticate → route permission (deny by default) → resource owner +
      // tenant/scope authorization → handler. All of it runs before the body or the parameters are looked at.
      const guarded = !!(r.meta.write || r.meta.admin);
      if (guarded && !config.writesEnabled) throw E.forbidden('WRITES_DISABLED', 'Escrita desabilitada neste ambiente (nenhuma credencial configurada)');
      let principal = await authn.authenticate(req);
      if (principal.clearSessionCookie) authSvc.clearSession(res); // expired/revoked session: the browser forgets it
      // CSRF (W3): a cookie is ambient, a bearer header is not. Unsafe methods authenticated by the session cookie need
      // X-CSRF-Token; without it a guarded/CSRF-marked route is refused and any other route runs as an anonymous request.
      if (principal.viaSession && !SAFE_METHODS.has(req.method) && !authn.checkCsrf(req, principal)) {
        if (guarded || r.meta.csrf) throw E.forbidden('CSRF_TOKEN_INVALID', 'Token CSRF ausente ou inválido (cabeçalho X-CSRF-Token de GET /api/v1/auth/session)');
        principal = ANONYMOUS;
      }
      if (guarded && principal.type === 'ANONYMOUS') throw E.unauthorized();
      if (rlPolicies.length) { // user-keyed policies (admin.write, analysis.expensive, export, upload) once the principal is known
        const rl = policyLimiter.check(rlPolicies, { ...rlDims, user: principal.type === 'ANONYMOUS' ? null : principal.actorId || principal.idempotencyPrincipal }, 'post');
        if (!rl.ok) { rateLimitPolicy = rl.policyId; rejectRate(rl); }
      }
      let access = { resource: null, decision: null };
      if (r.meta.permission) {
        await tenancy.checkRoute(principal, r.meta.permission, requestId);
        access = await tenancy.guard(principal, r.meta, params, requestId);
      }
      const auth = guarded ? { actorId: principal.actorId, actorType: principal.type, principal: principal.idempotencyPrincipal, permissionKey: r.meta.permission || null } : null;
      let bodyPromise = null;
      const bodyLimit = r.meta.largeBody ? config.adminBodyLimitBytes : config.bodyLimitBytes; // admin commands with large bodies only
      const readBody = () => (bodyPromise = bodyPromise || mw.readJsonBody(req, bodyLimit)); // read once, shared with idempotency
      const ctx = { req, res, params, query: url.searchParams, requestId, config, auth, readBody, principal, access };
      const payloadOf = out => {
        const p = out.build || out.body;
        return out.schema && config.validateResponses ? checked(out.schema, route, requestId, typeof p === 'function' ? p : () => out.body) : p;
      };
      let out = null;
      if (r.meta.idempotent) {
        out = await idempotency.handle({ req, url, routeTemplate: route, principal: auth ? auth.principal : 'anonymous', requestId, readBody,
          execute: () => r.handler(ctx), resolve: async o => { const p = payloadOf(o); return typeof p === 'function' ? p() : p; } });
      }
      if (!out) out = await r.handler(ctx);
      if (out.stream) return; // the handler owns the response (Server-Sent Events)
      // a private development's representation is never stored by shared caches
      const cache = access.resource && access.resource.visibility !== 'PUBLIC' && out.cache && out.cache.startsWith('public') ? CACHE.PRIVATE : out.cache;
      if (authn.providersEnabled) res.setHeader('Vary', `Origin, Authorization, X-Organization-Id${authSvc.enabled ? ', Cookie' : ''}`); // representations may depend on the principal
      await sendJson(req, res, out.status, payloadOf(out), { etag: out.etagToken ? etagOf(out.etagToken) : null, cache, compression: config.compression, headers: out.headers });
    } catch (err) {
      const { status, body } = toErrorResponse(err, requestId);
      errorCode = body.code;
      // B3: the logger redacts detail/stack centrally; in production the stack is not logged at all
      if (status >= 500) logger.error('unhandled error', { requestId, route, errorCode, detail: err && err.message, ...(config.isProduction ? {} : { stack: err && err.stack }) });
      if (!res.headersSent) res.removeHeader('ETag'); // an error is never a cacheable representation
      if (status === 429 && err.details) res.setHeader('Retry-After', String(err.details.retryAfterSeconds));
      if (err && err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="plat-api"');
      if (status >= 400 && !res.headersSent) res.removeHeader('Location');
      if (status === 503) res.setHeader('Retry-After', String(config.retryAfterSeconds));
      if (status === 405 && err.details) res.setHeader('Allow', err.details.allowed.join(', '));
      if (status === 413) res.setHeader('Connection', 'close');
      await sendJson(req, res, status, body, { cache: CACHE.NONE, compression: false }).catch(() => {});
    }
  }

  /** stops timers and ends open event streams (otherwise server.close would wait for them forever) */
  const close = () => { limiter.stop(); if (policyLimiter) policyLimiter.stop(); features.close(); return availabilityStream.close(); };
  return { handler, router, services, close, features: { enabled: features.enabled, jobs: features.jobs.map(j => ({ name: j.name, intervalMs: j.intervalMs, run: j.run })) } };
}

/** startServer: builds pool + app and listens. Used by src/server.js, scripts and tests. */
async function startServer({ config, logger = createLogger({ level: config.logLevel, production: config.isProduction }), pool = null, App = null } = {}) {
  const ownPool = !pool;
  pool = pool || createPool(config.db, logger);
  App = App || getSharedApp(config.sharedSrcDir, config.sharedConfigDir);
  const app = createApp({ config, pool, logger, App });
  const server = http.createServer(app.handler);
  server.headersTimeout = 20000;
  server.requestTimeout = Math.max(config.requestTimeoutMs + 5000, 10000);
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  const addr = server.address();
  const url = `http://${addr.address.includes(':') ? `[${addr.address}]` : addr.address}:${addr.port}`;
  logger.info('server started', { listen: url, env: config.env, writesEnabled: config.writesEnabled, corsOrigins: config.corsOrigins.length, ...(app.features.enabled.length ? { features: app.features.enabled } : {}) });
  if (config.rateLimit.policies === false && config.env !== 'test') logger.warn('RATE_LIMIT_POLICIES=false: per-category rate limits are off (global per-IP limit only)', { errorCode: 'RATE_LIMIT_POLICIES_OFF' });
  if (config.writeAuth.legacyRequested) logger.warn('WRITES_ENABLED=true without ADMIN_API_TOKEN: writes stay disabled (set ADMIN_API_TOKEN)');
  if (config.writeAuth.credentials.some(c => c.kind === 'WRITE_API_KEY')) logger.warn('WRITE_API_KEY is deprecated: use ADMIN_API_TOKEN');
  if (loadErrorsOf(App).length) logger.warn('optional shared modules failed to load', { errorCode: 'SHARED_MODULE_LOAD', files: loadErrorsOf(App).map(e => e.file) });
  return {
    server, url, app, pool,
    close: async () => {
      await app.close();
      await new Promise(r => server.close(() => r()));
      server.closeAllConnections && server.closeAllConnections();
      if (ownPool) await pool.end();
    }
  };
}

module.exports = { createApp, startServer };
