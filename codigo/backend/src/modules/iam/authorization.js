'use strict';
/* AuthorizationService / PolicyEvaluator (topics 30 + 31). Pure: receives an already loaded PrincipalContext and an
   AuthorizationResource; no I/O, no eval, no role-code checks (only permission keys from the registry).
   Model: RBAC with ORGANIZATION / DEVELOPMENT scopes + two explicit attributes (resource visibility, tenant).
     ALLOW only when one of:
       - principal is SYSTEM (bootstrap platform credential, ADMIN_API_TOKEN);
       - the permission is publicRead and the development is PUBLIC (anyone, anonymous included);
       - USER with an ACTIVE membership in the resource organization (organization ACTIVE/TRIAL) and an ACTIVE role
         assignment in that organization (organization-wide or for that development) whose role grants the key.
     Everything else: DENY. notFound=true means the resource must be reported as nonexistent (404): the principal
     cannot even see it (other tenant, or private development without development.view) — existence is not leaked.
   PrincipalContext = { type: 'ANONYMOUS'|'USER'|'SYSTEM', id, userId, displayName, status, actorId, idempotencyPrincipal,
     authenticationMethod, memberships: [{ organizationId, slug, displayName, status }], assignments: [{ roleCode, organizationId, developmentId }] } */
const reg = require('./permissions');

const TENANT_OK = new Set(['ACTIVE', 'TRIAL']);

const ANONYMOUS = Object.freeze({ type: 'ANONYMOUS', id: null, userId: null, displayName: null, status: 'ACTIVE', actorId: null, idempotencyPrincipal: 'anonymous',
  authenticationMethod: null, memberships: Object.freeze([]), assignments: Object.freeze([]) });

/** organizations where the principal is an active member of an operating organization */
const activeOrgIds = ctx => new Set((ctx.memberships || []).filter(m => m.status === 'ACTIVE' && TENANT_OK.has(m.organizationStatus || 'ACTIVE')).map(m => m.organizationId));

/** permission keys granted by the principal's assignments for (organizationId, developmentId|null). developmentId null =
    organization-wide grants only. Assignments of a non-member organization grant nothing. */
function grantedKeys(ctx, organizationId, developmentId = null) {
  const out = new Set();
  if (!ctx || ctx.type !== 'USER' || ctx.status !== 'ACTIVE' || !activeOrgIds(ctx).has(organizationId)) return out;
  for (const a of ctx.assignments || []) {
    if (a.organizationId !== organizationId) continue;
    if (a.developmentId != null && a.developmentId !== developmentId) continue;
    for (const k of reg.roleKeys(a.roleCode, a.organizationId)) out.add(k);
  }
  return out;
}

/** matched assignments (for the decision record) */
const matched = (ctx, r, key) => (ctx.assignments || []).filter(a => a.organizationId === r.organizationId && (a.developmentId == null || a.developmentId === r.developmentId)
  && reg.roleKeys(a.roleCode, a.organizationId).includes(key)).map(a => ({ roleCode: a.roleCode, organizationId: a.organizationId, developmentId: a.developmentId }));

/**
 * decide(ctx, permissionKey, resource?) → AuthorizationDecision
 *   { effect: 'ALLOW'|'DENY', permissionKey, reasons: [code], matchedAssignments, notFound, obligations, policyVersion, evaluatedAt }
 * resource: { type, organizationId, developmentId?, visibility: 'PUBLIC'|'PRIVATE' } — or null for the route-level check
 * ("could this principal hold the permission anywhere?"), used before the resource is loaded.
 */
function decide(ctx, permissionKey, resource = null, now = new Date()) {
  const perm = reg.assertKnown(permissionKey);
  const d = (effect, reasons, extra = {}) => ({ effect, permissionKey, reasons, matchedAssignments: extra.matchedAssignments || [], notFound: !!extra.notFound,
    obligations: effect === 'ALLOW' && (perm.riskLevel === 'HIGH' || perm.riskLevel === 'CRITICAL') ? ['writeAuditEvent'] : [], policyVersion: reg.POLICY_VERSION, evaluatedAt: now.toISOString() });
  ctx = ctx || ANONYMOUS;
  if (ctx.type === 'SYSTEM') return d('ALLOW', ['SYSTEM_PRINCIPAL']);
  if (ctx.status !== 'ACTIVE') return d('DENY', ['PRINCIPAL_NOT_ACTIVE'], { notFound: !!resource && resource.visibility !== 'PUBLIC' });
  if (perm.systemOnly) return d('DENY', ['SYSTEM_ONLY_PERMISSION'], { notFound: !!resource && resource.visibility !== 'PUBLIC' });
  if (!resource) {
    if (perm.publicRead) return d('ALLOW', ['PUBLIC_PERMISSION']);
    if (ctx.type === 'USER') {
      for (const org of activeOrgIds(ctx)) {
        const anyDev = (ctx.assignments || []).some(a => a.organizationId === org && reg.roleKeys(a.roleCode, a.organizationId).includes(permissionKey));
        if (anyDev) return d('ALLOW', ['GRANTED_IN_SOME_SCOPE']);
      }
    }
    return d('DENY', [ctx.type === 'ANONYMOUS' ? 'AUTHENTICATION_REQUIRED' : 'PERMISSION_NOT_GRANTED']);
  }
  if (perm.publicRead && resource.visibility === 'PUBLIC') return d('ALLOW', ['PUBLIC_RESOURCE']);
  if (ctx.type !== 'USER') return d('DENY', ['AUTHENTICATION_REQUIRED'], { notFound: resource.visibility !== 'PUBLIC' });
  if (!activeOrgIds(ctx).has(resource.organizationId)) return d('DENY', ['TENANT_MISMATCH'], { notFound: true });
  const keys = grantedKeys(ctx, resource.organizationId, resource.developmentId || null);
  if (keys.has(permissionKey)) return d('ALLOW', ['ROLE_GRANT'], { matchedAssignments: matched(ctx, resource, permissionKey) });
  const canSee = resource.visibility === 'PUBLIC' || keys.has('development.view');
  return d('DENY', ['PERMISSION_NOT_GRANTED'], { notFound: !canSee });
}

/** effective permission keys of a principal for (organization, development|null) — PrincipalContext.effectivePermissions */
function effectivePermissions(ctx, organizationId, developmentId = null) {
  if (!ctx) return [];
  if (ctx.type === 'SYSTEM') return [...reg.KEYS].sort();
  return [...grantedKeys(ctx, organizationId, developmentId)].sort();
}

/** final action = domain capability AND user authorization (topic 30 §9); capability false always denies */
function finalAction(decision, domainCapability) {
  if (decision.effect !== 'ALLOW') return { allowed: false, reason: decision.reasons[0] };
  if (domainCapability === false) return { allowed: false, reason: 'DOMAIN_CAPABILITY_FALSE' };
  return { allowed: true, reason: null };
}

module.exports = { decide, effectivePermissions, grantedKeys, activeOrgIds, finalAction, ANONYMOUS, TENANT_OK };
