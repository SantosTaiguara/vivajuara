'use strict';
/* Topic 58 — OpenAPI paths of the development onboarding admin API. NOT added to docs/openapi.json yet (the routes are not
   wired; tests/backend/api.openapi.test.js requires route↔path parity): the integrator calls addOnboardingPaths(add) inside
   scripts/lib/openapiDoc.js buildPaths when registerOnboardingRoutes is wired, then runs `npm run openapi:generate`.
   Domain refusal codes (SOURCE_DUPLICATE, DATA_QUALITY_BLOCKER, PUBLICATION_SEPARATION_OF_DUTIES…) travel in details.reason. */
const B = '/api/v1/admin/onboarding';
const ROUTES = [
  ['post', `${B}/cases`, 'Criar caso de onboarding (rascunho; nada é publicado)', 'development_onboarding.create'],
  ['get', `${B}/cases/{caseId}`, 'Caso de onboarding (estado, progresso, prontidão)', 'development_onboarding.read'],
  ['post', `${B}/cases/{caseId}/cancel`, 'Cancelar caso (estado terminal; não publica)', 'development_onboarding.create'],
  ['get', `${B}/cases/{caseId}/sources`, 'Inventário de fontes (checksum, versão, varredura, autoridade)', 'development_onboarding.read'],
  ['post', `${B}/cases/{caseId}/sources`, 'Enviar fonte imutável (base64; sha256; duplicata = SOURCE_DUPLICATE; nova versão substitui sem sobrescrever)', 'development_onboarding.upload_source'],
  ['post', `${B}/cases/{caseId}/authority`, 'Declarar fonte de autoridade por domínio', 'development_onboarding.map_schema'],
  ['post', `${B}/sources/{sourceId}/discover`, 'Descobrir schema e sugerir mapeamento (sugestão ≠ confirmação)', 'development_onboarding.map_schema'],
  ['patch', `${B}/sources/{sourceId}/mappings`, 'Atualizar/confirmar regras de mapeamento (expectedRevision obrigatório)', 'development_onboarding.map_schema'],
  ['post', `${B}/cases/{caseId}/batches`, 'Criar IngestionBatch idempotente (impressão digital das fontes + versões)', 'development_onboarding.map_schema'],
  ['post', `${B}/batches/{batchId}/run`, 'Executar pipeline (DRY_RUN | VALIDATE_ONLY | BUILD_CANDIDATE); gate de qualidade', 'development_onboarding.map_schema'],
  ['get', `${B}/batches/{batchId}`, 'Batch (estado, impressão digital, resumo de qualidade)', 'development_onboarding.read'],
  ['get', `${B}/batches/{batchId}/progress`, 'Progresso por estágio do pipeline', 'development_onboarding.read'],
  ['get', `${B}/cases/{caseId}/review-items`, 'Fila de revisão (identidade, geometria, conflito, status)', 'development_onboarding.read'],
  ['post', `${B}/review-items/{reviewId}/resolve`, 'Resolver item de revisão (motivo obrigatório)', 'development_onboarding.resolve_conflict'],
  ['post', `${B}/conflicts/{conflictId}/resolve`, 'Resolver DataConflict (fonte escolhida + motivo; auditado)', 'development_onboarding.resolve_conflict'],
  ['post', `${B}/batches/{batchId}/geometry-matches/{featureId}/approve`, 'Aprovar vínculo geometria↔lote', 'development_onboarding.review_geometry'],
  ['get', `${B}/cases/{caseId}/publication`, 'Estado da publicação (ponteiro, candidatos, aprovações, histórico)', 'development_onboarding.read'],
  ['post', `${B}/cases/{caseId}/publications/{publicationId}/decision`, 'Aprovar/rejeitar candidato (separação de funções: política null → aprovador ≠ solicitante)', 'development_onboarding.publish'],
  ['post', `${B}/cases/{caseId}/publications/{publicationId}/activate`, 'Ativar candidato (ponteiro atômico, expectedPointerRevision, idempotente)', 'development_onboarding.publish'],
  ['post', `${B}/cases/{caseId}/rollback`, 'Rollback do ponteiro (disponibilidade não é revertida automaticamente)', 'development_onboarding.rollback']
];
const ENVELOPE = { type: 'object', required: ['data', 'meta'], properties: { data: {}, meta: { type: 'object' } } };
const params = p => [...p.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', maxLength: 64 } }));
function addOnboardingPaths(add) {
  for (const [method, path, summary, permission] of ROUTES) {
    const write = method !== 'get';
    add(path, method, { tags: ['onboarding'], summary, description: `Permissão: \`${permission}\` (negação por padrão; recurso de outra organização = 404). Ainda não ligada ao router (tópico 58).`,
      ok: ENVELOPE, cache: 'NONE', security: [{ bearerAuth: [] }, { cookieAuth: [] }], extraParamsInline: params(path),
      requestBody: write ? { required: false, content: { 'application/json': { schema: { type: 'object' } } } } : undefined,
      errors: { 400: ['VALIDATION_ERROR'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED', ...(write ? ['CSRF_TOKEN_INVALID'] : [])], 404: ['NOT_FOUND'], ...(write ? { 409: ['CONFLICT'] } : {}) } });
  }
}
module.exports = { addOnboardingPaths, ROUTES, BASE: B };
