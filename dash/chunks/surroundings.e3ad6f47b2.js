/* Viva Juara — chunk "surroundings" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- config/surroundings/surroundings.config.js ---- */
/* config/surroundings/surroundings.config.js — topic 63 (Google Maps, Entorno, raio máximo de 8 km).
   One source of truth for the browser (App.surroundings.config) and the backend (require()). Pure data, no secrets.

   RULES CARRIED BY THIS FILE
   - Feature flag location_intelligence_google_maps = false (OFF). Rollback = keep it false.
   - The Entorno center is ONLY a validated official development coordinate. Since 2026-10-18 it is the gatehouse AC3
     "Portaria" taken from the developer's KMZ, validated by the owner (Edmilson Margon) on the KMZ basis — see
     location.sourceRef / validationMethod / validatedBy / validatedAt below and docs/RELATORIO_TOPICO_63.md. Nothing in
     the code derives a center from a neighbourhood, a lot centroid, the solar coordinate or an LLM.
   - maxNearbyRadiusMeters = 8000 is the explicit business rule of the spec (§2, §4, §283, §554). Selectable radii
     2000/4000/6000/8000 (§84). Any other value → INVALID_RADIUS (§85, §412).
   - Google place types: only types checked against the official "Place types (New)" Table A
     (https://developers.google.com/maps/documentation/places/web-service/place-types), as the spec requires (§47, §48).
   - Business/legal values not decided by the spec are null + "necessita confirmação": the code refuses (deny) while null.
   - API keys never live here. Server key: env GOOGLE_MAPS_API_KEY (backend only). Browser key: provisioned by the
     deployment (GOOGLE_MAPS_BROWSER_KEY, restricted by HTTP referrer + Maps JavaScript API), never in Git. */
