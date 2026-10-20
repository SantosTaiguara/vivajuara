'use strict';
/* AuditLog (append-only since migration 009). actor_id is the user uuid, "admin" (bootstrap system credential) or NULL
   (legacy WRITE_API_KEY); never a name, e-mail or token. organization_id comes from development_id when omitted (trigger).
   PII: free-text fields (notes) are never copied into audit values — only the fact that they were present. */
const FREE_TEXT = ['notes'];

function redact(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return v;
  const out = { ...v };
  for (const k of FREE_TEXT) if (k in out) { out[k + 'Present'] = out[k] != null && out[k] !== ''; delete out[k]; }
  return out;
}

const actorTypeOf = a => a.actorType || (a.actorId == null || a.actorId === 'admin' ? 'SYSTEM' : 'USER');

async function insertAudit(db, a) {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, development_id, old_value, new_value, request_id, organization_id, actor_type, permission_key, outcome)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)`,
    [a.actorId ?? null, a.action, a.entityType, a.entityId, a.developmentId ?? null,
      a.oldValue == null ? null : JSON.stringify(redact(a.oldValue)), a.newValue == null ? null : JSON.stringify(redact(a.newValue)), a.requestId ?? null,
      a.organizationId ?? null, actorTypeOf(a), a.permissionKey ?? null, a.outcome || 'SUCCESS']);
}
module.exports = { insertAudit, redact };
