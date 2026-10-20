/* versioning/analysisVersioning.js — Analytical versioning (topic 35).
   Versions and orchestrates the IntelligenceEngine; never rewrites it and never changes a
   score, class, ranking, alert or price. ANALYSIS RESULT = INPUT SNAPSHOT + ANALYSIS DEFINITION
   + METHODOLOGY VERSION(S) + MODULE VERSION(S) + ENGINE BUILD + CONFIG VERSION(S) + EXECUTION.

   Concepts kept distinct: AnalysisRun (an execution attempt) ≠ AnalysisVersion (a materialized,
   immutable result) ≠ methodology version. latest ≠ current published. Publication moves a pointer
   (optimistic concurrency) and appends an activation event; it never edits a version.
   Lifecycle model chosen (spec §259–265): lifecycleStatus ∈ DRAFT | VALIDATED | PUBLISHED | ARCHIVED |
   REJECTED; CURRENT / SUPERSEDED are derived from the pointer and the activation history.

   Snapshots hold only real dependencies: LOT_INTELLIGENCE_BASE reads measurements, the static plan,
   the scoring methodology and the engine — not the price table, not availability — so a price or
   availability change never marks it stale.

   API (App.versioning): definitions(dev), moduleGraph(), fingerprint(sources), refs.*, inputSnapshot(def, sources),
   moduleFingerprints(graph, inputs, cfg), repository(tenant) → { plan, run, validate, publish, activate, resolve,
   currentness, refreshPlan, diff, impact, reproducibility, ... }, legacyBaseline(lots, ctx), parity(a, b), readModel(v, mode). */
