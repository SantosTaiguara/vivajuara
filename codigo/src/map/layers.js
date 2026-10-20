/* map/layers.js — map layer architecture (topic 18).
   MapLayerRegistry (BASE / THEMATIC_PRIMARY / CONTEXT_OVERLAY / INTERACTION_OVERLAY / REFERENCE_OVERLAY / LABEL)
   → LayerValueProvider (reads values already produced: canonical Lot, LotAnalysisResult, FitScoreResult,
   RecommendationResult; it never recomputes) → ScaleDefinition (built once on the FULL development and cached
   by data version, so a filter never changes what a colour means) → LayerStyleResolver (one precedence:
   selected > comparison/recommendation outline > thematic fill > filter dim > base) → MapRenderModel, which the
   renderer only draws. Bins and colours are exactly those of services/layers.js; this module adds metadata,
   value status, tokens, coverage and state around them. A layer never filters, never scores, never hides a lot. */
App.mapLayers = (() => {
  const LY = App.services.layers, M = App.model, F = App.fmt;
  const SCHEMA_VERSION = 1, REGISTRY_VERSION = '1.0.0';
  const TYPES = Object.freeze({ BASE: 'BASE', THEMATIC_PRIMARY: 'THEMATIC_PRIMARY', CONTEXT_OVERLAY: 'CONTEXT_OVERLAY', INTERACTION_OVERLAY: 'INTERACTION_OVERLAY', REFERENCE_OVERLAY: 'REFERENCE_OVERLAY', LABEL: 'LABEL' });
  const VALUE_STATUS = Object.freeze(['AVAILABLE', 'NO_DATA', 'UNKNOWN', 'CONFLICTED', 'ERROR']);
  const BASE_MODES = Object.freeze(['PLANT', 'AERIAL', 'HYBRID']);
  const BASE_TO_STORE = Object.freeze({ PLANT: 'plan', AERIAL: 'aerial', HYBRID: 'hybrid' });
  const STORE_TO_BASE = Object.freeze({ plan: 'PLANT', aerial: 'AERIAL', hybrid: 'HYBRID' });
  /** formal z-order (renderer groups follow it: gBg < gLots < gOvl/gRoute < pins < gLbl/gBlk/gPoi < tooltip) */
  const Z_ORDER = Object.freeze(['BASE_MAP', 'STATIC_REFERENCES', 'THEMATIC_FILL', 'FILTER_DIM', 'CONTEXT_OVERLAYS', 'RECOMMENDATION_COMPARISON', 'HOVER', 'SELECTED', 'LABELS', 'TOOLTIP']);
  const Z = Object.fromEntries(Z_ORDER.map((k, i) => [k, i]));
  const PRECEDENCE = Object.freeze(['selected', 'comparison', 'recommendation', 'thematic', 'filterDim', 'base']);

  // ---------------------------------------------------------------- design tokens (single place for colours)
  const TOKENS = {};
  LY.GREEN.forEach((c, i) => { TOKENS['map.ramp.green.' + i] = c; });
  LY.ORANGE.forEach((c, i) => { TOKENS['map.ramp.orange.' + i] = c; });
  for (const [k, c] of Object.entries(LY.CLASS)) TOKENS['map.class.' + k] = c;
  for (const [k, c] of Object.entries(LY.STATUS)) TOKENS['map.status.' + k] = c;
  Object.assign(TOKENS, { 'map.neutral.sand': '#D8D3BF', 'map.noData': '#cdd2c9', 'map.unknown': LY.STATUS.UNKNOWN, 'map.conflicted': '#cdd2c9', 'map.error': '#cdd2c9',
    'map.solar.front': '#eda100', 'map.solar.back': '#2a78d6', 'map.solar.night': '#c9cec5',
    'map.selected': '#0f1f13', 'map.comparison': 'var(--cmp)', 'map.recommendation.primary': '#13261a', 'map.recommendation.review': '#13261a', 'map.hover': '#13261a', 'map.base.stroke': '#ffffff' });
  Object.freeze(TOKENS);
  const RAMP_BY_HEX = new Map();
  for (const [k, c] of Object.entries(TOKENS)) if (/^map\.(ramp|neutral|solar)\./.test(k) && !RAMP_BY_HEX.has(c.toLowerCase())) RAMP_BY_HEX.set(c.toLowerCase(), k);
  /** a class colour from the layer definition → its semantic token (availability/class use their own families) */
  function tokenFor(layerId, key, hex) {
    if (layerId === 'availability' && TOKENS['map.status.' + key]) return 'map.status.' + key;
    if (layerId === 'class' && TOKENS['map.class.' + key]) return 'map.class.' + key;
    return (hex && RAMP_BY_HEX.get(String(hex).toLowerCase())) || 'map.noData';
  }
  const color = token => TOKENS[token] || TOKENS['map.noData'];

  // ---------------------------------------------------------------- registry
  // Thematic metadata: where the value comes from, its type, scale strategy and which version invalidates the scale.
  const THEMATIC = {
    availability: { group: 'COMMERCIAL', valueSource: 'DYNAMIC', fieldKey: 'availability.status', valueType: 'ENUM', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'availability', freshnessKey: 'availability', unit: null, legendType: 'STATUS', unknownIsCategory: true, description: 'Situação comercial de cada lote.' },
    price: { group: 'COMMERCIAL', valueSource: 'COMMERCIAL', fieldKey: 'commercial.price', valueType: 'MONEY', renderMode: 'FILL', scaleType: 'QUANTILE', scaleParams: { classes: 5, roundTo: 10000 }, versionKey: 'commercial', freshnessKey: 'commercial', unit: 'BRL', legendType: 'BINNED', requires: ['requiresCommercialData'], description: 'Cores representam o preço atual por lote.' },
    pricePerM2: { group: 'COMMERCIAL', valueSource: 'COMMERCIAL', fieldKey: 'commercial.pricePerM2', valueType: 'MONEY', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'commercial', freshnessKey: 'commercial', unit: 'BRL_PER_M2', legendType: 'CATEGORICAL', requires: ['requiresCommercialData'], description: 'Preço por metro quadrado da tabela vigente.' },
    area: { group: 'COMMERCIAL', valueSource: 'STATIC', fieldKey: 'geometry.areaM2', valueType: 'NUMBER', renderMode: 'FILL', scaleType: 'QUANTILE', scaleParams: { classes: 5, roundTo: 10 }, versionKey: 'static', unit: 'M2', legendType: 'BINNED', description: 'Área do lote pela planta oficial.' },
    class: { group: 'INTELLIGENCE', valueSource: 'ANALYSIS', fieldKey: 'intelligence.class', metricKey: 'class', valueType: 'ENUM', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'analysis', unit: null, legendType: 'CATEGORICAL', visibility: { client: false }, requires: ['requiresAnalysis'], description: 'Classe pelo percentil do score geral.' },
    score: { group: 'INTELLIGENCE', valueSource: 'ANALYSIS', fieldKey: 'intelligence.scores', metricKey: 'scores', valueType: 'SCORE', renderMode: 'FILL', scaleType: 'FIXED_BINS', versionKey: 'analysis', unit: 'POINTS', legendType: 'BINNED', setting: 'scoreKey', visibility: { client: false }, requires: ['requiresAnalysis'], description: 'Faixas fixas da metodologia publicada.' },
    fit: { group: 'CUSTOMER', valueSource: 'FIT', fieldKey: null, metricKey: 'fitScore', valueType: 'PERCENT', renderMode: 'FILL', scaleType: 'THRESHOLD', versionKey: 'fit', unit: 'PERCENT', legendType: 'BINNED', requires: ['requiresCustomerContext'], label: 'Compatibilidade com o cliente', description: 'Aderência ao perfil do cliente atual (não é probabilidade de compra).' },
    sun: { group: 'COMFORT', valueSource: 'STATIC', fieldKey: 'environmental.orientationRear', valueType: 'ENUM', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'static', unit: null, legendType: 'CATEGORICAL', requires: ['requiresSolarData'], description: 'Para onde ficam os fundos do lote. A análise solar mostra hora a hora.' },
    noise: { group: 'COMFORT', valueSource: 'ANALYSIS', fieldKey: 'environmental.noiseLevel', valueType: 'ORDINAL', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'analysis', unit: null, legendType: 'CATEGORICAL', estimated: true, description: 'Exposição potencial estimada, não medição.' },
    privacy: { group: 'COMFORT', valueSource: 'ANALYSIS', fieldKey: 'environmental.privacyLevel', valueType: 'ORDINAL', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'analysis', unit: null, legendType: 'CATEGORICAL', estimated: true, description: 'Privacidade estimada pelo que fica nos fundos.' },
    forest: { group: 'COMFORT', valueSource: 'STATIC', fieldKey: 'surroundings.hasGreenRear', valueType: 'BOOLEAN', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'static', unit: null, legendType: 'BOOLEAN', description: 'Mata ou parque nos fundos, pela planta e pelo KMZ.' },
    traffic: { group: 'LOCATION', valueSource: 'ANALYSIS', fieldKey: 'mobility.estimatedTraffic', valueType: 'ORDINAL', renderMode: 'FILL', scaleType: 'CATEGORICAL', versionKey: 'analysis', unit: null, legendType: 'CATEGORICAL', estimated: true, description: 'Fluxo relativo de veículos estimado pelas rotas internas (não é ruído).' },
    gate: { group: 'LOCATION', valueSource: 'STATIC', fieldKey: 'mobility.gateProximity', valueType: 'ENUM', renderMode: 'FILL', scaleType: 'THRESHOLD', versionKey: 'static', unit: 'M', legendType: 'BINNED', description: 'Distância de carro até a portaria.' },
    leisure: { group: 'LOCATION', valueSource: 'STATIC', fieldKey: 'mobility.routeDistanceToLeisureM', valueType: 'DISTANCE', renderMode: 'FILL', scaleType: 'THRESHOLD', versionKey: 'static', unit: 'M', legendType: 'BINNED', description: 'Distância de carro até o clube.' },
    none: { group: 'BASE', valueSource: 'NONE', fieldKey: null, valueType: 'NONE', renderMode: 'NONE', scaleType: 'CATEGORICAL', versionKey: null, unit: null, legendType: 'CATEGORICAL', description: 'Somente a planta.' }
  };
  const OVERLAYS = [
    { id: 'recommendation', type: TYPES.CONTEXT_OVERLAY, label: 'Recomendação', toggle: true, autoActivateOn: 'find', valueSource: 'RECOMMENDATION', channel: 'OUTLINE_AND_PIN', zIndex: Z.RECOMMENDATION_COMPARISON, shareable: true },
    { id: 'comparison', type: TYPES.CONTEXT_OVERLAY, label: 'Comparação', toggle: true, valueSource: 'COMPARISON', channel: 'OUTLINE_AND_NUMBER', zIndex: Z.RECOMMENDATION_COMPARISON, shareable: true },
    { id: 'routes', type: TYPES.REFERENCE_OVERLAY, label: 'Rotas', toggle: false, valueSource: 'SPATIAL', channel: 'LINE', zIndex: Z.CONTEXT_OVERLAYS, shareable: false, note: 'Aparece somente quando uma rota é pedida no lote.' },
    { id: 'references', type: TYPES.REFERENCE_OVERLAY, label: 'Pontos de referência', toggle: true, valueSource: 'SPATIAL', channel: 'SYMBOL', zIndex: Z.LABELS, shareable: true },
    { id: 'selected', type: TYPES.INTERACTION_OVERLAY, label: 'Lote selecionado', toggle: false, alwaysOn: true, channel: 'OUTLINE', zIndex: Z.SELECTED },
    { id: 'hover', type: TYPES.INTERACTION_OVERLAY, label: 'Lote sob o cursor', toggle: false, alwaysOn: true, desktopOnly: true, channel: 'OUTLINE', zIndex: Z.HOVER },
    { id: 'filterDim', type: TYPES.INTERACTION_OVERLAY, label: 'Fora dos filtros', toggle: false, alwaysOn: true, channel: 'OPACITY', zIndex: Z.FILTER_DIM },
    { id: 'favorites', type: TYPES.INTERACTION_OVERLAY, label: 'Favoritos', toggle: false, alwaysOn: true, channel: 'DASHED_OUTLINE', zIndex: Z.CONTEXT_OVERLAYS },
    { id: 'labels', type: TYPES.LABEL, label: 'Rótulos', toggle: false, alwaysOn: true, channel: 'TEXT', zIndex: Z.LABELS }
  ];
  const BASES = BASE_MODES.map(m => ({ id: 'base.' + m.toLowerCase(), type: TYPES.BASE, mode: m, label: { PLANT: 'Planta', AERIAL: 'Aérea', HYBRID: 'Híbrido' }[m], zIndex: Z.BASE_MAP }));

  const cfgOf = devId => (App.configs && App.configs.layers && App.configs.layers[devId]) || { defaultPrimaryLayer: 'availability', defaultBaseMap: 'PLANT', hybridBlend: 0.42, enabledLayers: Object.keys(THEMATIC), layerOrder: Object.keys(THEMATIC), defaultOverlays: ['recommendation', 'comparison', 'references'], groups: [], layerOverrides: {}, legendPolicy: {} };
  const fitThresholds = devId => { const r = App.configs && App.configs.recommendation && App.configs.recommendation[devId]; return { min: r ? r.minimumFitScore : null, strong: r ? r.strongMatchFitScore : null }; };

  /** MapLayerRegistry for one development: definitions are frozen; overrides change label/visibility, never meaning */
  const registries = new Map();
  function registry(devId = 'viva-juara') {
    if (registries.has(devId)) return registries.get(devId);
    const cfg = cfgOf(devId), enabled = new Set(cfg.enabledLayers || []), order = cfg.layerOrder || [];
    const groups = Object.fromEntries((cfg.groups || []).map(g => [g.id, g.label]));
    const themed = [];
    for (const id of order) {
      const meta = THEMATIC[id]; if (!meta || !enabled.has(id)) continue;
      const svc = LY.BY[id], ov = (cfg.layerOverrides || {})[id] || {};
      if (!svc && id !== 'fit') continue;
      const vis = { client: svc ? !!svc.client : true, broker: true, technical: true, ...(meta.visibility || {}), ...(ov.visibility || {}) };
      themed.push(Object.freeze({ id, type: id === 'none' ? TYPES.BASE : TYPES.THEMATIC_PRIMARY, version: REGISTRY_VERSION, label: ov.label || meta.label || svc.label, group: meta.group, groupLabel: groups[meta.group] || meta.group,
        valueSource: meta.valueSource, fieldKey: meta.fieldKey, metricKey: meta.metricKey || null, valueType: meta.valueType, renderMode: meta.renderMode,
        scale: Object.freeze({ type: meta.scaleType, domainSource: meta.scaleType === 'FIXED_BINS' || meta.scaleType === 'THRESHOLD' ? 'FIXED_CONFIG' : 'FULL_DEVELOPMENT', versionKey: meta.versionKey, params: meta.scaleParams || null }),
        unit: meta.unit, legendType: meta.legendType, description: meta.description, estimated: !!meta.estimated, freshnessKey: meta.freshnessKey || null, unknownIsCategory: !!meta.unknownIsCategory,
        setting: meta.setting || null, requires: Object.freeze(meta.requires || []), clientVisible: vis.client, brokerVisible: vis.broker, technicalVisible: vis.technical,
        supportsOpacity: id !== 'none', zIndex: Z.THEMATIC_FILL, sortOrder: themed.length }));
    }
    const all = [...BASES, ...themed, ...OVERLAYS.map(o => Object.freeze({ ...o }))];
    const byId = new Map(all.map(d => [d.id, d]));
    const r = Object.freeze({ developmentId: devId, version: REGISTRY_VERSION, config: cfg, all: Object.freeze(all), primary: Object.freeze(themed), overlays: Object.freeze(all.filter(d => d.type === TYPES.CONTEXT_OVERLAY || d.type === TYPES.REFERENCE_OVERLAY || d.type === TYPES.INTERACTION_OVERLAY)), get: id => byId.get(id) || null, has: id => byId.has(id) });
    registries.set(devId, r); return r;
  }

  /** isLayerAvailable(def, ctx) → { available, hidden, reason } — a layer that would paint an empty map is disabled with a reason */
  function isLayerAvailable(def, ctx = {}) {
    if (!def) return { available: false, hidden: true, reason: 'Camada inexistente.' };
    const mode = ctx.mode || 'broker';
    const hidden = mode === 'client' ? !def.clientVisible : mode === 'technical' ? !def.technicalVisible : !def.brokerVisible;
    if (hidden) return { available: false, hidden: true, reason: 'Camada técnica.' };
    for (const req of def.requires || []) {
      if (req === 'requiresCustomerContext' && !(ctx.fit && ctx.fit.size)) return { available: false, hidden: false, reason: 'Selecione um cliente com preferências.' };
      if (req === 'requiresCommercialData' && ctx.lots && !ctx.lots.some(l => l.commercial.price != null)) return { available: false, hidden: false, reason: 'Sem tabela de preços carregada.' };
      if (req === 'requiresAnalysis' && ctx.lots && !ctx.lots.some(l => l.intelligence.class && l.intelligence.class !== 'UNKNOWN')) return { available: false, hidden: false, reason: 'Análise ainda não disponível.' };
      if (req === 'requiresSolarData' && ctx.features && ctx.features.solarAnalysis === false) return { available: false, hidden: false, reason: 'Orientação solar não disponível neste empreendimento.' };
    }
    return { available: true, hidden: false, reason: null };
  }

  // ---------------------------------------------------------------- scales (shared bin resolver for map, legend and tooltip)
  const FIT_COLORS = [LY.GREEN[0], LY.GREEN[2], LY.GREEN[4]];
  function buildFitScale(devId) {
    const t = fitThresholds(devId); if (t.min == null || t.strong == null) return null;
    const bins = [{ key: 'f0', lo: 0, hi: t.min, label: `Abaixo de ${t.min}%` }, { key: 'f1', lo: t.min, hi: t.strong, label: `${t.min}% a ${t.strong - 1}%` }, { key: 'f2', lo: t.strong, hi: 100.000001, label: `${t.strong}% ou mais` }];
    bins.forEach((b, i) => { b.color = FIT_COLORS[i]; });
    return { title: null, classes: bins, value: () => null, note: 'Faixas definidas pela política de recomendação (mínimo e forte aderência).' };
  }
  const scaleCache = new Map();
  /** scaleFor(def, lots, ctx) → ScaleDefinition built on the full development (never on the filtered subset) */
  function scaleFor(def, lots, ctx = {}) {
    const devId = ctx.developmentId || 'viva-juara', setting = def.setting ? (ctx.settings || {})[def.setting] || 'housing' : '';
    const version = def.scale.versionKey ? (ctx.dataVersions || {})[def.scale.versionKey] : null;
    const key = [devId, def.id, setting, version == null ? 'rev:' + (ctx.dataRevision || 0) : version, lots.length].join('|');
    if (scaleCache.has(key)) return scaleCache.get(key);
    let built, status = 'READY', error = null;
    try { built = def.id === 'fit' ? buildFitScale(devId) : LY.BY[def.id].build(lots, { scoreKey: setting || undefined }); if (!built) { status = 'ERROR'; error = 'INVALID_SCALE'; } }
    catch (e) { status = 'ERROR'; error = 'SCALE_BUILD_FAILED'; built = null; }
    const items = built ? built.classes.map((c, i) => Object.freeze({ key: c.key, label: c.label, min: c.lo != null && c.lo !== -Infinity ? c.lo : null, max: c.hi != null && c.hi !== Infinity ? c.hi : null, includeMin: true, includeMax: false, color: c.color, token: tokenFor(def.id, c.key, c.color), order: i })) : [];
    const scale = Object.freeze({ layerId: def.id, type: def.scale.type, domainSource: def.scale.domainSource, dataVersion: version == null ? null : version, setting: setting || null, cacheKey: key, status, error,
      title: built && built.title || def.label, note: built && built.note || null, neutral: !!(built && built.neutral), items: Object.freeze(items), byKey: new Map(items.map(i => [i.key, i])),
      resolve: built ? (def.id === 'fit' ? (lot, v) => { if (v == null) return null; const b = built.classes.find(c => v >= c.lo && v < c.hi); return b ? b.key : null; } : lot => built.value(lot)) : () => null });
    if (scaleCache.size > 80) scaleCache.clear();
    scaleCache.set(key, scale); return scale;
  }

  // ---------------------------------------------------------------- value provider
  const rawOf = (def, lot, ctx) => {
    if (def.id === 'fit') { const r = ctx.fit && ctx.fit.get(lot.identity.id); return r && r.status !== 'INSUFFICIENT_PROFILE' && r.status !== 'FAILED' && r.fitScore != null ? r.fitScore : null; }
    if (def.id === 'score') return lot.intelligence.scores[(ctx.settings || {}).scoreKey || 'housing'];
    if (!def.fieldKey) return null;
    return M.get(lot, def.fieldKey);
  };
  /** LayerValueProvider.get(def, lot, scale, ctx) → LayerValueResult (never recomputes: reads Lot / analysis / Fit results) */
  function valueOf(def, lot, scale, ctx = {}) {
    const lotId = lot.identity.id, version = scale ? scale.dataVersion : null;
    try {
      if (def.id === 'none') return { lotId, layerId: def.id, value: null, binKey: null, valueStatus: 'NO_DATA', freshness: null, confidence: null, provenanceSummary: null, version };
      const raw = rawOf(def, lot, ctx), binKey = scale ? scale.resolve(lot, raw) : null;
      const prov = def.fieldKey && def.id !== 'score' ? M.getFieldProvenance(lot, def.fieldKey) : def.id === 'score' ? M.getFieldProvenance(lot, 'intelligence.scores.' + ((ctx.settings || {}).scoreKey || 'housing')) : null;
      const fresh = def.freshnessKey === 'availability' ? (lot.availability.freshness || 'UNKNOWN') : def.freshnessKey && ctx.freshness && ctx.freshness[def.freshnessKey] ? ctx.freshness[def.freshnessKey].status || null : null;
      let valueStatus = 'AVAILABLE';
      if (def.id === 'availability' && raw === 'UNKNOWN') valueStatus = 'UNKNOWN';
      else if (raw === 'UNKNOWN' || (def.id === 'class' && raw == null)) valueStatus = 'UNKNOWN';
      else if (raw == null || binKey == null) valueStatus = 'NO_DATA';
      else if (prov && prov.status === 'CONFLICTED') valueStatus = 'CONFLICTED';
      return { lotId, layerId: def.id, value: raw == null ? null : raw, binKey: valueStatus === 'AVAILABLE' || (def.unknownIsCategory && valueStatus === 'UNKNOWN') ? binKey : null, valueStatus, freshness: fresh,
        confidence: prov ? prov.confidence || null : null, provenanceSummary: prov ? { status: prov.status, sourceId: prov.sourceId || null, method: prov.method || null } : null, version };
    } catch (e) { return { lotId, layerId: def.id, value: null, binKey: null, valueStatus: 'ERROR', freshness: null, confidence: null, provenanceSummary: null, version, error: String(e && e.message || e) }; }
  }
  /** values for every lot of the reference dataset: Map lotId → LayerValueResult (memoized by scale + fit identity) */
  const valuesCache = new Map();
  function valuesFor(def, lots, scale, ctx = {}) {
    const k = scale.cacheKey + '|' + (def.id === 'fit' ? (ctx.fitKey || '') : '') + '|' + (def.freshnessKey && ctx.freshness && ctx.freshness[def.freshnessKey] ? ctx.freshness[def.freshnessKey].status : '') + '|' + (ctx.dataRevision || 0);
    const hit = valuesCache.get(k); if (hit && hit.lots === lots) return hit.values;
    const values = new Map(lots.map(l => [l.identity.id, valueOf(def, l, scale, ctx)]));
    if (valuesCache.size > 40) valuesCache.clear();
    valuesCache.set(k, { lots, values }); return values;
  }
  /** coverage metadata: the layer is honest about how many lots actually carry a value */
  function coverage(values) {
    const c = { totalLots: 0, availableCount: 0, noDataCount: 0, unknownCount: 0, conflictedCount: 0, errorCount: 0, staleCount: 0, expiredCount: 0 };
    for (const v of values.values()) {
      c.totalLots++;
      if (v.valueStatus === 'AVAILABLE') c.availableCount++; else if (v.valueStatus === 'NO_DATA') c.noDataCount++; else if (v.valueStatus === 'UNKNOWN') c.unknownCount++; else if (v.valueStatus === 'CONFLICTED') c.conflictedCount++; else c.errorCount++;
      if (v.freshness === 'STALE') c.staleCount++; else if (v.freshness === 'EXPIRED') c.expiredCount++;
    }
    c.coverageRatio = c.totalLots ? c.availableCount / c.totalLots : 0;
    return c;
  }

  // ---------------------------------------------------------------- style resolver
  /** resolveStyle(input) → LotVisualStyle. Precedence: selected > comparison/recommendation outline > thematic fill > filter dim > base */
  function resolveStyle({ def, value, scale, interaction = {}, filter = {}, base = 'PLANT', mode = 'broker', layerAllStale = false }) {
    let fillToken = 'map.noData', patternToken = null;
    const vs = value ? value.valueStatus : 'NO_DATA';
    if (def.id === 'none' || !scale || scale.status === 'ERROR') fillToken = def.id === 'none' ? 'map.unknown' : 'map.noData';
    else if (value.binKey != null && scale.byKey.get(value.binKey)) fillToken = scale.byKey.get(value.binKey).token;
    else if (vs === 'UNKNOWN') fillToken = scale.neutral ? 'map.unknown' : 'map.unknown';
    else if (vs === 'CONFLICTED') { fillToken = 'map.conflicted'; if (mode !== 'client') patternToken = 'pattern.conflicted'; }
    else if (vs === 'ERROR') fillToken = 'map.error';
    else fillToken = scale.neutral ? 'map.unknown' : 'map.noData';
    if (vs === 'UNKNOWN' && def.id !== 'availability') patternToken = mode === 'client' ? null : 'pattern.unknown';
    const fillOpacity = base === 'PLANT' ? 0.55 : 0.8;
    const st = { fillToken, fill: color(fillToken), fillOpacity, strokeToken: 'map.base.stroke', strokeWidth: 0.6, strokePattern: 'solid', patternToken, symbolToken: null, zIndex: Z.THEMATIC_FILL, classes: [], ariaLabelParts: [] };
    const dimmed = !!(filter.active && !filter.matched);
    if (dimmed) { st.classes.push('dim'); st.zIndex = Z.FILTER_DIM; }
    if (value && value.freshness === 'STALE' && def.freshnessKey && !layerAllStale) { st.symbolToken = 'symbol.stale'; st.classes.push('stale'); }
    if (interaction.favorite) { st.classes.push('fav'); st.strokePattern = 'dashed'; st.strokeToken = 'map.hover'; st.strokeWidth = 1.6; }
    if (interaction.recommendation) { st.classes.push(interaction.recommendation === 'REVIEW_REQUIRED' ? 'rev' : 'rec'); st.strokeToken = interaction.recommendation === 'REVIEW_REQUIRED' ? 'map.recommendation.review' : 'map.recommendation.primary'; st.strokeWidth = 1.8; st.strokePattern = interaction.recommendation === 'REVIEW_REQUIRED' ? 'dashed' : 'solid'; st.zIndex = Z.RECOMMENDATION_COMPARISON; }
    if (interaction.comparisonIndex) { st.classes.push('cmp'); st.strokeToken = 'map.comparison'; st.strokeWidth = 2.4; st.strokePattern = 'solid'; st.symbolToken = 'symbol.comparison.' + interaction.comparisonIndex; st.zIndex = Z.RECOMMENDATION_COMPARISON; }
    if (interaction.legendFocus === 'in') st.classes.push('lfocus'); else if (interaction.legendFocus === 'out') st.classes.push('lfade');
    if (interaction.selected) { st.classes.push('sel'); st.strokeToken = 'map.selected'; st.strokeWidth = 3.4; st.strokePattern = 'solid'; st.zIndex = Z.SELECTED; }
    if (patternToken) st.classes.push(patternToken === 'pattern.conflicted' ? 'conf' : 'unk');
    return st;
  }

  // ---------------------------------------------------------------- state
  function defaultState(devId = 'viva-juara') {
    const c = cfgOf(devId);
    return { schemaVersion: SCHEMA_VERSION, baseMapMode: BASE_MODES.includes(c.defaultBaseMap) ? c.defaultBaseMap : 'PLANT', baseMapBlend: typeof c.hybridBlend === 'number' ? c.hybridBlend : 0.42,
      primaryLayerId: c.defaultPrimaryLayer || 'availability', activeOverlayIds: (c.defaultOverlays || []).slice(), layerOpacities: {}, layerSettings: { score: { scoreKey: 'housing' } }, lastUpdatedAt: null };
  }
  const touch = (s, patch) => ({ ...s, ...patch, lastUpdatedAt: null });
  /** reducers — pure; only visual configuration, never lot data */
  function setPrimaryLayer(state, layerId, ctx = {}) {
    const r = registry(ctx.developmentId), def = r.get(layerId);
    if (!def || (def.type !== TYPES.THEMATIC_PRIMARY && def.id !== 'none')) return { state, ok: false, reason: 'UNKNOWN_LAYER' };
    const av = isLayerAvailable(def, ctx); if (!av.available) return { state, ok: false, reason: av.reason };
    return { state: touch(state, { primaryLayerId: layerId, previousPrimaryLayerId: state.primaryLayerId }), ok: true };
  }
  function toggleOverlay(state, overlayId, ctx = {}) {
    const def = registry(ctx.developmentId).get(overlayId); if (!def || !def.toggle) return { state, ok: false, reason: 'NOT_TOGGLEABLE' };
    const on = state.activeOverlayIds.includes(overlayId);
    return { state: touch(state, { activeOverlayIds: on ? state.activeOverlayIds.filter(x => x !== overlayId) : [...state.activeOverlayIds, overlayId] }), ok: true };
  }
  function setBaseMapMode(state, mode) { if (!BASE_MODES.includes(mode)) return { state, ok: false, reason: 'UNKNOWN_BASE' }; return { state: touch(state, { baseMapMode: mode }), ok: true }; }
  function setBaseMapBlend(state, v) { const n = Number(v); if (!(n >= 0 && n <= 1)) return { state, ok: false, reason: 'OUT_OF_RANGE' }; return { state: touch(state, { baseMapBlend: n }), ok: true }; }
  function setLayerOpacity(state, layerId, v, ctx = {}) {
    const def = registry(ctx.developmentId).get(layerId), n = Number(v);
    if (!def || !def.supportsOpacity) return { state, ok: false, reason: 'OPACITY_NOT_SUPPORTED' };
    if (!(n >= 0.1 && n <= 1)) return { state, ok: false, reason: 'OUT_OF_RANGE' };
    return { state: touch(state, { layerOpacities: { ...state.layerOpacities, [layerId]: n } }), ok: true };
  }
  const resetLayersToDevelopmentDefault = devId => defaultState(devId);
  /** validate a saved / linked state: unknown layer → default, fit layer without customer → default, schema migration */
  function sanitizeState(saved, ctx = {}) {
    const d = defaultState(ctx.developmentId), dropped = [];
    if (!saved || typeof saved !== 'object') return { state: d, dropped: ['state'] };
    const s = migrate(saved), r = registry(ctx.developmentId), out = { ...d };
    if (BASE_MODES.includes(s.baseMapMode)) out.baseMapMode = s.baseMapMode; else if (s.baseMapMode != null) dropped.push('baseMapMode');
    if (typeof s.baseMapBlend === 'number' && s.baseMapBlend >= 0 && s.baseMapBlend <= 1) out.baseMapBlend = s.baseMapBlend;
    const def = r.get(s.primaryLayerId);
    if (def && (def.type === TYPES.THEMATIC_PRIMARY || def.id === 'none') && isLayerAvailable(def, ctx).available) out.primaryLayerId = def.id; else if (s.primaryLayerId != null) dropped.push('primaryLayerId');
    if (Array.isArray(s.activeOverlayIds)) out.activeOverlayIds = s.activeOverlayIds.filter(id => { const o = r.get(id); return o && o.toggle; });
    if (s.layerOpacities && typeof s.layerOpacities === 'object') for (const [k, v] of Object.entries(s.layerOpacities)) { const o = r.get(k); if (o && o.supportsOpacity && v >= 0.1 && v <= 1) out.layerOpacities = { ...out.layerOpacities, [k]: v }; }
    if (s.layerSettings && s.layerSettings.score && ['housing', 'investment', 'family', 'premium', 'overall'].includes(s.layerSettings.score.scoreKey)) out.layerSettings = { ...out.layerSettings, score: { scoreKey: s.layerSettings.score.scoreKey } };
    return { state: out, dropped };
  }
  /** schema migration: v0 (the store keys activeMapLayer / backgroundLayer / scoreKey) → v1 */
  function migrate(s) {
    if (s.schemaVersion === SCHEMA_VERSION) return s;
    if (s.schemaVersion == null && ('activeMapLayer' in s || 'backgroundLayer' in s)) return { schemaVersion: SCHEMA_VERSION, baseMapMode: STORE_TO_BASE[s.backgroundLayer] || null, primaryLayerId: s.activeMapLayer || null, activeOverlayIds: s.mapOverlays, layerSettings: { score: { scoreKey: s.scoreKey } }, baseMapBlend: s.baseMapBlend, layerOpacities: s.layerOpacities };
    return {};
  }
  /** the application store keeps the v0 keys (activeMapLayer, backgroundLayer, scoreKey) plus mapOverlays / baseMapBlend / layerOpacities */
  const fromStore = st => ({ schemaVersion: SCHEMA_VERSION, baseMapMode: STORE_TO_BASE[st.backgroundLayer] || 'PLANT', baseMapBlend: typeof st.baseMapBlend === 'number' ? st.baseMapBlend : 0.42, primaryLayerId: st.activeMapLayer, previousPrimaryLayerId: st.previousMapLayer || null, activeOverlayIds: Array.isArray(st.mapOverlays) ? st.mapOverlays : [], layerOpacities: st.layerOpacities || {}, layerSettings: { score: { scoreKey: st.scoreKey || 'housing' } }, lastUpdatedAt: null });
  const toStorePatch = s => ({ backgroundLayer: BASE_TO_STORE[s.baseMapMode] || 'plan', baseMapBlend: s.baseMapBlend, activeMapLayer: s.primaryLayerId, previousMapLayer: s.previousPrimaryLayerId || null, mapOverlays: s.activeOverlayIds.slice(), layerOpacities: { ...s.layerOpacities }, scoreKey: (s.layerSettings.score || {}).scoreKey || 'housing' });

  /** URL: base=plant&layer=score&score=housing&ov=recommendation,comparison — ids only, never data */
  function serialize(s, d = defaultState()) {
    const p = [];
    if (s.baseMapMode !== d.baseMapMode) p.push('base=' + s.baseMapMode.toLowerCase());
    if (s.primaryLayerId !== d.primaryLayerId) p.push('layer=' + encodeURIComponent(s.primaryLayerId));
    if (s.primaryLayerId === 'score') p.push('score=' + ((s.layerSettings.score || {}).scoreKey || 'housing'));
    const r = registry(), ov = s.activeOverlayIds.filter(id => (r.get(id) || {}).shareable).sort(), dv = d.activeOverlayIds.slice().sort();
    if (ov.join(',') !== dv.join(',')) p.push('ov=' + (ov.join(',') || '-'));
    return p.join('&');
  }
  function parse(q) {
    const out = {}; if (!q) return out;
    for (const part of String(q).replace(/^[?&]/, '').split('&')) {
      const [k, v] = part.split('='); if (!v) continue; let val; try { val = decodeURIComponent(v); } catch (e) { continue; } // malformed link: ignore that part
      if (k === 'base') { const m = val.toUpperCase(); if (BASE_MODES.includes(m)) out.baseMapMode = m; }
      else if (k === 'layer' && /^[a-zA-Z0-9_]{1,32}$/.test(val)) out.primaryLayerId = val;
      else if (k === 'score' && ['housing', 'investment', 'family', 'premium', 'overall'].includes(val)) out.layerSettings = { score: { scoreKey: val } };
      else if (k === 'ov') out.activeOverlayIds = val === '-' ? [] : val.split(',').filter(x => /^[a-zA-Z]{1,24}$/.test(x));
    }
    return out;
  }

  // ---------------------------------------------------------------- render model
  /** recommendation overlay features from a RecommendationResult: top 5 numbered; review candidates only when nothing is eligible */
  function recommendationFeatures(rec, limit = 5) {
    const m = new Map(), pins = [];
    if (!rec) return { byId: m, pins, counts: null };
    const recs = rec.recommendations || [], review = rec.reviewCandidates || [];
    recs.forEach((r, i) => { const state = i === 0 && r.tier === 'PRIMARY' ? 'TOP_1' : i < limit ? 'TOP_2_5' : r.tier; m.set(r.lotId, r.tier); if (i < limit) pins.push({ lotId: r.lotId, label: String(i + 1), kind: 'rec', state, title: `${i + 1}º na recomendação` }); });
    if (!recs.length) review.slice(0, limit).forEach((r, i) => { m.set(r.lotId, 'REVIEW_REQUIRED'); pins.push({ lotId: r.lotId, label: String(i + 1), kind: 'rev', state: 'REVIEW_REQUIRED', title: `${i + 1}º para revisar (status a confirmar)` }); });
    const counts = { PRIMARY: recs.filter(r => r.tier === 'PRIMARY').length, STRONG_MATCH: recs.filter(r => r.tier === 'STRONG_MATCH').length, ALTERNATIVE: recs.filter(r => r.tier === 'ALTERNATIVE').length, REVIEW_REQUIRED: rec.reviewTotal != null ? rec.reviewTotal : review.length };
    return { byId: m, pins, counts };
  }
  /** buildRenderModel(input) → MapRenderModel. input = { developmentId, lots, layerState, mode, filter: { active, matchedIds }, selectedLotId, hoverLotId,
      comparisonIds, favorites, recommendation, fit, fitKey, freshness, dataVersions, dataRevision, legendFocus: { layerId, itemKey } } */
  /** legend item key of one lot value: a bin, or a status bucket '#NO_DATA'… (client mode folds CONFLICTED into '#NO_DATA') */
  const itemKeyOf = (v, mode) => v.binKey != null ? v.binKey : v.valueStatus === 'CONFLICTED' && mode === 'client' ? '#NO_DATA' : '#' + v.valueStatus;
  /** lots that a legend item stands for, from the same render model the map drew (hover highlight; never filters) */
  function lotsForItem(model, itemKey, mode) { const out = []; if (!model || !model.values) return out; for (const [id, v] of model.values) if (v && itemKeyOf(v, mode || 'broker') === itemKey) out.push(id); return out; }
  function buildRenderModel(input) {
    const t0 = Date.now(), r = registry(input.developmentId), ls = input.layerState, lots = input.lots, mode = input.mode || 'broker';
    const ctx = { developmentId: r.developmentId, settings: ls.layerSettings.score || {}, fit: input.fit, fitKey: input.fitKey, freshness: input.freshness, dataVersions: input.dataVersions || {}, dataRevision: input.dataRevision, lots, mode, features: input.features };
    let def = r.get(ls.primaryLayerId), layerError = null;
    if (!def || !(def.type === TYPES.THEMATIC_PRIMARY || def.id === 'none') || !isLayerAvailable(def, ctx).available) { layerError = def ? 'LAYER_UNAVAILABLE' : 'UNKNOWN_LAYER';
      // topic 18: fall back to the layer the user had before (when it is still usable), then the development default
      const prev = ls.previousPrimaryLayerId && r.get(ls.previousPrimaryLayerId);
      def = prev && prev.type === TYPES.THEMATIC_PRIMARY && isLayerAvailable(prev, ctx).available ? prev : r.get(r.config.defaultPrimaryLayer) || r.primary[0]; }
    let scale = scaleFor(def, lots, ctx);
    if (scale.status === 'ERROR') { layerError = 'LAYER_ERROR'; def = r.get('none') || def; scale = scaleFor(def, lots, ctx); }
    const values = valuesFor(def, lots, scale, ctx), cov = coverage(values);
    const layerAllStale = cov.staleCount === cov.totalLots && cov.totalLots > 0;
    const ov = new Set(ls.activeOverlayIds);
    const recF = ov.has('recommendation') ? recommendationFeatures(input.recommendation) : { byId: new Map(), pins: [], counts: null };
    const cmpIds = ov.has('comparison') ? (input.comparisonIds || []) : [], cmpIdx = new Map(cmpIds.map((id, i) => [id, i + 1]));
    const matched = input.filter && input.filter.active ? input.filter.matchedIds : null, fav = input.favorites || new Set();
    const focus = input.legendFocus && input.legendFocus.layerId === def.id ? input.legendFocus.itemKey : undefined;
    // same item keys as the legend: a bin, or a status bucket '#NO_DATA'… (client mode folds CONFLICTED into '#NO_DATA')
    const keyOfValue = v => itemKeyOf(v, mode);
    const lotStylesById = new Map();
    for (const l of lots) {
      const id = l.identity.id, v = values.get(id);
      const style = resolveStyle({ def, value: v, scale, base: ls.baseMapMode, mode, layerAllStale,
        filter: { active: !!matched, matched: matched ? matched.has(id) : true },
        interaction: { selected: input.selectedLotId === id, comparisonIndex: cmpIdx.get(id) || 0, recommendation: recF.byId.get(id) || null, favorite: fav.has(id), legendFocus: focus === undefined ? null : keyOfValue(v) === focus ? 'in' : 'out' } });
      const op = ls.layerOpacities[def.id]; if (op != null) style.fillOpacity = op;
      style.ariaLabelParts = [`Quadra ${l.identity.blockId}, lote ${l.identity.lotNumber}`, `situação: ${App.i18n.t('AvailabilityStatus', l.availability.status)}`, `${def.label}: ${valueText(def, v, scale, mode)}`];
      lotStylesById.set(id, style);
    }
    const pins = [...recF.pins.filter(p => !cmpIdx.has(p.lotId)), ...cmpIds.map((id, i) => ({ lotId: id, label: String(i + 1), kind: 'cmp', state: 'COMPARISON', title: `Comparação ${i + 1}` }))];
    return {
      baseMap: { mode: ls.baseMapMode, storeMode: BASE_TO_STORE[ls.baseMapMode], blend: ls.baseMapBlend, fillOpacity: ls.baseMapMode === 'PLANT' ? 0.55 : 0.8 },
      primaryLayerId: def.id, requestedLayerId: ls.primaryLayerId, layerError, def, scale, values,
      lotStylesById, overlayFeatures: { pins, recommendation: recF.counts, comparison: cmpIds.slice() },
      referenceFeatures: { visible: ov.has('references') }, labels: { visible: true },
      layerMetadata: { layerId: def.id, title: scale.title, unit: def.unit, scaleType: scale.type, domainSource: scale.domainSource, dataVersion: scale.dataVersion, note: scale.note, coverage: cov, layerAllStale, estimated: def.estimated },
      zOrder: Z_ORDER, precedence: PRECEDENCE, timing: { buildMs: Date.now() - t0 }
    };
  }
  /** text of a layer value (tooltip / aria / legend selected indicator share it) */
  function valueText(def, v, scale, mode) {
    if (!v || def.id === 'none') return 'sem camada';
    if (v.valueStatus === 'ERROR') return 'não foi possível ler';
    if (v.valueStatus === 'CONFLICTED') return mode === 'client' ? 'não disponível' : 'fontes divergentes';
    if (v.valueStatus === 'NO_DATA') return 'não disponível';
    if (v.valueStatus === 'UNKNOWN' && !(def.unknownIsCategory && v.binKey)) return 'desconhecido';
    const item = scale && scale.byKey.get(v.binKey), x = v.value;
    switch (def.unit) {
      case 'BRL': return F.formatBRL(x);
      case 'BRL_PER_M2': return F.formatPricePerM2(x);
      case 'M2': return F.formatSquareMeters(x);
      case 'POINTS': return F.formatScore(x);
      case 'PERCENT': return F.number(x, 0) + '%';
      case 'M': return def.id === 'gate' ? (item ? item.label : String(x)) : F.formatMeters(x);
      default: return item ? item.label : String(x);
    }
  }
  /** tooltip: always block/lot, area and status, then the active layer's value */
  function tooltip(lot, model, mode) {
    const v = model.values.get(lot.identity.id), def = model.def;
    const lines = [F.formatLotTitle(lot.identity.blockId, lot.identity.lotNumber), `${F.formatSquareMeters(lot.geometry.areaM2)} · ${App.i18n.t('AvailabilityStatus', lot.availability.status)}`];
    if (def.id !== 'none' && def.id !== 'availability') lines.push(`${model.scale.title}: ${valueText(def, v, model.scale, mode)}${v && v.freshness === 'STALE' && def.freshnessKey ? ' (último valor conhecido)' : ''}`);
    return lines;
  }
  /** layer menu model (grouped; unavailable layers disabled with the reason; hidden ones left out) */
  function menu(ctx) {
    const r = registry(ctx.developmentId), groups = [];
    for (const d of r.primary) {
      const av = isLayerAvailable(d, ctx); if (av.hidden) continue;
      let g = groups.find(x => x.id === d.group); if (!g) groups.push(g = { id: d.group, label: d.groupLabel, items: [] });
      g.items.push({ id: d.id, label: d.label, disabled: !av.available, reason: av.reason });
    }
    return { groups, bases: BASES.map(b => ({ mode: b.mode, label: b.label })), overlays: r.overlays.filter(o => o.toggle).map(o => ({ id: o.id, label: o.label })) };
  }
  return { SCHEMA_VERSION, REGISTRY_VERSION, TYPES, VALUE_STATUS, BASE_MODES, BASE_TO_STORE, STORE_TO_BASE, Z_ORDER, PRECEDENCE, TOKENS, tokenFor, color,
    registry, isLayerAvailable, scaleFor, valueOf, valuesFor, coverage, resolveStyle, defaultState, setPrimaryLayer, toggleOverlay, setBaseMapMode, setBaseMapBlend, setLayerOpacity,
    resetLayersToDevelopmentDefault, sanitizeState, migrate, fromStore, toStorePatch, serialize, parse, recommendationFeatures, buildRenderModel, itemKeyOf, lotsForItem, valueText, tooltip, menu, cfgOf };
})();
