/* cache/cacheCore.js — topic 48: cache vocabulary, keys, policies and decisions (pure; no storage, no network).
   Cache = an accelerating, disposable copy; the authority stays in the published files / backend (never source of truth).
   CachePartitionKey (who may reuse a copy) + CacheKey = ResourceKey (topic 47, the same identity) + partition + representation
   schema · canonical serialization (fixed order, escaped, explicit omission) · QueryFingerprint · data classification ·
   CachePolicyRegistry (one policy per resource type: strategy, soft/hard TTL, persistence, partition, retention, logout/tenant
   rules) · CacheFreshness (FRESH / STALE_REVALIDATABLE / EXPIRED / INVALID / CORRUPT / UNKNOWN) kept apart from DomainFreshness ·
   CacheReadDecision · CacheUseDecision by ActionIntent (VIEW / SIMULATE / SHARE / PROPOSE / RESERVE) with the domain wording
   ("necessita confirmação", never "cache stale") · dependency fingerprints + CacheDependencyIndex · compatibility validator ·
   schema migrations · negative caching · eviction scoring · ResourceVersionManifest (pointers) ≠ CacheManifest (local storage
   metadata) · CacheTaxonomy (what is cached where, today) · LegacyCacheInventory.

   Invariants: a price is never served stale without its freshness label; availability UNKNOWN stays UNKNOWN and a cached
   AVAILABLE is never "disponível agora"; Customer/Journey/Share/auth never persist; no secrets or PII in keys, labels or metrics. */