(function () {
  const NEEDS = 'necessita confirmação';
  const CFG = {
    kind: 'surroundings-config',
    version: '2026-10-16.1',
    topic: 63,
    featureFlag: { key: 'location_intelligence_google_maps', enabled: false, rollout: ['INTERNAL_ADMINS', 'SELECTED_BROKERS', 'HOUSE_7', 'FUTURE_TENANTS'], rolloutStage: null },
    capabilities: ['GOOGLE_MAPS_ENVIRONMENT', 'NEARBY_PLACES', 'ROUTE_ESTIMATES'],

    // ---------------------------------------------------------------- DevelopmentLocationConfig (§7, §8)
    developments: {
      'viva-juara': {
        location: {
          developmentId: 'viva-juara', organizationId: 'org_house7', name: 'Viva Juara',
          // 2026-10-18: owner's decision (round 6). Gatehouse AC3 "Portaria" from the developer's KMZ; never invented (§10).
          center: { latitude: -20.145472, longitude: -40.211418 },
          centerKind: 'GATEHOUSE',            // ponto AC3 "Portaria" (entrada do empreendimento), não um centróide
          estimatedAccuracyMeters: 10,        // aproximadamente 10 m (ajuste afim planta → KMZ)
          maxNearbyRadiusMeters: 8000,
          locationStatus: 'VALIDATED',        // UNVERIFIED | VALIDATED | REJECTED
          sourceRef: "KMZ da incorporadora (GroundOverlay 'Quintas II', LatLonBox N -20.14228 S -20.14923 E -40.20275 W -40.21316), ponto AC3 Portaria convertido do plano por ajuste afim com os 498 lotes (erro médio 0,3 m, máx 3,9 m)",
          validationMethod: 'OFFICIAL_KML_KMZ', validatedBy: 'Edmilson Margon (owner)', validatedAt: '2026-10-18',
          googleMapsEnabled: false,           // flag OFF and no key: the visitor still sees nothing
          version: 'loc-1',
          // What the inventory found before the owner's decision (topic 63 §618 step 4). References only, never used as the center.
          candidateEvidence: [
            { ref: 'src/config/developments.js#geo', kind: 'SOLAR_INPUT', note: 'Coordenada de 3 casas decimais usada só no cálculo solar; sem fonte, sem validação e sem autor. Não é a coordenada oficial do empreendimento.' },
            { ref: 'lots.json#location.latitude/longitude (fonte kmz-v1)', kind: 'PER_LOT_KMZ', note: 'Coordenadas por lote derivadas do KMZ (fonte sem data). Não existe centro oficial do empreendimento; derivar um centróide seria inventar o centro.' }
          ]
        },
        intelligence: { // DevelopmentLocationIntelligenceConfig (§281, §282)
          enabled: false,
          maxRadiusMeters: 8000, approvedMaxRadiusMeters: 8000,
          selectableRadiiMeters: [2000, 4000, 6000, 8000], defaultRadiusMeters: 8000,
          enabledCategoryCodes: ['SUPERMARKETS', 'SCHOOLS', 'HEALTH', 'PHARMACIES', 'SHOPPING_COMMERCE', 'RESTAURANTS', 'GYMS', 'PARKS_LEISURE', 'BEACHES', 'GAS_STATIONS', 'BANKS', 'PUBLIC_TRANSPORT'],
          defaultCategoryCode: null,          // lazy loading: no category on open (§54, §55)
          routesEnabled: false, recommendationIntegrationEnabled: false, presentationIntegrationEnabled: false,
          version: 'li-2026-10-16.1'
        },
        viewport: { developmentId: 'viva-juara', maxRadiusMeters: 8000, initialFitMode: 'RADIUS_BOUNDS', minZoom: null, maxZoom: null, strictBounds: false, paddingPx: { desktop: 48, mobile: 16 } }
      }
    },

    // ---------------------------------------------------------------- radius (§3, §83–§86, §127–§129)
    radius: { productMaxMeters: 8000, providerTechnicalMaxMeters: 50000, boundaryToleranceMeters: 1, invalidRadiusBehavior: 'REJECT' },

    // ---------------------------------------------------------------- Places API (New) type table (subset in use)
    placeTypeTable: {
      provider: 'GOOGLE', api: 'PLACES_NEW', table: 'A',
      sourceUrl: 'https://developers.google.com/maps/documentation/places/web-service/place-types',
      pageLastUpdated: '2026-10-13', verifiedAt: '2026-10-16', verifiedBy: 'topic-63-implementation (Claude)',
      types: ['supermarket', 'grocery_store', 'school', 'primary_school', 'secondary_school', 'preschool', 'university', 'hospital', 'medical_clinic', 'doctor',
        'pharmacy', 'drugstore', 'shopping_mall', 'department_store', 'restaurant', 'gym', 'fitness_center', 'park', 'beach', 'gas_station', 'bank', 'atm',
        'bus_station', 'bus_stop', 'transit_station', 'train_station']
    },

    // ---------------------------------------------------------------- NearbyPlaceCategoryRegistry (§44–§53)
    categories: [
      { id: 'cat-supermarkets', code: 'SUPERMARKETS', label: 'Supermercados', shortLabel: 'Mercados', googleIncludedTypes: ['supermarket', 'grocery_store'], iconKey: 'cart', glyph: 'M', enabled: true, defaultVisible: true, maxResults: 20, displayOrder: 1, allowedForRecommendation: false, version: '1' },
      { id: 'cat-schools', code: 'SCHOOLS', label: 'Escolas', shortLabel: 'Escolas', googleIncludedTypes: ['school', 'primary_school', 'secondary_school', 'preschool'], iconKey: 'school', glyph: 'E', enabled: true, defaultVisible: true, maxResults: 20, displayOrder: 2, allowedForRecommendation: false, version: '1' },
      { id: 'cat-health', code: 'HEALTH', label: 'Hospitais e clínicas', shortLabel: 'Saúde', googleIncludedTypes: ['hospital', 'medical_clinic'], iconKey: 'health', glyph: 'S', enabled: true, defaultVisible: true, maxResults: 20, displayOrder: 3, allowedForRecommendation: false, version: '1' },
      { id: 'cat-pharmacies', code: 'PHARMACIES', label: 'Farmácias', shortLabel: 'Farmácias', googleIncludedTypes: ['pharmacy', 'drugstore'], iconKey: 'pharmacy', glyph: 'F', enabled: true, defaultVisible: true, maxResults: 20, displayOrder: 4, allowedForRecommendation: false, version: '1' },
      { id: 'cat-shopping', code: 'SHOPPING_COMMERCE', label: 'Comércio e shopping', shortLabel: 'Comércio', googleIncludedTypes: ['shopping_mall', 'department_store'], iconKey: 'shop', glyph: 'C', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 5, allowedForRecommendation: false, version: '1' },
      { id: 'cat-restaurants', code: 'RESTAURANTS', label: 'Restaurantes', shortLabel: 'Restaurantes', googleIncludedTypes: ['restaurant'], iconKey: 'restaurant', glyph: 'R', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 6, allowedForRecommendation: false, version: '1' },
      { id: 'cat-gyms', code: 'GYMS', label: 'Academias', shortLabel: 'Academias', googleIncludedTypes: ['gym', 'fitness_center'], iconKey: 'gym', glyph: 'A', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 7, allowedForRecommendation: false, version: '1' },
      { id: 'cat-parks', code: 'PARKS_LEISURE', label: 'Parques e lazer', shortLabel: 'Lazer', googleIncludedTypes: ['park'], iconKey: 'park', glyph: 'P', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 8, allowedForRecommendation: false, version: '1' },
      { id: 'cat-beaches', code: 'BEACHES', label: 'Praias', shortLabel: 'Praias', googleIncludedTypes: ['beach'], iconKey: 'beach', glyph: 'Pr', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 9, allowedForRecommendation: false, version: '1' },
      { id: 'cat-gas', code: 'GAS_STATIONS', label: 'Postos de combustível', shortLabel: 'Postos', googleIncludedTypes: ['gas_station'], iconKey: 'fuel', glyph: 'G', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 10, allowedForRecommendation: false, version: '1' },
      { id: 'cat-banks', code: 'BANKS', label: 'Bancos e caixas eletrônicos', shortLabel: 'Bancos', googleIncludedTypes: ['bank', 'atm'], iconKey: 'bank', glyph: 'B', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 11, allowedForRecommendation: false, version: '1' },
      { id: 'cat-transport', code: 'PUBLIC_TRANSPORT', label: 'Transporte público', shortLabel: 'Transporte', googleIncludedTypes: ['bus_station', 'bus_stop', 'transit_station', 'train_station'], iconKey: 'bus', glyph: 'T', enabled: true, defaultVisible: false, maxResults: 20, displayOrder: 12, allowedForRecommendation: false, version: '1' }
    ],

    // ---------------------------------------------------------------- provider request policy (fixed server-side)
    provider: {
      code: 'GOOGLE_MAPS',
      places: {
        endpoint: 'https://places.googleapis.com/v1/places:searchNearby', method: 'POST', maxResultCountCap: 20,
        rankPreferences: ['DISTANCE', 'POPULARITY'], defaultRank: 'DISTANCE', languageCode: 'pt-BR', regionCode: 'BR',
        fieldMaskPolicyRef: 'places-nearby-v1',
        fieldMask: ['places.id', 'places.displayName', 'places.location', 'places.primaryType', 'places.types', 'places.formattedAddress', 'places.rating', 'places.userRatingCount'],
        fieldMaskAllowlist: ['places.id', 'places.displayName', 'places.location', 'places.primaryType', 'places.types', 'places.formattedAddress', 'places.rating', 'places.userRatingCount'],
        forbiddenFields: ['places.reviews', 'places.editorialSummary', 'places.regularOpeningHours', 'places.currentOpeningHours', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri', 'places.parkingOptions', 'places.paymentOptions', 'places.photos']
      },
      routes: {
        endpoint: 'https://routes.googleapis.com/directions/v2:computeRoutes', method: 'POST',
        travelModes: ['DRIVE'], trafficModes: ['TRAFFIC_UNAWARE', 'TRAFFIC_AWARE'], defaultTrafficMode: 'TRAFFIC_UNAWARE', languageCode: 'pt-BR', units: 'METRIC',
        fieldMaskPolicyRef: 'routes-compute-v1',
        fieldMask: ['routes.distanceMeters', 'routes.duration'],
        fieldMaskAllowlist: ['routes.distanceMeters', 'routes.duration', 'routes.polyline.encodedPolyline'],
        polylineEnabled: false
      },
      http: { timeoutMs: 8000, maxAttempts: 2, backoffBaseMs: 250, retryOn: ['NETWORK', 429, 500, 502, 503, 504], note: 'Valores técnicos (não comerciais), revisar após medir a latência real.' },
      serverKeyEnv: 'GOOGLE_MAPS_API_KEY', browserKeyEnv: 'GOOGLE_MAPS_BROWSER_KEY', mapIdEnv: 'GOOGLE_MAPS_MAP_ID',
      mapsJs: { scriptOrigin: 'https://maps.googleapis.com', loaderPath: '/maps/api/js', version: 'weekly', libraries: ['marker'], language: 'pt-BR', region: 'BR' }
    },

    // ---------------------------------------------------------------- ExternalLocationRateLimitPolicy (§217, §218)
    rateLimit: { scope: 'USER', placesRequestsPerMinute: null, routesRequestsPerMinute: null, version: 'rl-0', status: NEEDS, note: 'Números escolhidos após a linha de base de uso (§217). Enquanto null, o servidor recusa chamadas ao Google.' },

    // ---------------------------------------------------------------- ExternalProviderContentPolicy (§98–§108, §309–§318)
    contentPolicies: [
      { provider: 'GOOGLE', contentType: 'PLACE_ID', persistenceMode: 'PLACE_ID_ONLY', maxTtlSeconds: null, attributionRequired: false, policyVersion: 'gmp-content-2026-10-16', note: 'Place IDs podem ser guardados (isentos das restrições de cache, conforme a orientação vigente do Google).' },
      { provider: 'GOOGLE', contentType: 'PLACE_RESULT', persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true, policyVersion: 'gmp-content-2026-10-16', note: 'Nome, posição, endereço, tipos e avaliação: só na resposta corrente. Nenhum cache até a revisão dos termos.' },
      { provider: 'GOOGLE', contentType: 'ROUTE_ESTIMATE', persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true, policyVersion: 'gmp-content-2026-10-16', note: 'Tempo estimado é efêmero; nunca é dado permanente do empreendimento.' },
      { provider: 'GOOGLE', contentType: 'REVIEW', persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true, policyVersion: 'gmp-content-2026-10-16', note: 'Avaliações escritas não são solicitadas nem arquivadas.' },
      { provider: 'GOOGLE', contentType: 'MAP_TILE', persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true, policyVersion: 'gmp-content-2026-10-16', note: 'Sem mapa offline próprio a partir de tiles do Google; Service Worker não guarda respostas do Google.' }
    ],
    placeIdRefreshPolicy: { refreshAfterDays: null, status: NEEDS },

    // ---------------------------------------------------------------- ProviderPolicyVersion (§456)
    providerPolicy: { provider: 'GOOGLE_MAPS', reviewedAt: null, reviewedBy: null, termsVersionRef: null, cacheRulesRef: 'docs/GOOGLE_MAPS_CACHE_AND_STORAGE_POLICY.md', attributionRulesRef: 'docs/GOOGLE_MAPS_ATTRIBUTION_POLICY.md', nextReviewAt: null, status: NEEDS },

    // ---------------------------------------------------------------- coordinate change governance (§383–§388)
    locationChangePolicy: { requireDistinctApprover: null, status: NEEDS, previewRequired: true },

    // ---------------------------------------------------------------- attribution (§105–§107, §259)
    attribution: { provider: 'GOOGLE', text: 'Dados de locais: Google Maps', required: true, policyRef: 'docs/GOOGLE_MAPS_ATTRIBUTION_POLICY.md' },

    // ---------------------------------------------------------------- round 7 (2026-10-19): keyless base map of the Entorno
    // Owner's request (Edmilson, 2026-10-19): "ver a região ao redor do empreendimento". There is no Google key yet, so the
    // Entorno opens on OpenStreetMap raster tiles (no key, no script, no data about the user beyond what any <img> sends).
    // Google features (Places/Routes/Maps JS) keep the topic-63 path above and stay NOT_CONFIGURED until a key exists.
    baseMapProviders: [
      { code: 'OSM', name: 'OpenStreetMap', kind: 'RASTER_TILES', enabled: true, requiresKey: false,
        tileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', origin: 'https://tile.openstreetmap.org', tileSize: 256, minZoom: 11, maxZoom: 18,
        attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', required: true },
        usagePolicy: { url: 'https://operations.osmfoundation.org/policies/tiles/', visibleTilesOnly: true, maxPrefetchRings: 1, bulkDownload: false, serviceWorkerCache: false, offlineUse: false,
          referrerPolicy: 'strict-origin-when-cross-origin', note: 'Só os tiles visíveis (mais no máximo 1 anel), sem download em massa, sem cache no Service Worker; atribuição sempre visível.' },
        csp: { directive: 'img-src', source: 'https://tile.openstreetmap.org' },
        dataSent: 'IP, User-Agent e a origem da página (Referer só com a origem) do visitante, como em qualquer imagem; nenhum dado de cliente, lote ou preço.',
        reviewedAt: '2026-10-19', reviewedBy: 'round-7 implementation (Claude)', status: 'ACTIVE' }
    ],
    environmentMap: {
      baseMapProvider: 'OSM',
      ringsMeters: [2000, 4000, 6000, 8000], ringKind: 'STRAIGHT_LINE', ringLabel: 'Linha reta',
      boundsRadiusMeters: 8000, boundsMarginMeters: 2000, initialFitRadiusMeters: 2000,
      planOverlay: { enabled: true, defaultOpacity: 0.85, method: 'AFFINE_LOT_CENTROIDS', source: 'planta.webp + lots.json (centróides dos polígonos da planta ↔ latitude/longitude do KMZ)', maxResidualMeters: 5, lotPolygonsMinZoom: 16 },
      gate: { label: 'Portaria', ref: 'AC3' },
      externalLinks: { provider: 'GOOGLE_MAPS_URLS', requiresKey: false, sendsUserData: false,
        search: 'https://www.google.com/maps/search/?api=1&query={lat},{lon}', directions: 'https://www.google.com/maps/dir/?api=1&destination={lat},{lon}' },
      copy: {
        title: 'Entorno',
        nearbyPending: 'Locais próximos (mercados, escolas, farmácias) aparecem quando a chave do Google Maps for configurada.',
        tilesFailed: 'Mapa de fundo indisponível nesta visualização',
        tilesFailedHint: 'A planta, os círculos e os links do Google Maps continuam funcionando.',
        offline: 'Mapa de fundo indisponível sem conexão.',
        rings: 'Círculos de 2, 4, 6 e 8 km em linha reta a partir da portaria',
        openInMaps: 'Abrir no Google Maps', directions: 'Como chegar',
        notValidated: 'Coordenada oficial do empreendimento ainda não validada.'
      }
    },

    // ---------------------------------------------------------------- product events (§286–§288): categoryCode + radiusBucket only
    events: ['environment_map_opened', 'nearby_category_selected', 'nearby_radius_selected', 'nearby_place_selected', 'route_estimate_requested'],

    copy: {
      notValidated: 'Coordenada oficial do empreendimento ainda não validada.',
      notConfigured: 'Entorno ainda não configurado para este empreendimento.',
      unavailable: 'Dados do entorno temporariamente indisponíveis.',
      offline: 'Entorno indisponível sem conexão. O mapa de lotes continua funcionando.',
      selectCategory: 'Selecione o que deseja encontrar no entorno.',
      loading: 'Carregando locais...',
      empty: 'Nenhum resultado retornado para esta busca.',
      emptyHint: 'Nenhum local encontrado nesta categoria dentro do raio selecionado. Isso não significa que não exista nenhum: a busca devolve um conjunto limitado.',
      resultsHeading: 'Locais encontrados no raio',
      maxRadius: 'Raio máximo do entorno: 8 km',
      straightLine: 'Distância aproximada em linha reta',
      routeNote: 'O local está dentro do raio de 8 km; o trajeto por vias pode ser maior.',
      footer: 'As distâncias em linha reta consideram a coordenada oficial do empreendimento. Distâncias e tempos por vias são estimativas do provedor e podem variar.',
      routeFailed: 'Não foi possível calcular o trajeto agora. A distância em linha reta continua válida.',
      noRating: 'Sem avaliação disponível'
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CFG;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.config = CFG; }
})();

/* ---- surroundings/surroundingsDomain.js ---- */
/* surroundings/surroundingsDomain.js — topic 63: location intelligence domain (Entorno, raio máximo de 8 km).
   Pure functions, no I/O, no provider SDK. Shared by the browser (App.surroundings.domain) and the backend
   (require('…/src/surroundings/surroundingsDomain.js')), so both apply the same radius, category, distance and copy rules.

   Invariants (spec §648): center = VALIDATED coordinate only · max radius 8000 m · client never widens it · Google
   technical max ≠ product max · explicit FieldMask, never '*' · ≤ 20 results · route on demand · straight line ≠ road ·
   only Place IDs may be persisted · attribution never removed · no verified coordinate → no environment map. */
(function () {
  const DOMAIN_VERSION = '63.1.0';
  const EARTH_RADIUS_M = 6371008.8; // IUGG mean Earth radius (Haversine on a sphere)
  const RANKS = Object.freeze(['DISTANCE', 'POPULARITY']);
  const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
  const CATEGORY_RE = /^[A-Z][A-Z_]{1,40}$/;

  /** Provider-neutral error catalog (§180). status = HTTP status the backend answers with. */
  const ERRORS = Object.freeze({
    GOOGLE_MAPS_NOT_CONFIGURED: { status: 503, message: 'Entorno ainda não configurado para este empreendimento.' },
    GOOGLE_MAPS_LOCATION_UNVERIFIED: { status: 409, message: 'Coordenada oficial do empreendimento ainda não validada.' },
    GOOGLE_PLACES_UNAVAILABLE: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PLACES_QUOTA_EXCEEDED: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PLACES_INVALID_REQUEST: { status: 502, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_ROUTES_UNAVAILABLE: { status: 503, message: 'Não foi possível calcular o trajeto agora.' },
    GOOGLE_ROUTES_QUOTA_EXCEEDED: { status: 503, message: 'Não foi possível calcular o trajeto agora.' },
    GOOGLE_PROVIDER_AUTH_ERROR: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PROVIDER_RATE_LIMIT: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    LOCATION_CATEGORY_UNSUPPORTED: { status: 422, message: 'Categoria de entorno não suportada.' },
    LOCATION_RADIUS_INVALID: { status: 422, message: 'Raio não permitido. Use 2, 4, 6 ou 8 km.' },
    LOCATION_PLACE_NOT_IN_SCOPE: { status: 422, message: 'Este local não foi retornado por uma busca do entorno deste empreendimento. Refaça a busca.' },
    LOCATION_POLICY_NOT_CONFIGURED: { status: 409, message: 'Política de validação de coordenada ainda não definida.' },
    LOCATION_CHANGE_INVALID: { status: 422, message: 'Alteração de coordenada inválida.' },
    LOCATION_RATE_LIMITED: { status: 429, message: 'Muitas consultas ao entorno; tente novamente em instantes.' }
  });

  const cfgOf = c => c || (typeof App !== 'undefined' && App && App.surroundings && App.surroundings.config) || (typeof require === 'function' ? require('../config/surroundings/surroundings.config.js') : null);
  const fail = (code, details) => ({ ok: false, code, message: (ERRORS[code] || {}).message || code, details: details || null });
  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  // ------------------------------------------------------------------ coordinates (§7–§13, LI-DQ-001..003)
  /** validateCoordinate({latitude, longitude}) → issues[] (empty = valid). No rounding (§491). */
  function validateCoordinate(p) {
    const issues = [];
    if (!p || typeof p !== 'object') return [{ rule: 'LI-DQ-001', reason: 'MISSING' }];
    if (!isNum(p.latitude) || p.latitude < -90 || p.latitude > 90) issues.push({ rule: 'LI-DQ-002', reason: 'LATITUDE_OUT_OF_RANGE' });
    if (!isNum(p.longitude) || p.longitude < -180 || p.longitude > 180) issues.push({ rule: 'LI-DQ-003', reason: 'LONGITUDE_OUT_OF_RANGE' });
    return issues;
  }
  /** locationReadiness(DevelopmentLocationConfig) → { ready, coordinateStatus: VALIDATED | NOT_VALIDATED | REJECTED | INVALID, code, message } */
  function locationReadiness(loc, cfg) {
    const C = cfgOf(cfg);
    if (!loc) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    if (loc.locationStatus === 'REJECTED') return { ready: false, coordinateStatus: 'REJECTED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    if (loc.locationStatus !== 'VALIDATED' || !loc.center) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    const issues = validateCoordinate(loc.center);
    if (issues.length) return { ready: false, coordinateStatus: 'INVALID', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated, issues };
    if (!loc.sourceRef || !loc.validationMethod || !loc.validatedBy || !loc.validatedAt) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated, issues: [{ rule: 'LI-DQ-001', reason: 'PROVENANCE_MISSING' }] };
    return { ready: true, coordinateStatus: 'VALIDATED', code: null, message: null };
  }
  /** provenance(loc) → answers "de onde veio, quem validou, qual versão" (§13) without exposing anything secret */
  const provenance = loc => loc ? { developmentId: loc.developmentId, version: loc.version, locationStatus: loc.locationStatus, sourceRef: loc.sourceRef || null, validationMethod: loc.validationMethod || null, validatedBy: loc.validatedBy || null, validatedAt: loc.validatedAt || null } : null;

  // ------------------------------------------------------------------ geodesy (§122–§129, §493–§499)
  /** haversineMeters(a, b) → great-circle distance in meters (full precision, never rounded before filtering) */
  function haversineMeters(a, b) {
    const R = Math.PI / 180, dLat = (b.latitude - a.latitude) * R, dLng = (b.longitude - a.longitude) * R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * R) * Math.cos(b.latitude * R) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** destination(center, bearingDeg, meters) → point (used by tests/fixtures and bounds) */
  function destination(c, bearingDeg, d) {
    const R = Math.PI / 180, δ = d / EARTH_RADIUS_M, θ = bearingDeg * R, φ1 = c.latitude * R, λ1 = c.longitude * R;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { latitude: φ2 / R, longitude: ((λ2 / R + 540) % 360) - 180 };
  }
  /** boundsAround(center, radius) → GeoBounds {north, south, east, west} enclosing the circle (viewport rule §63, §68) */
  function boundsAround(c, r) {
    const n = destination(c, 0, r), s = destination(c, 180, r), e = destination(c, 90, r), w = destination(c, 270, r);
    const dLng = Math.max(Math.abs(e.longitude - c.longitude), Math.abs(c.longitude - w.longitude)) * 1.0005; // small widening: meridians converge
    return { north: n.latitude, south: s.latitude, east: c.longitude + dLng, west: c.longitude - dLng };
  }

  // ------------------------------------------------------------------ radius policy (§2–§4, §81–§86, §411–§414)
  function radiusPolicy(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId];
    if (!d) return null;
    const max = Math.min(d.location.maxNearbyRadiusMeters, d.intelligence.maxRadiusMeters, C.radius.productMaxMeters);
    return { developmentId, maxRadiusMeters: max, selectableRadiiMeters: d.intelligence.selectableRadiiMeters.filter(r => r > 0 && r <= max), defaultRadiusMeters: d.intelligence.defaultRadiusMeters, toleranceMeters: C.radius.boundaryToleranceMeters };
  }
  /** resolveRadius(requested, policy) → { ok, requestedRadiusMeters, effectiveRadiusMeters } | INVALID_RADIUS. Never clamps silently (§412). */
  function resolveRadius(requested, policy) {
    const s = typeof requested === 'number' ? String(requested) : typeof requested === 'string' ? requested.trim() : '';
    if (!/^\d{1,6}$/.test(s)) return { ...fail('LOCATION_RADIUS_INVALID', { reason: 'INVALID_RADIUS', allowedRadiiMeters: policy.selectableRadiiMeters }), reason: 'INVALID_RADIUS' };
    const r = Number(s);
    if (!(r > 0) || r > policy.maxRadiusMeters || !policy.selectableRadiiMeters.includes(r)) return { ...fail('LOCATION_RADIUS_INVALID', { reason: 'INVALID_RADIUS', requested: r, allowedRadiiMeters: policy.selectableRadiiMeters, maxRadiusMeters: policy.maxRadiusMeters }), reason: 'INVALID_RADIUS' };
    return { ok: true, requestedRadiusMeters: r, effectiveRadiusMeters: Math.min(r, policy.maxRadiusMeters) };
  }

  // ------------------------------------------------------------------ category registry (§44–§53, LI-DQ-006)
  /** buildRegistry(cfg) → { categories (validated), byCode, issues }. A category with a type outside the official table is DISABLED. */
  function buildRegistry(cfg, developmentId) {
    const C = cfgOf(cfg), table = new Set(C.placeTypeTable.types), issues = [];
    const enabledCodes = developmentId && C.developments[developmentId] ? new Set(C.developments[developmentId].intelligence.enabledCategoryCodes) : null;
    const categories = C.categories.map(c => {
      const bad = [...(c.googleIncludedTypes || []), ...(c.googleExcludedTypes || [])].filter(t => !table.has(t));
      if (bad.length) issues.push({ rule: 'LI-DQ-006', categoryCode: c.code, reason: 'UNSUPPORTED_PROVIDER_TYPE', types: bad });
      if (!c.googleIncludedTypes || !c.googleIncludedTypes.length) issues.push({ rule: 'LI-DQ-006', categoryCode: c.code, reason: 'NO_PROVIDER_TYPE' });
      const usable = c.enabled && !bad.length && c.googleIncludedTypes && c.googleIncludedTypes.length > 0 && (!enabledCodes || enabledCodes.has(c.code));
      return Object.freeze({ ...c, maxResults: Math.min(c.maxResults, C.provider.places.maxResultCountCap), status: usable ? 'ENABLED' : bad.length ? 'DISABLED_INVALID_TYPES' : 'DISABLED' });
    }).sort((a, b) => a.displayOrder - b.displayOrder);
    const byCode = Object.fromEntries(categories.map(c => [c.code, c]));
    return { categories, byCode, enabled: categories.filter(c => c.status === 'ENABLED'), issues };
  }
  /** resolveCategory(code, registry) → { ok, category } | LOCATION_CATEGORY_UNSUPPORTED. Category codes only — never a Google type from the client (§558). */
  function resolveCategory(code, registry) {
    if (typeof code !== 'string' || !CATEGORY_RE.test(code)) return fail('LOCATION_CATEGORY_UNSUPPORTED', { category: typeof code === 'string' ? code.slice(0, 40) : null });
    const c = registry.byCode[code];
    if (!c || c.status !== 'ENABLED') return fail('LOCATION_CATEGORY_UNSUPPORTED', { category: code });
    return { ok: true, category: c };
  }
  const resolveRank = (rank, cfg) => { const C = cfgOf(cfg); if (rank == null || rank === '') return { ok: true, rank: C.provider.places.defaultRank }; return RANKS.includes(rank) ? { ok: true, rank } : { ok: false, code: 'VALIDATION_ERROR', details: { field: 'rank', allowed: RANKS } }; };

  // ------------------------------------------------------------------ field masks (§33–§37, §143–§144, §425)
  /** fieldMask(list, allowlist) → header value. Throws on '*', empty, or a field outside the allowlist (cost control). */
  function fieldMask(list, allowlist) {
    if (!Array.isArray(list) || !list.length) throw Object.assign(new Error('FieldMask vazio'), { code: 'FIELD_MASK_INVALID' });
    for (const f of list) {
      if (typeof f !== 'string' || f.includes('*')) throw Object.assign(new Error('FieldMask com curinga é proibido'), { code: 'FIELD_MASK_WILDCARD' });
      if (allowlist && !allowlist.includes(f)) throw Object.assign(new Error(`campo fora da allowlist: ${f}`), { code: 'FIELD_MASK_NOT_ALLOWED' });
    }
    return list.join(',');
  }
  const placesFieldMask = cfg => { const P = cfgOf(cfg).provider.places; return fieldMask(P.fieldMask, P.fieldMaskAllowlist); };
  const routesFieldMask = (cfg, { polyline = false } = {}) => { const R = cfgOf(cfg).provider.routes; return fieldMask(polyline && R.polylineEnabled ? [...R.fieldMask, 'routes.polyline.encodedPolyline'] : R.fieldMask, R.fieldMaskAllowlist); };

  // ------------------------------------------------------------------ provider request builders (adapter input, §31–§32, §139)
  /** nearbyRequestBody → Places API (New) searchNearby body. Radius already validated; capped again defensively. */
  function nearbyRequestBody({ center, effectiveRadiusMeters, category, rank }, cfg) {
    const C = cfgOf(cfg), P = C.provider.places;
    if (!(effectiveRadiusMeters > 0) || effectiveRadiusMeters > C.radius.productMaxMeters) throw Object.assign(new Error('raio acima do máximo do produto'), { code: 'LOCATION_RADIUS_INVALID' });
    const body = { includedTypes: [...category.googleIncludedTypes], maxResultCount: Math.max(1, Math.min(category.maxResults, P.maxResultCountCap)),
      locationRestriction: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: effectiveRadiusMeters } },
      rankPreference: RANKS.includes(rank) ? rank : P.defaultRank, languageCode: P.languageCode, regionCode: P.regionCode };
    if (category.googleExcludedTypes && category.googleExcludedTypes.length) body.excludedTypes = [...category.googleExcludedTypes];
    return body;
  }
  /** routeRequestBody → Routes API computeRoutes body: origin = Development.center (never the user, §229) */
  function routeRequestBody({ center, providerPlaceId, trafficMode }, cfg) {
    const R = cfgOf(cfg).provider.routes, tm = R.trafficModes.includes(trafficMode) ? trafficMode : R.defaultTrafficMode;
    return { origin: { location: { latLng: { latitude: center.latitude, longitude: center.longitude } } }, destination: { placeId: providerPlaceId },
      travelMode: 'DRIVE', routingPreference: tm, computeAlternativeRoutes: false, languageCode: R.languageCode, units: R.units };
  }

  // ------------------------------------------------------------------ results (§92, §122–§129, §255–§258, §333–§336)
  /** validPlace: Place ID + name + location are mandatory to be shown (§333) */
  const validPlace = p => !!p && typeof p.providerPlaceId === 'string' && PLACE_ID_RE.test(p.providerPlaceId) && typeof p.name === 'string' && p.name.trim() !== '' && !validateCoordinate(p.location).length;
  /** withDistances(places, center) → adds straightLineDistanceMeters (full precision) */
  const withDistances = (places, center) => places.map(p => ({ ...p, straightLineDistanceMeters: haversineMeters(center, p.location) }));
  /** postFilter: strict defensive filter (§125). Tolerance is technical (≈1 m), never a wider business radius (§128). */
  function postFilter(places, center, effectiveRadiusMeters, toleranceMeters = 1) {
    const kept = [], removed = [];
    for (const p of withDistances(places.filter(validPlace), center)) (p.straightLineDistanceMeters <= effectiveRadiusMeters + Math.min(Math.max(toleranceMeters, 0), 5) ? kept : removed).push(p);
    return { kept, removed, invalid: places.length - kept.length - removed.length };
  }
  /** sortPlaces: DISTANCE → by straight line (deterministic, id as tie-break); POPULARITY → provider order preserved (§256–§257) */
  const sortPlaces = (places, rank) => rank === 'POPULARITY' ? places.slice() : places.slice().sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters || (a.providerPlaceId < b.providerPlaceId ? -1 : 1));
  /** narrowToRadius: 8 km → 2 km in the UI removes places outside the smaller filter (§428) */
  const narrowToRadius = (places, radius) => places.filter(p => p.straightLineDistanceMeters <= radius);

  // ------------------------------------------------------------------ copy & formatting (§130–§133, §156–§158, §339–§342, §497–§502, §536)
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  /** formatDistance: < 1 km → meters; ≥ 1 km → one decimal km (display only) */
  const formatDistance = m => !isNum(m) ? 'não disponível' : m < 1000 ? `${nf0.format(Math.round(m))} m` : `${nf1.format(Math.round(m / 100) / 10)} km`;
  /** formatDuration: seconds → "7 min" / "1 h 12 min" */
  function formatDuration(s) {
    if (!isNum(s) || s < 0) return 'não disponível';
    const min = Math.max(1, Math.round(s / 60)); if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), r = min % 60; return r ? `${h} h ${r} min` : `${h} h`;
  }
  const formatRadius = m => `${nf0.format(m / 1000)} km`;
  /** parseDuration: Google "123s" / "123.5s" → seconds (adapter responsibility, kept here so both sides agree, §501) */
  const parseDuration = v => { const m = /^(\d+(?:\.\d+)?)s$/.exec(String(v || '')); return m ? Number(m[1]) : null; };
  const formatRating = (rating, count) => !isNum(rating) ? null : `${nf1.format(rating)}${isNum(count) ? ` · ${new Intl.NumberFormat('pt-BR').format(count)} avaliações` : ''}`;
  /** summaryText: actual returned count, never the total universe (§157, §340, §536) */
  function summaryText({ count, categoryLabel, radiusMeters }) {
    const lab = String(categoryLabel || 'locais').toLowerCase();
    if (!count) return `A busca não retornou ${lab} no raio selecionado (${formatRadius(radiusMeters)}).`;
    return `A busca retornou ${count} ${count === 1 ? 'resultado' : 'resultados'} de ${lab} em até ${formatRadius(radiusMeters)} (linha reta).`;
  }
  const nearestText = (place, categoryLabel) => place ? `${categoryLabel} mais próximo encontrado: ${formatDistance(place.straightLineDistanceMeters)} em linha reta.` : null;
  const routeText = route => route ? `aproximadamente ${formatDuration(route.durationSeconds)} de carro, conforme estimativa do provedor no momento da consulta` : null;
  /** environmentSummary → NearbyEnvironmentSummary (§161): generated on demand, not persisted (§163) */
  function environmentSummary({ developmentId, maxRadiusMeters, results, generatedAt }) {
    return { developmentId, generatedAt, maxRadiusMeters, persisted: false,
      categories: results.map(r => { const n = r.places.length ? sortPlaces(r.places, 'DISTANCE')[0] : null;
        return { categoryCode: r.categoryCode, resultCount: r.places.length, nearestPlace: n ? { providerPlaceId: n.providerPlaceId, name: n.name, straightLineDistanceMeters: n.straightLineDistanceMeters } : undefined }; }) };
  }

  // ------------------------------------------------------------------ cache keys, content policy (§98–§104, §186–§188, §309–§318, §432)
  /** requestKey: tenant-partitioned and invalidated by location/category versions */
  const requestKey = k => ['GOOGLE', k.organizationId, k.developmentId, k.locationVersion, k.categoryCode, k.categoryVersion, k.radiusMeters, k.rankPreference].map(v => String(v == null ? '-' : v)).join('|');
  const contentPolicy = (contentType, cfg) => cfgOf(cfg).contentPolicies.find(p => p.contentType === contentType) || { contentType, persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true };
  /** persistablePlaceRef(place) → the only thing that may be stored long-term: the Place ID (+ our own derived scope facts) */
  const persistablePlaceRef = (place, ctx) => ({ provider: 'GOOGLE', providerPlaceId: place.providerPlaceId, categoryCode: ctx.categoryCode, developmentId: ctx.developmentId, organizationId: ctx.organizationId, locationVersion: ctx.locationVersion, withinMaxRadius: true });

  // ------------------------------------------------------------------ provider errors (§180–§184, §219, §565)
  /** normalizeProviderError({ service: 'PLACES'|'ROUTES', status, network, timeout, reason }) → { code, transient } */
  function normalizeProviderError(e) {
    const svc = e.service === 'ROUTES' ? 'ROUTES' : 'PLACES';
    if (e.network || e.timeout) return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: true };
    const s = e.status;
    if (s === 401 || s === 403) return { code: e.reason === 'QUOTA' ? `GOOGLE_${svc}_QUOTA_EXCEEDED` : 'GOOGLE_PROVIDER_AUTH_ERROR', transient: false };
    if (s === 429) return { code: e.reason === 'QUOTA' ? `GOOGLE_${svc}_QUOTA_EXCEEDED` : 'GOOGLE_PROVIDER_RATE_LIMIT', transient: e.reason !== 'QUOTA' };
    if (s === 400 || s === 404) return { code: svc === 'PLACES' ? 'GOOGLE_PLACES_INVALID_REQUEST' : 'GOOGLE_ROUTES_UNAVAILABLE', transient: false };
    if ([500, 502, 503, 504].includes(s)) return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: true };
    return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: false };
  }

  // ------------------------------------------------------------------ capability gating (§274–§280) and data quality (§326)
  /** capability({ developmentId, env: { serverKeyConfigured, browserKeyConfigured, online } }) → flags + reasons */
  function capability(developmentId, env = {}, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], reasons = [];
    if (!d) return { GOOGLE_MAPS_ENVIRONMENT: false, NEARBY_PLACES: false, ROUTE_ESTIMATES: false, reasons: ['DEVELOPMENT_NOT_CONFIGURED'], state: 'NOT_CONFIGURED', message: C.copy.notConfigured, BASE_MAP: false, baseMap: baseMap(developmentId, env, C) };
    const loc = locationReadiness(d.location, C);
    if (!C.featureFlag.enabled) reasons.push('FEATURE_FLAG_OFF');
    if (!d.intelligence.enabled || !d.location.googleMapsEnabled) reasons.push('DEVELOPMENT_DISABLED');
    if (!loc.ready) reasons.push('LOCATION_NOT_VALIDATED');
    if (d.intelligence.maxRadiusMeters !== d.intelligence.approvedMaxRadiusMeters || d.intelligence.maxRadiusMeters > C.radius.productMaxMeters) reasons.push('MAX_RADIUS_NOT_APPROVED');
    if (env.emergencyDisabled) reasons.push('EMERGENCY_DISABLED');
    const map = !reasons.length && !!env.browserKeyConfigured;
    if (!reasons.length && !env.browserKeyConfigured) reasons.push('BROWSER_KEY_NOT_CONFIGURED');
    const server = !!env.serverKeyConfigured && C.rateLimit.placesRequestsPerMinute != null && !!C.providerPolicy.reviewedAt;
    const nearby = map && server && buildRegistry(C, developmentId).enabled.length > 0;
    const routes = nearby && d.intelligence.routesEnabled && C.rateLimit.routesRequestsPerMinute != null;
    const offline = env.online === false;
    const state = offline ? 'OFFLINE' : !loc.ready ? 'NOT_VALIDATED' : !map ? 'NOT_CONFIGURED' : 'AVAILABLE';
    const bm = baseMap(developmentId, env, C);
    return { GOOGLE_MAPS_ENVIRONMENT: map && !offline, NEARBY_PLACES: nearby && !offline, ROUTE_ESTIMATES: routes && !offline, reasons, state, coordinateStatus: loc.coordinateStatus,
      message: state === 'OFFLINE' ? C.copy.offline : state === 'NOT_VALIDATED' ? C.copy.notValidated : state === 'NOT_CONFIGURED' ? C.copy.notConfigured : null,
      BASE_MAP: bm.available, baseMap: bm };
  }
  // ------------------------------------------------------------------ round 7: keyless base map (OpenStreetMap) of the Entorno
  /** baseMapProvider(cfg) → the enabled keyless provider named by environmentMap.baseMapProvider, or null */
  function baseMapProvider(cfg) {
    const C = cfgOf(cfg), em = C.environmentMap, list = C.baseMapProviders || [];
    const p = em && list.find(x => x.code === em.baseMapProvider);
    return p && p.enabled && p.requiresKey === false && /^https:\/\/[a-z0-9.-]+\/\{z\}\/\{x\}\/\{y\}\.png$/.test(p.tileUrlTemplate) && p.attribution && p.attribution.required && p.attribution.text ? p : null;
  }
  /** baseMap(developmentId, env) → { available, state: AVAILABLE | NOT_VALIDATED | NOT_CONFIGURED, provider, center, offline, message }.
      Independent of the Google flag/keys: it needs only the validated official coordinate and a keyless provider. Offline
      keeps it AVAILABLE (plan, rings and links still work); the tiles then fail and the view says so. */
  function baseMap(developmentId, env = {}, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], p = baseMapProvider(C), em = C.environmentMap || {};
    if (!d) return { available: false, state: 'NOT_CONFIGURED', provider: null, center: null, offline: env.online === false, message: C.copy.notConfigured };
    const loc = locationReadiness(d.location, C);
    if (!loc.ready) return { available: false, state: 'NOT_VALIDATED', provider: p ? p.code : null, center: null, offline: env.online === false, message: C.copy.notValidated };
    if (!p) return { available: false, state: 'NOT_CONFIGURED', provider: null, center: null, offline: env.online === false, message: C.copy.notConfigured };
    return { available: true, state: 'AVAILABLE', provider: p.code, center: { lat: d.location.center.latitude, lon: d.location.center.longitude }, offline: env.online === false,
      message: env.online === false ? (em.copy && em.copy.offline) || C.copy.offline : null };
  }
  /** externalLinks(developmentId) → { openInMaps, directions } built ONLY from the validated official coordinate (no user data,
      no key, no place id, no tracking parameter); null when the coordinate is not validated */
  function externalLinks(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], L = C.environmentMap && C.environmentMap.externalLinks;
    if (!d || !L || !locationReadiness(d.location, C).ready) return null;
    const lat = d.location.center.latitude, lon = d.location.center.longitude, f = v => Number(v).toFixed(6);
    const fill = t => t.replace('{lat}', f(lat)).replace('{lon}', f(lon));
    return { openInMaps: fill(L.search), directions: fill(L.directions) };
  }
  /** dataQuality(developmentId) → LI-DQ-001..006 results (LI-DQ-005/007 run per request) */
  function dataQuality(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], loc = d && d.location, reg = buildRegistry(C, developmentId);
    const center = loc && loc.center, cIssues = center ? validateCoordinate(center) : [];
    return [
      { rule: 'LI-DQ-001', label: 'Centro validado', pass: !!loc && locationReadiness(loc, C).ready },
      { rule: 'LI-DQ-002', label: 'Latitude válida', pass: !!center && !cIssues.some(i => i.rule === 'LI-DQ-002'), notApplicable: !center },
      { rule: 'LI-DQ-003', label: 'Longitude válida', pass: !!center && !cIssues.some(i => i.rule === 'LI-DQ-003'), notApplicable: !center },
      { rule: 'LI-DQ-004', label: 'Raio máximo ≤ 8.000 m aprovado', pass: !!d && d.intelligence.maxRadiusMeters <= C.radius.productMaxMeters && d.intelligence.maxRadiusMeters === d.intelligence.approvedMaxRadiusMeters && d.intelligence.selectableRadiiMeters.every(r => r > 0 && r <= d.intelligence.maxRadiusMeters) },
      { rule: 'LI-DQ-006', label: 'Categorias com tipos oficiais', pass: !reg.issues.length, issues: reg.issues }
    ];
  }

  // ------------------------------------------------------------------ deep link (§367–§371, §452)
  /** linkState(state) → semantic params only (no key, no PII, no pixels) */
  function linkState(s) {
    const out = { tab: 'environment' };
    if (s.selectedCategory && CATEGORY_RE.test(s.selectedCategory)) out.category = s.selectedCategory;
    if (isNum(s.selectedRadiusMeters)) out.radius = String(s.selectedRadiusMeters);
    if (s.selectedPlaceId && PLACE_ID_RE.test(s.selectedPlaceId)) out.selectedPlaceId = s.selectedPlaceId;
    return out;
  }
  /** restoreLinkState(params, { registry, policy }) → { state, status: COMPLETE | PARTIAL, issues } */
  function restoreLinkState(params, { registry, policy }) {
    const issues = [], st = { selectedCategory: undefined, selectedRadiusMeters: policy.defaultRadiusMeters, selectedPlaceId: undefined, rankPreference: 'DISTANCE', routeVisible: false };
    if (params.radius != null) { const r = resolveRadius(params.radius, policy); if (r.ok) st.selectedRadiusMeters = r.effectiveRadiusMeters; else issues.push('RADIUS_IGNORED'); }
    if (params.category != null) { const c = resolveCategory(params.category, registry); if (c.ok) st.selectedCategory = c.category.code; else issues.push('CATEGORY_IGNORED'); }
    if (params.selectedPlaceId != null) { if (PLACE_ID_RE.test(String(params.selectedPlaceId))) st.selectedPlaceId = String(params.selectedPlaceId); else issues.push('PLACE_IGNORED'); }
    return { state: st, status: issues.length ? 'PARTIAL' : 'COMPLETE', issues };
  }
  /** restoreSelection(state, places) → selected place kept only if still returned; otherwise PARTIAL with a message (§370, §429) */
  function restoreSelection(state, places) {
    if (!state.selectedPlaceId) return { state, status: 'COMPLETE', message: null };
    if (places.some(p => p.providerPlaceId === state.selectedPlaceId)) return { state, status: 'COMPLETE', message: null };
    return { state: { ...state, selectedPlaceId: undefined, routeVisible: false }, status: 'PARTIAL', message: 'O local do link não apareceu nesta busca; mostramos os resultados atuais.' };
  }

  // ------------------------------------------------------------------ external link (§362–§366, §587–§590)
  /** mapsUrl(place) → official Maps URLs search link; no key, no redirect parameter, no customer data */
  function mapsUrl(place) {
    if (!validPlace(place)) return null;
    const q = `${place.location.latitude},${place.location.longitude}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${encodeURIComponent(place.providerPlaceId)}`;
  }

  // ------------------------------------------------------------------ analytics payload (§286–§288)
  const radiusBucket = m => isNum(m) ? `${Math.round(m / 1000)}km` : 'unknown';
  const eventPayload = (name, { categoryCode, radiusMeters } = {}) => ({ name, props: { ...(categoryCode && CATEGORY_RE.test(categoryCode) ? { categoryCode } : {}), ...(isNum(radiusMeters) ? { radiusBucket: radiusBucket(radiusMeters) } : {}) } });

  // ------------------------------------------------------------------ DevelopmentLocationChange state machine (§383–§388, §392)
  const CHANGE_FLOW = Object.freeze({ DRAFT: ['REVIEW'], REVIEW: ['APPROVED', 'DRAFT'], APPROVED: ['PUBLISHED'], PUBLISHED: [] });
  const METHODS = Object.freeze(['OFFICIAL_GEOREFERENCE', 'OFFICIAL_KML_KMZ', 'OFFICIAL_COORDINATE', 'MANUAL_CONFIRMED', 'GEOCODED_AND_CONFIRMED']);
  /** createLocationChange → DRAFT. A coordinate always comes with an official sourceRef and a reason; never generated. */
  function createLocationChange({ current, proposedCenter, sourceRef, reason, validationMethod, requestedBy, id }) {
    const issues = validateCoordinate(proposedCenter);
    if (!sourceRef || typeof sourceRef !== 'string') issues.push({ reason: 'SOURCE_REF_REQUIRED' });
    if (!reason || typeof reason !== 'string') issues.push({ reason: 'REASON_REQUIRED' });
    if (!METHODS.includes(validationMethod)) issues.push({ reason: 'VALIDATION_METHOD_INVALID' });
    if (!requestedBy) issues.push({ reason: 'REQUESTED_BY_REQUIRED' });
    if (issues.length) return fail('LOCATION_CHANGE_INVALID', { issues });
    return { ok: true, change: { id: id || null, developmentId: current.developmentId, previousCenter: current.center || null, proposedCenter: { latitude: proposedCenter.latitude, longitude: proposedCenter.longitude },
      sourceRef, reason, validationMethod, requestedBy, approvedBy: null, previewConfirmedBy: null, status: 'DRAFT', baseVersion: current.version, version: null } };
  }
  /** transitionLocationChange(change, to, { actor, previewConfirmed }, cfg) → { ok, change } — approval needs preview (§392) and a configured approver policy */
  function transitionLocationChange(change, to, { actor, previewConfirmed } = {}, cfg) {
    const C = cfgOf(cfg);
    if (!(CHANGE_FLOW[change.status] || []).includes(to)) return fail('LOCATION_CHANGE_INVALID', { from: change.status, to });
    if (!actor) return fail('LOCATION_CHANGE_INVALID', { reason: 'ACTOR_REQUIRED' });
    if (to === 'APPROVED') {
      if (C.locationChangePolicy.previewRequired && !previewConfirmed) return fail('LOCATION_CHANGE_INVALID', { reason: 'PREVIEW_REQUIRED' });
      if (C.locationChangePolicy.requireDistinctApprover == null) return fail('LOCATION_POLICY_NOT_CONFIGURED', { field: 'locationChangePolicy.requireDistinctApprover' });
      if (C.locationChangePolicy.requireDistinctApprover && actor === change.requestedBy) return fail('LOCATION_CHANGE_INVALID', { reason: 'APPROVER_MUST_DIFFER' });
      return { ok: true, change: { ...change, status: 'APPROVED', approvedBy: actor, previewConfirmedBy: actor } };
    }
    return { ok: true, change: { ...change, status: to } };
  }
  /** publishLocationChange(location, change, { at }) → new VALIDATED DevelopmentLocationConfig version (old caches invalidated by version) */
  function publishLocationChange(location, change, { at, actor }) {
    if (change.status !== 'APPROVED') return fail('LOCATION_CHANGE_INVALID', { reason: 'NOT_APPROVED' });
    if (change.baseVersion !== location.version) return fail('LOCATION_CHANGE_INVALID', { reason: 'STALE_BASE_VERSION', currentVersion: location.version });
    const n = Number(String(location.version).replace(/^loc-/, '')) || 0, version = `loc-${n + 1}`;
    return { ok: true, change: { ...change, status: 'PUBLISHED', version }, location: { ...location, center: { ...change.proposedCenter }, locationStatus: 'VALIDATED', sourceRef: change.sourceRef, validationMethod: change.validationMethod, validatedBy: change.approvedBy, validatedAt: at, version },
      audit: { event: 'DEVELOPMENT_LOCATION_CENTER_CHANGED', developmentId: location.developmentId, fromVersion: location.version, toVersion: version, actor: actor || change.approvedBy, at } };
  }

  const api = { DOMAIN_VERSION, EARTH_RADIUS_M, RANKS, PLACE_ID_RE, ERRORS, CHANGE_FLOW, VALIDATION_METHODS: METHODS,
    validateCoordinate, locationReadiness, provenance, haversineMeters, destination, boundsAround, radiusPolicy, resolveRadius, buildRegistry, resolveCategory, resolveRank,
    fieldMask, placesFieldMask, routesFieldMask, nearbyRequestBody, routeRequestBody, validPlace, withDistances, postFilter, sortPlaces, narrowToRadius,
    formatDistance, formatDuration, formatRadius, parseDuration, formatRating, summaryText, nearestText, routeText, environmentSummary,
    requestKey, contentPolicy, persistablePlaceRef, normalizeProviderError, capability, baseMap, baseMapProvider, externalLinks, dataQuality, linkState, restoreLinkState, restoreSelection, mapsUrl,
    radiusBucket, eventPayload, createLocationChange, transitionLocationChange, publishLocationChange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.domain = api; }
})();

