/* rules/alertDomain.js — Alert Domain (topic 36): facts, candidates, AlertInstance lifecycle,
   reconciliation (dedup, severity change, auto-resolve, reopen, episodes), suppression,
   hysteresis, audience projection and sort policy.

   RuleEngine (rules/ruleCore.js) answers "is the condition TRUE/FALSE/UNKNOWN?".
   This module answers "what occurrence exists, in which state, for whom?".
   Nothing here changes a score, a class, Fit, Recommendation, a comparison winner or an
   Availability status, and nothing sends a notification: events are returned for a future
   subscriber. Customer-context alerts never become base lot alerts.

   API (App.alerts):
     catalog(developmentId) → { doc, registry, ruleSet, compiled }   (bundled config/rules/<dev>.json)
     facts.forLot(lot, analysis?) → RuleEvaluationInput.facts
     evaluateLot(compiledRules, lot, opts) → { results, candidates }
     store({ organizationId }) → AlertStore with reconcile(results, opts), acknowledge/snooze/dismiss/reopen, history, events
     project(alert, audience) / sortAlerts(list) / quickViewSummary(list, max) */
App.alerts = (() => {
  const RE = App.ruleEngine, checksum = RE.checksum, freeze = o => App.domain.deepFreeze(o);
  const STATES = Object.freeze(['ACTIVE', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED', 'DISMISSED']);
  const REASON_TYPES = Object.freeze(['CONDITION', 'REVIEW', 'DATA_QUALITY']);
  const err = (code, message) => Object.assign(new Error(message), { code });
  const SEV = App.enums.SEVERITY_ORDER;

  // ---------------------------------------------------------------- catalog (bundled, published, read-only)
  const catalogs = new Map();
  /** catalog(dev) → the bundled rule catalog loaded into a tenant-scoped registry, with its PUBLISHED rule set compiled */
  function catalog(developmentId, opts = {}) {
    const doc = opts.doc || (App.configs && App.configs.rules && App.configs.rules[developmentId]);
    if (!doc) return null;
    const key = developmentId + ':' + checksum(doc);
    if (!opts.doc && catalogs.has(key)) return catalogs.get(key);
    const reg = RE.ruleSetRegistry({ organizationId: doc.organizationId });
    doc.definitions.forEach(d => reg.addDefinition(d));
    doc.versions.forEach(v => reg.addVersion(v, { importPublished: true }));
    const compiled = doc.ruleSet.ruleVersionIds.map(id => reg.compiledOf(id)); // throws if a published rule no longer validates
    const out = Object.freeze({ doc, registry: reg, ruleSet: doc.ruleSet, compiled: Object.freeze(compiled), byCode: new Map(compiled.map(c => [c.code, c])), organizationId: doc.organizationId, developmentId,
      featureFlag: doc.featureFlag, featureFlagDefault: doc.featureFlagDefault === true });
    if (!opts.doc) catalogs.set(key, out);
    return out;
  }

  // ---------------------------------------------------------------- facts (the engine never fetches: the caller builds them here)
  const getPath = (o, p) => p.split('.').reduce((x, k) => x == null ? undefined : x[k], o);
  /** noise sources from the published analysis trace (the same steps the legacy wording reads) */
  function noiseSources(result) {
    return (result.criteriaTrace.quiet || []).filter(s => s.reason && s.reason.startsWith('NOISE_SOURCE_')).map(s => s.reason === 'NOISE_SOURCE_STREET_FLOW'
      ? { kind: 'STREET_FLOW', source: 'STREET_FLOW', distanceM: null, level: s.input } : { kind: 'POINT', source: s.reason.replace('NOISE_SOURCE_', ''), distanceM: s.input, level: null });
  }
  /** analysis facts: from a LotAnalysisResult (IntelligenceEngine, unrounded) — null stays null */
  function analysisFacts(result) {
    const m = result.metrics || {}, n = result.notes || {}, v = k => m[k] === undefined ? null : m[k];
    return {
      ANALYSIS_NOTE_QUIET: n.quiet ?? null, ANALYSIS_NOTE_PRIVACY: n.privacy ?? null, ANALYSIS_NOTE_GEOMETRY: n.geometry ?? null,
      STRONG_AFTERNOON_SUN: v('environmental.strongAfternoonSun'), STRONG_AFTERNOON_SIDE: v('environmental.strongAfternoonSide'),
      DISTANCE_TECHNICAL_AREA_M: v('location.distanceToTechnicalAreaM'), DISTANCE_EXTERNAL_ROAD_M: v('location.distanceToExternalRoadM'),
      ADJACENT_PROJECTED_EASEMENT: v('construction.adjacentToProjectedEasement'), ESTIMATED_TRAFFIC: v('mobility.estimatedTraffic'),
      FRONT_WIDTH_M: v('geometry.frontWidthM'), SHAPE_CLASS: v('geometry.shapeClass'), IS_CORNER: v('geometry.isCorner'), HAS_TWO_FRONTS: v('geometry.hasTwoFronts'),
      REAR_CLASS: v('surroundings.rearClass'), AREA_M2: v('geometry.areaM2'), NOISE_SOURCES: noiseSources(result)
    };
  }
  const LOT_ATTRIBUTES = ['identity.code', 'availability.status', 'availability.freshness', 'availability.updatedAt', 'commercial.price'];
  /** forLot(lot, analysisResult?) → { metrics, attributes }. Analysis metrics are absent (not null) when the analysis was not loaded. */
  function forLot(lot, analysisResult, opts = {}) {
    const attributes = {}, metrics = {};
    if (lot) {
      for (const p of LOT_ATTRIBUTES) attributes[p] = getPath(lot, p) === undefined ? null : getPath(lot, p);
      const fr = lot.metadata && lot.metadata.freshness;
      metrics.COMMERCIAL_FRESHNESS_TRACKED = !!fr;
      if (fr) metrics.COMMERCIAL_FRESHNESS = fr.commercial === undefined ? null : fr.commercial;
    }
    if (analysisResult) Object.assign(metrics, analysisFacts(analysisResult));
    return { metrics, attributes };
  }
  /** evaluation input for a lot (coherent snapshot: one set of facts and one asOf for every rule) */
  function inputFor(lot, analysisResult, ctx = {}) {
    const id = lot ? lot.identity.id : analysisResult.lotId;
    const dv = (lot && lot.metadata && lot.metadata.dataVersions) || {};
    const refs = ctx.dataVersionRefs || [
      dv.analysisVersion && { type: 'ANALYSIS_VERSION', id: String(dv.analysisVersion) }, dv.priceTableVersion && { type: 'PRICE_TABLE_VERSION', id: String(dv.priceTableVersion) },
      dv.availabilityRevision != null && { type: 'AVAILABILITY_REVISION', id: String(dv.availabilityRevision) }, dv.staticVersion && { type: 'STATIC_DATA_VERSION', id: String(dv.staticVersion) }].filter(Boolean);
    return { organizationId: ctx.organizationId, developmentId: ctx.developmentId || (lot && lot.identity.developmentId) || null, entity: { type: 'LOT', id, code: lot ? lot.identity.code : analysisResult.code },
      facts: forLot(lot, analysisResult), context: { asOf: ctx.asOf || null, executionMode: ctx.executionMode || 'SHADOW', dataVersionRefs: refs, contextDiscriminator: ctx.contextDiscriminator || null, contextRef: ctx.contextRef || null } };
  }

  // ---------------------------------------------------------------- candidates
  const alertKeyOf = (ruleDefinitionId, entityType, entityId, discriminator, reasonType = 'CONDITION') => [ruleDefinitionId, entityType, entityId, discriminator || 'BASE', reasonType].join('|');
  /** candidateOf(rule, result, input, audienceMessages) → AlertCandidate | null (ERROR never creates a business alert) */
  function candidateOf(rule, result, input) {
    let reasonType = null, severity = result.severity;
    if (result.truth === 'TRUE') reasonType = 'CONDITION';
    else if (result.truth === 'UNKNOWN' && rule.unknownPolicy.behavior === 'CREATE_REVIEW_ALERT') { reasonType = 'REVIEW'; severity = 'ATTENTION'; }
    else if (result.truth === 'UNKNOWN' && rule.unknownPolicy.behavior === 'CREATE_DATA_QUALITY_ALERT') { reasonType = 'DATA_QUALITY'; severity = 'INFO'; }
    if (!reasonType) return null;
    const messages = {};
    if (reasonType === 'CONDITION') for (const aud of ['BROKER', 'CLIENT']) messages[aud] = RE.render(rule, input, aud);
    const key = alertKeyOf(rule.ruleDefinitionId, result.targetEntityType, result.targetEntityId, result.contextDiscriminator, reasonType);
    const fp = checksum({ key, severity, ops: result.evaluatedOperands.map(o => [o.operandRef, o.resolvedValue]), messages });
    return freeze({ organizationId: result.organizationId, developmentId: result.developmentId, ruleDefinitionId: rule.ruleDefinitionId, ruleVersionId: rule.ruleVersionId, ruleCode: rule.code, category: rule.category,
      contextType: rule.contextType, targetEntityType: result.targetEntityType, targetEntityId: result.targetEntityId, targetEntityCode: input.entity.code || null, severity, reasonType,
      alertKey: key, alertFingerprint: fp, reasonCodes: result.reasonCodes, evidenceRefs: result.evidenceRefs, messages, firstObservedAt: result.evaluatedAt, observedAt: result.evaluatedAt,
      evaluationResultId: result.id, sequence: rule.sequence, legacyProjection: rule.legacyProjection, explanation: RE.explain(rule, result) });
  }
  /** evaluateLot(rules, lot, { analysisResult, asOf, organizationId, contextType }) → { results, candidates } */
  function evaluateLot(rules, lot, opts = {}) {
    const input = inputFor(lot, opts.analysisResult, opts), results = [], candidates = [];
    for (const r of rules) {
      if (opts.contextType && r.contextType !== opts.contextType) continue;
      if (opts.surface && (r.legacyProjection || {}).surface !== opts.surface) continue;
      const res = RE.evaluate(r, input, { activeState: opts.activeKeys ? opts.activeKeys.has(alertKeyOf(r.ruleDefinitionId, 'LOT', input.entity.id, input.context.contextDiscriminator)) : false });
      results.push(res); const c = candidateOf(r, res, input); if (c) candidates.push(c);
    }
    return { input, results, candidates };
  }

  // ---------------------------------------------------------------- reconciliation and lifecycle
  /** store({ organizationId }) → AlertStore (in memory; the backend persists the same records with optimistic `version`) */
  function store(tenant) {
    if (!tenant || !tenant.organizationId) throw err('TENANT_REQUIRED', 'TenantContext obrigatório');
    const org = tenant.organizationId, byKey = new Map(), events = [], history = [], pending = new Map();
    const emit = (type, inst, extra = {}) => { const e = { type, alertKey: inst.alertKey, alertInstanceId: inst.id, ruleCode: inst.ruleCode, ruleVersionId: inst.currentRuleVersionId, entityId: inst.targetEntityId, severity: inst.currentSeverity, at: extra.at || null, ...extra }; events.push(Object.freeze(e)); history.push(e); return e; };
    const policyOf = rule => ({ ...RE.DEFAULT_LIFECYCLE, ...((rule && rule.lifecyclePolicy) || {}) });
    const counter = (key, kind) => { const p = pending.get(key) || { up: 0, down: 0 }; if (kind === 'up') { p.up++; p.down = 0; } else { p.down++; p.up = 0; } pending.set(key, p); return p; };
    /** reconcile(evaluations, { rules, now, mode }) — evaluations: [{ result, candidate }] from one coherent run */
    function reconcile(evals, opts = {}) {
      const mode = opts.mode || 'PUBLISHED', now = opts.now || null, out = [];
      if (mode === 'REPLAY') return { mutated: false, changes: [], reason: 'REPLAY_NEVER_MUTATES_LIVE_ALERTS' };
      const rules = opts.rules ? new Map(opts.rules.map(r => [r.ruleVersionId, r])) : new Map();
      for (const { result, candidate } of evals) {
        if (result.organizationId && result.organizationId !== org) throw err('TENANT_MISMATCH', 'avaliação de outro tenant');
        if (result.truth === 'ERROR' || result.truth === 'NOT_APPLICABLE') continue; // technical failure never opens/resolves a business alert
        const rule = rules.get(result.ruleVersionId), pol = policyOf(rule), h = rule && rule.hysteresisPolicy, sup = (rule && rule.suppressionPolicy) || {};
        const key = candidate ? candidate.alertKey : alertKeyOf(result.ruleDefinitionId, result.targetEntityType, result.targetEntityId, result.contextDiscriminator);
        const inst = byKey.get(key);
        if (candidate) {
          const p = counter(key, 'up');
          if (h && h.activationConsecutiveEvaluations > 1 && (!inst || ['RESOLVED'].includes(inst.lifecycleState)) && p.up < h.activationConsecutiveEvaluations) { out.push({ key, action: 'PENDING_ACTIVATION' }); continue; }
          if (!inst) {
            const n = { id: 'alert:' + checksum(key), organizationId: org, developmentId: candidate.developmentId, ruleDefinitionId: candidate.ruleDefinitionId, ruleCode: candidate.ruleCode, category: candidate.category, contextType: candidate.contextType,
              targetEntityType: candidate.targetEntityType, targetEntityId: candidate.targetEntityId, targetEntityCode: candidate.targetEntityCode, alertKey: key, reasonType: candidate.reasonType,
              lifecycleState: 'ACTIVE', currentSeverity: candidate.severity, currentRuleVersionId: candidate.ruleVersionId, currentEvaluationResultId: candidate.evaluationResultId,
              firstTriggeredAt: now, lastTriggeredAt: now, lastEvaluatedAt: now, occurrenceCount: 1, currentFingerprint: candidate.alertFingerprint, version: 1,
              messages: candidate.messages, evidenceRefs: candidate.evidenceRefs, explanation: candidate.explanation, sequence: candidate.sequence, legacyProjection: candidate.legacyProjection,
              episodes: [{ episodeId: key + '#1', startedAt: now, endedAt: null, acknowledgedAt: null }] };
            byKey.set(key, n); emit('ALERT_OPENED', n, { at: now }); out.push({ key, action: 'OPENED' }); continue;
          }
          inst.lastEvaluatedAt = now; inst.currentEvaluationResultId = candidate.evaluationResultId;
          if (inst.lifecycleState === 'RESOLVED') {
            if (!pol.reopenWhenTrue) { out.push({ key, action: 'NOT_REOPENED_POLICY' }); continue; }
            const inCooldown = sup.cooldownSeconds && inst.resolvedAt && now && (Date.parse(now) - Date.parse(inst.resolvedAt)) / 1000 < sup.cooldownSeconds;
            inst.lifecycleState = 'ACTIVE'; inst.resolvedAt = undefined; inst.resolutionReasonCode = undefined; inst.occurrenceCount++; inst.lastTriggeredAt = now; inst.version++;
            Object.assign(inst, { currentSeverity: candidate.severity, currentRuleVersionId: candidate.ruleVersionId, currentFingerprint: candidate.alertFingerprint, messages: candidate.messages, explanation: candidate.explanation, evidenceRefs: candidate.evidenceRefs });
            inst.episodes.push({ episodeId: `${key}#${inst.episodes.length + 1}`, startedAt: now, endedAt: null, acknowledgedAt: null });
            if (!pol.preserveAcknowledgementOnRetrigger) { inst.acknowledgedAt = undefined; inst.acknowledgedBy = undefined; }
            emit('ALERT_REOPENED', inst, { at: now, suppressed: !!inCooldown, suppressionReasonCode: inCooldown ? 'COOLDOWN' : undefined }); out.push({ key, action: inCooldown ? 'REOPENED_SUPPRESSED' : 'REOPENED' }); continue;
          }
          if (inst.lifecycleState === 'DISMISSED') { out.push({ key, action: 'KEPT_DISMISSED' }); continue; } // dismissal holds while the condition stays true
          if (inst.lifecycleState === 'SNOOZED' && inst.snoozedUntil && now && now >= inst.snoozedUntil) { inst.lifecycleState = inst.acknowledgedAt ? 'ACKNOWLEDGED' : 'ACTIVE'; inst.snoozedUntil = undefined; inst.version++; emit('ALERT_SNOOZE_EXPIRED', inst, { at: now }); }
          if (inst.currentFingerprint === candidate.alertFingerprint && sup.suppressRepeatedFingerprint !== false) { out.push({ key, action: 'UNCHANGED' }); continue; } // no spam: same fingerprint = same occurrence
          const prevSev = inst.currentSeverity;
          Object.assign(inst, { currentSeverity: candidate.severity, currentRuleVersionId: candidate.ruleVersionId, currentFingerprint: candidate.alertFingerprint, messages: candidate.messages, explanation: candidate.explanation, evidenceRefs: candidate.evidenceRefs, lastTriggeredAt: now });
          inst.version++;
          if (prevSev !== candidate.severity) { emit('ALERT_SEVERITY_CHANGED', inst, { at: now, from: prevSev, to: candidate.severity }); out.push({ key, action: 'SEVERITY_CHANGED' }); }
          else { emit('ALERT_UPDATED', inst, { at: now }); out.push({ key, action: 'UPDATED' }); }
          continue;
        }
        // no candidate: FALSE, or UNKNOWN with NO_ALERT / BLOCK_EVALUATION
        if (!inst || inst.lifecycleState === 'RESOLVED') { counter(key, 'down'); continue; }
        if (result.truth === 'UNKNOWN') { inst.lastEvaluatedAt = now; out.push({ key, action: 'KEPT_UNKNOWN' }); continue; } // unknown is not "condition gone"
        const p = counter(key, 'down');
        if (h && h.resolutionConsecutiveEvaluations > 1 && p.down < h.resolutionConsecutiveEvaluations) { out.push({ key, action: 'PENDING_RESOLUTION' }); continue; }
        if (h && h.minimumActiveDurationSeconds && now && inst.lastTriggeredAt && (Date.parse(now) - Date.parse(inst.lastTriggeredAt)) / 1000 < h.minimumActiveDurationSeconds) { out.push({ key, action: 'PENDING_RESOLUTION' }); continue; }
        if (!pol.autoResolveWhenFalse) { inst.lastEvaluatedAt = now; out.push({ key, action: 'MANUAL_RESOLUTION_REQUIRED' }); continue; }
        inst.lifecycleState = 'RESOLVED'; inst.resolvedAt = now; inst.resolutionReasonCode = 'CONDITION_FALSE'; inst.lastEvaluatedAt = now; inst.version++;
        const ep = inst.episodes[inst.episodes.length - 1]; if (ep) ep.endedAt = now;
        emit('ALERT_RESOLVED', inst, { at: now }); out.push({ key, action: 'RESOLVED' });
      }
      return { mutated: true, changes: out };
    }
    const need = (meta, perm) => { if (typeof meta.can !== 'function' || !meta.can(perm)) throw err('FORBIDDEN', `ação exige ${perm}`); if (meta.offline) throw err('OFFLINE_WRITE_NOT_ALLOWED', 'ações sobre alertas exigem conexão (sem escrita autoritativa offline)'); };
    const find = (key, expectedVersion) => {
      const i = byKey.get(key); if (!i) throw err('NOT_FOUND', 'alerta inexistente');
      if (expectedVersion != null && expectedVersion !== i.version) throw err('ALERT_VERSION_CONFLICT', `versão ${i.version}, esperada ${expectedVersion}`);
      return i;
    };
    /** acknowledge: the condition remains; idempotent */
    function acknowledge(key, meta = {}) {
      need(meta, 'alert.acknowledge'); const i = find(key, meta.expectedVersion), pol = policyOf(meta.rule);
      if (!pol.acknowledgeAllowed) throw err('ACTION_NOT_ALLOWED', 'esta regra não permite reconhecer');
      if (i.lifecycleState === 'ACKNOWLEDGED') return i;
      if (!['ACTIVE', 'SNOOZED'].includes(i.lifecycleState)) throw err('INVALID_TRANSITION', `${i.lifecycleState} → ACKNOWLEDGED`);
      i.lifecycleState = 'ACKNOWLEDGED'; i.acknowledgedAt = meta.at || null; i.acknowledgedBy = meta.by || null; i.version++;
      const ep = i.episodes[i.episodes.length - 1]; if (ep) ep.acknowledgedAt = i.acknowledgedAt; // acknowledgement is scoped to the episode
      emit('ALERT_ACKNOWLEDGED', i, { at: meta.at || null }); return i;
    }
    function snooze(key, meta = {}) {
      need(meta, 'alert.snooze'); const i = find(key, meta.expectedVersion), pol = policyOf(meta.rule);
      if (!pol.snoozeAllowed) throw err('ACTION_NOT_ALLOWED', 'esta regra não permite adiar');
      if (!meta.until) throw err('MISSING_UNTIL', 'adiar exige a data final');
      if (!['ACTIVE', 'ACKNOWLEDGED'].includes(i.lifecycleState)) throw err('INVALID_TRANSITION', `${i.lifecycleState} → SNOOZED`);
      i.lifecycleState = 'SNOOZED'; i.snoozedUntil = meta.until; i.version++; emit('ALERT_SNOOZED', i, { at: meta.at || null, until: meta.until }); return i;
    }
    function dismiss(key, meta = {}) {
      need(meta, 'alert.dismiss'); const i = find(key, meta.expectedVersion), pol = policyOf(meta.rule);
      if (!pol.dismissAllowed || (i.currentSeverity === 'CRITICAL' && !meta.allowCritical)) throw err('DISMISS_NOT_ALLOWED', 'este alerta não pode ser descartado');
      if (!meta.reasonCode) throw err('MISSING_REASON', 'descartar exige o motivo');
      if (i.lifecycleState === 'RESOLVED') throw err('INVALID_TRANSITION', 'RESOLVED → DISMISSED');
      i.lifecycleState = 'DISMISSED'; i.dismissedAt = meta.at || null; i.dismissedBy = meta.by || null; i.dismissalReasonCode = meta.reasonCode; i.version++;
      emit('ALERT_DISMISSED', i, { at: meta.at || null, reasonCode: meta.reasonCode }); return i;
    }
    /** expire snoozes at `now` (the timer/job is future work; callers pass the clock explicitly) */
    function expireSnoozes(now) { const out = []; for (const i of byKey.values()) if (i.lifecycleState === 'SNOOZED' && i.snoozedUntil && now >= i.snoozedUntil) { i.lifecycleState = i.acknowledgedAt ? 'ACKNOWLEDGED' : 'ACTIVE'; i.snoozedUntil = undefined; i.version++; emit('ALERT_SNOOZE_EXPIRED', i, { at: now }); out.push(i.alertKey); } return out; }
    const visible = i => ['ACTIVE', 'ACKNOWLEDGED', 'SNOOZED'].includes(i.lifecycleState);
    return { organizationId: org, reconcile, acknowledge, snooze, dismiss, expireSnoozes, get: key => byKey.get(key) || null, all: () => [...byKey.values()],
      active: entityId => [...byKey.values()].filter(i => visible(i) && (!entityId || i.targetEntityId === entityId)), activeKeys: () => new Set([...byKey.values()].filter(visible).map(i => i.alertKey)),
      events: () => events.slice(), drainEvents: () => events.splice(0), history: key => history.filter(e => !key || e.alertKey === key) };
  }

  // ---------------------------------------------------------------- projection, sort, summaries
  /** sort policy: severity (CRITICAL first), then rule sequence, then entity; deterministic */
  const sortAlerts = list => list.slice().sort((a, b) => SEV.indexOf(a.severity || a.currentSeverity) - SEV.indexOf(b.severity || b.currentSeverity) || (a.sequence || 0) - (b.sequence || 0) || String(a.targetEntityId).localeCompare(String(b.targetEntityId)));
  /** legacy wording of the INTELLIGENCE_ALERTS surface (same string as lots.json "al") */
  function legacyText(c) { const lp = c.legacyProjection || {}, msg = c.messages.BROKER; return lp.textFormat === 'TITLE_PREFIX' ? `ATENÇÃO — ${lp.title}: ${msg}` : msg; }
  /** legacy shape of lot.intelligence.alerts: { id, type, severity, title, message, fieldKey, sourceId } in the legacy order */
  function toLegacyIntelligenceAlerts(candidates, lotId) {
    const own = candidates.filter(c => (c.legacyProjection || {}).surface === 'INTELLIGENCE_ALERTS' && c.reasonType === 'CONDITION').sort((a, b) => a.sequence - b.sequence);
    const withIdx = own.map((c, i) => ({ c, i }));
    // the legacy list is ordered by severity with a stable sort over the analysis order
    withIdx.sort((x, y) => SEV.indexOf(x.c.severity) - SEV.indexOf(y.c.severity) || x.i - y.i);
    return withIdx.map(({ c, i }) => {
      const lp = c.legacyProjection, titled = lp.textFormat === 'TITLE_PREFIX';
      return { id: `${lotId}-${lp.type}-${i}`, type: lp.type, severity: c.severity, title: titled ? lp.title : null, message: titled ? c.messages.BROKER : legacyText(c), fieldKey: lp.fieldKey, sourceId: lp.sourceId };
    });
  }
  /** audience projection. CLIENT: no rule ids/versions/fingerprints, client wording, only CRITICAL/IMPORTANT (as the details view today). */
  const CLIENT_SEVERITIES = ['CRITICAL', 'IMPORTANT'];
  function project(a, audience = 'BROKER') {
    const sev = a.severity || a.currentSeverity, lp = a.legacyProjection || {}, typeCode = lp.type || a.ruleCode;
    if (audience === 'CLIENT' && !CLIENT_SEVERITIES.includes(sev)) return null;
    const base = { type: typeCode, severity: sev, severityLabel: App.i18n.t('Severity', sev), typeLabel: App.i18n.t('AlertType', typeCode), message: (a.messages || {})[audience === 'CLIENT' ? 'CLIENT' : 'BROKER'], category: a.category, state: a.lifecycleState || 'ACTIVE' };
    if (audience === 'CLIENT') return base;
    const broker = { ...base, alertKey: a.alertKey, fieldKey: lp.fieldKey || null, acknowledged: a.lifecycleState === 'ACKNOWLEDGED', reasonType: a.reasonType };
    if (audience !== 'TECHNICAL') return broker;
    return { ...broker, ruleCode: a.ruleCode, ruleDefinitionId: a.ruleDefinitionId, ruleVersionId: a.currentRuleVersionId || a.ruleVersionId, fingerprint: a.currentFingerprint || a.alertFingerprint, explanation: a.explanation, evidenceRefs: a.evidenceRefs };
  }
  /** QuickViewAlertSummary from alert-domain items (same counting and ordering as quickview.alertSummary) */
  function quickViewSummary(alerts, max) {
    const by = s => alerts.filter(a => a.severity === s), crit = by('CRITICAL'), imp = by('IMPORTANT'), att = by('ATTENTION'), info = by('INFO');
    const top = [...crit, ...imp, ...att].sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity)).slice(0, Math.max(max, crit.length + imp.length));
    return { criticalCount: crit.length, importantCount: imp.length, attentionCount: att.length, infoCount: info.length, total: alerts.length, hasBlockingAlert: crit.length > 0,
      topAlerts: top.map(a => ({ ...a, typeLabel: App.i18n.t('AlertType', a.type), severityLabel: App.i18n.t('Severity', a.severity), section: 'intelligence' })), moreCount: Math.max(0, alerts.length - top.length) };
  }
  return Object.freeze({ STATES, REASON_TYPES, catalog, facts: Object.freeze({ forLot, analysisFacts, noiseSources, inputFor, LOT_ATTRIBUTES }), alertKeyOf, candidateOf, evaluateLot, store,
    sortAlerts, project, legacyText, toLegacyIntelligenceAlerts, quickViewSummary });
})();
