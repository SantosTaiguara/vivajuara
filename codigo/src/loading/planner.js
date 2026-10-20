/* loading/planner.js — topic 47: plans, readiness, prefetch and budgets (pure: no network, no DOM).
   LoadPlanner.buildPlan(context) → LoadPlan { required, deferred, speculative, readinessTargets } for MAP_ROUTE (cold / warm),
   LOT_SELECTION, COMPARISON_ROUTE, CUSTOMER_ROUTE, PRESENTATION_ROUTE, SHARE_ROUTE, ANALYTICS_ROUTE · MapBootstrap and
   MapLotIndex projections (minimal: never the 70 fields of a lot) · MapReadiness (SHELL_READY … FULLY_ENHANCED, not strictly
   linear) + capabilities · LoadProgress (blocking vs optional, no misleading 100 %) · PrefetchPolicy + PrefetchIntentService
   (dwell on hover, touch/focus without hover, Save-Data, slow-connection hint, byte budget, never restricted resources) ·
   image loading attributes · SearchRequestPolicy · RouteBundleBudget + analyzeBundle (CI report of the built index.html). */
App.loading = App.loading || {};
App.loading.planner = (() => {
  const R = App.loading.resources;
  const ser = R.serializeResourceKey;

  // ---------------------------------------------------------------- projections
  /** MapBootstrap from the published manifest: references and versions only (no lot data). */
  function mapBootstrap({ organizationId, developmentId, manifest, defaultLayerId = 'availability', configVersion = null, generatedAt = null }) {
    const reg = R.ResourceRegistry({ organizationId, developmentId, manifest }), v = R.versionsFromManifest(manifest);
    const geoVersion = v.geometryVersion && v.analysisVersion ? `${v.geometryVersion}+${v.analysisVersion}` : undefined;
    return Object.freeze({
      organizationId, developmentId, developmentConfigVersion: configVersion, analysisVersionRef: v.analysisVersion || null,
      geometryManifestRef: reg.descriptor('MAP_BOOTSTRAP').key,
      mapLotIndexRef: reg.descriptor('GEOMETRY_BUNDLE', { version: geoVersion }).key, // same bundle today (≈498 lots)
      baseMapRefs: [reg.descriptor('BASE_MAP_MEDIUM', { version: v.assetVersion ? v.assetVersion('planta.webp') || undefined : undefined }).key],
      defaultLayerId, defaultLayerResourceRef: null, // default layer values travel inside the geometry bundle
      availabilitySnapshotRef: manifest && manifest.availabilityPath ? reg.descriptor('AVAILABILITY_SNAPSHOT', { version: String(manifest.availabilityRevision) }).key : null,
      pricingSnapshotRef: reg.descriptor('PRICING_SNAPSHOT').key, // pointer: resolved network-first
      capabilities: ['CAN_PAN_ZOOM', 'CAN_SELECT_LOT', 'CAN_SEARCH_LOT'], generatedAt: generatedAt || (manifest && manifest.generatedAt) || null
    });
  }
  /** MapLotIndexItem: the minimum the map needs (identity, label, area, feature index, quick flags). Never price history, documents or customer data. */
  function mapLotIndex(lots) {
    return lots.map((l, i) => {
      const id = l.identity || {}, g = l.geometry || {}, av = l.availability || {};
      const flags = []; if (av.status && av.status !== 'UNKNOWN') flags.push('STATUS_' + av.status); if (av.status === 'UNKNOWN' || !av.status) flags.push('STATUS_UNKNOWN');
      return Object.freeze({ lotId: id.id, blockCode: id.blockId != null ? String(id.blockId) : undefined, lotNumber: id.lotNumber != null ? String(id.lotNumber) : undefined,
        area: g.areaM2 == null ? undefined : g.areaM2, geometryFeatureIndex: i, searchableLabel: [id.displayCode || id.code, id.blockId != null ? 'Quadra ' + id.blockId : null, id.lotNumber != null ? 'Lote ' + id.lotNumber : null].filter(Boolean).join(' · '), quickFlags: flags });
    });
  }

  // ---------------------------------------------------------------- planner
  const CONTEXTS = Object.freeze(['APP_BOOT', 'MAP_ROUTE', 'LOT_SELECTION', 'COMPARISON_ROUTE', 'CUSTOMER_ROUTE', 'PRESENTATION_ROUTE', 'SHARE_ROUTE', 'ANALYTICS_ROUTE']);
  /** types that may never enter a shared (external) runtime plan */
  const SHARE_FORBIDDEN = new Set(['CUSTOMER_SUMMARY', 'CUSTOMER_PROFILE', 'JOURNEY_SUMMARY', 'JOURNEY_TIMELINE', 'RECOMMENDATION_RESULT', 'ANALYTICS_QUERY_RESULT', 'DOCUMENT_PREVIEW', 'PERMISSIONS']);
  let planSeq = 0;
  /** buildPlan({ context, organizationId, developmentId, manifest, structuralCached, backgroundLayer, lotId, openSection, presentationStep,
        presentationStepCount, candidateIds, customerId, share, saveData, now }) → LoadPlan. Pure: builds the plan, does not load it. */
  function buildPlan(c) {
    if (!CONTEXTS.includes(c.context)) throw new R.KeyError('UNKNOWN_CONTEXT', `contexto de carga desconhecido: ${c.context}`);
    const reg = R.ResourceRegistry({ organizationId: c.organizationId, developmentId: c.developmentId, manifest: c.manifest });
    const v = R.versionsFromManifest(c.manifest), asset = p => (v.assetVersion ? v.assetVersion(p) || undefined : undefined);
    const K = (type, o) => reg.descriptor(type, o).key;
    const required = [], deferred = [], speculative = [], targets = [], notes = [];
    const geo = () => K('GEOMETRY_BUNDLE', { version: v.geometryVersion && v.analysisVersion ? `${v.geometryVersion}+${v.analysisVersion}` : undefined });
    switch (c.context) {
      case 'APP_BOOT':
        required.push(K('APP_SHELL'), K('ORGANIZATION_CONTEXT'), K('PERMISSIONS'), K('DEVELOPMENT_CONFIG')); targets.push('SHELL_READY'); break;
      case 'MAP_ROUTE': {
        if (c.structuralCached) {
          // warm: geometry from the versioned cache; pointers and prices revalidated after INTERACTIVE (network-first, never stale-as-fresh)
          required.push(geo()); deferred.push(K('MAP_BOOTSTRAP'), K('PRICING_SNAPSHOT'));
          notes.push('geometria do cache versionado; manifest e preço revalidados após INTERACTIVE');
        } else {
          // cold: the three documents in parallel (no manifest → lots → commercial waterfall)
          required.push(K('MAP_BOOTSTRAP'), geo(), K('PRICING_SNAPSHOT'));
        }
        if (c.manifest && c.manifest.availabilityPath) deferred.push(K('AVAILABILITY_SNAPSHOT', { version: String(c.manifest.availabilityRevision) }));
        const bg = c.backgroundLayer || 'plan';
        if (bg === 'plan' || bg === 'hybrid') deferred.push(K('BASE_MAP_MEDIUM', { version: asset('planta.webp') }));
        if (bg === 'aerial' || bg === 'hybrid') deferred.push(K('BASE_MAP_HIGH', { version: asset('aerea.webp') }));
        deferred.push(K('SERVICE_WORKER'));
        // nothing speculative on boot: aerial, analysis input, routes and gallery wait for intent (Save-Data or not)
        targets.push('SHELL_READY', 'GEOMETRY_READY', 'INTERACTIVE', 'FULLY_ENHANCED');
        if (c.lotId) { required.push(K('LOT_QUICK_VIEW', { resourceId: c.lotId })); notes.push('deep link: QuickView em paralelo ao núcleo do mapa, sem esperar FULLY_ENHANCED'); }
        break;
      }
      case 'LOT_SELECTION':
        if (!c.lotId) throw new R.KeyError('LOT_REQUIRED', 'seleção sem lote');
        required.push(K('LOT_QUICK_VIEW', { resourceId: c.lotId }));
        if (c.openSection) deferred.push(K('LOT_DETAIL_SECTION', { resourceId: c.lotId, variant: c.openSection }));
        if (c.openSection === 'technical' || c.openSection === 'explain') deferred.push(K('TECHNICAL_ANALYSIS_INPUT', { version: asset('analysis-input.json') }));
        if (c.openSection === 'mobility') deferred.push(K('MOBILITY_ROUTES', { version: asset('routes.json') }));
        // on demand only: price history, provenance evidence, confidence detail, documents, technical trace
        targets.push('QUICKVIEW_READY'); break;
      case 'COMPARISON_ROUTE':
        required.push(K('COMPARISON_SESSION', { resourceId: c.comparisonId || 'session' }));
        for (const g of c.openGroups || []) deferred.push(K('COMPARISON_SECTION', { resourceId: c.comparisonId || 'session', variant: g }));
        targets.push('SUMMARY_READY'); break;
      case 'CUSTOMER_ROUTE':
        if (!c.customerId) throw new R.KeyError('CUSTOMER_REQUIRED', 'rota de cliente sem cliente');
        required.push(K('CUSTOMER_SUMMARY', { resourceId: c.customerId }), K('JOURNEY_SUMMARY', { resourceId: c.customerId }));
        if (c.timelineVisible) deferred.push(K('JOURNEY_TIMELINE', { resourceId: c.customerId, variant: 'page:first' }));
        targets.push('SUMMARY_READY'); notes.push('linha do tempo paginada por cursor, só quando visível'); break;
      case 'PRESENTATION_ROUTE': {
        const n = Number.isInteger(c.presentationStep) ? c.presentationStep : 0, snap = c.presentationSnapshotId;
        if (!snap) throw new R.KeyError('SNAPSHOT_REQUIRED', 'apresentação sem snapshot');
        required.push(K('PRESENTATION_SNAPSHOT', { resourceId: snap, version: snap }), K('PRESENTATION_STEP_ASSET', { resourceId: snap, variant: 'step:' + n }));
        if (!c.saveData && (c.presentationStepCount == null || n + 1 < c.presentationStepCount)) speculative.push(K('PRESENTATION_STEP_ASSET', { resourceId: snap, variant: 'step:' + (n + 1) }));
        targets.push('STEP_READY'); break;
      }
      case 'SHARE_ROUTE':
        required.push(K('SHARE_RESOURCE', { resourceId: c.shareSessionRef || 'session' }));
        if (Number.isInteger(c.presentationStep) && c.presentationSnapshotId) required.push(K('PRESENTATION_STEP_ASSET', { resourceId: c.presentationSnapshotId, variant: 'step:' + c.presentationStep }));
        targets.push('SHARE_READY'); break;
      case 'ANALYTICS_ROUTE':
        required.push(K('ANALYTICS_QUERY_RESULT', { resourceId: c.queryFingerprint || 'default' })); targets.push('DASHBOARD_READY'); break;
    }
    if (c.context === 'SHARE_ROUTE') for (const k of [...required, ...deferred, ...speculative]) if (SHARE_FORBIDDEN.has(k.type)) throw new R.KeyError('SHARE_SCOPE', `${k.type} fora do escopo do compartilhamento`);
    if (c.saveData) speculative.length = 0;
    return Object.freeze({ id: 'plan' + (++planSeq), context: c.context, required, deferred, speculative, readinessTargets: targets, notes, createdAt: new Date(c.now || Date.now()).toISOString() });
  }
  /** descriptors of a plan's keys (for LoadCoordinator.execute) */
  function descriptorsOf(plan, { organizationId, developmentId, manifest, dev } = {}) {
    const reg = R.ResourceRegistry({ organizationId, developmentId, manifest, dev }), m = new Map();
    for (const k of [...plan.required, ...plan.deferred, ...plan.speculative]) m.set(ser(k), reg.descriptor(k.type, { resourceId: k.resourceId, version: k.version, variant: k.variant, locale: k.locale }));
    return m;
  }

  // ---------------------------------------------------------------- progressive readiness
  const Readiness = Object.freeze(['SHELL_READY', 'BASE_MAP_READY', 'GEOMETRY_READY', 'INTERACTIVE', 'FULLY_ENHANCED']);
  /** MapReadiness: fed with resource states; readiness is a set (base map may arrive after geometry). */
  function MapReadiness() {
    const st = {}; const subs = [];
    const ok = t => st[t] === 'READY' || st[t] === 'PARTIAL';
    const settled = t => ok(t) || st[t] === 'ERROR';
    function update(type, state) { st[type] = state; subs.forEach(fn => { try { fn(snapshot()); } catch (e) { console.error(e); } }); return snapshot(); }
    function snapshot() {
      const reached = new Set();
      if (ok('APP_SHELL') && ok('DEVELOPMENT_CONFIG')) reached.add('SHELL_READY');
      if (ok('BASE_MAP_MEDIUM') || ok('BASE_MAP_LOW')) reached.add('BASE_MAP_READY');
      if (reached.has('SHELL_READY') && ok('GEOMETRY_BUNDLE')) reached.add('GEOMETRY_READY');
      if (reached.has('GEOMETRY_READY')) reached.add('INTERACTIVE'); // SVG native hit-test: no separate spatial index to wait for
      // fully enhanced: prices settled (confirmed, or last table labelled "necessita confirmação") and a base map (or its failure, kept degraded)
      if (reached.has('INTERACTIVE') && settled('PRICING_SNAPSHOT') && (settled('BASE_MAP_MEDIUM') || settled('BASE_MAP_HIGH'))) reached.add('FULLY_ENHANCED');
      const caps = new Set();
      if (reached.has('INTERACTIVE')) { caps.add('CAN_PAN_ZOOM'); caps.add('CAN_SELECT_LOT'); caps.add('CAN_SEARCH_LOT'); caps.add('CAN_RENDER_DEFAULT_LAYER'); }
      if (reached.has('INTERACTIVE') && settled('PRICING_SNAPSHOT')) caps.add('CAN_SHOW_QUICKVIEW');
      if (ok('BASE_MAP_HIGH')) caps.add('CAN_SHOW_AERIAL_HIGH_RES');
      if (reached.has('FULLY_ENHANCED')) caps.add('CAN_SHOW_ADVANCED_LABELS');
      const top = [...Readiness].reverse().find(r => reached.has(r)) || 'LOADING';
      return { reached: Readiness.filter(r => reached.has(r)), state: top, capabilities: [...caps], degraded: Object.keys(st).filter(t => st[t] === 'ERROR') };
    }
    return { update, snapshot, can: c => snapshot().capabilities.includes(c), subscribe: fn => { subs.push(fn); return () => subs.splice(subs.indexOf(fn), 1); } };
  }
  /** LoadProgress from a plan and the state registry; unknown/dynamic resources never make it look 100 % before they settle */
  function loadProgress(plan, getState, readinessState = null) {
    const done = k => ['READY', 'PARTIAL'].includes(getState(k));
    const req = plan.required, opt = [...plan.deferred, ...plan.speculative];
    return { blockingReady: req.filter(done).length, blockingTotal: req.length, optionalReady: opt.filter(done).length, optionalTotal: opt.length, readinessState };
  }

  // ---------------------------------------------------------------- prefetch
  const DEFAULT_PREFETCH = Object.freeze({ enabled: true, maxConcurrent: 1, maxBytesPerWindow: 1500000, windowMs: 60000, disableWhenSaveData: true, disableOnSlowConnectionHint: true, cancelOnCriticalRequest: true, hoverDwellMs: 180 });
  const SLOW = new Set(['slow-2g', '2g', '3g']);
  /** prefetchDecision(descriptor, { saveData, effectiveType, bytesInWindow, criticalPending, policy }) → { allowed, reason } */
  function prefetchDecision(desc, env = {}) {
    const p = { ...DEFAULT_PREFETCH, ...(env.policy || {}) };
    if (!p.enabled) return { allowed: false, reason: 'PREFETCH_DISABLED' };
    if (!desc || !desc.prefetchAllowed) return { allowed: false, reason: 'NOT_PREFETCHABLE' };
    if (desc.securityClass === 'RESTRICTED' || desc.securityClass === 'CUSTOMER_SENSITIVE') return { allowed: false, reason: 'RESTRICTED_RESOURCE' };
    if (p.disableWhenSaveData && env.saveData) return { allowed: false, reason: 'SAVE_DATA' };
    if (p.disableOnSlowConnectionHint && env.effectiveType && SLOW.has(env.effectiveType)) return { allowed: false, reason: 'SLOW_CONNECTION_HINT' };
    if (env.criticalPending) return { allowed: false, reason: 'CRITICAL_QUEUE_BUSY' };
    if (p.maxBytesPerWindow != null && (env.bytesInWindow || 0) + (desc.estimatedBytes || 0) > p.maxBytesPerWindow) return { allowed: false, reason: 'BYTE_BUDGET' };
    return { allowed: true, reason: 'OK' };
  }
  /** PrefetchIntentService: hover needs a dwell (no avalanche); focus/touchstart/panel-open are intents without hover (touch devices).
      onPrefetch(descriptor) is called at most once per key; never announced to screen readers. */
  function PrefetchIntentService({ onPrefetch, env = () => ({}), policy = {}, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() } = {}) {
    const p = { ...DEFAULT_PREFETCH, ...policy }, timers = new Map(), done = new Set(), spent = []; let decisions = [];
    const bytesInWindow = () => { const t = now(); while (spent.length && t - spent[0].t > p.windowMs) spent.shift(); return spent.reduce((a, x) => a + x.b, 0); };
    function fire(desc) {
      const k = ser(desc.key); if (done.has(k)) return { allowed: false, reason: 'ALREADY_PREFETCHED' };
      const d = prefetchDecision(desc, { ...env(), bytesInWindow: bytesInWindow(), policy: p }); decisions.push({ type: desc.key.type, ...d }); if (decisions.length > 50) decisions = decisions.slice(-50);
      if (!d.allowed) return d;
      done.add(k); spent.push({ t: now(), b: desc.estimatedBytes || 0 });
      try { onPrefetch && onPrefetch(desc); } catch (e) { console.error(e); }
      return d;
    }
    /** signal(kind, descriptor): kind = hover | hoverEnd | focus | touchstart | panelOpen | nextStep | candidateCount2 | zoomNearThreshold */
    function signal(kind, desc) {
      if (!desc) return null; const k = ser(desc.key);
      if (kind === 'hover') { if (timers.has(k) || done.has(k)) return null; timers.set(k, setTimer(() => { timers.delete(k); fire(desc); }, p.hoverDwellMs)); return { pending: true }; }
      if (kind === 'hoverEnd') { if (timers.has(k)) { clearTimer(timers.get(k)); timers.delete(k); } return null; }
      return fire(desc);
    }
    return { signal, decisions: () => decisions.slice(), reset: () => { done.clear(); spent.length = 0; } };
  }
  /** env from the browser: Save-Data and the effective connection type are hints, never functional requirements */
  function connectionEnv(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
    const c = nav && nav.connection; return { saveData: !!(c && c.saveData), effectiveType: c && c.effectiveType ? c.effectiveType : null };
  }

  // ---------------------------------------------------------------- assets
  /** imageAttrs({ critical, visible, width, height, highRes }) → attribute string for <img>: dimensions reserved (no layout shift),
      lazy for everything not critical-and-visible; fetchpriority is a hint only. */
  function imageAttrs(o = {}) {
    const a = [];
    if (o.width) a.push(`width="${Math.round(o.width)}"`); if (o.height) a.push(`height="${Math.round(o.height)}"`);
    if (o.critical && o.visible) a.push('loading="eager"', 'fetchpriority="high"'); else a.push('loading="lazy"', 'fetchpriority="low"');
    a.push('decoding="async"');
    return a.join(' ');
  }
  const SearchRequestPolicy = Object.freeze({ lot: { minChars: 1, debounceMs: 0, maxResults: 20, local: true }, customer: { minChars: 2, debounceMs: 250, maxResults: 20, local: false } });

  // ---------------------------------------------------------------- budgets (CI)
  /** RouteBundleBudget: values come from the measured baseline (LAZY_LOADING_BASELINE_REPORT.md), with a tolerance. */
  const BUDGETS = Object.freeze({
    MAP_ROUTE: { routeCode: 'MAP_ROUTE', maxInitialJsBytes: 3400000, maxInitialCssBytes: 90000, maxCriticalDataBytes: 760000, maxDataRequestsUntilInteractive: 3, maxDuplicateDataRequests: 0,
      tolerance: 0.10, baseline: { initialJsBytes: 2255668, initialCssBytes: 69000, criticalDataBytes: 732700, preSplitJsBytes: 3399319 }, targetInteractiveMsByDeviceClass: null,
      // round 6 code splitting: the page must keep at least 25 % less JS than before the split; a lazy chunk stays under 400 KB
      minSplitReduction: 0.25, maxLazyChunkBytes: 400000 }
  });
  /** analyzeBundle(html) → per-module bytes and per-chunk totals (from the `/* ---- file ---- *\/` markers of the build) */
  function analyzeBundle(html) {
    const a = html.indexOf('<script>'), b = html.lastIndexOf('</script>');
    const s0 = html.indexOf('<style>'), s1 = html.indexOf('</style>');
    const js = a >= 0 && b > a ? html.slice(a, b) : '', parts = js.split(/\/\* ---- (.+?) ---- \*\//), modules = [];
    for (let i = 1; i < parts.length; i += 2) modules.push({ file: parts[i], bytes: parts[i + 1].length, chunk: R.chunkOf(parts[i].replace(/ \(.*\)$/, '')) });
    const byChunk = {}; for (const m of modules) byChunk[m.chunk] = (byChunk[m.chunk] || 0) + m.bytes;
    return { totalBytes: html.length, jsBytes: js.length, cssBytes: s0 >= 0 && s1 > s0 ? s1 - s0 : 0, moduleCount: modules.length, modules: modules.sort((x, y) => y.bytes - x.bytes), byChunk,
      deferrableBytes: Object.entries(byChunk).filter(([c]) => c !== 'core').reduce((x, [, n]) => x + n, 0) };
  }
  /** analyzeChunks(manifest, readFile) → [{ name, file, bytes, modules[] }] for the lazy chunks of the build (round 6) */
  function analyzeChunks(manifest, readFile) {
    return Object.entries(manifest || {}).map(([name, e]) => { const t = readFile(e.file) || ''; return { name, file: e.file, bytes: t.length, modules: [...t.matchAll(/\/\* ---- (.+?) ---- \*\//g)].map(m => m[1]).filter(f => !/^(configs \(|chunk end)/.test(f)), deps: e.deps || [] }; });
  }
  /** checkBudget(analysis, budget, measured) → { ok, violations[] }: material regressions (> tolerance over the budget) fail CI */
  function checkBudget(an, budget = BUDGETS.MAP_ROUTE, measured = {}) {
    const v = [], over = (what, value, max) => { if (max != null && value != null && value > max) v.push({ what, value, max }); };
    over('initialJsBytes', an.jsBytes, budget.maxInitialJsBytes); over('initialCssBytes', an.cssBytes, budget.maxInitialCssBytes);
    over('criticalDataBytes', measured.criticalDataBytes, budget.maxCriticalDataBytes);
    over('dataRequestsUntilInteractive', measured.dataRequestsUntilInteractive, budget.maxDataRequestsUntilInteractive);
    over('duplicateDataRequests', measured.duplicateDataRequests, budget.maxDuplicateDataRequests);
    return { ok: !v.length, violations: v };
  }

  return Object.freeze({ mapBootstrap, mapLotIndex, CONTEXTS, SHARE_FORBIDDEN, buildPlan, descriptorsOf, Readiness, MapReadiness, loadProgress, DEFAULT_PREFETCH, prefetchDecision, PrefetchIntentService,
    connectionEnv, imageAttrs, SearchRequestPolicy, BUDGETS, analyzeBundle, analyzeChunks, checkBudget });
})();
