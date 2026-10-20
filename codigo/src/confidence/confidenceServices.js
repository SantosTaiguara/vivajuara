/* confidence/confidenceServices.js — Topic 34 application layer (SHADOW by default).
   MethodologyRegistry (lifecycle DRAFT → VALIDATED → PUBLISHED, published = immutable by checksum),
   InputBuilder (Topic 33 provenance → ConfidenceInput), DependencyResolver (memo, cycle guard, max depth),
   ApplicationService (evaluate / entity / development), Repository (append-only history), Cache (tenant + version keys),
   Projection (CLIENT / BROKER / TECHNICAL / AUDIT honoring ExecutionMode), LotConfidenceSummary, Diagnostics,
   Snapshot, MethodologyImpactReport, MIXED_METHODOLOGY check, events.
   Shadow guarantee: nothing here writes to lots, scores, classes, rankings, Fit, Recommendation, winner, colors or filters. */
App.dataConfidenceServices = (() => {
  const C = App.dataConfidence, P = App.provenance, I = App.integrity;
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const iso = t => t == null ? null : typeof t === 'string' ? t : new Date(t).toISOString();
  const err = (code, message, extra) => ({ ok: false, code, message: message || code, ...(extra || {}) });
  const orgOf = t => { if (!t || !t.organizationId) throw Object.assign(new Error('TenantContext obrigatório'), { code: 'TENANT_REQUIRED' }); return t.organizationId; };
  const configOf = devId => (App.configs && App.configs.confidence && App.configs.confidence[devId]) || null;

  // ------------------------------------------------------------------ methodology registry
  function createMethodologyRegistry(devId, o = {}) {
    const cfg = o.config || configOf(devId) || { methodologies: [] }, list = new Map();
    for (const m of cfg.methodologies || []) { const x = { ...clone(m) }; x.checksum = C.checksumOf(x); list.set(x.version, freeze(x)); }
    const executionMode = C.ExecutionMode[o.executionMode || cfg.executionMode] ? (o.executionMode || cfg.executionMode) : 'DISABLED';
    const current = () => { const pub = [...list.values()].filter(m => m.status === 'PUBLISHED'); if (pub.length) return pub[pub.length - 1]; const all = [...list.values()].filter(m => m.status !== 'ARCHIVED'); return all[all.length - 1] || null; };
    return Object.freeze({ executionMode, get: v => list.get(v) || null, list: () => [...list.values()], current,
      /** add(m) — a new version (drafts only); a published version can never be edited */
      add(m) { if (list.has(m.version) && list.get(m.version).status === 'PUBLISHED') return err('CONFIDENCE_METHODOLOGY_IMMUTABLE', 'versão publicada é imutável: crie nova versão');
        const x = freeze({ ...clone(m), status: m.status === 'PUBLISHED' ? 'DRAFT' : m.status, checksum: C.checksumOf(m) }); const v = C.validateMethodology(x); if (!v.valid) return err('CONFIDENCE_WEIGHT_CONFIGURATION_INVALID', 'metodologia inválida', { errors: v.errors });
        list.set(x.version, x); return { ok: true, methodology: x }; },
      /** publish(version, access) — validated only, explicit permission, never automatic */
      publish(version, access, now) { if (!(access && typeof access.can === 'function' && access.can(C.PERMISSIONS.METHODOLOGY_MANAGE, {}))) return err('CONFIDENCE_ACCESS_DENIED');
        const m = list.get(version); if (!m) return err('CONFIDENCE_METHODOLOGY_NOT_FOUND'); if (m.status !== 'VALIDATED') return err('CONFIDENCE_METHODOLOGY_NOT_VALIDATED', 'só metodologia VALIDATED pode ser publicada');
        const v = C.validateMethodology(m); if (!v.valid) return err('CONFIDENCE_WEIGHT_CONFIGURATION_INVALID', null, { errors: v.errors });
        const p = freeze({ ...clone(m), status: 'PUBLISHED', publishedAt: iso(now) }); list.set(version, p); return { ok: true, methodology: p }; } });
  }

  // ------------------------------------------------------------------ repository (append-only history) + cache
  function createRepository() {
    const byOrg = new Map(), S = t => { const o = orgOf(t); if (!byOrg.has(o)) byOrg.set(o, { results: new Map(), latest: new Map(), history: new Map() }); return byOrg.get(o); };
    const k = (a, b, c) => a + '|' + b + '|' + c;
    return Object.freeze({
      put(t, r) { if (r.organizationId !== t.organizationId) return err('CONFIDENCE_TENANT_MISMATCH'); const s = S(t); s.results.set(r.id, r); const key = k(r.entityType, r.entityId, r.attributePath);
        if (!s.history.has(key)) s.history.set(key, []); const h = s.history.get(key); if (!h.length || h[h.length - 1].resultId !== r.id) h.push(freeze({ resultId: r.id, valueFingerprint: r.valueFingerprint, score: r.score, band: r.band, status: r.status, methodologyVersion: r.methodologyVersion, evaluatedAt: r.evaluatedAt, asOf: r.asOf }));
        s.latest.set(key, r.id); return { ok: true }; },
      get: (t, id) => S(t).results.get(id) || null,
      latest: (t, et, id, p) => { const s = S(t), x = s.latest.get(k(et, id, p)); return x ? s.results.get(x) : null; },
      history: (t, et, id, p) => [...(S(t).history.get(k(et, id, p)) || [])],
      all: t => [...S(t).latest.values()].map(id => S(t).results.get(id)), clearOrganization: o => byOrg.delete(o) });
  }
  function createCache() {
    const m = new Map();
    /** ConfidenceInvalidationKey: org, dev, entity, path, value fingerprint, provenance id, methodology version, asOf bucket */
    const key = (x, mv, bucket) => App.tenancy.scopedKey(x.organizationId, 'conf', x.developmentId || '-', x.entityType, x.entityId, x.attributePath, x.valueFingerprint, x.provenanceId || '-', mv, bucket || '-', I.sha256(JSON.stringify((x.dependencyInputs || []).map(d => [d.attributePath, d.confidenceResultId, d.status]))).slice(0, 12));
    return Object.freeze({ key, get: k => m.get(k) || null, set: (k, v) => { m.set(k, v); }, size: () => m.size, clearOrganization: org => { const p = 'org:' + org + ':'; for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); }, clear: () => m.clear() });
  }
  function createEventLog() { const l = []; return Object.freeze({ emit: (type, o) => { const e = freeze({ type, ...clone(o) }); l.push(e); return e; }, list: f => l.filter(e => !f || !f.type || e.type === f.type) }); }

  // ------------------------------------------------------------------ application service
  /** createService({ provenance: provenanceService, developmentId, registry?, now?, documents? }) */
  function createService(o) {
    const prov = o.provenance, devId = o.developmentId, registry = o.registry || createMethodologyRegistry(devId, o), repo = o.repository || createRepository(), cache = o.cache || createCache(), events = o.events || createEventLog();
    const clock = () => o.now != null ? (typeof o.now === 'function' ? o.now() : o.now) : Date.now();
    const executionMode = registry.executionMode;

    /** buildInput(t, entityType, entityId, path, { methodology, asOf, deps }) → ConfidenceInput from Topic 33 facts */
    function buildInput(t, entityType, entityId, path, ctx) {
      const r = prov.repo.current(t, entityType, entityId, path); if (!r) return null;
      const ci = prov.confidenceInputs(t, entityType, entityId, path), m = ctx.methodology;
      const docRefs = r.evidenceRefs.filter(e => e.type === 'DOCUMENT_VERSION').map(e => e.documentSourceRef);
      const sources = r.evidenceRefs.filter(e => e.type !== 'ATTRIBUTE_DEPENDENCY' && e.type !== 'ANALYSIS_RESULT' && e.type !== 'USER_ASSERTION');
      const authorities = sources.map(e => ({ authority: e.type === 'DOCUMENT_VERSION' ? e.documentSourceRef.authority || 'UNKNOWN' : (r.metadata && r.metadata.sourceAuthority) || 'UNKNOWN', ref: e.type })); // unrecorded authority is UNKNOWN (never skipped, never inflated)
      const spec = docRefs.length ? docRefs.map(s => App.documents ? App.documents.locatorSpecificity(s.locator) : 'NONE').sort((a, b) => (m.locatorSpecificityRules[b] || 0) - (m.locatorSpecificityRules[a] || 0))[0] : null;
      const groups = sources.length > 1 && r.metadata && Array.isArray(r.metadata.sourceIndependenceGroups) ? r.metadata.sourceIndependenceGroups : undefined; // never inferred from filenames
      const conflict = r.conflictRef ? prov.repo.getConflict(t, r.conflictRef) : null;
      return { organizationId: r.organizationId, developmentId: r.developmentId, entityType, entityId, attributePath: path, valueFingerprint: r.valueFingerprint, provenanceId: r.id,
        provenanceKind: r.provenanceKind, evidenceState: r.evidenceState, currentness: ci.currentness, recordStatus: ci.status, sourceAuthorities: authorities, sourceIndependenceGroups: groups,
        hasConflict: ci.hasConflict, conflictState: conflict ? (conflict.resolutionStatus === 'OPEN' || conflict.resolutionStatus === 'DEFERRED' ? 'OPEN' : 'RESOLVED') : ci.hasConflict ? 'OPEN' : undefined,
        methodRef: r.methodRef || undefined, methodAssessment: r.methodRef ? C.assessmentOf(m, r.methodRef) : undefined, dependencyInputs: ctx.deps || [],
        extractionQuality: r.metadata && typeof r.metadata.extractionQuality === 'number' ? r.metadata.extractionQuality : null, locatorSpecificity: spec,
        legacyFlags: r.provenanceKind === 'LEGACY_DECLARED' ? ['LEGACY_SOURCE_UNRESOLVED'] : [], legacyCandidateDocument: !!(r.metadata && r.metadata.candidateDocumentId),
        manualSupportingEvidence: (r.provenanceKind === 'MANUAL_ASSERTION' || r.provenanceKind === 'MANUAL_OVERRIDE') ? r.evidenceRefs.some(e => e.type === 'DOCUMENT_VERSION' || e.type === 'SYSTEM_RECORD' || e.type === 'IMPORT_BATCH') : false,
        estimate: ci.estimate, valueFingerprintMismatch: ctx.currentValueFingerprint != null && ctx.currentValueFingerprint !== r.valueFingerprint,
        evaluationContext: { asOf: ctx.asOf, methodologyVersion: m.version, mode: ctx.mode || 'CURRENT' } };
    }
    /** evaluate(t, entityType, entityId, path, { asOf, methodologyVersion, entity }) — dependencies first (memo per call, cycle guard, depth limit) */
    function evaluate(t, entityType, entityId, path, q = {}) {
      if (executionMode === 'DISABLED') return err('CONFIDENCE_DISABLED');
      const m = q.methodologyVersion ? registry.get(q.methodologyVersion) : registry.current(); if (!m) return err('CONFIDENCE_METHODOLOGY_NOT_FOUND');
      const asOf = q.asOf || iso(clock()), memo = q.memo || new Map(), maxDepth = (m.dependencyPolicy && m.dependencyPolicy.maxDepth) || 4;
      const run = (et, id, p, depth, stack) => {
        const key = et + '|' + id + '|' + p; if (memo.has(key)) return memo.get(key);
        const r = prov.repo.current(t, et, id, p); if (!r) return null;
        let deps = [];
        if ((r.dependencyRefs || []).length) {
          if (depth >= maxDepth) deps = r.dependencyRefs.map(d => ({ attributePath: d.attributePath, status: 'NOT_EVALUATED', score: null, required: true, valueFingerprint: d.valueFingerprint }));
          else deps = r.dependencyRefs.map(d => { const k2 = d.entityType + '|' + d.entityId + '|' + d.attributePath;
            if (stack.has(k2)) return { attributePath: d.attributePath, status: 'INVALID_PROVENANCE', score: null, required: true, valueFingerprint: d.valueFingerprint, cycle: true };
            const dr = run(d.entityType, d.entityId, d.attributePath, depth + 1, new Set([...stack, k2]));
            return dr ? { attributePath: d.attributePath, confidenceResultId: dr.id, score: dr.score, status: dr.valueFingerprint === d.valueFingerprint ? dr.status : 'INVALID_PROVENANCE', required: true, valueFingerprint: d.valueFingerprint }
              : { attributePath: d.attributePath, status: 'NOT_EVALUATED', score: null, required: true, valueFingerprint: d.valueFingerprint }; });
        }
        const ent = q.entities ? q.entities.get(id) : (id === entityId ? q.entity : null);
        const input = buildInput(t, et, id, p, { methodology: m, asOf, deps, mode: q.mode, currentValueFingerprint: ent ? P.fingerprint(P.valueAt(ent, p)) : null });
        const ck = cache.key(input, m.version, asOf.slice(0, 10)); let res = cache.get(ck);
        if (!res) { res = C.evaluate(input, m); cache.set(ck, res); if (res.id) { repo.put(t, res); events.emit('AttributeConfidenceEvaluated', { organizationId: res.organizationId, entityType: et, entityId: id, attributePath: p, resultId: res.id, status: res.status, methodologyVersion: m.version, executionMode }); } }
        memo.set(key, res); return res;
      };
      const out = run(entityType, entityId, path, 0, new Set([entityType + '|' + entityId + '|' + path]));
      return out ? { ok: true, result: out, executionMode, methodology: { id: m.id, version: m.version, status: m.status, checksum: m.checksum } } : err('PROVENANCE_NOT_FOUND');
    }
    /** evaluateEntity(t, entity, { asOf }) → results for every tracked attribute (batch, shared memo) */
    function evaluateEntity(t, entityType, entity, q = {}) {
      const id = entity.identity ? entity.identity.id : entity.id, memo = q.memo || new Map(), out = {};
      for (const p of prov.repo.entityPaths(t, entityType, id)) { const r = evaluate(t, entityType, id, p, { ...q, memo, entity }); if (r.ok) out[p] = r.result; }
      return out;
    }
    function evaluateDevelopment(t, lots, q = {}) {
      const memo = new Map(), entities = new Map(lots.map(l => [l.identity.id, l])), results = [];
      for (const l of lots) for (const r of Object.values(evaluateEntity(t, 'LOT', l, { ...q, memo, entities }))) results.push(r);
      return results;
    }

    // -------- projection (ExecutionMode decides who can see; the result itself never changes by mode)
    function project(t, r, q = {}) {
      const mode = q.mode || 'BROKER', access = q.access || {}, m = r && registry.get(r.methodologyVersion);
      if (!r || !r.status) return freeze({ visible: false, reason: 'NO_RESULT' });
      if (r.organizationId !== t.organizationId) return err('CONFIDENCE_TENANT_MISMATCH');
      const tech = mode === 'TECHNICAL' || mode === 'AUDIT', canTech = typeof access.can === 'function' && access.can(C.PERMISSIONS.TECHNICAL_READ, { organizationId: t.organizationId });
      const published = m && m.status === 'PUBLISHED' && executionMode === 'PUBLISHED';
      if (executionMode === 'DISABLED') return freeze({ visible: false, reason: 'DISABLED' });
      if (tech) {
        if (!canTech) return err('CONFIDENCE_ACCESS_DENIED', 'exige confidence.technical.read');
        const ex = C.explain(r, m);
        const vm = { visible: true, mode, title: 'Confiança do dado', shadow: executionMode === 'SHADOW', methodologyBadge: (m ? m.status : '?') + ' · ' + r.methodologyVersion + (executionMode === 'SHADOW' ? ' · shadow' : ''),
          status: r.status, score: r.displayScore, band: r.band, bandLabel: r.band ? C.bandLabel(m, r.band) : null, text: ex.text, caveats: ex.caveats, calibrationStatus: r.calibrationStatus,
          dimensions: r.dimensions.map(d => ({ dimension: d.dimension, status: d.status, score: d.score, weight: d.weight, normalizedWeight: d.normalizedWeight, contribution: d.contribution, reasonCodes: d.reasonCodes })),
          appliedCaps: ex.appliedCaps, limitingFactors: r.limitingFactors, warnings: r.warnings, trace: r.trace, provenanceId: r.provenanceId, resultId: r.id, asOf: r.asOf, methodologyChecksum: r.methodologyChecksum };
        if (mode === 'AUDIT') vm.history = repo.history(t, r.entityType, r.entityId, r.attributePath);
        return freeze(vm);
      }
      if (!published) return freeze({ visible: false, reason: executionMode === 'SHADOW' ? 'SHADOW_MODE' : 'METHODOLOGY_NOT_PUBLISHED' }); // DRAFT/shadow never reaches client or broker
      if (mode === 'CLIENT') return freeze({ visible: r.status === 'COMPUTED', mode, label: r.band ? 'Confiança ' + String(C.bandLabel(m, r.band)).toLowerCase() : null }); // no number, no sources
      return freeze({ visible: true, mode, label: r.status === 'COMPUTED' ? `${r.displayScore}/100 — ${C.bandLabel(m, r.band)}` : C.STATUS_TEXT[r.status], status: r.status });
    }

    // -------- summaries / diagnostics / snapshot / impact
    function lotSummary(t, lotId, results, q = {}) {
      const rs = results || repo.all(t).filter(r => r.entityId === lotId), m = registry.current(), bandCounts = {}, statusCounts = {};
      for (const r of rs) { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; if (r.band) bandCounts[r.band] = (bandCounts[r.band] || 0) + 1; }
      const critical = p => !!(C.resolveFieldPolicy(m, p) || {}).critical;
      return freeze({ lotId, trackedAttributeCount: rs.length, computedCount: statusCounts.COMPUTED || 0, unresolvedCount: rs.length - (statusCounts.COMPUTED || 0) - (statusCounts.NOT_APPLICABLE || 0), statusCounts, bandCounts,
        weightedAggregateScore: null, aggregateMethodologyRef: null, // no overall lot confidence (§212): distribution only
        criticalLowConfidenceFields: rs.filter(r => critical(r.attributePath) && (r.band === 'LOW' || r.band === 'VERY_LOW' || (r.status !== 'COMPUTED' && r.status !== 'NOT_APPLICABLE'))).map(r => r.attributePath).sort(),
        conflictedFields: rs.filter(r => r.status === 'CONFLICTED').map(r => r.attributePath).sort(), generatedAt: iso(q.now || clock()) });
    }
    function diagnostics(t, results) {
      const rs = results || repo.all(t), m = registry.current(), statusCounts = {}, bandCounts = {}, byKind = {};
      for (const r of rs) { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; if (r.band) bandCounts[r.band] = (bandCounts[r.band] || 0) + 1; }
      return freeze({ organizationId: orgOf(t), developmentId: devId, methodologyVersion: m ? m.version : null, methodologyStatus: m ? m.status : null, executionMode, trackedCount: rs.length, computedCount: statusCounts.COMPUTED || 0,
        noScoreCount: rs.filter(r => r.score == null).length, statusCounts, bandCounts, lowCriticalFieldCount: rs.filter(r => (C.resolveFieldPolicy(m, r.attributePath) || {}).critical && (r.band === 'LOW' || r.band === 'VERY_LOW')).length,
        unassessedMethodCount: new Set(rs.filter(r => r.status === 'METHOD_UNASSESSED').map(r => (r.limitingFactors.find(l => l.code === 'METHOD_UNASSESSED') || {}).technicalDetails).filter(Boolean).map(d => d.methodId + '@' + d.methodVersion)).size,
        blockedConflictCount: statusCounts.CONFLICTED || 0, generatedAt: iso(clock()), note: 'Diagnóstico técnico de qualidade de dados — não é KPI comercial.' });
    }
    function snapshot(t, results, purpose, dataVersionRefs = []) {
      const versions = [...new Set(results.map(r => r.methodologyVersion))];
      if (versions.length > 1) return err('CONFIDENCE_MIXED_METHODOLOGY', null, { versions });
      const body = { organizationId: orgOf(t), developmentId: devId, resultIds: results.map(r => r.id).sort(), methodologyVersion: versions[0] || null, dataVersionRefs: clone(dataVersionRefs), purpose: purpose || null };
      return { ok: true, snapshot: freeze({ id: I.stableId('csnap', body), ...body, generatedAt: iso(clock()), checksum: I.checksumOf(body) }) };
    }
    /** impactReport(fromResults, toResults) — before publishing a new methodology (never auto-publish) */
    function impactReport(from, to) {
      const idx = new Map(from.map(r => [r.entityType + '|' + r.entityId + '|' + r.attributePath, r])), trans = {}, deltas = [], crit = [], m = registry.current();
      for (const r of to) { const a = idx.get(r.entityType + '|' + r.entityId + '|' + r.attributePath); if (!a) continue;
        const k = (a.band || a.status) + '→' + (r.band || r.status); trans[k] = (trans[k] || 0) + 1;
        if (a.score != null && r.score != null) deltas.push(r.score - a.score);
        if ((C.resolveFieldPolicy(m, r.attributePath) || {}).critical && (a.band || a.status) !== (r.band || r.status)) crit.push({ entityId: r.entityId, attributePath: r.attributePath, from: a.band || a.status, to: r.band || r.status }); }
      const sorted = [...deltas].sort((a, b) => a - b), med = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
      return freeze({ fromVersion: from[0] ? from[0].methodologyVersion : null, toVersion: to[0] ? to[0].methodologyVersion : null, affectedResults: Object.entries(trans).filter(([k]) => k.split('→')[0] !== k.split('→')[1]).reduce((s, [, n]) => s + n, 0),
        bandTransitions: trans, averageScoreDelta: deltas.length ? Math.round(deltas.reduce((s, x) => s + x, 0) / deltas.length * 1e6) / 1e6 : null, medianScoreDelta: med == null ? null : Math.round(med * 1e6) / 1e6, criticalFieldTransitions: crit.slice(0, 200), generatedAt: iso(clock()) });
    }
    return Object.freeze({ registry, repo, cache, events, executionMode, buildInput, evaluate, evaluateEntity, evaluateDevelopment, project, explain: r => C.explain(r, registry.get(r.methodologyVersion)), lotSummary, diagnostics, snapshot, impactReport });
  }
  /** comparator guard (§424): confidence across lots is comparable only within one methodology version */
  function checkComparable(results) { const v = [...new Set(results.filter(Boolean).map(r => r.methodologyVersion))]; return v.length <= 1 ? { ok: true, methodologyVersion: v[0] || null } : { ok: false, code: 'CONFIDENCE_MIXED_METHODOLOGY', label: 'MIXED_METHODOLOGY', versions: v }; }

  return Object.freeze({ configOf, createMethodologyRegistry, createRepository, createCache, createEventLog, createService, checkComparable });
})();
