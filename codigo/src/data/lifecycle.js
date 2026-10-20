/* data/lifecycle.js — STATIC / VERSIONED / DYNAMIC separation (data lifecycle).
   The Field Registry's dynamicType is the only classification. lots.json stays the
   single physical file for now; the separation is logical:
     raw → Normalizer → split → StaticSnapshot + AnalysisSnapshot + CommercialSnapshot + AvailabilitySnapshot
                                  → LotComposer → LotFactory → Lot
   Each snapshot carries its own version, is validated before it replaces the
   previous one and is cached under its own key, so a price change never touches
   geometry and a new analysis never touches price or availability. */
App.lifecycle = (() => {
  const M = App.model, D = App.domain, get = M.get;
  const STORED = M.getStoredFields().filter(f => !f.key.startsWith('metadata.'));
  // DYNAMIC has two independent channels: commercial and availability.
  const layerOf = f => f.dynamicType === 'STATIC' ? 'static' : f.dynamicType === 'VERSIONED' ? 'analysis' : f.key.startsWith('availability.') ? 'availability' : 'commercial';
  const LAYERS = ['static', 'analysis', 'commercial', 'availability'];
  const FIELDS = Object.fromEntries(LAYERS.map(l => [l, STORED.filter(f => layerOf(f) === l)]));
  const LAYER_BY_KEY = new Map(STORED.map(f => [f.key, layerOf(f)]));
  const VERSION_KEY = { static: 'staticDataVersion', analysis: 'analysisVersion', commercial: 'priceTableVersion', availability: 'revision' };
  const log = [];
  const note = (event, data) => { log.push({ event, ...data, at: Date.now() }); if (log.length > 200) log.shift(); if (App.debug) console.info('[dados]', event, data); };

  /** extract one layer of a Lot (or of normalized data): values + the provenance of those fields */
  function extract(lot, layer) {
    const out = {};
    for (const f of FIELDS[layer]) { const v = get(lot, f.key); if (v !== undefined) D.setPath(out, f.key, v); }
    const prov = Object.entries(lot.provenance || {}).filter(([k]) => LAYER_BY_KEY.get(k) === layer);
    if (prov.length) out.provenance = Object.fromEntries(prov);
    return out;
  }
  const extractStaticData = lot => extract(lot, 'static');
  const extractVersionedData = lot => extract(lot, 'analysis');
  const extractDynamicData = lot => ({ commercial: extract(lot, 'commercial'), availability: extract(lot, 'availability') });
  const splitLotData = lot => ({ static: extract(lot, 'static'), versioned: extract(lot, 'analysis'), dynamic: extractDynamicData(lot) });

  /** snapshot = { kind, schemaVersion, developmentId, <version>, timestamps, lots: { [lotId]: partial } } */
  function snapshot(kind, developmentId, meta, lots) { return { kind, schemaVersion: D.SCHEMA_VERSION, developmentId, ...meta, lots }; }

  /** validateSnapshot: schema, development, and no field from another layer (no duplication across layers) */
  function validateSnapshot(s, kind, developmentId, staticIds) {
    const errors = [];
    if (!s || s.kind !== kind) errors.push({ code: 'SNAPSHOT_KIND', message: `esperado ${kind}` });
    else {
      if (s.schemaVersion !== D.SCHEMA_VERSION) errors.push({ code: 'SCHEMA_MISMATCH', message: `schema ${s.schemaVersion}, esperado ${D.SCHEMA_VERSION}` });
      if (s.developmentId !== developmentId) errors.push({ code: 'DEVELOPMENT_MISMATCH', message: `${s.developmentId} ≠ ${developmentId}` });
      if (s[VERSION_KEY[kind]] == null) errors.push({ code: 'MISSING_VERSION', message: `${VERSION_KEY[kind]} ausente` });
      if (!s.lots || typeof s.lots !== 'object') errors.push({ code: 'NO_LOTS', message: 'lista de lotes ausente' });
      else for (const [id, part] of Object.entries(s.lots)) {
        if (staticIds && !staticIds.has(id)) { errors.push({ code: 'ORPHAN_LOT', lotId: id, message: 'lote inexistente nos dados estáticos' }); continue; }
        (function walk(o, path) {
          for (const k of Object.keys(o)) {
            if (!path && k === 'provenance') { for (const pk of Object.keys(o.provenance)) if (LAYER_BY_KEY.get(pk) !== kind) errors.push({ code: 'LAYER_VIOLATION', lotId: id, fieldKey: pk, message: 'proveniência de outra camada' }); continue; }
            const p = path ? path + '.' + k : k, lk = LAYER_BY_KEY.get(p);
            if (lk) { if (lk !== kind) errors.push({ code: 'LAYER_VIOLATION', lotId: id, fieldKey: p, message: `campo da camada ${lk}` }); }
            else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) walk(o[k], p);
            else errors.push({ code: 'UNKNOWN_FIELD', lotId: id, fieldKey: p, message: 'campo fora do registro' });
          }
        })(part, '');
      }
    }
    return errors;
  }

  /** FreshnessPolicy (topic 10): per domain, per development (DevelopmentConfig.freshnessPolicy).
      Time limits are a business decision, so the defaults are null (no time limit): freshness then depends only
      on whether the official source confirmed the value in this session. Static and analysis data are valid
      until their version changes. */
  const FreshnessPolicy = Object.freeze({ staticMaxAgeMs: null, analysisMaxAgeMs: null, commercialMaxAgeMs: null, availabilityMaxAgeMs: null,
    commercialExpireAfterMs: null, availabilityExpireAfterMs: null });
  function policyFor(devId) { const d = App.config && App.config.DEVELOPMENTS.find(x => x.id === devId); return { ...FreshnessPolicy, ...((d && d.freshnessPolicy) || {}) }; }
  /** FreshnessState of a dynamic snapshot: FRESH only when the source confirmed it (source REMOTE, not marked stale);
      a cached or bundled copy is STALE; beyond the validity or the expire limit it is EXPIRED; nothing → UNKNOWN. */
  function freshnessState(s, now = Date.now()) {
    if (!s) return { status: 'UNKNOWN', lastSuccessfulSyncAt: null, sourceUpdatedAt: null, maxAgePolicy: null, source: null };
    const p = policyFor(s.developmentId), max = p[s.kind + 'MaxAgeMs'], exp = p[s.kind + 'ExpireAfterMs'];
    const ref = s.confirmedAt || (s.source === 'CACHE' || s.source === 'BUNDLED' ? null : s.updatedAt);
    const out = { lastSuccessfulSyncAt: s.confirmedAt || null, sourceUpdatedAt: s.updatedAt || null, maxAgePolicy: max == null ? null : max, source: s.source || 'REMOTE' };
    let st;
    if (s.validUntil && now > Date.parse(s.validUntil)) st = 'EXPIRED';
    else if (s.kind === 'availability' && !s.updatedAt) st = 'UNKNOWN';
    else if (exp != null && ref && now - Date.parse(ref) > exp) st = 'EXPIRED';
    else if (s.stale || s.source === 'CACHE' || s.source === 'BUNDLED') st = 'STALE';
    else if (max != null && ref && now - Date.parse(ref) > max) st = 'STALE';
    else st = 'FRESH';
    return { status: st, ...out };
  }
  const freshness = (s, now) => freshnessState(s, now).status;

  /** LotComposer: static + analysis + commercial + availability → normalized Lot data (not yet validated).
      A missing layer yields null/UNKNOWN (never a semantic default). */
  function composeOne(id, layers, now) {
    const d = {}, prov = {};
    for (const l of LAYERS) {
      const part = layers[l] && layers[l].lots[id];
      for (const f of FIELDS[l]) { const v = part ? get(part, f.key) : undefined; D.setPath(d, f.key, v === undefined ? D.emptyValue(f) : v); }
      if (part && part.provenance) Object.assign(prov, part.provenance);
    }
    d.provenance = prov;
    d.metadata = {
      schemaVersion: D.SCHEMA_VERSION, createdAt: null, updatedAt: null,
      dataVersions: { staticVersion: v(layers.static, 'staticDataVersion'), analysisVersion: v(layers.analysis, 'analysisVersion'), priceTableVersion: v(layers.commercial, 'priceTableVersion'), availabilityRevision: v(layers.availability, 'revision') },
      freshness: { commercial: layers.commercial ? freshness(layers.commercial, now) : 'UNKNOWN', availability: layers.availability ? freshness(layers.availability, now) : 'UNKNOWN' }
    };
    // a lot missing from the availability snapshot stays UNKNOWN (never AVAILABLE); freshness comes from the snapshot
    d.availability.freshness = d.availability.status === 'UNKNOWN' ? 'UNKNOWN' : d.metadata.freshness.availability;
    return d;
  }
  const v = (s, k) => (s && s[k] != null ? s[k] : null);
  function compose(layers, now = Date.now()) {
    if (!layers.static) throw new Error('Dados estáticos ausentes: não é possível compor lotes sem identidade e geometria');
    const ids = new Set(Object.keys(layers.static.lots)), orphans = [];
    for (const l of ['analysis', 'commercial', 'availability']) if (layers[l]) for (const id of Object.keys(layers[l].lots)) if (!ids.has(id)) orphans.push({ layer: l, lotId: id });
    orphans.forEach(o => note('orphan ignored', o));
    const res = D.LotFactory.createMany([...ids].map(id => composeOne(id, layers, now)));
    return { ...res, orphans };
  }

  /** Dependency graph from the registry (dependsOn) + who consumes each kind of data. */
  const DEPENDENTS = new Map();
  M.FIELDS.forEach(f => (f.dependsOn || []).forEach(dep => { if (!DEPENDENTS.has(dep)) DEPENDENTS.set(dep, new Set()); DEPENDENTS.get(dep).add(f.key); }));
  const CONSUMERS = [
    ['geometry.polygon', ['contorno no mapa', 'centroide e limites', 'medidas no zoom próximo']],
    ['geometry.', ['ficha (geometria)', 'filtros de área', 'comparação']],
    ['commercial.', ['camada Preço e Preço por m²', 'filtros de preço', 'simulação financeira', 'Quick View', 'comparação', 'compartilhamento']],
    ['availability.', ['camada Disponibilidade', 'filtro Somente disponíveis', 'Quick View', 'comparação']],
    ['intelligence.scores', ['camada Score', 'classe e rankings (nova versão)', 'recomendação', 'Quick View', 'comparação']],
    ['intelligence.', ['camada Classe', 'alertas e destaques', 'ficha (inteligência)']],
    ['environmental.noise', ['camada Ruído', 'alertas de ruído']], ['environmental.privacy', ['camada Privacidade']],
    ['environmental.', ['análise solar', 'camada Sol', 'ficha (conforto)']], ['mobility.', ['camada Trânsito e distâncias', 'ficha (mobilidade)']],
    ['surroundings.', ['camada Mata', 'ficha (vizinhança)']], ['location.', ['ficha (localização)', 'busca no mapa']]
  ];
  /** impactOf(fieldKey) → { fields: derived fields to recompute, consumers: what refreshes, layer } */
  function impactOf(key) {
    const out = new Set(), stack = [key];
    while (stack.length) { const k = stack.pop(); for (const d of DEPENDENTS.get(k) || []) if (!out.has(d)) { out.add(d); stack.push(d); } }
    const consumers = []; for (const [p, cs] of CONSUMERS) if (key.startsWith(p)) { consumers.push(...cs); if (p !== 'geometry.polygon') break; }
    return { field: key, layer: LAYER_BY_KEY.get(key) || null, fields: [...out], consumers: [...new Set(consumers)] };
  }

  /** ChangeSet between two snapshots of the same layer */
  function diff(prev, next) {
    const changedLotIds = [], changedFields = new Set(), kind = next.kind;
    const ids = new Set([...Object.keys(prev ? prev.lots : {}), ...Object.keys(next.lots)]);
    for (const id of ids) {
      const a = prev && prev.lots[id], b = next.lots[id]; let changed = false;
      for (const f of FIELDS[kind]) { const x = a ? get(a, f.key) : undefined, y = b ? get(b, f.key) : undefined; if (JSON.stringify(x) !== JSON.stringify(y)) { changed = true; changedFields.add(f.key); } }
      if (JSON.stringify((a && a.provenance) || {}) !== JSON.stringify((b && b.provenance) || {})) changed = true;
      if (changed) changedLotIds.push(id);
    }
    return { domain: kind, version: next[VERSION_KEY[kind]], previousVersion: prev ? prev[VERSION_KEY[kind]] : null, changedLotIds, changedFields: [...changedFields] };
  }

  /** Cache per layer and version. Invalidation is per domain, never global, and matches the entry's fields
      (kind + development), never a substring of the key (topic 48: a development id may be the prefix of another). */
  function DataCache() {
    const m = new Map(), meta = new Map();
    const key = s => `${s.kind}:${s.developmentId}:${s[VERSION_KEY[s.kind]]}`;
    return {
      key, put(s) { const k = key(s); m.set(k, s); meta.set(k, { kind: s.kind, developmentId: s.developmentId }); return k; }, get: k => m.get(k) || null,
      invalidate(kind, developmentId) { for (const [k, x] of [...meta]) if (x.kind === kind && x.developmentId === developmentId) { m.delete(k); meta.delete(k); } note('cache invalidated', { kind, developmentId }); },
      keys: () => [...m.keys()]
    };
  }
  return Object.freeze({ LAYERS, FIELDS, VERSION_KEY, layerOf, extract, extractStaticData, extractVersionedData, extractDynamicData, splitLotData, snapshot, validateSnapshot,
    FreshnessPolicy, policyFor, freshnessState, freshness, composeOne, compose, DEPENDENTS, impactOf, diff, DataCache, log, note });
})();
