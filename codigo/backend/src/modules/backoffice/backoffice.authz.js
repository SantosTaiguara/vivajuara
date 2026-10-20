'use strict';
/* Admin authorization (topic 60 §9, §140, §161-170). Reuses the IAM PolicyEvaluator (modules/iam/authorization.js):
   - key in the IAM registry → authz.decide(principal, key, organization resource) unchanged;
   - backoffice.* key → same model (SYSTEM allowed; USER needs an ACTIVE membership of an operating organization —
     authz.activeOrgIds — and an ACTIVE assignment whose role is granted the key in `roleGrants`). roleGrants is EMPTY
     by default: no role gets backoffice access until a human decides (docs/RELATORIO_TOPICO_60.md);
   - unknown key → DENY (never throws to the client).
   Cross-tenant: the organization of the command must be one of the principal's active organizations (SYSTEM = platform
   principal, allowed by IAM semantics). notFound=true → answer 404 (existence is not leaked). */
const iamReg = require('../iam/permissions');
const authz = require('../iam/authorization');
const { BO_PERMISSIONS } = require('./backoffice.policy');

function createAdminAuthz({ roleGrants = {} } = {}) {
  const grants = Object.freeze(Object.fromEntries(Object.entries(roleGrants).map(([r, ks]) => [r, Object.freeze([...ks])])));
  /** decide(principal, key, organizationId) → { effect, reasons, notFound } */
  function decide(principal, key, organizationId, now = new Date()) {
    const p = principal || authz.ANONYMOUS;
    const out = (effect, reason, notFound = false) => Object.freeze({ effect, permissionKey: key, reasons: [reason], notFound, evaluatedAt: now.toISOString() });
    if (iamReg.BY_KEY.has(key) && !BO_PERMISSIONS.has(key)) {
      const d = authz.decide(p, key, { type: 'organization', organizationId, developmentId: null, visibility: 'PRIVATE' }, now);
      return out(d.effect, d.reasons[0], d.notFound);
    }
    if (!BO_PERMISSIONS.has(key)) return out('DENY', 'UNKNOWN_PERMISSION');
    if (p.type === 'SYSTEM') return out('ALLOW', 'SYSTEM_PRINCIPAL');
    if (p.type !== 'USER' || p.status !== 'ACTIVE') return out('DENY', p.type === 'ANONYMOUS' ? 'AUTHENTICATION_REQUIRED' : 'PRINCIPAL_NOT_ACTIVE', true);
    if (!authz.activeOrgIds(p).has(organizationId)) return out('DENY', 'TENANT_MISMATCH', true);
    // grant = the injected map (empty in production) OR the IAM role (template/explicit grant: OWNER_ADMIN, decision 2026-10-18)
    const ok = (p.assignments || []).some(a => a.organizationId === organizationId && ((grants[a.roleCode] || []).includes(key) || (iamReg.BY_KEY.has(key) && iamReg.roleKeys(a.roleCode, a.organizationId).includes(key))));
    return out(ok ? 'ALLOW' : 'DENY', ok ? 'ROLE_GRANT' : 'PERMISSION_NOT_GRANTED');
  }
  /** isMember(principal, organizationId) — tenant resolution for admin commands */
  const isMember = (p, org) => !!p && (p.type === 'SYSTEM' || (p.type === 'USER' && authz.activeOrgIds(p).has(org)));
  return { decide, isMember, roleGrants: grants };
}

module.exports = { createAdminAuthz };
