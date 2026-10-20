/* rules/ruleCore.js — Rule Engine core (topic 36).
   Declarative, versioned, deterministic. A rule is data: a closed AST (LOGICAL / COMPARISON /
   EXISTS / PREDICATE) over safe operands (ATTRIBUTE from the Field Registry, METRIC from the
   RuleMetricRegistry, CONFIG from the RuleVersion parameters, LITERAL, CONTEXT). No eval, no
   Function, no client-sent code: operators, predicates, metrics and formatters are closed registries.

   Truth is never a bare boolean: TRUE / FALSE / UNKNOWN / ERROR / NOT_APPLICABLE (Kleene logic).
   null is never false: a comparison over a missing value is UNKNOWN, and the rule's unknownPolicy
   (explicit per rule) decides what UNKNOWN produces.

   The engine is pure: it does not fetch, persist, notify, read the clock or mutate the target.
   Lifecycle (AlertInstance), suppression and projection live in rules/alertDomain.js.

   API (App.ruleEngine):
     compile(ruleDefinition, ruleVersion) → CompiledRuleVersion (frozen) | throws RULE_INVALID with errors
     validate(ruleDefinition, ruleVersion) → { ok, errors, warnings }
     evaluate(compiled, input, opts) → RuleEvaluationResult
     render(compiled, input, audience) → message (from the same resolved facts; no recomputation)
     dependencyIndex(compiledList) / plan(index, changeEvent) → selective re-evaluation
     ruleSetRegistry(tenant) → RuleDefinition / RuleVersion / RuleSetVersion lifecycle and current pointer */
