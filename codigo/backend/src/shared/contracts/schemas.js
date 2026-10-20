'use strict';
/* API v1 contract — OpenAPI 3.0 component schemas of every DTO this backend validates.
   Built from the shared domain (App.enums + App.model Field Registry), so enum values and the meaning
   of each fieldKey can never drift between frontend, backend and documentation (§117).
   The same objects are:
     - written to docs/openapi.json components.schemas by scripts/openapi.js (a test fails on drift);
     - used to validate responses at runtime when VALIDATE_RESPONSES=true (default outside production);
     - used by the contract tests (responses validated against docs/openapi.json).
   Conventions (docs/API_ARCHITECTURE.md): numbers are JSON numbers (never formatted strings); dates are
   ISO 8601 (date-time in UTC "Z", date-only as YYYY-MM-DD); absence of a value is null (never "", "-", "N/A");
   an omitted property is not part of that DTO. Scores keep the current scales (0–100 scores, 0–10 criteria). */
const { ERROR_CATALOG } = require('../http/errors');

const API_VERSION = 'v1';
const CONTRACT_VERSION = '1.4.0';
const LAYERS = ['static', 'analysis', 'commercial', 'availability'];

const n = s => ({ ...s, nullable: true });
const STR = { type: 'string' }, NUM = { type: 'number' }, INT = { type: 'integer' }, BOOL = { type: 'boolean' };
const DT = { type: 'string', format: 'date-time' }, DATE = { type: 'string', format: 'date' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
/** strict object: every listed property is required (null when absent), nothing else allowed */
const obj = (properties, extra = {}) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...extra });
const POINT = arr(NUM, { minItems: 2, maxItems: 2 });
const POLYGON = arr(POINT, { minItems: 3, description: 'Anel fechado [[x, y], ...] em unidades da planta (coordinateSpace IMAGE_RELATIVE: origem no canto superior esquerdo da imagem oficial, y para baixo; metros = unidade × map.metersPerUnit da configuração). Precisão total, sem simplificação.' });

