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
      // 2026-10-20: aerial image widened with the developer's illustrated map of the surroundings (owner's request). Same plan frame
      // (1 px = 1 plan unit, rect below), so the plan → lat/lon affine above positions it. Illustrative: not a photo, not exact geography.
      aerialOverlay: { enabled: true, asset: 'aerea_ampliada.webp', planRect: { x: -113, y: -327, w: 2321, h: 2321 }, defaultOpacity: 1, label: 'Aérea ilustrativa',
        badge: 'Entorno ilustrativo — arte da incorporadora, não é foto',
        note: 'Aérea ilustrativa: dentro do empreendimento, a imagem aérea do painel; fora dele, arte do mapa ilustrado da incorporadora (não é foto nem geografia exata; lagoa e vias em posição aproximada). Registrada à imagem aérea por 1.713 pontos (calculado: erro médio ≈ 1 px).',
        registration: { method: 'SIFT + similaridade (RANSAC)', inliers: 1713, scale: 1.033, rotationDeg: 0.08, meanResidualPx: 1, date: '2026-10-20' } },
      gate: { label: 'Portaria', ref: 'AC3' },
      externalLinks: { provider: 'GOOGLE_MAPS_URLS', requiresKey: false, sendsUserData: false,
        search: 'https://www.google.com/maps/search/?api=1&query={lat},{lon}', directions: 'https://www.google.com/maps/dir/?api=1&destination={lat},{lon}' },
      copy: {
        title: 'Entorno',
        nearbyPending: 'Locais próximos (mercados, escolas, farmácias) aparecem quando a chave do Google Maps for configurada.',
        tilesFailed: 'Mapa de fundo indisponível nesta visualização',
        tilesFailedHint: 'A planta, a aérea ilustrativa, os círculos e os links do Google Maps continuam funcionando.',
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
