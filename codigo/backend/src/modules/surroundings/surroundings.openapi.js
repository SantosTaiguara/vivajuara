'use strict';
/* OpenAPI 3.0 fragment of topic 63 (paths + component schemas), kept in the module until the routes are wired.
   Integration: in scripts/lib/openapiDoc.js buildPaths(), call
     require('../../src/modules/surroundings/surroundings.openapi').addPaths(add, { DEV, queryParam, ref })
   and merge `schemas` into components.schemas; add the error codes of ERROR_CODES to ERROR_CATALOG (shared/http/errors.js)
   at the same time (tests/backend/api.openapi.test.js requires every documented code and route to exist). */
const domain = require('../../../../src/surroundings/surroundingsDomain.js');
const cfg = require('../../../../src/config/surroundings/surroundings.config.js');

const GeoPoint = { type: 'object', required: ['latitude', 'longitude'], properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } } };
const Attribution = { type: 'object', required: ['provider', 'text', 'required'], properties: { provider: { type: 'string', enum: ['GOOGLE'] }, text: { type: 'string' }, required: { type: 'boolean' }, policyRef: { type: 'string' } } };
const schemas = {
  SurroundingsGeoPoint: GeoPoint,
  SurroundingsAttribution: Attribution,
  NearbyPlace: { type: 'object', required: ['provider', 'providerPlaceId', 'categoryCode', 'name', 'location', 'straightLineDistanceMeters'], properties: {
    provider: { type: 'string', enum: ['GOOGLE'] }, providerPlaceId: { type: 'string', pattern: domain.PLACE_ID_RE.source }, categoryCode: { type: 'string' }, name: { type: 'string' },
    primaryType: { type: 'string' }, types: { type: 'array', items: { type: 'string' } }, location: { $ref: '#/components/schemas/SurroundingsGeoPoint' }, formattedAddress: { type: 'string', description: 'Ausente quando o provedor não informa (nunca inventado).' },
    rating: { type: 'number', description: 'Ausente = sem avaliação (nunca 0). Dado do provedor, não recomendação.' }, userRatingCount: { type: 'integer' },
    straightLineDistanceMeters: { type: 'number', description: 'Haversine a partir da coordenada oficial validada, precisão total (exibição arredonda).' } } },
  NearbyPlacesResult: { type: 'object', required: ['developmentId', 'center', 'requestedRadiusMeters', 'effectiveRadiusMeters', 'categoryCode', 'places', 'provider', 'generatedAt', 'attribution'], properties: {
    developmentId: { type: 'string' }, center: { $ref: '#/components/schemas/SurroundingsGeoPoint' }, locationVersion: { type: 'string' }, requestedRadiusMeters: { type: 'integer', enum: [2000, 4000, 6000, 8000] },
    effectiveRadiusMeters: { type: 'integer', maximum: 8000 }, maxRadiusMeters: { type: 'integer', maximum: 8000 }, categoryCode: { type: 'string' }, categoryVersion: { type: 'string' }, rankPreference: { type: 'string', enum: domain.RANKS },
    resultLimit: { type: 'integer', maximum: 20 }, resultCount: { type: 'integer', description: 'Quantidade retornada pela busca (não é o total existente no raio).' }, places: { type: 'array', maxItems: 20, items: { $ref: '#/components/schemas/NearbyPlace' } },
    provider: { type: 'string', enum: ['GOOGLE'] }, generatedAt: { type: 'string', format: 'date-time' }, persisted: { type: 'boolean' }, summaryText: { type: 'string' }, attribution: { $ref: '#/components/schemas/SurroundingsAttribution' } } },
  RouteEstimateRequest: { type: 'object', additionalProperties: false, required: ['providerPlaceId', 'travelMode'], properties: { providerPlaceId: { type: 'string', pattern: domain.PLACE_ID_RE.source }, travelMode: { type: 'string', enum: ['DRIVE'] }, trafficMode: { type: 'string', enum: cfg.provider.routes.trafficModes } } },
  RouteEstimateResult: { type: 'object', required: ['developmentId', 'providerPlaceId', 'routeSummary'], properties: { developmentId: { type: 'string' }, providerPlaceId: { type: 'string' },
    routeSummary: { type: 'object', required: ['mode', 'distanceMeters', 'durationSeconds', 'trafficAware', 'computedAt'], properties: { mode: { type: 'string', enum: ['DRIVE'] }, distanceMeters: { type: 'number', description: 'De carro (pode passar de 8 km).' }, durationSeconds: { type: 'number', description: 'Tempo estimado do provedor, não garantido.' }, trafficAware: { type: 'boolean' }, computedAt: { type: 'string', format: 'date-time' } } },
    persisted: { type: 'boolean' }, attribution: { $ref: '#/components/schemas/SurroundingsAttribution' } } },
  EnvironmentMapConfigResponse: { type: 'object', required: ['enabled', 'state', 'coordinateStatus', 'center', 'maxRadiusMeters', 'selectableRadiiMeters', 'categories', 'routesEnabled'], properties: {
    enabled: { type: 'boolean' }, state: { type: 'string', enum: ['AVAILABLE', 'NOT_VALIDATED', 'NOT_CONFIGURED', 'OFFLINE'] }, coordinateStatus: { type: 'string', enum: ['VALIDATED', 'NOT_VALIDATED', 'REJECTED', 'INVALID'] }, message: { type: 'string', nullable: true },
    center: { allOf: [{ $ref: '#/components/schemas/SurroundingsGeoPoint' }], nullable: true, description: 'null enquanto a coordenada oficial não estiver validada.' }, locationVersion: { type: 'string' }, maxRadiusMeters: { type: 'integer', maximum: 8000 },
    selectableRadiiMeters: { type: 'array', items: { type: 'integer' } }, defaultRadiusMeters: { type: 'integer' }, strictBounds: { type: 'boolean' },
    categories: { type: 'array', items: { type: 'object', required: ['code', 'label', 'iconKey'], properties: { code: { type: 'string' }, label: { type: 'string' }, iconKey: { type: 'string' } } } },
    nearbyPlacesEnabled: { type: 'boolean' }, routesEnabled: { type: 'boolean' }, mapId: { type: 'string' }, attribution: { $ref: '#/components/schemas/SurroundingsAttribution' } }, description: 'Nunca contém chave de API.' }
};
const ERROR_CODES = Object.keys(domain.ERRORS);

