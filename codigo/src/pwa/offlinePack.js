/* pwa/offlinePack.js — topic 49 §50–§86, §132–§182, §272–§295, §360, §366–§367, §374: Offline Pack.
   An Offline Pack is an EXPLICIT, versioned set of resources for one development ("Disponibilizar Viva Juara offline"), never the
   whole site and never prepared automatically for every development (§52, §57). Installing the PWA ≠ a development available offline (§178).
   Pipeline (§61): resolve definition → validate permissions → estimate size → check quota BEFORE downloading (§59, §60) → resolve EXACT
   versions from the published manifest (never "current", §62) → download → validate checksums (sha-256/12, the build digest) → atomic
   commit of the pack index (one write) → READY. A failure at any step rolls the staging cache back; the old pack stays READY (§278, §367).
   Profiles (§71–§74): BASIC (geometry + medium base map + version pointers) · STANDARD (+ published price table as last-known, technical
   analysis input versioned by checksum, routes) · FULL_MAP (+ aerial high-res, gallery). High-res is opt-in (§70).
   Refresh (§132–§137, §366) downloads only what changed (delta by resource/checksum); unchanged entries are copied from the old pack.
   Security (§75–§86, §286–§295): only PUBLIC_SAFE resources (no customer, journey, share, auth, document bytes — §75, §167); pack class
   ORGANIZATION, visible only to its organization; logout/user switch/tenant switch/access revoked apply OfflinePackSecurityPolicy; offline
   use after login is bounded by OfflineAuthPolicy.maxOfflineSessionAgeMs (revocation is NOT instantaneous while fully offline, §292).
   Storage: Cache Storage (`ws-pack:<org>:<dev>:<tx>` entries `__pack__/<path>?v=<checksum>`, index `ws-pack-index`), read by the worker
   only for exact versions of PUBLIC_SAFE resources (pwa/swRouting.js). Availability is NEVER stored as current: no sales mirror exists, so the
   pack records availability as "não disponível" and every lot stays UNKNOWN (§64, §65). */
