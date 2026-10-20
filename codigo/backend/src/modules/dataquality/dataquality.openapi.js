'use strict';
/* Topic 61 — OpenAPI paths of the data quality admin API (added by scripts/lib/openapiDoc.js through addDataQualityPaths(add)).
   Inline schemas (no edit of the shared contracts/schemas.js). Error codes are existing catalog codes; the domain refusal code
   (DQ_*) travels in details.reason. */
const ROUTES = [
  ['get', '/api/v1/admin/data-quality/health', 'Saúde por domínio (HEALTHY/DEGRADED/CRITICAL/UNKNOWN), scorecard dimensional, SLO (meta null = não configurado)', 'data_quality.read'],
  ['get', '/api/v1/admin/data-quality/findings', 'Fila de findings agrupados (filtros domain, severity, ruleId, status, ownerRef, developmentId)', 'data_quality.read'],
  ['get', '/api/v1/admin/data-quality/findings/{id}', 'Finding com regra, valor observado, condição esperada, linhagem e impacto', 'data_quality.read'],
  ['post', '/api/v1/admin/data-quality/findings/{id}/acknowledge', 'Reconhecer finding', 'data_quality.manage_findings'],
  ['post', '/api/v1/admin/data-quality/findings/{id}/resolve', 'Resolver finding (evidência + reexecução da regra obrigatórias)', 'data_quality.manage_findings'],
  ['post', '/api/v1/admin/data-quality/exceptions', 'Pedir exceção (motivo, risco, expiração obrigatória; regra bloqueante não aceita por padrão)', 'data_quality.create_exception'],
  ['post', '/api/v1/admin/data-quality/exceptions/{id}/approve', 'Aprovar exceção (quem pede não aprova)', 'data_quality.approve_exception'],
  ['get', '/api/v1/admin/data-quality/rules', 'Regras versionadas com modo efetivo (SHADOW/WARNING/ENFORCED)', 'data_quality.read'],
  ['post', '/api/v1/admin/data-quality/rules/{id}/run', 'Executar regra (job): devolve runId; erro de execução = UNKNOWN, nunca PASS', 'data_quality.run_checks'],
  ['post', '/api/v1/admin/data-quality/gates/evaluate', 'Gate de qualidade (ONBOARDING_BATCH, DEVELOPMENT_PUBLICATION, PRICE_TABLE_ACTIVATION, RESERVATION, PROPOSAL_SUBMIT…) → PASS | BLOCK | REVIEW', 'data_quality.run_checks'],
  ['get', '/api/v1/admin/data-quality/incidents', 'Incidentes de dados (SEV1–SEV4)', 'data_quality.read'],
  ['post', '/api/v1/admin/data-quality/incidents', 'Abrir incidente de dados', 'data_quality.manage_incident'],
  ['get', '/api/v1/admin/data-governance/contracts', 'Contratos de dados (schema, semântica, nulos, unidades, compatibilidade)', 'data_quality.read'],
  ['get', '/api/v1/admin/data-governance/catalog', 'Catálogo semântico (gerado do Field Registry), owners, fontes de autoridade, glossário, limitações', 'data_quality.read']
];
const ENVELOPE = { type: 'object', required: ['data', 'meta'], properties: { data: {}, meta: { type: 'object' } } };
function addDataQualityPaths(add) {
  for (const [method, path, summary, permission] of ROUTES) {
    const write = method === 'post';
    add(path, method, { tags: ['data-quality'], summary, description: `Permissão: \`${permission}\` (negação por padrão; recurso de outra organização = 404). Ainda não ligada ao router (tópico 61).`,
      ok: ENVELOPE, cache: 'NONE', security: [{ bearerAuth: [] }, { cookieAuth: [] }],
      extraParamsInline: path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', maxLength: 64 } }] : [],
      requestBody: write ? { required: false, content: { 'application/json': { schema: { type: 'object' } } } } : undefined,
      errors: { 400: ['VALIDATION_ERROR'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED', ...(write ? ['CSRF_TOKEN_INVALID'] : [])], 404: ['NOT_FOUND'] } });
  }
}
module.exports = { addDataQualityPaths, ROUTES };
