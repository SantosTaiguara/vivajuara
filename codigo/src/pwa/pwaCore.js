/* pwa/pwaCore.js — topic 49: PWA vocabulary and the parts that do not touch storage or network.
   - OfflineCapability + OfflineCapabilityRegistry (§3–§13): every feature declares its offline behaviour; evaluate() answers
     "can this be offered now, and with which wording?" so the UI never hides silently nor spins forever (§150–§153).
   - PwaCapabilityDetector (§248): feature detection, never User-Agent sniffing (§249).
   - Build/schema compatibility (§46, §47, §213, §214): appBuildId, serviceWorkerBuildId, cacheSchemaVersion, offlinePackSchemaVersion,
     apiCompatibilityVersion, queueSchemaVersion; mixed app/worker versions are detected, never operated silently.
   - InstallPromptController (§26–§29, §269–§271): no prompt in the first seconds nor in the first session, never in front of a
     client, one suggestion per session, 30-day cool-down after a dismissal; the menu entry works whenever the browser allows; iOS gets
     instructions. Installing the app ≠ a development available offline (§178/§179).
   - PWA telemetry (§237–§240): technical events go to observability (topic 51) when present, else to the local lifecycle log;
     product events only through the analytics sink the composition root injects (local-only). No URL, token or lot/customer field in any event.
   - PwaDiagnostics (§241), BrowserSupportMatrix (§245), LegacyPwaInventory (§346–§352).
   Pure except the controller/detector, which read `window`/`navigator` passed in (testable with fakes). */
