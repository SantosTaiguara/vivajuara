'use strict';
/* TenantResolver + TenantGuard (topic 31) on top of the AuthorizationService (topic 30).
   Request pipeline (app.js): authenticate → route permission (deny by default) → resolve the resource owner from the
   database (development or lot in the route) → authorize against { organizationId, developmentId, visibility } →
   handler. A resource the principal cannot see answers exactly like a nonexistent one (404 DEVELOPMENT_NOT_FOUND /
   LOT_NOT_FOUND): knowing another tenant's id is never enough, and existence is not leaked. A visible resource without
   the permission → 403 PERMISSION_DENIED. The TenantContext is request-scoped (returned, never stored globally).
   Listings (developments, batch summary) are filtered with the same decision. HIGH/CRITICAL denials of authenticated
   principals are written to the audit log (outcome DENIED). */
const repo = require('./tenancy.repository');
const iamRepo = require('../iam/iam.repository');
const reg = require('../iam/permissions');
const authz = require('../iam/authorization');
const { insertAudit } = require('../../shared/db/audit.repository');
const { E } = require('../../shared/http/errors');
const { DEVELOPMENT_ID_RE, LOT_ID_RE } = require('../../shared/validation');

const ORG_ID_RE = /^org_[a-z0-9_]{2,60}$/;

const forbidden = (key, message) => {
  const e = E.forbidden('PERMISSION_DENIED', message || 'Você não possui permissão para esta operação');
  e.details = { permission: key };
  return e;
};

function createTenancyService({ pool, logger }) {
  async function auditDenied(ctx, key, resource, requestId) {
    const p = reg.BY_KEY.get(key);
    if (!p || ctx.type === 'ANONYMOUS' || !(p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL')) return;
    try {
      await insertAudit(pool, { actorId: ctx.actorId, actorType: ctx.type, action: 'AUTHZ_DENIED', permissionKey: key, outcome: 'DENIED',
        entityType: resource ? resource.type : 'route', entityId: resource ? resource.id : '-', developmentId: resource ? resource.developmentId || null : null,
        organizationId: resource ? resource.organizationId : null, requestId });
    } catch (e) { logger && logger.warn('audit write failed', { requestId, errorCode: 'AUDIT_WRITE_FAILED' }); }
  }

  /** route-level check before anything is loaded: 401 for anonymous, 403 when the key is granted nowhere.
      Round-5 (explicitGrantOnly) keys are held only through a role grant: the platform credential (SYSTEM,
      ADMIN_API_TOKEN) has no role, so it is refused on those routes (403) — use an OWNER_ADMIN user session. */
  async function checkRoute(ctx, key, requestId) {
    const p = reg.BY_KEY.get(key);
    if (p && p.explicitGrantOnly && ctx.type === 'SYSTEM') { await auditDenied(ctx, key, null, requestId); throw forbidden(key, 'Credencial de plataforma não tem papel: esta operação exige um usuário com o papel que concede a permissão'); }
    const d = authz.decide(ctx, key, null);
    if (d.effect === 'ALLOW') return d;
    if (ctx.type === 'ANONYMOUS') throw E.unauthorized();
    await auditDenied(ctx, key, null, requestId);
    throw forbidden(key);
  }

  /** loads the owner of the route resource and authorizes; returns { resource, decision } (resource null when the route has none) */
  async function guard(ctx, meta, params, requestId) {
    const key = meta.permission;
    let resource = null, notFound = null;
    if (meta.resource === 'development' && DEVELOPMENT_ID_RE.test(params.developmentId || '')) {
      const o = await repo.findDevelopmentOwner(pool, params.developmentId);
      notFound = () => E.developmentNotFound(params.developmentId);
      if (!o) throw notFound();
      resource = { type: 'development', id: o.developmentId, ...o };
    } else if (meta.resource === 'lot' && LOT_ID_RE.test(params.lotId || '')) {
      const o = await repo.findLotOwner(pool, params.lotId);
      notFound = () => E.lotNotFound(params.lotId);
      if (!o) throw notFound();
      resource = { type: 'lot', id: o.lotId, ...o };
    }
    if (!resource) return { resource: null, decision: null }; // malformed id: the handler answers 400 before touching data
    const decision = authz.decide(ctx, key, resource);
    if (decision.effect === 'ALLOW') return { resource, decision };
    if (decision.notFound) throw notFound();
    if (ctx.type === 'ANONYMOUS') throw E.unauthorized();
    await auditDenied(ctx, key, resource, requestId);
    throw forbidden(key);
  }

  /** listing scope for developments: { all, organizationIds, developmentIds } (PUBLIC developments are always included) */
  function developmentScope(ctx, key = 'development.view') {
    if (ctx.type === 'SYSTEM') return { all: true, organizationIds: [], developmentIds: [] };
    const organizationIds = [], developmentIds = [];
    if (ctx.type === 'USER' && ctx.status === 'ACTIVE') {
      for (const org of authz.activeOrgIds(ctx)) {
        if (authz.grantedKeys(ctx, org, null).has(key)) organizationIds.push(org);
        for (const a of ctx.assignments) if (a.organizationId === org && a.developmentId && reg.roleKeys(a.roleCode, a.organizationId).includes(key)) developmentIds.push(a.developmentId);
      }
    }
    return { all: false, organizationIds, developmentIds: [...new Set(developmentIds)] };
  }

  /** ids the principal may read with `key` (others are reported as not found) */
  async function visibleLotIds(ctx, ids, key = 'lot.view') {
    const owners = await repo.findLotOwners(pool, ids);
    return new Set(owners.filter(o => authz.decide(ctx, key, { type: 'lot', ...o }).effect === 'ALLOW').map(o => o.lotId));
  }

  /** TenantResolver for organization-level routes (/me, audit): X-Organization-Id is a selector, validated against the
      principal's memberships; without it a single active membership is unambiguous; otherwise no active organization. */
  async function resolveActiveOrganization(ctx, header) {
    const now = new Date().toISOString();
    if (header != null && header !== '') {
      if (typeof header !== 'string' || !ORG_ID_RE.test(header)) throw E.badRequest('X-Organization-Id inválido', [{ field: 'X-Organization-Id', reason: 'format', issue: 'format', expected: ORG_ID_RE.source }]);
      const org = await iamRepo.findOrganization(pool, header);
      const allowed = org && (ctx.type === 'SYSTEM' || (ctx.type === 'USER' && authz.activeOrgIds(ctx).has(header) && authz.TENANT_OK.has(org.status)));
      if (!allowed) throw E.notFound('Organização não encontrada', { organizationId: header }, 'ORGANIZATION_NOT_FOUND');
      return { organizationId: org.id, organization: org, resolvedBy: 'HEADER_SELECTOR', resolvedAt: now, selectionRequired: false };
    }
    if (ctx.type === 'USER') {
      const orgs = [...authz.activeOrgIds(ctx)];
      if (orgs.length === 1) return { organizationId: orgs[0], organization: await iamRepo.findOrganization(pool, orgs[0]), resolvedBy: 'SINGLE_MEMBERSHIP', resolvedAt: now, selectionRequired: false };
      return { organizationId: null, organization: null, resolvedBy: null, resolvedAt: now, selectionRequired: orgs.length > 1 };
    }
    return { organizationId: null, organization: null, resolvedBy: null, resolvedAt: now, selectionRequired: false };
  }

  return { checkRoute, guard, developmentScope, visibleLotIds, resolveActiveOrganization, auditDenied };
}

module.exports = { createTenancyService, ORG_ID_RE };
