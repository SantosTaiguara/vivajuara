/* onboarding/publication.js — topic 58 §171–236, §307–311, §401–436, §478–513: config, readiness, publication, rollback, diffs.
   - DevelopmentConfig / DevelopmentCapabilityManifest / DevelopmentLayerConfig from a versioned TEMPLATE (configuration, never data §292–296).
   - DevelopmentReadiness + FeatureReadiness: capability-based publish (core can be ready while commercial is not, §396–399).
   - DevelopmentPublication = immutable version vector + checksum (no timestamps in the checksum, §371). Candidate first,
     approval (separation of duties: null policy → strictest reading), atomic pointer activation behind a mutex with an
     expected pointer revision (multi-tab safety §423), idempotent publish, failure keeps the previous pointer (§206, §387).
   - Rollback is domain-specific (§207–214): pointer switch for lot/geometry/config/analysis; pricing follows its own
     pointer policy; live availability is NEVER rolled back blindly (§208).
   - IngestionDiff / FieldChange severity / removal classification (removed lots never silently deleted §219–220),
     RecomputePlan from the FieldRegistry dependency graph (§230–236), PublicationDiff, SourceReconciliationResult (no writes),
     onboarding report (immutable) and operational handoff.
   Pure: state in, new state out. Depends on App.model, App.onboarding.model, App.onboardingPolicy. */