function addPaths(add, { DEV, queryParam, ref = n => ({ $ref: `#/components/schemas/${n}` }) }) {
  const common = { 400: ['VALIDATION_ERROR', 'TENANT_CONTEXT_REQUIRED'], 401: ['UNAUTHORIZED'], 403: ['PERMISSION_DENIED'], 404: ['DEVELOPMENT_NOT_FOUND'] };
  const security = [{ bearerAuth: [] }, { cookieAuth: [] }];
  add('/api/v1/developments/{developmentId}/environment-map-config', 'get', { tags: ['surroundings'], summary: 'Configuração segura do mapa de Entorno (sem chave de API)', params: DEV, cache: 'PRIVATE', ok: { type: 'object', properties: { data: ref('EnvironmentMapConfigResponse'), meta: { type: 'object' } } }, security, errors: common });
  add('/api/v1/developments/{developmentId}/nearby-places', 'get', { tags: ['surroundings'], summary: 'Locais encontrados no raio (Places API New, proxy semântico, máximo 8 km)',
    description: 'Somente category, radius (2000|4000|6000|8000) e rank (DISTANCE|POPULARITY). Raio fora da lista → 422 LOCATION_RADIUS_INVALID (nunca chama o provedor). FieldMask e maxResultCount (≤ 20) fixos no servidor. Pós-filtro Haversine.',
    params: DEV, query: [{ ...queryParam('category', { type: 'enum', enum: cfg.categories.map(c => c.code) }, 'Categoria do registro (nunca um tipo Google).'), required: true }, { ...queryParam('radius', { type: 'enum', enum: ['2000', '4000', '6000', '8000'] }, 'Raio em metros.'), required: true }, queryParam('rank', { type: 'enum', enum: domain.RANKS, default: 'DISTANCE' }, 'Ordem.')],
    cache: 'NONE', ok: { type: 'object', properties: { data: ref('NearbyPlacesResult'), meta: { type: 'object' } } }, security,
    errors: { ...common, 409: ['GOOGLE_MAPS_LOCATION_UNVERIFIED'], 422: ['LOCATION_RADIUS_INVALID', 'LOCATION_CATEGORY_UNSUPPORTED'], 502: ['GOOGLE_PLACES_INVALID_REQUEST'], 503: ['GOOGLE_MAPS_NOT_CONFIGURED', 'GOOGLE_PLACES_UNAVAILABLE', 'GOOGLE_PLACES_QUOTA_EXCEEDED', 'GOOGLE_PROVIDER_AUTH_ERROR', 'GOOGLE_PROVIDER_RATE_LIMIT'] } });
  add('/api/v1/developments/{developmentId}/route-estimates', 'post', { tags: ['surroundings'], summary: 'Trajeto sob demanda (Routes API, DRIVE) da coordenada oficial até um local retornado pela busca',
    params: DEV, requestBody: { required: true, content: { 'application/json': { schema: ref('RouteEstimateRequest') } } }, cache: 'NONE', ok: { type: 'object', properties: { data: ref('RouteEstimateResult'), meta: { type: 'object' } } }, security,
    errors: { ...common, 403: ['PERMISSION_DENIED', 'CSRF_TOKEN_INVALID'], 409: ['GOOGLE_MAPS_LOCATION_UNVERIFIED'], 422: ['LOCATION_PLACE_NOT_IN_SCOPE'], 503: ['GOOGLE_MAPS_NOT_CONFIGURED', 'GOOGLE_ROUTES_UNAVAILABLE', 'GOOGLE_ROUTES_QUOTA_EXCEEDED', 'GOOGLE_PROVIDER_AUTH_ERROR', 'GOOGLE_PROVIDER_RATE_LIMIT'] } });
}

module.exports = { addPaths, schemas, ERROR_CODES };
