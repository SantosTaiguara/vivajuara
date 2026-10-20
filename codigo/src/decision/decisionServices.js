/* decision/decisionServices.js — topic 56: DecisionOrchestrator + read models (application layer).
   Orchestrates existing domains, never recalculates them:
     Recommendation/Fit  → App.recommendation.recommend (the same request state/selectors.js sends; or the selector's result as-is)
     Explanation         → App.explanation.explainLot (reasons and trade-offs derive from the SAME trace)
     Availability        → App.availability.offerability (UNKNOWN is never offerable → "sujeito a confirmação")
     Pricing             → lot.commercial (table price; provenance status shown)
     Financial           → App.services.finance.simulate (no formula here)
   Read models: DecisionCandidate · CommercialViability · FinancialCompatibility · DecisionExplanation · DecisionReadiness ·
   NextBestAction (suggest only, human confirms) · DecisionResolutionSuggestion · DecisionPortfolio · DecisionQualitySummary ·
   DecisionSummary · DecisionCapability · LiveCommercialOverlay · ReplacementSuggestion · client-safe projection · ViewModel (pt-BR).
   It must not: calculate prices, scores, availability or financial schedules; multiply Fit × confidence × freshness; boost lots. */
App.decision = App.decision || {};
App.decision.services = (() => {
  const D = () => App.decision.domain, F = () => App.fmt;
  const SEV = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const get = (lot, k) => App.model.get(lot, k), prov = (lot, k) => App.model.getFieldProvenance(lot, k);
  const statusLabel = s => (F().formatDataStatus(s || 'UNKNOWN') || '').toLowerCase();

  // ---------------------------------------------------------------- value formatting (from the field registry; never invents a value)
  function fmtField(fieldKey, v, devId) {
    const f = F();
    if (v == null) return f.ND;
    const d = App.model.field(fieldKey) || {}, fitPref = Object.values((App.fit.cfgOf(devId) || {}).preferences || {}).find(p => p.fieldKey === fieldKey);
    if (typeof v === 'boolean') return f.formatBool(v);
    if (d.unit === 'BRL') return f.formatBRL(v);
    if (d.unit === 'm²') return f.formatSquareMeters(v);
    if (d.unit === 'm') return f.formatMeters(v);
    if (d.enum) return App.i18n.t(d.enum, v, String(v));
    if (typeof v === 'number' && fitPref && fitPref.type === 'SCORE_PREFERENCE') return `${f.number(v, fitPref.scaleMax <= 10 ? 1 : 0)} de ${fitPref.scaleMax}`;
    if (typeof v === 'number') return f.number(v, Number.isInteger(v) ? 0 : 1);
    return String(v);
  }
  const fact = (lot, fieldKey, devId, label) => { const v = get(lot, fieldKey), p = prov(lot, fieldKey), d = App.model.field(fieldKey) || {}; return { fieldKey, label: label || d.label || fieldKey, value: v ?? null, text: fmtField(fieldKey, v, devId), dataStatus: v == null ? 'UNKNOWN' : p.status, statusText: v == null ? 'não disponível' : statusLabel(p.status) }; };

  // ---------------------------------------------------------------- engine call (parity with state/selectors.js)
  /** recommendationFor(context, env) → RecommendationResult, built with exactly the request the selectors build. null without preferences and constraints (as the selectors). */
  function recommendationFor(ctx, env) {
    const devId = ctx.developmentId, { profile, constraints } = D().engineInputs(ctx), fr = env.freshness || {};
    if (App.fit.isEmpty(profile) && !constraints.length) return null;
    return App.recommendation.recommend({ developmentId: devId, profile, constraints, lots: env.lots, scope: env.scope || null, policy: App.recommendation.policyOf(devId), fitCfg: App.fit.cfgOf(devId), availabilityPolicy: env.availabilityPolicy,
      commercialFreshness: fr.commercial && fr.commercial.status, availabilityFreshness: fr.availability && fr.availability.status, offline: !!env.offline, dataVersions: env.dataVersions || {}, generatedAt: null });
  }

  // ---------------------------------------------------------------- CommercialViability and FinancialCompatibility (consume, never compute)
  const priceFreshnessOf = fr => { const s = fr && fr.commercial && fr.commercial.status; return s === 'FRESH' ? 'CURRENT' : s === 'STALE' || s === 'EXPIRED' ? 'STALE' : 'UNKNOWN'; };
  const availabilityFreshnessOf = fr => { const s = fr && fr.availability && fr.availability.status; return s === 'FRESH' ? 'FRESH' : s === 'STALE' || s === 'EXPIRED' ? 'STALE' : 'UNKNOWN'; };
  function commercialViability(lot, env = {}) {
    const off = App.availability.offerability(lot, { policy: env.availabilityPolicy }), pf = priceFreshnessOf(env.freshness), pp = prov(lot, 'commercial.price');
    const status = off.offerability === 'OFFERABLE' ? 'READY_TO_OFFER' : off.offerability === 'NOT_OFFERABLE' ? 'NOT_OFFERABLE' : 'NEEDS_CONFIRMATION';
    const warnings = [...off.reasons]; if (pf !== 'CURRENT') warnings.push('PRICE_NOT_CURRENT'); if (lot.commercial.price == null) warnings.push('PRICE_NOT_AVAILABLE');
    return Object.freeze({ status, availabilityStatus: off.status, availabilityFreshness: off.freshness, offerability: off.offerability, priceStatus: lot.commercial.price == null ? 'UNKNOWN' : pp.status, priceFreshness: pf,
      paymentPlanAvailable: (lot.commercial.availablePlans || []).length > 0, warnings: Object.freeze(warnings), availabilityRevision: off.availabilityRevision });
  }
  /** FinancialCompatibility from App.services.finance.simulate (standard table scenario: default down payment of the table, every plan of the lot) */
  function financialCompatibility(lot, ctx, priceTable) {
    const b = ctx.budgetProfile || {}, dpCap = b.downPaymentCapacity ? b.downPaymentCapacity.maxMinor / 100 : null, moCap = b.monthlyPaymentCapacity ? b.monthlyPaymentCapacity.maxMinor / 100 : null;
    const price = lot.commercial.price, warnings = [];
    if (price == null || !priceTable) return Object.freeze({ status: 'UNKNOWN', warnings: Object.freeze([price == null ? 'PRICE_NOT_AVAILABLE' : 'PRICE_TABLE_NOT_AVAILABLE']), plans: Object.freeze([]) });
    const ids = lot.commercial.availablePlans || [], plans = (priceTable.plans || []).filter(p => !ids.length || ids.includes(p.id));
    const pct = lot.commercial.downPaymentDefaultPercent != null ? lot.commercial.downPaymentDefaultPercent : priceTable.downPaymentDefault != null ? priceTable.downPaymentDefault * 100 : null;
    if (pct == null) return Object.freeze({ status: 'UNKNOWN', warnings: Object.freeze(['DOWN_PAYMENT_NOT_DEFINED']), plans: Object.freeze([]) });
    const sim = App.services.finance.simulate({ price, downPaymentPct: pct, plans });
    const rows = sim.plans.map(p => Object.freeze({ id: p.id, name: p.name, kind: p.kind, monthly: p.main.value, months: p.main.count, annual: p.annual || 0, annualCount: p.annualCount || 0, total: p.total, desc: p.desc || null }));
    warnings.push('DOWN_PAYMENT_DEFAULT_TO_CONFIRM', 'NOMINAL_VALUES_NO_INDEXATION');
    const dpOk = dpCap == null ? undefined : sim.downPayment <= dpCap, compatible = rows.filter(p => moCap == null || p.monthly <= moCap), moOk = moCap == null ? undefined : compatible.length > 0;
    if (dpCap == null && moCap == null) warnings.push('CAPACITY_NOT_INFORMED');
    else { if (dpCap == null) warnings.push('DOWN_PAYMENT_CAPACITY_NOT_INFORMED'); if (moCap == null) warnings.push('MONTHLY_CAPACITY_NOT_INFORMED'); }
    const informed = [dpOk, moOk].filter(x => x !== undefined), status = !informed.length ? 'UNKNOWN' : informed.every(Boolean) ? 'COMPATIBLE' : informed.some(Boolean) ? 'PARTIALLY_COMPATIBLE' : 'INCOMPATIBLE';
    const best = informed.length && moOk !== false ? compatible.slice().sort((a, b2) => a.total - b2.total || a.id.localeCompare(b2.id))[0] : null;
    if (best && best.annualCount) warnings.push('PLAN_HAS_ANNUAL_PARCELS');
    return Object.freeze({ status, downPaymentCompatible: dpOk, monthlyPaymentCompatible: moOk, bestKnownPlanId: best ? best.id : undefined, downPayment: sim.downPayment, downPaymentPct: pct, compatiblePlanIds: Object.freeze(compatible.map(p => p.id)),
      plans: Object.freeze(rows), warnings: Object.freeze([...new Set(warnings)]), source: 'FINANCE_SERVICE_SIMULATION', priceTableVersion: priceTable.version || null });
  }

  // ---------------------------------------------------------------- reasons and trade-offs (from the explanation trace, never recalculated)
  const PREF_TRADEOFF_TYPE = { LOCATION: 'LOCATION_TRADEOFF' };
  function reasonsOf(x, lot, expl, ctx, crit) {
    const devId = ctx.developmentId, fitCfg = App.fit.cfgOf(devId), out = [];
    const bc = (x.constraintResults || []).find(c => c.key === 'budgetMax' && c.status === 'PASS');
    if (bc) out.push({ code: 'WITHIN_BUDGET', type: 'HARD_CONSTRAINT_PASS', labelKey: 'decision.reason.withinBudget', text: 'Dentro do orçamento informado', clientText: 'Dentro da faixa de investimento informada',
      supportingFacts: [`Preço de tabela ${F().formatBRL(bc.actualValue)} (limite ${F().formatBRL(bc.expectedValue)})`], dataStatus: prov(lot, 'commercial.price').status, stale: !!bc.stale });
    for (const f of expl.positiveFactors || []) {
      const d = fitCfg.preferences[f.preferenceKey] || {}, c = crit.get(f.preferenceKey);
      out.push({ code: App.reasonCodes.matchCode(f.preferenceKey), type: 'CUSTOMER_PREFERENCE_MATCH', labelKey: App.reasonCodes.matchCode(f.preferenceKey), text: d.label || f.preferenceKey, clientText: c && c.clientSafe === false || !d.label ? null : `${d.label}: ponto forte para o perfil informado`,
        supportingFacts: [`${fmtField(f.metricKey, f.actualValue, devId)} (${statusLabel(f.dataStatus)})`], dataStatus: f.dataStatus, contribution: f.contribution, importance: f.importance });
    }
    for (const c of x.constraintResults || []) {
      if (c.status !== 'PASS' || c.key === 'budgetMax') continue;
      const d = App.recommendation.policyOf(devId).constraints[c.key] || {};
      out.push({ code: 'MEETS_' + c.key.replace(/[A-Z]/g, m => '_' + m).toUpperCase(), type: 'HARD_CONSTRAINT_PASS', labelKey: 'constraint.' + c.key, text: `Atende: ${(d.label || c.key).toLowerCase()}`, clientText: null,
        supportingFacts: [fmtField(c.metricKey, c.actualValue, devId)], dataStatus: c.dataStatus });
    }
    return out;
  }
  function tradeoffsOf(x, lot, expl, ctx, viability, fin) {
    const devId = ctx.developmentId, fitCfg = App.fit.cfgOf(devId), RC = App.reasonCodes, out = [];
    for (const f of expl.negativeFactors || []) {
      const d = fitCfg.preferences[f.preferenceKey] || {}, cat = (D().criterionRegistry(devId).get(f.preferenceKey) || {}).category;
      out.push({ code: 'MISMATCH_' + f.preferenceKey, severity: f.importance === 'HIGH' ? 'HIGH' : f.importance === 'MEDIUM' ? 'MEDIUM' : 'LOW', type: PREF_TRADEOFF_TYPE[cat] || 'PREFERENCE_MISMATCH', explanationKey: 'TRADE_OFF',
        text: `${d.label || f.preferenceKey}: abaixo do desejado`, clientText: `${d.label || 'Critério'}: ponto de atenção`, supportingFacts: [`${fmtField(f.metricKey, f.actualValue, devId)} (${statusLabel(f.dataStatus)})`] });
    }
    if (viability.status === 'NOT_OFFERABLE') out.push({ code: 'NOT_OFFERABLE', severity: 'HIGH', type: 'COMMERCIAL_LIMITATION', explanationKey: 'STATUS_' + viability.availabilityStatus, text: `Situação atual: ${F().formatAvailability(viability.availabilityStatus).toLowerCase()}`, clientText: null, availability: true });
    else if (viability.status === 'NEEDS_CONFIRMATION') out.push({ code: 'AVAILABILITY_TO_CONFIRM', severity: 'MEDIUM', type: 'COMMERCIAL_LIMITATION', explanationKey: 'AVAILABILITY_UNKNOWN', text: 'Disponibilidade sujeita a confirmação com a loteadora', clientText: 'Disponibilidade a confirmar', availability: true });
    for (const code of x.reviewReasons || []) if (!['AVAILABILITY_UNKNOWN', 'STALE_AVAILABILITY'].includes(code))
      out.push({ code, severity: 'MEDIUM', type: 'DATA_UNCERTAINTY', explanationKey: code, text: (RC.label(code, 'broker') || 'Dado a confirmar').replace(/\.$/, ''), clientText: RC.visibleIn(code, 'client') ? (RC.label(code, 'client') || '').replace(/\.$/, '') || null : null });
    for (const code of x.warnings || []) out.push({ code, severity: 'LOW', type: 'DATA_UNCERTAINTY', explanationKey: code, text: (RC.label(code, 'broker') || 'Dado a confirmar').replace(/\.$/, ''), clientText: null });
    const notEval = (expl.dataQualityFactors || []).filter(f => f.reasonCode === 'PREFERENCE_NOT_EVALUATED' || f.reasonCode === 'PREFERENCE_FAILED').map(f => (fitCfg.preferences[f.preferenceKey] || {}).label || f.preferenceKey);
    if (notEval.length) out.push({ code: 'PREFERENCE_NOT_EVALUATED', severity: 'MEDIUM', type: 'DATA_UNCERTAINTY', explanationKey: 'PREFERENCE_NOT_EVALUATED', text: `Sem dado para avaliar: ${[...new Set(notEval)].join(', ').toLowerCase()}`, clientText: 'Parte das informações ainda não está disponível' });
    const est = (expl.dataQualityFactors || []).filter(f => f.reasonCode === 'ESTIMATED_INPUT').map(f => (fitCfg.preferences[f.preferenceKey] || {}).label || f.preferenceKey);
    if (est.length) out.push({ code: 'ESTIMATED_INPUTS', severity: 'LOW', type: 'DATA_UNCERTAINTY', explanationKey: 'ESTIMATED_INPUT', text: `Usa valores estimados em: ${[...new Set(est)].join(', ').toLowerCase()}`, clientText: 'Algumas características são estimativas' });
    if (fin.status === 'INCOMPATIBLE' || fin.status === 'PARTIALLY_COMPATIBLE') out.push({ code: 'FINANCIAL_' + fin.status, severity: fin.status === 'INCOMPATIBLE' ? 'HIGH' : 'MEDIUM', type: 'FINANCIAL_TRADEOFF', explanationKey: fin.status,
      text: fin.downPaymentCompatible === false ? 'Entrada padrão da tabela acima da capacidade informada' : 'Parcela das condições de tabela acima da capacidade informada', clientText: null });
    return out.sort((a, b) => SEV[b.severity] - SEV[a.severity] || 0);
  }
  function dataQualitySummary(x, expl) {
    const dq = expl.dataQualityFactors || [], est = dq.filter(f => f.reasonCode === 'ESTIMATED_INPUT').length, ne = dq.filter(f => f.reasonCode === 'PREFERENCE_NOT_EVALUATED' || f.reasonCode === 'PREFERENCE_FAILED').length;
    const pend = (x.reviewReasons || []).filter(c => c !== 'AVAILABILITY_UNKNOWN').length;
    const level = ne || pend ? 'PENDING_INFORMATION' : est ? 'SOME_ESTIMATED' : 'SUFFICIENT';
    return Object.freeze({ level, label: { SUFFICIENT: 'Dados suficientes', SOME_ESTIMATED: 'Alguns dados estimados', PENDING_INFORMATION: 'Informação pendente' }[level], estimatedInputs: est, notEvaluated: ne, pendingConstraints: pend, coverage: x.coverage ?? null, confidenceLevel: x.fitConfidence || 'UNKNOWN' });
  }
  function objectiveContext(lot, ctx, priceTable) {
    const devId = ctx.developmentId, f = F();
    if (ctx.objective === 'INVESTMENT') {
      const inst = (priceTable && priceTable.plans || []).filter(p => p.kind === 'INSTALLMENTS' && (!(lot.commercial.availablePlans || []).length || lot.commercial.availablePlans.includes(p.id)));
      return Object.freeze({ objective: 'INVESTMENT', title: 'Critérios de investimento informados', facts: Object.freeze([
        `Ticket: ${f.formatBRL(lot.commercial.price)} (preço de tabela)`, `Preço por m²: ${f.formatPricePerM2(lot.commercial.pricePerM2)} (tabela ${lot.commercial.priceTableVersion || 'vigente'})`,
        ...inst.map(p => `Condição de tabela: ${p.name} — ${p.desc || ''}`.replace(/ — $/, '')),
        'Variação de tabela não é promessa de valorização nem de retorno.']) });
    }
    if (ctx.objective === 'HOUSING') {
      const keys = ['environmental.privacyScore', 'environmental.noiseLevel', 'environmental.orientationRear', 'mobility.routeDistanceToLeisureM', 'surroundings.hasGreenRear'].filter(k => App.model.field(k));
      return Object.freeze({ objective: 'HOUSING', title: 'Para morar', facts: Object.freeze(keys.map(k => { const x = fact(lot, k, devId); return `${x.label}: ${x.text} (${x.statusText})`; })) });
    }
    return Object.freeze({ objective: 'UNDECIDED', title: 'Compatibilidade geral', facts: Object.freeze(['Objetivo ainda não definido: confirme se o cliente quer morar ou investir para destacar os critérios certos.']) });
  }

  // ---------------------------------------------------------------- DecisionCandidate
  function candidateOf(x, bucket, lot, rec, ctx, env, crit) {
    const pol = D().policyOf(ctx.developmentId), maxR = (pol.explanation || {}).maxReasons || 3, maxT = (pol.explanation || {}).maxTradeoffs || 2;
    const expl = App.explanation.explainLot(rec, x.lotId), viability = commercialViability(lot, env), fin = financialCompatibility(lot, ctx, env.priceTable);
    const reasons = reasonsOf(x, lot, expl, ctx, crit), tradeoffs = tradeoffsOf(x, lot, expl, ctx, viability, fin);
    const eligibility = bucket === 'RECOMMENDED' ? 'ELIGIBLE' : bucket === 'REVIEW' ? 'REVIEW_REQUIRED' : 'INELIGIBLE';
    return Object.freeze({ lotId: x.lotId, code: lot.identity.code, displayCode: lot.identity.displayCode, blockId: lot.identity.blockId, eligibility,
      recommendationRank: bucket === 'RECOMMENDED' ? x.rank : undefined, reviewRank: bucket === 'REVIEW' ? x.rank : undefined, tier: bucket === 'EXCLUDED' ? undefined : x.tier,
      fitScore: x.fitScore ?? undefined, fitCoverage: x.coverage ?? undefined, fitConfidence: x.confidence ?? undefined, fitConfidenceLevel: x.fitConfidence || 'UNKNOWN',
      primaryReviewReason: x.primaryReviewReason || undefined, reviewCategory: x.reviewCategory || undefined, exclusionReasonCode: bucket === 'EXCLUDED' ? x.reasonCode : undefined, exclusionStage: bucket === 'EXCLUDED' ? x.stage : undefined,
      keyReasons: Object.freeze(reasons.slice(0, maxR)), allReasons: Object.freeze(reasons), keyTradeoffs: Object.freeze(tradeoffs.filter(t => !t.availability).slice(0, maxT)), allTradeoffs: Object.freeze(tradeoffs),
      commercialSnapshot: Object.freeze({ price: lot.commercial.price ?? null, pricePerM2: lot.commercial.pricePerM2 ?? null, priceDataStatus: lot.commercial.price == null ? 'UNKNOWN' : prov(lot, 'commercial.price').status, priceTableVersion: lot.commercial.priceTableVersion || null,
        areaM2: lot.geometry.areaM2 ?? null, areaDataStatus: lot.geometry.areaM2 == null ? 'UNKNOWN' : prov(lot, 'geometry.areaM2').status, availabilityStatus: lot.availability.status, viability }),
      commercialViability: viability, financialCompatibility: fin, dataQualitySummary: dataQualitySummary(x, expl), objectiveContext: objectiveContext(lot, ctx, env.priceTable),
      explanationRef: Object.freeze({ standing: expl.standing, summaryReasonCodes: expl.summaryReasonCodes, versions: expl.versions }) });
  }
  /** explanation(candidate, result) → DecisionExplanation (why in, position, what is uncertain; version refs) */
  function explanation(c, result) {
    return Object.freeze({ lotId: c.lotId, recommendationRank: c.recommendationRank, reviewRank: c.reviewRank, positiveReasons: c.allReasons, tradeoffs: c.allTradeoffs,
      constraintSummary: c.allReasons.filter(r => r.type === 'HARD_CONSTRAINT_PASS').map(r => r.text), financialSummary: [finText(c.financialCompatibility)].filter(Boolean),
      uncertaintySummary: c.allTradeoffs.filter(t => t.type === 'DATA_UNCERTAINTY' || t.type === 'COMMERCIAL_LIMITATION').map(t => t.text), versionRefs: result.versionRefs });
  }

  // ---------------------------------------------------------------- readiness, next actions, resolution
  function readiness({ validation, candidates, shortlistIds, env, ctx, recPol }) {
    const blocking = [], warnings = [];
    if (validation.status === 'INVALID') blocking.push('INVALID_CONTEXT');
    if (validation.status === 'INSUFFICIENT_CONTEXT') blocking.push('INSUFFICIENT_CONTEXT');
    if (!blocking.length && !candidates.length) blocking.push('NO_CANDIDATES');
    const top = candidates.filter(c => shortlistIds.includes(c.lotId) && c.fitCoverage != null), cov = top.length ? top.reduce((a, c) => a + c.fitCoverage, 0) / top.length : null;
    const af = availabilityFreshnessOf(env.freshness), pf = priceFreshnessOf(env.freshness);
    const pend = candidates.filter(c => shortlistIds.includes(c.lotId) && c.commercialViability.status !== 'READY_TO_OFFER').length;
    if (af !== 'FRESH' || pend) warnings.push('AVAILABILITY_NEEDS_CONFIRMATION');
    if (pf !== 'CURRENT') warnings.push('PRICE_NOT_CURRENT');
    if (validation.profileCompleteness != null && validation.profileCompleteness < ((D().policyOf(ctx.developmentId).readiness || {}).minProfileCompleteness ?? 0.5)) warnings.push('PARTIAL_PROFILE');
    if (cov != null && cov < (recPol.minFitCoverage ?? 0.5)) warnings.push('LOW_DATA_COVERAGE');
    if (ctx.budgetProfile && ctx.budgetProfile.source === 'ESTIMATED') warnings.push('BUDGET_ESTIMATED');
    if (env.offline) warnings.push('OFFLINE');
    const status = blocking.length ? 'NOT_READY' : warnings.includes('LOW_DATA_COVERAGE') ? 'LOW' : warnings.length ? 'MEDIUM' : 'HIGH';
    return Object.freeze({ status, profileCompleteness: validation.profileCompleteness, dataCoverage: cov ?? undefined, availabilityFreshness: af, priceFreshness: pf, blockingIssues: Object.freeze(blocking), warnings: Object.freeze(warnings) });
  }
  const NBA_TEXT = { CONFIRM_BUDGET: 'Confirmar a faixa máxima de investimento do cliente', CONFIRM_PREFERENCE: 'Revisar critérios e exigências do cliente', COMPARE: 'Comparar os candidatos selecionados',
    SIMULATE: 'Simular as condições de pagamento dos finalistas', PREPARE_PRESENTATION: 'Preparar a apresentação com as opções selecionadas', REQUEST_STATUS_CONFIRMATION: 'Confirmar a disponibilidade com a loteadora antes de oferecer',
    SCHEDULE_VISIT: 'Agendar visita ao lote', SHARE_SHORTLIST: 'Compartilhar a seleção com o cliente', FOLLOW_UP: 'Fazer o acompanhamento com o cliente' };
  const NBA_ACT = { COMPARE: 'decCompareShortlist', PREPARE_PRESENTATION: 'decPresent', SIMULATE: 'decCompareShortlist', CONFIRM_BUDGET: 'openFind', CONFIRM_PREFERENCE: 'openFind' };
  function nba(actionType, reasonCodes, priority, ctx) {
    const ap = (D().policyOf(ctx.developmentId).actionPolicy || {})[actionType] || {};
    return Object.freeze({ code: 'NBA_' + actionType, actionType, reasonCodes: Object.freeze(reasonCodes), priority, requiresHumanConfirmation: true, automation: ap.automation || 'SUGGEST_ONLY', requiredPermission: ap.requiredPermission || undefined, text: NBA_TEXT[actionType], act: NBA_ACT[actionType] || null });
  }
  /** nextActions(...) → ordered NextBestAction list (the first is the primary). Never automatic: the broker decides. */
  function nextActions({ validation, candidates, shortlistIds, mode, progress = {}, ctx }) {
    const out = [], has = w => validation.warnings.includes(w), sl = candidates.filter(c => shortlistIds.includes(c.lotId));
    if (validation.status === 'INVALID') out.push(nba('CONFIRM_PREFERENCE', ['HARD_CONSTRAINT_CONFLICT'], 'HIGH', ctx));
    if (validation.status === 'INSUFFICIENT_CONTEXT') out.push(nba('CONFIRM_PREFERENCE', ['PROFILE_EMPTY'], 'HIGH', ctx));
    if (out.length) return out;
    if (has('BUDGET_NOT_INFORMED') || has('BUDGET_ESTIMATED') || has('BUDGET_NEEDS_CONFIRMATION')) out.push(nba('CONFIRM_BUDGET', [validation.warnings.find(w => w.startsWith('BUDGET_'))], mode === 'DISCOVER' ? 'MEDIUM' : 'HIGH', ctx));
    if (!candidates.length) { out.unshift(nba('CONFIRM_PREFERENCE', ['NO_ELIGIBLE_LOTS'], 'HIGH', ctx)); return out; }
    const needConf = sl.some(c => c.commercialViability.status !== 'READY_TO_OFFER');
    const conf = needConf ? nba('REQUEST_STATUS_CONFIRMATION', ['AVAILABILITY_NOT_CONFIRMED'], 'HIGH', ctx) : null;
    if (mode === 'DECIDE') { if (conf) out.push(conf); out.push(nba(progress.simulated ? 'PREPARE_PRESENTATION' : 'SIMULATE', [progress.simulated ? 'FINALISTS_DEFINED' : 'SHORTLIST_DEFINED'], 'MEDIUM', ctx)); }
    else {
      if (sl.length >= 2 && !progress.compared) out.push(nba('COMPARE', ['SHORTLIST_HAS_CANDIDATES'], mode === 'DISCOVER' ? 'MEDIUM' : 'HIGH', ctx));
      else if (sl.length >= 2 && !progress.simulated) out.push(nba('SIMULATE', ['SHORTLIST_DEFINED'], 'MEDIUM', ctx));
      else if (sl.length >= 1) out.push(nba('PREPARE_PRESENTATION', ['FINALISTS_DEFINED'], 'MEDIUM', ctx));
      if (conf) out.push(conf);
    }
    if ((progress.feedback || []).some(f => f.feedbackType === 'WANTS_VISIT')) out.push(nba('SCHEDULE_VISIT', ['CUSTOMER_WANTS_VISIT'], 'MEDIUM', ctx));
    return out;
  }
  const RESOLUTION_TEXT = { REVIEW_CONSTRAINTS: 'Revisar as exigências com o cliente', INCREASE_BUDGET: 'Conversar sobre a faixa de investimento', REDUCE_MIN_AREA: 'Conversar sobre a área mínima',
    WAIT_FOR_AVAILABILITY: 'Aguardar/obter a confirmação de disponibilidade', EXPLORE_OTHER_DEVELOPMENT: 'Considerar outro empreendimento', COLLECT_MORE_PROFILE_DATA: 'Completar o perfil do cliente' };
  /** resolutionSuggestions(rec, validation) — when nothing fits well. Never auto-relaxes: every item needs the user's confirmation. */
  function resolutionSuggestions(rec, validation, candidates) {
    const out = [], add = (code, reasons) => { if (!out.some(o => o.code === code)) out.push(Object.freeze({ code, reasonCodes: Object.freeze(reasons), requiresUserConfirmation: true, text: RESOLUTION_TEXT[code] })); };
    if (validation.status === 'INSUFFICIENT_CONTEXT' || validation.warnings.includes('PARTIAL_PROFILE')) add('COLLECT_MORE_PROFILE_DATA', ['PARTIAL_PROFILE']);
    if (!rec) return out;
    const ex = rec.exclusionSummary || {}, eligible = candidates.filter(c => c.eligibility === 'ELIGIBLE');
    if (!eligible.length) {
      if (ex.PRICE_ABOVE_MAX) add('INCREASE_BUDGET', ['PRICE_ABOVE_MAX']);
      if (ex.AREA_BELOW_MIN) add('REDUCE_MIN_AREA', ['AREA_BELOW_MIN']);
      if (candidates.some(c => c.eligibility === 'REVIEW_REQUIRED' && c.reviewCategory === 'AVAILABILITY') || ex.SOLD || ex.RESERVED || ex.BLOCKED) add('WAIT_FOR_AVAILABILITY', ['AVAILABILITY_NOT_CONFIRMED']);
      if (!candidates.length || ex.LOW_FIT || Object.keys(ex).some(k => !['PRICE_ABOVE_MAX', 'AREA_BELOW_MIN', 'SOLD', 'RESERVED', 'BLOCKED', 'IN_PROPOSAL', 'AVAILABILITY_UNKNOWN', 'STALE_AVAILABILITY'].includes(k))) add('REVIEW_CONSTRAINTS', ['NO_ELIGIBLE_LOTS']);
    }
    for (const c of rec.conflicts || []) add(c.code && c.code.startsWith('BUDGET') ? 'INCREASE_BUDGET' : 'REVIEW_CONSTRAINTS', [c.code]);
    return out;
  }
  /** suggested shortlist: eligible by analytical rank first; when none is eligible, review candidates of the allowed categories (labelled "sujeito a confirmação") */
  function suggestShortlist(cands, ctx) {
    const sp = D().policyOf(ctx.developmentId).shortlistPolicy || D().DEFAULT_POLICY.shortlistPolicy, n = sp.defaultSize;
    const el = cands.filter(c => c.eligibility === 'ELIGIBLE' && c.commercialViability.status !== 'NOT_OFFERABLE');
    let ids = el.slice(0, n).map(c => c.lotId);
    if (ids.length < n && sp.includeReviewWhenNoEligible) ids = [...ids, ...cands.filter(c => c.eligibility === 'REVIEW_REQUIRED' && (sp.reviewCategoriesAllowedInSuggestion || []).includes(c.reviewCategory)).slice(0, n - ids.length).map(c => c.lotId)];
    return ids;
  }
  function portfolio(cands, ids) {
    const sl = cands.filter(c => ids.includes(c.lotId)), prices = sl.map(c => c.commercialSnapshot.price).filter(v => v != null), blocks = new Set(sl.map(c => c.blockId));
    const dup = []; for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) { const a = sl[i], b = sl[j], aa = a.commercialSnapshot.areaM2, ba = b.commercialSnapshot.areaM2;
      if (a.blockId === b.blockId && aa != null && ba != null && Math.abs(aa - ba) / Math.max(aa, ba) <= 0.05 && a.fitScore != null && b.fitScore != null && Math.abs(a.fitScore - b.fitScore) <= 2) dup.push(`${a.displayCode} ≈ ${b.displayCode}`); }
    const gaps = []; if (sl.length && sl.every(c => c.commercialViability.status !== 'READY_TO_OFFER')) gaps.push('Nenhuma opção com disponibilidade confirmada');
    if (sl.length > 1 && blocks.size === 1) gaps.push('Todas as opções na mesma quadra');
    const types = new Set(sl.flatMap(c => c.keyTradeoffs.map(t => t.type)));
    return Object.freeze({ candidateIds: Object.freeze(ids.slice()), coverageSummary: Object.freeze({ budgetCoverage: prices.length ? (prices.length > 1 ? `${F().formatBRL(Math.min(...prices))} a ${F().formatBRL(Math.max(...prices))}` : F().formatBRL(prices[0])) : 'Preço não disponível',
      locationDiversity: `${blocks.size} ${blocks.size === 1 ? 'quadra' : 'quadras'}`, tradeoffDiversity: types.size ? `${types.size} tipo(s) de ponto de atenção` : 'Sem pontos de atenção relevantes' }), duplicatedProfiles: Object.freeze(dup), gaps: Object.freeze(gaps) });
  }

  // ---------------------------------------------------------------- DecisionOrchestrator
  /** orchestrate(input) → DecisionOrchestratorResult.
      input = { context, lots, recommendation? (the selector's result, consumed as-is), freshness, dataVersions, priceTable, availabilityPolicy, offline?, mode?, shortlist?, progress?, now? } */
  function orchestrate(input) {
    const t0 = Date.now(), ctx = input.context, devId = ctx.developmentId, recPol = App.recommendation.policyOf(devId), pol = D().policyOf(devId), mode = D().WorkspaceMode[input.mode] ? input.mode : 'DISCOVER';
    const env = { lots: input.lots || [], freshness: input.freshness || {}, dataVersions: input.dataVersions || {}, priceTable: input.priceTable || null, availabilityPolicy: input.availabilityPolicy, offline: !!input.offline, scope: input.scope || null };
    const validation = D().validate(ctx, { profileVersion: input.profileVersion }), warnings = [];
    let rec = null;
    if (validation.status !== 'INVALID' && validation.status !== 'INSUFFICIENT_CONTEXT') {
      const { profile } = D().engineInputs(ctx);
      if (input.recommendation && input.recommendation.customerProfileVersion === profile.profileVersion) rec = input.recommendation; // consumed as-is (QuickView/panel parity)
      else { if (input.recommendation) warnings.push('RESULT_CONTEXT_MISMATCH_RECOMPUTED'); rec = recommendationFor(ctx, env); }
    }
    const byId = new Map(env.lots.map(l => [l.identity.id, l])), crit = D().criterionRegistry(devId), cands = [];
    if (rec) {
      for (const x of rec.recommendations) { const l = byId.get(x.lotId); if (l) cands.push(candidateOf(x, 'RECOMMENDED', l, rec, ctx, env, crit)); }
      for (const x of rec.reviewCandidates) { const l = byId.get(x.lotId); if (l) cands.push(candidateOf(x, 'REVIEW', l, rec, ctx, env, crit)); }
    }
    // investment context: the lowest ticket among the listed options is a fact about this list (labelled as such), never a return claim
    let cs = cands;
    if (ctx.objective === 'INVESTMENT' && cands.length > 1) {
      const min = Math.min(...cands.map(c => c.commercialSnapshot.price).filter(v => v != null));
      const maxR = (pol.explanation || {}).maxReasons || 3;
      cs = cands.map(c => {
        if (c.commercialSnapshot.price !== min) return c;
        const r = Object.freeze({ code: 'LOWEST_TICKET_IN_LIST', type: 'CONTEXTUAL_ADVANTAGE', labelKey: 'decision.reason.lowestTicket', text: 'Menor ticket entre as opções listadas', clientText: 'Menor valor entre as opções analisadas', supportingFacts: [F().formatBRL(min)], dataStatus: prov(byId.get(c.lotId), 'commercial.price').status });
        return Object.freeze({ ...c, allReasons: Object.freeze([...c.allReasons, r]), keyReasons: Object.freeze(c.keyReasons.length < maxR ? [...c.keyReasons, r] : c.keyReasons) });
      });
    }
    const suggested = suggestShortlist(cs, ctx), shortlistIds = input.shortlist ? input.shortlist.orderedCandidateIds.slice() : suggested;
    const strong = cs.filter(c => c.fitScore != null && c.fitScore >= recPol.strongMatchFitScore), elig = cs.filter(c => c.eligibility === 'ELIGIBLE');
    const status = validation.status === 'INVALID' ? 'INVALID_CONTEXT' : validation.status === 'INSUFFICIENT_CONTEXT' ? 'INSUFFICIENT_CONTEXT' : !cs.length ? 'NO_ELIGIBLE_LOTS'
      : !strong.length ? 'NO_STRONG_MATCH' : elig.some(c => strong.includes(c)) ? 'CONFIRMED_OPTIONS' : 'OPTIONS_PENDING_CONFIRMATION';
    const rd = readiness({ validation, candidates: cs, shortlistIds, env, ctx, recPol }), actions = nextActions({ validation, candidates: cs, shortlistIds, mode, progress: input.progress, ctx });
    const dv = env.dataVersions, exByStage = {}; for (const e of (rec && rec.excluded) || []) exByStage[e.stage] = (exByStage[e.stage] || 0) + 1;
    const versionRefs = Object.freeze({ contextRef: ctx.contextRef, customerProfileVersionId: ctx.customerProfileVersionId || undefined, profileVersion: rec ? rec.customerProfileVersion : undefined, fitMethodologyVersion: ctx.fitMethodologyVersion,
      recommendationPolicyVersion: ctx.recommendationPolicyVersion, explanationPolicyVersion: (App.explanation.policyOf(devId) || {}).version, decisionPolicyVersion: pol.version,
      priceTableVersion: dv.priceTableVersion || undefined, availabilityRevision: dv.availabilityRevision != null ? String(dv.availabilityRevision) : undefined, analysisVersion: dv.analysisVersion || undefined, staticVersion: dv.staticVersion || undefined });
    const modeN = ((pol.workspaceModes || {})[mode] || {}).candidates || 10;
    const quality = Object.freeze({ profileCompleteness: validation.profileCompleteness, eligibleCandidateCount: elig.length, reviewRequiredCount: rec ? rec.reviewRequiredCount : 0,
      averageFitCoverage: cs.length && cs.some(c => c.fitCoverage != null) ? cs.filter(c => c.fitCoverage != null).reduce((a, c) => a + c.fitCoverage, 0) / cs.filter(c => c.fitCoverage != null).length : undefined,
      staleCommercialCandidateCount: cs.filter(c => c.commercialViability.priceFreshness === 'STALE' || c.commercialViability.availabilityFreshness === 'STALE').length,
      unresolvedConflictCount: (rec && rec.conflicts || []).length, brokerOverrideCount: input.shortlist ? (input.shortlist.overrides || []).length : 0 });
    return Object.freeze({ recommendationResultId: rec ? rec.requestId : undefined, status, developmentId: devId, objective: ctx.objective, workspaceMode: mode,
      candidateSummaries: Object.freeze(cs), modeCandidateIds: Object.freeze(cs.slice(0, modeN).map(c => c.lotId)), suggestedShortlistIds: Object.freeze(suggested), shortlistIds: Object.freeze(shortlistIds),
      nextBestAction: actions[0], nextActions: Object.freeze(actions), readiness: rd, validation, resolutionSuggestions: Object.freeze(resolutionSuggestions(rec, validation, cs)),
      counts: Object.freeze({ eligible: elig.length, review: rec ? rec.reviewRequiredCount : 0, reviewListed: cs.filter(c => c.eligibility === 'REVIEW_REQUIRED').length, excluded: rec ? rec.ineligibleCount : 0, strong: strong.length }),
      exclusions: Object.freeze({ total: rec ? (rec.excluded || []).length : 0, byReason: Object.freeze({ ...((rec && rec.exclusionSummary) || {}) }), byStage: Object.freeze(exByStage) }),
      portfolio: portfolio(cs, shortlistIds), quality, versionRefs, warnings: Object.freeze([...warnings, ...((rec && rec.warnings) || [])]), engineResult: rec, durationMs: Date.now() - t0, generatedAt: nowIso(input.now) });
  }
  /** forLot(result, lotId, env) → DecisionCandidate for a lot in the result, or an INELIGIBLE candidate built from its ExcludedLotDetail (for override warnings / QuickView). null when unknown. */
  function forLot(result, lotId, env = {}) {
    const c = result.candidateSummaries.find(x => x.lotId === lotId); if (c) return c;
    const rec = result.engineResult, e = rec && (rec.excluded || []).find(x => x.lotId === lotId), lot = (env.lots || []).find(l => l.identity.id === lotId) || (env.getLot && env.getLot(lotId));
    if (!e || !lot) return null;
    const ctx = env.context, crit = D().criterionRegistry(result.developmentId);
    return candidateOf({ ...e, rank: null, tier: null, reviewReasons: [], warnings: e.warnings || [] }, 'EXCLUDED', lot, rec, ctx, { ...env, priceTable: env.priceTable || null }, crit);
  }

  // ---------------------------------------------------------------- QuickView block, map overlay, live overlay, replacement
  /** quickViewBlock(result, lotId, mode) → "Para este cliente" lines, from the existing result (no recalculation); null without a decision */
  function quickViewBlock(result, lotId, mode = 'broker') {
    if (!result) return null;
    const c = result.candidateSummaries.find(x => x.lotId === lotId), client = mode === 'client', lines = [];
    if (!c) { const ex = result.engineResult && (result.engineResult.excluded || []).find(x => x.lotId === lotId); if (ex && !client) lines.push((App.reasonCodes.label(ex.reasonCode, 'broker') || 'Fora da recomendação').replace(/\.$/, '')); return lines.length ? Object.freeze({ title: 'Para este cliente', lines: Object.freeze(lines) }) : null; }
    if (!client && c.fitScore != null) lines.push(`Compatibilidade: ${c.fitScore >= 70 ? 'alta' : c.fitScore >= 50 ? 'média' : 'baixa'} (${Math.round(c.fitScore)}%)`);
    lines.push(c.eligibility === 'ELIGIBLE' ? `Recomendação: ${c.recommendationRank}º` : `Recomendação sujeita a confirmação (${c.reviewRank}º para revisar)`);
    for (const r of c.keyReasons) { const t = client ? r.clientText : r.text; if (t) lines.push(t); }
    const t = c.keyTradeoffs[0]; if (t && (!client || t.clientText)) lines.push('Atenção: ' + (client ? t.clientText : t.text).replace(/^./, s => s.toLowerCase()));
    return Object.freeze({ title: 'Para este cliente', lines: Object.freeze(lines) });
  }
  /** mapOverlay(result) → recommendation overlay groups (its own semantics; the Availability layer is untouched) */
  function mapOverlay(result) {
    const g = { PRIMARY: [], STRONG_MATCH: [], ALTERNATIVE: [], REVIEW_REQUIRED: [] };
    for (const c of (result && result.candidateSummaries) || []) if (c.tier && g[c.tier]) g[c.tier].push(c.lotId);
    return Object.freeze({ groups: Object.freeze(g), shortlistIds: Object.freeze(((result && result.shortlistIds) || []).slice()), replacesAvailabilityLayer: false });
  }
  const STATUS_MSG = { SOLD: 'atualmente vendido', RESERVED: 'atualmente reservado', BLOCKED: 'atualmente bloqueado', PROPOSAL: 'atualmente em proposta', UNAVAILABLE: 'atualmente indisponível' };
  /** liveOverlay(shortlist, getLot, env) → current commercial state over a historical shortlist; never mutates the shortlist or the old result */
  function liveOverlay(shortlist, getLot, env = {}, ctx = null) {
    return Object.freeze((shortlist ? shortlist.orderedCandidateIds : []).map(id => {
      const lot = getLot(id); if (!lot) return Object.freeze({ lotId: id, status: 'UNKNOWN', viability: 'NEEDS_CONFIRMATION', changed: true, message: 'Lote não encontrado nos dados atuais' });
      const v = commercialViability(lot, env), bm = ctx ? D().budgetMaxOf(ctx) : null, over = bm != null && lot.commercial.price != null && lot.commercial.price > bm;
      const msg = v.status === 'NOT_OFFERABLE' ? `Recomendado anteriormente — ${STATUS_MSG[v.availabilityStatus] || 'atualmente indisponível'}` : over ? 'Preço atual acima do orçamento informado' : v.status === 'NEEDS_CONFIRMATION' ? 'Disponibilidade sujeita a confirmação' : null;
      return Object.freeze({ lotId: id, status: v.availabilityStatus, viability: v.status, overBudgetNow: over, changed: v.status === 'NOT_OFFERABLE' || over, message: msg });
    }));
  }
  /** replacementSuggestions(shortlist, overlay, currentResult) → ReplacementSuggestion[] PENDING (the broker confirms) */
  function replacementSuggestions(shortlist, overlay, result, opts = {}) {
    const used = new Set(shortlist.orderedCandidateIds), pool = result.candidateSummaries.filter(c => !used.has(c.lotId) && c.commercialViability.status !== 'NOT_OFFERABLE' && (c.eligibility === 'ELIGIBLE' || c.reviewCategory === 'AVAILABILITY')), out = [];
    for (const o of overlay) if (o.viability === 'NOT_OFFERABLE' || o.overBudgetNow) { const r = pool.shift(); if (!r) break; out.push(Object.freeze({ replacedLotId: o.lotId, replacementLotId: r.lotId, reasonCode: o.overBudgetNow ? 'PRICE_ABOVE_MAX_NOW' : 'LOT_' + o.status, recommendationRank: r.recommendationRank, reviewRank: r.reviewRank, generatedAt: nowIso(opts.now), status: 'PENDING', requiresBrokerConfirmation: true })); }
    return Object.freeze(out);
  }

  // ---------------------------------------------------------------- summary, capabilities, comparison/presentation inputs
  function summary(session, result, shortlist, opts = {}) {
    return Object.freeze({ decisionSessionId: session ? session.id : undefined, customerDisplayName: opts.customerDisplayName || undefined, objective: result.objective, readiness: result.readiness,
      recommendationCount: result.candidateSummaries.length, shortlistCount: shortlist ? shortlist.candidates.length : result.suggestedShortlistIds.length, comparedCount: opts.comparedCount || 0, simulationsCount: opts.simulationsCount || 0,
      topCandidateIds: Object.freeze(result.candidateSummaries.slice(0, 3).map(c => c.lotId)), nextBestAction: result.nextBestAction, lastUpdatedAt: (session && session.updatedAt) || result.generatedAt });
  }
  /** capabilities({ online, tenant, developmentId, shortlistCount }) → DecisionCapability[] (semantic preconditions; final = capability AND permission) */
  function capabilities({ online = true, tenant = null, developmentId, shortlistCount = 0 } = {}) {
    const can = k => D().can(tenant, k, developmentId), C = (action, allowed, reasonCodes, requiresOnline) => Object.freeze({ action, allowed: !!allowed, reasonCodes: Object.freeze(reasonCodes), ...(requiresOnline ? { requiresOnline: true } : {}) });
    return Object.freeze([
      C('EXPLORE', true, []), C('RECOMMEND', can('decision.read'), can('decision.read') ? [] : ['PERMISSION_DENIED']),
      C('SHORTLIST', can('decision.update'), can('decision.update') ? [] : ['PERMISSION_DENIED']), C('COMPARE', shortlistCount >= 2, shortlistCount >= 2 ? [] : ['NEEDS_TWO_CANDIDATES']),
      C('SIMULATE', true, ['SIMULATION_CONSULTATIVE']), C('PRESENT', shortlistCount >= 1, shortlistCount >= 1 ? ['PRESENTATION_USES_SNAPSHOT'] : ['EMPTY_SHORTLIST']),
      C('SHARE', online && can('decision.share'), [...(online ? [] : ['OFFLINE']), ...(can('decision.share') ? [] : ['REQUIRES_SERVER_AND_PERMISSION'])], true),
      C('RESERVE_OR_PROPOSAL', false, ['NOT_DECISION_DOMAIN', 'REQUIRES_HUMAN_CONFIRMATION', 'READ_ONLY_NO_AUTHORITATIVE_BACKEND'], true)]);
  }
  /** comparisonContext(session, result, shortlist) → DecisionComparisonContext (highlights the customer's criteria; nothing is hidden) */
  function comparisonContext(session, result, ctx) {
    return Object.freeze({ decisionSessionId: session ? session.id : undefined, customerProfileVersionId: ctx.customerProfileVersionId, highlightedCriterionIds: Object.freeze([...ctx.preferences.map(p => p.key), ...ctx.constraints.map(c => c.key)]), versionRefs: result.versionRefs,
      lotIds: Object.freeze(result.shortlistIds.slice(0, 4)) });
  }
  /** presentationInput(shortlist|ids) → input for App.presentationMode.domain.fromFavorites (snapshot is taken by the presentation domain; never the live ranking) */
  const presentationInput = (sl, title = 'Opções selecionadas') => Object.freeze({ collection: Object.freeze({ id: 'dec-' + (sl.id || 'suggested'), lotIds: Object.freeze((sl.orderedCandidateIds || sl).slice()) }), title });

  // ---------------------------------------------------------------- client-safe projection
  /** clientSafe(result, { ids, getLot, shortlist }) → plain facts only: no score, no codes, no notes, no budget, no customer data; availability never "confirmada" unless offerable */
  function clientSafe(result, opts = {}) {
    const pol = D().policyOf(result.developmentId).clientSafe || {}, ids = opts.ids || result.shortlistIds, slc = new Map(((opts.shortlist && opts.shortlist.candidates) || []).map(c => [c.lotId, c]));
    const items = ids.map(id => {
      const c = result.candidateSummaries.find(x => x.lotId === id) || (opts.candidates || []).find(x => x.lotId === id); if (!c) return null;
      const sc = slc.get(id), breach = sc && (sc.constraintBreaches || []).length;
      return { lot: c.displayCode, area: c.commercialSnapshot.areaM2 == null ? 'Área não disponível' : F().formatSquareMeters(c.commercialSnapshot.areaM2), price: c.commercialSnapshot.price == null ? 'Preço não disponível' : `${F().formatBRL(c.commercialSnapshot.price)} (preço de tabela)`,
        availability: c.commercialViability.status === 'READY_TO_OFFER' ? 'Disponível' : c.commercialViability.status === 'NOT_OFFERABLE' ? 'Indisponível no momento' : 'Disponibilidade a confirmar',
        highlights: c.keyReasons.map(r => r.clientText).filter(Boolean), attention: (c.keyTradeoffs.find(t => t.clientText) || {}).clientText || null,
        note: breach && pol.showOutOfConstraintNote ? 'Esta opção está fora de um dos critérios inicialmente informados, mas foi incluída como alternativa.' : null };
    }).filter(Boolean);
    const obj = { HOUSING: 'Opções selecionadas para morar', INVESTMENT: 'Opções com maior aderência aos critérios de investimento informados', UNDECIDED: 'Opções selecionadas para você' }[result.objective] || 'Opções selecionadas para você';
    const out = { title: obj, items, footer: ['Preços de tabela; condições e disponibilidade sujeitas a confirmação.', 'Características marcadas como estimadas vêm da análise do empreendimento, não de medição.'] };
    const issues = App.presentationMode && App.presentationMode.policy && App.presentationMode.policy.scanPayload ? App.presentationMode.policy.scanPayload(out) : [];
    return D().deepFreeze({ ...out, safety: { issues } });
  }

  // ---------------------------------------------------------------- view model (pt-BR text; markup is in decisionView.js)
  const READINESS_LABEL = { HIGH: 'Pronto para apresentar', MEDIUM: 'Pronto, com pontos a confirmar', LOW: 'Poucos dados para decidir', NOT_READY: 'Ainda não é possível recomendar' };
  const READINESS_ITEM = { AVAILABILITY_NEEDS_CONFIRMATION: 'Disponibilidade sujeita a confirmação', PRICE_NOT_CURRENT: 'Preço não confirmado nesta sessão', PARTIAL_PROFILE: 'Recomendação baseada em perfil parcial',
    LOW_DATA_COVERAGE: 'Poucos critérios do perfil puderam ser avaliados', BUDGET_ESTIMATED: 'Orçamento estimado (não declarado)', OFFLINE: 'Sem conexão: situação comercial pode ter mudado', INVALID_CONTEXT: 'Exigências em conflito', INSUFFICIENT_CONTEXT: 'Perfil vazio', NO_CANDIDATES: 'Nenhum lote atende aos critérios' };
  const VALIDATION_TEXT = { OBJECTIVE_NOT_INFORMED: 'Objetivo (morar ou investir) não informado', OBJECTIVE_UNDECIDED: 'Cliente ainda não decidiu entre morar e investir', BUDGET_NOT_INFORMED: 'Orçamento não informado',
    BUDGET_ESTIMATED: 'Orçamento estimado: confirme com o cliente', BUDGET_NEEDS_CONFIRMATION: 'Orçamento registrado pelo corretor, a confirmar', NO_PREFERENCES: 'Sem prioridades: a ordem usa apenas as exigências', AD_HOC_PROFILE: 'Atendimento sem cliente cadastrado (perfil temporário)',
    PARTIAL_PROFILE: 'Perfil parcial', CONTRADICTORY_PREFERENCES: 'Prioridades difíceis de atender juntas', PROFILE_TRADEOFF: 'Prioridades que competem entre si', PREFERENCE_NOT_SATISFIABLE: 'Uma prioridade não é atendida por nenhum lote' };
  const STATUS_VIEW = {
    CONFIRMED_OPTIONS: ['Principal recomendação para este contexto', 'Opções com melhor compatibilidade com o perfil informado.'],
    OPTIONS_PENDING_CONFIRMATION: ['Opções compatíveis, sujeitas a confirmação', 'Nenhum lote tem disponibilidade confirmada agora: as opções abaixo combinam com o perfil, mas precisam de confirmação antes de serem oferecidas.'],
    NO_STRONG_MATCH: ['Nenhuma opção atende bem aos critérios atuais', 'Há alternativas, mas nenhuma com forte aderência. Nenhum critério foi afrouxado automaticamente.'],
    NO_ELIGIBLE_LOTS: ['Nenhum lote atende aos critérios', 'Revise as exigências com o cliente. Nada é relaxado automaticamente.'],
    INSUFFICIENT_CONTEXT: ['Conte o que o cliente procura', 'Escolha prioridades ou exigências (objetivo, orçamento, área, privacidade, lazer…) para ver o que mostrar primeiro.'],
    INVALID_CONTEXT: ['Exigências em conflito', 'Revise as exigências (por exemplo, área mínima maior que a máxima).'] };
  const FIN_TEXT = { COMPATIBLE: 'Condições de tabela compatíveis com a capacidade informada', PARTIALLY_COMPATIBLE: 'Parcialmente compatível com a capacidade informada', INCOMPATIBLE: 'Condições de tabela acima da capacidade informada' };
  function finText(fin) {
    if (!fin) return null;
    if (fin.status === 'UNKNOWN') return fin.warnings.includes('CAPACITY_NOT_INFORMED') && fin.downPayment != null ? `Entrada padrão da tabela: ${F().formatBRL(fin.downPayment)} (${F().number(fin.downPaymentPct)}%, a confirmar). Informe entrada e parcela do cliente para checar a compatibilidade.` : 'Compatibilidade financeira não avaliada.';
    const best = fin.plans.find(p => p.id === fin.bestKnownPlanId);
    return `${FIN_TEXT[fin.status]}${best ? ` · ${best.name}: ${best.months}x de ${F().formatBRL(best.monthly)}${best.annualCount ? ' + anuais' : ''} (calculado, sem correção)` : ''}.`;
  }
  /** viewModel(result, { mode, shortlist, customerLabel, favoriteIds, comparisonIds }) → everything decisionView.js prints */
  function viewModel(result, opts = {}) {
    const client = opts.mode === 'client', pol = D().policyOf(result.developmentId), ctx = opts.context || null;
    const inSl = new Set(result.shortlistIds), favs = new Set(opts.favoriteIds || []), cmp = new Set(opts.comparisonIds || []);
    const [title, text] = STATUS_VIEW[result.status] || ['Decisão', ''];
    const bm = ctx ? D().budgetMaxOf(ctx) : null;
    const header = { title: 'O que mostrar a este cliente — e por quê', customerLabel: opts.customerLabel || 'Atendimento atual', objective: (pol.objectiveLabels || {})[result.objective] || result.objective,
      budget: client || !pol || bm == null ? null : `Orçamento: até ${F().formatBRL(bm)} (${{ CUSTOMER_DECLARED: 'declarado pelo cliente', BROKER_RECORDED: 'registrado pelo corretor', ESTIMATED: 'estimado' }[ctx.budgetProfile.source] || 'origem não informada'})`,
      modes: Object.keys(pol.workspaceModes || {}).map(id => ({ id, label: pol.workspaceModes[id].label || id, active: id === result.workspaceMode })) };
    const showIds = result.workspaceMode === 'DISCOVER' || result.workspaceMode === 'SHORTLIST' ? [...new Set([...(result.workspaceMode === 'SHORTLIST' ? result.shortlistIds : []), ...result.modeCandidateIds, ...result.shortlistIds])] : result.shortlistIds;
    const cards = showIds.map(id => result.candidateSummaries.find(c => c.lotId === id) || (opts.extraCandidates || []).find(c => c.lotId === id)).filter(Boolean).map(c => {
      const sc = opts.shortlist && opts.shortlist.candidates.find(x => x.lotId === c.lotId);
      return { lotId: c.lotId, code: c.displayCode,
        position: c.eligibility === 'ELIGIBLE' ? `${c.recommendationRank}ª recomendação` : c.eligibility === 'REVIEW_REQUIRED' ? `${c.reviewRank}º para revisar` : 'Fora dos critérios',
        curated: sc && sc.addedBy !== 'SYSTEM' ? `Incluído pelo ${sc.addedBy === 'CUSTOMER' ? 'cliente' : 'corretor'}${sc.reasonCode ? ' · ' + ((pol.overrideReasonLabels || {})[sc.reasonCode] || sc.reasonCode) : ''}` : null,
        breach: sc && (sc.constraintBreaches || []).length ? 'Não atende a todos os critérios informados (mantido visível)' : null,
        tier: c.eligibility === 'REVIEW_REQUIRED' ? 'Sujeito a confirmação' : { PRIMARY: 'Principal recomendação', STRONG_MATCH: 'Forte aderência', ALTERNATIVE: 'Alternativa' }[c.tier] || null,
        price: c.commercialSnapshot.price == null ? 'Preço não disponível' : `${F().formatBRL(c.commercialSnapshot.price)} · preço de tabela`, area: c.commercialSnapshot.areaM2 == null ? 'Área não disponível' : F().formatSquareMeters(c.commercialSnapshot.areaM2),
        availability: c.commercialViability.status === 'READY_TO_OFFER' ? 'Disponível (confirmado)' : c.commercialViability.status === 'NOT_OFFERABLE' ? F().formatAvailability(c.commercialViability.availabilityStatus) : 'Disponibilidade sujeita a confirmação',
        availabilityTone: c.commercialViability.status === 'READY_TO_OFFER' ? 'ok' : 'warn',
        fit: client || c.fitScore == null ? null : `Compatibilidade ${Math.round(c.fitScore)}% · ${Math.round((c.fitCoverage ?? 0) * 100)}% dos critérios avaliados`,
        reasons: c.keyReasons.map(r => ({ text: client ? r.clientText : r.text, facts: client ? [] : r.supportingFacts })).filter(r => r.text),
        tradeoffs: c.keyTradeoffs.map(t => ({ text: client ? t.clientText : t.text, severity: t.severity })).filter(t => t.text),
        financial: client ? null : finText(c.financialCompatibility), dataQuality: c.dataQualitySummary.label, objective: client ? null : c.objectiveContext,
        inShortlist: inSl.has(c.lotId), favorite: favs.has(c.lotId), compared: cmp.has(c.lotId) };
    });
    const ex = Object.entries(result.exclusions.byReason).filter(([, n]) => n).map(([k, n]) => `${F().number(n)} · ${(App.reasonCodes.label(k, 'broker') || k).replace(/\.$/, '')}`);
    const rd = result.readiness;
    return D().deepFreeze({ mode: client ? 'client' : 'broker', header, status: { code: result.status, title, text }, validation: client ? [] : result.validation.warnings.map(w => VALIDATION_TEXT[w]).filter(Boolean),
      readiness: { status: rd.status, label: READINESS_LABEL[rd.status], items: [...rd.blockingIssues, ...rd.warnings].map(w => READINESS_ITEM[w]).filter(Boolean) },
      nextAction: result.nextBestAction ? { text: result.nextBestAction.text, act: result.nextBestAction.act, actionType: result.nextBestAction.actionType, priority: result.nextBestAction.priority } : null,
      otherActions: result.nextActions.slice(1).map(a => ({ text: a.text, act: a.act, actionType: a.actionType })),
      cards, shortlist: { count: result.shortlistIds.length, max: (pol.shortlistPolicy || {}).maxSize || 5, source: opts.shortlist ? opts.shortlist.source : 'RECOMMENDATION', ids: result.shortlistIds.slice(), portfolio: client ? null : result.portfolio },
      resolution: result.resolutionSuggestions.map(r => r.text), exclusions: client ? [] : ex, counts: result.counts,
      caveats: ['Compatibilidade mede só a aderência ao perfil informado: não prevê compra nem valorização.', 'Preços são de tabela; disponibilidade e condições precisam de confirmação antes de qualquer oferta.', 'Nada é reservado, enviado ou proposto automaticamente.'] });
  }
  /** analyticsPayload(name, result) → aggregate-only event payload (no profile, no budget, no customer id, no notes) */
  const analyticsPayload = (result, extra = {}) => Object.freeze({ status: result.status, mode: result.workspaceMode, objective: result.objective, eligible: result.counts.eligible, review: result.counts.reviewListed, shortlist: result.shortlistIds.length, readiness: result.readiness.status, ...extra });

  return Object.freeze({ recommendationFor, commercialViability, financialCompatibility, candidateOf, explanation, readiness, nextActions, resolutionSuggestions, suggestShortlist, portfolio, orchestrate, forLot,
    quickViewBlock, mapOverlay, liveOverlay, replacementSuggestions, summary, capabilities, comparisonContext, presentationInput, clientSafe, viewModel, finText, analyticsPayload, fmtField });
})();