App.ruleEngine = (() => {
  const ENGINE_ID = 'rule-engine', ENGINE_VERSION = '1.0.0', AST_VERSION = '1.0';
  const TRUTH = Object.freeze({ TRUE: 'TRUE', FALSE: 'FALSE', UNKNOWN: 'UNKNOWN', ERROR: 'ERROR', NOT_APPLICABLE: 'NOT_APPLICABLE' });
  const EXECUTION_MODES = Object.freeze(['SHADOW', 'TECHNICAL_ONLY', 'PUBLISHED', 'REPLAY']);
  const RULE_VERSION_STATUS = Object.freeze(['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED', 'REJECTED']);
  const CATEGORIES = Object.freeze(['COMMERCIAL', 'AVAILABILITY', 'LOCATION', 'MOBILITY', 'ENVIRONMENTAL', 'GEOMETRY', 'CONSTRUCTION', 'PRICING', 'DATA_QUALITY', 'SOURCE_QUALITY', 'ANALYTICAL', 'CUSTOMER_CONTEXT', 'OPERATIONAL']);
  // Severity: the platform's existing AlertSeverity enum (domain/enums.js) is kept for zero-delta.
  // Spec mapping: INFO=INFO, ATTENTION≈NOTICE, IMPORTANT≈WARNING, CRITICAL=CRITICAL.
  const SEVERITIES = App.enums.SEVERITY_ORDER; // CRITICAL first
  const UNKNOWN_BEHAVIORS = Object.freeze(['NO_ALERT', 'CREATE_DATA_QUALITY_ALERT', 'CREATE_REVIEW_ALERT', 'BLOCK_EVALUATION']);
  const CONTEXT_TYPES = Object.freeze(['BASE', 'CUSTOMER', 'SHARE']);
  const AUDIENCES = Object.freeze(['CLIENT', 'BROKER', 'TECHNICAL']);
  const VALUE_TYPES = Object.freeze(['NUMBER', 'BOOLEAN', 'ENUM', 'STRING', 'LIST', 'DATETIME', 'STRING_LIST', 'ENUM_LIST']);

  const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});
  const checksum = v => App.methodology.checksum(v);
  const freeze = o => App.domain.deepFreeze(o);
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  // ---------------------------------------------------------------- metric registry (closed, versioned)
  // domain: which upstream domain a metric reads (drives the dependency manifest and selective re-evaluation).
  const ANALYSIS = 'LOT_INTELLIGENCE_BASE';
  const METRICS = new Map();
  function defMetric(id, valueType, domain, fieldKey, description, extra = {}) {
    METRICS.set(id, Object.freeze({ id, version: extra.version || '1.0', valueType, domain, analysisDefinitionId: domain === 'ANALYSIS' ? ANALYSIS : null, fieldKey, description, unit: extra.unit || null, enumValues: extra.enumValues || null }));
  }
  const LEVELS = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  defMetric('ANALYSIS_NOTE_QUIET', 'NUMBER', 'ANALYSIS', 'environmental.quietScore', 'Nota de silêncio (0–10, sem arredondamento) da análise publicada');
  defMetric('ANALYSIS_NOTE_PRIVACY', 'NUMBER', 'ANALYSIS', 'environmental.privacyScore', 'Nota de privacidade (0–10, sem arredondamento)');
  defMetric('ANALYSIS_NOTE_GEOMETRY', 'NUMBER', 'ANALYSIS', 'geometry.usableGeometryScore', 'Nota de geometria aproveitável (0–10, sem arredondamento)');
  defMetric('STRONG_AFTERNOON_SUN', 'BOOLEAN', 'ANALYSIS', 'environmental.afternoonSun', 'Frente ou fundos voltados para o sol forte da tarde (oeste/noroeste)');
  defMetric('STRONG_AFTERNOON_SIDE', 'ENUM', 'ANALYSIS', 'environmental.afternoonSun', 'Lado com sol forte da tarde', { enumValues: ['FRONT', 'BACK'] });
  defMetric('DISTANCE_TECHNICAL_AREA_M', 'NUMBER', 'ANALYSIS', 'location.distanceToTechnicalAreaM', 'Distância linear até a EEEB', { unit: 'm' });
  defMetric('DISTANCE_EXTERNAL_ROAD_M', 'NUMBER', 'ANALYSIS', 'location.distanceToExternalRoadM', 'Distância linear até a Av. Porto Dourado', { unit: 'm' });
  defMetric('ADJACENT_PROJECTED_EASEMENT', 'BOOLEAN', 'ANALYSIS', 'construction.easements', 'Lote junto à servidão projetada da planta');
  defMetric('ESTIMATED_TRAFFIC', 'ENUM', 'ANALYSIS', 'mobility.estimatedTraffic', 'Fluxo estimado de veículos na rua', { enumValues: LEVELS });
  defMetric('FRONT_WIDTH_M', 'NUMBER', 'ANALYSIS', 'geometry.frontBoxWidthM', 'Largura da frente medida na planta (sem arredondamento)', { unit: 'm' });
  defMetric('SHAPE_CLASS', 'ENUM', 'ANALYSIS', 'geometry.shape', 'Forma do lote', { enumValues: ['CORNER', 'TRAPEZOIDAL', 'IRREGULAR', 'SQUARE', 'RECTANGULAR'] });
  defMetric('IS_CORNER', 'BOOLEAN', 'ANALYSIS', 'geometry.isCorner', 'Lote de esquina');
  defMetric('HAS_TWO_FRONTS', 'BOOLEAN', 'ANALYSIS', 'geometry.frontCount', 'Frente para duas ruas');
  defMetric('REAR_CLASS', 'ENUM', 'ANALYSIS', 'surroundings.rearNeighborType', 'O que existe nos fundos', { enumValues: ['LOT', 'CONDO_GREEN', 'GREEN_EXTERNAL', 'PERIMETER', 'COMMON_AREA', 'STREET', 'UNKNOWN'] });
  defMetric('AREA_M2', 'NUMBER', 'ANALYSIS', 'geometry.areaM2', 'Área oficial do lote', { unit: 'm²' });
  defMetric('NOISE_SOURCES', 'LIST', 'ANALYSIS', 'environmental.noiseSources', 'Fontes de ruído que reduziram a nota de silêncio (traço da análise)');
  defMetric('COMMERCIAL_FRESHNESS_TRACKED', 'BOOLEAN', 'PRICING', 'commercial.priceTableVersion', 'A sessão acompanha a atualidade do dado comercial');
  defMetric('COMMERCIAL_FRESHNESS', 'ENUM', 'PRICING', 'commercial.priceTableVersion', 'Atualidade do dado comercial nesta sessão', { enumValues: ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN'] });
  const ATTRIBUTE_DOMAIN = path => path.startsWith('availability.') ? 'AVAILABILITY' : path.startsWith('commercial.') ? 'PRICING' : path.startsWith('intelligence.') ? 'ANALYSIS' : 'STATIC';
  const CONTEXT_KEYS = Object.freeze({ AS_OF: 'DATETIME', AUDIENCE: 'ENUM', CUSTOMER_BUDGET_MAX: 'NUMBER' }); // CUSTOMER_* only in customer-context rules

  // ---------------------------------------------------------------- operators and predicates (closed)
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const OPERATORS = Object.freeze({
    EQ: { arity: 2, types: null, fn: (a, b) => a === b },
    NEQ: { arity: 2, types: null, fn: (a, b) => a !== b },
    GT: { arity: 2, types: ['NUMBER', 'DATETIME'], fn: (a, b) => a > b },
    GTE: { arity: 2, types: ['NUMBER', 'DATETIME'], fn: (a, b) => a >= b },
    LT: { arity: 2, types: ['NUMBER', 'DATETIME'], fn: (a, b) => a < b },
    LTE: { arity: 2, types: ['NUMBER', 'DATETIME'], fn: (a, b) => a <= b },
    BETWEEN: { arity: 2, types: ['NUMBER'], list: true, fn: (a, b) => a >= b[0] && a <= b[1] },
    IN: { arity: 2, types: null, list: true, fn: (a, b) => b.includes(a) },
    NOT_IN: { arity: 2, types: null, list: true, fn: (a, b) => !b.includes(a) }
  });
  /** predicates: semantics stated explicitly, including how a missing value is read */
  const PREDICATES = Object.freeze({
    // absence of confirmation IS the condition: null/UNKNOWN/STALE/EXPIRED are all "not confirmed fresh"
    IS_NOT_CONFIRMED_FRESH: { version: '1.0', args: 1, nullMeans: 'TRUE', run: ([v]) => v !== 'FRESH' ? TRUTH.TRUE : TRUTH.FALSE },
    // UNKNOWN is never offerable (topic 8); a missing status is UNKNOWN, not false
    IS_OFFERABLE: { version: '1.0', args: 1, nullMeans: 'UNKNOWN', run: ([v], cfg) => v == null ? TRUTH.UNKNOWN : App.availability.isOfferable(v, cfg && cfg.policy && typeof cfg.policy === 'object' ? cfg.policy : undefined) ? TRUTH.TRUE : TRUTH.FALSE }
  });
  // message formatters (closed). AGE reads the evaluation context's asOf, never the clock.
  const LOWER = s => s == null ? s : String(s).toLowerCase();
  const FORMATTERS = Object.freeze({
    RAW: (v) => v == null ? null : String(v),
    LOWER: (v) => LOWER(v),
    FIXED_0: (v) => App.imath.toFixedPy(v, 0),
    FIXED_1: (v) => App.imath.toFixedPy(v, 1),
    MAP: (v, seg) => v != null && seg.map && has(seg.map, v) ? seg.map[v] : (has(seg, 'default') ? seg.default : null),
    I18N_LOWER: (v, seg) => v == null ? null : LOWER(App.i18n.t(seg.enum, v)),
    AGE: (v, seg, ctx) => v == null ? null : App.fmt.formatAge(v, Date.parse(ctx.asOf))
  });
  const NULL_TEXT = 'não disponível';

  // ---------------------------------------------------------------- validation / compilation
  function operandType(op, ver, errors, path, scope = {}) {
    if (!op || typeof op !== 'object') { errors.push({ code: 'INVALID_OPERAND', path, message: 'operando ausente' }); return null; }
    switch (op.type) {
      case 'ATTRIBUTE': {
        const f = App.model.field(op.attributePath);
        if (!f) { errors.push({ code: 'UNKNOWN_FIELD', path, message: `atributo fora do Field Registry: ${op.attributePath}` }); return null; }
        return { string: 'STRING', number: 'NUMBER', boolean: 'BOOLEAN', enum: 'ENUM', datetime: 'DATETIME', date: 'DATETIME', array: 'LIST' }[f.type] || 'STRING';
      }
      case 'METRIC': { const m = METRICS.get(op.metricId); if (!m) { errors.push({ code: 'UNKNOWN_METRIC', path, message: `métrica não registrada: ${op.metricId}` }); return null; } return m.valueType; }
      case 'CONFIG': {
        if (!ver.parameters || !has(ver.parameters, op.key)) { errors.push({ code: 'UNKNOWN_CONFIG_KEY', path, message: `parâmetro ausente na versão: ${op.key}` }); return null; }
        const v = ver.parameters[op.key]; return Array.isArray(v) ? 'LIST' : typeof v === 'number' ? 'NUMBER' : typeof v === 'boolean' ? 'BOOLEAN' : 'STRING';
      }
      case 'LITERAL': {
        if (!VALUE_TYPES.includes(op.valueType)) { errors.push({ code: 'INVALID_LITERAL_TYPE', path, message: `valueType inválido: ${op.valueType}` }); return null; }
        const v = op.value, t = op.valueType;
        const ok = t === 'NUMBER' ? isNum(v) : t === 'BOOLEAN' ? typeof v === 'boolean' : t === 'LIST' || t === 'STRING_LIST' || t === 'ENUM_LIST' ? Array.isArray(v) : typeof v === 'string';
        if (!ok) { errors.push({ code: 'LITERAL_TYPE_MISMATCH', path, message: `literal não é ${t}` }); return null; }
        return t === 'STRING_LIST' || t === 'ENUM_LIST' ? 'LIST' : t;
      }
      case 'CONTEXT': if (!has(CONTEXT_KEYS, op.contextKey)) { errors.push({ code: 'UNKNOWN_CONTEXT_KEY', path, message: `contexto não permitido: ${op.contextKey}` }); return null; } return CONTEXT_KEYS[op.contextKey];
      case 'ITEM': if (!scope.inList) { errors.push({ code: 'ITEM_OUTSIDE_LIST', path, message: 'ITEM só vale dentro de um template de lista' }); return null; } return 'ANY';
      default: errors.push({ code: 'UNKNOWN_OPERAND_TYPE', path, message: `tipo de operando desconhecido: ${op.type}` }); return null;
    }
  }
  const compatible = (a, b) => a == null || b == null || a === 'ANY' || b === 'ANY' || a === b || (a === 'ENUM' && b === 'STRING') || (a === 'STRING' && b === 'ENUM');
  function validateNode(n, ver, errors, path, scope = {}, depth = 0) {
    if (depth > 32) { errors.push({ code: 'AST_TOO_DEEP', path, message: 'condição aninhada demais' }); return; }
    if (!n || typeof n !== 'object') { errors.push({ code: 'INVALID_NODE', path, message: 'nó ausente' }); return; }
    switch (n.type) {
      case 'LOGICAL':
        if (!['AND', 'OR', 'NOT'].includes(n.operator)) errors.push({ code: 'UNKNOWN_OPERATOR', path, message: `operador lógico inválido: ${n.operator}` });
        if (!Array.isArray(n.children) || !n.children.length) { errors.push({ code: 'EMPTY_LOGICAL', path, message: 'nó lógico sem filhos' }); return; }
        if (n.operator === 'NOT' && n.children.length !== 1) errors.push({ code: 'NOT_ARITY', path, message: 'NOT recebe um filho' });
        n.children.forEach((c, i) => validateNode(c, ver, errors, `${path}.children[${i}]`, scope, depth + 1)); return;
      case 'COMPARISON': {
        const op = OPERATORS[n.operator];
        if (!op) { errors.push({ code: 'UNKNOWN_OPERATOR', path, message: `operador não registrado: ${n.operator}` }); return; }
        const lt = operandType(n.left, ver, errors, path + '.left', scope), rt = operandType(n.right, ver, errors, path + '.right', scope);
        if (op.list) { if (rt && rt !== 'LIST' && rt !== 'ANY') errors.push({ code: 'TYPE_MISMATCH', path, message: `${n.operator} exige lista à direita` }); }
        else if (!compatible(lt, rt)) errors.push({ code: 'TYPE_MISMATCH', path, message: `tipos incompatíveis: ${lt} ${n.operator} ${rt}` });
        if (op.types && lt && lt !== 'ANY' && !op.types.includes(lt)) errors.push({ code: 'TYPE_MISMATCH', path, message: `${n.operator} não se aplica a ${lt}` });
        return;
      }
      case 'EXISTS': operandType(n.operand, ver, errors, path + '.operand', scope); if (typeof n.expected !== 'boolean') errors.push({ code: 'INVALID_EXISTS', path, message: 'expected deve ser booleano' }); return;
      case 'PREDICATE': {
        const p = PREDICATES[n.predicateId];
        if (!p) { errors.push({ code: 'UNKNOWN_PREDICATE', path, message: `predicado não registrado: ${n.predicateId}` }); return; }
        if (!Array.isArray(n.args) || n.args.length !== p.args) errors.push({ code: 'PREDICATE_ARITY', path, message: `${n.predicateId} recebe ${p.args} argumento(s)` });
        (n.args || []).forEach((a, i) => operandType(a, ver, errors, `${path}.args[${i}]`, scope)); return;
      }
      default: errors.push({ code: 'UNKNOWN_NODE_TYPE', path, message: `tipo de nó desconhecido: ${n.type}` });
    }
  }
  function validateTemplate(segs, ver, errors, path, scope = {}) {
    if (!Array.isArray(segs)) { errors.push({ code: 'INVALID_TEMPLATE', path, message: 'template deve ser lista de segmentos' }); return; }
    segs.forEach((s, i) => {
      const p = `${path}[${i}]`;
      if (has(s, 'text')) { if (typeof s.text !== 'string' || /[<>]/.test(s.text)) errors.push({ code: 'UNSAFE_TEMPLATE_TEXT', path: p, message: 'texto de template sem HTML' }); }
      else if (has(s, 'value')) { operandType(s.value, ver, errors, p + '.value', scope); if (!FORMATTERS[s.format || 'RAW']) errors.push({ code: 'UNKNOWN_FORMATTER', path: p, message: `formatador não registrado: ${s.format}` }); if (s.map && Object.values(s.map).some(v => typeof v !== 'string' || /[<>]/.test(v))) errors.push({ code: 'UNSAFE_TEMPLATE_TEXT', path: p, message: 'mapa de rótulos sem HTML' }); }
      else if (has(s, 'when')) { validateNode(s.when, ver, errors, p + '.when', scope); validateTemplate(s.then || [], ver, errors, p + '.then', scope); validateTemplate(s.else || [], ver, errors, p + '.else', scope); }
      else if (has(s, 'list')) { operandType(s.list, ver, errors, p + '.list', scope); validateTemplate(s.item, ver, errors, p + '.item', { inList: true }); }
      else if (has(s, 'group')) { validateTemplate(s.group, ver, errors, p + '.group', scope); if (s.format && !FORMATTERS[s.format]) errors.push({ code: 'UNKNOWN_FORMATTER', path: p, message: `formatador não registrado: ${s.format}` }); }
      else errors.push({ code: 'INVALID_SEGMENT', path: p, message: 'segmento desconhecido' });
    });
  }
  /** validate(definition, version) → { ok, errors, warnings } (never throws) */
  function validate(def, ver) {
    const errors = [], warnings = [], E = (code, path, message) => errors.push({ code, path, message });
    if (!def || typeof def !== 'object') return { ok: false, errors: [{ code: 'MISSING_DEFINITION', path: '', message: 'RuleDefinition ausente' }], warnings };
    if (!ver || typeof ver !== 'object') return { ok: false, errors: [{ code: 'MISSING_VERSION', path: '', message: 'RuleVersion ausente' }], warnings };
    for (const k of ['id', 'code', 'titleKey', 'category', 'targetEntityType', 'defaultSeverity']) if (!def[k]) E('MISSING_FIELD', 'definition.' + k, `${k} obrigatório`);
    if (def.code && !/^[A-Z][A-Z0-9_]*$/.test(def.code)) E('INVALID_CODE', 'definition.code', 'code em MAIÚSCULAS_COM_SUBLINHADO');
    if (def.category && !CATEGORIES.includes(def.category)) E('INVALID_CATEGORY', 'definition.category', `categoria fora de ${CATEGORIES.join(', ')}`);
    if (def.defaultSeverity && !SEVERITIES.includes(def.defaultSeverity)) E('INVALID_SEVERITY', 'definition.defaultSeverity', 'severidade inválida');
    if (def.contextType && !CONTEXT_TYPES.includes(def.contextType)) E('INVALID_CONTEXT_TYPE', 'definition.contextType', 'contextType inválido');
    if (def.contextType !== 'CUSTOMER' && JSON.stringify(ver.condition || {}).includes('"CUSTOMER_')) E('CUSTOMER_CONTEXT_IN_BASE_RULE', 'condition', 'regra base não pode depender do cliente atual');
    if (ver.ruleDefinitionId !== def.id) E('DEFINITION_MISMATCH', 'version.ruleDefinitionId', 'a versão pertence a outra regra');
    if (!/^\d+\.\d+\.\d+$/.test(ver.version || '')) E('INVALID_VERSION', 'version.version', 'use semver (1.0.0)');
    if (ver.lifecycleStatus && !RULE_VERSION_STATUS.includes(ver.lifecycleStatus)) E('INVALID_STATUS', 'version.lifecycleStatus', 'status inválido');
    if ((def.scope || {}).organizationId && ver.organizationId && def.scope.organizationId !== ver.organizationId) E('TENANT_SCOPE_MISMATCH', 'version.organizationId', 'versão de outro tenant');
    validateNode(ver.condition, ver, errors, 'condition');
    const sp = ver.severityPolicy || {};
    if (sp.type === 'STATIC') { if (!SEVERITIES.includes(sp.severity)) E('INVALID_SEVERITY', 'severityPolicy.severity', 'severidade inválida'); }
    else if (sp.type === 'THRESHOLD_BASED') {
      operandType(sp.operand, ver, errors, 'severityPolicy.operand');
      if (!Array.isArray(sp.bands) || !sp.bands.length || sp.bands.some(b => !SEVERITIES.includes(b.severity))) E('INVALID_SEVERITY_BANDS', 'severityPolicy.bands', 'faixas de severidade inválidas');
      const lim = (sp.bands || []).map(b => b.lt).filter(v => v != null); if (lim.some((v, i) => i && v <= lim[i - 1])) E('THRESHOLD_ORDER', 'severityPolicy.bands', 'limites fora de ordem crescente');
    } else E('INVALID_SEVERITY_POLICY', 'severityPolicy', 'use STATIC ou THRESHOLD_BASED');
    const up = ver.unknownPolicy || {};
    if (!UNKNOWN_BEHAVIORS.includes(up.behavior)) E('MISSING_UNKNOWN_POLICY', 'unknownPolicy.behavior', 'a política para UNKNOWN deve ser explícita');
    if (!up.reasonCode) E('MISSING_UNKNOWN_REASON', 'unknownPolicy.reasonCode', 'reasonCode obrigatório');
    const tpl = ver.messageTemplates || {};
    if (!Object.keys(tpl).length) E('MISSING_TEMPLATE', 'messageTemplates', 'template de mensagem obrigatório');
    for (const [aud, segs] of Object.entries(tpl)) { if (!AUDIENCES.includes(aud) && aud !== 'DEFAULT') E('INVALID_AUDIENCE', 'messageTemplates.' + aud, 'público inválido'); validateTemplate(segs, ver, errors, 'messageTemplates.' + aud); }
    const h = ver.hysteresisPolicy;
    if (h) {
      if (h.parameterKey && !(ver.parameters && has(ver.parameters, h.parameterKey))) E('INVALID_HYSTERESIS', 'hysteresisPolicy.parameterKey', 'parâmetro de histerese ausente');
      for (const k of ['activationConsecutiveEvaluations', 'resolutionConsecutiveEvaluations']) if (h[k] != null && !(Number.isInteger(h[k]) && h[k] >= 1)) E('INVALID_HYSTERESIS', 'hysteresisPolicy.' + k, 'inteiro ≥ 1');
    }
    const s = ver.suppressionPolicy;
    if (s && s.cooldownSeconds != null && !(s.cooldownSeconds >= 0)) E('INVALID_SUPPRESSION', 'suppressionPolicy.cooldownSeconds', 'cooldown ≥ 0');
    if (!ver.lifecyclePolicy) warnings.push({ code: 'DEFAULT_LIFECYCLE_POLICY', path: 'lifecyclePolicy', message: 'usando a política padrão (autoResolveWhenFalse)' });
    return { ok: !errors.length, errors, warnings };
  }
  /** dependency manifest: what the rule reads, by domain (selective re-evaluation) */
  function manifestOf(ver) {
    const attrs = new Set(), metrics = new Set(), ctxs = new Set(), preds = new Set();
    const walkOp = o => { if (!o) return; if (o.type === 'ATTRIBUTE') attrs.add(o.attributePath); if (o.type === 'METRIC') metrics.add(o.metricId); if (o.type === 'CONTEXT') ctxs.add(o.contextKey); };
    const walk = n => { if (!n) return; if (n.children) n.children.forEach(walk); if (n.left) walkOp(n.left); if (n.right) walkOp(n.right); if (n.operand) walkOp(n.operand); if (n.args) n.args.forEach(walkOp); if (n.predicateId) preds.add(n.predicateId); };
    const walkT = segs => (segs || []).forEach(s => { if (s.value) walkOp(s.value); if (s.when) walk(s.when); walkT(s.then); walkT(s.else); if (s.list) walkOp(s.list); walkT(s.item); walkT(s.group); });
    walk(ver.condition); Object.values(ver.messageTemplates || {}).forEach(walkT); if (ver.severityPolicy && ver.severityPolicy.operand) walkOp(ver.severityPolicy.operand);
    const ms = [...metrics].map(id => METRICS.get(id)).filter(Boolean), as = [...attrs];
    const dom = d => [...new Set([...ms.filter(m => m.domain === d).map(m => m.id), ...as.filter(a => ATTRIBUTE_DOMAIN(a) === d)])].sort();
    const m = {
      attributePaths: as.sort(), metricIds: [...metrics].sort(), predicateIds: [...preds].sort(), contextKeys: [...ctxs].sort(),
      analysisDefinitionIds: [...new Set(ms.map(x => x.analysisDefinitionId).filter(Boolean))].sort(),
      pricingDependencies: dom('PRICING'), availabilityDependencies: dom('AVAILABILITY'), analysisDependencies: dom('ANALYSIS'), staticDependencies: dom('STATIC'),
      provenanceDependencies: [], confidenceDependencies: [], customerContextDependencies: [...ctxs].filter(k => k.startsWith('CUSTOMER_')).sort()
    };
    m.checksum = checksum(m);
    return m;
  }
  /** compile(def, ver) → frozen CompiledRuleVersion. Throws RULE_INVALID (errors attached). */
  function compile(def, ver) {
    const v = validate(def, ver);
    if (!v.ok) throw err('RULE_INVALID', `regra ${def && def.code} inválida: ` + v.errors.map(e => `${e.code} ${e.path}`).join('; '), { errors: v.errors });
    const logic = { condition: ver.condition, parameters: ver.parameters || {}, severityPolicy: ver.severityPolicy, unknownPolicy: ver.unknownPolicy, messageTemplates: ver.messageTemplates,
      hysteresisPolicy: ver.hysteresisPolicy || null, suppressionPolicy: ver.suppressionPolicy || null, lifecyclePolicy: ver.lifecyclePolicy || null, evidencePolicy: ver.evidencePolicy || null, legacyProjection: ver.legacyProjection || null };
    const versionChecksum = checksum({ code: def.code, version: ver.version, ...logic });
    if (ver.checksum && ver.checksum !== versionChecksum && ver.lifecycleStatus === 'PUBLISHED') throw err('RULE_CHECKSUM_MISMATCH', `a versão publicada ${ver.id} não confere com o checksum gravado`);
    return freeze({
      ruleDefinitionId: def.id, ruleVersionId: ver.id, code: def.code, version: ver.version, sequence: ver.sequence || 1, lifecycleStatus: ver.lifecycleStatus || 'DRAFT',
      organizationId: (def.scope && def.scope.organizationId) || ver.organizationId || null, developmentIds: (def.scope && def.scope.developmentIds) || null,
      category: def.category, targetEntityType: def.targetEntityType, contextType: def.contextType || 'BASE', defaultSeverity: def.defaultSeverity, titleKey: def.titleKey,
      ...logic, lifecyclePolicy: { ...DEFAULT_LIFECYCLE, ...(ver.lifecyclePolicy || {}) },
      dependencyManifest: manifestOf(ver), checksum: versionChecksum, engineCompatibility: { engineId: ENGINE_ID, astVersion: AST_VERSION, minEngineVersion: ENGINE_VERSION }, warnings: v.warnings
    });
  }
  const DEFAULT_LIFECYCLE = Object.freeze({ autoResolveWhenFalse: true, reopenWhenTrue: true, acknowledgeAllowed: true, dismissAllowed: true, snoozeAllowed: true, preserveAcknowledgementOnRetrigger: false });

  // ---------------------------------------------------------------- evaluation
  /** resolve one operand against the input → { status, value, ref } (never throws for data) */
  function resolve(op, rule, input, scope, opts) {
    const facts = input.facts || {};
    switch (op.type) {
      case 'LITERAL': return { status: 'RESOLVED', value: op.value, ref: 'literal' };
      case 'CONFIG': {
        const ov = opts && opts.parameterOverrides && has(opts.parameterOverrides, op.key);
        return { status: 'RESOLVED', value: ov ? opts.parameterOverrides[op.key] : rule.parameters[op.key], ref: 'config:' + op.key };
      }
      case 'CONTEXT': {
        const c = input.context || {}, v = op.contextKey === 'AS_OF' ? c.asOf : op.contextKey === 'AUDIENCE' ? (scope && scope.audience) : op.contextKey === 'CUSTOMER_BUDGET_MAX' ? (c.customer || {}).budgetMax : undefined;
        return v == null ? { status: 'UNKNOWN', value: null, ref: 'context:' + op.contextKey } : { status: 'RESOLVED', value: v, ref: 'context:' + op.contextKey };
      }
      case 'ITEM': { const it = scope && scope.item; return { status: it && it[op.field] != null ? 'RESOLVED' : 'UNKNOWN', value: it ? it[op.field] ?? null : null, ref: 'item:' + op.field }; }
      case 'METRIC': {
        const src = facts.metrics || {};
        if (!has(src, op.metricId)) return { status: 'UNKNOWN', value: null, ref: 'metric:' + op.metricId, notProvided: true };
        const v = src[op.metricId];
        if (typeof v === 'number' && !Number.isFinite(v)) return { status: 'ERROR', value: null, ref: 'metric:' + op.metricId };
        return { status: v == null ? 'UNKNOWN' : 'RESOLVED', value: v ?? null, ref: 'metric:' + op.metricId };
      }
      case 'ATTRIBUTE': {
        const src = facts.attributes || {};
        if (!has(src, op.attributePath)) return { status: 'UNKNOWN', value: null, ref: 'attribute:' + op.attributePath, notProvided: true };
        const v = src[op.attributePath];
        return { status: v == null ? 'UNKNOWN' : 'RESOLVED', value: v ?? null, ref: 'attribute:' + op.attributePath };
      }
      default: return { status: 'ERROR', value: null, ref: 'invalid' };
    }
  }
  const AND = ts => ts.includes('FALSE') ? 'FALSE' : ts.includes('ERROR') ? 'ERROR' : ts.includes('UNKNOWN') ? 'UNKNOWN' : ts.every(t => t === 'NOT_APPLICABLE') ? 'NOT_APPLICABLE' : 'TRUE';
  const OR = ts => ts.includes('TRUE') ? 'TRUE' : ts.includes('ERROR') ? 'ERROR' : ts.includes('UNKNOWN') ? 'UNKNOWN' : ts.every(t => t === 'NOT_APPLICABLE') ? 'NOT_APPLICABLE' : 'FALSE';
  const NOT = t => t === 'TRUE' ? 'FALSE' : t === 'FALSE' ? 'TRUE' : t;
  /** evalNode → truth; every resolved operand is recorded in trace (explanations read the trace, never recompute) */
  function evalNode(n, rule, input, trace, scope, opts) {
    const rec = (r, node) => { if (trace && !(r.ref || '').startsWith('item:')) trace.push({ operandRef: r.ref, resolvedValue: r.value, status: r.status, valueFingerprint: r.status === 'RESOLVED' ? checksum({ v: r.value }) : undefined, sourceRefs: r.ref.startsWith('metric:') || r.ref.startsWith('attribute:') ? [r.ref] : undefined, node }); return r; };
    switch (n.type) {
      case 'LOGICAL': {
        const ts = n.children.map(c => evalNode(c, rule, input, trace, scope, opts));
        return n.operator === 'AND' ? AND(ts) : n.operator === 'OR' ? OR(ts) : NOT(ts[0]);
      }
      case 'COMPARISON': {
        const op = OPERATORS[n.operator], l = rec(resolve(n.left, rule, input, scope, opts), n.operator), r = rec(resolve(n.right, rule, input, scope, opts), n.operator);
        if (l.status === 'ERROR' || r.status === 'ERROR') return 'ERROR';
        if (l.status !== 'RESOLVED' || r.status !== 'RESOLVED') return 'UNKNOWN';
        if (op.list && !Array.isArray(r.value)) return 'ERROR';
        if (op.types && op.types.includes('NUMBER') && !op.list && (typeof l.value !== typeof r.value)) return 'ERROR';
        return op.fn(l.value, r.value) ? 'TRUE' : 'FALSE';
      }
      case 'EXISTS': {
        const r = rec(resolve(n.operand, rule, input, scope, opts), 'EXISTS');
        if (r.status === 'ERROR') return 'ERROR';
        if (r.notProvided) return 'UNKNOWN'; // the source was not loaded: existence itself is unknown
        const present = r.status === 'RESOLVED' && r.value !== '' && !(Array.isArray(r.value) && !r.value.length);
        return present === n.expected ? 'TRUE' : 'FALSE';
      }
      case 'PREDICATE': {
        const p = PREDICATES[n.predicateId], rs = n.args.map(a => rec(resolve(a, rule, input, scope, opts), n.predicateId));
        if (rs.some(r => r.status === 'ERROR')) return 'ERROR';
        if (rs.some(r => r.notProvided)) return 'UNKNOWN';
        if (p.nullMeans === 'UNKNOWN' && rs.some(r => r.status !== 'RESOLVED')) return 'UNKNOWN';
        try { return p.run(rs.map(r => r.value), n.config || {}); } catch (e) { return 'ERROR'; }
      }
      default: return 'ERROR';
    }
  }
  function severityOf(rule, input, opts) {
    const sp = rule.severityPolicy;
    if (sp.type === 'STATIC') return { severity: sp.severity, reason: 'STATIC' };
    const r = resolve(sp.operand, rule, input, null, opts);
    if (r.status !== 'RESOLVED') return { severity: rule.defaultSeverity, reason: 'SEVERITY_OPERAND_UNKNOWN' };
    const b = sp.bands.find(x => x.lt == null || r.value < x.lt);
    return { severity: b.severity, reason: 'THRESHOLD_BAND', value: r.value, band: b };
  }
  /** evaluate(compiled, input, opts) → RuleEvaluationResult.
      input: { organizationId, developmentId, entity: { type, id }, facts: { metrics, attributes }, context: { asOf, executionMode, dataVersionRefs, analysisVersionRefs, contextDiscriminator } }
      opts.activeState: the alert is currently active (hysteresis resolution threshold applies). */
  function evaluate(rule, input, opts = {}) {
    const ctx = input.context || {}, warnings = [], errors = [], trace = [];
    const base = { organizationId: input.organizationId || null, developmentId: input.developmentId || null, ruleDefinitionId: rule.ruleDefinitionId, ruleVersionId: rule.ruleVersionId, ruleCode: rule.code,
      targetEntityType: input.entity && input.entity.type, targetEntityId: input.entity && input.entity.id, evaluationContextRef: ctx.contextRef || null, evaluatedAt: ctx.asOf || null, executionMode: ctx.executionMode || 'SHADOW',
      contextDiscriminator: ctx.contextDiscriminator || null };
    const out = (truth, extra = {}) => {
      const fp = checksum({ r: rule.ruleVersionId, c: rule.checksum, e: base.targetEntityId, d: base.contextDiscriminator, ops: trace.map(t => [t.operandRef, t.status, t.resolvedValue]), a: !!opts.activeState });
      return freeze({ id: `eval:${rule.ruleVersionId}:${base.targetEntityId}:${fp}`, ...base, truth, severity: null, reasonCodes: [], evaluatedOperands: trace, evidenceRefs: [], evaluationFingerprint: fp, warnings, errors, ...extra });
    };
    if (!input.entity || !input.entity.id) { errors.push('MISSING_ENTITY'); return out('ERROR'); }
    if (rule.organizationId && input.organizationId !== rule.organizationId) { errors.push('TENANT_MISMATCH'); return out('ERROR', { reasonCodes: ['RULE_TENANT_MISMATCH'] }); }
    if (rule.developmentIds && input.developmentId && !rule.developmentIds.includes(input.developmentId)) return out('NOT_APPLICABLE', { reasonCodes: ['RULE_OUT_OF_SCOPE'] });
    if (input.entity.type !== rule.targetEntityType) return out('NOT_APPLICABLE', { reasonCodes: ['RULE_ENTITY_TYPE_MISMATCH'] });
    if (!ctx.asOf) warnings.push('MISSING_AS_OF');
    let overrides = null;
    const h = rule.hysteresisPolicy;
    if (h && h.parameterKey && opts.activeState && h.resolutionThreshold != null) overrides = { [h.parameterKey]: h.resolutionThreshold };
    else if (h && h.parameterKey && h.activationThreshold != null) overrides = { [h.parameterKey]: h.activationThreshold };
    const eo = { parameterOverrides: overrides };
    let truth;
    try { truth = evalNode(rule.condition, rule, input, trace, null, eo); } catch (e) { errors.push('EVALUATION_FAILED'); return out('ERROR'); }
    const notProvided = trace.filter(t => t.status === 'UNKNOWN').map(t => t.operandRef);
    if (truth === 'TRUE') {
      const sev = severityOf(rule, input, eo);
      return out('TRUE', { severity: sev.severity, severityEvaluation: sev, reasonCodes: ['RULE_TRUE:' + rule.code], evidenceRefs: evidenceOf(rule, trace, ctx) });
    }
    if (truth === 'UNKNOWN') return out('UNKNOWN', { reasonCodes: [rule.unknownPolicy.reasonCode], unknownOperands: [...new Set(notProvided)], evidenceRefs: evidenceOf(rule, trace, ctx) });
    if (truth === 'ERROR') errors.push('OPERAND_ERROR');
    return out(truth, { reasonCodes: truth === 'FALSE' ? ['RULE_FALSE:' + rule.code] : [] });
  }
  function evidenceOf(rule, trace, ctx) {
    const refs = trace.filter(t => t.status === 'RESOLVED' && t.sourceRefs).map(t => ({ type: 'RULE_OPERAND', ref: t.operandRef }));
    for (const r of ctx.dataVersionRefs || []) if (relevantRef(rule, r)) refs.push({ type: r.type, id: r.id });
    const seen = new Set(); return refs.filter(r => { const k = r.type + ':' + (r.ref || r.id); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  /** only versions of domains the rule actually reads become evidence */
  function relevantRef(rule, ref) {
    const m = rule.dependencyManifest;
    if (ref.type === 'ANALYSIS_VERSION') return m.analysisDefinitionIds.length > 0;
    if (ref.type === 'PRICE_TABLE_VERSION') return m.pricingDependencies.length > 0;
    if (ref.type === 'AVAILABILITY_REVISION') return m.availabilityDependencies.length > 0;
    if (ref.type === 'STATIC_DATA_VERSION') return m.staticDependencies.length > 0 || m.analysisDefinitionIds.length > 0;
    return false;
  }

  // ---------------------------------------------------------------- message rendering (same resolution as the evaluation)
  function renderSegs(segs, rule, input, scope, out) {
    for (const s of segs || []) {
      if (has(s, 'text')) out.push(s.text);
      else if (has(s, 'value')) { const r = resolve(s.value, rule, input, scope); const f = FORMATTERS[s.format || 'RAW'](r.value, s, input.context || {}); out.push(f == null ? NULL_TEXT : f); }
      else if (has(s, 'when')) renderSegs(evalNode(s.when, rule, input, null, scope) === 'TRUE' ? s.then : s.else, rule, input, scope, out);
      else if (has(s, 'list')) {
        const r = resolve(s.list, rule, input, scope), items = Array.isArray(r.value) ? r.value : [];
        out.push(items.map(it => { const o = []; renderSegs(s.item, rule, input, { ...(scope || {}), item: it }, o); return o.join(''); }).join(s.separator || ', '));
      } else if (has(s, 'group')) { const o = []; renderSegs(s.group, rule, input, scope, o); const txt = o.join(''); out.push(s.format ? FORMATTERS[s.format](txt, s, input.context || {}) : txt); }
    }
    return out;
  }
  /** render(compiled, input, audience) → string; audience falls back BROKER → DEFAULT */
  function render(rule, input, audience = 'BROKER') {
    const t = rule.messageTemplates, segs = t[audience] || (audience === 'TECHNICAL' && t.BROKER) || t.DEFAULT || t.BROKER;
    return renderSegs(segs, rule, input, { audience }, []).join('');
  }
  /** explanation from the evaluation trace (no recomputation) */
  function explain(rule, result) {
    const thresholds = result.evaluatedOperands.filter(t => t.operandRef.startsWith('config:') || t.operandRef === 'literal');
    const triggers = result.evaluatedOperands.filter(t => t.operandRef.startsWith('metric:') || t.operandRef.startsWith('attribute:'));
    const fact = t => ({ ref: t.operandRef, value: t.resolvedValue, status: t.status, operator: t.node, fieldKey: t.operandRef.startsWith('metric:') ? (METRICS.get(t.operandRef.slice(7)) || {}).fieldKey || null : t.operandRef.startsWith('attribute:') ? t.operandRef.slice(10) : null });
    return freeze({ ruleDefinitionId: rule.ruleDefinitionId, ruleVersionId: rule.ruleVersionId, summaryCode: result.truth === 'TRUE' ? 'ALERT_' + rule.code : result.truth === 'UNKNOWN' ? rule.unknownPolicy.reasonCode : 'RULE_' + result.truth,
      triggerFacts: triggers.map(fact), thresholdFacts: thresholds.map(fact), caveats: (result.unknownOperands || []).map(r => 'DADO_NAO_DISPONIVEL:' + r), dataQualityWarnings: result.warnings.slice(), evidenceRefs: result.evidenceRefs, evaluatedAt: result.evaluatedAt });
  }

  // ---------------------------------------------------------------- dependency index and selective re-evaluation planner
  /** change event types → which manifest list makes a rule depend on it */
  const CHANGE_DEPENDENCY = Object.freeze({
    PRICE_TABLE_CHANGED: m => m.pricingDependencies.length > 0, COMMERCIAL_FRESHNESS_CHANGED: m => m.pricingDependencies.length > 0,
    AVAILABILITY_CHANGED: m => m.availabilityDependencies.length > 0, ANALYSIS_VERSION_CHANGED: m => m.analysisDefinitionIds.length > 0,
    STATIC_DATA_CHANGED: m => m.staticDependencies.length > 0 || m.analysisDefinitionIds.length > 0, CUSTOMER_CONTEXT_CHANGED: m => m.customerContextDependencies.length > 0
  });
  function dependencyIndex(rules) {
    const idx = new Map(), add = (k, code) => { if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(code); };
    for (const r of rules) {
      const m = r.dependencyManifest;
      m.attributePaths.forEach(p => add('ATTRIBUTE:' + p, r.code)); m.metricIds.forEach(id => add('METRIC:' + id, r.code));
      m.analysisDefinitionIds.forEach(id => add('ANALYSIS:' + id, r.code));
      for (const [ev, test] of Object.entries(CHANGE_DEPENDENCY)) if (test(m)) add('EVENT:' + ev, r.code);
    }
    const rulesByCode = new Map(rules.map(r => [r.code, r]));
    return Object.freeze({ get: k => [...(idx.get(k) || [])].sort(), keys: () => [...idx.keys()].sort(), rulesByCode, size: idx.size });
  }
  /** plan(index, event) → { ruleCodes, entityIds, reasonCodes }. event: { type, entityIds?, attributePaths?, metricIds? } */
  function plan(index, event) {
    const codes = new Set(), reasons = [];
    if (CHANGE_DEPENDENCY[event.type]) { index.get('EVENT:' + event.type).forEach(c => codes.add(c)); reasons.push(event.type); }
    for (const p of event.attributePaths || []) index.get('ATTRIBUTE:' + p).forEach(c => codes.add(c));
    for (const id of event.metricIds || []) index.get('METRIC:' + id).forEach(c => codes.add(c));
    if ((event.attributePaths || []).length || (event.metricIds || []).length) reasons.push('INPUT_CHANGED');
    // customer-context rules only for the sessions/profiles named by the event
    const ruleCodes = [...codes].filter(c => { const r = index.rulesByCode.get(c); return !r || r.contextType !== 'CUSTOMER' || !!event.customerContextRef; }).sort();
    return Object.freeze({ ruleCodes, entityIds: event.entityIds ? [...event.entityIds].sort() : 'ALL', reasonCodes: reasons, eventType: event.type });
  }

  // ---------------------------------------------------------------- RuleDefinition / RuleVersion / RuleSet registry (tenant-scoped, in memory)
  /** ruleSetRegistry({ organizationId }) — published versions are immutable; latest ≠ current published; publication is atomic */
  function ruleSetRegistry(tenant) {
    if (!tenant || !tenant.organizationId) throw err('TENANT_REQUIRED', 'TenantContext obrigatório');
    const org = tenant.organizationId, defs = new Map(), versions = new Map(), sets = new Map(), audit = [];
    const pointer = { currentPublishedRuleSetVersionId: null, latestRuleSetVersionId: null, revision: 0 }, activations = [];
    const own = (o, what) => { if (o.organizationId && o.organizationId !== org) throw err('TENANT_MISMATCH', `${what} de outro tenant`); };
    const log = (action, id, meta = {}) => audit.push({ action, id, at: meta.at || null, by: meta.by || null, reason: meta.reason || null });
    function addDefinition(d, meta = {}) {
      own(d.scope || {}, 'regra'); if (defs.has(d.id)) throw err('DUPLICATE_DEFINITION', `regra ${d.id} já existe`);
      const copy = freeze(JSON.parse(JSON.stringify({ status: 'ACTIVE', ...d, organizationId: org }))); defs.set(d.id, copy); log('ADD_DEFINITION', d.id, meta); return copy;
    }
    function addVersion(v, meta = {}) {
      own(v, 'versão'); const d = defs.get(v.ruleDefinitionId); if (!d) throw err('NOT_FOUND', `regra ${v.ruleDefinitionId} não existe`);
      if (versions.has(v.id)) { const ex = versions.get(v.id); if (ex.lifecycleStatus === 'PUBLISHED' || ex.lifecycleStatus === 'ARCHIVED') throw err('PUBLISHED_IMMUTABLE', `a versão ${v.id} já foi publicada: crie uma nova versão`); }
      const status = v.lifecycleStatus === 'PUBLISHED' && meta.importPublished ? 'PUBLISHED' : 'DRAFT';
      const rec = { ...JSON.parse(JSON.stringify(v)), organizationId: org, lifecycleStatus: status };
      versions.set(v.id, status === 'PUBLISHED' ? freeze(rec) : rec); log('ADD_VERSION', v.id, meta); return versions.get(v.id);
    }
    function updateVersion(id, patch, meta = {}) {
      const v = versions.get(id); if (!v) throw err('NOT_FOUND', `versão ${id} não existe`);
      if (v.lifecycleStatus !== 'DRAFT') throw err('PUBLISHED_IMMUTABLE', `a versão ${id} está ${v.lifecycleStatus}: crie uma nova versão`);
      const next = { ...v, ...JSON.parse(JSON.stringify(patch)), id, lifecycleStatus: 'DRAFT' }; versions.set(id, next); log('UPDATE_VERSION', id, meta); return next;
    }
    function validateVersion(id, meta = {}) {
      const v = versions.get(id); if (!v) throw err('NOT_FOUND', `versão ${id} não existe`);
      if (v.lifecycleStatus !== 'DRAFT') throw err('INVALID_TRANSITION', `${v.lifecycleStatus} → VALIDATED não é permitido`);
      const r = validate(defs.get(v.ruleDefinitionId), v);
      if (!r.ok) { versions.set(id, { ...v, lifecycleStatus: 'REJECTED' }); log('REJECT_VERSION', id, meta); throw err('RULE_INVALID', 'regra inválida', { errors: r.errors }); }
      const c = compile(defs.get(v.ruleDefinitionId), v);
      versions.set(id, { ...v, lifecycleStatus: 'VALIDATED', checksum: c.checksum, dependencyManifest: c.dependencyManifest, validatedAt: meta.at || null, validatedBy: meta.by || null }); log('VALIDATE_VERSION', id, meta); return versions.get(id);
    }
    function compiledOf(id) { const v = versions.get(id); if (!v) throw err('NOT_FOUND', `versão ${id} não existe`); return compile(defs.get(v.ruleDefinitionId), v); }
    /** RuleSetVersion: a coherent list of RuleVersions (never half V1 / half V2 by accident) */
    function createRuleSetVersion(s, meta = {}) {
      own(s, 'rule set'); if (sets.has(s.id)) throw err('DUPLICATE_RULESET', `rule set ${s.id} já existe`);
      for (const id of s.ruleVersionIds) if (!versions.has(id)) throw err('NOT_FOUND', `versão ${id} não existe`);
      const perDef = new Map(); for (const id of s.ruleVersionIds) { const d = versions.get(id).ruleDefinitionId; if (perDef.has(d)) throw err('DUPLICATE_RULE_IN_SET', `regra ${d} aparece duas vezes`); perDef.set(d, id); }
      const rec = { ...JSON.parse(JSON.stringify(s)), organizationId: org, lifecycleStatus: 'DRAFT', checksum: checksum(s.ruleVersionIds.map(id => [id, versions.get(id).checksum || null])) };
      sets.set(s.id, rec); pointer.latestRuleSetVersionId = s.id; log('CREATE_RULESET', s.id, meta); return rec;
    }
    /** publish(ruleSetVersionId, { expectedCurrentId, by, reason, can }) — atomic: every version validates or nothing changes */
    function publishRuleSet(id, meta = {}) {
      const s = sets.get(id); if (!s) throw err('NOT_FOUND', `rule set ${id} não existe`);
      if (typeof meta.can !== 'function' || !meta.can('rule.publish')) throw err('FORBIDDEN', 'publicar regras exige rule.publish');
      if (!meta.reason) throw err('MISSING_REASON', 'publicar exige o motivo');
      if ((meta.expectedCurrentId ?? null) !== pointer.currentPublishedRuleSetVersionId) throw err('RULESET_CURRENT_VERSION_CONFLICT', `o rule set atual é ${pointer.currentPublishedRuleSetVersionId}, não ${meta.expectedCurrentId}`);
      const bad = s.ruleVersionIds.filter(v => !['VALIDATED', 'PUBLISHED'].includes(versions.get(v).lifecycleStatus));
      if (bad.length) throw err('RULESET_NOT_VALIDATED', `versões não validadas: ${bad.join(', ')}`, { versionIds: bad });
      const compiled = s.ruleVersionIds.map(compiledOf); // throws before any mutation
      for (const v of s.ruleVersionIds) { const x = versions.get(v); if (x.lifecycleStatus !== 'PUBLISHED') versions.set(v, freeze({ ...x, lifecycleStatus: 'PUBLISHED', publishedAt: meta.at || null, publishedBy: meta.by || null })); }
      for (const d of new Set(s.ruleVersionIds.map(v => versions.get(v).ruleDefinitionId))) { const def = defs.get(d), vid = s.ruleVersionIds.find(v => versions.get(v).ruleDefinitionId === d); defs.set(d, freeze({ ...def, currentPublishedVersionId: vid })); }
      sets.set(id, freeze({ ...s, lifecycleStatus: 'PUBLISHED', publishedAt: meta.at || null, publishedBy: meta.by || null }));
      activate(id, meta, 'PUBLISH'); return { ruleSet: sets.get(id), compiled };
    }
    function activate(id, meta, action) {
      const at = meta.at || null, prev = pointer.currentPublishedRuleSetVersionId;
      if (activations.length && activations[activations.length - 1].deactivatedAt == null) activations[activations.length - 1].deactivatedAt = at;
      activations.push({ ruleSetVersionId: id, previousRuleSetVersionId: prev, activatedAt: at, deactivatedAt: null, by: meta.by || null, reason: meta.reason || null, action });
      pointer.currentPublishedRuleSetVersionId = id; pointer.revision++; log(action, id, meta);
    }
    /** rollback: re-activates an older PUBLISHED rule set; the newer one stays as history; alerts must be re-evaluated */
    function rollback(id, meta = {}) {
      const s = sets.get(id); if (!s) throw err('NOT_FOUND', `rule set ${id} não existe`);
      if (s.lifecycleStatus !== 'PUBLISHED') throw err('INVALID_TRANSITION', 'só um rule set publicado pode ser reativado');
      if (typeof meta.can !== 'function' || !meta.can('rule.publish')) throw err('FORBIDDEN', 'reativar regras exige rule.publish');
      if (!meta.reason) throw err('MISSING_REASON', 'reativar exige o motivo');
      if ((meta.expectedCurrentId ?? null) !== pointer.currentPublishedRuleSetVersionId) throw err('RULESET_CURRENT_VERSION_CONFLICT', 'o rule set atual mudou');
      activate(id, meta, 'ROLLBACK'); return { ruleSet: s, compiled: s.ruleVersionIds.map(compiledOf), requiresReevaluation: true };
    }
    /** rules consumed by brokers/clients: the current PUBLISHED set only, never the latest draft */
    function currentCompiled() { const id = pointer.currentPublishedRuleSetVersionId; return id ? sets.get(id).ruleVersionIds.map(compiledOf) : []; }
    function compiledSet(id, opts = {}) {
      const s = sets.get(id); if (!s) throw err('NOT_FOUND', `rule set ${id} não existe`);
      if (s.lifecycleStatus !== 'PUBLISHED' && !opts.technical) throw err('DRAFT_NOT_ALLOWED', 'rule set em rascunho só no modo técnico/shadow');
      return s.ruleVersionIds.map(compiledOf);
    }
    const asOf = at => { const a = activations.filter(x => x.activatedAt != null && x.activatedAt <= at && (x.deactivatedAt == null || x.deactivatedAt > at)).pop(); return a ? a.ruleSetVersionId : null; };
    return { organizationId: org, addDefinition, addVersion, updateVersion, validateVersion, compiledOf, createRuleSetVersion, publishRuleSet, rollback, currentCompiled, compiledSet, asOf,
      definition: id => defs.get(id) || null, version: id => versions.get(id) || null, ruleSet: id => sets.get(id) || null,
      pointer: () => ({ ...pointer }), activations: () => activations.map(a => ({ ...a })), audit: () => audit.slice() };
  }

  // ---------------------------------------------------------------- rule test cases (first-class)
  /** runTestCases(compiled, cases) → [{ id, pass, expected, actual }]; case: { id, input, expectedTruth, expectedSeverity?, expectedMessage? } */
  function runTestCases(rule, cases) {
    return cases.map(c => {
      const r = evaluate(rule, c.input), msg = c.expectedMessage != null && r.truth === 'TRUE' ? render(rule, c.input, c.audience || 'BROKER') : undefined;
      const pass = r.truth === c.expectedTruth && (c.expectedSeverity == null || r.severity === c.expectedSeverity) && (c.expectedMessage == null || msg === c.expectedMessage);
      return { id: c.id, pass, expected: { truth: c.expectedTruth, severity: c.expectedSeverity, message: c.expectedMessage }, actual: { truth: r.truth, severity: r.severity, message: msg } };
    });
  }

  return Object.freeze({ ENGINE_ID, ENGINE_VERSION, AST_VERSION, TRUTH, EXECUTION_MODES, RULE_VERSION_STATUS, CATEGORIES, SEVERITIES, UNKNOWN_BEHAVIORS, CONTEXT_TYPES, AUDIENCES,
    OPERATORS: Object.keys(OPERATORS), PREDICATES: Object.keys(PREDICATES), FORMATTERS: Object.keys(FORMATTERS), DEFAULT_LIFECYCLE,
    metric: id => METRICS.get(id) || null, metrics: () => [...METRICS.values()], validate, compile, manifestOf, evaluate, render, explain, dependencyIndex, plan, ruleSetRegistry, runTestCases, checksum });
})();