App.versioning = (() => {
  const C = v => App.methodology.checksum(v), freeze = o => App.domain.deepFreeze(o), R = App.imath;
  const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});
  const LIFECYCLE = Object.freeze(['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED', 'REJECTED']);
  const RUN_STATUS = Object.freeze(['QUEUED', 'PLANNING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);
  const ORIGINS = Object.freeze(['COMPUTED', 'MIGRATED_LEGACY', 'IMPORTED', 'REBUILT', 'RECOVERED']);
  const CURRENTNESS = Object.freeze(['CURRENT_INPUTS', 'INPUTS_CHANGED', 'METHODOLOGY_SUPERSEDED', 'ENGINE_SUPERSEDED', 'REVIEW_REQUIRED', 'UNKNOWN']);
  const REPRODUCIBILITY = Object.freeze(['FULL', 'PARTIAL', 'NON_REPRODUCIBLE', 'NOT_EVALUATED']);
  const RESOLUTION = Object.freeze(['CURRENT_PUBLISHED', 'LATEST', 'EXPLICIT_VERSION', 'AS_OF']);
  const SCOPES = Object.freeze(['ENTITY_LOCAL', 'DEVELOPMENT_GLOBAL', 'CROSS_ENTITY', 'EXTERNAL_DEPENDENT']);
  const ENGINE_ID = 'intelligence-engine', VALIDATOR_VERSION = '1.0.0', OUTPUT_SCHEMA = 'lot-analysis-result/1.0';
  const LOT_CLASSES = ['A_PLUS', 'A', 'B', 'C', 'D', 'UNKNOWN'];

  /** bundled definitions + policies (config/versioning/<dev>.json) */
  function definitions(dev) {
    const doc = App.configs && App.configs.versioning && App.configs.versioning[dev];
    return doc ? { organizationId: doc.organizationId, developmentId: doc.developmentId, definitions: doc.definitions, policies: doc.publicationPolicies, precision: doc.numericPrecisionProfiles } : null;
  }

  // ---------------------------------------------------------------- module graph (from the engine's own pipeline)
  // what each base module reads from LotAnalysisInput (input paths) and which methodology section configures each module
  const READS = { geometry: ['geometry'], location: ['location'], mobility: ['mobility'], environmental: ['environmental'], surroundings: ['surroundings', 'geometry.hasTwoFronts', 'construction'],
    criteria: ['code', 'measurementConfidence'] };
  const CONFIG_SECTIONS = { geometry: ['metrics.shape'], mobility: ['metrics.traffic', 'metrics.streetHierarchy', 'metrics.gateProximity'], environmental: ['metrics.solar'], surroundings: ['metrics.rearSequence'], location: [],
    criteria: ['criteria', 'lotAdjustments', 'confidence'], levels: ['levels'], scoring: ['scores'], overall: ['overall'], profiles: ['profiles'], alerts: ['alerts'], highlights: [], classification: ['classification'], ranking: ['ranking'] };
  function topo(nodes, edges) {
    const deps = new Map(nodes.map(n => [n.moduleId, edges.filter(e => e.to === n.moduleId).map(e => e.from)])), order = [], state = new Map();
    const visit = (id, path) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw err('CYCLE', 'ciclo no grafo de módulos: ' + [...path, id].join(' → '));
      state.set(id, 1); for (const d of deps.get(id) || []) visit(d, [...path, id]); state.set(id, 2); order.push(id);
    };
    nodes.forEach(n => visit(n.moduleId, []));
    return order;
  }
  /** moduleGraph(pipeline?) → AnalysisModuleGraph (DAG, checksum); throws CYCLE */
  function moduleGraph(pipeline = App.intelligence.MODULES) {
    const producers = new Map();
    pipeline.forEach(m => m.produces.forEach(p => producers.set(p, m.id)));
    const base = pipeline.filter(m => READS[m.id] && m.phase === 1 && m.id !== 'criteria').map(m => m.id);
    const nodes = pipeline.map(m => ({ moduleId: m.id, moduleVersion: m.version, phase: m.phase, requiredAttributes: m.phase === 1 && READS[m.id] ? READS[m.id] : [], requiredConfigs: CONFIG_SECTIONS[m.id] || [],
      dependsOnModules: [], outputAttributes: m.produces, deterministic: true, numericPrecisionProfile: 'exact', computationScope: m.phase === 2 ? 'CROSS_ENTITY' : 'ENTITY_LOCAL' }));
    const edges = [];
    for (const m of pipeline) for (const r of m.requires) {
      const from = r === 'metrics' ? base : producers.has(r) && producers.get(r) !== m.id && !base.includes(m.id) ? [producers.get(r)] : [];
      for (const f of from) if (!edges.some(e => e.from === f && e.to === m.id)) edges.push({ from: f, to: m.id, kind: r === 'metrics' ? 'METRICS' : 'OUTPUT' });
    }
    nodes.forEach(n => { n.dependsOnModules = edges.filter(e => e.to === n.moduleId).map(e => e.from); });
    const order = topo(nodes, edges);
    const g = { id: 'intelligence-engine-pipeline', version: App.intelligence.ENGINE_VERSION, nodes, edges, order };
    return freeze({ ...g, checksum: C({ nodes, edges }) });
  }

  // ---------------------------------------------------------------- refs and fingerprints (canonical values, never display strings)
  const pickPath = (o, p) => p.split('.').reduce((x, k) => x == null ? undefined : x[k], o);
  const refs = Object.freeze({
    methodology: cfg => cfg ? { methodologyType: 'SCORING_METHODOLOGY', methodologyId: cfg.methodologyId, methodologyVersion: cfg.methodologyVersion, methodologyChecksum: C(cfg) } : null,
    engine: (opts = {}) => ({ engineId: ENGINE_ID, engineVersion: App.intelligence.ENGINE_VERSION, buildId: opts.buildId || null, commitRef: opts.commitRef || null, artifactChecksum: opts.artifactChecksum || null,
      runtimeVersion: opts.runtimeVersion || null, moduleVersions: Object.fromEntries(App.intelligence.MODULES.map(m => [m.id, m.version])) }),
    staticData: dev => dev && dev.staticDataVersion ? { type: 'STATIC_DATA_VERSION', id: String(dev.staticDataVersion) } : null,
    measurements: doc => doc ? { type: 'CUSTOM_VERSION', subtype: 'MEASUREMENT_INPUT', id: String(doc.inputVersion), sourceSha256: doc.sha256 || null, checksum: C(doc.lots), entityCount: doc.lots.length } : null,
    priceTable: dev => { const t = dev && (dev.priceTables || []).find(x => x.id === dev.currentPriceTableId); return t ? { type: 'PRICE_TABLE_VERSION', id: t.id, version: t.version, checksum: C({ id: t.id, version: t.version, pricePerM2: t.pricePerM2, plans: t.plans, downPaymentDefault: t.downPaymentDefault }) } : null; },
    availability: rev => rev == null ? null : { type: 'AVAILABILITY_REVISION', id: String(rev) },
    configs: () => Object.entries(App.configs || {}).filter(([k]) => k !== 'scoring').map(([k, v]) => ({ configType: k, checksum: C(v) })).sort((a, b) => a.configType < b.configType ? -1 : 1)
  });
  /** fingerprint(sources) → the version fingerprint of everything the platform currently serves (technical view). Read-only. */
  function fingerprint(s = {}) {
    const f = { methodology: refs.methodology(s.methodologyConfig), engine: refs.engine(s.engine), configs: refs.configs(), staticData: refs.staticData(s.dev), measurements: refs.measurements(s.inputDoc),
      priceTable: refs.priceTable(s.dev), availability: refs.availability(s.availabilityRevision), dataVersions: s.dataVersions || null };
    return freeze({ ...f, combined: C(f) });
  }

  // ---------------------------------------------------------------- input snapshot (only real dependencies) and module computation keys
  const DOMAIN_REF = { STATIC_DATA_VERSION: s => refs.staticData(s.dev), MEASUREMENT_INPUT: s => refs.measurements(s.inputDoc), SCORING_METHODOLOGY: s => refs.methodology(s.methodologyConfig), ENGINE_BUILD: s => refs.engine(s.engine),
    PRICE_TABLE_VERSION: s => refs.priceTable(s.dev), AVAILABILITY_REVISION: s => refs.availability(s.availabilityRevision) };
  const section = (cfg, p) => pickPath(cfg, p);
  /** moduleFingerprints(graph, inputs, cfg) → AnalysisDependencyFingerprint[] (computationKey = hash of all that influences the module) */
  function moduleFingerprints(graph, inputs, cfg) {
    const sorted = inputs.slice().sort((a, b) => a.lotId < b.lotId ? -1 : 1), keys = new Map(), out = [];
    for (const id of graph.order) {
      const n = graph.nodes.find(x => x.moduleId === id);
      const inputFingerprint = n.requiredAttributes.length ? C(sorted.map(i => [i.lotId, n.requiredAttributes.map(p => pickPath(i, p) ?? null)])) : null;
      const configFingerprint = C(n.requiredConfigs.map(p => [p, section(cfg, p) ?? null]));
      const methodologyFingerprint = n.requiredConfigs.length ? C({ id: cfg.methodologyId, cfg: configFingerprint }) : null;
      const up = n.dependsOnModules.map(d => keys.get(d)), upstreamModuleFingerprint = up.length ? C(up) : null;
      // a cross-entity module (classification, ranking) depends on the whole entity set
      const entitySet = n.computationScope === 'CROSS_ENTITY' ? C(sorted.map(i => i.lotId)) : null;
      const computationKey = C({ m: id, v: n.moduleVersion, inputFingerprint, configFingerprint, upstreamModuleFingerprint, entitySet });
      keys.set(id, computationKey); out.push({ moduleId: id, moduleVersion: n.moduleVersion, inputFingerprint, configFingerprint, methodologyFingerprint, upstreamModuleFingerprint, computationKey, computationScope: n.computationScope });
    }
    return out;
  }
  /** inputSnapshot(def, sources, meta) → immutable AnalysisInputSnapshot holding only the definition's declared dependencies */
  function inputSnapshot(def, s, meta = {}) {
    const all = (def.dependencyDomains || []).map(d => [d, DOMAIN_REF[d] ? DOMAIN_REF[d](s) : null]);
    const versioned = all.filter(([d, r]) => r && ['STATIC_DATA_VERSION', 'MEASUREMENT_INPUT'].includes(d)).map(([, r]) => r);
    const dynamic = all.filter(([d, r]) => r && ['PRICE_TABLE_VERSION', 'AVAILABILITY_REVISION'].includes(d)).map(([, r]) => r);
    const methodologyRefs = all.filter(([d, r]) => r && d === 'SCORING_METHODOLOGY').map(([, r]) => r);
    const graph = s.graph || moduleGraph(), inputs = (s.inputDoc && s.inputDoc.lots) || [];
    const snap = { organizationId: meta.organizationId, developmentId: meta.developmentId || def.developmentId || null, analysisDefinitionId: def.id,
      staticDataVersion: s.dev ? String(s.dev.staticDataVersion) : null, versionedDataRefs: versioned, dynamicDataRefs: dynamic, documentVersionRefs: [], externalSnapshotRefs: s.inputDoc && s.inputDoc.sha256 ? ['sha256:' + s.inputDoc.sha256] : [],
      configVersionRefs: [], methodologyRefs, provenanceRevision: null, entitySetRef: C(inputs.map(i => i.lotId).sort()), entityCount: inputs.length,
      engineBuildRef: (all.find(([d]) => d === 'ENGINE_BUILD') || [])[1] || null, moduleGraphChecksum: graph.checksum,
      dependencyFingerprints: s.methodologyConfig ? moduleFingerprints(graph, inputs, s.methodologyConfig) : [], generatedAt: meta.at || null };
    snap.checksum = C({ ...snap, generatedAt: null });
    snap.id = 'snap:' + snap.checksum;
    return freeze(snap);
  }

  // ---------------------------------------------------------------- per-entity outputs (canonical, raw numbers)
  const outputsOf = r => ({ notes: r.notes, scores: r.scores, overallRaw: r.overallRaw, class: r.class, rankings: r.rankings, levels: r.levels, highlights: r.highlights.map(h => h.type),
    profileSignals: r.profileSignals.map(p => p.id), alerts: r.alerts.map(a => ({ type: a.type, severity: a.severity })), confidence: r.confidence });
  const MODULE_OUTPUT = { criteria: r => r.notes, levels: r => r.levels, scoring: r => { const { overall, ...s } = r.scores; return s; }, overall: r => ({ overall: r.scores.overall, overallRaw: r.overallRaw }),
    profiles: r => r.profileSignals.map(p => p.id), alerts: r => r.alerts.map(a => [a.type, a.severity]), highlights: r => r.highlights.map(h => h.type), classification: r => r.class, ranking: r => r.rankings };
  const moduleOutput = (id, node, r) => MODULE_OUTPUT[id] ? MODULE_OUTPUT[id](r) : Object.fromEntries(node.outputAttributes.map(k => [k, (r.metrics || {})[k] ?? null]));
  const entityStatus = r => r.status === 'COMPLETE' ? 'READY' : r.diagnostics.some(d => d.level === 'ERROR') ? (Object.values(r.scores).every(v => v == null) ? 'ERROR' : 'PARTIAL') : Object.values(r.scores).every(v => v == null) ? 'NOT_COMPUTABLE' : 'PARTIAL';

  // ---------------------------------------------------------------- repository + planner + runner + validation + publication (tenant-scoped, in memory)
  function repository(tenant, opts = {}) {
    if (!tenant || !tenant.organizationId) throw err('TENANT_REQUIRED', 'TenantContext obrigatório');
    const org = tenant.organizationId, versions = new Map(), runs = new Map(), snapshots = new Map(), moduleSets = new Map(), resultSets = new Map(), reports = new Map(), pointers = new Map(), activations = [], audit = [], events = [];
    const policyOf = def => (opts.policies || []).find(p => p.id === def.defaultPublicationPolicyRef) || { requireValidationPass: true, maxCriticalErrors: 0, maxEntityErrors: 0, allowPartialPublication: false, allowAutomaticPublication: false, requireImpactReview: true, requireParityForMigration: true };
    const own = o => { if (o && o.organizationId && o.organizationId !== org) throw err('TENANT_MISMATCH', 'recurso de outro tenant'); return o; };
    const ptr = defId => { if (!pointers.has(defId)) pointers.set(defId, { organizationId: org, analysisDefinitionId: defId, currentPublishedVersionId: null, latestVersionId: null, revision: 0, updatedAt: null }); return pointers.get(defId); };
    const emit = (type, payload) => { const e = Object.freeze({ type, organizationId: org, ...payload }); events.push(e); return e; }; // ids and refs only, never full results
    const nextSeq = defId => 1 + Math.max(0, ...[...versions.values()].filter(v => v.analysisDefinitionId === defId).map(v => v.sequence));
    const getV = id => { const v = versions.get(id); if (!v) throw err('NOT_FOUND', `versão ${id} não existe`); return own(v); };
    function saveSnapshot(s) { own(s); if (!snapshots.has(s.id)) snapshots.set(s.id, s); return snapshots.get(s.id); }

    /** plan(def, snapshot, { previousVersionId, forceRebuild }) → AnalysisExecutionPlan (deterministic; executes nothing) */
    function plan(def, snap, o = {}) {
      own(snap); saveSnapshot(snap);
      const prev = o.previousVersionId ? getV(o.previousVersionId) : null, prevSets = prev ? prev.moduleResultRefs.map(id => moduleSets.get(id)) : [], prevFp = prev ? new Map((snapshots.get(prev.inputSnapshotId) || { dependencyFingerprints: [] }).dependencyFingerprints.map(f => [f.moduleId, f])) : new Map();
      const modulePlans = snap.dependencyFingerprints.map(f => {
        const reusable = prevSets.find(m => m && m.moduleId === f.moduleId && m.computationKey === f.computationKey && m.status === 'VALID');
        if (o.forceRebuild) return { moduleId: f.moduleId, action: 'RECOMPUTE', reasonCodes: ['FORCED_REBUILD'], computationKey: f.computationKey };
        if (reusable) return { moduleId: f.moduleId, action: 'REUSE', reasonCodes: [], computationKey: f.computationKey, reusableResultId: reusable.id };
        const p = prevFp.get(f.moduleId), reasons = [];
        if (!p) reasons.push('NO_REUSABLE_RESULT');
        else {
          if (p.moduleVersion !== f.moduleVersion) reasons.push('MODULE_VERSION_CHANGED');
          if (p.inputFingerprint !== f.inputFingerprint) reasons.push('INPUT_CHANGED');
          if (p.configFingerprint !== f.configFingerprint) reasons.push('METHODOLOGY_CHANGED');
          if (p.upstreamModuleFingerprint !== f.upstreamModuleFingerprint) reasons.push('UPSTREAM_CHANGED');
          if (!reasons.length) reasons.push(f.computationScope === 'CROSS_ENTITY' ? 'INPUT_CHANGED' : 'NO_REUSABLE_RESULT');
        }
        return { moduleId: f.moduleId, action: 'RECOMPUTE', reasonCodes: reasons, computationKey: f.computationKey };
      });
      const p = { analysisDefinitionId: def.id, inputSnapshotId: snap.id, modulePlans, reusableModuleResultIds: modulePlans.filter(m => m.action === 'REUSE').map(m => m.reusableResultId),
        recomputeModuleIds: modulePlans.filter(m => m.action === 'RECOMPUTE').map(m => m.moduleId), estimatedEntityCount: snap.entityCount, generatedAt: o.at || null, previousVersionId: prev ? prev.id : null };
      return freeze({ ...p, id: 'plan:' + C({ ...p, generatedAt: null }) });
    }
    /** run(plan, { inputs, methodologyConfig, at, requestedBy, reason }) → { run, version } — never publishes; FAILED leaves every pointer untouched */
    function run(p, o = {}) {
      const snap = snapshots.get(p.inputSnapshotId), def = o.definition; if (!snap) throw err('NOT_FOUND', 'snapshot inexistente');
      const r = { id: 'run:' + C({ p: p.id, at: o.at || null, n: runs.size }), organizationId: org, developmentId: snap.developmentId, analysisDefinitionId: p.analysisDefinitionId, requestedBy: o.requestedBy || null, requestReason: o.reason || null,
        inputSnapshotId: snap.id, executionPlanId: p.id, engineBuildRef: snap.engineBuildRef, methodologyRefs: snap.methodologyRefs, status: 'RUNNING', startedAt: o.at || null, completedAt: null, generatedDraftVersionId: null, warnings: [], errors: [], executionStats: null };
      runs.set(r.id, r);
      // the snapshot froze the inputs: refuse inputs that drifted since
      if (o.inputs && C(o.inputs.map(i => i.lotId).sort()) !== snap.entitySetRef) { r.status = 'FAILED'; r.errors.push({ code: 'INPUT_SNAPSHOT_MISMATCH' }); r.completedAt = o.at || null; emit('ANALYSIS_RUN_FAILED', { runId: r.id, code: 'INPUT_SNAPSHOT_MISMATCH' }); return { run: freeze({ ...r }), version: null }; }
      const mref = snap.methodologyRefs[0];
      if (!o.methodologyConfig || !mref || C(o.methodologyConfig) !== mref.methodologyChecksum) { r.status = 'FAILED'; r.errors.push({ code: 'METHODOLOGY_SNAPSHOT_MISMATCH' }); r.completedAt = o.at || null; emit('ANALYSIS_RUN_FAILED', { runId: r.id, code: 'METHODOLOGY_SNAPSHOT_MISMATCH' }); return { run: freeze({ ...r }), version: null }; }
      let out;
      try { out = (o.engine || App.intelligence).analyzeDevelopment(o.inputs, { methodology: App.methodology.compiled(o.methodologyConfig), inputVersion: (snap.versionedDataRefs.find(x => x.subtype === 'MEASUREMENT_INPUT') || {}).id, generatedAt: null }); }
      catch (e) { r.status = 'FAILED'; r.errors.push({ code: e.code || 'ENGINE_FAILED', message: e.message }); r.completedAt = o.at || null; emit('ANALYSIS_RUN_FAILED', { runId: r.id, code: e.code || 'ENGINE_FAILED' }); return { run: freeze({ ...r }), version: null }; }
      const graph = o.graph || moduleGraph(), moduleRefs = [], determinism = [];
      for (const mp of p.modulePlans) {
        const node = graph.nodes.find(n => n.moduleId === mp.moduleId), data = out.results.map(x => [x.lotId, moduleOutput(mp.moduleId, node, x)]), outputChecksum = C(data);
        if (mp.action === 'REUSE') {
          const old = moduleSets.get(mp.reusableResultId);
          if (old.outputChecksum !== outputChecksum) determinism.push({ moduleId: mp.moduleId, code: 'DETERMINISM_MISMATCH' });
          moduleRefs.push(old.id); continue;
        }
        const ms = { id: 'mod:' + C({ k: mp.computationKey, o: outputChecksum }), organizationId: org, developmentId: snap.developmentId, analysisDefinitionId: p.analysisDefinitionId, moduleId: mp.moduleId, moduleVersion: node.moduleVersion,
          computationKey: mp.computationKey, entitySetRef: snap.entitySetRef, entityCount: data.length, resultArtifactRef: null, outputChecksum, inputSnapshotRef: snap.id, status: 'VALID', createdAt: o.at || null };
        if (!moduleSets.has(ms.id)) moduleSets.set(ms.id, freeze(ms)); moduleRefs.push(ms.id);
      }
      const entities = out.results.map(x => ({ entityId: x.lotId, outputs: outputsOf(x), resultStatus: entityStatus(x), warnings: x.diagnostics.filter(d => d.level !== 'INFO').map(d => d.code) }));
      const rs = { organizationId: org, developmentId: snap.developmentId, analysisDefinitionId: p.analysisDefinitionId, entityType: 'LOT', entityCount: entities.length, moduleResultRefs: moduleRefs, outputSchemaVersion: def ? def.outputSchemaVersion : OUTPUT_SCHEMA,
        artifactRef: null, entities, checksum: C(entities), generatedAt: o.at || null };
      rs.id = 'rs:' + rs.checksum; resultSets.set(rs.id, freeze(rs));
      const count = s => entities.filter(e => e.resultStatus === s).length;
      r.status = count('ERROR') ? 'PARTIAL' : 'SUCCEEDED';
      const seq = nextSeq(p.analysisDefinitionId);
      const v = { id: 'av:' + C({ d: p.analysisDefinitionId, s: seq, rs: rs.checksum, snap: snap.id, org }), organizationId: org, developmentId: snap.developmentId, analysisDefinitionId: p.analysisDefinitionId, sequence: seq, label: 'A' + seq,
        origin: o.origin || 'COMPUTED', lifecycleStatus: 'DRAFT', inputSnapshotId: snap.id, methodologyRefs: snap.methodologyRefs, engineBuildRef: snap.engineBuildRef, moduleResultRefs: moduleRefs, resultSetRef: rs.id, manifestRef: null,
        contentChecksum: rs.checksum, reproducibilityStatus: 'NOT_EVALUATED', createdFromRunId: r.id, createdAt: o.at || null, determinism };
      const manifest = { analysisVersionId: v.id, organizationId: org, developmentId: v.developmentId, analysisDefinitionId: v.analysisDefinitionId, sequence: seq, entityCount: entities.length, readyCount: count('READY'), partialCount: count('PARTIAL'),
        notComputableCount: count('NOT_COMPUTABLE'), errorCount: count('ERROR'), outputSchemaVersion: rs.outputSchemaVersion, inputSnapshotChecksum: snap.checksum, resultSetChecksum: rs.checksum,
        moduleVersions: Object.fromEntries(graph.nodes.map(n => [n.moduleId, n.moduleVersion])), methodologyVersions: Object.fromEntries(snap.methodologyRefs.map(m => [m.methodologyId, m.methodologyVersion])), generatedAt: o.at || null };
      manifest.versionChecksum = C({ v: v.id, rs: rs.checksum, snap: snap.checksum }); v.manifestRef = 'manifest:' + manifest.versionChecksum; v.manifest = manifest;
      versions.set(v.id, v); r.generatedDraftVersionId = v.id; r.completedAt = o.at || null; r.executionStats = { entityCount: entities.length, recomputedModules: p.recomputeModuleIds.length, reusedModules: p.reusableModuleResultIds.length };
      const pt = ptr(p.analysisDefinitionId); pt.latestVersionId = v.id; pt.updatedAt = o.at || null; // latest moves, current published does not
      emit('ANALYSIS_RUN_SUCCEEDED', { runId: r.id, versionId: v.id, status: r.status });
      return { run: freeze({ ...r }), version: v };
    }
    /** validate(versionId, { at }) → AnalysisValidationReport; DRAFT → VALIDATED when PASS/PASS_WITH_WARNINGS, → REJECTED on FAIL */
    function validate(id, o = {}) {
      const v = getV(id), rs = resultSets.get(v.resultSetRef), checks = [], add = (code, ok, level = 'ERROR', detail) => checks.push({ code, status: ok ? 'PASS' : level === 'ERROR' ? 'FAIL' : 'WARN', detail: detail || null });
      if (v.lifecycleStatus !== 'DRAFT') throw err('INVALID_TRANSITION', `${v.lifecycleStatus} → VALIDATED`);
      const snap = snapshots.get(v.inputSnapshotId);
      add('ENTITY_COUNT', rs.entityCount === snap.entityCount, 'ERROR', `${rs.entityCount}/${snap.entityCount}`);
      const ids = rs.entities.map(e => e.entityId); add('UNIQUE_ENTITY_IDS', new Set(ids).size === ids.length);
      let nonFinite = 0, outOfRange = 0, badEnum = 0, missing = 0;
      for (const e of rs.entities) {
        for (const x of [...Object.values(e.outputs.scores), ...Object.values(e.outputs.notes), e.outputs.overallRaw]) if (typeof x === 'number' && !Number.isFinite(x)) nonFinite++;
        for (const x of Object.values(e.outputs.scores)) if (typeof x === 'number' && (x < 0 || x > 100)) outOfRange++;
        if (!LOT_CLASSES.includes(e.outputs.class)) badEnum++;
        if (e.outputs.scores == null || e.outputs.class == null) missing++;
      }
      add('NO_NAN_OR_INFINITY', !nonFinite, 'ERROR', String(nonFinite)); add('SCORE_RANGE', !outOfRange, 'ERROR', String(outOfRange)); add('ENUMS_VALID', !badEnum, 'ERROR', String(badEnum)); add('REQUIRED_OUTPUTS', !missing, 'ERROR', String(missing));
      add('METHODOLOGY_REFS', v.methodologyRefs.length > 0 && v.methodologyRefs.every(m => m.methodologyChecksum)); add('ENGINE_BUILD_REF', !!(v.engineBuildRef && v.engineBuildRef.engineVersion));
      add('TENANT_OWNERSHIP', v.organizationId === org && snap.organizationId === org); add('INPUT_SNAPSHOT_CONSISTENCY', rs.entities.length === snap.entityCount && C(ids.slice().sort()) === snap.entitySetRef);
      add('MODULE_CHECKSUMS', v.moduleResultRefs.every(m => moduleSets.has(m))); add('DETERMINISTIC_REUSE', !(v.determinism || []).length);
      const errs = v.manifest.errorCount, partial = v.manifest.partialCount + v.manifest.notComputableCount;
      add('ENTITY_ERRORS', errs === 0); add('PARTIAL_ENTITIES', partial === 0, 'WARN', String(partial));
      const crit = checks.filter(c => c.status === 'FAIL').length, warn = checks.filter(c => c.status === 'WARN').length;
      const rep = { id: 'val:' + v.id, analysisVersionId: v.id, status: crit ? 'FAIL' : warn ? 'PASS_WITH_WARNINGS' : 'PASS', checks, criticalErrorCount: crit, warningCount: warn, generatedAt: o.at || null, validatorVersion: VALIDATOR_VERSION };
      reports.set(rep.id, freeze(rep));
      v.validationReportRef = rep.id; v.lifecycleStatus = crit ? 'REJECTED' : 'VALIDATED'; v.validatedAt = o.at || null; v.validatedBy = o.by || null;
      if (v.lifecycleStatus === 'VALIDATED') freeze(v); // from here the version is immutable
      emit(crit ? 'ANALYSIS_VERSION_REJECTED' : 'ANALYSIS_VERSION_VALIDATED', { versionId: v.id });
      return rep;
    }
    /** decision(versionId, meta) → AnalysisPublicationDecision (no mutation) */
    function decision(id, meta = {}, def) {
      const v = getV(id), pol = policyOf(def || { defaultPublicationPolicyRef: meta.policyRef }), pt = ptr(v.analysisDefinitionId), rep = v.validationReportRef ? reports.get(v.validationReportRef) : null, blockers = [], warnings = [];
      if (!['VALIDATED', 'PUBLISHED'].includes(v.lifecycleStatus)) blockers.push('NOT_VALIDATED');
      if (pol.requireValidationPass && (!rep || rep.status === 'FAIL')) blockers.push('VALIDATION_NOT_PASSED');
      if (rep && rep.criticalErrorCount > (pol.maxCriticalErrors || 0)) blockers.push('TOO_MANY_CRITICAL_ERRORS');
      if (!pol.allowPartialPublication && (v.manifest.partialCount + v.manifest.notComputableCount + v.manifest.errorCount) > (pol.maxPartialEntities || 0)) blockers.push('PARTIAL_PUBLICATION_NOT_ALLOWED');
      if ((meta.expectedCurrentVersionId ?? null) !== pt.currentPublishedVersionId) blockers.push('ANALYSIS_CURRENT_VERSION_CONFLICT');
      if (typeof meta.can !== 'function' || !meta.can('analysis.publish')) blockers.push('FORBIDDEN');
      if (!meta.reason) blockers.push('MISSING_REASON');
      if (pol.requireImpactReview && pt.currentPublishedVersionId && !meta.impactReviewed) blockers.push('IMPACT_REVIEW_REQUIRED');
      if (pol.requireParityForMigration && meta.migration && !(meta.parityReport && meta.parityReport.mismatchCount === 0)) blockers.push('PARITY_REQUIRED');
      if (rep && rep.status === 'PASS_WITH_WARNINGS') warnings.push('VALIDATION_WARNINGS');
      return { allowed: !blockers.length, currentVersionId: pt.currentPublishedVersionId, candidateVersionId: id, validationStatus: rep ? rep.status : 'NOT_VALIDATED', impactReviewStatus: meta.impactReviewed ? 'REVIEWED' : 'NOT_REVIEWED', blockers, warnings };
    }
    function activateInternal(v, meta, action) {
      const pt = ptr(v.analysisDefinitionId), at = meta.at || null, prev = pt.currentPublishedVersionId;
      const open = activations.filter(a => a.analysisDefinitionId === v.analysisDefinitionId && a.deactivatedAt == null).pop(); if (open) open.deactivatedAt = at;
      activations.push({ organizationId: org, analysisDefinitionId: v.analysisDefinitionId, versionId: v.id, previousVersionId: prev, activatedAt: at, deactivatedAt: null, actor: meta.by || null, reason: meta.reason || null, action, pointerRevision: pt.revision + 1 });
      pt.currentPublishedVersionId = v.id; pt.revision++; pt.updatedAt = at;
      audit.push({ action, versionId: v.id, previousVersionId: prev, at, by: meta.by || null, reason: meta.reason || null });
      emit(action === 'PUBLISH' ? 'ANALYSIS_VERSION_PUBLISHED' : 'ANALYSIS_VERSION_ACTIVATED', { versionId: v.id, previousVersionId: prev, at });
    }
    /** publish(versionId, { expectedCurrentVersionId, can, by, reason, at, impactReviewed, migration, parityReport }) — atomic pointer move, never recomputes or edits outputs */
    function publish(id, meta = {}, def) {
      const d = decision(id, meta, def);
      if (!d.allowed) throw err(d.blockers.includes('ANALYSIS_CURRENT_VERSION_CONFLICT') ? 'ANALYSIS_CURRENT_VERSION_CONFLICT' : d.blockers.includes('FORBIDDEN') ? 'FORBIDDEN' : 'PUBLICATION_BLOCKED', d.blockers.join(', '), { decision: d });
      const v = getV(id);
      if (v.lifecycleStatus !== 'PUBLISHED') { const nv = freeze({ ...v, lifecycleStatus: 'PUBLISHED', publishedAt: meta.at || null, publishedBy: meta.by || null, supersedesVersionId: ptr(v.analysisDefinitionId).currentPublishedVersionId }); versions.set(id, nv); }
      activateInternal(versions.get(id), meta, 'PUBLISH'); return { decision: d, version: versions.get(id), pointer: { ...ptr(v.analysisDefinitionId) } };
    }
    /** activate(versionId, meta) — rollback/re-activation of an older PUBLISHED version (audit; nothing is deleted) */
    function activate(id, meta = {}) {
      const v = getV(id), pt = ptr(v.analysisDefinitionId);
      if (v.lifecycleStatus !== 'PUBLISHED') throw err('INVALID_TRANSITION', 'só uma versão publicada pode ser reativada');
      if (typeof meta.can !== 'function' || !meta.can('analysis.activate')) throw err('FORBIDDEN', 'reativar exige analysis.activate');
      if (!meta.reason) throw err('MISSING_REASON', 'reativar exige o motivo');
      if ((meta.expectedCurrentVersionId ?? null) !== pt.currentPublishedVersionId) throw err('ANALYSIS_CURRENT_VERSION_CONFLICT', 'a versão atual mudou');
      activateInternal(v, meta, 'ACTIVATE'); return { version: v, pointer: { ...pt } };
    }
    function archive(id, meta = {}) {
      const v = getV(id); if (ptr(v.analysisDefinitionId).currentPublishedVersionId === id) throw err('INVALID_TRANSITION', 'a versão atual não pode ser arquivada');
      if (!['PUBLISHED', 'REJECTED', 'VALIDATED'].includes(v.lifecycleStatus)) throw err('INVALID_TRANSITION', `${v.lifecycleStatus} → ARCHIVED`);
      versions.set(id, freeze({ ...v, lifecycleStatus: 'ARCHIVED', archivedAt: meta.at || null })); return versions.get(id);
    }
    /** resolve(definitionId, { mode, versionId, at, technical }) — normal experience: CURRENT_PUBLISHED only; LATEST/EXPLICIT drafts only in technical mode */
    function resolve(defId, o = {}) {
      const mode = o.mode || 'CURRENT_PUBLISHED', pt = ptr(defId);
      let id = null;
      if (mode === 'CURRENT_PUBLISHED') id = pt.currentPublishedVersionId;
      else if (mode === 'LATEST') id = pt.latestVersionId;
      else if (mode === 'EXPLICIT_VERSION') id = o.versionId;
      else if (mode === 'AS_OF') { const a = activations.filter(x => x.analysisDefinitionId === defId && x.activatedAt != null && x.activatedAt <= o.at && (x.deactivatedAt == null || x.deactivatedAt > o.at)).pop(); id = a ? a.versionId : null; }
      else throw err('INVALID_RESOLUTION_MODE', `modo inválido: ${mode}`);
      if (!id) return null;
      const v = getV(id);
      if (v.lifecycleStatus !== 'PUBLISHED' && !o.technical) throw err('DRAFT_NOT_ALLOWED', 'versões não publicadas só no modo técnico');
      return v;
    }
    /** derived current/superseded label */
    const currentStatus = id => { const v = getV(id), pt = ptr(v.analysisDefinitionId); return pt.currentPublishedVersionId === id ? 'CURRENT' : activations.some(a => a.versionId === id) ? 'SUPERSEDED' : 'NEVER_ACTIVE'; };
    /** currentness(versionId, latestSources, def) → { status, reasons } comparing only the definition's real dependencies */
    function currentness(id, latest, def) {
      const v = getV(id), snap = snapshots.get(v.inputSnapshotId), reasons = [];
      const now = inputSnapshot(def, latest, { organizationId: org, developmentId: v.developmentId });
      const byType = arr => new Map(arr.map(r => [r.subtype || r.type, r]));
      const a = byType([...snap.versionedDataRefs, ...snap.dynamicDataRefs]), b = byType([...now.versionedDataRefs, ...now.dynamicDataRefs]);
      for (const [k, r] of b) { const o = a.get(k); if (!o || J(o) !== J(r)) reasons.push({ code: 'INPUTS_CHANGED', dependency: k, from: o ? o.id : null, to: r.id }); }
      const ma = snap.methodologyRefs[0], mb = now.methodologyRefs[0];
      if (ma && mb && ma.methodologyChecksum !== mb.methodologyChecksum) reasons.push({ code: 'METHODOLOGY_SUPERSEDED', from: ma.methodologyVersion, to: mb.methodologyVersion });
      if (snap.engineBuildRef && now.engineBuildRef && J(snap.engineBuildRef.moduleVersions) + snap.engineBuildRef.engineVersion !== J(now.engineBuildRef.moduleVersions) + now.engineBuildRef.engineVersion) reasons.push({ code: 'ENGINE_SUPERSEDED' });
      const status = reasons.some(r => r.code === 'INPUTS_CHANGED') ? 'INPUTS_CHANGED' : reasons.some(r => r.code === 'METHODOLOGY_SUPERSEDED') ? 'METHODOLOGY_SUPERSEDED' : reasons.some(r => r.code === 'ENGINE_SUPERSEDED') ? 'ENGINE_SUPERSEDED' : 'CURRENT_INPUTS';
      return { versionId: id, status, reasons, comparedDependencies: [...b.keys()].sort(), ignoredDomains: def.notDependentOn || [] };
    }
    /** refreshPlan(versionId, latestSources, def) → AnalysisRefreshPlan (recommends; never recomputes or publishes by itself) */
    function refreshPlan(id, latest, def) {
      const v = getV(id), cur = currentness(id, latest, def), snap = snapshots.get(v.inputSnapshotId), next = inputSnapshot(def, latest, { organizationId: org, developmentId: v.developmentId });
      const old = new Map(snap.dependencyFingerprints.map(f => [f.moduleId, f.computationKey])), affected = next.dependencyFingerprints.filter(f => old.get(f.moduleId) !== f.computationKey).map(f => f.moduleId);
      const reusable = v.moduleResultRefs.map(r => moduleSets.get(r)).filter(m => m && !affected.includes(m.moduleId)).map(m => m.id);
      return { currentVersionId: id, affectedModuleIds: affected, reasons: cur.reasons, canReuseModuleResultIds: reusable, recommendedAction: cur.status === 'CURRENT_INPUTS' ? 'NO_ACTION' : cur.status === 'METHODOLOGY_SUPERSEDED' ? 'REVIEW' : 'RECOMPUTE', generatedAt: null };
    }
    const J = x => JSON.stringify(x);
    /** diff(fromId, toId) → AnalysisVersionDiff; causes only from snapshot/method metadata (no invented causality) */
    function diff(fromId, toId) {
      const a = getV(fromId), b = getV(toId), ra = resultSets.get(a.resultSetRef), rb = resultSets.get(b.resultSetRef), ea = new Map(ra.entities.map(e => [e.entityId, e])), attr = {};
      let changedEntities = 0, changedAttrs = 0;
      for (const e of rb.entities) { const o = ea.get(e.entityId); let ch = false; for (const k of Object.keys(e.outputs)) if (!o || J(o.outputs[k]) !== J(e.outputs[k])) { ch = true; changedAttrs++; attr[k] = (attr[k] || 0) + 1; } if (ch) changedEntities++; }
      const sa = snapshots.get(a.inputSnapshotId), sb = snapshots.get(b.inputSnapshotId), causes = [];
      if (sa && sb) {
        if (J(sa.versionedDataRefs) !== J(sb.versionedDataRefs) || J(sa.dynamicDataRefs) !== J(sb.dynamicDataRefs)) causes.push('INPUT_CHANGED');
        if (J(sa.methodologyRefs) !== J(sb.methodologyRefs)) causes.push('METHODOLOGY_CHANGED');
        if (J(sa.engineBuildRef) !== J(sb.engineBuildRef)) causes.push('ENGINE_CHANGED');
      }
      if (a.origin === 'MIGRATED_LEGACY' || b.origin === 'MIGRATED_LEGACY') causes.push('LEGACY_MIGRATION');
      const moduleDiffs = (b.moduleResultRefs || []).map(id => moduleSets.get(id)).filter(Boolean).map(m => { const prev = (a.moduleResultRefs || []).map(x => moduleSets.get(x)).find(x => x && x.moduleId === m.moduleId);
        return { moduleId: m.moduleId, fromModuleVersion: prev ? prev.moduleVersion : null, toModuleVersion: m.moduleVersion, reused: !!prev && prev.id === m.id, changedOutput: !prev || prev.outputChecksum !== m.outputChecksum }; });
      return { id: 'diff:' + C([fromId, toId]), fromVersionId: fromId, toVersionId: toId, changedEntityCount: changedEntities, changedAttributeCount: changedAttrs, moduleDiffs,
        attributeDiffSummary: Object.entries(attr).map(([attribute, count]) => ({ attribute, count })), causeSummary: { causes: causes.length ? causes : (changedEntities ? ['UNKNOWN'] : []) }, generatedAt: null };
    }
    /** impact(candidateId, currentId?) → AnalysisImpactReport (class transitions, score deltas, ranking shifts) */
    function impact(candId, curId) {
      const cur = curId ? getV(curId) : null, cand = getV(candId), rc = resultSets.get(cand.resultSetRef), ro = cur ? new Map(resultSets.get(cur.resultSetRef).entities.map(e => [e.entityId, e])) : new Map();
      const trans = {}, items = []; let changed = 0, crit = 0;
      for (const e of rc.entities) {
        const o = ro.get(e.entityId); if (!o) continue;
        const dScore = Math.max(...Object.keys(e.outputs.scores).map(k => Math.abs((e.outputs.scores[k] ?? 0) - (o.outputs.scores[k] ?? 0))));
        const rk = t => ((e.outputs.rankings.find(x => x.type === t) || {}).position ?? 0) - ((o.outputs.rankings.find(x => x.type === t) || {}).position ?? 0);
        if (o.outputs.class !== e.outputs.class) { const k = `${o.outputs.class}→${e.outputs.class}`; trans[k] = (trans[k] || 0) + 1; crit++; }
        if (J(o.outputs) !== J(e.outputs)) { changed++; items.push({ entityId: e.entityId, maxScoreDelta: dScore, overallRankShift: rk('OVERALL'), classFrom: o.outputs.class, classTo: e.outputs.class }); }
      }
      items.sort((a, b) => b.maxScoreDelta - a.maxScoreDelta || Math.abs(b.overallRankShift) - Math.abs(a.overallRankShift) || (a.entityId < b.entityId ? -1 : 1));
      return { candidateVersionId: candId, currentVersionId: curId || null, changedEntityCount: changed, classTransitionCounts: trans, criticalFieldChangeCount: crit, largestChanges: items.slice(0, 20),
        rankingShiftSummary: { maxAbsShift: items.reduce((m, x) => Math.max(m, Math.abs(x.overallRankShift)), 0) }, causeSummary: curId ? diff(curId, candId).causeSummary : { causes: [] }, generatedAt: null };
    }
    /** reproducibility(versionId) → AnalysisReproducibilityReport (honest: legacy baselines are never FULL) */
    function reproducibility(id) {
      const v = getV(id), snap = snapshots.get(v.inputSnapshotId), missing = [];
      if (!snap) missing.push('INPUT_SNAPSHOT');
      else {
        if (!snap.versionedDataRefs.some(r => r.subtype === 'MEASUREMENT_INPUT')) missing.push('MEASUREMENT_INPUT_REF');
        if (!snap.methodologyRefs.length) missing.push('METHODOLOGY_REF');
        if (!snap.engineBuildRef) missing.push('ENGINE_BUILD_REF');
        if (snap.engineBuildRef && !snap.engineBuildRef.runtimeVersion) missing.push('RUNTIME_VERSION');
        if (snap.engineBuildRef && !snap.engineBuildRef.artifactChecksum && !snap.engineBuildRef.commitRef) missing.push('ENGINE_ARTIFACT_CHECKSUM');
        missing.push('DOCUMENT_VERSION_IDS'); // plan PDF / KMZ / aerial: the platform has source ids but no document version ids yet
      }
      const critical = missing.filter(m => ['INPUT_SNAPSHOT', 'MEASUREMENT_INPUT_REF', 'METHODOLOGY_REF'].includes(m));
      const status = v.origin === 'MIGRATED_LEGACY' ? 'PARTIAL' : critical.length ? 'NON_REPRODUCIBLE' : missing.filter(m => m !== 'DOCUMENT_VERSION_IDS').length ? 'PARTIAL' : 'FULL';
      const note = status === 'FULL' ? 'Entradas, metodologia e engine identificados; documentos-fonte referenciados por id de fonte (sem versão de documento).' : null;
      return { analysisVersionId: id, status, missingRefs: missing, runtimeUncertainty: missing.includes('RUNTIME_VERSION'), externalMutableSourceRefs: [], note };
    }
    /** register a MIGRATED_LEGACY baseline (published lots.json) as a version with its own snapshot */
    function registerBaseline(b, meta = {}) {
      own(b.snapshot); saveSnapshot(b.snapshot);
      const rs = { ...b.resultSet, organizationId: org }; rs.id = 'rs:' + rs.checksum; resultSets.set(rs.id, freeze(rs));
      const seq = nextSeq(b.analysisDefinitionId), count = s => rs.entities.filter(e => e.resultStatus === s).length;
      const v = { id: 'av:' + C({ d: b.analysisDefinitionId, s: seq, rs: rs.checksum, org, legacy: true }), organizationId: org, developmentId: b.snapshot.developmentId, analysisDefinitionId: b.analysisDefinitionId, sequence: seq, label: 'A' + seq,
        origin: 'MIGRATED_LEGACY', lifecycleStatus: 'DRAFT', inputSnapshotId: b.snapshot.id, methodologyRefs: b.snapshot.methodologyRefs, engineBuildRef: null, moduleResultRefs: [], resultSetRef: rs.id, contentChecksum: rs.checksum,
        reproducibilityStatus: 'PARTIAL', createdFromRunId: null, createdAt: meta.at || null, determinism: [],
        manifest: { entityCount: rs.entityCount, readyCount: count('READY'), partialCount: count('PARTIAL'), notComputableCount: count('NOT_COMPUTABLE'), errorCount: count('ERROR'), outputSchemaVersion: rs.outputSchemaVersion, resultSetChecksum: rs.checksum } };
      versions.set(v.id, v); const pt = ptr(b.analysisDefinitionId); pt.latestVersionId = v.id; return v;
    }
    const resultSet = id => resultSets.get(getV(id).resultSetRef);
    return { organizationId: org, plan, run, validate, decision, publish, activate, archive, resolve, currentStatus, currentness, refreshPlan, diff, impact, reproducibility, registerBaseline, saveSnapshot,
      version: id => versions.has(id) ? own(versions.get(id)) : null, versions: defId => [...versions.values()].filter(v => !defId || v.analysisDefinitionId === defId), run_: id => runs.get(id) || null, runs: () => [...runs.values()],
      snapshot: id => snapshots.get(id) || null, moduleResultSet: id => moduleSets.get(id) || null, resultSet, validationReport: id => reports.get(id) || null,
      pointer: defId => ({ ...ptr(defId) }), activations: defId => activations.filter(a => !defId || a.analysisDefinitionId === defId).map(a => ({ ...a })), audit: () => audit.slice(), events: () => events.slice() };
  }

  // ---------------------------------------------------------------- legacy baseline and parity
  const NOTE_KEYS = ['quiet', 'privacy', 'solar', 'view', 'leisure', 'gate', 'lowTraffic', 'geometry', 'priceQuality', 'liquidity', 'relativeValue'];
  /** legacyBaseline(lots, { def, dev, organizationId }) → { snapshot, resultSet } from the published canonical lots (no recomputation) */
  function legacyBaseline(lots, o) {
    const entities = lots.slice().sort((a, b) => a.identity.id < b.identity.id ? -1 : 1).map(l => ({ entityId: l.identity.id, resultStatus: 'READY', warnings: [],
      outputs: { scores: { ...l.intelligence.scores }, class: l.intelligence.class, rankings: l.intelligence.rankings.map(r => ({ ...r })), highlights: l.intelligence.highlights.map(h => h.type),
        alerts: l.intelligence.alerts.map(a => ({ type: a.type, severity: a.severity })), confidence: l.intelligence.confidence, notesPublished: Object.fromEntries(NOTE_KEYS.map(k => [k, App.model.criterion(l, k) ?? null])) } }));
    const snapshot = { organizationId: o.organizationId, developmentId: o.dev.id, analysisDefinitionId: o.def.id, staticDataVersion: String(o.dev.staticDataVersion),
      versionedDataRefs: [refs.staticData(o.dev), { type: 'ANALYSIS_VERSION', subtype: 'PUBLISHED_ANALYSIS', id: String(o.dev.analysisVersion) }], dynamicDataRefs: [], documentVersionRefs: [], externalSnapshotRefs: [], configVersionRefs: [],
      methodologyRefs: [], provenanceRevision: null, entitySetRef: C(entities.map(e => e.entityId)), entityCount: entities.length, engineBuildRef: null, moduleGraphChecksum: null, dependencyFingerprints: [], generatedAt: null,
      note: 'Baseline legado: valores publicados em lots.json (análise de 2026-10-06); método e entradas exatas não referenciados no registro.' };
    snapshot.checksum = C(snapshot); snapshot.id = 'snap:' + snapshot.checksum;
    return { analysisDefinitionId: o.def.id, snapshot: freeze(snapshot), resultSet: { analysisDefinitionId: o.def.id, entityType: 'LOT', entityCount: entities.length, outputSchemaVersion: 'lot-published-analysis/legacy', entities, checksum: C(entities), moduleResultRefs: [] } };
  }
  /** parity(baselineResultSet, candidateResultSet) → AnalysisParityReport. Exact for scores/class/rankings/highlights/alerts/confidence; notes compared at the published precision (1 decimal) = tolerance match. */
  function parity(base, cand, meta = {}) {
    const bm = new Map(base.entities.map(e => [e.entityId, e])), mism = [];
    let attrs = 0, exact = 0, tol = 0;
    const sortA = xs => xs.slice().sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
    for (const e of cand.entities) {
      const b = bm.get(e.entityId); if (!b) { mism.push({ entityId: e.entityId, attribute: '*', baseline: null, candidate: 'present' }); continue; }
      const pairs = [['scores', b.outputs.scores, e.outputs.scores], ['class', b.outputs.class, e.outputs.class], ['rankings', b.outputs.rankings, e.outputs.rankings], ['highlights', b.outputs.highlights, e.outputs.highlights],
        ['alerts', sortA(b.outputs.alerts), sortA(e.outputs.alerts)], ['confidence', b.outputs.confidence, e.outputs.confidence]];
      for (const [k, x, y] of pairs) { attrs++; if (JSON.stringify(x) === JSON.stringify(y)) exact++; else mism.push({ entityId: e.entityId, attribute: k, baseline: x, candidate: y, classification: 'UNCLASSIFIED' }); }
      for (const k of NOTE_KEYS) {
        attrs++; const pub = b.outputs.notesPublished[k], raw = e.outputs.notes[k], rounded = raw == null ? null : R.roundTo(raw, 1);
        if (pub === raw) exact++; else if (pub === rounded) tol++; else mism.push({ entityId: e.entityId, attribute: 'notes.' + k, baseline: pub, candidate: raw, classification: 'UNCLASSIFIED' });
      }
    }
    for (const id of bm.keys()) if (!cand.entities.some(e => e.entityId === id)) mism.push({ entityId: id, attribute: '*', baseline: 'present', candidate: null });
    return { baselineRef: meta.baselineRef || base.checksum, candidateRef: meta.candidateRef || cand.checksum, comparedEntityCount: cand.entities.length, comparedAttributeCount: attrs, exactMatchCount: exact,
      toleranceMatchCount: tol, toleranceProfile: 'notes: precisão publicada (1 casa decimal); demais saídas exatas', mismatchCount: mism.length, mismatchItems: mism.slice(0, 50), generatedAt: meta.at || null };
  }

  /** determinismCheck(inputs, cfg) → AnalysisDeterminismCheck: same inputs + versions (any order) → same output checksum */
  function determinismCheck(inputs, cfg, opts = {}) {
    const m = App.methodology.compiled(cfg), run = xs => C(App.intelligence.analyzeDevelopment(xs, { methodology: m, generatedAt: null }).results.map(r => [r.lotId, outputsOf(r)]));
    const a = run(inputs), b = run(inputs.slice().reverse());
    return { deterministic: a === b, runs: 2, checksums: [a, b], orderIndependent: true, numericPrecisionProfile: opts.precision || 'exact' };
  }
  // ---------------------------------------------------------------- read model (UI): which version is current, how fresh, how reproducible
  /** readModel(repo, defId, { mode, latestSources, def }) → AnalysisVersionReadModel for client / broker / technical */
  function readModel(repo, defId, o = {}) {
    const v = repo.resolve(defId, { mode: 'CURRENT_PUBLISHED' }); if (!v) return { available: false };
    const cur = o.latestSources && o.def ? repo.currentness(v.id, o.latestSources, o.def) : { status: 'UNKNOWN', reasons: [] };
    const base = { available: true, label: v.label, publishedAt: v.publishedAt || null, currentness: cur.status, stale: cur.status !== 'CURRENT_INPUTS' && cur.status !== 'UNKNOWN' };
    if (o.mode === 'client') return { available: true, stale: base.stale, note: base.stale ? 'Análise comparativa em revisão; valores sujeitos a confirmação.' : null };
    const broker = { ...base, methodologyVersion: (v.methodologyRefs[0] || {}).methodologyVersion || null, origin: v.origin, note: base.stale ? 'Há dados novos que esta análise ainda não considera.' : null };
    if (o.mode !== 'technical') return broker;
    const p = repo.pointer(defId);
    return { ...broker, versionId: v.id, latestVersionId: p.latestVersionId, pointerRevision: p.revision, inputSnapshotId: v.inputSnapshotId, contentChecksum: v.contentChecksum, engineBuildRef: v.engineBuildRef,
      reproducibility: repo.reproducibility(v.id).status, currentnessReasons: cur.reasons, activations: repo.activations(defId) };
  }
  return Object.freeze({ LIFECYCLE, RUN_STATUS, ORIGINS, CURRENTNESS, REPRODUCIBILITY, RESOLUTION, SCOPES, ENGINE_ID, OUTPUT_SCHEMA,
    definitions, moduleGraph, topo, refs, fingerprint, moduleFingerprints, inputSnapshot, repository, legacyBaseline, parity, readModel, outputsOf, determinismCheck });
})();
