/* Viva Juara — chunk "favorites" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- favorites/favorites.js ---- */
/* favorites/favorites.js — topic 38: favorites as a formal domain.

   FavoriteRecord (one logical record per identity key, soft lifecycle ACTIVE / REMOVED / ARCHIVED, recordRevision) ·
   FavoriteIdentityKey (organizationId + userId + contextType + contextRef + entityType + entityId) · contexts PERSONAL /
   CUSTOMER (contextRef = opaque customerId, topic 39 foundation) / SESSION (memory only) / SHARED_COLLECTION ·
   FavoriteCollection + FavoriteCollectionItem (many-to-many, manual order, soft delete) · FavoriteCollectionSnapshot ·
   FavoriteStateTransition · domain events · FavoriteRepository over a backend (IndexedDB → localStorage → memory) ·
   FavoriteMutationQueue + FavoriteSyncService (server revision wins for toggles, notes never overwritten silently) ·
   FavoriteReadModelAssembler (batch, live current state via topic 37 ResolvedAttributeValue) · projections INTERNAL /
   CLIENT / SHARE / TECHNICAL · FavoriteSetProjection for the map · LegacyFavoriteMigrationAdapter · store bridge.

   Invariants: a favorite is never authorization, never Availability, never a reservation/proposal, never a Recommendation,
   Fit, score or winner input, and never a field of the canonical Lot (no lot.isFavorite). It survives sale, price change,
   filters, layer changes, selection and comparison removal. Removing from a collection ≠ unfavorite; archiving a collection
   keeps the favorites. Favorites are private to (organizationId, userId); cross-tenant / cross-user reads are DENIED.
   No customer PII: only opaque ids; notes are internal content, never in events, logs, URLs or client/share projections.
   Components never touch storage: they call the service (or keep using store.favorites through bindStore). */
