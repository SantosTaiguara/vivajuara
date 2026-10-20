'use strict';
/* Topic 59 — OpenAPI paths of the privacy admin API, for scripts/lib/openapiDoc.js: addPrivacyPaths(add).
   Add together with the route registration (the OpenAPI test requires every documented path to be routed). */
const { ROUTES } = require('./privacy.routes');
const ENVELOPE = { type: 'object', required: ['data', 'meta'], properties: { data: {}, meta: { type: 'object' } } };
function addPrivacyPaths(add) {
  for (const [method, routerPath, summary, permission] of ROUTES) {
    const path = routerPath.replace(/:(\w+)/g, '{$1}'), write = method === 'post', params = [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
    add(path, method, { tags: ['privacy'], summary, description: `Permissão: \`${permission}\` (negação por padrão; recurso de outra organização = 404). Não é parecer jurídico.`,
      ok: ENVELOPE, cache: 'NONE', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
      extraParamsInline: params.map(name => ({ name, in: 'path', required: true, schema: { type: 'string', maxLength: 64 } })),
      requestBody: write ? { required: false, content: { 'application/json': { schema: { type: 'object' } } } } : undefined,
      errors: { 400: ['VALIDATION_ERROR', 'TENANT_CONTEXT_REQUIRED'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED', ...(write ? ['CSRF_TOKEN_INVALID'] : [])], 404: ['NOT_FOUND'], ...(write ? { 409: ['REVISION_CONFLICT'], 422: ['PRIVACY_RULE_DENIED'] } : {}) } });
  }
}
module.exports = { addPrivacyPaths };