function buildSchemas(App) {
  const en = name => {
    const values = App.enums[name];
    if (!values) throw new Error(`enum ${name} missing in App.enums`);
    return { type: 'string', enum: Object.values(values) };
  };
  const F = App.model.FIELDS.filter(f => !f.virtual);

  // ---------------------------------------------------------------- canonical Lot sections from the Field Registry
  const ARRAY_ITEMS = { 'intelligence.alerts': ref('Alert'), 'intelligence.highlights': ref('Highlight'), 'intelligence.rankings': ref('Ranking'),
    'construction.easements': ref('Easement'), 'environmental.noiseSources': ref('NoiseSource'), 'commercial.availablePlans': STR };
  const GEOMETRY = { 'geometry.polygon': POLYGON, 'geometry.centroid': POINT, 'geometry.bounds': obj({ x: NUM, y: NUM, w: NUM, h: NUM }) };
  function fieldSchema(f) {
    let s;
    switch (f.type) {
      case 'string': s = { type: 'string' }; break;
      case 'number': s = { type: 'number' }; break;
      case 'boolean': s = { type: 'boolean' }; break;
      case 'enum': s = en(f.enum); break;
      case 'date': s = { ...DATE }; break;
      case 'datetime': s = { ...DT }; break;
      case 'geometry': s = { ...(GEOMETRY[f.key] || {}) }; break;
      case 'array': s = arr(ARRAY_ITEMS[f.key] || (f.enum ? en(f.enum) : {})); break;
      default: s = {};
    }
    // Partial failure contract (§141): fields of the analysis and commercial layers (VERSIONED / DYNAMIC) are null
    // when that layer is unavailable, even when the registry marks them non-nullable in a complete Lot.
    // Availability fields never become null (no record = UNKNOWN, revision 0).
    const layerMayFail = f.dynamicType === 'VERSIONED' || (f.dynamicType === 'DYNAMIC' && !f.key.startsWith('availability.'));
    s.description = `${f.label}${f.unit ? ` (${f.unit})` : ''} — fieldKey ${f.key}${layerMayFail && !f.nullable ? ' (null somente se a camada estiver indisponível)' : ''}${s.description ? '. ' + s.description : ''}`;
    return f.nullable || layerMayFail ? n(s) : s;
  }
  /** section → strict object; three-segment keys (intelligence.scores.housing) become nested objects */
  function section(name, { exclude = [] } = {}) {
    const props = {};
    for (const f of F) {
      const parts = f.key.split('.');
      if (parts[0] !== name || exclude.includes(f.key)) continue;
      if (parts.length === 2) props[parts[1]] = fieldSchema(f);
      else if (parts.length === 3) {
        props[parts[1]] = props[parts[1]] || obj({}, { description: `fieldKey ${parts[0]}.${parts[1]}` });
        props[parts[1]].properties[parts[2]] = fieldSchema(f);
        props[parts[1]].required.push(parts[2]);
      }
    }
    return obj(props);
  }
  const sections = Object.fromEntries(['identity', 'geometry', 'location', 'surroundings', 'mobility', 'environmental', 'construction', 'commercial', 'intelligence'].map(s => [s, section(s)]));
  const publicAvailability = section('availability', { exclude: ['availability.notes', 'availability.proposalId'] });
  const scoreKeys = Object.keys(sections.intelligence.properties.scores.properties);
  const scoresSchema = obj(Object.fromEntries(scoreKeys.map(k => [k, n({ ...NUM, description: `0–100 — fieldKey intelligence.scores.${k}` })])));
  const thematicScoresSchema = obj(Object.fromEntries(scoreKeys.filter(k => k !== 'overall').map(k => [k, n({ ...NUM, description: `0–100 — fieldKey intelligence.scores.${k}` })])),
    { description: 'Scores por objetivo (camada "score"); o overall já está em MapLotDto.overallScore.' });
  const criteriaSchema = obj(Object.fromEntries(Object.entries(App.model.CRITERIA_FIELDS).map(([k, key]) => [k, n({ ...NUM, description: `0–10 — fieldKey ${key}` })])),
    { description: 'Critérios 0–10 da análise (App.model.CRITERIA_FIELDS); null sem análise.' });

  const level = n(en('Level'));
  const versions = obj({
    staticVersion: n({ ...STR, example: '2026-10-06.1' }), analysisVersion: n({ ...STR, example: '2026-10-06' }),
    priceTableId: n({ ...STR, example: 'lancamento-2026-10' }), priceTableVersion: n({ ...STR, example: '2026-10-06' }), availabilityRevision: { ...INT, minimum: 0, example: 0 }
  }, { description: 'Versões correntes de cada camada. API version (v1) ≠ schemaVersion ≠ analysisVersion ≠ priceTableVersion ≠ availabilityRevision.' });

  // ---------------------------------------------------------------- envelopes
  const metaBase = {
    apiVersion: { type: 'string', enum: [API_VERSION] },
    requestId: { ...STR, description: 'Mesmo valor do cabeçalho X-Request-Id da resposta que gerou a representação.' },
    generatedAt: DT
  };
  const optional = (props, required) => ({ type: 'object', additionalProperties: false, required, properties: props });
  const resourceMeta = optional({ ...metaBase, versions: ref('Versions'), unavailableLayers: arr({ type: 'string', enum: LAYERS }, { description: 'Camadas indisponíveis (falha parcial): seus campos vêm null / UNKNOWN; nunca AVAILABLE.' }) },
    ['apiVersion', 'requestId', 'generatedAt']);
  const collectionMeta = optional({
    ...resourceMeta.properties,
    total: { ...INT, minimum: 0 }, page: { ...INT, minimum: 1 }, pageSize: { ...INT, minimum: 1 }, totalPages: { ...INT, minimum: 0 },
    sortBy: STR, sortDirection: { type: 'string', enum: ['asc', 'desc'] },
    filters: { type: 'object', description: 'Filtros efetivamente aplicados (somente os informados).' }
  }, ['apiVersion', 'requestId', 'generatedAt', 'total', 'page', 'pageSize', 'totalPages']);
  const searchMeta = optional({
    ...resourceMeta.properties, q: STR, kind: { type: 'string', enum: ['lot', 'block', 'multi', 'none'] }, total: { ...INT, minimum: 0 }, limit: { ...INT, minimum: 1 }, truncated: BOOL
  }, ['apiVersion', 'requestId', 'generatedAt', 'q', 'kind', 'total', 'limit', 'truncated']);
  const batchMeta = optional({ ...metaBase, requested: INT, found: INT, notFound: arr(STR) }, ['apiVersion', 'requestId', 'generatedAt', 'requested', 'found', 'notFound']);
  const envelope = (data, meta = 'ResourceMeta') => obj({ data, meta: ref(meta) });

  const errorCodes = Object.keys(ERROR_CATALOG).filter(k => !ERROR_CATALOG[k].feature); // round-5 codes: docs/openapi.features.json only
  const S = {
    ApiError: {
      type: 'object', additionalProperties: false, required: ['code', 'message', 'details', 'requestId', 'traceId', 'timestamp'],
      properties: {
        code: { type: 'string', enum: errorCodes, description: 'Código semântico estável (docs/API_ERRORS.md). Clientes devem tratar código desconhecido com fallback pelo status HTTP.' },
        message: { ...STR, description: 'Mensagem legível (pt-BR), sem informação sensível.' },
        details: { nullable: true, description: 'Lista de problemas [{ field, reason, ... }] (validação) ou objeto de contexto; nunca stack trace.' },
        requestId: STR,
        traceId: { ...STR, deprecated: true, description: 'Alias de requestId mantido para clientes v1.' },
        timestamp: DT,
        currentRevision: { ...INT, description: 'Somente em REVISION_CONFLICT.' }
      },
      example: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado', details: { lotId: 'VJ-QZ-L9999' }, requestId: 'req-0001-abcd', traceId: 'req-0001-abcd', timestamp: '2026-10-07T17:32:00.000Z' }
    },
    Error: ref('ApiError'),
    Versions: versions,
    ResourceMeta: resourceMeta,
    CollectionMeta: collectionMeta,
    SearchMeta: searchMeta,
    BatchMeta: batchMeta,
    Live: obj({ status: { type: 'string', enum: ['ok'] } }),
    Health: obj({ status: { type: 'string', enum: ['ok'] }, service: STR, version: STR, timestamp: DT, uptimeSeconds: INT, writesEnabled: BOOL }),

    // ---- developments
    DevelopmentDto: obj({
      id: STR, code: STR, name: STR, slug: STR, status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }, currency: STR, locale: STR,
      currentStaticVersion: n(STR), currentAnalysisVersion: n(STR), currentPriceTableId: n(STR), currentPriceTableVersion: n(STR),
      availabilityRevision: { ...INT, minimum: 0 }, updatedAt: DT,
      organizationId: { ...STR, description: 'Organização dona (tenant). Id opaco e estável; slug nunca é fronteira de segurança. (1.3.0)' },
      visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'], description: 'PUBLIC: leituras públicas para qualquer principal; PRIVATE: somente membros autorizados da organização. (1.3.0)' }
    }, { example: { id: 'viva-juara', code: 'VJ', name: 'Viva Juara', slug: 'viva-juara', status: 'ACTIVE', currency: 'BRL', locale: 'pt-BR', currentStaticVersion: '2026-10-06.1',
      currentAnalysisVersion: '2026-10-06', currentPriceTableId: 'lancamento-2026-10', currentPriceTableVersion: '2026-10-06', availabilityRevision: 0, updatedAt: '2026-10-07T12:00:00.000Z',
      organizationId: 'org_house7', visibility: 'PUBLIC' } }),
    DevelopmentResponse: envelope(ref('DevelopmentDto')),
    DevelopmentListResponse: envelope(arr(ref('DevelopmentDto')), 'CollectionMeta'),
    ManifestDto: obj({
      developmentId: STR, schemaVersion: { ...STR, example: '1.0' }, staticVersion: n(STR), analysisVersion: n(STR), priceTableId: n(STR), priceTableVersion: n(STR),
      availabilityRevision: { ...INT, minimum: 0 }, generatedAt: DT
    }, { example: { developmentId: 'viva-juara', schemaVersion: '1.0', staticVersion: '2026-10-06.1', analysisVersion: '2026-10-06', priceTableId: 'lancamento-2026-10',
      priceTableVersion: '2026-10-06', availabilityRevision: 0, generatedAt: '2026-10-07T17:32:00.000Z' } }),
    ManifestResponse: envelope(ref('ManifestDto')),
    SourceDto: obj({ id: STR, type: STR, name: STR, version: n(STR), date: n(DATE), precision: n(STR), description: n(STR) }),
    SourcesResponse: envelope(arr(ref('SourceDto'))),

    // ---- commercial
    PaymentPlan: {
      type: 'object', additionalProperties: true, required: ['id', 'name', 'kind'],
      description: 'Plano de pagamento restaurado sem perda (taxas e descontos como fração 0..1).',
      properties: { id: STR, name: STR, kind: { type: 'string', enum: ['PRICE', 'PRICE_ANNUAL', 'INSTALLMENTS'] }, desc: STR, months: INT, rate: NUM, annualCount: INT, firstAnnualMonth: INT, monthlyShare: NUM, discount: NUM }
    },
    PriceTableDto: obj({
      id: STR, developmentId: STR, version: STR, name: STR, sourceId: n(STR), createdAt: n(DATE), validFrom: n(DATE), validUntil: n(DATE),
      pricePerM2: n(NUM), downPaymentDefault: n({ ...NUM, description: 'Fração 0..1 (0.12 = 12%).' }), plans: arr(ref('PaymentPlan')),
      status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }, currency: STR, revision: INT
    }),
    PriceTableResponse: envelope(ref('PriceTableDto')),
    LotCommercialDto: obj({
      lotId: STR, ...sections.commercial.properties,
      plans: arr(ref('PaymentPlan'), { description: 'Planos da tabela corrente aplicáveis ao lote (commercial.availablePlans), na ordem da tabela.' })
    }, { description: 'CommercialSnapshot de um lote: preço da tabela corrente e condições aplicáveis. price e priceTableVersion vêm sempre da mesma tabela.' }),
    LotCommercialResponse: envelope(ref('LotCommercialDto')),

    // ---- price table publication (contract 1.2)
    PublishPriceTableRequest: {
      type: 'object', additionalProperties: false, required: ['version'],
      description: 'Nova versão de tabela de preço. Informe pricePerM2 (todos os lotes: área × R$/m², arredondado ao centavo) e/ou lotPrices (preço por lote; sem pricePerM2 todos os lotes devem constar). Geometria e área nunca são alteradas (campos como areaM2/polygon → 422).',
      properties: {
        version: { ...STR, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', example: '2026-11-01' },
        id: { ...STR, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', description: 'Padrão: <developmentId>-<version>.' },
        name: n({ ...STR, maxLength: 120 }),
        pricePerM2: n({ ...NUM, minimum: 0, maximum: 1e6, exclusiveMinimum: true, description: 'BRL/m², positivo, até 2 casas decimais.' }),
        lotPrices: n(arr(obj({ lotId: { ...STR, pattern: '^[A-Z0-9]+-Q[A-Z0-9]+-L\\d{4}$' }, price: n({ ...NUM, minimum: 0, exclusiveMinimum: true }), pricePerM2: n({ ...NUM, minimum: 0, exclusiveMinimum: true }) },
          { required: ['lotId'], description: 'Exatamente um de price ou pricePerM2.' }), { minItems: 1, maxItems: 10000 })),
        validFrom: n(DATE), validUntil: n(DATE),
        downPaymentDefault: n({ ...NUM, minimum: 0, maximum: 1, description: 'Fração 0..1; padrão: a da tabela corrente.' }),
        sourceId: n({ ...STR, description: 'Fonte existente em /sources.' }), changeReason: n({ ...STR, maxLength: 500 })
      },
      example: { version: '2026-11-01', pricePerM2: 1250, validFrom: '2026-11-01', validUntil: null, changeReason: 'Reajuste de novembro' }
    },
    PriceDiffItem: obj({
      lotId: STR, code: STR, areaM2: n(NUM), currentPrice: n(NUM), currentPricePerM2: n(NUM), proposedPrice: n(NUM), proposedPricePerM2: n(NUM),
      delta: n({ ...NUM, description: 'proposedPrice − currentPrice (BRL).' }), deltaPercent: n(NUM), changed: BOOL,
      source: { type: 'string', enum: ['TABLE_PRICE_PER_M2', 'LOT_PRICE_PER_M2', 'LOT_PRICE'] }
    }),
    PriceTableDiff: obj({
      lotCount: INT, changed: INT, unchanged: INT, increased: INT, decreased: INT, newlyPriced: INT,
      totals: obj({ current: n(NUM), proposed: NUM, delta: n(NUM) }),
      lots: arr(ref('PriceDiffItem'))
    }, { description: 'Diferença por lote entre a tabela corrente e a proposta (todos os lotes do empreendimento).' }),
    PriceTablePublicationDto: {
      type: 'object', additionalProperties: false, required: ['dryRun', 'priceTable', 'publication', 'diff'],
      properties: {
        dryRun: BOOL,
        priceTable: ref('PriceTableDto'),
        publication: obj({
          publishedAt: n(DT), publishedBy: n({ ...STR, description: 'Ator do token de escrita ("admin").' }), previousPriceTableId: n(STR), previousPriceTableVersion: n(STR),
          pricingMode: { type: 'string', enum: ['PER_M2', 'PER_LOT', 'MIXED'] }, changeReason: n(STR), checksum: STR
        }),
        diff: ref('PriceTableDiff'),
        wouldConflict: { ...BOOL, description: 'Somente em dryRun: true quando a publicação real responderia 409 PRICE_TABLE_VERSION_EXISTS.' }
      }
    },
    PriceTablePublicationResponse: envelope(ref('PriceTablePublicationDto')),

    // ---- analysis preview (contract 1.2)
    AnalysisPreviewRequest: {
      type: 'object', additionalProperties: false, required: [],
      properties: {
        methodology: { type: 'object', nullable: true, description: 'ScoringMethodologyConfig candidata (formato de plat/config/scoring/<dev>/<versão>.json). Ausente = a metodologia publicada (impacto zero).' },
        massChangeShare: n({ ...NUM, minimum: 0, maximum: 1, description: 'Fração de lotes alterados que caracteriza mudança em massa (padrão 0.2).' }),
        topMoves: n({ ...INT, minimum: 1, maximum: 100 })
      },
      example: {}
    },
    MethodologyRef: obj({ methodologyVersion: STR, checksum: STR }),
    ImpactReport: {
      type: 'object', additionalProperties: false,
      required: ['configDiff', 'lotCount', 'changedLots', 'changedShare', 'massChange', 'scores', 'classDistribution', 'classMatrix', 'classChanges', 'rankingMoves', 'alertChanges'],
      description: 'App.methodology.impact(publicada, candidata, entradas) — o que a candidata mudaria, sem publicar.',
      properties: {
        configDiff: arr({ type: 'object', additionalProperties: true, required: ['kind', 'path'], properties: { kind: STR, path: STR } }),
        lotCount: INT, changedLots: INT, changedShare: NUM, massChange: BOOL,
        scores: { type: 'object', additionalProperties: { type: 'object', additionalProperties: false, required: ['changed', 'maxAbsDelta', 'meanDelta'],
          properties: { changed: INT, maxAbsDelta: NUM, meanDelta: NUM, nullTransitions: INT } } },
        classDistribution: obj({ base: { type: 'object', additionalProperties: INT }, candidate: { type: 'object', additionalProperties: INT } }),
        classMatrix: { type: 'object', additionalProperties: INT, description: 'Contagem "classeBase→classeCandidata".' },
        classChanges: arr(obj({ lotId: STR, code: STR, from: STR, to: STR })),
        rankingMoves: arr({ type: 'object', additionalProperties: false, required: ['lotId', 'code'], properties: { lotId: STR, code: STR, from: n(INT), to: n(INT) } }),
        alertChanges: arr(obj({ lotId: STR, code: STR, from: arr(STR), to: arr(STR) }))
      }
    },
    PublishedParity: obj({
      analysisVersion: STR, lots: INT, identical: INT, fieldsCompared: arr(STR),
      diffs: arr({ type: 'object', additionalProperties: false, required: ['lotId', 'field'], properties: { lotId: STR, field: STR, engine: {}, published: {} } }, { description: 'Até 20 divergências.' })
    }, { description: 'Metodologia publicada rodada sobre as entradas armazenadas × análise publicada armazenada.' }),
    AnalysisPreviewDto: obj({
      developmentId: STR, published: { ...BOOL, enum: [false], description: 'Sempre false: a prévia nunca publica.' }, engineVersion: STR, inputVersion: STR, analysisVersion: n(STR),
      base: ref('MethodologyRef'), candidate: ref('MethodologyRef'), sameMethodology: BOOL, impact: ref('ImpactReport'), publishedParity: { nullable: true, oneOf: [ref('PublishedParity')], description: 'null quando o empreendimento não tem análise publicada.' }
    }),
    AnalysisPreviewResponse: envelope(ref('AnalysisPreviewDto')),

    // ---- identity & access (topic 30) / tenancy (topic 31) — API 1.3.0
    MeDto: obj({
      authenticated: BOOL,
      principal: obj({ type: { type: 'string', enum: ['ANONYMOUS', 'USER', 'SYSTEM'] }, id: n(STR), displayName: n(STR),
        status: { type: 'string', enum: ['ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED', 'ARCHIVED'] },
        authenticationMethod: n({ type: 'string', enum: ['DEV_TOKEN', 'ADMIN_API_TOKEN', 'WRITE_API_KEY', 'GOOGLE_OIDC'] }) }),
      organizationId: n({ ...STR, description: 'Organização ativa (X-Organization-Id validado, ou membership única). null: anônimo, plataforma ou seleção pendente.' }),
      organization: n(obj({ id: STR, slug: STR, displayName: STR, status: STR,
        developments: arr(obj({ id: STR, slug: STR, name: STR, visibility: { type: 'string', enum: ['PUBLIC', 'PRIVATE'] } })) })),
      organizationSelectionRequired: { ...BOOL, description: 'true: usuário com mais de uma membership ativa e sem X-Organization-Id.' },
      tenantResolvedBy: n({ type: 'string', enum: ['HEADER_SELECTOR', 'SINGLE_MEMBERSHIP'] }),
      memberships: arr(obj({ organizationId: STR, slug: STR, displayName: STR, status: STR })),
      roles: arr(STR, { description: 'Códigos de role na organização ativa (resumo para UI; autorização usa somente permissions).' }),
      roleAssignments: arr(obj({ role: STR, organizationId: STR, developmentId: n(STR) })),
      permissions: arr(STR, { description: 'Permissões efetivas no escopo da organização ativa (anônimo/sem organização: as públicas, válidas só em empreendimentos PUBLIC).' }),
      publicPermissions: arr(STR, { description: 'Permissões que qualquer principal tem em empreendimentos PUBLIC.' }),
      developmentPermissions: { type: 'object', additionalProperties: arr(STR), description: 'Permissões adicionais concedidas só para um empreendimento: { developmentId: [keys] }.' },
      policyVersion: STR,
      session: obj({ expiresAt: n(DT) }),
      identityProvider: obj({ status: { type: 'string', enum: ['CONFIGURED', 'NOT_CONFIGURED', 'PENDING_DECISION'], description: 'CONFIGURED: login Google ativo neste ambiente. PENDING_DECISION não é mais emitido (decisão D-IDP = Google).' },
        mode: { type: 'string', enum: ['GOOGLE_OIDC', 'DEV_TOKEN', 'NONE'] } })
    }, { description: 'PrincipalContext para o frontend (AccessControlViewModel). Esconder botão não é segurança: o backend decide em cada rota.' }),
    MeResponse: envelope(ref('MeDto')),
    // ---- login Google (OIDC + sessão por cookie, fase W3)
    AuthRedirectDto: obj({ location: { ...STR, description: 'Mesmo valor do cabeçalho Location (302).' } }),
    AuthRedirectResponse: envelope(ref('AuthRedirectDto')),
    AuthSessionDto: obj({
      enabled: { ...BOOL, description: 'Login Google configurado neste ambiente.' },
      provider: n({ type: 'string', enum: ['google'] }),
      authenticated: { ...BOOL, description: 'Há sessão de cookie válida nesta requisição.' },
      csrfToken: n({ ...STR, description: 'Token sincronizador: envie em X-CSRF-Token em toda escrita autenticada pelo cookie. Nunca guardar em localStorage nem em URL.' }),
      expiresAt: n({ ...DT, description: 'Expiração absoluta da sessão.' }),
      idleExpiresAt: n({ ...DT, description: 'Expiração por inatividade (renovada a cada uso).' }),
      loginUrl: n({ ...STR, description: 'Caminho de início do login (relativo à origem da API).' })
    }, { description: 'Estado da sessão por cookie (sem dados pessoais).' }),
    AuthSessionResponse: envelope(ref('AuthSessionDto')),
    AuthLogoutResponse: envelope(obj({ revoked: { ...BOOL, description: 'true quando havia sessão e ela foi revogada; o cookie é sempre apagado.' } })),
    PermissionDto: obj({ key: STR, resource: STR, action: STR, riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      scopeTypes: arr({ type: 'string', enum: ['GLOBAL', 'ORGANIZATION', 'DEVELOPMENT'] }), publicRead: BOOL, systemOnly: BOOL,
      enforcedBy: { type: 'string', enum: ['BACKEND', 'FRONTEND'] }, description: STR }),
    IamRegistryDto: obj({ policyVersion: STR, permissions: arr(ref('PermissionDto')), roles: arr(obj({ code: STR, roleType: { type: 'string', enum: ['SYSTEM', 'CUSTOM'] }, permissions: arr(STR) })),
      publicVisitorPermissions: arr(STR) }),
    IamRegistryResponse: envelope(ref('IamRegistryDto')),
    AuditEventDto: obj({ id: INT, occurredAt: DT, actorType: n({ type: 'string', enum: ['SYSTEM', 'USER', 'SERVICE', 'ANONYMOUS'] }), actorId: n(STR), action: STR, permissionKey: n(STR),
      outcome: { type: 'string', enum: ['SUCCESS', 'DENIED', 'FAILED', 'CANCELLED'] }, resourceType: STR, resourceId: STR, organizationId: n(STR), developmentId: n(STR), requestId: n(STR) },
      { description: 'Evento de auditoria (append-only). Sem valores antes/depois nem PII: somente referências.' }),
    AuditMeta: optional({ ...metaBase, organizationId: n(STR), limit: INT, nextBefore: n(INT) }, ['apiVersion', 'requestId', 'generatedAt', 'organizationId', 'limit', 'nextBefore']),
    AuditEventListResponse: envelope(arr(ref('AuditEventDto')), 'AuditMeta'),

    // ---- price history (topic 28) — read-only, derived from immutable published price table versions
    PriceHistoryPoint: obj({ lotId: STR, priceTableId: STR, priceTableVersion: STR, versionNumber: INT, versionStatus: { type: 'string', enum: ['PUBLISHED', 'ARCHIVED'] },
      effectiveFrom: n(DATE), effectiveTo: n(DATE), publishedAt: n(DT), archivedAt: n(DT), amount: n(NUM), pricePerM2: n(NUM), currency: n(STR),
      priceType: { type: 'string', enum: ['LIST_PRICE'] }, pointStatus: { type: 'string', enum: ['VALID', 'MISSING', 'WITHHELD', 'CONFLICTED', 'INVALID', 'NOT_APPLICABLE'] },
      sourceId: n(STR), checksum: n(STR), pricingMode: n(STR) }, { description: 'Um ponto por versão publicada. MISSING = lacuna (nunca zero).' }),
    PriceInterval: obj({ startAt: n(DATE), endAt: n(DATE), amount: n(NUM), priceTableId: STR, status: STR, durationDays: n(INT) }),
    PriceChangeEvent: obj({ developmentId: STR, lotId: STR, priceType: STR, fromPriceTableId: n(STR), toPriceTableId: STR, effectiveAt: n(DATE),
      previousAmount: n(NUM), newAmount: n(NUM), absoluteDelta: n(NUM), relativeDeltaPct: n(NUM),
      changeType: { type: 'string', enum: ['INITIAL', 'INCREASE', 'DECREASE', 'UNCHANGED', 'WITHHELD', 'RESTORED', 'REMOVED', 'CONFLICTED', 'CORRECTION'] },
      reason: { type: 'string', enum: ['UNKNOWN_REASON'] }, reasonText: n(STR), reasonSource: n({ type: 'string', enum: ['PUBLICATION_NOTE'] }) }),
    LotPriceHistorySummary: obj({ priceType: STR, currency: n(STR), comparableVersionCount: INT, initialKnownPrice: n(NUM), initialKnownAt: n(DATE), lastKnownPrice: n(NUM), lastKnownAt: n(DATE),
      currentPrice: n(NUM), currentPriceTableId: n(STR), consistentWithCurrent: BOOL, initialPricePerM2: n(NUM), lastPricePerM2: n(NUM), changeCount: INT, lastChangeAt: n(DATE),
      label: STR, absoluteChange: n(NUM), relativeChangePct: n(NUM), pricePerM2Change: n(NUM),
      calculationStatus: { type: 'string', enum: ['CALCULATED', 'PARTIAL', 'NOT_CALCULABLE'] },
      notCalculableReason: n({ type: 'string', enum: ['NO_VALID_PRICE', 'INSUFFICIENT_COMPARABLE_VERSIONS', 'ZERO_START_PRICE'] }), periodDays: n(INT) },
      { description: 'Variação nominal do preço de tabela entre o primeiro e o último ponto VALID comparáveis; null (com motivo) com menos de 2 versões comparáveis.' }),
    PriceHistoryQuality: obj({ level: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] }, versionCount: INT, validPointCount: INT, missingPointCount: INT,
      invalidPointCount: INT, coverageRatio: NUM, warnings: arr(STR) }),
    LotPriceHistoryDto: obj({ developmentId: STR, lotId: STR, priceType: STR, currency: n(STR), areaM2: n(NUM), methodologyVersion: STR, generatedAt: DT,
      points: arr(ref('PriceHistoryPoint')), intervals: arr(ref('PriceInterval')), changeEvents: arr(ref('PriceChangeEvent')), summary: ref('LotPriceHistorySummary'),
      quality: ref('PriceHistoryQuality'), versionRefs: arr(obj({ priceTableId: STR, version: STR, checksum: n(STR) })), caveats: arr(STR) },
      { description: 'Histórico do preço de tabela publicado de um lote (série em degraus, sem interpolação). Não é preço de venda, valorização do ativo nem rentabilidade.' }),
    LotPriceHistoryResponse: envelope(ref('LotPriceHistoryDto')),
    DevelopmentPriceVersion: obj({ priceTableId: STR, version: STR, versionNumber: INT, status: STR, currency: n(STR), effectiveFrom: n(DATE), effectiveTo: n(DATE), publishedAt: n(DT),
      archivedAt: n(DT), sourceId: n(STR), checksum: n(STR), pricingMode: n(STR), pricedLotCount: INT, coverageRatio: NUM, medianPrice: n(NUM), medianPricePerM2: n(NUM) }),
    DevelopmentPriceChange: obj({ fromPriceTableId: STR, toPriceTableId: STR, fromEffectiveAt: n(DATE), toEffectiveAt: n(DATE), method: { type: 'string', enum: ['SAME_LOT_BASKET_MEDIAN'] },
      commonLotCount: INT, coverageRatio: NUM, addedLotCount: INT, removedPriceLotCount: INT, increased: INT, decreased: INT, unchanged: INT,
      medianRelativeChangePct: n(NUM), medianPricePerM2From: n(NUM), medianPricePerM2To: n(NUM), calculationStatus: { type: 'string', enum: ['CALCULATED', 'NOT_CALCULABLE'] },
      notCalculableReason: n({ type: 'string', enum: ['MIXED_CURRENCY', 'NO_COMMON_LOTS'] }) }),
    DevelopmentPriceHistoryDto: obj({ developmentId: STR, priceType: STR, methodologyVersion: STR, generatedAt: DT, lotCount: INT, label: STR,
      versions: arr(ref('DevelopmentPriceVersion')), changes: arr(ref('DevelopmentPriceChange')),
      summary: obj({ versionCount: INT, firstVersionAt: n(DATE), latestVersionAt: n(DATE), currentPriceTableId: n(STR), consistentWithCurrent: BOOL, numberOfRepricings: INT,
        change: { nullable: true, oneOf: [ref('DevelopmentPriceChange')] }, calculationStatus: { type: 'string', enum: ['CALCULATED', 'NOT_CALCULABLE'] },
        notCalculableReason: n({ type: 'string', enum: ['INSUFFICIENT_COMPARABLE_VERSIONS', 'MIXED_CURRENCY', 'NO_COMMON_LOTS'] }) }),
      caveats: arr(STR) }, { description: 'Índice interno dos preços de tabela (cesta dos mesmos lotes, mediana). Não é índice de mercado.' }),
    DevelopmentPriceHistoryResponse: envelope(ref('DevelopmentPriceHistoryDto')),

    // ---- availability manifest (topic 29)
    AvailabilityManifestDto: obj({ developmentId: STR, revision: { ...INT, minimum: 0 }, checksum: STR, updatedAt: n(DT), sourceId: n(STR), lotCount: INT,
      statusCounts: obj(Object.fromEntries(Object.values(App.enums.AvailabilityStatus).map(k => [k, INT]))),
      freshnessCounts: obj({ FRESH: INT, STALE: INT, EXPIRED: INT, UNKNOWN: INT }), dataStateCounts: obj({ VALID: INT, UNKNOWN_SOURCE: INT }),
      freshnessPolicy: obj({ availabilityMaxAgeMs: n(INT), availabilityExpireAfterMs: n(INT) }), generatedAt: DT },
      { description: 'Manifesto do domínio Availability: revisão própria + checksum + contagens. Sem nenhum campo de preço (independente do Pricing). UNKNOWN nunca conta como AVAILABLE.' }),
    AvailabilityManifestResponse: envelope(ref('AvailabilityManifestDto')),

    // ---- availability
    AvailabilityStreamEvent: obj({
      developmentId: STR, availabilityRevision: { ...INT, minimum: 0 }, previousRevision: n({ ...INT, description: 'Revisão anterior conhecida pelo cliente (Last-Event-ID); null na primeira mensagem.' }),
      updatedAt: n(DT), changedLots: n({ ...INT, description: 'Lotes alterados desde previousRevision; null em resync.' }),
      resync: { ...BOOL, description: 'true: recarregue o snapshot /availability (primeira mensagem, revisão do cliente à frente ou alterações demais).' },
      reason: n({ type: 'string', enum: ['INITIAL', 'REVISION_AHEAD', 'TOO_MANY_CHANGES'] }),
      lots: arr(ref('AvailabilityDto'), { description: 'Somente campos públicos (sem proposalId nem notes).' })
    }, { description: 'data de cada evento `availability` do stream SSE (id do evento = availabilityRevision).' }),
    AvailabilityDto: obj({
      lotId: STR, status: en('AvailabilityStatus'), updatedAt: n(DT), revision: { ...INT, minimum: 0 }, reservedUntil: n(DT),
      freshnessSource: n({ ...STR, description: 'Fonte (sourceId) que confirmou o status por último; null quando UNKNOWN. O cliente calcula a atualidade pela freshnessPolicy.' })
    }, { description: 'Disponibilidade pública de um lote. Sem proposalId nem notes. UNKNOWN nunca é reportado como AVAILABLE.',
      example: { lotId: 'VJ-QB-L0079', status: 'UNKNOWN', updatedAt: null, revision: 0, reservedUntil: null, freshnessSource: null } }),
    AvailabilityResponse: envelope(ref('AvailabilityDto')),
    UpdateAvailabilityResponse: obj({
      lotId: STR, developmentId: STR, status: en('AvailabilityStatus'), revision: INT, updatedAt: n(DT), developmentRevision: INT,
      availability: { type: 'object', description: 'AvailabilityState completo (legado v1; inclui proposalId/notes para o operador autenticado).' }
    }),

    // ---- lots
    ThematicValues: obj({
      scores: thematicScoresSchema,
      noiseLevel: { ...level, description: 'fieldKey environmental.noiseLevel' },
      privacyLevel: { ...level, description: 'fieldKey environmental.privacyLevel' },
      estimatedTraffic: { ...level, description: 'fieldKey mobility.estimatedTraffic' },
      gateProximity: n({ ...en('GateProximity'), description: 'fieldKey mobility.gateProximity' }),
      hasGreenRear: n({ ...BOOL, description: 'fieldKey surroundings.hasGreenRear' }),
      orientationRear: n({ ...en('Direction'), description: 'fieldKey environmental.orientationRear' }),
      routeDistanceToLeisureM: n({ ...NUM, description: 'm — fieldKey mobility.routeDistanceToLeisureM' }),
      frontBearingDeg: n({ ...NUM, description: 'graus — fieldKey environmental.frontBearingDeg' })
    }, { description: 'Valores usados pelas camadas temáticas do mapa (services/layers.js). Cada chave é o último segmento do fieldKey indicado.' }),
    MapLotDto: obj({
      id: { ...STR, example: 'VJ-QB-L0079' }, code: { ...STR, example: 'B79' }, blockId: { ...STR, example: 'B' }, blockNumber: n(INT), lotNumber: INT,
      areaM2: n({ ...NUM, description: 'm² — fieldKey geometry.areaM2' }),
      polygon: POLYGON, centroid: n(POINT),
      availabilityStatus: en('AvailabilityStatus'),
      status: { ...en('AvailabilityStatus'), deprecated: true, description: 'Alias legado de availabilityStatus (v1.0).' },
      price: n({ ...NUM, description: 'BRL — fieldKey commercial.price' }), pricePerM2: n(NUM),
      class: en('LotClass'), overallScore: n({ ...NUM, description: '0–100 — fieldKey intelligence.scores.overall' }),
      thematicValues: ref('ThematicValues')
    }, { description: 'Payload enxuto do mapa: somente render, tooltip, camadas e seleção. Sem ficha completa.' }),
    LotSummaryDto: ref('MapLotDto'),
    MapLotsResponse: obj({ developmentId: STR, versions: ref('Versions'), count: INT, lots: arr(ref('MapLotDto')) }),
    LotQuickViewDto: obj({
      id: STR, code: STR, displayCode: STR, developmentId: STR, blockId: STR, blockNumber: n(INT), lotNumber: INT,
      areaM2: n(NUM), frontM: n(NUM), averageDepthM: n(NUM), isCorner: n(BOOL),
      availabilityStatus: en('AvailabilityStatus'),
      price: n(NUM), pricePerM2: n(NUM), currency: n(STR), priceTableVersion: n(STR),
      class: en('LotClass'), scores: scoresSchema, criteria: criteriaSchema,
      noiseLevel: level, privacyLevel: level, estimatedTraffic: level,
      routeDistanceToGateM: n({ ...NUM, description: 'm — fieldKey mobility.routeDistanceToGateM' }), hasGreenRear: n(BOOL),
      highlights: arr(obj({ type: STR, title: STR, weight: n(NUM) })),
      alerts: arr(obj({ type: en('AlertType'), severity: en('AlertSeverity'), title: STR, fieldKey: n(STR) })),
      analysisVersion: n(STR)
    }, { description: 'Resumo de um lote (Quick View, listas, busca, batch). Sem polígono, sem proveniência.' }),
    LotQuickViewResponse: envelope(ref('LotQuickViewDto')),
    LotListResponse: envelope(arr(ref('LotQuickViewDto')), 'CollectionMeta'),
    LotSearchResponse: envelope(arr(ref('LotQuickViewDto')), 'SearchMeta'),
    BatchSummaryRequest: obj({ ids: arr({ type: 'string', pattern: '^[A-Z0-9]+-Q[A-Z0-9]+-L\\d{4}$' }, { minItems: 1, maxItems: 100 }) }),
    BatchSummaryResponse: envelope(arr(ref('LotQuickViewDto')), 'BatchMeta'),

    Alert: {
      type: 'object', additionalProperties: false, required: ['id', 'type', 'severity', 'title'],
      properties: { id: STR, type: en('AlertType'), severity: en('AlertSeverity'), title: STR, message: n(STR), fieldKey: n(STR), sourceId: n(STR) }
    },
    Highlight: { type: 'object', additionalProperties: false, required: ['id', 'type', 'title'], properties: { id: STR, type: STR, title: STR, fieldKey: n(STR), weight: n(NUM) } },
    Ranking: obj({ type: en('RankingType'), position: INT, total: INT }),
    Easement: { type: 'object', additionalProperties: true, required: ['type'], properties: { type: STR, description: n(STR), sourceId: n(STR) } },
    NoiseSource: { type: 'object', additionalProperties: true, required: ['type'], properties: { type: en('NoiseSourceType'), detail: n(STR), distanceM: n(NUM) } },

    LotIdentity: sections.identity, LotGeometry: sections.geometry, LotLocation: sections.location, LotSurroundings: sections.surroundings,
    LotMobility: sections.mobility, LotEnvironmental: sections.environmental, LotConstruction: sections.construction,
    LotCommercial: sections.commercial, LotIntelligence: sections.intelligence, LotPublicAvailability: publicAvailability,
    ProvenanceSummary: obj({
      totalFields: INT,
      lotSpecificFields: { ...INT, description: 'Campos com proveniência própria do lote (os demais usam o padrão do Field Registry).' },
      byStatus: { type: 'object', additionalProperties: INT, description: 'Contagem por DataStatus' },
      byConfidence: { type: 'object', additionalProperties: INT, description: 'Contagem por Confidence (null → "NONE")' },
      toConfirm: arr(STR, { description: 'fieldKeys com status TO_CONFIRM' }),
      lowConfidence: arr(STR, { description: 'fieldKeys com confiança LOW' }),
      href: STR
    }),
    LotMetadata: {
      type: 'object', additionalProperties: true, required: ['schemaVersion', 'dataVersions'],
      properties: { schemaVersion: STR, createdAt: n(DT), updatedAt: n(DT), dataVersions: { type: 'object' }, freshness: { type: 'object' } }
    },
    LotDetailDto: obj({
      identity: ref('LotIdentity'), geometry: ref('LotGeometry'), location: ref('LotLocation'), surroundings: ref('LotSurroundings'), mobility: ref('LotMobility'),
      environmental: ref('LotEnvironmental'), construction: ref('LotConstruction'), commercial: ref('LotCommercial'), intelligence: ref('LotIntelligence'),
      availability: ref('LotPublicAvailability'), provenanceSummary: ref('ProvenanceSummary'), metadata: ref('LotMetadata')
    }, { description: 'Ficha completa do lote (seções do Lot canônico geradas do Field Registry). Sem notas internas, proposalId nem IDs administrativos; proveniência detalhada em /lots/{lotId}/provenance.' }),
    LotDetailResponse: {
      type: 'object', additionalProperties: false, required: ['data', 'meta', 'lot', 'versions'],
      properties: {
        data: ref('LotDetailDto'), meta: ref('ResourceMeta'),
        lot: { type: 'object', deprecated: true, description: 'Lot canônico completo (contrato v1.0, usado pelo shadow compare). Deprecated: use data. Removido em /api/v2.' },
        versions: { ...ref('Versions'), deprecated: true }
      }
    },
    LotAnalysisDto: obj({
      lotId: STR, generatedAt: n(DT),
      ...sections.intelligence.properties,
      analysisVersion: STR
    }, { description: 'Inteligência do lote na versão de análise corrente: score, classe e ranking sempre da mesma analysisVersion.' }),
    LotAnalysisResponse: envelope(ref('LotAnalysisDto')),
    FieldProvenance: obj({
      fieldKey: STR, domain: STR, status: en('DataStatus'), sourceId: n(STR), method: n(STR), confidence: n(en('Confidence')),
      precision: n(STR), updatedAt: n(STR), notes: n(STR), lotSpecific: BOOL
    }),
    LotProvenanceDto: obj({ lotId: STR, fields: arr(ref('FieldProvenance')) }),
    LotProvenanceResponse: envelope(ref('LotProvenanceDto'))
  };
  return S;
}

module.exports = { buildSchemas, API_VERSION, CONTRACT_VERSION, LAYERS };
