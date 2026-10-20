/* pwa/sync.js — topic 49 §99–§131, §183–§188, §296–§306, §364–§365, §371, §376: offline mutations.
   Not every action can wait for the network. OfflineMutationPolicy decides per mutation type (§101):
     DENY_OFFLINE            reserve, propose, change availability/price/permissions, create/revoke share, journey stage (§102, §124–§128)
     QUEUE_IDEMPOTENT        desired-state operations (favorite SET/UNSET, §121/§122) — only when a backend transport exists
     QUEUE_WITH_REVALIDATION drafts (customer note, follow-up, presentation feedback) — OFF until the domain approves (§104/§105)
     LOCAL_ONLY              local preferences and LOCAL_OFFLINE_COMPARISON (never synced as a server session, §161/§162)
   There is NO generic POST queue (§201, §352) and the Service Worker never replays business mutations (§130).
   PendingMutationStore (IndexedDB `ws-pwa-queue`, memory fallback) is partitioned by organizationId + userId (§107, §187): user B never
   sees nor synchronizes user A's queue (§186, §188). Payloads are checked for secrets/tokens (§108).
   SyncCoordinator: enqueue / syncPending / getPending / discard (§112). Same entity → strict order; independent entities → parallel (§113–§116).
   Before each commit: authenticated, same tenant/user, permission still present, not expired, base version revalidated (§117, §183, §184).
   Conflicts are never last-write-wins (§119): USER_REVIEW_REQUIRED keeps the mutation and explains it (§299). Idempotency keys make a
   retried sync safe (§305/§306). Background Sync is optional; the fallback is foreground / reconnect / manual retry (§111, §251, §371).
   Product analytics events keep their own buffer (topic 45): classification ANALYTICS_BUFFER ≠ OFFLINE_BUSINESS_MUTATION ≠ PWA_ASSET_UPDATE (§131).
   Today there is no backend: no transport is configured, so queueable mutations are refused with a clear message instead of piling up. */
