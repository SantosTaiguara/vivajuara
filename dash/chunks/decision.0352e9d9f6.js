/* Viva Juara — chunk "decision" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- configs (decision) ---- */
Object.assign(App.configs, {"decision":{"viva-juara":{"kind":"decision-policy","id":"viva-juara-decision","version":"1.0.0","developmentId":"viva-juara","status":"PUBLISHED","changeReason":"Tópico 56: primeira política da decisão comercial orientada ao cliente. Orquestra Fit (14), Recomendação (15) e Explicação (16) sem alterar nenhum cálculo. Valores de política (tamanhos, limiares) são padrões operacionais e podem ser revistos pelo negócio.","objectiveMap":{"ui":{"housing":"HOUSING","investment":"INVESTMENT","family":"HOUSING","premium":"UNDECIDED"},"customer":{"LIVE":"HOUSING","INVEST":"INVESTMENT","LIVE_OR_INVEST":"UNDECIDED","UNDECIDED":"UNDECIDED"},"note":"Preset 'premium' não diz se o cliente quer morar ou investir: vira UNDECIDED (nunca adivinhar). 'family' é preset de moradia."},"objectiveLabels":{"HOUSING":"Moradia","INVESTMENT":"Investimento","UNDECIDED":"Objetivo ainda não definido"},"shortlistPolicy":{"defaultSize":3,"maxSize":5,"allowBrokerReorder":true,"allowCustomerSelection":true,"requireReasonForManualOverride":true,"includeReviewWhenNoEligible":true,"reviewCategoriesAllowedInSuggestion":["AVAILABILITY"],"note":"Enquanto nenhum lote tiver disponibilidade confirmada, a shortlist sugerida pode usar candidatos em revisão SOMENTE por disponibilidade, sempre rotulados 'sujeito a confirmação'."},"workspaceModes":{"DISCOVER":{"candidates":10,"label":"Descobrir"},"SHORTLIST":{"candidates":5,"label":"Selecionar"},"COMPARE":{"candidates":4,"label":"Comparar"},"DECIDE":{"candidates":3,"label":"Decidir"}},"diversityPolicy":{"enabled":false,"diversityDimensions":["identity.blockId"],"maxNearDuplicateCandidates":2,"preserveTopRankedCandidate":true},"explanation":{"maxReasons":3,"maxTradeoffs":2,"brokerLevels":["L1","L2"],"clientLevels":["L0","L1"]},"readiness":{"minProfileCompleteness":0.5,"note":"Sem fórmula de multiplicação: cada eixo é avaliado e mostrado separadamente."},"refreshPolicy":{"onProfileChange":"REQUIRED","onAvailabilityChange":"SUGGEST","onPriceChange":"SUGGEST","onAnalysisChange":"SUGGEST","onMethodologyChange":"REQUIRED"},"overrideReasonCodes":["CUSTOMER_REQUESTED","BROKER_LOCAL_KNOWLEDGE","COMMERCIAL_NEGOTIATION","VISIT_CONTEXT","SPECIAL_CONDITION","OTHER"],"overrideReasonLabels":{"CUSTOMER_REQUESTED":"Pedido do cliente","BROKER_LOCAL_KNOWLEDGE":"Conhecimento local do corretor","COMMERCIAL_NEGOTIATION":"Negociação comercial","VISIT_CONTEXT":"Contexto da visita","SPECIAL_CONDITION":"Condição especial","OTHER":"Outro (descrever)"},"feedbackSuggestion":{"threshold":2,"note":"Sugestão de preferência a partir de feedback: só com o critério marcado pelo corretor e após N ocorrências; nunca aplicada sem confirmação."},"actionPolicy":{"COMPARE":{"automation":"SUGGEST_ONLY","requiredPermission":"lot.compare"},"SIMULATE":{"automation":"SUGGEST_ONLY"},"CONFIRM_BUDGET":{"automation":"SUGGEST_ONLY"},"CONFIRM_PREFERENCE":{"automation":"SUGGEST_ONLY"},"SCHEDULE_VISIT":{"automation":"USER_CONFIRMATION_REQUIRED"},"REQUEST_STATUS_CONFIRMATION":{"automation":"USER_CONFIRMATION_REQUIRED"},"PREPARE_PRESENTATION":{"automation":"USER_CONFIRMATION_REQUIRED","requiredPermission":"presentation.create"},"SHARE_SHORTLIST":{"automation":"USER_CONFIRMATION_REQUIRED","requiredPermission":"decision.share","requiresOnline":true},"FOLLOW_UP":{"automation":"USER_CONFIRMATION_REQUIRED"},"RESERVE":{"automation":"USER_CONFIRMATION_REQUIRED","requiresOnline":true,"note":"Reserva/proposta não pertencem ao domínio de decisão; nunca automáticas."}},"clientSafe":{"showBudgetRange":false,"showOutOfConstraintNote":true,"showFitScore":false},"permissions":{"keys":["decision.read","decision.create","decision.update","decision.override","decision.share"],"localDevice":["decision.read","decision.create","decision.update","decision.override"],"note":"Modo sem login (aparelho): leitura, criação, edição e curadoria locais, em memória. Compartilhar exige servidor (negado). Chaves ainda não registradas em security/permissions.json."},"security":{"classification":"CONFIDENTIAL","notesClassification":"RESTRICTED","persistOffline":false},"criteria":{"categoryByPrefix":{"commercial":"BUDGET","geometry":"GEOMETRY","location":"LOCATION","mobility":"LOCATION","environmental":"ENVIRONMENT","surroundings":"LIFESTYLE","identity":"LOCATION","availability":"COMMERCIAL","intelligence.scores":"LIFESTYLE","intelligence.notes":"LIFESTYLE"},"overrides":{"investment":{"category":"INVESTMENT"},"priceQuality":{"category":"INVESTMENT"},"housing":{"clientSafe":false},"family":{"clientSafe":false},"premium":{"clientSafe":false}},"displayOnly":[{"id":"pricePerM2","fieldKey":"commercial.pricePerM2","label":"Preço por m² (tabela)","category":"INVESTMENT","valueType":"MONEY"},{"id":"availability","fieldKey":"availability.status","label":"Situação comercial","category":"COMMERCIAL","valueType":"ENUM"}]}}}});
/* ---- decision/decisionDomain.js ---- */
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

