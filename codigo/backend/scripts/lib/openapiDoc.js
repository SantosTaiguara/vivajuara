'use strict';
/* Builds docs/openapi.json from the code contracts:
   - components.schemas: DTO schemas from src/shared/contracts/schemas.js (+ the hand-written v1.0 snapshot schemas
     listed in LEGACY_SCHEMAS, kept from the current file);
   - paths: the route table below; list/search query parameters come from the same specs the controllers validate
     with (modules/lots/lots.query.js), error codes from the error catalog.
   Deterministic: building twice gives the same file (tests/backend/api.openapi.test.js checks there is no drift). */
const { buildSchemas, API_VERSION, CONTRACT_VERSION } = require('../../src/shared/contracts/schemas');
const { ERROR_CATALOG } = require('../../src/shared/http/errors');
const lq = require('../../src/modules/lots/lots.query');
const { DEVELOPMENT_ID_RE, LOT_ID_RE, PRICE_TABLE_ID_RE } = require('../../src/shared/validation');

const LEGACY_SCHEMAS = ['Ready', 'StaticSnapshot', 'AnalysisSnapshot', 'CommercialSnapshot', 'AvailabilitySnapshot', 'AvailabilityState', 'DevelopmentConfigDto',
  'AssetDto', 'AssetsResponse', 'UpdateAvailabilityRequest', 'AvailabilityHistoryResponse'];

const CACHE_TEXT = {
  PRIVATE: 'private, no-store',
  STATIC: 'public, max-age=86400, stale-while-revalidate=604800', VERSIONED: 'public, max-age=300, must-revalidate', DYNAMIC: 'no-cache', NONE: 'no-store'
};
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const pref = name => ({ $ref: `#/components/parameters/${name}` });
const href = name => ({ $ref: `#/components/headers/${name}` });

/** parseQuery spec entry → OpenAPI query parameter */
function queryParam(name, s, description) {
  let schema;
  if (s.type === 'int') schema = { type: 'integer' };
  else if (s.type === 'number') schema = { type: 'number' };
  else if (s.type === 'boolean') schema = { type: 'boolean' };
  else if (s.type === 'enum') schema = { type: 'string', enum: s.enum };
  else if (s.type === 'enumList') schema = { type: 'array', items: { type: 'string', enum: s.enum }, ...(s.maxItems ? { maxItems: s.maxItems } : {}) };
  else schema = { type: 'string', ...(s.pattern ? { pattern: s.pattern.source } : {}), ...(s.maxLength ? { maxLength: s.maxLength } : {}) };
  if (s.min != null) schema.minimum = s.min;
  if (s.max != null) schema.maximum = s.max;
  if (s.default != null) schema.default = s.default;
  const p = { name, in: 'query', required: false, description, schema };
  if (s.type === 'enumList') { p.style = 'form'; p.explode = false; }
  return p;
}

function listQueryParams(App) {
  const spec = lq.listQuerySpec(App);
  const d = {
    status: 'Status de disponibilidade (lista separada por vírgula).', block: 'Quadra(s), ex.: B ou A,B.', minArea: 'Área mínima (m²).', maxArea: 'Área máxima (m²).',
    minPrice: 'Preço mínimo (BRL). Lotes sem preço nunca entram em filtros de preço.', maxPrice: 'Preço máximo (BRL).', class: 'Classe(s) da análise.',
    minHousingScore: 'Score Moradia mínimo (0–100).', noiseLevel: 'Nível de ruído estimado (lista).', privacyLevel: 'Nível de privacidade estimado (lista).',
    corner: 'true = somente esquinas; false = sem esquinas.', search: 'Busca central (mesmo parser do frontend): "79", "L79", "Q B L79", "B79", "VJ-QB-L0079".',
    sortBy: 'Ordenação (whitelist). code = quadra + número (padrão); distanceToGateM = mobility.routeDistanceToGateM (rota de carro). Nulos sempre no fim.',
    sortDirection: 'asc | desc', page: 'Página (≥ 1).', pageSize: `Itens por página (1–${lq.PAGE_SIZE_MAX}, padrão ${lq.PAGE_SIZE_DEFAULT}).`
  };
  return Object.entries(spec).map(([k, s]) => queryParam(k, s, `${d[k] || ''}${lq.FILTER_FIELDS[k] ? ` — fieldKey ${lq.FILTER_FIELDS[k]}` : lq.SORT_FIELDS[k] ? '' : ''}`.trim()));
}

function errorResponse(status, codes) {
  const out = { description: codes.join(', '), headers: { 'X-Request-Id': href('RequestId') }, content: { 'application/json': { schema: ref('ApiError') } } };
  if (status === 429 || status === 503) out.headers['Retry-After'] = href('RetryAfter');
  if (status === 405) out.headers.Allow = { schema: { type: 'string' } };
  return out;
}

/** op({ ... }) → OpenAPI operation */
function op({ tags, summary, description, params = [], query = [], extraParams = [], extraParamsInline = [], ok, okStatus = 200, okDescription = 'OK', okHeaders = {}, okContent = null, extraOk = {}, cache, etag = false, errors = {}, requestBody, security, deprecated }) {
  const headers = { 'X-Request-Id': href('RequestId'), 'Cache-Control': { description: CACHE_TEXT[cache], schema: { type: 'string', example: CACHE_TEXT[cache] } }, ...okHeaders };
  if (etag) headers.ETag = href('ETag');
  const responses = { [okStatus]: { description: okDescription, headers, content: okContent || { 'application/json': { schema: typeof ok === 'string' ? ref(ok) : ok } } } };
  for (const [st, x] of Object.entries(extraOk)) responses[st] = { description: x.description, headers: { 'X-Request-Id': href('RequestId'), 'Cache-Control': headers['Cache-Control'], ...(x.headers || {}) }, content: { 'application/json': { schema: ref(x.ok) } } };
  if (etag) responses[304] = { description: 'Not Modified (If-None-Match coincide com o ETag atual)', headers: { ETag: href('ETag') } };
  const all = { ...errors, 429: ['RATE_LIMITED'], 500: ['INTERNAL_ERROR'], 503: [...new Set([...(errors[503] || []), 'DATABASE_UNAVAILABLE', 'REQUEST_TIMEOUT'])] };
  for (const [st, codes] of Object.entries(all)) responses[st] = errorResponse(Number(st), codes);
  const o = { tags, summary, description: `${description ? description + '\n\n' : ''}Cache-Control: \`${CACHE_TEXT[cache]}\`${etag ? ' + ETag (If-None-Match → 304)' : ''}.`, parameters: [...params.map(pref), ...query, ...extraParams.map(pref), ...extraParamsInline] };
  if (etag) o.parameters.push(pref('IfNoneMatch'));
  if (requestBody) o.requestBody = requestBody;
  o.security = security || [];
  if (deprecated) o.deprecated = true;
  o.responses = responses;
  return o;
}

