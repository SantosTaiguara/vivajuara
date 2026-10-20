/* pwa/connectivity.js — topic 49 §87–§97, §307–§310: ConnectivityService.
   navigator.onLine is only a hint (§87). The effective state combines:
     browser hint (online/offline events) + backend reachability (a light probe) + recent request failures (reported by the data layer).
   States: ONLINE (backend really reachable) · DEGRADED (browser online, requests failing) · OFFLINE (no useful connectivity) · UNKNOWN.
   Hysteresis (§308): one failed request does not flip the UI; `failuresBeforeDegraded`/`failuresBeforeOffline` consecutive failures do.
   The browser "offline" event accelerates the transition to OFFLINE; only a successful probe/request brings ONLINE back (§310).
   Probing (§92–§94): on reconnect, on foreground after a while, before a critical action (ensureOnline) and, only while DEGRADED/OFFLINE
   with the browser online, on a bounded backoff (5 s → 15 s → 60 s → 5 min). Never polling while ONLINE (§93).
   The probe defaults to HEAD manifest.json with no-store (the worker never answers HEAD/no-store); with the backend it becomes
   /api/v1/health/connectivity. No URL, token or personal data is logged. */
App.pwa = App.pwa || {};
App.pwa.connectivity = (() => {
  const POLICY = Object.freeze({ failuresBeforeDegraded: 2, failuresBeforeOffline: 4, successesBeforeOnline: 1, probeBackoffMs: Object.freeze([5000, 15000, 60000, 300000]), probeTimeoutMs: 5000, foregroundProbeAfterMs: 60000, freshContactMs: 30000 });
  const LABELS = Object.freeze({ ONLINE: 'Online', DEGRADED: 'Conexão instável', OFFLINE: 'Offline', UNKNOWN: 'Verificando conexão', SYNCING: 'Sincronizando' });

  /** default probe: HEAD on a tiny same-origin document, never cached (cache: no-store → the worker lets it through) */
  function httpProbe(url = 'manifest.json', fetchFn = null) {
    return async ({ signal } = {}) => {
      const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null); if (!f) throw new Error('fetch indisponível');
      const r = await f(url, { method: 'HEAD', cache: 'no-store', signal, credentials: 'same-origin' });
      return !!r && (r.ok || (r.status > 0 && r.status < 500)); // a 404 still proves the server answers; 5xx = backend failing
    };
  }

  function ConnectivityService({ win = (typeof window !== 'undefined' ? window : null), probe = null, policy = {}, now = () => Date.now(), timers = null, emit = null } = {}) {
    const P = { ...POLICY, ...policy };
    const T = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
    const nav = win && win.navigator;
    let browserHint = nav && nav.onLine === false ? 'OFFLINE' : 'ONLINE', reach = 'UNKNOWN', failures = 0, successes = 0, lastContact = null, lastProbeAt = 0;
    let effective = browserHint === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN', subs = [], timer = null, backoffIdx = 0, inflight = null, disposed = false;
    const listeners = [];
    const state = () => Object.freeze({ browserHint, backendReachability: reach, effectiveState: effective, lastSuccessfulBackendContactAt: lastContact ? new Date(lastContact).toISOString() : undefined });
    function derive() {
      if (browserHint === 'OFFLINE') return 'OFFLINE';
      if (failures >= P.failuresBeforeOffline) return 'OFFLINE';
      if (failures >= P.failuresBeforeDegraded) return 'DEGRADED';
      if (successes >= P.successesBeforeOnline && reach === 'REACHABLE') return 'ONLINE';
      // between thresholds keep the current state (hysteresis): ONLINE survives an isolated failure, OFFLINE needs a success to leave
      return effective === 'OFFLINE' && failures > 0 ? 'OFFLINE' : (effective === 'UNKNOWN' ? 'UNKNOWN' : effective);
    }
    function update(why) {
      const next = derive(); if (next === effective) return;
      const prev = effective; effective = next;
      if (emit) try { emit('connectivity_state_change', { from: prev, to: next, reason: why }); } catch (e) { /* telemetry */ }
      for (const fn of subs) try { fn(state(), prev); } catch (e) { console.error(e); }
      schedule();
    }
    /** report(ok, info): every real request tells the service what happened. info: { network?, status? } */
    function report(ok, info = {}) {
      const success = ok || (info.status > 0 && info.status < 500 && !info.network);
      if (success) { successes++; failures = 0; reach = 'REACHABLE'; lastContact = now(); backoffIdx = 0; }
      else { failures++; successes = 0; if (failures >= P.failuresBeforeDegraded) reach = 'UNREACHABLE'; }
      update(success ? 'request_ok' : 'request_failed');
    }
    /** probeNow(trigger) → Promise<ConnectivityState>; concurrent calls share one probe */
    function probeNow(trigger = 'manual') {
      if (!probe) return Promise.resolve(state());
      if (inflight) return inflight;
      lastProbeAt = now();
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let to = null;
      inflight = new Promise(res => { to = setTimeout(() => { if (ac) ac.abort(); res(false); }, P.probeTimeoutMs); Promise.resolve().then(() => probe({ signal: ac && ac.signal })).then(ok => res(!!ok), () => res(false)); })
        .then(ok => { clearTimeout(to); inflight = null; if (browserHint === 'OFFLINE' && ok) browserHint = 'ONLINE'; report(ok, { network: !ok }); if (!timer) schedule(); return state(); });
      return inflight;
    }
    /** bounded probing only while DEGRADED/OFFLINE with the browser claiming to be online */
    function schedule() {
      if (timer) { T.clear(timer); timer = null; }
      if (disposed || !probe || effective === 'ONLINE' || effective === 'UNKNOWN' || browserHint === 'OFFLINE') return;
      const ms = P.probeBackoffMs[Math.min(backoffIdx, P.probeBackoffMs.length - 1)]; backoffIdx++;
      timer = T.set(() => { timer = null; probeNow('backoff'); }, ms);
    }
    /** before a critical action (reserve, propose, share): a recent success is enough, otherwise probe */
    async function ensureOnline() {
      if (effective === 'ONLINE' && lastContact && now() - lastContact < P.freshContactMs) return true;
      if (browserHint === 'OFFLINE') return false;
      const s = await probeNow('critical_action'); return s.effectiveState === 'ONLINE';
    }
    const on = (target, ev, fn) => { if (target && target.addEventListener) { target.addEventListener(ev, fn); listeners.push([target, ev, fn]); } };
    on(win, 'offline', () => { browserHint = 'OFFLINE'; successes = 0; update('browser_offline'); schedule(); });
    on(win, 'online', () => { browserHint = 'ONLINE'; failures = 0; backoffIdx = 0; reach = 'UNKNOWN'; successes = 0; if (effective === 'OFFLINE') { effective = 'DEGRADED'; for (const fn of subs) try { fn(state(), 'OFFLINE'); } catch (e) { /* ui */ } } probeNow('reconnect'); });
    const doc = win && win.document;
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'visible' && now() - lastProbeAt > P.foregroundProbeAfterMs) probeNow('foreground'); });
    /** attach(legacyConnectivity): the data layer's raw reports (data/offline.js Connectivity.onReport) feed the hysteresis */
    function attach(legacy) {
      if (!legacy) return () => {};
      if (typeof legacy.onReport === 'function') return legacy.onReport((scope, ok, err) => report(ok, { network: !!(err && err.network), status: err && err.status }));
      return legacy.subscribe ? legacy.subscribe(s => { if (s === 'ONLINE') report(true); else if (s === 'OFFLINE' || s === 'DEGRADED') report(false, { network: true }); }) : () => {};
    }
    function dispose() { disposed = true; if (timer) T.clear(timer); for (const [t, ev, fn] of listeners) try { t.removeEventListener(ev, fn); } catch (e) { /* gone */ } subs = []; }
    return { getState: state, get: () => effective, report, probeNow, ensureOnline, attach, dispose, policy: P,
      subscribe: fn => { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; } };
  }

  /** indicator view model (§95): Online / Conexão instável / Offline / Sincronizando — never hidden while not ONLINE (§96) */
  function indicator(state, { syncing = false, pendingCount = 0 } = {}) {
    const s = state && state.effectiveState || 'UNKNOWN';
    if (syncing && s === 'ONLINE') return { state: 'SYNCING', label: LABELS.SYNCING, tone: 'info', visible: true };
    const tone = s === 'ONLINE' ? 'ok' : s === 'DEGRADED' ? 'warn' : s === 'OFFLINE' ? 'error' : 'muted';
    const detail = s === 'OFFLINE' ? 'Dados comerciais podem estar desatualizados.' : s === 'DEGRADED' ? 'Algumas informações podem não carregar.' : null;
    return { state: s, label: LABELS[s] || LABELS.UNKNOWN, tone, visible: s !== 'ONLINE' && s !== 'UNKNOWN' || pendingCount > 0, detail,
      pending: pendingCount > 0 ? (pendingCount === 1 ? '1 alteração aguardando sincronização' : `${pendingCount} alterações aguardando sincronização`) : null };
  }
  return Object.freeze({ POLICY, LABELS, httpProbe, ConnectivityService, indicator });
})();
