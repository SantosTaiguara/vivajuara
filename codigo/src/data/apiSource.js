/* data/apiSource.js — frontend access to the V2 backend (topic 9).
   UI → Repository → ApiClient → HTTPS/JSON → /api/v1. Components never call fetch.
   - ApiClient: base URL from DevelopmentConfig.dataSource.apiBaseUrl (never hardcoded), timeout,
     ONE controlled retry for idempotent GETs only (network error, timeout, 5xx, 429), normalized
     ApiError { code, status, message, details, traceId }, central error log (App.api.errorLog).
   - ApiLotSource(dev, { fallback }): same contract as JsonLotSource ({ kind, loadLayers }) built from
     the four snapshot endpoints. Failure policy per domain:
       static        → structural: use fallback.loadLayers() if a fallback was configured, else throw;
       analysis / commercial / availability → that layer is null with state 'error'; the composer
         then yields null / UNKNOWN for its fields (a lot is never shown as AVAILABLE by default).
   - Thin API repositories for the write phase and polling (availability, commercial, development).
   Runs in the browser and in the Node vm harness (uses the global fetch; AbortController when present). */
App.api = (() => {
  const errorLog = [];
  const DEFAULT_TIMEOUT_MS = 10000, RETRY_DELAY_MS = 300, MAX_LOG = 50;

  function ApiError(o) {
    const e = new Error(o.message || 'Erro na API');
    e.name = 'ApiError'; e.code = o.code || 'API_ERROR'; e.status = o.status == null ? null : o.status;
    e.details = o.details == null ? null : o.details; e.traceId = o.traceId || null; e.method = o.method || 'GET'; e.path = o.path || null;
    e.retriable = !!o.retriable;
    return e;
  }
  const isRetriable = e => e.retriable === true;

  function logError(e, attempt) {
    const entry = { at: new Date().toISOString(), method: e.method, path: e.path, status: e.status, code: e.code, traceId: e.traceId, attempt };
    errorLog.push(entry); if (errorLog.length > MAX_LOG) errorLog.shift();
    try { App.lifecycle && App.lifecycle.note('api error', entry); } catch (_) { /* never break the caller */ }
    if (App.debug) console.warn('[api]', entry);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** ApiClient({ baseUrl, timeoutMs, retries, etagCache }) */
  function ApiClient(opts = {}) {
    const baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const retries = opts.retries == null ? 1 : Math.min(opts.retries, 1); // controlled: at most one retry
    // Manual ETag revalidation is opt-in (Node/tests); browsers already revalidate through their HTTP cache,
    // and a custom If-None-Match header would force a CORS preflight on every GET.
    const etags = opts.etagCache ? new Map() : null;

    async function once(method, path, body) {
      if (!baseUrl) throw ApiError({ code: 'API_NOT_CONFIGURED', message: 'dataSource.apiBaseUrl não configurado', method, path });
      const url = baseUrl + path;
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const cached = etags && method === 'GET' ? etags.get(url) : null;
      if (cached) headers['If-None-Match'] = cached.etag;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(ApiError({ code: 'TIMEOUT', message: `Tempo limite de ${timeoutMs} ms excedido`, method, path, retriable: true })); }, timeoutMs);
      });
      let res;
      try {
        res = await Promise.race([fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined }), timeout]);
      } catch (e) {
        if (e && e.name === 'ApiError') throw e;
        throw ApiError({ code: 'NETWORK_ERROR', message: 'Falha de rede ao acessar a API', method, path, retriable: true });
      } finally { clearTimeout(timer); }
      if (res.status === 304 && cached) return cached.body;
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok) {
        const d = data && typeof data === 'object' ? data : {};
        throw ApiError({ code: d.code || `HTTP_${res.status}`, status: res.status, message: d.message || `HTTP ${res.status}`, details: d.details, traceId: d.traceId,
          method, path, retriable: res.status >= 500 || res.status === 429 });
      }
      const etag = etags && res.headers && res.headers.get ? res.headers.get('etag') : null;
      if (etag) etags.set(url, { etag, body: data });
      return data;
    }

    async function request(method, path, body) {
      const attempts = method === 'GET' ? 1 + retries : 1; // writes are never retried automatically (no idempotency key yet)
      for (let i = 1; ; i++) {
        try { return await once(method, path, body); }
        catch (e) {
          logError(e, i);
          if (i >= attempts || !isRetriable(e)) throw e;
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    return { baseUrl, timeoutMs, get: path => request('GET', path), patch: (path, body) => request('PATCH', path, body) };
  }

  const clientFor = (dev, opts = {}) => opts.client || ApiClient({ baseUrl: (dev.dataSource || {}).apiBaseUrl, timeoutMs: (dev.dataSource || {}).timeoutMs });
  const devPath = dev => `/developments/${encodeURIComponent(dev.id)}`;
  const LAYERS = ['static', 'analysis', 'commercial', 'availability'];
  const endpoints = dev => ({ static: devPath(dev) + '/lots/static', analysis: devPath(dev) + '/analysis/current', commercial: devPath(dev) + '/commercial/current', availability: devPath(dev) + '/availability' });

  /** ApiLotSource(dev, { fallback, client }) → { kind: 'api', loadLayers } (same contract as JsonLotSource). */
  function ApiLotSource(dev, opts = {}) {
    const client = clientFor(dev, opts), fallback = opts.fallback || null, ep = endpoints(dev), L = App.lifecycle;
    const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    const invalid = (kind, snap, ids) => { const errs = L.validateSnapshot(snap, kind, dev.id, ids); return errs.length ? ApiError({ code: 'INVALID_SNAPSHOT', message: `snapshot ${kind} inválido: ${errs.slice(0, 3).map(e => e.code).join(', ')}`, details: errs.slice(0, 10), path: ep[kind] }) : null; };
    async function loadLayers() {
      const res = await Promise.all(LAYERS.map(k => settle(client.get(ep[k]))));
      const byKind = Object.fromEntries(LAYERS.map((k, i) => [k, res[i]]));
      const st = byKind.static;
      const staticErr = st.ok ? invalid('static', st.v, null) : st.e;
      if (staticErr) {
        if (st.ok) logError(staticErr, 1);
        if (fallback) { // structural failure: whole JSON dataset (never a mix of API and JSON layers)
          L.note('api static failed, using JSON fallback', { code: staticErr.code, traceId: staticErr.traceId });
          const out = await fallback.loadLayers();
          return { ...out, warnings: (out.warnings || []).concat([{ code: 'API_FALLBACK_JSON', lotId: null, fieldKey: null, message: `API indisponível (${staticErr.code}); dados carregados do JSON publicado` }]), fallbackUsed: true };
        }
        throw staticErr;
      }
      const layers = { static: st.v }, states = { static: 'ready' }, warnings = [];
      const ids = new Set(Object.keys(st.v.lots));
      for (const k of LAYERS.slice(1)) {
        const r = byKind[k], err = r.ok ? invalid(k, r.v, ids) : r.e;
        if (err) {
          if (r.ok) logError(err, 1);
          layers[k] = null; states[k] = 'error';
          warnings.push({ code: 'API_LAYER_UNAVAILABLE', lotId: null, fieldKey: null, message: `${k}: ${err.code}${err.traceId ? ' (trace ' + err.traceId + ')' : ''}` });
        } else { layers[k] = r.v; states[k] = 'ready'; }
      }
      return { layers, states, warnings, variants: [], unmapped: [], fallbackUsed: false };
    }
    return { kind: 'api', loadLayers, client };
  }

  /** Thin API repositories (read polling + the guarded write command). */
  function ApiAvailabilityRepository(dev, opts = {}) {
    const client = clientFor(dev, opts);
    return {
      getSnapshot: () => client.get(endpoints(dev).availability),
      getHistory: lotId => client.get(`/lots/${encodeURIComponent(lotId)}/availability/history`),
      /** UpdateAvailabilityRequest { status, expectedRevision, reason?, reservedUntil?, proposalId?, notes? } — never retried */
      updateAvailability: (lotId, cmd) => client.patch(`/lots/${encodeURIComponent(lotId)}/availability`, cmd)
    };
  }
  function ApiCommercialRepository(dev, opts = {}) {
    const client = clientFor(dev, opts);
    return { getCurrentSnapshot: () => client.get(endpoints(dev).commercial), getCurrentPriceTable: () => client.get(devPath(dev) + '/commercial/price-tables/current') };
  }
  function ApiDevelopmentRepository(dev, opts = {}) {
    const client = clientFor(dev, opts);
    return { getConfig: () => client.get(devPath(dev) + '/config'), getMapLots: () => client.get(devPath(dev) + '/map-lots'), getAssets: () => client.get(devPath(dev) + '/assets'),
      getLot: lotId => client.get(`/lots/${encodeURIComponent(lotId)}`) };
  }

  return Object.freeze({ ApiClient, ApiError, ApiLotSource, ApiAvailabilityRepository, ApiCommercialRepository, ApiDevelopmentRepository, errorLog });
})();
