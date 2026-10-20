/* onboarding/canonical.js — topic 58 §67–83: canonical lot drafts, deterministic ids, duplicates, identity reconciliation, blocks, lineage.
   - canonicalLotId follows topic 6 / the current published data exactly: `${developmentCode}-Q${blockCode}-L${lotNumber padded to 4}`
     (VJ-QA-L0001). Same physical identity → same id in every reimport and environment (§70, §363). A non-integer lot
     number ("327A") never gets an id by guess: the draft goes to LOT_IDENTITY review (§71).
   - A source that carries its own id (legacy `did`) is checked against the rule; a mismatch is LOT_IDENTITY_CONFLICT.
   - Duplicates are classified (§75–76) and always blocking; ambiguous identities are never auto-matched (§74, §502).
   - Lineage (§77–80): only CREATED / RENUMBERED / RETIRED are produced now, always with an approver; SPLIT/MERGED are typed for later.
   Pure. Depends on App.onboarding.model. */
App.onboarding = App.onboarding || {};
App.onboarding.canonical = (() => {
  const M = App.onboarding.model;
  const freeze = o => Object.freeze(o);
  const RULE = 'lot-id@1';

  /** canonicalLotId({ developmentCode, blockCode, lotNumber }) → { id, reason } (id null when the identity is not deterministic) */
  function canonicalLotId({ developmentCode, blockCode, lotNumber }) {
    if (!developmentCode || !/^[A-Z0-9]{1,8}$/.test(developmentCode)) return { id: null, reason: 'DEVELOPMENT_CODE_INVALID' };
    if (blockCode == null || !/^[A-Z0-9]{1,6}$/.test(String(blockCode))) return { id: null, reason: 'BLOCK_CODE_MISSING' };
    if (lotNumber == null) return { id: null, reason: 'LOT_NUMBER_MISSING' };
    if (!Number.isInteger(lotNumber) || lotNumber < 0) return { id: null, reason: 'LOT_NUMBER_NOT_INTEGER' };
    return { id: `${developmentCode}-Q${blockCode}-L${String(lotNumber).padStart(4, '0')}`, reason: null };
  }
  const blockIdOf = (code, block) => `${code}-Q${block}`;
  const provRef = p => M.id('iprov', p.sourceAssetId, p.sourceRecordRef, p.sourceField, p.mappingRuleId, p.batchId);

  /** buildLotDrafts(normalized, { developmentDraftId, developmentCode }) → { drafts[], unresolved[], issues[] } */
  function buildLotDrafts(records, { developmentDraftId, developmentCode }) {
    const drafts = [], unresolved = [], issues = [];
    for (const r of records) {
      const v = r.values, block = v['identity.blockId'], lot = v['identity.lotNumber'];
      const { id, reason } = canonicalLotId({ developmentCode, blockCode: block, lotNumber: lot });
      if (!id) { unresolved.push(freeze({ recordRef: r.recordRef, sourceAssetId: r.sourceAssetId, reason, blockCode: block ?? null, lotNumber: lot ?? null })); continue; }
      const declared = v['identity.id'];
      if (declared != null && declared !== id) issues.push(freeze({ code: 'LOT_IDENTITY_CONFLICT', recordRef: r.recordRef, canonicalLotId: id, declaredId: declared, detail: `id da fonte ${declared} ≠ regra ${RULE} ${id}` }));
      const attributes = {}, provenanceRefs = {}, provenance = {};
      for (const [k, val] of Object.entries(v)) {
        if (!['identity.blockId', 'identity.lotNumber', 'geometry.areaM2', 'identity.id'].includes(k)) attributes[k] = val;
        if (r.provenance[k]) { provenanceRefs[k] = provRef(r.provenance[k]); provenance[k] = r.provenance[k]; }
      }
      drafts.push(freeze({ canonicalLotId: id, idRule: RULE, developmentDraftId, blockCode: block, lotNumber: String(lot), lotNumberValue: lot,
        areaSqm: v['geometry.areaM2'] == null ? undefined : v['geometry.areaM2'], attributes: freeze(attributes), fieldStates: r.fieldStates, provenanceRefs: freeze(provenanceRefs),
        provenance: freeze(provenance), sourceRecordRefs: freeze([`${r.sourceAssetId}#${r.recordRef}`]), sourceExternalId: v['identity.externalCode'] ?? r.sourceExternalId ?? null, declaredId: declared ?? null }));
    }
    return freeze({ drafts: freeze(drafts), unresolved: freeze(unresolved), issues: freeze(issues) });
  }

  /** detectDuplicates(drafts) → [{ key, kind, canonicalLotId?, recordRefs, classification }] — every entry is BLOCKING */
  function detectDuplicates(drafts) {
    const out = [], group = (keyFn, kind) => {
      const g = new Map(); for (const d of drafts) { const k = keyFn(d); if (k == null) continue; g.set(k, [...(g.get(k) || []), d]); }
      for (const [k, ds] of g) if (ds.length > 1) {
        const sameIds = new Set(ds.map(d => d.canonicalLotId)).size === 1, sameArea = new Set(ds.map(d => d.areaSqm)).size === 1;
        const classification = kind === 'SOURCE_EXTERNAL_ID' && !sameIds ? 'SOURCE_ERROR' : sameArea && sameIds ? 'DUPLICATE_RECORD' : 'UNKNOWN';
        out.push(freeze({ key: k, kind, canonicalLotIds: freeze([...new Set(ds.map(d => d.canonicalLotId))]), recordRefs: freeze(ds.flatMap(d => d.sourceRecordRefs)), classification }));
      }
    };
    group(d => d.canonicalLotId, 'CANONICAL_ID');
    group(d => d.sourceExternalId == null ? null : String(d.sourceExternalId), 'SOURCE_EXTERNAL_ID');
    return freeze(out);
  }

  /** buildBlocks(drafts, developmentCode, explicitBlocks?) — explicit block data wins over string parsing (§82) */
  function buildBlocks(drafts, developmentCode, explicitBlocks = null) {
    const counts = new Map(); drafts.forEach(d => counts.set(d.blockCode, (counts.get(d.blockCode) || 0) + 1));
    const codes = explicitBlocks ? explicitBlocks.map(b => b.code) : [...counts.keys()];
    const blocks = codes.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true })).map(c => freeze({ id: blockIdOf(developmentCode, c), code: c, lotCount: counts.get(c) || 0, source: explicitBlocks ? 'EXPLICIT' : 'DERIVED_FROM_LOTS' }));
    const orphanLots = explicitBlocks ? drafts.filter(d => !codes.includes(d.blockCode)).map(d => d.canonicalLotId) : [];
    return freeze({ blocks: freeze(blocks), orphanLots: freeze(orphanLots) });
  }

  /** reconcile(drafts, unresolved, existingLots) → LotIdentityMatch[] + retired candidates. existingLots: [{ id, blockId, lotNumber, areaM2, externalCode }] */
  function reconcile({ drafts, unresolved = [] }, existingLots = []) {
    const byId = new Map(existingLots.map(l => [l.id, l])), byExt = new Map(existingLots.filter(l => l.externalCode != null).map(l => [String(l.externalCode), l]));
    const matches = [], used = new Set();
    for (const d of drafts) {
      const ex = byId.get(d.canonicalLotId), ext = d.sourceExternalId != null ? byExt.get(String(d.sourceExternalId)) : null, ev = [];
      if (ex) {
        ev.push('canonicalId', 'block+lot'); if (ex.areaM2 != null && d.areaSqm != null) ev.push(ex.areaM2 === d.areaSqm ? 'area=' : 'area≠');
        if (ext && ext.id !== ex.id) { matches.push(freeze({ incomingRecordId: d.sourceRecordRefs[0], incomingLotId: d.canonicalLotId, existingLotId: ex.id, matchType: 'CONFLICT', evidence: freeze([...ev, `externalId aponta para ${ext.id}`]) })); used.add(ex.id); continue; }
        matches.push(freeze({ incomingRecordId: d.sourceRecordRefs[0], incomingLotId: d.canonicalLotId, existingLotId: ex.id, matchType: 'EXACT', evidence: freeze(ev) })); used.add(ex.id); continue;
      }
      if (ext) { matches.push(freeze({ incomingRecordId: d.sourceRecordRefs[0], incomingLotId: d.canonicalLotId, existingLotId: ext.id, matchType: 'HIGH_CONFIDENCE', evidence: freeze(['source external ID', 'id canônico mudou: possível renumeração']) })); used.add(ext.id); continue; }
      matches.push(freeze({ incomingRecordId: d.sourceRecordRefs[0], incomingLotId: d.canonicalLotId, existingLotId: undefined, matchType: existingLots.length ? 'NEW' : 'NEW', evidence: freeze(['sem lote existente']) }));
    }
    for (const u of unresolved) {
      const n = parseInt(String(u.lotNumber), 10), cands = existingLots.filter(l => l.blockId === u.blockCode && Number.isFinite(n) && l.lotNumber === n);
      matches.push(freeze({ incomingRecordId: `${u.sourceAssetId}#${u.recordRef}`, incomingLotId: null, existingLotId: cands.length === 1 ? cands[0].id : undefined, matchType: 'AMBIGUOUS',
        evidence: freeze([`lote "${u.lotNumber}" não determinístico (${u.reason})`, ...cands.map(c => `candidato ${c.id}`)]) }));
      cands.forEach(c => used.add(c.id));
    }
    const missingExisting = existingLots.filter(l => !used.has(l.id)).map(l => l.id);
    return freeze({ matches: freeze(matches), missingExisting: freeze(missingExisting), requiresReview: matches.some(m => ['AMBIGUOUS', 'CONFLICT', 'HIGH_CONFIDENCE'].includes(m.matchType)) });
  }

  /** lineageEvent({ eventType, sourceLotIds, targetLotIds, sourceRef, approvedBy, effectiveAt }) — explicit approval; no overwrite of history */
  function lineageEvent(e) {
    if (!M.LineageEventType[e.eventType]) return M.fail('VALIDATION_ERROR', 'eventType inválido');
    if (!e.approvedBy) return M.fail('VALIDATION_ERROR', 'linhagem exige aprovação explícita');
    if (['SPLIT', 'MERGED'].includes(e.eventType)) return M.fail('SOURCE_FILE_UNSUPPORTED', 'divisão/fusão de lote: modelo previsto, fluxo ainda não implementado (§80)');
    if (e.eventType === 'RENUMBERED' && !(e.sourceLotIds.length === 1 && e.targetLotIds.length === 1)) return M.fail('VALIDATION_ERROR', 'renumeração é 1→1');
    return M.ok(freeze({ id: M.id('lin', e.eventType, e.sourceLotIds, e.targetLotIds, e.sourceRef), eventType: e.eventType, sourceLotIds: freeze([...e.sourceLotIds]), targetLotIds: freeze([...e.targetLotIds]),
      effectiveAt: e.effectiveAt || undefined, sourceRef: e.sourceRef, approvedBy: e.approvedBy }));
  }

  /** existingLotsFromRepository(lots) — read-only projection of currently published lots (never mutated) */
  const existingFromLots = lots => lots.map(l => freeze({ id: l.identity.id, blockId: l.identity.blockId, lotNumber: l.identity.lotNumber, areaM2: l.geometry ? l.geometry.areaM2 : null, externalCode: l.identity.externalCode ?? null }));

  return freeze({ RULE, canonicalLotId, blockIdOf, buildLotDrafts, detectDuplicates, buildBlocks, reconcile, lineageEvent, existingFromLots, provRef });
})();
