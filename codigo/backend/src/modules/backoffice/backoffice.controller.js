'use strict';
/* HTTP for the backoffice (topic 60, namespace /api/v1/admin/*, §237-240). NOT wired into src/app.js yet (shared
   composition root; see docs/RELATORIO_TOPICO_60.md "Integração"). When wired, the app pipeline already provides:
   authentication (iam/authentication.js: ADMIN_API_TOKEN bearer or Google session cookie), CSRF for cookie writes
   (meta.admin → guarded), WRITES_DISABLED, rate limits (admin.write), X-Request-Id. Each handler ALSO authorizes through
   the backoffice service (tenant → permission → policy), so the routes are deny-by-default even before the IAM
   registry knows the backoffice.* keys. Responses are private, no-store (§386). */
const { envelope, CACHE } = require('../../shared/http/respond');
const { E } = require('../../shared/http/errors');

const ORG_RE = /^org_[a-z0-9_]{1,60}$/;
function orgOf(req, principal) {
  if (!principal || principal.type === 'ANONYMOUS') throw E.unauthorized();
  const h = req.headers['x-organization-id'];
  if (typeof h === 'string' && ORG_RE.test(h)) return h;
  const active = (principal.memberships || []).filter(m => m.status === 'ACTIVE');
  if (active.length === 1) return active[0].organizationId;
  throw E.tenantRequired ? E.tenantRequired('Selecione a organização (X-Organization-Id)', [{ field: 'X-Organization-Id', reason: 'required', issue: 'required' }]) : E.badRequest('X-Organization-Id obrigatório');
}

/** ROUTES: method, template, meta — meta.permission is the route-level key once registered in the IAM registry. */
const ROUTES = Object.freeze([
  ['GET', '/api/v1/admin/backoffice/navigation', 'navigation', { admin: false, backoffice: true }],
  ['GET', '/api/v1/admin/backoffice/secrets-status', 'secretsStatus', { backoffice: true }],
  ['GET', '/api/v1/admin/backoffice/support-sessions/active', 'supportSessions', { backoffice: true }],
  ['GET', '/api/v1/admin/backoffice/emergency-controls', 'emergencyControls', { backoffice: true }],
  ['POST', '/api/v1/admin/commands/preview', 'preview', { admin: true, csrf: true, backoffice: true }],
  ['POST', '/api/v1/admin/commands/execute', 'execute', { admin: true, csrf: true, backoffice: true }]
]);

function registerBackofficeRoutes(router, { backoffice }) {
  const ok = (requestId, data, meta = {}) => ({ status: 200, body: envelope(requestId, { data, meta }), cache: CACHE.PRIVATE });
  const H = {
    navigation: async ({ principal, req, requestId }) => { const org = orgOf(req, principal); return ok(requestId, backoffice.navigation(principal, org), { organizationId: org }); },
    secretsStatus: async ({ principal, req, requestId }) => { const org = orgOf(req, principal); return ok(requestId, backoffice.secretsStatus(principal, org), { organizationId: org, note: 'somente status; valores nunca são exibidos' }); },
    supportSessions: async ({ principal, req, requestId }) => { const org = orgOf(req, principal); return ok(requestId, await backoffice.activeSupportSessions(principal, org), { organizationId: org }); },
    emergencyControls: async ({ principal, req, requestId }) => { const org = orgOf(req, principal); return ok(requestId, await backoffice.activeEmergencyControls(principal, org), { organizationId: org }); },
    preview: async ({ principal, readBody, requestId }) => ok(requestId, await backoffice.preview(principal, await readBody(), { requestId })),
    execute: async ({ principal, readBody, requestId }) => ok(requestId, await backoffice.execute(principal, await readBody(), { requestId }))
  };
  for (const [method, template, h, meta] of ROUTES) (method === 'GET' ? router.get : router.post)(template, H[h], meta);
}

module.exports = { registerBackofficeRoutes, ROUTES };