App.onboarding = App.onboarding || {};
App.onboarding.publication = (() => {
  const M = App.onboarding.model, P = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);

  // ------------------------------------------------------------------ config + capabilities (§171–179)
  function buildDevelopmentConfig({ identity, templateRef, enabledCapabilities = {}, crs }) {
    const tpl = P().templates[templateRef];
    if (!tpl) return M.fail('POLICY_NOT_CONFIGURED', `template ${templateRef} não existe`);
    const supportedFields = App.model.FIELDS.filter(f => !f.virtual).map(f => f.key);
    const capabilities = tpl.capabilities.map(code => freeze({ code, enabled: enabledCapabilities[code] === true, reason: enabledCapabilities[code] === true ? undefined : 'não declarado pronto para este empreendimento' }));
    const capOn = c => capabilities.some(x => x.code === c && x.enabled);
    const layerReq = { availability: ['AVAILABILITY'], price: ['PRICING'], area: [], class: ['ANALYSIS'] };
    const layers = tpl.layers.map(id => freeze({ layerId: id, fieldKey: { availability: 'availability.status', price: 'commercial.price', area: 'geometry.areaM2', class: 'intelligence.class' }[id], enabled: (layerReq[id] || []).every(capOn),
      defaultVisible: id === 'area', requiredCapabilities: freeze(layerReq[id] || []) }));
    const filters = App.model.getFilterableFields().map(f => f.key);
    const config = freeze({ identity: freeze({ ...identity }), timezone: identity.timezone, templateRef, map: freeze({ coordinateReference: crs || 'UNKNOWN', listOnlyModeSupported: !!tpl.listOnlyModeSupported }),
      supportedFields: freeze(supportedFields), layers: freeze(layers), filters: freeze(filters), documentCategories: freeze([...tpl.documentCategories]), capabilities: freeze(capabilities) });
    return M.ok(freeze({ ...config, version: 'cfg-' + M.checksum(config).slice(7, 19) }));
  }
  const capabilityManifest = (developmentId, config) => freeze({ developmentId, capabilities: config.capabilities });

  // ------------------------------------------------------------------ readiness (§187–191, §392–399)
  function readiness({ hasDevelopment, blocks, lots, geometryLinked, mapLotIndex, prices, availability, paymentPlans, analysisVersion, documents, gate, commercialRequired = false, analyticsRequired = false }) {
    const blockers = [], warnings = [];
    const core = hasDevelopment && blocks > 0 && lots > 0 && geometryLinked === lots && mapLotIndex && gate && gate.publishable ? 'READY' : 'NOT_READY';
    if (!hasDevelopment) blockers.push('DEVELOPMENT'); if (!(blocks > 0)) blockers.push('BLOCKS'); if (!(lots > 0)) blockers.push('LOTS'); if (geometryLinked !== lots) blockers.push('GEOMETRY'); if (!mapLotIndex) blockers.push('MAP_LOT_INDEX');
    if (gate && !gate.publishable) blockers.push(...gate.blockers.map(b => 'DQ:' + b), ...(gate.errorsBlockPublish ? gate.errors.map(e => 'DQ:' + e) : []));
    const commercial = prices && availability && paymentPlans ? 'READY' : prices || availability || paymentPlans ? 'PARTIAL' : 'NOT_READY';
    if (commercial !== 'READY') (commercialRequired ? blockers : warnings).push(`COMMERCIAL_${commercial}`);
    const analytics = analysisVersion ? 'READY' : 'NOT_READY'; if (analytics !== 'READY') (analyticsRequired ? blockers : warnings).push('ANALYTICS_NOT_READY');
    const docs = documents > 0 ? 'READY' : 'NOT_READY'; if (docs !== 'READY') warnings.push('DOCUMENTS_NOT_READY');
    if (gate) warnings.push(...gate.warnings.map(w => 'DQ:' + w));
    return freeze({ core, commercial, analytics, documents: docs, blockers: freeze([...new Set(blockers)]), warnings: freeze([...new Set(warnings)]) });
  }
  /** FeatureReadiness per capability: a feature goes live only when READY; no dead controls (§399–400) */
  const featureReadiness = (r, config) => freeze(config.capabilities.map(c => freeze({ featureCode: c.code,
    status: !c.enabled ? 'NOT_READY' : ['PRICING', 'AVAILABILITY', 'PAYMENT_PLANS'].includes(c.code) ? r.commercial : ['ANALYSIS', 'SOLAR_ANALYSIS'].includes(c.code) ? r.analytics : r.core, blockers: freeze(c.enabled ? [] : ['CAPABILITY_DISABLED']), warnings: freeze([]) })));

  // ------------------------------------------------------------------ publications (§198–206, §239–241, §420–423)
  const emptyState = developmentId => freeze({ developmentId, publications: freeze([]), pointer: freeze({ publicationId: null, revision: 0 }), lock: null, approvals: freeze([]), history: freeze([]) });
  const findPub = (s, id) => s.publications.find(p => p.id === id) || null;
  const replacePub = (s, pub) => freeze({ ...s, publications: freeze(s.publications.map(p => p.id === pub.id ? pub : p)) });
  /** buildCandidate(state, { batch, gate, versions, artifactsChecksums, runMode, by }) — immutable candidate; refuses obsolete batches and silent blockers */
  function buildCandidate(state, { batch, gate, versions, artifactChecksums = {}, runMode = 'BUILD_CANDIDATE', by, at }) {
    if (runMode === 'DRY_RUN') return M.fail('VALIDATION_ERROR', 'DRY_RUN não cria candidato (§328)');
    if (!batch || ['SUPERSEDED', 'CANCELLED', 'FAILED', 'ROLLED_BACK'].includes(batch.status)) return M.fail('BATCH_OBSOLETE', batch && batch.status, { batchId: batch && batch.id });
    if (batch.status !== 'READY') return M.fail('PUBLICATION_VALIDATION_FAILED', `lote em ${batch.status}`, { batchId: batch.id });
    if (!gate || !gate.publishable) return M.fail('DATA_QUALITY_BLOCKER', (gate && gate.blockers.join(', ')) || 'sem avaliação de qualidade', { batchId: batch.id });
    for (const k of ['lotDataVersion', 'geometryVersion', 'developmentConfigVersion']) if (!versions[k]) return M.fail('PUBLICATION_VALIDATION_FAILED', `${k} ausente`, { batchId: batch.id });
    const vector = { lotDataVersion: versions.lotDataVersion, geometryVersion: versions.geometryVersion, priceTableVersion: versions.priceTableVersion || undefined, availabilityRevision: versions.availabilityRevision || undefined,
      analysisVersion: versions.analysisVersion || undefined, developmentConfigVersion: versions.developmentConfigVersion, documentSetVersion: versions.documentSetVersion || undefined };
    const checksum = M.checksum({ vector, artifacts: artifactChecksums });
    const existing = state.publications.find(p => p.checksum === checksum && p.status !== 'REJECTED');
    if (existing) return M.ok(state, { publication: existing, idempotent: true });
    const number = state.publications.length + 1;
    const pub = freeze({ id: M.id('pub', state.developmentId, number, checksum), developmentId: state.developmentId, publicationNumber: number, status: 'CANDIDATE', ...vector,
      artifactChecksums: freeze({ ...artifactChecksums }), batchId: batch.id, batchGeneration: batch.generation, candidateBy: by, candidateAt: at, publishedBy: null, publishedAt: null, checksum, revision: '1', statusHistory: freeze([]) });
    const approval = freeze({ candidatePublicationId: pub.id, status: 'PENDING', requestedBy: by, requestedAt: at, approvedBy: undefined, approvedAt: undefined, reason: undefined, revision: '1' });
    return M.ok(freeze({ ...state, publications: freeze([...state.publications, pub]), approvals: freeze([...state.approvals, approval]) }), { publication: pub });
  }
  function decideApproval(state, publicationId, { approve, by, at, reason }) {
    const a = state.approvals.find(x => x.candidatePublicationId === publicationId);
    if (!a) return M.fail('NOT_FOUND');
    const sod = P().approval.separationOfDuties; // null → strictest: approver must differ from requester
    if (approve && (sod == null || sod === true) && by === a.requestedBy) return M.fail('PUBLICATION_SEPARATION_OF_DUTIES', P().approval.separationOfDutiesStatus);
    if (!by) return M.fail('VALIDATION_ERROR', 'aprovador obrigatório');
    const t = M.transition('approval', a, approve ? 'APPROVED' : 'REJECTED', { at, by }); if (!t.ok) return t;
    const next = freeze({ ...t.value, approvedBy: approve ? by : undefined, approvedAt: approve ? at : undefined, reason: reason || undefined, decidedBy: by });
    let s = freeze({ ...state, approvals: freeze(state.approvals.map(x => x === a ? next : x)) });
    if (!approve) { const pub = findPub(s, publicationId); const tp = M.transition('publication', pub, 'REJECTED', { at, by }); if (tp.ok) s = replacePub(s, tp.value); }
    return M.ok(s);
  }
  /** activate(state, publicationId, { by, at, expectedPointerRevision, currentBatchGeneration, verify, activator }) — atomic at pointer level */
  function activate(state, publicationId, { by, at, expectedPointerRevision, currentBatchGeneration, verifyChecksum, activator } = {}) {
    const pub = findPub(state, publicationId); if (!pub) return M.fail('NOT_FOUND');
    if (pub.status === 'PUBLISHED' && state.pointer.publicationId === pub.id) return M.ok(state, { idempotent: true, publication: pub }); // idempotent publish §422
    if (state.lock) return M.fail('PUBLICATION_CONFLICT', 'outra ativação em andamento (PublicationMutex)');
    if (expectedPointerRevision == null || expectedPointerRevision !== state.pointer.revision) return M.fail('PUBLICATION_CONFLICT', `ponteiro mudou (esperado ${expectedPointerRevision}, atual ${state.pointer.revision})`);
    if (currentBatchGeneration != null && pub.batchGeneration < currentBatchGeneration && pub.status === 'CANDIDATE') return M.fail('BATCH_OBSOLETE', 'candidato de lote obsoleto', { batchId: pub.batchId });
    if (P().approval.requiredForPublish && pub.status === 'CANDIDATE') { const a = state.approvals.find(x => x.candidatePublicationId === pub.id); if (!a || a.status !== 'APPROVED') return M.fail('PUBLICATION_APPROVAL_REQUIRED'); }
    if (typeof verifyChecksum === 'function' && !verifyChecksum(pub)) return M.fail('PUBLICATION_VALIDATION_FAILED', 'checksum de artefato não confere');
    if (!['CANDIDATE', 'SUPERSEDED', 'ROLLED_BACK'].includes(pub.status)) return M.fail('INVALID_TRANSITION', pub.status);
    try { if (typeof activator === 'function') activator(pub); } // staging/activation hook; any failure leaves the old pointer untouched
    catch (e) { return M.fail('PUBLICATION_CONFLICT', 'falha na ativação: publicação anterior continua ativa', { publicationId: pub.id }); }
    let s = state;
    const prev = state.pointer.publicationId && findPub(state, state.pointer.publicationId);
    if (prev && prev.status === 'PUBLISHED') s = replacePub(s, freeze({ ...prev, status: 'SUPERSEDED' }));
    const t = M.transition('publication', pub, 'PUBLISHED', { at, by }); if (!t.ok) return t;
    const live = freeze({ ...t.value, publishedBy: pub.publishedBy || by, publishedAt: pub.publishedAt || at });
    s = replacePub(s, live);
    s = freeze({ ...s, pointer: freeze({ publicationId: live.id, revision: state.pointer.revision + 1 }), history: freeze([...state.history, freeze({ action: 'ACTIVATE', publicationId: live.id, previous: prev ? prev.id : null, by, at })]) });
    return M.ok(s, { publication: live, rollbackTarget: prev ? prev.id : null });
  }
  /** rollbackPlan(publication) — per-domain semantics (§214) */
  const rollbackPlan = pub => freeze({ publicationId: pub.id, domains: freeze([
    freeze({ domain: 'LOT_DATA', rollbackMode: 'POINTER_SWITCH' }), freeze({ domain: 'GEOMETRY', rollbackMode: 'POINTER_SWITCH' }), freeze({ domain: 'DEVELOPMENT_CONFIG', rollbackMode: 'POINTER_SWITCH' }),
    freeze({ domain: 'ANALYSIS', rollbackMode: pub.analysisVersion ? 'POINTER_SWITCH' : 'NO_AUTOMATIC_ROLLBACK' }),
    freeze({ domain: 'PRICING', rollbackMode: pub.priceTableVersion ? 'MANUAL_RECONCILIATION' : 'NO_AUTOMATIC_ROLLBACK', note: 'ponteiro da tabela segue a política do domínio Pricing' }),
    freeze({ domain: 'AVAILABILITY', rollbackMode: 'NO_AUTOMATIC_ROLLBACK', note: 'disponibilidade viva nunca volta junto com a publicação (§208)' }),
    freeze({ domain: 'DOCUMENTS', rollbackMode: 'POINTER_SWITCH', note: 'versões antigas preservadas' })]) });
  /** rollback(state, { toPublicationId, by, at, reason, expectedPointerRevision }) — pointer back to a prior valid publication */
  function rollback(state, { toPublicationId, by, at, reason, expectedPointerRevision }) {
    if (!reason || !by) return M.fail('VALIDATION_ERROR', 'rollback exige motivo e autor');
    const cur = state.pointer.publicationId && findPub(state, state.pointer.publicationId), target = findPub(state, toPublicationId);
    if (!cur || !target || target.id === cur.id) return M.fail('NOT_FOUND', 'publicação alvo inválida');
    if (!['SUPERSEDED', 'ROLLED_BACK'].includes(target.status)) return M.fail('INVALID_TRANSITION', 'alvo precisa ter sido publicado antes');
    if (expectedPointerRevision !== state.pointer.revision) return M.fail('PUBLICATION_CONFLICT');
    if (state.lock) return M.fail('PUBLICATION_CONFLICT');
    let s = replacePub(state, freeze({ ...cur, status: 'ROLLED_BACK', rolledBackAt: at, rolledBackBy: by, rollbackReason: reason }));
    s = replacePub(s, freeze({ ...target, status: 'PUBLISHED' }));
    s = freeze({ ...s, pointer: freeze({ publicationId: target.id, revision: state.pointer.revision + 1 }), history: freeze([...state.history, freeze({ action: 'ROLLBACK', publicationId: target.id, previous: cur.id, by, at, reason })]) });
    return M.ok(s, { plan: rollbackPlan(cur), dynamicDomainsUntouched: ['AVAILABILITY'] });
  }
  const publicationHistory = s => freeze(s.publications.map(p => freeze({ id: p.id, number: p.publicationNumber, status: p.status, active: s.pointer.publicationId === p.id, publishedAt: p.publishedAt, checksum: p.checksum })));

  // ------------------------------------------------------------------ diffs (§217–225, §435–436)
  const CRITICAL_FIELDS = new Set(['identity.blockId', 'identity.lotNumber', 'identity.id']);
  /** ingestionDiff({ batchId, baseline: Map(lotId → { areaSqm, attributes, geometryChecksum, sourceRef }), drafts, geometryChecksums: Map, priceDiff, availabilityDiff }) */
  function ingestionDiff({ batchId, baseline, drafts, geometryChecksums = new Map(), priceDiff, availabilityDiff, documents }) {
    const incoming = new Map(drafts.map(d => [d.canonicalLotId, d])), added = [], changed = [], removed = [], fieldChanges = [], fields = {};
    const fc = (entityId, fieldKey, before, after, severity, sb, sa) => { fieldChanges.push(freeze({ entityId, fieldKey, before, after, sourceBefore: sb, sourceAfter: sa, severity })); fields[fieldKey] = (fields[fieldKey] || 0) + 1; };
    for (const [id, d] of incoming) {
      const b = baseline.get(id); if (!b) { added.push(id); continue; }
      let ch = false;
      if (b.areaSqm !== d.areaSqm) { fc(id, 'geometry.areaM2', b.areaSqm, d.areaSqm, 'HIGH', b.sourceRef, d.sourceRecordRefs[0]); ch = true; } // "material" threshold not configured → HIGH (review)
      for (const k of new Set([...Object.keys(b.attributes || {}), ...Object.keys(d.attributes || {})])) {
        if (k === 'geometry.polygon') continue;
        const x = (b.attributes || {})[k], y = (d.attributes || {})[k];
        if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) { fc(id, k, x ?? null, y ?? null, CRITICAL_FIELDS.has(k) ? 'CRITICAL' : 'MEDIUM', b.sourceRef, d.sourceRecordRefs[0]); ch = true; }
      }
      if (ch) changed.push(id);
    }
    for (const id of baseline.keys()) if (!incoming.has(id)) { removed.push(id); fc(id, 'lot', 'PRESENT', 'REMOVED', 'CRITICAL'); }
    const geomChanged = [...geometryChecksums].filter(([id, c]) => baseline.has(id) && baseline.get(id).geometryChecksum && baseline.get(id).geometryChecksum !== c).map(([id]) => id);
    geomChanged.forEach(id => fc(id, 'geometry.polygon', baseline.get(id).geometryChecksum, geometryChecksums.get(id), 'HIGH'));
    const sev = fieldChanges.some(f => f.severity === 'CRITICAL') ? 'CRITICAL' : fieldChanges.some(f => f.severity === 'HIGH') ? 'HIGH' : fieldChanges.length ? 'MEDIUM' : 'LOW';
    return freeze({ batchId, lots: freeze({ added: freeze(added.sort()), changed: freeze(changed.sort()), removed: freeze(removed.sort()) }), geometry: freeze({ changed: freeze(geomChanged.sort()), unmatched: freeze([]) }),
      fields: freeze(fields), pricing: priceDiff || undefined, availability: availabilityDiff || undefined, documents: documents || undefined, fieldChanges: freeze(fieldChanges), severity: sev, requiresReview: sev === 'HIGH' || sev === 'CRITICAL' });
  }
  /** classifyRemoval(lotId, classification, by) — a removed lot needs an explicit class before publish (§219–220) */
  const classifyRemoval = (lotId, classification, by, at) => !M.RemovalClass[classification] ? M.fail('VALIDATION_ERROR', 'classificação inválida') : !by ? M.fail('VALIDATION_ERROR', 'autor obrigatório')
    : M.ok(freeze({ lotId, classification, classifiedBy: by, classifiedAt: at, lineage: classification === 'RETIRED' ? 'RETIRED' : classification === 'MERGED' ? 'MERGED' : null }));
  /** UpdateClassificationPolicy (§478–482): structural → onboarding pipeline; operational → domain services */
  function classifyUpdate(diff) {
    const cats = new Set();
    if (diff.lots.added.length || diff.lots.removed.length || Object.keys(diff.fields).some(k => k !== 'geometry.polygon')) cats.add('LOT_MASTER_UPDATE');
    if (diff.geometry.changed.length) cats.add('GEOMETRY_UPDATE');
    if (diff.pricing && (diff.pricing.changedPrices.length || diff.pricing.addedLotIds.length)) cats.add('PRICING_UPDATE');
    if (diff.availability && diff.availability.changed.length) cats.add('AVAILABILITY_UPDATE');
    const structural = [...cats].some(c => c === 'LOT_MASTER_UPDATE' || c === 'GEOMETRY_UPDATE');
    return freeze({ categories: freeze([...cats]), kind: structural ? 'STRUCTURAL' : cats.size ? 'OPERATIONAL' : 'NONE',
      routing: freeze([...cats].map(c => ({ category: c, owner: { LOT_MASTER_UPDATE: 'Development/Lot', GEOMETRY_UPDATE: 'Geometry', PRICING_UPDATE: 'Pricing', AVAILABILITY_UPDATE: 'Availability' }[c] }))) });
  }
  /** RecomputePlan from the FieldRegistry dependency graph (§230–236): only affected lots/modules, correctness first */
  function recomputePlan(diff) {
    const rev = new Map(); for (const f of App.model.FIELDS) for (const d of f.dependsOn || []) rev.set(d, [...(rev.get(d) || []), f.key]);
    const affectedFields = new Set(), queue = Object.keys(diff.fields).filter(k => k !== 'lot');
    while (queue.length) { const k = queue.shift(); if (affectedFields.has(k)) continue; affectedFields.add(k); (rev.get(k) || []).forEach(x => queue.push(x)); }
    const scoreInput = [...affectedFields].some(k => { const f = App.model.field(k); return f && (f.scoreInput || f.alertInput || k.startsWith('intelligence.')); });
    const affectedLotIds = [...new Set(diff.fieldChanges.map(f => f.entityId))].sort();
    const downstream = new Set();
    if (diff.geometry.changed.length || affectedFields.has('geometry.polygon')) downstream.add('GeometryBundle').add('SpatialIndex');
    if (diff.lots.added.length || diff.lots.removed.length) downstream.add('MapLotIndex').add('GeometryBundle');
    if (affectedFields.has('commercial.price')) downstream.add('PriceTableVersion (derivado: área × R$/m²)');
    return freeze({ affectedLotIds: freeze(affectedLotIds), analysisModules: freeze(scoreInput ? ['intelligence.engine', 'scores', 'recommendation', 'alerts'] : []), downstreamArtifacts: freeze([...downstream]),
      affectedFields: freeze([...affectedFields].sort()), reasonRefs: freeze(diff.fieldChanges.slice(0, 50).map(f => `${f.entityId}:${f.fieldKey}`)), fullRecompute: false });
  }
  function publicationDiff(a, b, { lotChanges = 0, geometryChanges = 0, configChanges = 0 } = {}) {
    return freeze({ fromPublicationId: a.id, toPublicationId: b.id, lotChanges, geometryChanges, configChanges: configChanges || (a.developmentConfigVersion !== b.developmentConfigVersion ? 1 : 0),
      priceVersionChanged: a.priceTableVersion !== b.priceTableVersion, analysisVersionChanged: a.analysisVersion !== b.analysisVersion, lotDataVersionChanged: a.lotDataVersion !== b.lotDataVersion,
      geometryVersionChanged: a.geometryVersion !== b.geometryVersion, detailsRef: `pubdiff:${a.id}..${b.id}` });
  }
  /** SourceReconciliationResult (§307–311) — reports only, never writes */
  function reconcileSource(domain, sourceMap, localMap) {
    const s = new Map(Object.entries(sourceMap)), l = new Map(Object.entries(localMap));
    const missingLocal = [...s.keys()].filter(k => !l.has(k)).sort(), missingSource = [...l.keys()].filter(k => !s.has(k)).sort(), changed = [...s.keys()].filter(k => l.has(k) && JSON.stringify(s.get(k)) !== JSON.stringify(l.get(k))).sort();
    return freeze({ domain, missingLocal: freeze(missingLocal), missingSource: freeze(missingSource), changed: freeze(changed), status: missingLocal.length || missingSource.length || changed.length ? 'DIFFERENCES_FOUND' : 'MATCH', writesApplied: 0,
      autoApplyAllowed: false, note: domain === 'LOT_IDENTITY' ? 'identidade de lote: revisão manual' : 'aplicação automática só com política explícita' });
  }
  /** SourceSyncState transitions on sync results (§305–306, §388) */
  function syncState(prev, { connectorId, ok: success, at, cursor }) {
    const p = prev || { connectorId, status: 'HEALTHY', consecutiveFailures: 0 };
    if (success) return freeze({ connectorId, lastSuccessfulSyncAt: at, lastAttemptAt: at, cursor: cursor ?? p.cursor, status: 'HEALTHY', consecutiveFailures: 0 });
    const f = (p.consecutiveFailures || 0) + 1;
    return freeze({ ...p, connectorId, lastAttemptAt: at, status: f >= 3 ? 'FAILED' : 'DEGRADED', consecutiveFailures: f });
  }

  // ------------------------------------------------------------------ report + handoff (§508–513)
  function onboardingReport(x) {
    const body = { identity: x.identity, sources: (x.sources || []).map(s => ({ id: s.id, type: s.sourceType, purpose: s.purpose, fileName: s.originalFileName, checksum: s.checksum, status: s.status, version: s.version })),
      authorityMatrix: x.authorityMatrix ? x.authorityMatrix.rows : [], lotCount: x.lotCount, blockCount: x.blockCount, geometryCount: x.geometryCount, unmatchedRecords: x.unmatchedRecords || [],
      priceCoverage: x.priceCoverage, availabilityCoverage: x.availabilityCoverage, documentSet: x.documentSet || [], fieldMappings: x.fieldMappings || [], conflicts: x.conflicts || [], corrections: x.corrections || [],
      qualitySummary: x.qualitySummary, publication: x.publication ? { id: x.publication.id, number: x.publication.publicationNumber, checksum: x.publication.checksum, versions: { lot: x.publication.lotDataVersion, geometry: x.publication.geometryVersion, price: x.publication.priceTableVersion || null, availability: x.publication.availabilityRevision || null, config: x.publication.developmentConfigVersion } } : null,
      approvals: x.approvals || [], warnings: x.warnings || [], unresolvedLimitations: x.limitations || [] };
    return freeze({ ...body, reportChecksum: M.checksum(body), immutable: true });
  }
  function operationalHandoff({ developmentId, publicationId, owners = {}, authorityMatrixRef, activeSyncs = [], knownLimitations = [], runbookRefs = [], acceptedBy, at }) {
    if (!acceptedBy) return M.fail('VALIDATION_ERROR', 'handoff exige aceite explícito');
    const missingOwners = ['LOT_IDENTITY', 'GEOMETRY', 'PRICING', 'AVAILABILITY'].filter(d => !owners[d]);
    return M.ok(freeze({ developmentId, publicationId, owners: freeze({ ...owners }), sourceAuthorityMatrixRef: authorityMatrixRef, activeSyncs: freeze([...activeSyncs]), knownLimitations: freeze([...knownLimitations, ...missingOwners.map(d => `responsável de ${d} não definido (necessita confirmação)`)]),
      runbookRefs: freeze([...runbookRefs]), acceptedBy, acceptedAt: at }));
  }

  return freeze({ buildDevelopmentConfig, capabilityManifest, readiness, featureReadiness, emptyState, buildCandidate, decideApproval, activate, rollbackPlan, rollback, publicationHistory,
    ingestionDiff, classifyRemoval, classifyUpdate, recomputePlan, publicationDiff, reconcileSource, syncState, onboardingReport, operationalHandoff });
})();
