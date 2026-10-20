/* loading/coordinator.js — topic 47: the one place that executes loads.
   InFlightResourceRegistry (1 request, N consumers, ref-count) · LoadScheduler (priority + concurrency budget, user action
   preempts speculative work, backpressure) · LoadScopeRegistry (APPLICATION … ENTITY, cancel a scope and its children) ·
   LoadTransaction (stale-result protection: an old answer never overwrites the current context) · bounded retry (never 403,
   404 of a versioned artifact → refresh the pointer once) · ResourceStateRegistry (UI derives loading state from the resource
   it needs, not from scattered booleans) · LoadCoordinator (request / execute(plan) / cancelScope / switchContext) ·
   diagnostics (technical telemetry, aggregated, no PII, no ids of people).

   It does not decide freshness or reuse: when a CacheManager (topic 48) is given, the coordinator asks it (`cache.load`)
   and keeps ownership of priority and cancellation only. Loaders are injected (loaderId → function); nothing here knows URLs. */
App.loading = App.loading || {};
App.loading.coordinator = (() => {
  const R = App.loading.resources, S = R.ResourceLoadState, RANK = R.PRIORITY_RANK;
  const ser = k => (typeof k === 'string' ? k : R.serializeResourceKey(k));
  const nowIso = t => new Date(t).toISOString();
  class LoadError extends Error {
    constructor(code, message, extra = {}) { super(message); this.code = R.ErrorCode[code] ? code : 'UNKNOWN'; Object.assign(this, extra); this.retryable = extra.retryable != null ? extra.retryable : ['NETWORK', 'TIMEOUT'].includes(this.code); }
  }
  /** maps errors of the data layer (offline.js NetError, fetch errors) to ResourceLoadError codes */
  function classifyError(e) {
    if (!e) return { code: 'UNKNOWN', retryable: false };
    if (e instanceof LoadError) return { code: e.code, retryable: e.retryable, technicalMessage: e.message };
    const st = e.status;
    if (e.code === 'ABORTED' || e.name === 'AbortError') return { code: 'ABORTED', retryable: false, technicalMessage: e.message };
    if (st === 403 || st === 401 || e.code === 'FORBIDDEN') return { code: 'FORBIDDEN', retryable: false, technicalMessage: e.message };
    if (st === 404 || e.code === 'NOT_FOUND') return { code: 'NOT_FOUND', retryable: false, technicalMessage: e.message };
    if (e.code === 'TIMEOUT') return { code: 'TIMEOUT', retryable: true, technicalMessage: e.message };
    if (e.code === 'NETWORK' || e.network || (e.name === 'TypeError' && /fetch/i.test(e.message))) return { code: 'NETWORK', retryable: true, technicalMessage: e.message };
    if (st >= 500 || st === 429 || st === 408) return { code: 'NETWORK', retryable: true, technicalMessage: e.message };
    if (e.code === 'PARSE' || e.code === 'INVALID' || e.code === 'CACHE_CORRUPT') return { code: 'DECODE_ERROR', retryable: false, technicalMessage: e.message };
    if (e.code === 'VERSION_MISMATCH') return { code: 'VERSION_MISMATCH', retryable: false, technicalMessage: e.message };
    return { code: 'UNKNOWN', retryable: false, technicalMessage: e.message };
  }

  // ---------------------------------------------------------------- in-flight dedup
  /** getOrCreate(key, factory, { signal }) — same key while in flight → same underlying promise. Each consumer may abort its
      own wait; the underlying load is aborted only when no consumer is left and the resource allows it (abortWhenUnused). */
  function InFlightResourceRegistry() {
    const m = new Map(); let deduplicated = 0, created = 0;
    function getOrCreate(key, factory, o = {}) {
      const k = ser(key);
      let e = m.get(k);
      if (e) { deduplicated++; e.refs++; }
      else {
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        e = { refs: 1, ac, abortWhenUnused: o.abortWhenUnused !== false, promise: null };
        created++;
        e.promise = Promise.resolve().then(() => factory(ac ? ac.signal : undefined)).finally(() => { if (m.get(k) === e) m.delete(k); });
        m.set(k, e);
      }
      const entry = e;
      let released = false;
      const release = () => { if (released) return; released = true; entry.refs--; if (entry.refs <= 0 && entry.abortWhenUnused && entry.ac && m.get(k) === entry) { entry.ac.abort(); m.delete(k); } };
      if (!o.signal) return entry.promise.finally(release);
      if (o.signal.aborted) { release(); return Promise.reject(new LoadError('ABORTED', 'cancelado antes de iniciar')); }
      return new Promise((res, rej) => {
        const onAbort = () => { release(); rej(new LoadError('ABORTED', 'consumidor cancelou')); };
        o.signal.addEventListener('abort', onAbort, { once: true });
        entry.promise.then(v => { o.signal.removeEventListener('abort', onAbort); release(); res(v); }, err => { o.signal.removeEventListener('abort', onAbort); release(); rej(err); });
      });
    }
    return { getOrCreate, has: k => m.has(ser(k)), size: () => m.size, stats: () => ({ inFlight: m.size, deduplicated, created }) };
  }

  // ---------------------------------------------------------------- scheduler
  /** default budget: measured on the published page (one HTML + 3 JSON on boot). Not universal numbers: configurable. */
  const DEFAULT_BUDGET = Object.freeze({ maxNetworkHighPriority: 6, maxNetworkNormalPriority: 3, maxCpuHeavyTasks: 1, maxImageDecodes: 2, maxSpeculativeLoads: 1, maxQueued: 40 });
  /** LoadScheduler: IMMEDIATE/HIGH share the high lane; NORMAL/LOW the normal lane (and may borrow idle high slots);
      IDLE runs only when nothing more important waits and is cancelled first under pressure. */
  function LoadScheduler(budget = {}) {
    const B = { ...DEFAULT_BUDGET, ...budget };
    const queue = [], active = new Set(); let seq = 0, cancelled = 0, preempted = 0, waitSum = 0, waitN = 0, dropped = 0;
    const lane = p => (RANK[p] <= RANK.HIGH ? 'high' : p === 'IDLE' ? 'idle' : 'normal');
    const activeIn = l => [...active].filter(t => t.lane === l).length;
    function canStart(t) {
      const hi = activeIn('high'), no = activeIn('normal'), id = activeIn('idle');
      if (t.lane === 'high') return hi < B.maxNetworkHighPriority;
      if (t.lane === 'normal') return no < B.maxNetworkNormalPriority || (hi + no < B.maxNetworkHighPriority && !queue.some(q => q.lane === 'high'));
      return id < B.maxSpeculativeLoads && !queue.some(q => q.lane !== 'idle') && hi === 0;
    }
    function pump() {
      queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
      for (let i = 0; i < queue.length;) {
        const t = queue[i];
        if (!canStart(t)) { i++; continue; }
        queue.splice(i, 1); active.add(t); t.startedAt = Date.now(); waitSum += t.startedAt - t.queuedAt; waitN++;
        Promise.resolve().then(() => t.run()).then(t.resolve, t.reject).finally(() => { active.delete(t); pump(); });
      }
    }
    /** schedule(run, { priority, cpu, onPreempt }) → promise. A HIGH/IMMEDIATE task preempts running IDLE work when the high lane is busy. */
    function schedule(run, o = {}) {
      const priority = R.LoadPriority[o.priority] ? o.priority : 'NORMAL';
      return new Promise((resolve, reject) => {
        const t = { seq: ++seq, priority, lane: lane(priority), run, resolve, reject, queuedAt: Date.now(), onPreempt: o.onPreempt || null, signal: o.signal };
        if (t.lane === 'high') for (const a of [...active]) if (a.lane === 'idle' && a.onPreempt) { preempted++; a.onPreempt(); }
        // backpressure: too many queued → speculative work is dropped first (never critical work)
        if (queue.length >= B.maxQueued) { const idle = queue.findIndex(q => q.lane === 'idle'); if (idle >= 0) { const [d] = queue.splice(idle, 1); dropped++; d.reject(new LoadError('ABORTED', 'prefetch descartado sob pressão')); } }
        if (o.signal) { if (o.signal.aborted) { cancelled++; reject(new LoadError('ABORTED', 'cancelado')); return; } o.signal.addEventListener('abort', () => { const i = queue.indexOf(t); if (i >= 0) { queue.splice(i, 1); cancelled++; reject(new LoadError('ABORTED', 'cancelado na fila')); } }, { once: true }); }
        queue.push(t); pump();
      });
    }
    function diagnostics() {
      const byPriority = {}; for (const t of [...queue, ...active]) byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      const warnings = []; if (queue.length > B.maxQueued / 2) warnings.push('QUEUE_PRESSURE');
      return { queued: queue.length, active: active.size, byPriority, cancelled, preempted, droppedSpeculative: dropped, averageWaitMs: waitN ? Math.round(waitSum / waitN) : null, warnings };
    }
    return { schedule, diagnostics, budget: B, pending: () => queue.length + active.size };
  }

  // ---------------------------------------------------------------- scopes and transactions
  /** scopes form a tree (APPLICATION → ORGANIZATION → DEVELOPMENT → ROUTE → ENTITY | PREFETCH). Closing a scope aborts its loads and its children. */
  function LoadScopeRegistry() {
    const scopes = new Map(); let revision = 0;
    function open(id, { kind = 'ENTITY', parent = null } = {}) {
      const prev = scopes.get(id); if (prev && prev.active) return prev;
      const s = { id, kind, parent, active: true, revision: ++revision, ac: typeof AbortController !== 'undefined' ? new AbortController() : null, children: new Set() };
      scopes.set(id, s); if (parent && scopes.get(parent)) scopes.get(parent).children.add(id);
      return s;
    }
    function close(id) {
      const s = scopes.get(id); if (!s || !s.active) return 0;
      s.active = false; if (s.ac) s.ac.abort();
      let n = 1; for (const c of s.children) n += close(c);
      return n;
    }
    /** replace(kind-prefixed entity): select 327 then 145 → LOT:327 closed, LOT:145 opened */
    function replace(oldId, newId, o) { if (oldId && oldId !== newId) close(oldId); return open(newId, o); }
    return { open, close, replace, get: id => scopes.get(id) || null, isActive: id => !!(scopes.get(id) && scopes.get(id).active), revisionOf: id => (scopes.get(id) ? scopes.get(id).revision : null), all: () => [...scopes.values()] };
  }

  // ---------------------------------------------------------------- resource state registry
  function ResourceStateRegistry() {
    const st = new Map(), subs = new Map();
    const get = k => (st.get(ser(k)) || { state: S.IDLE }).state;
    function set(k, state, extra = {}) { const s = ser(k); st.set(s, { state, ...extra, at: Date.now() }); (subs.get(s) || []).forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
    function subscribe(k, fn) { const s = ser(k); if (!subs.has(s)) subs.set(s, []); subs.get(s).push(fn); return () => subs.set(s, subs.get(s).filter(f => f !== fn)); }
    return { get, set, subscribe, info: k => st.get(ser(k)) || { state: S.IDLE }, entries: () => [...st.entries()] };
  }

  // ---------------------------------------------------------------- coordinator
  /** LoadCoordinator({ organizationId, developmentId, loaders, cache, budget, retry, hooks }) */
  function LoadCoordinator(o = {}) {
    if (!o.organizationId) throw new R.KeyError('TENANT_REQUIRED', 'o coordenador precisa do organizationId');
    let ctx = { organizationId: o.organizationId, developmentId: o.developmentId || null, revision: 1 };
    const loaders = { ...(o.loaders || {}) }, cache = o.cache || null, hooks = o.hooks || {};
    const scheduler = LoadScheduler(o.budget), inflight = o.inflight || InFlightResourceRegistry(), scopes = LoadScopeRegistry(), states = ResourceStateRegistry();
    const retry = { baseMs: 500, maxBackoffMs: 4000, ...(o.retry || {}) }, sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const counters = { requests: 0, ready: 0, partial: 0, errors: 0, cancelled: 0, discardedStale: 0, optionalFailures: 0, prefetchStarted: 0, prefetchUsed: 0, prefetchWasted: 0, retries: 0, manifestRefreshes: 0 };
    const telemetry = [], prefetched = new Map(), txs = new Map(); let txSeq = 0;
    const emit = (evt, data = {}) => { telemetry.push({ evt, ...data, t: Date.now() }); if (telemetry.length > 300) telemetry.shift(); if (hooks.telemetry) try { hooks.telemetry(evt, data); } catch (e) { /* optional */ } };
    scopes.open('app', { kind: 'APPLICATION' });
    const orgScope = () => `org:${ctx.organizationId}`, devScope = () => `dev:${ctx.organizationId}:${ctx.developmentId}`;
    scopes.open(orgScope(), { kind: 'ORGANIZATION', parent: 'app' }); if (ctx.developmentId) scopes.open(devScope(), { kind: 'DEVELOPMENT', parent: orgScope() });
    const defaultScope = () => (ctx.developmentId ? devScope() : orgScope());
    function openScope(id, kind = 'ENTITY', parent) { return scopes.open(id, { kind, parent: parent || defaultScope() }); }

    function isCurrent(tx) {
      return scopes.isActive(tx.scopeId) && scopes.revisionOf(tx.scopeId) === tx.scopeRevision && tx.contextRevision === ctx.revision
        && tx.organizationId === ctx.organizationId && (tx.developmentId || null) === (ctx.developmentId || tx.developmentId || null);
    }
    async function runWithRetry(desc, loader, signal, info, extra = {}) {
      const pol = R.failurePolicy(desc.key.type); let attempt = 0, refreshed = false;
      for (;;) {
        try { return await loader({ ...extra, key: desc.key, descriptor: desc, signal, url: desc.resolveUrl ? desc.resolveUrl() : null, attempt }); }
        catch (e) {
          const c = classifyError(e);
          if (c.code === 'ABORTED' || (signal && signal.aborted)) throw new LoadError('ABORTED', 'cancelado');
          if (c.code === 'FORBIDDEN') throw new LoadError('FORBIDDEN', c.technicalMessage || 'sem permissão', { retryable: false }); // never retry 403
          // a versioned artifact that is gone usually means a stale pointer: refresh the manifest ONCE, retry ONCE, never loop
          if (c.code === 'NOT_FOUND' && desc.versioned && !refreshed && hooks.refreshPointer) { refreshed = true; counters.manifestRefreshes++; const nk = await hooks.refreshPointer(desc.key); if (nk && !R.sameKey(nk, desc.key)) { desc = { ...desc, key: nk }; info.key = nk; } continue; }
          if (c.retryable && attempt < pol.maxAutomaticRetries) { attempt++; counters.retries++; await sleep(Math.min(retry.maxBackoffMs, retry.baseMs * Math.pow(2, attempt - 1))); continue; }
          throw new LoadError(c.code, c.technicalMessage || e.message, { retryable: c.retryable, cause: e });
        }
      }
    }
    /** request(descriptor, { scopeId, priority, origin, signal, expectedVersions, cacheKey, cachePolicy, actionIntent }) → ResourceLoadResult (never throws) */
    async function request(desc, ro = {}) {
      counters.requests++;
      const t0 = Date.now(), key = desc.key, k = ser(key), origin = ro.origin || 'USER_REQUEST';
      const result = (state, extra = {}) => ({ key, state, warnings: [], timings: { queuedAt: nowIso(t0), totalMs: Date.now() - t0 }, ...extra });
      // tenant isolation: a key of another organization or development is refused, never deduplicated across tenants
      if (key.organizationId !== ctx.organizationId || (ctx.developmentId && key.developmentId && key.developmentId !== ctx.developmentId)) {
        counters.errors++; return result(S.ERROR, { error: { code: 'FORBIDDEN', retryable: false, technicalMessage: 'recurso de outro tenant/empreendimento' } });
      }
      if (origin === 'PREFETCH' && (!desc.prefetchAllowed || desc.securityClass === 'RESTRICTED' || desc.securityClass === 'CUSTOMER_SENSITIVE')) {
        return result(S.CANCELLED, { error: { code: 'ABORTED', retryable: false, technicalMessage: 'prefetch não permitido para este recurso' } });
      }
      const loader = loaders[desc.loaderId];
      if (!loader) { counters.errors++; return result(S.ERROR, { error: { code: 'UNKNOWN', retryable: false, technicalMessage: `loader ausente: ${desc.loaderId}` } }); }
      const scopeId = ro.scopeId || defaultScope(); if (!scopes.get(scopeId)) openScope(scopeId, origin === 'PREFETCH' ? 'PREFETCH' : 'ROUTE');
      const scope = scopes.get(scopeId);
      const tx = { id: 'tx' + (++txSeq), scopeId, scopeRevision: scope.revision, resourceKey: key, startedAt: nowIso(t0), contextRevision: ctx.revision, organizationId: ctx.organizationId, developmentId: ctx.developmentId, status: 'QUEUED' };
      txs.set(tx.id, tx); if (txs.size > 200) txs.delete(txs.keys().next().value);
      // the consumer's wait is cancelled with its scope or its own signal
      const consumer = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const onScopeAbort = () => consumer && consumer.abort(); if (scope.ac) scope.ac.signal.addEventListener('abort', onScopeAbort, { once: true });
      if (ro.signal) { if (ro.signal.aborted && consumer) consumer.abort(); else ro.signal.addEventListener('abort', onScopeAbort, { once: true }); }
      const priority = ro.priority || (origin === 'PREFETCH' ? 'IDLE' : desc.defaultPriority);
      if (origin === 'PREFETCH') { counters.prefetchStarted++; emit('prefetch_started', { type: key.type }); }
      else if (prefetched.has(k)) { counters.prefetchUsed++; prefetched.delete(k); emit('prefetch_used', { type: key.type }); }
      states.set(key, S.SCHEDULED);
      const info = { key };
      try {
        const value = await inflight.getOrCreate(key, signal => scheduler.schedule(async () => {
          tx.status = 'LOADING'; states.set(key, S.LOADING);
          const run = (extra) => runWithRetry(desc, loaders[desc.loaderId], signal, info, extra);
          if (cache && ro.cacheKey) return cache.load(ro.cacheKey, args => run({ etag: args && args.etag, lastModified: args && args.lastModified }), { policy: ro.cachePolicy, signal, origin, actionIntent: ro.actionIntent, expectedContext: ro.expectedVersions });
          return { value: await run(), cache: null };
        }, { priority, signal, onPreempt: origin === 'PREFETCH' ? () => consumer && consumer.abort() : null }), { signal: consumer ? consumer.signal : undefined, abortWhenUnused: desc.abortWhenUnused });
        if (origin === 'PREFETCH') prefetched.set(k, Date.now());
        // stale-result protection: tenant/development/scope still the same, version still the expected one
        if (!isCurrent(tx)) { tx.status = 'DISCARDED_STALE'; counters.discardedStale++; states.set(key, S.READY); return result(S.DISCARDED_STALE, { warnings: ['STALE_CONTEXT'] }); }
        const out = value && Object.prototype.hasOwnProperty.call(value, 'value') ? value : { value };
        const data = out.value && out.value.data !== undefined && out.value.builtAgainst ? out.value.data : out.value;
        const builtAgainst = (out.value && out.value.builtAgainst) || out.builtAgainst || null;
        if (ro.expectedVersions && builtAgainst) {
          const comp = R.validateCompatibility(key.type, builtAgainst, ro.expectedVersions);
          if (comp.status === 'VERSION_MISMATCH') { tx.status = 'ERROR'; counters.errors++; states.set(key, S.ERROR); return result(S.ERROR, { error: { code: 'VERSION_MISMATCH', retryable: false, technicalMessage: comp.mismatches.map(m => m.field).join(',') }, compatibility: comp }); }
        }
        const partial = !!(out.partial || (out.cache && out.cache.partial));
        tx.status = 'READY'; counters[partial ? 'partial' : 'ready']++; states.set(key, partial ? S.PARTIAL : S.READY);
        const warnings = [...((out.cache && out.cache.warnings) || [])];
        return result(partial ? S.PARTIAL : S.READY, { data, version: key.version, warnings, cache: out.cache || null, freshness: out.cache ? out.cache.freshness : undefined });
      } catch (e) {
        const c = classifyError(e);
        if (c.code === 'ABORTED' || (consumer && consumer.signal.aborted)) { tx.status = 'CANCELLED'; counters.cancelled++; states.set(key, S.CANCELLED); return result(S.CANCELLED, { error: { code: 'ABORTED', retryable: false } }); }
        tx.status = 'ERROR'; counters.errors++; if (desc.criticality === 'OPTIONAL' || desc.criticality === 'NON_BLOCKING') counters.optionalFailures++;
        states.set(key, S.ERROR);
        const pol = R.failurePolicy(key.type);
        return result(S.ERROR, { error: { code: c.code, retryable: c.retryable, technicalMessage: c.technicalMessage }, failure: pol });
      } finally { if (scope.ac) scope.ac.signal.removeEventListener('abort', onScopeAbort); }
    }
    /** execute(plan) — required in parallel by dependency level; deferred after required settle (NORMAL/LOW); speculative IDLE. */
    function execute(plan, eo = {}) {
      const scopeId = eo.scopeId || `route:${plan.context}:${plan.id}`; openScope(scopeId, 'ROUTE', eo.parentScope);
      const descOf = eo.descriptorOf || (k => eo.descriptors && eo.descriptors.get(ser(k)));
      const graph = R.ResourceDependencyGraph(plan.required.map(descOf).filter(Boolean));
      const results = new Map(), t0 = Date.now();
      emit('route_load_plan_start', { context: plan.context, required: plan.required.length });
      const runOne = (k, priority, origin) => { const d = descOf(k); if (!d) return Promise.resolve(null); const p = request(d, { scopeId, priority, origin, ...(eo.requestOptions ? eo.requestOptions(d) : {}) }); results.set(ser(k), p); return p; };
      // independent resources start together; a dependent one starts as soon as its own dependencies settle
      const started = new Map();
      const start = k => { const s = ser(k); if (started.has(s)) return started.get(s); const deps = graph.has(s) ? graph.dependenciesOf(s) : []; const p = Promise.all(deps.map(start)).then(() => runOne(k, undefined, 'ROUTE_CRITICAL')); started.set(s, p); return p; };
      const required = Promise.all(plan.required.map(start)).then(rs => { emit('route_critical_ready', { context: plan.context, ms: Date.now() - t0 }); return rs; });
      const deferred = required.then(() => Promise.all(plan.deferred.map(k => runOne(k, 'NORMAL', 'ROUTE_DEFERRED'))));
      const speculative = eo.allowSpeculative === false ? Promise.resolve([]) : deferred.then(() => Promise.all(plan.speculative.map(k => runOne(k, 'IDLE', 'PREFETCH'))));
      return { scopeId, required, deferred, speculative, results, cancel: () => scopes.close(scopeId) };
    }
    function cancelScope(id) { return scopes.close(id); }
    /** tenant / development switch: every scope of the previous context is closed; late answers are discarded */
    function switchContext(next) {
      const prevOrg = ctx.organizationId, prevDev = ctx.developmentId;
      if (next.organizationId && next.organizationId !== prevOrg) scopes.close(`org:${prevOrg}`);
      else if (prevDev && next.developmentId !== prevDev) scopes.close(`dev:${prevOrg}:${prevDev}`);
      ctx = { organizationId: next.organizationId || prevOrg, developmentId: next.developmentId === undefined ? prevDev : next.developmentId, revision: ctx.revision + 1 };
      for (const s of scopes.all()) if (s.id.startsWith('org:') && s.id !== orgScope()) scopes.close(s.id);
      scopes.open(orgScope(), { kind: 'ORGANIZATION', parent: 'app' }); if (ctx.developmentId) scopes.open(devScope(), { kind: 'DEVELOPMENT', parent: orgScope() });
      return { ...ctx };
    }
    /** prefetched entries never used within the window count as waste */
    function settlePrefetchWaste(maxAgeMs = 60000) { const t = Date.now(); for (const [k, at] of [...prefetched]) if (t - at > maxAgeMs) { prefetched.delete(k); counters.prefetchWasted++; emit('prefetch_wasted', {}); } }
    function diagnostics(extra = {}) {
      const q = scheduler.diagnostics(), dd = inflight.stats();
      return { queue: { ...q, deduplicated: dd.deduplicated }, lazy: { routeCode: extra.routeCode || null, loadPlanId: extra.loadPlanId || null, deduplicatedRequestCount: dd.deduplicated, cancelledRequestCount: counters.cancelled + q.cancelled,
        staleResultDiscardCount: counters.discardedStale, optionalFailureCount: counters.optionalFailures, warnings: q.warnings }, counters: { ...counters },
        prefetch: { hitRate: counters.prefetchStarted ? counters.prefetchUsed / counters.prefetchStarted : null, wasteRate: counters.prefetchStarted ? counters.prefetchWasted / counters.prefetchStarted : null }, context: { organizationId: ctx.organizationId, developmentId: ctx.developmentId, revision: ctx.revision } };
    }
    return { request, execute, cancelScope, openScope, switchContext, states, scopes, scheduler, inflight, diagnostics, settlePrefetchWaste, telemetry, context: () => ({ ...ctx }), registerLoader: (id, fn) => { loaders[id] = fn; } };
  }

  return Object.freeze({ LoadError, classifyError, InFlightResourceRegistry, DEFAULT_BUDGET, LoadScheduler, LoadScopeRegistry, ResourceStateRegistry, LoadCoordinator });
})();
