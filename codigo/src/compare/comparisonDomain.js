/* compare/comparisonDomain.js — topic 24: the comparison as a domain of its own.
   ComparisonSession (aggregate root) · ComparisonCandidate · ComparisonPolicy · ComparisonContext ·
   ComparisonMetricRegistry · ComparisonGroupRegistry · ComparisonMetricProfiles · ComparisonDataProvider ·
   ComparisonValue · ComparisonSnapshot · ComparisonMatrix · ComparisonDelta (preparation only) ·
   ComparisonService / ComparisonStore / ComparisonSelectors · migrations, deep link and share payload.

   Rules: the session keeps lot ids and their explicit order, never a copy of the Lot; values come from the
   canonical Lot (repository resolve), the FitScoreResult map and the recommendation result, never from lots.json;
   nothing here recalculates scores or Fit, formats text or chooses a winner (that is topic 25, compare/criterionWinner.js).
   null never becomes 0; UNKNOWN availability is a status of its own ("Status não confirmado"), never AVAILABLE. */
App.compare = App.compare || {};
App.compare.domain = (() => {
  const M = App.model;
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const SessionStatus = E('DRAFT', 'READY', 'PARTIAL', 'STALE', 'INVALID', 'ARCHIVED');
  const AddedFrom = E('MAP', 'SEARCH', 'RECOMMENDATION', 'QUICKVIEW', 'FAVORITES', 'DEEP_LINK', 'RESTORE');
  const CandidateValidation = E('VALID', 'MISSING', 'WRONG_DEVELOPMENT', 'DUPLICATE', 'INACCESSIBLE');
  const ContextMode = E('GENERAL', 'CUSTOMER', 'RECOMMENDATION', 'TECHNICAL', 'PRESENTATION');
  const ValueType = E('MONEY', 'NUMBER', 'AREA', 'DISTANCE', 'SCORE', 'PERCENTAGE', 'ENUM', 'BOOLEAN', 'STATUS', 'TEXT_SHORT');
  const DataSource = E('CANONICAL_LOT', 'COMMERCIAL_STATE', 'AVAILABILITY_STATE', 'ANALYSIS_RESULT', 'FIT_RESULT', 'DERIVED_METRIC', 'PROVENANCE_SUMMARY');
  const DynamicType = E('STATIC', 'VERSIONED', 'DYNAMIC', 'CONTEXTUAL');
  const Semantics = E('LOWER_CAN_BE_PREFERABLE', 'HIGHER_CAN_BE_PREFERABLE', 'CONTEXT_DEPENDENT', 'CATEGORICAL', 'NON_ORDERED', 'STATUS', 'INFORMATIONAL');
  const NullPolicy = E('DISPLAY_NO_DATA', 'DISPLAY_UNKNOWN', 'HIDE_METRIC_IF_ALL_NULL', 'SHOW_PARTIAL', 'NOT_APPLICABLE');
  const StalePolicy = E('SHOW_WITH_WARNING', 'REQUIRE_CONFIRMATION', 'HIDE_IF_EXPIRED', 'ALLOW_LAST_KNOWN');
  const ValueStatus = E('VALID', 'NO_DATA', 'UNKNOWN', 'NOT_APPLICABLE', 'CONFLICTED', 'ERROR');
  const ComparableState = E('COMPARABLE', 'PARTIAL', 'NOT_COMPARABLE', 'CONTEXT_MISSING');
  const LoadingState = E('INITIAL', 'PARTIAL', 'READY', 'ERROR');
  const Audience = E('client', 'presentation', 'broker', 'technical');
  const Errors = E('COMPARISON_LIMIT_REACHED', 'LOT_NOT_FOUND', 'WRONG_DEVELOPMENT', 'INACCESSIBLE', 'NOT_IN_SESSION', 'INVALID_ORDER', 'INVALID_PROFILE', 'INVALID_LOT_ID');
  const SCHEMA_VERSION = 1;
  const MESSAGES = Object.freeze({
    DUPLICATE: 'Este lote já está na comparação.',
    COMPARISON_LIMIT_REACHED: max => `A comparação aceita até ${max} lotes. Remova um lote antes de adicionar outro.`,
    LOT_NOT_FOUND: 'Lote não encontrado neste empreendimento.',
    WRONG_DEVELOPMENT: 'Este lote pertence a outro empreendimento; a comparação é feita dentro de um empreendimento.',
    INACCESSIBLE: 'Este lote não pode entrar na comparação pela política do empreendimento.',
    PARTIAL: 'Comparação parcial — alguns critérios não possuem dados para todos os lotes.',
    ADD_ONE_MORE: 'Adicione mais 1 lote para comparar.', EMPTY: 'Adicione até 4 lotes pelo botão Comparar no painel do lote.'
  });

  // ---------------------------------------------------------------- small utilities (deterministic)
  /** FNV-1a 32-bit over a stable JSON (object keys sorted): same input → same hash */
  const stable = v => v == null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  function hash(v) { const s = stable(v); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  function uuid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* no crypto */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
  }
  const nowIso = opts => (opts && opts.now) || new Date().toISOString();
  const LOT_ID = /^[A-Z]{1,4}-Q[A-Z0-9]{1,4}-L\d{4}$/;
  const cfgOf = devId => (App.configs && App.configs.compare && App.configs.compare[devId]) || null;

  // ---------------------------------------------------------------- ComparisonPolicy
  const DEFAULT_POLICY = Object.freeze({ minCandidates: 2, maxCandidates: (App.services && App.services.comparison && App.services.comparison.MAX_LOTS) || 4, requireSameDevelopment: true,
    allowSold: true, allowUnavailable: true, allowUnknownAvailability: true, allowStaleCommercial: true, preserveCandidateOnStatusChange: true, defaultMetricProfileId: 'BROKER_STANDARD', version: '1.0.0' });
  const policyOf = devId => Object.freeze({ ...DEFAULT_POLICY, ...(((cfgOf(devId) || {}).comparisonPolicy) || {}) });

  // ---------------------------------------------------------------- ComparisonMetricRegistry
  const fmtOf = { MONEY: 'money', AREA: 'area', DISTANCE: 'distance', SCORE: 'score', PERCENTAGE: 'percentage', ENUM: 'enum', BOOLEAN: 'boolean', STATUS: 'status', NUMBER: 'number', TEXT_SHORT: 'text' };
  const metricDefs = [];
  /** D(id, groupId, opts): one ComparisonMetricDefinition. Label/description come from the Field Registry when a fieldKey exists. */
  function D(id, groupId, o) {
    const f = o.fieldKey ? M.field(o.fieldKey) : null;
    const def = Object.freeze({
      id, fieldKey: o.fieldKey || null, metricKey: o.metricKey || null, groupId, labelKey: 'compare.metric.' + id, descriptionKey: 'compare.metric.' + id + '.description',
      label: o.label || (f ? f.label : id), description: o.description || (f ? f.meaning : ''), valueType: o.valueType, unit: o.unit !== undefined ? o.unit : (f ? f.unit : null), enumName: o.enumName || (f && f.enum) || null,
      comparable: o.comparable !== false, clientVisible: o.client !== false, brokerVisible: o.broker !== false, technicalVisible: true, customerContextRequired: !!o.customer,
      dataSource: o.dataSource, dynamicType: o.dynamicType || (f ? f.dynamicType : 'STATIC'), priority: o.priority || (f ? f.priority : 'P2'), sortOrder: metricDefs.length,
      formatterId: o.formatterId || fmtOf[o.valueType], nullPolicy: o.nullPolicy || (['ENUM', 'BOOLEAN', 'STATUS'].includes(o.valueType) ? 'DISPLAY_UNKNOWN' : 'DISPLAY_NO_DATA'),
      stalePolicy: o.stalePolicy || (o.freshnessDomain ? 'SHOW_WITH_WARNING' : 'ALLOW_LAST_KNOWN'), provenancePolicy: o.provenancePolicy || 'SUMMARY',
      comparisonSemantics: o.semantics, freshnessDomain: o.freshnessDomain || null, alwaysShow: !!o.alwaysShow, versionCoherence: o.versionCoherence !== false,
      get: o.get || null, fieldKeyOf: o.fieldKeyOf || null, version: '1.0.0' });
    metricDefs.push(def); return def;
  }
  const S = Semantics;
  // SUMMARY: only the essentials (spec 24 §23)
  D('status', 'SUMMARY', { fieldKey: 'availability.status', label: 'Disponibilidade', valueType: 'STATUS', enumName: 'AvailabilityStatus', dataSource: 'AVAILABILITY_STATE', dynamicType: 'DYNAMIC', semantics: S.STATUS, freshnessDomain: 'availability', priority: 'P0', alwaysShow: true, versionCoherence: false });
  D('area', 'SUMMARY', { fieldKey: 'geometry.areaM2', valueType: 'AREA', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT, priority: 'P0' });
  D('price', 'SUMMARY', { fieldKey: 'commercial.price', label: 'Preço de tabela', valueType: 'MONEY', dataSource: 'COMMERCIAL_STATE', semantics: S.LOWER_CAN_BE_PREFERABLE, freshnessDomain: 'commercial', priority: 'P0' });
  D('pricePerM2', 'SUMMARY', { fieldKey: 'commercial.pricePerM2', label: 'Preço de tabela por m²', valueType: 'MONEY', dataSource: 'COMMERCIAL_STATE', semantics: S.LOWER_CAN_BE_PREFERABLE, freshnessDomain: 'commercial', priority: 'P0', formatterId: 'pricePerM2' });
  D('lotClass', 'SUMMARY', { fieldKey: 'intelligence.class', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.CATEGORICAL, client: false, priority: 'P1', formatterId: 'lotClass' });
  D('primaryScore', 'SUMMARY', { metricKey: 'intelligence.scores.{scoreKey}', label: 'Score principal', valueType: 'SCORE', unit: 'score 0–100', dataSource: 'ANALYSIS_RESULT', dynamicType: 'VERSIONED', semantics: S.HIGHER_CAN_BE_PREFERABLE, client: false, priority: 'P1',
    get: (lot, ctx) => lot.intelligence.scores[ctx.scoreKey || 'housing'], fieldKeyOf: ctx => 'intelligence.scores.' + (ctx.scoreKey || 'housing') });
  D('fitScore', 'SUMMARY', { metricKey: 'fit.fitScore', label: 'Compatibilidade com o perfil', description: 'Aderência do lote ao perfil informado (0–100). Não é probabilidade de compra.', valueType: 'SCORE', unit: 'score 0–100', dataSource: 'FIT_RESULT', dynamicType: 'CONTEXTUAL', customer: true, semantics: S.HIGHER_CAN_BE_PREFERABLE, priority: 'P0',
    get: (lot, ctx, fit) => fit ? fit.fitScore : undefined });
  // COMMERCIAL
  D('downPayment', 'COMMERCIAL', { fieldKey: 'commercial.downPaymentDefaultValue', label: 'Entrada padrão (valor)', valueType: 'MONEY', dataSource: 'COMMERCIAL_STATE', semantics: S.INFORMATIONAL, freshnessDomain: 'commercial', priority: 'P1' });
  D('priceTableVersion', 'COMMERCIAL', { fieldKey: 'commercial.priceTableVersion', valueType: 'TEXT_SHORT', dataSource: 'COMMERCIAL_STATE', semantics: S.INFORMATIONAL, comparable: false, client: false, broker: false, priority: 'P3', versionCoherence: false });
  // GEOMETRY
  D('front', 'GEOMETRY', { fieldKey: 'geometry.frontM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  D('rear', 'GEOMETRY', { fieldKey: 'geometry.rearM', label: 'Fundos (largura)', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL });
  D('depth', 'GEOMETRY', { fieldKey: 'geometry.averageDepthM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL });
  D('shape', 'GEOMETRY', { fieldKey: 'geometry.shape', valueType: 'ENUM', dataSource: 'CANONICAL_LOT', semantics: S.NON_ORDERED });
  D('isCorner', 'GEOMETRY', { fieldKey: 'geometry.isCorner', valueType: 'BOOLEAN', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  // LOCATION
  D('blockPosition', 'LOCATION', { fieldKey: 'location.blockPosition', valueType: 'ENUM', dataSource: 'CANONICAL_LOT', semantics: S.NON_ORDERED });
  D('distanceToGate', 'LOCATION', { fieldKey: 'mobility.routeDistanceToGateM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  D('distanceToLeisure', 'LOCATION', { fieldKey: 'mobility.routeDistanceToLeisureM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  D('distanceToGreen', 'LOCATION', { fieldKey: 'location.distanceToGreenAreaM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  D('distanceToAvenue', 'LOCATION', { fieldKey: 'location.distanceToExternalRoadM', valueType: 'DISTANCE', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  // SURROUNDINGS
  D('rearNeighbor', 'SURROUNDINGS', { fieldKey: 'surroundings.rearNeighborType', valueType: 'ENUM', dataSource: 'CANONICAL_LOT', semantics: S.NON_ORDERED });
  D('greenRear', 'SURROUNDINGS', { fieldKey: 'surroundings.hasGreenRear', valueType: 'BOOLEAN', dataSource: 'CANONICAL_LOT', semantics: S.CONTEXT_DEPENDENT });
  D('sewageStationNearby', 'SURROUNDINGS', { fieldKey: 'surroundings.sewageStationNearby', valueType: 'BOOLEAN', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL });
  // MOBILITY
  D('traffic', 'MOBILITY', { fieldKey: 'mobility.estimatedTraffic', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.CONTEXT_DEPENDENT, formatterId: 'level' });
  D('streetHierarchy', 'MOBILITY', { fieldKey: 'mobility.streetHierarchy', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.NON_ORDERED });
  // ENVIRONMENTAL (only real data: ventilation is null for every lot and is not listed)
  D('orientationFront', 'ENVIRONMENTAL', { fieldKey: 'environmental.orientationFront', valueType: 'ENUM', dataSource: 'CANONICAL_LOT', semantics: S.NON_ORDERED });
  D('northSun', 'ENVIRONMENTAL', { fieldKey: 'environmental.northSunSide', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.NON_ORDERED, formatterId: 'northSun' });
  D('noiseLevel', 'ENVIRONMENTAL', { fieldKey: 'environmental.noiseLevel', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.INFORMATIONAL, formatterId: 'level' });
  D('quietScore', 'ENVIRONMENTAL', { fieldKey: 'environmental.quietScore', valueType: 'SCORE', dataSource: 'ANALYSIS_RESULT', semantics: S.HIGHER_CAN_BE_PREFERABLE, client: false, formatterId: 'note' });
  D('privacyLevel', 'ENVIRONMENTAL', { fieldKey: 'environmental.privacyLevel', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.INFORMATIONAL, formatterId: 'levelF' });
  D('privacyScore', 'ENVIRONMENTAL', { fieldKey: 'environmental.privacyScore', valueType: 'SCORE', dataSource: 'ANALYSIS_RESULT', semantics: S.HIGHER_CAN_BE_PREFERABLE, client: false, formatterId: 'note' });
  D('solarScore', 'ENVIRONMENTAL', { fieldKey: 'environmental.solarScore', valueType: 'SCORE', dataSource: 'ANALYSIS_RESULT', semantics: S.CONTEXT_DEPENDENT, client: false, formatterId: 'note' });
  D('viewDetail', 'ENVIRONMENTAL', { fieldKey: 'surroundings.viewDetail', label: 'Vista', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.NON_ORDERED });
  // CONSTRUCTION — never inferred: null stays "Desconhecido"
  D('topography', 'CONSTRUCTION', { fieldKey: 'construction.topography', valueType: 'ENUM', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL });
  D('slope', 'CONSTRUCTION', { fieldKey: 'construction.slopePercent', valueType: 'PERCENTAGE', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL, formatterId: 'percentNumber' });
  D('constructivePotential', 'CONSTRUCTION', { fieldKey: 'construction.constructivePotential', valueType: 'NUMBER', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL });
  D('easements', 'CONSTRUCTION', { fieldKey: 'construction.easements', valueType: 'TEXT_SHORT', dataSource: 'CANONICAL_LOT', semantics: S.INFORMATIONAL, formatterId: 'easements', comparable: false });
  // INTELLIGENCE (consumed from the analysis; never recalculated)
  for (const [k, lbl] of [['housing', 'Moradia'], ['investment', 'Investimento'], ['family', 'Família'], ['premium', 'Premium']])
    D(k + 'Score', 'INTELLIGENCE', { fieldKey: 'intelligence.scores.' + k, label: 'Score ' + lbl, valueType: 'SCORE', dataSource: 'ANALYSIS_RESULT', semantics: S.HIGHER_CAN_BE_PREFERABLE, client: false });
  D('alertsCount', 'INTELLIGENCE', { metricKey: 'intelligence.alerts.count', label: 'Alertas', valueType: 'NUMBER', unit: 'alertas', dataSource: 'DERIVED_METRIC', dynamicType: 'VERSIONED', semantics: S.INFORMATIONAL, client: false, priority: 'P2', formatterId: 'alerts',
    get: lot => Array.isArray(lot.intelligence.alerts) ? lot.intelligence.alerts.length : undefined });
  D('analysisVersion', 'INTELLIGENCE', { fieldKey: 'intelligence.analysisVersion', valueType: 'TEXT_SHORT', dataSource: 'ANALYSIS_RESULT', semantics: S.INFORMATIONAL, comparable: false, client: false, broker: false, versionCoherence: false });
  // CUSTOMER_FIT — only with a customer context
  D('fitCoverage', 'CUSTOMER_FIT', { metricKey: 'fit.coverage', label: 'Cobertura dos dados do perfil', valueType: 'PERCENTAGE', unit: '%', dataSource: 'FIT_RESULT', dynamicType: 'CONTEXTUAL', customer: true, semantics: S.INFORMATIONAL, client: false, priority: 'P2', formatterId: 'ratio',
    get: (lot, ctx, fit) => fit ? fit.coverage : undefined });
  D('fitConfidence', 'CUSTOMER_FIT', { metricKey: 'fit.confidence', label: 'Confiabilidade da compatibilidade', valueType: 'ENUM', enumName: 'Confidence', unit: null, dataSource: 'FIT_RESULT', dynamicType: 'CONTEXTUAL', customer: true, semantics: S.INFORMATIONAL, client: false, priority: 'P2',
    get: (lot, ctx, fit) => fit && fit.confidence ? fit.confidence.level : undefined });
  // DATA_QUALITY — broker / technical
  D('availabilityFreshness', 'DATA_QUALITY', { fieldKey: 'availability.freshness', label: 'Atualidade da disponibilidade', valueType: 'ENUM', enumName: 'Freshness', dataSource: 'PROVENANCE_SUMMARY', semantics: S.INFORMATIONAL, client: false, comparable: false, versionCoherence: false,
    get: lot => lot.availability.freshness });
  D('commercialFreshness', 'DATA_QUALITY', { metricKey: 'metadata.freshness.commercial', label: 'Atualidade do preço de tabela', valueType: 'ENUM', enumName: 'Freshness', unit: null, dataSource: 'PROVENANCE_SUMMARY', dynamicType: 'DYNAMIC', semantics: S.INFORMATIONAL, client: false, comparable: false,
    get: lot => (lot.metadata.freshness || {}).commercial });
  D('analysisConfidence', 'DATA_QUALITY', { fieldKey: 'intelligence.confidence', valueType: 'ENUM', dataSource: 'ANALYSIS_RESULT', semantics: S.INFORMATIONAL, client: false });
  D('conflictsCount', 'DATA_QUALITY', { metricKey: 'provenance.conflicts', label: 'Campos com fontes divergentes', valueType: 'NUMBER', unit: 'campos', dataSource: 'PROVENANCE_SUMMARY', dynamicType: 'STATIC', semantics: S.INFORMATIONAL, client: false, comparable: false, formatterId: 'number',
    get: lot => Object.values(lot.provenance || {}).filter(p => p && p.status === 'CONFLICTED').length });
  const METRICS = Object.freeze(metricDefs.slice());
  const METRIC_BY = new Map(METRICS.map(m => [m.id, m]));
  const metric = id => METRIC_BY.get(id) || null;

  // ---------------------------------------------------------------- ComparisonGroupRegistry (order = sortOrder)
  const G = (id, label, description, o = {}) => Object.freeze({ id, labelKey: 'compare.group.' + id, label, descriptionKey: 'compare.group.' + id + '.description', description, priority: o.priority || 2,
    collapsedByDefault: !!o.collapsed, clientVisible: o.client !== false, brokerVisible: o.broker !== false, technicalVisible: true, metricIds: Object.freeze(METRICS.filter(m => m.groupId === id).map(m => m.id)), sortOrder: o.order });
  const GROUPS = Object.freeze([
    G('SUMMARY', 'Resumo', 'O essencial: situação, área, preço de tabela, classe, score principal e compatibilidade quando há cliente.', { priority: 0, order: 0 }),
    G('CUSTOMER_FIT', 'Perfil do cliente', 'Compatibilidade com o perfil informado; aparece só com cliente.', { priority: 1, order: 1 }),
    G('COMMERCIAL', 'Comercial', 'Condições da tabela vigente.', { priority: 1, order: 2 }),
    G('GEOMETRY', 'Geometria', 'Medidas e formato do lote.', { priority: 2, order: 3, collapsed: true }),
    G('LOCATION', 'Localização', 'Posição e percursos internos.', { priority: 2, order: 4 }),
    G('SURROUNDINGS', 'Vizinhança', 'O que existe hoje ao redor do lote.', { priority: 2, order: 5, collapsed: true }),
    G('MOBILITY', 'Mobilidade', 'Trânsito estimado e tipo de via.', { priority: 2, order: 6, collapsed: true }),
    G('ENVIRONMENTAL', 'Conforto', 'Sol, ruído, privacidade e vista (estimativas da análise).', { priority: 2, order: 7 }),
    G('CONSTRUCTION', 'Construção', 'Topografia e restrições; sem levantamento, nada é inferido.', { priority: 3, order: 8, collapsed: true }),
    G('INTELLIGENCE', 'Inteligência', 'Scores e classe da análise vigente.', { priority: 2, order: 9, client: false }),
    G('DATA_QUALITY', 'Qualidade do dado', 'Atualidade, confiabilidade e divergências.', { priority: 3, order: 10, client: false, collapsed: true })
  ].sort((a, b) => a.sortOrder - b.sortOrder));
  const GROUP_BY = new Map(GROUPS.map(g => [g.id, g]));

  // ---------------------------------------------------------------- ComparisonMetricProfiles (switching a profile never touches candidates)
  const ALL_GROUPS = GROUPS.map(g => g.id);
  const P = (id, label, groupIds, mode, filter = () => true, extra = {}) => Object.freeze({ id, labelKey: 'compare.profile.' + id, label, groupIds: Object.freeze(groupIds), mode,
    metricIds: Object.freeze(groupIds.flatMap(g => GROUP_BY.get(g).metricIds).filter(id => filter(metric(id)))), requiredContext: extra.requiredContext || null, version: '1.0.0' });
  const PROFILES = Object.freeze([
    P('QUICK', 'Rápido', ['SUMMARY'], 'broker'),
    P('BROKER_STANDARD', 'Corretor', ['SUMMARY', 'CUSTOMER_FIT', 'COMMERCIAL', 'LOCATION', 'ENVIRONMENTAL', 'GEOMETRY', 'SURROUNDINGS', 'MOBILITY', 'CONSTRUCTION', 'INTELLIGENCE'], 'broker', m => m.brokerVisible),
    P('CUSTOMER', 'Cliente', ['SUMMARY', 'CUSTOMER_FIT', 'COMMERCIAL', 'LOCATION', 'ENVIRONMENTAL', 'GEOMETRY', 'SURROUNDINGS'], 'client', m => m.clientVisible),
    P('TECHNICAL', 'Técnico', ALL_GROUPS, 'technical'),
    P('INVESTMENT', 'Investimento', ['SUMMARY', 'INTELLIGENCE', 'COMMERCIAL', 'LOCATION', 'GEOMETRY'], 'broker', m => m.brokerVisible),
    P('HOUSING', 'Moradia', ['SUMMARY', 'CUSTOMER_FIT', 'ENVIRONMENTAL', 'MOBILITY', 'SURROUNDINGS', 'LOCATION', 'INTELLIGENCE', 'GEOMETRY'], 'broker', m => m.brokerVisible)
  ]);
  const PROFILE_BY = new Map(PROFILES.map(p => [p.id, p]));
  const profile = id => PROFILE_BY.get(id) || null;
  /** the active map layer only emphasises its metric (presentation hint; values and order never change) */
  const LAYER_METRIC = Object.freeze({ availability: 'status', price: 'price', pricePerM2: 'pricePerM2', area: 'area', class: 'lotClass', score: 'primaryScore', fit: 'fitScore', sun: 'northSun',
    noise: 'noiseLevel', privacy: 'privacyLevel', forest: 'greenRear', traffic: 'traffic', gate: 'distanceToGate', leisure: 'distanceToLeisure' });

  // ---------------------------------------------------------------- ComparisonContext
  function normalizeContext(c = {}) {
    let mode = ContextMode[c.mode] ? c.mode : (c.customerProfileVersion ? 'CUSTOMER' : 'GENERAL');
    if (c.customerProfileVersion && mode === 'GENERAL') mode = 'CUSTOMER';
    if (!c.customerProfileVersion && (mode === 'CUSTOMER' || mode === 'RECOMMENDATION')) mode = 'GENERAL'; // no customer → no customer context
    const opaque = v => typeof v === 'string' && v.length <= 80 ? v : null; // ids only; never names, phones or documents
    return Object.freeze({ mode, customerId: opaque(c.customerId), customerProfileVersion: opaque(c.customerProfileVersion), activeLayerId: opaque(c.activeLayerId), recommendationSessionId: opaque(c.recommendationSessionId),
      filterQueryHash: opaque(c.filterQueryHash), scoreKey: ['housing', 'investment', 'family', 'premium', 'overall'].includes(c.scoreKey) ? c.scoreKey : 'housing', locale: 'pt-BR', currency: 'BRL' });
  }
  const hasCustomer = ctx => !!(ctx && ctx.customerProfileVersion);
  /** contextHash: what can change values or their meaning (not the active layer nor the filters: those are presentation hints) */
  const contextHash = ctx => hash({ mode: ctx.mode, customerProfileVersion: ctx.customerProfileVersion || null, scoreKey: ctx.scoreKey });

  // ---------------------------------------------------------------- ComparisonSession (pure: every operation returns a new session)
  function statusOf(s, policy = policyOf(s.developmentId)) { return s.candidates.length < policy.minCandidates ? 'DRAFT' : 'READY'; }
  function withCandidates(s, candidates, opts, patch = {}) {
    const c = candidates.map((x, i) => Object.freeze({ ...x, order: i }));
    const n = { ...s, ...patch, candidates: Object.freeze(c), candidateIds: Object.freeze(c.map(x => x.lotId)), candidateOrder: Object.freeze(c.map(x => x.lotId)), updatedAt: nowIso(opts), revision: (s.revision || 0) + 1 };
    n.status = s.status === 'ARCHIVED' ? 'ARCHIVED' : statusOf(n, opts && opts.policy);
    return Object.freeze(n);
  }
  function createSession(developmentId, opts = {}) {
    const policy = opts.policy || policyOf(developmentId), at = nowIso(opts);
    const s = Object.freeze({ id: opts.id || 'cmp_' + uuid(), developmentId, candidates: Object.freeze([]), candidateIds: Object.freeze([]), candidateOrder: Object.freeze([]), context: normalizeContext(opts.context),
      metricProfileId: profile(opts.metricProfileId) ? opts.metricProfileId : policy.defaultMetricProfileId, status: 'DRAFT', createdAt: at, updatedAt: at, schemaVersion: SCHEMA_VERSION, snapshotRef: null, revision: 0 });
    if (!opts.candidateIds || !opts.candidateIds.length) return opts.withReport ? { session: s, rejected: [] } : s;
    let cur = s; const rejected = [];
    for (const id of opts.candidateIds) { const r = addCandidate(cur, id, { ...opts, source: opts.source || 'RESTORE' }); if (r.duplicate) rejected.push({ ref: id, code: 'DUPLICATE', validationState: 'DUPLICATE' }); else if (r.ok) cur = r.session; else rejected.push({ ref: id, code: r.code, validationState: r.validationState }); }
    return opts.withReport ? { session: cur, rejected } : cur;
  }
  /** validate(ref) → { lot, lotId, validationState, code } — resolve accepts a technical id or a short code */
  function validateCandidate(s, ref, opts = {}) {
    const policy = opts.policy || policyOf(s.developmentId);
    let lot = null;
    if (typeof opts.resolve === 'function') { try { lot = opts.resolve(ref) || null; } catch (e) { lot = null; } }
    else if (typeof ref === 'string' && LOT_ID.test(ref)) lot = { identity: { id: ref, developmentId: s.developmentId, displayCode: ref }, availability: { status: 'UNKNOWN' } }; // id-only mode (no repository): format check
    if (!lot || !lot.identity) return { validationState: 'MISSING', code: 'LOT_NOT_FOUND' };
    if (policy.requireSameDevelopment && lot.identity.developmentId && lot.identity.developmentId !== s.developmentId) return { lot, lotId: lot.identity.id, validationState: 'WRONG_DEVELOPMENT', code: 'WRONG_DEVELOPMENT' };
    const st = lot.availability && lot.availability.status;
    if ((st === 'SOLD' && !policy.allowSold) || (['UNAVAILABLE', 'BLOCKED', 'RESERVED', 'PROPOSAL'].includes(st) && !policy.allowUnavailable) || (st === 'UNKNOWN' && !policy.allowUnknownAvailability))
      return { lot, lotId: lot.identity.id, validationState: 'INACCESSIBLE', code: 'INACCESSIBLE' };
    if (s.candidateIds.includes(lot.identity.id)) return { lot, lotId: lot.identity.id, validationState: 'DUPLICATE', code: null };
    return { lot, lotId: lot.identity.id, validationState: 'VALID', code: null };
  }
  /** addCandidate(session, lotId, { source, resolve }) → { ok, session, duplicate?, code?, message?, validationState } */
  function addCandidate(s, ref, opts = {}) {
    const policy = opts.policy || policyOf(s.developmentId), v = validateCandidate(s, ref, { ...opts, policy });
    if (v.validationState === 'DUPLICATE') return { ok: true, session: s, duplicate: true, validationState: 'DUPLICATE', message: MESSAGES.DUPLICATE };
    if (v.code) return { ok: false, session: s, code: v.code, validationState: v.validationState, message: MESSAGES[v.code] };
    if (s.candidates.length >= policy.maxCandidates) return { ok: false, session: s, code: 'COMPARISON_LIMIT_REACHED', validationState: 'VALID', message: MESSAGES.COMPARISON_LIMIT_REACHED(policy.maxCandidates) }; // never drops an existing candidate
    const cand = { lotId: v.lotId, displayCode: v.lot.identity.displayCode || v.lotId, order: s.candidates.length, addedAt: nowIso(opts), addedFrom: AddedFrom[opts.source] || 'MAP', validationState: 'VALID' };
    return { ok: true, session: withCandidates(s, [...s.candidates, cand], { ...opts, policy }), validationState: 'VALID' };
  }
  function removeCandidate(s, lotId, opts = {}) {
    if (!s.candidateIds.includes(lotId)) return { ok: false, session: s, code: 'NOT_IN_SESSION' };
    return { ok: true, session: withCandidates(s, s.candidates.filter(c => c.lotId !== lotId), opts) };
  }
  /** reorderCandidates(session, order): order must be a permutation of the current ids */
  function reorderCandidates(s, order, opts = {}) {
    const ok = Array.isArray(order) && order.length === s.candidates.length && new Set(order).size === order.length && order.every(id => s.candidateIds.includes(id));
    if (!ok) return { ok: false, session: s, code: 'INVALID_ORDER' };
    const by = new Map(s.candidates.map(c => [c.lotId, c]));
    return { ok: true, session: withCandidates(s, order.map(id => by.get(id)), opts) };
  }
  /** moveCandidate(session, lotId, -1 | +1): the keyboard alternative to drag and drop ("Mover para a esquerda/direita") */
  function moveCandidate(s, lotId, delta, opts = {}) {
    const i = s.candidateIds.indexOf(lotId), j = i + Math.sign(delta || 0);
    if (i < 0) return { ok: false, session: s, code: 'NOT_IN_SESSION' };
    if (j < 0 || j >= s.candidateIds.length || j === i) return { ok: true, session: s, unchanged: true };
    const order = s.candidateIds.slice(); [order[i], order[j]] = [order[j], order[i]];
    return reorderCandidates(s, order, opts);
  }
  function replaceCandidate(s, oldId, ref, opts = {}) {
    const i = s.candidateIds.indexOf(oldId); if (i < 0) return { ok: false, session: s, code: 'NOT_IN_SESSION' };
    const without = { ...s, candidates: s.candidates.filter(c => c.lotId !== oldId), candidateIds: s.candidateIds.filter(id => id !== oldId) };
    const r = addCandidate(without, ref, opts); if (!r.ok) return { ...r, session: s };
    if (r.duplicate) return { ok: false, session: s, code: 'DUPLICATE', validationState: 'DUPLICATE', message: MESSAGES.DUPLICATE };
    const added = r.session.candidates[r.session.candidates.length - 1], list = s.candidates.slice(); list[i] = added;
    return { ok: true, session: withCandidates(s, list, opts) };
  }
  const clear = (s, opts = {}) => ({ ok: true, session: withCandidates(s, [], opts) });
  /** customer change: candidates and order stay; only the context (and so the Fit upstream) changes */
  const setContext = (s, ctx, opts = {}) => ({ ok: true, session: withCandidates(s, s.candidates, opts, { context: normalizeContext({ ...s.context, ...ctx }) }) });
  function setMetricProfile(s, id, opts = {}) {
    if (!profile(id)) return { ok: false, session: s, code: 'INVALID_PROFILE' };
    return { ok: true, session: withCandidates(s, s.candidates, opts, { metricProfileId: id }) };
  }
  /** syncFromIds(previous, developmentId, ids, opts): reconcile with the app store's comparisonLotIds keeping the session id,
      addedAt/addedFrom of the lots that stay and the explicit order of `ids`. Invalid ids are reported, never thrown. */
  function syncFromIds(prev, developmentId, ids, opts = {}) {
    const base = prev && prev.developmentId === developmentId ? prev : createSession(developmentId, opts);
    const keep = new Map(base.candidates.map(c => [c.lotId, c])), list = [], rejected = [], policy = opts.policy || policyOf(developmentId);
    let probe = { ...base, candidates: [], candidateIds: [] };
    for (const ref of Array.isArray(ids) ? ids : []) {
      const v = validateCandidate(probe, ref, { ...opts, policy });
      if (v.validationState === 'DUPLICATE') { rejected.push({ ref, code: 'DUPLICATE', validationState: 'DUPLICATE' }); continue; }
      if (v.code) { rejected.push({ ref, code: v.code, validationState: v.validationState }); continue; }
      if (list.length >= policy.maxCandidates) { rejected.push({ ref, code: 'COMPARISON_LIMIT_REACHED', validationState: 'VALID' }); continue; }
      list.push(keep.get(v.lotId) || { lotId: v.lotId, displayCode: v.lot.identity.displayCode || v.lotId, addedAt: nowIso(opts), addedFrom: AddedFrom[opts.source] || 'MAP', validationState: 'VALID' });
      probe = { ...probe, candidateIds: list.map(c => c.lotId) };
    }
    const same = list.length === base.candidates.length && list.every((c, i) => c.lotId === base.candidateIds[i]);
    let s = same ? base : withCandidates(base, list, { ...opts, policy });
    if (opts.context) { const nc = normalizeContext({ ...s.context, ...opts.context }); if (stable(nc) !== stable(s.context)) s = withCandidates(s, s.candidates, opts, { context: nc }); }
    if (opts.metricProfileId && opts.metricProfileId !== s.metricProfileId && profile(opts.metricProfileId)) s = withCandidates(s, s.candidates, opts, { metricProfileId: opts.metricProfileId });
    return { session: s, rejected };
  }

  // ---------------------------------------------------------------- persistence, migrations, deep link, share
  /** serialize: only ids, order, profile and context mode — never live values, never customer identity */
  const serialize = s => ({ v: SCHEMA_VERSION, developmentId: s.developmentId, candidateIds: s.candidateIds.slice(), metricProfileId: s.metricProfileId, contextMode: s.context.mode === 'CUSTOMER' ? 'CUSTOMER' : s.context.mode });
  /** ComparisonSessionMigrationRegistry: version → upgrade to the next version. v0 = the store's plain array of ids. */
  const MIGRATIONS = Object.freeze({ 0: raw => ({ v: 1, developmentId: raw.developmentId || null, candidateIds: Array.isArray(raw) ? raw : (raw.ids || raw.candidateIds || []), metricProfileId: raw.metricProfileId || null, contextMode: raw.contextMode || 'GENERAL' }) });
  function migrate(raw) {
    let cur = Array.isArray(raw) ? Object.assign([...raw], { v: 0 }) : raw && typeof raw === 'object' ? raw : null; if (!cur) return null;
    let v = typeof cur.v === 'number' ? cur.v : 0, guard = 0;
    while (v < SCHEMA_VERSION && MIGRATIONS[v] && guard++ < 10) { cur = MIGRATIONS[v](cur); v = cur.v; }
    return v === SCHEMA_VERSION ? cur : null;
  }
  /** restore(serialized, { developmentId, resolve, customerProfileVersion }) → { session, warnings } — values are rebuilt from current data */
  function restore(raw, opts = {}) {
    const warnings = [], devId = opts.developmentId, data = migrate(raw);
    if (!data) { warnings.push({ code: 'INVALID_STATE', message: 'Comparação salva em formato desconhecido: ignorada.' }); return { session: createSession(devId, { ...opts, withReport: false }), warnings }; }
    if (data.developmentId && devId && data.developmentId !== devId) { warnings.push({ code: 'WRONG_DEVELOPMENT', message: MESSAGES.WRONG_DEVELOPMENT }); return { session: createSession(devId, { ...opts, withReport: false }), warnings }; }
    let profileId = data.metricProfileId, mode = data.contextMode;
    if (profileId && !profile(profileId)) { warnings.push({ code: 'INVALID_PROFILE', message: 'Perfil de comparação desconhecido: usando o perfil padrão.' }); profileId = null; }
    if (mode === 'CUSTOMER' && !opts.customerProfileVersion) { warnings.push({ code: 'CUSTOMER_CONTEXT_MISSING', message: 'O cliente da comparação não está mais ativo: a compatibilidade foi retirada e os lotes foram mantidos.' }); mode = 'GENERAL'; if (profileId === 'CUSTOMER') profileId = 'BROKER_STANDARD'; }
    const r = createSession(devId || data.developmentId, { ...opts, metricProfileId: profileId, context: { ...(opts.context || {}), mode, customerProfileVersion: mode === 'CUSTOMER' ? opts.customerProfileVersion : null }, candidateIds: data.candidateIds, source: opts.source || 'RESTORE', withReport: true });
    for (const x of r.rejected) warnings.push({ code: x.code, ref: x.ref, message: x.code === 'COMPARISON_LIMIT_REACHED' ? MESSAGES.COMPARISON_LIMIT_REACHED(policyOf(devId).maxCandidates) : x.code === 'DUPLICATE' ? MESSAGES.DUPLICATE : MESSAGES[x.code] || x.code });
    return { session: r.session, warnings };
  }
  /** deepLinkToken(session, codeOf) — the router's grammar: <dev>.compare.<code>~<code> (short codes, ids only, no customer data) */
  const deepLinkToken = (s, codeOf = id => id) => s.candidateIds.length ? `${s.developmentId}.compare.${s.candidateIds.map(codeOf).join('~')}` : s.developmentId;
  /** parseDeepLink(link, { developmentId, resolve }) accepts "<dev>.compare.A1~B2" or "?compare=ID,ID"; invalid ids never break the app */
  function parseDeepLink(link, opts = {}) {
    const str = String(link || '').replace(/^#/, ''); let dev = opts.developmentId, refs = [];
    const q = str.match(/(?:^|[?&])compare=([^&]*)/);
    if (q) refs = decodeURIComponent(q[1]).split(',');
    else { const p = str.split('?')[0].split('.'); if (p[1] === 'compare' && p[2]) { if (opts.developmentId && p[0] !== opts.developmentId) return { session: createSession(opts.developmentId, { ...opts, withReport: false }), warnings: [{ code: 'WRONG_DEVELOPMENT', message: MESSAGES.WRONG_DEVELOPMENT }] }; dev = dev || p[0]; refs = p[2].split('~'); } }
    refs = refs.map(x => x.trim()).filter(Boolean).slice(0, 20);
    return restore({ v: SCHEMA_VERSION, developmentId: dev, candidateIds: refs, metricProfileId: null, contextMode: 'GENERAL' }, { ...opts, developmentId: dev, source: 'DEEP_LINK' });
  }
  /** ComparisonSharePayload (the WhatsApp text itself is produced by ShareService, not by the table) */
  function sharePayload(s, { codeOf, baseUrl = '', snapshot = null, evaluationPolicyVersion = null } = {}) {
    const token = deepLinkToken(s, codeOf);
    return { developmentId: s.developmentId, candidateIds: s.candidateIds.slice(), metricProfileId: s.metricProfileId, contextMode: s.context.mode === 'CUSTOMER' ? 'CUSTOMER' : s.context.mode,
      deepLink: App.services.share && App.services.share.deepLink ? App.services.share.deepLink(baseUrl, token) : baseUrl + '#' + token,
      versionSummary: snapshot ? { snapshotHash: snapshot.hash, dataVersions: snapshot.dataVersions, evaluationPolicyVersion } : null };
  }

  // ---------------------------------------------------------------- ComparisonDataProvider → ComparisonValue
  const isUnknownEnum = v => v === 'UNKNOWN';
  function versionRefOf(def, lot, fit) {
    const dv = (lot.metadata && lot.metadata.dataVersions) || {};
    switch (def.dataSource) {
      case 'CANONICAL_LOT': return dv.staticVersion ? 'static:' + dv.staticVersion : null;
      case 'COMMERCIAL_STATE': return dv.priceTableVersion || (lot.commercial && lot.commercial.priceTableVersion) ? 'priceTable:' + (dv.priceTableVersion || lot.commercial.priceTableVersion) : null;
      case 'AVAILABILITY_STATE': return 'availability:rev' + ((lot.availability && lot.availability.revision) || 0);
      case 'ANALYSIS_RESULT': return dv.analysisVersion ? 'analysis:' + dv.analysisVersion : null;
      case 'FIT_RESULT': return fit && fit.versions ? 'fit:' + fit.versions.fitMethodologyVersion + '/' + (fit.customerProfileVersion || fit.versions.profileVersion) : null;
      default: return null;
    }
  }
  /** value(def, lot, ctx, fit) → ComparisonValue. Never formats, ranks or recalculates. */
  function value(def, lot, ctx, fit) {
    const base = { candidateId: lot.identity.id, metricId: def.id, unit: def.unit, normalizedValue: null, freshness: null, confidence: null, provenanceSummary: null, versionRef: null, notes: null };
    if (def.customerContextRequired && !hasCustomer(ctx)) return Object.freeze({ ...base, rawValue: null, valueStatus: 'NOT_APPLICABLE', comparableState: 'CONTEXT_MISSING', notes: 'CUSTOMER_CONTEXT_MISSING' });
    let raw;
    try { raw = def.get ? def.get(lot, ctx, fit) : M.get(lot, def.fieldKey); } catch (e) { return Object.freeze({ ...base, rawValue: null, valueStatus: 'ERROR', comparableState: 'NOT_COMPARABLE', notes: 'READ_ERROR' }); }
    const fk = def.fieldKeyOf ? def.fieldKeyOf(ctx) : def.fieldKey;
    const prov = fk ? M.getFieldProvenance(lot, fk) : null;
    let freshness = null;
    if (def.freshnessDomain === 'commercial') freshness = (lot.metadata && lot.metadata.freshness && lot.metadata.freshness.commercial) || 'UNKNOWN';
    else if (def.freshnessDomain === 'availability') freshness = (lot.availability && lot.availability.freshness) || 'UNKNOWN';
    const confidence = def.dataSource === 'FIT_RESULT' ? (fit && fit.confidence ? fit.confidence.level : null) : prov ? prov.confidence || null : null;
    let valueStatus;
    if (def.dataSource === 'FIT_RESULT' && !fit) valueStatus = 'NO_DATA';
    else if (prov && prov.status === 'CONFLICTED') valueStatus = 'CONFLICTED'; // never resolved silently
    else if (raw == null) valueStatus = prov && prov.status === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : def.nullPolicy === 'DISPLAY_UNKNOWN' ? 'UNKNOWN' : 'NO_DATA';
    else if (isUnknownEnum(raw) && ['ENUM', 'STATUS'].includes(def.valueType)) valueStatus = 'UNKNOWN';
    else if (typeof raw === 'number' && !Number.isFinite(raw)) valueStatus = 'ERROR';
    else valueStatus = 'VALID';
    const stale = freshness === 'STALE' || freshness === 'EXPIRED';
    const comparableState = valueStatus !== 'VALID' || !def.comparable ? 'NOT_COMPARABLE' : stale ? 'PARTIAL' : 'COMPARABLE';
    return Object.freeze({ ...base, rawValue: raw == null ? null : raw, valueStatus, comparableState, freshness, confidence,
      provenanceSummary: prov ? Object.freeze({ status: prov.status, sourceId: prov.sourceId || null, method: prov.method || null }) : null,
      versionRef: versionRefOf(def, lot, fit), fieldKey: fk || def.metricKey || null });
  }
  /** batch: one lookup per candidate, every metric read from that one Lot (no N+1) */
  function provideValues({ candidateIds, metrics, resolve, fitById, context }) {
    const out = new Map(), ctx = context || normalizeContext();
    for (const id of candidateIds) {
      let lot = null; try { lot = resolve(id) || null; } catch (e) { lot = null; }
      const fit = lot && fitById && typeof fitById.get === 'function' ? fitById.get(lot.identity.id) || null : null;
      const row = new Map();
      for (const def of metrics) row.set(def.id, lot ? value(def, lot, ctx, fit) : Object.freeze({ candidateId: id, metricId: def.id, rawValue: null, valueStatus: 'ERROR', comparableState: 'NOT_COMPARABLE', freshness: null, confidence: null, provenanceSummary: null, versionRef: null, unit: def.unit, notes: 'LOT_NOT_FOUND' }));
      out.set(id, { lot, fit, values: row });
    }
    return out;
  }

  // ---------------------------------------------------------------- ComparisonSnapshot
  const FRESH_RANK = { FRESH: 0, UNKNOWN: 1, STALE: 2, EXPIRED: 3 };
  const worst = xs => xs.filter(Boolean).reduce((a, b) => (FRESH_RANK[b] ?? 1) > (FRESH_RANK[a] ?? 1) ? b : a, null);
  const metricsOf = (s, extra = []) => { const p = profile(s.metricProfileId) || profile('BROKER_STANDARD'); return [...p.metricIds, ...extra.filter(id => !p.metricIds.includes(id))].map(metric).filter(Boolean); };
  /** buildSnapshot(session, { resolve, fitById, recommendation, filter: { active, matchedIds }, now, requestToken }) */
  function buildSnapshot(s, deps = {}) {
    const prof = profile(s.metricProfileId) || profile('BROKER_STANDARD'), metrics = metricsOf(s), ctx = s.context;
    const data = provideValues({ candidateIds: s.candidateIds, metrics, resolve: deps.resolve || (() => null), fitById: hasCustomer(ctx) ? deps.fitById : null, context: ctx });
    const valuesByMetric = {}, metricOrder = metrics.map(m => m.id);
    for (const m of metrics) valuesByMetric[m.id] = Object.freeze(s.candidateIds.map(id => data.get(id).values.get(m.id)));
    // data versions: one per kind; a disagreement between candidates is MIXED_VERSION, never hidden
    const lots = s.candidateIds.map(id => data.get(id).lot).filter(Boolean), dv = l => (l.metadata && l.metadata.dataVersions) || {};
    const pick = key => { const xs = [...new Set(lots.map(l => dv(l)[key]).filter(x => x != null))]; return xs.length <= 1 ? (xs[0] ?? null) : xs; };
    const fits = s.candidateIds.map(id => data.get(id).fit).filter(Boolean);
    const fitVersion = [...new Set(fits.map(f => f.versions && f.versions.fitMethodologyVersion).filter(Boolean))];
    const dataVersions = { staticDataVersion: pick('staticVersion'), analysisVersion: pick('analysisVersion'), priceTableVersion: pick('priceTableVersion'),
      availabilityRevision: Object.fromEntries(lots.map(l => [l.identity.id, (l.availability && l.availability.revision) || 0])),
      customerProfileVersion: hasCustomer(ctx) ? ctx.customerProfileVersion : null, fitMethodologyVersion: fitVersion.length <= 1 ? (fitVersion[0] || null) : fitVersion,
      comparisonMetricProfileVersion: prof.version };
    const mixedKeys = ['staticDataVersion', 'analysisVersion', 'priceTableVersion', 'fitMethodologyVersion'].filter(k => Array.isArray(dataVersions[k]));
    // completeness (context-missing Fit cells are not expected cells)
    const comp = { totalExpectedCells: 0, validCells: 0, noDataCells: 0, unknownCells: 0, conflictedCells: 0, staleCells: 0, errorCells: 0, coverageRatio: null, byCandidate: {}, byMetric: {}, partialMetricIds: [] };
    for (const m of metrics) {
      const vs = valuesByMetric[m.id]; let valid = 0, expected = 0;
      vs.forEach(v => {
        if (v.comparableState === 'CONTEXT_MISSING' || v.valueStatus === 'NOT_APPLICABLE') return;
        expected++; comp.totalExpectedCells++;
        const bc = comp.byCandidate[v.candidateId] || (comp.byCandidate[v.candidateId] = { expected: 0, valid: 0 }); bc.expected++;
        if (v.valueStatus === 'VALID') { valid++; comp.validCells++; bc.valid++; } else if (v.valueStatus === 'NO_DATA') comp.noDataCells++; else if (v.valueStatus === 'UNKNOWN') comp.unknownCells++;
        else if (v.valueStatus === 'CONFLICTED') comp.conflictedCells++; else comp.errorCells++;
        if (v.freshness === 'STALE' || v.freshness === 'EXPIRED') comp.staleCells++;
      });
      comp.byMetric[m.id] = { expected, valid, coverage: expected ? valid / expected : null };
      if (valid > 0 && valid < expected && !m.alwaysShow) comp.partialMetricIds.push(m.id);
    }
    comp.coverageRatio = comp.totalExpectedCells ? comp.validCells / comp.totalExpectedCells : null;
    for (const v of Object.values(comp.byCandidate)) v.coverage = v.expected ? v.valid / v.expected : null;
    const freshnessSummary = { commercial: worst(lots.map(l => l.metadata && l.metadata.freshness && l.metadata.freshness.commercial)), availability: worst(lots.map(l => l.availability && l.availability.freshness)),
      staleCandidateIds: lots.filter(l => ['STALE', 'EXPIRED'].includes(l.metadata && l.metadata.freshness && l.metadata.freshness.commercial) || ['STALE', 'EXPIRED'].includes(l.availability.freshness)).map(l => l.identity.id) };
    const missing = s.candidateIds.filter(id => !data.get(id).lot);
    const status = missing.length ? 'INVALID' : s.candidates.length < policyOf(s.developmentId).minCandidates ? 'DRAFT' : comp.staleCells > 0 ? 'STALE' : (mixedKeys.length || comp.partialMetricIds.length || comp.conflictedCells) ? 'PARTIAL' : 'READY';
    const cHash = contextHash(ctx);
    const h = hash({ c: s.candidateIds, p: prof.id, pv: prof.version, dv: dataVersions, ctx: cHash });
    // candidate summaries are read live here and never stored in the session
    const rec = deps.recommendation, recItem = id => rec ? [...(rec.recommendations || []), ...(rec.reviewCandidates || [])].find(x => x.lotId === id) || null : null;
    const filter = deps.filter && deps.filter.active ? deps.filter : null;
    const candidates = s.candidates.map(c => {
      const { lot, fit } = data.get(c.lotId);
      if (!lot) return Object.freeze({ ...c, validationState: 'MISSING', availabilitySummary: null, commercialSummary: null, freshness: null });
      const r = recItem(c.lotId);
      return Object.freeze({ ...c, displayCode: lot.identity.displayCode, code: lot.identity.code, validationState: 'VALID',
        availabilitySummary: { status: lot.availability.status, freshness: lot.availability.freshness, updatedAt: lot.availability.updatedAt || null },
        commercialSummary: { price: lot.commercial.price ?? null, pricePerM2: lot.commercial.pricePerM2 ?? null, areaM2: lot.geometry.areaM2 ?? null, priceTableVersion: lot.commercial.priceTableVersion || null, freshness: (lot.metadata.freshness || {}).commercial || 'UNKNOWN' },
        freshness: worst([(lot.metadata.freshness || {}).commercial, lot.availability.freshness]),
        matchesCurrentFilters: filter ? !!(filter.matchedIds && filter.matchedIds.has && filter.matchedIds.has(c.lotId)) : null,
        recommendation: r ? { rank: r.rank ?? null, tier: r.tier || null } : null, hasFit: !!fit });
    });
    return Object.freeze({ id: 'cmps_' + h, sessionId: s.id, sessionRevision: s.revision || 0, developmentId: s.developmentId, candidateIds: s.candidateIds.slice(), candidates, metricProfileId: prof.id, metricOrder, valuesByMetric,
      dataVersions, mixedVersion: mixedKeys.length > 0, mixedVersionKeys: mixedKeys, generatedAt: nowIso(deps), freshnessSummary, completenessSummary: comp, contextRef: { mode: ctx.mode, customerProfileVersion: ctx.customerProfileVersion, scoreKey: ctx.scoreKey, hash: cHash },
      context: ctx, hash: h, status, missingCandidateIds: missing, requestToken: deps.requestToken ?? null });
  }
  /** an older response never overwrites a newer matrix (request/snapshot token) */
  const isCurrentSnapshot = (s, snap, token) => !!snap && snap.sessionId === s.id && snap.sessionRevision === (s.revision || 0) && (token == null || snap.requestToken === token);

  // ---------------------------------------------------------------- ComparisonMatrix (no winner here)
  const visibleFor = (m, audience) => audience === 'technical' ? m.technicalVisible : audience === 'client' || audience === 'presentation' ? m.clientVisible : m.brokerVisible;
  const groupVisibleFor = (g, audience) => audience === 'technical' ? true : audience === 'client' || audience === 'presentation' ? g.clientVisible : g.brokerVisible;
  const MISSING = new Set(['NO_DATA', 'UNKNOWN', 'NOT_APPLICABLE', 'ERROR']);
  function buildMatrix(s, snap, opts = {}) {
    const audience = Audience[opts.audience] ? opts.audience : 'broker', technical = audience === 'technical', prof = profile(snap.metricProfileId);
    const emph = s.context.activeLayerId ? LAYER_METRIC[s.context.activeLayerId] || null : null;
    const scoreLbl = { housing: 'Moradia', investment: 'Investimento', family: 'Família', premium: 'Premium', overall: 'Geral' }[s.context.scoreKey] || 'Moradia';
    const rows = [];
    for (const id of snap.metricOrder) {
      const m = metric(id); if (!m || !visibleFor(m, audience)) continue;
      const cells = snap.valuesByMetric[id].map(v => Object.freeze({ candidateId: v.candidateId, metricId: id, value: v.rawValue, valueStatus: v.valueStatus, freshness: v.freshness, confidence: v.confidence,
        provenanceIndicator: v.provenanceSummary ? v.provenanceSummary.status : null, comparableState: v.comparableState, uiHints: { stale: v.freshness === 'STALE' || v.freshness === 'EXPIRED', expired: v.freshness === 'EXPIRED', emphasis: emph === id } }));
      const contextMissing = cells.every(c => c.comparableState === 'CONTEXT_MISSING');
      const allMissing = cells.every(c => MISSING.has(c.valueStatus));
      const someMissing = cells.some(c => MISSING.has(c.valueStatus) || c.valueStatus === 'CONFLICTED');
      const comparability = contextMissing ? 'CONTEXT_MISSING' : !m.comparable || allMissing ? 'NOT_COMPARABLE' : someMissing || cells.some(c => c.uiHints.stale) ? 'PARTIAL' : 'COMPARABLE';
      // the objective's score already shown as "Score principal" is not repeated in INTELLIGENCE (same field, one row)
      const duplicateOf = m.groupId === 'INTELLIGENCE' && snap.metricOrder.includes('primaryScore') && m.fieldKey === 'intelligence.scores.' + s.context.scoreKey && visibleFor(metric('primaryScore'), audience) ? 'primaryScore' : null;
      const hidden = (contextMissing && !technical) || (allMissing && !m.alwaysShow && !technical) || (!!duplicateOf && !technical);
      rows.push(Object.freeze({ metricId: id, groupId: m.groupId, labelKey: m.labelKey, label: id === 'primaryScore' ? 'Score ' + scoreLbl : m.label, description: m.description, unit: m.unit, valueType: m.valueType, formatterId: m.formatterId, enumName: m.enumName, cells,
        comparability, metadata: Object.freeze({ comparisonSemantics: m.comparisonSemantics, priority: m.priority, dynamicType: m.dynamicType, dataSource: m.dataSource, fieldKey: m.fieldKeyOf ? m.fieldKeyOf(s.context) : m.fieldKey || m.metricKey,
          allMissing, partial: someMissing && !allMissing, contextMissing, duplicateOf, hiddenInNormalMode: hidden, emphasis: emph === id, customerContextRequired: m.customerContextRequired }) }));
    }
    const groupOrder = prof ? prof.groupIds : GROUPS.map(g => g.id);
    const groups = groupOrder.map(gid => GROUP_BY.get(gid)).filter(g => g && groupVisibleFor(g, audience)).map(g => {
      const rs = rows.filter(r => r.groupId === g.id), shown = rs.filter(r => !r.metadata.hiddenInNormalMode);
      return Object.freeze({ id: g.id, labelKey: g.labelKey, label: g.label, description: g.description, collapsedByDefault: g.collapsedByDefault, metricIds: shown.map(r => r.metricId), hiddenMetricIds: rs.filter(r => r.metadata.hiddenInNormalMode).map(r => r.metricId), empty: !shown.length });
    }).filter(g => technical || !g.empty);
    const candidateColumns = snap.candidates.map(c => Object.freeze({ candidateId: c.lotId, displayCode: c.displayCode, code: c.code || null, order: c.order, status: c.availabilitySummary ? c.availabilitySummary.status : null, validationState: c.validationState,
      summary: Object.freeze({ availability: c.availabilitySummary, commercial: c.commercialSummary, freshness: c.freshness, matchesCurrentFilters: c.matchesCurrentFilters, recommendation: c.recommendation }) }));
    return Object.freeze({ candidateColumns, groups, rows: rows.filter(r => groups.some(g => g.id === r.groupId)), status: snap.status,
      metadata: Object.freeze({ sessionId: s.id, snapshotId: snap.id, snapshotHash: snap.hash, metricProfileId: snap.metricProfileId, audience, generatedAt: snap.generatedAt, dataVersions: snap.dataVersions, mixedVersion: snap.mixedVersion,
        mixedVersionKeys: snap.mixedVersionKeys, completeness: snap.completenessSummary, freshness: snap.freshnessSummary, contextMode: s.context.mode, hasCustomer: hasCustomer(s.context), activeLayerMetricId: emph }) });
  }

  // ---------------------------------------------------------------- ComparisonDelta (preparation for topic 25: numeric, no "better")
  const NUMERIC = new Set(['MONEY', 'NUMBER', 'AREA', 'DISTANCE', 'SCORE', 'PERCENTAGE']);
  function deltas(snap, metricId) {
    const m = metric(metricId), vs = snap.valuesByMetric[metricId]; if (!m || !vs || !NUMERIC.has(m.valueType)) return [];
    const out = [];
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j], ok = a.valueStatus === 'VALID' && b.valueStatus === 'VALID' && typeof a.rawValue === 'number' && typeof b.rawValue === 'number';
      out.push(Object.freeze({ metricId, candidateA: a.candidateId, candidateB: b.candidateId, rawDelta: ok ? b.rawValue - a.rawValue : null, relativeDelta: ok && a.rawValue !== 0 ? (b.rawValue - a.rawValue) / Math.abs(a.rawValue) : null, comparable: ok }));
    }
    return out;
  }

  // ---------------------------------------------------------------- ComparisonSummary (tray/bar)
  function summary(s, snap = null) {
    const policy = policyOf(s.developmentId), n = s.candidates.length;
    const warnings = [];
    if (snap && snap.status === 'STALE') warnings.push({ code: 'STALE', message: 'Há dados comerciais que podem estar desatualizados.' });
    if (snap && snap.completenessSummary.partialMetricIds.length) warnings.push({ code: 'PARTIAL', message: MESSAGES.PARTIAL });
    if (snap && snap.missingCandidateIds.length) warnings.push({ code: 'INVALID', message: 'Um lote da comparação não foi encontrado nos dados atuais.' });
    return Object.freeze({ count: n, max: policy.maxCandidates, candidateSummaries: s.candidates.map(c => ({ lotId: c.lotId, displayCode: c.displayCode, order: c.order })),
      canCompare: n >= policy.minCandidates, canAdd: n < policy.maxCandidates, limitReached: n >= policy.maxCandidates,
      message: n === 0 ? MESSAGES.EMPTY : n < policy.minCandidates ? MESSAGES.ADD_ONE_MORE : n >= policy.maxCandidates ? MESSAGES.COMPARISON_LIMIT_REACHED(policy.maxCandidates) : 'Comparar',
      warnings, freshness: snap ? snap.freshnessSummary : null });
  }

  // ---------------------------------------------------------------- ComparisonStore + selectors + ComparisonService
  /** ComparisonStore: semantic session state, kept apart from ComparisonUiState */
  function createStore(session) {
    let st = { session, snapshot: null, matrix: null, token: 0, ui: { expandedGroupIds: [], scrollPosition: 0, focusedCandidateId: null, focusedMetricId: null, layoutVariant: null } }, subs = [];
    return { get: () => st, set(patch) { st = { ...st, ...patch }; subs.forEach(f => { try { f(st); } catch (e) { /* subscriber error */ } }); }, setUi(patch) { this.set({ ui: { ...st.ui, ...patch } }); },
      subscribe(fn) { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; } };
  }
  const selectors = Object.freeze({
    selectComparisonSession: st => st.session,
    selectComparisonCandidates: st => st.session.candidates,
    selectComparisonSnapshot: st => st.snapshot && isCurrentSnapshot(st.session, st.snapshot) ? st.snapshot : null,
    selectComparisonMatrix: st => st.matrix && st.snapshot && isCurrentSnapshot(st.session, st.snapshot) ? st.matrix : null,
    selectComparisonSummary: st => summary(st.session, st.snapshot),
    selectComparisonWarnings: st => summary(st.session, st.snapshot).warnings,
    selectComparisonCanAddLot: (st, lotId) => st.session.candidateIds.includes(lotId) || st.session.candidates.length < policyOf(st.session.developmentId).maxCandidates,
    selectComparisonCandidateState: (st, lotId) => { const i = st.session.candidateIds.indexOf(lotId); return i < 0 ? { inComparison: false, index: null, total: st.session.candidates.length } : { inComparison: true, index: i + 1, total: st.session.candidates.length }; }
  });
  /** ComparisonService: the operations of spec 24 §12 over a ComparisonStore. Emits analytics events without PII. */
  function createService({ developmentId, resolve, policy, store, track } = {}) {
    const pol = policy || policyOf(developmentId), st = store || createStore(createSession(developmentId, { policy: pol }));
    const emit = (evt, data) => { try { (track || (App.analytics && App.analytics.track) || (() => {}))(evt, { ...data, developmentId }); } catch (e) { /* analytics never breaks the session */ } };
    const apply = (r, evt, data) => { if (r.ok && r.session !== st.get().session) { st.set({ session: r.session, snapshot: null, matrix: null }); if (evt) emit(evt, { count: r.session.candidates.length, ...data }); } return r; };
    return {
      store: st,
      createSession(ctx) { st.set({ session: createSession(developmentId, { policy: pol, context: ctx }), snapshot: null, matrix: null }); emit('comparison_started', {}); return st.get().session; },
      addCandidate: (lotId, source) => apply(addCandidate(st.get().session, lotId, { resolve, source, policy: pol }), 'comparison_candidate_added', { lotId, source: source || 'MAP' }),
      removeCandidate: lotId => apply(removeCandidate(st.get().session, lotId, { policy: pol }), 'comparison_candidate_removed', { lotId }),
      reorderCandidates: order => apply(reorderCandidates(st.get().session, order, { policy: pol })),
      moveCandidate: (lotId, d) => apply(moveCandidate(st.get().session, lotId, d, { policy: pol })),
      replaceCandidate: (a, b) => apply(replaceCandidate(st.get().session, a, b, { resolve, policy: pol })),
      clear: () => apply(clear(st.get().session, { policy: pol }), 'comparison_cleared'),
      setContext: ctx => apply(setContext(st.get().session, ctx, { policy: pol })),
      setMetricProfile: id => apply(setMetricProfile(st.get().session, id, { policy: pol }), 'comparison_profile_changed', { metricProfileId: id }),
      /** beginRequest → token; commit(token, deps) builds and stores the snapshot only if no newer request started */
      beginRequest() { const token = st.get().token + 1; st.set({ token }); return token; },
      buildSnapshot(deps = {}, token = null) {
        const s = st.get().session, snap = buildSnapshot(s, { resolve, ...deps, requestToken: token });
        if (token != null && token !== st.get().token) return { ok: false, code: 'STALE_RESPONSE', snapshot: snap };
        if (!isCurrentSnapshot(st.get().session, snap)) return { ok: false, code: 'STALE_RESPONSE', snapshot: snap };
        st.set({ snapshot: snap, matrix: null }); return { ok: true, snapshot: snap };
      },
      buildMatrix(opts = {}) { const { session, snapshot } = st.get(); if (!snapshot) return null; const m = buildMatrix(session, snapshot, opts); st.set({ matrix: m }); emit('comparison_opened', { count: session.candidates.length, metricProfileId: session.metricProfileId }); return m; },
      restore(raw, opts = {}) { const r = restore(raw, { developmentId, resolve, policy: pol, ...opts }); st.set({ session: r.session, snapshot: null, matrix: null }); return r; },
      serialize: () => serialize(st.get().session),
      share(opts) { emit('comparison_shared', { count: st.get().session.candidates.length }); return sharePayload(st.get().session, { ...opts, snapshot: st.get().snapshot }); }
    };
  }

  return Object.freeze({
    SessionStatus, AddedFrom, CandidateValidation, ContextMode, ValueType, DataSource, DynamicType, Semantics, NullPolicy, StalePolicy, ValueStatus, ComparableState, LoadingState, Audience, Errors, MESSAGES, SCHEMA_VERSION,
    DEFAULT_POLICY, policyOf, METRICS, metric, GROUPS, group: id => GROUP_BY.get(id) || null, PROFILES, profile, LAYER_METRIC, MIGRATIONS,
    normalizeContext, hasCustomer, contextHash, hash, stable,
    createSession, validateCandidate, addCandidate, removeCandidate, reorderCandidates, moveCandidate, replaceCandidate, clear, setContext, setMetricProfile, syncFromIds, statusOf,
    serialize, migrate, restore, deepLinkToken, parseDeepLink, sharePayload,
    value, provideValues, buildSnapshot, isCurrentSnapshot, buildMatrix, deltas, summary, createStore, selectors, createService, visibleFor
  });
})();
