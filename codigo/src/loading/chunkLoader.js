/* loading/chunkLoader.js — round 6 (code splitting): App.chunks, the runtime half of the split plan in loading/resources.js
   (FEATURE_MODULES, lazy: true). The build (scripts/chunks.js) writes dash/chunks/<chunk>.<hash>.js and puts the manifest in the
   page as App.CHUNK_MANIFEST = { <chunk>: { file, integrity, bytes, deps, css } }; each chunk ends with App.chunks._done('<chunk>').
   - ensure(name) → Promise: dependencies first, one <script> per chunk (deduplicated in flight), same-origin + SRI integrity,
     resolves only after the chunk ran to the end; a failure rejects with code CHUNK_LOAD_FAILED and can be retried.
   - need(name) → boolean: true when loaded; otherwise starts loading in the background and returns false (callers render
     a short loading state; onReady listeners re-render when it arrives).
   - Without a manifest (tests in the vm, an unsplit build) every chunk counts as loaded: the modules are already in App.
   The Service Worker precaches every chunk (scripts/pwaBuild.js), so a view opened for the first time offline still works.
   No data, no PII, no third party: chunks are code of this build only. */
App.chunks = (() => {
  const M = () => App.CHUNK_MANIFEST || null;
  const state = new Map(); // name → { status: LOADING | READY | ERROR, promise, ms, error }
  const ran = new Set(), listeners = [];
  const split = () => !!M();
  const known = name => !split() || Object.prototype.hasOwnProperty.call(M(), name);
  /** isLoaded(name): its modules are in App (the chunk ran to its last line); always true without a split build */
  const isLoaded = name => !split() || (known(name) && ran.has(name));
  const doc = () => (typeof document !== 'undefined' ? document : null);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const err = (code, name, cause) => Object.assign(new Error(code === 'CHUNK_UNKNOWN' ? `parte do painel desconhecida: ${name}` : `não foi possível carregar a parte "${name}" do painel`), { code, chunk: name, cause: cause && cause.message });
  /** same origin as the page → SRI integrity is safe (a cross-origin host would need CORS headers for SRI) */
  function sameOrigin(url) { try { const d = doc(); return new URL(url, d.baseURI).origin === location.origin && location.origin !== 'null'; } catch (e) { return false; } }
  function addCss(href) {
    const d = doc(); if (!d) return Promise.resolve();
    if (d.querySelector && d.querySelector(`link[data-chunk-css="${href}"]`)) return Promise.resolve();
    return new Promise(res => { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-chunk-css', href); l.onload = () => res(); l.onerror = () => res(); (d.head || d.documentElement).appendChild(l); });
  }
  function addScript(name, entry) {
    const d = doc(); if (!d) return Promise.reject(err('CHUNK_LOAD_FAILED', name));
    return new Promise((res, rej) => {
      const s = d.createElement('script'); s.src = entry.file; s.async = true; s.setAttribute('data-chunk', name);
      if (entry.integrity && sameOrigin(entry.file)) s.integrity = entry.integrity;
      s.onload = () => (ran.has(name) ? res() : rej(err('CHUNK_INCOMPLETE', name)));
      s.onerror = () => { try { s.remove(); } catch (e) { /* detached */ } rej(err('CHUNK_LOAD_FAILED', name)); };
      (d.head || d.documentElement).appendChild(s);
    });
  }
  function emit(name, ok, e) { for (const fn of listeners.slice()) { try { fn(name, ok, e || null); } catch (x) { /* a listener never breaks the loader */ } } }
  /** ensure(name) → Promise<void> */
  function ensure(name) {
    if (!split()) return Promise.resolve();
    if (!known(name)) return Promise.reject(err('CHUNK_UNKNOWN', name));
    const cur = state.get(name);
    if (cur && (cur.status === 'READY' || cur.status === 'LOADING')) return cur.promise;
    const entry = M()[name], t0 = now();
    const promise = (async () => {
      for (const dep of entry.deps || []) await ensure(dep);
      await Promise.all((entry.css || []).map(addCss));
      if (!ran.has(name)) await addScript(name, entry);
    })().then(() => { state.set(name, { status: 'READY', promise, ms: Math.round(now() - t0) }); emit(name, true); },
      e => { state.set(name, { status: 'ERROR', promise: null, error: e && e.code }); emit(name, false, e); throw e; });
    state.set(name, { status: 'LOADING', promise });
    return promise;
  }
  /** ensureAll(names) → Promise<void> */
  const ensureAll = names => Promise.all((names || []).filter(Boolean).map(ensure)).then(() => undefined);
  /** need(name) → true when usable now; otherwise loads it in the background (onReady re-renders) and returns false */
  function need(name) {
    if (isLoaded(name)) return true;
    const cur = state.get(name);
    if (!cur) ensure(name).catch(() => { /* reported through onReady(name, false) */ }); // a failed chunk waits for retryFailed()
    return false;
  }
  /** retryFailed() — the user asked to try again: failed chunks may load again (need() never retries on its own) */
  function retryFailed() { for (const [n, v] of state) if (v.status === 'ERROR') state.delete(n); }
  /** has(name) → the feature exists in this build (button visibility before the code arrives) */
  const has = name => known(name);
  /** onReady(fn(name, ok, error)) → unsubscribe */
  function onReady(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  /** called by the last line of every chunk file */
  function _done(name) { ran.add(name); if (!state.has(name)) state.set(name, { status: 'READY', promise: Promise.resolve(), ms: 0 }); }
  /** status() → diagnostics (no URL beyond the chunk file name, no data) */
  const status = () => Object.fromEntries(Object.keys(M() || {}).map(n => [n, { state: isLoaded(n) ? 'READY' : (state.get(n) || {}).status || 'NOT_LOADED', bytes: M()[n].bytes, ms: (state.get(n) || {}).ms || null, error: (state.get(n) || {}).error || null }]));
  const failed = name => (state.get(name) || {}).status === 'ERROR';
  return Object.freeze({ ensure, ensureAll, need, retryFailed, isLoaded, has, failed, onReady, _done, status, split });
})();
