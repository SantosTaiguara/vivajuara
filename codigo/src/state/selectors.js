/* state/selectors.js — memoized reads over (LotRepository, ApplicationState).
   Each selector recomputes only when its inputs change by identity, so a click
   (currentLotId) never re-filters, re-ranks or recolors 498 lots.
   Pipeline (topics 14–19): FilterState → FilterQuery → FilterResult (dims the map, never re-ranks);
   preferences + constraints → CustomerProfile → Fit (every lot) → Recommendation (all lots, or the
   explicit RecommendationScope); MapLayerState + those results → MapRenderModel → LegendModel. */
App.selectors = (repo, devCfg) => {
  const S = App.services, AV = App.availability, FX = App.filters, ML = App.mapLayers, policy = AV.policyOf(devCfg), devId = devCfg.id;
  function memo(fn) { let args = null, val; return (...a) => { if (args && a.length === args.length && a.every((x, i) => x === args[i])) return val; args = a; val = fn(...a); return val; }; }
  let lots = [];
  const lotsMemo = memo((rev) => (lots = repo.lotsSync()));
  const selectLots = st => lotsMemo(st.dataRevision);
  const favSet = memo(f => new Set(f));
  const freshness = memo(rev => repo.getFreshnessState());
  const versions = memo(rev => { const v = repo.getDataVersions() || {}; return { static: v.staticVersion || null, analysis: v.analysisVersion || null, commercial: v.priceTableVersion || null, availability: v.availabilityRevision != null ? 'rev' + v.availabilityRevision : null, raw: v }; });
  const counts = memo(ls => AV.counts(ls));
  const offerable = memo(ls => new Set(ls.filter(l => AV.isOfferable(l.availability.status, policy)).map(l => l.identity.id)));

  // ---------------------------------------------------------------- customer: profile → Fit → Recommendation
  const fitCfg = App.fit.cfgOf(devId), recPolicy = App.recommendation.policyOf(devId), fitCache = App.fit.cache();
  const profile = memo((prefs, cons, customerId) => App.fit.buildProfile({ id: customerId || 'working-profile', developmentId: devId, preferences: prefs || {} }));
  const fitMap = memo((ls, p, fr, rev) => {
    if (App.fit.isEmpty(p)) return null;
    const v = versions(rev).raw;
    return fitCache.get(p, ls, fitCfg, { commercialFreshness: fr.commercial && fr.commercial.status, priceTableVersion: v.priceTableVersion, analysisVersion: v.analysisVersion });
  });
  const constraintList = memo(cons => Object.entries(cons || {}).filter(([k, v]) => v != null && v !== false && v !== '').map(([k, v]) => App.recommendation.constraint(k, v, recPolicy)).filter(Boolean));
  const recommendation = memo((ls, p, cl, scope, fr, rev, offline) => {
    if (App.fit.isEmpty(p) && !cl.length) return null;
    return App.recommendation.recommend({ developmentId: devId, profile: p, constraints: cl, lots: ls, scope: scope || null, policy: recPolicy, fitCfg, availabilityPolicy: policy,
      commercialFreshness: fr.commercial && fr.commercial.status, availabilityFreshness: fr.availability && fr.availability.status, offline: !!offline, dataVersions: versions(rev).raw, generatedAt: null });
  });
  /** compatibility view used by the list, the pins and the tooltip: recommendations first, then the review bucket */
  const ranking = memo(rec => {
    if (!rec) return null;
    const items = [...rec.recommendations, ...rec.reviewCandidates].map(x => ({ id: x.lotId, position: x.rank, tier: x.tier, fitScore: x.fitScore, relevance: x.fitScore == null ? null : x.fitScore / 100, review: x.tier === 'REVIEW_REQUIRED', reasons: x.keyReasonCodes || [] }));
    return { result: rec, list: items, recommended: items.filter(i => !i.review), review: items.filter(i => i.review), byId: new Map(items.map(i => [i.id, i])) };
  });

  // ---------------------------------------------------------------- filters
  const query = memo((filters, mode) => FX.compile(filters || {}, { mode: mode === 'client' ? 'client' : 'broker', developmentId: devId }));
  const filterResult = memo((ls, q, favs, fit, fr) => FX.run(ls, q.query, { policy, favorites: favSet(favs), fit, freshness: fr, developmentId: devId }));
  const sel = {
    policy, fitCfg, recPolicy,
    selectLots,
    selectCurrentLot: st => (st.currentLotId ? repo.getLotById(st.currentLotId) : null),
    selectComparisonLots: st => repo.getLotsByIds(st.comparisonLotIds),
    selectFreshness: st => freshness(st.dataRevision),
    selectDataVersions: st => versions(st.dataRevision),
    selectProfile: st => profile(st.preferences, st.constraints, st.currentCustomerId),
    selectFit: st => fitMap(selectLots(st), sel.selectProfile(st), freshness(st.dataRevision), st.dataRevision),
    selectConstraints: st => constraintList(st.constraints),
    selectRecommendation: st => recommendation(selectLots(st), sel.selectProfile(st), constraintList(st.constraints), st.recScope, freshness(st.dataRevision), st.dataRevision, st.connectivity === 'OFFLINE'),
    /** recommendation list (not scoped by filters unless the user applied them as RecommendationScope) */
    selectRanking: st => ranking(sel.selectRecommendation(st)),
    selectFilterQuery: st => query(st.activeFilters, st.presentationMode),
    selectFilterResult: st => filterResult(selectLots(st), query(st.activeFilters, st.presentationMode), st.favorites, sel.selectFit(st), freshness(st.dataRevision)),
    selectFilteredLotIds: st => sel.selectFilterResult(st).matchedIds,
    selectFilterActive: st => query(st.activeFilters, st.presentationMode).query.conditions.length > 0,
    selectAvailabilityCounts: st => counts(selectLots(st)),
    selectOfferableLotIds: st => offerable(selectLots(st)),
    selectLayerState: st => ML.fromStore(st),
    /** MapRenderModel: the map only draws this */
    selectRenderModel: st => renderModel(selectLots(st), st.activeMapLayer, st.backgroundLayer, st.mapOverlays, st.scoreKey, st.layerOpacities, st.presentationMode, sel.selectFilterResult(st), sel.selectFilterActive(st),
      st.currentLotId, st.comparisonLotIds, st.favorites, sel.selectRecommendation(st), sel.selectFit(st), st.legendFocus, st.dataRevision),
    selectLegend: st => legend(sel.selectRenderModel(st), sel.selectFilterResult(st), sel.selectFilterActive(st), st.presentationMode, st.currentLotId, freshness(st.dataRevision)),
    selectCurrentPriceTable: () => repo.commercialRepo.getPriceTable(),
    selectBlocks: st => blocks(selectLots(st)),
    selectHasAvailabilityFeed: st => counts(selectLots(st)).UNKNOWN < selectLots(st).length
  };
  const renderModel = memo((ls, layer, bg, ovs, sk, ops, mode, fres, factive, cur, cmp, favs, rec, fit, focus, rev) => ML.buildRenderModel({
    developmentId: devId, lots: ls, layerState: ML.fromStore({ activeMapLayer: layer, backgroundLayer: bg, mapOverlays: ovs, scoreKey: sk, layerOpacities: ops }), mode,
    filter: { active: factive, matchedIds: fres.matchedIds }, selectedLotId: cur, comparisonIds: cmp, favorites: favSet(favs), recommendation: rec, fit, fitKey: fit ? 'fit' + (rec ? rec.customerProfileVersion : '') + ':' + fit.size : '',
    freshness: freshness(rev), dataVersions: { ...versions(rev), fit: fitCfg.fitMethodologyVersion }, dataRevision: rev, features: devCfg.features, legendFocus: focus }));
  const legend = memo((m, fres, factive, mode, cur, fr) => App.legend.build({ model: m, lots, filter: { active: factive, matchedIds: fres.matchedIds }, selectedLotId: cur, mode, developmentId: devId, freshnessState: fr }));
  const blocks = memo(ls => {
    const m = new Map();
    for (const l of ls) { const b = l.geometry.bounds; if (!b) continue; const k = l.identity.blockId, e = m.get(k) || { id: k, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0, sx: 0, sy: 0 };
      e.x0 = Math.min(e.x0, b.x); e.y0 = Math.min(e.y0, b.y); e.x1 = Math.max(e.x1, b.x + b.w); e.y1 = Math.max(e.y1, b.y + b.h); e.n++; e.sx += l.geometry.centroid[0]; e.sy += l.geometry.centroid[1]; m.set(k, e); }
    return [...m.values()].map(e => ({ id: e.id, bounds: { x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 }, center: [e.sx / e.n, e.sy / e.n], count: e.n })).sort((a, b) => a.id.localeCompare(b.id));
  });
  return sel;
};
