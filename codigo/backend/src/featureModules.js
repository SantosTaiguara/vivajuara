'use strict';
/* Round-5 modules (topics 57 deals, 58 onboarding, 59 privacy, 60 backoffice, 61 data quality, 63 surroundings) behind
   module-level feature flags (config.features, env FEATURE_DEALS / FEATURE_ONBOARDING / FEATURE_PRIVACY /
   FEATURE_BACKOFFICE / FEATURE_DATA_QUALITY / FEATURE_SURROUNDINGS — all OFF by default).
   - flag off: nothing is required, built, registered or scheduled (same routes, same OpenAPI paths as before round 5);
   - flag on: the module's routes are registered with its RoutePermissionMatrix rows; createApp then applies the normal
     pipeline (writes enabled? → authenticate → route permission → handler). The permissions are explicit-grant-only:
     OWNER_ADMIN holds them (decision 2026-10-18, Edmilson); every other role → 403; anonymous → 401; the platform
     credential (ADMIN_API_TOKEN, SYSTEM) → 403 (it has no role). Each module keeps its own checks and still refuses
     while its business/legal policy values are null ("necessita confirmação").
   Modules written against a { actorId, organizationId, permissions[] } principal (onboarding, privacy, data quality)
   receive it through `scoped()`: organization = X-Organization-Id validated against the active memberships (or the only
   one), permissions = the principal's granted keys of that module in that organization (never from the request). */
const { AppError, ERROR_CATALOG } = require('./shared/http/errors');
const authz = require('./modules/iam/authorization');
const round5 = require('./modules/iam/round5');

const ORG_RE = /^org_[a-z0-9_]{2,60}$/;
const FALLBACK = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_ERROR' };

/** plain { status, code, details } errors of the module adapters → ApiError (4xx only; anything else stays a 500) */
function asApiError(e) {
  if (e instanceof AppError || !e || !Number.isInteger(e.status) || e.status < 400 || e.status >= 500) return e;
  const code = ERROR_CATALOG[e.code] ? e.code : FALLBACK[e.status] || 'VALIDATION_ERROR';
  return new AppError(e.status, code, e.message || code, e.details || null, e.extra || null);
}

/** active organization of a request principal for organization-level admin routes (null when ambiguous / none) */
function activeOrganization(principal, header) {
  if (!principal || principal.type !== 'USER') return null;
  const orgs = [...authz.activeOrgIds(principal)];
  if (typeof header === 'string' && header !== '') return ORG_RE.test(header) && orgs.includes(header) ? header : null;
  return orgs.length === 1 ? orgs[0] : null;
}

/** router proxy: handlers receive ctx.principal + { organizationId, permissions } of `feature`; errors mapped to ApiError */
function scoped(router, feature) {
  const keys = new Set(round5.FEATURES[feature].keys);
  const wrap = h => async ctx => {
    const p = ctx.principal;
    const organizationId = activeOrganization(p, ctx.req.headers['x-organization-id']);
    const permissions = organizationId ? [...authz.grantedKeys(p, organizationId, null)].filter(k => keys.has(k)) : [];
    try { return await h({ ...ctx, principal: { ...p, organizationId, permissions } }); } catch (e) { throw asApiError(e); }
  };
  return { get: (t, h, m) => router.get(t, wrap(h), m), post: (t, h, m) => router.post(t, wrap(h), m), patch: (t, h, m) => router.patch(t, wrap(h), m) };
}
/** router proxy that only maps errors (modules that already read the IAM principal themselves) */
function mapped(router) {
  const wrap = h => async ctx => { try { return await h(ctx); } catch (e) { throw asApiError(e); } };
  return { get: (t, h, m) => router.get(t, wrap(h), m), post: (t, h, m) => router.post(t, wrap(h), m), patch: (t, h, m) => router.patch(t, wrap(h), m) };
}

/** pricing port of the deals service: current PUBLISHED table price of the lot (never estimated; null when absent) */
function commercialPricingPort(commercial) {
  return {
    async quote(devId, lotId) {
      let snap;
      try { snap = await (await commercial.getCurrentSnapshot(devId, { lotId })).build(); } catch (e) { if (e instanceof AppError && e.status === 404) return null; throw e; }
      const m = snap.lots[lotId], price = m && m.commercial && typeof m.commercial.price === 'number' ? m.commercial.price : null;
      if (price == null) return null;
      return { developmentId: devId, lotId, priceTableId: snap.priceTableId, priceTableVersion: snap.priceTableVersion, listPriceMinor: Math.round(price * 100), currency: (m.commercial.currency || 'BRL') };
    }
  };
}

