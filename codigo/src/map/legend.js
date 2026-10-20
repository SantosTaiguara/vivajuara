/* map/legend.js — contextual legend (topic 19).
   LegendEngine builds a LegendModel from what the map already resolved (MapRenderModel: the same ScaleDefinition,
   the same LayerValueResults, the same bin resolver), so a lot's tooltip, its fill and its legend item always agree.
   Counts: total on the reference dataset, filtered on FilterResult.matchedIds; the scale never changes with a filter.
   Interaction: hover highlights, click focuses (temporary visual state), and only an explicit action turns an item
   into a FilterCondition, through the filter engine, with a chip. The engine does not format; LegendViewModel does. */
App.legend = (() => {
  const ML = App.mapLayers, F = App.fmt;
  const POLICY_VERSION = '1.0.0';
  const COUNT_MODES = Object.freeze(['TOTAL_ONLY', 'FILTERED_ONLY', 'FILTERED_AND_TOTAL', 'NONE']);
  const STATUS = Object.freeze(['READY', 'PARTIAL', 'NO_DATA', 'UNAVAILABLE', 'ERROR']);
  const policyOf = devId => ({ version: POLICY_VERSION, lowCoverageRatio: 0.8, countModeWithoutFilter: 'TOTAL_ONLY', countModeWithFilter: 'FILTERED_AND_TOTAL',
    interaction: { hoverHighlight: true, clickFocus: true, clickPin: false, explicitFilterAction: true, allowMultiFocus: false, keyboardNavigation: true }, ...((ML.cfgOf(devId) || {}).legendPolicy || {}) });
  const BUCKETS = { NO_DATA: { label: 'Sem dado', token: 'map.noData' }, UNKNOWN: { label: 'Desconhecido', token: 'map.unknown', pattern: 'pattern.unknown' }, CONFLICTED: { label: 'Fontes divergentes', token: 'map.conflicted', pattern: 'pattern.conflicted' }, ERROR: { label: 'Erro de leitura', token: 'map.error' } };
  const TIER_LABEL = { PRIMARY: 'Melhor opção', STRONG_MATCH: 'Forte aderência', ALTERNATIVE: 'Alternativa', REVIEW_REQUIRED: 'Revisar (status a confirmar)' };

  /** legend item → filter state patch, only where the filter engine can express the item exactly (same lots) */
  function filterActionFor(def, item, values, lots) {
    if (def.id === 'availability') return { patch: { statuses: [item.key] }, label: 'Filtrar somente esta situação' };
    if (def.id === 'forest' && item.key === 'yes') return { patch: { greenBehind: true }, label: 'Filtrar com mata nos fundos' };
    if (def.id === 'price' || def.id === 'area') {
      // bins are [min, max); the filter is inclusive, so the upper bound is the largest real value inside the bin
      const field = def.id === 'price' ? l => l.commercial.price : l => l.geometry.areaM2, inBin = lots.filter(l => (values.get(l.identity.id) || {}).binKey === item.key).map(field).filter(v => v != null);
      if (!inBin.length) return null;
      const r = item.range || item, lo = r.min == null ? null : r.min, hi = r.max == null ? null : Math.max(...inBin);
      return { patch: def.id === 'price' ? { priceMin: lo, priceMax: hi } : { areaMin: lo, areaMax: hi }, label: def.id === 'price' ? 'Aplicar esta faixa de preço' : 'Aplicar esta faixa de área' };
    }
    return null;
  }
  /** LegendCountAggregator: every lot lands in exactly one item (bin/category or a status bucket) */
  function aggregate(values, matched) {
    const total = new Map(), filtered = new Map();
    for (const v of values.values()) {
      const k = v.binKey != null ? v.binKey : '#' + v.valueStatus;
      total.set(k, (total.get(k) || 0) + 1);
      if (matched && matched.has(v.lotId)) filtered.set(k, (filtered.get(k) || 0) + 1);
    }
    return { total, filtered };
  }
  /** build(input) → LegendModel. input = { model (MapRenderModel), lots, filter { active, matchedIds }, selectedLotId, mode, recommendation, comparisonIds, freshnessState, developmentId } */
  function build(input) {
    const m = input.model, mode = input.mode || 'broker', pol = policyOf(input.developmentId);
    try {
      const def = m.def, scale = m.scale, values = m.values, cov = m.layerMetadata.coverage;
      if (def.id === 'none') return Object.freeze({ id: 'legend:none', layerId: 'none', type: 'CATEGORICAL', titleKey: def.label, status: 'READY', sections: [], coverageSummary: null, selectedIndicator: null, countMode: 'NONE', versions: { policy: pol.version }, interactionMetadata: pol.interaction });
      if (scale.status === 'ERROR') return Object.freeze({ id: 'legend:' + def.id, layerId: def.id, type: def.legendType, titleKey: def.label, status: 'ERROR', sections: [], error: scale.error });
      const filterActive = !!(input.filter && input.filter.active), matched = filterActive ? input.filter.matchedIds : null;
      const countMode = mode === 'client' ? 'NONE' : filterActive ? pol.countModeWithFilter : pol.countModeWithoutFilter;
      const agg = aggregate(values, matched);
      const sel = input.selectedLotId ? values.get(input.selectedLotId) : null;
      const items = scale.items.map(it => ({ id: def.id + ':' + it.key, key: it.key, labelKey: it.label, styleToken: it.token, color: it.color, patternToken: null, symbolToken: null,
        range: it.min != null || it.max != null ? { min: it.min, max: it.max, includeMin: it.includeMin, includeMax: it.includeMax } : null,
        totalCount: agg.total.get(it.key) || 0, filteredCount: filterActive ? agg.filtered.get(it.key) || 0 : null, freshness: null, selected: !!(sel && sel.binKey === it.key), interactionKey: it.key, metadata: {} }));
      // availability keeps its six statuses but drops UNKNOWN when nothing is unknown (as the published map did)
      const shown = items.filter(it => !(def.id === 'availability' && it.key === 'UNKNOWN' && !it.totalCount));
      for (const [vs, b] of Object.entries(BUCKETS)) {
        const n = agg.total.get('#' + vs) || 0; if (!n) continue;
        if (vs === 'CONFLICTED' && mode === 'client') { // client mode shows conflicted values as "sem dado"
          const nd = shown.find(x => x.key === '#NO_DATA'); if (nd) { nd.totalCount += n; continue; } }
        const key = vs === 'CONFLICTED' && mode === 'client' ? '#NO_DATA' : '#' + vs;
        shown.push({ id: def.id + ':' + key, key, labelKey: scale.neutral && vs === 'NO_DATA' ? 'Sem informação' : (vs === 'CONFLICTED' && mode === 'client' ? BUCKETS.NO_DATA.label : b.label), styleToken: scale.neutral && vs === 'NO_DATA' ? 'map.unknown' : b.token, color: ML.color(scale.neutral && vs === 'NO_DATA' ? 'map.unknown' : b.token),
          patternToken: mode === 'client' ? null : b.pattern || null, symbolToken: null, range: null, totalCount: n, filteredCount: filterActive ? agg.filtered.get('#' + vs) || 0 : null, freshness: null, selected: !!(sel && sel.binKey == null && sel.valueStatus === vs), interactionKey: key, bucket: vs, metadata: {} });
      }
      for (const it of shown) { it.disabled = !it.totalCount; it.filterAction = mode !== 'client' || def.id === 'availability' || def.id === 'price' || def.id === 'area' ? filterActionFor(def, it, values, input.lots) : null; if (it.bucket) it.filterAction = null; }
      // invariant: every lot counted exactly once
      const sumTotal = shown.reduce((s, it) => s + it.totalCount, 0), sumFiltered = filterActive ? shown.reduce((s, it) => s + it.filteredCount, 0) : null;
      const invariant = { ok: sumTotal === values.size && (!filterActive || sumFiltered === [...values.keys()].filter(id => matched.has(id)).length), sumTotal, sumFiltered, expected: values.size };
      const sections = [{ id: 'primary', type: def.legendType, titleKey: scale.title, items: shown, scale: scaleMeta(scale), summary: filterActive ? { matched: matched.size, total: values.size } : null, priority: 0, collapsible: false }];
      const recCounts = m.overlayFeatures.recommendation;
      if (recCounts && (recCounts.PRIMARY || recCounts.STRONG_MATCH || recCounts.ALTERNATIVE || recCounts.REVIEW_REQUIRED)) {
        sections.push({ id: 'recommendation', type: 'OVERLAY', titleKey: mode === 'client' ? 'Sugestões para você' : 'Recomendação para o cliente', priority: 1, collapsible: true,
          items: ['PRIMARY', 'STRONG_MATCH', 'ALTERNATIVE', 'REVIEW_REQUIRED'].filter(k => recCounts[k]).map(k => ({ id: 'rec:' + k, key: k, labelKey: TIER_LABEL[k], symbolToken: k === 'REVIEW_REQUIRED' ? 'symbol.review' : 'symbol.recommendation', totalCount: recCounts[k], interactionKey: null })) });
      }
      const cmp = m.overlayFeatures.comparison;
      if (cmp.length) sections.push({ id: 'comparison', type: 'OVERLAY', titleKey: 'Comparando', priority: 2, collapsible: true, items: cmp.map((id, i) => ({ id: 'cmp:' + id, key: id, number: i + 1, symbolToken: 'symbol.comparison.' + (i + 1), lotId: id, interactionKey: null })) });
      let selectedIndicator = null;
      if (sel) {
        let pos = null, special = null;
        const nums = scale.items.filter(i => i.min != null || i.max != null);
        if (typeof sel.value === 'number' && nums.length) {
          const vals = [...values.values()].map(v => v.value).filter(v => typeof v === 'number'), lo = Math.min(...vals), hi = Math.max(...vals);
          if (hi === lo) { pos = 0.5; special = 'ZERO_RANGE'; } else { pos = (sel.value - lo) / (hi - lo); if (pos < 0 || pos > 1) { special = 'OUT_OF_DOMAIN'; pos = Math.max(0, Math.min(1, pos)); } }
        }
        selectedIndicator = { lotId: sel.lotId, rawValue: sel.value, normalizedPosition: pos, binId: sel.binKey, valueStatus: sel.valueStatus, freshness: sel.freshness, special };
      }
      const status = cov.availableCount === 0 && !(def.unknownIsCategory && cov.unknownCount) ? 'NO_DATA' : cov.coverageRatio < 1 && !(def.unknownIsCategory) ? 'PARTIAL' : 'READY';
      const freshnessSummary = def.freshnessKey ? { freshCount: cov.totalLots - cov.staleCount - cov.expiredCount - [...values.values()].filter(v => v.freshness === 'UNKNOWN' || v.freshness == null).length, staleCount: cov.staleCount, expiredCount: cov.expiredCount,
        unknownCount: [...values.values()].filter(v => v.freshness === 'UNKNOWN' || v.freshness == null).length, lastSyncAt: input.freshnessState && input.freshnessState[def.freshnessKey] ? input.freshnessState[def.freshnessKey].lastSyncAt || null : null, allStale: m.layerMetadata.layerAllStale } : null;
      const dq = mode === 'client' || !def.estimated && !cov.conflictedCount ? null : { estimatedCount: def.estimated ? cov.availableCount : 0, conflictedCount: cov.conflictedCount, highConfidenceCount: null, mediumConfidenceCount: null, lowConfidenceCount: null };
      return Object.freeze({ id: 'legend:' + def.id, layerId: def.id, type: def.legendType, titleKey: scale.title, subtitleKey: def.description, unit: def.unit, sections, countMode,
        coverageSummary: { totalLots: cov.totalLots, validValueCount: cov.availableCount, noDataCount: cov.noDataCount, unknownCount: cov.unknownCount, staleCount: cov.staleCount, conflictedCount: cov.conflictedCount, coverageRatio: cov.coverageRatio, low: cov.coverageRatio < pol.lowCoverageRatio && !def.unknownIsCategory },
        selectedIndicator, freshnessSummary, dataQualitySummary: dq, scaleMetadata: scaleMeta(scale), interactionMetadata: pol.interaction, versions: { policy: pol.version, registry: ML.REGISTRY_VERSION, dataVersion: scale.dataVersion },
        status, invariant, note: scale.note, estimated: def.estimated, filterActive, layerError: m.layerError });
    } catch (e) { return Object.freeze({ id: 'legend:error', layerId: m && m.def ? m.def.id : null, titleKey: m && m.def ? m.def.label : 'Camada', status: 'ERROR', sections: [], error: String(e && e.message || e) }); }
  }
  const scaleMeta = s => ({ scaleType: s.type, domainSource: s.domainSource, dataVersion: s.dataVersion, binDefinitions: s.items.map(i => ({ key: i.key, min: i.min, max: i.max, includeMin: i.includeMin, includeMax: i.includeMax })), clamped: false });

  // ---------------------------------------------------------------- legend UI state (no data inside)
  const STATE_VERSION = 1;
  const defaultState = () => ({ expanded: true, pinned: false, activeSectionId: 'primary', focusedItemId: null, showCounts: true, schemaVersion: STATE_VERSION });
  /** focus is a temporary visual state: it never touches FilterQuery or the recommendation */
  const focus = (state, layerId, itemKey) => ({ ...state, focusedItemId: state.focusedItemId && state.focusedItemId.layerId === layerId && state.focusedItemId.itemKey === itemKey ? null : { layerId, itemKey } });
  const clearFocus = state => ({ ...state, focusedItemId: null });
  const onLayerChange = (state, layerId) => (state.focusedItemId && state.focusedItemId.layerId !== layerId ? { ...state, focusedItemId: null } : state);
  const persistable = s => ({ expanded: s.expanded, pinned: s.pinned, showCounts: s.showCounts, schemaVersion: STATE_VERSION });

  // ---------------------------------------------------------------- LegendViewModel (formatting, mode-dependent detail)
  function viewModel(lm, { mode = 'broker', selectedCode = null, customerLabel = null } = {}) {
    if (!lm || lm.status === 'ERROR') return { title: lm && lm.titleKey || 'Camada', error: 'Legenda indisponível.', sections: [] };
    const client = mode === 'client', technical = mode === 'technical';
    const n = x => F.number(x || 0);
    const countText = it => lm.countMode === 'NONE' || it.totalCount == null ? '' : lm.countMode === 'FILTERED_AND_TOTAL' ? `${n(it.filteredCount)} / ${n(it.totalCount)}` : lm.countMode === 'FILTERED_ONLY' ? n(it.filteredCount) : n(it.totalCount);
    const aria = it => `${it.labelKey}${lm.countMode === 'FILTERED_AND_TOTAL' ? `, ${n(it.filteredCount)} ${it.filteredCount === 1 ? 'lote' : 'lotes'} nos filtros atuais, ${n(it.totalCount)} no total` : lm.countMode === 'TOTAL_ONLY' ? `, ${n(it.totalCount)} ${it.totalCount === 1 ? 'lote' : 'lotes'}` : ''}${it.selected && selectedCode ? `, inclui o lote selecionado ${selectedCode}` : ''}${it.patternToken ? ', marcado com hachura' : ''}`;
    const prim = lm.sections.find(s => s.id === 'primary');
    const warnings = [];
    if (lm.coverageSummary && lm.coverageSummary.low) warnings.push(`${lm.titleKey} disponível para ${n(lm.coverageSummary.validValueCount)} de ${n(lm.coverageSummary.totalLots)} lotes.`);
    if (lm.freshnessSummary && (lm.freshnessSummary.staleCount || lm.freshnessSummary.expiredCount)) warnings.push(client ? 'Valores sujeitos a confirmação.' : lm.freshnessSummary.allStale ? 'Dados comerciais sem confirmação nesta sessão: mostrando o último valor conhecido.' : `${n(lm.freshnessSummary.staleCount)} lotes com dados comerciais desatualizados.`);
    if (lm.layerError) warnings.push('Não foi possível usar a camada pedida; mostrando a camada padrão.');
    let selected = null;
    if (lm.selectedIndicator) {
      const si = lm.selectedIndicator, it = prim.items.find(i => i.key === (si.binId != null ? si.binId : '#' + si.valueStatus));
      selected = { code: selectedCode, text: si.valueStatus === 'NO_DATA' || si.valueStatus === 'ERROR' ? 'Lote selecionado: sem dado nesta camada.' : `${selectedCode || 'Lote'} · ${it ? it.labelKey : 'sem dado'}${si.freshness === 'STALE' ? ' (último valor conhecido)' : ''}`, position: si.normalizedPosition };
    }
    return {
      title: lm.layerId === 'fit' && customerLabel && !client ? `Compatibilidade com ${customerLabel}` : lm.titleKey,
      subtitle: lm.subtitleKey, status: lm.status, countMode: lm.countMode,
      items: prim ? prim.items.map(it => ({ key: it.key, label: it.labelKey, color: it.color, pattern: it.patternToken, count: countText(it), aria: aria(it), selected: it.selected, disabled: it.disabled,
        filterAction: !client || it.filterAction ? it.filterAction : null, interactive: !it.disabled })) : [],
      filterSummary: prim && prim.summary ? `${n(prim.summary.matched)} de ${n(prim.summary.total)} correspondem aos filtros.` : null,
      selected, warnings, note: lm.note, estimated: lm.estimated,
      coverage: !client && lm.coverageSummary && lm.coverageSummary.coverageRatio < 1 && lm.layerId !== 'availability' ? `Com dado: ${n(lm.coverageSummary.validValueCount)} de ${n(lm.coverageSummary.totalLots)} lotes.` : null,
      overlays: lm.sections.filter(s => s.id !== 'primary').map(s => ({ id: s.id, title: s.titleKey, items: s.items.map(i => ({ key: i.key, label: i.labelKey || null, number: i.number || null, lotId: i.lotId || null, count: !client && i.totalCount != null ? n(i.totalCount) : '', symbol: i.symbolToken })) })),
      technical: technical || mode === 'broker' ? { scaleType: lm.scaleMetadata.scaleType, domainSource: lm.scaleMetadata.domainSource, dataVersion: lm.scaleMetadata.dataVersion, policy: lm.versions.policy } : null
    };
  }
  return { POLICY_VERSION, COUNT_MODES, STATUS, policyOf, aggregate, build, filterActionFor, defaultState, focus, clearFocus, onLayerChange, persistable, viewModel };
})();
