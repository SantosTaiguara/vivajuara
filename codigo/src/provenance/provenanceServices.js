/* provenance/provenanceServices.js — Topic 33 application layer.
   Index (append-only history) → tenant-aware Repository → Service (record / supersede / invalidate / review / conflicts /
   manual assertion / override / document-publish impact) + Builder (raw → normalized observation → record),
   Graph (lineage, cycles), SourceDependencyIndex, Manifest / Coverage / Diagnostics, Projection (CLIENT / BROKER /
   TECHNICAL / AUDIT, respects document access), LineageViewModel, Pricing / Availability / Analysis adapters,
   Cache, Snapshot, event log and batch query DTOs.
   Never recalculates values, never picks a conflicting value silently, never turns legacy into verified. */
App.provenanceServices = (() => {
  const P = App.provenance, I = App.integrity;
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const iso = t => t == null ? null : typeof t === 'string' ? t : new Date(t).toISOString();
  const err = (code, message, extra) => ({ ok: false, code, message: message || code, ...(extra || {}) });
  const orgOf = t => { if (!t || !t.organizationId) throw Object.assign(new Error('TenantContext obrigatório'), { code: 'TENANT_REQUIRED' }); return t.organizationId; };
  const keyOf = (entityType, entityId, path) => entityType + '|' + entityId + '|' + path;

  // ------------------------------------------------------------------ AttributeProvenanceIndex (history per attribute; records are never overwritten)
  function createIndex() {
    const byOrg = new Map();
    const org = o => { if (!byOrg.has(o)) byOrg.set(o, { records: new Map(), byAttr: new Map(), status: new Map(), transitions: [], conflicts: new Map(), assertions: new Map(), overrides: new Map(), byDoc: new Map(), byMethod: new Map(), byConfig: new Map(), dependents: new Map(), byEntity: new Map(), revision: 0 }); return byOrg.get(o); };
    return Object.freeze({ org, clearOrganization: o => byOrg.delete(o), organizations: () => [...byOrg.keys()] });
  }

  // ------------------------------------------------------------------ AttributeProvenanceRepository (TenantContext required on every call)
  function createRepository(index = createIndex()) {
    const S = t => index.org(orgOf(t));
    const statusOf = (s, r) => s.status.get(r.id) || r.status;
    const withStatus = (s, r) => r && (s.status.has(r.id) ? freeze({ ...clone(r), status: s.status.get(r.id) }) : r);
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
    function put(t, r) {
      const s = S(t); if (r.organizationId !== t.organizationId) return err('TENANT_MISMATCH');
      if (s.records.has(r.id)) return { ok: true, record: withStatus(s, s.records.get(r.id)), deduplicated: true };
      s.records.set(r.id, r); const k = keyOf(r.entityType, r.entityId, r.attributePath);
      if (!s.byAttr.has(k)) s.byAttr.set(k, []); s.byAttr.get(k).push(r.id);
      push(s.byEntity, r.entityType + '|' + r.entityId, k);
      for (const e of r.evidenceRefs) { if (e.type === 'DOCUMENT_VERSION' && e.documentSourceRef) push(s.byDoc, e.documentSourceRef.documentId, r.id); if (e.type === 'CONFIG_VERSION') push(s.byConfig, e.configId, r.id); }
      if (r.metadata && r.metadata.candidateDocumentId) push(s.byDoc, r.metadata.candidateDocumentId, r.id);
      if (r.methodRef) push(s.byMethod, r.methodRef.methodId, r.id);
      for (const d of r.dependencyRefs || []) push(s.dependents, keyOf(d.entityType, d.entityId, d.attributePath), r.id);
      s.revision++; return { ok: true, record: r };
    }
    function setStatus(t, id, to, reason, at) {
      const s = S(t), r = s.records.get(id); if (!r) return err('PROVENANCE_NOT_FOUND');
      const from = statusOf(s, r); if (from === to) return { ok: true, unchanged: true };
      s.status.set(id, to); s.transitions.push(freeze({ provenanceId: id, from, to, reason: reason || null, at: iso(at) })); s.revision++; return { ok: true, from, to };
    }
    const get = (t, id) => { const s = S(t); return withStatus(s, s.records.get(id) || null); };
    const history = (t, entityType, entityId, path) => { const s = S(t); return (s.byAttr.get(keyOf(entityType, entityId, path)) || []).map(id => withStatus(s, s.records.get(id))); };
    /** current: the last record that is ACTIVE or REVIEW_REQUIRED (REVIEW keeps it current but flagged) */
    const current = (t, entityType, entityId, path) => { const h = history(t, entityType, entityId, path); for (let i = h.length - 1; i >= 0; i--) if (h[i].status === 'ACTIVE' || h[i].status === 'REVIEW_REQUIRED') return h[i]; return null; };
    const ids = (m, k) => [...(m.get(k) || [])];
    return Object.freeze({ index, put, get, history, current, setStatus, statusOf: (t, id) => { const s = S(t), r = s.records.get(id); return r ? statusOf(s, r) : null; },
      transitions: (t, id) => S(t).transitions.filter(x => !id || x.provenanceId === id),
      entityPaths: (t, entityType, entityId) => [...(S(t).byEntity.get(entityType + '|' + entityId) || [])].map(k => k.split('|')[2]),
      all: t => { const s = S(t); return [...s.records.values()].map(r => withStatus(s, r)); },
      currentAll: t => { const s = S(t), out = []; for (const k of s.byAttr.keys()) { const [a, b, c] = k.split('|'); const r = current(t, a, b, c); if (r) out.push(r); } return out; },
      byDocument: (t, docId) => ids(S(t).byDoc, docId).map(id => get(t, id)), byMethod: (t, m) => ids(S(t).byMethod, m).map(id => get(t, id)), byConfig: (t, c) => ids(S(t).byConfig, c).map(id => get(t, id)),
      dependentsOf: (t, entityType, entityId, path) => ids(S(t).dependents, keyOf(entityType, entityId, path)).map(id => get(t, id)),
      putConflict: (t, c) => { if (c.organizationId !== t.organizationId) return err('TENANT_MISMATCH'); const s = S(t); if (!s.conflicts.has(c.id)) s.conflicts.set(c.id, []); s.conflicts.get(c.id).push(c); return { ok: true, conflict: c }; },
      getConflict: (t, id) => { const h = S(t).conflicts.get(id); return h ? h[h.length - 1] : null; }, conflictHistory: (t, id) => [...(S(t).conflicts.get(id) || [])],
      listConflicts: t => [...S(t).conflicts.values()].map(h => h[h.length - 1]),
      putAssertion: (t, a) => { if (a.organizationId !== t.organizationId) return err('TENANT_MISMATCH'); S(t).assertions.set(a.id, a); return { ok: true }; }, getAssertion: (t, id) => S(t).assertions.get(id) || null,
      putOverride: (t, o) => { if (o.organizationId !== t.organizationId) return err('TENANT_MISMATCH'); S(t).overrides.set(o.id, o); return { ok: true }; }, listOverrides: t => [...S(t).overrides.values()],
      revision: t => S(t).revision });
  }

  // ------------------------------------------------------------------ events (no document content, no PII beyond actor ref)
  function createEventLog() {
    const list = [];
    return Object.freeze({ emit(type, o) { const e = freeze({ type, organizationId: o.organizationId, entityType: o.entityType || null, entityId: o.entityId || null, attributePath: o.attributePath || null,
      provenanceId: o.provenanceId || null, sourceRefs: o.sourceRefs || [], actorRef: o.actorRef || null, at: iso(o.now), metadata: clone(o.metadata || {}) }); list.push(e); return e; },
      list: (f = {}) => list.filter(e => (!f.type || e.type === f.type) && (!f.organizationId || e.organizationId === f.organizationId)), size: () => list.length });
  }
  const shortRefs = r => r.evidenceRefs.map(e => e.type === 'DOCUMENT_VERSION' ? { type: e.type, documentId: e.documentSourceRef.documentId, documentVersionId: e.documentSourceRef.documentVersionId } : { type: e.type });

  // ------------------------------------------------------------------ ProvenanceGraphService (acyclic derivation; depth-limited)
  function createGraph(repo) {
    function deps(t, r) { return (r.dependencyRefs || []).map(d => (d.provenanceId && repo.get(t, d.provenanceId)) || repo.current(t, d.entityType, d.entityId, d.attributePath)).filter(Boolean); }
    /** wouldCycle(t, record) — true when one of the inputs (transitively) depends on the record's own attribute */
    function wouldCycle(t, r, limit = 64) {
      const target = keyOf(r.entityType, r.entityId, r.attributePath), seen = new Set(), stack = (r.dependencyRefs || []).map(d => ({ d, depth: 1 }));
      while (stack.length) { const { d, depth } = stack.pop(); const k = keyOf(d.entityType, d.entityId, d.attributePath); if (k === target) return true; if (seen.has(k) || depth > limit) continue; seen.add(k);
        const cur = repo.current(t, d.entityType, d.entityId, d.attributePath); if (cur) for (const x of cur.dependencyRefs || []) stack.push({ d: x, depth: depth + 1 }); }
      return false;
    }
    function lineage(t, r, depth = 2) { if (!r || depth < 0) return null; return { record: r, inputs: depth === 0 ? [] : deps(t, r).map(x => lineage(t, x, depth - 1)).filter(Boolean), truncated: depth === 0 && (r.dependencyRefs || []).length > 0 }; }
    /** downstream(t, record) → every record (transitively) computed from it (impact analysis) */
    function downstream(t, r, limit = 10000) {
      const out = new Map(), q = [r];
      while (q.length && out.size < limit) { const x = q.shift(); for (const d of repo.dependentsOf(t, x.entityType, x.entityId, x.attributePath)) if (d && !out.has(d.id) && d.id !== r.id) { out.set(d.id, d); q.push(d); } }
      return [...out.values()];
    }
    return Object.freeze({ dependencies: deps, wouldCycle, lineage, downstream });
  }

  // ------------------------------------------------------------------ normalizers (Builder). Each is a versioned MethodRef.
  const NORMALIZERS = Object.freeze({
    'br_decimal_to_number@1.0.0': raw => { if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null; if (raw == null) return null; const s = String(raw).trim().replace(/\s/g, ''); if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null; return Number(s.replace(/\./g, '').replace(',', '.')); },
    'area_string_to_decimal@1': raw => { if (raw == null) return null; const m = String(raw).replace(/m²|m2/gi, '').trim(); return NORMALIZERS['br_decimal_to_number@1.0.0'](m); } });

  // ------------------------------------------------------------------ application service
  /** createService({ now, documents: { service, tenant }?, index?, events? }) */
  function createService(o = {}) {
    const repo = o.repository || createRepository(o.index), events = o.events || createEventLog(), graph = createGraph(repo), cache = o.cache || createCache();
    const clock = () => o.now != null ? (typeof o.now === 'function' ? o.now() : o.now) : Date.now(), nowIso = () => iso(clock());
    const docs = o.documents || null; // { service: App.documentServices.createService(), tenant }
    const methods = devId => P.methodRegistry(devId);
    const resolveDocument = (t, ref) => { if (!docs || !ref) return null; const d = docs.service.repo.getDocument(t, ref.documentId); if (!d) return null; const v = docs.service.repo.getVersion(t, ref.documentVersionId); return { document: d, version: v && v.documentId === d.id ? v : null }; };
    const can = (access, k, t) => !!(access && typeof access.can === 'function' && access.can(k, { organizationId: t.organizationId }));
    const actorOf = a => a && a.principalId ? 'user:' + a.principalId : null;

    /** currentness at read time (asOf): document superseded / review / stale — the record itself is never mutated */
    function currentnessOf(t, r) {
      if (!r) return 'UNKNOWN';
      const st = repo.statusOf(t, r.id);
      if (st === 'REVIEW_REQUIRED' || r.currentness === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
      if (docs) for (const e of r.evidenceRefs) if (e.type === 'DOCUMENT_VERSION') { const d = docs.service.repo.getDocument(t, e.documentSourceRef.documentId);
        if (d && d.currentPublishedVersionId && d.currentPublishedVersionId !== e.documentSourceRef.documentVersionId) return 'SOURCE_SUPERSEDED'; }
      if (r.metadata && r.metadata.freshness === 'STALE') return 'STALE';
      return r.currentness;
    }
    const summaryOf = (t, r) => r ? P.summarize(repo.get(t, r.id) || r, { currentness: currentnessOf(t, r), status: repo.statusOf(t, r.id) || r.status, conflicted: !!(r.conflictRef && (repo.getConflict(t, r.conflictRef) || {}).resolutionStatus === 'OPEN') }) : P.summarize(null);

    /** record(t, input, { entity?, access?, system? }) — validates, rejects cycles, supersedes the previous current record */
    function record(t, input, ctx = {}) {
      let r; try { r = P.createRecord({ recordedAt: nowIso(), ...input, organizationId: input.organizationId || orgOf(t) }); } catch (e) { return err(e.code || 'INVALID_RECORD', e.message); }
      const prev = repo.current(t, r.entityType, r.entityId, r.attributePath);
      if (prev && prev.id === r.id) return { ok: true, record: prev, deduplicated: true };
      if (prev && !r.supersedesProvenanceId) r = P.createRecord({ ...clone(r), id: undefined, supersedesProvenanceId: prev.id });
      const v = P.validateRecord(r, { tenant: t, developmentId: ctx.developmentId || r.developmentId, methods: methods(r.developmentId), resolveDocument: docs ? ref => resolveDocument(t, ref) : null,
        getRecord: id => repo.get(t, id), getConflict: id => repo.getConflict(t, id), ...('entity' in ctx ? { entity: ctx.entity } : {}) });
      if (!v.valid) return err(v.errors[0], 'registro de proveniência inválido', { errors: v.errors, warnings: v.warnings });
      if (graph.wouldCycle(t, r)) return err('LINEAGE_CYCLE');
      const put = repo.put(t, r); if (!put.ok) return put;
      if (prev) { repo.setStatus(t, prev.id, 'SUPERSEDED', 'NEW_RECORD', clock()); events.emit('AttributeProvenanceSuperseded', { ...r, provenanceId: prev.id, now: clock(), metadata: { supersededBy: r.id } }); }
      events.emit('AttributeProvenanceRecorded', { ...r, provenanceId: r.id, sourceRefs: shortRefs(r), actorRef: actorOf(ctx.access) || r.recordedBy, now: clock() });
      cache.invalidateEntity(r.organizationId, r.entityType, r.entityId);
      return { ok: true, record: put.record, warnings: v.warnings };
    }
    /** bulkImport(t, records) — migration path: trusted builder output, validated structurally, no events per record */
    function bulkImport(t, list, opts = {}) {
      const errors = []; let n = 0;
      for (const input of list) { const r = input.id && input.valueFingerprint && Object.isFrozen(input) ? input : P.createRecord(input);
        if (opts.validate !== false) { const v = P.validateRecord(r, { tenant: t, methods: methods(r.developmentId) }); if (!v.valid) { errors.push({ entityId: r.entityId, attributePath: r.attributePath, errors: v.errors }); continue; } }
        const res = repo.put(t, r); if (res.ok) n++; else errors.push({ entityId: r.entityId, attributePath: r.attributePath, errors: [res.code] });
        if (r.status === 'REVIEW_REQUIRED') repo.setStatus(t, r.id, 'REVIEW_REQUIRED', 'IMPORTED', clock()); }
      cache.clearOrganization(orgOf(t));
      return { ok: !errors.length, imported: n, errors };
    }
    function invalidate(t, id, reason) { const r = repo.setStatus(t, id, 'INVALIDATED', reason, clock()); if (r.ok && !r.unchanged) { const x = repo.get(t, id); events.emit('AttributeProvenanceInvalidated', { ...x, provenanceId: id, now: clock(), metadata: { reason } }); cache.invalidateEntity(x.organizationId, x.entityType, x.entityId); } return r; }
    function requireReview(t, id, reason) { const r = repo.setStatus(t, id, 'REVIEW_REQUIRED', reason, clock()); if (r.ok && !r.unchanged) { const x = repo.get(t, id); events.emit('ProvenanceReviewRequired', { ...x, provenanceId: id, now: clock(), metadata: { reason } }); cache.invalidateEntity(x.organizationId, x.entityType, x.entityId); } return r; }
    /** checkValue(t, entityType, entity, path) — fingerprint mismatch is reported and flagged for review, never corrected silently (§134) */
    function checkValue(t, entityType, entity, path) {
      const id = entity.identity ? entity.identity.id : entity.id, r = repo.current(t, entityType, id, path); if (!r) return { ok: false, code: 'PROVENANCE_NOT_FOUND' };
      const fp = P.fingerprint(P.valueAt(entity, path)); if (fp === r.valueFingerprint) return { ok: true, record: r };
      requireReview(t, r.id, 'PROVENANCE_VALUE_MISMATCH'); return { ok: false, code: 'PROVENANCE_VALUE_MISMATCH', provenanceId: r.id, expected: r.valueFingerprint, actual: fp };
    }
    /** reportCandidates(t, { entityType, entityId, attributePath, developmentId, candidates }) — agreement ⇒ one record with all refs; disagreement ⇒ ProvenanceConflict OPEN (unless a formal policy resolves) */
    function reportCandidates(t, o) {
      const pol = P.resolutionPolicy(o.attributePath, o.developmentId);
      const res = P.detectConflict({ organizationId: orgOf(t), entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, candidates: o.candidates, policy: pol, now: nowIso() });
      if (res.agreed) { const c = res.candidates; return { ok: true, agreed: true, recordInput: { entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, developmentId: o.developmentId, valueFingerprint: c[0].valueFingerprint,
        provenanceKind: o.kind || 'DIRECT_SOURCE', evidenceState: o.evidenceState || 'VERIFIED', currentness: 'CURRENT', evidenceRefs: c.flatMap(x => x.evidenceRefs), metadata: { sourceAuthority: c[0].authority } } }; }
      repo.putConflict(t, res.conflict);
      events.emit('ProvenanceConflictDetected', { organizationId: orgOf(t), entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, now: clock(), metadata: { conflictId: res.conflict.id, conflictType: res.conflict.conflictType, status: res.conflict.resolutionStatus } });
      const cur = repo.current(t, o.entityType, o.entityId, o.attributePath); if (cur && res.conflict.resolutionStatus === 'OPEN') requireReview(t, cur.id, 'CONFLICT_OPEN');
      return { ok: true, agreed: false, conflict: res.conflict };
    }
    function resolveConflictCmd(t, conflictId, o, access) {
      if (!can(access, P.PERMISSIONS.RESOLVE_CONFLICT, t)) return err('PROVENANCE_ACCESS_DENIED');
      const c = repo.getConflict(t, conflictId); if (!c) return err('CONFLICT_REFERENCE_INVALID');
      let n; try { n = P.resolveConflict(c, { ...o, actorUserId: access.principalId, now: nowIso() }); } catch (e) { return err(e.code, e.message); }
      repo.putConflict(t, n); events.emit('ProvenanceConflictResolved', { organizationId: c.organizationId, entityType: c.entityType, entityId: c.entityId, attributePath: c.attributePath, actorRef: actorOf(access), now: clock(), metadata: { conflictId, status: n.resolutionStatus, selectedCandidateId: n.selectedCandidateId } });
      return { ok: true, conflict: n, note: 'o valor canônico não é alterado aqui: a aplicação do candidato escolhido passa pelo pipeline de dados (com validação em shadow)' };
    }
    /** assertManual(t, { entityType, entityId, attributePath, developmentId, value, reasonCode, notes, supportingEvidenceRefs }, access) */
    function assertManual(t, o, access) {
      if (!can(access, P.PERMISSIONS.OVERRIDE, t)) return err('PROVENANCE_ACCESS_DENIED');
      const pol = P.fieldPolicy(o.attributePath, o.developmentId); if (!pol) return err('INVALID_ATTRIBUTE_PATH'); if (!pol.allowManualAssertion) return err('KIND_NOT_ALLOWED', 'o campo não aceita informação manual');
      let a; try { a = P.createManualAssertion({ ...o, organizationId: orgOf(t), assertedBy: access.principalId, assertedAt: nowIso() }); } catch (e) { return err(e.code, e.message); }
      repo.putAssertion(t, a);
      return record(t, { entityType: o.entityType, entityId: o.entityId, attributePath: o.attributePath, developmentId: o.developmentId, valueFingerprint: a.valueFingerprint, provenanceKind: 'MANUAL_ASSERTION',
        evidenceState: (o.supportingEvidenceRefs || []).length ? 'PARTIAL' : 'UNRESOLVED', currentness: 'CURRENT', evidenceRefs: [P.evidence.userAssertion({ actorUserId: access.principalId, assertionId: a.id, reasonCode: a.reasonCode, assertedAt: a.assertedAt }), ...(o.supportingEvidenceRefs || [])],
        assertionRef: a.id, recordedBy: actorOf(access) }, { access });
    }
    /** override(t, { ...record input, reasonCode, reasonText }, access) — the previous record stays in history (§260) */
    function override(t, o, access) {
      if (!can(access, P.PERMISSIONS.OVERRIDE, t)) return err('PROVENANCE_ACCESS_DENIED');
      const pol = P.fieldPolicy(o.attributePath, o.developmentId); if (!pol || !pol.allowOverride) return err('KIND_NOT_ALLOWED', 'override não permitido para este campo');
      if (!o.reasonCode) return err('REASON_REQUIRED');
      const prev = repo.current(t, o.entityType, o.entityId, o.attributePath);
      const res = record(t, { ...o, provenanceKind: 'MANUAL_OVERRIDE', recordedBy: actorOf(access) }, { access }); if (!res.ok) return res;
      const ov = P.createOverride({ organizationId: orgOf(t), previousProvenanceId: prev ? prev.id : null, replacementProvenanceId: res.record.id, actorUserId: access.principalId, reasonCode: o.reasonCode, reasonText: o.reasonText, createdAt: nowIso() });
      repo.putOverride(t, ov); events.emit('ProvenanceOverrideApplied', { ...res.record, provenanceId: res.record.id, actorRef: actorOf(access), now: clock(), metadata: { overrideId: ov.id, previousProvenanceId: ov.previousProvenanceId } });
      return { ok: true, record: res.record, override: ov };
    }
    /** onDocumentVersionPublished(t, event) — ProvenanceImpactAnalysis: flags review, never recalculates (§187, §505) */
    function onDocumentVersionPublished(t, e) {
      const docId = e.documentId, newVer = e.versionId, direct = [], candidates = [];
      for (const r of repo.byDocument(t, docId)) { if (!r || !['ACTIVE', 'REVIEW_REQUIRED'].includes(r.status)) continue;
        const refs = r.evidenceRefs.filter(x => x.type === 'DOCUMENT_VERSION' && x.documentSourceRef.documentId === docId);
        if (refs.length && refs.every(x => x.documentSourceRef.documentVersionId === newVer)) continue;
        (refs.length ? direct : candidates).push(r); }
      const affected = [...direct, ...candidates], downstream = new Map();
      for (const r of affected) for (const d of graph.downstream(t, r)) if (!affected.some(x => x.id === d.id)) downstream.set(d.id, d);
      for (const r of affected) requireReview(t, r.id, direct.includes(r) ? 'SOURCE_SUPERSEDED' : 'CANDIDATE_SOURCE_PUBLISHED');
      for (const r of downstream.values()) requireReview(t, r.id, 'UPSTREAM_SOURCE_CHANGED');
      if (direct.length) events.emit('SourceVersionSuperseded', { organizationId: orgOf(t), now: clock(), sourceRefs: [{ type: 'DOCUMENT_VERSION', documentId: docId, documentVersionId: newVer }], metadata: { previousVersionId: e.metadata && e.metadata.previousVersionId || null, affected: direct.length } });
      const byPath = {}; for (const r of [...affected, ...downstream.values()]) byPath[r.attributePath] = (byPath[r.attributePath] || 0) + 1;
      return freeze({ documentId: docId, newVersionId: newVer, previousVersionId: e.metadata && e.metadata.previousVersionId || null, directlyAffected: direct.length, candidateLinksToReview: candidates.length,
        downstreamAffected: downstream.size, byAttributePath: byPath, recalculated: 0, generatedAt: nowIso(),
        note: 'Nenhum valor foi recalculado; os registros antigos continuam no histórico e foram marcados para revisão.' });
    }
    function attachDocumentEvents(docEventLog) { /* pull model: call onDocumentVersionPublished for each DocumentVersionPublished event */
      return t => docEventLog.list({ type: 'DocumentVersionPublished', organizationId: t.organizationId }).map(e => onDocumentVersionPublished(t, { documentId: e.documentId, versionId: e.versionId, metadata: e.metadata })); }

    // -------- reads
    function getField(t, entityType, entityId, path, q = {}) {
      const ck = cache.key(orgOf(t), entityType, entityId, path, q.mode || 'SUMMARY', repo.revision(t));
      const hit = cache.get(ck); if (hit) return hit;
      const r = repo.current(t, entityType, entityId, path);
      const out = { attributePath: path, valueFingerprint: r ? r.valueFingerprint : null, summary: summaryOf(t, r) };
      cache.set(ck, out); return out;
    }
    /** batchQuery(t, { entityType, entityIds, attributePaths, detailLevel: SUMMARY|STANDARD|TECHNICAL, mode, access }) — one call, no N+1 */
    function batchQuery(t, q) {
      const paths = q.attributePaths && q.attributePaths.length ? q.attributePaths : null, out = {};
      for (const id of q.entityIds || []) { out[id] = {};
        for (const p of paths || repo.entityPaths(t, q.entityType, id)) { const r = repo.current(t, q.entityType, id, p);
          out[id][p] = q.detailLevel === 'TECHNICAL' || q.detailLevel === 'STANDARD' ? project(t, r, { mode: q.detailLevel === 'TECHNICAL' ? (q.mode || 'TECHNICAL') : 'BROKER', access: q.access }) : { valueFingerprint: r ? r.valueFingerprint : null, summary: summaryOf(t, r) }; } }
      return out;
    }

    // -------- ProvenanceProjectionService
    /** project(t, record, { mode, access }) — evidence visibility follows document access; evidenceState is never changed by visibility (§351) */
    function project(t, r, o = {}) {
      const mode = P.ProjectionMode[o.mode] ? o.mode : 'BROKER', access = o.access || {};
      if ((mode === 'TECHNICAL' || mode === 'AUDIT') && !can(access, P.PERMISSIONS.TECHNICAL_READ, t)) return err('PROVENANCE_ACCESS_DENIED', 'modo técnico exige provenance.technical.read');
      if (mode === 'BROKER' && !can(access, P.PERMISSIONS.READ, t)) return err('PROVENANCE_ACCESS_DENIED', 'exige provenance.read');
      const s = summaryOf(t, r), label = P.labelFor(s.displayCode, mode);
      if (!r) return freeze({ mode, displayCode: s.displayCode, label: mode === 'CLIENT' ? P.labelFor('REVIEW', 'CLIENT') : 'Sem proveniência registrada', untracked: true });
      const docVis = e => { if (e.type !== 'DOCUMENT_VERSION') return 'FULL'; if (!docs) return 'SUMMARY_ONLY';
        const d = docs.service.repo.getDocument(t, e.documentSourceRef.documentId); if (!d) return 'HIDDEN';
        const dec = App.documents.decide(d, { action: 'READ', access: { ...access, organizationId: access.organizationId || t.organizationId, mode: mode === 'CLIENT' ? 'CLIENT' : access.mode } });
        return dec.allowed ? 'FULL' : dec.hideExistence ? 'HIDDEN' : 'SUMMARY_ONLY'; };
      const reason = r.notAvailableReason ? P.REASON_LABELS[r.notAvailableReason] : null;
      if (mode === 'CLIENT') {
        const official = s.displayCode === 'CONFIRMED' && r.evidenceRefs.some(e => e.type === 'DOCUMENT_VERSION' && /^OFFICIAL/.test(e.documentSourceRef.authority || '') && docVis(e) === 'FULL');
        return freeze({ mode, displayCode: s.displayCode, label, sourcePhrase: official ? 'Fonte: documentação oficial do empreendimento' : null, reason }); // no ids, no paths, no notes (§220)
      }
      const sources = r.evidenceRefs.map(e => { const vis = docVis(e);
        if (e.type === 'DOCUMENT_VERSION') { const sr = e.documentSourceRef;
          if (vis === 'HIDDEN') return { type: e.type, visibility: 'HIDDEN' };
          if (vis === 'SUMMARY_ONLY' || mode === 'BROKER') return { type: e.type, visibility: vis === 'FULL' ? 'SUMMARY_ONLY' : vis, label: /^OFFICIAL/.test(sr.authority || '') ? 'Documento oficial' : 'Documento do empreendimento', ...(vis === 'FULL' && sr.locator && sr.locator.pageNumber ? { page: sr.locator.pageNumber } : {}) };
          return { type: e.type, visibility: 'FULL', documentId: sr.documentId, documentVersionId: sr.documentVersionId, locator: sr.locator, checksum: sr.checksum, authority: sr.authority }; }
        if (mode === 'BROKER') return { type: e.type, visibility: 'SUMMARY_ONLY' };
        if (e.type === 'USER_ASSERTION') return { type: e.type, visibility: 'FULL', assertionId: e.assertionId, reasonCode: e.reasonCode, assertedAt: e.assertedAt }; // actor + notes stay out of the projection
        return { ...clone(e), visibility: 'FULL' }; });
      const base = { mode, displayCode: s.displayCode, label, summary: s, reason, sources };
      if (mode === 'BROKER') return freeze({ ...base, method: r.methodRef ? { label: r.methodRef.descriptionKey || r.methodRef.methodId } : null, dependencyCount: (r.dependencyRefs || []).length });
      const tech = { ...base, provenanceId: r.id, entityId: r.entityId, attributePath: r.attributePath, valueFingerprint: r.valueFingerprint, provenanceKind: r.provenanceKind, evidenceState: r.evidenceState,
        currentness: s.currentness, status: s.status, methodRef: r.methodRef, dependencyRefs: r.dependencyRefs, conflictRef: r.conflictRef, metadata: clone(r.metadata), recordedAt: r.recordedAt,
        warnings: P.validateRecord(r, { methods: methods(r.developmentId) }).warnings };
      if (mode === 'AUDIT') { tech.history = repo.history(t, r.entityType, r.entityId, r.attributePath).map(x => ({ id: x.id, status: x.status, provenanceKind: x.provenanceKind, recordedAt: x.recordedAt, valueFingerprint: x.valueFingerprint }));
        tech.transitions = repo.transitions(t).filter(x => tech.history.some(h => h.id === x.provenanceId)); if (r.conflictRef) tech.conflictHistory = repo.conflictHistory(t, r.conflictRef); }
      return freeze(tech);
    }
    /** lineageViewModel(t, entityType, entityId, path, { depth = 2, access, valueLabel }) — technical tree; lazy, depth-limited (§293) */
    function lineageViewModel(t, entityType, entityId, path, o = {}) {
      if (!can(o.access, P.PERMISSIONS.TECHNICAL_READ, t)) return err('PROVENANCE_ACCESS_DENIED');
      const r = repo.current(t, entityType, entityId, path); if (!r) return err('PROVENANCE_NOT_FOUND');
      const depth = Math.max(0, Math.min(3, o.depth == null ? 2 : o.depth)), p = project(t, r, { mode: 'TECHNICAL', access: o.access });
      const node = (type, label, extra = {}) => ({ type, label, ...extra });
      const tree = graph.lineage(t, r, depth);
      const depNode = n => node('ATTRIBUTE', n.record.attributePath + (n.record.entityId !== entityId ? ' (' + n.record.entityId + ')' : ''), { displayCode: summaryOf(t, n.record).displayCode, children: n.inputs.map(depNode), truncated: n.truncated });
      return { ok: true, vm: freeze({ attributePath: path, valueLabel: o.valueLabel != null ? String(o.valueLabel) : null, summary: p.summary,
        sourceNodes: p.sources.map(s => s.type === 'DOCUMENT_VERSION' ? node('DOCUMENT', s.visibility === 'FULL' ? s.documentId + ' / ' + s.documentVersionId : 'Documento (acesso restrito)', { visibility: s.visibility })
          : s.type === 'CONFIG_VERSION' ? node('CONFIG', s.configId + '@' + s.configVersion) : s.type === 'ANALYSIS_RESULT' ? node('ANALYSIS', s.moduleId + '@' + s.moduleVersion + (s.methodologyVersion ? ' · metodologia ' + s.methodologyVersion : ''))
          : s.type === 'USER_ASSERTION' ? node('ASSERTION', 'Asserção ' + s.assertionId) : node('SOURCE', s.type + (s.recordType ? ' ' + s.recordType + ' ' + s.recordId : ''))),
        methodNode: r.methodRef ? node('METHOD', r.methodRef.methodId + ' v' + r.methodRef.methodVersion, { methodType: r.methodRef.methodType }) : null,
        dependencyNodes: tree.inputs.map(depNode), conflictNode: r.conflictRef ? node('CONFLICT', r.conflictRef) : null, warnings: p.warnings, depth,
        actions: [{ id: 'prov-history', label: 'Histórico', enabled: can(o.access, P.PERMISSIONS.TECHNICAL_READ, t) }, { id: 'prov-resolve', label: 'Resolver conflito', enabled: !!r.conflictRef && can(o.access, P.PERMISSIONS.RESOLVE_CONFLICT, t) }] }) };
    }

    // -------- Manifest / Coverage / Diagnostics (operational state — never a confidence number)
    function counts(list) { const c = { VERIFIED: 0, PARTIAL: 0, UNRESOLVED: 0, MISSING: 0, CONFLICTED: 0, ACCESS_RESTRICTED: 0, INVALID: 0 }; for (const r of list) c[r.evidenceState]++; return c; }
    function manifest(t, devId) {
      const list = repo.currentAll(t).filter(r => !devId || r.developmentId === devId), c = counts(list), ents = new Set(list.map(r => r.entityType + '|' + r.entityId));
      const body = { organizationId: orgOf(t), developmentId: devId || null, provenanceRevision: String(repo.revision(t)), entityCount: ents.size, attributeRecordCount: list.length, verifiedCount: c.VERIFIED, partialCount: c.PARTIAL,
        unresolvedCount: c.UNRESOLVED, missingCount: c.MISSING, conflictedCount: c.CONFLICTED, reviewRequiredCount: list.filter(r => r.status === 'REVIEW_REQUIRED' || currentnessOf(t, r) === 'REVIEW_REQUIRED').length,
        ids: list.map(r => r.id).sort() };
      const checksum = I.checksumOf(body); delete body.ids; return freeze({ ...body, generatedAt: nowIso(), checksum });
    }
    function coverage(t, devId, o = {}) {
      const list = repo.currentAll(t).filter(r => !devId || r.developmentId === devId), byPath = {}, byKind = {}, byDisplay = {}, byDomain = {};
      for (const r of list) { const s = summaryOf(t, r), f = App.model.field(r.attributePath), dom = f ? f.domain : 'UNKNOWN';
        byKind[r.provenanceKind] = (byKind[r.provenanceKind] || 0) + 1; byDisplay[s.displayCode] = (byDisplay[s.displayCode] || 0) + 1;
        const bp = byPath[r.attributePath] || (byPath[r.attributePath] = { total: 0, verified: 0, partial: 0, unresolved: 0, notAvailable: 0, legacy: 0 }); bp.total++;
        if (r.evidenceState === 'VERIFIED') bp.verified++; if (r.evidenceState === 'PARTIAL') bp.partial++; if (r.evidenceState === 'UNRESOLVED') bp.unresolved++; if (r.provenanceKind === 'NOT_AVAILABLE') bp.notAvailable++; if (r.provenanceKind === 'LEGACY_DECLARED') bp.legacy++;
        const bd = byDomain[dom] || (byDomain[dom] = { total: 0, verified: 0 }); bd.total++; if (r.evidenceState === 'VERIFIED') bd.verified++; }
      const tracked = P.pathRegistry.tracked().length, ents = new Set(list.map(r => r.entityId)).size;
      return freeze({ organizationId: orgOf(t), developmentId: devId || null, trackedPathsInRegistry: tracked, entities: ents, records: list.length, expectedRecords: o.expectedEntities ? o.expectedEntities * tracked : null,
        byKind, byDisplayCode: byDisplay, byDomain, byAttributePath: byPath, generatedAt: nowIso(), note: 'Cobertura de proveniência (estado operacional). Não é score de confiança.' });
    }
    /** diagnostics(t, devId, { entities: Map(entityId → entity), entityType }) — brokenDocumentRefs, brokenDependencyRefs, fingerprint mismatches */
    function diagnostics(t, devId, o = {}) {
      const list = repo.currentAll(t).filter(r => !devId || r.developmentId === devId), c = counts(list); let brokenDoc = 0, brokenDep = 0, mismatch = 0;
      for (const r of list) {
        for (const e of r.evidenceRefs) if (e.type === 'DOCUMENT_VERSION' && docs) { const res = resolveDocument(t, e.documentSourceRef); if (!res || !res.version) brokenDoc++; }
        for (const d of r.dependencyRefs || []) { const x = repo.current(t, d.entityType, d.entityId, d.attributePath); if (!x || x.valueFingerprint !== d.valueFingerprint) brokenDep++; }
        if (o.entities) { const ent = o.entities.get(r.entityId); if (ent && P.fingerprint(P.valueAt(ent, r.attributePath)) !== r.valueFingerprint) mismatch++; } }
      return freeze({ organizationId: orgOf(t), developmentId: devId || null, totalTrackedAttributes: list.length, verified: c.VERIFIED, partial: c.PARTIAL, unresolved: c.UNRESOLVED, missing: c.MISSING, conflicted: c.CONFLICTED, invalid: c.INVALID,
        reviewRequired: list.filter(r => r.status === 'REVIEW_REQUIRED').length, legacyDeclared: list.filter(r => r.provenanceKind === 'LEGACY_DECLARED').length,
        brokenDocumentRefs: brokenDoc, brokenDependencyRefs: brokenDep, valueFingerprintMismatches: mismatch, openConflicts: repo.listConflicts(t).filter(x => x.resolutionStatus === 'OPEN').length, generatedAt: nowIso() });
    }
    /** snapshot(t, { entityRefs, purpose, dataVersionRefs }) — exact records used by a report / share (§416) */
    function snapshot(t, o) {
      const ids = []; for (const ref of o.entityRefs || []) for (const p of (o.attributePaths || repo.entityPaths(t, ref.entityType, ref.entityId))) { const r = repo.current(t, ref.entityType, ref.entityId, p); if (r) ids.push(r.id); }
      const body = { organizationId: orgOf(t), developmentId: o.developmentId || null, entityRefs: (o.entityRefs || []).map(r => r.entityType + ':' + r.entityId), provenanceIds: ids.sort(), dataVersionRefs: (o.dataVersionRefs || []).map(clone), purpose: o.purpose || null };
      return freeze({ id: I.stableId('psnap', body), ...body, generatedAt: nowIso(), checksum: I.checksumOf(body) });
    }

    return Object.freeze({ repo, events, graph, cache, clock, record, bulkImport, invalidate, requireReview, checkValue, reportCandidates, resolveConflict: resolveConflictCmd, assertManual, override,
      onDocumentVersionPublished, attachDocumentEvents, currentnessOf, summaryOf, getField, batchQuery, project, lineageViewModel, manifest, coverage, diagnostics, snapshot,
      confidenceInputs: (t, entityType, entityId, path) => { const r = repo.current(t, entityType, entityId, path); return r ? P.confidenceInputs(r, { currentness: currentnessOf(t, r), status: repo.statusOf(t, r.id) }) : null; } });
  }

  // ------------------------------------------------------------------ ProvenanceBuilder (imports: raw observation → normalized observation → record input)
  /** rawObservation({ rawValue, sourceRef, locator, observedAt, rawFieldName }) — value and position travel together (§333) */
  const rawObservation = o => freeze({ rawValue: o.rawValue, sourceRef: clone(o.sourceRef), locator: o.locator ? clone(o.locator) : (o.sourceRef && o.sourceRef.locator) || null, observedAt: o.observedAt || null, rawFieldName: o.rawFieldName || null });
  /** normalize(raw, attributePath, normalizer 'id@version' | null) → NormalizedFieldObservation */
  function normalize(raw, attributePath, normalizer) {
    if (!P.pathRegistry.has(attributePath)) return err('INVALID_ATTRIBUTE_PATH');
    let canonicalValue = raw.rawValue, normalizationMethodRef = null;
    if (normalizer) { const fn = NORMALIZERS[normalizer]; if (!fn) return err('METHOD_NOT_FOUND'); canonicalValue = fn(raw.rawValue); const [id, v] = normalizer.split('@'); normalizationMethodRef = P.methodRef({ methodId: id, methodVersion: v, methodType: 'NORMALIZATION' }); }
    return { ok: true, observation: freeze({ canonicalValue, canonicalAttributePath: attributePath, sourceRef: raw.sourceRef, normalizationMethodRef, sourceLocator: raw.locator, rawFieldName: raw.rawFieldName, observedAt: raw.observedAt, changed: normalizer ? canonicalValue !== raw.rawValue : false }) };
  }
  /** buildFromObservation(obs, { organizationId, developmentId, entityType, entityId, evidenceState }) → record input (DIRECT vs NORMALIZED decided by the transformation) */
  function buildFromObservation(obs, o) {
    const sr = obs.sourceRef && obs.sourceLocator && !obs.sourceRef.locator ? { ...obs.sourceRef, locator: obs.sourceLocator } : obs.sourceRef;
    const verified = sr && sr.versionStatus === 'PUBLISHED';
    return { organizationId: o.organizationId, developmentId: o.developmentId, entityType: o.entityType, entityId: o.entityId, attributePath: obs.canonicalAttributePath, valueFingerprint: P.fingerprint(obs.canonicalValue),
      provenanceKind: obs.normalizationMethodRef ? 'NORMALIZED_SOURCE' : 'DIRECT_SOURCE', evidenceState: o.evidenceState || (verified ? 'VERIFIED' : 'PARTIAL'), currentness: 'CURRENT',
      evidenceRefs: [P.evidence.document(sr)], methodRef: obs.normalizationMethodRef, metadata: { sourceAuthority: sr && sr.authority || null, rawFieldName: obs.rawFieldName } };
  }
  /** fromAnalysisTrace(output{ value, trace }, ctx) — Analysis Engine contract (§342): module returns trace, service builds the record */
  function fromAnalysisTrace(out, o) {
    const tr = out.trace || {};
    return { organizationId: o.organizationId, developmentId: o.developmentId, entityType: o.entityType || 'LOT', entityId: o.entityId, attributePath: o.attributePath, valueFingerprint: P.fingerprint(out.value),
      provenanceKind: o.kind || 'ANALYSIS_DERIVED', evidenceState: o.evidenceState || 'PARTIAL', currentness: 'CURRENT',
      evidenceRefs: [P.evidence.analysis({ analysisVersion: o.analysisVersion || tr.moduleVersion, moduleId: tr.moduleId, moduleVersion: tr.moduleVersion, methodologyVersion: tr.methodologyVersion }), ...(tr.configRefs || []).map(c => P.evidence.config(c))],
      dependencyRefs: (tr.inputAttributeRefs || []).map(P.dependencyRef), methodRef: o.methodRef || null, metadata: { estimate: !!o.estimate, traceWarnings: tr.warnings || [] } };
  }

  // ------------------------------------------------------------------ domain adapters (Pricing / Availability keep their own provenance; this is a projection — §280)
  const PRICE_PATHS = new Set(['commercial.pricePerM2', 'commercial.currency', 'commercial.priceTableId', 'commercial.priceTableVersion', 'commercial.price', 'commercial.downPaymentDefaultValue', 'commercial.validFrom', 'commercial.validUntil']);
  const pricingAdapter = Object.freeze({
    supports: (entityType, path) => entityType === 'LOT' && PRICE_PATHS.has(path),
    /** recordInput(lot, path, { organizationId, devCfg, depRecords }) — PriceTableVersion (SYSTEM_RECORD with checksum) as evidence; the table file was not received ⇒ PARTIAL */
    recordInput(lot, path, o) {
      const ver = (App.priceHistory.versionsFrom(o.devCfg) || []).find(v => v.priceTableId === lot.commercial.priceTableId && v.version === lot.commercial.priceTableVersion) || null;
      const base = { organizationId: o.organizationId, developmentId: lot.identity.developmentId, entityType: 'LOT', entityId: lot.identity.id, attributePath: path, valueFingerprint: P.fingerprint(P.valueAt(lot, path)), currentness: 'CURRENT' };
      const evid = ver ? [P.evidence.systemRecord({ domain: 'PRICING', recordType: 'PriceTableVersion', recordId: ver.id, recordVersion: ver.version, checksum: ver.checksum })] : [];
      const v = P.valueAt(lot, path);
      if (v == null) { const na = ((P.configOf(lot.identity.developmentId) || {}).notAvailableReasons || {}).fields || {}; return { ...base, provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', evidenceRefs: evid, notAvailableReason: (na[path] || {}).reason || 'UNKNOWN_REASON', metadata: { adapter: 'PRICING', basis: (na[path] || {}).basis || null } }; }
      if (path === 'commercial.price' || path === 'commercial.downPaymentDefaultValue') {
        const m = P.methodRegistry(lot.identity.developmentId).resolveLegacy('price-table-v1', 'price-table', path);
        const deps = (path === 'commercial.price' ? ['geometry.areaM2', 'commercial.pricePerM2'] : ['commercial.price', 'commercial.downPaymentDefaultPercent']).map(p => P.dependencyRef({ organizationId: o.organizationId, entityType: 'LOT', entityId: lot.identity.id, attributePath: p, valueFingerprint: P.fingerprint(P.valueAt(lot, p)), provenanceId: o.depRecords && o.depRecords[p] ? o.depRecords[p].id : undefined }));
        const F = App.pricing.formula, recompute = path === 'commercial.price' ? F.lotPrice(lot.geometry.areaM2, lot.commercial.pricePerM2) : F.downPaymentValue(lot.commercial.price, lot.commercial.downPaymentDefaultPercent); // TD-12
        const reproducible = recompute != null && Math.abs(recompute - v) < 0.011;
        return { ...base, provenanceKind: 'CALCULATED', evidenceState: 'PARTIAL', evidenceRefs: evid, methodRef: m ? P.methodRef(m) : null, dependencyRefs: deps, currentness: reproducible ? 'CURRENT' : 'REVIEW_REQUIRED',
          metadata: { adapter: 'PRICING', reproducible, recomputed: recompute, priceDisclaimer: 'preço de tabela' } };
      }
      return { ...base, provenanceKind: 'DIRECT_SOURCE', evidenceState: ver ? 'PARTIAL' : 'UNRESOLVED', evidenceRefs: evid, metadata: { adapter: 'PRICING', sourceAuthority: null, documentStatus: 'SOURCE_NOT_AVAILABLE', candidateDocumentId: 'doc_vj_price_table_2026_10', legacySourceId: 'price-table-v1' } };
    },
    summary: (svc, t, lot, path) => svc.summaryOf(t, svc.repo.current(t, 'LOT', lot.identity.id, path)) });
  const availabilityAdapter = Object.freeze({
    supports: (entityType, path) => entityType === 'LOT' && /^availability\./.test(path),
    /** UNKNOWN never becomes AVAILABLE; no feed ingested ⇒ NOT_AVAILABLE / SOURCE_NOT_INGESTED (value fingerprint is still the real stored value) */
    recordInput(lot, path, o) {
      const a = lot.availability, base = { organizationId: o.organizationId, developmentId: lot.identity.developmentId, entityType: 'LOT', entityId: lot.identity.id, attributePath: path, valueFingerprint: P.fingerprint(P.valueAt(lot, path)), currentness: 'CURRENT' };
      const rev = P.evidence.systemRecord({ domain: 'AVAILABILITY', recordType: 'AvailabilityRevision', recordId: lot.identity.id + '#' + a.revision, recordVersion: a.revision });
      const reg = P.methodRegistry(lot.identity.developmentId);
      if (path === 'availability.revision') return { ...base, provenanceKind: 'DIRECT_SOURCE', evidenceState: 'VERIFIED', evidenceRefs: [rev], metadata: { adapter: 'AVAILABILITY' } };
      if (path === 'availability.freshness') { const m = reg.list().find(x => x.methodId === 'availability_freshness_policy');
        return { ...base, provenanceKind: 'CALCULATED', evidenceState: a.sourceId ? 'PARTIAL' : 'MISSING', evidenceRefs: [rev], methodRef: m ? P.methodRef(m) : null, dependencyRefs: [P.dependencyRef({ organizationId: o.organizationId, entityType: 'LOT', entityId: lot.identity.id, attributePath: 'availability.updatedAt', valueFingerprint: P.fingerprint(a.updatedAt) })], metadata: { adapter: 'AVAILABILITY' } }; }
      if (a.sourceId) return { ...base, provenanceKind: 'DIRECT_SOURCE', evidenceState: 'PARTIAL', evidenceRefs: [rev, P.evidence.systemRecord({ domain: 'AVAILABILITY', recordType: 'AvailabilitySource', recordId: a.sourceId })], metadata: { adapter: 'AVAILABILITY' } };
      return { ...base, provenanceKind: 'NOT_AVAILABLE', evidenceState: 'MISSING', evidenceRefs: [rev], notAvailableReason: 'SOURCE_NOT_INGESTED', metadata: { adapter: 'AVAILABILITY', basis: 'Sem espelho de vendas: estado UNKNOWN (nunca tratado como disponível).' } };
    },
    summary: (svc, t, lot, path) => svc.summaryOf(t, svc.repo.current(t, 'LOT', lot.identity.id, path)) });

  // ------------------------------------------------------------------ ProvenanceCache (tenant-namespaced; invalidated by revision)
  function createCache() {
    const m = new Map();
    return Object.freeze({ key: (org, entityType, entityId, path, mode, rev) => App.tenancy.scopedKey(org, 'prov', entityType, entityId, path, mode, rev),
      get: k => m.get(k) || null, set: (k, v) => { m.set(k, v); }, size: () => m.size,
      invalidateEntity(org, entityType, entityId) { const p = App.tenancy.scopedKey(org, 'prov', entityType, entityId, ''); for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); },
      clearOrganization(org) { const p = 'org:' + org + ':'; for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); }, clear: () => m.clear() });
  }
  /** DTOs (API) */
  const toSummaryDto = (path, fp, s) => ({ attributePath: path, valueFingerprint: fp, summary: { kind: s.kind, evidenceState: s.evidenceState, currentness: s.currentness, displayCode: s.displayCode, sourceCount: s.sourceCount, hasConflict: s.hasConflict } });

  return Object.freeze({ createIndex, createRepository, createEventLog, createGraph, createService, createCache, NORMALIZERS, rawObservation, normalize, buildFromObservation, fromAnalysisTrace, pricingAdapter, availabilityAdapter, toSummaryDto });
})();
