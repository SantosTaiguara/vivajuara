/* decision/decisionDomain.js — topic 56: customer-oriented commercial decision (domain layer).
   "Qual lote devo mostrar a este cliente — e por quê?" This is NOT a new recommendation engine: it builds the
   CustomerDecisionContext (a projection, never the Customer), validates it, turns it into the SAME engine inputs the
   panel already uses (App.fit.buildProfile + App.recommendation.constraint, unchanged) and owns only what is new:
   DecisionSession · Shortlist (curated order ≠ analytical rank) · BrokerDecisionOverride · CustomerDecisionFeedback ·
   PreferenceSuggestion (never auto-applied) · DecisionHistoryEvent / transitions · DecisionSessionSnapshot · currentness.

   Rules: works with and without a persisted Customer (ad-hoc profile from the current panel state, never turned into a
   Customer). Objective is explicit (UNDECIDED is valid, never guessed). Estimated budget stays ESTIMATED. Unknown is never
   a pass. Memory-only repository (CONFIDENTIAL; no localStorage, no URL, no PII in logs/events). Deny by default. */
App.decision = App.decision || {};
App.decision.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const Objective = E('HOUSING', 'INVESTMENT', 'UNDECIDED');
  const BudgetSource = E('CUSTOMER_DECLARED', 'BROKER_RECORDED', 'ESTIMATED', 'UNKNOWN');
  const ConstraintOrigin = E('CUSTOMER_EXPLICIT', 'BROKER_CONFIRMED', 'SYSTEM_POLICY', 'IMPORTED_CONFIRMED');
  const ValidationStatus = E('READY', 'READY_WITH_WARNINGS', 'INSUFFICIENT_CONTEXT', 'INVALID');
  const Eligibility = E('ELIGIBLE', 'INELIGIBLE', 'REVIEW_REQUIRED');
  const Tier = E('PRIMARY', 'STRONG_MATCH', 'ALTERNATIVE', 'REVIEW_REQUIRED');
  const SessionStatus = E('DRAFT', 'ACTIVE', 'SHORTLIST_READY', 'PRESENTED', 'CLOSED', 'ARCHIVED');
  const WorkspaceMode = E('DISCOVER', 'SHORTLIST', 'COMPARE', 'DECIDE');
  const DecisionStage = E('EXPLORING', 'QUALIFYING', 'SHORTLISTING', 'COMPARING', 'NEGOTIATING', 'UNKNOWN');
  const Timing = E('IMMEDIATE', 'SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM', 'UNKNOWN');
  const Level3 = E('LOW', 'MEDIUM', 'HIGH');
  const ShortlistSource = E('RECOMMENDATION', 'BROKER_CURATED', 'CUSTOMER_SELECTED', 'MIXED');
  const AddedBy = E('SYSTEM', 'BROKER', 'CUSTOMER');
  const OverrideAction = E('PROMOTE_TO_SHORTLIST', 'REMOVE_FROM_SHORTLIST', 'REORDER', 'MARK_FOR_REVIEW');
  const FeedbackType = E('LIKED', 'DISLIKED', 'TOO_EXPENSIVE', 'LOCATION_NOT_PREFERRED', 'SIZE_NOT_PREFERRED', 'PAYMENT_NOT_PREFERRED', 'NEEDS_MORE_INFO', 'WANTS_VISIT', 'WANTS_SIMULATION', 'OTHER');
  const HistoryType = E('CONTEXT_UPDATED', 'RECOMMENDATION_REFRESHED', 'CANDIDATE_ADDED', 'CANDIDATE_REMOVED', 'CANDIDATE_REORDERED', 'COMPARISON_OPENED', 'SIMULATION_ADDED', 'FEEDBACK_RECORDED', 'PRESENTATION_CREATED', 'SESSION_CLOSED');
  const Outcome = E('CUSTOMER_SELECTED_LOT', 'NO_DECISION', 'NEEDS_MORE_OPTIONS', 'BUDGET_MISMATCH', 'COMMERCIAL_UNAVAILABLE', 'FOLLOW_UP_REQUIRED', 'OTHER');
  const Currentness = E('CURRENT', 'PROFILE_CHANGED', 'COMMERCIAL_CHANGED', 'ANALYSIS_CHANGED', 'METHODOLOGY_CHANGED', 'UNKNOWN');
  const RefreshReason = E('PROFILE_CHANGED', 'PRICE_CHANGED', 'AVAILABILITY_CHANGED', 'ANALYSIS_CHANGED', 'METHODOLOGY_CHANGED', 'MANUAL_REFRESH');
  const Errors = E('FORBIDDEN', 'MISSING_ORGANIZATION', 'MISSING_DEVELOPMENT', 'REVISION_CONFLICT', 'NOT_FOUND', 'INVALID_TRANSITION', 'REASON_REQUIRED', 'NOTE_REQUIRED', 'INVALID_REASON',
    'WARNING_NOT_ACKNOWLEDGED', 'SHORTLIST_FULL', 'NOT_IN_SHORTLIST', 'ALREADY_IN_SHORTLIST', 'UNKNOWN_LOT', 'INVALID_FEEDBACK', 'REORDER_NOT_ALLOWED', 'PII_AS_ID', 'CONTEXT_MISMATCH');
  const MESSAGES = Object.freeze({
    FORBIDDEN: 'Você não possui permissão para esta ação da decisão comercial.', REVISION_CONFLICT: 'Esta decisão foi alterada em outro lugar. Recarregue antes de salvar.',
    REASON_REQUIRED: 'Informe o motivo da alteração manual.', NOTE_REQUIRED: 'Descreva o motivo (obrigatório para "Outro").', INVALID_REASON: 'Motivo não reconhecido.',
    WARNING_NOT_ACKNOWLEDGED: 'Este lote não atende a todos os critérios informados. Confirme para incluí-lo mesmo assim.', SHORTLIST_FULL: 'A seleção já tem o número máximo de lotes.',
    NOT_IN_SHORTLIST: 'Este lote não está na seleção.', ALREADY_IN_SHORTLIST: 'Este lote já está na seleção.', UNKNOWN_LOT: 'Lote não encontrado neste empreendimento.',
    CONTEXT_MISMATCH: 'Esta seleção pertence a outro atendimento. Inicie uma nova decisão para este cliente.' });
  const DEFAULT_POLICY = Object.freeze({ version: '0.0.0-default', objectiveMap: { ui: { housing: 'HOUSING', investment: 'INVESTMENT', family: 'HOUSING' }, customer: { LIVE: 'HOUSING', INVEST: 'INVESTMENT', LIVE_OR_INVEST: 'UNDECIDED', UNDECIDED: 'UNDECIDED' } },
    objectiveLabels: { HOUSING: 'Moradia', INVESTMENT: 'Investimento', UNDECIDED: 'Objetivo ainda não definido' },
    shortlistPolicy: { defaultSize: 3, maxSize: 5, allowBrokerReorder: true, allowCustomerSelection: true, requireReasonForManualOverride: true, includeReviewWhenNoEligible: true, reviewCategoriesAllowedInSuggestion: ['AVAILABILITY'] },
    workspaceModes: { DISCOVER: { candidates: 10 }, SHORTLIST: { candidates: 5 }, COMPARE: { candidates: 4 }, DECIDE: { candidates: 3 } }, explanation: { maxReasons: 3, maxTradeoffs: 2 }, readiness: { minProfileCompleteness: 0.5 },
    refreshPolicy: { onProfileChange: 'REQUIRED', onAvailabilityChange: 'SUGGEST', onPriceChange: 'SUGGEST', onAnalysisChange: 'SUGGEST', onMethodologyChange: 'REQUIRED' },
    overrideReasonCodes: ['CUSTOMER_REQUESTED', 'BROKER_LOCAL_KNOWLEDGE', 'COMMERCIAL_NEGOTIATION', 'VISIT_CONTEXT', 'SPECIAL_CONDITION', 'OTHER'], overrideReasonLabels: {}, feedbackSuggestion: { threshold: 2 },
    actionPolicy: {}, clientSafe: { showBudgetRange: false, showOutOfConstraintNote: true, showFitScore: false }, permissions: { keys: ['decision.read', 'decision.create', 'decision.update', 'decision.override', 'decision.share'], localDevice: [] },
    security: { classification: 'CONFIDENTIAL', notesClassification: 'RESTRICTED', persistOffline: false }, criteria: { categoryByPrefix: {}, overrides: {}, displayOnly: [] } });
  /** policyOf(devId) → decision policy from config/decision/<dev>.json, else the safe default (marked as default) */
  const policyOf = devId => (App.configs && App.configs.decision && App.configs.decision[devId]) || DEFAULT_POLICY;
  const fitCfgOf = devId => App.fit.cfgOf(devId), recPolOf = devId => App.recommendation.policyOf(devId);
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const checksum = x => App.methodology.checksum(typeof x === 'string' ? x : JSON.stringify(x));
  const plain = x => x == null ? x : JSON.parse(JSON.stringify(x));
  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
  const err = (code, extra = {}) => Object.freeze({ ok: false, code, message: MESSAGES[code] || code, ...extra });
  let seq = 0;
  const newId = (prefix, opts = {}) => opts.id || `${prefix}_${(opts.now != null ? Number(new Date(opts.now)) : Date.now()).toString(36)}${(++seq).toString(36)}`;
  const looksLikePII = s => typeof s === 'string' && (/@|\s/.test(s) || /\d{8,}/.test(s.replace(/\D/g, '')) && /^[\d\s()+.-]+$/.test(s));

  // ---------------------------------------------------------------- permissions (deny by default)
  /** can(ctx, key): ctx.can (backend-derived) wins; else ctx.permissions; else the local-device allow-list (static mode, memory only). Unknown key → false. */
  function can(ctx, key, devId) {
    const pol = policyOf(devId || (ctx && ctx.developmentId)), keys = (pol.permissions && pol.permissions.keys) || [];
    if (!keys.includes(key)) return false;
    if (ctx && typeof ctx.can === 'function') return ctx.can(key) === true;
    if (ctx && Array.isArray(ctx.permissions)) return ctx.permissions.includes(key);
    return !!(ctx && ctx.localDevice && ((pol.permissions && pol.permissions.localDevice) || []).includes(key));
  }

  // ---------------------------------------------------------------- objective, budget, commercial context
  /** objectiveOf({ ui objective | customer objective | explicit }) → HOUSING / INVESTMENT / UNDECIDED, or null when not informed (UNDECIDED ≠ not informed) */
  function objectiveOf(input = {}, devId) {
    const m = policyOf(devId).objectiveMap || DEFAULT_POLICY.objectiveMap;
    if (input.objective && Objective[input.objective]) return input.objective;
    if (input.customerObjective && m.customer[input.customerObjective]) return m.customer[input.customerObjective];
    if (input.uiObjective && m.ui[input.uiObjective]) return m.ui[input.uiObjective];
    if (input.uiObjective) return Objective.UNDECIDED; // a preset that does not say live/invest → never guessed
    return null;
  }
  const minor = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : undefined);
  const amountOf = m => m == null ? undefined : typeof m === 'number' ? m : m.amount;
  /** CustomerBudgetProfile from (a) an explicit declared profile, (b) a customer profile version, (c) the panel's budget constraint. Unknown → source UNKNOWN (never 0). */
  function budgetProfileOf({ declared, version, constraints } = {}) {
    if (declared) {
      const src = BudgetSource[declared.source] ? declared.source : 'UNKNOWN', out = { currency: declared.currency || 'BRL', source: src };
      const put = (k, v) => { const x = minor(v); if (x != null) out[k] = { maxMinor: x, currency: out.currency }; };
      if (declared.purchaseMax != null || declared.purchaseMin != null) out.purchaseBudget = { ...(minor(declared.purchaseMin) != null ? { minMinor: minor(declared.purchaseMin) } : {}), ...(minor(declared.purchaseMax) != null ? { maxMinor: minor(declared.purchaseMax) } : {}), currency: out.currency };
      put('downPaymentCapacity', declared.downPaymentMax); put('monthlyPaymentCapacity', declared.monthlyMax);
      if (Array.isArray(declared.paymentPreferences)) out.paymentPreferences = declared.paymentPreferences.slice(0, 6).map(String);
      if (typeof declared.financingAllowed === 'boolean') out.financingAllowed = declared.financingAllowed;
      if (typeof declared.directInstallmentPreferred === 'boolean') out.directInstallmentPreferred = declared.directInstallmentPreferred;
      return out;
    }
    if (version && version.budgetProfile) {
      const b = version.budgetProfile, ds = b.dataState, src = ds === 'PROVIDED' ? 'CUSTOMER_DECLARED' : ds === 'NEEDS_CONFIRMATION' ? 'BROKER_RECORDED' : ds === 'ESTIMATED' ? 'ESTIMATED' : 'UNKNOWN';
      const out = { currency: b.currency || 'BRL', source: src, needsConfirmation: ds === 'NEEDS_CONFIRMATION' };
      const max = amountOf(b.maximumPurchasePrice) ?? amountOf(b.targetPurchasePriceMax), min = amountOf(b.targetPurchasePriceMin);
      if (max != null || min != null) out.purchaseBudget = { ...(min != null ? { minMinor: minor(min) } : {}), ...(max != null ? { maxMinor: minor(max) } : {}), currency: out.currency };
      if (amountOf(b.availableDownPayment) != null) out.downPaymentCapacity = { maxMinor: minor(amountOf(b.availableDownPayment)), currency: out.currency };
      if (amountOf(b.preferredMonthlyPaymentMax) != null) out.monthlyPaymentCapacity = { maxMinor: minor(amountOf(b.preferredMonthlyPaymentMax)), currency: out.currency };
      if (b.financingPreference) out.paymentPreferences = [String(b.financingPreference)];
      return out;
    }
    const bm = constraints && constraints.budgetMax;
    if (typeof bm === 'number' && bm > 0) return { currency: 'BRL', source: 'BROKER_RECORDED', purchaseBudget: { maxMinor: minor(bm), currency: 'BRL' } };
    return undefined;
  }
  const budgetMaxOf = ctx => ctx && ctx.budgetProfile && ctx.budgetProfile.purchaseBudget && ctx.budgetProfile.purchaseBudget.maxMinor != null ? ctx.budgetProfile.purchaseBudget.maxMinor / 100 : null;
  function commercialContextOf(input = {}, dataVersions = {}) {
    const pick = (v, enm, dflt) => (v && enm[v] ? v : dflt);
    return { currentAvailabilityRevision: dataVersions.availabilityRevision != null ? 'rev' + dataVersions.availabilityRevision : undefined, currentPriceTableVersion: dataVersions.priceTableVersion || undefined,
      desiredPurchaseTiming: pick(input.desiredPurchaseTiming, Timing, 'UNKNOWN'), flexibility: pick(input.flexibility, Level3, null), urgency: pick(input.urgency, { ...Level3, UNKNOWN: 'UNKNOWN' }, 'UNKNOWN'),
      decisionStage: pick(input.decisionStage, DecisionStage, 'UNKNOWN') };
  }

  // ---------------------------------------------------------------- CustomerDecisionContext
  /** uiStateOf(input) → { preferences, constraints } in the panel's shape: from the customer's profile version when given, else the current panel state (ad-hoc) */
  function uiStateOf(input = {}) {
    if (input.customer && input.customer.profileVersion && App.customer && App.customer.domain) return App.customer.domain.toUiState(input.customer.profileVersion, { developmentId: input.developmentId });
    if (input.adHoc) return { preferences: { ...(input.adHoc.preferences || {}) }, constraints: { ...(input.adHoc.constraints || {}) } };
    const ui = input.ui || {};
    return { preferences: { ...(ui.preferences || {}) }, constraints: { ...(ui.constraints || {}) } };
  }
  /** buildContext(input) → CustomerDecisionContext (frozen, no PII: customerId is an opaque id; names never enter the context).
      input = { organizationId, developmentId, customer?: { customerId, profileVersion? }, ui?: { preferences, constraints, objective, customerObjective }, adHoc?, budget?, commercial?, journey?, dataVersions?, now? } */
  function buildContext(input = {}) {
    const devId = input.developmentId; if (!devId) throw Object.assign(new Error('developmentId obrigatório'), { code: Errors.MISSING_DEVELOPMENT });
    const fitCfg = fitCfgOf(devId), recPol = recPolOf(devId), pol = policyOf(devId), ui = uiStateOf(input), dv = input.dataVersions || {};
    const cust = input.customer && input.customer.customerId ? input.customer : null;
    if (cust && (typeof cust.customerId !== 'string' || looksLikePII(cust.customerId))) throw Object.assign(new Error('customerId deve ser um identificador opaco'), { code: Errors.PII_AS_ID });
    const version = cust && cust.profileVersion ? cust.profileVersion : null;
    const prefSource = id => { const p = version && (version.preferences || []).find(x => x.key === id); return p ? p.source : input.adHoc ? 'BROKER_RECORDED' : 'BROKER_RECORDED'; };
    const preferences = Object.entries(ui.preferences || {}).filter(([k, w]) => w && fitCfg.preferences[k]).map(([key, w]) => ({ key, fieldKey: fitCfg.preferences[key].fieldKey, importance: typeof w === 'string' ? w : fitCfg.legacyImportance[String(w)], uiWeight: typeof w === 'number' ? w : null, label: fitCfg.preferences[key].label || key, source: prefSource(key) }))
      .filter(p => p.importance).sort((a, b) => a.key.localeCompare(b.key));
    const consOrigin = key => { const c = version && (version.hardConstraints || []).find(x => x.key === key); return c ? (c.source === 'CUSTOMER_EXPLICIT' ? 'CUSTOMER_EXPLICIT' : c.source === 'IMPORTED' ? 'IMPORTED_CONFIRMED' : 'BROKER_CONFIRMED') : 'BROKER_CONFIRMED'; };
    const constraints = Object.entries(ui.constraints || {}).filter(([k, v]) => v != null && v !== false && v !== '' && recPol.constraints[k]).map(([key, v]) => ({ key, metricKey: recPol.constraints[key].metricKey, operator: recPol.constraints[key].operator, expectedValue: v, label: recPol.constraints[key].label || key, origin: consOrigin(key) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const objective = objectiveOf({ objective: input.objective || (input.adHoc && input.adHoc.objective), customerObjective: version ? version.objective : (input.ui || {}).customerObjective, uiObjective: (input.ui || {}).objective }, devId);
    const budgetProfile = budgetProfileOf({ declared: input.budget, version, constraints: ui.constraints });
    const body = { developmentId: devId, customerId: cust ? cust.customerId : null, customerProfileVersionId: version ? version.id : null, objective, preferences: preferences.map(p => [p.key, p.importance]), constraints: constraints.map(c => [c.key, c.expectedValue]),
      budget: budgetProfile ? [budgetProfile.source, budgetMaxOf({ budgetProfile }), budgetProfile.downPaymentCapacity ? budgetProfile.downPaymentCapacity.maxMinor : null, budgetProfile.monthlyPaymentCapacity ? budgetProfile.monthlyPaymentCapacity.maxMinor : null] : null };
    const ctx = { organizationId: input.organizationId || null, developmentId: devId, customerId: cust ? cust.customerId : undefined, customerProfileVersionId: version ? version.id : undefined,
      adHocProfileId: !cust ? (input.adHoc && input.adHoc.id) || 'adhoc-current' : undefined, objective: objective || Objective.UNDECIDED, objectiveInformed: !!objective,
      constraints, preferences, budgetProfile, commercialContext: commercialContextOf(input.commercial, dv), journeyContext: input.journey ? { journeyId: input.journey.journeyId || null, stageKey: input.journey.stageKey || null } : undefined,
      recommendationPolicyVersion: recPol.version, fitMethodologyVersion: fitCfg.fitMethodologyVersion, decisionPolicyVersion: pol.version,
      contextRef: 'dctx_' + checksum(body), uiState: ui, generatedAt: nowIso(input.now) };
    return deepFreeze(ctx);
  }
  /** AdHocDecisionProfile (temporary lead, no Customer created): lives only in memory and expires */
  function createAdHoc({ objective = null, preferences = {}, constraints = {}, budget = null } = {}, opts = {}) {
    return deepFreeze({ id: newId('adhoc', opts), objective: objective && Objective[objective] ? objective : null, preferences: { ...preferences }, constraints: { ...constraints }, budget: budget ? { ...budget } : null,
      expiresAt: opts.ttlMs ? nowIso((opts.now != null ? Number(new Date(opts.now)) : Date.now()) + opts.ttlMs) : undefined, persistent: false });
  }
  /** engineInputs(context) → { profile, constraints } exactly as state/selectors.js builds them (parity: same profileVersion, same constraints) */
  function engineInputs(ctx) {
    const devId = ctx.developmentId, recPol = recPolOf(devId), ui = ctx.uiState || {};
    const profile = App.fit.buildProfile({ id: ctx.customerId || 'working-profile', developmentId: devId, preferences: ui.preferences || {} });
    const constraints = Object.entries(ui.constraints || {}).filter(([k, v]) => v != null && v !== false && v !== '').map(([k, v]) => App.recommendation.constraint(k, v, recPol)).filter(Boolean);
    return { profile, constraints };
  }

  // ---------------------------------------------------------------- validation and completeness
  /** profileCompleteness(ctx) → ratio over objective / budget / preferences / hard constraints reviewed (same four items as the Customer domain). Not confidence. */
  function completeness(ctx, version) {
    if (version && version.profileCompleteness && typeof version.profileCompleteness.ratio === 'number') return version.profileCompleteness.ratio;
    const has = [ctx.objectiveInformed, !!budgetMaxOf(ctx), ctx.preferences.length > 0, ctx.constraints.length > 0];
    return has.filter(Boolean).length / has.length;
  }
  /** validate(ctx, { lots }) → DecisionContextValidation. Never blocks for being partial: partial = READY_WITH_WARNINGS ("Recomendação baseada em perfil parcial"). */
  function validate(ctx, opts = {}) {
    const devId = ctx.developmentId, { profile, constraints } = engineInputs(ctx), fitCfg = fitCfgOf(devId), recPol = recPolOf(devId);
    const vp = App.fit.validateProfile(profile, fitCfg), vc = App.recommendation.validateConstraints(constraints, recPol);
    const errors = [...vp.errors, ...vc.errors].map(e => ({ code: e.code, path: e.path || null, message: e.message || null }));
    const warnings = [], missing = [];
    const comp = completeness(ctx, opts.profileVersion);
    if (errors.length) return deepFreeze({ status: 'INVALID', missingCriticalInputs: [], warnings: errors.map(e => e.code), errors, profileCompleteness: comp });
    if (!ctx.preferences.length && !ctx.constraints.length) { missing.push('PREFERENCES_OR_CONSTRAINTS'); return deepFreeze({ status: 'INSUFFICIENT_CONTEXT', missingCriticalInputs: missing, warnings, errors: [], profileCompleteness: comp }); }
    if (!ctx.objectiveInformed) warnings.push('OBJECTIVE_NOT_INFORMED');
    else if (ctx.objective === 'UNDECIDED') warnings.push('OBJECTIVE_UNDECIDED');
    const b = ctx.budgetProfile;
    if (!b || !budgetMaxOf(ctx)) warnings.push('BUDGET_NOT_INFORMED'); else if (b.source === 'ESTIMATED') warnings.push('BUDGET_ESTIMATED'); else if (b.needsConfirmation) warnings.push('BUDGET_NEEDS_CONFIRMATION');
    if (!ctx.preferences.length) warnings.push('NO_PREFERENCES');
    if (!ctx.customerId) warnings.push('AD_HOC_PROFILE');
    if (comp < (policyOf(devId).readiness || {}).minProfileCompleteness) warnings.push('PARTIAL_PROFILE');
    for (const w of [...vp.warnings, ...vc.warnings]) warnings.push(w.code);
    return deepFreeze({ status: warnings.some(w => w !== 'AD_HOC_PROFILE') ? 'READY_WITH_WARNINGS' : 'READY', missingCriticalInputs: missing, warnings: [...new Set(warnings)], errors: [], profileCompleteness: comp });
  }

  // ---------------------------------------------------------------- DecisionCriterionRegistry (reuses the field registry; nothing duplicated)
  function criterionRegistry(devId) {
    const fitCfg = fitCfgOf(devId), recPol = recPolOf(devId), cr = policyOf(devId).criteria || {}, byPrefix = cr.categoryByPrefix || {};
    const category = fk => { const k = Object.keys(byPrefix).filter(p => fk === p || fk.startsWith(p + '.')).sort((a, b) => b.length - a.length)[0]; return k ? byPrefix[k] : 'DATA_QUALITY'; };
    const out = new Map();
    for (const [k, d] of Object.entries(fitCfg.preferences)) {
      const o = (cr.overrides || {})[k] || {};
      out.set(k, { id: k, fieldKey: d.fieldKey, metricKey: d.fieldKey, labelKey: d.label || k, category: o.category || category(d.fieldKey), supportedAs: 'PREFERENCE', valueType: d.type, matcherId: d.type, explanationTemplateId: App.reasonCodes ? App.reasonCodes.matchCode(k) : null, clientSafe: o.clientSafe !== false });
    }
    for (const [k, d] of Object.entries(recPol.constraints)) {
      const twin = [...out.values()].find(x => x.fieldKey === d.metricKey && x.supportedAs === 'PREFERENCE' && k === x.id);
      if (twin) { twin.supportedAs = 'BOTH'; continue; }
      out.set(k, { id: k, fieldKey: d.metricKey, metricKey: d.metricKey, labelKey: d.label || k, category: (cr.overrides || {})[k] && cr.overrides[k].category || category(d.metricKey), supportedAs: 'CONSTRAINT', valueType: d.operator, matcherId: d.operator, explanationTemplateId: d.failCode || null, clientSafe: true });
    }
    for (const d of cr.displayOnly || []) out.set(d.id, { id: d.id, fieldKey: d.fieldKey, metricKey: d.fieldKey, labelKey: d.label, category: d.category, supportedAs: 'DISPLAY_ONLY', valueType: d.valueType, matcherId: null, explanationTemplateId: null, clientSafe: true });
    const list = deepFreeze([...out.values()]);
    const unknownFields = list.filter(c => App.model && !App.model.field(c.fieldKey)).map(c => c.id);
    return Object.freeze({ list: () => list, get: id => list.find(c => c.id === id) || null, forConstraintBuilder: () => list.filter(c => c.supportedAs === 'CONSTRAINT' || c.supportedAs === 'BOTH'), unknownFields });
  }

  // ---------------------------------------------------------------- DecisionSession, history, transitions
  const tenantOf = t => { if (!t || !t.organizationId) throw Object.assign(new Error('contexto sem organização'), { code: Errors.MISSING_ORGANIZATION }); return t.organizationId; };
  function historyEvent(sessionId, eventType, metadata = {}, opts = {}) {
    const safe = {}; for (const [k, v] of Object.entries(metadata || {})) if (!/note|name|email|phone|budget|notes|text/i.test(k)) safe[k] = v; // no PII / notes / budget in history metadata
    return deepFreeze({ id: newId('dhe', opts), decisionSessionId: sessionId, eventType, occurredAt: nowIso(opts.now), actorId: opts.actorId || undefined, metadata: plain(safe) });
  }
  /** startSession(tenant, { developmentId, context }, opts) → DecisionSession DRAFT. A new customer never reuses another customer's session. */
  function startSession(tenant, { developmentId, context } = {}, opts = {}) {
    const org = tenantOf(tenant); if (!can(tenant, 'decision.create', developmentId)) return err(Errors.FORBIDDEN);
    if (!developmentId) return err(Errors.MISSING_DEVELOPMENT);
    const at = nowIso(opts.now), s = { id: newId('ds', opts), organizationId: org, developmentId, customerId: context && context.customerId || undefined, customerDecisionContextRef: context ? context.contextRef : null,
      status: 'DRAFT', recommendationResultId: undefined, shortlistId: undefined, comparisonSessionId: undefined, financialScenarioIds: [], presentationId: undefined, workspaceMode: 'DISCOVER',
      createdAt: at, updatedAt: at, revision: '1', transitions: [], history: [] };
    s.history = [historyEvent(s.id, 'CONTEXT_UPDATED', { contextRef: s.customerDecisionContextRef, reason: 'SESSION_STARTED' }, opts)];
    return deepFreeze({ ok: true, session: s });
  }
  const bump = r => String(Number(r) + 1);
  /** guardContext(session, context): a session bound to another customer is never silently reused */
  const sameCustomer = (session, context) => (session.customerId || null) === ((context && context.customerId) || null);
  /** transition(session, to, { reasonCode, expectedRevision, actorId, now }) — no forced progression (the user can go back); ARCHIVED is final; history kept */
  function transition(session, to, opts = {}) {
    if (!SessionStatus[to]) return err(Errors.INVALID_TRANSITION);
    if (session.status === 'ARCHIVED') return err(Errors.INVALID_TRANSITION, { message: 'Sessão arquivada não muda de estado.' });
    if (opts.expectedRevision != null && opts.expectedRevision !== session.revision) return err(Errors.REVISION_CONFLICT, { currentRevision: session.revision });
    if (to === session.status) return Object.freeze({ ok: true, session, unchanged: true });
    const at = nowIso(opts.now), tr = { from: session.status, to, reasonCode: opts.reasonCode || 'USER_ACTION', actorId: opts.actorId || null, occurredAt: at };
    const hist = to === 'CLOSED' ? [historyEvent(session.id, 'SESSION_CLOSED', { outcome: Outcome[opts.outcome] ? opts.outcome : undefined, selectedLotId: opts.selectedLotId || undefined }, opts)] : [];
    return deepFreeze({ ok: true, session: { ...plain(session), status: to, outcome: to === 'CLOSED' && Outcome[opts.outcome] ? opts.outcome : session.outcome, selectedLotId: to === 'CLOSED' ? opts.selectedLotId || undefined : session.selectedLotId,
      transitions: [...plain(session.transitions), tr], history: [...plain(session.history), ...hist], updatedAt: at, revision: bump(session.revision) } });
  }
  /** attachResult(session, orchestratorResult) — a new RecommendationResult is a new reference; the previous one is kept in history (never overwritten) */
  function attachResult(session, result, opts = {}) {
    if (opts.expectedRevision != null && opts.expectedRevision !== session.revision) return err(Errors.REVISION_CONFLICT, { currentRevision: session.revision });
    const prev = session.recommendationResultId, at = nowIso(opts.now);
    const ev = historyEvent(session.id, 'RECOMMENDATION_REFRESHED', { recommendationResultId: result.recommendationResultId, previousResultId: prev || undefined, refreshReason: RefreshReason[opts.refreshReason] ? opts.refreshReason : prev ? 'MANUAL_REFRESH' : undefined }, opts);
    return deepFreeze({ ok: true, session: { ...plain(session), recommendationResultId: result.recommendationResultId, previousResultIds: [...(session.previousResultIds || []), ...(prev && prev !== result.recommendationResultId ? [prev] : [])],
      status: session.status === 'DRAFT' ? 'ACTIVE' : session.status, history: [...plain(session.history), ev], updatedAt: at, revision: bump(session.revision) } });
  }
  const setMode = (session, mode) => WorkspaceMode[mode] ? deepFreeze({ ...plain(session), workspaceMode: mode }) : session; // presentation only: never changes the engine

  // ---------------------------------------------------------------- Shortlist (curated order ≠ analytical rank)
  /** createShortlist(session, result, { ids?, policy }) → Shortlist from the orchestrator's suggestion (or explicit ids). Keeps analytical rank and curated position separately. */
  function createShortlist(session, result, opts = {}) {
    const pol = (opts.policy || policyOf(session.developmentId)).shortlistPolicy || DEFAULT_POLICY.shortlistPolicy;
    const byId = new Map((result.candidateSummaries || []).map(c => [c.lotId, c])), ids = (opts.ids || result.suggestedShortlistIds || []).filter(id => byId.has(id)).slice(0, pol.maxSize);
    const at = nowIso(opts.now), sl = { id: newId('sl', opts), decisionSessionId: session.id, recommendationResultId: result.recommendationResultId, source: 'RECOMMENDATION', maxCandidates: pol.maxSize,
      candidates: ids.map((id, i) => ({ lotId: id, recommendationRank: byId.get(id).recommendationRank, reviewRank: byId.get(id).reviewRank, eligibility: byId.get(id).eligibility, curatedPosition: i + 1, addedBy: 'SYSTEM', reasonCode: undefined, constraintBreaches: [] })),
      overrides: [], createdAt: at, updatedAt: at, revision: '1' };
    sl.candidateIds = sl.candidates.map(c => c.lotId); sl.orderedCandidateIds = sl.candidateIds.slice();
    const ev = historyEvent(session.id, 'CANDIDATE_ADDED', { shortlistId: sl.id, lotIds: sl.candidateIds, by: 'SYSTEM' }, opts);
    return deepFreeze({ ok: true, shortlist: sl, history: [ev] });
  }
  const sensitiveOf = (cand, ctx) => {
    if (!cand) return ['NOT_IN_RESULT'];
    const out = [];
    if (cand.eligibility === 'INELIGIBLE') out.push(cand.exclusionReasonCode || 'INELIGIBLE');
    const allowed = (((policyOf(ctx && ctx.developmentId).shortlistPolicy) || {}).reviewCategoriesAllowedInSuggestion) || [];
    if (cand.eligibility === 'REVIEW_REQUIRED' && !allowed.includes(cand.reviewCategory)) out.push('REVIEW_REQUIRED'); // review only for availability = same rule as the suggested shortlist
    const bm = budgetMaxOf(ctx), price = cand.commercialSnapshot && cand.commercialSnapshot.price;
    if (bm != null && price != null && price > bm && !out.includes('PRICE_ABOVE_MAX')) out.push('PRICE_ABOVE_MAX');
    return out;
  };
  /** applyOverride(shortlist, override, { candidate, context, tenant, expectedRevision, now }) → { ok, shortlist, override, history, warnings }.
      Never changes Fit or recommendation rank. Promoting an ineligible / review / over-budget lot needs a reason AND acknowledgeWarning; the breach stays visible (FAIL is never turned into PASS). */
  function applyOverride(shortlist, ov = {}, opts = {}) {
    const devId = (opts.context && opts.context.developmentId) || opts.developmentId, pol = policyOf(devId), sp = pol.shortlistPolicy || DEFAULT_POLICY.shortlistPolicy;
    if (!can(opts.tenant, 'decision.override', devId)) return err(Errors.FORBIDDEN);
    if (opts.expectedRevision != null && opts.expectedRevision !== shortlist.revision) return err(Errors.REVISION_CONFLICT, { currentRevision: shortlist.revision });
    if (!OverrideAction[ov.action]) return err(Errors.INVALID_REASON, { message: 'Ação de curadoria inválida.' });
    const inList = shortlist.candidates.find(c => c.lotId === ov.lotId), cand = opts.candidate || null;
    const breaches = ov.action === 'PROMOTE_TO_SHORTLIST' ? sensitiveOf(cand, opts.context) : [];
    const needsReason = breaches.length > 0 && sp.requireReasonForManualOverride !== false; // reason is mandatory for SENSITIVE overrides (out of budget / ineligible / review)
    if (needsReason && !ov.reasonCode) return err(Errors.REASON_REQUIRED);
    if (ov.reasonCode && !(pol.overrideReasonCodes || []).includes(ov.reasonCode)) return err(Errors.INVALID_REASON);
    if (ov.reasonCode === 'OTHER' && !(ov.note && String(ov.note).trim())) return err(Errors.NOTE_REQUIRED);
    if (breaches.length && !breaches.includes('NOT_IN_RESULT') && ov.acknowledgeWarning !== true) return err(Errors.WARNING_NOT_ACKNOWLEDGED, { breaches });
    if (breaches.includes('NOT_IN_RESULT') && !opts.lotExists) return err(Errors.UNKNOWN_LOT);
    if (breaches.includes('NOT_IN_RESULT') && ov.acknowledgeWarning !== true) return err(Errors.WARNING_NOT_ACKNOWLEDGED, { breaches });
    let cands = plain(shortlist.candidates), evType;
    if (ov.action === 'PROMOTE_TO_SHORTLIST') {
      if (inList) return err(Errors.ALREADY_IN_SHORTLIST);
      if (cands.length >= shortlist.maxCandidates) return err(Errors.SHORTLIST_FULL);
      cands.push({ lotId: ov.lotId, recommendationRank: cand ? cand.recommendationRank : undefined, reviewRank: cand ? cand.reviewRank : undefined, eligibility: cand ? cand.eligibility : 'INELIGIBLE', curatedPosition: cands.length + 1, addedBy: ov.addedBy === 'CUSTOMER' ? 'CUSTOMER' : 'BROKER', reasonCode: ov.reasonCode, note: ov.note ? String(ov.note).slice(0, 500) : undefined, constraintBreaches: breaches });
      evType = 'CANDIDATE_ADDED';
    } else if (ov.action === 'REMOVE_FROM_SHORTLIST') {
      if (!inList) return err(Errors.NOT_IN_SHORTLIST);
      cands = cands.filter(c => c.lotId !== ov.lotId); evType = 'CANDIDATE_REMOVED';
    } else if (ov.action === 'REORDER') {
      if (!sp.allowBrokerReorder) return err(Errors.REORDER_NOT_ALLOWED);
      if (!inList) return err(Errors.NOT_IN_SHORTLIST);
      const to = Math.max(1, Math.min(cands.length, Number(ov.toPosition) || 1)), item = cands.find(c => c.lotId === ov.lotId);
      cands = cands.filter(c => c.lotId !== ov.lotId); cands.splice(to - 1, 0, item); evType = 'CANDIDATE_REORDERED';
    } else { // MARK_FOR_REVIEW: flag only
      if (!inList) return err(Errors.NOT_IN_SHORTLIST);
      cands = cands.map(c => c.lotId === ov.lotId ? { ...c, markedForReview: true, reasonCode: ov.reasonCode || c.reasonCode } : c); evType = 'CANDIDATE_REORDERED';
    }
    cands = cands.map((c, i) => ({ ...c, curatedPosition: i + 1 }));
    const at = nowIso(opts.now), record = { decisionSessionId: shortlist.decisionSessionId, lotId: ov.lotId, action: ov.action, addedBy: ov.addedBy === 'CUSTOMER' ? 'CUSTOMER' : 'BROKER', reasonCode: ov.reasonCode || undefined, note: ov.note ? String(ov.note).slice(0, 500) : undefined, createdBy: (opts.tenant && opts.tenant.userId) || 'local-user', createdAt: at, breaches };
    const byCust = cands.some(c => c.addedBy === 'CUSTOMER'), curated = cands.some(c => c.addedBy === 'BROKER') || [...shortlist.overrides, record].some(o => o.action !== 'PROMOTE_TO_SHORTLIST' || o.addedBy !== 'CUSTOMER');
    const source = byCust && curated ? 'MIXED' : byCust ? 'CUSTOMER_SELECTED' : curated ? 'BROKER_CURATED' : 'RECOMMENDATION';
    const next = { ...plain(shortlist), candidates: cands, candidateIds: cands.map(c => c.lotId), orderedCandidateIds: cands.map(c => c.lotId), overrides: [...plain(shortlist.overrides), record], source, updatedAt: at, revision: bump(shortlist.revision) };
    const ev = historyEvent(shortlist.decisionSessionId, evType, { shortlistId: shortlist.id, lotId: ov.lotId, action: ov.action, reasonCode: ov.reasonCode, sensitive: breaches.length > 0 }, opts);
    const audit = breaches.length ? { type: 'DecisionOverrideSensitive', decisionSessionId: shortlist.decisionSessionId, lotId: ov.lotId, reasonCode: ov.reasonCode, breaches } : null; // no note, no PII
    return deepFreeze({ ok: true, shortlist: next, override: record, history: [ev], audit, warnings: breaches });
  }

  // ---------------------------------------------------------------- feedback and preference suggestions (never auto-applied)
  /** recordFeedback(session, fb, opts) → CustomerDecisionFeedback (note internal, never client-facing) + history event without the note */
  function recordFeedback(session, fb = {}, opts = {}) {
    if (!FeedbackType[fb.feedbackType]) return err(Errors.INVALID_FEEDBACK);
    const f = { id: newId('dfb', opts), decisionSessionId: session.id, lotId: fb.lotId || undefined, feedbackType: fb.feedbackType, criterionId: fb.criterionId || undefined, note: fb.note ? String(fb.note).slice(0, 500) : undefined, recordedAt: nowIso(opts.now), recordedBy: opts.actorId || 'local-user' };
    return deepFreeze({ ok: true, feedback: f, history: [historyEvent(session.id, 'FEEDBACK_RECORDED', { lotId: f.lotId, feedbackType: f.feedbackType, criterionId: f.criterionId }, opts)] });
  }
  /** suggestPreferences(feedbacks, { customerId, developmentId, context }) → PreferenceSuggestion[] PENDING. Only criteria the broker tagged, only past the threshold; the profile is NEVER changed here. */
  function suggestPreferences(feedbacks = [], opts = {}) {
    const devId = opts.developmentId, fitCfg = fitCfgOf(devId), th = ((policyOf(devId).feedbackSuggestion) || {}).threshold || 2, have = new Set(((opts.context && opts.context.preferences) || []).map(p => p.key));
    const negative = new Set(['DISLIKED', 'LOCATION_NOT_PREFERRED', 'SIZE_NOT_PREFERRED', 'TOO_EXPENSIVE', 'PAYMENT_NOT_PREFERRED']), count = new Map();
    for (const f of feedbacks) { if (!f || !negative.has(f.feedbackType)) continue; const c = f.criterionId || (f.feedbackType === 'SIZE_NOT_PREFERRED' ? 'area' : null); if (!c || !fitCfg.preferences[c]) continue; const e = count.get(c) || []; e.push(f.id); count.set(c, e); }
    const out = [];
    for (const [c, refs] of count) if (refs.length >= th && !have.has(c)) out.push({ suggestionId: 'psg_' + checksum([opts.customerId || 'adhoc', c, refs]), customerId: opts.customerId || undefined, criterionId: c,
      suggestedPreference: { key: c, importance: 'MEDIUM', source: 'SYSTEM_SUGGESTED_UNCONFIRMED', active: false }, basedOnFeedbackRefs: refs.slice(), status: 'PENDING', label: fitCfg.preferences[c].label || c });
    return deepFreeze(out);
  }
  /** resolveSuggestion(s, accept) → { suggestion, uiPatch? } — accepting returns the explicit patch the UI applies; nothing is applied here */
  function resolveSuggestion(s, accept, opts = {}) {
    const fitCfg = fitCfgOf(opts.developmentId), w = Object.entries(fitCfg.legacyImportance || {}).find(([, v]) => v === s.suggestedPreference.importance);
    return deepFreeze({ suggestion: { ...plain(s), status: accept ? 'ACCEPTED' : 'REJECTED' }, uiPatch: accept ? { preferences: { [s.criterionId]: w ? Number(w[0]) : 2 } } : null });
  }

  // ---------------------------------------------------------------- snapshot, currentness, refresh policy
  /** snapshot(session, result) → DecisionSessionSnapshot (refs + checksum; reproducible "why then") */
  function snapshot(session, result, opts = {}) {
    const v = result.versionRefs || {}, s = { decisionSessionId: session.id, customerProfileVersionId: v.customerProfileVersionId || undefined, profileVersion: v.profileVersion || undefined, recommendationResultId: result.recommendationResultId,
      comparisonSnapshotId: opts.comparisonSnapshotId || undefined, priceTableVersion: v.priceTableVersion || undefined, availabilityRevision: v.availabilityRevision != null ? String(v.availabilityRevision) : undefined, analysisVersion: v.analysisVersion || undefined,
      fitMethodologyVersion: v.fitMethodologyVersion, recommendationPolicyVersion: v.recommendationPolicyVersion, decisionPolicyVersion: v.decisionPolicyVersion, shortlistLotIds: opts.shortlist ? opts.shortlist.orderedCandidateIds.slice() : undefined, createdAt: nowIso(opts.now) };
    s.checksum = checksum({ ...s, createdAt: undefined });
    return deepFreeze(s);
  }
  /** currentness(snapshotOrRefs, currentRefs, devId) → { currentness, changes, refresh: REQUIRED/SUGGEST/OPTIONAL/NONE, refreshReasons } — the user chooses to refresh; nothing is recomputed here */
  function currentness(snap, cur, devId) {
    if (!snap || !cur) return deepFreeze({ currentness: 'UNKNOWN', changes: [], refresh: 'NONE', refreshReasons: [] });
    const rp = policyOf(devId).refreshPolicy || DEFAULT_POLICY.refreshPolicy, changes = [], reasons = [];
    const diff = (k, reason, pol) => { if ((snap[k] ?? null) !== (cur[k] ?? null) && (cur[k] != null || snap[k] != null)) { changes.push({ ref: k, from: snap[k] ?? null, to: cur[k] ?? null, policy: pol }); reasons.push(reason); } };
    diff('profileVersion', 'PROFILE_CHANGED', rp.onProfileChange); diff('priceTableVersion', 'PRICE_CHANGED', rp.onPriceChange);
    diff('availabilityRevision', 'AVAILABILITY_CHANGED', rp.onAvailabilityChange); diff('analysisVersion', 'ANALYSIS_CHANGED', rp.onAnalysisChange);
    diff('fitMethodologyVersion', 'METHODOLOGY_CHANGED', rp.onMethodologyChange); diff('recommendationPolicyVersion', 'METHODOLOGY_CHANGED', rp.onMethodologyChange);
    const has = r => reasons.includes(r);
    const c = has('METHODOLOGY_CHANGED') ? 'METHODOLOGY_CHANGED' : has('PROFILE_CHANGED') ? 'PROFILE_CHANGED' : has('PRICE_CHANGED') || has('AVAILABILITY_CHANGED') ? 'COMMERCIAL_CHANGED' : has('ANALYSIS_CHANGED') ? 'ANALYSIS_CHANGED' : 'CURRENT';
    const lv = changes.map(x => x.policy), refresh = lv.includes('REQUIRED') ? 'REQUIRED' : lv.includes('SUGGEST') ? 'SUGGEST' : lv.includes('OPTIONAL') ? 'OPTIONAL' : 'NONE';
    return deepFreeze({ currentness: c, changes, refresh, refreshReasons: [...new Set(reasons)] });
  }

  // ---------------------------------------------------------------- repository (memory only, tenant-scoped, optimistic concurrency)
  function createRepository() {
    let orgs = new Map();
    const of = t => { const o = tenantOf(t); if (!orgs.has(o)) orgs.set(o, { sessions: new Map(), shortlists: new Map(), feedback: new Map() }); return orgs.get(o); };
    return Object.freeze({
      getById(t, id) { if (!can(t, 'decision.read', t.developmentId)) return null; const s = of(t).sessions.get(id); return s && s.organizationId === t.organizationId ? s : null; },
      save(t, session, expectedRevision) {
        if (!can(t, 'decision.update', t.developmentId) && !can(t, 'decision.create', t.developmentId)) return err(Errors.FORBIDDEN);
        if (session.organizationId !== t.organizationId) return err(Errors.NOT_FOUND);
        const cur = of(t).sessions.get(session.id);
        if (cur && expectedRevision != null && cur.revision !== expectedRevision) return err(Errors.REVISION_CONFLICT, { currentRevision: cur.revision });
        of(t).sessions.set(session.id, session); return Object.freeze({ ok: true, session });
      },
      listByCustomer(t, customerId) { if (!can(t, 'decision.read', t.developmentId)) return []; return [...of(t).sessions.values()].filter(s => s.customerId === customerId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); },
      saveShortlist(t, sl, expectedRevision) { const cur = of(t).shortlists.get(sl.id); if (cur && expectedRevision != null && cur.revision !== expectedRevision) return err(Errors.REVISION_CONFLICT, { currentRevision: cur.revision }); of(t).shortlists.set(sl.id, sl); return Object.freeze({ ok: true, shortlist: sl }); },
      getShortlist(t, id) { return of(t).shortlists.get(id) || null; },
      addFeedback(t, f) { const m = of(t).feedback; const l = m.get(f.decisionSessionId) || []; l.push(f); m.set(f.decisionSessionId, l); return Object.freeze({ ok: true }); },
      feedbackOf(t, sessionId) { return (of(t).feedback.get(sessionId) || []).slice(); },
      clear() { orgs = new Map(); }, persistent: false
    });
  }

  return Object.freeze({ Objective, BudgetSource, ConstraintOrigin, ValidationStatus, Eligibility, Tier, SessionStatus, WorkspaceMode, DecisionStage, Timing, ShortlistSource, AddedBy, OverrideAction, FeedbackType, HistoryType, Outcome, Currentness, RefreshReason, Errors, MESSAGES,
    DEFAULT_POLICY, policyOf, can, objectiveOf, budgetProfileOf, budgetMaxOf, commercialContextOf, uiStateOf, buildContext, createAdHoc, engineInputs, completeness, validate, criterionRegistry,
    historyEvent, startSession, sameCustomer, transition, attachResult, setMode, createShortlist, applyOverride, recordFeedback, suggestPreferences, resolveSuggestion, snapshot, currentness, createRepository, checksum, deepFreeze, looksLikePII });
})();