App.cache = App.cache || {};
App.cache.core = (() => {
  const RS = App.loading && App.loading.resources;
  if (!RS) throw new Error('cache/cacheCore.js requer loading/resources.js (ResourceKey do tópico 47)');
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const CacheStrategy = E('IMMUTABLE_VERSIONED', 'CACHE_FIRST_REVALIDATE', 'STALE_WHILE_REVALIDATE', 'NETWORK_FIRST', 'MEMORY_ONLY', 'NETWORK_ONLY', 'NO_CACHE');
  const CacheFreshness = E('FRESH', 'STALE_REVALIDATABLE', 'EXPIRED', 'INVALID', 'CORRUPT', 'UNKNOWN');
  const RetentionClass = E('SESSION_ONLY', 'SHORT_LIVED', 'LONG_LIVED_VERSIONED', 'REGENERABLE', 'NEVER_PERSIST');
  const PrincipalScope = E('PUBLIC', 'ORGANIZATION', 'USER', 'CUSTOMER_CONTEXT', 'SHARE_SESSION');
  const LookupStatus = E('HIT_FRESH', 'HIT_STALE', 'MISS', 'EXPIRED', 'INVALID', 'CORRUPT', 'FORBIDDEN');
  const StorageClass = E('MEMORY', 'INDEXED_DB', 'CACHE_STORAGE', 'HTTP');
  const Compatibility = E('COMPATIBLE', 'VERSION_MISMATCH', 'DEPENDENCY_MISMATCH', 'SCHEMA_MISMATCH', 'SECURITY_SCOPE_MISMATCH', 'UNKNOWN');
  const EntryOrigin = E('USER_REQUEST', 'ROUTE_CRITICAL', 'ROUTE_DEFERRED', 'PREFETCH', 'BACKGROUND_REVALIDATION', 'OFFLINE_PREPARATION');
  const ActionIntent = E('VIEW', 'SIMULATE', 'SHARE', 'PROPOSE', 'RESERVE');
  const InvalidationEvent = E('AvailabilityRevisionPublished', 'PriceTableActivated', 'AnalysisVersionActivated', 'DevelopmentConfigPublished', 'GeometryVersionPublished', 'DocumentVersionPublished',
    'CustomerProfileUpdated', 'PermissionRevisionChanged', 'OrganizationMembershipChanged', 'PresentationSnapshotRevoked', 'ShareGrantRevoked', 'UserLoggedOut', 'TenantSwitched', 'PrivacyDeletion');
  const CACHE_SCHEMA_VERSION = '1';
  class CacheError extends Error { constructor(code, message) { super(message); this.code = code; } }

  // ---------------------------------------------------------------- hashing / canonical form
  /** canonical JSON: sorted keys, undefined dropped (explicit omission), arrays keep order unless the caller sorts them */
  function canonical(v) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  /** FNV-1a 32-bit (same family as offline.checksum); two rounds with different seeds → 64-bit hex to reduce collisions */
  function hash(s) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 0x01000193); b ^= c; b = Math.imul(b, 0x01000193 + 0x2b); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  const fingerprintOf = v => hash(typeof v === 'string' ? v : canonical(v) || '');

  // ---------------------------------------------------------------- partition / key
  const PARTITION_FIELDS = ['organizationId', 'principalScope', 'principalId', 'permissionRevision', 'locale'];
  /** makePartition: USER / CUSTOMER_CONTEXT / SHARE_SESSION require a principal; a share session is referenced by an opaque hash, never by its token */
  function makePartition(p) {
    if (!p || !p.organizationId) throw new CacheError('TENANT_REQUIRED', 'organizationId é obrigatório na partição de cache');
    const scope = p.principalScope || 'ORGANIZATION';
    if (!PrincipalScope[scope]) throw new CacheError('INVALID_SCOPE', `escopo de partição inválido: ${scope}`);
    if (['USER', 'CUSTOMER_CONTEXT', 'SHARE_SESSION'].includes(scope) && !p.principalId) throw new CacheError('PRINCIPAL_REQUIRED', `${scope} exige principalId`);
    if (p.principalId && /^(Bearer\s|eyJ|tok_|sk_|st_)/i.test(String(p.principalId))) throw new CacheError('TOKEN_IN_KEY', 'token não pode ser parte da chave de cache: use sharePartitionRef()');
    const out = {}; for (const f of PARTITION_FIELDS) if (p[f] != null && p[f] !== '') out[f] = String(p[f]);
    out.principalScope = scope;
    return Object.freeze(out);
  }
  /** opaque, stable reference for a share session (the token itself never enters keys, logs or metrics) */
  const sharePartitionRef = (shareSessionId) => 'shr_' + fingerprintOf('share:' + String(shareSessionId));
  /** CacheKey = ResourceKey + CachePartitionKey + representationSchemaVersion */
  function makeCacheKey(resource, partition, representationSchemaVersion = '1') {
    const r = RS.makeKey(resource), p = makePartition(partition);
    if (r.organizationId !== p.organizationId) throw new CacheError('PARTITION_TENANT_MISMATCH', 'recurso e partição de organizações diferentes');
    return Object.freeze({ resource: r, partition: p, representationSchemaVersion: String(representationSchemaVersion) });
  }
  const enc = v => encodeURIComponent(v).replace(/[|~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  function serializeCacheKey(k) {
    const ck = k.resource && k.partition ? k : null; if (!ck) throw new CacheError('INVALID_CACHE_KEY', 'CacheKey inválida');
    const p = makePartition(ck.partition);
    return 'ck1|' + RS.serializeResourceKey(ck.resource).slice(4) + '||' + PARTITION_FIELDS.map(f => (p[f] == null ? '~' : enc(p[f]))).join('|') + '||s' + enc(ck.representationSchemaVersion);
  }
  /** QueryFingerprint: canonical query; arrays listed in `unordered` are sorted; free text is hashed (no raw text kept) */
  function queryFingerprint(query, { unordered = [], hashText = ['text', 'q', 'search'] } = {}) {
    const norm = {};
    for (const k of Object.keys(query || {}).sort()) {
      let v = query[k]; if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (Array.isArray(v) && unordered.includes(k)) v = [...v].map(String).sort();
      if (hashText.includes(k) && typeof v === 'string') v = 'h:' + fingerprintOf(v.trim().toLowerCase());
      norm[k] = v;
    }
    return { fingerprint: fingerprintOf(norm), canonical: canonical(norm) };
  }

  // ---------------------------------------------------------------- classification + policies
  const SECURITY_BY_TYPE = Object.freeze(Object.fromEntries(RS.TEMPLATES.map(t => [t.type, t.securityClass])));
  const PUBLIC_EXTRA = new Set(['PRICE_TABLE_VERSION', 'ANALYSIS_VERSION', 'MAP_LOT_INDEX', 'LAYER_VALUES', 'BASE_MAP_LOW', 'SPATIAL_INDEX', 'GEOMETRY_MANIFEST', 'LOT_PROVENANCE_DETAIL', 'LOT_CONFIDENCE_DETAIL', 'DOCUMENT_VIEWER_MODULE', 'FINANCIAL_MODULE', 'ANALYTICS_DASHBOARD_MODULE']);
  const securityClassOf = type => SECURITY_BY_TYPE[type] || (PUBLIC_EXTRA.has(type) ? 'PUBLIC_SAFE' : 'RESTRICTED'); // unknown → most restrictive
  const H = 3600e3, DAY = 24 * H;
  const P = (resourceType, strategy, o = {}) => Object.freeze({
    id: `${resourceType}.${strategy}`.toLowerCase(), resourceType, strategy, memoryEnabled: strategy !== 'NO_CACHE' && strategy !== 'NETWORK_ONLY', persistentEnabled: false, persistentStore: undefined,
    softTtlMs: undefined, hardTtlMs: undefined, maxStaleMs: undefined, backgroundRevalidate: false, allowStaleOnNetworkFailure: false, requireChecksum: false, requireVersionMatch: false,
    partitionScope: 'ORGANIZATION', retentionClass: 'SESSION_ONLY', evictionPriority: 'NORMAL', clearOnLogout: true, clearOnTenantSwitch: true, persistSensitive: false,
    staleForIntents: [], domainLabel: null, ...o });
  const IMM = (t, o = {}) => P(t, 'IMMUTABLE_VERSIONED', { persistentEnabled: true, persistentStore: 'INDEXED_DB', requireChecksum: true, requireVersionMatch: true, partitionScope: 'PUBLIC', retentionClass: 'LONG_LIVED_VERSIONED', evictionPriority: 'LOW', clearOnLogout: false, clearOnTenantSwitch: false, ...o });
  const MEM = (t, o = {}) => P(t, 'MEMORY_ONLY', { retentionClass: 'NEVER_PERSIST', ...o });
  const POLICIES = Object.freeze({
    APP_SHELL: P('APP_SHELL', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'CACHE_STORAGE', softTtlMs: 0, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'LONG_LIVED_VERSIONED', evictionPriority: 'LOW', clearOnLogout: false, clearOnTenantSwitch: false, staleForIntents: ['VIEW', 'SIMULATE', 'SHARE', 'PROPOSE', 'RESERVE'], notes: 'sw.js: navegação rede primeiro, shell salvo para offline.' }),
    APP_FONT: P('APP_FONT', 'NETWORK_ONLY', { partitionScope: 'PUBLIC', notes: 'terceiro: cache HTTP do navegador; o SW não intercepta outra origem.' }),
    DEVELOPMENT_CONFIG: IMM('DEVELOPMENT_CONFIG', { persistentEnabled: false, persistentStore: undefined, requireChecksum: false, notes: 'embutida no index.html (versão = hash do build).' }),
    ORGANIZATION_CONTEXT: MEM('ORGANIZATION_CONTEXT', { softTtlMs: 5 * 60e3, hardTtlMs: H }),
    PERMISSIONS: MEM('PERMISSIONS', { partitionScope: 'USER', softTtlMs: 60e3, hardTtlMs: 10 * 60e3, notes: 'chave inclui userId + permissionRevision; decisão de autorização continua no servidor.' }),
    MAP_BOOTSTRAP: P('MAP_BOOTSTRAP', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'INDEXED_DB', softTtlMs: 0, hardTtlMs: 30 * DAY, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'SHORT_LIVED', evictionPriority: 'LOW', clearOnLogout: false, clearOnTenantSwitch: false, staleForIntents: ['VIEW', 'SIMULATE'], notes: 'ponteiro de versões (manifest.json): sempre revalidado; nunca é fonte comercial.' }),
    GEOMETRY_BUNDLE: IMM('GEOMETRY_BUNDLE', { notes: 'staticLots/analysisLots por versão (ws-cache), checksum do manifest; ponteiro atual + anterior.' }),
    MAP_LOT_INDEX: IMM('MAP_LOT_INDEX'), LAYER_VALUES: IMM('LAYER_VALUES', { notes: 'valores analíticos ligados à AnalysisVersion.' }),
    SPATIAL_INDEX: P('SPATIAL_INDEX', 'MEMORY_ONLY', { partitionScope: 'PUBLIC', retentionClass: 'REGENERABLE', clearOnLogout: false, notes: 'reconstruído da geometria (barato para 498 lotes).' }),
    SEARCH_INDEX: P('SEARCH_INDEX', 'MEMORY_ONLY', { partitionScope: 'PUBLIC', retentionClass: 'REGENERABLE', clearOnLogout: false }),
    PRICE_TABLE_VERSION: IMM('PRICE_TABLE_VERSION', { persistentEnabled: false, persistentStore: undefined, requireChecksum: false, notes: 'tabela publicada versionada (imutável); a tabela vigente é o ponteiro PRICING_SNAPSHOT.' }),
    ANALYSIS_VERSION: IMM('ANALYSIS_VERSION'),
    PRICING_SNAPSHOT: P('PRICING_SNAPSHOT', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'INDEXED_DB', softTtlMs: 0, hardTtlMs: undefined, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'SHORT_LIVED', clearOnLogout: false, clearOnTenantSwitch: false,
      staleForIntents: ['VIEW', 'SIMULATE'], domainLabel: 'PRICE', notes: 'rede primeiro; cópia local só como "última tabela disponível — necessita confirmação". Limite de validade (hard TTL) é decisão de negócio (FreshnessPolicy).' }),
    AVAILABILITY_SNAPSHOT: P('AVAILABILITY_SNAPSHOT', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'INDEXED_DB', softTtlMs: 0, hardTtlMs: undefined, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'SHORT_LIVED', clearOnLogout: false, clearOnTenantSwitch: false,
      staleForIntents: ['VIEW'], domainLabel: 'AVAILABILITY', notes: 'nunca "disponível agora" a partir de cópia; reservar/propor/compartilhar exige revalidação.' }),
    BASE_MAP_LOW: IMM('BASE_MAP_LOW', { persistentStore: 'CACHE_STORAGE' }), BASE_MAP_MEDIUM: IMM('BASE_MAP_MEDIUM', { persistentStore: 'CACHE_STORAGE', notes: 'AssetCache: planta.webp?v=<checksum>.' }),
    BASE_MAP_HIGH: IMM('BASE_MAP_HIGH', { persistentStore: 'CACHE_STORAGE', evictionPriority: 'HIGH', notes: 'aerea.webp?v=<checksum>; primeira a sair sob pressão de cota.' }),
    TECHNICAL_ANALYSIS_INPUT: IMM('TECHNICAL_ANALYSIS_INPUT', { persistentEnabled: false, persistentStore: undefined, evictionPriority: 'HIGH', retentionClass: 'REGENERABLE', notes: 'memória (L1) por checksum; persistência offline: decisão do tópico 49.' }),
    MOBILITY_ROUTES: P('MOBILITY_ROUTES', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'CACHE_STORAGE', softTtlMs: 0, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'REGENERABLE', clearOnLogout: false, clearOnTenantSwitch: false, staleForIntents: ['VIEW', 'SIMULATE', 'SHARE'] }),
    GALLERY_INDEX: P('GALLERY_INDEX', 'NETWORK_FIRST', { persistentEnabled: true, persistentStore: 'CACHE_STORAGE', softTtlMs: 0, allowStaleOnNetworkFailure: true, partitionScope: 'PUBLIC', retentionClass: 'REGENERABLE', clearOnLogout: false, clearOnTenantSwitch: false, staleForIntents: ['VIEW', 'SIMULATE', 'SHARE'] }),
    GALLERY_IMAGE: IMM('GALLERY_IMAGE', { persistentStore: 'CACHE_STORAGE', requireChecksum: false, evictionPriority: 'HIGH', retentionClass: 'REGENERABLE' }),
    LOT_QUICK_VIEW: MEM('LOT_QUICK_VIEW', { requireVersionMatch: true, notes: 'composto em memória a partir dos snapshots; fingerprint de dependências (estático, análise, preço, disponibilidade).' }),
    LOT_DETAIL_SECTION: MEM('LOT_DETAIL_SECTION', { partitionScope: 'PUBLIC', requireVersionMatch: true, clearOnLogout: false }),
    LOT_PRICE_HISTORY: MEM('LOT_PRICE_HISTORY', { partitionScope: 'PUBLIC', requireVersionMatch: true, clearOnLogout: false, notes: 'chave: lote + tipo de preço + intervalo + versão do histórico.' }),
    LOT_PROVENANCE_DETAIL: MEM('LOT_PROVENANCE_DETAIL', { partitionScope: 'PUBLIC', clearOnLogout: false }), LOT_CONFIDENCE_DETAIL: MEM('LOT_CONFIDENCE_DETAIL', { partitionScope: 'PUBLIC', clearOnLogout: false }),
    COMPARISON_SESSION: MEM('COMPARISON_SESSION', { partitionScope: 'USER' }), COMPARISON_SECTION: MEM('COMPARISON_SECTION', { partitionScope: 'USER' }),
    RECOMMENDATION_RESULT: MEM('RECOMMENDATION_RESULT', { partitionScope: 'CUSTOMER_CONTEXT', requireVersionMatch: true }), RECOMMENDATION_EXPLANATION: MEM('RECOMMENDATION_EXPLANATION', { partitionScope: 'CUSTOMER_CONTEXT' }),
    CUSTOMER_SUMMARY: MEM('CUSTOMER_SUMMARY', { partitionScope: 'CUSTOMER_CONTEXT' }), CUSTOMER_PROFILE: MEM('CUSTOMER_PROFILE', { partitionScope: 'CUSTOMER_CONTEXT' }),
    JOURNEY_SUMMARY: MEM('JOURNEY_SUMMARY', { partitionScope: 'CUSTOMER_CONTEXT' }), JOURNEY_TIMELINE: MEM('JOURNEY_TIMELINE', { partitionScope: 'CUSTOMER_CONTEXT', notes: 'páginas por cursor, memória.' }),
    PRESENTATION_SNAPSHOT: MEM('PRESENTATION_SNAPSHOT', { partitionScope: 'USER' }), PRESENTATION_STEP_ASSET: MEM('PRESENTATION_STEP_ASSET', { partitionScope: 'USER' }),
    SHARE_RESOURCE: MEM('SHARE_RESOURCE', { partitionScope: 'SHARE_SESSION', softTtlMs: 0, notes: 'sessão de compartilhamento: memória, revogação imediata, nunca SWR.' }),
    DOCUMENT_METADATA: P('DOCUMENT_METADATA', 'STALE_WHILE_REVALIDATE', { softTtlMs: 5 * 60e3, hardTtlMs: H, maxStaleMs: 10 * 60e3, backgroundRevalidate: true, staleForIntents: ['VIEW'] }),
    DOCUMENT_PREVIEW: MEM('DOCUMENT_PREVIEW', { partitionScope: 'USER', notes: 'chave por DocumentVersion + representação + página; nunca por nome de arquivo.' }),
    DOCUMENT_VIEWER_MODULE: P('DOCUMENT_VIEWER_MODULE', 'NETWORK_ONLY', { partitionScope: 'PUBLIC' }),
    FINANCIAL_MODULE: P('FINANCIAL_MODULE', 'NETWORK_ONLY', { partitionScope: 'PUBLIC' }), ANALYTICS_DASHBOARD_MODULE: P('ANALYTICS_DASHBOARD_MODULE', 'NETWORK_ONLY', { partitionScope: 'PUBLIC' }),
    FINANCIAL_SIMULATION_RESULT: MEM('FINANCIAL_SIMULATION_RESULT', { partitionScope: 'CUSTOMER_CONTEXT', requireVersionMatch: true }),
    ANALYTICS_QUERY_RESULT: MEM('ANALYTICS_QUERY_RESULT', { softTtlMs: 60e3, hardTtlMs: 5 * 60e3, notes: 'chave = fingerprint canônico da consulta + revisão de permissão.' }),
    SERVICE_WORKER: P('SERVICE_WORKER', 'NETWORK_ONLY', { partitionScope: 'PUBLIC' }),
    AUTH_TOKEN: P('AUTH_TOKEN', 'NO_CACHE', { partitionScope: 'USER', notes: 'segredo/token: nunca em cache, storage, URL ou log.' })
  });
  /** CachePolicyRegistry.getPolicy(type, context) — the only place with TTLs; unknown types fall back to NO_CACHE (deny by default) */
  function getPolicy(type, ctx = {}) {
    const p = POLICIES[type] || P(type, 'NO_CACHE', { notes: 'tipo sem política: sem cache (negado por padrão).' });
    // persistent sensitive data is never enabled by context alone
    if (['CUSTOMER_SENSITIVE', 'RESTRICTED'].includes(securityClassOf(type)) && p.persistentEnabled) return Object.freeze({ ...p, persistentEnabled: false, persistentStore: undefined });
    if (ctx.persistentUnavailable && p.persistentEnabled) return Object.freeze({ ...p, persistentEnabled: false, persistentStore: undefined, notes: (p.notes || '') + ' (armazenamento persistente indisponível)' });
    return p;
  }
  /** registry self-check: sensitive types never persist, every TEMPLATE type has a policy, no SWR for commercial actions */
  function validateRegistry() {
    const errors = [];
    for (const t of RS.TEMPLATES) if (!POLICIES[t.type]) errors.push({ code: 'MISSING_POLICY', type: t.type });
    for (const [t, p] of Object.entries(POLICIES)) {
      const sc = securityClassOf(t);
      if ((sc === 'CUSTOMER_SENSITIVE' || sc === 'RESTRICTED') && p.persistentEnabled) errors.push({ code: 'SENSITIVE_PERSISTED', type: t });
      if ((t === 'PRICING_SNAPSHOT' || t === 'AVAILABILITY_SNAPSHOT') && p.strategy === 'STALE_WHILE_REVALIDATE') errors.push({ code: 'SWR_ON_COMMERCIAL', type: t });
      if (p.staleForIntents.some(i => i === 'RESERVE' || i === 'PROPOSE') && p.domainLabel) errors.push({ code: 'STALE_FOR_COMMERCIAL_ACTION', type: t });
      if (p.strategy === 'IMMUTABLE_VERSIONED' && !p.requireVersionMatch) errors.push({ code: 'IMMUTABLE_WITHOUT_VERSION', type: t });
    }
    return { ok: !errors.length, errors };
  }

  // ---------------------------------------------------------------- freshness
  /** entry timestamps from a policy (soft → staleAt, hard → expiresAt); jitter only for public manifests (anti-stampede) */
  function stamp(policy, fetchedAtMs, o = {}) {
    const j = o.jitterMs ? Math.round((o.random || Math.random)() * o.jitterMs) : 0;
    return { fetchedAt: new Date(fetchedAtMs).toISOString(), validatedAt: new Date(fetchedAtMs).toISOString(),
      staleAt: policy.softTtlMs == null ? undefined : new Date(fetchedAtMs + policy.softTtlMs + j).toISOString(),
      expiresAt: policy.hardTtlMs == null ? undefined : new Date(fetchedAtMs + policy.hardTtlMs + j).toISOString() };
  }
  /** CacheFreshness of an entry: technical only (FRESH means "this copy is within its TTL", never "the domain value is current") */
  function evaluateFreshness(entry, policy, now = Date.now(), o = {}) {
    if (!entry) return 'UNKNOWN';
    if (entry.corrupt || (o.checksumOf && entry.checksum && o.checksumOf(entry.value) !== entry.checksum)) return 'CORRUPT';
    if (entry.key && entry.key.representationSchemaVersion != null && o.schemaVersion != null && String(entry.key.representationSchemaVersion) !== String(o.schemaVersion)) return 'INVALID';
    if (policy.requireVersionMatch && policy.strategy === 'IMMUTABLE_VERSIONED' && !(entry.resourceVersion || (entry.key && entry.key.resource && entry.key.resource.version))) return 'INVALID';
    if (entry.invalidatedAt) return 'INVALID';
    if (entry.expiresAt && now >= Date.parse(entry.expiresAt)) {
      if (policy.maxStaleMs != null && now < Date.parse(entry.expiresAt) + policy.maxStaleMs) return 'STALE_REVALIDATABLE';
      return 'EXPIRED';
    }
    if (policy.strategy === 'IMMUTABLE_VERSIONED') return 'FRESH';
    if (entry.staleAt && now >= Date.parse(entry.staleAt)) return 'STALE_REVALIDATABLE';
    if (policy.softTtlMs === 0) return 'STALE_REVALIDATABLE';
    return 'FRESH';
  }
  const lookupStatusOf = f => ({ FRESH: 'HIT_FRESH', STALE_REVALIDATABLE: 'HIT_STALE', EXPIRED: 'EXPIRED', INVALID: 'INVALID', CORRUPT: 'CORRUPT', UNKNOWN: 'MISS' }[f]);
  /** CacheReadDecision — nobody but this function decides SWR / network-first behaviour */
  function readDecision(policy, freshness, ctx = {}) {
    const s = policy.strategy, intent = ctx.actionIntent || 'VIEW';
    const intentAllowsStale = policy.staleForIntents.includes(intent);
    if (s === 'NO_CACHE' || s === 'NETWORK_ONLY') return { useCachedValue: false, revalidate: false, blockForNetwork: true, allowStaleFallback: false };
    if (['CORRUPT', 'INVALID'].includes(freshness)) return { useCachedValue: false, revalidate: false, blockForNetwork: true, allowStaleFallback: false };
    if (s === 'NETWORK_FIRST') return { useCachedValue: false, revalidate: true, blockForNetwork: true, allowStaleFallback: policy.allowStaleOnNetworkFailure && intentAllowsStale && freshness !== 'EXPIRED' };
    if (freshness === 'FRESH') return { useCachedValue: true, revalidate: false, blockForNetwork: false, allowStaleFallback: false };
    if (s === 'IMMUTABLE_VERSIONED' || s === 'MEMORY_ONLY') return { useCachedValue: false, revalidate: false, blockForNetwork: true, allowStaleFallback: false };
    if (freshness === 'STALE_REVALIDATABLE' && intentAllowsStale && (s === 'STALE_WHILE_REVALIDATE' || (s === 'CACHE_FIRST_REVALIDATE' && policy.backgroundRevalidate)))
      return { useCachedValue: true, revalidate: true, blockForNetwork: false, allowStaleFallback: true };
    return { useCachedValue: false, revalidate: true, blockForNetwork: true, allowStaleFallback: policy.allowStaleOnNetworkFailure && intentAllowsStale && freshness !== 'EXPIRED' };
  }

  // ---------------------------------------------------------------- domain wording (cache never decides a domain rule)
  const LABELS = Object.freeze({
    PRICE_LAST_KNOWN: 'Preço de tabela da última tabela disponível — necessita confirmação',
    PRICE_NOT_AVAILABLE: 'Preço não disponível',
    AVAILABILITY_LAST_KNOWN: 'Última informação conhecida — necessita confirmação',
    AVAILABILITY_UNKNOWN: 'Status não confirmado',
    OFFLINE_COPY: 'Cópia salva neste aparelho — necessita confirmação',
    REVALIDATION_REQUIRED: 'É preciso confirmar com a fonte oficial antes desta ação'
  });
  /** CacheUseDecision: what a caller may do with a cached copy for an action intent. Warnings are domain codes, never "cache stale". */
  function useDecision({ policy, status, actionIntent = 'VIEW', online = true, domainFreshness = null }) {
    const intent = ActionIntent[actionIntent] ? actionIntent : 'VIEW', label = policy.domainLabel;
    const out = { canServe: false, mustRevalidate: false, canServeWhileRevalidating: false, canFallbackOnNetworkFailure: false, warningCodes: [], capabilityRestrictions: [], labels: [] };
    if (status === 'FORBIDDEN' || status === 'CORRUPT' || status === 'INVALID') { out.mustRevalidate = true; return out; }
    const stale = status === 'HIT_STALE' || status === 'EXPIRED' || (domainFreshness && domainFreshness !== 'FRESH');
    const commercialAction = intent === 'RESERVE' || intent === 'PROPOSE' || (intent === 'SHARE' && label === 'AVAILABILITY');
    if (label && commercialAction) { out.mustRevalidate = true; out.capabilityRestrictions.push('REQUIRES_NETWORK_REVALIDATION'); out.labels.push(LABELS.REVALIDATION_REQUIRED); if (!stale && status === 'HIT_FRESH' && domainFreshness === 'FRESH') out.canServe = true; return out; }
    if (status === 'HIT_FRESH' && !stale) { out.canServe = true; return out; }
    const allowed = policy.staleForIntents.includes(intent) && status !== 'EXPIRED' && status !== 'MISS';
    out.canServe = allowed; out.canFallbackOnNetworkFailure = allowed && policy.allowStaleOnNetworkFailure; out.canServeWhileRevalidating = allowed && policy.strategy === 'STALE_WHILE_REVALIDATE';
    out.mustRevalidate = true;
    if (allowed && stale) {
      if (label === 'PRICE') { out.warningCodes.push('PRICE_LAST_KNOWN'); out.labels.push(LABELS.PRICE_LAST_KNOWN); out.capabilityRestrictions.push('PROPOSE', 'RESERVE'); }
      else if (label === 'AVAILABILITY') { out.warningCodes.push('AVAILABILITY_LAST_KNOWN'); out.labels.push(LABELS.AVAILABILITY_LAST_KNOWN); out.capabilityRestrictions.push('RESERVE', 'PROPOSE', 'SHARE_AVAILABLE_NOW'); }
      else { out.warningCodes.push('OFFLINE_COPY'); if (!online) out.labels.push(LABELS.OFFLINE_COPY); }
    }
    return out;
  }
  /** availability shown from a cached copy: UNKNOWN stays UNKNOWN; a cached AVAILABLE is never claimed as current */
  function availabilityDisplay(status, { cacheStatus = 'HIT_FRESH', domainFreshness = 'UNKNOWN' } = {}) {
    if (!status || status === 'UNKNOWN') return { status: 'UNKNOWN', claimCurrent: false, label: LABELS.AVAILABILITY_UNKNOWN };
    const current = cacheStatus === 'HIT_FRESH' && domainFreshness === 'FRESH';
    return { status, claimCurrent: current, label: current ? null : LABELS.AVAILABILITY_LAST_KNOWN };
  }
  /** price shown from a cached copy: the freshness label is mandatory unless the source confirmed it in this session */
  function priceDisplay(price, { cacheStatus = 'HIT_FRESH', domainFreshness = 'UNKNOWN' } = {}) {
    if (price == null) return { value: null, label: LABELS.PRICE_NOT_AVAILABLE, confirmed: false };
    const confirmed = cacheStatus === 'HIT_FRESH' && domainFreshness === 'FRESH';
    return { value: price, confirmed, label: confirmed ? null : LABELS.PRICE_LAST_KNOWN };
  }

  // ---------------------------------------------------------------- dependencies + invalidation index
  /** CacheDependencyFingerprint: canonical hash of the dependency refs (order-independent) */
  function dependencyFingerprint(refs = []) {
    const norm = refs.map(r => ({ t: String(r.resourceType), i: String(r.resourceId), v: r.version == null ? undefined : String(r.version), r: r.revision == null ? undefined : String(r.revision), f: r.fingerprint })).sort((a, b) => (a.t + a.i < b.t + b.i ? -1 : 1));
    return fingerprintOf(norm);
  }
  /** event → resource types it invalidates (immutable artifacts are never in these lists: the pointer moves, the artifact stays) */
  const DEPENDENCY_INDEX = Object.freeze({
    AvailabilityRevisionPublished: ['AVAILABILITY_SNAPSHOT', 'LOT_QUICK_VIEW', 'RECOMMENDATION_RESULT', 'COMPARISON_SECTION', 'ANALYTICS_QUERY_RESULT'],
    PriceTableActivated: ['PRICING_SNAPSHOT', 'LOT_QUICK_VIEW', 'FINANCIAL_SIMULATION_RESULT', 'RECOMMENDATION_RESULT', 'COMPARISON_SECTION', 'LOT_PRICE_HISTORY'],
    AnalysisVersionActivated: ['MAP_BOOTSTRAP', 'LOT_QUICK_VIEW', 'RECOMMENDATION_RESULT', 'RECOMMENDATION_EXPLANATION', 'COMPARISON_SECTION', 'LOT_CONFIDENCE_DETAIL'],
    GeometryVersionPublished: ['MAP_BOOTSTRAP', 'LOT_QUICK_VIEW', 'SPATIAL_INDEX', 'SEARCH_INDEX', 'LOT_DETAIL_SECTION'],
    DevelopmentConfigPublished: ['MAP_BOOTSTRAP', 'DEVELOPMENT_CONFIG'],
    DocumentVersionPublished: ['DOCUMENT_METADATA', 'DOCUMENT_PREVIEW'],
    CustomerProfileUpdated: ['CUSTOMER_PROFILE', 'CUSTOMER_SUMMARY', 'RECOMMENDATION_RESULT', 'RECOMMENDATION_EXPLANATION', 'FINANCIAL_SIMULATION_RESULT'],
    PresentationSnapshotRevoked: ['PRESENTATION_SNAPSHOT', 'PRESENTATION_STEP_ASSET'],
    ShareGrantRevoked: ['SHARE_RESOURCE']
  });
  /** affected types of an event; the event's new versions let entries depending on the OLD versions be found by fingerprint/version */
  function affectedBy(event) {
    if (!event || !InvalidationEvent[event.eventType]) throw new CacheError('UNKNOWN_EVENT', `evento de invalidação desconhecido: ${event && event.eventType}`);
    if (!event.organizationId) throw new CacheError('TENANT_REQUIRED', 'evento sem organizationId');
    return [...new Set([...(DEPENDENCY_INDEX[event.eventType] || []), ...(event.affectedResourceTypes || [])])];
  }
  /** structured selector match (never substring of a serialized key) */
  function matchesSelector(entry, sel) {
    const r = entry.key.resource, p = entry.key.partition;
    if (sel.organizationId !== r.organizationId) return false;
    if (sel.developmentId && r.developmentId !== sel.developmentId) return false;
    if (sel.resourceTypes && !sel.resourceTypes.includes(r.type)) return false;
    if (sel.resourceIds && !sel.resourceIds.includes(r.resourceId)) return false;
    if (sel.principalId && p.principalId !== sel.principalId) return false;
    if (sel.principalScopes && !sel.principalScopes.includes(p.principalScope)) return false;
    if (sel.dependencyFingerprint && entry.dependencyFingerprint !== sel.dependencyFingerprint) return false;
    if (sel.olderThanVersion && !(r.version != null && String(r.version) < String(sel.olderThanVersion))) return false;
    if (sel.securityClasses && !sel.securityClasses.includes(entry.securityClass)) return false;
    return true;
  }

  // ---------------------------------------------------------------- compatibility / schema / negative caching
  function validateCompatibility(key, entry, expected = {}) {
    if (!entry) return { status: 'UNKNOWN' };
    if (serializePartitionSafe(entry.key.partition) !== serializePartitionSafe(key.partition)) return { status: 'SECURITY_SCOPE_MISMATCH' };
    if (String(entry.key.representationSchemaVersion) !== String(key.representationSchemaVersion)) return { status: 'SCHEMA_MISMATCH' };
    if (key.resource.version != null && String(entry.resourceVersion || entry.key.resource.version) !== String(key.resource.version)) return { status: 'VERSION_MISMATCH' };
    if (expected.dependencyFingerprint && entry.dependencyFingerprint && expected.dependencyFingerprint !== entry.dependencyFingerprint) return { status: 'DEPENDENCY_MISMATCH' };
    const c = RS.validateCompatibility(key.resource.type, (entry.metadata && entry.metadata.builtAgainst) || {}, expected.versions || {});
    if (c.status === 'VERSION_MISMATCH') return { status: 'DEPENDENCY_MISMATCH', mismatches: c.mismatches };
    return { status: 'COMPATIBLE' };
  }
  const serializePartitionSafe = p => PARTITION_FIELDS.map(f => (p && p[f] != null ? String(p[f]) : '~')).join('|');
  /** CacheSchemaMigrationRegistry: pure migrations; anything not registered (or throwing) → invalidate (the cache is disposable) */
  function SchemaMigrationRegistry() {
    const m = new Map();
    const register = mig => { if (!mig || typeof mig.migrate !== 'function') throw new CacheError('INVALID_MIGRATION', 'migração inválida'); m.set(`${mig.resourceType}|${mig.fromSchemaVersion}|${mig.toSchemaVersion}`, mig); };
    function migrate(entry, toVersion) {
      const from = String(entry.key.representationSchemaVersion); if (from === String(toVersion)) return { action: 'KEEP', entry };
      const mig = m.get(`${entry.key.resource.type}|${from}|${toVersion}`); if (!mig) return { action: 'INVALIDATE', reason: 'NO_MIGRATION' };
      try { const value = mig.migrate(JSON.parse(JSON.stringify(entry.value))); if (value === undefined) return { action: 'INVALIDATE', reason: 'MIGRATION_EMPTY' };
        return { action: 'MIGRATED', entry: { ...entry, value, key: { ...entry.key, representationSchemaVersion: String(toVersion) }, checksum: undefined } }; }
      catch (e) { return { action: 'INVALIDATE', reason: 'MIGRATION_FAILED' }; }
    }
    /** schema versions an entry of `type` may be migrated FROM into `toVersion` (used to find the old-schema copy of a key) */
    const sourcesFor = (type, toVersion) => [...m.values()].filter(x => x.resourceType === type && String(x.toSchemaVersion) === String(toVersion)).map(x => String(x.fromSchemaVersion));
    return { register, migrate, sourcesFor, size: () => m.size };
  }
  /** NegativeCachePolicy: only a 404 of an immutable artifact, briefly; 403/401/5xx are never cached (security 403 never becomes a global 404) */
  const NegativeCachePolicy = Object.freeze({ cache404ForImmutableMs: 30e3, never: [401, 403, 500, 502, 503, 504] });
  const negativeTtl = (status, policy) => (status === 404 && policy.strategy === 'IMMUTABLE_VERSIONED' ? NegativeCachePolicy.cache404ForImmutableMs : 0);

  // ---------------------------------------------------------------- eviction
  const RETENTION_WEIGHT = { NEVER_PERSIST: 0, SESSION_ONLY: 1, REGENERABLE: 2, SHORT_LIVED: 3, LONG_LIVED_VERSIONED: 6 };
  /** evictionCandidates(entries, { now, isCurrent(entry), activeKeys:Set }) → ordered (first = evict first): unused prefetch, old optional/high-res,
      regenerable, old non-current versions; current essential and active entries are protected. Scores are computed, never persisted. */
  function evictionCandidates(entries, { now = Date.now(), isCurrent = () => true, activeKeys = new Set(), serialize = serializeCacheKey } = {}) {
    const out = [];
    for (const e of entries) {
      const k = serialize(e.key); if (activeKeys.has(k) || e.pinned) continue;
      const pol = getPolicy(e.key.resource.type), current = isCurrent(e);
      const ageH = (now - Date.parse(e.lastAccessedAt || e.fetchedAt || e.createdAt || new Date(now).toISOString())) / H;
      let score = 10 - (RETENTION_WEIGHT[pol.retentionClass] || 0) + Math.min(ageH / 24, 5) + (e.sizeBytes || 0) / 5e6;
      if (e.origin === 'PREFETCH' && !e.usedAt) score += 6;
      if (pol.evictionPriority === 'HIGH') score += 3; else if (pol.evictionPriority === 'LOW') score -= 3;
      if (!current) score += 4; else if (pol.retentionClass === 'LONG_LIVED_VERSIONED') score -= 20; // current geometry / index: last resort
      out.push({ key: e.key, serialized: k, sizeBytes: e.sizeBytes || 0, lastAccessedAt: e.lastAccessedAt, retentionClass: pol.retentionClass, isCurrentVersion: current, regenerable: pol.retentionClass === 'REGENERABLE', evictionScore: Math.round(score * 100) / 100 });
    }
    return out.sort((a, b) => b.evictionScore - a.evictionScore);
  }
  const DEFAULT_BUDGET = Object.freeze({ maxTotalBytes: 50e6, maxBytesByResourceType: { BASE_MAP_HIGH: 8e6, GALLERY_IMAGE: 10e6, TECHNICAL_ANALYSIS_INPUT: 2e6 }, targetHighWatermarkRatio: 0.9, targetLowWatermarkRatio: 0.7 });
  /** approximate size (diagnostics only; Blobs/ArrayBuffers exact) */
  function sizeOf(v) {
    if (v == null) return 0;
    if (typeof v === 'string') return v.length * 2;
    if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return v.byteLength;
    if (v && typeof v.byteLength === 'number') return v.byteLength;
    if (v && typeof v.size === 'number' && typeof v.slice === 'function') return v.size;
    try { return JSON.stringify(v).length * 2; } catch (e) { return 0; }
  }

  // ---------------------------------------------------------------- manifests
  /** ResourceVersionManifest from the published manifest.json (pointers per development) */
  function resourceVersionManifest(m, organizationId) {
    if (!m || !m.developmentId) return null;
    const body = { organizationId, developmentId: m.developmentId, manifestRevision: hash(canonical({ s: m.staticVersion, a: m.analysisVersion, p: m.priceTableVersion, c: m.commercialRevision, v: m.availabilityRevision, cs: m.checksums })),
      developmentConfigVersion: m.appVersion || undefined, geometryVersion: m.staticVersion || undefined, analysisVersion: m.analysisVersion || undefined, currentPriceTableVersion: m.priceTableVersion || undefined,
      commercialRevision: m.commercialRevision == null ? undefined : String(m.commercialRevision), availabilityRevision: m.availabilityRevision == null ? undefined : String(m.availabilityRevision), updatedAt: m.generatedAt || null };
    return Object.freeze({ ...body, checksum: fingerprintOf(body) });
  }
  /** diff of two version manifests → invalidation events (selective; the artifacts of the old versions stay for history/deep links) */
  function versionEvents(prev, next, occurredAt = new Date().toISOString()) {
    if (!next) return [];
    const ev = (eventType, field, reasonCode) => ({ eventType, organizationId: next.organizationId, developmentId: next.developmentId, affectedResourceTypes: [], newVersionRefs: { [field]: next[field] }, previousVersionRefs: { [field]: prev ? prev[field] : null }, occurredAt, reasonCode });
    const out = []; const ch = f => !prev || prev[f] !== next[f];
    if (prev && ch('geometryVersion')) out.push(ev('GeometryVersionPublished', 'geometryVersion', 'MANIFEST_POINTER_MOVED'));
    if (prev && ch('analysisVersion')) out.push(ev('AnalysisVersionActivated', 'analysisVersion', 'MANIFEST_POINTER_MOVED'));
    if (prev && (ch('currentPriceTableVersion') || ch('commercialRevision'))) out.push(ev('PriceTableActivated', 'currentPriceTableVersion', 'MANIFEST_POINTER_MOVED'));
    if (prev && ch('availabilityRevision')) out.push(ev('AvailabilityRevisionPublished', 'availabilityRevision', 'MANIFEST_POINTER_MOVED'));
    return out;
  }
  /** CacheManifest (local storage metadata) — distinct from the ResourceVersionManifest */
  function cacheManifest(entries, { organizationId, lastMaintenanceAt = null, lastQuotaEstimate = null } = {}) {
    const by = {};
    for (const e of entries) { if (organizationId && e.key.resource.organizationId !== organizationId) continue; const t = e.key.resource.type, b = by[t] || (by[t] = { count: 0, bytes: 0, versions: [] }); b.count++; b.bytes += e.sizeBytes || 0; const v = e.resourceVersion || e.key.resource.version; if (v && !b.versions.includes(v)) b.versions.push(v); }
    return { kind: 'cache-manifest-local', cacheSchemaVersion: CACHE_SCHEMA_VERSION, organizationId: organizationId || null, entriesByResourceType: by, lastMaintenanceAt, lastQuotaEstimate };
  }

  // ---------------------------------------------------------------- taxonomy + legacy inventory (what exists today)
  /** CacheTaxonomy: every physical cache of the published page, what it holds, its key, version, freshness and invalidation. */
  const CacheTaxonomy = Object.freeze([
    { id: 'L0-memo', layer: 'L0', store: 'memória (seletores, view models, fingerprints)', holds: 'resultados derivados puros', key: 'fingerprint do input', version: 'input', freshness: 'n/a', invalidation: 'input muda', security: 'PUBLIC_SAFE', persistent: false },
    { id: 'L1-lifecycle', layer: 'L1', store: 'lifecycle.DataCache (memória)', holds: 'snapshots estático/análise/comercial/disponibilidade', key: 'camada:empreendimento:versão', version: 'staticDataVersion | analysisVersion | priceTableVersion | revision', freshness: 'FreshnessPolicy (domínio)', invalidation: 'por domínio e empreendimento (seletivo)', security: 'PUBLIC_SAFE', persistent: false },
    { id: 'L1-spatial', layer: 'L1', store: 'SpatialRepository / AssetRepository (memória)', holds: 'routes.json, img_list.json', key: 'empreendimento', version: 'nenhuma (arquivo publicado)', freshness: 'sessão', invalidation: 'recarregar a página', security: 'PUBLIC_SAFE', persistent: false },
    { id: 'L1-tech', layer: 'L1', store: 'app.js techAnalysis (memória)', holds: 'analysis-input.json + análise reexecutada', key: 'sessão (sem versão)', version: 'inputVersion do documento', freshness: 'sessão', invalidation: 'recarregar a página', security: 'PUBLIC_SAFE', persistent: false },
    { id: 'L1-customer', layer: 'L1', store: 'customer/journey (memória)', holds: 'clientes, jornada', key: 'organização + usuário', version: '—', freshness: '—', invalidation: 'troca de organização / fechar aba', security: 'CUSTOMER_SENSITIVE', persistent: false },
    { id: 'L2-ws-cache', layer: 'L2', store: 'IndexedDB ws-cache v1 (offline.js)', holds: 'staticLots/analysisLots por versão; dynamicLots (último estado comercial + disponibilidade); metadata (ponteiros, checksum); assetsMetadata; syncState', key: '[developmentId, version, lotId] / developmentId:*', version: 'staticVersion, analysisVersion (atual + anterior)', freshness: 'dinâmico lido do cache = STALE até a fonte confirmar', invalidation: 'checksum/versão do manifest; troca atômica; "Limpar dados locais"', security: 'PUBLIC_SAFE', persistent: true },
    { id: 'L2-favorites', layer: 'L2', store: 'IndexedDB/localStorage de favoritos (tópico 38)', holds: 'favoritos do aparelho (dado do usuário, não cache)', key: 'organização + aparelho', version: 'schema', freshness: '—', invalidation: 'serviço de favoritos', security: 'AUTHENTICATED', persistent: true },
    { id: 'L3-http', layer: 'L3', store: 'cache HTTP do navegador', holds: 'fontes Google; nada de JSON (fetch com cache: no-store)', key: 'URL', version: 'URL', freshness: 'cabeçalhos do servidor (no-cache no host local)', invalidation: 'servidor', security: 'PUBLIC_SAFE', persistent: true },
    { id: 'L4-assets', layer: 'L4', store: 'Cache Storage ws:<dev>:assets (AssetCache)', holds: 'planta.webp, aerea.webp', key: 'caminho?v=<checksum do manifest>', version: 'checksum', freshness: 'imutável por checksum', invalidation: 'checksum novo remove o antigo do mesmo caminho', security: 'PUBLIC_SAFE', persistent: true },
    { id: 'L4-shell', layer: 'L4', store: 'Cache Storage ws-shell-<versão> (sw.js)', holds: 'index.html, logo.png', key: 'escopo / URL', version: 'hash do build', freshness: 'navegação rede primeiro; cópia só offline', invalidation: 'activate apaga shells antigos', security: 'PUBLIC_SAFE', persistent: true },
    { id: 'L4-runtime', layer: 'L4', store: 'Cache Storage ws-runtime-v1 (sw.js)', holds: 'routes.json, img_list.json, fotos img/*', key: 'URL', version: 'nenhuma (risco: arquivo trocado com o mesmo nome)', freshness: 'JSON rede primeiro; fotos cache primeiro', invalidation: 'nenhuma automática (pendente: versão por checksum)', security: 'PUBLIC_SAFE', persistent: true },
    { id: 'prefs', layer: 'prefs', store: 'localStorage ws:org:<org>:dev:<dev>:state, vj-device-id', holds: 'preferências de interface e id pseudônimo do aparelho (não é cache de dados)', key: 'organização + empreendimento', version: 'schema do estado', freshness: '—', invalidation: 'sanitize na carga', security: 'AUTHENTICATED', persistent: true }
  ]);
  /** never cached anywhere (enforced by sw.js rules and by the policies): */
  const NEVER_CACHED = Object.freeze(['commercial.json no Cache Storage (preço: rede primeiro, cópia só no IndexedDB com rótulo)', 'manifest.json no Cache Storage', 'espelho de disponibilidade no Cache Storage', 'qualquer /api/ (backend)', 'respostas com Authorization ou Cache-Control: no-store', 'dados de cliente/jornada/compartilhamento em storage persistente', 'tokens e segredos']);
  const LegacyCacheInventory = Object.freeze([
    { location: 'data/offline.js IndexedDB ws-cache', mechanism: 'INDEXED_DB', resourceType: 'GEOMETRY_BUNDLE', tenantAware: false, userAware: false, versionAware: true, freshnessAware: true, storesSensitiveData: false, invalidationStrategy: 'VERSION', migrationAction: 'PARTITION', severity: 'MEDIUM', notes: 'chaves por developmentId sem organizationId; hoje um tenant (house7). Partição por organização exige migração v2 do banco (adiada, documentada).' },
    { location: 'data/offline.js dynamicLots', mechanism: 'INDEXED_DB', resourceType: 'PRICING_SNAPSHOT', tenantAware: false, userAware: false, versionAware: true, freshnessAware: true, storesSensitiveData: false, invalidationStrategy: 'VERSION', migrationAction: 'KEEP', severity: 'LOW', notes: 'último estado conhecido; lido sempre como CACHE/STALE (nunca FRESH sem a fonte).' },
    { location: 'data/offline.js AssetCache', mechanism: 'CACHE_STORAGE', resourceType: 'BASE_MAP_MEDIUM', tenantAware: false, userAware: false, versionAware: true, freshnessAware: true, storesSensitiveData: false, invalidationStrategy: 'VERSION', migrationAction: 'KEEP', severity: 'LOW', notes: 'checksum na chave; agora com dedup em voo (antes 3 downloads simultâneos da planta).' },
    { location: 'sw.js ws-runtime-v1 (img/, routes.json, img_list.json)', mechanism: 'CACHE_STORAGE', resourceType: 'GALLERY_IMAGE', tenantAware: false, userAware: false, versionAware: false, freshnessAware: false, storesSensitiveData: false, invalidationStrategy: 'NONE', migrationAction: 'ADD_VERSION', severity: 'MEDIUM', notes: 'fotos cache-primeiro por URL sem versão: foto substituída com o mesmo nome fica antiga. Proposta: ?v=<checksum> do manifest (integrador/app.js).' },
    { location: 'data/lifecycle.js DataCache', mechanism: 'MEMORY', resourceType: 'GEOMETRY_BUNDLE', tenantAware: false, userAware: false, versionAware: true, freshnessAware: false, storesSensitiveData: false, invalidationStrategy: 'VERSION', migrationAction: 'KEEP', severity: 'LOW', notes: 'invalidação agora por campos (não por prefixo de string).' },
    { location: 'presentation/app.js techAnalysis', mechanism: 'MEMORY', resourceType: 'TECHNICAL_ANALYSIS_INPUT', tenantAware: false, userAware: false, versionAware: false, freshnessAware: false, storesSensitiveData: false, invalidationStrategy: 'NONE', migrationAction: 'ADD_VERSION', severity: 'LOW', notes: 'memo da sessão sem chave versionada; receita: coordenador + CacheManager por checksum.' },
    { location: 'state/store.js localStorage ws:org:*:state', mechanism: 'LOCAL_STORAGE', resourceType: undefined, tenantAware: true, userAware: false, versionAware: true, freshnessAware: false, storesSensitiveData: false, invalidationStrategy: 'MANUAL', migrationAction: 'KEEP', severity: 'LOW', notes: 'preferências (não é cache de dados); nomes de clientes legados já migrados/removidos (tópico 39).' },
    { location: 'presentation/app.js localStorage vj-device-id', mechanism: 'LOCAL_STORAGE', resourceType: undefined, tenantAware: false, userAware: false, versionAware: false, freshnessAware: false, storesSensitiveData: false, invalidationStrategy: 'NONE', migrationAction: 'REVIEW', severity: 'LOW', notes: 'id pseudônimo do aparelho; nunca usado como autorização.' },
    { location: 'customer/*, journey/*', mechanism: 'MEMORY', resourceType: 'CUSTOMER_SUMMARY', tenantAware: true, userAware: true, versionAware: false, freshnessAware: false, storesSensitiveData: true, invalidationStrategy: 'MANUAL', migrationAction: 'KEEP', severity: 'LOW', notes: 'memória apenas (nunca localStorage/IndexedDB): conforme.' }
  ]);

  return Object.freeze({ CacheStrategy, CacheFreshness, RetentionClass, PrincipalScope, LookupStatus, StorageClass, Compatibility, EntryOrigin, ActionIntent, InvalidationEvent, CACHE_SCHEMA_VERSION, CacheError,
    canonical, hash, fingerprintOf, PARTITION_FIELDS, makePartition, sharePartitionRef, makeCacheKey, serializeCacheKey, queryFingerprint,
    securityClassOf, POLICIES, getPolicy, validateRegistry, stamp, evaluateFreshness, lookupStatusOf, readDecision, LABELS, useDecision, availabilityDisplay, priceDisplay,
    dependencyFingerprint, DEPENDENCY_INDEX, affectedBy, matchesSelector, validateCompatibility, SchemaMigrationRegistry, NegativeCachePolicy, negativeTtl,
    evictionCandidates, DEFAULT_BUDGET, sizeOf, resourceVersionManifest, versionEvents, cacheManifest, CacheTaxonomy, NEVER_CACHED, LegacyCacheInventory });
})();
