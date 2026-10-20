/* rules/legacyAlertMigration.js — Legacy alert inventory, shadow parity and the integration
   entry point of the Rule Engine alerts (topic 36, phases 1–6).

   Legacy surfaces migrated (zero-delta, proved by tests/rules.test.js over the 498 lots):
     INTELLIGENCE_ALERTS  lot.intelligence.alerts (lots.json "al", parsed by data/legacyAdapter.js;
                          conditions in config/scoring/<dev>/1.0.json#alerts, run by intelligence/engine.js,
                          wording in intelligence/textAdapter.js, severity in domain/rules.js)
     STATUS_NOTE          presentation/viewmodels.js statusVM → note + warn (availability confirmation)
     SHARE_WARNINGS       presentation/viewmodels.js shareVM → "CONFIRA ANTES DE ENVIAR" warnings
   The UI keeps reading the legacy surfaces until RULE_ENGINE_ALERTS_ENABLED is switched on
   (feature flag; default off). The integrator calls intelligenceAlertsFor / statusNoteFor /
   shareWarningsFor, which return the legacy shape, from the engine when enabled and parity holds.

   API (App.alertMigration): INVENTORY, fromMethodologyAlerts(cfgAlerts), legacy.*, engine.*,
   parityReport(opts), enabled(dev), intelligenceAlertsFor(lot, opts), statusNoteFor(lot, mode, opts), shareWarningsFor(lots, opts) */