const DEV = ['DevelopmentId'], LOT = ['LotId'];
const E400 = ['VALIDATION_ERROR'];
const DEV404 = ['DEVELOPMENT_NOT_FOUND'];
// admin (write) routes: bearer token, Idempotency-Key, larger body limit
const ADMIN_ERRORS = { 401: ['UNAUTHORIZED'], 403: ['WRITES_DISABLED', 'PERMISSION_DENIED', 'CSRF_TOKEN_INVALID'], 409: ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_REQUEST_IN_PROGRESS'], 413: ['PAYLOAD_TOO_LARGE'], 415: ['UNSUPPORTED_MEDIA_TYPE'] };
const ADMIN_TEXT = 'Rota administrativa: exige `Authorization: Bearer <token>` — ADMIN_API_TOKEN (principal SYSTEM) ou token de usuário (AUTH_DEV_TOKENS, somente dev/test) com a permissão da rota no escopo do empreendimento (sem credencial configurada no servidor → 403 WRITES_DISABLED; token ausente/errado → 401 UNAUTHORIZED; sem permissão → 403 PERMISSION_DENIED; empreendimento de outra organização → 404; tudo verificado antes de ler o corpo). Aceita `Idempotency-Key` (8–128 caracteres `[A-Za-z0-9._:-]`, validade IDEMPOTENCY_TTL_SECONDS, padrão 24 h): mesma chave + mesma requisição → resposta armazenada reenviada (cabeçalho Idempotent-Replayed: true); mesma chave + corpo diferente → 409 IDEMPOTENCY_KEY_REUSED. Corpo até ADMIN_BODY_LIMIT_BYTES (padrão 256 KB).';
const merge = (...maps) => maps.reduce((acc, m) => { for (const [k, v] of Object.entries(m)) acc[k] = [...new Set([...(acc[k] || []), ...v])]; return acc; }, {});

function buildPaths(App) {
  const P = {};
  const add = (path, method, o) => { P[path] = P[path] || {}; P[path][method] = op(o); };
  add('/health', 'get', { tags: ['health'], summary: 'Liveness (não toca no banco)', ok: 'Health', cache: 'NONE' });
  add('/health/live', 'get', { tags: ['health'], summary: 'Liveness mínima (só o processo; sem versão nem dependências)', ok: 'Live', cache: 'NONE' });
  add('/health/ready', 'get', { tags: ['health'], summary: 'Readiness: banco + versão do schema', ok: 'Ready', cache: 'NONE', errors: { 503: ['NOT_READY'] } });

  add('/api/v1/developments', 'get', { tags: ['developments'], summary: 'Lista empreendimentos (DevelopmentDto[], paginado)', cache: 'DYNAMIC', etag: true, ok: 'DevelopmentListResponse',
    query: [queryParam('page', { type: 'int', min: 1, max: 100000, default: 1 }, 'Página (≥ 1).'), queryParam('pageSize', { type: 'int', min: 1, max: 100, default: 20 }, 'Itens por página (1–100).')],
    errors: { 400: ['VALIDATION_ERROR', 'INVALID_FILTER'], 422: ['INVALID_FILTER'] } });
  add('/api/v1/developments/{developmentId}', 'get', { tags: ['developments'], summary: 'Resumo do empreendimento (DevelopmentDto)', params: DEV, cache: 'DYNAMIC', etag: true, ok: 'DevelopmentResponse', errors: { 400: E400, 404: DEV404 } });
  add('/api/v1/developments/{developmentId}/config', 'get', { tags: ['developments'], summary: 'Configuração pública/operacional (DevelopmentConfigDto, mesmo formato de config/developments.js)',
    description: 'Inclui camada padrão do mapa (map.defaultLayer), features habilitadas, availabilityPolicy, freshnessPolicy, fontes e tabelas publicadas. Contrato v1.0 sem envelope.',
    params: DEV, cache: 'VERSIONED', etag: true, ok: 'DevelopmentConfigDto', errors: { 400: E400, 404: DEV404 } });
  add('/api/v1/developments/{developmentId}/manifest', 'get', { tags: ['developments'], summary: 'Manifesto de versões correntes (ManifestDto)',
    description: 'Clientes comparam o manifesto para decidir o que buscar de novo. ETag muda quando qualquer camada muda.', params: DEV, cache: 'DYNAMIC', etag: true, ok: 'ManifestResponse', errors: { 400: E400, 404: DEV404 } });
  add('/api/v1/developments/{developmentId}/sources', 'get', { tags: ['sources'], summary: 'Catálogo de fontes de dados (proveniência)', params: DEV, cache: 'VERSIONED', etag: true, ok: 'SourcesResponse', errors: { 400: E400, 404: DEV404 } });

  add('/api/v1/developments/{developmentId}/map-lots', 'get', { tags: ['lots'], summary: 'Payload enxuto do mapa (MapLotDto[], todos os lotes, sem paginação)',
    description: 'Uma única consulta (sem N+1): estático + resumo da análise + disponibilidade + resumo comercial. Contrato v1.0 sem envelope; staticVersion em versions.',
    params: DEV, cache: 'DYNAMIC', etag: true, ok: 'MapLotsResponse', errors: { 400: E400, 404: [...DEV404, 'STATIC_VERSION_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/lots', 'get', { tags: ['lots'], summary: 'Lista paginada de lotes com filtros canônicos (LotQuickViewDto[])',
    description: 'Filtros, ordenação e paginação no servidor (uma consulta). Parâmetro desconhecido → 400 VALIDATION_ERROR; valor malformado → 400 INVALID_FILTER; enum inválido, faixa invertida (min > max) ou pageSize acima do máximo → 422 INVALID_FILTER.',
    params: DEV, query: listQueryParams(App), cache: 'DYNAMIC', etag: true, ok: 'LotListResponse', errors: { 400: ['VALIDATION_ERROR', 'INVALID_FILTER'], 404: [...DEV404, 'STATIC_VERSION_NOT_FOUND'], 422: ['INVALID_FILTER'] } });
  const sq = { q: { type: 'string', maxLength: lq.SEARCH_MAX_LENGTH }, limit: { type: 'int', min: 1, max: lq.SEARCH_LIMIT_MAX, default: lq.SEARCH_LIMIT_DEFAULT } };
  add('/api/v1/developments/{developmentId}/lots/search', 'get', { tags: ['lots'], summary: 'Busca de lote (parser central do frontend)',
    description: 'Aceita "79", "L79", "Lote 79", "Q B L79", "QB L79", "B79", "VJ-QB-L0079". Um lote único nunca é adivinhado de uma consulta ambígua (kind = multi).',
    params: DEV, query: [{ ...queryParam('q', sq.q, 'Termo de busca (obrigatório).'), required: true }, queryParam('limit', sq.limit, 'Máximo de resultados.')],
    cache: 'DYNAMIC', etag: true, ok: 'LotSearchResponse', errors: { 400: ['VALIDATION_ERROR', 'INVALID_FILTER'], 404: DEV404, 422: ['INVALID_FILTER'] } });

  add('/api/v1/developments/{developmentId}/lots/static', 'get', { tags: ['lots'], summary: 'StaticSnapshot (contrato data/lifecycle.js do frontend)', params: DEV, cache: 'STATIC', etag: true, ok: 'StaticSnapshot',
    errors: { 400: E400, 404: [...DEV404, 'STATIC_VERSION_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/analysis/current', 'get', { tags: ['analysis'], summary: 'AnalysisSnapshot da versão de análise corrente', params: DEV, cache: 'VERSIONED', etag: true, ok: 'AnalysisSnapshot',
    errors: { 400: E400, 404: [...DEV404, 'ANALYSIS_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/analysis/preview', 'post', { tags: ['analysis'], summary: 'Prévia de análise (admin): relatório de impacto de uma metodologia candidata, sem publicar',
    description: `Roda o mesmo IntelligenceEngine do frontend (plat/src/intelligence/*.js + plat/config/scoring) sobre as medições de entrada armazenadas e devolve App.methodology.impact(publicada, candidata): scores, classes, rankings e alertas que mudariam, mudança em massa. Sem methodology no corpo, a candidata é a publicada (impacto zero). publishedParity compara a metodologia publicada com a análise publicada armazenada. Nada é gravado. ${ADMIN_TEXT}`,
    params: DEV, ok: 'AnalysisPreviewResponse', okHeaders: { 'Idempotent-Replayed': href('IdempotentReplayed') },
    requestBody: { required: true, content: { 'application/json': { schema: ref('AnalysisPreviewRequest'), example: {} } } },
    security: [{ bearerAuth: [] }], cache: 'NONE', extraParams: ['IdempotencyKey'],
    errors: merge(ADMIN_ERRORS, { 400: E400, 404: [...DEV404, 'ANALYSIS_INPUT_NOT_FOUND'], 422: ['INVALID_METHODOLOGY'], 503: ['INTELLIGENCE_UNAVAILABLE'] }) });
  add('/api/v1/developments/{developmentId}/commercial/current', 'get', { tags: ['commercial'], summary: 'CommercialSnapshot da tabela corrente (preço + priceTableVersion por lote)', params: DEV, cache: 'VERSIONED', etag: true, ok: 'CommercialSnapshot',
    errors: { 400: E400, 404: [...DEV404, 'PRICE_TABLE_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/commercial/price-tables/current', 'get', { tags: ['commercial'], summary: 'Tabela de preço corrente com planos (PriceTableDto, sem envelope)', params: DEV, cache: 'VERSIONED', etag: true, ok: 'PriceTableDto',
    errors: { 400: E400, 404: [...DEV404, 'PRICE_TABLE_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/price-tables', 'post', { tags: ['commercial'], summary: 'Publica uma nova versão de tabela de preço (admin); ?dryRun=true devolve só o diff por lote',
    description: `Preço = área × R$/m² arredondado ao centavo (mesma regra do frontend, App.repos.CommercialRepository.commercialFor), ou preço por lote (R$/m² derivado). Validação estrita: números positivos e finitos com até 2 casas, todo lote referenciado existe no empreendimento, sem lote repetido, sem alteração de geometria/área, vigência coerente. Publicação: nova versão imutável (PUBLISHED, publishedBy/publishedAt), planos copiados da tabela corrente, preço de todos os lotes, tabela anterior ARCHIVED (continua legível por id) e ponteiro corrente movido — tudo numa transação. dryRun=true: mesma validação e cálculo, nada é gravado (200). ${ADMIN_TEXT}`,
    params: DEV, query: [queryParam('dryRun', { type: 'boolean', default: false }, 'true = somente calcula o diff por lote, sem gravar.')], okStatus: 201, okDescription: 'Publicada (Location aponta a nova tabela)', ok: 'PriceTablePublicationResponse',
    okHeaders: { Location: href('Location'), 'Idempotent-Replayed': href('IdempotentReplayed') }, extraOk: { 200: { description: 'dryRun=true: diff por lote, nada gravado', ok: 'PriceTablePublicationResponse', headers: { 'Idempotent-Replayed': href('IdempotentReplayed') } } },
    requestBody: { required: true, content: { 'application/json': { schema: ref('PublishPriceTableRequest'), example: { version: '2026-11-01', pricePerM2: 1250, validFrom: '2026-11-01', changeReason: 'Reajuste de novembro' } } } },
    security: [{ bearerAuth: [] }], cache: 'NONE', extraParams: ['IdempotencyKey'],
    errors: merge(ADMIN_ERRORS, { 400: E400, 404: [...DEV404, 'STATIC_VERSION_NOT_FOUND'], 409: ['PRICE_TABLE_VERSION_EXISTS'], 422: ['INVALID_PRICE_TABLE'] }) });
  add('/api/v1/developments/{developmentId}/price-tables/{priceTableId}', 'get', { tags: ['commercial'], summary: 'Tabela de preço por id (PUBLISHED ou ARCHIVED, escopada ao empreendimento)',
    params: [...DEV, 'PriceTableId'], cache: 'VERSIONED', etag: true, ok: 'PriceTableResponse', errors: { 400: E400, 404: [...DEV404, 'PRICE_TABLE_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/availability', 'get', { tags: ['availability'], summary: 'AvailabilitySnapshot (revision + status por lote)',
    description: 'Payload rápido e frequente. ETag por revisão. Contrato v1.0 sem envelope (consumido pelo ApiLotSource).', params: DEV, cache: 'DYNAMIC', etag: true, ok: 'AvailabilitySnapshot', errors: { 400: E400, 404: DEV404 } });
  add('/api/v1/developments/{developmentId}/availability/stream', 'get', { tags: ['availability'], summary: 'Stream de mudanças de disponibilidade (Server-Sent Events)',
    description: 'Conexão `text/event-stream` aberta. Cada nova availabilityRevision gera `id: <revision>`, `event: availability`, `data: AvailabilityStreamEvent` (JSON, somente campos públicos: nunca proposalId nem notes). Detecção por PostgreSQL LISTEN/NOTIFY (gatilho na revisão, entregue no COMMIT) + verificação periódica de segurança (SSE_POLL_INTERVAL_MS). `Last-Event-ID` (ou ?lastEventId=) retoma após reconexão com os lotes alterados desde aquela revisão; sem ele, o primeiro evento traz a revisão atual com resync=true. Comentários `: heartbeat` a cada SSE_HEARTBEAT_MS; `retry:` sugerido ao cliente. Limite de conexões: SSE_MAX_CLIENTS.',
    params: [...DEV, 'LastEventId'], query: [queryParam('lastEventId', { type: 'int', min: 0 }, 'Alternativa ao cabeçalho Last-Event-ID (clientes que não definem cabeçalhos).')], cache: 'NONE',
    okContent: { 'text/event-stream': { schema: { type: 'string', description: 'Eventos SSE; o campo data de cada evento `availability` segue AvailabilityStreamEvent.', example: 'retry: 3000\n\nid: 185\nevent: availability\ndata: {"developmentId":"viva-juara","availabilityRevision":185,...}\n\n: heartbeat\n\n' }, 'x-event-data': ref('AvailabilityStreamEvent') } },
    errors: { 400: E400, 404: DEV404, 503: ['STREAM_LIMIT_REACHED'] } });
  add('/api/v1/developments/{developmentId}/assets', 'get', { tags: ['assets'], summary: 'Metadados de assets (planta, aérea, logo…; sem binários)', params: DEV, cache: 'VERSIONED', etag: true, ok: 'AssetsResponse', errors: { 400: E400, 404: DEV404 } });

  add('/api/v1/lots/batch-summary', 'post', { tags: ['lots'], summary: 'Resumo de vários lotes (comparação, favoritos)', okDescription: 'Lotes encontrados na ordem pedida; ids inexistentes em meta.notFound',
    requestBody: { required: true, content: { 'application/json': { schema: ref('BatchSummaryRequest'), example: { ids: ['VJ-QB-L0079', 'VJ-QA-L0001'] } } } },
    cache: 'NONE', ok: 'BatchSummaryResponse', errors: { 400: E400, 413: ['PAYLOAD_TOO_LARGE'], 415: ['UNSUPPORTED_MEDIA_TYPE'] } });
  add('/api/v1/lots/{lotId}', 'get', { tags: ['lots'], summary: 'Ficha do lote (LotDetailDto em data; lot/versions v1.0 deprecated)', params: LOT, cache: 'DYNAMIC', etag: true, ok: 'LotDetailResponse',
    errors: { 400: E400, 404: ['LOT_NOT_FOUND', 'STATIC_VERSION_NOT_FOUND'] } });
  add('/api/v1/lots/{lotId}/summary', 'get', { tags: ['lots'], summary: 'Quick View do lote (LotQuickViewDto)', params: LOT, cache: 'DYNAMIC', etag: true, ok: 'LotQuickViewResponse', errors: { 400: E400, 404: ['LOT_NOT_FOUND'] } });
  add('/api/v1/lots/{lotId}/analysis', 'get', { tags: ['analysis'], summary: 'Scores, classe, alertas, destaques, ranking e analysisVersion do lote', params: LOT, cache: 'VERSIONED', etag: true, ok: 'LotAnalysisResponse',
    errors: { 400: E400, 404: ['LOT_NOT_FOUND', 'ANALYSIS_NOT_FOUND'] } });
  add('/api/v1/lots/{lotId}/commercial', 'get', { tags: ['commercial'], summary: 'Preço atual e condições aplicáveis ao lote', params: LOT, cache: 'VERSIONED', etag: true, ok: 'LotCommercialResponse',
    errors: { 400: E400, 404: ['LOT_NOT_FOUND', 'PRICE_TABLE_NOT_FOUND'] } });
  P['/api/v1/lots/{lotId}/availability'] = {
    get: op({ tags: ['availability'], summary: 'Disponibilidade pública do lote (AvailabilityDto)', params: LOT, cache: 'DYNAMIC', etag: true, ok: 'AvailabilityResponse', errors: { 400: E400, 404: ['LOT_NOT_FOUND'] } }),
    patch: op({ tags: ['availability'], summary: 'Atualiza o status comercial (escrita controlada; DESABILITADA sem ADMIN_API_TOKEN)',
      description: `Transação: lock → expectedRevision (409 REVISION_CONFLICT com currentRevision) → máquina de estados compartilhada (422) → status + histórico + audit_log (actor "admin") → NOTIFY para o stream de disponibilidade. Nunca repetida automaticamente pelo cliente sem Idempotency-Key. ${ADMIN_TEXT}`,
      params: LOT, requestBody: { required: true, content: { 'application/json': { schema: ref('UpdateAvailabilityRequest'), example: { status: 'RESERVED', expectedRevision: 184, reservedUntil: '2026-10-31T23:59:59Z' } } } },
      security: [{ bearerAuth: [] }], cache: 'NONE', ok: 'UpdateAvailabilityResponse', okHeaders: { 'Idempotent-Replayed': href('IdempotentReplayed') }, extraParams: ['IdempotencyKey'],
      errors: merge(ADMIN_ERRORS, { 400: E400, 404: ['LOT_NOT_FOUND'], 409: ['REVISION_CONFLICT'], 422: ['INVALID_AVAILABILITY_TRANSITION', 'INVALID_STATE', 'FIELD_NOT_ALLOWED'] }) })
  };
  add('/api/v1/lots/{lotId}/availability/history', 'get', { tags: ['availability'], summary: 'Histórico de status do lote', params: LOT, cache: 'DYNAMIC', ok: 'AvailabilityHistoryResponse', errors: { 400: E400, 404: ['LOT_NOT_FOUND'] } });
  add('/api/v1/lots/{lotId}/provenance', 'get', { tags: ['sources'], summary: 'Proveniência por atributo (auditoria técnica)',
    description: 'Para cada campo armazenado: status, fonte, método, confiança (padrão do Field Registry ou específico do lote). Filtre com fieldKey.',
    params: LOT, query: [queryParam('fieldKey', { type: 'string', pattern: /^[a-zA-Z]+(\.[a-zA-Z0-9]+){1,3}$/, maxLength: 96 }, 'fieldKey canônico, ex.: geometry.areaM2')],
    cache: 'DYNAMIC', etag: true, ok: 'LotProvenanceResponse', errors: { 400: ['VALIDATION_ERROR', 'INVALID_FILTER'], 404: ['LOT_NOT_FOUND'], 422: ['INVALID_FIELD_KEY'] } });

  // ---- identity & access (topic 30), tenancy (topic 31), price history (topic 28), availability manifest (topic 29) — 1.3.0
  const ORG_HEADER = { name: 'X-Organization-Id', in: 'header', required: false, description: 'Seletor da organização ativa (validado contra as memberships do principal; nunca é autorização por si só).', schema: { type: 'string', pattern: '^org_[a-z0-9_]{2,60}$', example: 'org_house7' } };
  add('/api/v1/me', 'get', { tags: ['iam'], summary: 'Principal atual: usuário, organização ativa, roles e permissões efetivas (MeDto)',
    description: 'Sem Authorization → 200 com principal ANONYMOUS e as permissões públicas (válidas só em empreendimentos PUBLIC). Token inválido/expirado/revogado → 401. Fonte de verdade do contrato de acesso do frontend; esconder botão não é segurança.',
    extraParamsInline: [ORG_HEADER], cache: 'PRIVATE', ok: 'MeResponse', errors: { 400: E400, 401: ['UNAUTHORIZED'], 404: ['ORGANIZATION_NOT_FOUND'] }, security: [{}, { bearerAuth: [] }, { cookieAuth: [] }] });

  // ---- login Google (OIDC Authorization Code + PKCE) e sessão por cookie — fase W3, contrato 1.4.0
  const LOC = { Location: href('Location') };
  add('/api/v1/auth/google/start', 'get', { tags: ['auth'], summary: 'Inicia o login com Google (302 para accounts.google.com)',
    description: 'Gera state, nonce e code_verifier (PKCE S256) e os guarda cifrados (AES-256-GCM) no cookie HttpOnly `plat_oauth` (Path do callback, 10 min). `returnTo` só é aceito numa origem de AUTH_APP_URL/CORS_ORIGINS; senão vale AUTH_APP_URL. Navegação de página inteira (não use fetch).',
    query: [queryParam('returnTo', { type: 'string', maxLength: 2048 }, 'URL do painel para onde voltar depois do login (origem permitida).')],
    okStatus: 302, okDescription: 'Redireciona para o Google', okHeaders: LOC, ok: 'AuthRedirectResponse', cache: 'NONE', errors: { 400: E400, 503: ['AUTH_NOT_CONFIGURED'] } });
  add('/api/v1/auth/google/callback', 'get', { tags: ['auth'], summary: 'Retorno do Google: valida state, troca o code (PKCE), verifica o ID token e cria a sessão',
    description: 'ID token RS256 verificado com o JWKS do Google (iss, aud = GOOGLE_CLIENT_ID, exp/iat, nonce de uso único, email_verified, hd quando ALLOWED_HD). Conta sem convite → sessão autenticada SEM permissão de organização (negação por padrão). Convite pendente para o e-mail verificado → membership + role na organização do convite. Sessão nova a cada login (rotação), cookie HttpOnly + Secure + SameSite=Lax. Com AUTH_APP_URL/returnTo: 302 de volta ao painel (falha: `?login=erro` ou `?login=negado`); sem URL de retorno: JSON.',
    query: [queryParam('code', { type: 'string', maxLength: 2048 }, 'Código de autorização do Google.'), queryParam('state', { type: 'string', maxLength: 128 }, 'Mesmo state enviado no início.'), queryParam('error', { type: 'string', maxLength: 128 }, 'Erro informado pelo Google (ex.: access_denied).')],
    okStatus: 302, okDescription: 'Volta ao painel (sucesso ou falha sinalizada em ?login=)', okHeaders: LOC, ok: 'AuthRedirectResponse',
    extraOk: { 200: { description: 'Sem URL de retorno configurada: sessão criada', ok: 'AuthSessionResponse' } }, cache: 'NONE',
    errors: { 400: ['VALIDATION_ERROR', 'LOGIN_FAILED'], 403: ['LOGIN_DENIED'], 503: ['AUTH_NOT_CONFIGURED'] } });
  add('/api/v1/auth/session', 'get', { tags: ['auth'], summary: 'Estado da sessão por cookie e token CSRF (sincronizador)',
    description: 'Sem dados pessoais (nome e permissões vêm de GET /me). `csrfToken` deve ir em `X-CSRF-Token` em toda escrita autenticada pelo cookie; só origens permitidas conseguem lê-lo (CORS com credenciais). Sessão expirada/revogada → authenticated=false e o cookie é apagado.',
    cache: 'NONE', ok: 'AuthSessionResponse', errors: { 400: E400 }, security: [{}, { cookieAuth: [] }] });
  add('/api/v1/auth/logout', 'post', { tags: ['auth'], summary: 'Encerra a sessão (revoga no servidor e apaga o cookie)',
    description: 'Com cookie de sessão exige `X-CSRF-Token` (senão 403 CSRF_TOKEN_INVALID). Idempotente: sem sessão, só apaga o cookie (revoked=false). Auditado (AUTH_LOGOUT).',
    cache: 'NONE', ok: 'AuthLogoutResponse', errors: { 400: E400, 403: ['CSRF_TOKEN_INVALID'] }, security: [{}, { cookieAuth: [] }],
    extraParamsInline: [{ name: 'X-CSRF-Token', in: 'header', required: false, description: 'Token de GET /api/v1/auth/session (obrigatório com cookie de sessão).', schema: { type: 'string', maxLength: 128 } }] });
  add('/api/v1/iam/registry', 'get', { tags: ['iam'], summary: 'PermissionRegistry, templates de role e permissões públicas (dados globais da plataforma)',
    cache: 'VERSIONED', etag: true, ok: 'IamRegistryResponse', errors: { 400: E400 } });
  add('/api/v1/admin/audit-events', 'get', { tags: ['iam'], summary: 'Eventos de auditoria da organização ativa (admin.audit.view)',
    description: 'Append-only; sem valores antes/depois nem PII. Usuário: somente a própria organização (X-Organization-Id obrigatório com mais de uma membership). Principal de plataforma: todas, ou a do cabeçalho. Paginação por ?before=<id>.',
    query: [queryParam('limit', { type: 'int', min: 1, max: 200, default: 50 }, 'Máximo de eventos (1–200).'), queryParam('before', { type: 'int', min: 1 }, 'Somente eventos com id menor (paginação).')],
    extraParamsInline: [ORG_HEADER], cache: 'NONE', ok: 'AuditEventListResponse', security: [{ bearerAuth: [] }],
    errors: { 400: ['VALIDATION_ERROR', 'INVALID_FILTER', 'TENANT_CONTEXT_REQUIRED'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED'], 404: ['ORGANIZATION_NOT_FOUND'], 422: ['INVALID_FILTER'] } });
  add('/api/v1/developments/{developmentId}/lots/{lotId}/price-history', 'get', { tags: ['commercial'], summary: 'Histórico do preço de tabela publicado de um lote (somente leitura)',
    description: 'Série em degraus derivada das versões publicadas (PUBLISHED + ARCHIVED, imutáveis): pontos, intervalos de vigência, eventos de mudança e resumo. Variação (absoluta/percentual, nominal) somente com ≥ 2 versões comparáveis; caso contrário null + notCalculableReason. Versão sem preço = lacuna (MISSING), nunca zero nem queda. Não é preço de venda, valorização do ativo nem rentabilidade.',
    params: [...DEV, ...LOT], cache: 'DYNAMIC', etag: true, ok: 'LotPriceHistoryResponse', errors: { 400: E400, 401: ['UNAUTHORIZED'], 404: [...DEV404, 'LOT_NOT_FOUND'] } });
  add('/api/v1/developments/{developmentId}/pricing/history', 'get', { tags: ['commercial'], summary: 'Histórico das versões de tabela do empreendimento (índice interno, cesta dos mesmos lotes)',
    description: 'Por versão: lotes com preço, cobertura, medianas de preço e R$/m². Entre versões consecutivas: mudança pela mediana das variações dos MESMOS lotes (sem efeito de mix, sem média ingênua). summary.change é null com menos de 2 versões. Não é índice de mercado.',
    params: DEV, cache: 'DYNAMIC', etag: true, ok: 'DevelopmentPriceHistoryResponse', errors: { 400: E400, 401: ['UNAUTHORIZED'], 404: DEV404 } });
  add('/api/v1/developments/{developmentId}/availability/manifest', 'get', { tags: ['availability'], summary: 'Manifesto de disponibilidade (revisão, checksum, contagens, atualidade) — sem preço',
    description: 'Sincronização rápida: se a revisão/checksum local for igual, não baixe o snapshot. Construído só do domínio Availability (independente do Pricing): publicar tabela não muda este manifesto; UNKNOWN nunca conta como AVAILABLE.',
    params: DEV, cache: 'DYNAMIC', etag: true, ok: 'AvailabilityManifestResponse', errors: { 400: E400, 401: ['UNAUTHORIZED'], 404: DEV404 } });
  return P;
}

/** Round-5 module paths (topics 57-63), each operation marked x-feature-flag (FEATURE_*) + x-disabled-by-default: the
    routes exist only when that flag is on (src/featureModules.js). Published in docs/openapi.features.json; the main
    docs/openapi.json keeps exactly the routes registered with every flag off. */
const FEATURE_TAGS = ['deals', 'onboarding', 'privacy', 'backoffice', 'data-quality', 'surroundings'];
const FEATURE_TEXT = flag => `Módulo desligado por padrão: a rota só existe com ${flag}=1. Permissão de concessão explícita (OWNER_ADMIN por decisão de 2026-10-18; demais papéis 403; anônimo 401; ADMIN_API_TOKEN 403). Valores de política nulos = recusa ("necessita confirmação").`;
const ENV = (data = {}) => ({ type: 'object', required: ['data', 'meta'], properties: { data, meta: { type: 'object' } } });
function featureSchemas() {
  const bo = require('../../src/modules/backoffice/backoffice.openapi').SCHEMAS;
  const sur = require('../../src/modules/surroundings/surroundings.openapi').schemas;
  return {
    ...bo, ...sur,
    DealEnvelope: { type: 'object', properties: { data: { type: 'object' }, meta: { type: 'object', properties: { requestId: { type: 'string' } } } } },
    BackofficeNavigationResponse: ENV({ type: 'array', items: { type: 'object' } }),
    BackofficeSecretsStatusResponse: ENV({ type: 'array', items: { type: 'object', required: ['name', 'status'], properties: { name: { type: 'string' }, status: { type: 'string', enum: ['CONFIGURED', 'MISSING'] } } } }),
    BackofficeSupportSessionsResponse: ENV({ type: 'array', items: { type: 'object' } }),
    BackofficeEmergencyControlsResponse: ENV({ type: 'array', items: { type: 'object' } }),
    AdminActionPreviewResponse: ENV(ref('AdminActionPreview')),
    AdminCommandResultResponse: ENV(ref('AdminCommandResult'))
  };
}
function buildFeaturePaths() {
  const P = {};
  let flag = null;
  const mark = o => ({ ...o, 'x-feature-flag': flag, 'x-disabled-by-default': true, description: `${FEATURE_TEXT(flag)}\n\n${o.description || ''}`.trim() });
  const add = (path, method, o) => { P[path] = P[path] || {}; P[path][method] = mark(op(o)); };
  flag = 'FEATURE_DEALS';
  for (const [p, ops] of Object.entries(require('../../src/modules/deals/deals.openapi').build().paths)) for (const [m, o] of Object.entries(ops)) { P[p] = P[p] || {}; P[p][m] = mark(o); }
  flag = 'FEATURE_ONBOARDING'; require('../../src/modules/onboarding/onboarding.openapi').addOnboardingPaths(add);
  flag = 'FEATURE_PRIVACY'; require('../../src/modules/privacy/privacy.openapi').addPrivacyPaths(add);
  flag = 'FEATURE_BACKOFFICE'; require('../../src/modules/backoffice/backoffice.openapi').addPaths(add, { ref });
  flag = 'FEATURE_DATA_QUALITY'; require('../../src/modules/dataquality/dataquality.openapi').addDataQualityPaths(add);
  flag = 'FEATURE_SURROUNDINGS'; require('../../src/modules/surroundings/surroundings.openapi').addPaths(add, { DEV, queryParam, ref });
  return P;
}

const DESCRIPTION = [
  'API REST formal e versionada da Plataforma de Inteligência Comercial para Loteamentos (empreendimento de referência: Viva Juara, 498 lotes).',
  '',
  `**Versionamento:** por URL (\`/api/${API_VERSION}\`). Este documento descreve o contrato ${CONTRACT_VERSION}. Mudanças não breaking (campo opcional, endpoint novo) ficam em v1 e entram no API_CHANGELOG.md; mudanças breaking (remover/renomear campo, mudar tipo ou significado) só em /api/v2. A versão da API não se confunde com schemaVersion, analysisVersion, priceTableVersion ou availabilityRevision.`,
  '',
  '**Envelope:** endpoints novos (contrato 1.1) respondem `{ data, meta }` (meta: apiVersion, requestId, generatedAt, versions, paginação). Os endpoints de snapshot, config, map-lots, price-tables/current, assets e history mantêm o formato v1.0 sem envelope (o frontend depende dele).',
  '',
  '**Erros:** sempre `ApiError { code, message, details, requestId, traceId, timestamp }` com código semântico (docs/API_ERRORS.md). Nunca stack trace. 429/503 trazem Retry-After.',
  '',
  '**Formatos:** JSON UTF-8; números como number (sem "R$", sem "m²"); datas ISO 8601 (date-time em UTC "Z"; datas sem hora YYYY-MM-DD); ausência = null; campo omitido = não pertence ao DTO. Percentuais: frações 0..1 (downPaymentDefault, rate, discount) exceto commercial.downPaymentDefaultPercent (0–100, campo canônico existente). Scores 0–100; critérios 0–10. Polígonos em IMAGE_RELATIVE (unidades da planta).',
  '',
  '**Autenticação e autorização (1.3.0, tópicos 30/31):** toda rota declara uma permissão (registry em GET /api/v1/iam/registry; negação por padrão). Leituras de empreendimentos PUBLIC (viva-juara) seguem públicas, sem token, inclusive o stream SSE. Credenciais: `Authorization: Bearer <ADMIN_API_TOKEN>` (principal SYSTEM de plataforma, ator "admin") ou token de usuário do DevTokenProvider (AUTH_DEV_TOKENS=true, somente desenvolvimento/teste; IdP definitivo pendente). 401 = não autenticado (credencial ausente onde é exigida, inválida, expirada ou revogada); 403 PERMISSION_DENIED = autenticado sem permissão; recurso de outra organização ou privado sem acesso = 404 (mesma resposta de inexistente). Sem nenhuma credencial configurada no servidor a escrita fica desligada (403 WRITES_DISABLED). GET /api/v1/me descreve o principal atual.',
  '',
  '**Login Google e sessão por cookie (1.4.0, fase W3):** `GET /api/v1/auth/google/start` → Google (Authorization Code + PKCE, state, nonce) → `GET /api/v1/auth/google/callback` cria uma sessão no servidor e devolve só um cookie HttpOnly + Secure + SameSite=Lax com id opaco. Organização de referência: `org_house7`. Conta Google sem convite = autenticada sem nenhuma permissão de organização (negação por padrão); o administrador convida por e-mail (`npm run iam -- invite`). Escritas autenticadas pelo cookie exigem `X-CSRF-Token` (de `GET /api/v1/auth/session`); credenciais Bearer seguem iguais e não precisam dele.',
  '',
  '**Idempotência:** rotas administrativas aceitam `Idempotency-Key`; mesma chave + mesma requisição reenvia a resposta armazenada (Idempotent-Replayed: true), mesma chave + corpo diferente → 409 IDEMPOTENCY_KEY_REUSED. Validade: IDEMPOTENCY_TTL_SECONDS (padrão 24 h).',
  '',
  '**Cache:** estático = max-age longo; versionado (análise, comercial, config, fontes) = max-age=300 + must-revalidate; dinâmico (disponibilidade, mapa, ficha, listas) = no-cache; ETag fraco em todas as leituras cacheáveis.'
].join('\n');

/** features=false → docs/openapi.json (routes with every flag off); features=true → docs/openapi.features.json (all on) */
function buildOpenApi({ App, base, features = false }) {
  const schemas = buildSchemas(App);
  const kept = Object.fromEntries(LEGACY_SCHEMAS.filter(k => base.components.schemas[k]).map(k => [k, base.components.schemas[k]]));
  const allSchemas = { ...kept, ...(features ? featureSchemas() : {}), ...schemas };
  if (features) { // the full error code enum (round-5 module codes included)
    const e = JSON.parse(JSON.stringify(allSchemas.ApiError));
    e.properties.code.enum = Object.keys(ERROR_CATALOG);
    allSchemas.ApiError = e;
  }
  const sorted = Object.fromEntries(Object.keys(allSchemas).sort().map(k => [k, allSchemas[k]]));
  return {
    openapi: '3.0.3',
    info: { title: 'Plataforma de Inteligência Comercial de Loteamentos — API', version: CONTRACT_VERSION,
      description: features ? DESCRIPTION + '\n\n**Módulos da rodada 5 (tópicos 57–63):** este documento inclui as rotas de todos os módulos com flag (x-feature-flag), todas desligadas por padrão (x-disabled-by-default). docs/openapi.json descreve o servidor com todas as flags desligadas.' : DESCRIPTION, 'x-api-version': API_VERSION },
    servers: base.servers,
    tags: ['health', 'auth', 'iam', 'developments', 'lots', 'analysis', 'commercial', 'availability', 'assets', 'sources', ...(features ? FEATURE_TAGS : [])].map(name => ({ name })),
    paths: features ? { ...buildPaths(App), ...buildFeaturePaths() } : buildPaths(App),
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Host-plat_session', description: 'Sessão do login Google (W3): id opaco de 256 bits, HttpOnly, Secure, SameSite=Lax; o servidor guarda só o sha256. Nome `plat_session` quando COOKIE_DOMAIN está definido. Escritas autenticadas pelo cookie exigem X-CSRF-Token.' }, bearerAuth: { type: 'http', scheme: 'bearer', description: 'ADMIN_API_TOKEN (principal SYSTEM de plataforma, sha256 em tempo constante) ou token de usuário plat_dev_… (DevTokenProvider, somente dev/test; só o sha256 é armazenado). WRITE_API_KEY (com WRITES_ENABLED=true) segue aceito como legado, deprecated. Leituras de empreendimentos PUBLIC não exigem autenticação.' } },
      headers: {
        ETag: { description: 'ETag fraco calculado das versões das camadas (304 sem montar o corpo).', schema: { type: 'string', example: 'W/"availability-viva-juara-r0"' } },
        RequestId: { description: 'Id da requisição (aceito do cliente se bem formado, senão gerado); igual a requestId/traceId do corpo de erro.', schema: { type: 'string' } },
        RetryAfter: { description: 'Segundos até tentar novamente (429/503; 409 IDEMPOTENCY_REQUEST_IN_PROGRESS).', schema: { type: 'integer', minimum: 1 } },
        Location: { description: 'URL relativa do recurso criado.', schema: { type: 'string', example: '/api/v1/developments/viva-juara/price-tables/viva-juara-2026-11-01' } },
        IdempotentReplayed: { description: '"true" quando a resposta é a armazenada para a mesma Idempotency-Key (o comando não foi executado de novo).', schema: { type: 'string', enum: ['true'] } }
      },
      parameters: {
        DevelopmentId: { name: 'developmentId', in: 'path', required: true, schema: { type: 'string', pattern: DEVELOPMENT_ID_RE.source, example: 'viva-juara' } },
        LotId: { name: 'lotId', in: 'path', required: true, schema: { type: 'string', pattern: LOT_ID_RE.source, example: 'VJ-QB-L0079' } },
        PriceTableId: { name: 'priceTableId', in: 'path', required: true, schema: { type: 'string', pattern: PRICE_TABLE_ID_RE.source, example: 'lancamento-2026-10' } },
        IfNoneMatch: { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
        IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, description: 'Chave de idempotência do comando (validade padrão 24 h).', schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$', example: 'pt-2026-11-01-a1b2c3' } },
        LastEventId: { name: 'Last-Event-ID', in: 'header', required: false, description: 'Última availabilityRevision recebida (o EventSource envia ao reconectar).', schema: { type: 'string', pattern: '^\\d{1,15}$' } }
      },
      schemas: sorted
    },
    'x-error-catalog': Object.fromEntries(Object.entries(ERROR_CATALOG).map(([k, v]) => [k, { status: v.status, description: v.description, ...(v.feature ? { 'x-feature-flag': v.feature } : {}) }]))
  };
}

module.exports = { buildOpenApi, buildFeaturePaths, LEGACY_SCHEMAS, FEATURE_TAGS };
