/* Viva Juara — chunk "comparison" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- configs (comparison) ---- */
Object.assign(App.configs, {"compare":{"viva-juara":{"kind":"ComparisonEvaluationPolicyRegistry","schemaVersion":"1.0","developmentId":"viva-juara","evaluationPolicyVersion":"1.0.0","changeReason":"Tópico 25: primeira versão. Semântica conservadora: só critérios com direção formal na metodologia vigente (preço de tabela, scores 0–100, notas de silêncio/privacidade, classe A+–D e Fit com cliente) têm destaque sem contexto. Distâncias, área, sol, trânsito, esquina e área verde dependem do perfil do cliente.","comparisonPolicy":{"minCandidates":2,"maxCandidates":4,"requireSameDevelopment":true,"allowSold":true,"allowUnavailable":true,"allowUnknownAvailability":true,"allowStaleCommercial":true,"preserveCandidateOnStatusChange":true,"defaultMetricProfileId":"BROKER_STANDARD","version":"1.0.0"},"tiePolicies":{"exact":{"type":"EXACT","version":"1.0.0"},"money":{"type":"ABSOLUTE_TOLERANCE","absoluteTolerance":0.01,"version":"1.0.0"},"score100":{"type":"ABSOLUTE_TOLERANCE","absoluteTolerance":1,"version":"1.0.0"},"note10":{"type":"ABSOLUTE_TOLERANCE","absoluteTolerance":0.1,"version":"1.0.0"},"area":{"type":"RELATIVE_TOLERANCE","relativeTolerancePct":1,"version":"1.0.0"},"distance":{"type":"ABSOLUTE_OR_RELATIVE","absoluteTolerance":10,"relativeTolerancePct":3,"version":"1.0.0"},"ordinal":{"type":"EXACT","enumEqualityRequired":true,"version":"1.0.0"},"target":{"type":"TARGET_DISTANCE","targetDistanceTolerance":1,"version":"1.0.0"}},"marginPolicies":{"money":{"minimumRelativeDifferencePct":2,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"},"score100":{"minimumAbsoluteDifference":3,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"},"note10":{"minimumAbsoluteDifference":0.5,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"},"area":{"minimumRelativeDifferencePct":5,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"},"distance":{"minimumAbsoluteDifference":50,"minimumRelativeDifferencePct":10,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"},"ordinal":{"minimumOrdinalStep":1,"resultBelowThreshold":"TIE","version":"1.0.0"},"target":{"targetDistanceDifference":10,"resultBelowThreshold":"NO_CLEAR_WINNER","version":"1.0.0"}},"dataSufficiencyPolicies":{"default":{"minValidCandidates":2,"requireAllCandidates":false,"requireAllCandidatesFor":["client","presentation"],"allowUnknown":false,"allowStale":true,"allowEstimated":true,"allowConflicted":false,"requireSameVersion":true,"version":"1.0.0"},"strict":{"minValidCandidates":2,"requireAllCandidates":true,"allowUnknown":false,"allowStale":false,"allowEstimated":true,"allowConflicted":false,"requireSameVersion":true,"version":"1.0.0"}},"stalePolicies":{"commercial":{"broker":"ALLOW_WITH_WARNING","technical":"ALLOW_WITH_WARNING","client":"SUPPRESS_WINNER","presentation":"SUPPRESS_WINNER","expired":"SUPPRESS_WINNER","version":"1.0.0"},"availability":{"broker":"SUPPRESS_WINNER","technical":"SUPPRESS_WINNER","client":"SUPPRESS_WINNER","presentation":"SUPPRESS_WINNER","expired":"SUPPRESS_WINNER","version":"1.0.0"},"none":{"broker":"ALLOW_WITH_WARNING","technical":"ALLOW_WITH_WARNING","client":"ALLOW_WITH_WARNING","presentation":"ALLOW_WITH_WARNING","expired":"ALLOW_WITH_WARNING","version":"1.0.0"}},"conflictPolicies":{"default":{"type":"SUPPRESS_METRIC","version":"1.0.0"}},"confidencePolicies":{"default":{"minimum":{"client":"MEDIUM","presentation":"MEDIUM","broker":"LOW","technical":"LOW"},"version":"1.0.0"},"estimated":{"minimum":{"client":"MEDIUM","presentation":"HIGH","broker":"LOW","technical":"LOW"},"version":"1.0.0"}},"criteria":{"price":{"winnerSemantics":"LOWER_IS_PREFERRED","tiePolicyId":"money","marginPolicyId":"money","dataSufficiencyPolicyId":"default","stalePolicyId":"commercial","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"LOWEST_VALUE","phrase":"o menor preço de tabela","caveats":["PRICE_TABLE_ONLY"],"dedupGroup":"price","highlight":true},"pricePerM2":{"winnerSemantics":"LOWER_IS_PREFERRED","tiePolicyId":"money","marginPolicyId":"money","dataSufficiencyPolicyId":"default","stalePolicyId":"commercial","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"LOWEST_VALUE","phrase":"o menor preço de tabela por m²","caveats":["PRICE_TABLE_ONLY"],"dedupGroup":"price","highlight":true},"status":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"availability","tiePolicyId":"ordinal","marginPolicyId":"ordinal","dataSufficiencyPolicyId":"default","stalePolicyId":"availability","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"BOOLEAN_PREFERRED_VALUE","phrase":"situação disponível para negociação","caveats":[],"highlight":false},"area":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"area","tiePolicyId":"area","marginPolicyId":"area","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"a maior área","phraseTarget":"a área mais próxima da faixa desejada","caveats":["PROFILE_DEPENDENT"],"highlight":true},"lotClass":{"winnerSemantics":"ORDERED_ENUM","orderMap":{"A_PLUS":5,"A":4,"B":3,"C":2,"D":1},"tiePolicyId":"ordinal","marginPolicyId":"ordinal","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_ORDERED_CATEGORY","phrase":"a classe mais alta","caveats":["RELATIVE_CLASS"],"dedupGroup":"analysis","highlight":true},"primaryScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"o {label} mais alto","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,100]},"housingScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"o Score Moradia mais alto","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,100]},"investmentScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"o Score Investimento mais alto","caveats":["ANALYSIS_ESTIMATE","NO_APPRECIATION_PROMISE"],"highlight":true,"validRange":[0,100]},"familyScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"o Score Família mais alto","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,100]},"premiumScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"o Score Premium mais alto","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,100]},"fitScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","customerContextRequired":true,"tiePolicyId":"score100","marginPolicyId":"score100","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"HIGHEST_VALUE","phrase":"a maior compatibilidade com o perfil informado","caveats":["PROFILE_DEPENDENT","NOT_PURCHASE_PROBABILITY"],"highlight":true,"validRange":[0,100]},"quietScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"note10","marginPolicyId":"note10","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"estimated","explanationTemplateId":"HIGHEST_VALUE","phrase":"a maior nota de silêncio","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,10]},"privacyScore":{"winnerSemantics":"HIGHER_IS_PREFERRED","tiePolicyId":"note10","marginPolicyId":"note10","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"estimated","explanationTemplateId":"HIGHEST_VALUE","phrase":"a maior nota de privacidade","caveats":["ANALYSIS_ESTIMATE"],"highlight":true,"validRange":[0,10]},"solarScore":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"solar","tiePolicyId":"note10","marginPolicyId":"note10","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"estimated","explanationTemplateId":"CONTEXTUAL","phrase":"a maior nota de orientação solar","caveats":["ANALYSIS_ESTIMATE","PROFILE_DEPENDENT"],"highlight":true,"validRange":[0,10]},"traffic":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"traffic","tiePolicyId":"ordinal","marginPolicyId":"ordinal","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"estimated","explanationTemplateId":"CONTEXTUAL","phrase":"o menor trânsito estimado","caveats":["ANALYSIS_ESTIMATE","PROFILE_DEPENDENT"],"highlight":true},"distanceToGate":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"gate","tiePolicyId":"distance","marginPolicyId":"distance","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"o menor percurso até a portaria","caveats":["PROFILE_DEPENDENT"],"highlight":true},"distanceToLeisure":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"leisure","tiePolicyId":"distance","marginPolicyId":"distance","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"o menor percurso até o clube","caveats":["PROFILE_DEPENDENT"],"highlight":true},"distanceToAvenue":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"avenue","tiePolicyId":"distance","marginPolicyId":"distance","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"a maior distância da Av. Porto Dourado","caveats":["PROFILE_DEPENDENT"],"highlight":true},"distanceToGreen":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"none","tiePolicyId":"distance","marginPolicyId":"distance","dataSufficiencyPolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"o parque florestal mais perto","caveats":["PROFILE_DEPENDENT"],"highlight":false},"greenRear":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"green","tiePolicyId":"ordinal","marginPolicyId":"ordinal","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"BOOLEAN_PREFERRED_VALUE","phrase":"mata ou parque nos fundos","caveats":["PROFILE_DEPENDENT"],"highlight":true},"isCorner":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"corner","tiePolicyId":"ordinal","marginPolicyId":"ordinal","dataSufficiencyPolicyId":"default","stalePolicyId":"none","conflictPolicyId":"default","confidencePolicyId":"default","explanationTemplateId":"BOOLEAN_PREFERRED_VALUE","phrase":"lote fora de esquina","caveats":["PROFILE_DEPENDENT"],"highlight":false},"front":{"winnerSemantics":"CONTEXTUAL_PREFERENCE","contextualResolverId":"none","tiePolicyId":"distance","marginPolicyId":"distance","dataSufficiencyPolicyId":"default","explanationTemplateId":"CONTEXTUAL","phrase":"a maior frente","caveats":["PROFILE_DEPENDENT"],"highlight":false},"downPayment":{"winnerSemantics":"NO_WINNER","note":"Entrada/parcela/fluxo dependem do serviço financeiro canônico (tópico 26, não entregue)."},"alertsCount":{"winnerSemantics":"INFORMATIONAL","note":"Alertas não viram vantagem (spec 25 §253)."},"noiseLevel":{"winnerSemantics":"INFORMATIONAL","note":"A comparação acústica usa a Nota de silêncio; o nível é exibido sem destaque para não contar o mesmo critério duas vezes."},"privacyLevel":{"winnerSemantics":"INFORMATIONAL","note":"A comparação usa a Nota de privacidade."},"rear":{"winnerSemantics":"INFORMATIONAL"},"depth":{"winnerSemantics":"INFORMATIONAL"},"shape":{"winnerSemantics":"NON_ORDERED"},"blockPosition":{"winnerSemantics":"NON_ORDERED"},"rearNeighbor":{"winnerSemantics":"NON_ORDERED"},"streetHierarchy":{"winnerSemantics":"NON_ORDERED"},"orientationFront":{"winnerSemantics":"NON_ORDERED"},"northSun":{"winnerSemantics":"NON_ORDERED"},"viewDetail":{"winnerSemantics":"NON_ORDERED"},"sewageStationNearby":{"winnerSemantics":"INFORMATIONAL"},"topography":{"winnerSemantics":"INFORMATIONAL"},"slope":{"winnerSemantics":"INFORMATIONAL"},"constructivePotential":{"winnerSemantics":"INFORMATIONAL"},"easements":{"winnerSemantics":"INFORMATIONAL"},"priceTableVersion":{"winnerSemantics":"INFORMATIONAL"},"analysisVersion":{"winnerSemantics":"INFORMATIONAL"},"fitCoverage":{"winnerSemantics":"INFORMATIONAL"},"fitConfidence":{"winnerSemantics":"INFORMATIONAL"},"availabilityFreshness":{"winnerSemantics":"INFORMATIONAL"},"commercialFreshness":{"winnerSemantics":"INFORMATIONAL"},"analysisConfidence":{"winnerSemantics":"INFORMATIONAL"},"conflictsCount":{"winnerSemantics":"INFORMATIONAL"}},"contextualResolvers":{"none":{"rules":[]},"area":{"rules":[{"preferenceKey":"areaRange","winnerSemantics":"TARGET_RANGE_PREFERRED","targetFrom":"preferenceRange","tiePolicyId":"target","marginPolicyId":"target","rationaleCode":"CUSTOMER_AREA_RANGE"},{"preferenceKey":"area","winnerSemantics":"HIGHER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_LARGER_AREA"}]},"availability":{"rules":[{"contextModes":["CUSTOMER","RECOMMENDATION"],"winnerSemantics":"BOOLEAN_TRUE_PREFERRED","valueMap":"offerable","rationaleCode":"COMMERCIAL_OFFERABLE"}]},"solar":{"rules":[{"preferenceKey":"solar","winnerSemantics":"HIGHER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_SOLAR"},{"evaluationProfileId":"HOUSING","winnerSemantics":"HIGHER_IS_PREFERRED","rationaleCode":"HOUSING_PROFILE_SOLAR"}]},"traffic":{"rules":[{"preferenceKey":"lowTraffic","winnerSemantics":"ORDERED_ENUM","orderMap":{"VERY_LOW":5,"LOW":4,"MEDIUM":3,"HIGH":2,"VERY_HIGH":1},"rationaleCode":"CUSTOMER_PREFERS_LOW_TRAFFIC"},{"evaluationProfileId":"HOUSING","winnerSemantics":"ORDERED_ENUM","orderMap":{"VERY_LOW":5,"LOW":4,"MEDIUM":3,"HIGH":2,"VERY_HIGH":1},"rationaleCode":"HOUSING_PROFILE_LOW_TRAFFIC"}]},"gate":{"rules":[{"preferenceKey":"nearGate","winnerSemantics":"LOWER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_NEAR_GATE"},{"preferenceKey":"gate","winnerSemantics":"LOWER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_NEAR_GATE"}]},"leisure":{"rules":[{"preferenceKey":"leisure","winnerSemantics":"LOWER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_NEAR_LEISURE"}]},"avenue":{"rules":[{"preferenceKey":"awayFromAvenue","winnerSemantics":"HIGHER_IS_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_AWAY_FROM_AVENUE"}]},"green":{"rules":[{"preferenceKey":"green","winnerSemantics":"BOOLEAN_TRUE_PREFERRED","rationaleCode":"CUSTOMER_PREFERS_GREEN_REAR"}]},"corner":{"rules":[{"preferenceKey":"noCorner","winnerSemantics":"BOOLEAN_FALSE_PREFERRED","rationaleCode":"CUSTOMER_AVOIDS_CORNER"}]}},"evaluationProfiles":{"QUICK":{"mode":"broker","metricPolicyOverrides":{},"version":"1.0.0"},"BROKER_STANDARD":{"mode":"broker","metricPolicyOverrides":{},"version":"1.0.0"},"CUSTOMER":{"mode":"client","customerContextRequired":false,"metricPolicyOverrides":{},"version":"1.0.0"},"TECHNICAL":{"mode":"technical","metricPolicyOverrides":{},"version":"1.0.0"},"INVESTMENT":{"mode":"broker","metricPolicyOverrides":{},"version":"1.0.0"},"HOUSING":{"mode":"broker","metricPolicyOverrides":{},"version":"1.0.0"}},"dependencies":{"price":["priceTableVersion"],"pricePerM2":["priceTableVersion"],"downPayment":["priceTableVersion"],"status":["availabilityRevision"],"lotClass":["analysisVersion"],"primaryScore":["analysisVersion"],"housingScore":["analysisVersion"],"investmentScore":["analysisVersion"],"familyScore":["analysisVersion"],"premiumScore":["analysisVersion"],"quietScore":["analysisVersion"],"privacyScore":["analysisVersion"],"solarScore":["analysisVersion"],"traffic":["analysisVersion"],"fitScore":["customerProfileVersion","fitMethodologyVersion"],"area":["staticDataVersion","customerProfileVersion"],"distanceToGate":["staticDataVersion","customerProfileVersion"]},"highlights":{"max":{"broker":5,"technical":5,"client":3,"presentation":3}}}}});
/* ---- compare/comparisonDomain.js ---- */
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

