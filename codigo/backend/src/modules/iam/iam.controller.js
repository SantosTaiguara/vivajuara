'use strict';
/* HTTP: GET /api/v1/me (PrincipalContext / AccessControl contract for the frontend), GET /api/v1/iam/registry
   (PermissionRegistry + role templates, global platform data) and GET /api/v1/admin/audit-events (admin.audit.view,
   own organization only; the platform principal may read every organization). */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');
const reg = require('./permissions');
const authz = require('./authorization');
const repo = require('./iam.repository');
const { E } = require('../../shared/http/errors');
const round5 = require('./round5');

function registerIamRoutes(router, { pool, tenancy, config }) {
  // round-5 keys are listed only for modules whose FEATURE_* flag is on (all off ⇒ same responses as before round 5)
  const enabled = round5.enabledFeatures(config);
  const visible = keys => keys.filter(k => round5.isActive(k, enabled));
  const registryEtag = 'iam-registry-' + reg.POLICY_VERSION + (enabled.size ? '-' + [...enabled].sort().join('.').toLowerCase() : '');
  /** MeDto — see docs/IAM_ARCHITECTURE.md §"Contrato GET /api/v1/me" */
  router.get('/api/v1/me', async ({ query, requestId, principal, req }) => {
    v.queryAllowlist(query, []);
    const ctx = principal;
    const t = await tenancy.resolveActiveOrganization(ctx, req.headers['x-organization-id']);
    const orgId = t.organizationId;
    const developments = orgId ? await repo.listOrganizationDevelopments(pool, orgId) : [];
    const devPerms = {};
    if (orgId && ctx.type === 'USER') {
      const base = new Set(visible(authz.effectivePermissions(ctx, orgId, null)));
      for (const a of ctx.assignments) if (a.organizationId === orgId && a.developmentId) {
        const extra = visible(authz.effectivePermissions(ctx, orgId, a.developmentId)).filter(k => !base.has(k));
        if (extra.length) devPerms[a.developmentId] = extra;
      }
    }
    const permissions = ctx.type === 'SYSTEM' ? [...reg.KEYS].sort() : ctx.type === 'ANONYMOUS' || !orgId ? [...reg.PUBLIC_VISITOR].sort()
      : [...new Set(visible(authz.effectivePermissions(ctx, orgId, null)))].sort();
    const assignments = ctx.type === 'USER' ? ctx.assignments.filter(a => !orgId || a.organizationId === orgId) : [];
    const data = {
      authenticated: ctx.type !== 'ANONYMOUS',
      principal: { type: ctx.type, id: ctx.id, displayName: ctx.displayName, status: ctx.status, authenticationMethod: ctx.authenticationMethod },
      organizationId: orgId,
      organization: t.organization ? { id: t.organization.id, slug: t.organization.slug, displayName: t.organization.display_name, status: t.organization.status,
        developments: developments.map(d => ({ id: d.id, slug: d.slug, name: d.name, visibility: d.visibility })) } : null,
      organizationSelectionRequired: t.selectionRequired,
      tenantResolvedBy: t.resolvedBy,
      memberships: (ctx.memberships || []).filter(m => m.status === 'ACTIVE').map(m => ({ organizationId: m.organizationId, slug: m.slug, displayName: m.displayName, status: m.organizationStatus })),
      roles: [...new Set(assignments.map(a => a.roleCode))].sort(),
      roleAssignments: assignments.map(a => ({ role: a.roleCode, organizationId: a.organizationId, developmentId: a.developmentId })),
      permissions,
      publicPermissions: [...reg.PUBLIC_VISITOR].sort(),
      developmentPermissions: devPerms,
      policyVersion: reg.POLICY_VERSION,
      session: { expiresAt: ctx.tokenExpiresAt || null },
      identityProvider: { status: config.oidc && config.oidc.enabled ? 'CONFIGURED' : 'NOT_CONFIGURED', mode: config.oidc && config.oidc.enabled ? 'GOOGLE_OIDC' : config.auth.devTokens ? 'DEV_TOKEN' : 'NONE' }
    };
    return { status: 200, body: envelope(requestId, { data, meta: {} }), cache: CACHE.PRIVATE, schema: 'MeResponse' };
  }, { public: true });

  router.get('/api/v1/iam/registry', async ({ query, requestId }) => {
    v.queryAllowlist(query, []);
    return { status: 200, body: envelope(requestId, { data: reg.registryDto({ enabled }), meta: {} }), etagToken: registryEtag, cache: CACHE.VERSIONED, schema: 'IamRegistryResponse' };
  }, { public: true });

  router.get('/api/v1/admin/audit-events', async ({ query, requestId, principal, req }) => {
    const q = v.parseQuery(query, { limit: { type: 'int', min: 1, max: 200, default: 50 }, before: { type: 'int', min: 1, max: Number.MAX_SAFE_INTEGER } });
    const t = await tenancy.resolveActiveOrganization(principal, req.headers['x-organization-id']);
    if (principal.type !== 'SYSTEM') {
      if (!t.organizationId) throw E.tenantRequired('Selecione a organização (X-Organization-Id)', [{ field: 'X-Organization-Id', reason: 'required', issue: 'required' }]);
      const d = authz.decide(principal, 'admin.audit.view', { type: 'organization', organizationId: t.organizationId, developmentId: null, visibility: 'PRIVATE' });
      if (d.effect !== 'ALLOW') {
        await tenancy.auditDenied(principal, 'admin.audit.view', { type: 'organization', id: t.organizationId, organizationId: t.organizationId }, requestId);
        const e = E.forbidden('PERMISSION_DENIED', 'Você não possui permissão para consultar a auditoria desta organização'); e.details = { permission: 'admin.audit.view' }; throw e;
      }
    }
    const items = await repo.listAuditEvents(pool, { organizationId: t.organizationId, allOrganizations: principal.type === 'SYSTEM' && !t.organizationId, limit: q.limit, beforeId: q.before ?? null });
    const next = items.length === q.limit ? items[items.length - 1].id : null;
    return { status: 200, body: envelope(requestId, { data: items, meta: { organizationId: t.organizationId, limit: q.limit, nextBefore: next } }), cache: CACHE.NONE, schema: 'AuditEventListResponse' };
  }, { permission: 'admin.audit.view' });
}

module.exports = { registerIamRoutes };
