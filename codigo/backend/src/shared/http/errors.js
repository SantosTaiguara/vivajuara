'use strict';
/* Standard error model (ApiError). Clients always receive
     { code, message, details, requestId, traceId, timestamp }
   - code: stable semantic code from ERROR_CATALOG (clients branch on it, never on message);
   - message: human readable (pt-BR), never sensitive;
   - details: structured context (array of { field, reason, ... } issues, or an object), or null;
   - requestId: same value as the X-Request-Id response header;
   - traceId: alias of requestId kept for v1 clients that already read it (data/apiSource.js);
   - timestamp: ISO 8601 UTC.
   Some codes add documented top-level fields (REVISION_CONFLICT → currentRevision).
   Stack traces, SQL and internal paths never leave the server (they go to the log only). */
class AppError extends Error {
  constructor(status, code, message, details = null, extra = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
    this.expose = true;
  }
}

/** Catalog of every code the API can emit (documented in docs/API_ERRORS.md; a test keeps both in sync).
    Entries with `feature` belong to a round-5 module and can only be emitted while that FEATURE_* flag is on. */
const ERROR_CATALOG = Object.freeze({
  VALIDATION_ERROR: { status: 400, description: 'Parâmetro de rota, parâmetro de consulta desconhecido, corpo ou cabeçalho inválido.' },
  INVALID_FILTER: { status: [400, 422], description: 'Filtro, ordenação ou paginação inválidos: 400 quando malformado (tipo/formato), 422 quando bem formado mas semanticamente inválido (enum, faixa, mínimo > máximo, limite).' },
  INVALID_FIELD_KEY: { status: 422, description: 'fieldKey inexistente no Field Registry.' },
  UNAUTHORIZED: { status: 401, description: 'Não autenticado: credencial ausente onde é exigida (escrita/rota administrativa) ou Authorization: Bearer inválido, expirado, revogado ou de usuário não ativo (cabeçalho WWW-Authenticate). 401 = "quem é você?" não foi respondido.' },
  TENANT_CONTEXT_REQUIRED: { status: 400, description: 'Rota de organização sem organização ativa resolvível: usuário com mais de uma membership deve enviar X-Organization-Id.' },
  CSRF_TOKEN_INVALID: { status: 403, description: 'Escrita autenticada pelo cookie de sessão sem X-CSRF-Token válido (token de GET /api/v1/auth/session). Credenciais Bearer não precisam dele.' },
  LOGIN_FAILED: { status: 400, description: 'Retorno do login Google inválido: state ausente/expirado/diferente, code ausente, troca do code recusada, ID token inválido (assinatura, iss, aud, exp/iat) ou nonce reutilizado. Motivo detalhado só na auditoria/log.' },
  LOGIN_DENIED: { status: 403, description: 'Conta Google autenticada, mas recusada pela política: e-mail não verificado, domínio (hd) fora de ALLOWED_HD ou usuário suspenso/desativado.' },
  PERMISSION_DENIED: { status: 403, description: 'Autenticado, mas sem a permissão exigida pela rota no escopo do recurso (deny by default). 403 = "o que você pode fazer?" negado; details.permission traz a chave.' },
  ORGANIZATION_NOT_FOUND: { status: 404, description: 'X-Organization-Id inexistente ou sem membership ativa do principal (não revela se a organização existe).' },
  WRITES_DISABLED: { status: 403, description: 'Escrita desabilitada no ambiente: ADMIN_API_TOKEN não configurado (padrão) ou WRITES_ENABLED=false.' },
  CORS_ORIGIN_DENIED: { status: 403, description: 'Origem fora da allowlist CORS_ORIGINS (preflight).' },
  NOT_FOUND: { status: 404, description: 'Rota inexistente.' },
  DEVELOPMENT_NOT_FOUND: { status: 404, description: 'Empreendimento inexistente ou de outra organização / privado sem acesso (isolamento: mesma resposta, existência não é revelada).' },
  LOT_NOT_FOUND: { status: 404, description: 'Lote inexistente, fora do empreendimento da rota ou de empreendimento sem acesso (isolamento entre organizações).' },
  PRICE_TABLE_NOT_FOUND: { status: 404, description: 'Tabela de preço inexistente, não publicada ou de outro empreendimento; ou empreendimento sem tabela corrente.' },
  ANALYSIS_NOT_FOUND: { status: 404, description: 'Empreendimento sem versão de análise publicada.' },
  STATIC_VERSION_NOT_FOUND: { status: 404, description: 'Empreendimento sem versão estática publicada.' },
  METHOD_NOT_ALLOWED: { status: 405, description: 'Método HTTP não suportado na rota (cabeçalho Allow).' },
  REVISION_CONFLICT: { status: 409, description: 'expectedRevision diferente da revisão atual (concorrência otimista). Campo extra currentRevision.' },
  IDEMPOTENCY_KEY_REUSED: { status: 409, description: 'Idempotency-Key já usada (dentro da validade) com outra requisição (método, rota ou corpo diferentes).' },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: { status: 409, description: 'Outra requisição com a mesma Idempotency-Key ainda está em execução (Retry-After).' },
  PRICE_TABLE_VERSION_EXISTS: { status: 409, description: 'Já existe tabela de preço com esta versão (ou id); versões publicadas são imutáveis.' },
  PAYLOAD_TOO_LARGE: { status: 413, description: 'Corpo acima de BODY_LIMIT_BYTES.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, description: 'Corpo sem Content-Type: application/json.' },
  INVALID_AVAILABILITY_TRANSITION: { status: 422, description: 'Transição de status recusada pela máquina de estados compartilhada.' },
  INVALID_STATE: { status: 422, description: 'Estado de disponibilidade resultante inválido.' },
  FIELD_NOT_ALLOWED: { status: 422, description: 'Campo do comando não se aplica ao status informado.' },
  INVALID_PRICE_TABLE: { status: 422, description: 'Tabela de preço semanticamente inválida: lote inexistente ou repetido, lote sem preço, vigência invertida, fonte inexistente ou tentativa de alterar geometria/área.' },
  INVALID_METHODOLOGY: { status: 422, description: 'Metodologia candidata reprovada pela validação compartilhada (App.methodology.validate).' },
  ANALYSIS_INPUT_NOT_FOUND: { status: 404, description: 'Empreendimento sem medições de entrada do motor (analysis-input) importadas.' },
  RATE_LIMITED: { status: 429, description: 'Limite de requisições por IP excedido (Retry-After).' },
  INTERNAL_ERROR: { status: 500, description: 'Erro inesperado; detalhes somente no log, correlacionados por requestId.' },
  DATABASE_UNAVAILABLE: { status: 503, description: 'Banco de dados indisponível (Retry-After).' },
  AUTH_NOT_CONFIGURED: { status: 503, description: 'Login com Google não configurado neste ambiente (GOOGLE_CLIENT_ID ausente).' },
  NOT_READY: { status: 503, description: 'Readiness: banco indisponível (Retry-After).' },
  REQUEST_TIMEOUT: { status: 503, description: 'A requisição excedeu REQUEST_TIMEOUT_MS (Retry-After).' },
  INTELLIGENCE_UNAVAILABLE: { status: 503, description: 'Motor de inteligência não carregado no servidor (módulos intelligence/*.js ou configuração de scoring ausentes) (Retry-After).' },
  STREAM_LIMIT_REACHED: { status: 503, description: 'Limite de conexões simultâneas do stream de disponibilidade atingido (SSE_MAX_CLIENTS) (Retry-After).' },
  // ---- round 5 (topics 57-63): emitted only by routes of a module whose FEATURE_* flag is on (feature = the flag) ----
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, description: 'Escrita crítica exige Idempotency-Key.', feature: 'FEATURE_DEALS' },
  APPROVAL_SELF_DECISION_FORBIDDEN: { status: 403, description: 'Quem pediu a aprovação não pode decidi-la (separação de funções).', feature: 'FEATURE_DEALS' },
  PROPOSAL_NOT_FOUND: { status: 404, description: 'Proposta inexistente.', feature: 'FEATURE_DEALS' },
  RESERVATION_NOT_FOUND: { status: 404, description: 'Reserva inexistente.', feature: 'FEATURE_DEALS' },
  CLOSING_NOT_FOUND: { status: 404, description: 'Fechamento inexistente.', feature: 'FEATURE_DEALS' },
  CONTRACT_NOT_FOUND: { status: 404, description: 'Contrato inexistente.', feature: 'FEATURE_DEALS' },
  APPROVAL_NOT_FOUND: { status: 404, description: 'Pedido de aprovação inexistente.', feature: 'FEATURE_DEALS' },
  CHECKLIST_ITEM_NOT_FOUND: { status: 404, description: 'Item do checklist inexistente.', feature: 'FEATURE_DEALS' },
  CUSTOMER_NOT_FOUND: { status: 422, description: 'Proposta transacional exige cliente cadastrado (persistido).', feature: 'FEATURE_DEALS' },
  POLICY_NOT_CONFIGURED: { status: 422, description: 'Política comercial não configurada pela organização (necessita confirmação).', feature: 'FEATURE_DEALS' },
  COMMERCIAL_AUTHORITY_NOT_CONFIGURED: { status: 422, description: 'Autoridade do domínio comercial não definida (CommercialAuthorityMatrix necessita confirmação).', feature: 'FEATURE_DEALS' },
  COMMERCIAL_AUTHORITY_EXTERNAL: { status: 409, description: 'Este domínio é mantido por sistema externo: a plataforma não grava o estado oficial.', feature: 'FEATURE_DEALS' },
  PRICE_CONTEXT_INVALID: { status: 422, description: 'Sem preço de tabela vigente para o lote.', feature: 'FEATURE_DEALS' },
  PROPOSAL_INVALID: { status: 422, description: 'Proposta inválida: veja blockingErrors.', feature: 'FEATURE_DEALS' },
  PROPOSAL_EXPIRED: { status: 422, description: 'Proposta expirada: reemita uma nova versão ou nova proposta.', feature: 'FEATURE_DEALS' },
  PROPOSAL_VERSION_CONFLICT: { status: 409, description: 'A versão informada não é a versão corrente da proposta.', feature: 'FEATURE_DEALS' },
  PROPOSAL_NOT_ACCEPTABLE: { status: 422, description: 'A proposta não pode ser aceita neste estado.', feature: 'FEATURE_DEALS' },
  PROPOSAL_CONCURRENCY_CONFLICT: { status: 409, description: 'Já existe proposta ativa para este lote (política de concorrência).', feature: 'FEATURE_DEALS' },
  INVALID_PROPOSAL_TRANSITION: { status: 422, description: 'Transição de proposta não permitida.', feature: 'FEATURE_DEALS' },
  PROPOSAL_VERSION_IMMUTABLE: { status: 409, description: 'Versão emitida é imutável: crie nova versão.', feature: 'FEATURE_DEALS' },
  COMMERCIAL_APPROVAL_REQUIRED: { status: 422, description: 'Condição exige aprovação comercial antes de prosseguir.', feature: 'FEATURE_DEALS' },
  REASON_CODE_REQUIRED: { status: 422, description: 'Informe um código de motivo do registro.', feature: 'FEATURE_DEALS' },
  LOT_NOT_AVAILABLE: { status: 409, description: 'Lote não está disponível para reserva.', feature: 'FEATURE_DEALS' },
  LOT_AVAILABILITY_UNKNOWN: { status: 409, description: 'Disponibilidade do lote sem informação: confirme com a fonte oficial antes de reservar.', feature: 'FEATURE_DEALS' },
  LOT_ALREADY_RESERVED: { status: 409, description: 'Lote já reservado.', feature: 'FEATURE_DEALS' },
  AVAILABILITY_REVISION_CONFLICT: { status: 409, description: 'A disponibilidade mudou desde a leitura (expectedAvailabilityRevision): recarregue.', feature: 'FEATURE_DEALS' },
  AVAILABILITY_STALE: { status: 409, description: 'Disponibilidade desatualizada para ação crítica: atualize antes.', feature: 'FEATURE_DEALS' },
  RESERVATION_EXPIRED: { status: 409, description: 'Reserva expirada.', feature: 'FEATURE_DEALS' },
  RESERVATION_EXPIRY_INVALID: { status: 422, description: 'Prazo da reserva inválido ou acima do máximo da política.', feature: 'FEATURE_DEALS' },
  RESERVATION_EXTENSION_NOT_ALLOWED: { status: 422, description: 'Extensão de reserva não permitida pela política.', feature: 'FEATURE_DEALS' },
  INVALID_RESERVATION_TRANSITION: { status: 422, description: 'Transição de reserva não permitida.', feature: 'FEATURE_DEALS' },
  CLOSING_REQUIREMENTS_INCOMPLETE: { status: 422, description: 'Requisitos do fechamento incompletos.', feature: 'FEATURE_DEALS' },
  INVALID_CLOSING_TRANSITION: { status: 422, description: 'Transição de fechamento não permitida.', feature: 'FEATURE_DEALS' },
  CONTRACT_TEMPLATE_NOT_APPROVED: { status: 422, description: 'Modelo de contrato não aprovado/versionado pela organização.', feature: 'FEATURE_DEALS' },
  CONTRACT_VARIABLES_UNRESOLVED: { status: 422, description: 'Variáveis obrigatórias do modelo não resolvidas.', feature: 'FEATURE_DEALS' },
  CONTRACT_NOT_READY: { status: 422, description: 'Contrato não está pronto para esta operação.', feature: 'FEATURE_DEALS' },
  CONTRACT_VERSION_IMMUTABLE: { status: 409, description: 'Versão de contrato emitida/assinada é imutável: crie nova versão.', feature: 'FEATURE_DEALS' },
  SIGNATURE_INCOMPLETE: { status: 422, description: 'Assinatura não confirmada pelo provedor.', feature: 'FEATURE_DEALS' },
  SIGNATURE_WEBHOOK_INVALID: { status: 401, description: 'Webhook de assinatura com verificação inválida.', feature: 'FEATURE_DEALS' },
  SALE_COMPLETION_REQUIREMENTS_NOT_MET: { status: 422, description: 'Requisitos da conclusão de venda não atendidos.', feature: 'FEATURE_DEALS' },
  SALE_ALREADY_COMPLETED: { status: 409, description: 'Venda concluída não pode ser reaberta nem alterada.', feature: 'FEATURE_DEALS' },
  PRIVACY_RULE_DENIED: { status: 422, description: 'Regra de privacidade recusou a operação (sem base legal validada, aviso/checksum, verificação de identidade, transição, motivo de recusa…); código do domínio em details.reason. Não é parecer jurídico.', feature: 'FEATURE_PRIVACY' },
  CONFLICT: { status: 409, description: 'Conflito de estado/revisão/duplicata no onboarding (código do domínio em details.reason: SOURCE_DUPLICATE, REVISION_CONFLICT, IDEMPOTENCY…).', feature: 'FEATURE_ONBOARDING' },
  ADMIN_COMMAND_REJECTED: { status: 422, description: 'Comando administrativo recusado pela política (ação desconhecida/não suportada, política nula = necessita confirmação, bloqueio); motivo em details.reasonCode.', feature: 'FEATURE_BACKOFFICE' },
  GOOGLE_MAPS_NOT_CONFIGURED: { status: 503, description: 'Entorno ainda não configurado para este empreendimento.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_MAPS_LOCATION_UNVERIFIED: { status: 409, description: 'Coordenada oficial do empreendimento ainda não validada.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_PLACES_UNAVAILABLE: { status: 503, description: 'Dados do entorno temporariamente indisponíveis.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_PLACES_QUOTA_EXCEEDED: { status: 503, description: 'Dados do entorno temporariamente indisponíveis.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_PLACES_INVALID_REQUEST: { status: 502, description: 'Dados do entorno temporariamente indisponíveis.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_ROUTES_UNAVAILABLE: { status: 503, description: 'Não foi possível calcular o trajeto agora.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_ROUTES_QUOTA_EXCEEDED: { status: 503, description: 'Não foi possível calcular o trajeto agora.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_PROVIDER_AUTH_ERROR: { status: 503, description: 'Dados do entorno temporariamente indisponíveis.', feature: 'FEATURE_SURROUNDINGS' },
  GOOGLE_PROVIDER_RATE_LIMIT: { status: 503, description: 'Dados do entorno temporariamente indisponíveis.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_CATEGORY_UNSUPPORTED: { status: 422, description: 'Categoria de entorno não suportada.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_RADIUS_INVALID: { status: 422, description: 'Raio não permitido. Use 2, 4, 6 ou 8 km.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_PLACE_NOT_IN_SCOPE: { status: 422, description: 'Este local não foi retornado por uma busca do entorno deste empreendimento. Refaça a busca.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_POLICY_NOT_CONFIGURED: { status: 409, description: 'Política de validação de coordenada ainda não definida.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_CHANGE_INVALID: { status: 422, description: 'Alteração de coordenada inválida.', feature: 'FEATURE_SURROUNDINGS' },
  LOCATION_RATE_LIMITED: { status: 429, description: 'Muitas consultas ao entorno; tente novamente em instantes.', feature: 'FEATURE_SURROUNDINGS' }
});

const E = {
  badRequest: (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details),
  invalidFilter: (status, message, details) => new AppError(status, 'INVALID_FILTER', message, details),
  unauthorized: (message = 'Autenticação necessária (Authorization: Bearer <token>)') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (code, message) => new AppError(403, code || 'FORBIDDEN', message || 'Operação não permitida'),
  notFound: (message = 'Recurso não encontrado', details, code = 'NOT_FOUND') => new AppError(404, code, message, details),
  lotNotFound: lotId => new AppError(404, 'LOT_NOT_FOUND', 'Lote não encontrado', { lotId }),
  developmentNotFound: developmentId => new AppError(404, 'DEVELOPMENT_NOT_FOUND', 'Empreendimento não encontrado', { developmentId }),
  priceTableNotFound: (details, message = 'Tabela de preço não encontrada') => new AppError(404, 'PRICE_TABLE_NOT_FOUND', message, details),
  methodNotAllowed: allowed => new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido', { allowed }),
  conflict: (code, message, details, extra) => new AppError(409, code || 'CONFLICT', message, details, extra),
  payloadTooLarge: limit => new AppError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite', { limitBytes: limit }),
  unsupportedMedia: () => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json'),
  unprocessable: (code, message, details) => new AppError(422, code || 'UNPROCESSABLE_ENTITY', message, details),
  tooManyRequests: retryAfterSec => new AppError(429, 'RATE_LIMITED', 'Muitas requisições; tente novamente em instantes', { retryAfterSeconds: retryAfterSec }),
  unavailable: (code, message) => new AppError(503, code || 'SERVICE_UNAVAILABLE', message || 'Serviço temporariamente indisponível'),
  tenantRequired: (message, details) => new AppError(400, 'TENANT_CONTEXT_REQUIRED', message, details),
  timeout: () => new AppError(503, 'REQUEST_TIMEOUT', 'A requisição excedeu o tempo limite')
};

const isDbUnavailable = err => !!err && (err.code === 'ECONNREFUSED' || err.code === '57P01' || err.code === '57P03' || /timeout exceeded when trying to connect/i.test(err.message || ''));

/** Maps any thrown value to { status, body }. Unknown errors become a generic 500 (never the original message). */
function toErrorResponse(err, requestId, now = new Date()) {
  const body = (code, message, details = null, extra = null) => ({ ...(extra || {}), code, message, details: details ?? null, requestId, traceId: requestId, timestamp: now.toISOString() });
  if (err instanceof AppError) return { status: err.status, body: body(err.code, err.message, err.details, err.extra) };
  if (isDbUnavailable(err)) return { status: 503, body: body('DATABASE_UNAVAILABLE', 'Banco de dados indisponível') };
  return { status: 500, body: body('INTERNAL_ERROR', 'Erro interno') };
}

module.exports = { AppError, E, ERROR_CATALOG, toErrorResponse };
