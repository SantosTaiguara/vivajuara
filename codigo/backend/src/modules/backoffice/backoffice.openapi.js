'use strict';
/* OpenAPI fragment for the backoffice routes (topic 60), in the input format of scripts/lib/openapiDoc.js `add(path,
   method, op)`. NOT added to docs/openapi.json yet: the contract test requires documented paths == registered routes, and
   the routes are wired only when the integrator adds registerBackofficeRoutes to src/app.js. Integration (one step):
     1. app.js: registerBackofficeRoutes(router, { backoffice: createBackofficeService({ repo: createPgBackofficeRepository(pool),
        audit: authRepo.createPgAuditSink(pool, logger), previewKey: <derived from SESSION_SECRET>, roleGrants: {} }) });
     2. iam/permissions.js: register the backoffice.* keys (decide OWNER_ADMIN grants first) or keep routes { public:false } with
        meta.permission 'backoffice.access';
     3. openapiDoc.js buildPaths: `require('../../src/modules/backoffice/backoffice.openapi').addPaths(add, { ref })`;
     4. errors.js ERROR_CATALOG + docs/API_ERRORS.md: ADMIN_COMMAND_REJECTED (422); API_ARCHITECTURE.md: the 6 paths. */
const ADMIN_COMMAND_ERRORS = { 400: ['VALIDATION_ERROR'], 401: ['UNAUTHORIZED'], 403: ['WRITES_DISABLED', 'PERMISSION_DENIED', 'CSRF_TOKEN_INVALID'], 404: ['ORGANIZATION_NOT_FOUND', 'NOT_FOUND'],
  409: ['REVISION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED'], 422: ['ADMIN_COMMAND_REJECTED'] };
const READ_ERRORS = { 400: ['VALIDATION_ERROR', 'TENANT_CONTEXT_REQUIRED'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED'], 404: ['ORGANIZATION_NOT_FOUND'] };

function addPaths(add, { ref = n => ({ $ref: `#/components/schemas/${n}` }) } = {}) {
  const sec = [{ bearerAuth: [] }, { cookieAuth: [] }], tags = ['backoffice'];
  add('/api/v1/admin/backoffice/navigation', 'get', { tags, summary: 'Itens de navegação do console permitidos ao principal (deny by default)', cache: 'PRIVATE', ok: 'BackofficeNavigationResponse', security: sec, errors: READ_ERRORS });
  add('/api/v1/admin/backoffice/secrets-status', 'get', { tags, summary: 'Status das credenciais lidas pelo backend (configurado/ausente; nunca o valor)', cache: 'PRIVATE', ok: 'BackofficeSecretsStatusResponse', security: sec, errors: READ_ERRORS });
  add('/api/v1/admin/backoffice/support-sessions/active', 'get', { tags, summary: 'Sessões de suporte ativas na organização (banner obrigatório)', cache: 'PRIVATE', ok: 'BackofficeSupportSessionsResponse', security: sec, errors: READ_ERRORS });
  add('/api/v1/admin/backoffice/emergency-controls', 'get', { tags, summary: 'Controles de emergência ativos', cache: 'PRIVATE', ok: 'BackofficeEmergencyControlsResponse', security: sec, errors: READ_ERRORS });
  add('/api/v1/admin/commands/preview', 'post', { tags, summary: 'Prévia de um AdminCommandEnvelope (impacto, bloqueios, revisão, previewToken curto)', cache: 'NONE', ok: 'AdminActionPreviewResponse', security: sec, errors: ADMIN_COMMAND_ERRORS,
    requestBody: { required: true, content: { 'application/json': { schema: ref('AdminCommandRequest') } } } });
  add('/api/v1/admin/commands/execute', 'post', { tags, summary: 'Executa o comando de domínio (revalida tudo; idempotente por idempotencyKey)', cache: 'NONE', ok: 'AdminCommandResultResponse', security: sec, errors: ADMIN_COMMAND_ERRORS,
    requestBody: { required: true, content: { 'application/json': { schema: ref('AdminCommandRequest') } } } });
}

/** JSON schemas of the DTOs (to be merged into shared/contracts/schemas.js at wiring time) */
const SCHEMAS = {
  AdminCommandEnvelope: { type: 'object', required: ['actionCode', 'organizationId', 'resourceRef', 'payload'], additionalProperties: false, properties: {
    commandId: { type: 'string', maxLength: 128 }, actionCode: { type: 'string', pattern: '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$' }, organizationId: { type: 'string', pattern: '^org_[a-z0-9_]{1,60}$' },
    resourceRef: { type: 'string', pattern: '^[a-z][a-z_]*:[A-Za-z0-9._:-]{1,128}$' }, expectedRevision: { type: 'string', nullable: true }, idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' },
    reason: { type: 'object', nullable: true, properties: { code: { type: 'string', enum: ['DATA_CORRECTION', 'CUSTOMER_REQUEST', 'COMMERCIAL_EXCEPTION', 'SECURITY_RESPONSE', 'PRIVACY_REQUEST', 'ROLLBACK', 'SYSTEM_RECOVERY', 'OTHER'] }, text: { type: 'string', maxLength: 500 } } },
    payload: { type: 'object' }, approvalRef: { type: 'string', nullable: true } } },
  AdminCommandRequest: { type: 'object', required: ['envelope'], properties: { envelope: { $ref: '#/components/schemas/AdminCommandEnvelope' }, previewToken: { type: 'string', nullable: true } } },
  AdminActionPreview: { type: 'object', required: ['actionCode', 'allowed', 'warnings', 'blockers', 'affectedEntities', 'requiredApprovals', 'expectedRevision', 'previewToken', 'expiresAt'], properties: {
    actionCode: { type: 'string' }, allowed: { type: 'boolean' }, warnings: { type: 'array', items: { type: 'string' } }, blockers: { type: 'array', items: { type: 'string' } }, affectedEntities: { type: 'array', items: { type: 'string' } },
    currentStateSummary: {}, proposedStateSummary: {}, requiredApprovals: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'string', nullable: true }, previewToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, auditLevel: { type: 'string' } } },
  AdminCommandResult: { type: 'object', required: ['commandId', 'actionCode', 'outcome', 'resourceRef'], properties: { commandId: { type: 'string' }, actionCode: { type: 'string' }, outcome: { type: 'string', enum: ['EXECUTED'] }, resourceRef: { type: 'string' },
    previousRevision: { type: 'string', nullable: true }, newRevision: { type: 'string', nullable: true }, result: {}, replayed: { type: 'boolean' } } }
};

module.exports = { addPaths, SCHEMAS, ADMIN_COMMAND_ERRORS };