const MODULES = {
  FEATURE_DEALS({ router, pool, logger, App, services, config }) {
    const { createDealsService } = require('./modules/deals/deals.service');
    const repo = require('./modules/deals/deals.repository');
    const policy = require('./modules/deals/deals.policy');
    const ctl = require('./modules/deals/deals.controller');
    const deals = createDealsService({ store: repo.createPgDealsStore(pool, { App }), policies: policy.createFilePolicyPort(), pricing: commercialPricingPort(services.commercial), logger });
    ctl.registerDealsRoutes(mapped(router), { deals });
    // expiry worker: server clock only (Date.now of this process), one sweep per active organization, never overlapping
    const jobs = [];
    if (config.dealsExpiryIntervalMs > 0) {
      let running = false;
      const sweep = async () => {
        if (running) return; running = true;
        try {
          const { rows } = await pool.query("SELECT id FROM organizations WHERE status IN ('ACTIVE', 'TRIAL') ORDER BY id");
          for (const r of rows) {
            const out = await deals.runExpiry({ organizationId: r.id });
            if (out.reservationsExpired || out.proposalsExpired) logger.info('deals expiry', { organizationId: r.id, ...out });
          }
        } catch (e) { logger.warn('deals expiry sweep failed', { errorCode: 'DEALS_EXPIRY_FAILED', detail: e && e.message }); } finally { running = false; }
      };
      const timer = setInterval(sweep, config.dealsExpiryIntervalMs); timer.unref && timer.unref();
      jobs.push({ name: 'deals.runExpiry', intervalMs: config.dealsExpiryIntervalMs, run: sweep, stop: () => clearInterval(timer) });
    }
    return { service: deals, policies: ctl.DEALS_ROUTE_POLICIES, jobs };
  },
  FEATURE_ONBOARDING({ router, pool }) {
    const { createOnboardingService } = require('./modules/onboarding/onboarding.service');
    const { createPgOnboardingRepository } = require('./modules/onboarding/onboarding.repository');
    const ctl = require('./modules/onboarding/onboarding.controller');
    const onboarding = createOnboardingService({ repo: createPgOnboardingRepository(pool) }); // no scanner/extractor/activator configured: sources stay NOT_CONFIGURED
    ctl.registerOnboardingRoutes(scoped(router, 'FEATURE_ONBOARDING'), { onboarding });
    return { service: onboarding, policies: ctl.ROUTE_POLICIES, jobs: [] };
  },
  FEATURE_PRIVACY({ router, pool }) {
    const { createPrivacyService } = require('./modules/privacy/privacy.service');
    const { createPgPrivacyRepository } = require('./modules/privacy/privacy.repository');
    const { registerPrivacyRoutes } = require('./modules/privacy/privacy.controller');
    const { ROUTE_POLICIES } = require('./modules/privacy/privacy.routes');
    const privacy = createPrivacyService({ repo: createPgPrivacyRepository(pool) });
    registerPrivacyRoutes(scoped(router, 'FEATURE_PRIVACY'), { privacy });
    return { service: privacy, policies: ROUTE_POLICIES, jobs: [] };
  },
  FEATURE_BACKOFFICE({ router, pool, logger }) {
    const { createBackofficeService } = require('./modules/backoffice/backoffice.service');
    const { createPgBackofficeRepository } = require('./modules/backoffice/backoffice.repository');
    const { registerBackofficeRoutes, ROUTES } = require('./modules/backoffice/backoffice.controller');
    const authRepo = require('./modules/auth/auth.repository');
    // previewKey null: previews refuse (PREVIEW_UNAVAILABLE) until a dedicated key is decided; roleGrants {}: grants come from IAM
    const backoffice = createBackofficeService({ repo: createPgBackofficeRepository(pool), audit: authRepo.createPgAuditSink(pool, logger), previewKey: null, roleGrants: {}, logger });
    registerBackofficeRoutes(mapped(router), { backoffice });
    const policies = Object.fromEntries(ROUTES.map(([m, t]) => [`${m} ${t}`, { permission: 'backoffice.access', resource: null }]));
    return { service: backoffice, policies, jobs: [] };
  },
  FEATURE_DATA_QUALITY({ router, pool, App }) {
    const { createDataQualityService } = require('./modules/dataquality/dataquality.service');
    const { createPgDataQualityRepository } = require('./modules/dataquality/dataquality.repository');
    const ctl = require('./modules/dataquality/dataquality.controller');
    const dataQuality = createDataQualityService({ App, repo: createPgDataQualityRepository(pool) });
    ctl.registerDataQualityRoutes(scoped(router, 'FEATURE_DATA_QUALITY'), { dataQuality });
    return { service: dataQuality, policies: ctl.ROUTE_POLICIES, jobs: [] };
  },
  FEATURE_SURROUNDINGS({ router, pool, logger }) {
    const mod = require('./modules/surroundings');
    const surroundings = mod.create({ pool, logger }); // server key read from GOOGLE_MAPS_API_KEY per call; absent → GOOGLE_MAPS_NOT_CONFIGURED
    mod.registerSurroundingsRoutes(mapped(router), { surroundings });
    return { service: surroundings, policies: mod.ROUTE_POLICIES, jobs: [] };
  }
};

/** registerFeatureModules(...) → { enabled: [FEATURE_*], policies: { 'METHOD /tpl': { permission, resource } }, services, jobs, close } */
function registerFeatureModules({ router, config, pool, logger, App, services }) {
  const enabled = [...round5.enabledFeatures(config)];
  const policies = {}, out = {}, jobs = [];
  for (const f of enabled) {
    const before = router.routes.length;
    const m = MODULES[f]({ router, config, pool, logger, App, services });
    out[round5.FEATURES[f].configKey] = m.service;
    for (const [k, p] of Object.entries(m.policies)) policies[k] = { permission: p.permission, resource: p.resource || null };
    for (const r of router.routes.slice(before)) {
      r.meta = { ...r.meta, feature: f };
      if (!policies[`${r.method} ${r.template}`]) throw new Error(`${f}: route ${r.method} ${r.template} has no permission policy`);
    }
    jobs.push(...m.jobs);
  }
  return { enabled, policies: Object.freeze(policies), services: out, jobs, close: () => jobs.forEach(j => j.stop()) };
}

module.exports = { registerFeatureModules, asApiError, activeOrganization, commercialPricingPort, MODULES };