/* ---- compare/criterionWinner.js ---- */
/* compare/criterionWinner.js — topic 25: winner per criterion, as a separate evaluation over the topic-24 snapshot.
   App.compare.evaluation: WinnerSemantics · CriterionEvaluationDefinition · TiePolicy · MarginPolicy · DataSufficiencyPolicy ·
     Stale/Conflict/Confidence policies · ComparisonEvaluationPolicyRegistry (config/compare/<dev>.json) · ContextualPreferenceResolver ·
     CriterionEvaluationProfiles · dependency registry · ComparisonEvaluationService (evaluate) → CriterionEvaluationResult with
     CandidateCriterionAssessment, PairwiseDelta, WinnerExplanation → ComparisonEvaluationSnapshot · ComparativeHighlightSelector.
   App.compare.viewModel: ComparisonViewModel / EvaluatedComparisonViewModel (text in pt-BR is produced here, never in the domain).

   Golden rules: no winner without registered semantics, enough valid values, compatible units/versions, a valid policy and a
   material difference. No generic max/min. Ties are never broken by lot id or at random. Raw precision (money in cents) is
   compared, never the rounded display. A single valid value never wins. Conflicted data never wins. Unknown is never 0.
   There is no overall best lot and the count of wins is never a ranking. Policy errors fail closed (no highlight). */