App.favorites = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const ContextType = E('PERSONAL', 'CUSTOMER', 'SESSION', 'SHARED_COLLECTION');
  const Source = E('MAP', 'QUICK_VIEW', 'FULL_DETAILS', 'SEARCH', 'FILTER_RESULT', 'RECOMMENDATION', 'COMPARISON', 'CLIENT_PROFILE', 'DEEP_LINK', 'IMPORT', 'MIGRATION', 'OTHER');
  const Lifecycle = E('ACTIVE', 'REMOVED', 'ARCHIVED');
  const CollectionContextType = E('PERSONAL', 'CUSTOMER', 'PRESENTATION', 'INVESTMENT_SHORTLIST', 'CUSTOM');
  const CollectionVisibility = E('PRIVATE', 'ORGANIZATION_SHARED', 'LINK_SHARED', 'CUSTOMER_SHARED');
  const CollectionLifecycle = E('ACTIVE', 'ARCHIVED', 'DELETED');
  const SyncState = E('SYNCED', 'PENDING_UPLOAD', 'PENDING_DELETE', 'CONFLICT', 'ERROR', 'LOCAL_ONLY');
  const MutationState = E('IDLE', 'ADDING', 'REMOVING', 'SYNC_PENDING', 'ERROR');
  const EntityResolution = E('RESOLVED', 'ENTITY_NOT_FOUND', 'ENTITY_ARCHIVED', 'ENTITY_INACCESSIBLE');
  const ContextResolution = E('RESOLVED', 'CONTEXT_ARCHIVED', 'CONTEXT_NOT_FOUND', 'CONTEXT_INACCESSIBLE');
  const Sort = E('RECENTLY_ADDED', 'OLDEST_FIRST', 'MANUAL', 'CURRENT_PRICE_ASC', 'CURRENT_PRICE_DESC', 'LOT_ID', 'CURRENT_STATUS');
  const ViewMode = E('LIVE', 'SNAPSHOT');
  const StateFlag = E('PRICE_CHANGED', 'STATUS_CHANGED', 'SOLD', 'RESERVED', 'UNAVAILABLE', 'PRICE_UNKNOWN', 'ANALYSIS_UPDATED', 'STALE_COMMERCIAL_DATA', 'HAS_CRITICAL_ALERT', 'ORPHANED');
  const ProjectionMode = E('INTERNAL', 'CLIENT', 'SHARE', 'TECHNICAL');
  const SyncConflictType = E('ADD_REMOVE', 'NOTE_NOTE', 'COLLECTION_MEMBERSHIP', 'CONTEXT_CHANGE', 'DELETE_UPDATE');
  const EventType = E('FavoriteAdded', 'FavoriteRemoved', 'FavoriteRestored', 'FavoriteArchived', 'FavoriteAddedToCollection', 'FavoriteRemovedFromCollection', 'FavoriteCollectionCreated', 'FavoriteCollectionArchived', 'FavoriteCollectionShared');
  const Errors = E('FAVORITE_NOT_FOUND', 'FAVORITE_ALREADY_ACTIVE', 'FAVORITE_ALREADY_REMOVED', 'FAVORITE_TENANT_MISMATCH', 'FAVORITE_USER_MISMATCH', 'FAVORITE_ENTITY_NOT_FOUND', 'FAVORITE_DEVELOPMENT_MISMATCH',
    'FAVORITE_COLLECTION_NOT_FOUND', 'FAVORITE_COLLECTION_TENANT_MISMATCH', 'FAVORITE_COLLECTION_CONTEXT_MISMATCH', 'FAVORITE_REVISION_CONFLICT', 'FAVORITE_SYNC_CONFLICT', 'FAVORITE_PERMISSION_DENIED',
    'FAVORITE_INVALID_CONTEXT', 'FAVORITE_INVALID_PRINCIPAL', 'FAVORITE_INVALID_ORDER', 'FAVORITE_DUPLICATE_ACTIVE_KEY', 'UNRESOLVED_LEGACY_FAVORITE');
  const Warnings = E('FAVORITE_ENTITY_SOLD', 'FAVORITE_ENTITY_BLOCKED', 'FAVORITE_PRICE_UNKNOWN', 'FAVORITE_STATUS_STALE', 'FAVORITE_SYNC_PENDING', 'FAVORITE_ORPHANED_ENTITY');
  /** proposed permission keys (not in the registry yet: favorites are device-local today, feature "lot.favorite") */
  const PERMISSIONS = Object.freeze({ read: 'favorite.read', create: 'favorite.create', remove: 'favorite.remove', manageCollections: 'favorite.manageCollections', share: 'favorite.share', readOthers: 'favorite.readOthers' });
  const SCHEMA_VERSION = 1, MIGRATION_VERSION = 1, NOTE_MAX = 500, IDEM_MAX = 300;
  const MESSAGES = Object.freeze({
    add: 'Adicionar lote aos favoritos', remove: 'Remover lote dos favoritos', added: 'Favoritado', notAdded: 'Favoritar',
    syncFailedLocal: 'Não foi possível sincronizar o favorito. Ele continua salvo localmente.', saveFailed: 'Não foi possível salvar o favorito.',
    empty: 'Você ainda não favoritou nenhum lote. Use a estrela no mapa ou na ficha do lote para guardar opções.', emptyCustomer: 'Nenhum lote favoritado para este cliente.',
    orphan: 'Lote não encontrado na versão atual', removedUndo: 'Favorito removido.', undo: 'Desfazer'
  });
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
  const validId = v => typeof v === 'string' && ID_RE.test(v);

  // ---------------------------------------------------------------- utilities (deterministic hash, ids, clone)
  const stable = v => v == null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  function hash(v) { const s = stable(v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  let counter = 0;
  const defaultId = prefix => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // ---------------------------------------------------------------- identity key + context
  /** identityKey(principal, context, lotId) → FavoriteIdentityKey */
  const identityKey = (p, ctx, entityId, entityType = 'LOT') => Object.freeze({ organizationId: p.organizationId, userId: p.userId, contextType: ctx.type, contextRef: ctx.ref || null, entityType, entityId });
  const keyString = k => [k.organizationId, k.userId, k.contextType, k.contextRef || '', k.entityType, k.entityId].join('|');
  /** normalizeContext({ type, ref, label }) → FavoriteActiveContext | null (UI/session state; label is UI text, never persisted) */
  function normalizeContext(c) {
    const ctx = c || { type: 'PERSONAL' }, type = ctx.type || 'PERSONAL';
    if (!ContextType[type]) return null;
    if ((type === 'CUSTOMER' || type === 'SHARED_COLLECTION' || type === 'SESSION') && !validId(ctx.ref)) return null; // opaque ids only, never names/emails/phones
    if (type === 'PERSONAL' && ctx.ref) return null;
    return Object.freeze({ type, ref: type === 'PERSONAL' ? null : ctx.ref, label: ctx.label || (type === 'PERSONAL' ? 'Meus favoritos' : type === 'CUSTOMER' ? 'Favoritos do cliente' : 'Favoritos da sessão') });
  }
  const PERSONAL = normalizeContext({ type: 'PERSONAL' });
  const sameCtx = (r, ctx) => r.contextType === ctx.type && (r.contextRef || null) === (ctx.ref || null);

  // ---------------------------------------------------------------- backends (same interface: load(ns) / save(ns, snap) / remove(ns))
  function memoryBackend() { const m = new Map(); return { kind: 'memory', load: async ns => clone(m.get(ns) || null), save: async (ns, s) => { m.set(ns, clone(s)); }, remove: async ns => { m.delete(ns); } }; }
  /** storageBackend(localStorage-like): small fallback; values are JSON. Failures surface as rejected promises (caller keeps memory). */
  function storageBackend(storage) {
    return { kind: 'local-storage',
      load: async ns => { const v = storage.getItem(ns); return v == null ? null : JSON.parse(v); },
      save: async (ns, s) => { storage.setItem(ns, JSON.stringify(s)); }, remove: async ns => { storage.removeItem(ns); } };
  }
  /** idbBackend(indexedDB) — one object store 'namespaces', one record per (org, user, development) namespace */
  function idbBackend(idb, name = 'ws-favorites') {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => { const r = idb.open(name, 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('namespaces')) r.result.createObjectStore('namespaces'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction('namespaces', mode), s = t.objectStore('namespaces'), req = fn(s); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }));
    return { kind: 'indexeddb', load: ns => tx('readonly', s => s.get(ns)).then(v => v == null ? null : clone(v)), save: (ns, snap) => tx('readwrite', s => s.put(clone(snap), ns)).then(() => undefined), remove: ns => tx('readwrite', s => s.delete(ns)).then(() => undefined) };
  }
  /** pickBackend({ indexedDB, storage }) — IndexedDB when present, else localStorage-like, else memory (private mode) */
  function pickBackend(o = {}) {
    try { if (o.indexedDB) return idbBackend(o.indexedDB); } catch (e) { /* no IndexedDB */ }
    try { if (o.storage) return storageBackend(o.storage); } catch (e) { /* no storage */ }
    return memoryBackend();
  }
  const nsKey = (org, user, dev) => `fav:v${SCHEMA_VERSION}:${org}:${user}:${dev}`;
  const emptySnapshot = () => ({ schemaVersion: SCHEMA_VERSION, favorites: [], collections: [], items: [], transitions: [], queue: [], conflicts: [], unresolvedLegacy: [], idempotency: {}, meta: { favoriteMigrationVersion: 0, setRevision: 0, collectionRevision: 0 } });

  // ---------------------------------------------------------------- FavoriteApplicationService (repository + domain rules + events + queue)
  /** createService({ organizationId, userId, developmentId, backend, resolveLot, resolveLots, now, idGen, deviceId, remote, authorize })
      resolveLot(ref) → canonical Lot | null (repository resolve: id or short code); resolveLots(ids) → Lot[] (batch, avoids N+1).
      authorize(permissionKey, resource) → boolean; default: own favorites allowed, readOthers / manageSharedCollections denied. */
  function createService(o = {}) {
    if (!validId(o.organizationId) || !validId(o.userId) || !validId(o.developmentId)) { const e = new Error('principal inválido'); e.code = 'FAVORITE_INVALID_PRINCIPAL'; throw e; }
    const principal = Object.freeze({ organizationId: o.organizationId, userId: o.userId }), devId = o.developmentId, ns = nsKey(principal.organizationId, principal.userId, devId);
    const backend = o.backend || memoryBackend(), now = o.now || (() => new Date().toISOString()), idGen = o.idGen || defaultId;
    const authorize = o.authorize || ((perm) => perm !== PERMISSIONS.readOthers && perm !== 'favorite.manageSharedCollections');
    let snap = emptySnapshot(), disposed = false, saving = Promise.resolve(), lastSaveError = null;
    const ephemeral = new Map(); // SESSION favorites: never persisted
    const subs = new Set();
    const ready = backend.load(ns).then(s => { if (s && s.schemaVersion === SCHEMA_VERSION) snap = { ...emptySnapshot(), ...s, meta: { ...emptySnapshot().meta, ...(s.meta || {}) } }; return api; }, e => { lastSaveError = e; return api; });
    const emit = (type, payload) => { const ev = Object.freeze({ type, organizationId: principal.organizationId, userId: principal.userId, developmentId: devId, ...payload, timestamp: now() }); subs.forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } }); return ev; };
    function persist() {
      const data = clone(snap);
      saving = saving.then(() => backend.save(ns, data)).then(() => { lastSaveError = null; }, e => { lastSaveError = e; });
      return saving;
    }
    const guard = (perm, resource) => { if (disposed) return { ok: false, code: 'FAVORITE_PERMISSION_DENIED' }; return authorize(perm, resource) ? null : { ok: false, code: 'FAVORITE_PERMISSION_DENIED' }; };
    const all = () => [...snap.favorites, ...ephemeral.values()];
    const byId = id => snap.favorites.find(f => f.id === id) || ephemeral.get(id) || null;
    const findByKey = k => { const ks = keyString(k); return all().find(f => keyString(identityKey(f, { type: f.contextType, ref: f.contextRef }, f.entityId, f.entityType)) === ks) || null; };
    const transition = (fav, from, to, reasonCode) => { const t = Object.freeze({ id: idGen('fvt'), favoriteId: fav.id, fromStatus: from || null, toStatus: to, actorUserId: principal.userId, reasonCode, occurredAt: now() }); if (fav.contextType !== 'SESSION') snap.transitions.push(t); return t; };
    const bumpSet = () => { snap.meta.setRevision++; };
    const remoteOn = () => !!o.remote;
    /** sync state after a local mutation: LOCAL_ONLY until a server knows the record */
    const pendingState = (f, del) => remoteOn() || (f && f.serverRevision != null) ? (del ? 'PENDING_DELETE' : 'PENDING_UPLOAD') : 'LOCAL_ONLY';
    function enqueue(command, fav) {
      if (fav && fav.contextType === 'SESSION') return null;
      const m = { id: idGen('fvm'), idempotencyKey: command.idempotencyKey || idGen('idem'), organizationId: principal.organizationId, userId: principal.userId, command: clone(command), createdAt: now(), attemptCount: 0, lastAttemptAt: null, status: 'PENDING' };
      snap.queue.push(m); return m;
    }
    function replace(fav, patch) {
      const next = Object.freeze({ ...fav, ...patch, updatedAt: now(), recordRevision: fav.recordRevision + 1 });
      if (fav.contextType === 'SESSION') ephemeral.set(fav.id, next); else snap.favorites = snap.favorites.map(f => f.id === fav.id ? next : f);
      return next;
    }
    function resolveTarget(lotRef) {
      const lot = o.resolveLot ? o.resolveLot(lotRef) : null;
      if (!lot) return { ok: false, code: 'FAVORITE_ENTITY_NOT_FOUND' };
      if (lot.identity.developmentId && lot.identity.developmentId !== devId) return { ok: false, code: 'FAVORITE_DEVELOPMENT_MISMATCH' };
      return { ok: true, lot, lotId: lot.identity.id };
    }
    const cleanNote = n => n == null ? null : String(n).slice(0, NOTE_MAX);

    /** add(lotRef, { context, source, note, idempotencyKey, snapshotRef, createdAt, metadata }) → { ok, favorite, created, reactivated, existing, code } — idempotent */
    function add(lotRef, a = {}) {
      const g = guard(PERMISSIONS.create); if (g) return g;
      const ctx = normalizeContext(a.context || PERSONAL); if (!ctx) return { ok: false, code: 'FAVORITE_INVALID_CONTEXT' };
      if (a.idempotencyKey && snap.idempotency[a.idempotencyKey]) { const f = byId(snap.idempotency[a.idempotencyKey]); if (f) return { ok: true, favorite: f, created: false, existing: true, idempotent: true }; }
      const t = resolveTarget(lotRef); if (!t.ok) return t;
      const key = identityKey(principal, ctx, t.lotId), ex = findByKey(key);
      let fav, created = false, reactivated = false;
      if (ex && ex.lifecycleStatus === 'ACTIVE') return { ok: true, favorite: ex, created: false, existing: true };
      if (ex) { // re-add: reactivate the same logical record (§45)
        fav = replace(ex, { lifecycleStatus: 'ACTIVE', removedAt: null, archivedAt: null, syncState: pendingState(ex) });
        transition(fav, ex.lifecycleStatus, 'ACTIVE', 'USER_RESTORED'); reactivated = true;
        emit('FavoriteRestored', { favoriteId: fav.id, lotId: fav.entityId, contextType: fav.contextType });
      } else {
        const at = a.createdAt || now();
        fav = Object.freeze({ id: idGen('fav'), organizationId: principal.organizationId, userId: principal.userId, developmentId: devId, entityType: 'LOT', entityId: t.lotId, contextType: ctx.type, contextRef: ctx.ref,
          collectionIds: [], source: Source[a.source] ? a.source : 'OTHER', lifecycleStatus: 'ACTIVE', note: cleanNote(a.note), createdAt: at, updatedAt: at, removedAt: null, archivedAt: null,
          createdOnDeviceId: o.deviceId || null, recordRevision: 1, serverRevision: null, syncState: remoteOn() ? 'PENDING_UPLOAD' : 'LOCAL_ONLY', snapshotRef: a.snapshotRef || null, metadata: a.metadata ? clone(a.metadata) : null });
        if (ctx.type === 'SESSION') ephemeral.set(fav.id, fav); else snap.favorites.push(fav);
        transition(fav, null, 'ACTIVE', a.source === 'MIGRATION' ? 'LEGACY_MIGRATION' : 'USER_ADDED'); created = true;
        emit('FavoriteAdded', { favoriteId: fav.id, lotId: fav.entityId, contextType: fav.contextType, source: fav.source });
      }
      if (a.idempotencyKey) { snap.idempotency[a.idempotencyKey] = fav.id; const ks = Object.keys(snap.idempotency); if (ks.length > IDEM_MAX) delete snap.idempotency[ks[0]]; }
      enqueue({ type: created ? 'AddFavorite' : 'RestoreFavorite', favoriteId: fav.id, key, expectedRevision: fav.recordRevision - 1, idempotencyKey: a.idempotencyKey }, fav);
      bumpSet(); persist();
      return { ok: true, favorite: fav, created, reactivated, existing: false };
    }
    const findTarget = (ref, ctx) => { const f = byId(ref); if (f) return f; const c = normalizeContext(ctx || PERSONAL); if (!c) return null; const t = o.resolveLot ? o.resolveLot(ref) : null; const id = t ? t.identity.id : ref; return all().find(x => x.entityId === id && sameCtx(x, c)) || null; };
    function setLifecycle(ref, to, ctx, reason, evType) {
      const g = guard(to === 'ACTIVE' ? PERMISSIONS.create : PERMISSIONS.remove); if (g) return g;
      const f = findTarget(ref, ctx); if (!f) return { ok: to !== 'ACTIVE', code: 'FAVORITE_NOT_FOUND', favorite: null, unchanged: true };
      if (f.organizationId !== principal.organizationId) return { ok: false, code: 'FAVORITE_TENANT_MISMATCH' };
      if (f.userId !== principal.userId) return { ok: false, code: 'FAVORITE_USER_MISMATCH' };
      if (f.lifecycleStatus === to) return { ok: true, favorite: f, unchanged: true, code: to === 'ACTIVE' ? 'FAVORITE_ALREADY_ACTIVE' : 'FAVORITE_ALREADY_REMOVED' };
      const ts = now(), next = replace(f, { lifecycleStatus: to, removedAt: to === 'REMOVED' ? ts : f.removedAt, archivedAt: to === 'ARCHIVED' ? ts : f.archivedAt, syncState: pendingState(f, to === 'REMOVED') });
      transition(next, f.lifecycleStatus, to, reason);
      enqueue({ type: to === 'ACTIVE' ? 'RestoreFavorite' : to === 'REMOVED' ? 'RemoveFavorite' : 'ArchiveFavorite', favoriteId: f.id, expectedRevision: f.recordRevision }, next);
      emit(evType, { favoriteId: f.id, lotId: f.entityId, contextType: f.contextType });
      bumpSet(); persist();
      return { ok: true, favorite: next };
    }
    /** remove(favoriteId | lotRef, { context }) — soft (REMOVED), idempotent; undo = restore */
    const remove = (ref, a = {}) => setLifecycle(ref, 'REMOVED', a.context, 'USER_REMOVED', 'FavoriteRemoved');
    const restore = (ref, a = {}) => setLifecycle(ref, 'ACTIVE', a.context, 'USER_RESTORED', 'FavoriteRestored');
    const archive = (ref, a = {}) => setLifecycle(ref, 'ARCHIVED', a.context, a.reasonCode || 'USER_ARCHIVED', 'FavoriteArchived');
    /** toggle(lotRef, { context, source }) — the star button */
    function toggle(lotRef, a = {}) { const ctx = normalizeContext(a.context || PERSONAL); if (!ctx) return { ok: false, code: 'FAVORITE_INVALID_CONTEXT' }; const f = findTarget(lotRef, ctx); return f && f.lifecycleStatus === 'ACTIVE' ? remove(f.id) : add(lotRef, a); }
    /** updateNote(id, note, { expectedRevision }) — optimistic concurrency; the note is internal (never in events) */
    function updateNote(id, note, a = {}) {
      const g = guard(PERMISSIONS.create); if (g) return g;
      const f = byId(id); if (!f) return { ok: false, code: 'FAVORITE_NOT_FOUND' };
      if (a.expectedRevision != null && a.expectedRevision !== f.recordRevision) return { ok: false, code: 'FAVORITE_REVISION_CONFLICT', currentRevision: f.recordRevision };
      const next = replace(f, { note: cleanNote(note), syncState: pendingState(f) });
      enqueue({ type: 'UpdateFavoriteNote', favoriteId: f.id, expectedRevision: f.recordRevision, note: next.note }, next); persist();
      return { ok: true, favorite: next };
    }
    /** copyFavoriteToContext(id, targetContext) — explicit copy (personal stays intact); move = copy + remove, by the caller */
    function copyToContext(id, target, a = {}) { const f = byId(id); if (!f) return { ok: false, code: 'FAVORITE_NOT_FOUND' }; return add(f.entityId, { context: target, source: a.source || f.source, note: a.withNote ? f.note : null }); }

    /** list(query) — FavoriteQuery; another user's favorites need favorite.readOthers (denied by default) */
    function list(q = {}) {
      if (q.organizationId && q.organizationId !== principal.organizationId) return { ok: false, code: 'FAVORITE_TENANT_MISMATCH', items: [] };
      if (q.userId && q.userId !== principal.userId && !authorize(PERMISSIONS.readOthers, { userId: q.userId })) return { ok: false, code: 'FAVORITE_PERMISSION_DENIED', items: [] };
      if (q.userId && q.userId !== principal.userId) return { ok: true, items: [] }; // other namespaces are served by the backend only
      const st = q.lifecycleStatus || ['ACTIVE'], ctx = q.context ? normalizeContext(q.context) : (q.contextType ? normalizeContext({ type: q.contextType, ref: q.contextRef }) : null);
      let items = all().filter(f => st.includes(f.lifecycleStatus) && (!ctx || sameCtx(f, ctx)) && (!q.collectionId || snap.items.some(i => i.collectionId === q.collectionId && i.favoriteId === f.id)));
      if (q.search) { const s = String(q.search).toUpperCase(); items = items.filter(f => f.entityId.toUpperCase().includes(s)); }
      const sort = q.sort || 'RECENTLY_ADDED';
      if (sort === 'RECENTLY_ADDED') items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      else if (sort === 'OLDEST_FIRST') items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      else if (sort === 'LOT_ID') items.sort((a, b) => a.entityId.localeCompare(b.entityId, 'pt-BR', { numeric: true }));
      else if (sort === 'MANUAL' && q.collectionId) { const ord = new Map(snap.items.filter(i => i.collectionId === q.collectionId).map(i => [i.favoriteId, i.sortOrder])); items.sort((a, b) => ord.get(a.id) - ord.get(b.id)); }
      return { ok: true, items };
    }
    const isFavorite = (lotId, ctx = PERSONAL) => { const c = normalizeContext(ctx); return !!c && all().some(f => f.entityId === lotId && f.lifecycleStatus === 'ACTIVE' && sameCtx(f, c)); };
    /** setProjection(context) → FavoriteSetProjection — light id set for the map/filters (never full records in the map payload) */
    function setProjection(ctx = PERSONAL) {
      const c = normalizeContext(ctx); if (!c) return Object.freeze({ context: null, lotIds: Object.freeze([]), revision: 'none' });
      const ids = all().filter(f => f.lifecycleStatus === 'ACTIVE' && sameCtx(f, c)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(f => f.entityId);
      return Object.freeze({ context: c, lotIds: Object.freeze(ids), revision: `${snap.meta.setRevision}:${ephemeral.size}` });
    }
    const projectionCacheKey = (ctx = PERSONAL) => { const c = normalizeContext(ctx) || {}; return [principal.organizationId, principal.userId, c.type, c.ref || '', devId, snap.meta.setRevision].join('|'); };

    // ------------------------------------------------ collections
    const collById = id => snap.collections.find(c => c.id === id) || null;
    function createCollection(a = {}) {
      const g = guard(PERMISSIONS.manageCollections); if (g) return g;
      const title = String(a.title || '').trim().slice(0, 80); if (!title) return { ok: false, code: 'FAVORITE_INVALID_CONTEXT', message: 'Título obrigatório' };
      const type = CollectionContextType[a.contextType] ? a.contextType : 'PERSONAL';
      if (type === 'CUSTOMER' && !validId(a.contextRef)) return { ok: false, code: 'FAVORITE_INVALID_CONTEXT' };
      const visibility = CollectionVisibility[a.visibility] ? a.visibility : 'PRIVATE';
      if (visibility !== 'PRIVATE' && !authorize(PERMISSIONS.share)) return { ok: false, code: 'FAVORITE_PERMISSION_DENIED' };
      const ts = now(), c = Object.freeze({ id: idGen('fcol'), organizationId: principal.organizationId, ownerUserId: principal.userId, developmentId: devId, contextType: type, contextRef: type === 'CUSTOMER' ? a.contextRef : (a.contextRef && validId(a.contextRef) ? a.contextRef : null),
        title, description: a.description ? String(a.description).slice(0, 300) : null, lifecycleStatus: 'ACTIVE', visibility, viewMode: ViewMode[a.viewMode] ? a.viewMode : 'LIVE', createdAt: ts, updatedAt: ts, archivedAt: null, recordRevision: 1 });
      snap.collections.push(c); snap.meta.collectionRevision++; emit('FavoriteCollectionCreated', { collectionId: c.id, contextType: c.contextType }); persist();
      return { ok: true, collection: c };
    }
    function patchCollection(id, patch, a = {}) {
      const c = collById(id); if (!c) return { ok: false, code: 'FAVORITE_COLLECTION_NOT_FOUND' };
      if (c.organizationId !== principal.organizationId) return { ok: false, code: 'FAVORITE_COLLECTION_TENANT_MISMATCH' };
      if (c.ownerUserId !== principal.userId && !authorize('favorite.manageSharedCollections', c)) return { ok: false, code: 'FAVORITE_PERMISSION_DENIED' };
      if (a.expectedRevision != null && a.expectedRevision !== c.recordRevision) return { ok: false, code: 'FAVORITE_REVISION_CONFLICT', currentRevision: c.recordRevision };
      const next = Object.freeze({ ...c, ...patch, updatedAt: now(), recordRevision: c.recordRevision + 1 }); snap.collections = snap.collections.map(x => x.id === id ? next : x); snap.meta.collectionRevision++; persist();
      return { ok: true, collection: next };
    }
    const renameCollection = (id, title, a) => { const t = String(title || '').trim().slice(0, 80); return t ? patchCollection(id, { title: t }, a) : { ok: false, code: 'FAVORITE_INVALID_CONTEXT' }; };
    /** archive/delete a collection — never removes FavoriteRecords (§360–§364) */
    function archiveCollection(id, a) { const r = patchCollection(id, { lifecycleStatus: 'ARCHIVED', archivedAt: now() }, a); if (r.ok) emit('FavoriteCollectionArchived', { collectionId: id }); return r; }
    const deleteCollection = (id, a) => patchCollection(id, { lifecycleStatus: 'DELETED', archivedAt: now() }, a);
    const restoreCollection = (id, a) => patchCollection(id, { lifecycleStatus: 'ACTIVE', archivedAt: null }, a);
    /** addToCollection(collectionId, favoriteId | lotRef, { context, note, ensureFavorite }) — idempotent membership */
    function addToCollection(collId, ref, a = {}) {
      const g = guard(PERMISSIONS.manageCollections); if (g) return g;
      const c = collById(collId); if (!c || c.lifecycleStatus === 'DELETED') return { ok: false, code: 'FAVORITE_COLLECTION_NOT_FOUND' };
      if (c.organizationId !== principal.organizationId) return { ok: false, code: 'FAVORITE_COLLECTION_TENANT_MISMATCH' };
      let f = findTarget(ref, a.context);
      if ((!f || f.lifecycleStatus !== 'ACTIVE') && a.ensureFavorite) { const r = add(f ? f.entityId : ref, { context: a.context, source: a.source }); if (!r.ok) return r; f = r.favorite; }
      if (!f || f.lifecycleStatus !== 'ACTIVE') return { ok: false, code: 'FAVORITE_NOT_FOUND' };
      if (f.organizationId !== c.organizationId) return { ok: false, code: 'FAVORITE_COLLECTION_TENANT_MISMATCH' };
      if (c.developmentId && f.developmentId !== c.developmentId) return { ok: false, code: 'FAVORITE_DEVELOPMENT_MISMATCH' };
      if (f.contextType === 'SESSION') return { ok: false, code: 'FAVORITE_COLLECTION_CONTEXT_MISMATCH' };
      const ex = snap.items.find(i => i.collectionId === collId && i.favoriteId === f.id);
      if (ex) return { ok: true, item: ex, existing: true };
      const order = snap.items.filter(i => i.collectionId === collId).reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
      const item = Object.freeze({ id: idGen('fci'), collectionId: collId, favoriteId: f.id, sortOrder: order, addedAt: now(), addedBy: principal.userId, note: cleanNote(a.note) });
      snap.items.push(item); replace(f, { collectionIds: [...new Set([...(f.collectionIds || []), collId])] }); snap.meta.collectionRevision++;
      enqueue({ type: 'AddFavoriteToCollection', favoriteId: f.id, collectionId: collId }, f);
      emit('FavoriteAddedToCollection', { favoriteId: f.id, lotId: f.entityId, collectionId: collId, contextType: f.contextType }); persist();
      return { ok: true, item };
    }
    /** removeFromCollection — the favorite stays ACTIVE (§361) */
    function removeFromCollection(collId, ref, a = {}) {
      const g = guard(PERMISSIONS.manageCollections); if (g) return g;
      const f = findTarget(ref, a.context); if (!f) return { ok: true, unchanged: true };
      const before = snap.items.length; snap.items = snap.items.filter(i => !(i.collectionId === collId && i.favoriteId === f.id));
      if (before === snap.items.length) return { ok: true, unchanged: true };
      replace(f, { collectionIds: (f.collectionIds || []).filter(x => x !== collId) }); snap.meta.collectionRevision++;
      enqueue({ type: 'RemoveFavoriteFromCollection', favoriteId: f.id, collectionId: collId }, f);
      emit('FavoriteRemovedFromCollection', { favoriteId: f.id, lotId: f.entityId, collectionId: collId, contextType: f.contextType }); persist();
      return { ok: true, favorite: byId(f.id) };
    }
    /** reorder(collectionId, favoriteIds[]) — explicit permutation of the current items */
    function reorder(collId, order, a = {}) {
      const items = snap.items.filter(i => i.collectionId === collId), ids = items.map(i => i.favoriteId);
      if (order.length !== ids.length || new Set(order).size !== order.length || order.some(x => !ids.includes(x))) return { ok: false, code: 'FAVORITE_INVALID_ORDER' };
      const r = patchCollection(collId, {}, a); if (!r.ok) return r;
      snap.items = snap.items.map(i => i.collectionId === collId ? Object.freeze({ ...i, sortOrder: order.indexOf(i.favoriteId) }) : i); persist();
      return { ok: true, collection: r.collection };
    }
    /** collectionItems(id, { live }) — the live view only shows ACTIVE favorites (§369); the historical view keeps all */
    function collectionItems(collId, a = {}) {
      const live = a.live !== false;
      return snap.items.filter(i => i.collectionId === collId).sort((x, y) => x.sortOrder - y.sortOrder).map(i => ({ item: i, favorite: byId(i.favoriteId) })).filter(x => x.favorite && (!live || x.favorite.lifecycleStatus === 'ACTIVE'));
    }
    const listCollections = (a = {}) => snap.collections.filter(c => (a.includeArchived ? c.lifecycleStatus !== 'DELETED' : c.lifecycleStatus === 'ACTIVE') && (!a.contextType || c.contextType === a.contextType) && (!a.contextRef || c.contextRef === a.contextRef));
    /** snapshotCollection(id, { purpose, capture(lot) → refs }) → FavoriteCollectionSnapshot (stable membership for a share/presentation) */
    function snapshotCollection(collId, a = {}) {
      const c = collById(collId); if (!c) return { ok: false, code: 'FAVORITE_COLLECTION_NOT_FOUND' };
      const rows = collectionItems(collId), lots = batch(rows.map(r => r.favorite.entityId));
      const itemRefs = rows.map((r, i) => { const lot = lots.get(r.favorite.entityId); const refs = lot && a.capture ? a.capture(lot) : lot ? defaultCapture(lot) : {}; return Object.freeze({ lotId: r.favorite.entityId, sortOrder: i, ...refs }); });
      const s = Object.freeze({ id: idGen('fcs'), organizationId: c.organizationId, collectionId: c.id, itemRefs: Object.freeze(itemRefs), createdAt: now(), createdBy: principal.userId, purpose: a.purpose || 'SHARE', checksum: hash(itemRefs) });
      emit('FavoriteCollectionShared', { collectionId: c.id, snapshotId: s.id }); return { ok: true, snapshot: s };
    }
    const defaultCapture = lot => ({ priceSnapshot: lot.commercial && typeof lot.commercial.price === 'number' ? lot.commercial.price : null, priceTableVersionId: (lot.commercial && lot.commercial.priceTableVersion) || null,
      availabilityStatus: lot.availability ? lot.availability.status : null, availabilityRevision: lot.availability && lot.availability.revision != null ? String(lot.availability.revision) : null, analysisVersion: (lot.intelligence && lot.intelligence.analysisVersion) || null });
    /** captureSnapshotRef(lot) → FavoriteSnapshotRef (optional baseline for PRICE_CHANGED / STATUS_CHANGED; default is none) */
    const captureSnapshotRef = lot => { const d = defaultCapture(lot); return Object.freeze({ lotSnapshotId: null, priceTableVersionId: d.priceTableVersionId, priceSnapshot: d.priceSnapshot, availabilityStatus: d.availabilityStatus, availabilityRevision: d.availabilityRevision, analysisVersionRefs: { analysis: d.analysisVersion }, capturedAt: now() }); };

    // ------------------------------------------------ read models (batch, live)
    function batch(ids) { const m = new Map(); if (!ids.length) return m; const lots = o.resolveLots ? o.resolveLots(ids) : ids.map(id => o.resolveLot ? o.resolveLot(id) : null); (lots || []).forEach(l => { if (l) m.set(l.identity.id, l); }); return m; }
    const DS = () => App.dataState;
    /** readModels(favorites, { mode, viewMode, contextResolver }) → FavoriteReadModel[] — one batch lot lookup, no N+1 */
    function readModels(favs, a = {}) {
      const mode = ProjectionMode[a.mode] ? a.mode : 'INTERNAL', dsMode = mode === 'CLIENT' || mode === 'SHARE' ? 'CLIENT' : mode === 'TECHNICAL' ? 'TECHNICAL' : 'BROKER';
      const lots = batch([...new Set(favs.map(f => f.entityId))]);
      return favs.map(f => {
        const lot = lots.get(f.entityId), flags = [], warnings = [];
        if (!lot) { flags.push('ORPHANED'); warnings.push('FAVORITE_ORPHANED_ENTITY'); }
        const price = lot && DS() ? DS().resolve(lot, 'commercial.price', { mode: dsMode }) : null;
        const status = lot && lot.availability ? lot.availability.status : null, freshness = lot && lot.metadata && lot.metadata.freshness ? lot.metadata.freshness : {};
        if (status === 'SOLD') { flags.push('SOLD'); warnings.push('FAVORITE_ENTITY_SOLD'); }
        if (status === 'RESERVED') flags.push('RESERVED');
        if (status === 'BLOCKED') warnings.push('FAVORITE_ENTITY_BLOCKED');
        if (status === 'UNAVAILABLE' || status === 'BLOCKED') flags.push('UNAVAILABLE');
        if (lot && !(price && DS().isKnownValue(price))) { flags.push('PRICE_UNKNOWN'); warnings.push('FAVORITE_PRICE_UNKNOWN'); }
        if (freshness.commercial === 'STALE' || freshness.commercial === 'EXPIRED') flags.push('STALE_COMMERCIAL_DATA');
        if (freshness.availability === 'STALE' || freshness.availability === 'EXPIRED') warnings.push('FAVORITE_STATUS_STALE');
        const base = f.snapshotRef; // change flags only against a captured baseline (§115–§117)
        if (lot && base && base.priceSnapshot != null && price && DS().isKnownValue(price) && price.value !== base.priceSnapshot) flags.push('PRICE_CHANGED');
        if (lot && base && base.availabilityStatus && status && base.availabilityStatus !== status) flags.push('STATUS_CHANGED');
        if (lot && base && base.analysisVersionRefs && base.analysisVersionRefs.analysis && lot.intelligence && base.analysisVersionRefs.analysis !== lot.intelligence.analysisVersion) flags.push('ANALYSIS_UPDATED');
        if (lot && (lot.intelligence && lot.intelligence.alerts || []).some(x => x && x.severity === 'CRITICAL')) flags.push('HAS_CRITICAL_ALERT');
        if (f.syncState === 'PENDING_UPLOAD' || f.syncState === 'PENDING_DELETE') warnings.push('FAVORITE_SYNC_PENDING');
        const ctxRes = f.contextType === 'CUSTOMER' && a.contextResolver ? (a.contextResolver(f.contextRef) || 'CONTEXT_NOT_FOUND') : 'RESOLVED';
        const rm = { favoriteId: f.id, lotId: f.entityId, developmentId: f.developmentId, identityLabel: lot ? App.fmt.formatLotTitle(lot.identity.blockId, lot.identity.lotNumber) : f.entityId, isFavorite: f.lifecycleStatus === 'ACTIVE',
          lifecycleStatus: f.lifecycleStatus, entityResolution: lot ? 'RESOLVED' : 'ENTITY_NOT_FOUND', contextResolution: ctxRes,
          favoriteContext: Object.freeze({ type: f.contextType, ref: mode === 'INTERNAL' || mode === 'TECHNICAL' ? f.contextRef : null }),
          currentAvailability: Object.freeze({ status: status || 'UNKNOWN', label: App.fmt.formatAvailability(status || 'UNKNOWN'), freshness: freshness.availability || 'UNKNOWN' }),
          currentCommercial: Object.freeze({ price: price ? price.value : null, priceState: price ? price.projectedState : 'UNKNOWN', priceFreshness: price ? price.freshness : null, priceLabel: price ? price.display.primaryText : MESSAGES.orphan, priceNote: price && price.display.stateLabel && price.display.showValue ? price.display.stateLabel : null }),
          collections: Object.freeze((f.collectionIds || []).map(id => collById(id)).filter(c => c && c.lifecycleStatus === 'ACTIVE').map(c => Object.freeze({ id: c.id, title: c.title }))),
          notePreview: mode === 'INTERNAL' && f.note ? f.note.slice(0, 80) : undefined, createdAt: f.createdAt, stateFlags: Object.freeze(flags), warnings: Object.freeze(warnings),
          actions: Object.freeze(mode === 'CLIENT' || mode === 'SHARE' ? [] : ['locate', 'open', 'compare', 'simulate', f.lifecycleStatus === 'ACTIVE' ? 'remove' : 'restore', 'addToCollection', 'share']) };
        if (mode === 'TECHNICAL') Object.assign(rm, { technical: Object.freeze({ recordRevision: f.recordRevision, serverRevision: f.serverRevision, syncState: f.syncState, source: f.source }) });
        if (mode === 'CLIENT' || mode === 'SHARE') { delete rm.notePreview; delete rm.favoriteId; }
        return Object.freeze(rm);
      });
    }
    /** listItems(query, { mode, sort }) → FavoriteListItemViewModel[] (sorted; unknown prices last via topic 37, never 0) */
    function listItems(q = {}, a = {}) {
      const r = list(q); if (!r.ok) return r;
      let rms = readModels(r.items, a);
      const sort = q.sort || 'RECENTLY_ADDED';
      if (sort === 'CURRENT_PRICE_ASC' || sort === 'CURRENT_PRICE_DESC') {
        const cmp = DS().comparator(sort === 'CURRENT_PRICE_ASC' ? 'asc' : 'desc', { unknown: 'LAST' });
        rms = rms.map(x => ({ id: x.lotId, x, resolved: { projectedState: x.currentCommercial.priceState, value: x.currentCommercial.price } })).sort(cmp).map(y => y.x);
      } else if (sort === 'CURRENT_STATUS') { const ord = App.enums.AVAILABILITY_ORDER; rms = rms.slice().sort((a1, b1) => ord.indexOf(a1.currentAvailability.status) - ord.indexOf(b1.currentAvailability.status) || a1.lotId.localeCompare(b1.lotId, 'pt-BR', { numeric: true })); }
      return { ok: true, items: rms.map(x => Object.freeze({ favoriteId: x.favoriteId, lotId: x.lotId, label: x.identityLabel, currentPriceLabel: x.currentCommercial.priceLabel, priceNote: x.currentCommercial.priceNote,
        currentAvailabilityLabel: x.currentAvailability.label, availabilityStatus: x.currentAvailability.status, stateFlags: x.stateFlags, notePreview: x.notePreview, collectionLabels: x.collections.map(c => c.title), actions: x.actions, orphan: x.entityResolution !== 'RESOLVED', isFavorite: x.isFavorite })) };
    }
    /** statusSummary(favorites) → FavoriteCollectionStatusSummary + price range of KNOWN prices with an explicit unknown count (no zeros) */
    function statusSummary(favs) {
      const rms = readModels(favs), s = { total: rms.length, available: 0, reserved: 0, proposal: 0, blocked: 0, sold: 0, unavailable: 0, unknown: 0 }, prices = [];
      const K = { AVAILABLE: 'available', RESERVED: 'reserved', PROPOSAL: 'proposal', BLOCKED: 'blocked', SOLD: 'sold', UNAVAILABLE: 'unavailable', UNKNOWN: 'unknown' };
      for (const r of rms) { s[K[r.currentAvailability.status] || 'unknown']++; if (r.currentCommercial.priceState === 'KNOWN' && typeof r.currentCommercial.price === 'number') prices.push(r.currentCommercial.price); }
      return Object.freeze({ ...s, price: Object.freeze({ min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null, knownCount: prices.length, unknownCount: rms.length - prices.length }) });
    }

    // ------------------------------------------------ projections for sharing (no notes, no owner, snapshot-safe)
    function shareProjection(collId, a = {}) {
      const c = collById(collId); if (!c) return { ok: false, code: 'FAVORITE_COLLECTION_NOT_FOUND' };
      if (c.visibility === 'PRIVATE' && !a.explicit) return { ok: false, code: 'FAVORITE_PERMISSION_DENIED' };
      const s = snapshotCollection(collId, { purpose: 'SHARE' }); if (!s.ok) return s;
      return { ok: true, projection: Object.freeze({ title: c.title, snapshotChecksum: s.snapshot.checksum, items: s.snapshot.itemRefs.map(i => Object.freeze({ lotId: i.lotId, sortOrder: i.sortOrder })) }) };
    }

    // ------------------------------------------------ integrity + diagnostics
    function validate(knownLotIds) {
      const errors = [], warnings = [], seen = new Map();
      for (const f of snap.favorites) {
        if (f.organizationId !== principal.organizationId) errors.push({ code: 'FAVORITE_TENANT_MISMATCH', favoriteId: f.id });
        if (f.userId !== principal.userId) errors.push({ code: 'FAVORITE_USER_MISMATCH', favoriteId: f.id });
        if (f.developmentId !== devId) errors.push({ code: 'FAVORITE_DEVELOPMENT_MISMATCH', favoriteId: f.id });
        if (knownLotIds && !knownLotIds.has(f.entityId)) warnings.push({ code: 'FAVORITE_ORPHANED_ENTITY', favoriteId: f.id });
        if (!(f.recordRevision >= 1)) errors.push({ code: 'FAVORITE_REVISION_CONFLICT', favoriteId: f.id });
        if (f.lifecycleStatus === 'ACTIVE') { const k = keyString(identityKey(f, { type: f.contextType, ref: f.contextRef }, f.entityId)); if (seen.has(k)) errors.push({ code: 'FAVORITE_DUPLICATE_ACTIVE_KEY', favoriteId: f.id }); seen.set(k, f.id); }
        for (const cid of f.collectionIds || []) if (!collById(cid)) errors.push({ code: 'FAVORITE_COLLECTION_NOT_FOUND', favoriteId: f.id, collectionId: cid });
      }
      for (const i of snap.items) if (!byId(i.favoriteId) || !collById(i.collectionId)) errors.push({ code: 'FAVORITE_COLLECTION_NOT_FOUND', itemId: i.id });
      return { ok: !errors.length, errors, warnings };
    }
    function diagnostics(knownLotIds) {
      return Object.freeze({ organizationId: principal.organizationId, userId: principal.userId, activeFavoriteCount: snap.favorites.filter(f => f.lifecycleStatus === 'ACTIVE').length, removedFavoriteCount: snap.favorites.filter(f => f.lifecycleStatus === 'REMOVED').length,
        collectionCount: snap.collections.filter(c => c.lifecycleStatus !== 'DELETED').length, unresolvedEntityCount: knownLotIds ? snap.favorites.filter(f => !knownLotIds.has(f.entityId)).length : null,
        unresolvedContextCount: null, pendingSyncCount: snap.queue.filter(m => m.status === 'PENDING' || m.status === 'FAILED').length, syncConflictCount: snap.conflicts.filter(c => !c.resolution).length,
        legacyMigratedCount: snap.favorites.filter(f => f.source === 'MIGRATION').length, unresolvedLegacyCount: snap.unresolvedLegacy.length, generatedAt: now() });
    }

    // ------------------------------------------------ sync (FavoriteSyncService): queue replay against a remote with server revisions
    /** sync(remote?) → { ok, sent, conflicts, failed } — replays in order, only under the same principal; toggles follow the server
        revision, note conflicts are recorded and never overwritten. remote.apply(mutation) → { ok, serverRevision, remoteState } | { conflict, conflictType, remoteState } | { ok:false, code } */
    async function sync(remote = o.remote, ctx = {}) {
      if (!remote) return { ok: false, code: 'NO_REMOTE', sent: 0, conflicts: 0, failed: 0 };
      if (ctx.principal && (ctx.principal.organizationId !== principal.organizationId || ctx.principal.userId !== principal.userId)) return { ok: false, code: 'FAVORITE_USER_MISMATCH', sent: 0, conflicts: 0, failed: 0 };
      let sent = 0, conflicts = 0, failed = 0;
      for (const m of snap.queue) {
        if ((m.status !== 'PENDING' && m.status !== 'FAILED') || m.blockedByConflict) continue; // a conflicted mutation waits for an explicit decision
        if (m.organizationId !== principal.organizationId || m.userId !== principal.userId) { m.status = 'FAILED'; m.error = 'PRINCIPAL_MISMATCH'; failed++; continue; }
        m.status = 'SYNCING'; m.attemptCount++; m.lastAttemptAt = now();
        { const cur = byId(m.command.favoriteId); m.command.expectedServerRevision = cur ? cur.serverRevision : null; } // the base this device last saw from the server
        let r; try { r = await remote.apply(clone(m)); } catch (e) { m.status = 'FAILED'; m.error = 'NETWORK'; failed++; break; } // keep order: stop on network failure
        const f = byId(m.command.favoriteId);
        if (r && r.ok) { m.status = 'COMPLETED'; sent++; if (f) setSync(f, r.serverRevision, 'SYNCED'); continue; }
        if (r && r.conflict) {
          conflicts++; if (f) setSync(f, null, 'CONFLICT'); const local = f ? clone(f) : null, c = { id: idGen('fsc'), favoriteId: m.command.favoriteId, localRevision: f ? f.recordRevision : null, remoteRevision: r.remoteState ? r.remoteState.serverRevision : null,
            conflictType: r.conflictType || 'ADD_REMOVE', localState: local, remoteState: r.remoteState || null, resolution: null, detectedAt: now() };
          if (c.conflictType === 'ADD_REMOVE' && r.remoteState && f) { // toggle: the server order wins (no client clocks)
            const next = replace(f, { lifecycleStatus: r.remoteState.lifecycleStatus, removedAt: r.remoteState.removedAt || null, serverRevision: r.remoteState.serverRevision, syncState: 'SYNCED' });
            transition(next, f.lifecycleStatus, next.lifecycleStatus, 'SYNC_SERVER_REVISION'); c.resolution = 'SERVER_REVISION'; m.status = 'COMPLETED'; bumpSet();
          } else { if (f) replace(f, { syncState: 'CONFLICT' }); m.status = 'FAILED'; m.error = 'FAVORITE_SYNC_CONFLICT'; m.blockedByConflict = c.id; } // NOTE_NOTE etc.: kept for review
          snap.conflicts.push(c); continue;
        }
        m.status = 'FAILED'; m.error = (r && r.code) || 'REJECTED'; failed++; if (f) replace(f, { syncState: 'ERROR' });
      }
      snap.queue = snap.queue.filter(m => m.status !== 'COMPLETED').concat([]); await persist();
      return { ok: !failed && !conflicts, sent, conflicts, failed };
    }
    function setSync(f, serverRevision, state) { const cur = byId(f.id); const next = Object.freeze({ ...cur, serverRevision: serverRevision != null ? serverRevision : cur.serverRevision, syncState: state }); snap.favorites = snap.favorites.map(x => x.id === f.id ? next : x); }
    /** resolveConflict(conflictId, 'KEEP_LOCAL' | 'KEEP_REMOTE') — explicit human decision for note conflicts */
    function resolveConflict(id, choice) {
      const c = snap.conflicts.find(x => x.id === id); if (!c || c.resolution) return { ok: false, code: 'FAVORITE_NOT_FOUND' };
      const f = byId(c.favoriteId); if (!f) return { ok: false, code: 'FAVORITE_NOT_FOUND' };
      if (choice === 'KEEP_REMOTE' && c.remoteState) replace(f, { note: c.remoteState.note == null ? null : c.remoteState.note, serverRevision: c.remoteState.serverRevision, syncState: 'SYNCED' });
      else { const next = replace(f, { serverRevision: c.remoteState ? c.remoteState.serverRevision : f.serverRevision, syncState: 'PENDING_UPLOAD' }); snap.queue = snap.queue.filter(m => m.command.favoriteId !== f.id); enqueue({ type: 'UpdateFavoriteNote', favoriteId: f.id, expectedRevision: next.serverRevision, note: next.note, force: true }, next); }
      c.resolution = choice; persist(); return { ok: true };
    }

    // ------------------------------------------------ lifecycle of the service
    const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
    /** dispose({ purge }) — tenant switch / logout: stop answering, optionally wipe this namespace from the device */
    async function dispose(a = {}) { disposed = true; subs.clear(); ephemeral.clear(); await saving; if (a.purge) await backend.remove(ns); snap = emptySnapshot(); }
    async function reload() { const s = await backend.load(ns); if (s && s.schemaVersion === SCHEMA_VERSION) snap = { ...emptySnapshot(), ...s }; bumpSet(); return api; }
    const api = {
      principal, developmentId: devId, namespace: ns, ready, backendKind: backend.kind, flush: () => saving, lastSaveError: () => lastSaveError,
      add, remove, restore, archive, toggle, updateNote, copyToContext, list, isFavorite, setProjection, projectionCacheKey, get: byId,
      createCollection, renameCollection, archiveCollection, deleteCollection, restoreCollection, addToCollection, removeFromCollection, reorder, collectionItems, listCollections, getCollection: collById,
      snapshotCollection, captureSnapshotRef, readModels, listItems, statusSummary, shareProjection, validate, diagnostics, sync, resolveConflict, subscribe, dispose, reload,
      pendingMutations: () => snap.queue.map(m => Object.freeze(clone(m))), conflicts: () => snap.conflicts.map(c => Object.freeze(clone(c))), transitions: () => snap.transitions.slice(),
      unresolvedLegacy: () => snap.unresolvedLegacy.slice(), migrationVersion: () => snap.meta.favoriteMigrationVersion,
      // internal hooks for the migration adapter (same module)
      _markMigrated: (version, unresolved) => { snap.unresolvedLegacy = unresolved; snap.meta.favoriteMigrationVersion = version; return persist(); }
    };
    return api;
  }

  // ---------------------------------------------------------------- LegacyFavoriteMigrationAdapter
  /** LEGACY_KEYS — only keys whose semantics are "favorites" (vj-sel = current lot, comparisonLotIds = comparison: never migrated) */
  const LEGACY_KEYS = Object.freeze(['ws:{dev}:state#prefs.favorites', 'ws-state#s.favorites', 'vj-favs']);
  /** readLegacy({ storage, developmentId, restored }) → [{ ref, sourceKey, savedAt }] in original order (raw, unresolved) */
  function readLegacy({ storage, developmentId, restored } = {}) {
    const out = [], get = k => { try { const v = storage && storage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
    const push = (arr, sourceKey, savedAt) => { if (Array.isArray(arr)) for (const r of arr) if (typeof r === 'string' && r.trim()) out.push({ ref: r.trim(), sourceKey, savedAt: savedAt || null }); };
    if (restored && Array.isArray(restored.ids)) push(restored.ids, 'store.restore', restored.savedAt);
    const v3 = get(`ws:${developmentId}:state`); if (v3 && v3.prefs) push(v3.prefs.favorites, `ws:${developmentId}:state`, v3.savedAt);
    const v2 = get('ws-state'); if (v2 && v2.v === 2 && v2.s && (v2.s.developmentId || developmentId) === developmentId) push(v2.s.favorites, 'ws-state', null);
    push(get('vj-favs'), 'vj-favs', null);
    return out;
  }
  /** migrateLegacy(service, { storage, restored, resolveLot }) → report — idempotent (marker favoriteMigrationVersion), lossless:
      every legacy ref becomes a PERSONAL favorite (source MIGRATION) or an UNRESOLVED_LEGACY_FAVORITE entry kept in the repository. */
  async function migrateLegacy(service, o = {}) {
    await service.ready;
    if (service.migrationVersion() >= MIGRATION_VERSION) return Object.freeze({ skipped: true, version: service.migrationVersion(), migrated: 0, alreadyFavorite: 0, unresolved: service.unresolvedLegacy(), sources: [] });
    const raw = readLegacy({ storage: o.storage, developmentId: service.developmentId, restored: o.restored }), resolve = o.resolveLot;
    const seen = new Set(), unresolved = [], sources = [...new Set(raw.map(r => r.sourceKey))]; let migrated = 0, already = 0, duplicates = 0;
    for (const r of raw) {
      const lot = resolve ? resolve(r.ref) : null, id = lot ? lot.identity.id : null;
      if (!id) { if (!unresolved.some(u => u.legacyRef === r.ref)) unresolved.push(Object.freeze({ code: 'UNRESOLVED_LEGACY_FAVORITE', legacyRef: r.ref, sourceKey: r.sourceKey })); continue; }
      if (seen.has(id)) { duplicates++; continue; } seen.add(id);
      if (service.isFavorite(id)) { already++; continue; }
      const res = service.add(id, { source: 'MIGRATION', createdAt: r.savedAt || undefined, metadata: { legacyRef: r.ref, legacyKey: r.sourceKey, timestampSource: r.savedAt ? 'LEGACY_SAVED_AT' : 'MIGRATION_TIME' } });
      if (res.ok && res.created) migrated++; else if (res.ok) already++;
    }
    await service.flush();
    if (service.lastSaveError()) return Object.freeze({ skipped: false, completed: false, error: 'PERSIST_FAILED', migrated, alreadyFavorite: already, duplicates, unresolved, sources }); // marker only after a successful import
    await service._markMigrated(MIGRATION_VERSION, unresolved);
    return Object.freeze({ skipped: false, completed: !service.lastSaveError(), version: MIGRATION_VERSION, legacyCount: raw.length, migrated, alreadyFavorite: already, duplicates, unresolved: Object.freeze(unresolved), sources });
  }

  // ---------------------------------------------------------------- store bridge (keeps the old store API working)
  /** bindStore(store, service, { context, source }) — store.favorites (array of lot ids) stays the FavoriteSetProjection of the
      active context, so map overlay, filter "Só favoritos", Quick View and the old toggleFav keep working unchanged. A UI write
      to store.favorites is diffed and turned into add/remove commands; nothing is lost when the store drops unknown ids. */
  function bindStore(store, service, o = {}) {
    let ctx = normalizeContext(o.context || PERSONAL), writing = false, last = service.setProjection(ctx).lotIds.slice();
    const push = () => { const ids = service.setProjection(ctx).lotIds.slice(); last = ids; const cur = store.get().favorites || []; if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return; writing = true; try { store.set({ favorites: ids }); } finally { writing = false; } };
    const offStore = store.subscribe(keys => {
      if (writing || !keys.has('favorites')) return;
      const now = Array.isArray(store.get().favorites) ? store.get().favorites : [], prev = new Set(last), nxt = new Set(now);
      for (const id of now) if (!prev.has(id)) service.add(id, { context: ctx, source: o.source || 'OTHER' });
      for (const id of last) if (!nxt.has(id)) service.remove(id, { context: ctx });
      push();
    });
    const offSvc = service.subscribe(() => { if (!writing) push(); });
    push();
    return Object.freeze({ setContext: c => { const n = normalizeContext(c); if (n) { ctx = n; push(); } return ctx; }, context: () => ctx, refresh: push, unbind: () => { offStore(); offSvc(); } });
  }

  // ---------------------------------------------------------------- in-memory server stand-in (tests, demos): server revisions, idempotency
  function createMemoryRemote() {
    const records = new Map(), idem = new Map(); let rev = 0;
    function apply(m) {
      if (idem.has(m.idempotencyKey)) return idem.get(m.idempotencyKey);
      const c = m.command, cur = records.get(c.favoriteId) || null; let r;
      const put = patch => { rev++; const next = { ...(cur || { favoriteId: c.favoriteId, lifecycleStatus: 'ACTIVE', note: null }), ...patch, serverRevision: rev }; records.set(c.favoriteId, next); return { ok: true, serverRevision: rev, remoteState: { ...next } }; };
      const base = c.expectedServerRevision == null ? 0 : c.expectedServerRevision, isNote = c.type === 'UpdateFavoriteNote', isLife = /^(Add|Remove|Restore|Archive)Favorite$/.test(c.type);
      // conflicts are judged by server order, never by client clocks: a note written on top of a newer server write, or a
      // lifecycle intent on top of a newer lifecycle change made by another device
      if (cur && !c.force && isNote && cur.serverRevision > base) r = { conflict: true, conflictType: cur.lifecycleStatus === 'ACTIVE' ? 'NOTE_NOTE' : 'DELETE_UPDATE', remoteState: { ...cur } };
      else if (cur && !c.force && isLife && (cur.lifecycleRevision || 0) > base) r = { conflict: true, conflictType: 'ADD_REMOVE', remoteState: { ...cur } };
      else if (c.type === 'AddFavorite' || c.type === 'RestoreFavorite') r = put({ lifecycleStatus: 'ACTIVE', removedAt: null, lifecycleRevision: rev + 1 });
      else if (c.type === 'RemoveFavorite' || c.type === 'ArchiveFavorite') r = put({ lifecycleStatus: c.type === 'RemoveFavorite' ? 'REMOVED' : 'ARCHIVED', removedAt: m.createdAt, lifecycleRevision: rev + 1 });
      else if (isNote) r = put({ note: c.note });
      else r = put({});
      idem.set(m.idempotencyKey, r); return r;
    }
    return { apply: async m => apply(m), state: id => records.get(id) || null, records, serverEdit: (id, patch) => { rev++; records.set(id, { ...(records.get(id) || { favoriteId: id, lifecycleStatus: 'ACTIVE', note: null }), ...patch, ...('lifecycleStatus' in patch ? { lifecycleRevision: rev } : {}), serverRevision: rev }); return rev; } };
  }

  return Object.freeze({ ContextType, Source, Lifecycle, CollectionContextType, CollectionVisibility, CollectionLifecycle, SyncState, MutationState, EntityResolution, ContextResolution, Sort, ViewMode, StateFlag,
    ProjectionMode, SyncConflictType, EventType, Errors, Warnings, PERMISSIONS, MESSAGES, SCHEMA_VERSION, MIGRATION_VERSION, LEGACY_KEYS, PERSONAL,
    identityKey, keyString, normalizeContext, nsKey, memoryBackend, storageBackend, idbBackend, pickBackend, createService, readLegacy, migrateLegacy, bindStore, createMemoryRemote, hash });
})();

