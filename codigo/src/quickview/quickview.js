/* quickview/quickview.js — LotQuickView view model (topic 20).
   One builder for every container (desktop panel, mobile sheet, presentation): QuickViewContextResolver decides the
   primary context once (TECHNICAL / PRESENTATION / COMPARISON / RECOMMENDATION / CUSTOMER / NEUTRAL); the field
   priority config decides what each mode shows; QuickViewHighlightSelector returns 3–5 deduplicated highlights with
   evidence; QuickViewAlertSummary keeps critical/important alerts visible; actions come from capabilities.
   It reads values already produced (Lot, analysis, FitScoreResult, RecommendationResult, FilterResult); it never
   calculates a score, a fit or a status, and never changes the filter query. */
App.quickView = (() => {
  const M = App.model, F = App.fmt, t = App.i18n.t, AV = App.availability, SC = App.services.scoring;
  const VIEWMODEL_VERSION = 2;
  const CONTEXT_MODES = Object.freeze(['NEUTRAL', 'CUSTOMER', 'RECOMMENDATION', 'COMPARISON', 'PRESENTATION', 'TECHNICAL']);
  const LOAD_STATUS = Object.freeze(['INITIAL', 'PARTIAL', 'READY', 'ERROR']);
  const cfgOf = devId => (App.configs && App.configs.quickview && App.configs.quickview[devId]) || App.configs.quickview['viva-juara'];
  // highlight topic (dedup key) for analysis highlights and fit preferences
  const TOPIC = { GREEN_REAR: 'green', QUIET: 'quiet', PRIVACY: 'privacy', LOW_TRAFFIC: 'traffic', NORTH_SUN_REAR: 'solar', NEAR_GATE: 'gate', NEAR_CLUB: 'leisure', LARGE: 'area', REGULAR_SHAPE: 'geometry',
    quiet: 'quiet', privacy: 'privacy', solar: 'solar', view: 'view', leisure: 'leisure', gate: 'gate', nearGate: 'gate', lowTraffic: 'traffic', geometry: 'geometry', priceQuality: 'price', green: 'green', area: 'area', areaRange: 'area', budget: 'price', noCorner: 'geometry', awayFromAvenue: 'traffic', rearOrientation: 'solar' };
  /** low-coverage threshold comes from the Fit methodology config (minCoverage), never a number fixed here */
  const minCoverageOf = devId => { const c = App.fit && App.fit.cfgOf ? App.fit.cfgOf(devId) : null; return c && Number.isFinite(c.minCoverage) ? c.minCoverage : 0.5; };
  const LAYER_TOPIC = { noise: 'quiet', privacy: 'privacy', sun: 'solar', forest: 'green', traffic: 'traffic', gate: 'gate', leisure: 'leisure', area: 'area', price: 'price', pricePerM2: 'price' };

  /** QuickViewContextResolver: one primary context, decided once */
  function resolveContext(input) {
    const pm = input.mode === 'technical' ? 'technical' : input.mode === 'client' ? 'client' : 'broker';
    const presentation = pm === 'client' && !!input.presentation;
    const fit = input.fit || null, hasCustomer = !!(input.customer && fit && fit.status !== 'INSUFFICIENT_PROFILE');
    const rec = input.recommendation || null, lotId = input.lotId;
    const inRec = rec ? (rec.recommendations || []).find(r => r.lotId === lotId) || (rec.reviewCandidates || []).find(r => r.lotId === lotId) || null : null;
    const cmpIdx = (input.compareIds || []).indexOf(lotId);
    const primary = pm === 'technical' ? 'TECHNICAL' : presentation ? 'PRESENTATION' : cmpIdx >= 0 && input.view === 'compare' ? 'COMPARISON' : inRec ? 'RECOMMENDATION' : hasCustomer ? 'CUSTOMER' : 'NEUTRAL';
    return Object.freeze({ mode: primary, presentationMode: pm, priorityMode: presentation ? 'presentation' : pm, activeLayerId: input.activeLayerId || null, currentCustomerId: hasCustomer ? input.customer.id : null,
      customerLabel: hasCustomer && pm !== 'client' ? input.customer.name || null : null,
      recommendationContext: inRec ? { rank: inRec.rank, tier: inRec.tier, reviewCategory: inRec.reviewCategory || null, total: inRec.tier === 'REVIEW_REQUIRED' ? rec.reviewTotal : (rec.recommendations || []).length } : null,
      comparisonState: cmpIdx >= 0 ? { index: cmpIdx + 1, total: input.compareIds.length } : null,
      filterStateSummary: input.filter && input.filter.active ? { active: true, matched: input.filter.matchedIds.has(lotId) } : { active: false, matched: true },
      offline: { status: input.connectivity || 'UNKNOWN' } });
  }
  /** QuickViewCapabilities: what this screen may do (no auth logic inline; roles arrive with a later topic) */
  function capabilities(ctx, lot, input) {
    const client = ctx.presentationMode === 'client', sim = AV.simulationEligibility(lot.availability.status, AV.policyOf(input.dev));
    return Object.freeze({ canViewCommercial: true, canViewTechnical: !client, canShare: true, canSimulate: !!sim.allowed && lot.commercial.price != null, simulateReason: !sim.allowed ? sim.warning || 'Simulação indisponível para este status.' : lot.commercial.price == null ? 'Simulação indisponível: lote sem preço de tabela utilizável.' : null, // topic 29: status and price are checked separately
      canCompare: !((input.compareIds || []).length >= App.services.comparison.MAX_LOTS && !(input.compareIds || []).includes(lot.identity.id)), canFavorite: true, canSolar: !!(input.dev.features || {}).solarAnalysis, canExplain: !client && !!input.fit });
  }

  /** QuickViewHighlightSelector: analysis highlights + customer strengths + layer context → 3–5, one per topic, each with evidence */
  function selectHighlights(lot, ctx, input, max) {
    const out = [], seen = new Set();
    const strengths = ctx.currentCustomerId && input.fit ? input.fit.strengths || [] : [];
    const strongTopics = new Set(strengths.map(s => TOPIC[s.key]).filter(Boolean));
    const layerTopic = LAYER_TOPIC[ctx.activeLayerId] || null;
    const cand = [];
    for (const h of lot.intelligence.highlights || []) {
      const topic = TOPIC[h.type] || h.type;
      cand.push({ id: h.id, reasonCode: 'HL_' + h.type, fieldKey: h.fieldKey, labelKey: h.title, type: 'POSITIVE', topic, priority: h.weight + (strongTopics.has(topic) ? 3 : 0) + (layerTopic === topic ? 2 : 0), evidenceRef: { kind: 'ANALYSIS', fieldKey: h.fieldKey }, confidence: null, status: M.getFieldProvenance(lot, h.fieldKey).status, matchesCustomer: strongTopics.has(topic), layerContext: layerTopic === topic });
    }
    for (const s of strengths) {
      const topic = TOPIC[s.key] || s.key;
      cand.push({ id: `${lot.identity.id}-FIT-${s.key}`, reasonCode: 'FIT_STRENGTH_' + s.key, fieldKey: s.fieldKey || null, labelKey: `Atende ao perfil: ${(((App.fit.cfgOf(input.dev.id) || {}).preferences || {})[s.key] || {}).label || s.key}`, type: 'CUSTOMER_MATCH', topic, priority: 3 + 4 * (s.weightedContribution || 0), evidenceRef: { kind: 'FIT', preferenceKey: s.key, matchScore: s.matchScore }, confidence: s.confidence || null, status: s.status || null, matchesCustomer: true, layerContext: layerTopic === topic });
    }
    // an analysis highlight and a customer strength on the same topic: keep one (the analysis text, marked as matching the customer)
    cand.sort((a, b) => b.priority - a.priority || (a.type === 'POSITIVE' ? -1 : 1) || a.id.localeCompare(b.id));
    for (const c of cand) { if (seen.has(c.topic)) continue; if (c.status === 'UNKNOWN' && c.type === 'POSITIVE') continue; seen.add(c.topic); out.push(c); if (out.length >= max) break; }
    return out;
  }
  /** QuickViewAlertSummary: critical/important always visible; attention summarized; info only in details */
  function alertSummary(lot, pcfg, max) {
    const all = lot.intelligence.alerts || [], order = App.enums.SEVERITY_ORDER, by = s => all.filter(a => a.severity === s);
    const crit = by('CRITICAL'), imp = by('IMPORTANT'), att = by('ATTENTION'), info = by('INFO');
    const top = [...crit, ...imp, ...att].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, Math.max(max, crit.length + imp.length));
    return { criticalCount: crit.length, importantCount: imp.length, attentionCount: att.length, infoCount: info.length, total: all.length, hasBlockingAlert: crit.length > 0,
      topAlerts: top.map(a => ({ ...a, typeLabel: t('AlertType', a.type), severityLabel: t('Severity', a.severity), section: 'intelligence' })), moreCount: Math.max(0, all.length - top.length) };
  }
  /** QuickViewAction[] (ordered by config; disabled ones stay visible with the reason when that explains a capability) */
  function actions(ctx, caps, lot, input) {
    const client = ctx.presentationMode === 'client', inCmp = (input.compareIds || []).includes(lot.identity.id), fav = input.favorites && input.favorites.has(lot.identity.id);
    const primary = AV.primaryAction(lot.availability.status);
    const A = (id, labelKey, iconToken, priority, visible, enabled, disabledReasonKey, extra = {}) => ({ id, labelKey, iconToken, priority, visible, enabled, disabledReasonKey: enabled ? null : disabledReasonKey, loading: false, destructive: false, analyticsKey: 'quickview_' + id, ...extra });
    const list = [
      A('primary', t('Action', primary), primary === 'SIMULATE' ? 'calc' : primary === 'CONFIRM_AVAILABILITY' ? 'info' : 'list', 0, true, true, null, { actionCode: primary }),
      A('details', 'Ver detalhes', 'list', 1, true, true),
      A('compare', inCmp ? 'Na comparação' : 'Comparar', 'cmp', 2, true, caps.canCompare || inCmp, 'Até 4 lotes na comparação.', { pressed: inCmp }),
      A('simulate', 'Simular', 'calc', 3, primary !== 'SIMULATE', caps.canSimulate, caps.simulateReason),
      A('share', 'Compartilhar', 'share', 4, true, caps.canShare),
      A('favorite', fav ? 'Favorito' : 'Favoritar', 'heart', 5, true, caps.canFavorite, null, { pressed: !!fav }),
      A('solar', 'Sol no lote', 'sun', 6, caps.canSolar, caps.canSolar),
      A('routeGate', 'Rota à portaria', 'route', 7, ctx.mode !== 'PRESENTATION', true, null, { pressed: input.showRoute === 'gate' }),
      A('routeLeisure', 'Rota ao clube', 'route', 8, ctx.mode !== 'PRESENTATION', true, null, { pressed: input.showRoute === 'leisure' }),
      A('explain', 'Por que esta posição?', 'info', 9, !client && !!ctx.recommendationContext, caps.canExplain, 'Selecione um cliente.'),
      A('copyId', 'Copiar ID técnico', 'copy', 10, ctx.presentationMode === 'technical', true),
      A('provenance', 'Origem dos dados', 'info', 11, ctx.presentationMode === 'technical', true)
    ];
    const order = cfgOf(input.dev.id).actionOrder || [];
    return list.filter(a => a.visible).sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  }
  const priceNote = (lot, client) => {
    const f = lot.metadata.freshness && lot.metadata.freshness.commercial;
    if (!f || f === 'FRESH') return null;
    if (f === 'EXPIRED') return client ? 'Valor sujeito a confirmação' : 'Tabela vencida: não use para fechar negócio';
    if (f === 'UNKNOWN') return 'Preço não disponível';
    return client ? 'Valor sujeito a confirmação' : 'Baseado na última tabela disponível';
  };

  /** build(lot, input) → LotQuickViewViewModel. input = { dev, cfg (presentation config), mode, presentation, objective, prefs, favorites, compareIds, view,
      filter { active, query, matchedIds }, fit (FitScoreResult of this lot), customer { id, name }, recommendation, activeLayerId, connectivity, freshness, showRoute, statusVM } */
  function build(lot, input) {
    const lotId = lot.identity.id, partialErrors = [];
    const ctx = resolveContext({ ...input, lotId });
    const pc = (cfgOf(input.dev.id).modes || {})[ctx.priorityMode] || cfgOf('viva-juara').modes.broker;
    const client = ctx.presentationMode === 'client', technical = ctx.presentationMode === 'technical';
    const caps = capabilities(ctx, lot, input);
    const status = input.statusVM(lot, ctx.presentationMode);
    const commercial = { price: lot.commercial.price, priceText: lot.commercial.price != null ? F.formatBRL(lot.commercial.price) : 'Não disponível', pricePerM2: lot.commercial.pricePerM2, pricePerM2Text: F.formatPricePerM2(lot.commercial.pricePerM2),
      freshness: lot.metadata.freshness ? lot.metadata.freshness.commercial || null : null, note: priceNote(lot, client), priceTableVersion: technical ? (lot.metadata.dataVersions || {}).priceTableVersion || null : null };
    const metrics = [
      { key: 'area', label: 'Área', value: F.formatSquareMeters(lot.geometry.areaM2), fieldKey: 'geometry.areaM2', status: M.getFieldProvenance(lot, 'geometry.areaM2').status, priority: 'P0' },
      { key: 'price', label: 'Preço', value: commercial.priceText, fieldKey: 'commercial.price', status: M.getFieldProvenance(lot, 'commercial.price').status, note: commercial.note, priority: 'P0' },
      { key: 'pricePerM2', label: 'Preço por m²', value: commercial.pricePerM2Text, fieldKey: 'commercial.pricePerM2', status: M.getFieldProvenance(lot, 'commercial.pricePerM2').status, priority: 'P1' }
    ].slice(0, pc.maxMetrics);
    // intelligence: primary score comes from the existing resolver (objective), never calculated here
    let intelligence = null;
    try {
      if (pc.showScore) {
        const ps = SC.primaryScore(lot, input.cfg, input.objective);
        intelligence = { primaryScore: { ...ps, formatted: F.formatScore(ps.value), rankingText: ps.ranking ? `${ps.ranking.position}º de ${ps.ranking.total} em ${ps.label}` : null },
          cls: lot.intelligence.class === 'UNKNOWN' ? null : { code: lot.intelligence.class, label: F.formatLotClass(lot.intelligence.class), color: App.services.layers.CLASS[lot.intelligence.class] || null },
          keyAttributes: SC.keyAttributes(lot, input.cfg, input.objective, input.prefs || {}, input.cfg.quickViewKeyAttributeCount).map(k => ({ ...k, formatted: k.value == null ? 'Não disponível' : `${F.formatNote(k.value)}/10` })),
          analysisVersion: technical ? (lot.metadata.dataVersions || {}).analysisVersion || null : null };
      }
    } catch (e) { partialErrors.push('intelligence'); }
    // customer fit: only with an active customer; never a purchase probability
    let customerFit = null;
    try {
      const f = input.fit;
      if (ctx.currentCustomerId && f) customerFit = { status: f.status, fitScore: f.fitScore, pct: f.fitScore == null ? null : Math.round(f.fitScore), coverage: f.coverage, confidence: f.confidence, label: f.fitScore == null ? 'Compatibilidade não calculada' : `${Math.round(f.fitScore)}% compatível`,
        customerLabel: ctx.customerLabel, lowCoverage: f.coverage != null && f.coverage < minCoverageOf(input.dev.id), partial: f.status === 'PARTIAL', staleCommercial: (f.warnings || []).some(w => w.code === 'STALE_PRICE'),
        note: lot.availability.freshness !== 'FRESH' || commercial.freshness && commercial.freshness !== 'FRESH' ? 'Resultado sujeito a confirmação de preço e disponibilidade' : null };
    } catch (e) { partialErrors.push('fit'); }
    const highlights = selectHighlights(lot, ctx, input, pc.maxHighlights);
    const alerts = alertSummary(lot, input.cfg, pc.maxAlerts);
    // filter context: explain without changing the filter
    let outsideFilter = null;
    if (ctx.filterStateSummary.active && !ctx.filterStateSummary.matched && input.filter.query) {
      const why = App.filters.whyNot(lot, input.filter.query, input.filter.ctx || {});
      outsideFilter = { reasons: why.map(w => ({ filterId: w.filterId, unknown: w.unknown, label: (App.filters.BY[w.filterId] || {}).group ? filterLabel(w) : w.filterId })) };
    }
    const facts = pc.showFacts ? [
      { label: 'Ruído provável', value: F.formatLevel(lot.environmental.noiseLevel), fieldKey: 'environmental.noiseLevel', emphasized: ctx.activeLayerId === 'noise' },
      { label: 'Privacidade', value: F.formatLevel(lot.environmental.privacyLevel, true), fieldKey: 'environmental.privacyLevel', emphasized: ctx.activeLayerId === 'privacy' },
      { label: 'Sol do norte', value: t('NorthSunSide', lot.environmental.northSunSide).split(';')[0].split(':')[0], fieldKey: 'environmental.northSunSide', emphasized: ctx.activeLayerId === 'sun' },
      ...(client || ctx.mode === 'PRESENTATION' ? [] : [
        { label: 'Frente', value: F.formatMeters(lot.geometry.frontM, 1), fieldKey: 'geometry.frontM', emphasized: false },
        { label: 'Formato', value: t('LotShape', lot.geometry.shape || 'UNKNOWN'), fieldKey: 'geometry.shape', emphasized: false },
        { label: 'Esquina', value: lot.geometry.isCorner == null ? 'Não disponível' : lot.geometry.isCorner ? 'Sim' : 'Não', fieldKey: 'geometry.isCorner', emphasized: false }])
    ].map(f => ({ ...f, status: M.getFieldProvenance(lot, f.fieldKey).status })) : [];
    const layerField = ctx.activeLayerId && App.mapLayers ? (App.mapLayers.registry(input.dev.id).get(ctx.activeLayerId) || {}).fieldKey : null;
    const uiHints = { primaryMetricKey: ctx.mode === 'CUSTOMER' || ctx.mode === 'RECOMMENDATION' ? 'fit' : client ? 'price' : 'score', emphasizedFieldKeys: layerField ? [layerField] : [],
      showRecommendationRank: !!ctx.recommendationContext, showFit: !!customerFit, showFreshnessWarning: !!(status.warn || commercial.note) };
    const actionList = actions(ctx, caps, lot, input).filter(a => ctx.mode !== 'PRESENTATION' || a.id === 'primary' || a.id === 'share')
      ; // tiers count visible actions only: 1 primary, 2 secondary, the rest under "Mais ações"
    { let vi = 0; for (let i = 0; i < actionList.length; i++) { const a = actionList[i]; actionList[i] = { ...a, tier: a.visible === false ? 'HIDDEN' : vi === 0 ? 'PRIMARY' : vi <= 2 ? 'SECONDARY' : 'OVERFLOW' }; if (a.visible !== false) vi++; } }
    const vm = {
      viewModelVersion: VIEWMODEL_VERSION, lotId, loadStatus: partialErrors.length ? 'PARTIAL' : 'READY', partialErrors, context: ctx,
      identity: { displayCode: lot.identity.displayCode, blockNumber: lot.identity.blockId, lotNumber: lot.identity.lotNumber, title: F.formatLotTitle(lot.identity.blockId, lot.identity.lotNumber), canonicalId: client ? null : lotId },
      availability: status, commercial, metrics, intelligence, customerFit,
      recommendation: ctx.recommendationContext ? { ...ctx.recommendationContext, label: ctx.recommendationContext.tier === 'REVIEW_REQUIRED' ? `${ctx.recommendationContext.rank}º para revisar (${!ctx.recommendationContext.reviewCategory || ctx.recommendationContext.reviewCategory === 'AVAILABILITY' ? 'status a confirmar' : 'dado a confirmar'})` : `${ctx.recommendationContext.rank}º na recomendação` } : null,
      comparison: ctx.comparisonState, outsideFilter, highlights, alerts, facts, freshness: client ? null : { availability: lot.availability.freshness, commercial: commercial.freshness },
      provenanceSummary: (() => { const keys = [...metrics.map(m => m.fieldKey), ...facts.map(f => f.fieldKey)], est = keys.filter(k => M.getFieldProvenance(lot, k).status === 'ESTIMATED');
        return { estimatedFields: est.length, estimatedKeys: est, labels: [...metrics, ...facts].filter(x => est.includes(x.fieldKey)).map(x => x.label) }; })(),
      actions: actionList, capabilities: caps, uiHints,
      bestFor: !client && lot.intelligence.idealProfiles.length ? `Mais indicado para ${lot.intelligence.idealProfiles.map(p => t('Profile', p)).join(' e ')}` : null,
      dataVersions: technical ? lot.metadata.dataVersions || null : null
    };
    // legacy shape kept for the details header and other readers of App.vm.quickViewVM
    Object.assign(vm, { id: lotId, code: lot.identity.code, title: vm.identity.title, displayCode: vm.identity.displayCode, techId: vm.identity.canonicalId, status, outOfFilters: !ctx.filterStateSummary.matched,
      cls: intelligence ? intelligence.cls : null, primaryScore: intelligence ? intelligence.primaryScore : null, keyAttributes: intelligence ? intelligence.keyAttributes : [],
      isFavorite: !!(input.favorites && input.favorites.has(lotId)), inComparison: (input.compareIds || []).includes(lotId), comparisonFull: !caps.canCompare,
      primaryAction: { id: actionList[0].actionCode, label: actionList[0].labelKey }, simulation: { allowed: caps.canSimulate } });
    return vm;
  }
  function filterLabel(w) {
    const L = { statuses: 'situação', onlyOfferable: 'só ofertáveis', block: 'quadra', price: 'preço', area: 'área', classMin: 'classe', noCorner: 'sem esquina', shapes: 'formato', greenBehind: 'mata nos fundos', rearOrientation: 'orientação dos fundos',
      noiseMax: 'ruído', privacyMin: 'privacidade', trafficMax: 'trânsito', gateMaxM: 'distância à portaria', clubMaxM: 'distância ao clube', noNoiseAlert: 'alerta de ruído', favoritesOnly: 'favoritos', scoreMin: 'score mínimo', alertsExclude: 'alertas', fitMin: 'compatibilidade', dataStatus: 'qualidade do dado' };
    return (L[w.filterId] || w.filterId) + (w.unknown ? ' (sem dado)' : '');
  }
  /** stale-response protection: an async part of the Quick View (e.g. a technical explanation) only lands if the lot is still the same */
  function requestGuard() {
    let seq = 0, current = null;
    return { begin(lotId) { seq++; current = { id: seq, lotId }; return current; }, isCurrent(token, lotId) { return !!token && current && token.id === current.id && token.lotId === lotId; }, cancel() { current = null; } };
  }
  return { VIEWMODEL_VERSION, CONTEXT_MODES, LOAD_STATUS, cfgOf, resolveContext, capabilities, selectHighlights, alertSummary, actions, build, requestGuard };
})();