/* ---- surroundings/surroundingsView.js ---- */
/* surroundings/surroundingsView.js — topic 63: "Mapa de Lotes | Entorno" as HTML strings (App.surroundingsView).
   Separate surface: the Google map never goes into the lot map (§0, §75). Markup only, no DOM access, everything escaped.
   States: NOT_VALIDATED ("Coordenada oficial do empreendimento ainda não validada.") · NOT_CONFIGURED · OFFLINE · AVAILABLE.
   In the first three, only the state message is rendered: no map container, so the integrator never loads the Google script.
   Delegated data-acts: envTab (data-v lots|environment), envRadius (data-v meters), envCategory (data-v code),
   envRank (data-v DISTANCE|POPULARITY), envPlace (data-id), envRoute, envOpenMaps (link, new tab, noopener).
   Accessibility: the list is the primary interface (the map is not the only one, §231–§235); chips are buttons with
   aria-pressed; categories carry a text glyph, never color alone (§236); loading is local (§238). */
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.domain) || require('./surroundingsDomain.js');
  const C = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.config) || require('../config/surroundings/surroundings.config.js');

  /** viewModel({ developmentId, capability, state }) → EnvironmentViewModel-like plain object (no raw provider payload) */
  function viewModel({ developmentId, capability, state = null }) {
    const Dm = D(), Cf = C(), d = Cf.developments[developmentId];
    const policy = d ? Dm.radiusPolicy(developmentId, Cf) : null, registry = Dm.buildRegistry(Cf, developmentId);
    const st = state || { selectedRadiusMeters: policy ? policy.defaultRadiusMeters : null, phase: 'IDLE', places: [], routePhase: 'IDLE' };
    const sel = st.selectedPlaceId ? (st.places || []).find(p => p.providerPlaceId === st.selectedPlaceId) : null;
    return { developmentId, developmentName: d ? d.location.name : '', state: capability ? capability.state : 'NOT_CONFIGURED', message: capability ? capability.message : Cf.copy.notConfigured,
      places: capability && capability.NEARBY_PLACES, routes: capability && capability.ROUTE_ESTIMATES,
      radius: { selectedMeters: st.selectedRadiusMeters, maxMeters: policy ? policy.maxRadiusMeters : null, options: policy ? policy.selectableRadiiMeters : [] },
      categories: registry.enabled.map(c => ({ code: c.code, label: c.label, shortLabel: c.shortLabel, glyph: c.glyph, iconKey: c.iconKey })),
      selectedCategory: st.selectedCategory ? registry.byCode[st.selectedCategory] : null, rank: st.rankPreference || 'DISTANCE',
      phase: st.phase, list: st.places || [], selectedPlace: sel || null, route: st.route || null, routePhase: st.routePhase || 'IDLE', routeError: st.routeError || null,
      error: st.error || null, summary: st.summary || null, linkMessage: st.linkMessage || null, copy: Cf.copy, attribution: Cf.attribution,
      baseMap: capability && capability.baseMap ? capability.baseMap : null, nearbyPending: Cf.environmentMap ? Cf.environmentMap.copy.nearbyPending : null };
  }

  /** tabs({ active, showEnvironment }) → the separate surface switch. Entorno is hidden when the capability is off (§277). */
  function tabs({ active = 'lots', showEnvironment = false } = {}) {
    const b = (v, label) => `<button type="button" role="tab" class="envtab${active === v ? ' on' : ''}" data-act="envTab" data-v="${v}" aria-selected="${active === v}">${esc(label)}</button>`;
    return `<div class="envtabs" role="tablist" aria-label="Superfícies do empreendimento">${b('lots', 'Mapa de Lotes')}${showEnvironment ? b('environment', 'Entorno') : ''}</div>`;
  }

  /** stateNotice(vm) → the only markup for NOT_VALIDATED / NOT_CONFIGURED / OFFLINE (no map container, no script) */
  function stateNotice(vm) {
    const cls = vm.state === 'OFFLINE' ? 'offline' : vm.state === 'NOT_VALIDATED' ? 'notvalidated' : 'notconfigured';
    return `<section class="envp envp-${cls}" aria-labelledby="envh"><h3 id="envh">Localização &amp; Entorno</h3><p class="envmsg" role="status">${esc(vm.message || vm.copy.notConfigured)}</p>${vm.state === 'NOT_VALIDATED' ? `<p class="small">O entorno só usa a coordenada oficial validada do empreendimento. Nenhuma posição aproximada é usada no lugar dela.</p>` : ''}${vm.baseMap && vm.baseMap.available ? `<p class="small">Mapa do entorno sem chave (OpenStreetMap, planta e círculos de 2 a 8 km): disponível no mapa, em "Mapa de Lotes | Entorno". ${esc(vm.nearbyPending || '')}</p>` : ''}</section>`;
  }

  function placeCard(p, vm) {
    const Dm = D(), on = vm.selectedPlace && vm.selectedPlace.providerPlaceId === p.providerPlaceId, cat = vm.selectedCategory;
    const rating = Dm.formatRating(p.rating, p.userRatingCount);
    return `<li class="envpl${on ? ' on' : ''}"><button type="button" class="envplb" data-act="envPlace" data-id="${esc(p.providerPlaceId)}" aria-pressed="${on}" aria-label="${esc(`${p.name}, ${cat ? cat.label : ''}, ${Dm.formatDistance(p.straightLineDistanceMeters)} em linha reta`)}">
      <span class="envgl" aria-hidden="true">${esc(cat ? cat.glyph : '•')}</span><span class="envnm">${esc(p.name)}</span>
      <span class="envd">Linha reta: ${esc(Dm.formatDistance(p.straightLineDistanceMeters))}</span>${rating ? `<span class="envr">Avaliação: ${esc(rating)}</span>` : ''}</button></li>`;
  }

  function detail(vm) {
    const Dm = D(), p = vm.selectedPlace; if (!p) return '';
    const rating = Dm.formatRating(p.rating, p.userRatingCount), url = Dm.mapsUrl(p);
    const route = vm.routePhase === 'READY' && vm.route ? `<dt>De carro</dt><dd>${esc(Dm.formatDistance(vm.route.distanceMeters))}</dd><dt>Tempo estimado</dt><dd>${esc(Dm.formatDuration(vm.route.durationSeconds))}</dd>` : '';
    const routeCta = !vm.routes ? '' : vm.routePhase === 'LOADING' ? `<p class="small" role="status">Calculando trajeto...</p>` : vm.routePhase === 'READY' ? `<p class="small">${esc(vm.copy.routeNote)}</p>`
      : `<button type="button" class="lbtn" data-act="envRoute" data-id="${esc(p.providerPlaceId)}">Calcular trajeto</button>${vm.routePhase === 'ERROR' ? `<p class="small warnl" role="status">${esc(vm.copy.routeFailed)}</p>` : ''}`;
    return `<article class="envdet" aria-labelledby="envdeth"><h4 id="envdeth">${esc(p.name)}</h4>${vm.selectedCategory ? `<p class="small">${esc(vm.selectedCategory.label)}</p>` : ''}
      <dl><dt>Linha reta</dt><dd>${esc(Dm.formatDistance(p.straightLineDistanceMeters))}</dd>${route}
      ${p.formattedAddress ? `<dt>Endereço</dt><dd>${esc(p.formattedAddress)}</dd>` : ''}<dt>Avaliação</dt><dd>${esc(rating || vm.copy.noRating)}</dd></dl>
      ${routeCta}${url ? `<a class="lbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="envOpenMaps">Abrir no Google Maps</a>` : ''}
      <p class="small">A avaliação é do provedor e não é recomendação da plataforma.</p></article>`;
  }

  function results(vm) {
    if (!vm.places) return `<p class="small">Busca de locais desativada para este empreendimento.</p>`;
    if (!vm.selectedCategory) return `<p class="envhint">${esc(vm.copy.selectCategory)}</p>`;
    if (vm.phase === 'LOADING') return `<p class="envload" role="status" aria-live="polite">${esc(vm.copy.loading)}</p>`;
    if (vm.phase === 'ERROR') return `<p class="envmsg warnl" role="alert">${esc(vm.copy.unavailable)}</p>`; // distinct from "no results" (§243)
    if (vm.phase === 'EMPTY' || !vm.list.length) return `<p class="envmsg" role="status">${esc(vm.copy.empty)}</p><p class="small">${esc(vm.copy.emptyHint)}</p>`;
    return `<h4 class="envrh">${esc(vm.copy.resultsHeading)}</h4>${vm.summary ? `<p class="small" role="status">${esc(vm.summary.text)}${vm.summary.nearest ? ' ' + esc(vm.summary.nearest) : ''}</p>` : ''}
      <ul class="envlist" aria-label="${esc(vm.copy.resultsHeading)}">${vm.list.map(p => placeCard(p, vm)).join('')}</ul>${detail(vm)}`;
  }

  /** render(vm) → Entorno panel. Only AVAILABLE gets the map container (data-surroundings-map) that the integrator fills. */
  function render(vm) {
    if (vm.state !== 'AVAILABLE') return stateNotice(vm);
    const Dm = D(), chip = (act, v, label, on, extra = '') => `<button type="button" class="envchip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}"${extra}>${label}</button>`;
    const radius = vm.radius.options.map(r => chip('envRadius', r, esc(Dm.formatRadius(r)), r === vm.radius.selectedMeters)).join('');
    const cats = vm.places ? vm.categories.map(c => chip('envCategory', c.code, `<span aria-hidden="true">${esc(c.glyph)}</span> ${esc(c.shortLabel)}`, !!vm.selectedCategory && vm.selectedCategory.code === c.code, ` aria-label="${esc(c.label)}"`)).join('') : '';
    const rank = vm.places && vm.selectedCategory ? `<div class="envrank" role="group" aria-label="Ordem">${chip('envRank', 'DISTANCE', 'Mais próximos', vm.rank === 'DISTANCE')}${chip('envRank', 'POPULARITY', 'Mais relevantes no provedor', vm.rank === 'POPULARITY')}</div>` : '';
    return `<section class="envp envp-on" aria-labelledby="envh"><h3 id="envh">Entorno em até ${esc(Dm.formatRadius(vm.radius.maxMeters))}</h3>
      ${vm.linkMessage ? `<p class="small" role="status">${esc(vm.linkMessage)}</p>` : ''}
      <div class="envlay"><div class="envmapw"><div class="envmap" data-surroundings-map="${esc(vm.developmentId)}" role="region" aria-label="Mapa do entorno de ${esc(vm.developmentName)} (a lista ao lado traz as mesmas informações)"></div>
      <p class="small envleg"><span aria-hidden="true">◎</span> ${esc(vm.developmentName)} · Área analisada — até ${esc(Dm.formatRadius(vm.radius.selectedMeters))} · ${esc(vm.copy.maxRadius)}</p></div>
      <div class="envside"><div role="group" aria-label="Raio">${radius}</div>${cats ? `<div class="envcats" role="group" aria-label="Categorias">${cats}</div>` : ''}${rank}
      <div class="envres">${results(vm)}</div></div></div>
      <p class="small envattr">${esc(vm.attribution.text)}</p><p class="small envfoot">${esc(vm.copy.footer)}</p></section>`;
  }

  const api = { viewModel, tabs, render, stateNotice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) App.surroundingsView = api;
})();

/* ---- surroundings/geoMercator.js ---- */
/* surroundings/geoMercator.js — round 7 (2026-10-19): projection math of the keyless Entorno map (App.surroundings.geo).
   Pure functions, no DOM, no network. Used by slippyMap.js / entornoView.js and by tests/entorno.test.js.
   - Web Mercator (EPSG:3857): normalized world coordinates x, y ∈ [0, 1); world pixel at zoom z = normalized × 256 × 2^z.
   - Tiles: the OSM "slippy map" scheme (z/x/y, 256 px). visibleTiles() lists only the tiles in view plus at most 1 ring.
   - Distances: haversine on the mean Earth radius; rings are geodesic circles (spherical destination point) projected to Mercator.
   - Plan georeferencing: least-squares affine from the lots' plan-pixel polygon centroids (area-weighted) to their KMZ
     latitude/longitude, fitted in Mercator metres. Residuals are reported in metres (haversine), never hidden. */
(function () {
  const TILE = 256, R_MERC = 6378137, R_MEAN = 6371008.8, MAX_LAT = 85.0511287798, D2R = Math.PI / 180;
  const clampLat = lat => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  /** project(lat, lon) → normalized Web Mercator { x, y } (y grows southwards) */
  function project(lat, lon) {
    const s = Math.sin(clampLat(lat) * D2R);
    return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  /** unproject(x, y) → { lat, lon } */
  function unproject(x, y) {
    return { lat: 90 - 360 * Math.atan(Math.exp((y - 0.5) * 2 * Math.PI)) / Math.PI, lon: x * 360 - 180 };
  }
  const worldSize = z => TILE * Math.pow(2, z);
  /** toPixel(lat, lon, z) → world pixel { x, y } at zoom z; fromPixel is its inverse */
  function toPixel(lat, lon, z) { const p = project(lat, lon), S = worldSize(z); return { x: p.x * S, y: p.y * S }; }
  function fromPixel(px, py, z) { const S = worldSize(z); return unproject(px / S, py / S); }
  /** metresPerPixel(lat, z) — ground resolution of a 256-px Mercator tile pyramid at that latitude */
  const metresPerPixel = (lat, z) => (2 * Math.PI * R_MERC * Math.cos(lat * D2R)) / worldSize(z);
  /** EPSG:3857 metres ↔ normalized */
  const toMerc = (lat, lon) => { const p = project(lat, lon); return { X: (p.x - 0.5) * 2 * Math.PI * R_MERC, Y: (0.5 - p.y) * 2 * Math.PI * R_MERC }; };
  const mercToNorm = (X, Y) => ({ x: X / (2 * Math.PI * R_MERC) + 0.5, y: 0.5 - Y / (2 * Math.PI * R_MERC) });

  /** haversine({lat,lon}, {lat,lon}) → metres */
  function haversine(a, b) {
    const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** destination({lat,lon}, bearingDeg, metres) → { lat, lon } on the sphere (same radius as haversine) */
  function destination(c, bearingDeg, metres) {
    const d = metres / R_MEAN, t = bearingDeg * D2R, f1 = c.lat * D2R, l1 = c.lon * D2R;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return { lat: f2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
  }
  /** ring(center, metres, n) → n points of a geodesic circle (north first, clockwise) */
  function ring(center, metres, n = 128) {
    const out = []; for (let i = 0; i < n; i++) out.push(destination(center, (360 * i) / n, metres)); return out;
  }
  /** envelope(center, metres) → { north, south, east, west } of the circle */
  function envelope(center, metres) {
    return { north: destination(center, 0, metres).lat, south: destination(center, 180, metres).lat, east: destination(center, 90, metres).lon, west: destination(center, 270, metres).lon };
  }

  /** polygonCentroid([[x,y],…]) → area-weighted centroid [x, y] (closed or open ring); vertex mean when the area is 0 */
  function polygonCentroid(p) {
    const n = p.length; if (!n) return null;
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n], c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
    if (Math.abs(A) < 1e-12) return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
    return [cx / (3 * A), cy / (3 * A)];
  }
  function solve3(M, v) { // Gauss-Jordan with partial pivoting
    const A = M.map((r, i) => [...r, v[i]]);
    for (let i = 0; i < 3; i++) {
      let m = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
      [A[i], A[m]] = [A[m], A[i]]; if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j <= 3; j++) A[k][j] -= f * A[i][j]; }
    }
    return A.map((r, i) => r[3] / r[i]);
  }
  /** fitAffine([{ src: [x, y], dst: [X, Y] }]) → [a, b, c, d, e, f] with X = a·x + c·y + e, Y = b·x + d·y + f (CSS matrix order).
      Source coordinates are centred before the normal equations (numerical stability); null with < 3 pairs or degenerate input. */
  function fitAffine(pairs) {
    if (!pairs || pairs.length < 3) return null;
    const mx = pairs.reduce((s, q) => s + q.src[0], 0) / pairs.length, my = pairs.reduce((s, q) => s + q.src[1], 0) / pairs.length;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vX = [0, 0, 0], vY = [0, 0, 0];
    for (const q of pairs) { const r = [q.src[0] - mx, q.src[1] - my, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; vX[i] += r[i] * q.dst[0]; vY[i] += r[i] * q.dst[1]; } }
    const sx = solve3(M, vX), sy = solve3(M, vY); if (!sx || !sy) return null;
    return [sx[0], sy[0], sx[1], sy[1], sx[2] - sx[0] * mx - sx[1] * my, sy[2] - sy[0] * mx - sy[1] * my];
  }
  const applyAffine = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /** lotGeo(lot) → { id, polygon, lat, lon } from a domain lot (geometry.polygon, location.latitude/longitude) or a raw lots.json row (p, lat, lon) */
  function lotGeo(l) {
    if (!l) return null;
    if (l.geometry || l.location) return { id: l.identity ? l.identity.id : l.id, code: l.identity ? l.identity.code : l.id, polygon: l.geometry && l.geometry.polygon, lat: l.location && l.location.latitude, lon: l.location && l.location.longitude };
    return { id: l.id, code: l.id, polygon: l.p, lat: l.lat, lon: l.lon };
  }
  /** planGeoref(lots) → { planToMerc: affine plan unit → EPSG:3857 metres, planToNorm: affine plan unit → normalized Mercator,
      residuals: { n, meanMeters, maxMeters, worstId }, perLot } — only lots that carry both a polygon and a KMZ lat/lon are used
      (nothing is filled in). null when fewer than 3 lots qualify. */
  function planGeoref(lots) {
    const rows = [];
    for (const raw of lots || []) {
      const g = lotGeo(raw); if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3 || typeof g.lat !== 'number' || typeof g.lon !== 'number' || !isFinite(g.lat) || !isFinite(g.lon)) continue;
      const c = polygonCentroid(g.polygon), m = toMerc(g.lat, g.lon); rows.push({ id: g.id, c, lat: g.lat, lon: g.lon, src: c, dst: [m.X, m.Y] });
    }
    const A = fitAffine(rows); if (!A) return null;
    const K = 2 * Math.PI * R_MERC, N = [A[0] / K, -A[1] / K, A[2] / K, -A[3] / K, A[4] / K + 0.5, 0.5 - A[5] / K];
    let sum = 0, max = 0, worstId = null; const perLot = [];
    for (const r of rows) {
      const [X, Y] = applyAffine(A, r.c[0], r.c[1]), n = mercToNorm(X, Y), ll = unproject(n.x, n.y), e = haversine(ll, { lat: r.lat, lon: r.lon });
      sum += e; if (e > max) { max = e; worstId = r.id; } perLot.push({ id: r.id, errorMeters: e });
    }
    return { planToMerc: A, planToNorm: N, residuals: { n: rows.length, meanMeters: sum / rows.length, maxMeters: max, worstId }, perLot };
  }
  /** planToLatLon(georef, x, y) → { lat, lon } of a plan point */
  function planToLatLon(G, x, y) { const [nx, ny] = applyAffine(G.planToNorm, x, y); return unproject(nx, ny); }
  /** cssMatrix(planToNorm, z, ox, oy) → 'matrix(a,b,c,d,e,f)' mapping plan units to pane pixels (world pixel at z minus origin) */
  function cssMatrix(N, z, ox, oy) {
    const S = worldSize(z), m = [N[0] * S, N[1] * S, N[2] * S, N[3] * S, N[4] * S - ox, N[5] * S - oy];
    return `matrix(${m.map(v => +v.toFixed(6)).join(',')})`;
  }

  /** visibleTiles({ cx, cy, z, width, height, margin }) → [{ z, x, y, key, left, top }] — the tiles that intersect the viewport
      centred on world pixel (cx, cy), plus `margin` rings (0 or 1; never more). left/top are world pixels of the tile corner. */
  function visibleTiles({ cx, cy, z, width, height, margin = 1 }) {
    const m = Math.max(0, Math.min(1, margin | 0)), n = Math.pow(2, z);
    const x0 = Math.floor((cx - width / 2) / TILE) - m, x1 = Math.floor((cx + width / 2 - 1e-9) / TILE) + m;
    const y0 = Math.max(0, Math.floor((cy - height / 2) / TILE) - m), y1 = Math.min(n - 1, Math.floor((cy + height / 2 - 1e-9) / TILE) + m);
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const wx = ((x % n) + n) % n; out.push({ z, x: wx, y, key: `${z}/${wx}/${y}`, left: x * TILE, top: y * TILE }); }
    return out;
  }
  /** tileUrl(template, t) → URL from the provider template ({z}/{x}/{y} only; integers checked) */
  function tileUrl(template, t) {
    if (![t.z, t.x, t.y].every(v => Number.isInteger(v) && v >= 0)) throw new Error('tileUrl: coordenadas inválidas');
    return String(template).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  }
  /** fitZoom(center, metres, width, height, { minZoom, maxZoom, paddingPx }) → largest integer zoom where the circle fits */
  function fitZoom(center, metres, width, height, o = {}) {
    const lo = o.minZoom != null ? o.minZoom : 0, hi = o.maxZoom != null ? o.maxZoom : 19, pad = o.paddingPx || 0;
    const e = envelope(center, metres);
    for (let z = hi; z >= lo; z--) { const a = toPixel(e.north, e.west, z), b = toPixel(e.south, e.east, z); if (b.x - a.x <= width - 2 * pad && b.y - a.y <= height - 2 * pad) return z; }
    return lo;
  }

  const api = { TILE, R_MERC, R_MEAN, MAX_LAT, project, unproject, worldSize, toPixel, fromPixel, metresPerPixel, toMerc, mercToNorm, haversine, destination, ring, envelope,
    polygonCentroid, fitAffine, applyAffine, lotGeo, planGeoref, planToLatLon, cssMatrix, visibleTiles, tileUrl, fitZoom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.geo = api; }
})();

/* ---- surroundings/slippyMap.js ---- */
/* surroundings/slippyMap.js — round 7 (2026-10-19): a small self-written raster "slippy map" (App.surroundings.slippy). No library.
   - Web Mercator, 256-px tiles from the configured keyless provider (OpenStreetMap), drawn as <img> elements at integer
     zoom and integer CSS pixels (no resampling → crisp on HiDPI screens; no @2x tiles, which would quadruple the requests).
   - Requests stay modest (OSM tile usage policy): only the tiles in view plus at most one ring, nothing in advance, no bulk
     download, no Service Worker caching (the worker ignores cross-origin requests), tiles outside view are dropped.
   - Interaction: drag / one-finger pan (pointer events), wheel and pinch zoom in whole steps anchored on the pointer,
     keyboard (arrows pan, + / − zoom) on the focusable viewport; buttons are wired by the caller (zoomBy / recenter).
   - Failure: when tiles cannot load (offline, CSP of the host, blocked network) the tile pane hides, onTileStatus('FAILED')
     fires and no further tile is requested until retryTiles(); overlays keep working on the neutral background.
   create(viewportEl, opts) → { zoomBy, setZoom, recenter, addLayer, getView, retryTiles, tileStats, destroy } */
(function () {
  const G = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.geo) || require('./geoMercator.js');
  const TAP_PX = 6, WHEEL_STEP = 60, WHEEL_GAP_MS = 220, FAIL_AFTER = 3, FAIL_TIMEOUT_MS = 10000;

  function create(vp, o) {
    const g = G(), doc = vp.ownerDocument, win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const minZ = o.minZoom, maxZ = o.maxZoom, layers = [], tiles = new Map(), pointers = new Map(), off = [];
    let z = Math.max(minZ, Math.min(maxZ, Math.round(o.zoom))), W = 0, H = 0, origin = { x: 0, y: 0 }, raf = 0;
    let c = g.toPixel(o.center.lat, o.center.lon, z); // map centre in world pixels at zoom z
    let stats = { requested: 0, loaded: 0, failed: 0, status: 'IDLE' }, failTimer = 0, stopped = false;
    let drag = null, pinch = null, suppressClick = false, wheelAcc = 0, wheelAt = 0;

    const pane = doc.createElement('div'); pane.className = 'smpane';
    const tileEl = doc.createElement('div'); tileEl.className = 'smtiles'; tileEl.setAttribute('aria-hidden', 'true');
    pane.appendChild(tileEl); vp.appendChild(pane);
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); off.push(() => el.removeEventListener(ev, fn, opt)); };

    function setStatus(s) { if (stats.status === s) return; stats.status = s; if (o.onTileStatus) o.onTileStatus(s, { ...stats }); }
    function clampCenter() {
      if (!o.bounds) return;
      const a = g.toPixel(o.bounds.north, o.bounds.west, z), b = g.toPixel(o.bounds.south, o.bounds.east, z);
      c = { x: Math.max(a.x, Math.min(b.x, c.x)), y: Math.max(a.y, Math.min(b.y, c.y)) };
    }
    function view() {
      return { z, ox: origin.x, oy: origin.y, width: W, height: H, center: g.fromPixel(c.x, c.y, z),
        toPane: (lat, lon) => { const p = g.toPixel(lat, lon, z); return [p.x - origin.x, p.y - origin.y]; } };
    }
    function measure() { W = vp.clientWidth || 0; H = vp.clientHeight || 0; }
    function transformPane() {
      const tx = Math.round(origin.x - (c.x - W / 2)), ty = Math.round(origin.y - (c.y - H / 2));
      pane.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    }
    function updateTiles() {
      const want = new Set();
      if (!stopped && W && H) {
        for (const t of g.visibleTiles({ cx: c.x, cy: c.y, z, width: W, height: H, margin: 1 })) {
          want.add(t.key); if (tiles.has(t.key)) continue;
          const img = doc.createElement('img');
          img.className = 'smtile'; img.alt = ''; img.width = 256; img.height = 256; img.draggable = false; img.decoding = 'async';
          img.referrerPolicy = o.referrerPolicy || 'strict-origin-when-cross-origin';
          img.style.left = (t.left - origin.x) + 'px'; img.style.top = (t.top - origin.y) + 'px';
          img.dataset.z = t.z; img.dataset.left = t.left; img.dataset.top = t.top;
          img.onload = () => { stats.loaded++; img.classList.add('ok'); clearTimeout(failTimer); tileEl.hidden = false; setStatus('OK'); };
          img.onerror = () => { stats.failed++; img.remove(); tiles.delete(t.key); if (!stats.loaded && stats.failed >= FAIL_AFTER) fail(); };
          stats.requested++; img.src = g.tileUrl(o.tileUrlTemplate, t);
          tiles.set(t.key, img); tileEl.appendChild(img);
        }
        if (stats.status === 'IDLE') { setStatus('LOADING'); clearTimeout(failTimer); failTimer = setTimeout(() => { if (!stats.loaded) fail(); }, FAIL_TIMEOUT_MS); }
      }
      for (const [k, img] of tiles) if (!want.has(k)) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); tiles.delete(k); }
    }
    function fail() { stopped = true; clearTimeout(failTimer); tileEl.hidden = true; for (const img of tiles.values()) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); } tiles.clear(); setStatus('FAILED'); }
    function reset() { // full re-render at the current zoom: new origin, tiles re-placed, layers redrawn
      measure(); clampCenter();
      origin = { x: Math.round(c.x - W / 2), y: Math.round(c.y - H / 2) };
      for (const img of tiles.values()) if (+img.dataset.z !== z) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); }
      for (const [k, img] of tiles) if (+img.dataset.z !== z) tiles.delete(k); else { img.style.left = (+img.dataset.left - origin.x) + 'px'; img.style.top = (+img.dataset.top - origin.y) + 'px'; }
      transformPane(); updateTiles();
      const v = view(); for (const l of layers) l.render(v);
      if (o.onView) o.onView(v);
    }
    function schedule() { if (raf) return; raf = (win && win.requestAnimationFrame ? win.requestAnimationFrame : f => setTimeout(f, 16))(() => { raf = 0; clampCenter(); transformPane(); updateTiles(); if (o.onView) o.onView(view()); }); }
    function panBy(dx, dy) { c = { x: c.x + dx, y: c.y + dy }; schedule(); }
    /** setZoom(nz, anchor) — anchor = viewport point [px, py] that stays fixed (default: centre) */
    function setZoom(nz, anchor) {
      nz = Math.max(minZ, Math.min(maxZ, Math.round(nz))); if (nz === z) return false;
      const ax = anchor ? anchor[0] - W / 2 : 0, ay = anchor ? anchor[1] - H / 2 : 0, k = Math.pow(2, nz - z);
      c = { x: (c.x + ax) * k - ax, y: (c.y + ay) * k - ay }; z = nz; reset(); return true;
    }
    const zoomBy = (d, anchor) => setZoom(z + d, anchor);
    function recenter(center, zoom) { const cz = zoom != null ? Math.max(minZ, Math.min(maxZ, Math.round(zoom))) : z; z = cz; c = g.toPixel(center.lat, center.lon, z); reset(); }
    const local = e => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    on(vp, 'pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest && e.target.closest('button,a,input,label')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, captured: false }; suppressClick = false; }
      else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; drag = null; suppressClick = true; }
    });
    on(vp, 'pointermove', e => {
      const p = pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, r = vp.getBoundingClientRect();
        const mid = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
        if (d / pinch.d >= Math.SQRT2) { if (setZoom(z + 1, mid)) pinch.d = d; else pinch.d = d; }
        else if (d / pinch.d <= Math.SQRT1_2) { if (setZoom(z - 1, mid)) pinch.d = d; else pinch.d = d; }
        e.preventDefault(); return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved >= TAP_PX && !drag.captured) { drag.captured = true; suppressClick = true; vp.classList.add('dragging'); try { vp.setPointerCapture(e.pointerId); } catch (x) { /* already released */ } }
      if (drag.captured) { panBy(-dx, -dy); e.preventDefault(); }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) { if (drag.captured) { vp.classList.remove('dragging'); reset(); } drag = null; }
    };
    on(vp, 'pointerup', up); on(vp, 'pointercancel', up); on(vp, 'lostpointercapture', e => { if (drag && drag.id === e.pointerId) up(e); });
    on(vp, 'click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
    on(vp, 'wheel', e => {
      e.preventDefault();
      const now = Date.now(); wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(wheelAcc) < WHEEL_STEP || now - wheelAt < WHEEL_GAP_MS) return;
      wheelAt = now; const d = wheelAcc < 0 ? 1 : -1; wheelAcc = 0; zoomBy(d, local(e));
    }, { passive: false });
    on(vp, 'keydown', e => {
      if (e.target !== vp) return;
      const step = 80, k = e.key;
      if (k === 'ArrowLeft') panBy(-step, 0); else if (k === 'ArrowRight') panBy(step, 0); else if (k === 'ArrowUp') panBy(0, -step); else if (k === 'ArrowDown') panBy(0, step);
      else if (k === '+' || k === '=') zoomBy(1); else if (k === '-' || k === '_') zoomBy(-1);
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    let ro = null;
    if (win && win.ResizeObserver) { ro = new win.ResizeObserver(() => { const w = vp.clientWidth, h = vp.clientHeight; if (w !== W || h !== H) reset(); }); ro.observe(vp); }

    const api = {
      zoomBy, setZoom, recenter, getView: view, getZoom: () => z, minZoom: minZ, maxZoom: maxZ,
      /** addLayer({ mount(pane), render(view) }) — overlays live in the pane, so a pan only moves the pane */
      addLayer(l) { if (l.mount) l.mount(pane); layers.push(l); if (W) l.render(view()); return l; },
      retryTiles() { stopped = false; stats = { requested: 0, loaded: 0, failed: 0, status: 'IDLE' }; tileEl.hidden = false; reset(); },
      tileStats: () => ({ ...stats, inDom: tiles.size }),
      refresh: reset,
      destroy() { clearTimeout(failTimer); if (ro) ro.disconnect(); off.forEach(f => f()); for (const img of tiles.values()) { img.onload = img.onerror = null; img.removeAttribute('src'); } tiles.clear(); pane.remove(); }
    };
    reset();
    return api;
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.slippy = api; }
})();

/* ---- surroundings/entornoView.js ---- */
/* surroundings/entornoView.js — round 7 (2026-10-19): the "Entorno" surface of the public panel (App.surroundings.entorno).
   Owner's request (Edmilson, 2026-10-19): see the region around the development. Keyless: OpenStreetMap base map
   (slippyMap.js) + overlays built only from data the panel already has:
   - the lot plan (planta.webp) georeferenced by the affine fit of the lots' plan centroids to their KMZ lat/lon
     (geoMercator.planGeoref), applied as a CSS matrix; user opacity control; lot outlines (tap → existing lot details);
   - the gatehouse (AC3 Portaria), the validated official coordinate of surroundings.config.js;
   - 2/4/6/8 km straight-line rings around it;
   - plain Google Maps links (search / directions) to that coordinate — no key, nothing about the user is sent.
   Nearby places are NOT listed: they need the Google key (topic 63 path, still NOT_CONFIGURED).
   Separate surface: it never draws into the lot map (#map) and never changes its camera, layers or colours.
   Delegated data-acts (uiOnly): envTab (lots|environment), envZoomIn, envZoomOut, envRecenter, envPlan, envInfo, envRetryTiles.
   html(vm) → markup string · viewModel(developmentId, { lots, online }) · mount(box, ctx) → controller { destroy, map, georef } */
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = () => (typeof App !== 'undefined' && App.surroundings) || {};
  const D = () => S().domain || require('./surroundingsDomain.js');
  const C = () => S().config || require('../config/surroundings/surroundings.config.js');
  const G = () => S().geo || require('./geoMercator.js');
  const SL = () => S().slippy || require('./slippyMap.js');
  const NS = 'http://www.w3.org/2000/svg';
  const fmtM = m => (m < 10 ? m.toFixed(1) : String(Math.round(m))).replace('.', ',');

  /** switchHtml(active) — the "Mapa de Lotes | Entorno" switch (same markup as the one in the lot map's top-left corner) */
  function switchHtml(active) {
    const b = (v, label) => `<button type="button" data-act="envTab" data-v="${v}" aria-pressed="${active === v}">${esc(label)}</button>`;
    return `<div class="seg envseg" role="group" aria-label="Mapa de Lotes ou Entorno">${b('lots', 'Mapa de Lotes')}${b('environment', 'Entorno')}</div>`;
  }

  /** viewModel(developmentId, { lots, online }) → plain object (no DOM). lots = domain lots or lots.json rows. */
  function viewModel(developmentId, o = {}) {
    const Cf = C(), Dm = D(), dev = Cf.developments[developmentId], em = Cf.environmentMap;
    const bm = Dm.baseMap(developmentId, { online: o.online !== false }, Cf), prov = Dm.baseMapProvider(Cf);
    const georef = o.lots ? G().planGeoref(o.lots) : null, maxRes = em.planOverlay.maxResidualMeters;
    const planOk = !!(em.planOverlay.enabled && georef && georef.residuals.maxMeters <= maxRes);
    return { developmentId, name: dev ? dev.location.name : '', baseMap: bm, provider: prov, links: Dm.externalLinks(developmentId, Cf),
      rings: em.ringsMeters.slice(), ringLabel: em.ringLabel, gate: em.gate, georef, planOverlay: planOk, planOpacity: em.planOverlay.defaultOpacity,
      lotMinZoom: em.planOverlay.lotPolygonsMinZoom, copy: em.copy, googleState: Dm.capability(developmentId, { online: o.online !== false }, Cf).state,
      boundsRadiusMeters: em.boundsRadiusMeters + em.boundsMarginMeters, initialFitRadiusMeters: em.initialFitRadiusMeters };
  }

  /** html(vm) → the Entorno surface. Unavailable base map (no validated coordinate / no provider) → state message only. */
  function html(vm) {
    const cp = vm.copy;
    if (!vm.baseMap.available) return `<div class="envbar">${switchHtml('environment')}</div><div class="envcard"><p class="envmsg" role="status">${esc(vm.baseMap.message || cp.notValidated)}</p></div>`;
    const res = vm.georef && vm.planOverlay ? `Planta posicionada pelo KMZ da incorporadora (calculado: erro médio ${fmtM(vm.georef.residuals.meanMeters)} m em ${vm.georef.residuals.n} lotes).` : 'Planta não sobreposta: ajuste ao KMZ indisponível.';
    const a = vm.provider.attribution;
    return `<div class="envbar">${switchHtml('environment')}</div>
<div class="envvp" tabindex="0" role="region" aria-roledescription="mapa" aria-label="Mapa do entorno de ${esc(vm.name)}: arraste ou use as setas para mover, + e − para aproximar ou afastar">
  <div class="envfail" role="status" hidden><b>${esc(cp.tilesFailed)}</b><span>${esc(cp.tilesFailedHint)}</span><button type="button" class="btn sm" data-act="envRetryTiles">Tentar de novo</button></div>
  <div class="envctl"><button type="button" class="mbtn" data-act="envZoomIn" aria-label="Aproximar o entorno">+</button><button type="button" class="mbtn" data-act="envZoomOut" aria-label="Afastar o entorno">−</button><button type="button" class="mbtn" data-act="envRecenter" aria-label="Centralizar na portaria" title="Centralizar na portaria">⌂</button></div>
  ${vm.planOverlay ? `<div class="envplan"><button type="button" class="mbtn" data-act="envPlan" aria-pressed="true">Planta</button><label class="envop"><span class="vh">Opacidade da planta</span><input type="range" min="0" max="100" step="5" value="${esc(Math.round(vm.planOpacity * 100))}" aria-label="Opacidade da planta"></label></div>` : ''}
  <p class="envattr"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.text)}</a></p>
