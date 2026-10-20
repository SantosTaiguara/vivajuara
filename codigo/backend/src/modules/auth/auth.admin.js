'use strict';
/* Administration of Google logins (W3): invitations by e-mail (scripts/iam.js invite | list-invites | revoke-invite)
   and session revocation (revoke-sessions). Pure validation + the repository interfaces (IdentityStore/SessionStore),
   so it runs against Postgres in the CLI and against the memory stores in the tests.
   No auto-provisioning: a role exists only because an admin invited that e-mail with that role. The e-mail is used
   once to compute its hash and is never stored, printed back or logged. */
const reg = require('../iam/permissions');
const { emailHash } = require('./auth.service');

const ORG_ID_RE = /^org_[a-z0-9_]{2,60}$/;
const DEV_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EMAIL_RE = /^[^\s@]{1,128}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

/** parse "BROKER" or "PRICING_MANAGER@viva-juara" */
function parseRole(spec) {
  const [roleCode, developmentId = null] = String(spec || '').split('@');
  if (!reg.ROLES[roleCode]) throw new Error(`role desconhecida "${roleCode}" (válidas: ${Object.keys(reg.ROLES).join(', ')})`);
  if (developmentId != null && !DEV_ID_RE.test(developmentId)) throw new Error('empreendimento inválido no papel (use ROLE@empreendimento)');
  return { roleCode, developmentId };
}

/** invite(identities, { email, organizationId, role, ttlDays = 14, invitedBy = 'admin', now }) → { id, organizationId, roleCode, developmentId, expiresAt } */
async function invite(identities, { email, organizationId, role, ttlDays = 14, invitedBy = 'admin', now = Date.now() }) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) throw new Error('e-mail inválido');
  if (!ORG_ID_RE.test(String(organizationId || ''))) throw new Error('organização inválida (ex.: org_house7)');
  const { roleCode, developmentId } = parseRole(role);
  const days = Number(ttlDays);
  if (!Number.isFinite(days) || days <= 0 || days > 90) throw new Error('--ttl-days entre 1 e 90');
  const r = await identities.createInvitation({ organizationId, emailHash: emailHash(email), roleCode, developmentId, invitedBy, expiresAt: new Date(now + days * 86400000) });
  return { id: r.id, organizationId, roleCode, developmentId, expiresAt: r.expiresAt };
}

module.exports = { invite, parseRole, ORG_ID_RE };
