/* pwa/update.js — topic 49 §37–§47, §210–§219, §311–§313, §368–§369, §377: PwaUpdateCoordinator.
   A new worker installs in the background and WAITS. Nothing is activated automatically (autoActivate NEVER by default, §38):
     new worker waiting → "Nova versão disponível" → user confirms → blockers checked (proposal, unsaved customer edit, active presentation
     step, unsaved financial input, pending offline changes with an incompatible queue schema) → safe state saved → SKIP_WAITING →
     controllerchange → ONE controlled reload. If the activation does not happen in time the old version keeps running (UPDATE_FAILED).
   Pending offline mutations are never deleted by an update (§218): with a compatible queue schema they survive; otherwise the update waits
   until they are synchronized (§219). Mixed versions (another tab activated a newer worker, or a schema change) → RELOAD_REQUIRED,
   never silent operation (§47). Update checks: app start, foreground after a long time, manual — never every minute (§312/§313).
   States: UP_TO_DATE · CHECKING · UPDATE_AVAILABLE · ACTIVATION_PENDING · ACTIVATING · RELOAD_REQUIRED · UPDATE_FAILED.
   Messages are in pt-BR without technical terms (§221). */
App.pwa = App.pwa || {};
App.pwa.update = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const PwaUpdateState = E('UP_TO_DATE', 'CHECKING', 'UPDATE_AVAILABLE', 'ACTIVATION_PENDING', 'ACTIVATING', 'RELOAD_REQUIRED', 'UPDATE_FAILED');
  const DEFAULT_POLICY = Object.freeze({ autoActivate: 'NEVER', requireUserConfirmationForBreakingUpdate: true, forceUpdateAfterSeconds: undefined, allowDeferredActivation: true,
    minCheckIntervalMs: 3600e3, foregroundCheckAfterMs: 6 * 3600e3, activationTimeoutMs: 10000 });
  /** activity codes that block an activation (§43) and the wording shown to the user */
  const BLOCKER_TEXT = Object.freeze({
    PROPOSAL_IN_PROGRESS: 'a proposta em andamento', CUSTOMER_EDIT_UNSAVED: 'a edição do cliente', PRESENTATION_STEP_ACTIVE: 'a apresentação em andamento',
    FINANCIAL_INPUT_UNSAVED: 'a simulação não salva', QUEUE_SCHEMA_INCOMPATIBLE: 'a sincronização das alterações pendentes'
  });
  const core = () => App.pwa.core;

  function askVersion(worker, timeoutMs = 3000) {
    return new Promise(res => {
      if (!worker || typeof worker.postMessage !== 'function') return res(null);
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      try {
        if (typeof MessageChannel !== 'undefined') { const ch = new MessageChannel(); ch.port1.onmessage = e => fin(e.data && e.data.type === 'SW_VERSION' ? e.data : null); worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }
        else worker.postMessage({ type: 'GET_VERSION' });
      } catch (e) { fin(null); }
      setTimeout(() => fin(null), timeoutMs);
    });
  }

  /** PwaUpdateCoordinator — checkForUpdate(), getState(), activateWaitingVersion(mode) (§44) + register(), later(), viewModel() */
  function PwaUpdateCoordinator({ container = (typeof navigator !== 'undefined' && navigator.serviceWorker) || null, app = null, policy = {}, activity = () => [],
    pendingMutations = async () => ({ count: 0, schemaVersion: null }), saveState = () => {}, reload = () => { if (typeof location !== 'undefined') location.reload(); },
    now = () => Date.now(), emit = null, onChange = null, onSyncRequested = null, versionOf = askVersion } = {}) {
    const P = { ...DEFAULT_POLICY, ...policy };
    const appInfo = app || core().appBuildInfo();
    let state = PwaUpdateState.UP_TO_DATE, reg = null, swInfo = null, waitingInfo = null, compat = { status: 'NO_WORKER', reasons: [] }, blockers = [], lastCheckAt = 0, error = null;
    let userConfirmed = false, activating = false, reloaded = false, deferredUntilNextCheck = false, waitingSince = null, supported = !!container;
    const tel = (n, d) => { if (emit) try { emit(n, d); } catch (e) { /* telemetry */ } };
    const set = (s, extra = {}) => { const prev = state; state = s; Object.assign(holder, extra); if (prev !== s && onChange) try { onChange(getState(), prev); } catch (e) { console.error(e); } };
    const holder = {};
    function getState() {
      return Object.freeze({ state, supported, blockers: blockers.slice(), swInfo, waitingInfo, compatibility: compat.status, compatibilityReasons: compat.reasons, lastCheckAt: lastCheckAt || null, error,
        hiddenUntilNextCheck: deferredUntilNextCheck, forced: isForced() });
    }
    const isForced = () => !!(P.forceUpdateAfterSeconds && waitingSince && now() - waitingSince >= P.forceUpdateAfterSeconds * 1000);
    async function onWaiting() {
      if (!reg || !reg.waiting) return;
      waitingSince = waitingSince || now(); waitingInfo = await versionOf(reg.waiting);
      deferredUntilNextCheck = false;
      if (state !== PwaUpdateState.ACTIVATING && state !== PwaUpdateState.ACTIVATION_PENDING) { set(PwaUpdateState.UPDATE_AVAILABLE); tel('sw_update_available', { build: waitingInfo ? waitingInfo.serviceWorkerBuildId : undefined }); }
      if (P.autoActivate === 'SAFE_ONLY' || P.autoActivate === 'ALWAYS') activateWaitingVersion('SAFE_AUTO');
    }
    function wire(r) {
      if (!r || r.__wsWired) return; r.__wsWired = true;
      r.addEventListener && r.addEventListener('updatefound', () => {
        const w = r.installing; if (!w) return;
        const firstInstall = !container.controller;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') { if (firstInstall) tel('sw_install_success', { kind: 'first' }); else onWaiting(); }
          else if (w.state === 'redundant' && !activating && r.waiting !== w && r.active !== w) { tel(firstInstall ? 'sw_install_failure' : 'sw_update_failed', { kind: firstInstall ? 'first' : 'update' }); if (!firstInstall) { error = 'INSTALL_FAILED'; set(PwaUpdateState.UPDATE_FAILED); } }
        });
      });
    }
    function onControllerChange() {
      if (activating && userConfirmed) { if (!reloaded) { reloaded = true; set(PwaUpdateState.RELOAD_REQUIRED); try { reload(); } catch (e) { /* host */ } } return; }
      // a worker this page did not ask for took over (another tab accepted an update): this page runs older code → ask for a restart
      if (swInfo) { set(PwaUpdateState.RELOAD_REQUIRED); checkVersion(); }
    }
    /** register(url) — progressive enhancement: without Service Worker support the app keeps working online (§250, §372) */
    async function register(url = 'sw.js') {
      if (!container) { supported = false; return getState(); }
      try {
        container.addEventListener && container.addEventListener('controllerchange', onControllerChange);
        container.addEventListener && container.addEventListener('message', e => {
          const d = e && e.data; if (!d) return;
          if (d.type === 'SW_EVENT' && core().TECH_EVENTS.includes(d.name)) tel(d.name, { build: d.build });
          if (d.type === 'SYNC_REQUESTED' && onSyncRequested) try { onSyncRequested(); } catch (x) { /* app */ }
        });
        reg = await container.register(url);
        wire(reg);
        if (reg.waiting && container.controller) await onWaiting();
        await checkVersion();
      } catch (e) { error = 'REGISTER_FAILED'; tel('sw_install_failure', { kind: 'register' }); }
      return getState();
    }
    /** mixed-version detection: compare the controlling worker with this page's build (§46, §47) */
    async function checkVersion() {
      if (!container || !container.controller) { compat = { status: 'NO_WORKER', reasons: [] }; return compat; }
      swInfo = await versionOf(container.controller);
      compat = core().compatibility(appInfo, swInfo);
      if (compat.status === 'UPDATE_REQUIRED' && state !== PwaUpdateState.ACTIVATING) set(PwaUpdateState.RELOAD_REQUIRED);
      return compat;
    }
    /** checkForUpdate(trigger): APP_START / FOREGROUND / MANUAL. Automatic triggers are rate limited (§312). */
    async function checkForUpdate(trigger = 'MANUAL') {
      if (!reg) return getState();
      if (trigger !== 'MANUAL' && now() - lastCheckAt < (trigger === 'FOREGROUND' ? P.foregroundCheckAfterMs : P.minCheckIntervalMs)) return getState();
      lastCheckAt = now();
      const prev = state; if (state === PwaUpdateState.UP_TO_DATE) set(PwaUpdateState.CHECKING);
      try { await reg.update(); } catch (e) { error = 'CHECK_FAILED'; } // offline: nothing to do, the current version keeps running
      if (reg.waiting && container.controller) await onWaiting();
      else if (state === PwaUpdateState.CHECKING) set(prev === PwaUpdateState.CHECKING ? PwaUpdateState.UP_TO_DATE : prev);
      return getState();
    }
    async function currentBlockers() {
      const out = [];
      for (const a of (activity() || [])) { const code = typeof a === 'string' ? a : a && a.code; if (code && !out.some(b => b.code === code)) out.push({ code, label: BLOCKER_TEXT[code] || 'a ação em andamento' }); }
      let pend = { count: 0, schemaVersion: null };
      try { pend = (await pendingMutations()) || pend; } catch (e) { /* unknown queue: treat as empty, never delete it */ }
      const target = waitingInfo && waitingInfo.queueSchemaVersion;
      if (pend.count > 0 && target && pend.schemaVersion && String(target) !== String(pend.schemaVersion)) out.push({ code: 'QUEUE_SCHEMA_INCOMPATIBLE', label: BLOCKER_TEXT.QUEUE_SCHEMA_INCOMPATIBLE, pendingCount: pend.count });
      return { blockers: out, pending: pend };
    }
    /** activateWaitingVersion(mode): USER_CONFIRMED (the banner button) or SAFE_AUTO (only when the policy allows and nothing blocks) */
    async function activateWaitingVersion(mode = 'USER_CONFIRMED') {
      if (!reg || !reg.waiting) return { ok: false, code: 'NO_WAITING_VERSION' };
      if (mode === 'SAFE_AUTO' && P.autoActivate === 'NEVER') return { ok: false, code: 'AUTO_ACTIVATION_DISABLED' };
      if (mode === 'SAFE_AUTO' && P.requireUserConfirmationForBreakingUpdate && waitingInfo && core().compatibility(appInfo, waitingInfo).status === 'UPDATE_REQUIRED') return { ok: false, code: 'USER_CONFIRMATION_REQUIRED' };
      if (mode === 'USER_CONFIRMED') userConfirmed = true;
      const { blockers: b, pending } = await currentBlockers();
      blockers = b;
      if (b.length) { set(PwaUpdateState.ACTIVATION_PENDING); return { ok: false, code: 'BLOCKED', blockers: b }; }
      activating = true; userConfirmed = true; set(PwaUpdateState.ACTIVATING);
      try { await saveState({ pendingMutationCount: pending.count }); } catch (e) { /* state saving is best effort; the URL hash keeps the view */ }
      const changed = new Promise(res => { const t = setTimeout(() => res(false), P.activationTimeoutMs); const h = () => { clearTimeout(t); res(true); }; if (container.addEventListener) container.addEventListener('controllerchange', h, { once: true }); });
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* worker gone */ }
      const ok = await changed;
      if (!ok) { activating = false; error = 'ACTIVATION_TIMEOUT'; set(PwaUpdateState.UPDATE_FAILED); tel('sw_update_failed', { reason: 'timeout' }); return { ok: false, code: 'ACTIVATION_TIMEOUT' }; }
      return { ok: true, pendingMutationCount: pending.count };
    }
    /** the app tells the coordinator that an activity started/ended; a confirmed, pending activation proceeds when nothing blocks anymore */
    async function activityChanged() { if (state === PwaUpdateState.ACTIVATION_PENDING && userConfirmed) return activateWaitingVersion('USER_CONFIRMED'); return { ok: false, code: 'NOTHING_PENDING' }; }
    /** "Depois": hide until the next check (deferred activation, §40) — not available for a forced update */
    function later() { if (!P.allowDeferredActivation || isForced()) return false; deferredUntilNextCheck = true; userConfirmed = false; if (state === PwaUpdateState.ACTIVATION_PENDING) set(PwaUpdateState.UPDATE_AVAILABLE); else if (onChange) onChange(getState(), state); return true; }
    function reloadNow() { if (reloaded) return; reloaded = true; try { reload(); } catch (e) { /* host */ } }
    /** foreground trigger helper */
    function attachTriggers(win = (typeof window !== 'undefined' ? window : null)) {
      const doc = win && win.document; if (!doc || !doc.addEventListener) return () => {};
      const h = () => { if (doc.visibilityState === 'visible') checkForUpdate('FOREGROUND'); };
      doc.addEventListener('visibilitychange', h); return () => doc.removeEventListener('visibilitychange', h);
    }
    return { register, checkForUpdate, getState, activateWaitingVersion, activityChanged, later, reloadNow, checkVersion, attachTriggers, policy: P, get registration() { return reg; } };
  }

  /** viewModel(state) → banner for the shell (role=status, keyboard reachable, never blocking without need, §222) */
  function viewModel(s) {
    if (!s || !s.supported) return null;
    const A = (act, label, primary) => ({ act, label, primary: !!primary });
    switch (s.state) {
      case 'UPDATE_AVAILABLE': if (s.hiddenUntilNextCheck) return null;
        return { tone: 'info', text: s.forced ? 'Atualização necessária. Conclua o que está fazendo e atualize.' : 'Nova versão disponível.', actions: s.forced ? [A('pwaUpdateNow', 'Atualizar agora', true)] : [A('pwaUpdateNow', 'Atualizar agora', true), A('pwaUpdateLater', 'Depois')] };
      case 'ACTIVATION_PENDING': return { tone: 'info', text: 'Atualização pronta. Ela será aplicada quando você concluir ' + s.blockers.map(b => b.label).join(', ') + '.', actions: [A('pwaUpdateLater', 'Depois')] };
      case 'ACTIVATING': return { tone: 'info', text: 'Atualizando…', actions: [] };
      case 'RELOAD_REQUIRED': return { tone: 'warn', text: 'Atualização requer reinício.', actions: [A('pwaReload', 'Reiniciar agora', true)] };
      case 'UPDATE_FAILED': return { tone: 'warn', text: 'Não foi possível atualizar agora. A versão atual continua funcionando.', actions: s.error === 'INSTALL_FAILED' ? [] : [A('pwaUpdateNow', 'Tentar novamente')] };
      default: return null;
    }
  }
  return Object.freeze({ PwaUpdateState, DEFAULT_POLICY, BLOCKER_TEXT, askVersion, PwaUpdateCoordinator, viewModel });
})();
