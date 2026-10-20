/* loading/resources.js — topic 47: resource identity and registry (WHEN to load is decided elsewhere; this file
   only says WHAT can be loaded, its identity, criticality, priority, trigger, dependencies and security class).
   LoadResourceType · ResourceKey + serializeResourceKey (tenant always in the key, `current` is never a version) ·
   LoadResourceDescriptor · ResourceRegistry (the real resources of the published page) · ResourceDependencyGraph (DAG,
   cycle detection, parallel levels) · LoadVersionContext + ResourceCompatibilityValidator · ResourceFailurePolicy ·
   FeatureModuleRegistry (code chunks; today every module is inline in index.html) · LegacyLoadInventory.

   Rules: a ResourceKey is not a URL (the URL is resolved by the descriptor and may change); the same resourceId in two
   organizations is two resources; versioned artifacts carry their concrete version; nothing here fetches. Cache policy
   (where to reuse a copy and for how long) is topic 48 (cache/cacheCore.js); offline packs are topic 49. */
App.loading = App.loading || {};
App.loading.resources = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const LoadResourceType = E('APP_SHELL', 'APP_FONT', 'ORGANIZATION_CONTEXT', 'PERMISSIONS', 'DEVELOPMENT_CONFIG', 'MAP_BOOTSTRAP', 'GEOMETRY_MANIFEST', 'GEOMETRY_BUNDLE',
    'SPATIAL_INDEX', 'BASE_MAP_LOW', 'BASE_MAP_MEDIUM', 'BASE_MAP_HIGH', 'MAP_LOT_INDEX', 'AVAILABILITY_SNAPSHOT', 'PRICING_SNAPSHOT', 'LAYER_VALUES', 'LOT_QUICK_VIEW',
    'LOT_DETAIL_SECTION', 'LOT_PRICE_HISTORY', 'LOT_PROVENANCE_DETAIL', 'LOT_CONFIDENCE_DETAIL', 'TECHNICAL_ANALYSIS_INPUT', 'MOBILITY_ROUTES', 'GALLERY_INDEX', 'GALLERY_IMAGE',
    'COMPARISON_SESSION', 'COMPARISON_SECTION', 'RECOMMENDATION_RESULT', 'RECOMMENDATION_EXPLANATION', 'CUSTOMER_SUMMARY', 'CUSTOMER_PROFILE', 'JOURNEY_SUMMARY', 'JOURNEY_TIMELINE',
    'PRESENTATION_SNAPSHOT', 'PRESENTATION_STEP_ASSET', 'SHARE_RESOURCE', 'DOCUMENT_METADATA', 'DOCUMENT_PREVIEW', 'DOCUMENT_VIEWER_MODULE', 'FINANCIAL_MODULE',
    'FINANCIAL_SIMULATION_RESULT', 'ANALYTICS_DASHBOARD_MODULE', 'ANALYTICS_QUERY_RESULT', 'SEARCH_INDEX', 'SERVICE_WORKER', 'AUTH_TOKEN', 'PRICE_TABLE_VERSION', 'ANALYSIS_VERSION');
  const LoadCriticality = E('BOOT_BLOCKING', 'ROUTE_BLOCKING', 'INTERACTION_BLOCKING', 'NON_BLOCKING', 'OPTIONAL');
  const LoadPriority = E('IMMEDIATE', 'HIGH', 'NORMAL', 'LOW', 'IDLE');
  const PRIORITY_RANK = Object.freeze({ IMMEDIATE: 0, HIGH: 1, NORMAL: 2, LOW: 3, IDLE: 4 });
  const LoadTrigger = E('APP_BOOT', 'ROUTE_ENTER', 'ROUTE_READY', 'VISIBLE', 'NEAR_VIEWPORT', 'USER_INTENT', 'USER_ACTION', 'NEXT_STEP_PREDICTED', 'ZOOM_THRESHOLD', 'IDLE', 'OFFLINE_PREPARATION');
  const LoadScopeKind = E('APPLICATION', 'ORGANIZATION', 'DEVELOPMENT', 'ROUTE', 'VIEWPORT', 'ENTITY', 'PRESENTATION_SESSION', 'SHARE_SESSION', 'PREFETCH');
  const ResourceLoadState = E('IDLE', 'SCHEDULED', 'LOADING', 'READY', 'PARTIAL', 'BLOCKED_BY_DEPENDENCY', 'ERROR', 'CANCELLED', 'DISCARDED_STALE');
  const SecurityClass = E('PUBLIC_SAFE', 'AUTHENTICATED', 'CUSTOMER_SENSITIVE', 'RESTRICTED');
  const ErrorCode = E('NETWORK', 'TIMEOUT', 'NOT_FOUND', 'FORBIDDEN', 'VERSION_MISMATCH', 'DECODE_ERROR', 'DEPENDENCY_FAILED', 'ABORTED', 'UNKNOWN');
  const FailureBehavior = E('BLOCK_ROUTE', 'DEGRADE', 'HIDE_FEATURE', 'SHOW_RETRY', 'KEEP_LOWER_QUALITY');

  // ---------------------------------------------------------------- ResourceKey
  const KEY_FIELDS = ['organizationId', 'developmentId', 'type', 'resourceId', 'version', 'variant', 'locale']; // fixed order = canonical
  const FORBIDDEN_VERSIONS = new Set(['current', 'latest', 'head', '*']);
  class KeyError extends Error { constructor(code, message) { super(message); this.code = code; } }
  /** makeKey(fields) → frozen ResourceKey. Throws when the tenant is missing, the type is unknown or the version is a pointer word. */
  function makeKey(k) {
    if (!k || typeof k !== 'object') throw new KeyError('INVALID_KEY', 'chave ausente');
    if (!k.organizationId || typeof k.organizationId !== 'string') throw new KeyError('TENANT_REQUIRED', 'organizationId é obrigatório na chave do recurso');
    if (!LoadResourceType[k.type]) throw new KeyError('UNKNOWN_TYPE', `tipo de recurso desconhecido: ${k.type}`);
    if (k.resourceId == null || k.resourceId === '') throw new KeyError('RESOURCE_ID_REQUIRED', 'resourceId é obrigatório');
    if (k.version != null && FORBIDDEN_VERSIONS.has(String(k.version).toLowerCase())) throw new KeyError('POINTER_AS_VERSION', `"${k.version}" é um ponteiro, não uma versão: resolva a versão concreta`);
    if (k.url != null || /^(https?:|blob:|data:)/i.test(String(k.resourceId))) throw new KeyError('URL_AS_IDENTITY', 'a URL física não é identidade do recurso');
    const out = {};
    for (const f of KEY_FIELDS) if (k[f] != null && k[f] !== '') out[f] = String(k[f]);
    return Object.freeze(out);
  }
  const enc = v => encodeURIComponent(v).replace(/[|~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  /** canonical serialization: fixed field order, absent fields written as "~", every value escaped (no collision by crafted input) */
  function serializeResourceKey(key) { const k = makeKey(key); return 'rk1|' + KEY_FIELDS.map(f => (k[f] == null ? '~' : enc(k[f]))).join('|'); }
  function parseResourceKey(s) {
    const parts = String(s).split('|'); if (parts[0] !== 'rk1' || parts.length !== KEY_FIELDS.length + 1) throw new KeyError('INVALID_SERIALIZED_KEY', 'chave serializada inválida');
    const o = {}; KEY_FIELDS.forEach((f, i) => { const v = parts[i + 1]; if (v !== '~') o[f] = decodeURIComponent(v); });
    return makeKey(o);
  }
  const sameKey = (a, b) => serializeResourceKey(a) === serializeResourceKey(b);
  /** a key without version is a pointer request (resolved at load time); it may be deduplicated in flight but never persisted as an artifact */
  const isResolved = (key, descriptor) => !(descriptor && descriptor.versioned) || key.version != null;

  // ---------------------------------------------------------------- descriptors (the real resources of the published page)
  const D = (o) => Object.freeze({ dependencies: [], estimatedCpuCost: 'LOW', reusableAcrossRoutes: true, abortWhenUnused: true, prefetchAllowed: false, versioned: false, metadata: {}, ...o });
  /** descriptor templates by resource type (+ resourceId for types that have several physical resources). `url` is only a resolver. */
  const TEMPLATES = [
    D({ type: 'APP_SHELL', resourceId: 'index', criticality: 'BOOT_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'APP_BOOT', loaderId: 'document', securityClass: 'PUBLIC_SAFE', url: () => './', abortWhenUnused: false,
      estimatedBytes: 2330000, estimatedCpuCost: 'HIGH', metadata: { note: 'HTML + CSS + todo o JS inline (87 módulos). Divisão em chunks: decisão pendente (FEATURE_AND_ROUTE_CODE_SPLITTING.md).' } }),
    D({ type: 'APP_FONT', resourceId: 'google-fonts', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'APP_BOOT', loaderId: 'stylesheet', securityClass: 'PUBLIC_SAFE', estimatedBytes: 99000, metadata: { display: 'swap', thirdParty: 'fonts.googleapis.com' } }),
    D({ type: 'ORGANIZATION_CONTEXT', resourceId: 'tenant', criticality: 'BOOT_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'APP_BOOT', loaderId: 'bundled', securityClass: 'AUTHENTICATED', estimatedBytes: 0 }),
    D({ type: 'PERMISSIONS', resourceId: 'effective', criticality: 'BOOT_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'APP_BOOT', loaderId: 'bundled', securityClass: 'AUTHENTICATED', estimatedBytes: 0, dependencies: ['ORGANIZATION_CONTEXT'] }),
    D({ type: 'DEVELOPMENT_CONFIG', resourceId: 'config', criticality: 'BOOT_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'APP_BOOT', loaderId: 'bundled', securityClass: 'PUBLIC_SAFE', estimatedBytes: 0, dependencies: ['ORGANIZATION_CONTEXT'] }),
    D({ type: 'MAP_BOOTSTRAP', resourceId: 'manifest', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: d => d.assets.manifest,
      estimatedBytes: 4600, dependencies: ['DEVELOPMENT_CONFIG'], metadata: { pointer: true, note: 'manifest.json: ponteiros de versão + checksums. Não é fonte comercial.' } }),
    // ~498 lots: one geometry bundle is the right granularity (no polygon-by-polygon loading). lots.json also carries the map index,
    // the analysis layer values and every detail section (70 fields): the SPLIT is documented as the main unresolved bottleneck.
    D({ type: 'GEOMETRY_BUNDLE', resourceId: 'lots', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: d => d.assets.lots,
      versioned: true, estimatedBytes: 726600, estimatedCpuCost: 'HIGH', dependencies: ['DEVELOPMENT_CONFIG'], abortWhenUnused: false,
      metadata: { contains: ['GEOMETRY_BUNDLE', 'MAP_LOT_INDEX', 'LAYER_VALUES', 'LOT_DETAIL_SECTION'], versionFrom: ['staticVersion', 'analysisVersion'], checksumFrom: 'manifest.checksums' } }),
    D({ type: 'PRICING_SNAPSHOT', resourceId: 'commercial', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: d => d.assets.commercial,
      estimatedBytes: 1500, dependencies: ['DEVELOPMENT_CONFIG'], metadata: { dynamic: true, note: 'tabela de preço vigente (rede primeiro). Falha → última tabela com rótulo "necessita confirmação", nunca valor inventado.' } }),
    D({ type: 'AVAILABILITY_SNAPSHOT', resourceId: 'sales-mirror', criticality: 'NON_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: (d, m) => (m && m.availabilityPath) || null,
      estimatedBytes: 0, dependencies: ['MAP_BOOTSTRAP'], metadata: { dynamic: true, announcedBy: 'manifest.availabilityPath', note: 'sem espelho de vendas publicado: os 498 lotes ficam UNKNOWN (nunca AVAILABLE).' } }),
    D({ type: 'BASE_MAP_MEDIUM', resourceId: 'plan', criticality: 'NON_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_READY', loaderId: 'asset-cache', securityClass: 'PUBLIC_SAFE', url: d => d.assets.plan,
      versioned: true, estimatedBytes: 1263300, estimatedCpuCost: 'MEDIUM', metadata: { versionFrom: 'manifest.assets[].checksum', note: 'planta: fundo padrão. O mapa é interativo sem ela.' } }),
    D({ type: 'BASE_MAP_HIGH', resourceId: 'aerial', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'asset-cache', securityClass: 'PUBLIC_SAFE', url: d => d.assets.aerial,
      versioned: true, prefetchAllowed: true, estimatedBytes: 381100, estimatedCpuCost: 'MEDIUM', metadata: { versionFrom: 'manifest.assets[].checksum', note: 'foto aérea: só quando o fundo Aérea/Híbrido é escolhido. Falha → mantém a planta.' } }),
    D({ type: 'LOT_QUICK_VIEW', resourceId: 'lot', criticality: 'INTERACTION_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'USER_ACTION', loaderId: 'compose', securityClass: 'AUTHENTICATED', estimatedBytes: 0,
      dependencies: ['GEOMETRY_BUNDLE', 'PRICING_SNAPSHOT'], metadata: { note: 'composto em memória a partir dos snapshots carregados (sem rede).' } }),
    D({ type: 'LOT_DETAIL_SECTION', resourceId: 'section', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'compose', securityClass: 'PUBLIC_SAFE', estimatedBytes: 0, dependencies: ['GEOMETRY_BUNDLE'] }),
    D({ type: 'LOT_PRICE_HISTORY', resourceId: 'price-history', criticality: 'OPTIONAL', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'compose', securityClass: 'PUBLIC_SAFE', estimatedBytes: 0, dependencies: ['PRICING_SNAPSHOT'] }),
    D({ type: 'TECHNICAL_ANALYSIS_INPUT', resourceId: 'analysis-input', criticality: 'OPTIONAL', defaultPriority: 'HIGH', trigger: 'USER_ACTION', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: () => 'analysis-input.json',
      versioned: true, prefetchAllowed: true, estimatedBytes: 508500, estimatedCpuCost: 'HIGH', dependencies: ['GEOMETRY_BUNDLE'],
      metadata: { versionFrom: 'manifest.assets[].checksum', note: 'medições para "Como o score foi calculado". Falha → o score publicado continua valendo.' } }),
    D({ type: 'MOBILITY_ROUTES', resourceId: 'routes', criticality: 'OPTIONAL', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: d => d.assets.routes,
      versioned: true, prefetchAllowed: true, estimatedBytes: 254600, estimatedCpuCost: 'MEDIUM', metadata: { versionFrom: 'manifest.assets[].checksum' } }),
    D({ type: 'GALLERY_INDEX', resourceId: 'img_list', criticality: 'OPTIONAL', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'json', securityClass: 'PUBLIC_SAFE', url: d => d.assets.images, estimatedBytes: 840, prefetchAllowed: true }),
    D({ type: 'GALLERY_IMAGE', resourceId: 'image', criticality: 'OPTIONAL', defaultPriority: 'LOW', trigger: 'NEAR_VIEWPORT', loaderId: 'img', securityClass: 'PUBLIC_SAFE', versioned: true, dependencies: ['GALLERY_INDEX'], metadata: { imagePolicy: 'lazy' } }),
    D({ type: 'SERVICE_WORKER', resourceId: 'sw', criticality: 'OPTIONAL', defaultPriority: 'IDLE', trigger: 'IDLE', loaderId: 'service-worker', securityClass: 'PUBLIC_SAFE', estimatedBytes: 3100, abortWhenUnused: false }),
    // domains of other topics: declared so plans and the cache taxonomy can reason about them; none is loaded on the map boot
    D({ type: 'COMPARISON_SESSION', resourceId: 'session', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'compose', securityClass: 'AUTHENTICATED' }),
    D({ type: 'COMPARISON_SECTION', resourceId: 'section', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'compose', securityClass: 'AUTHENTICATED', dependencies: ['COMPARISON_SESSION'] }),
    D({ type: 'RECOMMENDATION_RESULT', resourceId: 'result', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'compose', securityClass: 'CUSTOMER_SENSITIVE' }),
    D({ type: 'RECOMMENDATION_EXPLANATION', resourceId: 'explanation', criticality: 'OPTIONAL', defaultPriority: 'NORMAL', trigger: 'USER_INTENT', loaderId: 'compose', securityClass: 'CUSTOMER_SENSITIVE', prefetchAllowed: true, dependencies: ['RECOMMENDATION_RESULT'] }),
    D({ type: 'CUSTOMER_SUMMARY', resourceId: 'customer', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'memory', securityClass: 'CUSTOMER_SENSITIVE' }),
    D({ type: 'CUSTOMER_PROFILE', resourceId: 'profile', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'USER_ACTION', loaderId: 'memory', securityClass: 'CUSTOMER_SENSITIVE', dependencies: ['CUSTOMER_SUMMARY'] }),
    D({ type: 'JOURNEY_SUMMARY', resourceId: 'journey', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'memory', securityClass: 'CUSTOMER_SENSITIVE', dependencies: ['CUSTOMER_SUMMARY'] }),
    D({ type: 'JOURNEY_TIMELINE', resourceId: 'timeline', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'NEAR_VIEWPORT', loaderId: 'memory', securityClass: 'CUSTOMER_SENSITIVE', dependencies: ['JOURNEY_SUMMARY'], metadata: { paged: 'cursor' } }),
    D({ type: 'PRESENTATION_SNAPSHOT', resourceId: 'snapshot', criticality: 'ROUTE_BLOCKING', defaultPriority: 'HIGH', trigger: 'ROUTE_ENTER', loaderId: 'compose', securityClass: 'CUSTOMER_SENSITIVE', versioned: true }),
    D({ type: 'PRESENTATION_STEP_ASSET', resourceId: 'step', criticality: 'NON_BLOCKING', defaultPriority: 'HIGH', trigger: 'NEXT_STEP_PREDICTED', loaderId: 'compose', securityClass: 'AUTHENTICATED', prefetchAllowed: true, dependencies: ['PRESENTATION_SNAPSHOT'] }),
    D({ type: 'SHARE_RESOURCE', resourceId: 'share', criticality: 'ROUTE_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'ROUTE_ENTER', loaderId: 'share', securityClass: 'RESTRICTED' }),
    D({ type: 'DOCUMENT_METADATA', resourceId: 'documents', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'VISIBLE', loaderId: 'memory', securityClass: 'AUTHENTICATED' }),
    D({ type: 'DOCUMENT_PREVIEW', resourceId: 'preview', criticality: 'OPTIONAL', defaultPriority: 'LOW', trigger: 'NEAR_VIEWPORT', loaderId: 'memory', securityClass: 'RESTRICTED', dependencies: ['DOCUMENT_METADATA'] }),
    D({ type: 'FINANCIAL_SIMULATION_RESULT', resourceId: 'simulation', criticality: 'INTERACTION_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'USER_ACTION', loaderId: 'compose', securityClass: 'CUSTOMER_SENSITIVE', dependencies: ['PRICING_SNAPSHOT'] }),
    D({ type: 'ANALYTICS_QUERY_RESULT', resourceId: 'query', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'ROUTE_ENTER', loaderId: 'compose', securityClass: 'AUTHENTICATED' }),
    D({ type: 'SEARCH_INDEX', resourceId: 'lots', criticality: 'NON_BLOCKING', defaultPriority: 'NORMAL', trigger: 'ROUTE_READY', loaderId: 'compose', securityClass: 'PUBLIC_SAFE', dependencies: ['GEOMETRY_BUNDLE'], metadata: { note: 'índice leve de busca derivado do bundle (memória).' } }),
    D({ type: 'AUTH_TOKEN', resourceId: 'token', criticality: 'BOOT_BLOCKING', defaultPriority: 'IMMEDIATE', trigger: 'APP_BOOT', loaderId: 'none', securityClass: 'RESTRICTED', metadata: { note: 'não existe no app estático; declarado para o cache recusar (NO_CACHE).' } })
  ];
  const TPL_BY_TYPE = new Map(); for (const t of TEMPLATES) if (!TPL_BY_TYPE.has(t.type)) TPL_BY_TYPE.set(t.type, t);

  /** ResourceRegistry for one tenant/development: descriptor(type, overrides) → LoadResourceDescriptor with its ResourceKey */
  function ResourceRegistry({ organizationId, developmentId, dev = null, manifest = null } = {}) {
    if (!organizationId) throw new KeyError('TENANT_REQUIRED', 'organizationId é obrigatório no registro de recursos');
    function descriptor(type, o = {}) {
      const t = TPL_BY_TYPE.get(type); if (!t) throw new KeyError('UNKNOWN_TYPE', `tipo sem descritor: ${type}`);
      const key = makeKey({ organizationId, developmentId: o.developmentId || developmentId, type, resourceId: o.resourceId || t.resourceId, version: o.version, variant: o.variant, locale: o.locale });
      const deps = (o.dependencies || t.dependencies).map(d => typeof d === 'string' ? makeKey({ organizationId, developmentId, type: d, resourceId: TPL_BY_TYPE.get(d).resourceId }) : makeKey(d));
      const { url, ...rest } = t;
      return Object.freeze({ ...rest, ...o, key, dependencies: deps, resolveUrl: () => { try { return url ? url(dev || {}, manifest) || null : null; } catch (e) { return null; } } }); // no dev config → no URL (identity does not depend on it)
    }
    const types = () => [...TPL_BY_TYPE.keys()];
    return { organizationId, developmentId, descriptor, types, templates: TEMPLATES };
  }

  /** versions read from the published manifest.json (the pointer); used to give artifacts concrete versions */
  function versionsFromManifest(m) {
    if (!m) return {};
    const asset = p => { const a = (m.assets || []).find(x => x.path === p); return a ? a.checksum : null; };
    return { geometryVersion: m.staticVersion || null, analysisVersion: m.analysisVersion || null, priceTableVersion: m.priceTableVersion || null, commercialRevision: m.commercialRevision == null ? null : String(m.commercialRevision),
      availabilityRevision: m.availabilityRevision == null ? null : String(m.availabilityRevision), assetVersion: asset, appVersion: m.appVersion || null };
  }

  // ---------------------------------------------------------------- ResourceDependencyGraph (DAG)
  /** graph over descriptors: nodes by serialized key; edges from dependencies. levels() = groups that can load in parallel. */
  function ResourceDependencyGraph(descriptors) {
    const nodes = new Map(), byType = new Map();
    for (const d of descriptors) { nodes.set(serializeResourceKey(d.key), d); if (!byType.has(d.key.type)) byType.set(d.key.type, serializeResourceKey(d.key)); }
    // a dependency matches an exact key, or (unversioned template dependency) any node of that type
    const resolveDep = k => { const s = serializeResourceKey(k); return nodes.has(s) ? s : byType.get(k.type) || null; };
    const edges = new Map([...nodes.keys()].map(k => [k, nodes.get(k).dependencies.map(resolveDep).filter(Boolean)]));
    function cycles() {
      const out = [], color = new Map(), stack = [];
      const visit = n => { color.set(n, 1); stack.push(n); for (const m of edges.get(n) || []) { if (color.get(m) === 1) out.push(stack.slice(stack.indexOf(m)).concat(m)); else if (!color.get(m)) visit(m); } stack.pop(); color.set(n, 2); };
      for (const n of nodes.keys()) if (!color.get(n)) visit(n);
      return out;
    }
    function missing() { const out = []; for (const d of nodes.values()) for (const k of d.dependencies) if (!resolveDep(k)) out.push({ resource: serializeResourceKey(d.key), dependency: k.type }); return out; }
    /** topological levels; a level holds independent resources that start together (no artificial waterfall) */
    function levels(subset) {
      const want = new Set(subset ? subset.map(k => typeof k === 'string' ? k : serializeResourceKey(k)) : nodes.keys());
      const done = new Set(), out = [];
      const pending = () => [...want].filter(k => !done.has(k));
      while (pending().length) {
        const lvl = pending().filter(k => (edges.get(k) || []).every(d => done.has(d) || !want.has(d)));
        if (!lvl.length) throw new KeyError('DEPENDENCY_CYCLE', 'ciclo de dependências: ' + pending().join(', '));
        lvl.forEach(k => done.add(k)); out.push(lvl);
      }
      return out;
    }
    const dependenciesOf = k => (edges.get(typeof k === 'string' ? k : serializeResourceKey(k)) || []).slice();
    return { nodes, edges, cycles, missing, levels, dependenciesOf, has: k => nodes.has(typeof k === 'string' ? k : serializeResourceKey(k)) };
  }

  // ---------------------------------------------------------------- version coherence
  const VERSION_FIELDS = ['developmentConfigVersion', 'geometryVersion', 'analysisVersion', 'priceTableVersion', 'availabilityRevision', 'customerProfileVersion', 'presentationSnapshotId'];
  /** which version fields each resource type consumes (topic 35: never include versions the resource does not consume) */
  const CONSUMES = Object.freeze({ GEOMETRY_BUNDLE: ['geometryVersion', 'analysisVersion'], MAP_LOT_INDEX: ['geometryVersion'], SPATIAL_INDEX: ['geometryVersion'], LAYER_VALUES: ['geometryVersion', 'analysisVersion'],
    PRICING_SNAPSHOT: ['priceTableVersion'], AVAILABILITY_SNAPSHOT: ['availabilityRevision'], LOT_QUICK_VIEW: ['geometryVersion', 'analysisVersion', 'priceTableVersion', 'availabilityRevision'],
    TECHNICAL_ANALYSIS_INPUT: ['analysisVersion'], RECOMMENDATION_RESULT: ['analysisVersion', 'priceTableVersion', 'availabilityRevision', 'customerProfileVersion'], PRESENTATION_SNAPSHOT: ['presentationSnapshotId'] });
  /** LoadVersionContext restricted to what a resource type consumes */
  function versionContextFor(type, ctx = {}) { const out = {}; for (const f of CONSUMES[type] || []) if (ctx[f] != null) out[f] = String(ctx[f]); return out; }
  /** ResourceCompatibilityValidator: a loaded result is committed only if the versions it was built against match the expected context.
      Missing info is UNKNOWN (never silently coerced to compatible when the expected side has a version). */
  function validateCompatibility(type, builtAgainst = {}, expected = {}) {
    const mismatches = [];
    for (const f of CONSUMES[type] || []) {
      const a = builtAgainst[f], b = expected[f];
      if (b == null) continue;
      if (a == null) mismatches.push({ field: f, expected: String(b), actual: null, unknown: true });
      else if (String(a) !== String(b)) mismatches.push({ field: f, expected: String(b), actual: String(a) });
    }
    const status = !mismatches.length ? 'COMPATIBLE' : mismatches.every(m => m.unknown) ? 'UNKNOWN' : 'VERSION_MISMATCH';
    return { status, mismatches, action: status === 'COMPATIBLE' ? 'COMMIT' : 'REFRESH_MANIFEST_THEN_RETRY_ONCE' };
  }

  // ---------------------------------------------------------------- failure policy
  const FAILURE_POLICY = Object.freeze({
    APP_SHELL: { behavior: 'BLOCK_ROUTE', maxAutomaticRetries: 0, userRetryAllowed: true },
    GEOMETRY_BUNDLE: { behavior: 'BLOCK_ROUTE', maxAutomaticRetries: 2, userRetryAllowed: true, message: 'Não foi possível carregar os lotes.' },
    MAP_BOOTSTRAP: { behavior: 'DEGRADE', maxAutomaticRetries: 2, userRetryAllowed: false, message: 'versões não confirmadas; os dados carregados continuam válidos.' },
    PRICING_SNAPSHOT: { behavior: 'DEGRADE', maxAutomaticRetries: 2, userRetryAllowed: true, message: 'Preço de tabela não confirmado agora: mostrando a última tabela disponível (necessita confirmação).' },
    AVAILABILITY_SNAPSHOT: { behavior: 'DEGRADE', maxAutomaticRetries: 1, userRetryAllowed: true, message: 'Disponibilidade não confirmada: status desconhecido.' },
    BASE_MAP_MEDIUM: { behavior: 'DEGRADE', maxAutomaticRetries: 1, userRetryAllowed: false, message: 'Não foi possível carregar a planta. Os lotes continuam navegáveis.' },
    BASE_MAP_HIGH: { behavior: 'KEEP_LOWER_QUALITY', maxAutomaticRetries: 1, userRetryAllowed: false, message: 'Foto aérea indisponível: mantendo a planta.' },
    TECHNICAL_ANALYSIS_INPUT: { behavior: 'SHOW_RETRY', maxAutomaticRetries: 1, userRetryAllowed: true, message: 'Não foi possível carregar as medições agora. O score publicado continua valendo.' },
    MOBILITY_ROUTES: { behavior: 'HIDE_FEATURE', maxAutomaticRetries: 1, userRetryAllowed: true },
    GALLERY_INDEX: { behavior: 'HIDE_FEATURE', maxAutomaticRetries: 1, userRetryAllowed: true },
    GALLERY_IMAGE: { behavior: 'HIDE_FEATURE', maxAutomaticRetries: 0, userRetryAllowed: false },
    LOT_PRICE_HISTORY: { behavior: 'SHOW_RETRY', maxAutomaticRetries: 0, userRetryAllowed: true },
    DOCUMENT_PREVIEW: { behavior: 'SHOW_RETRY', maxAutomaticRetries: 0, userRetryAllowed: true },
    SERVICE_WORKER: { behavior: 'HIDE_FEATURE', maxAutomaticRetries: 0, userRetryAllowed: false }
  });
  const DEFAULT_FAILURE = Object.freeze({ behavior: 'DEGRADE', maxAutomaticRetries: 1, userRetryAllowed: true });
  const failurePolicy = type => ({ resourceType: type, ...(FAILURE_POLICY[type] || DEFAULT_FAILURE) });

  // ---------------------------------------------------------------- code chunks (FeatureModuleRegistry)
  /** Every module is inline today (one index.html). This registry says which ones the Map core needs and which are
      candidates for a deferred chunk; the build can measure them (loading/planner.js analyzeBundle). chunk = target chunk name. */
  // Round 6 (code splitting): this table is also the build's split plan (scripts/chunks.js). lazy: true → the modules (and the
  // config folders in `configs`) leave the inline page and go to dash/chunks/<chunk>.<hash>.js, loaded on first use by
  // App.chunks (loading/chunkLoader.js) and precached by the Service Worker. lazy: false → stays in the page (first paint).
  // Longest prefix wins, so explicit core files (e.g. documents/integrity.js, services/comparison.js) stay inline.
  const FEATURE_MODULES = Object.freeze([
    { moduleId: 'core', chunk: 'core', lazy: false, preloadPolicy: 'NEVER', estimatedChunkClass: 'LARGE', dependencies: [], prefixes: ['prelude.js', 'configs', 'domain/', 'config/', 'security/', 'utils/', 'data/', 'state/', 'layout/', 'map/', 'filters/', 'services/', 'presentation/', 'viewmodels/', 'quickview/', 'mobile/', 'intelligence/', 'rules/', 'datastate/', 'loading/', 'cache/', 'documents/integrity.js', 'presentation/securityView.js', 'services/comparison.js', 'services/share.js'] },
    { moduleId: 'comparison', chunk: 'comparison', lazy: true, routeCodes: ['compare'], preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'MEDIUM', dependencies: ['core'], prefixes: ['compare/', 'presentation/compareView.js'], configs: ['compare'], intent: 'segundo lote adicionado à comparação' },
    { moduleId: 'customer', chunk: 'customer', lazy: true, routeCodes: ['clients'], preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'LARGE', dependencies: ['core'], prefixes: ['customer/', 'journey/'], configs: ['customer', 'journey'], intent: 'aba Clientes ou cliente em atendimento' },
    { moduleId: 'favorites', chunk: 'favorites', lazy: true, preloadPolicy: 'AFTER_INTERACTIVE', estimatedChunkClass: 'SMALL', dependencies: ['core'], prefixes: ['favorites/', 'presentation/favoritesView.js'], intent: 'serviço de favoritos, iniciado depois da primeira pintura' },
    { moduleId: 'decision', chunk: 'decision', lazy: true, preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'MEDIUM', dependencies: ['core'], prefixes: ['decision/'], configs: ['decision'], intent: 'perfil de busca ou cliente em atendimento (painel de decisão)' },
    { moduleId: 'presentation', chunk: 'presentation', lazy: true, routeCodes: ['presentation', 'share'], preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'MEDIUM', dependencies: ['core', 'comparison'], prefixes: ['presentationmode/', 'share/'], intent: '"Apresentação guiada"' },
    { moduleId: 'financial', chunk: 'financial', lazy: false, preloadPolicy: 'NEVER', estimatedChunkClass: 'MEDIUM', dependencies: ['core'], prefixes: ['pricing/', 'presentation/pricingView.js', 'services/solar.js'], intent: 'ficha do lote (primeira pintura com deep link): fica na página' },
    { moduleId: 'technical', chunk: 'technical', lazy: true, preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'LARGE', dependencies: ['core'], prefixes: ['versioning/', 'provenance/', 'confidence/', 'documents/', 'presentation/dataTrustView.js'], configs: ['documents', 'provenance', 'confidence', 'versioning'], intent: 'modo Técnico, Empreendimento ou explicação técnica' },
    { moduleId: 'privacy', chunk: 'privacy', lazy: true, preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'SMALL', dependencies: ['core'], prefixes: ['privacy/'], intent: 'Empreendimento → "Dados neste aparelho"' },
    { moduleId: 'surroundings', chunk: 'surroundings', lazy: true, preloadPolicy: 'ON_INTENT', estimatedChunkClass: 'SMALL', dependencies: ['core'], prefixes: ['surroundings/', 'config/surroundings/'], css: ['surroundings/surroundings.css'], intent: 'Aba Entorno do mapa (todos os modos; mapa OpenStreetMap sem chave) e Empreendimento no modo Técnico (Google Maps, flag OFF)' }
  ]);
  function chunkOf(moduleFile) {
    let best = null;
    for (const m of FEATURE_MODULES) for (const p of m.prefixes) if (moduleFile === p || moduleFile.startsWith(p)) if (!best || p.length > best.p.length) best = { m, p };
    return best ? best.m.moduleId : 'core';
  }

  // ---------------------------------------------------------------- legacy inventory (what the code loads today)
  const LegacyLoadInventory = Object.freeze([
    { location: 'scripts/build.js (index.html)', resourceType: 'APP_SHELL', trigger: 'APP_BOOT', eager: true, duplicated: false, blocksRoute: true, cancelable: false, versionAware: true, tenantAware: false, estimatedCostClass: 'HIGH', migrationAction: 'SPLIT', notes: 'Rodada 6: dividido. Comparação, clientes/jornada, favoritos, decisão, apresentação/compartilhamento, técnico (documentos, origem, confiança, versionamento), privacidade e Entorno saem da página e carregam sob demanda (dash/chunks/*.js, pré-cache do Service Worker).' },
    { location: 'data/offline.js HybridLotSource.loadLayers (1ª visita)', resourceType: 'MAP_BOOTSTRAP', trigger: 'APP_BOOT', eager: true, duplicated: false, blocksRoute: true, cancelable: true, versionAware: true, tenantAware: false, estimatedCostClass: 'MEDIUM', migrationAction: 'KEEP', notes: 'era cascata manifest → lots → commercial; agora os três saem em paralelo (corrigido neste tópico).' },
    { location: 'data/offline.js SyncManager.sync("boot") logo após 1ª visita', resourceType: 'PRICING_SNAPSHOT', trigger: 'APP_BOOT', eager: true, duplicated: true, blocksRoute: false, cancelable: true, versionAware: true, tenantAware: false, estimatedCostClass: 'LOW', migrationAction: 'REMOVE', notes: 'manifest.json e commercial.json eram pedidos 2× na 1ª visita; a sincronização de boot reaproveita a carga recém-confirmada (corrigido).' },
    { location: 'data/offline.js AssetCache.get (planta)', resourceType: 'BASE_MAP_MEDIUM', trigger: 'ROUTE_READY', eager: true, duplicated: true, blocksRoute: false, cancelable: false, versionAware: true, tenantAware: false, estimatedCostClass: 'HIGH', migrationAction: 'MOVE_TO_COORDINATOR', notes: 'planta.webp (1,26 MB) baixada 3× em paralelo na 1ª visita (sem dedup em voo); dedup adicionada (corrigido).' },
    { location: 'data/repositories.js LotRepository (lots.json)', resourceType: 'GEOMETRY_BUNDLE', trigger: 'APP_BOOT', eager: true, duplicated: false, blocksRoute: true, cancelable: false, versionAware: true, tenantAware: false, estimatedCostClass: 'HIGH', migrationAction: 'SPLIT', notes: 'os 70 campos dos 498 lotes entram no boot (geometria + índice + análise + seções). Projeção de mapa separada: pendente (exige gerar novo arquivo publicado).' },
    { location: 'presentation/app.js openTechExplain (analysis-input.json)', resourceType: 'TECHNICAL_ANALYSIS_INPUT', trigger: 'USER_ACTION', eager: false, duplicated: false, blocksRoute: false, cancelable: false, versionAware: false, tenantAware: false, estimatedCostClass: 'HIGH', migrationAction: 'PREFETCH', notes: 'já é sob demanda, com guarda de lote atual; falta chave versionada (checksum do manifest) e prefetch por intenção.' },
    { location: 'data/repositories.js SpatialRepository (routes.json)', resourceType: 'MOBILITY_ROUTES', trigger: 'USER_ACTION', eager: false, duplicated: false, blocksRoute: false, cancelable: false, versionAware: false, tenantAware: false, estimatedCostClass: 'MEDIUM', migrationAction: 'KEEP', notes: 'sob demanda com promessa compartilhada (dedup própria).' },
    { location: 'data/repositories.js AssetRepository (img_list.json) + galeria <img>', resourceType: 'GALLERY_IMAGE', trigger: 'USER_ACTION', eager: false, duplicated: false, blocksRoute: false, cancelable: false, versionAware: false, tenantAware: false, estimatedCostClass: 'MEDIUM', migrationAction: 'REVIEW', notes: 'imagens da galeria sem loading="lazy"/dimensões: receita para o integrador (imageAttrs).' },
    { location: 'presentation/app.js applyBackground (aerea.webp)', resourceType: 'BASE_MAP_HIGH', trigger: 'USER_ACTION', eager: false, duplicated: false, blocksRoute: false, cancelable: false, versionAware: true, tenantAware: false, estimatedCostClass: 'MEDIUM', migrationAction: 'KEEP', notes: 'só no fundo Aérea/Híbrido.' },
    { location: 'scripts/build.js <link> Google Fonts', resourceType: 'APP_FONT', trigger: 'APP_BOOT', eager: true, duplicated: false, blocksRoute: false, cancelable: false, versionAware: false, tenantAware: false, estimatedCostClass: 'LOW', migrationAction: 'KEEP', notes: 'display=swap; terceiro (fonts.googleapis.com).' }
  ]);

  return Object.freeze({ LoadResourceType, LoadCriticality, LoadPriority, PRIORITY_RANK, LoadTrigger, LoadScopeKind, ResourceLoadState, SecurityClass, ErrorCode, FailureBehavior, KeyError,
    KEY_FIELDS, makeKey, serializeResourceKey, parseResourceKey, sameKey, isResolved, TEMPLATES, ResourceRegistry, versionsFromManifest, ResourceDependencyGraph,
    VERSION_FIELDS, CONSUMES, versionContextFor, validateCompatibility, FAILURE_POLICY, failurePolicy, FEATURE_MODULES, chunkOf, LegacyLoadInventory });
})();
