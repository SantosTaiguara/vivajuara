/* security/organization.js — App.tenancy (topic 31: organizations / multi-tenant isolation, frontend side).
   Organization ≠ Development. Every tenant-owned object (development, lot, price, availability, customer
   profile, comparison, share, audit event) carries or resolves to exactly one organizationId; anything that
   cannot be resolved without ambiguity is DENIED (fail closed). There is NO "first organization" fallback.
   The frontend only *selects* a tenant for UX; the backend revalidates membership on every request.
   localStorage / URL / X-Organization-Id never grant access by themselves.
   Loads before utils/i18n; reads App.configs.security and App.config lazily. No eval, no DOM. */
App.tenancy = (() => {
  const ORG_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', TRIAL: 'TRIAL', SUSPENDED: 'SUSPENDED', DISABLED: 'DISABLED', ARCHIVED: 'ARCHIVED' });
  const MEMBERSHIP_STATUS = Object.freeze({ INVITED: 'INVITED', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', REVOKED: 'REVOKED', ARCHIVED: 'ARCHIVED' });
  const RESOLVED_BY = Object.freeze({ ROUTE: 'ROUTE', SUBDOMAIN: 'SUBDOMAIN', CUSTOM_DOMAIN: 'CUSTOM_DOMAIN', USER_SELECTION: 'USER_SELECTION',
    SERVER_SESSION: 'SERVER_SESSION', SYSTEM_JOB: 'SYSTEM_JOB', SERVICE_PRINCIPAL: 'SERVICE_PRINCIPAL', PUBLIC_DEVELOPMENT: 'PUBLIC_DEVELOPMENT' });
  /** Data classification (TENANT_DATA_OWNERSHIP_MATRIX). */
  const OWNERSHIP = Object.freeze({ GLOBAL: 'GLOBAL', TENANT_OWNED: 'TENANT_OWNED', DEVELOPMENT_OWNED: 'DEVELOPMENT_OWNED', PUBLIC: 'PUBLIC', DERIVED: 'DERIVED' });
  const OWNERSHIP_MATRIX = Object.freeze({
    PermissionRegistry: 'GLOBAL', RoleTemplate: 'GLOBAL', ScoringMethodologyTemplate: 'GLOBAL', LayerRegistry: 'GLOBAL', ReasonCodeCatalog: 'GLOBAL',
    Organization: 'TENANT_OWNED', OrganizationSettings: 'TENANT_OWNED', OrganizationBranding: 'TENANT_OWNED', OrganizationMembership: 'TENANT_OWNED',
    RoleAssignment: 'TENANT_OWNED', CustomerProfile: 'TENANT_OWNED', Share: 'TENANT_OWNED', AuditEvent: 'TENANT_OWNED', AnalyticsEvent: 'TENANT_OWNED',
    Development: 'TENANT_OWNED', DevelopmentConfig: 'DEVELOPMENT_OWNED', Lot: 'DEVELOPMENT_OWNED', PriceTable: 'DEVELOPMENT_OWNED', PriceTableVersion: 'DEVELOPMENT_OWNED',
    AvailabilitySnapshot: 'DEVELOPMENT_OWNED', AnalysisSnapshot: 'DEVELOPMENT_OWNED', Document: 'DEVELOPMENT_OWNED', Asset: 'DEVELOPMENT_OWNED',
    ComparisonSession: 'DERIVED', FitResult: 'DERIVED', RecommendationResult: 'DERIVED', FinancialSimulation: 'DERIVED', RankingTrace: 'DERIVED',
    PublicShareProjection: 'PUBLIC', PublicDevelopmentView: 'PUBLIC'
  });
  /** On tenant switch these client-state keys are tenant data and must be reset (§125); everything else is a global UI preference. */
  const TENANT_SENSITIVE_STATE = Object.freeze(['developmentId', 'currentLotId', 'hoverLotId', 'comparisonLotIds', 'currentCustomerId', 'customers', 'favorites',
    'activeFilters', 'preferences', 'constraints', 'recScope', 'activePreset', 'objective', 'simulation', 'explain', 'legendFocus', 'mapViewport', 'dataRevision']);
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

  const reg = () => (App.configs && App.configs.security && App.configs.security.organizations) || { organizations: [], developments: {}, legacyTenantIds: {}, tenantAccessPolicy: {} };
  const policy = () => Object.freeze({ requireMembership: true, allowPlatformAdmin: false, allowPublicResources: true, suspendedTenantBehavior: 'READ_ONLY', crossTenantPolicy: 'DENY', version: 1, ...(reg().tenantAccessPolicy || {}) });
  const validId = id => typeof id === 'string' && ID_RE.test(id);

  // Organizations learned from a validated server context (/me). Kept apart from the bundled baseline.
  let serverOrgs = new Map(), serverDevOwners = new Map(), serverDevVisibility = new Map();
  function learnFromServer({ organizations = [], developmentOwners = {}, developmentVisibility = {} } = {}) {
    serverOrgs = new Map(organizations.filter(o => o && validId(o.id)).map(o => [o.id, Object.freeze({ ...o })]));
    serverDevOwners = new Map(Object.entries(developmentOwners).filter(([d, o]) => validId(d) && validId(o)));
    serverDevVisibility = new Map(Object.entries(developmentVisibility).filter(([d, v]) => validId(d) && (v === 'PUBLIC' || v === 'PRIVATE')));
  }
  function forgetServer() { serverOrgs = new Map(); serverDevOwners = new Map(); serverDevVisibility = new Map(); }

  /** Organization { id, slug, displayName, legalName, kind, status, settings, branding, domains } or null. */
  function getOrganization(id) {
    if (!validId(id)) return null;
    if (serverOrgs.has(id)) return serverOrgs.get(id);
    return (reg().organizations || []).find(o => o.id === id) || null;
  }
  const listOrganizations = () => [...new Map([...(reg().organizations || []).map(o => [o.id, o]), ...serverOrgs]).values()];
  /** Maps a legacy tenant id (App.config.TENANT.id = 'house7') to the registry id; unknown → null. */
  const canonicalOrgId = id => validId(id) ? (getOrganization(id) ? id : ((reg().legacyTenantIds || {})[id] || null)) : null;

  /** organizationOfDevelopment(devId) → orgId | null. Server ownership wins; bundled registry and App.config must agree, else null. */
  function organizationOfDevelopment(devId) {
    if (!validId(devId)) return null;
    if (serverDevOwners.has(devId)) return serverDevOwners.get(devId);
    const r = (reg().developments || {})[devId], fromReg = r ? r.organizationId : null;
    const dev = App.config && (App.config.DEVELOPMENTS || []).find(d => d.id === devId);
    const fromCfg = dev ? canonicalOrgId(dev.tenantId) : null;
    if (fromReg && fromCfg && fromReg !== fromCfg) return null; // ambiguous ownership → fail closed
    return fromReg || fromCfg || null;
  }
  const developmentVisibility = devId => serverDevVisibility.get(devId) || ((reg().developments || {})[devId] || {}).visibility || 'PRIVATE';
  const developmentsOf = orgId => [...new Set([...Object.keys(reg().developments || {}), ...serverDevOwners.keys()])].filter(d => organizationOfDevelopment(d) === orgId);

  /** developmentIdOf(resource): accepts a canonical Lot, { developmentId }, { identity: { developmentId } } or a lot id 'VJ-…' is NOT parsed (ids are not ownership). */
  function developmentIdOf(r) {
    if (!r || typeof r !== 'object') return null;
    return r.developmentId || (r.identity && r.identity.developmentId) || null;
  }
  /** resolveOrganizationId(resource) → { organizationId, developmentId, source, conflict } — never guesses. */
  function resolveOrganizationId(r) {
    const devId = developmentIdOf(r), fromDev = devId ? organizationOfDevelopment(devId) : null;
    const direct = r && typeof r === 'object' && r.organizationId != null ? r.organizationId : null;
    if (direct != null && !validId(direct)) return { organizationId: null, developmentId: devId, source: 'INVALID', conflict: true };
    if (direct && devId && fromDev !== direct) return { organizationId: null, developmentId: devId, source: 'CONFLICT', conflict: true }; // §199: never trust two ids blindly
    if (direct) return { organizationId: direct, developmentId: devId, source: 'DIRECT', conflict: false };
    if (fromDev) return { organizationId: fromDev, developmentId: devId, source: 'DEVELOPMENT', conflict: false };
    return { organizationId: null, developmentId: devId, source: 'UNRESOLVED', conflict: false };
  }

  /** TenantContext — immutable, explicit; never a mutable global. */
  function TenantContext(o) {
    if (!o || !validId(o.organizationId)) throw Object.assign(new Error('TenantContext exige organizationId válido'), { code: 'TENANT_UNRESOLVED' });
    return Object.freeze({ organizationId: o.organizationId, organizationSlug: o.organizationSlug || null, membershipId: o.membershipId || null,
      activeDevelopmentId: o.activeDevelopmentId || null, principalId: o.principalId || null, resolvedBy: o.resolvedBy || RESOLVED_BY.SERVER_SESSION,
      resolvedAt: o.resolvedAt || new Date().toISOString(), accessPolicyRevision: o.accessPolicyRevision || null, readOnly: !!o.readOnly, metadata: Object.freeze({ ...(o.metadata || {}) }) });
  }

  /** TenantResolver: candidate (from route/selection/server) + memberships → { ok, tenantContext, reason }.
      memberships: [{ organizationId, status, id? }]. publicDevelopmentId: anonymous access only to a PUBLIC development's owner. */
  function resolveTenant({ candidate = null, memberships = [], principalId = null, principalType = 'ANONYMOUS', activeDevelopmentId = null, resolvedBy = RESOLVED_BY.SERVER_SESSION, accessPolicyRevision = null, now } = {}) {
    const deny = reason => ({ ok: false, tenantContext: null, reason });
    let orgId = candidate;
    if (orgId == null && principalType === 'ANONYMOUS' && activeDevelopmentId) { // public read of a public development: org derived from the resource, not chosen
      if (developmentVisibility(activeDevelopmentId) !== 'PUBLIC') return deny('NOT_PUBLIC');
      orgId = organizationOfDevelopment(activeDevelopmentId); resolvedBy = RESOLVED_BY.PUBLIC_DEVELOPMENT;
    }
    if (orgId == null) return deny('TENANT_UNRESOLVED'); // no first-organization fallback (§113)
    if (!validId(orgId)) return deny('TENANT_INVALID');
    const org = getOrganization(orgId);
    if (!org) return deny('TENANT_NOT_FOUND');
    if (org.status === ORG_STATUS.DISABLED || org.status === ORG_STATUS.ARCHIVED) return deny('ORG_DISABLED');
    if (activeDevelopmentId && organizationOfDevelopment(activeDevelopmentId) !== orgId) return deny('TENANT_MISMATCH');
    let membershipId = null;
    if (principalType !== 'ANONYMOUS') {
      const m = (memberships || []).find(x => x && x.organizationId === orgId);
      if (policy().requireMembership && (!m || m.status !== MEMBERSHIP_STATUS.ACTIVE)) return deny('NO_MEMBERSHIP');
      membershipId = m ? m.id || null : null;
    }
    const readOnly = org.status === ORG_STATUS.SUSPENDED && policy().suspendedTenantBehavior === 'READ_ONLY';
    return { ok: true, reason: null, tenantContext: TenantContext({ organizationId: orgId, organizationSlug: org.slug, membershipId, activeDevelopmentId, principalId, resolvedBy, accessPolicyRevision, readOnly,
      resolvedAt: now ? new Date(now).toISOString() : undefined }) };
  }

  /** Leak detector (§285): resource of another tenant → false; strict (dev/test) throws. */
  function assertSameTenant(ctx, resource, { strict = false } = {}) {
    const r = resolveOrganizationId(resource), ok = !!(ctx && ctx.organizationId && r.organizationId && r.organizationId === ctx.organizationId);
    if (!ok && strict) throw Object.assign(new Error(`TENANT_LEAK: recurso de ${r.organizationId || '?'} no contexto ${ctx ? ctx.organizationId : '?'}`), { code: 'TENANT_LEAK' });
    return ok;
  }
  /** Tenant-scoped repository wrapper: every returned resource must belong to ctx; foreign rows are dropped (never shown). */
  function scopeRepository(repo, ctx, { strict = false } = {}) {
    if (!ctx || !validId(ctx.organizationId)) throw Object.assign(new Error('repositório tenant-owned sem TenantContext'), { code: 'TENANT_UNRESOLVED' });
    const keep = x => x == null ? x : (assertSameTenant(ctx, x, { strict }) ? x : null);
    const wrap = fn => (...a) => { const v = fn.apply(repo, a); const f = y => Array.isArray(y) ? y.filter(z => keep(z) != null) : keep(y); return v && typeof v.then === 'function' ? v.then(f) : f(v); };
    const out = { tenantContext: ctx };
    for (const k of ['getLotById', 'getLotByCode', 'getLotsByIds', 'getLotsByBlock', 'lotsSync', 'getLots', 'searchLots']) if (typeof repo[k] === 'function') out[k] = wrap(repo[k]);
    return Object.freeze(out);
  }

  /** Cache / storage namespaces (§130–142). Throws without organizationId: no tenant-less key for tenant data. */
  function scopedKey(ctxOrOrg, ...parts) {
    const org = typeof ctxOrOrg === 'string' ? ctxOrOrg : ctxOrOrg && ctxOrOrg.organizationId;
    if (!validId(org)) throw Object.assign(new Error('chave de cache sem organizationId'), { code: 'TENANT_UNRESOLVED' });
    return ['org', org, ...parts.map(p => String(p))].join(':');
  }
  /** localStorage key for per-development UI state. Legacy key was `ws:{dev}:state` (no tenant). */
  const storageKey = (orgId, devId, name = 'state') => 'ws:' + scopedKey(orgId, 'dev', devId, name);
  const legacyStorageKey = devId => `ws:${devId}:state`;

  /** Patch for the store on organization switch: reset tenant data, keep global UI prefs (theme, layout). */
  function switchPatch(initial) {
    const p = {}; for (const k of TENANT_SENSITIVE_STATE) if (initial && k in initial) p[k] = Array.isArray(initial[k]) ? [] : (initial[k] && typeof initial[k] === 'object' ? JSON.parse(JSON.stringify(initial[k])) : initial[k]);
    return p;
  }
  /** Organization chip view data (no PII). */
  function summary(orgId) {
    const o = getOrganization(orgId);
    return o ? { id: o.id, displayName: o.displayName, slug: o.slug, status: o.status, kind: o.kind || null } : null;
  }
  return Object.freeze({ ORG_STATUS, MEMBERSHIP_STATUS, RESOLVED_BY, OWNERSHIP, OWNERSHIP_MATRIX, TENANT_SENSITIVE_STATE, policy, validId,
    getOrganization, listOrganizations, canonicalOrgId, organizationOfDevelopment, developmentVisibility, developmentsOf, resolveOrganizationId,
    TenantContext, resolveTenant, assertSameTenant, scopeRepository, scopedKey, storageKey, legacyStorageKey, switchPatch, summary, learnFromServer, forgetServer });
})();
