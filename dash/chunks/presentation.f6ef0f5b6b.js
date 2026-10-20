/* Viva Juara — chunk "presentation" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- presentationmode/policy.js ---- */
/* presentationmode/policy.js — topic 41: the client-safe rules of the Presentation Mode, versioned.
   Enums · ClientSafeProjectionPolicy (allow-list, DENY BY DEFAULT) · PresentationRedactionRule + registered transforms
   (no arbitrary functions) · PresentationWordingPolicy (Data State / confidence / availability / price / financial /
   comparison wording in pt-BR) · CustomerDisplayPolicy · PresentationAlertPolicy · leak scanner (PII, internal keys,
   technical provenance, unsafe claims) used by preflight, snapshot and the share resolver.

   Rules: a value reaches an audience only if its path is explicitly allowed and not denied; unknown → removed (not hidden
   with CSS). Policy versions are immutable: a change of rules is a new version (old snapshots keep theirs and are
   re-evaluated through the safety record, never mutated). Nothing here reads the DB, recalculates scores or invents data. */
App.presentationMode = App.presentationMode || {};
App.presentationMode.policy = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const DefinitionStatus = E('DRAFT', 'READY', 'ARCHIVED'); // no PUBLISHED: distribution belongs to the ShareService (topic 42)
  const Purpose = E('INITIAL_OPTIONS', 'SHORTLIST', 'COMPARISON', 'INVESTMENT_REVIEW', 'FINANCIAL_REVIEW', 'VISIT_PREPARATION', 'NEGOTIATION_SUPPORT', 'GENERAL_PRESENTATION');
  const Audience = E('CUSTOMER', 'CUSTOMER_GROUP', 'INTERNAL_PREVIEW'); // INTERNAL_PREVIEW shows exactly what the customer will see
  const SnapshotStatus = E('READY', 'READY_WITH_WARNINGS', 'BLOCKED');
  const RuntimeMode = E('GUIDED', 'FREE_EXPLORE', 'MAP_FOCUSED', 'COMPARISON_FOCUSED');
  const DeviceProfile = E('DESKTOP', 'TABLET', 'MOBILE', 'EXTERNAL_DISPLAY');
  const SessionState = E('ACTIVE', 'PAUSED', 'ENDED');
  const DataMode = E('LIVE', 'SNAPSHOT');
  const BlockType = E('INTRO', 'DEVELOPMENT_OVERVIEW', 'CUSTOMER_OBJECTIVE', 'RECOMMENDATION_SUMMARY', 'LOT_HIGHLIGHT', 'LOT_DETAILS', 'COMPARISON', 'FINANCIAL_SIMULATION', 'MAP', 'LOCATION',
    'AVAILABILITY_STATUS', 'INVESTMENT_CONTEXT', 'ALERTS_CLIENT_SAFE', 'NEXT_STEPS', 'CUSTOM');
  /** block types that are internal by nature: asking for one in a client presentation is a data-exposure FAIL, not "unsupported" */
  const INTERNAL_BLOCK_TYPES = Object.freeze(['CUSTOMER_INTERNAL_NOTES', 'INTERNAL_NOTES', 'PRESENTER_NOTES', 'CRM', 'JOURNEY_STAGE', 'PIPELINE', 'AUDIT', 'DEBUG', 'TECHNICAL', 'PROVENANCE', 'RANKING_TRACE']);
  const RedactionAction = E('ALLOW', 'REDACT', 'HIDE', 'TRANSFORM');
  const AlertLevel = E('SHOW', 'SHOW_AS_CAVEAT', 'HIDE', 'BLOCK_PRESENTATION');
  const PreflightStatus = E('PASS', 'PASS_WITH_WARNINGS', 'FAIL');
  const BlockRenderState = E('READY', 'LOADING', 'UNAVAILABLE', 'ERROR', 'BLOCKED');
  const Criticality = E('OPTIONAL', 'IMPORTANT', 'CRITICAL');
  const SafetyStatus = E('SAFE', 'REVIEW_REQUIRED', 'REVOKED');
  const CustomerDisplay = E('PREFERRED_NAME', 'FIRST_NAME', 'FULL_NAME', 'ANONYMOUS');
  const FeedbackType = E('LIKED', 'DISLIKED', 'COMPARE', 'MORE_INFO', 'VISIT_INTEREST', 'FINANCIAL_INTEREST', 'OTHER');
  const LotAction = E('FOCUS_ON_MAP', 'COMPARE', 'OPEN_FINANCIAL', 'RECORD_INTEREST', 'REQUEST_VISIT', 'BACK');
  const AvailabilityProjection = E('AVAILABLE_CONFIRMED', 'STATUS_CONFIRMATION_REQUIRED', 'RESERVED', 'IN_PROPOSAL', 'SOLD', 'UNAVAILABLE'); // projections, not canonical statuses
  const PriceProjection = E('CURRENT_CONFIRMED', 'CURRENT_WITH_CAVEAT', 'NOT_AVAILABLE', 'CONFLICTED');
  const SimulationStatus = E('EXACT', 'PROJECTED', 'PARTIAL');
  const DataState = E('UNKNOWN', 'NOT_AVAILABLE', 'NOT_APPLICABLE', 'PENDING', 'CONFLICTED', 'STALE', 'WITHHELD');
  const FallbackPolicy = E('BLOCK', 'USE_LAST_SAFE_SNAPSHOT', 'ALLOW_PARTIAL_WITH_WARNING');

  const POLICY_VERSION = 'client-safe-41.1.0';
  const PC = () => (App.presentationConfig && App.presentationConfig.DEFAULTS) || {};

  // ---------------------------------------------------------------- ClientSafeProjectionPolicy
  /** Paths are relative to the projection being checked: canonical lot paths ("commercial.price") for lot data; the
      projection ViewModels below are built by allow-listed constructors, so their own keys are listed as "vm.*". */
  function buildPolicy() {
    const lotAllowed = (PC().clientSafeFields || []).slice();
    const lotDenied = [...((PC().hiddenFields || {}).client || []), 'provenance.*', 'metadata.*', 'intelligence.*', 'availability.notes', 'availability.reason', 'availability.proposalId', 'availability.sourceId', 'availability.revision',
      'commercial.priceTableId', 'commercial.priceTableVersion', 'identity.id', 'identity.externalCode'];
    return Object.freeze({
      id: 'CLIENT_SAFE_DEFAULT', version: POLICY_VERSION,
      allowedFieldPaths: Object.freeze([...new Set(lotAllowed)]),
      deniedFieldPaths: Object.freeze([...new Set(lotDenied)]),
      allowedBlockTypes: Object.freeze(Object.keys(BlockType)),
      redactionRules: Object.freeze([
        { targetPath: 'customer.displayName', action: 'TRANSFORM', transformId: 'SHOW_PREFERRED_OR_FIRST_NAME', reasonCode: 'MINIMIZE_PII' },
        { targetPath: 'customer.email', action: 'HIDE', reasonCode: 'CONTACT_DATA' }, { targetPath: 'customer.phone', action: 'HIDE', reasonCode: 'CONTACT_DATA' },
        { targetPath: 'customer.budget', action: 'HIDE', reasonCode: 'MINIMIZE_BY_DEFAULT' }, { targetPath: 'customer.notes', action: 'HIDE', reasonCode: 'INTERNAL_NOTE' },
        { targetPath: 'step.presenterHint', action: 'HIDE', transformId: 'HIDE_BROKER_NOTE', reasonCode: 'PRESENTER_ONLY' },
        { targetPath: 'lot.provenance', action: 'TRANSFORM', transformId: 'REMOVE_INTERNAL_SOURCE_IDS', reasonCode: 'TECHNICAL_PROVENANCE' },
        { targetPath: 'lot.intelligence.alerts', action: 'TRANSFORM', transformId: 'CLIENT_SAFE_ALERT_WORDING', reasonCode: 'ALERT_POLICY' },
        { targetPath: 'journey.stage', action: 'HIDE', reasonCode: 'INTERNAL_PIPELINE' }, { targetPath: 'recommendation.rankingTrace', action: 'HIDE', reasonCode: 'INTERNAL_TRACE' }
      ].map(Object.freeze)),
      wordingPolicyRef: 'pt-BR-41.1', staleDataPolicyRef: 'stale-caveat-41.1', unknownDataPolicyRef: 'unknown-never-zero-41.1', internalMetadataPolicyRef: 'strip-internal-41.1',
      showFitPercent: false, showCustomerBudget: false, customerDisplay: CustomerDisplay.PREFERRED_NAME, maxComparisonLots: 4
    });
  }
  let CURRENT = null;
  const current = () => CURRENT || (CURRENT = buildPolicy());
  /** a development/org may tighten (never loosen) the policy: overrides can only remove allowed paths or add denied ones */
  function derive(base, o = {}) {
    const deny = new Set([...base.deniedFieldPaths, ...(o.deniedFieldPaths || [])]);
    const allow = base.allowedFieldPaths.filter(p => !(o.removeAllowed || []).includes(p));
    const blocks = base.allowedBlockTypes.filter(t => !(o.removeBlockTypes || []).includes(t));
    if (!o.version || o.version === base.version) throw Object.assign(new Error('nova política exige nova versão'), { code: 'POLICY_VERSION_REQUIRED' });
    return Object.freeze({ ...base, ...o, version: o.version, allowedFieldPaths: Object.freeze(allow), deniedFieldPaths: Object.freeze([...deny]), allowedBlockTypes: Object.freeze(blocks), showFitPercent: !!(o.showFitPercent ?? base.showFitPercent), showCustomerBudget: !!(o.showCustomerBudget ?? base.showCustomerBudget) });
  }
  const match = (p, key) => p.endsWith('.*') ? key === p.slice(0, -2) || key.startsWith(p.slice(0, -1)) : p === key;
  /** isAllowedPath: denied wins; unlisted → false (deny by default) */
  function isAllowedPath(policy, key) {
    const pol = policy || current();
    if (pol.deniedFieldPaths.some(p => match(p, key))) return false;
    return pol.allowedFieldPaths.some(p => match(p, key));
  }
  /** projectLot(lot, policy) → { value, removed[] }: a NEW object with only the allowed leaf paths (the audience never receives the rest) */
  function projectLot(lot, policy) {
    const pol = policy || current(), removed = [], out = {};
    const walk = (o, prefix, target) => {
      for (const [k, v] of Object.entries(o || {})) {
        const key = prefix ? prefix + '.' + k : k;
        if (isAllowedPath(pol, key)) { target[k] = v == null ? v : JSON.parse(JSON.stringify(v)); continue; }
        if (v && typeof v === 'object' && !Array.isArray(v) && pol.allowedFieldPaths.some(p => p.startsWith(key + '.')) && !pol.deniedFieldPaths.some(p => match(p, key))) { target[k] = {}; walk(v, key, target[k]); continue; }
        removed.push(key);
      }
    };
    walk(lot, '', out);
    return { value: out, removed };
  }

  // ---------------------------------------------------------------- transforms (registered ids only)
  const firstToken = s => String(s || '').trim().split(/\s+/)[0] || null;
  const TRANSFORMS = Object.freeze({
    SHOW_FIRST_NAME_ONLY: c => c ? firstToken(c.preferredName || c.name || c.displayName) : null,
    SHOW_PREFERRED_OR_FIRST_NAME: c => c ? (c.preferredName ? String(c.preferredName).trim() : firstToken(c.name || c.displayName)) : null,
    SHOW_FULL_NAME: c => c ? String(c.name || c.displayName || '').trim() || null : null,
    ANONYMOUS: () => null,
    REMOVE_INTERNAL_SOURCE_IDS: prov => prov && typeof prov === 'object' ? { status: prov.status || null } : null,
    HIDE_BROKER_NOTE: () => undefined,
    CLIENT_SAFE_ALERT_WORDING: a => a ? { title: a.title || null, message: a.message || null } : null
  });
  const transform = (id, v) => { const f = TRANSFORMS[id]; if (!f) throw Object.assign(new Error(`transform não registrado: ${id}`), { code: 'UNKNOWN_TRANSFORM' }); return f(v); };
  /** CustomerDisplayPolicy → the only customer datum that may reach an audience surface */
  function customerLabel(customer, display) {
    const d = display || current().customerDisplay;
    if (!customer || d === 'ANONYMOUS') return null;
    const v = d === 'FULL_NAME' ? transform('SHOW_FULL_NAME', customer) : d === 'FIRST_NAME' ? transform('SHOW_FIRST_NAME_ONLY', customer) : transform('SHOW_PREFERRED_OR_FIRST_NAME', customer);
    return v && !/[@\d]/.test(v) ? v : null; // an email or a number typed as a name never becomes a label
  }

  // ---------------------------------------------------------------- PresentationWordingPolicy (pt-BR, factual, no jargon)
  const WORDING = Object.freeze({
    dataState: Object.freeze({ UNKNOWN: 'Informação não disponível', NOT_AVAILABLE: 'Não disponível', NOT_APPLICABLE: 'Não se aplica', PENDING: 'Informação a confirmar', CONFLICTED: 'Informação a confirmar',
      STALE: 'Sujeito a confirmação', WITHHELD: 'Informação não divulgada nesta apresentação' }),
    confidence: Object.freeze({ HIGH: 'Alta confiança', MEDIUM: 'Estimativa', LOW: 'Informação estimada', UNKNOWN: 'Informação a confirmar' }),
    provenance: Object.freeze({ CONFIRMED: null, CALCULATED: 'Calculado', ESTIMATED: 'Informação estimada', TO_CONFIRM: 'Informação a confirmar', UNKNOWN: 'Informação não disponível', CONFLICTED: 'Informação a confirmar', NOT_APPLICABLE: 'Não se aplica' }),
    availability: Object.freeze({ AVAILABLE_CONFIRMED: 'Disponível', STATUS_CONFIRMATION_REQUIRED: 'Disponibilidade sujeita a confirmação.', RESERVED: 'Reservado', IN_PROPOSAL: 'Em proposta', SOLD: 'Vendido', UNAVAILABLE: 'Indisponível' }),
    availabilityCaveat: 'Informação de disponibilidade precisa ser confirmada.',
    price: Object.freeze({ label: 'Preço de tabela', staleCaveat: 'Condição sujeita a confirmação.', notAvailable: 'Preço não disponível', conflicted: 'Informação a confirmar' }),
    financial: Object.freeze({ PROJECTED: 'Projeção', PROJECTED_TEXT: 'Fluxo projetado conforme premissas informadas.', PARTIAL: 'Simulação parcial', EXACT: 'Condição da tabela vigente',
      installmentProjected: 'Parcela projetada conforme premissas informadas.', indexUnknown: 'Valores sem correção pelo IGP-M: o índice futuro não é conhecido.' }),
    comparison: Object.freeze({ INSUFFICIENT_DATA: 'Não há dados suficientes para comparar este critério.', CONTEXT_REQUIRED: 'Este critério depende das preferências do cliente.', NO_CLEAR_WINNER: 'Sem diferença relevante entre as opções.',
      TIE: 'Empate entre as opções neste critério.', NOT_COMPARABLE: 'Critério informativo, sem comparação direta.' }),
    fit: Object.freeze({ HIGH: 'Alta compatibilidade', MEDIUM: 'Boa compatibilidade', LOW: 'Compatibilidade parcial', PARTIAL: 'Compatibilidade calculada com parte das preferências informadas.', NONE: null }),
    investment: Object.freeze({ priceChange: 'variação do preço de tabela', caveat: 'Preço de tabela nominal, sem correção; não representa valorização nem rentabilidade.' }),
    freshness: days => `Esta apresentação foi preparada há ${days} ${days === 1 ? 'dia' : 'dias'}. Confirme preço e disponibilidade.`,
    preparedAt: ts => `Dados da apresentação preparados em ${ts}`,
    noRecommendation: 'Nenhuma recomendação preparada para este cliente.'
  });

  // ---------------------------------------------------------------- PresentationAlertPolicy
  /** level(alert, policy) — client-safe alerts reuse the domain severity (topic 36); fields outside the allow-list stay internal */
  function alertLevel(alert, opts = {}) {
    if (!alert) return 'HIDE';
    if (alert.internal || alert.audience === 'INTERNAL') return 'HIDE';
    if (alert.fieldKey && !isAllowedPath(opts.policy, alert.fieldKey)) return 'HIDE';
    if (opts.block === 'FINANCIAL_SIMULATION' && alert.code === 'PRICE_CONFLICT' && alert.severity === 'CRITICAL') return 'BLOCK_PRESENTATION';
    if (alert.severity === 'CRITICAL' || alert.severity === 'IMPORTANT') return 'SHOW';
    if (alert.severity === 'ATTENTION') return 'SHOW_AS_CAVEAT';
    return 'HIDE'; // INFO / low-confidence technical warnings
  }

  // ---------------------------------------------------------------- leak scanner (payload that would reach an audience)
  const INTERNAL_KEYS = /^(notes?|internalNotes?|brokerNotes?|presenterHint|presenterNotes?|sourceId|sourceIds|sourceRef|sourceRefs|provenance|rankingTrace|trace|diagnostics|auditId|auditIds|crmId|externalCrmId|externalCode|roleAssignments?|assignments?|assignedTo|lossReason|syncConflicts?|tieBreak|tieBreakUsed|reviewReasons|keyReasonCodes|summaryReasonCodes|reasonCodes|debug|journeyStage|stage|pipeline|budget|budgetMax|budgetMin|email|e-?mail|phone|telefone|whatsapp|cpf|cnpj|rg|address|endereco|password|senha|token|secret|customerId|profileVersionId|organizationId|presenterUserId|createdBy|updatedBy|generatedBy)$/i;
  const VALUE_PATTERNS = Object.freeze([
    { code: 'PII_EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { code: 'PII_CPF', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
    { code: 'PII_PHONE', re: /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/ },
    { code: 'TECHNICAL_PROVENANCE', re: /SourceRef=|DOC_\d+\/PAGE|\b(?:analysis|aerial|kmz|plan-geometry|launch-event|price-table|solar-model|renders)-v\d\b/i },
    { code: 'INTERNAL_LOT_ID', re: /\b[A-Z]{1,4}-Q[A-Z0-9]{1,4}-L\d{4}\b/ },
    { code: 'UNSAFE_CLAIM', re: /rentabilidade garantida|retorno garantido|valoriza[çc][ãa]o (garantida|certa|prevista)|vai valorizar|chance de (satisfa|compra)|probabilidade de compra|pre[çc]o atual garantido|lote perfeito|condi[çc][ãa]o (final )?garantida/i },
    { code: 'HTML_MARKUP', re: /<\s*\/?\s*[a-z][^>]*>/i }
  ]);
  /** scanPayload(payload, { allowKeys }) → issues [{ code, path }] — runs on the exact object an audience would receive */
  function scanPayload(payload, opts = {}) {
    const issues = [], allowKeys = new Set(opts.allowKeys || []);
    const walk = (v, path) => {
      if (v == null) return;
      if (typeof v === 'string') { for (const p of VALUE_PATTERNS) if (p.re.test(v)) issues.push({ code: p.code, path }); return; }
      if (typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      for (const [k, x] of Object.entries(v)) {
        const p = path ? `${path}.${k}` : k;
        if (INTERNAL_KEYS.test(k) && !allowKeys.has(k) && x != null && !(Array.isArray(x) && !x.length)) issues.push({ code: /email|phone|telefone|whatsapp|cpf|cnpj|rg|address|endereco|customerId/i.test(k) ? 'PII_FIELD' : 'INTERNAL_FIELD', path: p });
        walk(x, p);
      }
    };
    walk(payload, '');
    return issues;
  }
  /** plain text for CUSTOM blocks: no HTML, no script, bounded */
  function safeText(s, max = 600) {
    if (s == null) return null;
    const t = String(s);
    if (/<\s*\/?\s*[a-z][^>]*>|javascript:|on\w+\s*=/i.test(t)) return { ok: false, code: 'HTML_NOT_ALLOWED' };
    if (t.length > max) return { ok: false, code: 'TEXT_TOO_LONG' };
    return { ok: true, value: t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') };
  }

  return Object.freeze({ DefinitionStatus, Purpose, Audience, SnapshotStatus, RuntimeMode, DeviceProfile, SessionState, DataMode, BlockType, INTERNAL_BLOCK_TYPES, RedactionAction, AlertLevel,
    PreflightStatus, BlockRenderState, Criticality, SafetyStatus, CustomerDisplay, FeedbackType, LotAction, AvailabilityProjection, PriceProjection, SimulationStatus, DataState, FallbackPolicy,
    POLICY_VERSION, current, derive, isAllowedPath, projectLot, TRANSFORMS, transform, customerLabel, WORDING, alertLevel, scanPayload, safeText, INTERNAL_KEYS });
})();

/* ---- presentationmode/projection.js ---- */
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

/* ---- presentationmode/domain.js ---- */
/* presentationmode/domain.js — topic 41: PresentationDefinition (mutable, revisioned) · PresentationBlockTypeRegistry +
   block schemas · PresentationTemplate · PresentationPreflightService (+ override policy) · PresentationVersionRefs ·
   PresentationSnapshotService (immutable, checksum, create-only) · LIVE projection (with stale-response protection) ·
   PresentationFreshnessEvaluator · PresentationSnapshotSafetyRecord · PresentationRepository (in-memory reference,
   tenant-scoped) · permissions / audit / domain events.

   Three separate things: the Definition is edited; the Snapshot is the frozen, client-safe, reproducible material; the
   Session (runtime.js) only navigates a Snapshot. The audience payload (snapshot.audience) is the ONLY thing a renderer
   or the ShareService (topic 42) may read; every internal ref (lot ids, customer id, versions) stays outside it.
   Frontend-only limitation: in the static panel the canonical lots are already in the page (public dataset, no customer
   PII); authoritative redaction for private data must run server-side with the same policy (docs/PRESENTATION_SECURITY_AND_REDACTION.md). */
App.presentationMode = App.presentationMode || {};
App.presentationMode.domain = (() => {
  const P = App.presentationMode.policy, PJ = App.presentationMode.projection, W = P.WORDING, F = App.fmt;
  const SCHEMA_VERSION = 1;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowIso = o => (o && o.now) || new Date().toISOString();
  const stable = v => v == null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  /** two independent FNV-1a 32-bit passes (different offsets) → 16 hex chars; integrity/reproducibility check, not a security MAC */
  function checksum(v) {
    const s = stable(v); let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 0x01000193) >>> 0; b ^= c; b = Math.imul(b, 0x01000193) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function opaqueId(prefix) {
    let r = null;
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) r = Array.from(crypto.getRandomValues(new Uint8Array(10)), x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { r = null; }
    if (!r) { opaqueId.n = (opaqueId.n || 0) + 1; r = Date.now().toString(36) + opaqueId.n.toString(36); } // ids are references, never secrets
    return prefix + '_' + r;
  }
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } else if (o && typeof o === 'object') for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !Object.isFrozen(o[k])) deepFreeze(o[k]); return o; };
  const plain = o => JSON.parse(JSON.stringify(o === undefined ? null : o));

  // ---------------------------------------------------------------- permissions (deny by default)
  /** Topic 41 permission keys. They are not yet in the backend registry (config/security/permissions.json mirrors it and
      only the backend adds keys): until then each key maps to an existing registry key ("interim") or to null = always
      denied in the frontend (override, presenter notes, theme management are never granted locally). */
  const PERMISSIONS = Object.freeze({
    'presentation.read': 'lot.view', 'presentation.create': 'lot.view', 'presentation.update': 'lot.view', 'presentation.archive': 'lot.view', 'presentation.preview': 'lot.view',
    'presentation.snapshot.create': 'lot.view', 'presentation.session.start': 'lot.view', 'presentation.feedback.record': 'lot.view',
    'presentation.internalNotes.read': null, 'presentation.preflight.override': null, 'presentation.theme.manage': null
  });
  /** can(ctx, key): ctx.can (backend-derived decisions) wins; else App.authz on the interim key; unknown key → false */
  function can(ctx, key) {
    if (!(key in PERMISSIONS)) return false;
    if (ctx && typeof ctx.can === 'function') return ctx.can(key) === true;
    const k = PERMISSIONS[key]; if (!k) return false;
    try { return !!(App.authz && App.authz.can(k, ctx && ctx.developmentId ? { developmentId: ctx.developmentId } : undefined)); } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- events + audit (opaque refs only, no PII)
  const EVENTS = [], AUDIT = [], MAX = 300;
  const EVENT_TYPES = Object.freeze(['PresentationSnapshotCreated', 'PresentationStarted', 'PresentationStepViewed', 'PresentationLotOpened', 'PresentationComparisonViewed', 'PresentationFinancialViewed',
    'PresentationFeedbackRecorded', 'PresentationEnded', 'PresentationCompleted']);
  const AUDIT_TYPES = Object.freeze(['PresentationCreated', 'PresentationUpdated', 'PresentationSnapshotCreated', 'PresentationPreflightBlocked', 'PresentationPreflightOverridden', 'PresentationStarted', 'PresentationEnded', 'PresentationArchived', 'PresentationSnapshotSafetyChanged']);
  function emit(type, data = {}, o = {}) {
    if (!EVENT_TYPES.includes(type)) throw err('UNKNOWN_EVENT', type);
    const ev = Object.freeze({ type, at: nowIso(o), ...sanitizeRefs(data) }); EVENTS.push(ev); if (EVENTS.length > MAX) EVENTS.shift(); return ev;
  }
  function audit(type, data = {}, o = {}) {
    if (!AUDIT_TYPES.includes(type)) throw err('UNKNOWN_AUDIT', type);
    const ev = Object.freeze({ type, at: nowIso(o), ...sanitizeRefs(data) }); AUDIT.push(ev); if (AUDIT.length > MAX) AUDIT.shift();
    try { if (App.authz && App.authz.audit) App.authz.audit.record({ action: type, resourceType: 'presentation', resourceId: data.snapshotId || data.definitionId || null, organizationId: data.organizationId, outcome: /Blocked/.test(type) ? 'DENIED' : 'SUCCESS', reasonCode: data.reasonCode || null, metadata: { refs: ev } }, o.now ? { now: o.now } : undefined); } catch (e) { /* tenant not resolvable in the static panel: the local log keeps it */ }
    return ev;
  }
  /** only opaque references and codes survive; names, contacts, notes and free text never enter events/audit */
  function sanitizeRefs(d) {
    const out = {};
    for (const [k, v] of Object.entries(d || {})) {
      if (/name|email|phone|telefone|note|text|reason$|label/i.test(k) && k !== 'reasonCode') continue;
      out[k] = Array.isArray(v) ? v.filter(x => typeof x !== 'object').slice(0, 20) : v && typeof v === 'object' ? undefined : v;
    }
    return out;
  }

  // ---------------------------------------------------------------- PresentationBlockTypeRegistry + schemas
  const str = max => v => typeof v === 'string' && v.length <= max && P.safeText(v, max).ok;
  const bool = v => typeof v === 'boolean', int = (a, b) => v => Number.isInteger(v) && v >= a && v <= b, lotId = v => typeof v === 'string' && v.length <= 40;
  const listOf = (f, max) => v => Array.isArray(v) && v.length <= max && v.every(f), oneOf = xs => v => xs.includes(v);
  const BLOCKS = {
    INTRO: { sourceDomain: 'DEVELOPMENT', schema: { headline: str(120), text: str(600) } },
    DEVELOPMENT_OVERVIEW: { sourceDomain: 'DEVELOPMENT', schema: {} },
    CUSTOMER_OBJECTIVE: { sourceDomain: 'CUSTOMER', schema: { showBudget: bool } },
    RECOMMENDATION_SUMMARY: { sourceDomain: 'RECOMMENDATION', schema: { max: int(1, 6) } },
    LOT_HIGHLIGHT: { sourceDomain: 'LOT', schema: { lotId }, required: ['lotId'] },
    LOT_DETAILS: { sourceDomain: 'LOT', schema: { lotId, fields: listOf(v => typeof v === 'string', 30) }, required: ['lotId'] },
    COMPARISON: { sourceDomain: 'COMPARISON', schema: {} },
    FINANCIAL_SIMULATION: { sourceDomain: 'FINANCIAL', schema: { lotId, simulationRef: str(80), planIds: listOf(v => typeof v === 'string', 8) }, required: ['lotId', 'simulationRef'] },
    MAP: { sourceDomain: 'MAP', schema: { showAvailability: bool } },
    LOCATION: { sourceDomain: 'LOT', schema: {} },
    AVAILABILITY_STATUS: { sourceDomain: 'LOT', schema: { claim: oneOf(['NONE', 'AVAILABLE_NOW']) } },
    INVESTMENT_CONTEXT: { sourceDomain: 'LOT', schema: {} },
    ALERTS_CLIENT_SAFE: { sourceDomain: 'LOT', schema: {} },
    NEXT_STEPS: { sourceDomain: 'JOURNEY', schema: { items: listOf(oneOf(Object.keys(PJ.NEXT_STEP)), 6) } },
    CUSTOM: { sourceDomain: 'DEVELOPMENT', schema: { text: str(600) }, required: ['text'] }
  };
  const BLOCK_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(BLOCKS).map(([type, b]) => [type, Object.freeze({ type, sourceDomain: b.sourceDomain, configSchemaRef: `block.${type}.v1`,
    projectionServiceId: `presentation.projection.${type}`, supportsLive: true, supportsSnapshot: true, clientSafeByDefault: true, requiredPermission: 'presentation.read', configKeys: Object.freeze(Object.keys(b.schema)) })])));
  /** validateBlockConfig(block) → [{ code, key }]: unknown keys and wrong types are errors (no free-form config) */
  function validateBlockConfig(block) {
    const def = BLOCKS[block.type]; if (!def) return [{ code: 'UNSUPPORTED_BLOCK', key: null }];
    const errors = [], cfg = block.config || {};
    for (const [k, v] of Object.entries(cfg)) { if (!def.schema[k]) errors.push({ code: 'UNKNOWN_CONFIG_KEY', key: k }); else if (v != null && !def.schema[k](v)) errors.push({ code: 'INVALID_CONFIG_VALUE', key: k }); }
    for (const k of def.required || []) if (cfg[k] == null) errors.push({ code: 'MISSING_CONFIG', key: k });
    if (block.title != null && !str(120)(block.title)) errors.push({ code: 'INVALID_TITLE', key: 'title' });
    return errors;
  }

  // ---------------------------------------------------------------- templates (no live data)
  const T = (code, name, purpose, blocks) => Object.freeze({ id: 'tpl_' + code.toLowerCase(), organizationId: null, code, name, purpose, version: '1.0.0', status: 'ACTIVE',
    blockTemplates: Object.freeze(blocks.map(b => Object.freeze(typeof b === 'string' ? { type: b } : b))), storylineTemplate: Object.freeze(blocks.map(b => typeof b === 'string' ? b : b.type)) });
  const TEMPLATES = Object.freeze({
    INITIAL_OPTIONS: T('INITIAL_OPTIONS', 'Opções iniciais', 'INITIAL_OPTIONS', ['INTRO', 'CUSTOMER_OBJECTIVE', { type: 'RECOMMENDATION_SUMMARY', criticality: 'IMPORTANT' }, { type: 'LOT_HIGHLIGHT', perLot: 3 }, { type: 'COMPARISON', criticality: 'OPTIONAL' }, 'MAP', 'NEXT_STEPS']),
    SHORTLIST: T('SHORTLIST', 'Seleção de lotes', 'SHORTLIST', ['INTRO', { type: 'LOT_HIGHLIGHT', perLot: 6 }, { type: 'COMPARISON', criticality: 'OPTIONAL' }, 'MAP', 'NEXT_STEPS']),
    COMPARISON: T('COMPARISON', 'Comparação', 'COMPARISON', ['INTRO', { type: 'COMPARISON', criticality: 'CRITICAL' }, 'MAP', 'NEXT_STEPS']),
    INVESTMENT_REVIEW: T('INVESTMENT_REVIEW', 'Análise para investimento', 'INVESTMENT_REVIEW', ['INTRO', 'CUSTOMER_OBJECTIVE', 'LOCATION', { type: 'LOT_HIGHLIGHT', perLot: 4 }, 'INVESTMENT_CONTEXT', { type: 'COMPARISON', criticality: 'OPTIONAL' }, { type: 'FINANCIAL_SIMULATION', perLot: 1, criticality: 'IMPORTANT' }, 'NEXT_STEPS']),
    FINANCIAL_REVIEW: T('FINANCIAL_REVIEW', 'Condições de pagamento', 'FINANCIAL_REVIEW', [{ type: 'LOT_DETAILS', perLot: 1 }, 'AVAILABILITY_STATUS', { type: 'FINANCIAL_SIMULATION', perLot: 1, criticality: 'CRITICAL' }, 'NEXT_STEPS']),
    VISIT_PREPARATION: T('VISIT_PREPARATION', 'Preparação de visita', 'VISIT_PREPARATION', ['INTRO', { type: 'LOT_HIGHLIGHT', perLot: 4 }, 'LOCATION', 'MAP', { type: 'NEXT_STEPS', config: { items: ['VISIT', 'CONFIRM_AVAILABILITY'] } }]),
    GENERAL_PRESENTATION: T('GENERAL_PRESENTATION', 'Apresentação geral', 'GENERAL_PRESENTATION', ['INTRO', 'DEVELOPMENT_OVERVIEW', 'MAP', 'NEXT_STEPS'])
  });
  /** expandTemplate(template, lotIds, opts) → { contentBlocks, storyline } — lot blocks repeat per lot in presentation order; sensitive blocks are never auto-added */
  function expandTemplate(tpl, lotIds = [], opts = {}) {
    if (!tpl || tpl.status !== 'ACTIVE') throw err('TEMPLATE_NOT_ACTIVE', 'Template indisponível.');
    const blocks = []; let n = 0;
    const add = (b, cfg) => { n++; blocks.push({ id: 'b' + n, type: b.type, title: null, enabled: true, config: { ...(b.config || {}), ...cfg }, visibilityPolicyRef: P.POLICY_VERSION, order: n, criticality: b.criticality || 'OPTIONAL' }); };
    for (const b of tpl.blockTemplates) {
      if (b.type === 'FINANCIAL_SIMULATION' && !opts.simulationRefs) continue; // needs an existing simulation result
      if (b.type === 'RECOMMENDATION_SUMMARY' && !opts.hasRecommendation) continue;
      if (b.type === 'COMPARISON' && !opts.hasComparison) continue;
      if (b.type === 'CUSTOMER_OBJECTIVE' && !opts.hasCustomer) continue;
      if (b.perLot) { for (const id of lotIds.slice(0, b.perLot)) add(b, b.type === 'FINANCIAL_SIMULATION' ? { lotId: id, simulationRef: opts.simulationRefs[id] } : { lotId: id }); continue; }
      add(b, {});
    }
    const finals = blocks.filter(b => !(b.type === 'FINANCIAL_SIMULATION' && !b.config.simulationRef));
    finals.forEach((b, i) => { b.order = i + 1; });
    const steps = finals.map((b, i) => ({ id: 'st' + (i + 1), blockId: b.id, order: i + 1, title: null, navigationLabel: null, skippable: b.criticality !== 'CRITICAL', presenterHint: null }));
    return { contentBlocks: finals, storyline: { steps, startStepId: steps.length ? steps[0].id : null, allowFreeNavigation: true, allowReturnToMap: true, allowLotJump: true }, templateRef: `${tpl.code}@${tpl.version}` };
  }

  // ---------------------------------------------------------------- PresentationDefinition
  const LIMITS = Object.freeze({ maxLots: 12, maxBlocks: 30 });
  function validateDefinition(d) {
    const e = [];
    if (!d.organizationId) e.push('organizationId'); if (!d.developmentId) e.push('developmentId');
    if (!P.Purpose[d.purpose]) e.push('purpose'); if (!P.Audience[d.audience]) e.push('audience');
    if (!str(120)(d.title || '')) e.push('title'); if (d.subtitle != null && !str(200)(d.subtitle)) e.push('subtitle');
    if (!Array.isArray(d.lotIds) || d.lotIds.length > LIMITS.maxLots || new Set(d.lotIds).size !== d.lotIds.length) e.push('lotIds');
    if (!Array.isArray(d.contentBlocks) || d.contentBlocks.length > LIMITS.maxBlocks) e.push('contentBlocks');
    return e;
  }
  /** create(ctx, input) — ctx = { organizationId, userId, can?, now? }. organizationId always comes from the context, never from input. */
  function createDefinition(ctx, input = {}) {
    if (!can(ctx, 'presentation.create')) throw err('FORBIDDEN', 'Você não possui permissão para criar apresentações.');
    const at = nowIso(ctx);
    const d = { id: opaqueId('prd'), organizationId: ctx.organizationId, developmentId: input.developmentId, customerId: input.customerId || null, journeyId: input.journeyId || null,
      title: input.title || 'Apresentação', subtitle: input.subtitle || null, purpose: input.purpose || 'GENERAL_PRESENTATION', audience: input.audience || 'CUSTOMER',
      contentBlocks: plain(input.contentBlocks || []), storyline: plain(input.storyline || { steps: [], startStepId: null, allowFreeNavigation: true, allowReturnToMap: true, allowLotJump: true }),
      lotIds: (input.lotIds || []).slice(), comparisonSessionId: input.comparisonSessionId || null, recommendationResultId: input.recommendationResultId || null, favoriteCollectionId: input.favoriteCollectionId || null,
      financialSimulationRefs: (input.financialSimulationRefs || []).slice(), themeRef: input.themeRef || null, templateRef: input.templateRef || null, sourceKind: input.sourceKind || 'MANUAL',
      lifecycleStatus: 'DRAFT', createdAt: at, updatedAt: at, createdBy: ctx.userId || null, updatedBy: null, recordRevision: 1, schemaVersion: SCHEMA_VERSION };
    const bad = validateDefinition(d); if (bad.length) throw err('INVALID_DEFINITION', 'Definição inválida: ' + bad.join(', '), { fields: bad });
    audit('PresentationCreated', { organizationId: d.organizationId, definitionId: d.id }, ctx);
    return deepFreeze(d);
  }
  /** sources: lot order follows the source (rank / collection / comparison); the presentation order is then curated separately */
  const fromRecommendation = (ctx, { recommendation, max = 3, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'RECOMMENDATION', recommendationResultId: recommendation.id,
    lotIds: (recommendation.result.recommendations || []).slice(0, max).map(r => r.lotId), purpose: rest.purpose || 'INITIAL_OPTIONS' });
  const fromFavorites = (ctx, { collection, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'FAVORITES', favoriteCollectionId: collection.id, lotIds: [...new Set(collection.lotIds)].slice(0, LIMITS.maxLots), purpose: rest.purpose || 'SHORTLIST' });
  const fromComparison = (ctx, { session, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'COMPARISON', comparisonSessionId: session.id, lotIds: session.candidateIds.slice(), purpose: rest.purpose || 'COMPARISON' });
  /** revise(def, patch, expectedRevision, ctx) → new frozen definition (optimistic concurrency); READY returns to DRAFT on edit */
  function revise(def, patch, expectedRevision, ctx = {}) {
    if (!can(ctx, 'presentation.update')) throw err('FORBIDDEN', 'Você não possui permissão para editar apresentações.');
    if (def.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Apresentação não encontrada.');
    if (def.lifecycleStatus === 'ARCHIVED') throw err('ARCHIVED', 'Apresentação arquivada não pode ser editada.');
    if (expectedRevision !== def.recordRevision) throw err('REVISION_CONFLICT', 'Esta apresentação foi alterada por outra pessoa. Recarregue antes de salvar.', { currentRevision: def.recordRevision });
    const allowed = ['title', 'subtitle', 'purpose', 'audience', 'contentBlocks', 'storyline', 'lotIds', 'customerId', 'journeyId', 'comparisonSessionId', 'recommendationResultId', 'favoriteCollectionId', 'financialSimulationRefs', 'themeRef', 'templateRef'];
    const bad = Object.keys(patch).filter(k => !allowed.includes(k)); if (bad.length) throw err('FIELD_NOT_EDITABLE', 'Campos não editáveis: ' + bad.join(', '));
    const next = { ...plain(def), ...plain(patch), lifecycleStatus: def.lifecycleStatus === 'READY' ? 'DRAFT' : def.lifecycleStatus, recordRevision: def.recordRevision + 1, updatedAt: nowIso(ctx), updatedBy: ctx.userId || null };
    const v = validateDefinition(next); if (v.length) throw err('INVALID_DEFINITION', 'Definição inválida: ' + v.join(', '), { fields: v });
    audit('PresentationUpdated', { organizationId: def.organizationId, definitionId: def.id, revision: next.recordRevision }, ctx);
    return deepFreeze(next);
  }
  /** reorderLots: a permutation of the current lots (curated order ≠ recommendation rank, which stays in the source result) */
  function reorderLots(def, order, ctx) {
    const same = order.length === def.lotIds.length && order.every(id => def.lotIds.includes(id)) && new Set(order).size === order.length;
    if (!same) throw err('INVALID_ORDER', 'A nova ordem deve conter exatamente os mesmos lotes.');
    return revise(def, { lotIds: order.slice() }, def.recordRevision, ctx);
  }
  const applyTemplate = (def, code, ctx, opts = {}) => { const tpl = TEMPLATES[code]; if (!tpl) throw err('TEMPLATE_NOT_FOUND', 'Template não encontrado.'); const x = expandTemplate(tpl, def.lotIds, { hasRecommendation: !!def.recommendationResultId, hasComparison: !!def.comparisonSessionId, hasCustomer: !!def.customerId, ...opts }); return revise(def, { contentBlocks: x.contentBlocks, storyline: x.storyline, templateRef: x.templateRef, purpose: tpl.purpose }, def.recordRevision, ctx); };
  function markReady(def, pre, ctx = {}) {
    if (!pre || pre.status === 'FAIL') throw err('PREFLIGHT_REQUIRED', 'A apresentação precisa passar na verificação antes de ficar pronta.');
    if (pre.definitionRevision !== def.recordRevision) throw err('PREFLIGHT_OUTDATED', 'A apresentação mudou depois da verificação. Verifique novamente.');
    return deepFreeze({ ...plain(def), lifecycleStatus: 'READY', updatedAt: nowIso(ctx), recordRevision: def.recordRevision }); // status-only change keeps the revision the preflight saw
  }
  function archive(def, ctx = {}) {
    if (!can(ctx, 'presentation.archive')) throw err('FORBIDDEN', 'Você não possui permissão para arquivar apresentações.');
    audit('PresentationArchived', { organizationId: def.organizationId, definitionId: def.id }, ctx);
    return deepFreeze({ ...plain(def), lifecycleStatus: 'ARCHIVED', updatedAt: nowIso(ctx), recordRevision: def.recordRevision + 1 });
  }

  // ---------------------------------------------------------------- projection of one block (client-safe payload)
  const lotLabel = l => F.formatLotTitle(l.identity.blockId, l.identity.lotNumber);
  function blockPayload(block, def, src, pctx) {
    const c = block.config || {}, R = src.resolve, lots = pctx.lots;
    switch (block.type) {
      case 'INTRO': return { headline: c.headline || def.title, subtitle: def.subtitle || null, text: c.text || null, customerLabel: pctx.customerLabel };
      case 'DEVELOPMENT_OVERVIEW': return PJ.developmentOverview(src.dev);
      case 'CUSTOMER_OBJECTIVE': return src.customer && src.customer.profile ? PJ.customerObjective(src.customer.profile, { ...pctx, showBudget: !!c.showBudget }) : null;
      case 'RECOMMENDATION_SUMMARY': return src.recommendation ? PJ.recommendation(src.recommendation.result, { ...pctx, resolve: R, max: c.max || 3 }) : null;
      case 'LOT_HIGHLIGHT': { const l = R(c.lotId); return l ? { card: PJ.lotCard(l, pctx) } : null; }
      case 'LOT_DETAILS': { const l = R(c.lotId); return l ? PJ.lotDetails(l, c.fields, pctx) : null; }
      case 'COMPARISON': return src.comparison && src.comparison.evaluation ? PJ.comparison(src.comparison.evaluation, { ...pctx, resolve: R }) : null;
      case 'FINANCIAL_SIMULATION': { const l = R(c.lotId), s = (src.simulations || {})[c.simulationRef]; return l && s ? { card: PJ.lotCard(l, pctx), simulation: PJ.financial(s, { planIds: c.planIds }) } : null; }
      case 'MAP': return PJ.map({ ...pctx, developmentId: def.developmentId, lots, comparisonLots: src.comparison && src.comparison.evaluation ? src.comparison.evaluation.candidateIds.map(R) : [],
        recommendationLots: src.recommendation ? (src.recommendation.result.recommendations || []).map(r => R(r.lotId)) : [], showAvailability: c.showAvailability !== false });
      case 'LOCATION': return { items: lots.map(l => ({ lotLabel: lotLabel(l), rows: ['mobility.routeDistanceToGateM', 'mobility.routeDistanceToLeisureM', 'location.distanceToClubLinearM', 'location.distanceToSquareM', 'location.distanceToGreenAreaM'].map(k => PJ.value(l, k, pctx)).filter(Boolean) })) };
      case 'AVAILABILITY_STATUS': return { items: lots.map(l => ({ lotLabel: lotLabel(l), availability: PJ.availability(l, pctx) })) };
      case 'INVESTMENT_CONTEXT': return PJ.investmentContext(lots, pctx);
      case 'ALERTS_CLIENT_SAFE': return { items: lots.map(l => ({ lotLabel: lotLabel(l), alerts: PJ.alerts(l, pctx) })).filter(x => x.alerts.length) };
      case 'NEXT_STEPS': return { items: PJ.nextSteps(c.items) };
      case 'CUSTOM': { const t = P.safeText(c.text); if (!t || !t.ok) throw err('REDACTION_ERROR', 'Texto livre inválido.'); return { text: t.value }; }
      default: throw err('UNSUPPORTED_BLOCK', block.type);
    }
  }
  function projectionContext(def, src, opts = {}) {
    const policy = opts.policy || P.current();
    const display = opts.customerDisplay || policy.customerDisplay;
    return { policy, priceTable: src.priceTable || null, commercialFreshness: (src.freshness || {}).commercial || 'UNKNOWN', offline: !!opts.offline, developmentId: def.developmentId,
      customerLabel: def.audience === 'INTERNAL_PREVIEW' || !src.customer ? (src.customer ? P.customerLabel(src.customer, display) : null) : P.customerLabel(src.customer, display),
      lots: def.lotIds.map(src.resolve).filter(Boolean), fitByLot: src.fitByLot || null };
  }

  // ---------------------------------------------------------------- version refs
  function versionRefs(def, src, opts = {}) {
    const dev = src.dev || {}, pt = src.priceTable, lots = def.lotIds.map(src.resolve).filter(Boolean);
    const simIds = def.contentBlocks.filter(b => b.enabled !== false && b.type === 'FINANCIAL_SIMULATION').map(b => b.config.simulationRef).filter(Boolean);
    return {
      staticDataVersion: dev.staticDataVersion || ((src.dataVersions || {}).static ?? null), analysisVersionRefs: { analysis: dev.analysisVersion || ((src.dataVersions || {}).analysis ?? null) },
      priceTableVersionId: pt ? `${pt.id}@${pt.version}` : null, availabilityRevision: src.availabilityRevision != null ? String(src.availabilityRevision) : checksum(lots.map(l => [l.identity.code, l.availability.status, l.availability.revision ?? null, l.availability.freshness])),
      recommendationResultId: src.recommendation ? src.recommendation.id : null, comparisonSnapshotId: src.comparison && src.comparison.snapshot ? src.comparison.snapshot.id : null,
      profileVersionId: src.customer ? (src.customer.profileVersionId || (src.recommendation && src.recommendation.profileVersionId) || null) : null,
      financialSimulationResultIds: simIds, alertRuleSetVersionId: dev.analysisVersion || null, clientSafePolicyVersion: (opts.policy || P.current()).version,
      themeVersion: src.theme ? `${src.theme.id}@${src.theme.version}` : null, templateRef: def.templateRef || null
    };
  }

  // ---------------------------------------------------------------- Preflight
  const OVERRIDES = Object.freeze({
    PRICE_STALE_FINANCIAL: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true }, // e.g. price confirmed verbally: wording keeps the caveat
    AVAILABILITY_STALE_CRITICAL: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true },
    BLOCK_SOURCE_MISSING: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true }
  }); // everything else (PII/internal exposure, cross-tenant, redaction, unsafe claims, version incoherence…) is non-overridable
  const MSG = Object.freeze({
    CROSS_TENANT: 'Recurso de outra organização.', CUSTOMER_ACCESS_DENIED: 'Sem acesso a este cliente.', JOURNEY_ACCESS_DENIED: 'Sem acesso a esta jornada.', NO_LOTS: 'Selecione ao menos um lote.',
    LOT_NOT_FOUND: 'Lote não encontrado.', WRONG_DEVELOPMENT: 'Lote de outro empreendimento.', AVAILABILITY_UNCONFIRMED: 'Disponibilidade não confirmada: a apresentação mostrará "sujeita a confirmação".',
    AVAILABILITY_STALE: 'Disponibilidade pode estar desatualizada.', AVAILABILITY_CLAIM_UNSUPPORTED: 'O bloco afirma "disponível agora", mas a disponibilidade não está confirmada.',
    AVAILABILITY_STALE_CRITICAL: 'Bloco crítico depende de disponibilidade não confirmada.', PRICE_STALE: 'Preço pode estar desatualizado: será exibido com ressalva.',
    PRICE_STALE_FINANCIAL: 'Simulação crítica sobre preço não confirmado.', PRICE_CONFLICTED: 'Preço conflitante.', PRICE_NOT_AVAILABLE: 'Lote sem preço de tabela.',
    RECOMMENDATION_REF_MISSING: 'Recomendação referenciada não encontrada.', RECOMMENDATION_PROFILE_VERSION_MISSING: 'Recomendação sem versão de perfil.',
    COMPARISON_REF_MISSING: 'Comparação referenciada não encontrada.', COMPARISON_VERSION_MISMATCH: 'Comparação com versões incoerentes.', COMPARISON_TOO_MANY_LOTS: 'Mais de 4 lotes: use navegação por seleção.',
    SIMULATION_REF_INVALID: 'Simulação referenciada inválida.', SIMULATION_VERSION_MISSING: 'Simulação sem versão.', UNSUPPORTED_BLOCK: 'Bloco não suportado.', INVALID_BLOCK_CONFIG: 'Configuração de bloco inválida.',
    BLOCK_NOT_ALLOWED_BY_POLICY: 'Bloco não permitido pela política client-safe.', PII_OR_INTERNAL_DATA_EXPOSURE: 'Dado pessoal ou interno chegaria ao cliente.', UNSAFE_CLAIM: 'Afirmação sem suporte (valorização, garantia, probabilidade).',
    REDACTION_ERROR: 'Falha ao aplicar a redação client-safe.', PROJECTION_ERROR: 'Falha ao montar o bloco.', BLOCK_SOURCE_MISSING: 'Fonte do bloco indisponível.', STORYLINE_INVALID: 'Roteiro aponta para bloco inexistente.',
    THEME_MISSING: 'Tema não encontrado: será usado o tema padrão.', MIXED_VERSIONS: 'Fontes com versões diferentes (documentadas no snapshot).', OFFLINE_LIVE: 'Sem conexão: dados ao vivo indisponíveis.',
    POLICY_VERSION_MISMATCH: 'Versão da política client-safe diferente da vigente.'
  });
  const LEAK_CODES = new Set(['PII_EMAIL', 'PII_CPF', 'PII_PHONE', 'PII_FIELD', 'INTERNAL_FIELD', 'INTERNAL_LOT_ID', 'TECHNICAL_PROVENANCE', 'HTML_MARKUP']);
  const projCache = new WeakMap();
  /** preflight(def, src, ctx) → PresentationPreflightResult. ctx = { organizationId, can?, now?, overrides: [{ issueCode, blockId?, reason }], offline?, dataMode? } */
  function preflight(def, src, ctx = {}) {
    const policy = ctx.policy || P.current(), blocking = [], warnings = [], info = [];
    const I = (sev, code, extra = {}) => { const x = { code, severity: sev, message: MSG[code] || code, overridable: !!(OVERRIDES[code] && OVERRIDES[code].allowed), ...extra }; (sev === 'BLOCKING' ? blocking : sev === 'WARNING' ? warnings : info).push(x); return x; };
    if (def.organizationId !== ctx.organizationId || (src.organizationId && src.organizationId !== def.organizationId)) I('BLOCKING', 'CROSS_TENANT');
    if (ctx.clientSafePolicyVersion && ctx.clientSafePolicyVersion !== policy.version) I('BLOCKING', 'POLICY_VERSION_MISMATCH');
    if (def.customerId) { const c = src.customer; if (!c || c.id !== def.customerId || c.organizationId !== def.organizationId || (src.canAccessCustomer && !src.canAccessCustomer(def.customerId))) I('BLOCKING', 'CUSTOMER_ACCESS_DENIED'); }
    if (def.journeyId) { const j = src.journey; if (!j || j.id !== def.journeyId || j.organizationId !== def.organizationId || (src.canAccessJourney && !src.canAccessJourney(def.journeyId))) I('BLOCKING', 'JOURNEY_ACCESS_DENIED'); }
    if (!def.lotIds.length) I('BLOCKING', 'NO_LOTS');
    const pctx = projectionContext(def, src, { policy, offline: ctx.offline });
    for (const id of def.lotIds) {
      const l = src.resolve(id); if (!l) { I('BLOCKING', 'LOT_NOT_FOUND'); continue; }
      if (l.identity.developmentId !== def.developmentId) { I('BLOCKING', 'WRONG_DEVELOPMENT', { lotRef: l.identity.code }); continue; }
      const av = PJ.availability(l, pctx), pr = PJ.price(l, pctx);
      if (l.availability.status === 'AVAILABLE' && av.state === 'STATUS_CONFIRMATION_REQUIRED') I('WARNING', 'AVAILABILITY_STALE', { lotRef: l.identity.code });
      else if (av.state === 'STATUS_CONFIRMATION_REQUIRED') I('WARNING', 'AVAILABILITY_UNCONFIRMED', { lotRef: l.identity.code });
      if (pr.state === 'CURRENT_WITH_CAVEAT') I('WARNING', 'PRICE_STALE', { lotRef: l.identity.code });
      if (pr.state === 'NOT_AVAILABLE') I('INFO', 'PRICE_NOT_AVAILABLE', { lotRef: l.identity.code });
      if (pr.state === 'CONFLICTED') { const fin = def.contentBlocks.some(b => b.enabled !== false && b.type === 'FINANCIAL_SIMULATION' && b.config.lotId === id); I(fin || def.purpose === 'FINANCIAL_REVIEW' ? 'BLOCKING' : 'WARNING', 'PRICE_CONFLICTED', { lotRef: l.identity.code }); }
    }
    const blockIds = new Set(), payloads = {};
    for (const b of def.contentBlocks) {
      blockIds.add(b.id); if (b.enabled === false) continue;
      const crit = P.Criticality[b.criticality] ? b.criticality : 'OPTIONAL', at = { blockId: b.id, blockType: b.type };
      if (P.INTERNAL_BLOCK_TYPES.includes(b.type)) { I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', at); continue; }
      if (!BLOCK_REGISTRY[b.type]) { I('BLOCKING', 'UNSUPPORTED_BLOCK', at); continue; }
      if (!policy.allowedBlockTypes.includes(b.type)) { I('BLOCKING', 'BLOCK_NOT_ALLOWED_BY_POLICY', at); continue; }
      const ce = validateBlockConfig(b); if (ce.length) { I('BLOCKING', 'INVALID_BLOCK_CONFIG', { ...at, details: ce }); continue; }
      if (b.config.lotId && !def.lotIds.includes(b.config.lotId)) { I('BLOCKING', 'INVALID_BLOCK_CONFIG', { ...at, details: [{ code: 'LOT_NOT_IN_PRESENTATION', key: 'lotId' }] }); continue; }
      if (b.type === 'RECOMMENDATION_SUMMARY') {
        if (!src.recommendation || (def.recommendationResultId && src.recommendation.id !== def.recommendationResultId)) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', crit === 'OPTIONAL' ? 'BLOCK_SOURCE_MISSING' : 'RECOMMENDATION_REF_MISSING', at); continue; }
        if (!src.recommendation.profileVersionId) { I('BLOCKING', 'RECOMMENDATION_PROFILE_VERSION_MISSING', at); continue; }
      }
      if (b.type === 'COMPARISON') {
        const cm = src.comparison;
        if (!cm || !cm.evaluation || !cm.snapshot || (def.comparisonSessionId && cm.sessionId && cm.sessionId !== def.comparisonSessionId)) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', crit === 'OPTIONAL' ? 'BLOCK_SOURCE_MISSING' : 'COMPARISON_REF_MISSING', at); continue; }
        if (cm.evaluation.comparisonSnapshotId !== cm.snapshot.id || (cm.snapshot.hash && cm.evaluation.comparisonSnapshotHash !== cm.snapshot.hash)) { I('BLOCKING', 'COMPARISON_VERSION_MISMATCH', at); continue; }
        if (cm.evaluation.candidateIds.length > policy.maxComparisonLots) I('INFO', 'COMPARISON_TOO_MANY_LOTS', at);
        if (cm.snapshot.dataVersions && src.dataVersions && Object.keys(cm.snapshot.dataVersions).some(k => src.dataVersions[k] != null && cm.snapshot.dataVersions[k] != null && String(cm.snapshot.dataVersions[k]) !== String(src.dataVersions[k]))) I('WARNING', 'MIXED_VERSIONS', at);
      }
      if (b.type === 'FINANCIAL_SIMULATION') {
        const s = (src.simulations || {})[b.config.simulationRef];
        if (!s || !s.result || (s.lotId && s.lotId !== b.config.lotId)) { I('BLOCKING', 'SIMULATION_REF_INVALID', at); continue; }
        if (!s.version) { I('BLOCKING', 'SIMULATION_VERSION_MISSING', at); continue; }
        const l = src.resolve(b.config.lotId), pr = l ? PJ.price(l, pctx) : null;
        if (crit === 'CRITICAL' && pr && pr.state === 'CURRENT_WITH_CAVEAT') I('BLOCKING', 'PRICE_STALE_FINANCIAL', at);
      }
      if (b.type === 'AVAILABILITY_STATUS' && b.config.claim === 'AVAILABLE_NOW' && pctx.lots.some(l => PJ.availability(l, pctx).state !== 'AVAILABLE_CONFIRMED')) { I('BLOCKING', 'AVAILABILITY_CLAIM_UNSUPPORTED', at); continue; }
      if (crit === 'CRITICAL' && ['LOT_HIGHLIGHT', 'LOT_DETAILS', 'AVAILABILITY_STATUS'].includes(b.type) && pctx.lots.some(l => (!b.config.lotId || l.identity.id === b.config.lotId) && PJ.availability(l, pctx).state === 'STATUS_CONFIRMATION_REQUIRED')) I('BLOCKING', 'AVAILABILITY_STALE_CRITICAL', at);
      let payload;
      try { payload = blockPayload(b, def, src, pctx); } catch (e) { I(e.code === 'REDACTION_ERROR' || crit !== 'OPTIONAL' ? 'BLOCKING' : 'WARNING', e.code === 'REDACTION_ERROR' ? 'REDACTION_ERROR' : 'PROJECTION_ERROR', at); continue; }
      if (payload == null) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', 'BLOCK_SOURCE_MISSING', at); continue; }
      const audiencePart = { title: b.title || null, payload };
      const leaks = P.scanPayload(audiencePart);
      if (leaks.some(x => x.code === 'UNSAFE_CLAIM')) I('BLOCKING', 'UNSAFE_CLAIM', { ...at, paths: leaks.filter(x => x.code === 'UNSAFE_CLAIM').map(x => x.path) });
      if (leaks.some(x => LEAK_CODES.has(x.code))) { I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { ...at, leakCodes: [...new Set(leaks.filter(x => LEAK_CODES.has(x.code)).map(x => x.code))] }); continue; }
      payloads[b.id] = payload;
    }
    for (const s of (def.storyline && def.storyline.steps) || []) if (!blockIds.has(s.blockId)) I('BLOCKING', 'STORYLINE_INVALID', { stepId: s.id });
    for (const s of (def.storyline && def.storyline.steps) || []) for (const k of ['title', 'navigationLabel']) if (s[k] != null) { const l = P.scanPayload({ v: s[k] }); if (l.length || !P.safeText(s[k], 120).ok) I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { stepId: s.id }); }
    if (pctx.customerLabel && P.scanPayload({ v: pctx.customerLabel }).length) I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { field: 'customerLabel' });
    if (def.themeRef && !(src.theme && src.theme.id === def.themeRef)) I('WARNING', 'THEME_MISSING');
    if (ctx.offline && ctx.dataMode === 'LIVE') I('BLOCKING', 'OFFLINE_LIVE');
    // overrides: explicit, permissioned, reasoned, audited; never for non-overridable issues
    for (const o of ctx.overrides || []) {
      const pol = OVERRIDES[o.issueCode];
      const idx = blocking.findIndex(x => x.code === o.issueCode && (!o.blockId || x.blockId === o.blockId));
      if (idx < 0 || !pol || !pol.allowed) continue;
      if (!can(ctx, pol.requiredPermission)) continue;
      if (pol.requireReason && !(o.reason && String(o.reason).trim().length >= 5)) continue;
      const [x] = blocking.splice(idx, 1); warnings.push({ ...x, severity: 'WARNING', overridden: true });
      audit('PresentationPreflightOverridden', { organizationId: def.organizationId, definitionId: def.id, issueCode: x.code, revision: def.recordRevision }, ctx);
    }
    const status = blocking.length ? 'FAIL' : warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS';
    if (status === 'FAIL') audit('PresentationPreflightBlocked', { organizationId: def.organizationId, definitionId: def.id, reasonCode: blocking[0].code, revision: def.recordRevision }, ctx);
    const res = Object.freeze({ status, blockingIssues: Object.freeze(blocking.map(Object.freeze)), warnings: Object.freeze(warnings.map(Object.freeze)), informational: Object.freeze(info.map(Object.freeze)),
      resolvedVersionRefs: Object.freeze(versionRefs(def, src, { policy })), evaluatedAt: nowIso(ctx), definitionRevision: def.recordRevision, clientSafePolicyVersion: policy.version });
    projCache.set(res, { payloads, pctx });
    return res;
  }

  // ---------------------------------------------------------------- audience payload (the only thing a renderer/share receives)
  function buildAudience(def, payloads, pctx, policy, meta) {
    const enabled = def.contentBlocks.filter(b => b.enabled !== false && payloads[b.id] != null).sort((a, b) => a.order - b.order);
    const ok = new Set(enabled.map(b => b.id));
    const steps = ((def.storyline && def.storyline.steps) || []).filter(s => ok.has(s.blockId)).sort((a, b) => a.order - b.order)
      .map((s, i) => ({ id: s.id, blockId: s.blockId, order: i + 1, title: s.title || null, navigationLabel: s.navigationLabel || null, skippable: s.skippable !== false })); // presenterHint never copied
    const sl = def.storyline || {};
    return {
      schemaVersion: SCHEMA_VERSION, title: def.title, subtitle: def.subtitle || null, customerLabel: pctx.customerLabel || null,
      preparedAtLabel: meta.preparedAt ? W.preparedAt(F.formatDateTime ? F.formatDateTime(meta.preparedAt) : meta.preparedAt) : null, dataMode: meta.dataMode,
      storyline: { steps, startStepId: steps.some(s => s.id === sl.startStepId) ? sl.startStepId : steps.length ? steps[0].id : null, allowFreeNavigation: sl.allowFreeNavigation !== false, allowReturnToMap: sl.allowReturnToMap !== false, allowLotJump: sl.allowLotJump !== false },
      blocks: enabled.map(b => ({ blockId: b.id, type: b.type, title: b.title || null, criticality: b.criticality || 'OPTIONAL', payload: payloads[b.id] })),
      lots: pctx.lots.map(l => ({ lotRef: l.identity.code, label: lotLabel(l) })),
      theme: meta.theme ? { name: meta.theme.name, typographyTokens: meta.theme.typographyTokens, spacingTokens: meta.theme.spacingTokens, layoutTokens: meta.theme.layoutTokens, presentationComponentTokens: meta.theme.presentationComponentTokens } : null,
      clientSafePolicyVersion: policy.version
    };
  }

  // ---------------------------------------------------------------- Snapshot service
  /** createSnapshot(repo, def, src, ctx, req) → { ok, snapshot?, preflight, reused? }.
      req = PresentationSnapshotGenerationRequest { expectedDefinitionRevision, dataMode, clientSafePolicyVersion, generatedBy, idempotencyKey? } */
  function createSnapshot(repo, def, src, ctx = {}, req = {}) {
    if (!can(ctx, 'presentation.snapshot.create')) return { ok: false, code: 'FORBIDDEN' };
    if (def.organizationId !== ctx.organizationId) return { ok: false, code: 'NOT_FOUND' };
    if (def.lifecycleStatus === 'ARCHIVED') return { ok: false, code: 'ARCHIVED' };
    if (req.expectedDefinitionRevision !== def.recordRevision) return { ok: false, code: 'DEFINITION_REVISION_CONFLICT', currentRevision: def.recordRevision };
    const policy = ctx.policy || P.current();
    if (req.clientSafePolicyVersion && req.clientSafePolicyVersion !== policy.version) return { ok: false, code: 'POLICY_VERSION_MISMATCH' };
    const pre = preflight(def, src, { ...ctx, policy, dataMode: req.dataMode || 'SNAPSHOT' });
    if (pre.status === 'FAIL') return { ok: false, code: 'PREFLIGHT_FAILED', preflight: pre };
    const { payloads, pctx } = projCache.get(pre), at = nowIso(ctx);
    const audience = buildAudience(def, payloads, pctx, policy, { preparedAt: at, dataMode: 'SNAPSHOT', theme: src.theme && src.theme.id === def.themeRef ? src.theme : null });
    const last = P.scanPayload(audience); // defense in depth: the full audience object, not only each block
    if (last.some(x => x.code !== 'UNSAFE_CLAIM')) return { ok: false, code: 'REDACTION_ERROR', preflight: pre, leaks: last };
    const lotRefs = pctx.lots.map((l, i) => ({ lotId: l.identity.id, lotRef: l.identity.code, order: i + 1 }));
    const sum = checksum({ audience: { ...audience, preparedAtLabel: null }, lotRefs, versionRefs: pre.resolvedVersionRefs, policy: policy.version, definitionRevision: def.recordRevision });
    if (req.idempotencyKey) { const prev = repo.findByIdempotencyKey(ctx, def.id, req.idempotencyKey); if (prev && prev.checksum === sum) return { ok: true, snapshot: prev, preflight: pre, reused: true }; } // commercial data changed → new checksum → new snapshot
    const snap = deepFreeze({
      id: opaqueId('prs'), schemaVersion: SCHEMA_VERSION, organizationId: def.organizationId, presentationDefinitionId: def.id, definitionRevision: def.recordRevision, developmentId: def.developmentId,
      customerRef: def.customerId ? { customerId: def.customerId, profileVersionId: pre.resolvedVersionRefs.profileVersionId, displayLabel: pctx.customerLabel || null } : null, // no phone/email
      journeyId: def.journeyId || null, purpose: def.purpose, dataMode: 'SNAPSHOT', templateRef: def.templateRef || null,
      blockSnapshots: def.contentBlocks.map(b => ({ blockId: b.id, type: b.type, order: b.order, criticality: b.criticality || 'OPTIONAL', renderState: b.enabled === false ? 'UNAVAILABLE' : payloads[b.id] != null ? 'READY' : 'UNAVAILABLE' })),
      lotRefs, versionRefs: pre.resolvedVersionRefs, clientSafePolicyVersion: policy.version, themeVersionRef: pre.resolvedVersionRefs.themeVersion, generatedAt: at, generatedBy: req.generatedBy || ctx.userId || null,
      checksum: sum, status: pre.status === 'PASS' ? 'READY' : 'READY_WITH_WARNINGS', warnings: pre.warnings.map(w => ({ code: w.code, blockId: w.blockId || null, lotRef: w.lotRef || null, overridden: !!w.overridden })),
      idempotencyKey: req.idempotencyKey || null, audience
    });
    repo.saveSnapshot(ctx, snap);
    safety.record(snap, ctx);
    audit('PresentationSnapshotCreated', { organizationId: snap.organizationId, snapshotId: snap.id, definitionId: def.id, revision: def.recordRevision }, ctx);
    emit('PresentationSnapshotCreated', { organizationId: snap.organizationId, snapshotId: snap.id }, ctx);
    return { ok: true, snapshot: snap, preflight: pre };
  }
  /** audienceOf(snapshot): what the renderer / ShareService may read */
  const audienceOf = snap => snap ? snap.audience : null;
  /** verify(snapshot) → true when the stored content still matches its checksum (reproducibility) */
  const verify = snap => checksum({ audience: { ...plain(snap.audience), preparedAtLabel: null }, lotRefs: plain(snap.lotRefs), versionRefs: plain(snap.versionRefs), policy: snap.clientSafePolicyVersion, definitionRevision: snap.definitionRevision }) === snap.checksum;

  // ---------------------------------------------------------------- LIVE projection (current refs each refresh; never stored as a snapshot)
  function liveProjection(def, src, ctx = {}) {
    const pre = preflight(def, src, { ...ctx, dataMode: 'LIVE' });
    if (pre.status === 'FAIL') return { ok: false, code: 'PREFLIGHT_FAILED', preflight: pre };
    const { payloads, pctx } = projCache.get(pre), at = nowIso(ctx);
    return { ok: true, dataMode: 'LIVE', refreshedAt: at, versionRefs: pre.resolvedVersionRefs, preflight: pre, audience: deepFreeze(buildAudience(def, payloads, pctx, ctx.policy || P.current(), { preparedAt: null, dataMode: 'LIVE', theme: src.theme && src.theme.id === def.themeRef ? src.theme : null })) };
  }
  /** LiveView: applies refresh results in request order; an older response arriving late is discarded (stale response protection) */
  function createLiveView() {
    let seq = 0, applied = 0, current = null;
    return { begin: () => ++seq, apply(reqSeq, result) { if (reqSeq <= applied) return { applied: false, reason: 'STALE_RESPONSE' }; applied = reqSeq; current = result; return { applied: true }; }, current: () => current };
  }

  // ---------------------------------------------------------------- Freshness (does not mutate the snapshot)
  const DAY = 86400000;
  const FRESHNESS_POLICY = Object.freeze({ warnAfterMs: DAY }); // UX threshold (pending human decision); version/revision changes warn immediately
  function freshness(snap, opts = {}) {
    const now = Date.parse(opts.now || new Date().toISOString()), age = Math.max(0, now - Date.parse(snap.generatedAt)), days = Math.floor(age / DAY);
    const cur = opts.currentVersionRefs || null, pol = { ...FRESHNESS_POLICY, ...(opts.policy || {}) };
    const changed = cur ? ['priceTableVersionId', 'availabilityRevision', 'staticDataVersion'].filter(k => cur[k] != null && snap.versionRefs[k] != null && String(cur[k]) !== String(snap.versionRefs[k])) : [];
    const unconfirmed = (snap.warnings || []).some(w => ['AVAILABILITY_UNCONFIRMED', 'AVAILABILITY_STALE', 'PRICE_STALE'].includes(w.code));
    const outdated = age >= pol.warnAfterMs || changed.length > 0 || !!opts.offline;
    const warnings = [];
    if (outdated) warnings.push(age >= DAY ? W.freshness(Math.max(1, days)) : 'Confirme preço e disponibilidade antes de decidir.');
    if (opts.offline) warnings.push(W.preparedAt(F.formatDateTime ? F.formatDateTime(snap.generatedAt) : snap.generatedAt));
    return Object.freeze({ ageMs: age, ageDays: days, commercialDataMayBeOutdated: outdated, changedRefs: Object.freeze(changed), unconfirmedAtGeneration: unconfirmed, warnings: Object.freeze(warnings) });
  }

  // ---------------------------------------------------------------- Snapshot safety (separate from freshness)
  const safety = (() => {
    const recs = new Map();
    const key = (org, id) => org + '|' + id;
    function record(snap, ctx = {}) { const r = Object.freeze({ snapshotId: snap.id, status: 'SAFE', policyVersion: snap.clientSafePolicyVersion, reasonCodes: Object.freeze([]), evaluatedAt: nowIso(ctx) }); recs.set(key(snap.organizationId, snap.id), r); return r; }
    function get(org, id) { return recs.get(key(org, id)) || null; }
    function mark(org, id, status, reasonCodes = [], ctx = {}) {
      if (!P.SafetyStatus[status]) throw err('INVALID_SAFETY_STATUS', status);
      const prev = get(org, id); if (!prev) return null;
      const r = Object.freeze({ snapshotId: id, status, policyVersion: (ctx.policy || P.current()).version, reasonCodes: Object.freeze(reasonCodes.slice()), evaluatedAt: nowIso(ctx) });
      recs.set(key(org, id), r); audit('PresentationSnapshotSafetyChanged', { organizationId: org, snapshotId: id, reasonCode: reasonCodes[0] || status }, ctx);
      for (const f of listeners) { try { f({ type: status === 'REVOKED' ? 'PresentationSnapshotRevoked' : 'PresentationSnapshotSafetyChanged', organizationId: org, snapshotId: id, status }); } catch (e) { /* listener isolation */ } }
      return r;
    }
    /** reevaluate(snapshot, policy): a stricter policy that now flags the frozen content → REVIEW_REQUIRED (content untouched) */
    function reevaluate(snap, ctx = {}) {
      const leaks = P.scanPayload(snap.audience, { policy: ctx.policy });
      const extra = ctx.policy && ctx.policy.deniedBlockTypes ? snap.audience.blocks.filter(b => ctx.policy.deniedBlockTypes.includes(b.type)) : [];
      if (!leaks.length && !extra.length) return get(snap.organizationId, snap.id);
      const cur = get(snap.organizationId, snap.id); if (cur && cur.status === 'REVOKED') return cur;
      return mark(snap.organizationId, snap.id, 'REVIEW_REQUIRED', ['POLICY_EVOLUTION', ...new Set(leaks.map(l => l.code))], ctx);
    }
    const listeners = [];
    return { record, get, mark, reevaluate, onChange: f => { listeners.push(f); return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; }, clear: () => recs.clear() };
  })();

  // ---------------------------------------------------------------- Repository (in-memory reference; the backend owns persistence)
  function createRepository() {
    const defs = new Map(), snaps = new Map(), idem = new Map();
    const scoped = (ctx, x) => x && ctx && x.organizationId === ctx.organizationId ? x : null; // cross-tenant → null (no existence leak)
    return Object.freeze({
      getDefinition: (ctx, id) => scoped(ctx, defs.get(id)),
      saveDefinition(ctx, def, expectedRevision) {
        if (def.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Organização diferente.');
        const cur = defs.get(def.id);
        if (cur && cur.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Apresentação não encontrada.');
        if (cur ? cur.recordRevision !== expectedRevision : expectedRevision != null && expectedRevision !== 0) throw err('REVISION_CONFLICT', 'Revisão desatualizada.', { currentRevision: cur ? cur.recordRevision : null });
        defs.set(def.id, def); return def;
      },
      getSnapshot: (ctx, id) => scoped(ctx, snaps.get(id)),
      saveSnapshot(ctx, snap) {
        if (snap.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Organização diferente.');
        if (snaps.has(snap.id)) throw err('SNAPSHOT_IMMUTABLE', 'Snapshot já existe e não pode ser alterado.');
        snaps.set(snap.id, deepFreeze(snap)); if (snap.idempotencyKey) idem.set(snap.organizationId + '|' + snap.presentationDefinitionId + '|' + snap.idempotencyKey, snap.id); return snap;
      },
      findByIdempotencyKey: (ctx, defId, k) => { const id = idem.get(ctx.organizationId + '|' + defId + '|' + k); return id ? scoped(ctx, snaps.get(id)) : null; },
      listByCustomer: (ctx, customerId) => [...snaps.values()].filter(s => s.organizationId === ctx.organizationId && s.customerRef && s.customerRef.customerId === customerId).map(summary),
      listByJourney: (ctx, journeyId) => [...snaps.values()].filter(s => s.organizationId === ctx.organizationId && s.journeyId === journeyId).map(summary)
    });
  }
  const summary = s => Object.freeze({ snapshotId: s.id, definitionId: s.presentationDefinitionId, purpose: s.purpose, status: s.status, generatedAt: s.generatedAt, lotCount: s.lotRefs.length, title: s.audience.title });

  /** sourcesFromRepo(repo, dev, extra) → the read-service bundle preflight/projection expect (no DB access here) */
  function sourcesFromRepo(repo, dev, extra = {}) {
    const pt = dev && (dev.priceTables || []).find(p => p.id === dev.currentPriceTableId);
    return { organizationId: dev ? dev.tenantId : null, developmentId: dev ? dev.id : null, dev, resolve: ref => ref == null ? null : repo.resolve(ref), freshness: repo.getFreshness(), dataVersions: repo.getDataVersions(), priceTable: pt || null, ...extra };
  }

  return Object.freeze({ SCHEMA_VERSION, PERMISSIONS, can, BLOCK_REGISTRY, validateBlockConfig, TEMPLATES, expandTemplate, LIMITS, validateDefinition, createDefinition, fromRecommendation, fromFavorites, fromComparison,
    revise, reorderLots, applyTemplate, markReady, archive, versionRefs, OVERRIDES, MESSAGES: MSG, preflight, createSnapshot, audienceOf, verify, liveProjection, createLiveView, FRESHNESS_POLICY, freshness, safety,
    createRepository, sourcesFromRepo, checksum, opaqueId, deepFreeze, emit, audit, events: () => EVENTS.slice(), auditLog: () => AUDIT.slice(), EVENT_TYPES, AUDIT_TYPES, sanitizeRefs });
})();

/* ---- presentationmode/runtime.js ---- */
/* presentationmode/runtime.js — topic 41: PresentationSession runtime (navigation only; never changes the snapshot) ·
   PresenterControlState + PresentationPresenterControlsPolicy (concealed from the audience) · PresentationOverlayCoordinator
   (one dominant overlay) · PresentationFeedbackIntent (records intent; never edits the profile, never infers hard
   constraints, never favorites by itself) · Journey milestones/suggestions (no auto stage move) · PresentationOutcomeSummary ·
   PresentationOfflinePolicy + PresentationFallbackPolicy (no silent fallback) · private cache (cleared on logout/tenant
   switch) · PresentationTheme (versioned, no business logic) · device layout · presenter notes (memory only) ·
   PresentationExportRequest (snapshot only; no PDF engine here) · LegacyPresentationInventory. */
App.presentationMode = App.presentationMode || {};
App.presentationMode.runtime = (() => {
  const P = App.presentationMode.policy, D = App.presentationMode.domain;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowIso = o => (o && o.now) || new Date().toISOString();
  const freeze = D.deepFreeze;

  // ---------------------------------------------------------------- access to a snapshot (current authorization always wins)
  /** openSnapshot(repo, ctx, snapshotId) → { ok, snapshot } — immutable content does not override current permission or safety */
  function openSnapshot(repo, ctx, id) {
    if (!D.can(ctx, 'presentation.read')) return { ok: false, code: 'FORBIDDEN' };
    const s = repo.getSnapshot(ctx, id); if (!s) return { ok: false, code: 'NOT_FOUND' }; // other tenant → NOT_FOUND
    const sf = D.safety.get(s.organizationId, s.id);
    if (!sf || sf.status === 'REVOKED') return { ok: false, code: 'SNAPSHOT_REVOKED' };
    if (sf.status === 'REVIEW_REQUIRED') return { ok: false, code: 'SNAPSHOT_REVIEW_REQUIRED' }; // the audience never sees content under review
    if (s.status === 'BLOCKED') return { ok: false, code: 'SNAPSHOT_BLOCKED' };
    return { ok: true, snapshot: s };
  }

  // ---------------------------------------------------------------- Session
  const sessions = new Map();
  /** start(repo, ctx, snapshotId, { mode, deviceProfile }) → PresentationSession (plain, frozen; every move returns a new one) */
  function start(repo, ctx, snapshotId, o = {}) {
    if (!D.can(ctx, 'presentation.session.start')) return { ok: false, code: 'FORBIDDEN' };
    const op = openSnapshot(repo, ctx, snapshotId); if (!op.ok) return op;
    const s = op.snapshot, st = s.audience.storyline, at = nowIso(ctx);
    const sess = freeze({ id: D.opaqueId('pss'), organizationId: s.organizationId, presentationSnapshotId: s.id, presenterUserId: ctx.userId || null, startedAt: at, endedAt: null,
      currentStepId: st.startStepId, mode: P.RuntimeMode[o.mode] ? o.mode : 'GUIDED', deviceProfile: P.DeviceProfile[o.deviceProfile] ? o.deviceProfile : 'DESKTOP', state: 'ACTIVE',
      runtimeFlags: { presenterNotesVisible: false, fullscreen: false, completed: false, mapOpen: false, overlay: null }, viewedStepIds: st.startStepId ? [st.startStepId] : [], viewedLotRefs: [], feedbackIds: [] });
    sessions.set(sess.id, { session: sess, snapshot: s });
    D.audit('PresentationStarted', { organizationId: s.organizationId, snapshotId: s.id, sessionId: sess.id }, ctx);
    D.emit('PresentationStarted', { organizationId: s.organizationId, snapshotId: s.id, sessionId: sess.id }, ctx);
    return { ok: true, session: sess };
  }
  const entry = id => { const e = sessions.get(id); if (!e) throw err('SESSION_NOT_FOUND', 'Sessão não encontrada.'); return e; };
  function put(e, patch, flags) { const next = freeze({ ...JSON.parse(JSON.stringify(e.session)), ...patch, runtimeFlags: { ...e.session.runtimeFlags, ...(flags || {}) } }); e.session = next; return next; }
  const steps = e => e.snapshot.audience.storyline.steps;
  function guardActive(e) { if (e.session.state === 'ENDED') throw err('SESSION_ENDED', 'A apresentação foi encerrada.'); }
  function goTo(sessionId, stepId, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    const ss = steps(e), i = ss.findIndex(s => s.id === stepId); if (i < 0) throw err('STEP_NOT_FOUND', 'Etapa inexistente.');
    const cur = ss.findIndex(s => s.id === e.session.currentStepId), sl = e.snapshot.audience.storyline;
    // Guided ≠ rigid: adjacent moves always; jumps when the storyline allows free navigation or the session is not GUIDED
    if (Math.abs(i - cur) > 1 && e.session.mode === 'GUIDED' && !sl.allowFreeNavigation) throw err('NAVIGATION_NOT_ALLOWED', 'Navegação livre desativada neste roteiro.');
    const viewed = e.session.viewedStepIds.includes(stepId) ? e.session.viewedStepIds : [...e.session.viewedStepIds, stepId];
    const blk = e.snapshot.audience.blocks.find(b => b.blockId === ss[i].blockId);
    D.emit('PresentationStepViewed', { organizationId: e.session.organizationId, sessionId, stepId }, ctx); // analytics-level, not a Journey fact
    if (blk && blk.type === 'COMPARISON') D.emit('PresentationComparisonViewed', { organizationId: e.session.organizationId, sessionId }, ctx);
    if (blk && blk.type === 'FINANCIAL_SIMULATION') D.emit('PresentationFinancialViewed', { organizationId: e.session.organizationId, sessionId }, ctx);
    return put(e, { currentStepId: stepId, viewedStepIds: viewed }, { overlay: null, mapOpen: false });
  }
  const move = (sessionId, d, ctx) => { const e = entry(sessionId); guardActive(e); const ss = steps(e), i = ss.findIndex(s => s.id === e.session.currentStepId), j = i + d; if (j < 0 || j >= ss.length) return e.session; return goTo(sessionId, ss[j].id, ctx); };
  const next = (id, ctx) => move(id, 1, ctx), previous = (id, ctx) => move(id, -1, ctx);
  function jumpToLot(sessionId, lotRef, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    if (!e.snapshot.audience.storyline.allowLotJump) throw err('NAVIGATION_NOT_ALLOWED', 'Salto para lote desativado neste roteiro.');
    if (!e.snapshot.audience.lots.some(l => l.lotRef === lotRef)) throw err('LOT_NOT_IN_PRESENTATION', 'Lote fora desta apresentação.');
    const blk = e.snapshot.audience.blocks.find(b => b.payload && ((b.payload.card && b.payload.card.lotRef === lotRef)));
    D.emit('PresentationLotOpened', { organizationId: e.session.organizationId, sessionId, lotRef }, ctx);
    const viewedLots = e.session.viewedLotRefs.includes(lotRef) ? e.session.viewedLotRefs : [...e.session.viewedLotRefs, lotRef];
    if (blk) { const st = steps(e).find(s => s.blockId === blk.blockId); if (st) { put(e, { viewedLotRefs: viewedLots }); return goToFree(e, st.id, ctx); } }
    return put(e, { viewedLotRefs: viewedLots }, { mapOpen: true, overlay: null, focusLotRef: lotRef });
  }
  function goToFree(e, stepId, ctx) { const viewed = e.session.viewedStepIds.includes(stepId) ? e.session.viewedStepIds : [...e.session.viewedStepIds, stepId]; D.emit('PresentationStepViewed', { organizationId: e.session.organizationId, sessionId: e.session.id, stepId }, ctx); return put(e, { currentStepId: stepId, viewedStepIds: viewed }, { overlay: null }); }
  function returnToMap(sessionId) { const e = entry(sessionId); guardActive(e); if (!e.snapshot.audience.storyline.allowReturnToMap) throw err('NAVIGATION_NOT_ALLOWED', 'Retorno ao mapa desativado neste roteiro.'); return put(e, {}, { mapOpen: true, overlay: null }); }
  function setMode(sessionId, mode) { if (!P.RuntimeMode[mode]) throw err('INVALID_MODE', mode); const e = entry(sessionId); guardActive(e); return put(e, { mode }); }
  const pause = id => { const e = entry(id); guardActive(e); return put(e, { state: 'PAUSED' }); };
  const resume = id => { const e = entry(id); guardActive(e); return put(e, { state: 'ACTIVE' }); };
  const setFullscreen = (id, on) => { const e = entry(id); return put(e, {}, { fullscreen: !!on }); }; // UI enhancement; exiting keeps the session
  /** markCompleted: explicit presenter action ("Concluir apresentação") — never inferred from reaching the last step */
  function markCompleted(sessionId, ctx = {}) { const e = entry(sessionId); guardActive(e); D.emit('PresentationCompleted', { organizationId: e.session.organizationId, sessionId, snapshotId: e.session.presentationSnapshotId }, ctx); return put(e, {}, { completed: true }); }
  function end(sessionId, ctx = {}) {
    const e = entry(sessionId); if (e.session.state === 'ENDED') return { session: e.session, journeyEvents: [] };
    const s = put(e, { state: 'ENDED', endedAt: nowIso(ctx) }, { overlay: null, presenterNotesVisible: false });
    D.audit('PresentationEnded', { organizationId: s.organizationId, sessionId, snapshotId: s.presentationSnapshotId }, ctx);
    D.emit('PresentationEnded', { organizationId: s.organizationId, sessionId }, ctx);
    const snap = e.snapshot, journeyEvents = [], suggestions = [];
    if (s.runtimeFlags.completed && snap.journeyId) {
      journeyEvents.push(freeze({ type: 'PRESENTATION_COMPLETED', journeyId: snap.journeyId, snapshotId: snap.id, sessionId, at: s.endedAt }));
      if (['SHORTLIST', 'COMPARISON', 'INITIAL_OPTIONS'].includes(snap.purpose)) suggestions.push(freeze({ type: 'STAGE_SUGGESTION', suggestedStage: 'SHORTLISTED', journeyId: snap.journeyId, autoApply: false })); // suggestion only
    }
    return { session: s, journeyEvents, stageSuggestions: suggestions, outcome: outcome(sessionId) };
  }
  const getSession = id => (sessions.get(id) || {}).session || null;
  /** audienceView(sessionId) → what the audience surface renders: the snapshot audience + current step; never presenter controls/notes */
  function audienceView(sessionId) {
    const e = entry(sessionId), a = e.snapshot.audience, st = steps(e).find(s => s.id === e.session.currentStepId) || null;
    return freeze({ title: a.title, customerLabel: a.customerLabel, step: st ? { id: st.id, order: st.order, total: steps(e).length, title: st.title, navigationLabel: st.navigationLabel } : null,
      block: st ? a.blocks.find(b => b.blockId === st.blockId) || null : null, mapOpen: !!e.session.runtimeFlags.mapOpen, focusLotRef: e.session.runtimeFlags.focusLotRef || null, lots: a.lots, theme: a.theme,
      state: e.session.state, preparedAtLabel: a.preparedAtLabel });
  }
  /** presenterControlState(sessionId, ctx) — separate surface; notes only with explicit permission (never mirrored) */
  function presenterControlState(sessionId, ctx = {}) {
    const e = entry(sessionId), ss = steps(e), i = ss.findIndex(s => s.id === e.session.currentStepId);
    const notesAllowed = D.can(ctx, 'presentation.internalNotes.read');
    return freeze({ currentStepId: e.session.currentStepId, nextStepId: ss[i + 1] ? ss[i + 1].id : null, previousStepId: i > 0 ? ss[i - 1].id : null, presenterNotesVisible: notesAllowed && !!e.session.runtimeFlags.presenterNotesVisible,
      audienceScreenConnected: !!e.session.runtimeFlags.audienceScreenConnected, controls: CONTROLS.filter(c => !c.permission || D.can(ctx, c.permission)).map(c => c.id),
      warnings: e.snapshot.warnings.map(w => (D.MESSAGES[w.code] || w.code) + (w.lotRef ? ` (${w.lotRef})` : '')), notes: notesAllowed ? notes.forStep(e.snapshot.presentationDefinitionId, e.session.currentStepId) : [] });
  }
  const CONTROLS = Object.freeze([{ id: 'ADD_PRESENTER_NOTE', permission: 'presentation.internalNotes.read' }, { id: 'MARK_PRESENTED' }, { id: 'RECORD_FEEDBACK', permission: 'presentation.feedback.record' }, { id: 'CREATE_FOLLOW_UP' }, { id: 'SCHEDULE_VISIT' }]);
  /** PresentationPresenterControlsPolicy: audience projection never carries these ids */
  const PRESENTER_CONTROLS_POLICY = Object.freeze({ audienceVisible: false, sameDeviceConcealed: true, separateWindowReady: true, controls: CONTROLS.map(c => c.id) });
  /** restorePayload / restore: crash recovery keeps only { snapshotId, currentStepId, mode } (no notes, no customer data) and re-checks access */
  const restorePayload = id => { const s = getSession(id); return s ? { snapshotId: s.presentationSnapshotId, currentStepId: s.currentStepId, mode: s.mode } : null; };
  function restore(repo, ctx, payload) {
    if (!payload || !payload.snapshotId) return { ok: false, code: 'NOTHING_TO_RESTORE' };
    const r = start(repo, ctx, payload.snapshotId, { mode: payload.mode }); if (!r.ok) return r;
    const e = entry(r.session.id); if (steps(e).some(s => s.id === payload.currentStepId)) put(e, { currentStepId: payload.currentStepId });
    return { ok: true, session: e.session };
  }

  // ---------------------------------------------------------------- overlay coordinator (one dominant overlay; no hidden modal stacks)
  const OVERLAYS = Object.freeze(['COMPARISON', 'FINANCIAL', 'LOT_DETAILS', 'MAP_LEGEND', 'FEEDBACK']);
  function createOverlayCoordinator() {
    let cur = null;
    return { open(kind) { if (!OVERLAYS.includes(kind)) throw err('UNKNOWN_OVERLAY', kind); const prev = cur; cur = kind; return { current: cur, replaced: prev }; }, close() { const p = cur; cur = null; return p; }, current: () => cur };
  }

  // ---------------------------------------------------------------- feedback intents (no profile mutation, no inferred constraints)
  const feedback = [];
  function recordFeedback(sessionId, input = {}, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    if (!D.can(ctx, 'presentation.feedback.record')) return { ok: false, code: 'FORBIDDEN' };
    if (!P.FeedbackType[input.type]) return { ok: false, code: 'INVALID_FEEDBACK_TYPE' };
    const by = input.recordedBy === 'CUSTOMER' ? 'CUSTOMER' : 'PRESENTER';
    const lot = input.lotRef ? e.snapshot.lotRefs.find(l => l.lotRef === input.lotRef) : null;
    if (input.lotRef && !lot) return { ok: false, code: 'LOT_NOT_IN_PRESENTATION' };
    const intent = freeze({ id: D.opaqueId('pfi'), sessionId, customerId: e.snapshot.customerRef ? e.snapshot.customerRef.customerId : null, lotId: lot ? lot.lotId : null, type: input.type, recordedAt: nowIso(ctx), recordedBy: by });
    feedback.push(intent); put(e, { feedbackIds: [...e.session.feedbackIds, intent.id] });
    D.emit('PresentationFeedbackRecorded', { organizationId: e.session.organizationId, sessionId, feedbackId: intent.id, type: intent.type }, ctx);
    const journeyEvent = e.snapshot.journeyId ? freeze({ type: 'PRESENTATION_FEEDBACK_RECORDED', journeyId: e.snapshot.journeyId, feedbackId: intent.id, feedbackType: intent.type }) : null;
    const nextAction = intent.type === 'VISIT_INTEREST' ? freeze({ type: 'NEXT_ACTION_SUGGESTION', action: 'SCHEDULE_VISIT', lotId: intent.lotId, reservation: false })
      : intent.type === 'FINANCIAL_INTEREST' ? freeze({ type: 'NEXT_ACTION_SUGGESTION', action: 'UPDATE_SIMULATION', lotId: intent.lotId }) : null;
    // DISLIKED is a signal for the broker to review; it never becomes a hard constraint, a preference or an unfavorite
    return { ok: true, intent, journeyEvent, nextAction, profileChanged: false, favoriteChanged: false };
  }
  const feedbackOf = sessionId => feedback.filter(f => f.sessionId === sessionId);
  /** PresentationOutcomeSummary: session summary (not analytics truth) */
  function outcome(sessionId) {
    const e = entry(sessionId), fb = feedbackOf(sessionId), refById = Object.fromEntries(e.snapshot.lotRefs.map(l => [l.lotId, l.lotRef]));
    return freeze({ sessionId, viewedLotIds: e.session.viewedLotRefs.map(r => (e.snapshot.lotRefs.find(l => l.lotRef === r) || {}).lotId).filter(Boolean), feedbackCount: fb.length,
      interestedLotIds: [...new Set(fb.filter(f => ['LIKED', 'MORE_INFO', 'VISIT_INTEREST', 'FINANCIAL_INTEREST', 'COMPARE'].includes(f.type) && f.lotId).map(f => f.lotId))].filter(id => refById[id]),
      nextActionSuggestionIds: fb.filter(f => ['VISIT_INTEREST', 'FINANCIAL_INTEREST'].includes(f.type)).map(f => f.id), completed: !!e.session.runtimeFlags.completed });
  }

  // ---------------------------------------------------------------- presenter notes (separate entity; memory only; never in snapshots)
  const notes = (() => {
    const all = [];
    return {
      add(ctx, n) { if (!D.can(ctx, 'presentation.internalNotes.read')) throw err('FORBIDDEN', 'Notas do apresentador exigem permissão.'); const x = freeze({ id: D.opaqueId('pnt'), presentationDefinitionId: n.presentationDefinitionId, blockId: n.blockId || null, stepId: n.stepId || null, authorUserId: ctx.userId || null, text: String(n.text || '').slice(0, 2000), visibility: 'PRESENTER_ONLY', createdAt: nowIso(ctx) }); all.push(x); return x; },
      forStep: (defId, stepId) => all.filter(n => n.presentationDefinitionId === defId && (!n.stepId || n.stepId === stepId)).map(n => ({ id: n.id, text: n.text })),
      clear: () => { all.length = 0; }
    };
  })();

  // ---------------------------------------------------------------- offline + fallback + private cache
  const OFFLINE_POLICY = Object.freeze({ allowSnapshotCache: false, allowCustomerLabelCache: false, allowMapAssetsCache: true, allowFinancialDataCache: false, maxCacheAgeSeconds: null, clearOnLogout: true });
  /** offlineView(snapshot, { online, policy, now, cached }) — SNAPSHOT may present offline only if policy allows caching it; never claims current availability */
  function offlineView(snap, o = {}) {
    const pol = { ...OFFLINE_POLICY, ...(o.policy || {}) };
    if (o.online !== false) return { allowed: true, offline: false, banner: null };
    if (!o.cached || !pol.allowSnapshotCache) return { allowed: false, offline: true, code: 'OFFLINE_SNAPSHOT_NOT_CACHED', message: 'Sem conexão e sem cópia local autorizada desta apresentação.' };
    if (pol.maxCacheAgeSeconds != null && (Date.parse(o.now || new Date().toISOString()) - Date.parse(snap.generatedAt)) / 1000 > pol.maxCacheAgeSeconds) return { allowed: false, offline: true, code: 'OFFLINE_CACHE_EXPIRED', message: 'A cópia local desta apresentação expirou.' };
    const fr = D.freshness(snap, { now: o.now, offline: true });
    return { allowed: true, offline: true, banner: fr.warnings.join(' '), currentAvailabilityClaimed: false, canRefresh: false, customerLabelVisible: pol.allowCustomerLabelCache, financialVisible: pol.allowFinancialDataCache };
  }
  /** liveFallback({ online, policy, lastSafeSnapshot }) — LIVE offline degrades explicitly (never silently) */
  function liveFallback(o = {}) {
    if (o.online !== false) return { mode: 'LIVE' };
    const pol = P.FallbackPolicy[o.policy] ? o.policy : 'BLOCK';
    if (pol === 'USE_LAST_SAFE_SNAPSHOT' && o.lastSafeSnapshot) return { mode: 'SNAPSHOT', snapshotId: o.lastSafeSnapshot.id, notice: 'Sem conexão: exibindo a última versão preparada desta apresentação.' };
    if (pol === 'ALLOW_PARTIAL_WITH_WARNING') return { mode: 'PARTIAL', notice: 'Sem conexão: alguns dados podem não estar disponíveis ou atualizados.' };
    return { mode: 'BLOCKED', notice: 'Sem conexão: a apresentação ao vivo não pode ser exibida.' };
  }
  /** private cache: key = org | snapshot/definition | policy version | permission context | version refs; cleared on logout/tenant switch */
  const cache = (() => {
    const m = new Map();
    const keyOf = k => [k.organizationId, k.snapshotId || k.definitionId, k.clientSafePolicyVersion, k.permissionContext || 'default', D.checksum(k.versionRefs || null)].join('|');
    return { keyOf, get: k => m.get(keyOf(k)) || null, set: (k, v) => { m.set(keyOf(k), v); return v; }, clearOrg: org => { for (const k of [...m.keys()]) if (k.startsWith(org + '|')) m.delete(k); }, clear: () => m.clear(), size: () => m.size };
  })();
  function clearPrivateState(reason = 'logout') { cache.clear(); sessions.clear(); notes.clear(); feedback.length = 0; return { cleared: true, reason }; }
  let lastOrg;
  /** bindAuth(): logout or tenant switch clears sessions, notes and the private cache */
  function bindAuth() {
    if (!App.authz || !App.authz.subscribe) return () => {};
    const org = () => { try { const c = App.authz.context(); return c && c.tenant ? c.tenant.organizationId : null; } catch (e) { return null; } };
    lastOrg = org();
    return App.authz.subscribe((ctx, info) => { const why = info && info.why, o = ctx && ctx.tenant ? ctx.tenant.organizationId : null; if (why === 'logout' || (info && info.tenantChanged) || o !== lastOrg) clearPrivateState(why === 'logout' ? 'logout' : 'tenant-switch'); lastOrg = o; });
  }

  // ---------------------------------------------------------------- theme (UI only; versioned)
  const DEFAULT_THEME = freeze({ id: 'house7-default', organizationId: 'house7', name: 'House 7', version: '1.0.0', logoAssetRef: 'logo.png', status: 'ACTIVE',
    typographyTokens: { heading: 'var(--font-heading, inherit)', body: 'var(--font-body, inherit)' }, spacingTokens: { block: '24px', gutter: '16px' }, layoutTokens: { maxWidth: '1100px' }, presentationComponentTokens: { cardRadius: '12px' } });
  function validateTheme(th) {
    const e = [];
    if (!th || !th.id || !th.version || !th.organizationId) e.push('IDENTITY');
    if (th && th.status !== 'ACTIVE') e.push('NOT_ACTIVE');
    const bad = /(price|preco|score|filter|rank|winner|availability|admin|debug)|^fit/i;
    for (const g of ['typographyTokens', 'spacingTokens', 'layoutTokens', 'presentationComponentTokens']) for (const [k, v] of Object.entries((th && th[g]) || {})) {
      if (bad.test(k)) e.push('BUSINESS_KEY:' + k);
      if (typeof v !== 'string' || /javascript:|expression\(|url\(\s*['"]?\s*(?!data:image\/)/i.test(v) || /<|>/.test(v)) e.push('UNSAFE_TOKEN:' + k);
    }
    return e;
  }
  /** device layout only (content truth is the same on every profile) */
  const LAYOUT = Object.freeze({ DESKTOP: { navigation: 'side', columns: 2, presenterPanel: 'inline' }, TABLET: { navigation: 'bottom', columns: 1, presenterPanel: 'drawer' },
    MOBILE: { navigation: 'bottom', columns: 1, presenterPanel: 'drawer', vertical: true }, EXTERNAL_DISPLAY: { navigation: 'hidden', columns: 2, presenterPanel: 'separate-surface' } });
  const layoutFor = p => LAYOUT[p] || LAYOUT.DESKTOP;

  // ---------------------------------------------------------------- export foundation (snapshot only)
  function exportRequest(snap, input = {}, ctx = {}) {
    if (!snap || !snap.id || !snap.checksum) return { ok: false, code: 'SNAPSHOT_REQUIRED' }; // never from a mutable Definition
    if (!['PDF', 'PRINT', 'IMAGE_SET'].includes(input.format)) return { ok: false, code: 'INVALID_FORMAT' };
    const sf = D.safety.get(snap.organizationId, snap.id); if (!sf || sf.status !== 'SAFE') return { ok: false, code: 'SNAPSHOT_NOT_SAFE' };
    return { ok: true, request: freeze({ snapshotId: snap.id, format: input.format, audience: 'CLIENT', includeCover: input.includeCover !== false, includeMap: !!input.includeMap, requestedBy: ctx.userId || null }), engine: input.format === 'PRINT' ? 'BROWSER_PRINT' : 'PENDING_TOPIC_42' };
  }
  /** internal route for authenticated users (no public access here; ShareService decides tokens) */
  const internalRoute = snapshotId => '/presentations/' + encodeURIComponent(snapshotId);

  // ---------------------------------------------------------------- legacy inventory (what existed before topic 41)
  const LEGACY_INVENTORY = Object.freeze([
    { location: 'presentation/app.js togglePresentation + store.presentationView', behavior: 'Botão "Apresentar": muda presentationMode para client, fecha gaveta e mostra só mapa/painel', dataSources: ['LotRepository (lots.json)', 'store'],
      hidesControlsOnly: false, exposesInternalPayload: true, classification: 'UI_ONLY', migrationAction: 'REUSE_UI', notes: 'Os textos passam por viewmodels (isFieldVisible), mas o lote canônico completo (scores, notas, provenance) está na página. Dataset público, sem PII; não serve como projeção segura para dados privados.' },
    { location: 'config/presentation.js hiddenFields/hiddenSections (modo cliente)', behavior: 'Lista de campos ocultos (deny-list)', dataSources: ['FieldRegistry'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'CLIENT_SAFE_PROJECTION', migrationAction: 'REUSE_UI', notes: 'Agora deny by default: clientSafeFields (allow-list) + hiddenFields. Campo novo fica oculto até ser classificado.' },
    { location: 'presentation/app.js classes ws.client / ws.pres / ws.tech', behavior: 'CSS esconde controles no modo cliente/apresentação', dataSources: [], hidesControlsOnly: true, exposesInternalPayload: false,
      classification: 'UI_ONLY', migrationAction: 'REVIEW', notes: 'Esconder por CSS não é segurança; o conteúdo do modo apresentação novo vem de snapshot.audience.' },
    { location: 'presentation/compareView.js + quickview (audience client/presentation)', behavior: 'Comparação e Quick View com audiência client', dataSources: ['compare.evaluation', 'quickView'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'CLIENT_SAFE_PROJECTION', migrationAction: 'REUSE_UI', notes: 'Reutilizados pela projeção (highlights audience presentation).' },
    { location: 'presentation/overlays.js share modal (WhatsApp/copiar texto/copiar link, PDF em breve)', behavior: 'Texto e link enviados ao cliente', dataSources: ['vm.shareVM', 'services.share'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'SHARE', migrationAction: 'REVIEW', notes: 'Distribuição é do tópico 42 (App.share). PDF continua desativado.' }
  ].map(Object.freeze));

  return Object.freeze({ openSnapshot, start, goTo, next, previous, jumpToLot, returnToMap, setMode, pause, resume, setFullscreen, markCompleted, end, getSession, audienceView, presenterControlState,
    PRESENTER_CONTROLS_POLICY, restorePayload, restore, createOverlayCoordinator, OVERLAYS, recordFeedback, feedbackOf, outcome, notes, OFFLINE_POLICY, offlineView, liveFallback, cache, clearPrivateState, bindAuth,
    DEFAULT_THEME, validateTheme, LAYOUT, layoutFor, exportRequest, internalRoute, LEGACY_INVENTORY });
})();

/* ---- share/shareDomain.js ---- */
/* share/shareDomain.js — topic 42: ShareService domain (frontend side + reference implementation of the contracts).
   ShareDefinition · SharePolicy (versioned registry) · ShareGrant (+ derived EXPIRED) · ShareTokenRecord (hash only) ·
   ShareArtifactRef · ShareAccessDecision (+ capabilities) · ShareAccessSession · ShareRevocationRecord ·
   ShareFreshnessPolicy · SharePasscodePolicy · ShareRateLimitPolicy · SharePreviewMetadataPolicy · ShareAssetAccessPolicy ·
   ShareReusePolicy · ShareSafetyDependency · ShareEntryPoint (+ validated initial view state) · ShareActionEvent /
   ShareAccessRecord · permissions · legacy link inventory.

   THE FRONTEND IS NEVER THE AUTHORITY FOR A SHARE. Issuing, hashing, expiry, revocation, one-time consumption, passcode
   and rate limits are enforced by the backend (docs/SHARE_*.md, backend/src/modules/share/tokens.js). This module
   gives the UI the same rules (to show correct states and never build an unsafe link) and an in-memory reference used
   by the tests. A share token held by the browser is a bearer secret for the backend, never an authorization the
   frontend trusts. Share URLs carry only an opaque token: no customer id, no PII, no lot id, no price, no query params. */
App.share = App.share || {};
App.share.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const ResourceType = E('PRESENTATION_SNAPSHOT', 'LOT_SNAPSHOT', 'FAVORITE_COLLECTION_SNAPSHOT', 'COMPARISON_SNAPSHOT', 'RECOMMENDATION_RESULT', 'FINANCIAL_SIMULATION_RESULT', 'DOCUMENT', 'CUSTOM_CLIENT_SAFE_RESOURCE');
  const AudienceType = E('CUSTOMER', 'CUSTOMER_GROUP', 'AUTHENTICATED_INTERNAL', 'AUTHENTICATED_EXTERNAL', 'PUBLIC_LINK');
  const AccessMode = E('AUTHENTICATED', 'TOKEN', 'TOKEN_PLUS_PASSCODE', 'ONE_TIME_TOKEN');
  const DefinitionStatus = E('DRAFT', 'ACTIVE', 'ARCHIVED');
  const GrantStatus = E('ACTIVE', 'EXPIRED', 'REVOKED', 'CONSUMED', 'SUSPENDED');
  const Capability = E('VIEW', 'PRINT', 'DOWNLOAD', 'RESHARE', 'OPEN_MAP', 'OPEN_COMPARISON', 'OPEN_FINANCIAL', 'SUBMIT_FEEDBACK');
  const ChannelType = E('COPY_LINK', 'NATIVE_SHARE', 'WHATSAPP', 'EMAIL', 'QR_CODE', 'INTERNAL', 'OTHER');
  const RevocationReason = E('USER_REVOKED', 'CUSTOMER_REQUEST', 'RESOURCE_REVOKED', 'SECURITY_POLICY_CHANGE', 'DATA_CORRECTION', 'SHARE_CREATED_IN_ERROR', 'CUSTOMER_RELATIONSHIP_ENDED', 'OTHER');
  const PreviewMode = E('GENERIC', 'RESOURCE_SAFE', 'DISABLED');
  const AssetAccess = E('PROXY_AUTHORIZED', 'SHORT_LIVED_SIGNED_URL', 'PUBLIC_STATIC_SAFE_ASSET');
  const RecipientConstraint = E('NONE', 'PASSCODE', 'AUTHENTICATED_IDENTITY', 'EMAIL_CHALLENGE');
  /** client-facing errors are generic: invalid / expired / revoked / suspended / consumed / cross-tenant all look the same */
  const PublicError = E('LINK_INVALID_OR_UNAVAILABLE', 'PASSCODE_REQUIRED', 'PASSCODE_INVALID', 'ACCESS_LIMIT_REACHED', 'RESOURCE_UNAVAILABLE');
  const PUBLIC_MESSAGES = Object.freeze({
    LINK_INVALID_OR_UNAVAILABLE: org => `Este link não está mais disponível. Entre em contato com a ${org || 'imobiliária'} para receber uma versão atualizada.`,
    PASSCODE_REQUIRED: () => 'Digite o código de acesso para ver este conteúdo.', PASSCODE_INVALID: () => 'Código de acesso incorreto.',
    ACCESS_LIMIT_REACHED: org => `Este link atingiu o limite de acessos. Entre em contato com a ${org || 'imobiliária'}.`,
    RESOURCE_UNAVAILABLE: () => 'Esta apresentação precisa ser atualizada antes de ser exibida.'
  });
  const POLICY_REGISTRY_VERSION = 'share-42.1.0';
  const DAY = 86400;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowMs = o => Date.parse((o && o.now) || new Date().toISOString());
  const iso = ms => new Date(ms).toISOString();
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };

  // ---------------------------------------------------------------- SharePolicy registry (versioned; TTLs are per content, never universal)
  const P = (code, o) => freeze({ id: 'shp_' + code.toLowerCase(), organizationId: null, code, version: '1.0.0', status: 'ACTIVE', allowNoExpiry: false, allowDownload: false, allowPrint: true, allowReshare: false,
    requireCurrentSafetyStatus: true, requireFreshnessCheck: true, allowedChannelTypes: ['COPY_LINK', 'NATIVE_SHARE', 'WHATSAPP', 'EMAIL', 'QR_CODE'], maxAccessCount: null,
    passcodePolicyRef: 'passcode-default', rateLimitPolicyRef: 'rate-default', cachePolicyRef: 'private-no-store', previewMetadata: 'GENERIC', reviewRequiredBehavior: 'SUSPEND',
    allowedAudienceTypes: ['CUSTOMER', 'CUSTOMER_GROUP', 'PUBLIC_LINK'], allowedAccessModes: ['TOKEN', 'TOKEN_PLUS_PASSCODE', 'ONE_TIME_TOKEN'],
    capabilities: ['VIEW', 'PRINT', 'OPEN_MAP', 'OPEN_COMPARISON', 'OPEN_FINANCIAL', 'SUBMIT_FEEDBACK'], ...o });
  const POLICIES = freeze({
    PRESENTATION_CUSTOMER: P('PRESENTATION_CUSTOMER', { allowedResourceTypes: ['PRESENTATION_SNAPSHOT'], defaultTtlSeconds: 7 * DAY, maxTtlSeconds: 30 * DAY,
      freshness: { resourceType: 'PRESENTATION_SNAPSHOT', staleBehavior: 'ALLOW_WITH_WARNING', availabilityBehavior: 'ALLOW_WITH_CAVEAT', pricingBehavior: 'ALLOW_WITH_CAVEAT', financialBehavior: 'ALLOW_SNAPSHOT' } }),
    LOT_CUSTOMER: P('LOT_CUSTOMER', { allowedResourceTypes: ['LOT_SNAPSHOT', 'FAVORITE_COLLECTION_SNAPSHOT', 'COMPARISON_SNAPSHOT'], defaultTtlSeconds: 7 * DAY, maxTtlSeconds: 30 * DAY, capabilities: ['VIEW', 'PRINT', 'OPEN_MAP', 'OPEN_COMPARISON', 'SUBMIT_FEEDBACK'],
      freshness: { resourceType: 'LOT_SNAPSHOT', staleBehavior: 'ALLOW_WITH_WARNING', availabilityBehavior: 'ALLOW_WITH_CAVEAT', pricingBehavior: 'ALLOW_WITH_CAVEAT', financialBehavior: 'ALLOW_SNAPSHOT' } }),
    FINANCIAL_CUSTOMER: P('FINANCIAL_CUSTOMER', { allowedResourceTypes: ['FINANCIAL_SIMULATION_RESULT'], defaultTtlSeconds: 2 * DAY, maxTtlSeconds: 7 * DAY, capabilities: ['VIEW', 'PRINT', 'OPEN_FINANCIAL'],
      freshness: { resourceType: 'FINANCIAL_SIMULATION_RESULT', staleBehavior: 'REQUIRE_REFRESH', availabilityBehavior: 'BLOCK_IF_STALE', pricingBehavior: 'BLOCK_IF_STALE', financialBehavior: 'BLOCK_IF_EXPIRED' } }),
    DOCUMENT_DENY: P('DOCUMENT_DENY', { allowedResourceTypes: [], defaultTtlSeconds: 0, maxTtlSeconds: 0, allowedChannelTypes: [], capabilities: [], freshness: null, note: 'Documentos só com classificação permitida (Document Domain ainda inexistente).' })
  });
  const policyFor = resourceType => Object.values(POLICIES).find(p => p.status === 'ACTIVE' && p.allowedResourceTypes.includes(resourceType)) || null;
  const policyRef = p => `${p.code}@${p.version}`;
  const SHARE_PASSCODE_POLICY = freeze({ minLength: 6, maxAttempts: 5, lockoutSeconds: 900, hashAlgorithmRef: 'scrypt-N16384-r8-p1 (backend) · PBKDF2-SHA256-210000 (reference)' });
  const RATE_LIMIT_POLICY = freeze({ maxAttemptsPerMinute: 30, maxInvalidTokenAttemptsPerMinute: 10, maxPasscodeAttempts: 5, lockoutSeconds: 900 });
  const SESSION_TTL_SECONDS = 30 * 60; // short-lived share session (never longer than the grant)
  const SECURITY_HEADERS = freeze({ 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  const REUSE_POLICY = freeze({ reuseActiveGrantForSameResource: false, requireSameAudienceBinding: true, requireSamePolicyVersion: true, requireSameExpiryPolicy: false, askUser: 'Já existe um link ativo. Copiar existente ou criar novo?' });
  const WATERMARK_POLICY = freeze({ enabled: false, type: 'GENERIC', showTimestamp: true });

  // ---------------------------------------------------------------- permissions (resource.read ≠ share.issue)
  const PERMISSIONS = freeze({ 'share.read': 'share.create', 'share.create': 'share.create', 'share.issue': 'share.create', 'share.revoke': 'share.create', 'share.suspend': 'share.create', 'share.channel.generate': 'share.create',
    'share.extendExpiry': null, 'share.viewAccessHistory': null, 'share.overridePolicy': null }); // null = never granted locally (backend registry first)
  function can(ctx, key) {
    if (!(key in PERMISSIONS)) return false;
    if (ctx && typeof ctx.can === 'function') return ctx.can(key) === true;
    const k = PERMISSIONS[key]; if (!k) return false;
    try { return !!(App.authz && App.authz.can(k)); } catch (e) { return false; }
  }
  /** ExternalShareCapability: Tenant AND share permission AND resource read AND policy; a raw technical object is never externally shareable */
  function externalShareCapability(ctx, artifact, o = {}) {
    const reasons = [];
    if (!artifact || !ResourceType[artifact.resourceType]) reasons.push('UNSUPPORTED_RESOURCE');
    else if (!policyFor(artifact.resourceType)) reasons.push('NO_POLICY_FOR_RESOURCE');
    if (!ctx || !ctx.organizationId || (artifact && artifact.organizationId !== ctx.organizationId)) reasons.push('CROSS_TENANT');
    if (!can(ctx, 'share.issue')) reasons.push('NO_SHARE_PERMISSION');
    if (!(o.canReadResource === true)) reasons.push('NO_RESOURCE_ACCESS');
    if (artifact && artifact.safetyStatus && artifact.safetyStatus !== 'SAFE') reasons.push('RESOURCE_NOT_SAFE');
    if (artifact && artifact.clientSafe !== true) reasons.push('NOT_CLIENT_SAFE');
    return freeze({ allowed: !reasons.length, reasons });
  }

  // ---------------------------------------------------------------- token (cryptographic, opaque; raw value returned once)
  function rng(n) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.getRandomValues) throw err('TOKEN_RNG_UNAVAILABLE', 'Gerador criptográfico indisponível: link não emitido.'); // never Math.random
    return c.getRandomValues(new Uint8Array(n));
  }
  const b64url = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  /** generateToken() → 32 random bytes (256 bits) as base64url (43 chars). Not derived from any id. */
  const generateToken = () => b64url(rng(32));
  /** hashToken(token, pepper?) → hex SHA-256 (reference). The backend uses HMAC-SHA256 with a server-side pepper. */
  async function hashToken(token, pepper = '') {
    const c = typeof crypto !== 'undefined' ? crypto : null; if (!c || !c.subtle) throw err('HASH_UNAVAILABLE', 'Hash indisponível.');
    const d = await c.subtle.digest('SHA-256', new TextEncoder().encode(pepper + ':' + token));
    return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
  }
  /** redactToken(text): removes any token-looking secret from text before it reaches logs/analytics */
  const redactToken = s => String(s == null ? '' : s).replace(/\/s\/[A-Za-z0-9_-]{20,}/g, '/s/[token]').replace(/\b[A-Za-z0-9_-]{43}\b/g, '[token]');

  // ---------------------------------------------------------------- share URL (opaque token only; nothing else)
  const URL_FORBIDDEN = Object.freeze([
    { code: 'QUERY_PARAMS', re: /\?/ }, { code: 'FRAGMENT_STATE', re: /#./ }, { code: 'PII_EMAIL', re: /[A-Z0-9._%+-]+(@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { code: 'PII_PHONE', re: /(?:\+|%2B)?55\d{10,11}|\(?\b\d{2}\)?[\s-]?9\d{4}[-\s]?\d{4}\b/ }, { code: 'PII_CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
    { code: 'CUSTOMER_ID', re: /customer|cliente|\bcus_|\bC\d{2,}\b/i }, { code: 'INTERNAL_LOT_ID', re: /\b[A-Z]{1,4}-Q[A-Z0-9]{1,4}-L\d{4}\b/ },
    { code: 'COMMERCIAL_VALUE', re: /price|preco|valor|R\$|\b\d{5,}\b/i }, { code: 'INTERNAL_RESOURCE_ID', re: /\b(prs|prd|pss|shd|shg)_[a-z0-9]+/i }
  ]);
  /** validateShareUrl(url) → [{ code }] (empty = safe). Applied to every URL the channel service emits. */
  function validateShareUrl(url) {
    const out = [], s = String(url || '');
    const m = s.match(/^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?)(\/[^?#]*)?\/s\/([A-Za-z0-9_-]+)$/);
    if (!m) out.push({ code: 'NOT_A_SHARE_URL' });
    else if (!TOKEN_RE.test(m[3])) out.push({ code: 'TOKEN_FORMAT' });
    const path = m ? (m[1].replace(/^https:\/\/[^/]+/, '') + (m[2] || '')) : s; // origin is trusted config; token itself is random
    for (const f of URL_FORBIDDEN) if (f.re.test(path) || (!m && f.re.test(s))) out.push({ code: f.code });
    return out;
  }
  /** shareUrl(origin, token): https origin only, no path params, no query; throws if anything unsafe slips in */
  function shareUrl(origin, token) {
    const o = String(origin || '').replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/[A-Za-z0-9._-]+)*$/.test(o)) throw err('INVALID_SHARE_ORIGIN', 'Origem de compartilhamento inválida (https, sem parâmetros).');
    const u = `${o}/s/${token}`, v = validateShareUrl(u);
    if (v.length) throw err('UNSAFE_SHARE_URL', 'URL de compartilhamento insegura: ' + v.map(x => x.code).join(', '), { issues: v });
    return u;
  }

  // ---------------------------------------------------------------- ShareDefinition / ShareGrant (pure lifecycle)
  function opaque(prefix) { return prefix + '_' + Array.from(rng(10), x => x.toString(16).padStart(2, '0')).join(''); }
  function createDefinition(ctx, input = {}) {
    if (!can(ctx, 'share.create')) throw err('FORBIDDEN', 'Você não possui permissão para compartilhar.');
    const a = input.artifact || {};
    if (!ResourceType[a.resourceType]) throw err('UNSUPPORTED_RESOURCE', 'Tipo de recurso não compartilhável.');
    const pol = input.policyCode ? POLICIES[input.policyCode] : policyFor(a.resourceType);
    if (!pol || !pol.allowedResourceTypes.includes(a.resourceType)) throw err('POLICY_DENIES_RESOURCE', 'A política não permite compartilhar este recurso.');
    if (a.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Recurso de outra organização.');
    const at = iso(nowMs(ctx));
    return freeze({ id: opaque('shd'), organizationId: ctx.organizationId, resourceType: a.resourceType, resourceId: a.resourceId, resourceVersionRef: a.versionRef || null, audienceType: input.audienceType || 'CUSTOMER',
      accessMode: input.accessMode || 'TOKEN', policyId: pol.id, policyVersionRef: policyRef(pol), title: input.title || null, description: null, lifecycleStatus: 'DRAFT', createdAt: at, updatedAt: at, createdBy: ctx.userId || null, updatedBy: null, recordRevision: 1,
      audienceBinding: input.audienceBinding ? { customerId: input.audienceBinding.customerId || null, customerGroupRef: input.audienceBinding.customerGroupRef || null, enforceBinding: !!input.audienceBinding.enforceBinding } : null }); // never a token
  }
  /** issueGrant(def, ctx, opts) → ShareGrant (pure; token generation/hashing happens in the service) */
  function buildGrant(def, ctx, o = {}) {
    if (def.lifecycleStatus === 'ARCHIVED') throw err('DEFINITION_ARCHIVED', 'Compartilhamento arquivado não emite novos links.');
    const pol = Object.values(POLICIES).find(p => p.id === def.policyId);
    if (!pol || pol.status !== 'ACTIVE') throw err('POLICY_NOT_ACTIVE', 'Política de compartilhamento inativa.');
    const mode = o.accessMode || def.accessMode, aud = o.audienceType || def.audienceType;
    if (!pol.allowedAccessModes.includes(mode)) throw err('ACCESS_MODE_NOT_ALLOWED', 'Modo de acesso não permitido pela política.');
    if (!pol.allowedAudienceTypes.includes(aud)) throw err('AUDIENCE_NOT_ALLOWED', 'Público não permitido pela política.');
    const now = nowMs(ctx), ttl = o.ttlSeconds == null ? pol.defaultTtlSeconds : o.ttlSeconds;
    if (ttl === Infinity || ttl === 0 || ttl == null) { if (!pol.allowNoExpiry) throw err('EXPIRY_REQUIRED', 'Este tipo de link precisa expirar.'); }
    else if (!(ttl > 0) || ttl > pol.maxTtlSeconds) throw err('TTL_OUT_OF_POLICY', `Validade máxima: ${Math.round(pol.maxTtlSeconds / DAY)} dias.`);
    const validFrom = o.validFrom ? Date.parse(o.validFrom) : now;
    return freeze({ id: opaque('shg'), organizationId: def.organizationId, shareDefinitionId: def.id, resourceType: def.resourceType, resourceId: def.resourceId, resourceVersionRef: def.resourceVersionRef,
      accessMode: mode, audienceType: aud, policyVersionRef: policyRef(pol), lifecycleStatus: 'ACTIVE', issuedAt: iso(now), issuedBy: ctx.userId || null, validFrom: iso(validFrom),
      expiresAt: ttl > 0 && ttl !== Infinity ? iso(validFrom + ttl * 1000) : null, revokedAt: null, revokedBy: null, revocationReasonCode: null,
      maxAccessCount: mode === 'ONE_TIME_TOKEN' ? 1 : o.maxAccessCount ?? pol.maxAccessCount ?? null, accessCount: 0, lastAccessAt: null, safetyStatusRef: o.safetyStatusRef || null, recordRevision: 1,
      capabilities: pol.capabilities.filter(c => c !== 'DOWNLOAD' || pol.allowDownload).filter(c => c !== 'PRINT' || pol.allowPrint).filter(c => c !== 'RESHARE' || pol.allowReshare) });
  }
  /** effectiveStatus(grant, now): EXPIRED derived from the clock (backend clock is authoritative; client clock never trusted) */
  function effectiveStatus(g, o = {}) {
    if (g.lifecycleStatus !== 'ACTIVE') return g.lifecycleStatus;
    const now = nowMs(o);
    if (g.expiresAt && now >= Date.parse(g.expiresAt)) return 'EXPIRED';
    if (g.maxAccessCount != null && g.accessCount >= g.maxAccessCount) return g.accessMode === 'ONE_TIME_TOKEN' ? 'CONSUMED' : 'ACTIVE';
    return 'ACTIVE';
  }
  const mutateGrant = (g, patch, expectedRevision) => { if (expectedRevision != null && expectedRevision !== g.recordRevision) throw err('REVISION_CONFLICT', 'O link foi alterado. Recarregue.'); return freeze({ ...g, ...patch, recordRevision: g.recordRevision + 1 }); };
  function revoke(g, ctx, reasonCode = 'USER_REVOKED', note) {
    if (!RevocationReason[reasonCode]) throw err('INVALID_REASON', reasonCode);
    if (g.lifecycleStatus === 'REVOKED') return { grant: g, record: null };
    const at = iso(nowMs(ctx));
    return { grant: mutateGrant(g, { lifecycleStatus: 'REVOKED', revokedAt: at, revokedBy: ctx.userId || null, revocationReasonCode: reasonCode }), record: freeze({ id: opaque('shr'), shareGrantId: g.id, reasonCode, revokedAt: at, revokedBy: ctx.userId || null, note: note ? String(note).slice(0, 200) : null }) };
  }
  const suspend = (g, ctx) => g.lifecycleStatus === 'ACTIVE' ? mutateGrant(g, { lifecycleStatus: 'SUSPENDED' }) : g;
  const resume = (g, ctx) => g.lifecycleStatus === 'SUSPENDED' ? mutateGrant(g, { lifecycleStatus: 'ACTIVE' }) : g;
  /** changeExpiry: shortening is always allowed; extending needs share.extendExpiry (never granted locally) and stays within policy */
  function changeExpiry(g, ctx, expiresAtIso) {
    const pol = Object.values(POLICIES).find(p => policyRef(p) === g.policyVersionRef), next = Date.parse(expiresAtIso), cur = g.expiresAt ? Date.parse(g.expiresAt) : Infinity;
    if (!(next > nowMs(ctx))) throw err('INVALID_EXPIRY', 'Data de expiração inválida.');
    if (next > cur && !can(ctx, 'share.extendExpiry')) throw err('FORBIDDEN', 'Estender a validade exige permissão.');
    if (pol && next - Date.parse(g.validFrom || g.issuedAt) > pol.maxTtlSeconds * 1000) throw err('TTL_OUT_OF_POLICY', 'Validade acima do máximo da política.');
    return mutateGrant(g, { expiresAt: iso(next) });
  }

  // ---------------------------------------------------------------- access decision (pure)
  /** evaluateAccess({ grant, now, tenantActive, safetyStatus, freshness, passcode: { required, verified, locked }, rateLimited, preview, consume }) → ShareAccessDecision */
  function evaluateAccess(i = {}) {
    const g = i.grant, reasons = [], pol = g ? Object.values(POLICIES).find(p => policyRef(p) === g.policyVersionRef) : null;
    const deny = (code, pub) => freeze({ allowed: false, denialReasonCodes: [...reasons, code], publicError: pub, grantStatus: g ? effectiveStatus(g, i) : null, requiresPasscode: pub === 'PASSCODE_REQUIRED' || pub === 'PASSCODE_INVALID',
      remainingAccessCount: null, resourceSafetyStatus: i.safetyStatus || null, resourceFreshnessWarnings: [], allowedCapabilities: [], consumesAccess: false });
    if (i.rateLimited) return deny('RATE_LIMITED', 'LINK_INVALID_OR_UNAVAILABLE');
    if (!g) return deny('TOKEN_NOT_FOUND', 'LINK_INVALID_OR_UNAVAILABLE');
    if (i.tenantActive === false) return deny('TENANT_SUSPENDED', 'LINK_INVALID_OR_UNAVAILABLE');
    const st = effectiveStatus(g, i);
    if (st !== 'ACTIVE') return deny('GRANT_' + st, 'LINK_INVALID_OR_UNAVAILABLE');
    if (g.validFrom && nowMs(i) < Date.parse(g.validFrom)) return deny('NOT_YET_VALID', 'LINK_INVALID_OR_UNAVAILABLE');
    if (!pol) return deny('POLICY_MISSING', 'LINK_INVALID_OR_UNAVAILABLE');
    if (pol.requireCurrentSafetyStatus) {
      if (i.safetyStatus === 'REVOKED' || i.safetyStatus == null) return deny('RESOURCE_SAFETY_' + (i.safetyStatus || 'UNKNOWN'), 'RESOURCE_UNAVAILABLE');
      if (i.safetyStatus === 'REVIEW_REQUIRED' && pol.reviewRequiredBehavior !== 'WARN') return deny('RESOURCE_SAFETY_REVIEW_REQUIRED', 'RESOURCE_UNAVAILABLE'); // customer-facing default: suspend until reviewed
    }
    const warnings = [], fr = i.freshness || {}, fp = pol.freshness || {};
    if (pol.requireFreshnessCheck && fr.commercialDataMayBeOutdated) {
      if (fp.staleBehavior === 'BLOCK' || fp.staleBehavior === 'REQUIRE_REFRESH') return deny('RESOURCE_STALE', 'RESOURCE_UNAVAILABLE');
      warnings.push('Valores e disponibilidade devem ser confirmados.');
    }
    if (fr.availabilityStale) { if (fp.availabilityBehavior === 'BLOCK_IF_STALE') return deny('AVAILABILITY_STALE', 'RESOURCE_UNAVAILABLE'); warnings.push('Disponibilidade sujeita a confirmação.'); }
    if (fr.pricingStale) { if (fp.pricingBehavior === 'BLOCK_IF_STALE') return deny('PRICING_STALE', 'RESOURCE_UNAVAILABLE'); warnings.push('Condição sujeita a confirmação.'); }
    if (fr.financialExpired && fp.financialBehavior === 'BLOCK_IF_EXPIRED') return deny('FINANCIAL_EXPIRED', 'RESOURCE_UNAVAILABLE');
    if (g.accessMode === 'TOKEN_PLUS_PASSCODE') {
      const pc = i.passcode || {};
      if (pc.locked) return deny('PASSCODE_LOCKED', 'PASSCODE_INVALID');
      if (!pc.attempted) return deny('PASSCODE_REQUIRED', 'PASSCODE_REQUIRED');
      if (!pc.verified) return deny('PASSCODE_INVALID', 'PASSCODE_INVALID');
    }
    if (g.maxAccessCount != null && g.accessCount >= g.maxAccessCount) return deny('ACCESS_LIMIT', 'ACCESS_LIMIT_REACHED');
    const preview = !!i.preview; // messaging-app preview bots: metadata only, never consume, never content
    const consumes = !preview && !!i.consume && !i.existingSession;
    return freeze({ allowed: true, denialReasonCodes: [], publicError: null, grantStatus: st, requiresPasscode: false, remainingAccessCount: g.maxAccessCount != null ? g.maxAccessCount - g.accessCount - (consumes ? 1 : 0) : null,
      resourceSafetyStatus: i.safetyStatus, resourceFreshnessWarnings: warnings, allowedCapabilities: preview ? [] : (g.capabilities || []).slice(), consumesAccess: consumes, previewOnly: preview });
  }
  /** isPreviewBot(userAgentClass) — link-preview fetchers (WhatsApp, Slack, Telegram, Facebook, iMessage…) */
  const isPreviewBot = ua => /whatsapp|facebookexternalhit|slackbot|telegrambot|twitterbot|linkedinbot|discordbot|skypeuripreview|applebot|googlebot|bingbot|preview|crawler|spider|bot\b/i.test(String(ua || ''));
  /** previewMetadata(mode, org): generic by default (no customer name, no price, no image) */
  function previewMetadata(mode = 'GENERIC', org = {}) {
    if (mode === 'DISABLED') return freeze({ title: null, description: null, image: null, robots: 'noindex, nofollow' });
    return freeze({ title: `Apresentação ${org.name || ''}`.trim(), description: `Conteúdo compartilhado pela ${org.name || 'imobiliária'}.`, image: null, robots: 'noindex, nofollow' });
  }

  // ---------------------------------------------------------------- assets
  /** assetAccess(asset, grant, now) — customer-specific assets are proxied through the share session; only generic theme assets are public */
  function assetAccess(asset, g, o = {}) {
    if (!asset) return freeze({ mode: null, allowed: false });
    if (asset.generic === true && asset.customerSpecific !== true) return freeze({ mode: 'PUBLIC_STATIC_SAFE_ASSET', allowed: true, cache: 'public, max-age=31536000, immutable' });
    if (asset.signed === true && g) { const left = g.expiresAt ? Date.parse(g.expiresAt) - nowMs(o) : Infinity; return freeze({ mode: 'SHORT_LIVED_SIGNED_URL', allowed: left > 0, ttlSeconds: Math.max(0, Math.min(300, Math.floor(left / 1000) - 1)), cache: 'private, no-store' }); }
    return freeze({ mode: 'PROXY_AUTHORIZED', allowed: true, cache: 'private, no-store' });
  }

  // ---------------------------------------------------------------- entry point / initial view state (schema-validated, client-safe)
  const VIEW_KEYS = Object.freeze({ step: v => typeof v === 'string' && /^st\d{1,3}$/.test(v), lotRef: v => typeof v === 'string' && /^[A-Z]{1,3}\d{1,4}$/.test(v),
    comparisonSection: v => ['summary', 'location', 'comfort', 'commercial', 'technical'].includes(v), mapViewportPreset: v => ['overview', 'presented', 'lot'].includes(v) });
  function validateInitialViewState(s, allowed = {}) {
    if (s == null) return { ok: true, value: null };
    if (typeof s !== 'object' || Array.isArray(s)) return { ok: false, code: 'INVALID_VIEW_STATE' };
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (!VIEW_KEYS[k] || !VIEW_KEYS[k](v)) return { ok: false, code: 'INVALID_VIEW_STATE', key: k };
      if (k === 'lotRef' && allowed.lotRefs && !allowed.lotRefs.includes(v)) return { ok: false, code: 'LOT_NOT_IN_RESOURCE', key: k };
      if (k === 'step' && allowed.stepIds && !allowed.stepIds.includes(v)) return { ok: false, code: 'STEP_NOT_IN_RESOURCE', key: k };
      out[k] = v;
    }
    return { ok: true, value: freeze(out) };
  }
  const ROUTE_OF = freeze({ PRESENTATION_SNAPSHOT: 'PRESENTATION', LOT_SNAPSHOT: 'LOT', COMPARISON_SNAPSHOT: 'COMPARISON', FINANCIAL_SIMULATION_RESULT: 'FINANCIAL', DOCUMENT: 'DOCUMENT', FAVORITE_COLLECTION_SNAPSHOT: 'LOT' });
  function entryPoint(artifact, initialViewState, allowed) {
    const v = validateInitialViewState(initialViewState, allowed); if (!v.ok) throw err(v.code, 'Estado inicial inválido.');
    return freeze({ routeType: ROUTE_OF[artifact.resourceType] || 'PRESENTATION', resourceRef: { resourceType: artifact.resourceType, resourceId: artifact.resourceId, versionRef: artifact.versionRef || null, contentChecksum: artifact.contentChecksum || null }, initialViewState: v.value });
  }

  // ---------------------------------------------------------------- events (Topic 44/45 boundary) + Journey boundary
  const ACTION_EVENTS = Object.freeze(['share_created', 'share_opened', 'share_session_started', 'share_resource_viewed', 'share_feedback_submitted', 'share_expired', 'share_revoked']);
  const AUDIT_EVENTS = Object.freeze(['ShareDefinitionCreated', 'ShareGrantIssued', 'ShareGrantRevoked', 'ShareGrantExpired', 'ShareGrantSuspended', 'ShareGrantResumed', 'ShareAccessDenied', 'SharePasscodeFailed', 'ShareSafetyBlocked', 'SharePolicyOverridden']);
  /** journey boundary: only an intentional delivery becomes PRESENTATION_SHARED (copy link alone is LINK_COPIED, never "sent") */
  const JOURNEY_MAP = freeze({ SHARE_GRANT_CREATED: null, LINK_COPIED: null, DELIVERY_REQUESTED: null, DELIVERY_CONFIRMED: 'PRESENTATION_SHARED', MARKED_AS_SENT: 'PRESENTATION_SHARED', RESOURCE_OPENED: 'PRESENTATION_OPENED', FEEDBACK_SUBMITTED: 'PRESENTATION_FEEDBACK' });
  const journeyEventFor = (action, grant) => JOURNEY_MAP[action] && grant && grant.resourceType === 'PRESENTATION_SNAPSHOT' ? freeze({ type: JOURNEY_MAP[action], shareGrantId: grant.id, resourceId: grant.resourceId }) : null;

  // ---------------------------------------------------------------- management view (internal; never the raw token)
  function linkStatusVM(g, o = {}) {
    const st = effectiveStatus(g, o), F = App.fmt, left = g.expiresAt ? Date.parse(g.expiresAt) - nowMs(o) : null;
    const label = st === 'ACTIVE' ? (left != null && left < 3 * DAY * 1000 ? `Expira em ${Math.max(1, Math.ceil(left / 3600000))} h` : 'Ativo') : { EXPIRED: 'Expirado', REVOKED: 'Revogado', SUSPENDED: 'Suspenso', CONSUMED: 'Consumido' }[st];
    return freeze({ shareGrantId: g.id, resource: { PRESENTATION_SNAPSHOT: 'Apresentação', LOT_SNAPSHOT: 'Lote', COMPARISON_SNAPSHOT: 'Comparação', FINANCIAL_SIMULATION_RESULT: 'Simulação', FAVORITE_COLLECTION_SNAPSHOT: 'Seleção' }[g.resourceType] || 'Recurso',
      created: F ? F.formatDateTime(g.issuedAt) : g.issuedAt, expires: g.expiresAt ? (F ? F.formatDateTime(g.expiresAt) : g.expiresAt) : 'Sem expiração', status: st, statusLabel: label,
      accessMode: { TOKEN: 'Link', TOKEN_PLUS_PASSCODE: 'Link + código', ONE_TIME_TOKEN: 'Link de uso único', AUTHENTICATED: 'Acesso com login' }[g.accessMode], lastAccess: g.lastAccessAt ? (F ? F.formatDateTime(g.lastAccessAt) : g.lastAccessAt) : 'Nunca acessado',
      accessCount: g.accessCount, maskedLink: o.tokenPrefix ? `…/s/${o.tokenPrefix}••••` : '…/s/••••', actions: st === 'ACTIVE' ? ['CREATE_NEW_LINK', 'REVOKE', 'SUSPEND'] : st === 'SUSPENDED' ? ['RESUME', 'REVOKE', 'CREATE_NEW_LINK'] : ['CREATE_NEW_LINK'] });
  }

  // ---------------------------------------------------------------- legacy link inventory (what existed before topic 42)
  const LEGACY_INVENTORY = freeze([
    { location: 'presentation/app.js shareLink() → services/share.js deepLink(dev.shareUrl, token)', resourceType: 'LOT/COMPARISON (deep link interno)', currentUrlPattern: '<artifact>#viva-juara.lots.<code> | #viva-juara.compare.<code>~<code>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'WRAP', severity: 'LOW', notes: 'Deep link interno sobre dados públicos (códigos curtos). Para cliente usar App.share (link opaco); o deep link continua para uso interno.' },
    { location: 'presentation/viewmodels.js shareVM → services/share.js whatsappUrl (wa.me/?text=)', resourceType: 'mensagem com lotes', currentUrlPattern: 'https://wa.me/?text=Olá, <nome>! … Preço … Disponível … [Score se não-cliente]',
      exposesInternalIds: false, exposesPII: true, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'REPLACE', severity: 'MEDIUM', notes: 'Nome do cliente digitado e preço/status no texto da URL do WhatsApp; fora do modo cliente inclui score e classe. Substituir pelo payload de canal genérico (sem preço/status por padrão).' },
    { location: 'compare/comparisonDomain.js sharePayload/deepLinkToken', resourceType: 'COMPARISON (deep link interno)', currentUrlPattern: '<artifact>#<dev>.compare.<code>~<code>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'WRAP', severity: 'LOW', notes: 'Somente códigos curtos; sem cliente. Compartilhamento externo deve virar COMPARISON_SNAPSHOT + ShareGrant.' },
    { location: 'state/store.js App.router (hash ?base=&layer=&f=)', resourceType: 'estado de mapa/filtros (deep link interno)', currentUrlPattern: '#<dev>.lots.<code>?layer=…&f=<filtros>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'REVIEW', severity: 'LOW', notes: 'Filtros podem conter faixa de orçamento escolhida para um cliente; não usar como link externo. Tópico 43 formaliza estado compartilhável.' },
    { location: 'presentation/dom.js copy() (clipboard)', resourceType: 'ação do usuário', currentUrlPattern: null, exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false,
      migrationAction: 'WRAP', severity: 'LOW', notes: 'Cópia só por ação explícita (ok). Reutilizado por COPY_LINK.' },
    { location: 'presentation/overlays.js botão "PDF (em breve)"', resourceType: 'export', currentUrlPattern: null, exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false,
      migrationAction: 'REVIEW', severity: 'LOW', notes: 'Desativado. Export deve partir de PresentationSnapshot (tópico 41 exportRequest).' }
  ]);

  return freeze({ ResourceType, AudienceType, AccessMode, DefinitionStatus, GrantStatus, Capability, ChannelType, RevocationReason, PreviewMode, AssetAccess, RecipientConstraint, PublicError, PUBLIC_MESSAGES,
    POLICY_REGISTRY_VERSION, POLICIES, policyFor, policyRef, SHARE_PASSCODE_POLICY, RATE_LIMIT_POLICY, SESSION_TTL_SECONDS, SECURITY_HEADERS, REUSE_POLICY, WATERMARK_POLICY, PERMISSIONS, can, externalShareCapability,
    generateToken, hashToken, redactToken, TOKEN_RE, validateShareUrl, shareUrl, opaque, createDefinition, buildGrant, effectiveStatus, revoke, suspend, resume, changeExpiry, evaluateAccess, isPreviewBot, previewMetadata,
    assetAccess, validateInitialViewState, entryPoint, ACTION_EVENTS, AUDIT_EVENTS, JOURNEY_MAP, journeyEventFor, linkStatusVM, LEGACY_INVENTORY });
})();

/* ---- share/shareService.js ---- */
/* share/shareService.js — topic 42: ShareApplicationService · ShareGrantService · ShareTokenService · ShareAccessService ·
   ShareChannelService (+ ShareMessageTemplate) · ShareResourceResolver · ShareRevocationService · ShareSafetyService ·
   ShareAssetService · ShareSnapshotFactory (LotShareSnapshot) — as ONE in-memory reference instance (createShareService).

   This is the executable contract the backend implements (same flows, same codes): in the browser it never decides
   who may see a share. Raw tokens exist only in the issuance result; the store keeps tokenHash + a 4-char prefix.
   Access is "grant valid AND resource safe AND fresh enough AND passcode/count/rate ok"; revocation wins immediately
   (sessions, cache and assets). The resolver returns only client-safe audience payloads (PresentationSnapshot.audience
   or a LotShareSnapshot), never a canonical object. Channels build payloads; nothing is sent automatically. */
App.share = App.share || {};
App.share.service = (() => {
  const S = App.share.domain;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowMs = o => Date.parse((o && o.now) || new Date().toISOString());
  const iso = ms => new Date(ms).toISOString();
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const PM = () => App.presentationMode || {};

  // ---------------------------------------------------------------- message templates (escaped, allow-listed variables; no prices/status by default)
  const TEMPLATES = freeze({
    WHATSAPP: { id: 'tpl_whatsapp_default', channel: 'WHATSAPP', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName', 'recipientFirstName', 'presenterName', 'expiresAt'],
      template: 'Preparei uma apresentação com algumas opções para você.\nAcesse pelo link abaixo:\n{shareUrl}' },
    EMAIL: { id: 'tpl_email_default', channel: 'EMAIL', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName', 'recipientFirstName', 'presenterName', 'expiresAt'],
      subject: 'Apresentação {organizationName}', template: 'Olá,\n\nPreparei uma seleção de lotes para você. Acesse pelo link:\n{shareUrl}\n\nO link expira em {expiresAt}.' },
    NATIVE_SHARE: { id: 'tpl_native_default', channel: 'NATIVE_SHARE', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName'],
      template: 'Preparei uma seleção de lotes para você. Acesse pelo link.' }
  });
  const COMMERCIAL_FACT = /R\$\s?\d|\d+[.,]\d{3}|dispon[ií]ve(l|is)|reservad|vendid|desconto|pre[çc]o|valoriza|rentabil/i;
  function validateTemplate(t, o = {}) {
    const errors = [], vars = [...String(t.template || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).concat([...String(t.subject || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]));
    for (const v of vars) if (!t.allowedVariables.includes(v)) errors.push('VARIABLE_NOT_ALLOWED:' + v);
    if (!o.allowCommercialFacts && (COMMERCIAL_FACT.test(t.template) || COMMERCIAL_FACT.test(t.subject || ''))) errors.push('COMMERCIAL_FACT_IN_TEMPLATE');
    if (/<\s*\/?\s*[a-z][^>]*>|javascript:/i.test(t.template + (t.subject || ''))) errors.push('MARKUP_NOT_ALLOWED');
    return errors;
  }
  const clean = (v, max = 60) => String(v == null ? '' : v).replace(/[<>\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  function renderTemplate(t, vars = {}, o = {}) {
    const errors = validateTemplate(t, o); if (errors.length) throw err('INVALID_TEMPLATE', errors.join(', '), { errors });
    const safe = { shareUrl: vars.shareUrl, organizationName: clean(vars.organizationName), presenterName: clean(vars.presenterName, 40), expiresAt: vars.expiresAt ? clean(App.fmt ? App.fmt.formatDateTime(vars.expiresAt) : vars.expiresAt) : '',
      recipientFirstName: o.allowRecipientName ? clean(String(vars.recipientFirstName || '').split(/\s+/)[0], 30).replace(/[@\d]/g, '') : '' };
    const fill = s => String(s || '').replace(/\{(\w+)\}/g, (_, k) => safe[k] == null ? '' : safe[k]).replace(/\n{3,}/g, '\n\n');
    return { text: fill(t.template), subject: t.subject ? fill(t.subject) : null };
  }
  const QR_WARNING = 'O QR Code contém o link de acesso: quem tiver a imagem acessa o conteúdo até o link expirar ou ser revogado.';
  const canNativeShare = nav => !!(nav && typeof nav.share === 'function');

  function createShareService(cfg = {}) {
    const origin = cfg.origin || 'https://share.example.invalid', org = cfg.organization || { name: 'House 7' };
    const presentationRepo = cfg.presentationRepo || null;
    const definitions = new Map(), grants = new Map(), tokens = new Map(), sessions = new Map(), revocations = [], records = [], events = [], audits = [], deps = [], passcodes = new Map(), lotSnaps = new Map();
    const tenantInactive = new Set(), cache = new Map(), rate = new Map(), safety = new Map();
    const tick = o => nowMs({ now: (o && o.now) || (cfg.clock ? cfg.clock() : undefined) });
    const ev = (type, data, o) => { const e = freeze({ type, at: iso(tick(o)), ...data }); (S.ACTION_EVENTS.includes(type) ? events : audits).push(e); return e; };
    const record = (g, sessionId, result, reasonCode, o, ua) => { const r = freeze({ id: S.opaque('sar'), shareGrantId: g ? g.id : null, accessSessionId: sessionId || null, result, reasonCode: reasonCode || null, occurredAt: iso(tick(o)), userAgentClass: ua || null }); records.push(r); return r; };
    const dto = (g, o) => g ? freeze({ id: g.id, shareDefinitionId: g.shareDefinitionId, resourceType: g.resourceType, accessMode: g.accessMode, audienceType: g.audienceType, policyVersionRef: g.policyVersionRef, status: S.effectiveStatus(g, o), issuedAt: g.issuedAt,
      expiresAt: g.expiresAt, revokedAt: g.revokedAt, accessCount: g.accessCount, maxAccessCount: g.maxAccessCount, lastAccessAt: g.lastAccessAt, capabilities: g.capabilities, tokenPrefix: tokenPrefixOf(g.id) }) : null; // never the raw token
    const tokenPrefixOf = gid => { for (const t of tokens.values()) if (t.shareGrantId === gid) return t.tokenPrefix; return null; };

    // ------------------------------------------------------------ resource resolver (client-safe only)
    function resourceSafety(g, o) {
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') { const r = PM().domain ? PM().domain.safety.get(g.organizationId, g.resourceId) : null; return r ? r.status : null; }
      const r = safety.get(g.organizationId + '|' + g.resourceId); return r || null;
    }
    function resolve(g, o = {}) {
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') {
        if (!presentationRepo) return null;
        const snap = presentationRepo.getSnapshot({ organizationId: g.organizationId }, g.resourceId); // tenant from the grant, never from the request
        if (!snap || (g.resourceVersionRef && snap.checksum !== g.resourceVersionRef)) return null; // a grant never silently points to another version
        const fr = PM().domain.freshness(snap, { now: o.now, currentVersionRefs: o.currentVersionRefs || cfg.currentVersionRefs || null });
        const availabilityStale = (snap.warnings || []).some(w => w.code === 'AVAILABILITY_STALE' || w.code === 'AVAILABILITY_UNCONFIRMED'), pricingStale = (snap.warnings || []).some(w => w.code === 'PRICE_STALE');
        return { title: snap.audience.title, content: snap.audience, freshness: { ...fr, availabilityStale, pricingStale }, lotRefs: snap.audience.lots.map(l => l.lotRef), stepIds: snap.audience.storyline.steps.map(s => s.id) };
      }
      if (g.resourceType === 'LOT_SNAPSHOT') {
        const s = lotSnaps.get(g.resourceId); if (!s || s.organizationId !== g.organizationId || (g.resourceVersionRef && s.checksum !== g.resourceVersionRef)) return null;
        const age = tick(o) - Date.parse(s.generatedAt);
        return { title: s.content.identity.label, content: s.content, freshness: { commercialDataMayBeOutdated: age >= 86400000, availabilityStale: s.content.availability.state === 'STATUS_CONFIRMATION_REQUIRED', pricingStale: s.content.price.state === 'CURRENT_WITH_CAVEAT', warnings: [] }, lotRefs: [s.content.identity.lotRef], stepIds: [] };
      }
      return null; // DOCUMENT and others: no client-safe resolver yet → unavailable (deny by default)
    }
    /** canRead(ctx, artifact): the user can share only what they can read now */
    function canRead(ctx, a) {
      if (a.resourceType === 'PRESENTATION_SNAPSHOT') { if (!presentationRepo || !PM().domain.can(ctx, 'presentation.read')) return false; return !!presentationRepo.getSnapshot(ctx, a.resourceId); }
      if (a.resourceType === 'LOT_SNAPSHOT') { const s = lotSnaps.get(a.resourceId); return !!(s && s.organizationId === ctx.organizationId); }
      return false;
    }
    function artifactOf(ctx, input) {
      const a = { resourceType: input.resourceType, resourceId: input.resourceId, organizationId: ctx.organizationId };
      if (a.resourceType === 'PRESENTATION_SNAPSHOT' && presentationRepo) { const s = presentationRepo.getSnapshot(ctx, a.resourceId); if (s) { a.versionRef = s.checksum; a.contentChecksum = s.checksum; a.clientSafe = !!s.audience; const sf = PM().domain.safety.get(s.organizationId, s.id); a.safetyStatus = sf ? sf.status : null; } }
      if (a.resourceType === 'LOT_SNAPSHOT') { const s = lotSnaps.get(a.resourceId); if (s && s.organizationId === ctx.organizationId) { a.versionRef = s.checksum; a.contentChecksum = s.checksum; a.clientSafe = true; a.safetyStatus = safety.get(s.organizationId + '|' + s.id) || 'SAFE'; } }
      return a;
    }

    // ------------------------------------------------------------ issue / rotate / revoke / suspend
    async function issue(ctx, input = {}) {
      const a = artifactOf(ctx, input);
      const cap = S.externalShareCapability(ctx, a, { canReadResource: canRead(ctx, a) });
      if (!cap.allowed) { ev('ShareAccessDenied', { organizationId: ctx.organizationId, reasonCode: cap.reasons[0] }, ctx); return { ok: false, code: cap.reasons.includes('NO_SHARE_PERMISSION') ? 'FORBIDDEN' : cap.reasons.includes('RESOURCE_NOT_SAFE') ? 'RESOURCE_NOT_SAFE' : 'RESOURCE_NOT_SHAREABLE', reasons: cap.reasons }; }
      if (!input.forceNew) {
        const active = [...grants.values()].find(g => g.organizationId === ctx.organizationId && g.resourceId === a.resourceId && S.effectiveStatus(g, ctx) === 'ACTIVE' && sameBinding(definitions.get(g.shareDefinitionId), input.audienceBinding));
        if (active) return { ok: false, code: 'ACTIVE_GRANT_EXISTS', message: S.REUSE_POLICY.askUser, existing: dto(active, ctx) }; // never silently issue infinite links
      }
      let def = input.shareDefinitionId ? definitions.get(input.shareDefinitionId) : null;
      if (def && (def.organizationId !== ctx.organizationId || def.resourceId !== a.resourceId)) return { ok: false, code: 'NOT_FOUND' };
      if (!def) { def = S.createDefinition(ctx, { artifact: a, audienceType: input.audienceType, accessMode: input.accessMode, audienceBinding: input.audienceBinding, title: null }); ev('ShareDefinitionCreated', { organizationId: def.organizationId, shareDefinitionId: def.id }, ctx); }
      if (def.lifecycleStatus === 'DRAFT') { def = freeze({ ...def, lifecycleStatus: 'ACTIVE', recordRevision: def.recordRevision + 1 }); }
      definitions.set(def.id, def);
      if (input.accessMode === 'TOKEN_PLUS_PASSCODE') { const pc = checkPasscodeShape(input.passcode); if (pc) return { ok: false, code: pc }; }
      const g = S.buildGrant({ ...def, resourceVersionRef: a.versionRef }, ctx, { accessMode: input.accessMode, audienceType: input.audienceType, ttlSeconds: input.ttlSeconds, maxAccessCount: input.maxAccessCount, validFrom: input.validFrom, safetyStatusRef: a.safetyStatus });
      const token = S.generateToken(), tokenHash = await S.hashToken(token, cfg.pepper || '');
      if (input.accessMode === 'TOKEN_PLUS_PASSCODE') { if (input.passcode === token) return { ok: false, code: 'PASSCODE_EQUALS_TOKEN' }; passcodes.set(g.id, { ...(await hashPasscode(input.passcode)), failures: 0, lockedUntil: 0 }); }
      grants.set(g.id, g);
      tokens.set(tokenHash, freeze({ id: S.opaque('sht'), organizationId: g.organizationId, shareGrantId: g.id, tokenHash, tokenPrefix: token.slice(0, 4), createdAt: g.issuedAt, lastUsedAt: null, revokedAt: null }));
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') addDependency(g.id, 'PRESENTATION_SNAPSHOT', g.resourceId, 'SAFE');
      addDependency(g.id, 'ORGANIZATION', g.organizationId, 'ACTIVE');
      if (def.audienceBinding && def.audienceBinding.customerId) addDependency(g.id, 'CUSTOMER', def.audienceBinding.customerId, 'ACCESSIBLE');
      ev('ShareGrantIssued', { organizationId: g.organizationId, shareGrantId: g.id, resourceType: g.resourceType }, ctx); ev('share_created', { shareGrantId: g.id, resourceType: g.resourceType }, ctx);
      const url = S.shareUrl(origin, token);
      return { ok: true, grant: dto(g, ctx), url, token, expiresAt: g.expiresAt, journeyEvent: null }; // ShareGrantCreateResultDto: the only time the raw token exists
    }
    const sameBinding = (def, b) => { const x = def && def.audienceBinding, cx = x ? x.customerId || null : null, cb = b ? b.customerId || null : null; return cx === cb; };
    function getGrant(ctx, id) { const g = grants.get(id); return g && g.organizationId === ctx.organizationId && S.can(ctx, 'share.read') ? dto(g, ctx) : null; } // IDOR: other tenant → null
    const listGrants = (ctx, defId) => S.can(ctx, 'share.read') ? [...grants.values()].filter(g => g.organizationId === ctx.organizationId && g.shareDefinitionId === defId).map(g => dto(g, ctx)) : [];
    function own(ctx, id, perm) { const g = grants.get(id); if (!g || g.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Link não encontrado.'); if (!S.can(ctx, perm)) throw err('FORBIDDEN', 'Sem permissão.'); return g; }
    function revoke(ctx, id, reasonCode = 'USER_REVOKED', note) {
      const g = own(ctx, id, 'share.revoke'), r = S.revoke(g, ctx, reasonCode, note);
      grants.set(id, r.grant); if (r.record) revocations.push(r.record);
      for (const t of tokens.values()) if (t.shareGrantId === id) tokens.set(t.tokenHash, freeze({ ...t, revokedAt: r.grant.revokedAt }));
      invalidate(id, 'REVOKED');
      ev('ShareGrantRevoked', { organizationId: g.organizationId, shareGrantId: id, reasonCode }, ctx); ev('share_revoked', { shareGrantId: id }, ctx);
      return dto(r.grant, ctx);
    }
    function suspend(ctx, id) { const g = own(ctx, id, 'share.suspend'), n = S.suspend(g, ctx); grants.set(id, n); invalidate(id, 'REVOKED'); ev('ShareGrantSuspended', { organizationId: g.organizationId, shareGrantId: id }, ctx); return dto(n, ctx); }
    function resume(ctx, id) { const g = own(ctx, id, 'share.suspend'), n = S.resume(g, ctx); grants.set(id, n); ev('ShareGrantResumed', { organizationId: g.organizationId, shareGrantId: id }, ctx); return dto(n, ctx); }
    function changeExpiry(ctx, id, at) { const g = own(ctx, id, 'share.issue'), n = S.changeExpiry(g, ctx, at); grants.set(id, n); invalidate(id); return dto(n, ctx); }
    /** rotate: new grant + new token for the same resource version; the old grant is revoked (never mutated to a new secret) */
    async function rotate(ctx, id, o = {}) {
      const g = own(ctx, id, 'share.issue'), def = definitions.get(g.shareDefinitionId);
      const r = await issue(ctx, { resourceType: g.resourceType, resourceId: g.resourceId, accessMode: g.accessMode, audienceType: g.audienceType, shareDefinitionId: def.id, forceNew: true, ttlSeconds: o.ttlSeconds, passcode: o.passcode, audienceBinding: def.audienceBinding });
      if (r.ok && o.revokeOld !== false) revoke(ctx, id, 'OTHER', 'rotação de link');
      return r;
    }
    function invalidate(grantId, sessionStatus) {
      cache.delete(grantId);
      if (sessionStatus) for (const [k, s] of sessions) if (s.shareGrantId === grantId && s.status === 'ACTIVE') sessions.set(k, freeze({ ...s, status: sessionStatus }));
    }

    // ------------------------------------------------------------ passcode (hashed with salt + KDF; rate-limited; independent from the token)
    function checkPasscodeShape(p) {
      const s = String(p || '');
      if (s.length < S.SHARE_PASSCODE_POLICY.minLength) return 'PASSCODE_TOO_SHORT';
      if (/@/.test(s) || /^\+?\d{10,13}$/.test(s.replace(/[\s()-]/g, '')) || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(s)) return 'PASSCODE_LOOKS_LIKE_PII'; // never email/phone/CPF as password
      return null;
    }
    async function hashPasscode(p, salt) {
      const c = crypto, sl = salt || c.getRandomValues(new Uint8Array(16));
      const key = await c.subtle.importKey('raw', new TextEncoder().encode(String(p)), 'PBKDF2', false, ['deriveBits']);
      const bits = await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sl, iterations: cfg.pbkdf2Iterations || 210000 }, key, 256);
      return { salt: sl, hash: Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('') };
    }
    const eqConst = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

    // ------------------------------------------------------------ rate limiting (by an opaque client ref; never raw IP storage)
    function limited(clientRef, kind, o) {
      if (!clientRef) return false;
      const k = clientRef + '|' + kind, now = tick(o), xs = (rate.get(k) || []).filter(t => now - t < 60000);
      rate.set(k, xs); const max = kind === 'invalid' ? S.RATE_LIMIT_POLICY.maxInvalidTokenAttemptsPerMinute : S.RATE_LIMIT_POLICY.maxAttemptsPerMinute;
      return xs.length >= max;
    }
    const hit = (clientRef, kind, o) => { if (!clientRef) return; const k = clientRef + '|' + kind; rate.set(k, [...(rate.get(k) || []), tick(o)]); };

    // ------------------------------------------------------------ access (exchange token → short session; then the token can leave the URL)
    async function exchange(token, o = {}) {
      const ua = o.userAgentClass || null, deny = (g, code, pub, sessionId) => { record(g, sessionId, 'DENIED', code, o, ua); if (g) ev(code.startsWith('PASSCODE') ? 'SharePasscodeFailed' : code.startsWith('RESOURCE') ? 'ShareSafetyBlocked' : 'ShareAccessDenied', { organizationId: g.organizationId, shareGrantId: g.id, reasonCode: code }, o);
        return { ok: false, publicError: pub, message: S.PUBLIC_MESSAGES[pub](org.name), headers: S.SECURITY_HEADERS }; };
      if (limited(o.clientRef, 'all', o) || limited(o.clientRef, 'invalid', o)) return deny(null, 'RATE_LIMITED', 'LINK_INVALID_OR_UNAVAILABLE');
      hit(o.clientRef, 'all', o);
      if (!S.TOKEN_RE.test(String(token || ''))) { hit(o.clientRef, 'invalid', o); return deny(null, 'TOKEN_FORMAT', 'LINK_INVALID_OR_UNAVAILABLE'); }
      const th = await S.hashToken(token, cfg.pepper || ''), tr = tokens.get(th);
      const g0 = tr ? grants.get(tr.shareGrantId) : null;
      if (!g0) { hit(o.clientRef, 'invalid', o); return deny(null, 'TOKEN_NOT_FOUND', 'LINK_INVALID_OR_UNAVAILABLE'); }
      const preview = S.isPreviewBot(ua);
      if (preview) { record(g0, null, 'DENIED', 'PREVIEW_METADATA_ONLY', o, ua); return { ok: false, preview: true, metadata: S.previewMetadata('GENERIC', org), headers: S.SECURITY_HEADERS }; } // never consumes, never content
      let pc = { attempted: false, verified: false, locked: false };
      if (g0.accessMode === 'TOKEN_PLUS_PASSCODE') {
        const st = passcodes.get(g0.id) || {};
        pc.locked = st.lockedUntil > tick(o);
        if (!pc.locked && o.passcode != null) {
          pc.attempted = true;
          const h = await hashPasscode(o.passcode, st.salt); pc.verified = eqConst(h.hash, st.hash || '');
          if (!pc.verified) { st.failures = (st.failures || 0) + 1; if (st.failures >= S.SHARE_PASSCODE_POLICY.maxAttempts) { st.lockedUntil = tick(o) + S.SHARE_PASSCODE_POLICY.lockoutSeconds * 1000; st.failures = 0; } passcodes.set(g0.id, st); }
          else { st.failures = 0; passcodes.set(g0.id, st); }
        }
      }
      if (g0.accessMode === 'ONE_TIME_TOKEN' && !o.confirm) return { ok: false, requiresConfirmation: true, message: 'Toque em "Abrir apresentação" para continuar. Este link pode ser aberto uma única vez.', headers: S.SECURITY_HEADERS }; // human confirmation before consuming
      // --- atomic section: no await between re-read and write (the backend uses a transaction / compare-and-set)
      const g = grants.get(g0.id), res = resolve(g, o);
      const d = S.evaluateAccess({ grant: g, now: o.now || (cfg.clock && cfg.clock()), tenantActive: !tenantInactive.has(g.organizationId), safetyStatus: res ? resourceSafety(g, o) : null, freshness: res ? res.freshness : null, passcode: pc, consume: true });
      if (!d.allowed) return deny(g, d.denialReasonCodes[d.denialReasonCodes.length - 1], d.publicError);
      if (!res) return deny(g, 'RESOURCE_MISSING', 'RESOURCE_UNAVAILABLE');
      const n = freeze({ ...g, accessCount: g.accessCount + 1, lastAccessAt: iso(tick(o)), lifecycleStatus: g.accessMode === 'ONE_TIME_TOKEN' ? 'CONSUMED' : g.lifecycleStatus, recordRevision: g.recordRevision + 1 });
      grants.set(g.id, n); tokens.set(th, freeze({ ...tr, lastUsedAt: n.lastAccessAt }));
      const exp = Math.min(tick(o) + S.SESSION_TTL_SECONDS * 1000, g.expiresAt ? Date.parse(g.expiresAt) : Infinity);
      const sess = freeze({ id: S.opaque('shs'), shareGrantId: g.id, startedAt: iso(tick(o)), lastActivityAt: iso(tick(o)), expiresAt: iso(exp), accessContext: { userAgentClass: ua, locale: o.locale || null }, status: 'ACTIVE', csrf: S.opaque('csrf'), passcodeVerified: pc.verified });
      sessions.set(sess.id, sess);
      record(n, sess.id, 'ALLOWED', null, o, ua); ev('share_opened', { shareGrantId: g.id }, o); ev('share_session_started', { shareGrantId: g.id }, o);
      // ShareAccessBootstrapDto: the session ref goes into a short-lived HttpOnly cookie on the backend; the page then replaces /s/<token> with a clean route
      return { ok: true, sessionRef: sess.id, csrfToken: sess.csrf, expiresAt: sess.expiresAt, cleanRoute: '/shared/view', headers: S.SECURITY_HEADERS, warnings: d.resourceFreshnessWarnings, journeyEvent: S.journeyEventFor('RESOURCE_OPENED', n) };
    }
    function liveSession(ref, o) {
      const s = sessions.get(ref); if (!s) return { error: 'LINK_INVALID_OR_UNAVAILABLE' };
      if (s.status !== 'ACTIVE' || tick(o) >= Date.parse(s.expiresAt)) { if (s.status === 'ACTIVE') sessions.set(ref, freeze({ ...s, status: 'EXPIRED' })); return { error: 'LINK_INVALID_OR_UNAVAILABLE' }; }
      const g = grants.get(s.shareGrantId), res = g ? resolve(g, o) : null;
      const d = S.evaluateAccess({ grant: g ? { ...g, lifecycleStatus: g.lifecycleStatus === 'CONSUMED' ? 'ACTIVE' : g.lifecycleStatus, maxAccessCount: null } : null, now: o.now || (cfg.clock && cfg.clock()), tenantActive: g ? !tenantInactive.has(g.organizationId) : false,
        safetyStatus: g && res ? resourceSafety(g, o) : null, freshness: res ? res.freshness : null, passcode: { attempted: true, verified: s.passcodeVerified }, existingSession: true });
      if (!d.allowed || !res) { sessions.set(ref, freeze({ ...s, status: 'REVOKED' })); record(g, ref, 'DENIED', d.denialReasonCodes[d.denialReasonCodes.length - 1] || 'RESOURCE_MISSING', o); return { error: d.publicError || 'RESOURCE_UNAVAILABLE' }; }
      sessions.set(ref, freeze({ ...s, lastActivityAt: iso(tick(o)) }));
      return { session: s, grant: g, res, decision: d };
    }
    /** resource(sessionRef) → SharedResourceDto (client-safe content; refresh inside the session never increments the access count) */
    function resource(ref, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error, message: S.PUBLIC_MESSAGES[L.error](org.name), headers: S.SECURITY_HEADERS };
      const { grant: g, res, decision: d } = L;
      const hit = cache.get(g.id); if (hit && hit.checksum === (g.resourceVersionRef || null)) { ev('share_resource_viewed', { shareGrantId: g.id }, o); return { ok: true, resource: hit.vm, headers: S.SECURITY_HEADERS, cached: true }; }
      const vm = freeze({ resourceType: g.resourceType, title: res.title, content: res.content, capabilities: d.allowedCapabilities, warnings: [...new Set([...(res.freshness.warnings || []), ...d.resourceFreshnessWarnings])],
        expiresAt: g.expiresAt, freshness: { commercialDataMayBeOutdated: !!res.freshness.commercialDataMayBeOutdated }, safetyStatus: resourceSafety(g, o), branding: { organizationName: org.name, logoAssetRef: org.logoAssetRef || null, themeRef: null, contactCta: org.contactCta || { label: 'Falar com corretor', channel: 'NONE' } },
        watermark: S.WATERMARK_POLICY.enabled ? { type: S.WATERMARK_POLICY.type } : null });
      cache.set(g.id, { checksum: g.resourceVersionRef || null, vm });
      ev('share_resource_viewed', { shareGrantId: g.id }, o);
      return { ok: true, resource: vm, headers: S.SECURITY_HEADERS };
    }
    function asset(ref, assetInput, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error };
      return { ok: true, access: S.assetAccess(assetInput, L.grant, o) }; // assets never increment the access count
    }
    /** feedback(sessionRef, input): scoped to the share session; any customerId sent by the browser is ignored */
    function feedback(ref, input = {}, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error };
      if (!input.csrfToken || input.csrfToken !== L.session.csrf) return { ok: false, publicError: 'LINK_INVALID_OR_UNAVAILABLE', reason: 'CSRF' };
      if (!L.decision.allowedCapabilities.includes('SUBMIT_FEEDBACK')) return { ok: false, publicError: 'RESOURCE_UNAVAILABLE', reason: 'CAPABILITY' };
      if (!['LIKED', 'MORE_INFO', 'VISIT_INTEREST', 'COMPARE', 'FINANCIAL_INTEREST'].includes(input.type)) return { ok: false, reason: 'INVALID_FEEDBACK_TYPE' };
      if (input.lotRef && !L.res.lotRefs.includes(input.lotRef)) return { ok: false, reason: 'LOT_NOT_IN_RESOURCE' };
      const def = definitions.get(L.grant.shareDefinitionId), binding = def && def.audienceBinding;
      const intent = freeze({ id: S.opaque('sfi'), shareGrantId: L.grant.id, accessSessionId: ref, type: input.type, lotRef: input.lotRef || null, customerId: binding ? binding.customerId : null, recordedBy: 'CUSTOMER', recordedAt: iso(tick(o)) }); // binding resolved server-side
      ev('share_feedback_submitted', { shareGrantId: L.grant.id, feedbackType: input.type }, o);
      return { ok: true, intent, profileChanged: false, journeyEvent: S.journeyEventFor('FEEDBACK_SUBMITTED', L.grant) };
    }

    // ------------------------------------------------------------ channels (payloads only; never sends)
    function channelPayload(ctx, input = {}) {
      if (!S.can(ctx, 'share.channel.generate')) return { ok: false, code: 'FORBIDDEN' };
      const g = grants.get(input.grantId); if (!g || g.organizationId !== ctx.organizationId) return { ok: false, code: 'NOT_FOUND' };
      const pol = Object.values(S.POLICIES).find(p => S.policyRef(p) === g.policyVersionRef);
      if (!S.ChannelType[input.channel] || !pol.allowedChannelTypes.includes(input.channel)) return { ok: false, code: 'CHANNEL_NOT_ALLOWED' };
      const issues = S.validateShareUrl(input.url); if (issues.length) return { ok: false, code: 'UNSAFE_SHARE_URL', issues };
      const vars = { shareUrl: input.url, organizationName: org.name, presenterName: input.presenterName, recipientFirstName: input.recipientFirstName, expiresAt: g.expiresAt };
      const warn = g.accessMode === 'TOKEN' ? ['Quem receber este link poderá abri-lo até expirar ou ser revogado; o link não é pessoal.'] : [];
      const base = { channel: input.channel, url: input.url, expiresAt: g.expiresAt };
      let out;
      if (input.channel === 'COPY_LINK') out = { ...base, warnings: warn };
      else if (input.channel === 'WHATSAPP') { const r = renderTemplate(input.template || TEMPLATES.WHATSAPP, vars, { allowRecipientName: !!input.allowRecipientName }); out = { ...base, message: r.text, actionUrl: 'https://wa.me/?text=' + encodeURIComponent(r.text), warnings: warn }; } // no phone, nothing sent
      else if (input.channel === 'EMAIL') { const r = renderTemplate(input.template || TEMPLATES.EMAIL, vars, { allowRecipientName: !!input.allowRecipientName }); out = { ...base, title: r.subject, message: r.text, actionUrl: 'mailto:?subject=' + encodeURIComponent(r.subject || '') + '&body=' + encodeURIComponent(r.text), warnings: warn }; }
      else if (input.channel === 'NATIVE_SHARE') { const r = renderTemplate(TEMPLATES.NATIVE_SHARE, vars); out = { ...base, title: `Apresentação ${org.name}`, message: r.text, fallback: 'COPY_LINK', warnings: warn }; }
      else if (input.channel === 'QR_CODE') out = { ...base, qrData: input.url, textAlternative: input.url, warnings: [...warn, QR_WARNING] };
      else return { ok: false, code: 'CHANNEL_NOT_ALLOWED' };
      ev(input.channel === 'COPY_LINK' ? 'share_created' : 'share_created', { shareGrantId: g.id, channel: input.channel }, ctx);
      return { ok: true, payload: freeze(out), journeyEvent: S.journeyEventFor(input.channel === 'COPY_LINK' ? 'LINK_COPIED' : 'DELIVERY_REQUESTED', g) }; // never "PRESENTATION_SHARED" from a payload alone
    }
    const markAsSent = (ctx, grantId) => { const g = grants.get(grantId); return g && g.organizationId === ctx.organizationId ? S.journeyEventFor('MARKED_AS_SENT', g) : null; };

    // ------------------------------------------------------------ safety dependencies (selective invalidation)
    function addDependency(shareGrantId, dependencyType, dependencyRef, requiredStatus) { deps.push(freeze({ shareGrantId, dependencyType, dependencyRef, requiredStatus })); }
    /** onDomainEvent: PresentationSnapshotRevoked · OrganizationSuspended/Reactivated · CustomerAccessChanged · SharePolicyArchived */
    function onDomainEvent(e = {}) {
      const affected = new Set();
      if (e.type === 'PresentationSnapshotRevoked' || e.type === 'PresentationSnapshotSafetyChanged') for (const d of deps) if (d.dependencyType === 'PRESENTATION_SNAPSHOT' && d.dependencyRef === e.snapshotId) affected.add(d.shareGrantId);
      if (e.type === 'OrganizationSuspended') { tenantInactive.add(e.organizationId); for (const d of deps) if (d.dependencyType === 'ORGANIZATION' && d.dependencyRef === e.organizationId) affected.add(d.shareGrantId); }
      if (e.type === 'OrganizationReactivated') tenantInactive.delete(e.organizationId);
      if (e.type === 'CustomerAccessChanged') for (const d of deps) if (d.dependencyType === 'CUSTOMER' && d.dependencyRef === e.customerId) { affected.add(d.shareGrantId); const g = grants.get(d.shareGrantId); if (g && g.lifecycleStatus === 'ACTIVE') grants.set(g.id, S.suspend(g)); }
      if (e.type === 'LotSnapshotRevoked') { safety.set(e.organizationId + '|' + e.snapshotId, 'REVOKED'); for (const g of grants.values()) if (g.resourceId === e.snapshotId) affected.add(g.id); }
      for (const id of affected) invalidate(id, 'REVOKED');
      return [...affected];
    }
    if (PM().domain && PM().domain.safety && PM().domain.safety.onChange) PM().domain.safety.onChange(onDomainEvent);

    // ------------------------------------------------------------ ShareSnapshotFactory: LotShareSnapshot (client-safe projection, immutable)
    function createLotSnapshot(ctx, lot, src = {}) {
      if (!S.can(ctx, 'share.create')) return { ok: false, code: 'FORBIDDEN' };
      const PJ = PM().projection, D = PM().domain; if (!PJ || !lot) return { ok: false, code: 'NOT_AVAILABLE' };
      const pctx = { policy: PM().policy.current(), priceTable: src.priceTable || null, commercialFreshness: (src.freshness || {}).commercial || 'UNKNOWN' };
      const card = PJ.lotCard(lot, pctx);
      const content = { identity: { lotRef: card.lotRef, label: card.identityLabel }, availability: card.availability, price: card.price, keyMetrics: ['geometry.areaM2', 'geometry.frontM', 'environmental.orientationFront', 'mobility.routeDistanceToLeisureM'].map(k => PJ.value(lot, k, pctx)).filter(Boolean),
        highlights: card.keyHighlights, alerts: card.clientSafeAlerts };
      const leaks = PM().policy.scanPayload(content); if (leaks.length) return { ok: false, code: 'REDACTION_ERROR', leaks };
      const pt = src.priceTable, versionRefs = { priceTableVersionId: pt ? `${pt.id}@${pt.version}` : null, analysisVersion: (lot.intelligence || {}).analysisVersion || null, clientSafePolicyVersion: pctx.policy.version, availabilityRevision: String(lot.availability.revision ?? '') };
      const generatedAt = iso(tick(ctx)), sum = D.checksum({ content, versionRefs });
      const snap = freeze({ id: S.opaque('lss'), organizationId: ctx.organizationId, lotId: lot.identity.id, developmentId: lot.identity.developmentId, content, versionRefs, generatedAt, checksum: sum });
      lotSnaps.set(snap.id, snap); safety.set(snap.organizationId + '|' + snap.id, 'SAFE');
      return { ok: true, snapshot: snap };
    }

    return Object.freeze({ issue, rotate, revoke, suspend, resume, changeExpiry, getGrant, listGrants, exchange, resource, asset, feedback, channelPayload, markAsSent, onDomainEvent, createLotSnapshot, canNativeShare,
      // inspection for tests/ops (no raw tokens anywhere)
      _store: () => ({ tokens: [...tokens.values()], grants: [...grants.values()], sessions: [...sessions.values()], records: records.slice(), events: events.slice(), audits: audits.slice(), revocations: revocations.slice(), deps: deps.slice() }) });
  }

  return Object.freeze({ createShareService, TEMPLATES, validateTemplate, renderTemplate, canNativeShare, QR_WARNING });
})();

/* ---- presentationmode/presentationView.js ---- */
/* presentationmode/presentationView.js — topic 41 renderer: HTML strings from the AUDIENCE view (runtime.audienceView) and,
   on a separate surface, the presenter controls / preflight panel. It never receives a canonical Lot, a customer or a
   definition, so there is nothing internal to hide with CSS. Markup only; actions use delegated data-act:
   pmPrev, pmNext, pmStep (data-step), pmLot (data-lot), pmMap, pmFeedback (data-type, data-lot), pmComplete, pmEnd.
   Accessibility: landmarks, a live region for the step and for unconfirmed states, text (never colour alone),
   keyboard order = reading order, reduced motion respected by CSS (no animation here). */
App.presentationView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p = (t, cls) => t ? `<p${cls ? ` class="${cls}"` : ''}>${esc(t)}</p>` : '';
  const LOT_ACTION = { FOCUS_ON_MAP: 'Ver no mapa', COMPARE: 'Comparar', OPEN_FINANCIAL: 'Simular', RECORD_INTEREST: 'Gostei', REQUEST_VISIT: 'Quero visitar' };
  const ACT = { FOCUS_ON_MAP: 'pmLot', COMPARE: 'pmFeedback', OPEN_FINANCIAL: 'pmFeedback', RECORD_INTEREST: 'pmFeedback', REQUEST_VISIT: 'pmFeedback' };
  const FB = { COMPARE: 'COMPARE', OPEN_FINANCIAL: 'FINANCIAL_INTEREST', RECORD_INTEREST: 'LIKED', REQUEST_VISIT: 'VISIT_INTEREST' };
  function card(c) {
    if (!c) return '';
    const pr = c.price || {}, av = c.availability || {};
    return `<article class="pm-card" aria-label="${esc(c.identityLabel)}"><h3>${esc(c.identityLabel)}</h3>
      <p class="pm-av${av.confirmed ? '' : ' warn'}"><span class="vh">Situação: </span>${esc(av.label)}${av.caveat && av.caveat !== av.label ? ` <span class="small">${esc(av.caveat)}</span>` : ''}</p>
      <p class="pm-pr"><span class="lbl">${esc(pr.label)}:</span> ${esc(pr.text)}${pr.pricePerM2Text ? ` <span class="small">(${esc(pr.pricePerM2Text)})</span>` : ''}${pr.caveat ? ` <span class="small warn">${esc(pr.caveat)}</span>` : ''}</p>
      ${c.area ? p(`${c.area.label}: ${c.area.text}`, 'small') : ''}
      ${c.fitSummary ? `<p class="pm-fit">${esc(c.fitSummary.label)}${c.fitSummary.percentText ? ` · ${esc(c.fitSummary.percentText)}` : ''}${c.fitSummary.caveat ? ` <span class="small">${esc(c.fitSummary.caveat)}</span>` : ''}</p>` : ''}
      ${c.keyHighlights && c.keyHighlights.length ? `<ul class="pm-hl">${c.keyHighlights.map(h => `<li>${esc(h.text)}</li>`).join('')}</ul>` : ''}
      ${c.clientSafeAlerts && c.clientSafeAlerts.length ? `<ul class="pm-al" aria-label="Pontos de atenção">${c.clientSafeAlerts.map(a => `<li class="lv-${esc(String(a.level).toLowerCase())}">${a.title ? `<strong>${esc(a.title)}:</strong> ` : ''}${esc(a.text)}</li>`).join('')}</ul>` : ''}
      <div class="pm-acts" role="group" aria-label="Ações de ${esc(c.identityLabel)}">${(c.actions || []).filter(a => LOT_ACTION[a]).map(a => `<button class="btn small" data-act="${ACT[a]}" data-lot="${esc(c.lotRef)}"${FB[a] ? ` data-type="${FB[a]}"` : ''}>${esc(LOT_ACTION[a])}</button>`).join('')}</div></article>`;
  }
  function block(b) {
    if (!b) return `<p>${esc('Conteúdo indisponível nesta etapa.')}</p>`;
    const x = b.payload || {}, h = b.title ? `<h2>${esc(b.title)}</h2>` : '';
    switch (b.type) {
      case 'INTRO': return `${h}<h2>${esc(x.headline)}</h2>${p(x.subtitle)}${x.customerLabel ? p(`Preparado para ${x.customerLabel}`, 'small') : ''}${p(x.text)}`;
      case 'DEVELOPMENT_OVERVIEW': return `${h}<h2>${esc(x.name)}</h2>${p(x.city)}${p(x.legalName, 'small')}`;
      case 'CUSTOMER_OBJECTIVE': return `${h || '<h2>Seu objetivo</h2>'}${p(x.objective)}${p(x.priorities)}${p(x.budget)}`;
      case 'RECOMMENDATION_SUMMARY': return `${h || '<h2>Opções selecionadas</h2>'}${x.empty ? p(x.emptyText) : `<ol class="pm-recs">${x.items.map(i => `<li><p class="small">${esc(i.positionLabel)}</p>${card(i.card)}${i.reasons.length ? `<ul class="small">${i.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`}${(x.caveats || []).map(c => p(c, 'small')).join('')}`;
      case 'LOT_HIGHLIGHT': return h + card(x.card);
      case 'LOT_DETAILS': return h + card(x.card) + `<dl class="pm-dl">${(x.rows || []).map(r => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}${r.qualifier ? ` <span class="small">(${esc(r.qualifier)})</span>` : ''}</dd>`).join('')}</dl>`;
      case 'COMPARISON': return `${h || '<h2>Comparação</h2>'}<div class="pm-cmp">${(x.candidateCards || []).map(card).join('')}</div>
        ${(x.safeHighlights || []).length ? `<ul class="pm-hl">${x.safeHighlights.map(s => `<li><strong>${esc(s.lotLabel)}</strong> — ${esc(s.text)}</li>`).join('')}</ul>` : ''}
        <table class="pm-t"><caption class="vh">Critérios comparados</caption><thead><tr><th scope="col">Critério</th><th scope="col">Resultado</th></tr></thead><tbody>${(x.comparisonSections || []).map(s => `<tr><th scope="row">${esc(s.criterion)}</th><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table>${(x.caveats || []).map(c => p(c, 'small')).join('')}`;
      case 'FINANCIAL_SIMULATION': { const s = x.simulation || {}; return `${h || '<h2>Condições de pagamento</h2>'}${card(x.card)}${s.available ? `<p class="pm-st"><strong>${esc(s.statusLabel)}</strong>${s.statusText ? ' — ' + esc(s.statusText) : ''}</p>
        <p>${esc(s.basePrice.label)}: ${esc(s.basePrice.text)} · ${esc(s.downPayment.label)}: ${esc(s.downPayment.text)}</p><ul>${s.plans.map(pl => `<li><strong>${esc(pl.name)}</strong>: ${esc(pl.installments)}${pl.annual ? ' ' + esc(pl.annual) : ''}${pl.condition ? ` <span class="small">(${esc(pl.condition)})</span>` : ''}</li>`).join('')}</ul>
        ${s.assumptions.map(a => p(a, 'small')).join('')}${s.caveats.map(c => p(c, 'small')).join('')}` : p(s.text)}`; }
      case 'MAP': return `${h || '<h2>Localização no empreendimento</h2>'}<button class="btn" data-act="pmMap">Abrir mapa</button><ul class="pm-maplist" aria-label="Lotes apresentados (alternativa ao mapa)">${(x.textAlternative || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
      case 'LOCATION': return `${h || '<h2>Distâncias</h2>'}${(x.items || []).map(i => `<h3>${esc(i.lotLabel)}</h3><dl class="pm-dl">${i.rows.map(r => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join('')}</dl>`).join('')}`;
      case 'AVAILABILITY_STATUS': return `${h || '<h2>Situação comercial</h2>'}<ul>${(x.items || []).map(i => `<li>${esc(i.lotLabel)}: ${esc(i.availability.label)}${i.availability.caveat && i.availability.caveat !== i.availability.label ? ' ' + esc(i.availability.caveat) : ''}</li>`).join('')}</ul>`;
      case 'INVESTMENT_CONTEXT': return `${h || '<h2>Preço de tabela por m²</h2>'}<ul>${(x.items || []).map(i => `<li>${esc(i.lotLabel)}: ${esc(i.priceText)}${i.pricePerM2Text ? ` (${esc(i.pricePerM2Text)})` : ''}</li>`).join('')}</ul>${p(x.tableLabel, 'small')}${p(x.caveat, 'small')}`;
      case 'ALERTS_CLIENT_SAFE': return `${h || '<h2>Pontos de atenção</h2>'}${(x.items || []).map(i => `<h3>${esc(i.lotLabel)}</h3><ul>${i.alerts.map(a => `<li>${a.title ? `<strong>${esc(a.title)}:</strong> ` : ''}${esc(a.text)}</li>`).join('')}</ul>`).join('')}`;
      case 'NEXT_STEPS': return `${h || '<h2>Próximos passos</h2>'}<ol>${(x.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ol>`;
      case 'CUSTOM': return h + p(x.text);
      default: return p('Conteúdo indisponível nesta etapa.');
    }
  }
  /** audience(view) — view = App.presentationMode.runtime.audienceView(sessionId) */
  function audience(v) {
    const st = v.step;
    return `<main class="pm-aud" aria-labelledby="pmTitle"><header class="pm-head"><h1 id="pmTitle">${esc(v.title)}</h1>${v.preparedAtLabel ? `<p class="small">${esc(v.preparedAtLabel)}</p>` : ''}</header>
      <section class="pm-step" aria-live="polite" aria-label="${st ? `Etapa ${st.order} de ${st.total}` : 'Apresentação'}">${block(v.block)}</section>
      <nav class="pm-nav" aria-label="Navegação da apresentação"><button class="btn" data-act="pmPrev"${st && st.order > 1 ? '' : ' disabled'}>Anterior</button>
        <span class="small">${st ? `${st.order} / ${st.total}` : ''}</span><button class="btn pri" data-act="pmNext"${st && st.order < st.total ? '' : ' disabled'}>Próximo</button>
        <button class="btn" data-act="pmMap">Mapa</button></nav></main>`;
  }
  /** presenter(controlState) — separate surface/drawer; never mirrored to the audience */
  function presenter(c) {
    return `<aside class="pm-presenter" aria-label="Controles do apresentador"><h2>Apresentador</h2>
      ${(c.warnings || []).length ? `<ul class="small warnl">${c.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${c.presenterNotesVisible && c.notes.length ? `<ul class="pm-notes">${c.notes.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
      <div role="group" aria-label="Ações"><button class="btn" data-act="pmComplete">Concluir apresentação</button><button class="btn" data-act="pmEnd">Encerrar</button></div></aside>`;
  }
  /** preflight(result) — internal preview issue panel (presenter only) */
  function preflight(r) {
    const li = xs => xs.map(i => `<li>${esc(i.message)}${i.lotRef ? ` (${esc(i.lotRef)})` : ''}${i.overridden ? ' — liberado com justificativa' : ''}</li>`).join('');
    const lbl = { PASS: 'Pronta para apresentar', PASS_WITH_WARNINGS: 'Pronta, com avisos', FAIL: 'Bloqueada: corrija antes de apresentar' }[r.status];
    return `<section class="pm-pre" aria-label="Verificação da apresentação"><h2>${esc(lbl)}</h2>${r.blockingIssues.length ? `<h3>Bloqueios</h3><ul>${li(r.blockingIssues)}</ul>` : ''}${r.warnings.length ? `<h3>Avisos</h3><ul>${li(r.warnings)}</ul>` : ''}</section>`;
  }
  return Object.freeze({ audience, presenter, preflight, block, card, esc });
})();

/* ---- share/sharedShellView.js ---- */
/* share/sharedShellView.js — topic 42 renderers: SharedAppShell (public runtime: branding, client-safe content, allowed
   actions, expiry/safety warning, feedback when the capability exists — no admin nav, no CRM shortcuts, no customer
   search, no internal shortcuts), generic error/passcode/confirmation screens, and the internal link-management list.
   Markup only. data-act: sharedFeedback (data-type, data-lot), sharedPasscode, sharedConfirm, sharedPrint,
   shareCopy, shareNative, shareWhatsapp, shareEmail, shareQr, shareRevoke / shareSuspend / shareResume / shareRotate (data-id). */
App.sharedShellView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** headMeta(meta) — noindex/nofollow + no-referrer; generic Open Graph (never a customer name or price) */
  const headMeta = m => `<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">${m && m.title ? `<meta property="og:title" content="${esc(m.title)}">` : ''}${m && m.description ? `<meta property="og:description" content="${esc(m.description)}">` : ''}`;
  function shell(r) {
    const caps = r.capabilities || [], b = r.branding || {}, a = r.content || {};
    const fb = caps.includes('SUBMIT_FEEDBACK');
    const blocks = App.presentationView && a.blocks ? a.blocks.map(x => `<section class="sh-block">${App.presentationView.block(x)}</section>`).join('') : '';
    return `<div class="sh-shell"><header class="sh-head" role="banner"><strong>${esc(b.organizationName)}</strong></header>
      ${(r.warnings || []).length ? `<div class="sh-warn" role="status">${r.warnings.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
      <main class="sh-main" aria-label="${esc(r.title || 'Conteúdo compartilhado')}"><h1>${esc(r.title)}</h1>${a.preparedAtLabel ? `<p class="small">${esc(a.preparedAtLabel)}</p>` : ''}${blocks}</main>
      <footer class="sh-foot">${caps.includes('PRINT') ? '<button class="btn" data-act="sharedPrint">Imprimir</button>' : ''}${fb ? '<button class="btn" data-act="sharedFeedback" data-type="MORE_INFO">Quero saber mais</button><button class="btn" data-act="sharedFeedback" data-type="VISIT_INTEREST">Quero visitar</button>' : ''}
        ${b.contactCta && b.contactCta.channel !== 'NONE' ? `<button class="btn pri" data-act="sharedContact">${esc(b.contactCta.label)}</button>` : ''}
        ${r.expiresAt ? `<p class="small">Disponível até ${esc(App.fmt ? App.fmt.formatDateTime(r.expiresAt) : r.expiresAt)}.</p>` : ''}</footer></div>`;
  }
  const error = (message) => `<main class="sh-err" role="alert"><h1>Link indisponível</h1><p>${esc(message)}</p></main>`;
  const passcode = (message) => `<main class="sh-pass"><h1>Código de acesso</h1>${message ? `<p role="alert">${esc(message)}</p>` : ''}<label for="shPass">Código</label><input id="shPass" type="password" inputmode="numeric" autocomplete="one-time-code" data-in="sharedPasscode"><button class="btn pri" data-act="sharedPasscode">Entrar</button></main>`;
  const confirm = (message) => `<main class="sh-confirm"><p>${esc(message)}</p><button class="btn pri" data-act="sharedConfirm">Abrir apresentação</button></main>`;
  /** links(vms) — internal management (statusVM from App.share.domain.linkStatusVM); never shows the raw token */
  function links(vms) {
    return `<table class="sh-links"><caption>Links compartilhados</caption><thead><tr><th scope="col">Recurso</th><th scope="col">Criado</th><th scope="col">Expira</th><th scope="col">Situação</th><th scope="col">Modo</th><th scope="col">Último acesso</th><th scope="col">Acessos</th><th scope="col">Ações</th></tr></thead><tbody>
      ${vms.map(v => `<tr><td>${esc(v.resource)} <span class="small">${esc(v.maskedLink)}</span></td><td>${esc(v.created)}</td><td>${esc(v.expires)}</td><td>${esc(v.statusLabel)}</td><td>${esc(v.accessMode)}</td><td>${esc(v.lastAccess)}</td><td>${esc(v.accessCount)}</td>
        <td>${v.actions.map(a => `<button class="lbtn small" data-act="${{ CREATE_NEW_LINK: 'shareRotate', REVOKE: 'shareRevoke', SUSPEND: 'shareSuspend', RESUME: 'shareResume' }[a]}" data-id="${esc(v.shareGrantId)}">${esc({ CREATE_NEW_LINK: 'Criar novo link', REVOKE: 'Revogar', SUSPEND: 'Suspender', RESUME: 'Reativar' }[a])}</button>`).join('')}</td></tr>`).join('')}</tbody></table>`;
  }
  /** issued(result, opts) — shown once right after issuance: link + channel buttons (QR keeps a textual URL alternative) */
  function issued(res, o = {}) {
    return `<section class="sh-issued" aria-label="Link criado"><p>Link criado. Ele não será mostrado novamente depois que você fechar esta janela.</p>
      <label for="shUrl">Link</label><input id="shUrl" readonly value="${esc(res.url)}">
      <div role="group" aria-label="Enviar"><button class="btn" data-act="shareCopy">Copiar link</button>${o.native ? '<button class="btn" data-act="shareNative">Compartilhar…</button>' : ''}<button class="btn" data-act="shareWhatsapp">WhatsApp</button><button class="btn" data-act="shareEmail">E-mail</button><button class="btn" data-act="shareQr">QR Code</button></div>
      <p class="small">Quem receber este link poderá abri-lo até ${esc(res.expiresAt && App.fmt ? App.fmt.formatDateTime(res.expiresAt) : 'expirar')} ou até ser revogado; o link não é pessoal.</p></section>`;
  }
  return Object.freeze({ headMeta, shell, error, passcode, confirm, links, issued, esc });
})();

/* ---- chunk end ---- */
App.chunks._done("presentation");