/* ---- decision/decisionServices.js ---- */
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

/* ---- decision/decisionView.js ---- */
/* decision/decisionView.js — topic 56 UI strings (markup only: no DOM access, no state, no calculation).
   Input = App.decision.services.viewModel(result, …) / clientSafe(result, …) / quickViewBlock(…).
   Broker panel "O que mostrar a este cliente — e por quê": context line, stage (Descobrir · Selecionar · Comparar · Decidir),
   status, readiness, next step, candidate cards (facts before score; reasons, points of attention, availability caveat),
   the selection (shortlist) and its actions. Never promises valorização, never shows availability UNKNOWN as confirmed.
   data-act used: goLot, explain, cmp, openFind (existing) · decMode, decShortlist, decFavCust, decCompareShortlist, decPresent, decRefresh (new). */
App.decisionView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TONE = { CONFIRMED_OPTIONS: 'ok', OPTIONS_PENDING_CONFIRMATION: 'warn', NO_STRONG_MATCH: 'warn', NO_ELIGIBLE_LOTS: 'warn', INSUFFICIENT_CONTEXT: 'info', INVALID_CONTEXT: 'warn' };
  const ACT_LABEL = { decCompareShortlist: 'Comparar', decPresent: 'Preparar', openFind: 'Ajustar perfil' };
  function card(c, i) {
    const reasons = c.reasons.length ? `<ul class="dcs-pros" aria-label="Por que mostrar">${c.reasons.map(r => `<li><span aria-hidden="true">+</span> ${esc(r.text)}${r.facts && r.facts.length ? ` <span class="small">${esc(r.facts.join(' · '))}</span>` : ''}</li>`).join('')}</ul>` : '';
    const cons = c.tradeoffs.length ? `<ul class="dcs-cons" aria-label="Pontos de atenção">${c.tradeoffs.map(t => `<li class="sev-${esc(String(t.severity || '').toLowerCase())}"><span aria-hidden="true">!</span> ${esc(t.text)}</li>`).join('')}</ul>` : '';
    const obj = c.objective && c.objective.facts && c.objective.facts.length ? `<details class="dcs-obj"><summary>${esc(c.objective.title)}</summary><ul>${c.objective.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details>` : '';
    return `<li class="dcs-card${c.inShortlist ? ' in' : ''}" data-lot="${esc(c.lotId)}">
      <div class="dcs-ch"><button class="nm" data-act="goLot" data-id="${esc(c.lotId)}" aria-label="Ver ${esc(c.code)} no mapa">${esc(c.code)}</button><span class="dcs-pos">${esc(c.position)}</span>${c.tier ? `<span class="dcs-tier">${esc(c.tier)}</span>` : ''}</div>
      ${c.curated ? `<p class="small dcs-cur">${esc(c.curated)}</p>` : ''}${c.breach ? `<p class="dcs-breach">${esc(c.breach)}</p>` : ''}
      <p class="dcs-facts"><b>${esc(c.price)}</b> · ${esc(c.area)}</p>
      <p class="dcs-av ${c.availabilityTone === 'ok' ? 'ok' : 'warn'}">${esc(c.availability)}</p>
      ${reasons}${cons}
      ${c.fit ? `<p class="small">${esc(c.fit)} · ${esc(c.dataQuality)}</p>` : `<p class="small">${esc(c.dataQuality)}</p>`}
      ${c.financial ? `<p class="small dcs-fin">${esc(c.financial)}</p>` : ''}${obj}
      <div class="dcs-acts">
        <button class="lbtn small" data-act="goLot" data-id="${esc(c.lotId)}">Ver no mapa</button>
        <button class="lbtn small" data-act="explain" data-id="${esc(c.lotId)}" aria-label="Por que ${esc(c.code)} está nesta posição">Por quê?</button>
        <button class="lbtn small" data-act="decShortlist" data-id="${esc(c.lotId)}" data-op="${c.inShortlist ? 'remove' : 'add'}" aria-pressed="${!!c.inShortlist}">${c.inShortlist ? 'Tirar da seleção' : 'Adicionar à seleção'}</button>
        <button class="lbtn small" data-act="cmp" data-id="${esc(c.lotId)}" aria-pressed="${!!c.compared}">${c.compared ? 'Na comparação' : 'Comparar'}</button>
        <button class="lbtn small" data-act="decFavCust" data-id="${esc(c.lotId)}" aria-pressed="${!!c.favorite}">${c.favorite ? 'Favorito do cliente' : 'Favoritar para o cliente'}</button>
      </div></li>`;
  }
  /** panel(vm) → broker panel HTML (vm = App.decision.services.viewModel(result, { context, shortlist, … })) */
  function panel(vm) {
    if (!vm) return '';
    const h = vm.header, tone = TONE[vm.status.code] || 'info';
    let s = `<section class="dcs" aria-labelledby="dcsT"><header class="dcs-h"><h3 id="dcsT">${esc(h.title)}</h3>
      <p class="dcs-ctx small"><span>${esc(h.customerLabel)}</span> · <span>${esc(h.objective)}</span>${h.budget ? ` · <span>${esc(h.budget)}</span>` : ''}</p>
      <div class="seg dcs-modes" role="group" aria-label="Etapa da decisão">${h.modes.map(m => `<button data-act="decMode" data-mode="${esc(m.id)}" aria-pressed="${m.active}">${esc(m.label)}</button>`).join('')}</div></header>
      <div class="dcs-status ${tone}" role="status"><b>${esc(vm.status.title)}</b><p>${esc(vm.status.text)}</p></div>`;
    if (vm.validation.length) s += `<ul class="dcs-val small">${vm.validation.map(v => `<li>${esc(v)}</li>`).join('')}</ul>`;
    if (vm.readiness && vm.readiness.label) s += `<p class="dcs-ready"><b>${esc(vm.readiness.label)}</b>${vm.readiness.items.length ? ` <span class="small">· ${esc(vm.readiness.items.join(' · '))}</span>` : ''}</p>`;
    if (vm.nextAction) s += `<div class="dcs-nba"><span class="small">Próximo passo sugerido</span><p>${esc(vm.nextAction.text)}</p>${vm.nextAction.act ? `<button class="btn sm" data-act="${esc(vm.nextAction.act)}">${esc(ACT_LABEL[vm.nextAction.act] || 'Abrir')}</button>` : ''}${vm.otherActions.length ? `<p class="small">Depois: ${esc(vm.otherActions.map(a => a.text).join(' · '))}</p>` : ''}</div>`;
    if (vm.cards.length) s += `<ol class="dcs-cards">${vm.cards.map(card).join('')}</ol>`;
    if (vm.resolution.length) s += `<div class="dcs-res"><b>Para avançar</b><ul>${vm.resolution.map(r => `<li>${esc(r)}</li>`).join('')}</ul><p class="small">Nenhum critério é alterado sem a sua confirmação.</p></div>`;
    const sl = vm.shortlist;
    s += `<div class="dcs-sl"><p><b>Seleção para o cliente:</b> ${sl.count} de até ${sl.max}</p>`;
    if (sl.portfolio && sl.count) s += `<p class="small">${esc(sl.portfolio.coverageSummary.budgetCoverage)} · ${esc(sl.portfolio.coverageSummary.locationDiversity)}${sl.portfolio.gaps.length ? ' · ' + esc(sl.portfolio.gaps.join(' · ')) : ''}${sl.portfolio.duplicatedProfiles.length ? ' · Opções muito parecidas: ' + esc(sl.portfolio.duplicatedProfiles.join(', ')) : ''}</p>`;
    s += `<div class="dcs-acts"><button class="btn sm" data-act="decCompareShortlist"${sl.count < 2 ? ' disabled' : ''}>Comparar a seleção</button><button class="btn sm" data-act="decPresent"${sl.count < 1 ? ' disabled' : ''}>Apresentar a seleção</button><button class="lbtn small" data-act="decRefresh">Atualizar recomendação</button></div></div>`;
    if (vm.exclusions.length) s += `<details class="dcs-ex"><summary>Fora da recomendação</summary><ul class="small">${vm.exclusions.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small">Exigências não são afrouxadas automaticamente.</p></details>`;
    return s + `<ul class="dcs-cav small">${vm.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></section>`;
  }
  /** clientList(cs) → client-safe list (cs = App.decision.services.clientSafe(result, …)): facts only, no score, no internal codes */
  function clientList(cs) {
    if (!cs || !cs.items.length) return '';
    return `<section class="dcs dcs-client"><h3>${esc(cs.title)}</h3><ol class="dcs-cards">${cs.items.map(i => `<li class="dcs-card"><div class="dcs-ch"><b>${esc(i.lot)}</b></div><p class="dcs-facts"><b>${esc(i.price)}</b> · ${esc(i.area)}</p><p class="dcs-av warn">${esc(i.availability)}</p>
      ${i.highlights.length ? `<ul class="dcs-pros">${i.highlights.map(x => `<li><span aria-hidden="true">+</span> ${esc(x)}</li>`).join('')}</ul>` : ''}${i.attention ? `<p class="small">Atenção: ${esc(i.attention)}</p>` : ''}${i.note ? `<p class="small">${esc(i.note)}</p>` : ''}</li>`).join('')}</ol>
      <ul class="dcs-cav small">${cs.footer.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>`;
  }
  /** quickViewBlock(block) → "Para este cliente" block for the Quick View (block = App.decision.services.quickViewBlock(…)) */
  const quickView = b => b && b.lines.length ? `<div class="dcs-qv"><b>${esc(b.title)}</b><ul>${b.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : '';
  /** overrideConfirm({ lotCode, breaches, reasons }) → modal body asking for a reason when the lot breaks a criterion (FAIL stays visible) */
  function overrideConfirm({ lotId, lotCode, breaches = [], reasons = [] } = {}) {
    const B = { PRICE_ABOVE_MAX: 'Este lote excede o orçamento máximo informado.', REVIEW_REQUIRED: 'Este lote precisa de confirmação (disponibilidade ou dado pendente).', INELIGIBLE: 'Este lote não atende a uma exigência do cliente.' };
    const lines = [...new Set(breaches.map(b => B[b] || 'Este lote não atende a todos os critérios informados.'))];
    return `<div class="dcs-ov"><p><b>${esc(lotCode)}</b></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p>Deseja incluí-lo mesmo assim? O critério não atendido continua visível.</p>
      <div class="fld"><label for="dcsReason">Motivo</label><select id="dcsReason" data-in="decReason">${reasons.map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select></div>
      <div class="fld"><label for="dcsNote">Observação interna (não aparece para o cliente)</label><input id="dcsNote" data-in="decNote" maxlength="500"></div>
      <div class="acts2"><button class="btn pri" data-act="decShortlist" data-id="${esc(lotId)}" data-op="add" data-ack="1">Incluir assim mesmo</button><button class="btn" data-act="closeModal">Cancelar</button></div></div>`;
  }
  return Object.freeze({ panel, card, clientList, quickView, overrideConfirm, esc, ACTS: Object.freeze(['decMode', 'decShortlist', 'decFavCust', 'decCompareShortlist', 'decPresent', 'decRefresh']) });
})();

/* ---- chunk end ---- */
App.chunks._done("decision");
