/* pwa/swRouting.js — topic 49: ServiceWorkerRequestClassifier + runtime policy resolver (pure; no DOM, no storage, no network).
   ONE file, three consumers, so the worker and the app can never disagree:
     - the Service Worker (scripts/pwaBuild.js inlines this file into sw.js);
     - the app (App.pwa.routing, for diagnostics and tests);
     - Node (module.exports, for the build and the tests).
   The routing table itself is not written here: it is the projection of the cache policy registry (topic 48) produced by
   scripts/cacheRules.js and injected at build time. This file only interprets it.

   Request classes (§193): NAVIGATION · STATIC_ASSET · VERSIONED_DATA · DYNAMIC_DATA · SENSITIVE_DATA · MUTATION · SHARE · AUTH.
   Safety rules that hold for any table:
     - only same-origin GET is ever answered by the worker (mutations, HEAD probes and other origins go straight to the network);
     - Authorization / auth paths / /api/ / Cache-Control:no-store requests are never stored nor answered from a cache;
     - an API or asset request never receives HTML (no app-shell fallback, §196/§197/§316);
     - share routes (/s/<token>) never receive the internal app shell, online or offline (§199);
     - only the app-shell navigation (scope root / index.html) may fall back to the cached shell; other in-scope navigations get
       the static offline page. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.pwa = App.pwa || {}; App.pwa.routing = api; }
  else if (root && typeof module === 'undefined') root.WS_ROUTING = api; // inside the Service Worker
})(typeof self !== 'undefined' ? self : this, function () {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const RequestClass = E('NAVIGATION', 'STATIC_ASSET', 'VERSIONED_DATA', 'DYNAMIC_DATA', 'SENSITIVE_DATA', 'MUTATION', 'SHARE', 'AUTH');
  const SwStrategy = E('PRECACHE', 'CACHE_FIRST', 'NETWORK_FIRST', 'STALE_WHILE_REVALIDATE', 'NETWORK_ONLY', 'NO_STORE');
  /** where a request may be answered from when the network fails */
  const OfflineSource = E('SHELL', 'OFFLINE_PAGE', 'SHARE_OFFLINE_PAGE', 'PACK', 'RUNTIME_THEN_PACK', 'DATA_LAYER', 'NONE');
  /** physical caches. The worker owns ws-shell-*, ws-img-* and ws-runtime-v2; the app owns ws-pack:* (offline packs), ws-pack-index and
      ws:<dev>:assets (AssetCache). The worker READS packs (exact version only) and never deletes app-owned caches or IndexedDB. */
  const CACHE = Object.freeze({ shellPrefix: 'ws-shell-', imgPrefix: 'ws-img-', runtime: 'ws-runtime-v2', legacy: Object.freeze(['ws-runtime-v1']),
    packPrefix: 'ws-pack:', packIndex: 'ws-pack-index', appAssets: /^ws:[^:]+:assets$/ });
  const PACK_INDEX_KEY = '__pack__/index.json';
  const packEntryKey = (path, checksum) => `__pack__/${String(path).replace(/^\.?\//, '')}?v=${checksum}`;
  const SHARE_PATH = /(^|\/)s\/[A-Za-z0-9_-]{8,}\/?$/;
  const AUTH_PATH = /(^|\/)(auth|oauth|login|logout|session|token)(\/|$)/i;
  const API_PATH = /(^|\/)api\//i;
  const SHELL_ROUTES = new Set(['', 'index.html']);
  /** response content types the worker accepts per class (a cached response must look like what was asked, §203/§204) */
  const EXPECTED_TYPE = { SHELL: /text\/html/i, JSON: /(application|text)\/(json|[a-z.+-]*\+json)/i, IMAGE: /^image\//i, PAGE: /text\/html/i, SCRIPT: /(java|ecma)script/i, STYLE: /text\/css/i }; // SCRIPT/STYLE: round 6 code chunks

  /** compile(rules) → rules with RegExp objects. rules come from scripts/cacheRules.js (the cache policy projection). */
  function compile(rules) {
    return (rules || []).map(r => Object.freeze({ ...r, re: new RegExp(r.test, 'i'), keepRe: r.keep ? new RegExp(r.keep, 'i') : null }));
  }
  /** pathname relative to the worker scope ('' for the scope root); null when outside the scope */
  function relPath(pathname, scopePath) {
    const s = scopePath || '/';
    if (!pathname.startsWith(s)) return pathname === s.replace(/\/$/, '') ? '' : null;
    return decodeURIComponent(pathname.slice(s.length));
  }

  /** classify(req, ctx) → RouteDecision
      req: { method, url, mode, destination?, hasAuthorization?, cacheMode?, sameOrigin }
      ctx: { scopePath, rules (compiled), precache: Set<relative path> }
      RouteDecision: { klass, handle, strategy, offline, store, ruleId, resourceType, versionRequired, expect, reason } */
  function classify(req, ctx = {}) {
    const u = new URL(req.url), method = String(req.method || 'GET').toUpperCase();
    const D = (klass, o = {}) => Object.freeze({ klass, handle: false, strategy: SwStrategy.NETWORK_ONLY, offline: OfflineSource.NONE, store: null, ruleId: null, resourceType: null,
      versionRequired: false, expect: null, reason: null, rel: null, ...o });
    if (!req.sameOrigin) return D(RequestClass.STATIC_ASSET, { reason: 'CROSS_ORIGIN' }); // opaque third-party responses are never cached (§205)
    if (method !== 'GET' && method !== 'HEAD') return D(RequestClass.MUTATION, { strategy: SwStrategy.NO_STORE, reason: 'MUTATION_NEVER_CACHED' }); // §201: no generic POST queue
    const rel = relPath(u.pathname, ctx.scopePath);
    if (req.hasAuthorization || AUTH_PATH.test(u.pathname)) return D(RequestClass.AUTH, { strategy: SwStrategy.NO_STORE, reason: 'AUTH_NEVER_CACHED', rel });
    if (SHARE_PATH.test(u.pathname)) {
      // share runtime: grant/session validated online; offline → a neutral page, never the internal app (§199, §268)
      return req.mode === 'navigate' ? D(RequestClass.SHARE, { handle: true, offline: OfflineSource.SHARE_OFFLINE_PAGE, reason: 'SHARE_ONLINE_REQUIRED', rel })
        : D(RequestClass.SHARE, { strategy: SwStrategy.NO_STORE, reason: 'SHARE_ONLINE_REQUIRED', rel });
    }
    if (API_PATH.test(u.pathname)) return D(RequestClass.SENSITIVE_DATA, { strategy: SwStrategy.NO_STORE, reason: 'API_NETWORK_ONLY', rel });
    if (method === 'HEAD') return D(RequestClass.DYNAMIC_DATA, { reason: 'HEAD_PROBE', rel }); // connectivity probes always reach the network
    if (req.mode === 'navigate') {
      if (rel != null && SHELL_ROUTES.has(rel)) return D(RequestClass.NAVIGATION, { handle: true, strategy: SwStrategy.NETWORK_FIRST, offline: OfflineSource.SHELL, store: 'SHELL', expect: 'SHELL', reason: 'APP_SHELL_ROUTE', rel });
      return D(RequestClass.NAVIGATION, { handle: rel != null, offline: OfflineSource.OFFLINE_PAGE, reason: 'NON_SHELL_ROUTE', rel });
    }
    if (req.cacheMode === 'no-store') return D(RequestClass.DYNAMIC_DATA, { strategy: SwStrategy.NO_STORE, reason: 'NO_STORE_REQUEST', rel });
    if (rel != null && ctx.precache && ctx.precache.has(rel)) return D(RequestClass.STATIC_ASSET, { handle: true, strategy: SwStrategy.PRECACHE, offline: OfflineSource.NONE, store: null, reason: 'PRECACHED', rel });
    const rule = (ctx.rules || []).find(r => r.re.test(u.pathname));
    if (!rule) return D(RequestClass.STATIC_ASSET, { reason: 'NO_RULE', rel }); // deny by default: the worker stays out of the way
    const base = { ruleId: rule.id, resourceType: rule.resourceType || null, versionRequired: !!rule.versionRequired, rel };
    const klass = rule.klass || RequestClass.DYNAMIC_DATA;
    if (rule.strategy === 'BYPASS') return D(klass, { ...base, strategy: SwStrategy.NO_STORE, reason: 'RULE_BYPASS' });
    const offline = rule.offline || OfflineSource.NONE;
    if (rule.strategy === 'CACHE_FIRST') {
      const keep = !!(rule.keepRe && rule.keepRe.test(u.pathname));
      return D(klass, { ...base, handle: true, strategy: SwStrategy.CACHE_FIRST, offline, store: keep ? 'IMG' : null, expect: 'IMAGE', reason: 'RULE_CACHE_FIRST' });
    }
    if (rule.strategy === 'NETWORK_FIRST') return D(klass, { ...base, handle: true, strategy: SwStrategy.NETWORK_FIRST, offline, store: 'RUNTIME', expect: 'JSON', reason: 'RULE_NETWORK_FIRST' });
    // NETWORK_ONLY: the worker only answers when an exact-version offline-pack copy may stand in for a failed request
    if (offline === OfflineSource.PACK) return D(klass, { ...base, handle: true, strategy: SwStrategy.NETWORK_ONLY, offline, expect: 'JSON', reason: 'RULE_NETWORK_ONLY_PACK_FALLBACK' });
    return D(klass, { ...base, strategy: SwStrategy.NETWORK_ONLY, offline, reason: 'RULE_NETWORK_ONLY' });
  }

  /** storable(response, decision): status 200, same-origin basic, no no-store/private, no Set-Cookie, content type as expected (§192, §203, §204) */
  function storable(res, expect) {
    if (!res || res.status !== 200 || !res.ok || (res.type && res.type !== 'basic' && res.type !== 'default')) return false;
    const h = res.headers;
    if (/no-store|private/i.test(h.get('cache-control') || '')) return false;
    if (h.get('set-cookie')) return false;
    if (expect && EXPECTED_TYPE[expect] && !EXPECTED_TYPE[expect].test(h.get('content-type') || '')) return false;
    return true;
  }

  /** pickPackEntry(index, rel, { versionRequired, expectedChecksum }) → { packId, cacheName, key, checksum } | null.
      Only PUBLIC_SAFE resources of READY/STALE packs; with versionRequired, only the exact checksum the build expects. */
  function pickPackEntry(index, rel, o = {}) {
    if (!index || !index.packs || rel == null) return null;
    for (const p of Object.values(index.packs)) {
      if (!p || !['READY', 'PARTIAL', 'STALE', 'UPDATE_AVAILABLE'].includes(p.state)) continue;
      const r = p.resources && p.resources[rel];
      if (!r || r.securityClass !== 'PUBLIC_SAFE' || !r.checksum) continue;
      if (o.versionRequired && o.expectedChecksum && r.checksum !== o.expectedChecksum) continue;
      return { packId: p.packId, cacheName: p.cacheName, key: packEntryKey(rel, r.checksum), checksum: r.checksum };
    }
    return null;
  }

  /** caches the worker may delete on activate: older shells, older image versions and the unversioned legacy runtime cache.
      Never: offline packs, the pack index, the app's asset cache (data versions are independent of the app shell, §35/§36/§211). */
  function obsoleteCaches(keys, current) {
    return keys.filter(k => (k.startsWith(CACHE.shellPrefix) && k !== current.shell) || (k.startsWith(CACHE.imgPrefix) && k !== current.img) || CACHE.legacy.includes(k));
  }
  /** is this a cache the worker must never touch? */
  const appOwned = k => k.startsWith(CACHE.packPrefix) || k === CACHE.packIndex || CACHE.appAssets.test(k);

  /** offline page text variants (pt-BR, no technical terms, §221) */
  const OFFLINE_TEXT = Object.freeze({
    OFFLINE_PAGE: { title: 'Você está offline', body: 'Este conteúdo não está disponível offline. Conecte-se para carregar.' },
    SHARE_OFFLINE_PAGE: { title: 'Link compartilhado indisponível offline', body: 'Links compartilhados precisam de conexão para confirmar o acesso. Conecte-se e abra o link novamente.' }
  });

  return Object.freeze({ RequestClass, SwStrategy, OfflineSource, CACHE, PACK_INDEX_KEY, packEntryKey, SHARE_PATH, AUTH_PATH, API_PATH, EXPECTED_TYPE, compile, relPath, classify, storable,
    pickPackEntry, obsoleteCaches, appOwned, OFFLINE_TEXT });
});