App.compare = App.compare || {};
App.compare.evaluation = (() => {
  const D = App.compare.domain;
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const WinnerSemantics = E('HIGHER_IS_PREFERRED', 'LOWER_IS_PREFERRED', 'ORDERED_ENUM', 'BOOLEAN_TRUE_PREFERRED', 'BOOLEAN_FALSE_PREFERRED', 'TARGET_RANGE_PREFERRED', 'TARGET_VALUE_PREFERRED', 'CONTEXTUAL_PREFERENCE', 'NON_ORDERED', 'INFORMATIONAL', 'NO_WINNER');
  const EvaluationStatus = E('WINNER', 'TIE', 'NO_CLEAR_WINNER', 'NOT_COMPARABLE', 'INSUFFICIENT_DATA', 'CONTEXT_REQUIRED', 'SUPPRESSED', 'ERROR');
  const AssessmentState = E('BEST', 'CO_BEST', 'CLOSE', 'NEUTRAL', 'WEAKER', 'NO_DATA', 'UNKNOWN', 'CONFLICTED', 'STALE_REVIEW', 'NOT_APPLICABLE');
  const TieType = E('EXACT', 'ABSOLUTE_TOLERANCE', 'RELATIVE_TOLERANCE', 'ABSOLUTE_OR_RELATIVE', 'TARGET_DISTANCE', 'CUSTOM');
  const BelowThreshold = E('TIE', 'NO_CLEAR_WINNER', 'SUPPRESS_HIGHLIGHT');
  const EvaluationStalePolicy = E('ALLOW_WITH_WARNING', 'SUPPRESS_WINNER', 'EXCLUDE_STALE_CANDIDATE', 'REQUIRE_REFRESH');
  const EvaluationConflictPolicy = E('SUPPRESS_METRIC', 'EXCLUDE_CONFLICTED', 'ALLOW_WITH_WARNING');
  const EvaluationConfidence = E('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');
  const SuppressionReason = E('INSUFFICIENT_VALID_VALUES', 'MISSING_CONTEXT', 'STALE_DATA', 'CONFLICTED_DATA', 'LOW_CONFIDENCE', 'NON_ORDERED_METRIC', 'NO_MATERIAL_DIFFERENCE', 'VERSION_MISMATCH', 'POLICY_DISABLED', 'NOT_APPLICABLE', 'UNKNOWN_SEMANTICS', 'PARTIAL_DATA', 'INVALID_VALUE');
  const ComparativeAdvantage = E('CLEAR', 'SLIGHT', 'NONE', 'TIED', 'UNKNOWN');
  const CellState = E('WINNER', 'CO_WINNER', 'CLOSE', 'NORMAL', 'WEAKER', 'NO_DATA', 'STALE', 'CONFLICTED', 'SUPPRESSED');
  const ReasonCode = E('LOWEST_VALUE', 'HIGHEST_VALUE', 'CLOSE_TO_TARGET', 'WITHIN_TARGET_RANGE', 'HIGHEST_ORDERED_CATEGORY', 'PREFERRED_BOOLEAN_VALUE', 'ONLY_VALID_CANDIDATE_SUPPRESSED', 'TIED_TOP_VALUE', 'ALL_TIED',
    'NO_MATERIAL_DIFFERENCE', 'STALE_SUPPRESSION', 'CONFLICT_SUPPRESSION', 'LOW_CONFIDENCE_SUPPRESSION', 'PARTIAL_DATA_SUPPRESSION', 'INSUFFICIENT_DATA', 'CONTEXT_REQUIRED', 'NOT_ORDERED', 'INFORMATIONAL_ONLY', 'VERSION_MISMATCH', 'EVALUATION_ERROR');
  const ErrorType = E('INVALID_METRIC_POLICY', 'MISSING_ORDER_MAP', 'MISSING_CONTEXT', 'INSUFFICIENT_DATA', 'UNIT_MISMATCH', 'INVALID_VALUE', 'VERSION_MISMATCH', 'EVALUATION_ERROR');
  const CONF_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  /** precision policy (centralized): values are compared raw; money in integer cents; float comparisons with EPS */
  const PRECISION = Object.freeze({ EPS: 1e-9, MONEY_FACTOR: 100 });
  const ORDERED = new Set(['HIGHER_IS_PREFERRED', 'LOWER_IS_PREFERRED', 'ORDERED_ENUM', 'BOOLEAN_TRUE_PREFERRED', 'BOOLEAN_FALSE_PREFERRED', 'TARGET_RANGE_PREFERRED', 'TARGET_VALUE_PREFERRED']);
  const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const AUDIENCES = new Set(['client', 'presentation', 'broker', 'technical']);

  // ---------------------------------------------------------------- ComparisonEvaluationPolicyRegistry
  const EMPTY_REG = Object.freeze({ evaluationPolicyVersion: null, criteria: {}, tiePolicies: {}, marginPolicies: {}, dataSufficiencyPolicies: {}, stalePolicies: {}, conflictPolicies: {}, confidencePolicies: {}, contextualResolvers: {}, evaluationProfiles: {}, dependencies: {}, highlights: { max: {} } });
  const regCache = new Map();
  /** registry(devId, override?) → validated registry; invalid criteria are kept with `invalid` so they fail closed */
  function registry(devId, override) {
    if (!override && regCache.has(devId)) return regCache.get(devId);
    const raw = override || (App.configs && App.configs.compare && App.configs.compare[devId]) || EMPTY_REG, reg = { ...EMPTY_REG, ...raw, errors: [] };
    const criteria = {};
    for (const [id, c] of Object.entries(raw.criteria || {})) {
      const errs = [];
      if (!WinnerSemantics[c.winnerSemantics]) errs.push('UNKNOWN_SEMANTICS');
      if (ORDERED.has(c.winnerSemantics) || c.winnerSemantics === 'CONTEXTUAL_PREFERENCE') {
        for (const [k, coll] of [['tiePolicyId', 'tiePolicies'], ['marginPolicyId', 'marginPolicies'], ['dataSufficiencyPolicyId', 'dataSufficiencyPolicies']]) if (!c[k] || !(reg[coll] || {})[c[k]]) errs.push('MISSING_' + k);
        if (c.winnerSemantics === 'ORDERED_ENUM' && !c.orderMap) errs.push('MISSING_ORDER_MAP');
        if (c.winnerSemantics === 'CONTEXTUAL_PREFERENCE' && !(reg.contextualResolvers || {})[c.contextualResolverId]) errs.push('MISSING_RESOLVER');
      }
      criteria[id] = Object.freeze({ ...c, invalid: errs.length ? errs : null });
      if (errs.length) reg.errors.push({ metricId: id, errors: errs });
    }
    reg.criteria = criteria;
    const out = Object.freeze(reg);
    if (!override) regCache.set(devId, out);
    return out;
  }
  /** CriterionEvaluationDefinition: the metric's policy, with the evaluation profile's overrides (no field key duplicated) */
  function definitionOf(metricId, reg, evaluationProfileId) {
    const base = reg.criteria[metricId]; if (!base) return null;
    const ov = (((reg.evaluationProfiles || {})[evaluationProfileId] || {}).metricPolicyOverrides || {})[metricId] || {};
    const c = { ...base, ...ov };
    return Object.freeze({ metricId, winnerSemantics: c.winnerSemantics, direction: c.winnerSemantics === 'LOWER_IS_PREFERRED' ? 'LOWER' : c.winnerSemantics === 'HIGHER_IS_PREFERRED' ? 'HIGHER' : null, orderMap: c.orderMap || null,
      targetRange: c.targetRange || null, targetValue: c.targetValue ?? null, contextualResolverId: c.contextualResolverId || null, marginPolicyId: c.marginPolicyId || null, tiePolicyId: c.tiePolicyId || null,
      dataSufficiencyPolicyId: c.dataSufficiencyPolicyId || null, confidencePolicyId: c.confidencePolicyId || 'default', stalePolicyId: c.stalePolicyId || 'none', conflictPolicyId: c.conflictPolicyId || 'default',
      clientModeBehavior: 'CLEAR_ONLY', brokerModeBehavior: 'SHOW_SLIGHT_WITH_CAVEAT', technicalModeBehavior: 'SHOW_POLICY_DETAILS', explanationTemplateId: c.explanationTemplateId || null,
      customerContextRequired: !!c.customerContextRequired, phrase: c.phrase || null, phraseTarget: c.phraseTarget || null, caveats: c.caveats || [], dedupGroup: c.dedupGroup || null, highlight: c.highlight !== false,
      validRange: c.validRange || null, invalid: base.invalid, note: c.note || null, version: reg.evaluationPolicyVersion });
  }

  // ---------------------------------------------------------------- ContextualPreferenceResolver (no silent default)
  /** resolvePreference(def, ctx) → ResolvedCriterionPreference | null. ctx = { contextMode, customerProfile, evaluationProfileId, reg }.
      Uses only the customer's explicit preferences (never hard constraints, never the customer's identity). */
  function resolvePreference(def, ctx) {
    const resolver = (ctx.reg.contextualResolvers || {})[def.contextualResolverId]; if (!resolver) return null;
    const prefs = ((ctx.customerProfile && ctx.customerProfile.preferences) || []).filter(p => p && p.enabled !== false);
    for (const r of resolver.rules || []) {
      let target = null, source = null;
      if (r.preferenceKey) { const p = prefs.find(x => x.key === r.preferenceKey); if (!p) continue; source = 'CUSTOMER_PREFERENCE'; if (r.targetFrom === 'preferenceRange') { const t = p.target || {}; if (!Number.isFinite(t.min) && !Number.isFinite(t.max)) continue; target = { min: Number.isFinite(t.min) ? t.min : null, max: Number.isFinite(t.max) ? t.max : null }; } }
      if (r.contextModes) { if (!r.contextModes.includes(ctx.contextMode)) continue; source = source || 'COMPARISON_CONTEXT'; }
      if (r.evaluationProfileId) { if (r.evaluationProfileId !== ctx.evaluationProfileId) continue; source = source || 'EVALUATION_PROFILE'; }
      if (!source) continue; // a rule without a condition would be a silent default
      return Object.freeze({ winnerSemantics: r.winnerSemantics, targetRange: r.winnerSemantics === 'TARGET_RANGE_PREFERRED' ? target : null, targetValue: r.targetValue ?? null, orderMap: r.orderMap || null, valueMap: r.valueMap || null, tiePolicyId: r.tiePolicyId || null, marginPolicyId: r.marginPolicyId || null,
        rationaleCode: r.rationaleCode || null, source, version: ctx.reg.evaluationPolicyVersion });
    }
    return null;
  }

  // ---------------------------------------------------------------- per-criterion evaluation
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  function validValue(m, def, v) {
    if (['MONEY', 'AREA', 'DISTANCE', 'SCORE', 'PERCENTAGE', 'NUMBER'].includes(m.valueType) && !isNum(v)) return false;
    if (m.valueType === 'MONEY' && v < 0) return false;
    if (m.valueType === 'AREA' && v <= 0) return false;
    if (m.valueType === 'DISTANCE' && v < 0) return false;
    if (def.validRange && (v < def.validRange[0] || v > def.validRange[1])) return false;
    return true;
  }
  /** x: the value in "difference space" (raw, money in cents); g: goodness (higher = preferred for this criterion) */
  function keyOf(m, sem, rp, def, v, ctx) {
    const money = m.valueType === 'MONEY', num = x => money ? Math.round(x * PRECISION.MONEY_FACTOR) : x;
    switch (sem) {
      case 'HIGHER_IS_PREFERRED': return validValue(m, def, v) ? { x: num(v), g: num(v) } : null;
      case 'LOWER_IS_PREFERRED': return validValue(m, def, v) ? { x: num(v), g: -num(v) } : null;
      case 'ORDERED_ENUM': { const om = (rp && rp.orderMap) || def.orderMap, o = om ? om[v] : undefined; return isNum(o) ? { x: o, g: o, ordinal: o } : null; }
      case 'BOOLEAN_TRUE_PREFERRED': case 'BOOLEAN_FALSE_PREFERRED': {
        let b;
        if (rp && rp.valueMap === 'offerable') b = App.availability.isOfferable(v, ctx.availabilityPolicy); // UNKNOWN never reaches here (it is an UNKNOWN value)
        else if (typeof v === 'boolean') b = v; else return null;
        const pref = sem === 'BOOLEAN_TRUE_PREFERRED' ? b : !b; return { x: pref ? 1 : 0, g: pref ? 1 : 0 };
      }
      case 'TARGET_RANGE_PREFERRED': {
        const t = (rp && rp.targetRange) || def.targetRange; if (!t || !validValue(m, def, v)) return null;
        const d = t.min != null && v < t.min ? t.min - v : t.max != null && v > t.max ? v - t.max : 0; return { x: d, g: -d, distanceToTarget: d };
      }
      case 'TARGET_VALUE_PREFERRED': {
        const t = rp && rp.targetValue != null ? rp.targetValue : def.targetValue; if (!isNum(t) || !validValue(m, def, v)) return null;
        const d = Math.abs(v - t); return { x: d, g: -d, distanceToTarget: d };
      }
      default: return null;
    }
  }
  const relOf = (diff, base) => base === 0 ? null : diff / Math.abs(base);
  function tied(tp, diff, base) {
    const EPS = PRECISION.EPS, rel = relOf(diff, base);
    switch (tp.type) {
      case 'EXACT': return diff <= EPS;
      case 'ABSOLUTE_TOLERANCE': return diff <= (tp.absoluteTolerance || 0) + EPS;
      case 'RELATIVE_TOLERANCE': return diff <= EPS || (rel != null && rel * 100 <= (tp.relativeTolerancePct || 0) + EPS);
      case 'ABSOLUTE_OR_RELATIVE': return diff <= (tp.absoluteTolerance || 0) + EPS || (rel != null && rel * 100 <= (tp.relativeTolerancePct || 0) + EPS);
      case 'TARGET_DISTANCE': return diff <= (tp.targetDistanceTolerance || 0) + EPS;
      default: return null; // CUSTOM / unknown: fail closed
    }
  }
  function material(mp, diff, base) {
    const EPS = PRECISION.EPS, rel = relOf(diff, base), checks = [];
    if (mp.minimumAbsoluteDifference != null) checks.push(diff + EPS >= mp.minimumAbsoluteDifference);
    if (mp.minimumRelativeDifferencePct != null) checks.push(rel != null && rel * 100 + EPS >= mp.minimumRelativeDifferencePct);
    if (mp.minimumOrdinalStep != null) checks.push(diff + EPS >= mp.minimumOrdinalStep);
    if (mp.targetDistanceDifference != null) checks.push(diff + EPS >= mp.targetDistanceDifference);
    return checks.every(Boolean); // every configured threshold must be met (conservative)
  }
  const capConf = (c, cap) => CONF_RANK[c] > CONF_RANK[cap] ? cap : c;
  const moneyBack = (m, x) => m.valueType === 'MONEY' ? x / PRECISION.MONEY_FACTOR : x;

  /** evaluateCriterion(metricDef, values[], ctx) → CriterionEvaluationResult. Never mutates inputs. */
  function evaluateCriterion(m, values, ctx) {
    const audience = ctx.audience, def = definitionOf(m.id, ctx.reg, ctx.evaluationProfileId);
    const res = { metricId: m.id, evaluationStatus: null, winnerSemantics: def ? def.winnerSemantics : null, resolvedSemantics: null, resolvedPreference: null, winnerCandidateIds: [], assessments: [], tieState: 'NONE',
      marginSummary: null, dataSufficiency: { validCandidates: 0, totalCandidates: values.length, partial: false, requireAll: false }, evaluationConfidence: 'UNKNOWN', comparativeAdvantage: 'UNKNOWN',
      explanation: null, suppressionReasons: [], caveats: [], versionRefs: [...new Set(values.map(v => v.versionRef).filter(Boolean))], error: null, pairwiseDeltas: [],
      policy: def ? { tiePolicyId: def.tiePolicyId, marginPolicyId: def.marginPolicyId, dataSufficiencyPolicyId: def.dataSufficiencyPolicyId, stalePolicyId: def.stalePolicyId, conflictPolicyId: def.conflictPolicyId, confidencePolicyId: def.confidencePolicyId, version: def.version } : null,
      priority: m.priority, highlight: def ? def.highlight : false, phraseTarget: def ? def.phraseTarget : null, dedupGroup: def ? def.dedupGroup || (m.fieldKeyOf ? m.fieldKeyOf(ctx.context || {}) : m.fieldKey) : null, phrase: def ? def.phrase : null };
    const baseAssess = v => ({ candidateId: v.candidateId, metricId: m.id, rawValue: v.rawValue, comparableValue: null, ordinalValue: null, deltaToBest: null, relativeDeltaToBest: null, distanceToTarget: null, rankWithinCriterion: null,
      assessmentState: v.valueStatus === 'NO_DATA' || v.valueStatus === 'ERROR' ? 'NO_DATA' : v.valueStatus === 'UNKNOWN' ? 'UNKNOWN' : v.valueStatus === 'CONFLICTED' ? 'CONFLICTED' : v.valueStatus === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'NEUTRAL',
      freshness: v.freshness, confidence: v.confidence, provenanceStatus: v.provenanceSummary ? v.provenanceSummary.status : null, reasons: [] });
    const finish = (status, reasons = [], reasonCode = null, extra = {}) => {
      res.evaluationStatus = status; res.suppressionReasons = [...new Set([...res.suppressionReasons, ...reasons])];
      if (!res.assessments.length) res.assessments = values.map(baseAssess);
      if (!['WINNER', 'TIE', 'NO_CLEAR_WINNER'].includes(status)) { res.winnerCandidateIds = []; res.comparativeAdvantage = status === 'NOT_COMPARABLE' ? 'NONE' : 'UNKNOWN'; res.evaluationConfidence = 'UNKNOWN'; }
      res.explanation = Object.freeze({ metricId: m.id, winnerCandidateIds: res.winnerCandidateIds.slice(), reasonCode: reasonCode || status, templateId: (def && def.explanationTemplateId) || reasonCode || status, facts: Object.freeze(extra.facts || {}),
        comparisonPhraseKey: 'compare.phrase.' + m.id, caveats: res.caveats.slice(), evidenceRefs: [res.dedupGroup].filter(Boolean) });
      res.assessments = res.assessments.map(a => { const o = { ...a }; delete o.g; delete o.usable; return Object.freeze(o); });
      return Object.freeze(res);
    };
    try {
      if (!def) return finish('NOT_COMPARABLE', ['UNKNOWN_SEMANTICS'], 'INFORMATIONAL_ONLY');
      if (def.invalid) { res.error = { type: def.invalid.includes('MISSING_ORDER_MAP') ? 'MISSING_ORDER_MAP' : 'INVALID_METRIC_POLICY', details: def.invalid }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      let sem = def.winnerSemantics, rp = null;
      if (sem === 'NON_ORDERED') return finish('NOT_COMPARABLE', ['NON_ORDERED_METRIC'], 'NOT_ORDERED');
      if (sem === 'INFORMATIONAL' || sem === 'NO_WINNER') return finish('NOT_COMPARABLE', ['POLICY_DISABLED'], 'INFORMATIONAL_ONLY');
      if ((def.customerContextRequired || m.customerContextRequired) && !ctx.hasCustomer) { res.caveats.push('PROFILE_DEPENDENT'); return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED'); }
      if (values.length && values.every(v => v.comparableState === 'CONTEXT_MISSING')) return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED');
      if (sem === 'CONTEXTUAL_PREFERENCE') {
        rp = resolvePreference(def, ctx);
        if (!rp) { res.caveats.push('PROFILE_DEPENDENT'); return finish('CONTEXT_REQUIRED', ['MISSING_CONTEXT'], 'CONTEXT_REQUIRED'); }
        sem = rp.winnerSemantics; res.resolvedPreference = rp;
      }
      res.resolvedSemantics = sem;
      if (!ORDERED.has(sem)) return finish('NOT_COMPARABLE', ['UNKNOWN_SEMANTICS'], 'INFORMATIONAL_ONLY');
      if (sem === 'ORDERED_ENUM' && !((rp && rp.orderMap) || def.orderMap)) { res.error = { type: 'MISSING_ORDER_MAP' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      const reg = ctx.reg, target = sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED';
      const tp = reg.tiePolicies[(rp && rp.tiePolicyId) || (target && rp ? 'target' : def.tiePolicyId)], mp = reg.marginPolicies[(rp && rp.marginPolicyId) || (target && rp ? 'target' : def.marginPolicyId)], sp = reg.dataSufficiencyPolicies[def.dataSufficiencyPolicyId];
      const stp = (reg.stalePolicies || {})[def.stalePolicyId] || null, cp = (reg.conflictPolicies || {})[def.conflictPolicyId] || { type: 'SUPPRESS_METRIC' }, confp = (reg.confidencePolicies || {})[def.confidencePolicyId] || null;
      if (!tp || !mp || !sp || !TieType[tp.type]) { res.error = { type: 'INVALID_METRIC_POLICY' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      res.policy = { ...res.policy, tie: tp, margin: mp, sufficiency: sp, stale: stp, conflict: cp, confidence: confp, resolvedSemantics: sem };
      // units must match (normalization happens upstream, never here)
      const units = new Set(values.filter(v => v.valueStatus === 'VALID').map(v => v.unit == null ? '∅' : v.unit));
      if (units.size > 1) { res.error = { type: 'UNIT_MISMATCH' }; return finish('SUPPRESSED', ['INVALID_VALUE'], 'EVALUATION_ERROR'); }
      // assessments
      let staleSuppress = false, lowConf = false, conflicted = false, invalid = false, usedStale = false;
      const minConf = confp && confp.minimum ? confp.minimum[audience] : null;
      const assess = values.map(v => {
        const a = baseAssess(v); a.usable = false;
        if (v.valueStatus === 'CONFLICTED') { conflicted = true; a.reasons.push('CONFLICTED_DATA'); return a; }
        if (v.valueStatus !== 'VALID') return a;
        if (sp.allowEstimated === false && a.provenanceStatus === 'ESTIMATED') { a.assessmentState = 'NOT_APPLICABLE'; a.reasons.push('ESTIMATED_NOT_ALLOWED'); return a; }
        const k = keyOf(m, sem, rp, def, v.rawValue, ctx);
        if (!k) { if (sem === 'ORDERED_ENUM') { a.assessmentState = 'UNKNOWN'; a.reasons.push('NOT_IN_ORDER_MAP'); } else { invalid = true; a.assessmentState = 'NOT_APPLICABLE'; a.reasons.push('INVALID_VALUE'); } return a; }
        a.comparableValue = k.x; a.ordinalValue = k.ordinal ?? null; a.distanceToTarget = k.distanceToTarget ?? null; a.g = k.g;
        if (v.freshness === 'STALE' || v.freshness === 'EXPIRED') {
          const action = !stp ? 'ALLOW_WITH_WARNING' : v.freshness === 'EXPIRED' ? stp.expired : stp[audience];
          a.reasons.push('STALE_VALUE');
          if (action === 'SUPPRESS_WINNER' || action === 'REQUIRE_REFRESH' || sp.allowStale === false) { staleSuppress = true; if (action === 'REQUIRE_REFRESH') { a.assessmentState = 'STALE_REVIEW'; return a; } }
          else if (action === 'EXCLUDE_STALE_CANDIDATE') { a.assessmentState = 'STALE_REVIEW'; return a; }
          else usedStale = true;
        }
        if (minConf && a.confidence && CONF_RANK[a.confidence] < CONF_RANK[minConf]) { lowConf = true; a.reasons.push('LOW_CONFIDENCE'); }
        a.usable = true; return a;
      });
      res.assessments = assess;
      const usable = assess.filter(a => a.usable);
      res.dataSufficiency = { validCandidates: usable.length, totalCandidates: values.length, partial: usable.length < values.length, requireAll: !!(sp.requireAllCandidates || (sp.requireAllCandidatesFor || []).includes(audience)) };
      if (invalid) return finish('SUPPRESSED', ['INVALID_VALUE'], 'EVALUATION_ERROR');
      if (conflicted && cp.type === 'SUPPRESS_METRIC') { res.caveats.push('CONFLICTED_DATA'); return finish('SUPPRESSED', ['CONFLICTED_DATA'], 'CONFLICT_SUPPRESSION'); }
      if (usable.length < (sp.minValidCandidates || 2)) return finish('INSUFFICIENT_DATA', ['INSUFFICIENT_VALID_VALUES'], usable.length === 1 ? 'ONLY_VALID_CANDIDATE_SUPPRESSED' : 'INSUFFICIENT_DATA', { facts: { validCandidateCount: usable.length, totalCandidateCount: values.length } });
      if (res.dataSufficiency.partial && res.dataSufficiency.requireAll) { res.caveats.push('PARTIAL_DATA'); return finish('SUPPRESSED', ['PARTIAL_DATA', 'INSUFFICIENT_VALID_VALUES'], 'PARTIAL_DATA_SUPPRESSION', { facts: { validCandidateCount: usable.length, totalCandidateCount: values.length } }); }
      if (staleSuppress) { res.caveats.push('STALE_VALUE'); return finish('SUPPRESSED', ['STALE_DATA'], 'STALE_SUPPRESSION'); }
      if (lowConf) return finish('SUPPRESSED', ['LOW_CONFIDENCE'], 'LOW_CONFIDENCE_SUPPRESSION');
      if (sp.requireSameVersion && m.versionCoherence) { const refs = new Set(usable.map(a => values.find(v => v.candidateId === a.candidateId).versionRef).filter(Boolean)); if (refs.size > 1) return finish('SUPPRESSED', ['VERSION_MISMATCH'], 'VERSION_MISMATCH'); }
      if (res.dataSufficiency.partial) res.caveats.push('PARTIAL_DATA');
      if (usedStale) res.caveats.push('STALE_VALUE');
      for (const c of def.caveats || []) if (!res.caveats.includes(c)) res.caveats.push(c);
      // ordering: by goodness only (candidate order keeps output stable; lot id never breaks a tie)
      const bestG = Math.max(...usable.map(a => a.g)), best = usable.find(a => Math.abs(a.g - bestG) <= PRECISION.EPS);
      const diffTo = (a, b) => Math.abs(a.comparableValue - b.comparableValue);
      const baseOf = a => sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED' ? 0 : a.comparableValue;
      const tieRes = a => tied(tp, diffTo(best, a), baseOf(best));
      if (usable.some(a => tieRes(a) === null)) { res.error = { type: 'INVALID_METRIC_POLICY' }; return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR'); }
      const coBest = usable.filter(a => tieRes(a));
      for (const a of usable) { a.rankWithinCriterion = 1 + usable.filter(b => b.g > a.g + PRECISION.EPS).length; a.deltaToBest = moneyBack(m, a.comparableValue - best.comparableValue); a.relativeDeltaToBest = relOf(a.comparableValue - best.comparableValue, best.comparableValue); }
      let status, reasonCode, facts = { validCandidateCount: usable.length, totalCandidateCount: values.length, unit: m.unit };
      const winnerCode = { HIGHER_IS_PREFERRED: 'HIGHEST_VALUE', LOWER_IS_PREFERRED: 'LOWEST_VALUE', ORDERED_ENUM: 'HIGHEST_ORDERED_CATEGORY', BOOLEAN_TRUE_PREFERRED: 'PREFERRED_BOOLEAN_VALUE', BOOLEAN_FALSE_PREFERRED: 'PREFERRED_BOOLEAN_VALUE',
        TARGET_RANGE_PREFERRED: 'WITHIN_TARGET_RANGE', TARGET_VALUE_PREFERRED: 'CLOSE_TO_TARGET' }[sem];
      if (coBest.length === usable.length) {
        status = 'TIE'; res.tieState = 'ALL_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'ALL_TIED'; res.winnerCandidateIds = coBest.map(a => a.candidateId);
        coBest.forEach(a => { a.assessmentState = 'CO_BEST'; });
      } else if (coBest.length >= 2) {
        status = 'TIE'; res.tieState = 'TOP_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'TIED_TOP_VALUE'; res.winnerCandidateIds = coBest.map(a => a.candidateId);
        usable.forEach(a => { a.assessmentState = coBest.includes(a) ? 'CO_BEST' : 'WEAKER'; });
      } else {
        const others = usable.filter(a => a !== best), runner = others.reduce((r, a) => (r == null || a.g > r.g + PRECISION.EPS ? a : r), null);
        const diff = diffTo(best, runner), base = sem === 'TARGET_RANGE_PREFERRED' || sem === 'TARGET_VALUE_PREFERRED' ? 0 : runner.comparableValue, isMat = material(mp, diff, base);
        res.marginSummary = { absoluteDifference: moneyBack(m, diff), relativeDifferencePct: relOf(diff, base) == null ? null : relOf(diff, base) * 100, material: isMat, runnerUpCandidateId: runner.candidateId };
        facts = { ...facts, winnerCandidateId: best.candidateId, winnerValue: best.rawValue, runnerUpCandidateId: runner.candidateId, runnerUpValue: runner.rawValue, absoluteDifference: res.marginSummary.absoluteDifference,
          relativeDifferencePct: res.marginSummary.relativeDifferencePct, target: rp ? rp.targetRange || rp.targetValue : def.targetRange || def.targetValue };
        if (isMat) {
          status = 'WINNER'; res.comparativeAdvantage = 'CLEAR'; reasonCode = winnerCode === 'WITHIN_TARGET_RANGE' && best.distanceToTarget > 0 ? 'CLOSE_TO_TARGET' : winnerCode; res.winnerCandidateIds = [best.candidateId];
          usable.forEach(a => { a.assessmentState = a === best ? 'BEST' : 'WEAKER'; });
        } else {
          const below = BelowThreshold[mp.resultBelowThreshold] || 'NO_CLEAR_WINNER';
          const close = usable.filter(a => !material(mp, diffTo(best, a), base === 0 ? 0 : a.comparableValue));
          if (below === 'SUPPRESS_HIGHLIGHT') return finish('SUPPRESSED', ['NO_MATERIAL_DIFFERENCE'], 'NO_MATERIAL_DIFFERENCE', { facts });
          if (below === 'TIE') { status = 'TIE'; res.tieState = close.length === usable.length ? 'ALL_TIED' : 'TOP_TIED'; res.comparativeAdvantage = 'TIED'; reasonCode = 'TIED_TOP_VALUE'; res.winnerCandidateIds = close.map(a => a.candidateId); usable.forEach(a => { a.assessmentState = close.includes(a) ? 'CO_BEST' : 'WEAKER'; }); }
          else { status = 'NO_CLEAR_WINNER'; res.comparativeAdvantage = 'SLIGHT'; reasonCode = 'NO_MATERIAL_DIFFERENCE'; res.suppressionReasons.push('NO_MATERIAL_DIFFERENCE'); res.slightAdvantageCandidateId = best.candidateId; usable.forEach(a => { a.assessmentState = close.includes(a) ? 'CLOSE' : 'WEAKER'; }); }
        }
      }
      // confidence of the result: inputs, missing data, freshness, margin and context certainty
      let conf = 'HIGH';
      for (const a of usable) if (a.confidence && CONF_RANK[a.confidence] < CONF_RANK[conf]) conf = a.confidence;
      if (res.dataSufficiency.partial || usedStale || status === 'NO_CLEAR_WINNER' || (rp && rp.source === 'EVALUATION_PROFILE')) conf = capConf(conf, 'MEDIUM');
      res.evaluationConfidence = conf;
      // PairwiseDelta: each candidate against the reference (best, or the selected candidate) — not N²
      const refId = ctx.referenceCandidateId && usable.some(a => a.candidateId === ctx.referenceCandidateId) ? ctx.referenceCandidateId : best.candidateId, ref = usable.find(a => a.candidateId === refId);
      res.pairwiseDeltas = usable.filter(a => a !== ref).map(a => {
        const d = a.comparableValue - ref.comparableValue, ad = Math.abs(d), rel = relOf(d, ref.comparableValue);
        return Object.freeze({ metricId: m.id, candidateA: ref.candidateId, candidateB: a.candidateId, rawDelta: moneyBack(m, d), absoluteDelta: moneyBack(m, ad), relativeDeltaPct: rel == null ? null : rel * 100,
          direction: Math.abs(a.g - ref.g) <= PRECISION.EPS ? 'EQUAL' : a.g > ref.g ? 'B_PREFERRED' : 'A_PREFERRED', comparable: true,
          materiality: tied(tp, ad, baseOf(ref)) ? 'WITHIN_TIE' : material(mp, ad, sem.startsWith('TARGET') ? 0 : a.comparableValue) ? 'MATERIAL' : 'BELOW_MARGIN' });
      });
      return finish(status, [], reasonCode, { facts });
    } catch (e) {
      res.error = { type: 'EVALUATION_ERROR', message: String(e && e.message || e) };
      res.assessments = values.map(baseAssess);
      return finish('ERROR', ['POLICY_DISABLED'], 'EVALUATION_ERROR');
    }
  }

  // ---------------------------------------------------------------- ComparisonEvaluationService → ComparisonEvaluationSnapshot
  const cache = new Map(), LOG = [];
  /** evaluate(snapshot, { audience, customerProfile, evaluationProfileId, metricIds, previous, referenceCandidateId, reg, now }) */
  function evaluate(snap, opts = {}) {
    const audience = AUDIENCES.has(opts.audience) ? opts.audience : 'broker', reg = opts.reg || registry(snap.developmentId);
    const evaluationProfileId = opts.evaluationProfileId || snap.metricProfileId, ctxMode = snap.contextRef.mode;
    const hasCustomer = !!snap.contextRef.customerProfileVersion, prefsOk = hasCustomer && !!opts.customerProfile; // Fit comes from upstream; preferences only resolve contextual metrics
    const prefsKey = prefsOk ? D.hash((opts.customerProfile.preferences || []).filter(p => p.enabled !== false).map(p => [p.key, p.target ?? null])) : null;
    const contextHash = D.hash({ ctx: snap.contextRef.hash, audience, evaluationProfileId, prefsKey, ref: opts.referenceCandidateId || null });
    const metricIds = (opts.metricIds || snap.metricOrder).filter(id => snap.valuesByMetric[id] && D.metric(id) && D.visibleFor(D.metric(id), audience));
    const key = [snap.hash, reg.evaluationPolicyVersion, contextHash, (D.profile(snap.metricProfileId) || {}).version, D.hash(metricIds), D.hash(metricIds.map(id => snap.valuesByMetric[id].map(v => [v.rawValue, v.valueStatus, v.freshness, v.confidence])))].join('|');
    if (!opts.noCache && cache.has(key)) return Object.freeze({ ...cache.get(key), recomputedMetricIds: [] }); // same inputs + same policies = same result
    const ctx = { audience, reg, evaluationProfileId, contextMode: ctxMode, hasCustomer, customerProfile: prefsOk ? { preferences: opts.customerProfile.preferences || [] } : null,
      availabilityPolicy: App.availability.policyOf((App.config && App.config.DEVELOPMENTS && App.config.DEVELOPMENTS[snap.developmentId]) || null), referenceCandidateId: opts.referenceCandidateId || null, context: snap.context };
    const prev = opts.previous && opts.previous.developmentId === snap.developmentId ? opts.previous : null;
    const metricResults = {}, inputKeys = {}, recomputed = [];
    for (const id of metricIds) {
      const deps = ((reg.dependencies || {})[id] || []).map(k => [k, snap.dataVersions[k] ?? null]);
      const values = snap.valuesByMetric[id];
      const ik = D.hash({ v: values.map(v => [v.candidateId, v.rawValue, v.valueStatus, v.freshness, v.confidence, v.versionRef, v.comparableState]), deps, contextHash, pv: reg.evaluationPolicyVersion });
      inputKeys[id] = ik;
      if (prev && prev.inputKeys && prev.inputKeys[id] === ik && prev.metricResults[id]) { metricResults[id] = prev.metricResults[id]; continue; }
      metricResults[id] = evaluateCriterion(D.metric(id), values, ctx); recomputed.push(id);
      LOG.push({ metricId: id, evaluationStatus: metricResults[id].evaluationStatus, policyVersion: reg.evaluationPolicyVersion, suppressionReasons: metricResults[id].suppressionReasons.slice(), candidateCount: values.length });
      if (LOG.length > 200) LOG.shift();
    }
    const results = metricIds.map(id => metricResults[id]);
    const evaluable = results.filter(r => r.evaluationStatus !== 'NOT_COMPARABLE' && r.evaluationStatus !== 'CONTEXT_REQUIRED');
    const errors = results.filter(r => r.evaluationStatus === 'ERROR');
    const status = !snap.candidateIds.length ? 'SUPPRESSED' : errors.length && errors.length === evaluable.length ? 'ERROR' : evaluable.length && evaluable.every(r => ['SUPPRESSED', 'INSUFFICIENT_DATA', 'ERROR'].includes(r.evaluationStatus)) ? 'SUPPRESSED'
      : evaluable.some(r => ['SUPPRESSED', 'INSUFFICIENT_DATA', 'ERROR'].includes(r.evaluationStatus) || r.dataSufficiency.partial) ? 'PARTIAL' : 'READY';
    const counts = {}; for (const r of results) counts[r.evaluationStatus] = (counts[r.evaluationStatus] || 0) + 1;
    const out = Object.freeze({ id: 'cmpe_' + D.hash({ s: snap.hash, c: contextHash, p: reg.evaluationPolicyVersion, m: metricIds }), comparisonSnapshotId: snap.id, comparisonSnapshotHash: snap.hash, developmentId: snap.developmentId,
      candidateIds: snap.candidateIds.slice(), metricOrder: metricIds, metricResults: Object.freeze(metricResults), inputKeys: Object.freeze(inputKeys), recomputedMetricIds: recomputed,
      generatedAt: opts.now || snap.generatedAt, evaluationPolicyVersion: reg.evaluationPolicyVersion, evaluationProfileId, audience, contextHash, status,
      summary: Object.freeze({ counts, candidateSummaries: candidateSummaries(snap.candidateIds, results) }), registryErrors: reg.errors || [] });
    cache.set(key, out); if (cache.size > 30) cache.delete(cache.keys().next().value);
    return out;
  }
  /** CandidateCriterionSummary: counts per lot — never turned into a ranking or an overall winner */
  function candidateSummaries(ids, results) {
    return ids.map(id => {
      const s = { candidateId: id, clearWins: 0, coWins: 0, slightAdvantages: 0, suppressedMetrics: 0, noDataMetrics: 0, clearWinMetricIds: [] };
      for (const r of results) {
        if (r.evaluationStatus === 'WINNER' && r.winnerCandidateIds.includes(id)) { s.clearWins++; s.clearWinMetricIds.push(r.metricId); }
        else if (r.evaluationStatus === 'TIE' && r.tieState === 'TOP_TIED' && r.winnerCandidateIds.includes(id)) s.coWins++;
        else if (r.evaluationStatus === 'NO_CLEAR_WINNER' && r.slightAdvantageCandidateId === id) s.slightAdvantages++;
        if (['SUPPRESSED', 'INSUFFICIENT_DATA'].includes(r.evaluationStatus)) s.suppressedMetrics++;
        const a = r.assessments.find(x => x.candidateId === id); if (a && ['NO_DATA', 'UNKNOWN'].includes(a.assessmentState)) s.noDataMetrics++;
      }
      return Object.freeze(s);
    });
  }
  /** ComparativeHighlightSelector: top facts (priority + clear advantage + confidence), deduplicated, 3–5 max, grouped by lot — no champion */
  function highlights(ev, opts = {}) {
    const audience = opts.audience || ev.audience, reg = opts.reg || registry(ev.developmentId);
    const max = opts.max || ((reg.highlights || {}).max || {})[audience] || (audience === 'client' || audience === 'presentation' ? 3 : 5);
    const safe = audience === 'client' || audience === 'presentation';
    const cand = ev.metricOrder.map(id => ev.metricResults[id]).filter(r => r.evaluationStatus === 'WINNER' && r.highlight && r.evaluationConfidence !== 'LOW' && r.evaluationConfidence !== 'UNKNOWN'
      && !(safe && (r.caveats.includes('STALE_VALUE') || r.caveats.includes('PARTIAL_DATA'))))
      .map((r, i) => ({ r, i })).sort((a, b) => (PRIORITY_RANK[a.r.priority] ?? 9) - (PRIORITY_RANK[b.r.priority] ?? 9) || CONF_RANK[b.r.evaluationConfidence] - CONF_RANK[a.r.evaluationConfidence] || a.i - b.i);
    const used = new Set(), picked = [];
    for (const { r } of cand) {
      const k = r.winnerCandidateIds[0] + '|' + (r.dedupGroup || r.metricId); if (used.has(k)) continue; // e.g. "menor preço" + "menor R$/m²" for the same lot
      used.add(k); picked.push(r); if (picked.length >= max) break;
    }
    return ev.candidateIds.map(id => ({ candidateId: id, metricIds: picked.filter(r => r.winnerCandidateIds[0] === id).map(r => r.metricId) })).filter(x => x.metricIds.length);
  }
  /** share-safe facts: only clear, fresh, complete, non-low-confidence highlights; records the policy version */
  function shareFacts(ev, { names = {}, labelOf = id => id } = {}) {
    const hs = highlights(ev, { audience: 'client' });
    const lines = hs.map(h => `${names[h.candidateId] || h.candidateId}: ${h.metricIds.map(id => phraseOf(ev.metricResults[id], labelOf(id))).join('; ')}`);
    return { lines, evaluationPolicyVersion: ev.evaluationPolicyVersion, evaluationSnapshotId: ev.id, comparisonSnapshotId: ev.comparisonSnapshotId };
  }
  const phraseOf = (r, label) => {
    let p = r.phrase || ('destaque em ' + label);
    if ((r.resolvedSemantics === 'TARGET_RANGE_PREFERRED' || r.resolvedSemantics === 'TARGET_VALUE_PREFERRED') && r.phraseTarget) p = r.phraseTarget;
    return p.replace('{label}', label);
  };

  /** Adapter for the legacy App.services.comparison.compare(items, rows): rows declare a fieldKey; winners come only from the
      registered semantics (fail closed: a row without a registered metric has no winner). */
  function legacyRowWinners(items, rows, opts = {}) {
    const devId = (items[0] && items[0].identity && items[0].identity.developmentId) || 'viva-juara', reg = registry(devId), ctx0 = D.normalizeContext({ scoreKey: opts.scoreKey });
    const byField = new Map(D.METRICS.filter(m => m.fieldKey).map(m => [m.fieldKey, m]));
    const ctx = { audience: opts.audience || 'broker', reg, evaluationProfileId: 'BROKER_STANDARD', contextMode: 'GENERAL', hasCustomer: false, customerProfile: null, availabilityPolicy: App.availability.DEFAULT_POLICY, context: ctx0 };
    return rows.map(r => {
      const m = r.fieldKey && byField.get(r.fieldKey); if (!m || items.length < 2) return [];
      try {
        const res = evaluateCriterion(m, items.map(l => D.value(m, l, ctx0, null)), ctx);
        if (res.evaluationStatus === 'WINNER' || (res.evaluationStatus === 'TIE' && res.tieState === 'TOP_TIED')) return res.winnerCandidateIds.map(id => items.findIndex(l => l.identity.id === id)).filter(i => i >= 0);
      } catch (e) { /* fail closed */ }
      return [];
    });
  }
  /** Adapter for the legacy leaders(items, criteria): analysis notes 0–10 (higher = more of the attribute, by methodology), with the note10 tie and margin */
  function legacyLeaders(items, criteria) {
    const reg = registry((items[0] && items[0].identity && items[0].identity.developmentId) || 'viva-juara'), tp = reg.tiePolicies.note10, mp = reg.marginPolicies.note10;
    if (!tp || !mp || items.length < 2) return [];
    return criteria.map(c => {
      const vals = items.map(l => { try { return c.get(l); } catch (e) { return null; } });
      if (vals.some(v => !isNum(v))) return null; // a missing value is never 0 and never loses or wins
      const best = Math.max(...vals), top = vals.map((v, i) => [v, i]).filter(([v]) => tied(tp, best - v, best));
      if (top.length !== 1) return null;
      const runner = Math.max(...vals.filter((v, i) => i !== top[0][1]));
      return material(mp, best - runner, runner) ? { label: c.label, index: top[0][1] } : null;
    }).filter(Boolean);
  }

  return Object.freeze({ WinnerSemantics, EvaluationStatus, AssessmentState, TieType, BelowThreshold, EvaluationStalePolicy, EvaluationConflictPolicy, EvaluationConfidence, SuppressionReason, ComparativeAdvantage, CellState, ReasonCode, ErrorType, PRECISION,
    registry, definitionOf, resolvePreference, evaluateCriterion, evaluate, candidateSummaries, highlights, shareFacts, phraseOf, legacyRowWinners, legacyLeaders,
    log: () => LOG.slice(), clearCache: () => { cache.clear(); regCache.clear(); } });
})();

/* ComparisonViewModel / EvaluatedComparisonViewModel: composition of the base matrix (topic 24) and the evaluation (topic 25).
   Formatting and pt-BR text happen here. The same view model feeds desktop, tablet and mobile (no breakpoint logic). */
App.compare.viewModel = (() => {
  const D = App.compare.domain, EV = App.compare.evaluation, F = App.fmt, t = App.i18n.t;
  const CAVEAT = {
    PRICE_TABLE_ONLY: () => 'Preço de tabela; não inclui condições de negociação.',
    PROFILE_DEPENDENT: () => 'Depende do perfil do cliente informado.',
    NOT_PURCHASE_PROBABILITY: () => 'Compatibilidade não é probabilidade de compra.',
    ANALYSIS_ESTIMATE: () => 'Estimativa da análise.',
    NO_APPRECIATION_PROMISE: () => 'Não é promessa de valorização.',
    RELATIVE_CLASS: () => 'Classe relativa aos lotes do empreendimento.',
    STALE_VALUE: a => a === 'client' || a === 'presentation' ? 'Valor sujeito a confirmação.' : 'Baseado na última informação disponível; confirme antes de negociar.',
    PARTIAL_DATA: (a, r) => `Comparação parcial: ${r.dataSufficiency.validCandidates} de ${r.dataSufficiency.totalCandidates} lotes com dados.`,
    CONFLICTED_DATA: () => 'Há fontes divergentes para este critério.'
  };
  const REASON_PT = { INSUFFICIENT_VALID_VALUES: 'dados insuficientes', MISSING_CONTEXT: 'depende do perfil do cliente', STALE_DATA: 'dados desatualizados', CONFLICTED_DATA: 'fontes divergentes', LOW_CONFIDENCE: 'baixa confiabilidade',
    NON_ORDERED_METRIC: 'atributo sem ordem de preferência', NO_MATERIAL_DIFFERENCE: 'diferença abaixo da margem', VERSION_MISMATCH: 'versões de dados diferentes', POLICY_DISABLED: 'sem regra de destaque', NOT_APPLICABLE: 'não se aplica',
    UNKNOWN_SEMANTICS: 'semântica não registrada', PARTIAL_DATA: 'nem todos os lotes têm dado', INVALID_VALUE: 'valor fora da faixa válida' };
  const SEM_PT = { HIGHER_IS_PREFERRED: 'maior valor preferível', LOWER_IS_PREFERRED: 'menor valor preferível', ORDERED_ENUM: 'ordem formal de categorias', BOOLEAN_TRUE_PREFERRED: '"sim" preferível', BOOLEAN_FALSE_PREFERRED: '"não" preferível',
    TARGET_RANGE_PREFERRED: 'dentro da faixa desejada', TARGET_VALUE_PREFERRED: 'mais próximo do valor desejado', CONTEXTUAL_PREFERENCE: 'depende do contexto', NON_ORDERED: 'sem ordem', INFORMATIONAL: 'informativo', NO_WINNER: 'sem destaque' };
  const CONF_PT = { HIGH: 'alta', MEDIUM: 'média', LOW: 'baixa', UNKNOWN: 'não avaliada' };

  // ---------------------------------------------------------------- formatting (presentation only)
  function statusText(code, freshness, audience) {
    const client = audience === 'client' || audience === 'presentation';
    if (code === 'UNKNOWN' || code == null) return client ? 'Disponibilidade sujeita a confirmação' : 'Status não confirmado';
    if (code === 'AVAILABLE' && freshness !== 'FRESH') return client ? 'Disponível (sujeito a confirmação)' : 'Disponível, não confirmado agora';
    return t('AvailabilityStatus', code);
  }
  function formatValue(row, v, audience, freshness) {
    switch (row.formatterId) {
      case 'money': return F.formatBRL(v);
      case 'pricePerM2': return F.formatPricePerM2(v);
      case 'area': return F.formatSquareMeters(v, 2);
      case 'distance': return F.formatMeters(v, v < 100 && v % 1 ? 1 : 0);
      case 'score': return F.formatScore(v);
      case 'note': return `${F.formatNote(v)}/10`;
      case 'ratio': return F.formatPercentage(v);
      case 'percentNumber': return `${F.number(v, v % 1 ? 1 : 0)}%`;
      case 'level': return F.formatLevel(v);
      case 'levelF': return F.formatLevel(v, true);
      case 'lotClass': return F.formatLotClass(v);
      case 'status': return statusText(v, freshness, audience);
      case 'boolean': return F.formatBool(v);
      case 'easements': return Array.isArray(v) ? (v.length ? v.map(e => e.description || '').filter(Boolean).join('; ') || `${v.length}` : 'Nenhuma indicada na planta') : String(v);
      case 'alerts': return v === 0 ? 'Nenhum' : `${F.number(v)}`;
      case 'number': return F.number(v, v % 1 ? 1 : 0);
      case 'northSun': return String(t('NorthSunSide', v)).split(':')[0].split(';')[0];
      case 'enum': return row.enumName === 'Freshness' ? t('Freshness', v) : row.enumName === 'Confidence' ? t('Confidence', v) : t(row.enumName, v, F.ND);
      case 'text': return String(v);
      default: return v == null ? F.ND : String(v);
    }
  }
  function cellText(row, c, audience) {
    if (row.metricId === 'status') return statusText(c.valueStatus === 'VALID' ? c.value : 'UNKNOWN', c.freshness, audience);
    if (c.comparableState === 'CONTEXT_MISSING') return 'Sem perfil de cliente';
    switch (c.valueStatus) {
      case 'VALID': return formatValue(row, c.value, audience, c.freshness);
      case 'NO_DATA': case 'ERROR': return row.valueType === 'MONEY' && /price/i.test(row.metricId) ? 'Preço não disponível' : 'Não disponível';
      case 'UNKNOWN': return 'Desconhecido';
      case 'CONFLICTED': return 'Verificar divergência';
      case 'NOT_APPLICABLE': return 'Não se aplica';
      default: return 'Não disponível';
    }
  }
  const staleNote = (c, audience) => !c.uiHints.stale ? null : audience === 'client' || audience === 'presentation' ? 'sujeito a confirmação' : c.uiHints.expired ? 'vencido: confirme antes de negociar' : 'última informação disponível';
  const money = v => F.formatBRLShort(v);
  function diffText(row, r) {
    const ms = r.marginSummary; if (!ms) return '';
    const v = ms.absoluteDifference;
    if (row.valueType === 'MONEY') return row.formatterId === 'pricePerM2' ? `${F.formatPricePerM2(v)} abaixo` : `${money(v)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'abaixo' : 'acima'}`;
    if (row.valueType === 'SCORE') return row.formatterId === 'note' ? `${F.formatNote(v)} ponto${v === 1 ? '' : 's'} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'abaixo' : 'acima'}` : `${F.number(v)} ponto${Math.round(v) === 1 ? '' : 's'} acima`;
    if (row.valueType === 'AREA') return r.resolvedSemantics === 'TARGET_RANGE_PREFERRED' ? '' : `${F.formatSquareMeters(v, 0)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'a menos' : 'a mais'}`;
    if (row.valueType === 'DISTANCE') return `${F.formatMeters(v)} ${r.resolvedSemantics === 'LOWER_IS_PREFERRED' ? 'a menos' : 'a mais'}`;
    return '';
  }
  /** row text from facts + reason codes (the domain never writes these sentences) */
  function rowTexts(row, r, names, audience) {
    const client = audience === 'client' || audience === 'presentation', technical = audience === 'technical';
    const nm = id => names[id] || id, list = ids => ids.map(nm).join(ids.length > 2 ? ', ' : ' e ').replace(/, ([^,]*)$/, ' e $1');
    const phrase = EV.phraseOf(r, row.label);
    let explanationText = null, highlightMode = 'none';
    switch (r.evaluationStatus) {
      case 'WINNER': {
        const w = r.winnerCandidateIds[0], d = diffText(row, r), ru = r.marginSummary && r.marginSummary.runnerUpCandidateId;
        explanationText = `${nm(w)} possui ${phrase} entre os lotes comparados${d && ru ? `, ${d} de ${nm(ru)}` : ''}.`;
        if (r.dataSufficiency.partial) explanationText = `${nm(w)} possui ${phrase} entre os ${r.dataSufficiency.validCandidates} lotes com dados.`;
        highlightMode = ['P0', 'P1'].includes(r.priority) ? 'strong' : 'subtle'; break;
      }
      case 'TIE': explanationText = r.tieState === 'ALL_TIED' ? `Empate técnico em ${row.label}.` : `Empate entre ${list(r.winnerCandidateIds)}.`; highlightMode = r.tieState === 'ALL_TIED' ? 'none' : 'subtle'; break;
      case 'NO_CLEAR_WINNER': explanationText = `Sem diferença relevante em ${row.label} entre os lotes.` + (!client && r.slightAdvantageCandidateId ? ` Ligeira vantagem de ${nm(r.slightAdvantageCandidateId)}.` : ''); break;
      case 'INSUFFICIENT_DATA': explanationText = client ? null : 'Não é possível destacar um lote neste critério porque faltam dados.'; break;
      case 'CONTEXT_REQUIRED': explanationText = client ? null : row.metadata.customerContextRequired ? 'Disponível quando há um perfil de cliente.' : 'Este atributo depende da preferência do cliente.'; break;
      case 'SUPPRESSED': {
        const why = r.suppressionReasons.includes('STALE_DATA') ? 'dados desatualizados' : r.suppressionReasons.includes('CONFLICTED_DATA') ? 'dados divergentes' : r.suppressionReasons.includes('LOW_CONFIDENCE') ? 'baixa confiabilidade da estimativa'
          : r.suppressionReasons.includes('PARTIAL_DATA') ? 'falta de dados em parte dos lotes' : r.suppressionReasons.includes('VERSION_MISMATCH') ? 'versões de dados diferentes' : 'uma regra de segurança';
        explanationText = client ? null : `Não foi possível destacar um lote devido a ${why}.`; break;
      }
      case 'ERROR': explanationText = client ? null : 'Destaque indisponível para este critério.'; break;
      default: explanationText = technical ? (r.suppressionReasons.includes('NON_ORDERED_METRIC') ? 'Atributo descritivo, sem ordem de preferência.' : 'Informativo, sem destaque.') : null;
    }
    const showCaveats = client ? r.evaluationStatus === 'WINNER' : !['NOT_COMPARABLE', 'CONTEXT_REQUIRED'].includes(r.evaluationStatus);
    const caveats = showCaveats ? r.caveats.filter(c => CAVEAT[c]).map(c => CAVEAT[c](audience, r)) : [];
    const p = r.policy || {};
    const policyText = technical && p.tie ? [`Regra: ${SEM_PT[p.resolvedSemantics] || SEM_PT[r.winnerSemantics] || r.winnerSemantics}`, `empate: ${tieText(p.tie, row)}`, `margem: ${marginText(p.margin, row)}`,
      `confiança mínima: ${CONF_PT[((p.confidence || {}).minimum || {})[audience]] || 'não exigida'}`, `confiança do resultado: ${CONF_PT[r.evaluationConfidence]}`, `política ${p.version || '—'}`].join(' · ')
      + (r.suppressionReasons.length ? ` · motivos: ${r.suppressionReasons.map(x => REASON_PT[x] || x).join(', ')}` : '') + (r.resolvedPreference ? ` · preferência: ${r.resolvedPreference.rationaleCode}` : '')
      : technical ? `Regra: ${SEM_PT[r.winnerSemantics] || 'não registrada'}${r.suppressionReasons.length ? ' · motivos: ' + r.suppressionReasons.map(x => REASON_PT[x] || x).join(', ') : ''}` : null;
    if (client && r.evaluationStatus !== 'WINNER') highlightMode = 'none';
    return { explanationText, caveatText: caveats.length ? caveats.join(' ') : null, highlightMode, policyText };
  }
  const tieText = (tp, row) => tp.type === 'EXACT' ? 'só valores iguais' : tp.type === 'ABSOLUTE_TOLERANCE' ? `até ${row.valueType === 'MONEY' ? F.formatBRL(tp.absoluteTolerance, true) : F.number(tp.absoluteTolerance, tp.absoluteTolerance % 1 ? 1 : 0)}`
    : tp.type === 'RELATIVE_TOLERANCE' ? `até ${F.number(tp.relativeTolerancePct, 1)}%` : tp.type === 'ABSOLUTE_OR_RELATIVE' ? `até ${F.number(tp.absoluteTolerance)} ou ${F.number(tp.relativeTolerancePct, 1)}%` : tp.type === 'TARGET_DISTANCE' ? `distância à meta até ${F.number(tp.targetDistanceTolerance)}` : tp.type;
  const marginText = (mp, row) => [mp.minimumAbsoluteDifference != null ? `≥ ${row.valueType === 'MONEY' ? F.formatBRL(mp.minimumAbsoluteDifference) : F.number(mp.minimumAbsoluteDifference, mp.minimumAbsoluteDifference % 1 ? 1 : 0)}` : null,
    mp.minimumRelativeDifferencePct != null ? `≥ ${F.number(mp.minimumRelativeDifferencePct, 1)}%` : null, mp.minimumOrdinalStep != null ? `≥ ${mp.minimumOrdinalStep} nível` : null, mp.targetDistanceDifference != null ? `≥ ${F.number(mp.targetDistanceDifference)} da meta` : null].filter(Boolean).join(' e ') || 'sem margem';
  const BADGE = { client: { WINNER: 'Destaque' }, presentation: { WINNER: 'Destaque' }, broker: { WINNER: 'Destaque', CO_WINNER: 'Empate', CLOSE: 'Ligeira vantagem' }, technical: { WINNER: 'Vencedor', CO_WINNER: 'Co-vencedor', CLOSE: 'Ligeira vantagem' } };
  function cellState(r, a, c, audience) {
    const client = audience === 'client' || audience === 'presentation';
    if (c.valueStatus === 'CONFLICTED') return 'CONFLICTED';
    if (['NO_DATA', 'UNKNOWN', 'ERROR'].includes(c.valueStatus) || c.comparableState === 'CONTEXT_MISSING') return 'NO_DATA';
    if (!r || !a) return c.uiHints.stale ? 'STALE' : 'NORMAL';
    if (r.evaluationStatus === 'SUPPRESSED') return client ? (c.uiHints.stale ? 'STALE' : 'NORMAL') : 'SUPPRESSED';
    if (r.evaluationStatus === 'WINNER') return a.assessmentState === 'BEST' ? 'WINNER' : client ? 'NORMAL' : 'WEAKER'; // "weaker" is never shown as "ruim"
    if (r.evaluationStatus === 'TIE') return r.tieState === 'TOP_TIED' && a.assessmentState === 'CO_BEST' && !client ? 'CO_WINNER' : 'NORMAL';
    if (r.evaluationStatus === 'NO_CLEAR_WINNER') return !client && r.slightAdvantageCandidateId === a.candidateId ? 'CLOSE' : 'NORMAL';
    return c.uiHints.stale ? 'STALE' : 'NORMAL';
  }

  /** build(input) → EvaluatedComparisonViewModel.
      input = { matrix, snapshot, evaluation, session, audience, profiles?: bool, filterActive?: bool } (built by App.compare.viewModel.fromState) */
  function build({ matrix, snapshot, evaluation, session, audience = 'broker' }) {
    const client = audience === 'client' || audience === 'presentation', technical = audience === 'technical';
    const pol = D.policyOf(session.developmentId), names = Object.fromEntries(matrix.candidateColumns.map(c => [c.candidateId, c.displayCode]));
    const results = evaluation ? evaluation.metricResults : {};
    const sums = evaluation ? new Map(evaluation.summary.candidateSummaries.map(s => [s.candidateId, s])) : new Map();
    const n = matrix.candidateColumns.length;
    const candidates = matrix.candidateColumns.map((c, i) => {
      const s = c.summary, av = s.availability || {}, cm = s.commercial || {}, cs = sums.get(c.candidateId);
      const statusWarn = av.status === 'UNKNOWN' || (av.status === 'AVAILABLE' && av.freshness !== 'FRESH') || av.freshness === 'STALE' || av.freshness === 'EXPIRED';
      return { id: c.candidateId, name: c.displayCode, order: i + 1, missing: c.validationState === 'MISSING',
        title: c.validationState === 'MISSING' ? 'Lote não encontrado nos dados atuais' : c.displayCode,
        statusCode: av.status || null, statusLabel: statusText(av.status, av.freshness, audience), statusWarn, offerable: av.status ? App.availability.isOfferable(av.status) : false,
        priceText: cm.price != null ? F.formatBRL(cm.price) : 'Preço não disponível', priceNote: cm.freshness && cm.freshness !== 'FRESH' ? (client ? 'Valor sujeito a confirmação' : cm.freshness === 'EXPIRED' ? 'Tabela vencida' : 'Última tabela disponível') : null,
        areaText: cm.areaM2 != null ? F.formatSquareMeters(cm.areaM2, 2) : F.ND,
        outsideFilter: s.matchesCurrentFilters === false, recommendationText: !client && s.recommendation && s.recommendation.rank != null ? `Recomendação: ${s.recommendation.rank}º${s.recommendation.tier === 'REVIEW_REQUIRED' ? ' (revisar)' : ''}` : null,
        canMoveLeft: i > 0, canMoveRight: i < n - 1,
        criterionSummary: cs ? { clearWins: cs.clearWins, coWins: cs.coWins, slightAdvantages: cs.slightAdvantages, text: cs.clearWins ? `Destaque em ${cs.clearWins} ${cs.clearWins === 1 ? 'critério' : 'critérios'}` : null } : null };
    });
    const rowEvaluations = [];
    const groups = matrix.groups.map(g => {
      const rows = matrix.rows.filter(r => r.groupId === g.id && (technical || !r.metadata.hiddenInNormalMode)).map(row => {
        const r = results[row.metricId] || null, tx = r ? rowTexts(row, r, names, audience) : { explanationText: null, caveatText: null, highlightMode: 'none', policyText: null };
        const cells = row.cells.map(c => {
          const a = r ? r.assessments.find(x => x.candidateId === c.candidateId) : null, st = cellState(r, a, c, audience), badge = tx.highlightMode === 'none' && st !== 'WINNER' ? null : (BADGE[audience] || BADGE.broker)[st] || null;
          const text = cellText(row, c, audience), note = staleNote(c, audience);
          const badgeA11y = !badge ? '' : st === 'WINNER' ? ` Destaque neste critério: ${names[c.candidateId]} possui ${EV.phraseOf(r, row.label)}.` : st === 'CO_WINNER' ? ` Empate entre ${r.winnerCandidateIds.map(id => names[id]).join(' e ')}.` : ' Ligeira vantagem neste critério.';
          return { candidateId: c.candidateId, text, note, cellState: st, badge, stale: !!c.uiHints.stale, emphasis: !!c.uiHints.emphasis,
            ariaLabel: `${row.label}, ${names[c.candidateId]}, ${text}${note ? ' (' + note + ')' : ''}.${badgeA11y}${st === 'WEAKER' ? ' Valor menos favorável neste critério.' : ''}` };
        });
        const rv = { metricId: row.metricId, status: r ? r.evaluationStatus : null, winnerCandidateIds: r ? r.winnerCandidateIds.slice() : [], cellStates: cells.map(c => c.cellState), explanationText: tx.explanationText, caveatText: tx.caveatText, highlightMode: tx.highlightMode, policyText: tx.policyText };
        rowEvaluations.push(rv);
        return { metricId: row.metricId, label: row.label, description: row.description, emphasis: row.metadata.emphasis, hiddenInNormalMode: row.metadata.hiddenInNormalMode, cells, evaluation: rv };
      });
      return { id: g.id, label: g.label, collapsedByDefault: g.collapsedByDefault, empty: !rows.length, emptyText: !rows.length ? 'Sem dados disponíveis' : null, rows };
    }).filter(g => technical || !g.empty);
    // criterion highlights (top 3–5 facts, grouped by lot; no overall best)
    const hl = evaluation ? EV.highlights(evaluation, { audience }) : [];
    const criterionHighlights = hl.map(h => ({ candidateId: h.candidateId, name: names[h.candidateId], items: h.metricIds.map(id => { const row = matrix.rows.find(r => r.metricId === id); return EV.phraseOf(results[id], row ? row.label : id); }) }));
    const sum = D.summary(session, snapshot);
    const warnings = [];
    if (snapshot.status === 'STALE') warnings.push(client ? 'Alguns valores estão sujeitos a confirmação.' : 'Há dados comerciais que podem estar desatualizados: os destaques de preço seguem a política de atualização.');
    if (snapshot.completenessSummary.partialMetricIds.length) warnings.push(D.MESSAGES.PARTIAL);
    if (snapshot.missingCandidateIds.length) warnings.push('Um lote da comparação não foi encontrado nos dados atuais.');
    if (!technical && snapshot.mixedVersion) warnings.push('Os lotes usam versões de dados diferentes; destaques afetados foram suprimidos.');
    if (technical && snapshot.mixedVersion) warnings.push(`Versões divergentes: ${snapshot.mixedVersionKeys.join(', ')}.`);
    if (candidates.some(c => c.statusWarn)) warnings.push(client ? 'Disponibilidade sujeita a confirmação.' : 'Disponibilidade sujeita a confirmação para os lotes sem status confirmado.');
    if (candidates.some(c => c.outsideFilter)) { const out = candidates.filter(c => c.outsideFilter).map(c => c.name); warnings.push(`${out.join(', ')} ${out.length === 1 ? 'está fora' : 'estão fora'} dos filtros atuais.`); }
    const fitRow = matrix.rows.find(r => r.metricId === 'fitScore');
    const fitNote = fitRow && !fitRow.metadata.contextMissing ? 'Compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.' : null;
    const comp = snapshot.completenessSummary;
    const actions = [{ id: 'share', label: 'Compartilhar comparação', act: 'shareCmp' }, { id: 'clear', label: 'Limpar comparação', act: 'cmpClear' }];
    return {
      sessionId: session.id, title: 'Comparar lotes', mode: audience, status: snapshot.status, countLabel: `${n} de ${pol.maxCandidates}`, canCompare: sum.canCompare, summaryMessage: sum.message,
      candidates, groups, rowEvaluations, candidateSummaries: evaluation ? evaluation.summary.candidateSummaries : [], criterionHighlights, highlightsNote: criterionHighlights.length ? 'Destaques por critério; não indicam um lote melhor no geral.' : null,
      warnings, fitNote, actions,
      profiles: technical || !client ? D.PROFILES.filter(p => audience === 'technical' || p.mode !== 'technical').filter(p => p.id !== 'CUSTOMER' || !client).map(p => ({ id: p.id, label: p.label, selected: p.id === session.metricProfileId })) : [],
      freshness: { commercial: snapshot.freshnessSummary.commercial, availability: snapshot.freshnessSummary.availability },
      completeness: { coverageRatio: comp.coverageRatio, text: client ? null : comp.coverageRatio == null ? null : `${Math.round(comp.coverageRatio * 100)}% dos dados exibidos disponíveis` },
      footnote: client ? 'Valores de preço são de tabela. Análises de ruído, privacidade e sol são estimativas.' : 'Destaque = vantagem clara naquele critério, segundo regra explícita; empates e diferenças pequenas não recebem destaque. Não há lote "melhor" no geral. É leitura da análise, não promessa de valorização.',
      technical: technical ? { snapshotHash: snapshot.hash, evaluationPolicyVersion: evaluation && evaluation.evaluationPolicyVersion, dataVersions: snapshot.dataVersions, recomputedMetricIds: evaluation && evaluation.recomputedMetricIds } : null,
      baseComparison: { candidates: matrix.candidateColumns, groups: matrix.groups }, evaluationPolicyVersion: evaluation ? evaluation.evaluationPolicyVersion : null
    };
  }

  /** fromState(input) → { vm, session, snapshot, matrix, evaluation, rejected }: the single call the UI needs.
      input = { developmentId, lotIds (ordered), resolve(idOrCode)→Lot, audience ('client'|'broker'|'technical'|'presentation'), metricProfileId?, scoreKey?,
                fitById? (Map), customerProfile? (CustomerProfile; only preferences/profileVersion are read), recommendation?, filter? { active, matchedIds:Set },
                activeLayerId?, previous? (the previous return value, for session identity and selective recompute), now? } */
  function fromState(input) {
    const prev = input.previous || null, audience = input.audience || 'broker';
    const cp = input.customerProfile && input.customerProfile.profileVersion && (input.customerProfile.preferences || []).some(p => p.enabled !== false) ? input.customerProfile : null;
    const profileId = input.metricProfileId || (prev && prev.session && prev.session.metricProfileId) || (audience === 'client' || audience === 'presentation' ? 'CUSTOMER' : audience === 'technical' ? 'TECHNICAL' : 'BROKER_STANDARD');
    const { session, rejected } = D.syncFromIds(prev && prev.session, input.developmentId, input.lotIds || [], { resolve: input.resolve, now: input.now, metricProfileId: profileId,
      context: { mode: input.contextMode || (cp ? (input.recommendation ? 'RECOMMENDATION' : 'CUSTOMER') : audience === 'technical' ? 'TECHNICAL' : audience === 'presentation' ? 'PRESENTATION' : 'GENERAL'), customerProfileVersion: cp ? cp.profileVersion : null,
        activeLayerId: input.activeLayerId || null, scoreKey: input.scoreKey || 'housing' } });
    if (!session.candidates.length) return { vm: null, session, snapshot: null, matrix: null, evaluation: null, rejected };
    const snapshot = D.buildSnapshot(session, { resolve: input.resolve, fitById: input.fitById || null, recommendation: input.recommendation || null, filter: input.filter || null, now: input.now });
    const matrix = D.buildMatrix(session, snapshot, { audience });
    const evaluation = session.candidates.length >= 2 ? EV.evaluate(snapshot, { audience, customerProfile: cp, evaluationProfileId: session.metricProfileId, previous: prev && prev.evaluation, now: input.now, metricIds: matrix.rows.filter(r => !r.metadata.duplicateOf && (audience === 'technical' || !r.metadata.hiddenInNormalMode)).map(r => r.metricId) }) : null; // only visible, evaluable metrics
    const vm = build({ matrix, snapshot, evaluation, session, audience });
    if (rejected.length) vm.warnings.unshift(...rejected.map(r => r.code === 'COMPARISON_LIMIT_REACHED' ? D.MESSAGES.COMPARISON_LIMIT_REACHED(D.policyOf(input.developmentId).maxCandidates) : r.code === 'DUPLICATE' ? D.MESSAGES.DUPLICATE : 'Um lote do link não existe neste empreendimento e foi ignorado.'));
    return { vm, session, snapshot, matrix, evaluation, rejected };
  }
  return Object.freeze({ build, fromState, formatValue, cellText, statusText, rowTexts });
})();

/* ---- presentation/compareView.js ---- */
/* presentation/compareView.js — renders the EvaluatedComparisonViewModel (App.compare.viewModel) as HTML strings.
   Same view model on desktop, tablet and mobile: only CSS changes (cards scroll horizontally on narrow screens; each group
   is a <details> with its own accessible table: lots are column headers, criteria are row headers).
   Buttons use the app's delegated data-act actions: goLot, cmpRemove, cmpMove (data-dir -1|1), cmpProfile (data-v), shareCmp, cmpClear.
   Highlights are badges with text (never color alone) and there is no overall "best lot". Markup only, no DOM access in render. */
App.compareView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ComparisonUiState (kept apart from the domain): open groups, chosen metric profile, focused candidate
  const ui = { profileId: null, expanded: {}, focusedCandidateId: null, layoutVariant: null };
  let last = null; // previous fromState result (session identity + selective re-evaluation)

  function cand(c, vm) {
    const client = vm.mode === 'client' || vm.mode === 'presentation';
    return `<li class="cmpv-cand${c.missing ? ' missing' : ''}" data-id="${esc(c.id)}">
      <div class="cmpv-ch"><span class="pinlbl" aria-hidden="true">${c.order}</span><button class="lbtn nm" data-act="goLot" data-id="${esc(c.id)}" aria-label="Abrir ${esc(c.name)} no mapa">${esc(c.title)}</button></div>
      <p class="cmpv-st${c.statusWarn ? ' warn' : ''}"><span class="vh">Situação: </span>${esc(c.statusLabel)}</p>
      <p class="cmpv-pr"><span class="vh">Preço de tabela: </span>${esc(c.priceText)}${c.priceNote ? ` <span class="small">(${esc(c.priceNote)})</span>` : ''}</p>
      <p class="small"><span class="vh">Área: </span>${esc(c.areaText)}</p>
      ${c.criterionSummary && c.criterionSummary.text ? `<p class="cmpv-cs">${esc(c.criterionSummary.text)}</p>` : ''}
      ${c.outsideFilter ? `<p class="small warnl">Fora dos filtros atuais</p>` : ''}${!client && c.recommendationText ? `<p class="small">${esc(c.recommendationText)}</p>` : ''}
      <div class="cmpv-ca" role="group" aria-label="Ações de ${esc(c.name)}">
        <button class="lbtn small" data-act="cmpMove" data-id="${esc(c.id)}" data-dir="-1"${c.canMoveLeft ? '' : ' disabled'} aria-label="Mover ${esc(c.name)} para a esquerda" title="Mover para a esquerda">◀</button>
        <button class="lbtn small" data-act="cmpMove" data-id="${esc(c.id)}" data-dir="1"${c.canMoveRight ? '' : ' disabled'} aria-label="Mover ${esc(c.name)} para a direita" title="Mover para a direita">▶</button>
        <button class="lbtn small" data-act="cmpRemove" data-id="${esc(c.id)}" aria-label="Remover ${esc(c.name)} da comparação">Remover</button>
      </div></li>`;
  }
  function row(r, vm, cols) {
    const ev = r.evaluation, tech = vm.mode === 'technical';
    const cells = r.cells.map(c => `<td class="cs-${c.cellState.toLowerCase()}${c.emphasis ? ' emph' : ''}" aria-label="${esc(c.ariaLabel)}"><span class="v">${esc(c.text)}</span>${c.note ? `<span class="nt">${esc(c.note)}</span>` : ''}${c.badge ? `<span class="bdg bdg-${c.cellState.toLowerCase()}">${c.cellState === 'WINNER' ? '★ ' : c.cellState === 'CO_WINNER' ? '= ' : '≈ '}${esc(c.badge)}</span>` : ''}</td>`).join('');
    const why = [ev.explanationText, ev.caveatText, tech ? ev.policyText : null].filter(Boolean);
    return `<tr class="${r.emphasis ? 'emph ' : ''}hl-${ev.highlightMode}"><th scope="row">${esc(r.label)}${r.emphasis ? ' <span class="vh">(camada ativa no mapa)</span>' : ''}${tech && r.hiddenInNormalMode ? ' <span class="small">(oculto fora do modo técnico)</span>' : ''}</th>${cells}</tr>`
      + (why.length ? `<tr class="cmpv-why"><td colspan="${cols + 1}">${why.map((x, i) => `<span class="${i ? 'small' : ''}">${esc(x)}</span>`).join(' ')}</td></tr>` : '');
  }
  function group(g, vm) {
    const open = ui.expanded[g.id] != null ? ui.expanded[g.id] : !g.collapsedByDefault, names = vm.candidates.map(c => c.name);
    const body = g.empty ? `<p class="small cmpv-empty">${esc(g.emptyText)}</p>` : `<div class="cmpv-scroll" role="region" aria-label="${esc(g.label)}" tabindex="0"><table class="cmpv-t">
      <caption class="vh">${esc(g.label)}: comparação entre ${esc(names.join(', '))}</caption>
      <thead><tr><th scope="col"><span class="vh">Critério</span></th>${vm.candidates.map(c => `<th scope="col"><span class="pinlbl" aria-hidden="true">${c.order}</span> ${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>${g.rows.map(r => row(r, vm, vm.candidates.length)).join('')}</tbody></table></div>`;
    return `<details class="cmpv-grp" data-group="${esc(g.id)}"${open ? ' open' : ''}><summary><span>${esc(g.label)}</span> <span class="small">${g.rows.length} ${g.rows.length === 1 ? 'critério' : 'critérios'}</span></summary>${body}</details>`;
  }
  /** render(vm) → HTML string (content of the comparison overlay body). vm = null renders the empty state. */
  function render(vm) {
    if (!vm) return `<div class="cmpv"><p class="empty">Adicione até 4 lotes pelo botão Comparar no painel do lote.</p></div>`;
    let h = `<div class="cmpv" data-mode="${esc(vm.mode)}" data-status="${esc(vm.status)}">`;
    h += `<div class="cmpv-top"><p class="small cmpv-count">${esc(vm.countLabel)} lotes${vm.canCompare ? '' : ' · ' + esc(vm.summaryMessage)}</p>`;
    if (vm.profiles && vm.profiles.length) h += `<div class="cmpv-prof" role="group" aria-label="Conjunto de critérios">${vm.profiles.map(p => `<button class="chip" data-act="cmpProfile" data-v="${esc(p.id)}" aria-pressed="${p.selected}">${esc(p.label)}</button>`).join('')}</div>`;
    h += `</div>`;
    if (vm.warnings.length) h += `<ul class="cmpv-warn" role="status">${vm.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    if (vm.criterionHighlights.length) h += `<section class="cmpv-hl" aria-labelledby="cmpvHl"><h3 id="cmpvHl">Destaques por critério</h3><ul>${vm.criterionHighlights.map(x => `<li><b>${esc(x.name)}</b>: ${esc(x.items.join('; '))}</li>`).join('')}</ul>${vm.highlightsNote ? `<p class="small">${esc(vm.highlightsNote)}</p>` : ''}</section>`;
    h += `<ol class="cmpv-cands" aria-label="Lotes em comparação">${vm.candidates.map(c => cand(c, vm)).join('')}</ol>`;
    if (vm.canCompare) h += vm.groups.map(g => group(g, vm)).join('');
    if (vm.fitNote) h += `<p class="small">${esc(vm.fitNote)}</p>`;
    h += `<div class="acts2">${vm.actions.map(a => `<button class="btn" data-act="${esc(a.act)}">${esc(a.label)}</button>`).join('')}</div>`;
    if (vm.completeness && vm.completeness.text) h += `<p class="small">${esc(vm.completeness.text)}</p>`;
    if (vm.technical) h += `<p class="small cmpv-tech">Snapshot ${esc(vm.technical.snapshotHash)} · política de destaque ${esc(fmtV(vm.technical.evaluationPolicyVersion))} · análise ${esc(fmtV(vm.technical.dataVersions.analysisVersion))} · tabela ${esc(fmtV(vm.technical.dataVersions.priceTableVersion))}</p>`;
    h += `<p class="small">${esc(vm.footnote)}</p></div>`;
    return h;
  }
  const fmtV = v => Array.isArray(v) ? v.join(' / ') + ' (divergentes)' : v == null || v === '' ? '—' : v; // a real 0 is a value (topic 37)

  /** view(input) → { html, result }: builds the view model with App.compare.viewModel.fromState (remembering the previous result
      and the UI profile choice) and renders it. input: see App.compare.viewModel.fromState. */
  function view(input) {
    const res = App.compare.viewModel.fromState({ ...input, metricProfileId: input.metricProfileId || ui.profileId || undefined, previous: last && last.session && last.session.developmentId === input.developmentId ? last : null });
    last = res;
    return { html: render(res.vm), result: res };
  }
  /** handle(el, appState) for the delegated actions cmpMove / cmpProfile → { patch?, rerender? } (the caller applies the patch to the app store) */
  function handle(el, st) {
    const act = el && el.dataset ? el.dataset.act : null;
    if (act === 'cmpMove') {
      const ids = (st.comparisonLotIds || []).slice(), i = ids.indexOf(el.dataset.id), j = i + (Number(el.dataset.dir) < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= ids.length) return { patch: null, rerender: false };
      [ids[i], ids[j]] = [ids[j], ids[i]]; ui.focusedCandidateId = el.dataset.id;
      return { patch: { comparisonLotIds: ids }, rerender: false, focus: { act: 'cmpMove', id: el.dataset.id, dir: el.dataset.dir } };
    }
    if (act === 'cmpProfile') { if (App.compare.domain.profile(el.dataset.v)) ui.profileId = el.dataset.v; return { patch: null, rerender: true }; }
    return { patch: null, rerender: false };
  }
  /** bind(root): remembers which groups are open across re-renders (toggle does not bubble: captured once per root) and
      restores keyboard focus on the moved candidate's button. Idempotent. */
  function bind(root) {
    if (!root) return;
    if (!root.__cmpvBound) {
      root.__cmpvBound = true;
      root.addEventListener('toggle', e => { const d = e.target; if (d && d.classList && d.classList.contains('cmpv-grp')) ui.expanded[d.dataset.group] = d.open; }, true);
    }
    if (ui.focusedCandidateId && root.querySelector) {
      const b = root.querySelector(`.cmpv-cand[data-id="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(ui.focusedCandidateId) : ui.focusedCandidateId}"] [data-act="cmpMove"]:not([disabled])`);
      if (b) b.focus(); ui.focusedCandidateId = null;
    }
  }
  const reset = () => { last = null; ui.profileId = null; ui.expanded = {}; };
  return { render, view, handle, bind, reset, ui, esc };
})();

/* ---- chunk end ---- */
App.chunks._done("comparison");
