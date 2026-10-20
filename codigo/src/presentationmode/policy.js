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
