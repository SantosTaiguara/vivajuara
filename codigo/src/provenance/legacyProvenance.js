/* provenance/legacyProvenance.js — Topic 33 migration: legacy FieldRegistry labels (status/sourceId/method, incl. per-lot
   overrides in lot.provenance) → AttributeProvenanceRecords. Honest by construction:
   - "CONFIRMED" without a recoverable exact source becomes LEGACY_DECLARED / UNRESOLVED (never DIRECT_SOURCE / VERIFIED);
     the inventoried document stays only as a candidate (metadata.candidateDocumentId, match REQUIRES_REVIEW);
   - CALCULATED keeps a MethodRef only when the method version is traceable (config/provenance methods);
     otherwise LEGACY_DECLARED / PARTIAL with the legacy method name in metadata;
   - ESTIMATED stays an estimate (ESTIMATED, or ANALYSIS_DERIVED with metadata.estimate);
   - null gets a configured NotAvailableReason, or UNKNOWN_REASON flagged REVIEW_REQUIRED (no invented reason).
   Read-only over lots: values, scores, classes and prices are untouched (zero-delta is tested). */
App.provenanceMigration = (() => {
  const P = App.provenance, PS = App.provenanceServices, I = App.integrity;
  const MIGRATION_VERSION = '1.0.0';

  function context(devId, o = {}) {
    const devCfg = (App.config.DEVELOPMENTS || []).find(d => d.id === devId) || null;
    const orgId = o.organizationId || (App.tenancy && App.tenancy.organizationOfDevelopment ? App.tenancy.organizationOfDevelopment(devId) : null) || ((P.configOf(devId) || {}).organizationId);
    const docMatch = id => App.documentServices ? App.documentServices.legacyDocumentFor(devId, id) : null;
    const meth = App.methodology && App.methodology.current ? App.methodology.current(devId) : null;
    const cfgBody = devCfg ? JSON.parse(JSON.stringify(devCfg)) : null;
    return { devId, devCfg, organizationId: orgId, methods: P.methodRegistry(devId), docMatch, recordedAt: o.recordedAt || '2026-10-09T00:00:00.000Z',
      methodologyVersion: meth ? meth.methodologyVersion : null, devConfigChecksum: cfgBody ? I.checksumOf(cfgBody) : null, na: ((P.configOf(devId) || {}).notAvailableReasons || {}).fields || {} };
  }

  /** recordInputFor(lot, field, ctx) → record input (not yet frozen) */
  function recordInputFor(lot, f, ctx) {
    const path = f.key, v = P.valueAt(lot, path), lp = App.model.getFieldProvenance(lot, path);
    const dv = lot.metadata && lot.metadata.dataVersions || {};
    if (PS.pricingAdapter.supports('LOT', path)) return PS.pricingAdapter.recordInput(lot, path, { organizationId: ctx.organizationId, devCfg: ctx.devCfg });
    if (PS.availabilityAdapter.supports('LOT', path)) return PS.availabilityAdapter.recordInput(lot, path, { organizationId: ctx.organizationId });
    const base = { organizationId: ctx.organizationId, developmentId: lot.identity.developmentId, entityType: 'LOT', entityId: lot.identity.id, attributePath: path, valueFingerprint: P.fingerprint(v), currentness: 'CURRENT',
      valueVersionRef: /^intelligence\./.test(path) ? 'ANALYSIS_VERSION:' + (dv.analysisVersion || '') : 'STATIC_DATA_VERSION:' + (dv.staticVersion || '') };
    const legacy = { legacyLabel: lp.status, legacySourceId: lp.sourceId || null, legacyMethod: lp.method || null, legacyConfidenceLabel: lp.confidence || null, migration: MIGRATION_VERSION };
    const cand = lp.sourceId ? ctx.docMatch(lp.sourceId) : null;
    const candidate = cand ? { candidateDocumentId: cand.documentId, candidateDocumentVersionId: cand.candidateVersionId, candidateMatchStatus: cand.matchStatus, sourceAuthority: null } : {};
    const geoCand = !cand && (lp.sourceId === 'plan-geometry-v1') ? ctx.docMatch('official-plan-v1') : null; // measured on the plan: the plan is the candidate input document
    const deps = () => (f.dependsOn || []).map(p => P.dependencyRef({ organizationId: ctx.organizationId, entityType: 'LOT', entityId: lot.identity.id, attributePath: p, valueFingerprint: P.fingerprint(P.valueAt(lot, p)) }));
    const analysisEv = () => P.evidence.analysis({ analysisVersion: (lot.intelligence && lot.intelligence.analysisVersion) || dv.analysisVersion, moduleId: 'analysis-v1', moduleVersion: dv.analysisVersion || '2026-10-06', methodologyVersion: ctx.methodologyVersion || undefined });

    if (v == null && lp.status !== 'CONFIRMED') {
      const conf = ctx.na[path], reason = conf ? conf.reason : lp.status === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'UNKNOWN_REASON';
      return { ...base, provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', evidenceRefs: [], notAvailableReason: reason, status: reason === 'UNKNOWN_REASON' ? 'REVIEW_REQUIRED' : 'ACTIVE',
        metadata: { ...legacy, basis: conf ? conf.basis : null } };
    }
    if (lp.status === 'NOT_APPLICABLE') return { ...base, provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', evidenceRefs: [], notAvailableReason: 'NOT_APPLICABLE', metadata: legacy };
    if (lp.status === 'CONFIRMED' && ['config', 'inventory', 'schema'].includes(lp.method)) {
      const cfgEv = lp.sourceId === 'analysis-v1' ? P.evidence.config({ configType: 'analysis-version', configId: 'analysis-v1', configVersion: dv.analysisVersion || '2026-10-06' })
        : P.evidence.config({ configType: 'development-config', configId: 'developments.js#' + ctx.devId, configVersion: dv.staticVersion || 'unknown', configChecksum: ctx.devConfigChecksum || undefined });
      return { ...base, provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [cfgEv], metadata: { ...legacy, sourceAuthority: 'INTERNAL_APPROVED' } };
    }
    if (lp.status === 'CONFIRMED' || lp.status === 'TO_CONFIRM') // official / declared without exact recoverable source
      return { ...base, provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED', evidenceRefs: [], currentness: lp.status === 'TO_CONFIRM' ? 'REVIEW_REQUIRED' : 'UNKNOWN', metadata: { ...legacy, ...candidate } };
    const m = lp.method ? ctx.methods.resolveLegacy(lp.sourceId, lp.method, path) : null;
    const intel = /^intelligence\./.test(path), estimate = lp.status === 'ESTIMATED';
    if (lp.status === 'CALCULATED' || estimate) {
      if (intel) return { ...base, provenanceKind: 'ANALYSIS_DERIVED', evidenceState: 'PARTIAL', evidenceRefs: [analysisEv()], methodRef: m ? P.methodRef(m) : null, dependencyRefs: deps(), metadata: { ...legacy, estimate } };
      if (m) return { ...base, provenanceKind: estimate ? 'ESTIMATED' : 'CALCULATED', evidenceState: 'PARTIAL', evidenceRefs: m.legacySourceId === 'analysis-v1' ? [analysisEv()] : [], methodRef: P.methodRef(m), dependencyRefs: deps(),
        metadata: { ...legacy, ...(geoCand ? { candidateDocumentId: geoCand.documentId, candidateDocumentVersionId: geoCand.candidateVersionId, candidateMatchStatus: geoCand.matchStatus } : candidate) } };
      return { ...base, provenanceKind: 'LEGACY_DECLARED', evidenceState: 'PARTIAL', evidenceRefs: [], currentness: 'UNKNOWN', metadata: { ...legacy, ...candidate, estimate, methodVersionTraceable: false } };
    }
    return { ...base, provenanceKind: 'LEGACY_DECLARED', evidenceState: 'UNRESOLVED', evidenceRefs: [], currentness: 'UNKNOWN', metadata: legacy };
  }

  /** migrateLots(lots, devId, opts) → { records, report } — pure; never mutates the lots */
  function migrateLots(lots, devId, opts = {}) {
    const ctx = context(devId, opts), fields = P.pathRegistry.tracked(), records = [], tally = {}, byLegacy = {};
    for (const lot of lots) for (const f of fields) {
      const r = P.createRecord({ recordedAt: ctx.recordedAt, recordedBy: 'system:legacy-migration', ...recordInputFor(lot, f, ctx) });
      records.push(r); const k = r.provenanceKind + '/' + r.evidenceState; tally[k] = (tally[k] || 0) + 1;
      const lk = (r.metadata.legacyLabel || 'ADAPTER') + ' → ' + r.provenanceKind + '/' + r.evidenceState; byLegacy[lk] = (byLegacy[lk] || 0) + 1;
    }
    const report = Object.freeze({ migrationVersion: MIGRATION_VERSION, developmentId: devId, organizationId: ctx.organizationId, lots: lots.length, trackedFields: fields.length, records: records.length, byKindAndState: tally, legacyToNew: byLegacy,
      verifiedFromLegacyConfirmed: records.filter(r => r.metadata.legacyLabel === 'CONFIRMED' && r.evidenceState === 'VERIFIED' && !(r.evidenceRefs[0] && r.evidenceRefs[0].type === 'CONFIG_VERSION')).length,
      nullWithoutReason: records.filter(r => r.notAvailableReason === 'UNKNOWN_REASON').length, checksum: I.checksumOf(records.map(r => r.id)) });
    return { records, report };
  }
  /** load(service, tenant, lots, devId) — bulk import into a provenance service */
  function load(svc, t, lots, devId, opts = {}) { const { records, report } = migrateLots(lots, devId, opts); const imp = svc.bulkImport(t, records, { validate: opts.validate !== false }); return { report, import: imp }; }
  /** zeroDelta(lotsBefore[serialized], lots) — the migration must not change a single canonical value */
  const zeroDelta = (before, lots) => { const after = lots.map(l => App.domain.serializeLot(l)); const diff = after.filter((s, i) => s !== before[i]).length; return { ok: diff === 0, changedLots: diff }; };

  return Object.freeze({ MIGRATION_VERSION, context, recordInputFor, migrateLots, load, zeroDelta });
})();