/* ---- presentation/favoritesView.js ---- */
/* presentation/favoritesView.js — UI of topics 37/38 as pure functions returning HTML strings (no DOM, no storage).
   - toggleButton: persistent star toggle (☆ Favoritar / ★ Favoritado), aria-pressed + aria-label, never colour alone.
   - contextChip: which favorites context is active ("Meus favoritos" / "Favoritos de Maria"); switching is explicit.
   - list: favorites panel/sheet (same markup on desktop tab, tablet and mobile bottom sheet); current status and price
     come from the read model (live), a sold lot stays listed with "Vendido", an unknown price reads "Preço não disponível".
   - undoToast: removal is a domain remove; "Desfazer" calls restore.
   - dataValue: one field rendered from a topic 37 ResolvedAttributeValue (value, state label, stale overlay, aria text).
   The lead wires these in app.js/panels.js (docs/FAVORITES_UI_INTEGRATION.md). */
App.favoritesView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FLAG_LABEL = { SOLD: 'Vendido', RESERVED: 'Reservado', UNAVAILABLE: 'Indisponível', PRICE_UNKNOWN: 'Preço não disponível', PRICE_CHANGED: 'Preço mudou desde que foi favoritado',
    STATUS_CHANGED: 'Status mudou desde que foi favoritado', STALE_COMMERCIAL_DATA: 'Preço a confirmar', HAS_CRITICAL_ALERT: 'Alerta crítico', ORPHANED: 'Lote não encontrado na versão atual', ANALYSIS_UPDATED: 'Análise atualizada' };
  /** toggleButton({ lotId, isFavorite, contextLabel, compact }) — data-act="fav" (existing action) */
  function toggleButton({ lotId, isFavorite, contextLabel, compact } = {}) {
    const label = isFavorite ? App.favorites.MESSAGES.remove : App.favorites.MESSAGES.add;
    const text = isFavorite ? '★ Favoritado' : '☆ Favoritar';
    return `<button type="button" class="fav-toggle${isFavorite ? ' on' : ''}" data-act="fav" data-id="${esc(lotId)}" aria-pressed="${isFavorite ? 'true' : 'false'}" aria-label="${esc(label + (contextLabel ? ' — ' + contextLabel : ''))}">${compact ? (isFavorite ? '★' : '☆') : text}</button>`;
  }
  /** contextChip(activeContext) — the context switcher (proposed action "favCtx") is added by the lead with its features.json entry */
  const contextChip = ctx => `<span class="fav-ctx" role="status">${esc(ctx ? ctx.label : 'Meus favoritos')}</span>`;
  /** list(items, { context, client, count }) — items = service.listItems(...).items */
  function list(items, o = {}) {
    const ctx = o.context, empty = ctx && ctx.type === 'CUSTOMER' ? App.favorites.MESSAGES.emptyCustomer : App.favorites.MESSAGES.empty;
    let h = `<section class="fav-panel" aria-label="Favoritos"><header class="fav-head"><h2 class="fav-title">Favoritos</h2>${contextChip(ctx)}<span class="fav-count">${items.length} ${items.length === 1 ? 'favorito' : 'favoritos'}</span></header>`;
    if (!items.length) return h + `<p class="fav-empty">${esc(empty)}</p></section>`;
    h += '<ul class="fav-list">';
    for (const it of items) {
      const flags = it.stateFlags.filter(f => FLAG_LABEL[f] && f !== 'PRICE_UNKNOWN').map(f => `<span class="fav-flag fav-flag-${esc(f.toLowerCase())}">${esc(FLAG_LABEL[f])}</span>`).join('');
      h += `<li class="fav-item${it.orphan ? ' orphan' : ''}" data-lot="${esc(it.lotId)}"><div class="fav-main"><button type="button" class="fav-name" data-act="goLot" data-id="${esc(it.lotId)}">${esc(it.label)}</button>`
        + `<p class="fav-meta"><span class="fav-status">${esc(it.orphan ? FLAG_LABEL.ORPHANED : it.currentAvailabilityLabel)}</span> · <span class="fav-price">${esc(it.currentPriceLabel)}</span>${it.priceNote ? ` <span class="fav-note-stale">(${esc(it.priceNote)})</span>` : ''}</p>`
        + (flags ? `<p class="fav-flags">${flags}</p>` : '') + (!o.client && it.notePreview ? `<p class="fav-note">${esc(it.notePreview)}</p>` : '') + (it.collectionLabels.length ? `<p class="fav-colls">${it.collectionLabels.map(esc).join(' · ')}</p>` : '') + '</div>';
      if (!o.client && !it.orphan) h += `<div class="fav-actions"><button type="button" data-act="cmp" data-id="${esc(it.lotId)}">Comparar</button>${toggleButton({ lotId: it.lotId, isFavorite: it.isFavorite, compact: true })}</div>`;
      h += '</li>';
    }
    return h + '</ul></section>';
  }
  /** undoToast(lotId) — "Favorito removido. Desfazer": the existing "fav" action re-adds, which reactivates the same record (restore) */
  const undoToast = lotId => `<div class="fav-toast" role="status" aria-live="polite">${esc(App.favorites.MESSAGES.removedUndo)} <button type="button" data-act="fav" data-id="${esc(lotId)}">${esc(App.favorites.MESSAGES.undo)}</button></div>`;
  /** syncNotice(kind) — only when relevant (offline / rollback); technical sync states are not shown to brokers */
  const syncNotice = kind => kind === 'LOCAL' ? `<p class="fav-sync" role="status">${esc(App.favorites.MESSAGES.syncFailedLocal)}</p>` : kind === 'FAILED' ? `<p class="fav-sync err" role="alert">${esc(App.favorites.MESSAGES.saveFailed)}</p>` : '';
  /** dataValue(label, resolved) — topic 37 field rendering; HIDDEN (null) renders nothing */
  function dataValue(label, r) {
    if (!r || r.projectedState === 'HIDDEN') return '';
    const d = r.display;
    return `<div class="ds-field ${esc(d.semanticToken)}" data-state="${esc(r.projectedState)}"><dt>${esc(label)}</dt><dd aria-label="${esc(d.ariaText)}">${esc(d.primaryText)}${d.showValue && d.stateLabel ? ` <span class="ds-stale">${esc(d.stateLabel)}</span>` : ''}${d.secondaryText && !d.showValue ? ` <span class="ds-reason">${esc(d.secondaryText)}</span>` : ''}</dd></div>`;
  }
  return Object.freeze({ toggleButton, contextChip, list, undoToast, syncNotice, dataValue, FLAG_LABEL });
})();

/* ---- chunk end ---- */
App.chunks._done("favorites");
