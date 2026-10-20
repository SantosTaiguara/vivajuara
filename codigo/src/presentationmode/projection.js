/* presentationmode/projection.js — topic 41: PresentationProjectionService (client-safe ViewModels per domain).
   PresentationAvailabilityProjection · PresentationPriceProjection (table price only) · PresentationValueProjection ·
   PresentationHighlightPolicy · PresentationAlertSummary · PresentationFitSummary · PresentationLotCard ·
   PresentationRecommendationViewModel · PresentationComparisonViewModel · PresentationFinancialViewModel ·
   PresentationMapViewModel · CustomerObjective · DevelopmentOverview · NextSteps.

   Every builder reads already-computed results (canonical Lot, FitScoreResult, RecommendationResult, the comparison
   EvaluationResult of topic 25, FinancialSimulationResult) and returns NEW plain objects holding only client-safe values.
   Nothing here recalculates Fit, ranking, winners, prices or installments. The only price shown is the lot's table
   price (commercial.price of the current price table); unknown never becomes R$ 0 and UNKNOWN never becomes "Disponível".
   The renderer consumes these projections, never the domain objects. */
App.presentationMode = App.presentationMode || {};
App.presentationMode.projection = (() => {
  const P = App.presentationMode.policy, W = P.WORDING, F = App.fmt;
  const t = (k, v, d) => (App.i18n && App.i18n.t ? App.i18n.t(k, v, d) : (d ?? v));

  // ---------------------------------------------------------------- availability
  /** availability(lot, ctx) → PresentationAvailabilityProjection. AVAILABLE is only "Disponível" when fresh and online. */
  function availability(lot, ctx = {}) {
    const a = (lot && lot.availability) || {}, st = a.status || 'UNKNOWN', fresh = a.freshness === 'FRESH' && !ctx.offline;
    const state = st === 'AVAILABLE' ? (fresh ? 'AVAILABLE_CONFIRMED' : 'STATUS_CONFIRMATION_REQUIRED') : st === 'RESERVED' ? 'RESERVED' : st === 'PROPOSAL' ? 'IN_PROPOSAL' : st === 'SOLD' ? 'SOLD'
      : st === 'BLOCKED' || st === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'STATUS_CONFIRMATION_REQUIRED';
    const caveat = state === 'STATUS_CONFIRMATION_REQUIRED' ? W.availabilityCaveat : !fresh ? 'Situação sujeita a confirmação.' : null;
    return Object.freeze({ state, label: W.availability[state], caveat, confirmed: state !== 'STATUS_CONFIRMATION_REQUIRED' && fresh, announce: caveat ? `${W.availability[state]} ${caveat}` : W.availability[state] });
  }

  // ---------------------------------------------------------------- price (table price only)
  /** price(lot, ctx) → PresentationPriceProjection. Only commercial.price of the current table; never a negotiated/discounted price. */
  function price(lot, ctx = {}) {
    const c = (lot && lot.commercial) || {}, pt = ctx.priceTable || null, prov = ((lot && lot.provenance) || {})['commercial.price'];
    const table = pt ? `${pt.name} · ${F.formatDate(pt.version)}` : null;
    if (c.price == null || !Number.isFinite(c.price)) return Object.freeze({ state: 'NOT_AVAILABLE', kind: 'TABLE_PRICE', label: W.price.label, value: null, text: W.price.notAvailable, pricePerM2Text: null, tableLabel: table, caveat: null });
    const conflicted = (prov && prov.status === 'CONFLICTED') || (pt && c.priceTableId && c.priceTableId !== pt.id);
    if (conflicted) return Object.freeze({ state: 'CONFLICTED', kind: 'TABLE_PRICE', label: W.price.label, value: null, text: W.price.conflicted, pricePerM2Text: null, tableLabel: table, caveat: 'O preço deste lote precisa ser confirmado antes de ser apresentado.' });
    const fr = (lot.metadata && lot.metadata.freshness && lot.metadata.freshness.commercial) || ctx.commercialFreshness || 'UNKNOWN';
    const fresh = fr === 'FRESH' && !ctx.offline;
    return Object.freeze({ state: fresh ? 'CURRENT_CONFIRMED' : 'CURRENT_WITH_CAVEAT', kind: 'TABLE_PRICE', label: W.price.label, value: c.price, text: F.formatBRL(c.price),
      pricePerM2Text: c.pricePerM2 != null ? F.formatPricePerM2(c.pricePerM2) : null, tableLabel: table, caveat: fresh ? null : W.price.staleCaveat });
  }

  // ---------------------------------------------------------------- values
  /** value(lot, fieldKey, ctx) → PresentationValueProjection | null (null = path not client-safe: the field does not exist for the audience) */
  function value(lot, key, ctx = {}) {
    if (!P.isAllowedPath(ctx.policy, key)) return null;
    const vm = App.vm && App.vm.fieldVM ? App.vm.fieldVM(lot, key, {}) : null; if (!vm) return null;
    const ds = vm.formattedValue == null ? 'UNKNOWN' : null, stWord = W.provenance[vm.dataStatus] || null;
    return Object.freeze({ label: vm.label, text: vm.formattedValue == null ? W.dataState.UNKNOWN : vm.formattedValue, dataState: ds || (vm.dataStatus === 'CONFLICTED' ? 'CONFLICTED' : vm.dataStatus === 'TO_CONFIRM' ? 'PENDING' : null),
      qualifier: vm.formattedValue == null ? null : stWord });
  }
  const area = (lot, ctx) => value(lot, 'geometry.areaM2', ctx);

  // ---------------------------------------------------------------- highlights (from the existing factual engine only)
  /** highlights(lot, ctx): titles of the lot's own highlights (domain/rules) whose field is client-safe, plus comparison facts given by topic 25. */
  function highlights(lot, ctx = {}) {
    const max = ctx.max || 3, out = [];
    for (const h of ((lot.intelligence || {}).highlights || [])) { if (h.fieldKey && !P.isAllowedPath(ctx.policy, h.fieldKey)) continue; if (h.title) out.push(Object.freeze({ text: h.title, source: 'LOT_FACT' })); }
    for (const x of ctx.comparisonFacts || []) out.unshift(Object.freeze({ text: x, source: 'COMPARISON' }));
    return out.slice(0, max);
  }
  // ---------------------------------------------------------------- alerts
  function alerts(lot, ctx = {}) {
    const out = [];
    for (const a of ((lot.intelligence || {}).alerts || [])) {
      const lvl = P.alertLevel(a, ctx); if (lvl === 'HIDE') continue;
      const x = P.transform('CLIENT_SAFE_ALERT_WORDING', a);
      out.push(Object.freeze({ level: lvl, title: x.title ? F.capital(String(x.title).toLowerCase()) : null, text: x.message }));
    }
    const av = ctx.availability || availability(lot, ctx);
    if (av.state === 'STATUS_CONFIRMATION_REQUIRED') out.push(Object.freeze({ level: 'SHOW_AS_CAVEAT', title: 'Disponibilidade', text: W.availabilityCaveat }));
    return out;
  }
  // ---------------------------------------------------------------- Fit
  /** fitSummary(fitResult, ctx) — wording only; percent only when the policy allows; never "chance"/"probabilidade".
      "Alta compatibilidade" only above the recommendation policy's strongMatchFitScore (no band invented here). */
  function fitSummary(fit, ctx = {}) {
    if (!fit || fit.fitScore == null || !['COMPLETE', 'PARTIAL'].includes(fit.status)) return null;
    const pol = ctx.policy || P.current(), rp = App.recommendation && App.recommendation.policyOf ? App.recommendation.policyOf(ctx.developmentId || 'viva-juara') : null;
    const strong = rp && rp.strongMatchFitScore != null && fit.fitScore >= rp.strongMatchFitScore;
    return Object.freeze({ label: strong ? W.fit.HIGH : 'Compatível com parte das preferências informadas', percentText: pol.showFitPercent && fit.status === 'COMPLETE' ? `${Math.round(fit.fitScore)}% de aderência` : null,
      caveat: fit.status === 'PARTIAL' ? W.fit.PARTIAL : null, context: ctx.customerLabel ? `Compatibilidade com o perfil de ${ctx.customerLabel}` : 'Compatibilidade com o perfil informado' });
  }
  // ---------------------------------------------------------------- lot card
  function lotCard(lot, ctx = {}) {
    if (!lot) return null;
    const av = availability(lot, ctx), pr = price(lot, ctx), id = lot.identity;
    const actions = ['FOCUS_ON_MAP', 'COMPARE', ...(pr.state === 'CURRENT_CONFIRMED' || pr.state === 'CURRENT_WITH_CAVEAT' ? ['OPEN_FINANCIAL'] : []), 'RECORD_INTEREST', 'REQUEST_VISIT'];
    return Object.freeze({ lotRef: id.code, identityLabel: F.formatLotTitle(id.blockId, id.lotNumber), availability: av, price: pr, area: area(lot, ctx), keyHighlights: highlights(lot, ctx),
      fitSummary: ctx.fitByLot ? fitSummary(ctx.fitByLot[id.id], ctx) : null, clientSafeAlerts: alerts(lot, { ...ctx, availability: av }), actions: Object.freeze(actions) });
  }
  /** lotDetails(lot, fields, ctx): only the requested fields that are client-safe; others are dropped (not rendered-and-hidden) */
  function lotDetails(lot, fields, ctx = {}) {
    const keys = (fields && fields.length ? fields : ['geometry.areaM2', 'geometry.frontM', 'geometry.averageDepthM', 'geometry.shape', 'environmental.orientationFront', 'environmental.northSunSide', 'environmental.noiseLevel',
      'environmental.privacyLevel', 'mobility.estimatedTraffic', 'mobility.routeDistanceToGateM', 'mobility.routeDistanceToLeisureM', 'construction.topography']);
    return Object.freeze({ card: lotCard(lot, ctx), rows: keys.map(k => value(lot, k, ctx)).filter(Boolean) });
  }

  // ---------------------------------------------------------------- Recommendation (existing result; rank preserved)
  /** client wording of a recommendation reason: the reason-code registry (topic 16, client level); unknown or non-client codes → dropped */
  const reasonText = c => App.reasonCodes && App.reasonCodes.visibleIn(c, 'client') ? App.reasonCodes.label(c, 'client') : null;
  /** recommendation(result, ctx) → PresentationRecommendationViewModel. Unknown reason codes are dropped (deny by default); no trace, no tie-break, no codes. */
  function recommendation(result, ctx = {}) {
    if (!result || !(result.recommendations || []).length) return Object.freeze({ empty: true, emptyText: W.noRecommendation, items: [], caveats: [] });
    const max = ctx.max || 3, resolve = ctx.resolve || (() => null);
    const items = result.recommendations.slice(0, max).map(r => {
      const lot = resolve(r.lotId); if (!lot) return null;
      const reasons = (r.keyReasonCodes || []).map(reasonText).filter(Boolean);
      return Object.freeze({ positionLabel: `Opção ${r.rank}`, card: lotCard(lot, { ...ctx, fitByLot: { [lot.identity.id]: r.fit || (r.fitScore != null ? { fitScore: r.fitScore, status: r.coverage >= 0.999 ? 'COMPLETE' : 'PARTIAL' } : null) } }), reasons: Object.freeze([...new Set(reasons)].slice(0, 3)) });
    }).filter(Boolean);
    const caveats = []; if (items.some(i => i.card.fitSummary && i.card.fitSummary.caveat)) caveats.push(W.fit.PARTIAL);
    if (items.some(i => i.card.availability.state === 'STATUS_CONFIRMATION_REQUIRED')) caveats.push(W.availabilityCaveat);
    return Object.freeze({ empty: !items.length, emptyText: items.length ? null : W.noRecommendation, items: Object.freeze(items), caveats: Object.freeze(caveats) });
  }

  // ---------------------------------------------------------------- Comparison (topic 25 result; no winner logic here)
  /** comparison(evaluation, ctx) → PresentationComparisonViewModel. Highlights come from App.compare.evaluation.highlights(audience presentation). */
  function comparison(ev, ctx = {}) {
    const EV = App.compare && App.compare.evaluation, resolve = ctx.resolve || (() => null), labelOf = ctx.labelOf || (id => (App.compare.domain.metric(id) || {}).label || id);
    if (!ev || !EV) return Object.freeze({ empty: true, candidateCards: [], comparisonSections: [], safeHighlights: [], caveats: ['Comparação não disponível.'] });
    const ids = ev.candidateIds.slice(0, (ctx.policy || P.current()).maxComparisonLots), lots = ids.map(resolve), codeOf = id => { const l = lots[ids.indexOf(id)]; return l ? F.formatLotTitle(l.identity.blockId, l.identity.lotNumber) : null; };
    const hs = EV.highlights(ev, { audience: 'presentation' }), safeIds = new Set(hs.flatMap(h => h.metricIds.map(m => h.candidateId + '|' + m)));
    const phrase = (r, label) => String(r.phrase || ('destaque em ' + label)).replace('{label}', label);
    const safeHighlights = hs.flatMap(h => h.metricIds.map(m => { const r = ev.metricResults[m]; return Object.freeze({ lotLabel: codeOf(h.candidateId), text: `Destaque: ${phrase(r, labelOf(m).toLowerCase())} entre as opções comparadas.` }); }));
    const sections = ev.metricOrder.map(m => {
      const r = ev.metricResults[m], st = r.evaluationStatus;
      const isSafeWinner = (st === 'WINNER' || (st === 'TIE' && r.tieState === 'TOP_TIED')) && r.winnerCandidateIds.some(id => safeIds.has(id + '|' + m));
      const text = isSafeWinner ? `${r.winnerCandidateIds.map(codeOf).filter(Boolean).join(' e ')}: ${phrase(r, labelOf(m).toLowerCase())}` : st === 'WINNER' ? null : (W.comparison[st] || null);
      return Object.freeze({ criterion: labelOf(m), outcome: isSafeWinner ? 'HIGHLIGHT' : st === 'INSUFFICIENT_DATA' || st === 'SUPPRESSED' ? 'NO_DATA' : st === 'CONTEXT_REQUIRED' ? 'CONTEXT_REQUIRED' : 'NEUTRAL',
        text: text || (st === 'INSUFFICIENT_DATA' || st === 'SUPPRESSED' ? W.comparison.INSUFFICIENT_DATA : W.comparison.NO_CLEAR_WINNER) });
    });
    const caveats = []; if (ev.status === 'PARTIAL') caveats.push('Comparação parcial: alguns critérios não possuem dados para todas as opções.');
    if (lots.some(l => l && availability(l, ctx).state === 'STATUS_CONFIRMATION_REQUIRED')) caveats.push(W.availabilityCaveat);
    return Object.freeze({ empty: false, candidateCards: Object.freeze(lots.map(l => lotCard(l, ctx)).filter(Boolean)), comparisonSections: Object.freeze(sections), safeHighlights: Object.freeze(safeHighlights),
      caveats: Object.freeze(caveats), shortlistNavigation: ev.candidateIds.length > 4 });
  }

  // ---------------------------------------------------------------- Financial (FinancialSimulationResult; no recalculation)
  /** financial(sim, ctx) — sim = { result: services.finance.simulate(...) output, status: EXACT|PROJECTED|PARTIAL, id, version } */
  function financial(sim, ctx = {}) {
    if (!sim || !sim.result) return Object.freeze({ available: false, text: 'Simulação não disponível para esta opção.' });
    const r = sim.result, status = P.SimulationStatus[sim.status] ? sim.status : 'PARTIAL', projected = status === 'PROJECTED';
    const indexed = (r.plans || []).some(p => /IGP-?M/i.test(p.desc || ''));
    const plans = (r.plans || []).filter(p => !ctx.planIds || ctx.planIds.includes(p.id)).map(p => Object.freeze({ name: p.name, condition: p.desc || null,
      installments: `${p.main.count}x de ${F.formatBRL(p.main.value, true)}`, annual: p.annual ? `+ ${p.annualCount} anuais de ${F.formatBRL(p.annual, true)}` : null }));
    const caveats = [projected ? W.financial.installmentProjected : null, indexed ? W.financial.indexUnknown : null, 'Condições da tabela vigente; sujeitas a confirmação na proposta.'].filter(Boolean);
    return Object.freeze({ available: true, statusLabel: projected ? W.financial.PROJECTED : W.financial[status], statusText: projected ? W.financial.PROJECTED_TEXT : null,
      basePrice: Object.freeze({ label: W.price.label, text: F.formatBRL(r.price) }), downPayment: Object.freeze({ label: `Entrada (${F.number(r.downPaymentPct)}%)`, text: F.formatBRL(r.downPayment) }),
      plans: Object.freeze(plans), assumptions: Object.freeze([`Entrada de ${F.number(r.downPaymentPct)}% sobre o preço de tabela`, ...(ctx.assumptions || [])]), caveats: Object.freeze(caveats) });
  }

  // ---------------------------------------------------------------- Map (safe layers only; reuses the map layer registry)
  const SAFE_OVERLAYS = Object.freeze(['recommendation', 'comparison', 'references', 'selected', 'labels', 'hover', 'favorites']);
  function map(ctx = {}) {
    const reg = App.mapLayers && App.mapLayers.registry ? App.mapLayers.registry(ctx.developmentId) : null;
    const thematic = reg ? reg.primary : [];
    // a layer is client-safe only if the map registry already marks it client-visible AND its field is in the client allow-list (deny by default)
    const safeLayers = thematic.filter(l => l.clientVisible && (l.id === 'none' || (l.fieldKey && P.isAllowedPath(ctx.policy, l.fieldKey))) && !(l.requires || []).includes('requiresCustomerContext') && l.group !== 'INTELLIGENCE').map(l => l.id);
    const presented = (ctx.lots || []).filter(Boolean);
    return Object.freeze({ presentedLotRefs: Object.freeze(presented.map(l => l.identity.code)), comparisonLotRefs: Object.freeze((ctx.comparisonLots || []).filter(Boolean).map(l => l.identity.code)),
      recommendationLotRefs: Object.freeze((ctx.recommendationLots || []).filter(Boolean).map(l => l.identity.code)), safeLayers: Object.freeze(safeLayers.length ? safeLayers : ['availability', 'none']),
      safeOverlays: SAFE_OVERLAYS, baseModes: Object.freeze(['PLANT', 'AERIAL']), defaultLayer: ctx.showAvailability === false ? 'none' : 'availability',
      controls: Object.freeze(['ZOOM', 'PAN', 'SELECT_PRESENTED_LOT', 'SWITCH_BASE']), deniedControls: Object.freeze(['FILTER_BUILDER', 'RULE_DIAGNOSTICS', 'PROVENANCE_INSPECTOR', 'LAYER_ADMIN', 'TENANT_DEBUG']),
      textAlternative: Object.freeze(presented.map(l => `${F.formatLotTitle(l.identity.blockId, l.identity.lotNumber)} — ${availability(l, ctx).label}`)) });
  }

  // ---------------------------------------------------------------- Customer objective, development, next steps
  const OBJECTIVE = Object.freeze({ housing: 'Morar', investment: 'Investir', family: 'Morar com a família', premium: 'Morar com alto padrão' });
  const PRIORITY = Object.freeze({ quiet: 'silêncio', privacy: 'privacidade', solar: 'sol da manhã', leisure: 'proximidade do lazer', lowTraffic: 'rua tranquila', gate: 'proximidade da portaria', view: 'vista', area: 'área' });
  /** customerObjective(profile, ctx): only explicit, confirmed preferences (never inferred); budget omitted unless policy + config allow */
  function customerObjective(profile, ctx = {}) {
    if (!profile) return null;
    const prefs = (profile.preferences || []).filter(p => p.enabled !== false && (p.source == null || ['EXPLICIT', 'CONFIRMED', 'BROKER_CONFIRMED', 'CUSTOMER'].includes(p.source)) && PRIORITY[p.key]);
    const pol = ctx.policy || P.current();
    return Object.freeze({ objective: OBJECTIVE[profile.objective] ? `Objetivo: ${OBJECTIVE[profile.objective]}` : null, priorities: prefs.length ? `Prioridades: ${prefs.map(p => PRIORITY[p.key]).join(', ')}` : null,
      budget: pol.showCustomerBudget && ctx.showBudget && profile.budgetMax != null ? `Faixa de investimento: até ${F.formatBRL(profile.budgetMax)}` : null });
  }
  function developmentOverview(dev) {
    return dev ? Object.freeze({ name: dev.name, city: dev.city || null, legalName: dev.legalName || null }) : null;
  }
  const NEXT_STEP = Object.freeze({ VISIT: 'Visitar empreendimento', SELECT_LOT: 'Selecionar lote', UPDATE_SIMULATION: 'Atualizar simulação', CONFIRM_AVAILABILITY: 'Confirmar disponibilidade', TALK_TO_BROKER: 'Conversar com o corretor' });
  const nextSteps = items => Object.freeze((items && items.length ? items : ['VISIT', 'CONFIRM_AVAILABILITY', 'UPDATE_SIMULATION']).filter(k => NEXT_STEP[k]).map(k => NEXT_STEP[k]));
  /** investment context: R$/m² of the table, nominal; never ROI/valorização */
  function investmentContext(lots, ctx = {}) {
    const pt = ctx.priceTable;
    return Object.freeze({ items: Object.freeze((lots || []).filter(Boolean).map(l => { const p = price(l, ctx); return Object.freeze({ lotLabel: F.formatLotTitle(l.identity.blockId, l.identity.lotNumber), pricePerM2Text: p.pricePerM2Text, priceText: p.text, priceState: p.state }); })),
      tableLabel: pt ? `${pt.name} · ${F.formatDate(pt.version)}` : null, caveat: W.investment.caveat, historyLabel: ctx.priceHistoryText || null });
  }

  return Object.freeze({ availability, price, value, area, highlights, alerts, fitSummary, lotCard, lotDetails, recommendation, comparison, financial, map, customerObjective, developmentOverview, nextSteps, investmentContext,
    reasonText, NEXT_STEP, OBJECTIVE, PRIORITY, SAFE_OVERLAYS });
})();