</div>
<div class="envcard" id="envCard">
  <div class="envch"><p class="envct"><b>Entorno de ${esc(vm.name)}</b><span class="small"> · ${esc(vm.gate.label)} (${esc(vm.gate.ref)}), coordenada oficial validada</span></p><button type="button" class="lbtn small envinfo" data-act="envInfo" aria-expanded="true" aria-controls="envMore">Ocultar detalhes</button></div>
  <div class="envbtns"><a class="btn sm" href="${esc(vm.links.openInMaps)}" target="_blank" rel="noopener noreferrer">${esc(cp.openInMaps)}</a><a class="btn sm" href="${esc(vm.links.directions)}" target="_blank" rel="noopener noreferrer">${esc(cp.directions)}</a></div>
  <div id="envMore" class="envmore"><p class="small"><span class="envlg" aria-hidden="true"></span>${esc(cp.rings)} (${esc(vm.ringLabel.toLowerCase())}; o trajeto por vias é maior). ${esc(res)}</p>
  <p class="small envnote">${esc(cp.nearbyPending)}</p></div>
</div>`;
  }

  /** mount(box, { developmentId, lots, planUrl, planSize: { w, h }, online, onLot(id) }) → controller */
  function mount(box, ctx) {
    const vm = viewModel(ctx.developmentId, { lots: ctx.lots, online: ctx.online });
    box.innerHTML = html(vm);
    if (!vm.baseMap.available) return { vm, map: null, georef: vm.georef, destroy() { box.innerHTML = ''; } };
    const doc = box.ownerDocument, g = G(), vp = box.querySelector('.envvp'), failBox = box.querySelector('.envfail'), center = vm.baseMap.center, prov = vm.provider;
    const size = () => ({ w: vp.clientWidth || 600, h: vp.clientHeight || 400 });
    const fitZ = () => { const s = size(); return g.fitZoom(center, vm.initialFitRadiusMeters, s.w, s.h, { minZoom: prov.minZoom, maxZoom: prov.maxZoom, paddingPx: 16 }); };
    const map = SL().create(vp, { center, zoom: fitZ(), minZoom: prov.minZoom, maxZoom: prov.maxZoom, tileUrlTemplate: prov.tileUrlTemplate, referrerPolicy: prov.usagePolicy.referrerPolicy,
      bounds: g.envelope(center, vm.boundsRadiusMeters), onTileStatus: s => { failBox.hidden = s !== 'FAILED'; box.dataset.tiles = s; } });

    // ---- plan image (CSS matrix) and lot outlines (same affine, SVG)
    let planImg = null, planOn = true, opacity = vm.planOpacity, lotG = null, lotsDrawn = false;
    const svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('class', 'envsvg'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1'); svg.setAttribute('aria-hidden', 'true');
    const ringsG = doc.createElementNS(NS, 'g'); ringsG.setAttribute('class', 'envrings');
    const gateG = doc.createElementNS(NS, 'g'); gateG.setAttribute('class', 'envgate');
    if (vm.planOverlay) {
      planImg = doc.createElement('img'); planImg.className = 'envplanimg'; planImg.alt = ''; planImg.draggable = false; planImg.decoding = 'async';
      planImg.style.width = ctx.planSize.w + 'px'; planImg.style.height = ctx.planSize.h + 'px'; planImg.style.opacity = String(opacity);
      if (ctx.planUrl) planImg.src = ctx.planUrl;
      lotG = doc.createElementNS(NS, 'g'); lotG.setAttribute('class', 'envlots');
    }
    const ringPts = vm.rings.map(r => ({ r, pts: g.ring(center, r, 180), top: g.destination(center, 90, r) })); // label on the east side (clear of the top-left switch)
    function drawLots() {
      if (lotsDrawn || !lotG) return; lotsDrawn = true;
      const frag = doc.createDocumentFragment();
      for (const raw of ctx.lots || []) {
        const l = g.lotGeo(raw); if (!l || !Array.isArray(l.polygon) || l.polygon.length < 3) continue;
        const p = doc.createElementNS(NS, 'path');
        p.setAttribute('d', 'M' + l.polygon.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z');
        p.setAttribute('data-lot', l.id); p.setAttribute('vector-effect', 'non-scaling-stroke');
        const t = doc.createElementNS(NS, 'title'); t.textContent = `Lote ${l.code}`; p.appendChild(t); frag.appendChild(p);
      }
      lotG.appendChild(frag);
    }
    map.addLayer({
      mount(pane) { if (planImg) pane.appendChild(planImg); svg.append(...[lotG, ringsG, gateG].filter(Boolean)); pane.appendChild(svg); },
      render(v) {
        if (planImg && vm.georef) {
          const m = g.cssMatrix(vm.georef.planToNorm, v.z, v.ox, v.oy); planImg.style.transform = m; lotG.setAttribute('transform', m.replace(/,/g, ' '));
          const showLots = planOn && v.z >= vm.lotMinZoom; if (showLots) drawLots(); lotG.style.display = showLots ? '' : 'none';
        }
        let h = '';
        for (const R of ringPts) {
          const d = 'M' + R.pts.map(q => v.toPane(q.lat, q.lon).map(n => n.toFixed(1)).join(' ')).join('L') + 'Z', [tx, ty] = v.toPane(R.top.lat, R.top.lon);
          h += `<path d="${d}"/><text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle">${R.r / 1000} km</text>`;
        }
        ringsG.innerHTML = h;
        const [gx, gy] = v.toPane(center.lat, center.lon);
        gateG.innerHTML = `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="7"/><circle class="in" cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="2.5"/><text x="${(gx + 11).toFixed(1)}" y="${(gy + 4).toFixed(1)}">${esc(vm.gate.label)}</text>`;
      }
    });

    // ---- controls (local handlers; the global dispatcher only checks the uiOnly permission and has no case for them)
    const onClick = e => {
      const lot = e.target.closest && e.target.closest('[data-lot]');
      if (lot && ctx.onLot) { ctx.onLot(lot.getAttribute('data-lot')); return; }
      const a = e.target.closest && e.target.closest('[data-act]'); if (!a || !box.contains(a)) return;
      const act = a.dataset.act;
      if (act === 'envZoomIn') map.zoomBy(1); else if (act === 'envZoomOut') map.zoomBy(-1);
      else if (act === 'envRecenter') map.recenter(center, fitZ());
      else if (act === 'envRetryTiles') { failBox.hidden = true; map.retryTiles(); }
      else if (act === 'envPlan' && planImg) { planOn = !planOn; a.setAttribute('aria-pressed', String(planOn)); planImg.style.display = planOn ? '' : 'none'; map.refresh(); }
      else if (act === 'envInfo') { const more = box.querySelector('#envMore'), open = a.getAttribute('aria-expanded') !== 'true'; a.setAttribute('aria-expanded', String(open)); more.hidden = !open; a.textContent = open ? 'Ocultar detalhes' : 'Mostrar detalhes'; }
    };
    const onInput = e => { if (e.target.type === 'range' && planImg) { opacity = Math.max(0, Math.min(1, +e.target.value / 100)); planImg.style.opacity = String(opacity); } };
    box.addEventListener('click', onClick); box.addEventListener('input', onInput);
    if ((box.clientWidth || 1000) < 600) { const b = box.querySelector('[data-act=envInfo]'); if (b) onClick({ target: b }); } // phones: details folded, the map keeps the room
    return { vm, map, georef: vm.georef, planImg, destroy() { box.removeEventListener('click', onClick); box.removeEventListener('input', onInput); map.destroy(); box.innerHTML = ''; } };
  }

  const api = { viewModel, html, mount, switchHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.entorno = api; }
})();

/* ---- chunk end ---- */
App.chunks._done("surroundings");