App.pwa = App.pwa || {};
App.pwa.sync = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const MutationMode = E('DENY_OFFLINE', 'QUEUE_IDEMPOTENT', 'QUEUE_WITH_REVALIDATION', 'LOCAL_ONLY');
  const ConflictState = E('NO_CONFLICT', 'AUTO_MERGED', 'USER_REVIEW_REQUIRED', 'REJECTED', 'EXPIRED');
  const SyncEventClass = E('ANALYTICS_BUFFER', 'OFFLINE_BUSINESS_MUTATION', 'PWA_ASSET_UPDATE');
  const QUEUE_SCHEMA_VERSION = '1';
  const DAY = 24 * 3600e3;
  const M = (mutationType, mode, o = {}) => Object.freeze({ mutationType, mode, requiresUserConfirmationOnSync: false, conflictPolicyRef: undefined, maxQueueAgeMs: undefined, enabled: true, ...o });
  const POLICIES = Object.freeze({
    'lot.reserve': M('lot.reserve', 'DENY_OFFLINE'), 'proposal.submit': M('proposal.submit', 'DENY_OFFLINE'), 'availability.change': M('availability.change', 'DENY_OFFLINE'),
    'price_table.publish': M('price_table.publish', 'DENY_OFFLINE'), 'price.change': M('price.change', 'DENY_OFFLINE'), 'permission.change': M('permission.change', 'DENY_OFFLINE'),
    'share.create': M('share.create', 'DENY_OFFLINE'), 'share.revoke': M('share.revoke', 'DENY_OFFLINE'), 'journey.stage_change': M('journey.stage_change', 'DENY_OFFLINE'),
    'customer.edit': M('customer.edit', 'DENY_OFFLINE', { notes: 'edição de cliente não é enfileirável por padrão (§105).' }),
    'favorite.set': M('favorite.set', 'QUEUE_IDEMPOTENT', { conflictPolicyRef: 'desired-final-state', maxQueueAgeMs: 30 * DAY }),
    'favorite.unset': M('favorite.unset', 'QUEUE_IDEMPOTENT', { conflictPolicyRef: 'desired-final-state', maxQueueAgeMs: 30 * DAY }),
    'ui.preference': M('ui.preference', 'LOCAL_ONLY'), 'comparison.local': M('comparison.local', 'LOCAL_ONLY', { notes: 'LOCAL_OFFLINE_COMPARISON' }),
    'customer.note_draft': M('customer.note_draft', 'QUEUE_WITH_REVALIDATION', { enabled: false, requiresUserConfirmationOnSync: true, conflictPolicyRef: 'user-review', maxQueueAgeMs: 3 * DAY }),
    'followup.complete_draft': M('followup.complete_draft', 'QUEUE_WITH_REVALIDATION', { enabled: false, requiresUserConfirmationOnSync: true, conflictPolicyRef: 'user-review', maxQueueAgeMs: 3 * DAY }),
    'presentation.feedback': M('presentation.feedback', 'QUEUE_WITH_REVALIDATION', { enabled: false, conflictPolicyRef: 'snapshot-still-valid', maxQueueAgeMs: 14 * DAY })
  });
  /** unknown mutation types are denied offline (deny by default) */
  const policyOf = (type, overrides = {}) => overrides[type] || POLICIES[type] || M(type, 'DENY_OFFLINE', { notes: 'tipo sem política: negado offline.' });
  const MESSAGES = {
    ONLINE_REQUIRED: 'Esta ação precisa de conexão. Tente novamente quando estiver online.', QUEUE_DISABLED: 'Esta alteração só pode ser feita online.',
    NO_TRANSPORT: 'Sincronização com o servidor ainda não está disponível; a alteração ficou só neste aparelho.', SECRET_IN_PAYLOAD: 'Conteúdo não permitido na fila offline.',
    CONFLICT: 'Esta informação foi alterada no servidor enquanto você estava offline. Revise antes de continuar.', SYNCED: 'Sincronizado', RETRY: 'Tentar novamente'
  };
  const SECRET_KEY = /(token|password|senha|secret|authorization|cookie|bearer|session|cpf|email|phone|telefone)/i;
  const SECRET_VAL = /(^eyJ[A-Za-z0-9_-]{8,}\.|^Bearer\s|^st_[A-Za-z0-9_-]{16,}|\/s\/[A-Za-z0-9_-]{20,})/;
  function hasSecret(v, depth = 0) {
    if (depth > 6 || v == null) return false;
    if (typeof v === 'string') return SECRET_VAL.test(v);
    if (Array.isArray(v)) return v.some(x => hasSecret(x, depth + 1));
    if (typeof v === 'object') return Object.entries(v).some(([k, x]) => SECRET_KEY.test(k) || hasSecret(x, depth + 1));
    return false;
  }
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const partitionOf = (org, user) => `${org}|${user}`;

  // ---------------------------------------------------------------- PendingMutationStore
  function MemoryMutationStore() {
    const m = new Map();
    return { kind: 'memory', persistent: false,
      async put(env) { m.set(env.mutationId, JSON.parse(JSON.stringify(env))); }, async delete(id) { m.delete(id); },
      async listPartition(p) { return [...m.values()].filter(e => e.partition === p).map(e => JSON.parse(JSON.stringify(e))); },
      async get(id) { const v = m.get(id); return v ? JSON.parse(JSON.stringify(v)) : null; }, async count() { return m.size; } };
  }
  function IdbMutationStore(idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = 'ws-pwa-queue') {
    if (!idb) throw new Error('IndexedDB indisponível');
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { const r = idb.open(name, 1); r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('mutations')) { const os = db.createObjectStore('mutations', { keyPath: 'mutationId' }); os.createIndex('partition', 'partition'); } }; r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); }; }));
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const db = await open(); const t = db.transaction('mutations', mode); const out = fn(t.objectStore('mutations')); await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); return out; };
    return { kind: 'indexeddb', persistent: true,
      async put(env) { await tx('readwrite', os => os.put(env)); }, async delete(id) { await tx('readwrite', os => os.delete(id)); },
      async listPartition(p) { const db = await open(); return req(db.transaction('mutations', 'readonly').objectStore('mutations').index('partition').getAll(p)); },
      async get(id) { const db = await open(); const v = await req(db.transaction('mutations', 'readonly').objectStore('mutations').get(id)); return v || null; },
      async count() { const db = await open(); return req(db.transaction('mutations', 'readonly').objectStore('mutations').count()); } };
  }

  // ---------------------------------------------------------------- SyncCoordinator
  /** transport(envelope) → { status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED', currentVersion? } (server honours idempotencyKey)
      revalidate(envelope) → { currentVersion } ; auth() → { organizationId, userId, authenticated, can(mutationType) } */
  function SyncCoordinator({ store = MemoryMutationStore(), auth, transport = null, revalidate = null, policies = {}, now = () => Date.now(), emit = null, idGen = null, onChange = null } = {}) {
    let seq = 0, running = null, paused = false, lastSuccessfulSyncAt = null;
    const tel = (n, d) => { try { (emit || App.pwa.core.emit)(n, d); } catch (e) { /* telemetry */ } };
    const who = () => { try { return auth && auth(); } catch (e) { return null; } };
    const changed = () => { if (onChange) try { onChange(); } catch (e) { /* ui */ } };
    /** classify(kind): analytics events never enter this queue (topic 45 buffer) */
    const classify = kind => kind === 'analytics' ? SyncEventClass.ANALYTICS_BUFFER : kind === 'asset' ? SyncEventClass.PWA_ASSET_UPDATE : SyncEventClass.OFFLINE_BUSINESS_MUTATION;
    /** enqueue(input) — input: { mutationType, entityType, entityId, payload, baseVersion?, desiredState? } */
    async function enqueue(input = {}, o = {}) {
      const pol = policyOf(input.mutationType, policies), p = who();
      if (classify(input.kind) !== SyncEventClass.OFFLINE_BUSINESS_MUTATION) return { ok: false, code: 'NOT_A_BUSINESS_MUTATION' };
      if (pol.mode === 'DENY_OFFLINE') return { ok: false, code: 'ONLINE_REQUIRED', message: MESSAGES.ONLINE_REQUIRED };
      if (pol.mode === 'LOCAL_ONLY') return { ok: true, local: true, queued: false };
      if (!pol.enabled) return { ok: false, code: 'QUEUE_DISABLED', message: MESSAGES.QUEUE_DISABLED };
      if (!p || !p.organizationId || !p.userId || p.authenticated === false) return { ok: false, code: 'LOGIN_REQUIRED', message: MESSAGES.ONLINE_REQUIRED };
      if (!transport && !o.allowWithoutTransport) return { ok: false, code: 'NO_TRANSPORT', message: MESSAGES.NO_TRANSPORT, local: true };
      if (hasSecret(input.payload) || hasSecret(input.entityId)) return { ok: false, code: 'SECRET_IN_PAYLOAD', message: MESSAGES.SECRET_IN_PAYLOAD };
      const createdAt = now(), partition = partitionOf(p.organizationId, p.userId);
      // desired final state: SET/UNSET of the same entity share one idempotency key family; the newest replaces the pending one (§122)
      const family = `${input.entityType}|${input.entityId}|${pol.conflictPolicyRef === 'desired-final-state' ? 'favorite' : input.mutationType}`;
      const idem = 'idk_' + fnv(`${partition}|${family}|${input.mutationType}|${JSON.stringify(input.payload || null)}|${input.baseVersion || ''}`);
      const pending = await store.listPartition(partition);
      if (pending.some(e => e.idempotencyKey === idem && !e.conflict)) return { ok: true, queued: false, duplicate: true, idempotencyKey: idem };
      if (pol.conflictPolicyRef === 'desired-final-state') for (const e of pending) if (e.family === family && !e.inFlight) await store.delete(e.mutationId);
      const env = { mutationId: idGen ? idGen() : `mut_${createdAt.toString(36)}_${(++seq).toString(36)}`, organizationId: p.organizationId, userId: p.userId, mutationType: input.mutationType,
        entityType: input.entityType, entityId: String(input.entityId), baseVersion: input.baseVersion == null ? undefined : String(input.baseVersion), payload: input.payload == null ? null : input.payload,
        createdAt: new Date(createdAt).toISOString(), idempotencyKey: idem, requiresRevalidation: pol.mode === 'QUEUE_WITH_REVALIDATION', securityClass: 'ORGANIZATION',
        expiresAt: pol.maxQueueAgeMs ? new Date(createdAt + pol.maxQueueAgeMs).toISOString() : undefined,
        // storage-only fields
        partition, family, seq: ++seq, schemaVersion: QUEUE_SCHEMA_VERSION, attempts: 0, conflict: null };
      await store.put(env); changed();
      tel('sync_queue_size', { count: pending.length + 1 });
      return { ok: true, queued: true, mutationId: env.mutationId, idempotencyKey: idem };
    }
    /** getPending(): only the active user's partition */
    async function getPending() { const p = who(); if (!p || !p.organizationId || !p.userId) return []; return (await store.listPartition(partitionOf(p.organizationId, p.userId))).sort((a, b) => a.seq - b.seq).map(publicView); }
    const publicView = e => { const { partition, family, seq: s, schemaVersion, attempts, inFlight, ...env } = e; return { ...env, conflictState: e.conflict ? e.conflict.resolution : ConflictState.NO_CONFLICT }; };
    async function discard(mutationId) { const p = who(); const e = await store.get(mutationId); if (!e || !p || e.partition !== partitionOf(p.organizationId, p.userId)) return { ok: false, code: 'NOT_FOUND' }; await store.delete(mutationId); changed(); return { ok: true }; }
    /** syncPending() → SyncResult { synced, duplicates, conflicts[], rejected[], expired[], pending, paused?, reason? } */
    function syncPending(trigger = 'manual') {
      if (running) return running;
      running = (async () => {
        const p = who(), res = { trigger, synced: 0, duplicates: 0, conflicts: [], rejected: [], expired: [], failed: 0, pending: 0 };
        if (!p || !p.organizationId || !p.userId || p.authenticated === false) return { ...res, paused: true, reason: 'NOT_AUTHENTICATED' }; // after logout: pause (§185)
        if (paused) return { ...res, paused: true, reason: 'PAUSED' };
        const part = partitionOf(p.organizationId, p.userId);
        const all = (await store.listPartition(part)).sort((a, b) => a.seq - b.seq);
        if (!transport) return { ...res, pending: all.length, paused: true, reason: 'NO_TRANSPORT' };
        const byEntity = new Map(); for (const e of all) { const k = `${e.entityType}|${e.entityId}`; if (!byEntity.has(k)) byEntity.set(k, []); byEntity.get(k).push(e); }
        // independent entities in parallel, same entity strictly in order: a failure stops that entity's chain (§113–§116)
        await Promise.all([...byEntity.values()].map(async chain => {
          for (const e of chain) {
            if (e.conflict && e.conflict.resolution === ConflictState.USER_REVIEW_REQUIRED) { res.conflicts.push(conflictOf(e)); return; } // waits for the user, blocks later ones of the same entity
            if (e.expiresAt && now() > +new Date(e.expiresAt)) { await store.delete(e.mutationId); res.expired.push({ mutationId: e.mutationId, conflictState: ConflictState.EXPIRED }); continue; }
            if (e.organizationId !== p.organizationId || e.userId !== p.userId) return; // defensive: never as another user (§186)
            if (typeof p.can === 'function' && !p.can(e.mutationType)) { await store.delete(e.mutationId); res.rejected.push({ mutationId: e.mutationId, conflictState: ConflictState.REJECTED, reason: 'PERMISSION_REVOKED' }); continue; }
            try {
              if (e.requiresRevalidation && revalidate) {
                const cur = await revalidate(publicView(e));
                if (cur && e.baseVersion != null && cur.currentVersion != null && String(cur.currentVersion) !== String(e.baseVersion)) {
                  e.conflict = { conflictType: 'VERSION_CHANGED', currentVersion: String(cur.currentVersion), resolution: ConflictState.USER_REVIEW_REQUIRED, at: new Date(now()).toISOString() };
                  await store.put(e); res.conflicts.push(conflictOf(e)); tel('sync_conflict', { kind: 'version' }); return;
                }
              }
              e.attempts++; await store.put(e);
              const r = await transport(publicView(e));
              if (r && (r.status === 'APPLIED' || r.status === 'DUPLICATE')) { await store.delete(e.mutationId); if (r.status === 'DUPLICATE') res.duplicates++; else res.synced++; continue; }
              if (r && r.status === 'CONFLICT') { e.conflict = { conflictType: r.conflictType || 'SERVER_CONFLICT', currentVersion: r.currentVersion, resolution: ConflictState.USER_REVIEW_REQUIRED, at: new Date(now()).toISOString() }; await store.put(e); res.conflicts.push(conflictOf(e)); tel('sync_conflict', { kind: 'server' }); return; }
              if (r && r.status === 'REJECTED') { await store.delete(e.mutationId); res.rejected.push({ mutationId: e.mutationId, conflictState: ConflictState.REJECTED, reason: r.reason || 'REJECTED' }); continue; }
              res.failed++; return;
            } catch (err) { res.failed++; return; } // network: stays queued, retried on reconnect/foreground/manual
          }
        }));
        res.pending = (await store.listPartition(part)).length;
        if (res.synced || res.duplicates) { lastSuccessfulSyncAt = new Date(now()).toISOString(); tel('sync_success', { count: res.synced }); }
        if (res.failed) tel('sync_failure', { count: res.failed });
        changed();
        return res;
      })().finally(() => { running = null; });
      return running;
    }
    const conflictOf = e => ({ mutationId: e.mutationId, entityType: e.entityType, entityId: e.entityId, baseVersion: e.baseVersion, currentVersion: e.conflict.currentVersion, conflictType: e.conflict.conflictType,
      resolution: e.conflict.resolution, message: MESSAGES.CONFLICT });
    /** user decisions on a conflict: discard, or re-base and retry (never automatic for commercial risk, §300) */
    async function resolveConflict(mutationId, decision) {
      const p = who(); const e = await store.get(mutationId);
      if (!e || !p || e.partition !== partitionOf(p.organizationId, p.userId)) return { ok: false, code: 'NOT_FOUND' };
      if (decision === 'DISCARD') { await store.delete(mutationId); changed(); return { ok: true }; }
      if (decision === 'REBASE_AND_RETRY' && e.conflict) { e.baseVersion = e.conflict.currentVersion; e.conflict = null; e.idempotencyKey = 'idk_' + fnv(e.idempotencyKey + '|' + e.baseVersion); await store.put(e); changed(); return { ok: true }; }
      return { ok: false, code: 'INVALID_DECISION' };
    }
    /** foreground / reconnect / manual triggers; Background Sync only as an extra wake-up (§110, §111) */
    function attachTriggers({ win = (typeof window !== 'undefined' ? window : null), connectivity = null, registration = null } = {}) {
      const offs = [];
      if (connectivity && connectivity.subscribe) offs.push(connectivity.subscribe((s, prev) => { if (s.effectiveState === 'ONLINE' && prev !== 'ONLINE') syncPending('reconnect'); }));
      const doc = win && win.document;
      if (doc && doc.addEventListener) { const h = () => { if (doc.visibilityState === 'visible') syncPending('foreground'); }; doc.addEventListener('visibilitychange', h); offs.push(() => doc.removeEventListener('visibilitychange', h)); }
      if (registration && registration.sync && typeof registration.sync.register === 'function') registration.sync.register('ws-sync').catch(() => {}); // optional
      return () => offs.forEach(f => { try { f(); } catch (e) { /* gone */ } });
    }
    /** logout: pause (default) or discard the user's queue when the policy says the queue is sensitive (§185) */
    async function onLogout({ discard: drop = false, organizationId, userId } = {}) {
      if (drop && organizationId && userId) { for (const e of await store.listPartition(partitionOf(organizationId, userId))) await store.delete(e.mutationId); }
      paused = !drop; changed(); return { paused: !drop };
    }
    function onLogin() { paused = false; changed(); }
    /** count + queue schema for the PwaUpdateCoordinator (§217–§219): an update never deletes this queue */
    async function pendingInfo() { const p = who(); if (!p || !p.organizationId || !p.userId) return { count: 0, schemaVersion: QUEUE_SCHEMA_VERSION }; return { count: (await store.listPartition(partitionOf(p.organizationId, p.userId))).length, schemaVersion: QUEUE_SCHEMA_VERSION }; }
    return { enqueue, syncPending, getPending, discard, resolveConflict, attachTriggers, onLogout, onLogin, pendingInfo, classify, lastSuccessfulSyncAt: () => lastSuccessfulSyncAt, policyOf: t => policyOf(t, policies) };
  }
  /** favorites adapter: a favorite command becomes a desired-state mutation (SET/UNSET), never a counter (§122) */
  const favoriteMutation = (lotId, active, context = 'personal') => ({ mutationType: active ? 'favorite.set' : 'favorite.unset', entityType: 'favorite', entityId: `${context}:${lotId}`, payload: { lotId, context, desiredState: active ? 'SET_FAVORITE' : 'UNSET_FAVORITE' } });
  /** offline mutation matrix for docs/UI (§345 report) */
  const matrix = () => Object.values(POLICIES).map(p => ({ mutationType: p.mutationType, mode: p.mode, enabled: p.enabled, conflictPolicyRef: p.conflictPolicyRef || null, maxQueueAgeDays: p.maxQueueAgeMs ? p.maxQueueAgeMs / DAY : null }));
  return Object.freeze({ MutationMode, ConflictState, SyncEventClass, QUEUE_SCHEMA_VERSION, POLICIES, MESSAGES, policyOf, hasSecret, MemoryMutationStore, IdbMutationStore, SyncCoordinator, favoriteMutation, matrix });
})();
