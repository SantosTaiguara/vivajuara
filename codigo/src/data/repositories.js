/* data/repositories.js
   Repositories know HOW to obtain data and return canonical objects only.
   - DevelopmentRepository: configuration per development (static, in config/).
   - LotRepository (JSON implementation): reads lots.json once, normalizes it,
     splits it into static / analysis / availability snapshots, asks the
     CommercialRepository for the commercial snapshot, composes Lots and exposes
     update channels (structural, analytical, commercial, availability) that
     validate, diff and recompose only what changed. An API implementation only
     has to produce the same snapshots.
   - CommercialRepository: versioned price tables and the commercial state per lot.
   - SpatialRepository: precomputed routes and points of interest (lazy).
   - AssetRepository: gallery images. */
App.repos = (() => {
  const L = App.lifecycle, D = App.domain;
  const loader = { fetchJson: url => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`); return r.json(); }) };

  const DevelopmentRepository = {
    getDevelopments: () => App.config.DEVELOPMENTS.map(d => ({ id: d.id, name: d.name, city: d.city })),
    getDevelopment: id => App.config.DEVELOPMENTS.find(d => d.id === id) || null,
    getDevelopmentConfig(id) { const d = this.getDevelopment(id); return d ? { ...d, presentation: App.presentationConfig(d) } : null; },
    getSource(devId, sourceId) { const d = this.getDevelopment(devId); return (d && d.sources.find(s => s.id === sourceId)) || null; }
  };

  function CommercialRepository(devId) {
    const dev = DevelopmentRepository.getDevelopment(devId);
    let tables = dev.priceTables.slice();
    const repo = {
      getPriceTables: () => tables,
      getPriceTable: id => tables.find(t => t.id === (id || dev.currentPriceTableId)) || null,
      getPlans(tableId) { const t = this.getPriceTable(tableId); return t ? t.plans : []; },
      /** commercial state of one lot under a table: price = area × price per m² (unchanged rule) */
      commercialFor(areaM2, t) {
        const price = t ? App.pricing.formula.lotPrice(areaM2, t.pricePerM2) : null; // TD-12: single formula
        const pct = t ? t.downPaymentDefault * 100 : null;
        return { price, pricePerM2: t ? t.pricePerM2 : null, currency: dev.currency, downPaymentDefaultPercent: pct,
          downPaymentDefaultValue: App.pricing.formula.downPaymentValue(price, pct), availablePlans: t ? t.plans.map(p => p.id) : [],
          priceTableId: t ? t.id : null, priceTableVersion: t ? t.version : null, validFrom: t ? t.validFrom || null : null, validUntil: t ? t.validUntil || null : null };
      },
      /** the whole table applied at once (atomic): price, plans and validity of the same version */
      buildSnapshot(staticSnap, tableId) {
        const t = this.getPriceTable(tableId); if (!t) throw new Error(`Tabela comercial inexistente (${tableId})`);
        const lots = {}; for (const [id, s] of Object.entries(staticSnap.lots)) lots[id] = { commercial: this.commercialFor(s.geometry.areaM2, t) };
        return L.snapshot('commercial', devId, { priceTableId: t.id, priceTableVersion: t.version, revision: 1, updatedAt: t.createdAt || null, validFrom: t.validFrom || null, validUntil: t.validUntil || null, sourceId: t.sourceId }, lots);
      },
      /** register a new table version (validated by the LotRepository when applied) */
      addPriceTable(t) { tables = tables.filter(x => x.id !== t.id).concat([t]); }
    };
    return repo;
  }

  function LotRepository(devId, opts = {}) {
    const dev = DevelopmentRepository.getDevelopment(devId);
    const commercialRepo = opts.commercialRepo || CommercialRepository(devId);
    const cache = L.DataCache();
    const layers = { static: null, analysis: null, commercial: null, availability: null };
    const state = { static: 'idle', analysis: 'idle', commercial: 'idle', availability: 'idle' };
    let lots = [], index = D.buildIndex([]), warnings = [], report = null, variants = [], unmapped = new Set(), pending = null, subs = [];

    const source = opts.source || JsonLotSource(dev, commercialRepo);
    async function load() {
      if (lots.length) return lots;
      if (pending) return pending;
      pending = (async () => {
        Object.keys(state).forEach(k => { state[k] = 'loading'; });
        let res;
        try { res = await source.loadLayers(); } catch (e) { Object.keys(state).forEach(k => { state[k] = 'error'; }); throw e; }
        warnings = res.warnings || []; variants = res.variants || []; (res.unmapped || []).forEach(k => unmapped.add(k));
        Object.assign(layers, res.layers); Object.assign(state, res.states);
        LAYER_KEYS.forEach(k => layers[k] && cache.put(layers[k]));
        rebuild(L.compose(layers));
        L.note('version loaded', { source: source.kind, static: layers.static.staticDataVersion, analysis: layers.analysis && layers.analysis.analysisVersion, priceTable: layers.commercial && layers.commercial.priceTableVersion, availability: layers.availability && layers.availability.revision });
        return lots;
      })().finally(() => { pending = null; });
      return pending;
    }
    const LAYER_KEYS = ['static', 'analysis', 'commercial', 'availability'];
    function rebuild(res) {
      lots = Object.freeze(res.lots.slice().sort(byCode)); index = D.buildIndex(lots);
      warnings = warnings.filter(w => w.code !== 'COMPOSE').concat(res.rejected.map(r => ({ code: 'LOT_REJECTED', lotId: r.lotId, fieldKey: null, message: r.errors.map(e => e.code + ': ' + e.message).join('; ') })));
      report = { ...res.report, normalizationWarnings: warnings.length, orphans: res.orphans || [], unmappedLegacyFields: [...unmapped], measurementVariants: variants.length };
      if (res.rejected.length && App.debug) console.warn('[dados] lotes rejeitados', res.rejected);
    }
    const deriveIntelligence = deriveDatasetIntelligence;
    const byCode = (a, b) => a.identity.blockId.localeCompare(b.identity.blockId) || a.identity.lotNumber - b.identity.lotNumber;
    /** DataUpdateService: validate → compare version → diff → recompose changed lots → apply atomically → notify.
        An invalid snapshot never replaces the previous one. */
    function apply(kind, next) {
      const staticIds = new Set(Object.keys((kind === 'static' ? next : layers.static).lots || {}));
      const errors = L.validateSnapshot(next, kind, dev.id, kind === 'static' ? null : staticIds);
      if (errors.length) { L.note('validation failed', { kind, errors: errors.slice(0, 5) }); if (layers[kind]) layers[kind] = { ...layers[kind], stale: true }; return { applied: false, errors }; }
      const prev = layers[kind], vk = L.VERSION_KEY[kind];
      // an older response never overwrites a newer one (revision wins over timestamps: clock skew)
      if (kind === 'commercial' && prev && prev.revision != null && next.revision != null && next.revision < prev.revision) return { applied: false, reason: 'revisão antiga' };
      // same price table but a newer revision (e.g. a corrected price) is a real update
      const newerRevision = kind === 'commercial' && prev && next.revision != null && prev.revision != null && next.revision > prev.revision;
      if (prev && prev[vk] === next[vk] && kind !== 'availability' && !newerRevision) return { applied: false, reason: 'mesma versão' };
      if (kind === 'availability' && prev && next.revision <= prev.revision) return { applied: false, reason: 'revisão antiga' };
      if (kind === 'availability') { // state machine: every lot's move must be a valid transition, applied as one snapshot
        const AV = App.availability, pol = AV.policyOf(dev), bad = [];
        for (const [id, part] of Object.entries(next.lots)) {
          const a = { ...AV.EMPTY(), ...(part.availability || {}) };
          AV.validateState(a).forEach(e => bad.push({ ...e, lotId: id }));
          const pa = prev && prev.lots[id] && prev.lots[id].availability, before = pa ? pa.status : 'UNKNOWN';
          const lastConfirmed = before !== 'UNKNOWN' ? before : (pa && pa.lastConfirmedStatus) || null;
          const chk = AV.canTransition(before, a.status, { authorized: !!next.authorized, reason: a.reason, lastConfirmed }, pol);
          // a lot that loses confirmation keeps its last confirmed status, so SOLD → UNKNOWN → AVAILABLE cannot bypass the guard
          if (chk.ok && a.status === 'UNKNOWN' && lastConfirmed && part.availability) next.lots[id] = { ...part, availability: { ...part.availability, lastConfirmedStatus: lastConfirmed } };
          if (!chk.ok) bad.push({ code: 'INVALID_TRANSITION', lotId: id, message: chk.reason });
          else if (chk.exceptional) L.note('sold lot reopened', { lotId: id, reason: a.reason });
        }
        if (bad.length) { L.note('validation failed', { kind, errors: bad.slice(0, 5) }); layers.availability = { ...layers.availability, stale: true }; return { applied: false, errors: bad }; }
      }
      const change = L.diff(prev, next);
      const trial = { ...layers, [kind]: next };
      if (kind === 'static') { // structural correction: commercial depends on area
        try { trial.commercial = commercialRepo.buildSnapshot(next, layers.commercial && layers.commercial.priceTableId); } catch (e) { trial.commercial = null; }
      }
      let res;
      if (kind === 'analysis' || kind === 'static') {
        // rankings and highlights are relative to the whole dataset → recomputed for the new version
        const composed = Object.keys(trial.static.lots).map(id => L.composeOne(id, trial));
        deriveIntelligence(composed);
        trial.analysis = { ...trial.analysis, lots: Object.fromEntries(composed.map(d => [d.identity.id, L.extract(d, 'analysis')])) };
        res = D.LotFactory.createMany(Object.keys(trial.static.lots).map(id => L.composeOne(id, trial)));
      } else {
        const changed = new Set(change.changedLotIds), keep = lots.filter(l => !changed.has(l.identity.id));
        const fresh = D.LotFactory.createMany(change.changedLotIds.filter(id => trial.static.lots[id]).map(id => L.composeOne(id, trial)));
        res = { ...fresh, lots: keep.concat(fresh.lots) };
      }
      if (res.rejected.length) { L.note('validation failed', { kind, rejected: res.rejected.slice(0, 5) }); return { applied: false, errors: res.rejected }; }
      Object.assign(layers, trial); cache.invalidate(kind, dev.id); cache.put(next);
      if (kind === 'static' && trial.commercial) { cache.invalidate('commercial', dev.id); cache.put(trial.commercial); }
      state[kind] = 'ready';
      rebuild({ ...res, orphans: [] });
      L.note('version replaced', { kind, from: change.previousVersion, to: change.version, lots: change.changedLotIds.length });
      subs.forEach(fn => { try { fn(change); } catch (e) { console.error(e); } });
      return { applied: true, change };
    }

    /** Metadata-only change of a dynamic layer (source confirmed it again, or it could not be confirmed):
        values stay the same, freshness is recomputed for every lot. Used by the SyncManager (topic 10). */
    function touch(kind, patch) {
      if (!layers[kind]) return { applied: false, reason: 'camada ausente' };
      const trial = { ...layers, [kind]: { ...layers[kind], ...patch } };
      const before = L.freshness(layers[kind]), after = L.freshness(trial[kind]);
      Object.assign(layers, trial); cache.invalidate(kind, dev.id); cache.put(layers[kind]);
      if (before === after) return { applied: true, changed: false };
      const res = D.LotFactory.createMany(Object.keys(layers.static.lots).map(id => L.composeOne(id, layers)));
      rebuild({ ...res, orphans: [] });
      const change = { domain: kind, version: layers[kind][L.VERSION_KEY[kind]], previousVersion: layers[kind][L.VERSION_KEY[kind]], changedLotIds: lots.map(l => l.identity.id), changedFields: ['metadata.freshness'], freshness: { from: before, to: after } };
      L.note('freshness changed', { kind, from: before, to: after });
      subs.forEach(fn => { try { fn(change); } catch (e) { console.error(e); } });
      return { applied: true, changed: true, change };
    }

    return {
      developmentId: devId, load, commercialRepo, touch,
      getLots: () => load(), lotsSync: () => lots,
      getLotById: id => index.byId.get(id) || null,
      getLotByCode: code => index.byCode.get(String(code || '').toUpperCase()) || null,
      /** id or short code (links, saved favorites from older versions) */
      resolve: ref => index.byId.get(ref) || index.byCode.get(String(ref || '').toUpperCase()) || null,
      getLotsByBlock: b => index.byBlock.get(String(b).toUpperCase()) || [],
      getLotsByIds: ids => ids.map(id => index.byId.get(id)).filter(Boolean),
      getBlocks: () => [...index.byBlock.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
      getLotGeometry: id => { const l = index.byId.get(id); return l ? l.geometry : null; },
      searchLots: q => App.services.search.parse(q, { blocks: [...index.byBlock.keys()], all: lots, byCode: index.byCode }),
      // lifecycle views
      getStaticData: () => layers.static, getVersionedData: () => layers.analysis, getDynamicData: () => ({ commercial: layers.commercial, availability: layers.availability }),
      getDataState: () => ({ ...state }), getDataVersions: () => lots.length ? lots[0].metadata.dataVersions : null,
      getFreshness: () => ({ commercial: L.freshness(layers.commercial), availability: L.freshness(layers.availability) }),
      getFreshnessState: () => ({ commercial: L.freshnessState(layers.commercial), availability: L.freshnessState(layers.availability) }),
      getLayers: () => ({ ...layers }), sourceKind: () => source.kind,
      getWarnings: () => warnings.slice(), getQualityReport: () => report, getMeasurementVariants: () => variants.slice(), cache,
      // update channels
      applyStructuralUpdate: s => apply('static', s), applyAnalyticalUpdate: s => apply('analysis', s),
      applyCommercialUpdate: s => apply('commercial', s), applyAvailabilityUpdate: s => apply('availability', s),
      /** new price table: built from static areas and applied atomically */
      applyPriceTable(t) { commercialRepo.addPriceTable(t); return apply('commercial', commercialRepo.buildSnapshot(layers.static, t.id)); },
      /** availability feed { lotIdOrCode: { status, reservedUntil, proposalId, reason } } → one new revision.
          Each change goes through the state machine; lots absent from the feed keep their last known state. */
      applyAvailabilityFeed(map, meta = {}) {
        const AV = App.availability, pol = AV.policyOf(dev), rev = ((layers.availability && layers.availability.revision) || 0) + 1, at = meta.updatedAt || new Date().toISOString(), src = meta.sourceId || 'sales-mirror';
        const next = { ...layers.availability.lots }, errors = [];
        for (const [ref, a] of Object.entries(map || {})) {
          const l = this.resolve(ref); if (!l) { errors.push({ code: 'ORPHAN_LOT', lotId: ref, message: 'lote inexistente' }); continue; }
          const r = AV.transition(l.availability, a.status, { ...a, at, sourceId: src, revision: rev, authorized: meta.authorized }, pol);
          if (!r.ok) { errors.push({ ...r.error, lotId: l.identity.id }); continue; }
          const { freshness, ...state } = r.state;
          next[l.identity.id] = { availability: { ...state, freshness: 'FRESH' } };
          if (state.status !== 'UNKNOWN') next[l.identity.id].provenance = { 'availability.status': { status: 'CONFIRMED', sourceId: src, method: 'declared', confidence: 'HIGH', updatedAt: at } };
        }
        if (errors.length) { L.note('validation failed', { kind: 'availability', errors: errors.slice(0, 5) }); return { applied: false, errors }; }
        return apply('availability', L.snapshot('availability', dev.id, { revision: rev, updatedAt: at, sourceId: src, authorized: !!meta.authorized }, next));
      },
      subscribe: fn => { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; }
    };
  }

  /** rankings and highlights are derived from the whole analysis (dataset-relative) */
  function deriveDatasetIntelligence(data) {
    const ranks = App.rules.rankings(data);
    for (const d of data) { d.intelligence.rankings = ranks.get(d.identity.id) || []; d.intelligence.highlights = App.rules.highlights(d); }
  }
  /** legacy lots.json → static / analysis / availability snapshots (+ commercial from the price table).
      Shared by the browser (JsonLotSource) and the backend importer, so both produce identical data. */
  function buildSnapshotsFromLegacy(raw, dev, commercialRepo, now = new Date().toISOString()) {
    if (!Array.isArray(raw)) throw new Error('Formato inesperado do arquivo de lotes');
    const ctx = { developmentId: dev.id, code: dev.code, analysisVersion: dev.analysisVersion };
    const data = [], warnings = [], variants = [], unmapped = new Set();
    for (const r of raw) {
      try { const n = App.legacy.normalize(r, ctx); data.push(n.data); warnings.push(...n.warnings); variants.push(...n.variants); n.unmapped.forEach(k => unmapped.add(k)); }
      catch (e) { warnings.push({ code: 'RECORD_SKIPPED', lotId: r && r.id, fieldKey: null, message: e.message }); }
    }
    deriveDatasetIntelligence(data);
    const st = {}, an = {}, av = {};
    for (const d of data) { const id = d.identity.id; st[id] = L.extract(d, 'static'); an[id] = L.extract(d, 'analysis'); av[id] = L.extract(d, 'availability'); }
    const layers = {}, states = {};
    layers.static = L.snapshot('static', dev.id, { staticDataVersion: dev.staticDataVersion, createdAt: now }, st);
    layers.analysis = L.snapshot('analysis', dev.id, { analysisVersion: dev.analysisVersion, generatedAt: dev.analysisVersion, sourceId: 'analysis-v1', status: 'PUBLISHED' }, an);
    // lots.json has no sales mirror yet: revision 0, no timestamp → freshness UNKNOWN
    const hasFeed = Object.values(av).some(a => a.availability.status !== 'UNKNOWN');
    layers.availability = L.snapshot('availability', dev.id, { revision: 0, updatedAt: hasFeed ? now : null, sourceId: hasFeed ? 'lots.json' : null }, av);
    states.static = 'ready'; states.analysis = 'ready'; states.availability = 'ready';
    try { layers.commercial = commercialRepo.buildSnapshot(layers.static); states.commercial = 'ready'; }
    catch (e) { layers.commercial = null; states.commercial = 'error'; L.note('commercial failed, lots composed without price', { error: e.message }); }
    return { layers, states, warnings, variants, unmapped: [...unmapped] };
  }
  /** Data source for the client-only mode: the published lots.json. */
  function JsonLotSource(dev, commercialRepo) {
    return { kind: 'json', loadLayers: async () => buildSnapshotsFromLegacy(await loader.fetchJson(dev.assets.lots), dev, commercialRepo) };
  }
  /** Chooses the data source from DevelopmentConfig.dataSource (feature flag useBackendData). */
  function createLotRepository(devId, opts = {}) {
    const dev = DevelopmentRepository.getDevelopment(devId), ds = dev.dataSource || {};
    if (ds.useBackendData && App.api && App.api.ApiLotSource) {
      const commercialRepo = CommercialRepository(devId);
      const api = App.api.ApiLotSource(dev, { fallback: ds.fallbackToJson ? JsonLotSource(dev, commercialRepo) : null });
      return LotRepository(devId, { ...opts, commercialRepo, source: api });
    }
    return LotRepository(devId, opts);
  }

  function SpatialRepository(devId) {
    const dev = DevelopmentRepository.getDevelopment(devId);
    let routes = null, pending = null;
    const load = () => routes ? Promise.resolve(routes) : (pending = pending || loader.fetchJson(dev.assets.routes).then(r => (routes = r)).finally(() => { pending = null; }));
    return {
      getPois: () => dev.pois, getRoads: () => dev.roads,
      getPoi: id => dev.pois.find(p => p.id === id) || null,
      /** routes were computed once over the plan's road network (same run that produced the route distances). Keyed by the lot's short code. */
      async getRoutes(lot) {
        const r = (await load())[lot.identity.code]; if (!r) return null;
        return { toGate: r.p, toLeisure: r.k, nearestPlayground: r.np.split(' ')[0], nearestSquare: r.nq.split(' ')[0], nearestPark: r.nk.split(' ')[0] };
      }
    };
  }

  function AssetRepository(devId) {
    const dev = DevelopmentRepository.getDevelopment(devId);
    let imgs = null;
    return { getImages: async () => imgs || (imgs = (await loader.fetchJson(dev.assets.images)).map(x => ({ src: x.f, title: x.t }))) };
  }

  return { loader, DevelopmentRepository, LotRepository, JsonLotRepository: LotRepository, JsonLotSource, createLotRepository, buildSnapshotsFromLegacy, deriveDatasetIntelligence, CommercialRepository, SpatialRepository, AssetRepository };
})();
