/* onboarding/orchestrator.js — topic 58 §403–416, §259–281, §297–306, §424–437, §517: OnboardingOrchestrator + workspace.
   Coordinates the stages (it does not own domain truths: it never calculates scores, interprets legal clauses, decides
   availability or calculates financial plans, §405). One workspace = one organization, with:
   - deny-by-default authorization (injected `authorize(principal, permission, scope)`; none → everything denied) and
     cross-tenant refusal + security event (§73, §517);
   - an in-memory repository (the backend swaps it for Postgres, migration 012) and an immutable object store keyed by checksum;
   - a DAG pipeline plan executed in dependency order, real stage records (progress never invented), checkpoints and
     version-keyed parse cache reused only with the same checksum + parser version (§275–280);
   - run modes DRY_RUN / BUILD_CANDIDATE / PUBLISH: a dry-run never touches publication pointers (§326–330);
   - metrics (no raw values in labels), logs with ids only, audit with refs only (§259–263, §437–438);
   - source connectors + webhook replay protection; API data always goes through staging (§297–306).
   Current published data is only READ (existingLots / current prices / current availability are inputs); nothing here
   writes them. Depends on every App.onboarding.* module. */
App.onboarding = App.onboarding || {};
App.onboarding.orchestrator = (() => {
  const O = App.onboarding, M = O.model, IN = O.intake, PA = O.parsers, MP = O.mapping, CA = O.canonical, GE = O.geometry, CO = O.commercial, Q = O.quality, PU = O.publication;
  const P = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);
  const PERM = freeze({ READ: 'development_onboarding.read', CREATE: 'development_onboarding.create', UPLOAD: 'development_onboarding.upload_source', MAP: 'development_onboarding.map_schema',
    RESOLVE: 'development_onboarding.resolve_conflict', GEOMETRY: 'development_onboarding.review_geometry', PUBLISH: 'development_onboarding.publish', ROLLBACK: 'development_onboarding.rollback' });

  /** default authorizer: explicit grant list on the principal, scoped to its organization (deny by default) */
  const grantListAuthorizer = (principal, permission) => !!(principal && Array.isArray(principal.permissions) && principal.permissions.includes(permission));

  function createWorkspace({ organizationId, clock = () => null, authorize = grantListAuthorizer, scanner = null, extractor = null, customTransforms = [] } = {}) {
    if (!organizationId) throw new Error('organizationId obrigatório');
    const db = { cases: new Map(), sources: new Map(), bytes: new Map(), authority: [], mappingSets: new Map(), batches: new Map(), runs: new Map(), parseCache: new Map(), reviews: new Map(),
      conflicts: new Map(), exceptions: [], corrections: [], publications: new Map(), connectors: new Map(), syncStates: new Map(), deliveries: new Set(), supersessions: [], statusMappings: [], geometryApprovals: new Map(), transforms: new Map(), exclusions: new Map(), removals: new Map() };
    const metrics = {}, logs = [], audit = [], securityEvents = [];
    const transforms = MP.createTransformRegistry(customTransforms);
    const inc = (name, by = 1) => { metrics[name] = (metrics[name] || 0) + by; };
    const log = (level, msg, ids = {}) => logs.push(freeze({ level, msg, batchId: ids.batchId || null, sourceAssetId: ids.sourceAssetId || null, developmentDraftId: ids.developmentDraftId || null, at: clock() }));
    const auditOf = (action, principal, entityRef, outcome = 'SUCCESS', extra = {}) => audit.push(freeze({ action, actorId: principal ? principal.id : null, organizationId, entityRef, outcome, at: clock(), ...extra }));
    const secEvent = (type, principal, ref) => { securityEvents.push(freeze({ type, actorId: principal ? principal.id : null, organizationId, ref: ref || null, at: clock() })); };

    /** guard(principal, permission, resourceOrg) → null when allowed, fail otherwise (cross-tenant before permission: same 404-style refusal) */
    function guard(principal, permission, resourceOrg = organizationId, ref) {
      if (!principal || principal.organizationId !== organizationId || resourceOrg !== organizationId) {
        secEvent(permission === PERM.UPLOAD ? 'CROSS_TENANT_IMPORT_ATTEMPT' : 'CROSS_TENANT_IMPORT_ATTEMPT', principal, ref); auditOf('ACCESS', principal, ref, 'DENIED', { permission, reason: 'CROSS_TENANT' });
        return M.fail('CROSS_TENANT_DENIED');
      }
      if (!authorize(principal, permission, { organizationId })) {
        if (permission === PERM.UPLOAD) secEvent('UNAUTHORIZED_SOURCE_UPLOAD', principal, ref);
        if (permission === PERM.PUBLISH || permission === PERM.ROLLBACK) secEvent('UNAUTHORIZED_PUBLICATION', principal, ref);
        auditOf('ACCESS', principal, ref, 'DENIED', { permission }); return M.fail('PERMISSION_DENIED', permission);
      }
      return null;
    }
    const caseOf = id => db.cases.get(id) || null;
    const setCase = c => { db.cases.set(c.id, c); return c; };
    const moveCase = (c, to, by) => { if (c.status === to) return M.ok(c); const t = M.transition('case', c, to, { at: clock(), by }); if (t.ok) setCase(t.value); return t; };

    // ------------------------------------------------------------------ cases
    function createCase(principal, identity) {
      const g = guard(principal, PERM.CREATE, identity && identity.organizationId, 'case'); if (g) return g;
      const errs = [];
      if (!identity || !identity.name) errs.push('name'); if (!identity || !/^[A-Z0-9]{1,8}$/.test(identity.code || '')) errs.push('code'); if (!identity || !identity.timezone) errs.push('timezone');
      if (identity && !['LOT_SUBDIVISION', 'CONDOMINIUM_LOTS', 'OTHER'].includes(identity.developmentType)) errs.push('developmentType');
      if (errs.length) return M.fail('VALIDATION_ERROR', errs.join(', '));
      if ([...db.cases.values()].some(c => c.identity.code === identity.code && c.status !== 'CANCELLED')) return M.fail('VALIDATION_ERROR', `código ${identity.code} já usado nesta organização (§18)`);
      const id = M.id('case', organizationId, identity.code, db.cases.size + 1);
      const c = freeze({ id, organizationId, developmentDraftId: M.id('devdraft', organizationId, identity.code), developmentId: identity.developmentId || null, identity: freeze({ ...identity }), status: 'DRAFT',
        createdBy: principal.id, createdAt: clock(), updatedAt: clock(), currentBatchId: undefined, revision: '1', statusHistory: freeze([]), visibleToBrokers: false });
      setCase(c); db.publications.set(c.id, PU.emptyState(c.developmentId || c.developmentDraftId)); auditOf('CASE_CREATED', principal, id); log('info', 'onboarding case created', { developmentDraftId: c.developmentDraftId });
      return M.ok(c);
    }
    function cancelCase(principal, caseId) {
      const c = caseOf(caseId); const g = guard(principal, PERM.CREATE, c && c.organizationId, caseId); if (g) return g;
      const t = moveCase(c, 'CANCELLED', principal.id); if (t.ok) auditOf('CASE_CANCELLED', principal, caseId); return t; // raw sources are kept (§274)
    }

    // ------------------------------------------------------------------ sources
    function uploadSource(principal, caseId, f) {
      const c = caseOf(caseId); if (!c) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.UPLOAD, c.organizationId, caseId); if (g) return g;
      if (c.status === 'CANCELLED') return M.fail('CASE_CANCELLED');
      inc('source_assets_received_total');
      const insp = IN.inspectUpload(f);
      insp.securityEvents.forEach(e => secEvent(e, principal, caseId));
      let asset = IN.createSourceAsset({ ...f, organizationId, onboardingCaseId: caseId, uploadedBy: principal.id, at: clock(), inspection: insp });
      if (asset.status === 'REJECTED') { db.sources.set(asset.id, asset); auditOf('SOURCE_REJECTED', principal, asset.id, 'DENIED', { reasons: asset.rejectionReasons }); log('warn', 'source rejected at intake', { sourceAssetId: asset.id }); return M.fail('SOURCE_REJECTED', asset.rejectionReasons.join(', '), { sourceAssetId: asset.id }); }
      const dup = IN.findDuplicate([...db.sources.values()], asset);
      if (dup) return M.fail('SOURCE_DUPLICATE', null, { sourceAssetId: dup.id });
      if (f.supersedesId) {
        const old = db.sources.get(f.supersedesId); if (!old || old.onboardingCaseId !== caseId) return M.fail('NOT_FOUND', 'versão anterior');
        const s = IN.supersede(old, asset, clock()); if (!s.ok) return s; db.sources.set(old.id, s.value[0]); asset = s.value[1];
        for (const b of db.batches.values()) if (b.sourceAssetIds.includes(old.id) && !['PUBLISHED', 'SUPERSEDED', 'CANCELLED', 'ROLLED_BACK'].includes(b.status)) { const t = M.transition('batch', b, 'SUPERSEDED', { at: clock() }); if (t.ok) db.batches.set(b.id, freeze({ ...t.value, supersededReason: 'SOURCE_REPLACED' })); }
      }
      const bytes = IN.toBytes(f.bytes);
      if (!db.bytes.has(asset.checksum)) db.bytes.set(asset.checksum, bytes); // immutable object store
      asset = IN.applyScan(asset, scanner, bytes, clock());
      if (asset.status === 'REJECTED') secEvent('MALICIOUS_ARCHIVE_REJECTED', principal, asset.id);
      db.sources.set(asset.id, freeze({ ...asset, extracted: undefined }));
      if (f.extracted) db.parseCache.set('extracted:' + asset.id, f.extracted); else if (extractor && asset.status === 'VALIDATED' && ['KMZ', 'XLSX', 'DOCX'].includes(asset.sourceType)) { const ex = extractor(asset, bytes); if (ex) db.parseCache.set('extracted:' + asset.id, ex); }
      if (c.status === 'DRAFT') moveCase(c, 'SOURCE_INTAKE', principal.id);
      auditOf('SOURCE_UPLOADED', principal, asset.id, 'SUCCESS', { checksum: asset.checksum, purpose: asset.purpose });
      log('info', 'source registered', { sourceAssetId: asset.id, developmentDraftId: c.developmentDraftId });
      return asset.status === 'REJECTED' ? M.fail('SOURCE_REJECTED', asset.rejectionReasons.join(', '), { sourceAssetId: asset.id }) : M.ok(asset);
    }
    function declareAuthority(principal, caseId, { domain, sourceAssetId, authorityLevel }) {
      const c = caseOf(caseId); const g = guard(principal, PERM.MAP, c && c.organizationId, caseId); if (g) return g;
      const a = db.sources.get(sourceAssetId); if (!a || a.onboardingCaseId !== caseId) return M.fail('NOT_FOUND');
      const r = IN.declareAuthority({ domain, sourceAsset: a, authorityLevel, declaredBy: principal.id, at: clock() }); if (!r.ok) return r;
      db.authority = db.authority.filter(x => !(x.domain === domain && x.sourceAssetId === sourceAssetId)).concat(r.value).filter(x => !(authorityLevel === 'PRIMARY' && x.domain === domain && x.authorityLevel === 'PRIMARY' && x.sourceAssetId !== sourceAssetId));
      auditOf('SOURCE_AUTHORITY_DECLARED', principal, sourceAssetId, 'SUCCESS', { domain, authorityLevel }); return r;
    }
    const authorityMatrix = caseId => IN.authorityMatrix(db.authority.filter(d => (db.sources.get(d.sourceAssetId) || {}).onboardingCaseId === caseId), [...db.sources.values()].filter(s => s.onboardingCaseId === caseId));

    /** parse with version-keyed cache (§277–280) */
    function parseSource(asset) {
      const parser = PA.parserFor(asset), key = `${asset.checksum}|${parser ? parser.id + '@' + parser.version : 'none'}|${asset.id}`;
      if (db.parseCache.has(key)) return { result: db.parseCache.get(key), cached: true };
      const bytes = db.bytes.get(asset.checksum), extracted = db.parseCache.get('extracted:' + asset.id);
      const t0 = Date.now(), r = PA.parse(asset, { bytes, extracted }); inc('source_parse_duration_ms', Date.now() - t0);
      if (r && r.records) db.parseCache.set(key, r);
      return { result: r, cached: false };
    }
    function discover(principal, sourceAssetId) {
      const a = db.sources.get(sourceAssetId); if (!a) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.READ, a.organizationId, sourceAssetId); if (g) return g;
      const { result } = parseSource(a); if (!result.records) return result;
      const schema = PA.discoverSchema(result);
      return M.ok(freeze({ schema, suggestions: MP.suggest(schema), pii: MP.detectPii(result), warnings: result.warnings, requiresReview: result.requiresReview, metadata: result.metadata }));
    }
    function mappingSet(sourceAssetId) { if (!db.mappingSets.has(sourceAssetId)) db.mappingSets.set(sourceAssetId, MP.createMappingSet({ sourceAssetId, rules: [], at: clock() })); return db.mappingSets.get(sourceAssetId); }
    function updateMappings(principal, sourceAssetId, change, expectedRevision) {
      const a = db.sources.get(sourceAssetId); if (!a) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.MAP, a.organizationId, sourceAssetId); if (g) return g;
      const r = MP.updateMappingSet(mappingSet(sourceAssetId), change, { expectedRevision, by: principal.id, at: clock() });
      if (!r.ok) { if (r.code === 'MAPPING_REVISION_CONFLICT') inc('mapping_conflicts_total'); return r; }
      db.mappingSets.set(sourceAssetId, r.value);
      const c = caseOf(a.onboardingCaseId); if (c && ['SOURCE_INTAKE', 'PUBLISHED'].includes(c.status)) moveCase(c, 'MAPPING', principal.id);
      auditOf('MAPPING_UPDATED', principal, sourceAssetId, 'SUCCESS', { version: r.value.version, confirmed: (change.confirm || []).length + (change.upsert || []).filter(u => u.confidence === 'CONFIRMED').length });
      return r;
    }

    // ------------------------------------------------------------------ batches
    function createBatch(principal, caseId, { batchType = 'INITIAL', sourceAssetIds }) {
      const c = caseOf(caseId); if (!c) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.MAP, c.organizationId, caseId); if (g) return g;
      if (c.status === 'CANCELLED') return M.fail('CASE_CANCELLED');
      const assets = (sourceAssetIds || []).map(id => db.sources.get(id));
      if (assets.some(a => !a)) return M.fail('NOT_FOUND', 'fonte');
      const mappingVersion = assets.map(a => MP.mappingVersionOf(mappingSet(a.id))).join('+');
      const r = IN.createBatch([...db.batches.values()], { organizationId, onboardingCaseId: caseId, batchType, sourceAssets: assets, mappingVersion, createdBy: principal.id, at: clock() });
      if (!r.ok) return r;
      // §413–416: an open older batch of this case becomes obsolete
      for (const b of db.batches.values()) if (b.onboardingCaseId === caseId && !['PUBLISHED', 'SUPERSEDED', 'CANCELLED', 'ROLLED_BACK', 'FAILED'].includes(b.status)) {
        const s = IN.supersedeBatch(b, r.value, 'NEW_BATCH', clock()); if (s.ok) { db.batches.set(b.id, s.value.batch); db.supersessions.push(s.value.record); }
      }
      db.batches.set(r.value.id, r.value); setCase(freeze({ ...caseOf(caseId), currentBatchId: r.value.id }));
      inc('ingestion_batches_total'); auditOf('BATCH_CREATED', principal, r.value.id); log('info', 'batch created', { batchId: r.value.id, developmentDraftId: c.developmentDraftId });
      return r;
    }
    const moveBatch = (id, to) => { const b = db.batches.get(id); if (b.status === to) return b; const t = M.transition('batch', b, to, { at: clock() }); if (t.ok) db.batches.set(id, t.value); return db.batches.get(id); };

    /** OnboardingPipelinePlan (DAG §406–412) */
    function pipelinePlan(assets) {
      const stages = [];
      for (const a of assets) { stages.push({ id: `parse:${a.id}`, dependencies: [], executorId: 'parser', blocking: true }); stages.push({ id: `map:${a.id}`, dependencies: [`parse:${a.id}`], executorId: 'mapper+normalizer', blocking: true }); }
      const mapOf = p => assets.filter(a => a.purpose === p).map(a => `map:${a.id}`);
      stages.push({ id: 'canonical', dependencies: mapOf('LOT_MASTER'), executorId: 'canonical-lot', blocking: true });
      stages.push({ id: 'geometry', dependencies: ['canonical', ...mapOf('GEOMETRY')], executorId: 'geometry', blocking: true });
      stages.push({ id: 'pricing', dependencies: ['canonical', ...mapOf('PRICING')], executorId: 'pricing-candidates', blocking: false });
      stages.push({ id: 'availability', dependencies: ['canonical', ...mapOf('AVAILABILITY')], executorId: 'availability-candidates', blocking: false });
      stages.push({ id: 'documents', dependencies: assets.filter(a => ['REGULATION', 'LEGAL', 'MARKETING'].includes(a.purpose)).map(a => `parse:${a.id}`), executorId: 'documents', blocking: false });
      stages.push({ id: 'conflicts', dependencies: ['canonical', 'geometry', ...assets.map(a => `map:${a.id}`)], executorId: 'conflicts', blocking: true });
      stages.push({ id: 'quality', dependencies: ['conflicts', 'pricing', 'availability', 'documents'], executorId: 'quality-gate', blocking: true });
      stages.push({ id: 'artifacts', dependencies: ['quality'], executorId: 'artifact-builder', blocking: true });
      // topological order (stable)
      const done = new Set(), order = []; let guardN = 0;
      while (order.length < stages.length && guardN++ < 1000) for (const s of stages) if (!done.has(s.id) && s.dependencies.every(d => done.has(d))) { done.add(s.id); order.push(s); }
      return freeze({ stages: freeze(order.map(freeze)) });
    }

    /** runBatch(principal, batchId, { runMode, existingLots, currentPrices, currentAvailability, bounds, dev, lotCountExpected, requireGeometry, proposedPriceTableVersion, sourceSystem, initialAvailability }) */
    function runBatch(principal, batchId, opts = {}) {
      const b0 = db.batches.get(batchId); if (!b0) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.MAP, b0.organizationId, batchId); if (g) return g;
      if (['SUPERSEDED', 'CANCELLED', 'ROLLED_BACK'].includes(b0.status)) return M.fail('BATCH_OBSOLETE', b0.status, { batchId });
      const c = caseOf(b0.onboardingCaseId), runMode = opts.runMode || 'DRY_RUN', at = clock();
      const assets = b0.sourceAssetIds.map(id => db.sources.get(id)), plan = pipelinePlan(assets), stages = [], st = (stage, status, extra = {}) => stages.push(freeze({ stage, status, at: clock(), ...extra }));
      const ids = { batchId, developmentDraftId: c.developmentDraftId };
      if (b0.status !== 'INGESTING') moveBatch(batchId, 'INGESTING');
      if (c.status === 'SOURCE_INTAKE') moveCase(c, 'MAPPING', principal.id);
      st('UPLOAD', 'DONE'); st('SCAN', 'DONE');
      // ---- parse + map + normalize (per source)
      const perSource = new Map(), mappingValidation = [], normalizationIssues = [], piiFindings = [];
      for (const a of assets) {
        const pr = parseSource(a);
        if (!pr.result || !pr.result.records) { moveBatch(batchId, 'FAILED'); inc('ingestion_failures_total'); log('error', 'parse failed', { ...ids, sourceAssetId: a.id }); st('PARSE', 'FAILED'); db.runs.set(batchId, freeze({ stages: freeze(stages) })); return pr.result || M.fail('SOURCE_PARSE_FAILED', null, { batchId, sourceAssetId: a.id }); }
        const ps = pr.result, schema = PA.discoverSchema(ps), set = mappingSet(a.id), pii = MP.detectPii(ps);
        piiFindings.push(...pii.map(p => freeze({ ...p, sourceAssetId: a.id })));
        const v = MP.validateMappingSet(set, { purpose: ['LOT_MASTER', 'PRICING', 'AVAILABILITY', 'GEOMETRY'].includes(a.purpose) ? a.purpose : null, schema, piiFindings: pii, transforms });
        mappingValidation.push(freeze({ sourceAssetId: a.id, ...v }));
        inc('unmapped_field_count', v.unmappedFields.length);
        const mapped = MP.mapRecords(ps, set), norm = MP.normalizeRecords(mapped, { transforms, batchId, at, decimalHint: ps.metadata.decimalSeparatorHint });
        norm.forEach(r => r.issues.forEach(i => normalizationIssues.push(freeze({ recordRef: `${a.id}#${r.recordRef}`, ...i }))));
        perSource.set(a.id, { asset: a, parsed: ps, records: norm, cached: pr.cached });
      }
      st('PARSE', 'DONE'); st('SCHEMA_DISCOVERY', 'DONE'); st('MAP', 'DONE'); st('NORMALIZE', 'DONE');
      moveBatch(batchId, 'NORMALIZING');
      // ---- canonical lots
      const code = c.identity.code, master = assets.filter(a => a.purpose === 'LOT_MASTER');
      const masterRecords = master.flatMap(a => perSource.get(a.id).records);
      const built = CA.buildLotDrafts(masterRecords, { developmentDraftId: c.developmentDraftId, developmentCode: code });
      let drafts = built.drafts;
      const duplicates = CA.detectDuplicates(drafts);
      const identityMatches = CA.reconcile(built, opts.existingLots || []);
      st('CANONICALIZE', 'DONE');
      const knownIds = [...new Set(drafts.map(d => d.canonicalLotId))], byExt = new Map(drafts.filter(d => d.sourceExternalId != null).map(d => [String(d.sourceExternalId), d.canonicalLotId]));
      const lotIdOf = r => { const v = r.values; if (v['identity.id'] != null && knownIds.includes(v['identity.id'])) return v['identity.id']; if (v['identity.externalCode'] != null && byExt.has(String(v['identity.externalCode']))) return byExt.get(String(v['identity.externalCode']));
        const k = CA.canonicalLotId({ developmentCode: code, blockCode: v['identity.blockId'], lotNumber: v['identity.lotNumber'] }); return k.id || (v['identity.id'] != null ? String(v['identity.id']) : null); };
      // ---- geometry
      let geometry = null;
      const geoAuthority = db.authority.find(x => x.domain === 'GEOMETRY' && x.authorityLevel === 'PRIMARY' && b0.sourceAssetIds.includes(x.sourceAssetId));
      const geoSources = assets.filter(a => a.purpose === 'GEOMETRY');
      const geoAsset = (geoAuthority && db.sources.get(geoAuthority.sourceAssetId)) || geoSources[0] || (masterRecords.some(r => 'geometry.polygon' in r.values) ? master[0] : null);
      if (geoAsset) {
        const src = perSource.get(geoAsset.id), d = GE.describeSource(geoAsset, src.parsed, { authoritative: !!geoAuthority || geoAsset.purpose === 'LOT_MASTER' });
        if (!d.ok) geometry = { error: d };
        else {
          const features = GE.featuresFromRecords(src.records, d.value, lotIdOf);
          const issues = GE.validateFeatures(features, { bounds: opts.bounds || null });
          const match = GE.matchFeatures(features, drafts.map(x => ({ ...x })), { lotCrsRef: d.value.coordinateReference });
          const approvals = db.geometryApprovals.get(batchId) || new Map();
          const matches = match.matches.map(m => approvals.has(m.geometryFeatureId) ? approvals.get(m.geometryFeatureId) : m);
          const fById = new Map(features.map(f => [f.sourceFeatureId, f]));
          // published polygon = the authoritative feature linked to the lot (never re-projected)
          const polyByLot = new Map(matches.filter(m => m.approved).map(m => [m.lotId, fById.get(m.geometryFeatureId)]));
          drafts = drafts.map(dr => polyByLot.has(dr.canonicalLotId) ? freeze({ ...dr, polygon: polyByLot.get(dr.canonicalLotId).geometry.coordinates[0], geometryChecksum: polyByLot.get(dr.canonicalLotId).geometryChecksum, geometrySourceAssetId: geoAsset.id }) : dr);
          geometry = { descriptor: d.value, features, issues, match: freeze({ ...match, matches: freeze(matches) }), approvedExclusions: db.exclusions.get(batchId) || [], alignment: db.transforms.get(c.id) || null };
          inc('geometry_validation_failures_total', issues.filter(i => i.severity !== 'WARNING').length); inc('unmatched_geometry_count', match.unmatchedFeatures.length);
        }
      }
      st('GEOMETRY', 'DONE');
      // ---- commercial candidates (routed to their domains, never written here)
      let prices = null, priceDiff = null, availability = null, availabilityDiff = null, commands = [];
      const priceRecs = assets.filter(a => a.purpose === 'PRICING').flatMap(a => perSource.get(a.id).records);
      if (priceRecs.length) {
        prices = CO.priceCandidates(priceRecs, { lotIdOf, knownLotIds: knownIds.length ? knownIds : (opts.existingLots || []).map(l => l.id), currency: opts.currency || 'BRL', proposedPriceTableVersion: opts.proposedPriceTableVersion || null });
        priceDiff = CO.priceDiff(opts.currentPrices || {}, prices.candidates, knownIds);
        commands.push(CO.pricingCommand({ developmentId: c.developmentId || c.developmentDraftId, proposedPriceTableVersion: opts.proposedPriceTableVersion || null, candidates: prices.candidates, diff: priceDiff, batchId }));
      }
      const avRecs = assets.filter(a => a.purpose === 'AVAILABILITY').flatMap(a => perSource.get(a.id).records);
      if (avRecs.length) {
        const registry = CO.statusRegistry(db.statusMappings);
        availability = CO.availabilityCandidates(avRecs, { lotIdOf, knownLotIds: knownIds.length ? knownIds : (opts.existingLots || []).map(l => l.id), sourceSystem: opts.sourceSystem || 'source', registry });
        availabilityDiff = CO.availabilityDiff(opts.currentAvailability || {}, availability.candidates);
        commands.push(CO.availabilityCommand({ developmentId: c.developmentId || c.developmentDraftId, candidates: availability.candidates, initial: !!opts.initialAvailability, batchId }));
      }
      st('COMMERCIAL', 'DONE');
      // ---- documents: extracted facts stay derived + need review (§138–142)
      const documentExtractions = assets.filter(a => ['REGULATION', 'LEGAL'].includes(a.purpose)).map(a => { const ex = db.parseCache.get('extracted:' + a.id) || {}; return freeze({ documentVersionId: `docv:${a.id}`, extractorId: 'manual-or-adapter', extractorVersion: '1.0.0',
        extractedFacts: freeze((ex.facts || []).map(f => freeze({ fieldKey: f.fieldKey, value: f.value, location: f.location || null, sourceAssetId: a.id, state: 'NEEDS_CONFIRMATION', legalInterpretation: false }))), warnings: freeze(['extração não é interpretação jurídica']), generatedAt: at }); });
      // ---- conflicts across sources (§146–148)
      const obs = [];
      const purposeOf = id => db.sources.get(id).purpose;
      for (const d of drafts) obs.push({ entityType: 'lot', entityId: d.canonicalLotId, fieldKey: 'geometry.areaM2', value: d.areaSqm ?? null, sourceRef: d.sourceRecordRefs[0], sourcePurpose: 'LOT_MASTER' });
      for (const [sid, s] of perSource) if (s.asset.purpose !== 'LOT_MASTER') for (const r of s.records) if (r.values['geometry.areaM2'] != null) { const id = lotIdOf(r); if (id) obs.push({ entityType: 'lot', entityId: id, fieldKey: 'geometry.areaM2', value: r.values['geometry.areaM2'], sourceRef: `${sid}#${r.recordRef}`, sourcePurpose: purposeOf(sid) }); }
      const conflicts = Q.detectConflicts(obs, { at }).map(cf => db.conflicts.get(cf.id) || cf);
      conflicts.forEach(cf => { if (!db.conflicts.has(cf.id)) db.conflicts.set(cf.id, cf); });
      inc('data_conflict_count', conflicts.filter(x => x.status === 'OPEN').length);
      // resolved conflicts are applied as derived values with provenance to the selected source
      drafts = drafts.map(d => { const cf = conflicts.find(x => x.entityId === d.canonicalLotId && x.fieldKey === 'geometry.areaM2' && x.status === 'RESOLVED');
        return cf ? freeze({ ...d, areaSqm: cf.resolution.selectedValue, provenanceRefs: freeze({ ...d.provenanceRefs, 'geometry.areaM2': 'conflict:' + cf.id + '>' + cf.resolution.selectedSourceRef }) }) : d; });
      drafts = Q.applyCorrections(drafts, db.corrections);
      // ---- quality gate
      moveBatch(batchId, 'VALIDATING'); if (caseOf(c.id).status === 'MAPPING') moveCase(caseOf(c.id), 'VALIDATING', principal.id);
      const dataset = { drafts, unresolved: built.unresolved, duplicates, identityIssues: built.issues, identityMatches, geometry, requireGeometry: opts.requireGeometry !== false, prices, priceDiff, availability, conflicts,
        mappingValidation, normalizationIssues, piiFindings, lotCountExpected: opts.lotCountExpected ?? c.identity.lotCountExpected ?? null, documentExtractions };
      const quality = Q.evaluate(dataset, { exceptions: db.exceptions, at });
      inc('blocking_quality_issue_count', quality.summary.blockers);
      if (quality.summary.coveragePercent != null) metrics.provenance_coverage_percent = quality.summary.coveragePercent;
      st('VALIDATE', 'DONE'); st('QUALITY', 'DONE');
      const reviews = Q.reviewItemsFor(dataset, quality, { onboardingCaseId: c.id, batchId });
      for (const r of reviews) if (!db.reviews.has(r.id)) db.reviews.set(r.id, r);
      // ---- artifacts (version-keyed, deterministic, no timestamps in checksums)
      const blocks = CA.buildBlocks(drafts, code);
      const lotData = drafts.map(d => ({ id: d.canonicalLotId, block: d.blockCode, lot: d.lotNumber, area: d.areaSqm ?? null, attrs: Object.fromEntries(Object.entries(d.attributes).filter(([k]) => k !== 'geometry.polygon')) }));
      const lotDataVersion = 'lots-' + M.checksum(lotData).slice(7, 19);
      const art = geometry && geometry.descriptor ? GE.buildArtifacts({ drafts, dev: opts.dev || null, crsRef: geometry.descriptor.coordinateReference, sourceGeometryVersion: `${geoAsset.id}@${geoAsset.version}`, organizationId, developmentId: c.developmentId || c.developmentDraftId }) : null;
      st('BUILD_ARTIFACTS', 'DONE');
      const openReviews = [...db.reviews.values()].filter(r => r.batchId === batchId && r.status === 'OPEN');
      const ready = quality.gate.publishable && !openReviews.some(r => r.severity === 'CRITICAL' || r.severity === 'HIGH');
      moveBatch(batchId, ready ? 'READY' : 'REVIEW_REQUIRED');
      const cs = caseOf(c.id); if (cs.status === 'VALIDATING' || cs.status === 'REVIEW_REQUIRED' || cs.status === 'READY_TO_PUBLISH') moveCase(cs, ready ? 'READY_TO_PUBLISH' : 'REVIEW_REQUIRED', principal.id);
      st('REVIEW', ready ? 'DONE' : 'RUNNING');
      const run = freeze({ batchId, runMode, plan, stages: freeze(stages), dataset: freeze(dataset), quality, reviews: freeze(openReviews), commands: freeze(commands), blocks, lotDataVersion, lotData: freeze(lotData), artifacts: art,
        plainSummary: Q.plainSummary(dataset), cachedParses: [...perSource.values()].filter(s => s.cached).length, ready, checkpoints: freeze(['PARSED', 'MAPPED', 'NORMALIZED', 'VALIDATED', ...(art ? ['ARTIFACTS_BUILT'] : [])]) });
      db.runs.set(batchId, run);
      log('info', 'batch run finished', ids); auditOf('BATCH_RUN', principal, batchId, 'SUCCESS', { runMode, ready, blockers: quality.summary.blockers });
      if (runMode === 'DRY_RUN') return M.ok(run, { pointersTouched: false });
      if (!ready) return M.ok(run, { candidate: null });
      const cand = buildCandidate(principal, batchId, opts);
      if (!cand.ok) return M.ok(run, { candidate: null, candidateError: cand });
      if (runMode === 'PUBLISH') return M.ok(run, { candidate: cand.publication, note: 'PUBLISH exige aprovação + ativação explícitas (autoPublish = false)' });
      return M.ok(run, { candidate: cand.publication });
    }
    function buildCandidate(principal, batchId, opts = {}) {
      const b = db.batches.get(batchId), run = db.runs.get(batchId); if (!b || !run) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.MAP, b.organizationId, batchId); if (g) return g;
      const c = caseOf(b.onboardingCaseId), dataset = run.dataset;
      const cfg = PU.buildDevelopmentConfig({ identity: c.identity, templateRef: (P().developments[c.developmentId] || {}).templateRef || 'standard-lot-development@1.0.0', enabledCapabilities: opts.enabledCapabilities || {}, crs: dataset.geometry && dataset.geometry.descriptor ? dataset.geometry.descriptor.coordinateReference : 'UNKNOWN' });
      if (!cfg.ok) return cfg;
      const st = db.publications.get(c.id);
      const r = PU.buildCandidate(st, { batch: b, gate: run.quality.gate, runMode: opts.runMode || 'BUILD_CANDIDATE', by: principal.id, at: clock(),
        versions: { lotDataVersion: run.lotDataVersion, geometryVersion: run.artifacts ? 'geo-' + run.artifacts.bundleChecksum.slice(7, 19) : null, developmentConfigVersion: cfg.value.version,
          priceTableVersion: run.commands.find(x => x.domain === 'PRICING') ? (opts.proposedPriceTableVersion || null) : null, availabilityRevision: run.commands.find(x => x.domain === 'AVAILABILITY') ? 'avrev-' + run.commands.find(x => x.domain === 'AVAILABILITY').entriesChecksum.slice(7, 19) : null },
        artifactChecksums: { lotData: M.checksum(run.lotData), geometry: run.artifacts ? run.artifacts.bundleChecksum : null, mapLotIndex: run.artifacts ? run.artifacts.mapLotIndexChecksum : null, config: M.checksum(cfg.value) } });
      if (!r.ok) return r;
      db.publications.set(c.id, r.value); db.configs = db.configs || new Map(); db.configs.set(r.publication.id, cfg.value);
      auditOf('CANDIDATE_BUILT', principal, r.publication.id); return M.ok(r.publication, { publication: r.publication, idempotent: !!r.idempotent, config: cfg.value });
    }
    function decide(principal, caseId, publicationId, { approve, reason }) {
      const c = caseOf(caseId); const g = guard(principal, PERM.PUBLISH, c && c.organizationId, publicationId); if (g) return g;
      const r = PU.decideApproval(db.publications.get(caseId), publicationId, { approve, by: principal.id, at: clock(), reason }); if (!r.ok) { auditOf('PUBLICATION_APPROVAL', principal, publicationId, 'DENIED', { code: r.code }); return r; }
      db.publications.set(caseId, r.value); auditOf(approve ? 'PUBLICATION_APPROVED' : 'PUBLICATION_REJECTED', principal, publicationId); return M.ok(r.value.approvals.find(a => a.candidatePublicationId === publicationId));
    }
    function publish(principal, caseId, publicationId, { expectedPointerRevision, activator } = {}) {
      const c = caseOf(caseId); const g = guard(principal, PERM.PUBLISH, c && c.organizationId, publicationId); if (g) return g;
      if (c.status === 'CANCELLED') return M.fail('CASE_CANCELLED');
      const st = db.publications.get(caseId), pub = st.publications.find(p => p.id === publicationId); if (!pub) return M.fail('NOT_FOUND');
      const b = db.batches.get(pub.batchId);
      if (pub.status === 'CANDIDATE' && (!b || ['SUPERSEDED', 'CANCELLED', 'FAILED'].includes(b.status))) return M.fail('BATCH_OBSOLETE', b && b.status, { batchId: pub.batchId });
      const run = db.runs.get(pub.batchId);
      const wasReady = caseOf(caseId).status === 'READY_TO_PUBLISH'; if (wasReady) moveCase(caseOf(caseId), 'PUBLISHING', principal.id);
      const t0 = Date.now();
      const r = PU.activate({ ...st, lock: null }, publicationId, { by: principal.id, at: clock(), expectedPointerRevision, activator,
        currentBatchGeneration: Math.max(0, ...[...db.batches.values()].filter(x => x.onboardingCaseId === caseId && x.status !== 'SUPERSEDED').map(x => x.generation)),
        verifyChecksum: p => !run || p.artifactChecksums.lotData === M.checksum(run.lotData) });
      inc('publication_duration_ms', Date.now() - t0);
      if (!r.ok) { inc('publication_failures_total'); if (wasReady) moveCase(caseOf(caseId), r.code === 'DATA_QUALITY_BLOCKER' ? 'REVIEW_REQUIRED' : 'READY_TO_PUBLISH', principal.id); auditOf('PUBLISH', principal, publicationId, 'FAILED', { code: r.code }); log('warn', 'publish failed: previous publication stays active', { batchId: pub.batchId }); return r; }
      db.publications.set(caseId, r.value);
      if (!r.idempotent) { if (b && b.status === 'READY') moveBatch(b.id, 'PUBLISHED'); if (caseOf(caseId).status === 'PUBLISHING') moveCase(caseOf(caseId), 'PUBLISHED', principal.id); }
      auditOf('PUBLISH', principal, publicationId, 'SUCCESS', { idempotent: !!r.idempotent });
      const live = r.value.publications.find(p => p.id === publicationId);
      return M.ok(freeze({ publicationId: live.id, publicationNumber: live.publicationNumber, versionsActivated: freeze({ lot: live.lotDataVersion, geometry: live.geometryVersion, config: live.developmentConfigVersion, price: live.priceTableVersion || null, availability: live.availabilityRevision || null }),
        warnings: run ? run.quality.gate.warnings : [], rollbackTarget: r.rollbackTarget || null, pointerRevision: r.value.pointer.revision, idempotent: !!r.idempotent }));
    }
    function rollback(principal, caseId, { toPublicationId, reason, expectedPointerRevision }) {
      const c = caseOf(caseId); const g = guard(principal, PERM.ROLLBACK, c && c.organizationId, caseId); if (g) return g;
      const r = PU.rollback(db.publications.get(caseId), { toPublicationId, by: principal.id, at: clock(), reason, expectedPointerRevision });
      if (!r.ok) { auditOf('ROLLBACK', principal, caseId, 'FAILED', { code: r.code }); return r; }
      db.publications.set(caseId, r.value); auditOf('ROLLBACK', principal, toPublicationId, 'SUCCESS', { reason });
      return M.ok(freeze({ pointer: r.value.pointer, plan: r.plan, dynamicDomainsUntouched: r.dynamicDomainsUntouched }));
    }

    // ------------------------------------------------------------------ review actions
    function resolveConflict(principal, conflictId, body) {
      const cf = db.conflicts.get(conflictId); if (!cf) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.RESOLVE, organizationId, conflictId); if (g) return g;
      const r = Q.resolveConflict(cf, { ...body, resolvedBy: principal.id, at: clock() }); if (!r.ok) return r;
      db.conflicts.set(conflictId, r.value);
      for (const it of db.reviews.values()) if (it.category === 'DATA_CONFLICT' && it.entityRef === `${cf.entityId}:${cf.fieldKey}` && it.status === 'OPEN') db.reviews.set(it.id, Q.resolveReview(it, { resolution: body.reason, by: principal.id, at: clock() }).value);
      auditOf('DATA_CONFLICT_RESOLVED', principal, conflictId, 'SUCCESS', { selectedSourceRef: r.value.resolution.selectedSourceRef }); return r;
    }
    function resolveReview(principal, reviewId, body) {
      const it = db.reviews.get(reviewId); if (!it) return M.fail('NOT_FOUND');
      const perm = it.category === 'GEOMETRY_MATCH' || it.category === 'GEOMETRY_ALIGNMENT' ? PERM.GEOMETRY : PERM.RESOLVE;
      const g = guard(principal, perm, organizationId, reviewId); if (g) return g;
      const r = Q.resolveReview(it, { ...body, by: principal.id, at: clock() }); if (!r.ok) return r;
      db.reviews.set(reviewId, r.value); auditOf('REVIEW_RESOLVED', principal, reviewId, 'SUCCESS', { category: it.category, status: r.value.status }); return r;
    }
    function approveStatusMapping(principal, mapping) {
      const g = guard(principal, PERM.RESOLVE, organizationId, 'status-mapping'); if (g) return g;
      const r = CO.statusMapping({ ...mapping, approvedBy: principal.id, at: clock() }); if (!r.ok) return r;
      db.statusMappings.push(r.value); auditOf('STATUS_MAPPING_APPROVED', principal, `${mapping.sourceSystem}:${mapping.sourceValue}`, 'SUCCESS', { canonicalStatus: mapping.canonicalStatus });
      for (const it of db.reviews.values()) if (it.category === 'STATUS_MAPPING' && it.entityRef === `${mapping.sourceSystem}:${mapping.sourceValue}` && it.status === 'OPEN') db.reviews.set(it.id, Q.resolveReview(it, { resolution: `mapeado para ${mapping.canonicalStatus}`, by: principal.id, at: clock() }).value);
      return r;
    }
    function approveGeometryMatch(principal, batchId, geometryFeatureId) {
      const b = db.batches.get(batchId), run = db.runs.get(batchId); if (!b || !run || !run.dataset.geometry) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.GEOMETRY, b.organizationId, batchId); if (g) return g;
      const m = run.dataset.geometry.match.matches.find(x => x.geometryFeatureId === geometryFeatureId); if (!m) return M.fail('NOT_FOUND');
      const r = GE.approveMatch(m, principal.id, clock()); if (!r.ok) return r;
      if (!db.geometryApprovals.has(batchId)) db.geometryApprovals.set(batchId, new Map()); db.geometryApprovals.get(batchId).set(geometryFeatureId, r.value);
      auditOf('GEOMETRY_MANUAL_MATCH', principal, geometryFeatureId, 'SUCCESS', { lotId: m.lotId }); return r;
    }
    function approveExclusion(principal, batchId, geometryFeatureId, reason) {
      const b = db.batches.get(batchId); const g = guard(principal, PERM.GEOMETRY, b && b.organizationId, batchId); if (g) return g;
      if (!reason) return M.fail('VALIDATION_ERROR', 'motivo obrigatório');
      db.exclusions.set(batchId, [...(db.exclusions.get(batchId) || []), geometryFeatureId]); auditOf('GEOMETRY_EXCLUSION_APPROVED', principal, geometryFeatureId, 'SUCCESS', { reason }); return M.ok(true);
    }
    function approveAlignment(principal, caseId, transform, note) {
      const c = caseOf(caseId); const g = guard(principal, PERM.GEOMETRY, c && c.organizationId, caseId); if (g) return g;
      const r = GE.approveTransform(transform, principal.id, clock(), note); if (!r.ok) return r;
      db.transforms.set(caseId, r.value); auditOf('GEOMETRY_ALIGNMENT_APPROVED', principal, r.value.id, 'SUCCESS', { rms: r.value.anchorResidualRms }); return r;
    }
    function addQualityException(principal, batchId, checkCode, { entityRef, reason, expiresAt }) {
      const run = db.runs.get(batchId); if (!run) return M.fail('NOT_FOUND');
      const g = guard(principal, PERM.RESOLVE, organizationId, batchId); if (g) return g;
      const check = run.quality.checks.find(x => x.code === checkCode); if (!check) return M.fail('NOT_FOUND');
      const r = Q.createException({ check, entityRef, reason, acceptedBy: principal.id, at: clock(), expiresAt }); if (!r.ok) return r;
      db.exceptions.push(r.value); auditOf('QUALITY_EXCEPTION_APPROVED', principal, checkCode, 'SUCCESS'); return r;
    }
    function addCorrection(principal, rule) {
      const g = guard(principal, PERM.RESOLVE, organizationId, 'correction'); if (g) return g;
      const r = Q.correction({ ...rule, approvedBy: principal.id, at: clock() }); if (!r.ok) return r;
      db.corrections.push(r.value); auditOf('DATA_CORRECTION_APPROVED', principal, r.value.id, 'SUCCESS', { scope: rule.scope, fieldKey: rule.fieldKey }); return r;
    }
    function classifyRemoval(principal, batchId, lotId, classification) {
      const g = guard(principal, PERM.RESOLVE, organizationId, batchId); if (g) return g;
      const r = PU.classifyRemoval(lotId, classification, principal.id, clock()); if (r.ok) { db.removals.set(`${batchId}|${lotId}`, r.value); auditOf('LOT_REMOVAL_CLASSIFIED', principal, lotId, 'SUCCESS', { classification }); } return r;
    }

    // ------------------------------------------------------------------ connectors + webhooks (§297–306)
    function registerConnector(principal, { id, provider, sourceDomains, authRef, pollingPolicy, webhookSupport }) {
      const g = guard(principal, PERM.CREATE, organizationId, 'connector'); if (g) return g;
      if (!/^secretref:\/\/[a-z0-9._/-]+$/i.test(String(authRef || ''))) return M.fail('VALIDATION_ERROR', 'authRef deve ser referência a um segredo do servidor (secretref://…), nunca o segredo');
      const cn = freeze({ id, provider, sourceDomains: freeze([...(sourceDomains || [])]), authRef, pollingPolicy: pollingPolicy || undefined, webhookSupport: !!webhookSupport });
      db.connectors.set(id, cn); return M.ok(cn);
    }
    /** ingestWebhook(principal, caseId, { connectorId, deliveryId, payload, signatureVerified }) → new INCREMENTAL batch (never published) */
    function ingestWebhook(principal, caseId, { connectorId, deliveryId, payload, signatureVerified, purpose = 'AVAILABILITY' }) {
      const cn = db.connectors.get(connectorId); if (!cn) return M.fail('NOT_FOUND', 'connector');
      if (!signatureVerified) return M.fail('PERMISSION_DENIED', 'assinatura do webhook não verificada');
      if (!deliveryId || db.deliveries.has(connectorId + '|' + deliveryId)) return M.fail('BATCH_DUPLICATE', 'entrega repetida (proteção contra replay)');
      const up = uploadSource(principal, caseId, { sourceType: 'API', purpose, filename: `${connectorId}.json`, bytes: JSON.stringify(payload), metadata: { connectorId, cursor: payload && payload.cursor, receivedVia: 'webhook' } });
      if (!up.ok) return up;
      db.deliveries.add(connectorId + '|' + deliveryId);
      db.syncStates.set(connectorId, PU.syncState(db.syncStates.get(connectorId), { connectorId, ok: true, at: clock(), cursor: payload && payload.cursor }));
      return M.ok(up.value, { autoPublished: false });
    }
    function recordSyncFailure(connectorId) { db.syncStates.set(connectorId, PU.syncState(db.syncStates.get(connectorId), { connectorId, ok: false, at: clock() })); return db.syncStates.get(connectorId); }

    // ------------------------------------------------------------------ reads
    const readGuard = (principal, ref) => guard(principal, PERM.READ, organizationId, ref);
    return freeze({
      PERM, organizationId, pipelinePlan,
      createCase, cancelCase, uploadSource, declareAuthority, discover, updateMappings, createBatch, runBatch, buildCandidate, decide, publish, rollback,
      resolveConflict, resolveReview, approveStatusMapping, approveGeometryMatch, approveExclusion, approveAlignment, addQualityException, addCorrection, classifyRemoval,
      registerConnector, ingestWebhook, recordSyncFailure,
      getCase: (p, id) => readGuard(p, id) || M.ok(caseOf(id)),
      listSources: (p, caseId) => readGuard(p, caseId) || M.ok([...db.sources.values()].filter(s => s.onboardingCaseId === caseId)),
      getBatch: (p, id) => readGuard(p, id) || M.ok(db.batches.get(id) || null),
      getRun: (p, id) => readGuard(p, id) || M.ok(db.runs.get(id) || null),
      progress: (p, id) => readGuard(p, id) || M.ok(M.pipelineProgress(id, (db.runs.get(id) || { stages: [] }).stages)),
      mappingSet: (p, sourceAssetId) => readGuard(p, sourceAssetId) || M.ok(mappingSet(sourceAssetId)),
      reviewQueue: (p, caseId) => readGuard(p, caseId) || M.ok([...db.reviews.values()].filter(r => r.onboardingCaseId === caseId)),
      conflicts: (p) => readGuard(p, 'conflicts') || M.ok([...db.conflicts.values()]),
      publicationState: (p, caseId) => readGuard(p, caseId) || M.ok(db.publications.get(caseId)),
      authorityMatrix: (p, caseId) => readGuard(p, caseId) || M.ok(authorityMatrix(caseId)),
      syncState: connectorId => db.syncStates.get(connectorId) || null,
      metrics: () => freeze({ ...metrics }), logs: () => freeze([...logs]), audit: () => freeze([...audit]), securityEvents: () => freeze([...securityEvents]),
      supersessions: () => freeze([...db.supersessions]), removals: () => freeze([...db.removals.values()]), config: pubId => (db.configs && db.configs.get(pubId)) || null
    });
  }

  return freeze({ PERM, createWorkspace, grantListAuthorizer });
})();