App.pwa = App.pwa || {};
App.pwa.core = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const OfflineCapability = E('OFFLINE_SUPPORTED', 'OFFLINE_READ_ONLY', 'OFFLINE_LAST_KNOWN', 'OFFLINE_QUEUEABLE', 'ONLINE_REQUIRED', 'UNAVAILABLE_OFFLINE');
  const InstallState = E('NOT_INSTALLABLE', 'INSTALLABLE', 'INSTALL_PROMPT_DEFERRED', 'INSTALLED');
  const SW_LIFECYCLE = Object.freeze(['INSTALLING', 'INSTALLED', 'WAITING', 'ACTIVATING', 'ACTIVATED', 'REDUNDANT']);
  const VERSIONS = Object.freeze({ cacheSchemaVersion: '1', offlinePackSchemaVersion: '1', apiCompatibilityVersion: '1', queueSchemaVersion: '1' });

  // ---------------------------------------------------------------- OfflineCapabilityRegistry
  const F = (featureCode, capability, requiredResources, o = {}) => Object.freeze({ featureCode, capability, requiredResources: Object.freeze(requiredResources),
    requiresFreshness: false, staleDisplayAllowed: false, queuePolicyRef: undefined, onlineValidationRequiredForCommit: false, userMessageKey: undefined, ...o });
  /** one row per feature. requiredResources are LoadResourceType values (topic 47). */
  const CAPABILITIES = Object.freeze([
    F('APP_SHELL', 'OFFLINE_SUPPORTED', ['APP_SHELL']),
    F('MAP', 'OFFLINE_SUPPORTED', ['GEOMETRY_BUNDLE', 'BASE_MAP_MEDIUM'], { userMessageKey: 'offline.map' }),
    F('LOT_SEARCH', 'OFFLINE_SUPPORTED', ['GEOMETRY_BUNDLE'], { notes: 'busca no índice de lotes (MapLotIndex) reconstruído em memória.' }),
    F('LOT_QUICK_VIEW', 'OFFLINE_READ_ONLY', ['GEOMETRY_BUNDLE'], { staleDisplayAllowed: true, userMessageKey: 'offline.quickview' }),
    F('ANALYSIS_LAYERS', 'OFFLINE_READ_ONLY', ['GEOMETRY_BUNDLE'], { notes: 'AnalysisVersion imutável (scores/classes publicados).' }),
    F('TECHNICAL_EXPLANATION', 'OFFLINE_READ_ONLY', ['TECHNICAL_ANALYSIS_INPUT'], { notes: 'analysis-input.json no pacote (STANDARD), versão exata por checksum.' }),
    F('AVAILABILITY', 'OFFLINE_LAST_KNOWN', ['AVAILABILITY_SNAPSHOT'], { requiresFreshness: true, staleDisplayAllowed: true, onlineValidationRequiredForCommit: true, userMessageKey: 'offline.availability' }),
    F('PRICING', 'OFFLINE_LAST_KNOWN', ['PRICING_SNAPSHOT'], { requiresFreshness: true, staleDisplayAllowed: true, onlineValidationRequiredForCommit: true, userMessageKey: 'offline.pricing' }),
    F('PRICE_HISTORY', 'OFFLINE_READ_ONLY', ['PRICING_SNAPSHOT'], { notes: 'tabelas publicadas embutidas no app.' }),
    F('FINANCIAL_SIMULATION', 'OFFLINE_LAST_KNOWN', ['PRICING_SNAPSHOT'], { staleDisplayAllowed: true, onlineValidationRequiredForCommit: true, userMessageKey: 'offline.financial' }),
    F('COMPARISON', 'OFFLINE_SUPPORTED', ['GEOMETRY_BUNDLE'], { notes: 'LOCAL_OFFLINE_COMPARISON: comparação local, nunca sincronizada como sessão do servidor (§160–§162).' }),
    F('RECOMMENDATION', 'OFFLINE_READ_ONLY', ['GEOMETRY_BUNDLE'], { notes: 'só o resultado já calculado nesta sessão (perfil em memória); nunca persistido offline (§158/§159).' }),
    F('FAVORITES', 'OFFLINE_QUEUEABLE', ['GEOMETRY_BUNDLE'], { queuePolicyRef: 'favorite.set', notes: 'favoritos são locais hoje (LOCAL_ONLY); fila só quando houver backend.' }),
    F('MOBILITY_ROUTES', 'OFFLINE_READ_ONLY', ['MOBILITY_ROUTES']),
    F('AERIAL_VIEW', 'OFFLINE_READ_ONLY', ['BASE_MAP_HIGH'], { notes: 'só no perfil FULL_MAP ("incluir imagens em alta resolução").' }),
    F('GALLERY', 'OFFLINE_READ_ONLY', ['GALLERY_INDEX', 'GALLERY_IMAGE'], { notes: 'só no perfil FULL_MAP.' }),
    F('PRESENTATION_IN_PERSON', 'OFFLINE_READ_ONLY', ['GEOMETRY_BUNDLE'], { notes: 'apresentação presencial local, sem ShareGrant (§176).' }),
    F('CUSTOMER', 'UNAVAILABLE_OFFLINE', ['CUSTOMER_SUMMARY'], { userMessageKey: 'offline.customer', notes: 'padrão conservador (§10); persistência sensível exige aprovação do produto.' }),
    F('JOURNEY', 'UNAVAILABLE_OFFLINE', ['JOURNEY_SUMMARY']),
    F('DOCUMENTS', 'UNAVAILABLE_OFFLINE', ['DOCUMENT_METADATA'], { notes: 'documentos não entram no pacote (§167).' }),
    F('SHARE_CREATE', 'ONLINE_REQUIRED', ['SHARE_RESOURCE'], { onlineValidationRequiredForCommit: true }),
    F('SHARED_LINK_OPEN', 'ONLINE_REQUIRED', ['SHARE_RESOURCE'], { onlineValidationRequiredForCommit: true, userMessageKey: 'offline.share' }),
    F('RESERVATION', 'ONLINE_REQUIRED', ['AVAILABILITY_SNAPSHOT'], { requiresFreshness: true, onlineValidationRequiredForCommit: true }),
    F('PROPOSAL', 'ONLINE_REQUIRED', ['AVAILABILITY_SNAPSHOT', 'PRICING_SNAPSHOT'], { requiresFreshness: true, onlineValidationRequiredForCommit: true }),
    F('ANALYTICS_DASHBOARD', 'ONLINE_REQUIRED', ['ANALYTICS_QUERY_RESULT'])
  ]);
  const BY_CODE = new Map(CAPABILITIES.map(c => [c.featureCode, c]));
  const MSG = {
    ONLINE_REQUIRED: 'Disponível quando online.', UNAVAILABLE_OFFLINE: 'Indisponível no modo offline.', NOT_DOWNLOADED: 'Este conteúdo não foi baixado para uso offline.',
    LAST_KNOWN: 'Última informação conhecida. Confirme ao reconectar.', READ_ONLY: 'Somente consulta no modo offline.', QUEUED: 'Será sincronizado quando a conexão voltar.'
  };
  /** evaluate(featureCode, { connectivity: ONLINE|DEGRADED|OFFLINE|UNKNOWN, present: Set<resourceType> }) →
      { featureCode, capability, available, mode: NORMAL|OFFLINE_FULL|READ_ONLY|LAST_KNOWN|QUEUE|BLOCKED, allowCommit, message } */
  function evaluate(featureCode, ctx = {}) {
    const def = BY_CODE.get(featureCode);
    if (!def) return { featureCode, capability: null, available: false, mode: 'BLOCKED', allowCommit: false, message: MSG.UNAVAILABLE_OFFLINE, reason: 'UNKNOWN_FEATURE' }; // deny by default
    // UNKNOWN (boot, no request answered yet) is not shown as offline, but a commit must first confirm the connection (probe)
    if (ctx.connectivity === 'ONLINE' || ctx.connectivity === 'UNKNOWN' || ctx.connectivity == null) return { featureCode, capability: def.capability, available: true, mode: 'NORMAL', allowCommit: true,
      confirmConnectionBeforeCommit: ctx.connectivity !== 'ONLINE' && def.onlineValidationRequiredForCommit, message: null };
    const present = ctx.present instanceof Set ? ctx.present : new Set(ctx.present || []);
    const missing = def.requiredResources.filter(r => !present.has(r));
    const R = (o) => ({ featureCode, capability: def.capability, missing, ...o });
    switch (def.capability) {
      case 'ONLINE_REQUIRED': return R({ available: false, mode: 'BLOCKED', allowCommit: false, message: MSG.ONLINE_REQUIRED });
      case 'UNAVAILABLE_OFFLINE': return R({ available: false, mode: 'BLOCKED', allowCommit: false, message: MSG.UNAVAILABLE_OFFLINE });
      default:
        if (missing.length) return R({ available: false, mode: 'BLOCKED', allowCommit: false, message: MSG.NOT_DOWNLOADED });
        if (def.capability === 'OFFLINE_LAST_KNOWN') return R({ available: true, mode: 'LAST_KNOWN', allowCommit: !def.onlineValidationRequiredForCommit, message: MSG.LAST_KNOWN });
        if (def.capability === 'OFFLINE_READ_ONLY') return R({ available: true, mode: 'READ_ONLY', allowCommit: false, message: MSG.READ_ONLY });
        if (def.capability === 'OFFLINE_QUEUEABLE') return R({ available: true, mode: 'QUEUE', allowCommit: false, message: MSG.QUEUED });
        return R({ available: true, mode: 'OFFLINE_FULL', allowCommit: !def.onlineValidationRequiredForCommit, message: null });
    }
  }
  /** registry self-check: commercial commits always need online validation, customer data never offline by default */
  function validateRegistry() {
    const errors = [];
    for (const c of CAPABILITIES) {
      if (!OfflineCapability[c.capability]) errors.push(`${c.featureCode}: capacidade inválida`);
      if (['RESERVATION', 'PROPOSAL', 'SHARE_CREATE'].includes(c.featureCode) && c.capability !== 'ONLINE_REQUIRED') errors.push(`${c.featureCode} deve exigir conexão`);
      if (['AVAILABILITY', 'PRICING'].includes(c.featureCode) && (c.capability === 'OFFLINE_SUPPORTED' || !c.onlineValidationRequiredForCommit)) errors.push(`${c.featureCode} nunca é "atual" offline`);
      if (['CUSTOMER', 'JOURNEY'].includes(c.featureCode) && c.capability !== 'UNAVAILABLE_OFFLINE') errors.push(`${c.featureCode}: dado de cliente offline exige aprovação`);
    }
    return { ok: !errors.length, errors };
  }

  // ---------------------------------------------------------------- capability detection (§248)
  function detectCapabilities(win = (typeof window !== 'undefined' ? window : null)) {
    const nav = win && win.navigator, sw = !!(nav && 'serviceWorker' in nav);
    let standalone = false;
    try { standalone = !!(win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || !!(nav && nav.standalone === true); } catch (e) { /* no matchMedia */ }
    return Object.freeze({
      serviceWorker: sw, installPrompt: !!(win && 'onbeforeinstallprompt' in win), cacheStorage: !!(win && 'caches' in win), indexedDb: !!(win && 'indexedDB' in win && win.indexedDB),
      backgroundSync: !!(win && 'SyncManager' in win), periodicSync: !!(win && 'PeriodicSyncManager' in win), storageEstimate: !!(nav && nav.storage && typeof nav.storage.estimate === 'function'),
      displayModeStandalone: standalone, secureContext: !!(win && win.isSecureContext),
      // iOS Safari exposes navigator.standalone and no beforeinstallprompt: feature-based, not a User-Agent test
      manualInstallOnly: !!(nav && 'standalone' in nav && !(win && 'onbeforeinstallprompt' in win))
    });
  }

  // ---------------------------------------------------------------- build / schema compatibility
  /** appBuildInfo(doc) → { appBuildId, ...VERSIONS } read from <meta name="app-build-id"> (written by scripts/build.js) */
  function appBuildInfo(doc = (typeof document !== 'undefined' ? document : null)) {
    let id = null; try { const m = doc && doc.querySelector('meta[name="app-build-id"]'); id = m ? m.getAttribute('content') : null; } catch (e) { /* no DOM */ }
    return Object.freeze({ appBuildId: id && /^[0-9a-f]{6,64}$/i.test(id) ? id : 'dev', ...VERSIONS });
  }
  /** compatibility(app, sw) → { status: NO_WORKER | MATCH | TOLERATED | UPDATE_REQUIRED, reasons[] }
      TOLERATED: different builds with the same cache/API/pack schemas (the worker only routes; an update is offered, nothing breaks).
      UPDATE_REQUIRED: a schema differs → "Atualização requer reinício", never silent operation (§47, §214). */
  function compatibility(app, sw) {
    if (!sw || !sw.serviceWorkerBuildId) return { status: 'NO_WORKER', reasons: [] };
    const reasons = [];
    for (const k of ['cacheSchemaVersion', 'apiCompatibilityVersion', 'offlinePackSchemaVersion']) if (sw[k] != null && app[k] != null && String(sw[k]) !== String(app[k])) reasons.push(k);
    if (reasons.length) return { status: 'UPDATE_REQUIRED', reasons };
    return { status: sw.serviceWorkerBuildId === app.appBuildId ? 'MATCH' : 'TOLERATED', reasons: [] };
  }

  // ---------------------------------------------------------------- telemetry (§237–§240)
  const TECH_EVENTS = Object.freeze(['sw_install_success', 'sw_install_failure', 'sw_activate_success', 'sw_update_available', 'sw_update_failed', 'offline_pack_prepare_start', 'offline_pack_prepare_success',
    'offline_pack_prepare_failure', 'offline_pack_bytes', 'offline_pack_refresh', 'offline_boot_success', 'offline_boot_failure', 'sync_queue_size', 'sync_success', 'sync_failure', 'sync_conflict', 'connectivity_state_change']);
  const PRODUCT_EVENTS = Object.freeze(['offline_pack_enabled', 'offline_pack_removed', 'pwa_install_requested']);
  const SAFE_FIELD = /^(state|from|to|profile|bytes|count|reason|code|durationMs|outcome|trigger|mode|resources|changed|attempt|build|kind)$/;
  /** scrub(data): only whitelisted scalar fields; strings are short codes (no URL, token, e-mail, lot or customer data) */
  function scrub(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (!SAFE_FIELD.test(k)) continue;
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,48}$/.test(v) && !/^https?:/i.test(v)) out[k] = v;
    }
    return out;
  }
  /** GAP-ARCH-25: the product-analytics sink is injected by the composition root (presentation/app.js → setSinks); this
      infrastructure module never reaches App.analytics itself. Without a sink, product events are dropped locally. */
  const defaultSinks = { analytics: null };
  const setSinks = (o = {}) => { if (o.analytics && typeof o.analytics.track === 'function') defaultSinks.analytics = o.analytics; return !!defaultSinks.analytics; };
  /** emit(name, data) — technical → observability sink or lifecycle log; product → injected analytics sink (local-only) */
  function emit(name, data = {}, sinks = {}) {
    const clean = scrub(data);
    try {
      if (TECH_EVENTS.includes(name)) {
        const obs = sinks.observability || (App.observability && (App.observability.technical || App.observability));
        if (obs && typeof obs.emit === 'function') obs.emit('pwa.' + name, clean);
        else if (App.lifecycle && App.lifecycle.note) App.lifecycle.note('pwa ' + name, clean);
        return { ok: true, channel: 'TECHNICAL', data: clean };
      }
      if (PRODUCT_EVENTS.includes(name)) {
        const a = sinks.analytics || defaultSinks.analytics;
        if (a && typeof a.track === 'function') { try { a.track(name, clean); } catch (e) { /* event not registered yet: dropped, never sent elsewhere */ } }
        return { ok: true, channel: 'PRODUCT', data: clean };
      }
    } catch (e) { /* telemetry never breaks the app */ }
    return { ok: false, channel: null, data: clean };
  }

  // ---------------------------------------------------------------- InstallPromptController
  const INSTALL_POLICY = Object.freeze({ minSessions: 2, minSessionAgeMs: 30000, minRelevantUses: 1, cooldownMs: 30 * 24 * 3600e3, maxSuggestionsPerSession: 1, storageKey: 'ws-pwa-install' });
  function InstallPromptController({ win = (typeof window !== 'undefined' ? window : null), storage = null, now = () => Date.now(), policy = {}, onChange = null, sinks = {} } = {}) {
    const P = { ...INSTALL_POLICY, ...policy }, startedAt = now();
    const st = storage || (() => { try { return win && win.localStorage; } catch (e) { return null; } })();
    const read = () => { try { return JSON.parse((st && st.getItem(P.storageKey)) || '{}') || {}; } catch (e) { return {}; } };
    const write = v => { try { st && st.setItem(P.storageKey, JSON.stringify(v)); } catch (e) { /* storage blocked: the menu entry still works */ } };
    const caps = detectCapabilities(win);
    let deferred = null, state = caps.displayModeStandalone ? InstallState.INSTALLED : InstallState.NOT_INSTALLABLE, relevantUses = 0, suggestedThisSession = 0;
    // one session = one page load; the count lives in localStorage only as a per-device convenience (never authorization)
    const persisted = read(); persisted.sessions = (persisted.sessions || 0) + 1; write(persisted);
    const set = s => { if (s === state) return; state = s; if (onChange) try { onChange(s); } catch (e) { /* ui */ } };
    if (win && win.addEventListener) {
      win.addEventListener('beforeinstallprompt', e => { if (e && e.preventDefault) e.preventDefault(); deferred = e; if (state !== InstallState.INSTALLED) set(InstallState.INSTALL_PROMPT_DEFERRED); });
      win.addEventListener('appinstalled', () => { deferred = null; set(InstallState.INSTALLED); const p = read(); p.installedAt = now(); write(p); });
    }
    /** a relevant use (map opened, lot selected…): counts toward eligibility */
    function recordRelevantUse() { relevantUses++; }
    /** shouldSuggest(ctx) → { suggest, reason } — never in the first seconds, never on the first session, never in front of a client */
    function shouldSuggest(ctx = {}) {
      const p = read();
      if (state === InstallState.INSTALLED) return { suggest: false, reason: 'INSTALLED' };
      if (ctx.clientFacing || ctx.presentation) return { suggest: false, reason: 'CLIENT_CONTEXT' };
      if (state !== InstallState.INSTALL_PROMPT_DEFERRED && !caps.manualInstallOnly) return { suggest: false, reason: 'NOT_INSTALLABLE' };
      if (suggestedThisSession >= P.maxSuggestionsPerSession) return { suggest: false, reason: 'ALREADY_SUGGESTED' };
      if ((p.sessions || 0) < P.minSessions) return { suggest: false, reason: 'FIRST_SESSION' };
      if (now() - startedAt < P.minSessionAgeMs) return { suggest: false, reason: 'TOO_EARLY' };
      if (relevantUses < P.minRelevantUses) return { suggest: false, reason: 'NO_RELEVANT_USE' };
      if (p.dismissedAt && now() - p.dismissedAt < P.cooldownMs) return { suggest: false, reason: 'COOLDOWN' };
      return { suggest: true, reason: caps.manualInstallOnly ? 'MANUAL_INSTRUCTIONS' : 'ELIGIBLE' };
    }
    function markSuggested() { suggestedThisSession++; }
    function dismiss() { const p = read(); p.dismissedAt = now(); write(p); }
    /** from the menu "Instalar aplicativo": allowed whenever the browser handed us a deferred prompt */
    async function promptInstall() {
      emit('pwa_install_requested', { mode: deferred ? 'prompt' : (caps.manualInstallOnly ? 'manual' : 'unavailable') }, sinks);
      if (!deferred) return { outcome: caps.manualInstallOnly ? 'MANUAL_INSTRUCTIONS' : 'UNAVAILABLE', instructions: caps.manualInstallOnly ? manualInstructions() : null };
      const d = deferred; deferred = null;
      try { await d.prompt(); const c = await d.userChoice; if (c && c.outcome === 'accepted') { set(InstallState.INSTALLED); return { outcome: 'ACCEPTED' }; } dismiss(); set(InstallState.INSTALLABLE); return { outcome: 'DISMISSED' }; }
      catch (e) { set(InstallState.INSTALLABLE); return { outcome: 'FAILED' }; }
    }
    const manualInstructions = () => 'No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".';
    return { getState: () => state, capabilities: caps, recordRelevantUse, shouldSuggest, markSuggested, dismiss, promptInstall, manualInstructions, canPrompt: () => !!deferred, sessions: () => read().sessions || 0 };
  }

  // ---------------------------------------------------------------- diagnostics (§241–§244)
  /** pwaDiagnostics(parts) → PwaDiagnostics. Technical/admin only; never tokens, URLs with query strings or personal data. */
  function pwaDiagnostics({ swState = 'NONE', app = appBuildInfo(null), sw = null, connectivity = 'UNKNOWN', capabilities = null, packs = [], pendingMutationCount = 0, lastSyncAt = null, storageEstimate = null, extraWarnings = [] } = {}) {
    const warnings = [...extraWarnings];
    const compat = compatibility(app, sw);
    if (compat.status === 'UPDATE_REQUIRED') warnings.push('Versões do aplicativo e do serviço offline não combinam: atualização requer reinício.');
    if (capabilities && !capabilities.serviceWorker) warnings.push('Navegador sem suporte a uso offline: o aplicativo funciona normalmente online.');
    if (storageEstimate && storageEstimate.quota && storageEstimate.usage / storageEstimate.quota > 0.8) warnings.push('Armazenamento do aparelho quase cheio (estimativa).');
    const stale = packs.filter(p => p.state === 'STALE' || p.state === 'UPDATE_AVAILABLE').length;
    if (stale) warnings.push(`${stale} pacote(s) offline com atualização disponível.`);
    return Object.freeze({ serviceWorkerState: swState, appBuildId: app.appBuildId, serviceWorkerBuildId: sw ? sw.serviceWorkerBuildId : undefined, cacheSchemaVersion: app.cacheSchemaVersion,
      offlinePackSchemaVersion: app.offlinePackSchemaVersion, connectivityState: connectivity, installedStandalone: !!(capabilities && capabilities.displayModeStandalone),
      activeOfflinePackCount: packs.filter(p => ['READY', 'STALE', 'UPDATE_AVAILABLE'].includes(p.state)).length, pendingMutationCount, lastSyncAt: lastSyncAt || undefined,
      storageEstimate: storageEstimate ? { usage: storageEstimate.usage, quota: storageEstimate.quota } : undefined, compatibility: compat.status, warnings });
  }

  // ---------------------------------------------------------------- browser support matrix (§245–§247)
  const BROWSER_SUPPORT = Object.freeze([
    { browser: 'Chrome desktop', serviceWorker: 'SIM', installPrompt: 'SIM (beforeinstallprompt)', backgroundSync: 'SIM', periodicSync: 'SÓ APP INSTALADO', storageEstimate: 'SIM', notes: 'referência dos testes E2E (Chromium/Playwright).' },
    { browser: 'Chrome Android', serviceWorker: 'SIM', installPrompt: 'SIM', backgroundSync: 'SIM', periodicSync: 'SÓ APP INSTALADO', storageEstimate: 'SIM', notes: 'evicção sob pressão de armazenamento; pedir persistência ao preparar pacote.' },
    { browser: 'Edge', serviceWorker: 'SIM', installPrompt: 'SIM', backgroundSync: 'SIM', periodicSync: 'SÓ APP INSTALADO', storageEstimate: 'SIM', notes: 'Chromium.' },
    { browser: 'Safari macOS', serviceWorker: 'SIM', installPrompt: 'NÃO (menu Arquivo › Adicionar ao Dock)', backgroundSync: 'NÃO', periodicSync: 'NÃO', storageEstimate: 'SIM', notes: 'sincronização ao voltar ao primeiro plano.' },
    { browser: 'Safari iOS', serviceWorker: 'SIM', installPrompt: 'NÃO (Compartilhar › Adicionar à Tela de Início)', backgroundSync: 'NÃO', periodicSync: 'NÃO', storageEstimate: 'PARCIAL', notes: 'dados podem ser apagados após dias sem uso: pacote offline pode precisar ser refeito.' },
    { browser: 'Firefox', serviceWorker: 'SIM', installPrompt: 'NÃO (desktop)', backgroundSync: 'NÃO', periodicSync: 'NÃO', storageEstimate: 'SIM', notes: 'funciona como web app normal.' }
  ]);

  // ---------------------------------------------------------------- legacy inventory (§346–§352)
  const I = (location, type, behaviorDescription, flags, risk, migrationAction, notes) => Object.freeze({ location, type, behaviorDescription, ...flags, risk, migrationAction, notes });
  const LegacyPwaInventory = Object.freeze([
    I('src/sw.template.js (tópicos 10/48) fetch navigate', 'SERVICE_WORKER', 'gravava QUALQUER navegação como app shell (inclusive /s/<token>) e servia o shell offline para qualquer rota', { tenantAware: false, securityAware: false, versionAware: true, cachePolicyAware: false }, 'HIGH', 'REPLACE', 'tópico 49: só a rota do shell grava/serve o shell; /s/ e outras rotas recebem a página offline.'),
    I('src/sw.template.js CACHE_FIRST imagens', 'CACHE_RULE', 'caches.match em TODOS os caches com ignoreSearch (podia servir versão antiga de planta.webp do AssetCache)', { tenantAware: false, securityAware: true, versionAware: false, cachePolicyAware: true }, 'MEDIUM', 'REPLACE', 'agora só o cache do worker, por revisão exata (ws-img-1, ?v=<checksum>).'),
    I('src/sw.template.js runtime cache ws-runtime-v1', 'CACHE_RULE', 'cache de execução sem versão (galeria + routes/img_list)', { tenantAware: false, securityAware: true, versionAware: false, cachePolicyAware: true }, 'MEDIUM', 'REMOVE', 'apagado na ativação; substituído por ws-img-1 (por checksum) e ws-runtime-v2.'),
    I('src/sw.template.js install', 'SERVICE_WORKER', 'pré-cache com falhas engolidas (.catch(() => null)): worker instalado sem shell', { tenantAware: false, securityAware: false, versionAware: true, cachePolicyAware: false }, 'MEDIUM', 'REFACTOR', 'entradas obrigatórias (shell, página offline) fazem a instalação falhar e o worker antigo continua.'),
    I('src/sw.template.js message SKIP_WAITING', 'SERVICE_WORKER', 'skipWaiting só quando a página envia (usuário aceitou)', { tenantAware: false, securityAware: true, versionAware: true, cachePolicyAware: false }, 'LOW', 'KEEP', 'mantido; agora coordenado pelo PwaUpdateCoordinator (bloqueios, fila pendente).'),
    I('src/data/offline.js registerServiceWorker', 'SERVICE_WORKER', 'registro + aviso "Nova versão disponível" + reload no controllerchange', { tenantAware: false, securityAware: true, versionAware: false, cachePolicyAware: false }, 'LOW', 'REFACTOR', 'substituído por App.pwa.update.PwaUpdateCoordinator (estado, bloqueios, versão mista).'),
    I('src/data/offline.js Connectivity', 'CONNECTIVITY', 'estado a partir de requisições reais + eventos online/offline, sem histerese', { tenantAware: false, securityAware: false, versionAware: false, cachePolicyAware: false }, 'LOW', 'KEEP', 'continua como sinal bruto; App.pwa.connectivity aplica histerese e sonda.'),
    I('src/presentation/app.js renderNet (appUpdate)', 'OFFLINE_UI', 'faixa "Nova versão disponível" + botão Atualizar', { tenantAware: false, securityAware: false, versionAware: false, cachePolicyAware: false }, 'LOW', 'REFACTOR', 'usar App.pwaView.updateBanner (Atualizar agora / Depois, bloqueios).'),
    I('manifest.json (dados)', 'MANIFEST', 'é o CacheManifest de dados (versões/checksums), não um Web App Manifest', { tenantAware: false, securityAware: false, versionAware: true, cachePolicyAware: true }, 'LOW', 'KEEP', 'Web App Manifest novo: manifest.webmanifest.'),
    I('beforeinstallprompt / SyncManager / PeriodicSync', 'INSTALL_PROMPT', 'inexistentes antes do tópico 49', { tenantAware: false, securityAware: false, versionAware: false, cachePolicyAware: false }, 'LOW', 'REVIEW', 'InstallPromptController sem insistência; Background Sync opcional.')
  ]);

  return Object.freeze({ setSinks, OfflineCapability, InstallState, SW_LIFECYCLE, VERSIONS, CAPABILITIES, MSG, evaluate, validateRegistry, getCapability: c => BY_CODE.get(c) || null,
    detectCapabilities, appBuildInfo, compatibility, TECH_EVENTS, PRODUCT_EVENTS, scrub, emit, INSTALL_POLICY, InstallPromptController, pwaDiagnostics, BROWSER_SUPPORT, LegacyPwaInventory });
})();