App.alertMigration = (() => {
  const RE = App.ruleEngine, AL = App.alerts;

  // ---------------------------------------------------------------- phase 1–2: inventory and classification
  // class: DOMAIN_ALERT | VALIDATION_ERROR | DATA_QUALITY_WARNING | UI_HINT | RECOMMENDATION_REASON | TECHNICAL_DIAGNOSTIC
  const I = (id, location, condition, severity, wording, target, klass, migratedTo, notes) => Object.freeze({ id, location, condition, severity, wording, target, class: klass, migratedTo, clientVisible: !/broker|técnico/i.test(notes || ''), notes: notes || null });
  const SC = 'config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert)';
  const INVENTORY = Object.freeze([
    I('NOISE', SC, 'notes.quiet < 5', 'ATTENTION', 'ATENÇÃO — RUÍDO: exposição potencial a …', 'LOT', 'DOMAIN_ALERT', 'NOISE', 'fontes vêm do traço do critério quiet'),
    I('PRIVACY', SC, 'notes.privacy < 4', 'ATTENTION', 'ATENÇÃO — PRIVACIDADE: [esquina; ][frente para duas ruas; ]fluxo …', 'LOT', 'DOMAIN_ALERT', 'PRIVACY'),
    I('AFTERNOON_SUN', SC, 'environmental.strongAfternoonSun = true', 'INFO', 'ATENÇÃO — SOL DA TARDE: frente|fundos voltada para oeste/noroeste', 'LOT', 'DOMAIN_ALERT', 'AFTERNOON_SUN', 'INFO: só aparece em detalhes (broker), não no Quick View'),
    I('TECHNICAL_AREA', SC, 'location.distanceToTechnicalAreaM < 40', 'IMPORTANT', 'ATENÇÃO — ÁREA TÉCNICA: a N m da EEEB …', 'LOT', 'DOMAIN_ALERT', 'TECHNICAL_AREA'),
    I('EASEMENT', SC, 'construction.adjacentToProjectedEasement = true', 'IMPORTANT', 'ATENÇÃO — SERVIDÃO: lote junto à "servidão projetada" …', 'LOT', 'DOMAIN_ALERT', 'EASEMENT', 'o adaptador legado também deriva construction.easements deste texto (dependência circular conhecida)'),
    I('AVENUE', SC, 'location.distanceToExternalRoadM <= 100', 'IMPORTANT', 'ATENÇÃO — AVENIDA: a planta prevê ampliação …', 'LOT', 'DOMAIN_ALERT', 'AVENUE'),
    I('TRAFFIC', SC, 'mobility.estimatedTraffic in [HIGH, VERY_HIGH]', 'ATTENTION', 'ATENÇÃO — TRÁFEGO: rua com fluxo estimado …', 'LOT', 'DOMAIN_ALERT', 'TRAFFIC'),
    I('GEOMETRY', SC, 'notes.geometry < 6 OR geometry.frontWidthM < 9', 'ATTENTION', 'ATENÇÃO — GEOMETRIA: forma[, frente de cerca de N m]', 'LOT', 'DOMAIN_ALERT', 'GEOMETRY', '"frente estreita" (< 9 m) é fixo no código (engine.js alertOf), agora parâmetro narrowFrontBelowM da versão'),
    I('BUILDING_RESTRICTION', SC, 'surroundings.rearClass = GREEN_EXTERNAL', 'IMPORTANT', 'ATENÇÃO — RESTRIÇÃO CONSTRUTIVA: APP/mata nos fundos …', 'LOT', 'DOMAIN_ALERT', 'BUILDING_RESTRICTION', 'o adaptador legado deriva construction.nonBuildableRearToConfirm deste alerta'),
    I('MISSING_AREA', SC, 'geometry.areaM2 is null', 'ATTENTION (via OTHER)', 'ATENÇÃO — ÁREA NÃO INFORMADA NA PLANTA', 'LOT', 'DATA_QUALITY_WARNING', 'MISSING_AREA', 'bug conhecido: texto sem ":" → o adaptador legado lê como OTHER sem título; AlertType não tem MISSING_AREA; nenhum lote atual dispara'),
    I('STATUS_NOTE', 'presentation/viewmodels.js statusVM', 'status = UNKNOWN OR freshness in [EXPIRED, STALE]', 'warn=true', 'Sem espelho de vendas … / Informação vencida … / Disponibilidade não confirmada … / (cliente) Disponibilidade sujeita a confirmação', 'LOT', 'DOMAIN_ALERT', 'AVAILABILITY_CONFIRMATION', 'mesma condição usada no aviso da comparação (overlays.js, col.status.warn)'),
    I('STATUS_UPDATED_HINT', 'presentation/viewmodels.js statusVM', 'fresh AND updatedAt (broker)', 'nenhuma', 'Atualizado há …', 'LOT', 'UI_HINT', null, 'não é alerta; continua na UI'),
    I('AVAILABLE_NOT_CONFIRMED_LABEL', 'presentation/viewmodels.js statusVM', 'AVAILABLE AND freshness ≠ FRESH', 'nenhuma', 'Disponível, não confirmado agora', 'LOT', 'UI_HINT', null, 'rótulo de status, não alerta'),
    I('SHARE_STATUS', 'presentation/viewmodels.js shareVM', 'status = UNKNOWN OR freshness ≠ FRESH', 'aviso', 'CODE: status não confirmado | pode estar desatualizado', 'LOT×SHARE', 'DOMAIN_ALERT', 'SHARE_STATUS_NOT_CONFIRMED', 'condição parecida com STATUS_NOTE, mas freshness UNKNOWN também conta aqui: mantidas separadas (revisão humana)'),
    I('SHARE_NOT_OFFERABLE', 'presentation/viewmodels.js shareVM', 'NOT(SHARE_STATUS) AND NOT isOfferable(status)', 'aviso', 'CODE: <status>, não é uma oportunidade disponível', 'LOT×SHARE', 'DOMAIN_ALERT', 'SHARE_NOT_OFFERABLE'),
    I('SHARE_PRICE', 'presentation/viewmodels.js shareVM', 'commercial freshness tracked AND ≠ FRESH AND price != null', 'aviso', 'CODE: preço baseado na última tabela disponível', 'LOT×SHARE', 'DOMAIN_ALERT', 'SHARE_PRICE_FROM_LAST_TABLE'),
    I('QUICKVIEW_ALERT_SUMMARY', 'quickview/quickview.js alertSummary', 'contagem por severidade', '—', '—', 'LOT', 'UI_HINT', 'App.alerts.quickViewSummary', 'projeção; paridade testada'),
    I('DETAILS_CLIENT_FILTER', 'presentation/viewmodels.js detailsVM', 'cliente vê só CRITICAL/IMPORTANT', '—', '—', 'LOT', 'UI_HINT', 'App.alerts.project(…, CLIENT)', 'política de público'),
    I('ATTENTION_POINTS', 'intelligence/engine.js result.attentionPoints', 'alertas com severidade ≠ INFO', '—', '—', 'LOT', 'UI_HINT', 'App.alerts.project', 'derivado, mesma fonte'),
    I('FILTER_WARNINGS', 'presentation/panels.js WARN (STALE_PRICE, STALE_AVAILABILITY, ESTIMATED_FIELD, …)', 'avisos do FilterEngine', '—', '—', 'FILTER', 'DATA_QUALITY_WARNING', null, 'avisos do filtro, não do lote; ficam no FilterEngine'),
    I('FILTER_INVALID', 'presentation/panels.js', 'filtros inválidos ignorados', '—', '—', 'FILTER', 'VALIDATION_ERROR', null, 'técnico/broker'),
    I('FILTER_ALERT_CRITERIA', 'filters/filters.js noNoiseAlert / alertsExclude', 'NOT_CONTAINS_TYPE sobre intelligence.alerts', '—', '—', 'FILTER', 'UI_HINT', null, 'consumidor de alertas; passa a ler a projeção legada'),
    I('COMPARE_OUT_OF_FILTER', 'presentation/overlays.js', 'lote da comparação fora do filtro', '—', '—', 'COMPARISON', 'UI_HINT', null),
    I('COMPARE_ALERT_COUNT', 'compare/comparisonDomain.js alertsCount', 'número de alertas', '—', '—', 'COMPARISON', 'UI_HINT', null, 'informativo; nunca decide vencedor'),
    I('SIMULATION_ELIGIBILITY', 'domain/availability.js simulationEligibility → panels.js', 'status não ofertável', '—', '—', 'LOT', 'VALIDATION_ERROR', null, 'gate de política (tópico 8), não alerta'),
    I('RECOMMENDATION_CONFLICTS', 'presentation/panels.js (rec.conflicts, INVALID_PROFILE)', 'perfil/exigências', '—', '—', 'CUSTOMER', 'RECOMMENDATION_REASON', null),
    I('EXPLANATION_NEGATIVE', 'presentation/panels.js "Ponto de atenção"', 'negativeFactors da explicação', '—', '—', 'CUSTOMER', 'RECOMMENDATION_REASON', null),
    I('ENGINE_DIAGNOSTICS', 'intelligence/engine.js diag (MISSING_INPUT, UNKNOWN_ENUM, NON_FINITE_VALUE, MODULE_FAILED)', '—', 'WARNING/ERROR', '—', 'LOT', 'TECHNICAL_DIAGNOSTIC', null),
    I('METHODOLOGY_VALIDATION', 'intelligence/methodology.js validate warnings', '—', '—', '—', 'CONFIG', 'VALIDATION_ERROR', null),
    I('OFFLINE_BANNER', 'presentation/viewmodels.js connectivityVM', 'OFFLINE/DEGRADED', '—', 'Você está offline …', 'APP', 'UI_HINT', null, 'operacional, não de lote')
  ]);

  /** translator of the methodology's alert DSL (when: criterion/field + eq/in/lt/lte/gt/gte/isNull/any/all) into the Rule AST */
  const OPS = { eq: 'EQ', lt: 'LT', lte: 'LTE', gt: 'GT', gte: 'GTE', in: 'IN' };
  const CRITERION_METRIC = { quiet: 'ANALYSIS_NOTE_QUIET', privacy: 'ANALYSIS_NOTE_PRIVACY', geometry: 'ANALYSIS_NOTE_GEOMETRY' };
  const FIELD_METRIC = { 'environmental.strongAfternoonSun': 'STRONG_AFTERNOON_SUN', 'location.distanceToTechnicalAreaM': 'DISTANCE_TECHNICAL_AREA_M', 'construction.adjacentToProjectedEasement': 'ADJACENT_PROJECTED_EASEMENT',
    'location.distanceToExternalRoadM': 'DISTANCE_EXTERNAL_ROAD_M', 'mobility.estimatedTraffic': 'ESTIMATED_TRAFFIC', 'geometry.frontWidthM': 'FRONT_WIDTH_M', 'surroundings.rearClass': 'REAR_CLASS', 'geometry.areaM2': 'AREA_M2' };
  /** fromMethodologyAlerts(cfg.alerts) → [{ type, condition (literals resolved), unmapped }] — used to prove the catalog encodes the methodology exactly */
  function fromMethodologyAlerts(alerts) {
    const conv = w => {
      if (w.any) return { type: 'LOGICAL', operator: 'OR', children: w.any.map(conv) };
      if (w.all) return { type: 'LOGICAL', operator: 'AND', children: w.all.map(conv) };
      const metricId = w.criterion ? CRITERION_METRIC[w.criterion] : FIELD_METRIC[w.field];
      if (!metricId) return { type: 'UNMAPPED', source: w };
      const left = { type: 'METRIC', metricId };
      if (w.isNull) return { type: 'EXISTS', operand: left, expected: false };
      const k = Object.keys(OPS).find(x => x in w);
      return { type: 'COMPARISON', left, operator: OPS[k], right: { value: w[k] } };
    };
    return alerts.map(a => ({ type: a.type, condition: conv(a.when) }));
  }
  /** a catalog condition with CONFIG/LITERAL operands resolved to plain values (comparable to fromMethodologyAlerts) */
  function resolvedCondition(compiled) {
    const op = o => o.type === 'CONFIG' ? { value: compiled.parameters[o.key] } : o.type === 'LITERAL' ? { value: o.value } : o;
    const walk = n => n.type === 'LOGICAL' ? { type: 'LOGICAL', operator: n.operator, children: n.children.map(walk) } : n.type === 'COMPARISON' ? { type: 'COMPARISON', left: op(n.left), operator: n.operator, right: op(n.right) } : n;
    return walk(compiled.condition);
  }

  // ---------------------------------------------------------------- legacy outputs (read as they are today)
  const legacy = Object.freeze({
    intelligenceAlerts: lot => lot.intelligence.alerts,
    statusNote: (lot, mode) => { const s = App.vm.statusVM(lot, mode); return s.warn ? { note: s.note, warn: true } : null; },
    shareWarnings: (lots, ctx) => App.vm.shareVM(lots, ctx).warnings,
    engineTexts: (result, input) => result.alerts.map(a => App.analysisText.alertText(a, result, input))
  });

  // ---------------------------------------------------------------- engine outputs, projected to the legacy shapes
  const ctxOf = (cat, opts) => ({ organizationId: cat.organizationId, developmentId: cat.developmentId, asOf: opts.asOf || null, executionMode: opts.executionMode || 'SHADOW' });
  const surfaceRules = (cat, surface) => cat.compiled.filter(r => (r.legacyProjection || {}).surface === surface);
  const engine = Object.freeze({
    evaluation: (cat, lot, analysisResult, opts = {}) => AL.evaluateLot(surfaceRules(cat, 'INTELLIGENCE_ALERTS'), lot, { ...ctxOf(cat, opts), analysisResult }),
    intelligenceAlerts: (cat, lot, analysisResult, opts = {}) => AL.toLegacyIntelligenceAlerts(engine.evaluation(cat, lot, analysisResult, opts).candidates, lot ? lot.identity.id : analysisResult.lotId),
    /** the "al" strings in analysis order (what textAdapter writes) */
    texts: (cat, lot, analysisResult, opts = {}) => engine.evaluation(cat, lot, analysisResult, opts).candidates.filter(c => c.reasonType === 'CONDITION').sort((a, b) => a.sequence - b.sequence).map(AL.legacyText),
    statusNote: (cat, lot, mode, opts = {}) => {
      const ev = AL.evaluateLot(surfaceRules(cat, 'STATUS_NOTE'), lot, ctxOf(cat, opts)), c = ev.candidates.find(x => x.reasonType === 'CONDITION');
      return c ? { note: c.messages[mode === 'client' ? 'CLIENT' : 'BROKER'], warn: true } : null;
    },
    shareWarnings: (cat, lots, opts = {}) => {
      const rules = surfaceRules(cat, 'SHARE_WARNINGS'), out = [];
      for (const l of lots) for (const c of AL.evaluateLot(rules, l, { ...ctxOf(cat, opts), contextType: 'SHARE', contextDiscriminator: opts.shareRef || 'SHARE' }).candidates.filter(x => x.reasonType === 'CONDITION').sort((a, b) => a.sequence - b.sequence)) out.push(c.messages.BROKER);
      return out;
    }
  });

  // ---------------------------------------------------------------- phase 5: shadow parity report
  const J = x => JSON.stringify(x);
  /** parityReport({ catalog, lots, analysisById, inputsById?, asOf, statusScenarios?, shareCtx? }) → LegacyAlertParityReport */
  function parityReport(o) {
    const cat = o.catalog, mismatches = [];
    let legacyAlerts = 0, engineAlerts = 0, exact = 0, missing = 0, extra = 0, sevMis = 0, wordMis = 0, unknown = 0, errors = 0, entities = 0;
    for (const lot of o.lots) {
      entities++;
      const a = o.analysisById.get(lot.identity.id);
      const L = legacy.intelligenceAlerts(lot), ev = engine.evaluation(cat, lot, a, o), E = AL.toLegacyIntelligenceAlerts(ev.candidates, lot.identity.id);
      unknown += ev.results.filter(r => r.truth === 'UNKNOWN').length; errors += ev.results.filter(r => r.truth === 'ERROR').length;
      legacyAlerts += L.length; engineAlerts += E.length;
      const lk = new Map(L.map(x => [x.type, x])), ek = new Map(E.map(x => [x.type, x]));
      for (const [t, x] of lk) {
        const y = ek.get(t);
        if (!y) { missing++; mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, type: t, kind: 'MISSING_IN_ENGINE', legacy: x }); continue; }
        if (x.severity !== y.severity) { sevMis++; mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, type: t, kind: 'SEVERITY_MISMATCH', legacy: x.severity, engine: y.severity }); }
        else if (x.message !== y.message || x.title !== y.title) { wordMis++; mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, type: t, kind: 'WORDING_MISMATCH', legacy: x.message, engine: y.message }); }
        else if (J(x) !== J(y)) mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, type: t, kind: 'FIELD_MISMATCH', legacy: x, engine: y });
        else exact++;
      }
      for (const [t, y] of ek) if (!lk.has(t)) { extra++; mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, type: t, kind: 'EXTRA_IN_ENGINE', engine: y }); }
      if (J(L.map(x => x.id)) !== J(E.map(x => x.id))) mismatches.push({ surface: 'INTELLIGENCE_ALERTS', entityId: lot.identity.id, kind: 'ORDER_MISMATCH', legacy: L.map(x => x.id), engine: E.map(x => x.id) });
      for (const mode of ['broker', 'client']) {
        const ls = legacy.statusNote(lot, mode), es = engine.statusNote(cat, lot, mode, o);
        if (J(ls) !== J(es)) mismatches.push({ surface: 'STATUS_NOTE', entityId: lot.identity.id, mode, kind: !ls ? 'EXTRA_IN_ENGINE' : !es ? 'MISSING_IN_ENGINE' : 'WORDING_MISMATCH', legacy: ls, engine: es });
      }
    }
    let shareCompared = 0;
    if (o.shareCtx) {
      const ls = legacy.shareWarnings(o.lots, o.shareCtx), es = engine.shareWarnings(cat, o.lots, o); shareCompared = ls.length;
      if (J(ls) !== J(es)) mismatches.push({ surface: 'SHARE_WARNINGS', kind: 'LIST_MISMATCH', legacy: ls.slice(0, 5), engine: es.slice(0, 5), legacyCount: ls.length, engineCount: es.length });
    }
    return { totalEvaluatedEntities: entities, totalLegacyAlerts: legacyAlerts, totalEngineAlerts: engineAlerts, exactMatchCount: exact, missingInEngineCount: missing, extraInEngineCount: extra,
      severityMismatchCount: sevMis, wordingMismatchCount: wordMis, unknownEvaluations: unknown, errorEvaluations: errors, shareWarningsCompared: shareCompared,
      ruleSetVersionId: cat.ruleSet.id, mismatches, generatedAt: o.asOf || null };
  }

  // ---------------------------------------------------------------- phase 6: integration entry points (legacy fallback kept)
  /** RULE_ENGINE_ALERTS_ENABLED: dev.features.ruleEngineAlerts === true (default false → legacy surfaces) */
  const enabled = dev => !!(dev && dev.features && dev.features.ruleEngineAlerts === true);
  /** intelligenceAlertsFor(lot, { dev, analysisResult, asOf }) → { alerts (legacy shape), source } — falls back to the legacy list when off or when the analysis is not loaded */
  function intelligenceAlertsFor(lot, opts = {}) {
    const cat = opts.catalog || AL.catalog(lot.identity.developmentId);
    if (!enabled(opts.dev) || !cat || !opts.analysisResult) return { alerts: legacy.intelligenceAlerts(lot), source: 'LEGACY' };
    try { return { alerts: engine.intelligenceAlerts(cat, lot, opts.analysisResult, opts), source: 'RULE_ENGINE', ruleSetVersionId: cat.ruleSet.id }; }
    catch (e) { return { alerts: legacy.intelligenceAlerts(lot), source: 'LEGACY_FALLBACK', error: e.code || 'ERROR' }; }
  }
  function statusNoteFor(lot, mode, opts = {}) {
    const cat = opts.catalog || AL.catalog(lot.identity.developmentId);
    if (!enabled(opts.dev) || !cat) return { note: legacy.statusNote(lot, mode), source: 'LEGACY' };
    return { note: engine.statusNote(cat, lot, mode, opts), source: 'RULE_ENGINE' };
  }
  function shareWarningsFor(lots, opts = {}) {
    const cat = opts.catalog || (lots[0] && AL.catalog(lots[0].identity.developmentId));
    if (!enabled(opts.dev) || !cat) return { warnings: legacy.shareWarnings(lots, opts.shareCtx || { dev: opts.dev, mode: opts.mode }), source: 'LEGACY' };
    return { warnings: engine.shareWarnings(cat, lots, opts), source: 'RULE_ENGINE' };
  }
  return Object.freeze({ INVENTORY, fromMethodologyAlerts, resolvedCondition, legacy, engine, parityReport, enabled, intelligenceAlertsFor, statusNoteFor, shareWarningsFor });
})();