App.pwa = App.pwa || {};
App.pwa.pack = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const OfflinePackState = E('NOT_PREPARED', 'PREPARING', 'READY', 'PARTIAL', 'STALE', 'UPDATE_AVAILABLE', 'UPDATE_REQUIRED', 'ERROR', 'REMOVING');
  const TxStatus = E('DOWNLOADING', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTED', 'ROLLED_BACK', 'FAILED');
  const Profile = E('BASIC', 'STANDARD', 'FULL_MAP');
  const PACK_SCHEMA_VERSION = '1';
  const ROUTING = () => App.pwa.routing;
  const USABLE = new Set(['READY', 'PARTIAL', 'STALE', 'UPDATE_AVAILABLE']); // PARTIAL: usable for what is present, never shown as READY
  const MB = 1024 * 1024;

  /** profile → resources (asset key of dev.assets or a literal path), resource type, required */
  const PROFILE_RESOURCES = Object.freeze({
    BASIC: [['lots', 'GEOMETRY_BUNDLE', true], ['plan', 'BASE_MAP_MEDIUM', true]],
    STANDARD: [['commercial', 'PRICING_SNAPSHOT', true], ['analysis-input.json', 'TECHNICAL_ANALYSIS_INPUT', true], ['routes', 'MOBILITY_ROUTES', false]],
    FULL_MAP: [['aerial', 'BASE_MAP_HIGH', false], ['aerialWide', 'BASE_MAP_HIGH', false], ['images', 'GALLERY_INDEX', false], ['@gallery', 'GALLERY_IMAGE', false]]
  });
  const PROFILE_CHAIN = { BASIC: ['BASIC'], STANDARD: ['BASIC', 'STANDARD'], FULL_MAP: ['BASIC', 'STANDARD', 'FULL_MAP'] };
  const PROFILE_LABEL = { BASIC: 'Básico (mapa e lotes)', STANDARD: 'Padrão (mapa, tabela de preço e análise)', FULL_MAP: 'Completo (inclui imagens em alta resolução e galeria)' };

  const DEFAULT_SECURITY = Object.freeze({ allowOrganizationPackPersistenceAfterLogout: true, allowSensitiveResources: false, clearOnUserSwitch: false, requireReauthBeforeAccess: false });
  const DEFAULT_AUTH = Object.freeze({ allowPreviouslyAuthenticatedOfflineUse: true, maxOfflineSessionAgeMs: 7 * 24 * 3600e3, requireLocalUnlock: false,
    allowedFeatureCodes: Object.freeze(['APP_SHELL', 'MAP', 'LOT_SEARCH', 'LOT_QUICK_VIEW', 'ANALYSIS_LAYERS', 'TECHNICAL_EXPLANATION', 'AVAILABILITY', 'PRICING', 'PRICE_HISTORY', 'FINANCIAL_SIMULATION', 'COMPARISON', 'MOBILITY_ROUTES', 'AERIAL_VIEW', 'GALLERY', 'PRESENTATION_IN_PERSON']) });
  const DEFAULT_UPDATE = Object.freeze({ autoCheckOnAppStart: true, autoDownload: 'NEVER', maxAutomaticBytes: 2 * MB, requireUserConfirmationForLargeUpdate: true,
    refreshAvailabilityOnReconnect: true, refreshPricePointerOnReconnect: true, refreshAnalysisPointerOnReconnect: true, staleAfterMs: 7 * 24 * 3600e3 });
  /** expiration per resource class — no universal TTL (§283–§285). null = no age limit (the freshness label still applies). */
  const EXPIRATION = Object.freeze({ id: 'pack-expiration.default', GEOMETRY_BUNDLE: null, BASE_MAP_MEDIUM: null, BASE_MAP_HIGH: null, TECHNICAL_ANALYSIS_INPUT: null, MOBILITY_ROUTES: null,
    GALLERY_INDEX: null, GALLERY_IMAGE: null, PRICING_SNAPSHOT: null, AVAILABILITY_SNAPSHOT: null, note: 'limite de idade do preço/disponibilidade offline é decisão de negócio; sempre exibidos como última informação conhecida.' });

  class PackError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); } }
  const MESSAGES = {
    PERMISSION_DENIED: 'Você não tem permissão para preparar este empreendimento offline.', MANIFEST_UNAVAILABLE: 'Conecte-se para preparar o uso offline.',
    VERSION_UNRESOLVED: 'Não foi possível identificar a versão exata de todos os arquivos. Tente novamente mais tarde.', INSUFFICIENT_STORAGE: 'Espaço insuficiente no aparelho.',
    DOWNLOAD_FAILED: 'O download foi interrompido. O pacote anterior continua disponível.', CHECKSUM_MISMATCH: 'Um arquivo baixado não confere com a versão publicada. Nada foi alterado.',
    ABORTED: 'Preparação cancelada. Nada foi alterado.', SECURITY_CLASS_FORBIDDEN: 'Este conteúdo não pode ser guardado offline.', BUSY: 'Já existe uma preparação em andamento.',
    NOT_FOUND: 'Pacote offline não encontrado.', STORAGE_UNAVAILABLE: 'Este navegador não permite guardar o empreendimento offline.'
  };
  const fmtMB = b => b == null ? 'tamanho não disponível' : (b < MB ? '< 1 MB' : `${(b / MB).toFixed(b < 10 * MB ? 1 : 0).replace('.', ',')} MB`);
  const hhmm = iso => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  const dateTime = iso => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

  // ---------------------------------------------------------------- digest (same as scripts/build-data.js: sha-256, first 12 hex)
  async function sha12(bytes) {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) throw new PackError('STORAGE_UNAVAILABLE', 'crypto.subtle indisponível');
    const buf = await subtle.digest('SHA-256', bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  }
  const toU8 = b => b instanceof Uint8Array ? b : new Uint8Array(b);

  // ---------------------------------------------------------------- stores
  /** in-memory store (tests, browsers without Cache Storage: pack is then session-only and says so) */
  function MemoryPackStore() {
    const caches = new Map(); let index = null;
    const k = (path, cs) => ROUTING().packEntryKey(path, cs);
    return {
      kind: 'memory', persistent: false,
      async readIndex() { return index ? JSON.parse(JSON.stringify(index)) : null; },
      async writeIndex(doc) { index = JSON.parse(JSON.stringify(doc)); },
      async put(name, path, cs, bytes, contentType) { if (!caches.has(name)) caches.set(name, new Map()); caches.get(name).set(k(path, cs), { bytes: toU8(bytes).slice(), contentType }); },
      async get(name, path, cs) { const c = caches.get(name); const v = c && c.get(k(path, cs)); return v ? { bytes: v.bytes.slice(), contentType: v.contentType } : null; },
      async has(name, path, cs) { const c = caches.get(name); return !!(c && c.has(k(path, cs))); },
      async deleteCache(name) { return caches.delete(name); },
      async listCaches() { return [...caches.keys()]; },
      _caches: caches
    };
  }
  /** Cache Storage store (the worker reads the same caches) */
  function CacheStoragePackStore({ cachesApi = (typeof caches !== 'undefined' ? caches : null), base = (typeof location !== 'undefined' ? location.href : 'http://localhost/') } = {}) {
    if (!cachesApi) throw new PackError('STORAGE_UNAVAILABLE', MESSAGES.STORAGE_UNAVAILABLE);
    const abs = rel => new URL(rel, base).href, R = ROUTING();
    return {
      kind: 'cache-storage', persistent: true,
      async readIndex() { const c = await cachesApi.open(R.CACHE.packIndex); const r = await c.match(abs(R.PACK_INDEX_KEY)); return r ? r.json() : null; },
      async writeIndex(doc) { const c = await cachesApi.open(R.CACHE.packIndex); await c.put(abs(R.PACK_INDEX_KEY), new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } })); },
      async put(name, path, cs, bytes, contentType) { const c = await cachesApi.open(name); await c.put(abs(R.packEntryKey(path, cs)), new Response(toU8(bytes), { headers: { 'content-type': contentType || 'application/octet-stream', 'x-ws-checksum': cs } })); },
      async get(name, path, cs) { if (!(await cachesApi.has(name))) return null; const c = await cachesApi.open(name); const r = await c.match(abs(R.packEntryKey(path, cs))); return r ? { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') } : null; },
      async has(name, path, cs) { if (!(await cachesApi.has(name))) return false; const c = await cachesApi.open(name); return !!(await c.match(abs(R.packEntryKey(path, cs)))); },
      async deleteCache(name) { return cachesApi.delete(name); },
      async listCaches() { return (await cachesApi.keys()).filter(n => n.startsWith(R.CACHE.packPrefix)); }
    };
  }

  // ---------------------------------------------------------------- definition / versions
  const emptyIndex = () => ({ kind: 'offline-pack-index', schemaVersion: PACK_SCHEMA_VERSION, packs: {} });
  function validateManifest(m, dev) {
    if (!m || m.developmentId !== dev.id || !Array.isArray(m.assets) || !m.staticVersion || !m.analysisVersion) throw new PackError('VERSION_UNRESOLVED', MESSAGES.VERSION_UNRESOLVED, { detail: 'manifest inválido' });
    return m;
  }
  /** resolve the concrete resources of a profile from the published manifest (exact checksums; a missing checksum is never "current") */
  function resolveResources(profile, manifest, dev, o = {}) {
    if (!PROFILE_CHAIN[profile]) throw new PackError('VERSION_UNRESOLVED', 'perfil desconhecido: ' + profile);
    const C = App.cache && App.cache.core, byPath = new Map(manifest.assets.map(a => [a.path, a])), out = [];
    const rows = PROFILE_CHAIN[profile].flatMap(p => PROFILE_RESOURCES[p]);
    if (o.includeHighRes && profile !== 'FULL_MAP') rows.push(['aerial', 'BASE_MAP_HIGH', false], ['aerialWide', 'BASE_MAP_HIGH', false]);
    for (const [ref, type, required] of rows) {
      const paths = ref === '@gallery' ? manifest.assets.filter(a => /^img\//.test(a.path) && a.kind === 'image').map(a => a.path) : [dev.assets[ref] || ref];
      for (const path of paths) {
        const a = byPath.get(path);
        const sc = C ? C.securityClassOf(type) : 'PUBLIC_SAFE';
        if (sc !== 'PUBLIC_SAFE') throw new PackError('SECURITY_CLASS_FORBIDDEN', MESSAGES.SECURITY_CLASS_FORBIDDEN, { resourceType: type });
        if (!a || !a.checksum) { if (required) throw new PackError('VERSION_UNRESOLVED', MESSAGES.VERSION_UNRESOLVED, { path }); continue; }
        if (out.some(r => r.path === path)) continue;
        out.push(Object.freeze({ path, resourceType: type, checksum: a.checksum, bytes: a.bytes || null, securityClass: sc, required, kind: a.kind || (/\.json$/.test(path) ? 'data' : 'image') }));
      }
    }
    return out;
  }
  /** manifest revision: fingerprint of the concrete versions the pack was generated from */
  function manifestRevision(m) {
    const src = { s: m.staticVersion, a: m.analysisVersion, p: m.priceTableVersion, c: m.commercialRevision, av: m.availabilityRevision, cs: m.checksums, assets: (m.assets || []).map(x => [x.path, x.checksum]).sort() };
    return 'mr-' + (App.offline && App.offline.checksum ? App.offline.checksum(src) : String(JSON.stringify(src).length));
  }
  const packIdOf = (org, dev) => `pack:${org}:${dev}`;
  /** OfflinePackDefinition (§53) — resourceKeys carry concrete versions (topic 47 ResourceKey; a pointer word is rejected there) */
  function buildDefinition({ organizationId, developmentId, profile, resources, manifest, now = () => Date.now(), includeHighRes = false }) {
    const RS = App.loading && App.loading.resources;
    const resourceKeys = resources.map(r => { const k = { organizationId, developmentId, type: r.resourceType, resourceId: r.path, version: r.checksum }; return RS ? RS.makeKey(k) : Object.freeze(k); });
    return Object.freeze({ id: packIdOf(organizationId, developmentId), organizationId, developmentId, profile, includeHighRes: !!includeHighRes, resourceKeys, generatedFromManifestRevision: manifestRevision(manifest),
      securityClass: 'ORGANIZATION', createdAt: new Date(now()).toISOString(), estimatedBytes: resources.reduce((s, r) => s + (r.bytes || 0), 0), expirationPolicyRef: EXPIRATION.id, packSchemaVersion: PACK_SCHEMA_VERSION });
  }
  /** OfflinePackDiff (§134) between a committed record and the resources of a newer manifest */
  function diff(record, resources, manifest) {
    const old = record ? record.resources || {} : {}, next = new Map(resources.map(r => [r.path, r]));
    const added = [], changed = [], removed = [];
    for (const r of resources) { const o = old[r.path]; if (!o) added.push(r); else if (o.checksum !== r.checksum) changed.push(r); }
    for (const p of Object.keys(old)) if (!next.has(p)) removed.push({ path: p, ...old[p] });
    const v = (record && record.versions) || {};
    const key = r => ({ type: r.resourceType, resourceId: r.path, version: r.checksum });
    return Object.freeze({ packId: record ? record.packId : null, added: added.map(key), changed: changed.map(key), removed: removed.map(r => ({ type: r.resourceType, resourceId: r.path, version: r.checksum })),
      estimatedDownloadBytes: [...added, ...changed].reduce((s, r) => s + (r.bytes || 0), 0),
      availabilityRevisionChanged: (v.availabilityRevision == null ? null : String(v.availabilityRevision)) !== (manifest.availabilityRevision == null ? null : String(manifest.availabilityRevision)),
      pricingVersionChanged: String(v.priceTableVersion) !== String(manifest.priceTableVersion) || String(v.commercialRevision) !== String(manifest.commercialRevision),
      analysisVersionChanged: String(v.analysisVersion) !== String(manifest.analysisVersion) || changed.some(r => r.resourceType === 'TECHNICAL_ANALYSIS_INPUT'),
      geometryVersionChanged: String(v.staticVersion) !== String(manifest.staticVersion) || changed.some(r => r.resourceType === 'GEOMETRY_BUNDLE'),
      empty: !added.length && !changed.length && !removed.length });
  }

  // ---------------------------------------------------------------- manager
  function OfflinePackManager({ organizationId, developmentId, dev = null, store = null, fetchFn = null, quota = null, now = () => Date.now(), emit = null, security = {}, authPolicy = {}, updatePolicy = {},
    auth = null, digest = sha12, onCommitted = null, idGen = null, manifestUrl = null } = {}) {
    const D = dev || (App.repos && App.repos.DevelopmentRepository ? App.repos.DevelopmentRepository.getDevelopment(developmentId) : (App.config.DEVELOPMENTS || []).find(d => d.id === developmentId));
    if (!organizationId || !D) throw new PackError('PERMISSION_DENIED', 'organizationId e developmentId são obrigatórios');
    const SEC = { ...DEFAULT_SECURITY, ...security }, AUTH = { ...DEFAULT_AUTH, ...authPolicy }, UPD = { ...DEFAULT_UPDATE, ...updatePolicy };
    const S = store || (() => { try { return CacheStoragePackStore(); } catch (e) { return MemoryPackStore(); } })();
    const F = fetchFn || ((u, o) => fetch(u, o));
    const tel = (n, d) => { try { (emit || App.pwa.core.emit)(n, d); } catch (e) { /* telemetry */ } };
    const principal = () => { try { return (auth && auth()) || { organizationId, userId: 'local', authenticated: true, canPrepareOffline: true, lastValidatedAt: now() }; } catch (e) { return null; } };
    let seq = 0, busy = null;
    const txId = () => idGen ? idGen() : `t${now().toString(36)}${(++seq).toString(36)}`;
    const PACK_ID = packIdOf(organizationId, D.id);
    const cacheNameOf = tx => `${ROUTING().CACHE.packPrefix}${organizationId}:${D.id}:${tx}`;
    async function index() { const i = await S.readIndex(); return i && i.packs ? i : emptyIndex(); }
    /** atomic pointer change: read-modify-write of the single index document */
    async function commitIndex(fn) { const i = await index(); fn(i); i.updatedAt = new Date(now()).toISOString(); await S.writeIndex(i); return i; }
    async function fetchManifest(signal) {
      let r;
      try { r = await F(manifestUrl || D.assets.manifest, { cache: 'no-store', signal }); } catch (e) { throw new PackError(signal && signal.aborted ? 'ABORTED' : 'MANIFEST_UNAVAILABLE', MESSAGES[signal && signal.aborted ? 'ABORTED' : 'MANIFEST_UNAVAILABLE']); }
      if (!r || !r.ok) throw new PackError('MANIFEST_UNAVAILABLE', MESSAGES.MANIFEST_UNAVAILABLE);
      return validateManifest(await r.json(), D);
    }
    function checkPermission() {
      const p = principal();
      if (!p || p.organizationId !== organizationId || p.authenticated === false || p.canPrepareOffline === false) throw new PackError('PERMISSION_DENIED', MESSAGES.PERMISSION_DENIED);
      return p;
    }
    async function quotaCheck(bytes) {
      let q = null; try { q = quota ? await quota() : (App.offline && App.offline.storageEstimate ? await App.offline.storageEstimate() : null); } catch (e) { q = null; }
      const need = Math.round(bytes * 1.1) + MB; // margin for headers/metadata; the estimate is approximate (§182)
      if (q && q.quota > 0) { const free = Math.max(0, q.quota - (q.usage || 0)); if (free < need) throw new PackError('INSUFFICIENT_STORAGE', `${MESSAGES.INSUFFICIENT_STORAGE} São necessários cerca de ${fmtMB(need)} e há cerca de ${fmtMB(free)} livres (estimativa).`, { needBytes: need, freeBytes: free }); return { ...q, free, need }; }
      return { usage: null, quota: null, free: null, need, unknown: true };
    }
    async function download(r, signal) {
      let res;
      try { res = await F(r.path, { cache: 'no-store', signal }); } catch (e) { throw new PackError(signal && signal.aborted ? 'ABORTED' : 'DOWNLOAD_FAILED', MESSAGES[signal && signal.aborted ? 'ABORTED' : 'DOWNLOAD_FAILED'], { path: r.path }); }
      if (!res || !res.ok) throw new PackError('DOWNLOAD_FAILED', MESSAGES.DOWNLOAD_FAILED, { path: r.path, status: res && res.status });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const cs = await digest(bytes);
      if (cs !== r.checksum) throw new PackError('CHECKSUM_MISMATCH', MESSAGES.CHECKSUM_MISMATCH, { path: r.path });
      if (r.kind === 'data') { try { JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new PackError('CHECKSUM_MISMATCH', MESSAGES.CHECKSUM_MISMATCH, { path: r.path, detail: 'json' }); } }
      return { bytes, contentType: (res.headers && res.headers.get && res.headers.get('content-type')) || (r.kind === 'data' ? 'application/json' : 'application/octet-stream') };
    }
    function versionsOf(m) { return { staticVersion: m.staticVersion, analysisVersion: m.analysisVersion, priceTableVersion: m.priceTableVersion || null, commercialRevision: m.commercialRevision == null ? null : m.commercialRevision,
      availabilityRevision: m.availabilityRevision == null ? null : m.availabilityRevision, manifestRevision: manifestRevision(m), appVersion: m.appVersion || null }; }
    /** core transaction: stage (copy unchanged + download changed) → validate → commit → drop old cache. Old pack untouched on failure. */
    async function transact({ profile, includeHighRes, manifest, resources, previous, signal, reason }) {
      const tx = { transactionId: txId(), packId: PACK_ID, targetVersions: Object.fromEntries(resources.map(r => [r.path, r.checksum])), stagedResourceKeys: [], status: TxStatus.DOWNLOADING };
      const name = cacheNameOf(tx.transactionId);
      const old = previous && previous.resources || {};
      const t0 = now();
      let downloaded = 0; const skipped = [];
      try {
        for (const r of resources) {
          if (signal && signal.aborted) throw new PackError('ABORTED', MESSAGES.ABORTED);
          const prev = old[r.path];
          let got = null;
          if (prev && prev.checksum === r.checksum && previous.cacheName) got = await S.get(previous.cacheName, r.path, r.checksum); // delta: reuse unchanged entries
          if (got) { const cs = await digest(got.bytes); if (cs !== r.checksum) got = null; } // never carry a corrupted entry forward
          if (!got) {
            try { got = await download(r, signal); downloaded += got.bytes.byteLength; }
            catch (e) { if (r.required || e.code !== 'DOWNLOAD_FAILED') throw e; skipped.push(r.path); continue; } // optional extra (gallery, aerial): pack becomes PARTIAL
          }
          await S.put(name, r.path, r.checksum, got.bytes, got.contentType);
          tx.stagedResourceKeys.push({ type: r.resourceType, resourceId: r.path, version: r.checksum });
        }
        tx.status = TxStatus.VALIDATING;
        const kept = resources.filter(r => !skipped.includes(r.path));
        for (const r of kept) if (!(await S.has(name, r.path, r.checksum))) throw new PackError('DOWNLOAD_FAILED', MESSAGES.DOWNLOAD_FAILED, { path: r.path, detail: 'staging incompleto' });
        tx.status = TxStatus.READY_TO_COMMIT;
        const at = new Date(now()).toISOString();
        const record = { packId: PACK_ID, organizationId, developmentId: D.id, profile, includeHighRes: !!includeHighRes, cacheName: name, state: skipped.length ? OfflinePackState.PARTIAL : OfflinePackState.READY, skipped, packSchemaVersion: PACK_SCHEMA_VERSION,
          definition: { ...buildDefinition({ organizationId, developmentId: D.id, profile, resources, manifest, now, includeHighRes }), createdAt: previous && previous.definition ? previous.definition.createdAt : at },
          resources: Object.fromEntries(kept.map(r => [r.path, { resourceType: r.resourceType, checksum: r.checksum, bytes: r.bytes, securityClass: r.securityClass, kind: r.kind }])),
          versions: versionsOf(manifest),
          manifest: { kind: manifest.kind, developmentId: manifest.developmentId, schemaVersion: manifest.schemaVersion, staticVersion: manifest.staticVersion, analysisVersion: manifest.analysisVersion, priceTableVersion: manifest.priceTableVersion,
            commercialRevision: manifest.commercialRevision, availabilityRevision: manifest.availabilityRevision, availabilityPath: manifest.availabilityPath, checksums: manifest.checksums, lotCount: manifest.lotCount,
            assets: manifest.assets.filter(a => resources.some(r => r.path === a.path)), generatedAt: manifest.generatedAt },
          availability: { revision: manifest.availabilityRevision == null ? null : manifest.availabilityRevision, sourceUpdatedAt: null, downloadedAt: at, domainFreshness: manifest.availabilityRevision == null ? 'NOT_AVAILABLE' : 'LAST_KNOWN' },
          pricing: { priceTableVersion: manifest.priceTableVersion || null, commercialRevision: manifest.commercialRevision == null ? null : manifest.commercialRevision, downloadedAt: at, domainFreshness: 'LAST_KNOWN' },
          bytes: kept.reduce((s, r) => s + (r.bytes || 0), 0), createdAt: previous ? previous.createdAt : at, lastUpdatedAt: at, lastCheckedAt: at, update: null,
          preparedBy: { organizationId, userScope: 'ORGANIZATION' } };
        await commitIndex(i => { i.packs[PACK_ID] = record; });
        tx.status = TxStatus.COMMITTED;
        if (previous && previous.cacheName && previous.cacheName !== name) { try { await S.deleteCache(previous.cacheName); } catch (e) { /* maintenance removes it later */ } }
        tel(reason === 'refresh' ? 'offline_pack_refresh' : 'offline_pack_prepare_success', { profile, bytes: record.bytes, count: resources.length, durationMs: now() - t0 });
        tel('offline_pack_bytes', { bytes: downloaded, profile });
        if (onCommitted) { try { await onCommitted(record); } catch (e) { /* seeding is best effort */ } }
        return { ok: true, packId: PACK_ID, state: record.state, transaction: { ...tx }, bytes: record.bytes, downloadedBytes: downloaded, record };
      } catch (e) {
        try { await S.deleteCache(name); } catch (x) { /* staging leftover: maintenance */ }
        tx.status = e.code === 'ABORTED' || e.code === 'DOWNLOAD_FAILED' ? TxStatus.ROLLED_BACK : TxStatus.FAILED;
        tel('offline_pack_prepare_failure', { code: e.code || 'ERROR', profile });
        return { ok: false, packId: PACK_ID, code: e.code || 'ERROR', message: e.message, state: previous ? (await inspect()).state : OfflinePackState.NOT_PREPARED, transaction: { ...tx }, path: e.path };
      }
    }
    const lock = fn => { if (busy) return Promise.resolve({ ok: false, code: 'BUSY', message: MESSAGES.BUSY, packId: PACK_ID }); busy = Promise.resolve().then(fn).finally(() => { busy = null; }); return busy; };
    /** estimate(profile) → { profile, bytes, resources, label, quota } without downloading (pre-calculated size, §58) */
    async function estimate(profile = 'STANDARD', o = {}) {
      const m = o.manifest || await fetchManifest(o.signal); const resources = resolveResources(profile, m, D, o);
      const prev = (await index()).packs[PACK_ID];
      const d = prev ? diff(prev, resources, m) : null;
      const bytes = d ? d.estimatedDownloadBytes : resources.reduce((s, r) => s + (r.bytes || 0), 0);
      let q = null; try { q = await quotaCheck(bytes); } catch (e) { q = { insufficient: true, needBytes: e.needBytes, freeBytes: e.freeBytes, message: e.message }; }
      return { profile, label: PROFILE_LABEL[profile], bytes, bytesLabel: `Estimativa: ${fmtMB(bytes)}`, totalBytes: resources.reduce((s, r) => s + (r.bytes || 0), 0), resources: resources.length, quota: q };
    }
    /** prepare(definitionOrProfile, { includeHighRes, signal }) → OfflinePackResult (§55, §61) */
    function prepare(defOrProfile = 'STANDARD', o = {}) {
      return lock(async () => {
        const profile = typeof defOrProfile === 'string' ? defOrProfile : defOrProfile.profile;
        const includeHighRes = o.includeHighRes != null ? o.includeHighRes : !!(defOrProfile && defOrProfile.includeHighRes);
        tel('offline_pack_prepare_start', { profile });
        try {
          checkPermission();
          const manifest = await fetchManifest(o.signal);
          const resources = resolveResources(profile, manifest, D, { includeHighRes });
          const previous = (await index()).packs[PACK_ID] || null;
          const need = previous && previous.profile === profile ? diff(previous, resources, manifest).estimatedDownloadBytes : resources.reduce((s, r) => s + (r.bytes || 0), 0);
          await quotaCheck(need); // before any download (§60)
          const res = await transact({ profile, includeHighRes, manifest, resources, previous, signal: o.signal, reason: 'prepare' });
          if (res.ok) tel('offline_pack_enabled', { profile });
          return res;
        } catch (e) {
          tel('offline_pack_prepare_failure', { code: e.code || 'ERROR', profile });
          const prev = (await index()).packs[PACK_ID];
          return { ok: false, packId: PACK_ID, code: e.code || 'ERROR', message: e.message, state: prev ? prev.state : OfflinePackState.NOT_PREPARED, needBytes: e.needBytes, freeBytes: e.freeBytes };
        }
      });
    }
    /** checkForUpdates(): compare the committed versions with the published manifest (reconnect / app start, §132) */
    async function checkForUpdates(o = {}) {
      const rec = (await index()).packs[PACK_ID]; if (!rec) return { ok: false, code: 'NOT_FOUND', message: MESSAGES.NOT_FOUND };
      let m; try { m = await fetchManifest(o.signal); } catch (e) { return { ok: false, code: e.code, message: e.message, state: (await inspect()).state }; }
      let resources; try { resources = resolveResources(rec.profile, m, D, { includeHighRes: rec.includeHighRes }); } catch (e) { return { ok: false, code: e.code, message: e.message }; }
      const d = diff(rec, resources, m);
      await commitIndex(i => { const r = i.packs[PACK_ID]; if (!r) return; r.lastCheckedAt = new Date(now()).toISOString(); r.update = d.empty ? null : { diff: d, checkedAt: r.lastCheckedAt }; if (r.state === 'READY' || r.state === 'UPDATE_AVAILABLE' || r.state === 'STALE') r.state = d.empty ? 'READY' : 'UPDATE_AVAILABLE'; });
      const auto = !d.empty && UPD.autoDownload !== 'NEVER' && (UPD.autoDownload === 'ALWAYS_WHEN_ALLOWED' || d.estimatedDownloadBytes <= UPD.maxAutomaticBytes) && !(o.metered);
      return { ok: true, diff: d, state: d.empty ? 'READY' : 'UPDATE_AVAILABLE', autoDownloadAllowed: auto, message: d.empty ? null : `Atualização disponível · ${fmtMB(d.estimatedDownloadBytes)}` };
    }
    /** refresh(packId): delta download of what changed (§133) */
    function refresh(packId = PACK_ID, o = {}) {
      return lock(async () => {
        const rec = (await index()).packs[packId]; if (!rec || packId !== PACK_ID) return { ok: false, code: 'NOT_FOUND', message: MESSAGES.NOT_FOUND, packId };
        try {
          checkPermission();
          const m = await fetchManifest(o.signal);
          const resources = resolveResources(rec.profile, m, D, { includeHighRes: rec.includeHighRes });
          const d = diff(rec, resources, m);
          if (d.empty) { await commitIndex(i => { const r = i.packs[packId]; if (r) { r.lastCheckedAt = new Date(now()).toISOString(); r.update = null; if (r.state !== 'PARTIAL') r.state = 'READY'; } }); return { ok: true, packId, state: 'READY', diff: d, downloadedBytes: 0, unchanged: true }; }
          await quotaCheck(d.estimatedDownloadBytes);
          const res = await transact({ profile: rec.profile, includeHighRes: rec.includeHighRes, manifest: m, resources, previous: rec, signal: o.signal, reason: 'refresh' });
          return { ...res, diff: d };
        } catch (e) { return { ok: false, packId, code: e.code || 'ERROR', message: e.message, state: rec.state }; }
      });
    }
    /** remove(packId): REMOVING in the index first (the worker stops using it), then the cache, then the record (§287) */
    async function remove(packId = PACK_ID, reason = 'user') {
      const i = await index(); const rec = i.packs[packId]; if (!rec) return { ok: true, removed: false };
      await commitIndex(x => { if (x.packs[packId]) x.packs[packId].state = OfflinePackState.REMOVING; });
      try { await S.deleteCache(rec.cacheName); } catch (e) { /* maintenance */ }
      await commitIndex(x => { delete x.packs[packId]; });
      tel('offline_pack_removed', { reason });
      return { ok: true, removed: true };
    }
    /** access decision for the active principal (tenant isolation, offline session age, §80–§83, §290) */
    function accessDecision(rec, ctx = {}) {
      const p = principal();
      if (!rec) return { allowed: false, reason: 'NOT_PREPARED' };
      if (!p || p.organizationId !== rec.organizationId) return { allowed: false, reason: 'OTHER_ORGANIZATION' };
      if (p.authenticated === false && !AUTH.allowPreviouslyAuthenticatedOfflineUse) return { allowed: false, reason: 'LOGIN_REQUIRED', message: 'Entre novamente para usar os dados offline.' };
      if (SEC.requireReauthBeforeAccess && !p.authenticated) return { allowed: false, reason: 'REAUTH_REQUIRED', message: 'Entre novamente para usar os dados offline.' };
      const last = p.lastValidatedAt ? +new Date(p.lastValidatedAt) : null;
      if (ctx.offline && AUTH.maxOfflineSessionAgeMs != null && last != null && now() - last > AUTH.maxOfflineSessionAgeMs) return { allowed: false, reason: 'REVALIDATION_REQUIRED', message: 'Conecte-se para confirmar seu acesso aos dados offline.' };
      return { allowed: true, reason: 'OK' };
    }
    /** inspect(packId, { verify }) → OfflinePackStatus. verify: every entry is present (else PARTIAL — never a fake READY, §279) */
    async function inspect(packId = PACK_ID, o = {}) {
      const rec = (await index()).packs[packId];
      if (!rec) return { packId, state: OfflinePackState.NOT_PREPARED, developmentId: D.id, organizationId };
      let state = rec.state;
      if (rec.packSchemaVersion !== PACK_SCHEMA_VERSION) state = OfflinePackState.UPDATE_REQUIRED; // never interpret an incompatible pack silently (§215)
      const missing = [];
      if (o.verify && state !== 'REMOVING') { for (const [p, r] of Object.entries(rec.resources || {})) if (!(await S.has(rec.cacheName, p, r.checksum))) missing.push(p); if (missing.length) state = OfflinePackState.PARTIAL; }
      if (state === 'READY' && rec.lastCheckedAt && now() - +new Date(rec.lastCheckedAt) > UPD.staleAfterMs) state = OfflinePackState.STALE; // not verified for a long time: usable, not "current"
      const access = accessDecision(rec, { offline: o.offline });
      return { packId, state, profile: rec.profile, profileLabel: PROFILE_LABEL[rec.profile], developmentId: rec.developmentId, organizationId: rec.organizationId, versions: { ...rec.versions }, bytes: rec.bytes,
        createdAt: rec.createdAt, lastUpdatedAt: rec.lastUpdatedAt, lastCheckedAt: rec.lastCheckedAt, resources: Object.keys(rec.resources || {}).length, missing, availability: { ...rec.availability }, pricing: { ...rec.pricing },
        update: rec.update ? { estimatedDownloadBytes: rec.update.diff.estimatedDownloadBytes, checkedAt: rec.update.checkedAt, label: `Atualização disponível · ${fmtMB(rec.update.diff.estimatedDownloadBytes)}` } : null,
        access, usable: USABLE.has(state) && access.allowed };
    }
    /** list() → statuses of the ACTIVE organization only (a pack of org A is invisible in org B, §336) */
    async function list(o = {}) {
      const p = principal(), i = await index(), out = [];
      for (const rec of Object.values(i.packs)) if (p && rec.organizationId === p.organizationId) out.push(rec.packId === PACK_ID ? await inspect(rec.packId, o) : { packId: rec.packId, state: rec.state, developmentId: rec.developmentId, organizationId: rec.organizationId, bytes: rec.bytes, lastUpdatedAt: rec.lastUpdatedAt, profile: rec.profile });
      return out;
    }
    /** read(path, { as: 'json'|'bytes' }) → { data, checksum, packId, downloadedAt } | null — app-side reader (tenant + access checked) */
    async function read(path, o = {}) {
      const rec = (await index()).packs[PACK_ID];
      if (!rec || !USABLE.has(rec.state) || !accessDecision(rec, { offline: o.offline }).allowed) return null;
      const r = rec.resources[path]; if (!r) return null;
      const got = await S.get(rec.cacheName, path, r.checksum); if (!got) return null;
      if (o.verify !== false && (await digest(got.bytes)) !== r.checksum) return null; // corrupted entry is never shown
      const data = o.as === 'bytes' ? got.bytes : JSON.parse(new TextDecoder().decode(got.bytes));
      return { data, checksum: r.checksum, packId: PACK_ID, downloadedAt: rec.lastUpdatedAt, resourceType: r.resourceType, contentType: got.contentType };
    }
    /** resource types present in a usable pack (for OfflineCapabilityRegistry.evaluate) */
    async function presentResources(o = {}) {
      const rec = (await index()).packs[PACK_ID]; const out = new Set(['APP_SHELL']);
      if (!rec || !USABLE.has(rec.state) || !accessDecision(rec, { offline: o.offline }).allowed) return out;
      for (const r of Object.values(rec.resources)) out.add(r.resourceType);
      out.add('MAP_BOOTSTRAP'); out.add('AVAILABILITY_SNAPSHOT'); // availability = last-known UNKNOWN in the data layer (never current)
      return out;
    }
    // ---------- security lifecycle
    async function removeWhere(pred, reason) { const i = await index(); let n = 0; for (const rec of Object.values(i.packs)) if (pred(rec)) { await remove(rec.packId, reason); n++; } return n; }
    /** logout: organization-safe packs may stay (policy); nothing user-specific is ever in a pack (§77) */
    const onLogout = () => SEC.allowOrganizationPackPersistenceAfterLogout ? Promise.resolve({ removed: 0, kept: true }) : removeWhere(r => r.organizationId === organizationId, 'logout').then(removed => ({ removed, kept: false }));
    const onUserSwitch = () => SEC.clearOnUserSwitch ? removeWhere(r => r.organizationId === organizationId, 'user_switch').then(removed => ({ removed })) : Promise.resolve({ removed: 0 });
    /** first revalidation after reconnect says access is gone → block and remove the organization's packs (§288, §293) */
    const onAccessRevoked = (orgId = organizationId) => removeWhere(r => r.organizationId === orgId, 'access_revoked').then(removed => ({ removed }));
    /** maintenance: staging leftovers and caches not referenced by the index are deleted (atomic, logically consistent cleanup) */
    async function maintenance() {
      const i = await index(), used = new Set(Object.values(i.packs).map(r => r.cacheName)); let deleted = 0;
      if (busy) return { deleted };
      for (const n of await S.listCaches()) if (n.startsWith(ROUTING().CACHE.packPrefix) && !used.has(n)) { await S.deleteCache(n); deleted++; }
      return { deleted };
    }
    /** StorageUsageViewModel (§181) */
    async function storageUsage() {
      let q = null; try { q = quota ? await quota() : (App.offline && App.offline.storageEstimate ? await App.offline.storageEstimate() : null); } catch (e) { q = null; }
      const packs = (await list()).map(p => ({ packId: p.packId, developmentId: p.developmentId, bytes: p.bytes, state: p.state, lastUpdatedAt: p.lastUpdatedAt, profile: p.profile }));
      return { estimatedUsageBytes: q ? q.usage : undefined, estimatedQuotaBytes: q ? q.quota : undefined, approximate: true, persistent: !!S.persistent, packs };
    }
    return { packId: PACK_ID, development: D, store: S, profiles: () => Object.keys(PROFILE_CHAIN).map(p => ({ profile: p, label: PROFILE_LABEL[p] })), resolve: (profile, m, o) => resolveResources(profile, m, D, o),
      estimate, prepare, refresh, checkForUpdates, remove, inspect, list, read, presentResources, accessDecision: async () => accessDecision((await index()).packs[PACK_ID]), onLogout, onUserSwitch, onAccessRevoked, maintenance, storageUsage,
      policies: { security: SEC, auth: AUTH, update: UPD, expiration: EXPIRATION } };
  }

  // ---------------------------------------------------------------- offline remote for the data layer (first boot offline with a READY pack)
  /** packRemote(manager, dev, commercialRepo): the data-layer remote contract (data/offline.js) served from the pack.
      Price comes back STALE ("última tabela disponível — necessita confirmação"), availability stays UNKNOWN (no feed in the pack). */
  function packRemote(manager, dev, commercialRepo) {
    const need = async p => { const r = await manager.read(p, { offline: true }); if (!r) { const e = new Error('não disponível offline: ' + p); e.code = 'NOT_IN_PACK'; e.network = true; throw e; } return r.data; };
    return {
      kind: 'offline-pack',
      async getManifest() { const st = await manager.inspect(); if (!st.usable) { const e = new Error('pacote offline indisponível'); e.network = true; throw e; } const rec = (await manager.store.readIndex()).packs[manager.packId]; return { ...rec.manifest, source: 'OFFLINE_PACK' }; },
      async getStructural(manifest) { const raw = await need(dev.assets.lots); const d = manifest ? { ...dev, staticDataVersion: manifest.staticVersion, analysisVersion: manifest.analysisVersion } : dev; return App.repos.buildSnapshotsFromLegacy(raw, d, commercialRepo); },
      async getCommercial(staticSnap) { const doc = await need(dev.assets.commercial); const c = App.offline.commercialFromDoc(doc, staticSnap, dev, commercialRepo); return { ...c, source: 'OFFLINE_PACK', stale: true, confirmedAt: null }; },
      async getAvailability() { return null; }
    };
  }

  // ---------------------------------------------------------------- domain wording offline (§65, §66, §149, §154–§157, §164–§165, §263–§267)
  /** availability shown from an offline copy: never "current" (§7, §362) */
  function availabilityOffline(status, meta = {}) {
    const known = status && status !== 'UNKNOWN';
    return { status: known ? status : 'UNKNOWN', claimCurrent: false, mode: 'Modo offline',
      lines: [known ? 'Última informação conhecida' : 'Status não confirmado', 'Modo offline', 'Confirme disponibilidade ao reconectar', meta.downloadedAt ? `Última atualização: ${hhmm(meta.downloadedAt)}` : null].filter(Boolean),
      revision: meta.revision == null ? 'não disponível' : meta.revision };
  }
  /** price from the stored table (§66): version + "confirme a tabela atual antes de proposta" */
  function pricingOffline(meta = {}, table = null) {
    const t = table || {};
    return { label: meta.priceTableVersion ? `Tabela ${t.name || meta.priceTableVersion}${t.version || meta.priceTableVersion ? ' · versão ' + (t.version || meta.priceTableVersion) : ''}` : 'Tabela não disponível offline',
      validity: t.validFrom ? `Vigência a partir de ${t.validFrom}` : 'Vigência: não disponível', warning: 'Modo offline — confirme a tabela atual antes de proposta', confirmed: false };
  }
  /** financial simulation offline (§164, §165, §343): stamped, warned, no fabricated index */
  function financialOfflineStamp(result, { priceTableVersion = null, paymentPlanVersion = null, now = () => Date.now(), indexation = null } = {}) {
    return { ...result, calculationMode: 'OFFLINE_LAST_KNOWN_TABLE', priceTableVersion, paymentPlanVersion, offline: true, generatedAt: new Date(now()).toISOString(),
      indexation: indexation == null ? { value: null, label: 'não disponível' } : indexation,
      warnings: ['Simulação baseada na última tabela armazenada.', 'Confirme condições atuais antes de proposta.'] };
  }
  /** QuickView offline banner (§149, §150): explicit mode + commercial freshness; sections not stored say so instead of spinning */
  function quickViewOffline({ offline, packState, downloadedAt, missingSections = [] } = {}) {
    if (!offline) return null;
    return { badge: 'Modo offline', freshness: downloadedAt ? `Dados comerciais de ${dateTime(downloadedAt)}` : 'Dados comerciais: última informação conhecida',
      unavailable: missingSections.map(s => ({ section: s, text: 'Disponível quando online' })), packState: packState || null };
  }
  /** legend status of a map layer offline (§154–§157) */
  function layerOfflineStatus(layer = {}, present = new Set()) {
    const id = layer.id || layer;
    if (id === 'availability') return { status: 'REQUIRES_CURRENT_DATA', text: 'Dados de disponibilidade podem estar desatualizados' };
    if (/price|preco|pricing/i.test(id)) return present.has('PRICING_SNAPSHOT') ? { status: 'AVAILABLE_OFFLINE', text: 'Tabela de preço armazenada (confirme antes de proposta)' } : { status: 'NOT_DOWNLOADED', text: 'Não baixado para uso offline' };
    if (layer.requires && !layer.requires.every(r => present.has(r))) return { status: 'NOT_DOWNLOADED', text: 'Não baixado para uso offline' };
    return present.has('GEOMETRY_BUNDLE') ? { status: 'AVAILABLE_OFFLINE', text: 'Disponível offline' } : { status: 'NOT_DOWNLOADED', text: 'Não baixado para uso offline' };
  }
  /** deep link while offline (§263–§267): open only what is present; never redirect silently to another lot */
  function deepLinkOffline({ lotId = null, version = null } = {}, { presentLotIds = new Set(), presentVersions = new Set(), offline = true } = {}) {
    if (!offline) return { available: true };
    const unavailable = { available: false, title: 'Este conteúdo não está disponível offline.', text: 'Conecte-se para carregar.', redirect: null };
    if (version && !presentVersions.has(String(version))) return { ...unavailable, reason: 'VERSION_NOT_IN_PACK' };
    if (lotId && !presentLotIds.has(lotId)) return { ...unavailable, reason: 'LOT_NOT_IN_PACK' };
    return { available: true, reason: version ? 'VERSION_IN_PACK' : 'LOT_IN_PACK' };
  }
  /** OfflineDevelopmentCard (§146–§147) */
  function developmentCard(dev, status, caps = null) {
    const ready = status && USABLE.has(status.state);
    const stateText = { NOT_PREPARED: 'Não preparado para uso offline', PREPARING: 'Preparando…', READY: 'Disponível offline', PARTIAL: 'Incompleto — atualize', STALE: 'Disponível offline (não verificado recentemente)',
      UPDATE_AVAILABLE: 'Disponível offline · atualização disponível', UPDATE_REQUIRED: 'Precisa ser preparado de novo', ERROR: 'Erro — prepare de novo', REMOVING: 'Removendo…' };
    return { developmentId: dev.id, development: dev.name, packState: status ? status.state : 'NOT_PREPARED', stateText: stateText[status ? status.state : 'NOT_PREPARED'],
      lastUpdated: status && status.lastUpdatedAt ? dateTime(status.lastUpdatedAt) : null, dataFreshness: ready ? 'Preço e disponibilidade: última informação conhecida' : null,
      size: status && status.bytes ? fmtMB(status.bytes) : null, capabilities: caps || [], canOpen: !!(ready && status.access && status.access.allowed), access: status && status.access };
  }
  /** client-safe presentation pack (§171–§174): immutable, no presenter-only notes, no customer identifiers */
  function buildPresentationPack(snapshot, { clientFacing = true, now = () => Date.now() } = {}) {
    const DROP = /^(presenter|presenterNotes|notes|internal|internalNotes|speakerNotes|customerId|customerName|phone|email|cpf|token|shareToken)$/i;
    const clean = v => Array.isArray(v) ? v.map(clean) : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !(clientFacing && DROP.test(k))).map(([k, x]) => [k, clean(x)])) : v);
    const body = clean(JSON.parse(JSON.stringify(snapshot || {})));
    const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
    return deepFreeze({ kind: 'offline-presentation-pack', clientFacing, version: App.offline && App.offline.checksum ? App.offline.checksum(body) : null, createdAt: new Date(now()).toISOString(), snapshot: body });
  }
  /** first boot offline without any pack (§144, §145): explicit message, never an empty misleading map */
  const NO_PACK_MESSAGE = Object.freeze({ title: 'Você está offline.', text: 'Nenhum empreendimento foi preparado para uso offline.' });

  return Object.freeze({ OfflinePackState, TxStatus, Profile, PACK_SCHEMA_VERSION, PROFILE_RESOURCES, PROFILE_LABEL, DEFAULT_SECURITY, DEFAULT_AUTH, DEFAULT_UPDATE, EXPIRATION, MESSAGES, PackError,
    sha12, MemoryPackStore, CacheStoragePackStore, resolveResources, buildDefinition, manifestRevision, diff, OfflinePackManager, packRemote,
    availabilityOffline, pricingOffline, financialOfflineStamp, quickViewOffline, layerOfflineStatus, deepLinkOffline, developmentCard, buildPresentationPack, NO_PACK_MESSAGE, fmtMB });
})();
