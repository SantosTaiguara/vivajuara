/* documents/documentServices.js — Document Domain services (topic 32).
   Store (port, in memory here; Postgres + object storage in the backend) → tenant-aware
   DocumentRepository → DocumentStorageService (tenant namespace, quarantine, short-lived
   download tokens) → DocumentIngestionService (stage → scan → detect → hash → match → version →
   validate → extract) → DocumentPublisher (immutable published versions, atomic current pointer)
   → DocumentVersionResolver → DocumentSearchService (tenant + authorization filter BEFORE any
   snippet) → DocumentPreviewService (lazy, error-bounded) → DocumentApplicationService.
   Every call takes a TenantContext ({ organizationId }); a foreign document is "not found".
   Legacy catalog: seedLegacy() loads the documents inventoried in plat/config/documents. */
App.documentServices = (() => {
  const D = App.documents, I = App.integrity, err = D.err, freeze = D.freeze, clone = D.clone, iso = D.iso;
  const orgOf = t => { if (!t || !t.organizationId) throw Object.assign(new Error('operação de documento sem TenantContext'), { code: 'TENANT_UNRESOLVED' }); return t.organizationId; };

  // ------------------------------------------------------------------ store (port) — append-oriented; published rows are never replaced by content changes
  function createStore() {
    const orgs = new Map();
    const b = org => { if (!orgs.has(org)) orgs.set(org, { documents: new Map(), versions: new Map(), assets: new Map(), representations: new Map(), extractions: new Map(), relations: new Map(),
      batches: new Map(), snapshots: new Map(), collections: new Map(), operational: new Map(), blobs: new Map(), tokens: new Map() }); return orgs.get(org); };
    return { bucket: b, organizations: () => [...orgs.keys()], clearOrganization: org => orgs.delete(org) };
  }

  // ------------------------------------------------------------------ DocumentRepository (tenant-aware; every method requires the TenantContext)
  function createRepository(store) {
    const B = t => store.bucket(orgOf(t));
    const own = (t, x) => x && x.organizationId === orgOf(t) ? x : null;
    const repo = {
      getDocument: (t, id) => own(t, B(t).documents.get(id)) || null,
      getVersion: (t, id) => own(t, B(t).versions.get(id)) || null,
      getAsset: (t, id) => own(t, B(t).assets.get(id)) || null,
      listVersions: (t, docId) => [...B(t).versions.values()].filter(v => v.documentId === docId).sort((a, b) => a.versionNumber - b.versionNumber),
      listDocuments: t => [...B(t).documents.values()],
      listRepresentations: (t, versionId) => [...B(t).representations.values()].filter(r => r.documentVersionId === versionId),
      listExtractions: (t, versionId) => [...B(t).extractions.values()].filter(r => r.documentVersionId === versionId),
      listRelations: (t, f = {}) => [...B(t).relations.values()].filter(r => (!f.documentId || r.documentId === f.documentId) && (!f.targetType || r.targetType === f.targetType) && (!f.targetId || r.targetId === f.targetId)),
      /** searchMetadata(t, { text, documentType, authority, classification, status, tags }) — metadata only, unauthorized rows still filtered by the caller's access */
      searchMetadata(t, f = {}) {
        const q = (f.text || '').toLowerCase();
        return repo.listDocuments(t).filter(d => (!f.documentType || d.documentType === f.documentType) && (!f.authority || d.authority === f.authority) && (!f.classification || d.classification === f.classification)
          && (!f.status || d.lifecycleStatus === f.status) && (!f.tags || f.tags.every(x => d.tags.includes(x))) && (!q || (d.title + ' ' + (d.description || '') + ' ' + (d.documentCode || '')).toLowerCase().includes(q)));
      },
      listByScope(t, s = {}) {
        const rel = repo.listRelations(t, { targetType: s.targetType, targetId: s.targetId }).map(r => r.documentId);
        return repo.listDocuments(t).filter(d => rel.includes(d.id) || (s.targetType === 'DEVELOPMENT' && d.developmentId === s.targetId && d.scope.scopeType === 'DEVELOPMENT')
          || (s.targetType === 'LOT' && (d.scope.lotIds || []).includes(s.targetId)) || (s.targetType === 'BLOCK' && (d.scope.blockIds || []).includes(s.targetId)));
      },
      saveDraft(t, doc) { if (doc.organizationId !== orgOf(t)) return err('TENANT_MISMATCH'); const cur = B(t).documents.get(doc.id); if (cur && cur.organizationId !== doc.organizationId) return err('TENANT_MISMATCH'); B(t).documents.set(doc.id, freeze(doc)); return { ok: true, document: doc }; },
      /** putVersion: insert, or replace only while the content is not published (otherwise PUBLISHED_VERSION_IMMUTABLE) */
      putVersion(t, v) {
        if (v.organizationId !== orgOf(t)) return err('TENANT_MISMATCH');
        const cur = B(t).versions.get(v.id);
        if (cur) { const c = D.checkVersionPatch(cur, v); if (!c.ok) return c; }
        B(t).versions.set(v.id, freeze(v)); return { ok: true, version: v };
      },
      putAsset(t, a) { if (a.organizationId !== orgOf(t)) return err('TENANT_MISMATCH'); const cur = B(t).assets.get(a.id); if (cur && cur.contentChecksum && a.contentChecksum !== cur.contentChecksum) return err('PUBLISHED_VERSION_IMMUTABLE', 'bytes de um FileAsset não mudam'); B(t).assets.set(a.id, freeze(a)); return { ok: true, asset: a }; },
      putRepresentation(t, r) { if (r.organizationId !== orgOf(t)) return err('TENANT_MISMATCH'); B(t).representations.set(r.id, freeze(r)); return { ok: true }; },
      putExtraction(t, x) { if (x.organizationId !== orgOf(t)) return err('TENANT_MISMATCH'); B(t).extractions.set(x.id, freeze(x)); return { ok: true }; },
      putRelation(t, r) { if (r.organizationId !== orgOf(t)) return err('TENANT_MISMATCH'); B(t).relations.set(r.id, freeze(r)); return { ok: true }; },
      /** operational metadata (index/preview status) may change without a new version */
      setOperational(t, versionId, patch) { const v = repo.getVersion(t, versionId); if (!v) return err('DOCUMENT_VERSION_NOT_FOUND'); const cur = B(t).operational.get(versionId) || {}; B(t).operational.set(versionId, freeze({ ...cur, ...patch })); return { ok: true }; },
      getOperational: (t, versionId) => B(t).operational.get(versionId) || null,
      findAssetsByChecksum: (t, checksum) => [...B(t).assets.values()].filter(a => a.contentChecksum === checksum),
      archive(t, docId, { now, actor } = {}) { const d = repo.getDocument(t, docId); if (!d) return err('DOCUMENT_NOT_FOUND'); const nd = { ...clone(d), lifecycleStatus: 'ARCHIVED', updatedAt: iso(now), revision: d.revision + 1, metadata: { ...d.metadata, archivedBy: actor || null } }; B(t).documents.set(docId, freeze(nd)); return { ok: true, document: nd }; },
      putBatch: (t, x) => { B(t).batches.set(x.id, freeze(x)); }, getBatch: (t, id) => own(t, B(t).batches.get(id)) || null,
      putSnapshot: (t, s) => { B(t).snapshots.set(s.snapshotId, freeze(s)); }, getSnapshot: (t, id) => own(t, B(t).snapshots.get(id)) || null,
      putCollection: (t, c) => { B(t).collections.set(c.id, freeze(c)); }, getCollection: (t, id) => own(t, B(t).collections.get(id)) || null,
      /** hard delete: only staged/unpublished content, allowed by retention, not referenced as evidence */
      deleteVersion(t, versionId, { referencedBy = [], devId } = {}) {
        const v = repo.getVersion(t, versionId); if (!v) return err('DOCUMENT_VERSION_NOT_FOUND');
        const d = repo.getDocument(t, v.documentId), pol = D.retentionPolicy(devId || (d && d.developmentId), d && d.classification);
        const staged = ['DRAFT', 'UPLOADED', 'REJECTED'].includes(v.lifecycleStatus);
        if (!staged || referencedBy.length || (!pol.allowHardDelete && pol.retentionClass !== 'TEMPORARY' && !(staged && v.lifecycleStatus === 'REJECTED')))
          return err('RETENTION_POLICY_BLOCKED', null, { referencedBy: referencedBy.length, status: v.lifecycleStatus, retentionClass: pol.retentionClass });
        B(t).versions.delete(versionId); return { ok: true };
      }
    };
    return Object.freeze(repo);
  }

  // ------------------------------------------------------------------ DocumentStorageService (tenant namespace; path is never access control)
  function createStorage(store, opts = {}) {
    let seq = 0;
    const ns = (org, docId, verId, assetId) => `organizations/${org}/documents/${docId}/versions/${verId}/${assetId}`;
    return Object.freeze({
      namespace: ns,
      /** put(t, { documentId, versionId, assetId, bytes }) → { storageKey, contentChecksum, sizeBytes } */
      put(t, o) {
        const org = orgOf(t), key = ns(org, o.documentId, o.versionId, o.assetId), bytes = o.bytes instanceof Uint8Array ? o.bytes : I.utf8(String(o.bytes || ''));
        store.bucket(org).blobs.set(key, { bytes, quarantined: false });
        return { ok: true, storageKey: key, contentChecksum: 'sha256:' + I.sha256(bytes), sizeBytes: bytes.length };
      },
      verifyChecksum(t, storageKey, checksum) { const x = store.bucket(orgOf(t)).blobs.get(storageKey); if (!x) return err('STORAGE_ERROR'); const ok = 'sha256:' + I.sha256(x.bytes) === checksum; return ok ? { ok: true } : err('CHECKSUM_MISMATCH'); },
      quarantine(t, storageKey) { const x = store.bucket(orgOf(t)).blobs.get(storageKey); if (x) x.quarantined = true; return { ok: !!x }; },
      deleteTemporary(t, storageKey) { store.bucket(orgOf(t)).blobs.delete(storageKey); return { ok: true }; },
      /** issueDownload(t, { storageKey, ttlMs, now }) → { token, expiresAt } — only after authorization; never returns the storage key or any secret */
      issueDownload(t, o) {
        const org = orgOf(t), x = store.bucket(org).blobs.get(o.storageKey);
        if (!x || x.quarantined) return err('SIGNED_URL_FAILED');
        const now = typeof o.now === 'number' ? o.now : Date.parse(o.now), ttl = Math.min(o.ttlMs || 300000, o.maxTtlMs || 900000);
        const token = 'dl_' + I.sha256([org, o.storageKey, now, ++seq, opts.salt || ''].join('|')).slice(0, 40);
        store.bucket(org).tokens.set(token, { storageKey: o.storageKey, expiresAt: now + ttl });
        return { ok: true, token, expiresAt: new Date(now + ttl).toISOString() };
      },
      redeem(t, token, { now } = {}) {
        const org = orgOf(t), rec = store.bucket(org).tokens.get(token), ms = typeof now === 'number' ? now : Date.parse(now);
        if (!rec) return err('SIGNED_URL_FAILED'); if (ms >= rec.expiresAt) { store.bucket(org).tokens.delete(token); return err('SIGNED_URL_EXPIRED'); }
        const x = store.bucket(org).blobs.get(rec.storageKey); return x && !x.quarantined ? { ok: true, bytes: x.bytes } : err('SIGNED_URL_FAILED');
      },
      read(t, storageKey) { const x = store.bucket(orgOf(t)).blobs.get(storageKey); return x && !x.quarantined ? { ok: true, bytes: x.bytes } : err('STORAGE_ERROR'); }
    });
  }

  // ------------------------------------------------------------------ events / audit / observability (no content, no PII, no filenames)
  function createEventLog() {
    const events = [], metrics = {};
    return Object.freeze({
      emit(type, p = {}) { if (!D.EVENTS[type]) return null; const e = freeze({ type, organizationId: p.organizationId, documentId: p.documentId || null, versionId: p.versionId || null, actorRef: p.actorRef || null,
        timestamp: iso(p.now) || null, correlationId: p.correlationId || null, metadata: clone(p.metadata || {}) }); events.push(e); return e; },
      count(name, n = 1) { metrics[name] = (metrics[name] || 0) + n; }, list: () => events.slice(), metrics: () => ({ ...metrics }) });
  }

  // ------------------------------------------------------------------ DocumentSearchService (tenant + authorization filter before any title/snippet)
  function createSearch(repo) {
    const index = new Map(); // org → Map(versionId → record)
    const ix = t => { const o = orgOf(t); if (!index.has(o)) index.set(o, new Map()); return index.get(o); };
    function indexVersion(t, docId, versionId, { now, extractedText } = {}) {
      const d = repo.getDocument(t, docId), v = repo.getVersion(t, versionId); if (!d || !v) return err('INDEXING_FAILED');
      const prev = ix(t).get(versionId);
      const rec = freeze({ organizationId: d.organizationId, documentId: d.id, documentVersionId: v.id, title: d.title, documentType: d.documentType, scopeRefs: [d.scope.scopeType, d.developmentId].filter(Boolean),
        tags: d.tags.slice(), authority: d.authority, classification: d.classification, extractedTextRef: extractedText != null ? 'text:' + v.id : null, searchableFields: { description: d.description || '', code: d.documentCode || '' },
        text: extractedText != null ? String(extractedText) : (prev ? prev.text : null), indexVersion: prev ? prev.indexVersion + 1 : 1, indexedAt: iso(now) });
      ix(t).set(versionId, rec); repo.setOperational(t, versionId, { indexStatus: 'INDEXED', indexVersion: rec.indexVersion }); return { ok: true, record: rec };
    }
    const tokens = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
    /** search(t, { text, mode, filters }, access) → DocumentSearchResult[] — relevance never means authority */
    function search(t, q = {}, access = {}) {
      const mode = D.SearchMode[q.mode] ? q.mode : 'METADATA', want = tokens(q.text), out = [];
      for (const rec of ix(t).values()) {
        if (rec.organizationId !== orgOf(t)) continue;
        const d = repo.getDocument(t, rec.documentId), v = repo.getVersion(t, rec.documentVersionId);
        if (!d || !v) continue;
        if (v.id !== d.currentPublishedVersionId && !(access.mode === 'TECHNICAL' || access.mode === 'AUDIT')) continue; // default: current published only
        const f = q.filters || {};
        if ((f.documentType && d.documentType !== f.documentType) || (f.authority && d.authority !== f.authority) || (f.classification && d.classification !== f.classification) || (f.tags && !f.tags.every(x => d.tags.includes(x)))) continue;
        const dec = D.decide(d, { action: 'READ', version: v, access }); if (!dec.allowed) continue; // no title, no snippet, no count for inaccessible documents
        const meta = tokens([rec.title, rec.searchableFields.description, rec.searchableFields.code, ...rec.tags].join(' ')), body = mode === 'METADATA' ? [] : tokens(rec.text);
        const hitsMeta = want.filter(w => meta.some(m => m.startsWith(w))).length, hitsBody = want.filter(w => body.includes(w)).length;
        const score = mode === 'METADATA' ? hitsMeta : mode === 'FULL_TEXT' ? hitsBody : hitsMeta + hitsBody;
        if (want.length && !score) continue;
        let snippet = null;
        if (mode !== 'METADATA' && rec.text && hitsBody) { const lower = rec.text.toLowerCase(), i = lower.indexOf(want.find(w => lower.includes(w)) || ''); snippet = i >= 0 ? rec.text.slice(Math.max(0, i - 40), i + 80) : null; }
        out.push(freeze({ documentId: d.id, documentVersionId: v.id, title: d.title, documentType: d.documentType, snippet, locator: null, relevanceScore: want.length ? score / want.length : null,
          accessMode: D.decide(d, { action: 'DOWNLOAD', version: v, access }).allowed ? 'DOWNLOAD' : 'PREVIEW', metadata: { authority: d.authority, indexVersion: rec.indexVersion } }));
      }
      return out.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0) || (a.title < b.title ? -1 : 1));
    }
    return Object.freeze({ indexVersion, search, record: (t, versionId) => ix(t).get(versionId) || null, clearOrganization: org => index.delete(org) });
  }

  // ------------------------------------------------------------------ DocumentPreviewService (metadata first, content on demand; failure is contained)
  function previewPlan(version, asset, reps = []) {
    try {
      if (!version || !asset) return freeze({ status: 'UNAVAILABLE', type: 'DOWNLOAD_ONLY', reason: 'PRIMARY_FILE_MISSING', lazy: true, textAlternative: true });
      const m = asset.detectedMediaType || asset.mediaType, page = reps.find(r => r.type === 'PAGE_IMAGE' || r.type === 'PDF_PREVIEW' || r.type === 'THUMBNAIL');
      const type = m === 'application/pdf' ? 'PDF_VIEWER' : /^image\//.test(m || '') && !/svg/.test(m) ? 'IMAGE' : /spreadsheet|csv/.test(m || '') ? 'SPREADSHEET_SUMMARY' : /^text\//.test(m || '') && !/html/.test(m) ? 'TEXT' : 'DOWNLOAD_ONLY';
      return freeze({ status: 'READY', type, lazy: true, pageLazyLoad: type === 'PDF_VIEWER', pageCount: (asset.metadata && asset.metadata.pageCount) || null, derivedRepresentationId: page ? page.id : null,
        originalPreserved: true, keyboardNavigation: type === 'PDF_VIEWER', textAlternative: true });
    } catch (e) { return freeze({ status: 'FAILED', type: 'DOWNLOAD_ONLY', reason: 'PREVIEW_FAILED', lazy: true, textAlternative: true }); }
  }

  // ------------------------------------------------------------------ DocumentMetadataCache (tenant-namespaced; private content is not cached offline)
  function createMetadataCache(policy = D.DEFAULT_ACCESS_POLICY) {
    const m = new Map();
    const key = (org, docId, verId, rev) => App.tenancy.scopedKey(org, 'doc', docId, verId || '-', rev || 0);
    const previewKey = (org, verId, type, gen) => App.tenancy.scopedKey(org, 'preview', verId, type, gen || '-');
    return Object.freeze({ key, previewKey,
      set(k, v) { m.set(k, v); }, get: k => m.get(k) ?? null, size: () => m.size,
      allowOffline: (doc, what = 'METADATA') => what === 'METADATA' ? !!policy.offlineRules.cacheMetadata : doc && doc.classification === 'PUBLIC' ? !!policy.offlineRules.cachePublicContent : !!policy.offlineRules.cachePrivateContent,
      /** tenant switch / logout: everything of the previous organization goes away */
      clearOrganization(org) { const p = 'org:' + org + ':'; for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); }, clear() { m.clear(); } });
  }

  // ------------------------------------------------------------------ application service
  /** createService({ store?, now?, scanner?, extractor? }) → DocumentApplicationService
      scanner(bytes, meta) → 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS' | 'NOT_SCANNED' (port; default NOT_SCANNED — there is no scanner in the frontend)
      extractor(bytes, meta) → { status, outputType, text?, quality?, method?, extractorId, extractorVersion } (port; default NOT_SUPPORTED) */
  function createService(o = {}) {
    const store = o.store || createStore(), repo = createRepository(store), storage = createStorage(store, o), search = createSearch(repo), events = o.events || createEventLog();
    const clock = () => o.now != null ? (typeof o.now === 'function' ? o.now() : o.now) : Date.now();
    const nowIso = () => iso(clock());
    const scanner = o.scanner || (() => 'NOT_SCANNED'), extractor = o.extractor || (() => ({ status: 'NOT_SUPPORTED', extractorId: 'none', extractorVersion: null }));
    const actorOf = a => a && a.principalId ? 'user:' + a.principalId : null;
    const guard = (t, doc, access, action, version) => { const d = D.decide(doc, { action, version, access: { ...access, organizationId: access && access.organizationId || t.organizationId } });
      if (!d.allowed) { events.emit('DocumentAccessDenied', { organizationId: t.organizationId, documentId: doc && !d.hideExistence ? doc.id : null, now: clock(), metadata: { reason: d.reason, action } }); events.count('access_denied'); } return d; };
    const notFound = () => err('DOCUMENT_NOT_FOUND');
    const can = (access, key, t) => !!(access && typeof access.can === 'function' && access.can(key, { organizationId: t.organizationId }));

    function createDocumentCmd(t, input, access) {
      if (!can(access, D.PERMISSIONS.UPLOAD, t) && !can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      const doc = D.createDocument({ ...input, organizationId: orgOf(t) }, { now: clock(), actor: actorOf(access) });
      if (repo.getDocument(t, doc.id)) return err('VERSION_CONFLICT', 'documento já existe');
      const types = D.typeRegistry(doc.developmentId);
      if (!types.has(doc.documentType)) return err('INVALID_DOCUMENT_TYPE');
      const sc = D.validateScope(doc.scope, doc); if (sc.length) return err(sc[0] === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'INVALID_SCOPE');
      repo.saveDraft(t, doc); events.emit('DocumentCreated', { organizationId: doc.organizationId, documentId: doc.id, actorRef: actorOf(access), now: clock() });
      return { ok: true, document: doc };
    }
    /** matchDocument(t, item) → { kind: 'EXISTING'|'NEW'|'REVIEW', document?, reason } — a filename alone never matches */
    function matchDocument(t, item) {
      if (item.documentId) { const d = repo.getDocument(t, item.documentId); return d ? { kind: 'EXISTING', document: d, reason: 'EXPLICIT_DOCUMENT_ID' } : { kind: 'REVIEW', reason: 'DOCUMENT_NOT_FOUND' }; }
      const all = repo.listDocuments(t);
      if (item.documentCode) { const c = all.filter(d => d.documentCode === item.documentCode); if (c.length === 1) return { kind: 'EXISTING', document: c[0], reason: 'DOCUMENT_CODE' }; if (c.length > 1) return { kind: 'REVIEW', reason: 'AMBIGUOUS_CODE' }; }
      if (item.externalId) { const c = all.filter(d => d.sourceSystemRef && d.sourceSystemRef.externalId === item.externalId); if (c.length === 1) return { kind: 'EXISTING', document: c[0], reason: 'EXTERNAL_ID' }; if (c.length > 1) return { kind: 'REVIEW', reason: 'AMBIGUOUS_EXTERNAL_ID' }; }
      if (item.issuerDocumentNumber) { const c = all.filter(d => d.issuerRef && d.issuerRef.documentNumber === item.issuerDocumentNumber); if (c.length === 1) return { kind: 'EXISTING', document: c[0], reason: 'ISSUER_NUMBER' }; if (c.length > 1) return { kind: 'REVIEW', reason: 'AMBIGUOUS_ISSUER_NUMBER' }; }
      if (item.newDocument) return { kind: 'NEW', reason: 'EXPLICIT_NEW' };
      return { kind: 'REVIEW', reason: 'NO_STABLE_IDENTIFIER' }; // never auto-merge by filename or similarity
    }
    /** ingest(t, { origin, developmentId, sourceRef, items, duplicatePolicy }, access) → DocumentIngestionBatch (versions end UPLOADED, never PUBLISHED) */
    function ingest(t, req = {}, access) {
      if (!can(access, D.PERMISSIONS.UPLOAD, t)) return err('DOCUMENT_ACCESS_DENIED');
      const org = orgOf(t), now = clock(), batchId = I.stableId('dib', org, req.sourceRef || null, now, (req.items || []).length), items = [], warnings = [], errors = [];
      const dupPolicy = D.DuplicatePolicy[req.duplicatePolicy] ? req.duplicatePolicy : D.duplicatePolicy(req.developmentId);
      for (const [n, it] of (req.items || []).entries()) {
        const r = { index: n, status: 'UPLOADED', documentId: null, versionId: null, fileAssetId: null, warnings: [], errors: [] };
        try {
          const bytes = it.bytes != null ? (it.bytes instanceof Uint8Array ? it.bytes : I.utf8(String(it.bytes))) : null;
          if (!bytes && !it.externalRef) { r.status = 'FAILED'; r.errors.push('PRIMARY_FILE_MISSING'); items.push(r); continue; }
          const scan = bytes ? scanner(bytes, { filename: it.filename }) : 'NOT_SCANNED';                                 // Security Scan
          const det = bytes ? I.detectMediaType(bytes) : { mediaType: null, scriptable: false };                            // Detect Type
          const checksum = bytes ? 'sha256:' + I.sha256(bytes) : (it.externalRef && it.externalRef.snapshotChecksum) || null; // Hash
          if (scan === 'MALICIOUS' || scan === 'SUSPICIOUS') { r.status = 'QUARANTINED'; r.errors.push('MALWARE_DETECTED'); events.count('quarantined'); }
          const m = matchDocument(t, it);                                                                                     // Match Document
          let doc = m.document || null;
          if (m.kind === 'REVIEW') { r.status = 'READY_FOR_REVIEW'; r.warnings.push('REQUIRES_REVIEW:' + m.reason); items.push(r); continue; }
          const same = checksum ? repo.findAssetsByChecksum(t, checksum) : [];                                                // Duplicate policy (own tenant only)
          let reuse = null;
          if (same.length && r.status !== 'QUARANTINED') {
            const sameDocVersion = doc && repo.listVersions(t, doc.id).some(v => v.contentChecksum === checksum && v.lifecycleStatus !== 'REJECTED');
            if (sameDocVersion || dupPolicy === 'REJECT_EXACT_DUPLICATE') { r.status = 'REJECTED'; r.errors.push('DUPLICATE_VERSION'); items.push(r); continue; }
            if (dupPolicy === 'REQUIRE_REVIEW') { r.status = 'READY_FOR_REVIEW'; r.warnings.push('DUPLICATE_CONTENT'); items.push(r); continue; }
            r.warnings.push('DUPLICATE_CONTENT'); if (dupPolicy === 'LINK_EXISTING_ASSET') reuse = same[0];
          }
          if (!doc) { const c = createDocumentCmd(t, { ...it.newDocument, developmentId: it.newDocument.developmentId || req.developmentId, origin: req.origin || 'UPLOAD' }, access); if (!c.ok) { r.status = 'FAILED'; r.errors.push(c.code); items.push(r); continue; } doc = c.document; }
          const versions = repo.listVersions(t, doc.id), versionNumber = versions.length ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1;
          const versionId = I.stableId('docver', org, doc.id, versionNumber, checksum), assetId = reuse ? reuse.id : I.stableId('fa', org, versionId, checksum);
          let asset = reuse;
          if (!asset) {
            const put = bytes && r.status !== 'QUARANTINED' ? storage.put(t, { documentId: doc.id, versionId, assetId, bytes }) : null;
            if (bytes && r.status === 'QUARANTINED') { const q = storage.put(t, { documentId: doc.id, versionId, assetId, bytes }); storage.quarantine(t, q.storageKey); }
            asset = D.createFileAsset({ id: assetId, organizationId: org, storageProvider: bytes ? 'MANAGED' : 'EXTERNAL_REFERENCE', storageKey: put ? put.storageKey : bytes ? storage.namespace(org, doc.id, versionId, assetId) : null,
              originalFilename: it.filename || null, mediaType: it.declaredMediaType || null, detectedMediaType: det.mediaType, sizeBytes: bytes ? bytes.length : (it.externalRef && it.externalRef.sizeBytes) || null,
              contentChecksum: checksum, uploadStatus: r.status === 'QUARANTINED' ? 'QUARANTINED' : 'UPLOADED', securityScanStatus: D.SecurityScanStatus[scan] ? scan : 'NOT_SCANNED',
              metadata: it.externalRef ? { externalRef: D.externalDocumentRef(it.externalRef) } : {} }, { now, actor: actorOf(access) });
            repo.putAsset(t, asset);
          }
          const version = D.createVersion({ id: versionId, organizationId: org, documentId: doc.id, versionNumber, versionLabel: it.versionLabel, lifecycleStatus: r.status === 'QUARANTINED' ? 'REJECTED' : 'UPLOADED',
            sourceEffectiveFrom: it.sourceEffectiveFrom, sourceEffectiveTo: it.sourceEffectiveTo, issuedAt: it.issuedAt, supersedesVersionId: versions.length ? versions[versions.length - 1].id : null,
            primaryFileAssetId: asset.id, fileAssetIds: [asset.id], contentChecksum: checksum, authority: doc.authority, scope: doc.scope, issuerRef: doc.issuerRef, notes: it.notes, metadata: { origin: req.origin || 'UPLOAD' } }, { now, actor: actorOf(access) });
          const val = D.validateVersion({ document: doc, version, assets: [asset], versions, tenant: t, bytes });            // Validate
          const v2 = D.createVersion({ ...version, validationSummary: { valid: val.valid, errors: val.errors, warnings: val.warnings, policyVersion: val.policyVersion } });
          const put = repo.putVersion(t, v2); if (!put.ok) { r.status = 'FAILED'; r.errors.push(put.code); items.push(r); continue; }
          repo.saveDraft(t, D.createDocument({ ...clone(doc), latestVersionId: v2.id, updatedAt: iso(now), revision: doc.revision + 1 }));
          events.emit('DocumentVersionUploaded', { organizationId: org, documentId: doc.id, versionId: v2.id, actorRef: actorOf(access), now, correlationId: batchId });
          if (r.status !== 'QUARANTINED' && bytes) {                                                                          // Extract / Preview (derived; failure never invalidates the original)
            let x; try { x = extractor(bytes, { mediaType: det.mediaType }) || {}; } catch (e) { x = { status: 'FAILED', extractorId: 'unknown', errors: ['EXTRACTION_FAILED'] }; }
            const ex = D.createExtractionResult({ id: I.stableId('dex', org, v2.id, x.extractorId, x.extractorVersion || null), organizationId: org, documentVersionId: v2.id, extractorId: x.extractorId || 'unknown', extractorVersion: x.extractorVersion,
              status: x.status, outputType: x.outputType || null, outputRef: x.text != null ? 'text:' + v2.id : null, quality: x.quality, method: x.method || null, warnings: x.warnings, errors: x.errors }, { now });
            repo.putExtraction(t, ex);
            if (x.text != null && (ex.status === 'SUCCEEDED' || ex.status === 'PARTIAL')) repo.putRepresentation(t, D.createRepresentation({ id: I.stableId('rep', org, v2.id, 'EXTRACTED_TEXT', x.extractorVersion || null), organizationId: org, documentVersionId: v2.id,
              type: 'EXTRACTED_TEXT', contentRef: 'text:' + v2.id, generatorId: x.extractorId, generatorVersion: x.extractorVersion, quality: x.quality, metadata: { method: x.method || null, ocr: x.method === 'OCR' } }, { now }));
            if (ex.status === 'FAILED') r.warnings.push('EXTRACTION_FAILED');
            events.emit('DocumentExtractionCompleted', { organizationId: org, documentId: doc.id, versionId: v2.id, now, metadata: { status: ex.status } });
            if (x.text != null) search.indexVersion(t, doc.id, v2.id, { now, extractedText: x.text });
          }
          r.documentId = doc.id; r.versionId = v2.id; r.fileAssetId = asset.id; r.validation = val;
          if (r.status !== 'QUARANTINED') r.status = 'READY_FOR_REVIEW';
          r.warnings.push(...val.warnings);
        } catch (e) { r.status = 'FAILED'; r.errors.push(e.code || 'UPLOAD_FAILED'); }
        items.push(r);
      }
      const ok = items.filter(x => x.status === 'READY_FOR_REVIEW').length;
      const status = !items.length ? 'FAILED' : ok === items.length ? 'READY_FOR_REVIEW' : ok ? 'PARTIAL' : items.every(x => x.status === 'REJECTED') ? 'REJECTED' : 'FAILED';
      const batch = freeze({ id: batchId, organizationId: org, developmentId: req.developmentId || null, origin: req.origin || 'UPLOAD', sourceRef: req.sourceRef || null, items, status, createdAt: iso(now), createdBy: actorOf(access),
        summary: { total: items.length, readyForReview: ok, rejected: items.filter(x => x.status === 'REJECTED').length, quarantined: items.filter(x => x.status === 'QUARANTINED').length, failed: items.filter(x => x.status === 'FAILED').length }, warnings, errors });
      repo.putBatch(t, batch); return { ok: true, batch };
    }
    /** validateVersion(t, versionId, access) → marks VALIDATED when valid (content untouched) */
    function validateVersionCmd(t, versionId, access) {
      if (!can(access, D.PERMISSIONS.VALIDATE, t) && !can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      const v = repo.getVersion(t, versionId); if (!v) return err('DOCUMENT_VERSION_NOT_FOUND'); const d = repo.getDocument(t, v.documentId);
      const res = D.validateVersion({ document: d, version: v, assets: v.fileAssetIds.map(id => repo.getAsset(t, id)).filter(Boolean), versions: repo.listVersions(t, d.id), tenant: t, extractions: repo.listExtractions(t, v.id) });
      if (res.valid && v.lifecycleStatus === 'UPLOADED') { repo.putVersion(t, D.createVersion({ ...clone(v), lifecycleStatus: 'VALIDATED', validatedAt: nowIso(), validatedBy: actorOf(access), validationSummary: { valid: true, errors: [], warnings: res.warnings, policyVersion: res.policyVersion } }));
        events.emit('DocumentVersionValidated', { organizationId: t.organizationId, documentId: d.id, versionId: v.id, actorRef: actorOf(access), now: clock() }); }
      return { ok: res.valid, result: res, code: res.valid ? null : 'VALIDATION_FAILED' };
    }
    /** publish(t, docId, versionId, access) — preconditions; old current → SUPERSEDED (kept for audit); pointer switched in one assignment */
    function publish(t, docId, versionId, access, opts = {}) {
      if (!can(access, D.PERMISSIONS.PUBLISH, t) && !can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      const d = repo.getDocument(t, docId), v = repo.getVersion(t, versionId); if (!d) return notFound(); if (!v || v.documentId !== d.id) return err('DOCUMENT_VERSION_NOT_FOUND');
      if (opts.expectedRevision != null && opts.expectedRevision !== d.revision) return err('VERSION_CONFLICT', 'o documento mudou; recarregue antes de publicar', { currentRevision: d.revision });
      if (v.lifecycleStatus === 'PUBLISHED') return { ok: true, unchanged: true, document: d, version: v };
      if (v.lifecycleStatus !== 'VALIDATED') return err('VERSION_CONFLICT', 'apenas versões validadas podem ser publicadas', { status: v.lifecycleStatus });
      const assets = v.fileAssetIds.map(id => repo.getAsset(t, id)).filter(Boolean);
      const res = D.validateVersion({ document: d, version: v, assets, versions: repo.listVersions(t, d.id), tenant: t, stage: 'PUBLISH', existing: true });
      const blocking = res.errors.filter(e => e !== 'DUPLICATE_VERSION');
      if (blocking.length) return err(blocking.includes('MALWARE_DETECTED') ? 'MALWARE_SUSPECTED' : blocking.includes('SECURITY_SCAN_REQUIRED') ? 'SECURITY_SCAN_FAILED' : 'VERSION_CONFLICT', 'pré-condições de publicação não atendidas', { errors: blocking });
      const now = clock(), prev = d.currentPublishedVersionId ? repo.getVersion(t, d.currentPublishedVersionId) : null;
      const pub = D.createVersion({ ...clone(v), lifecycleStatus: 'PUBLISHED', publishedAt: iso(now), publishedBy: actorOf(access) });
      repo.putVersion(t, pub);
      if (prev && prev.id !== pub.id) { const s = repo.putVersion(t, D.createVersion({ ...clone(prev), lifecycleStatus: 'SUPERSEDED' })); if (!s.ok) return s; } // content (incl. effective dates) untouched
      const nd = D.createDocument({ ...clone(d), currentPublishedVersionId: pub.id, lifecycleStatus: 'ACTIVE', updatedAt: iso(now), revision: d.revision + 1 });
      repo.saveDraft(t, nd);
      if (prev) events.emit('DocumentVersionSuperseded', { organizationId: d.organizationId, documentId: d.id, versionId: prev.id, now, metadata: { supersededBy: pub.id } });
      // topic 33 hook: consumers find provenance that pointed to older versions of this document
      const ev = events.emit('DocumentVersionPublished', { organizationId: d.organizationId, documentId: d.id, versionId: pub.id, actorRef: actorOf(access), now, metadata: { previousVersionId: prev ? prev.id : null, versionNumber: pub.versionNumber } });
      search.indexVersion(t, d.id, pub.id, { now });
      return { ok: true, document: nd, version: pub, supersededVersionId: prev ? prev.id : null, event: ev };
    }
    /** resolveVersion(t, { documentId, asOf, explicitVersionId, requirePublished, mode }, access) — broker/client default CURRENT_PUBLISHED */
    function resolveVersion(t, q = {}, access = {}) {
      const d = repo.getDocument(t, q.documentId); if (!d) return notFound();
      const mode = D.ResolutionMode[q.mode] ? q.mode : q.explicitVersionId ? 'EXPLICIT_VERSION' : q.asOf ? 'AS_OF_EFFECTIVE_DATE' : 'CURRENT_PUBLISHED';
      const all = repo.listVersions(t, d.id), published = all.filter(v => ['PUBLISHED', 'SUPERSEDED'].includes(v.lifecycleStatus));
      let v = null;
      if (mode === 'CURRENT_PUBLISHED') v = d.currentPublishedVersionId ? repo.getVersion(t, d.currentPublishedVersionId) : null;
      else if (mode === 'EXPLICIT_VERSION') { v = repo.getVersion(t, q.explicitVersionId); if (v && v.documentId !== d.id) v = null; }
      else if (mode === 'AS_OF_EFFECTIVE_DATE') { const at = q.asOf; v = published.filter(x => (x.sourceEffectiveFrom || x.publishedAt || '') <= at).sort((a, b) => b.versionNumber - a.versionNumber)[0] || null; }
      else if (mode === 'LATEST_DRAFT_ADMIN') { if (!D.decide(d, { action: 'READ_DRAFT', access: { ...access, organizationId: access.organizationId || t.organizationId } }).allowed) return err('DOCUMENT_ACCESS_DENIED'); v = d.latestVersionId ? repo.getVersion(t, d.latestVersionId) : null; }
      if (!v) return err('DOCUMENT_VERSION_NOT_FOUND', null, { mode });
      if (q.requirePublished !== false && mode !== 'LATEST_DRAFT_ADMIN' && !['PUBLISHED', 'SUPERSEDED'].includes(v.lifecycleStatus)) return err('DOCUMENT_VERSION_NOT_FOUND', 'versão não publicada', { mode });
      if (mode !== 'LATEST_DRAFT_ADMIN') { const g = guard(t, d, access, 'READ', v); if (!g.allowed) return g.hideExistence ? notFound() : err('DOCUMENT_ACCESS_DENIED'); }
      return { ok: true, mode, document: d, version: v };
    }
    /** getDocument(t, id, access) — 404 hides sensitive/foreign documents, 403 otherwise */
    function getDocument(t, id, access = {}) {
      const d = repo.getDocument(t, id); if (!d) return notFound();
      const g = guard(t, d, access, 'READ'); if (!g.allowed) return g.hideExistence ? notFound() : err('DOCUMENT_ACCESS_DENIED');
      return { ok: true, document: d };
    }
    /** requestDownload(t, docId, versionId, access) → { token, expiresAt, url } — authorizes, audits, then a short-lived token */
    function requestDownload(t, docId, versionId, access = {}) {
      const d = repo.getDocument(t, docId); if (!d) return notFound();
      const v = repo.getVersion(t, versionId || d.currentPublishedVersionId); if (!v || v.documentId !== d.id) return err('DOCUMENT_VERSION_NOT_FOUND');
      const g = guard(t, d, access, 'DOWNLOAD', v); if (!g.allowed) return g.hideExistence ? notFound() : err('DOCUMENT_ACCESS_DENIED');
      const a = repo.getAsset(t, v.primaryFileAssetId); if (!a || a.storageProvider === 'EXTERNAL_REFERENCE' || !a.storageKey) return err('SIGNED_URL_FAILED', 'o original não está no storage gerenciado');
      if (a.uploadStatus === 'QUARANTINED') return err('MALWARE_SUSPECTED');
      const pol = D.accessPolicy(d.developmentId), tok = storage.issueDownload(t, { storageKey: a.storageKey, ttlMs: pol.downloadRules.signedUrlTtlMs, maxTtlMs: pol.downloadRules.maxTtlMs, now: clock() });
      if (!tok.ok) return tok;
      events.emit('DocumentDownloaded', { organizationId: d.organizationId, documentId: d.id, versionId: v.id, actorRef: actorOf(access), now: clock(), metadata: { audited: !!g.audit, classification: d.classification } });
      return { ok: true, token: tok.token, expiresAt: tok.expiresAt, url: `/api/v1/organizations/${d.organizationId}/documents/${d.id}/versions/${v.id}/download?token=${tok.token}` };
    }
    function preview(t, docId, versionId, access = {}) {
      const d = repo.getDocument(t, docId); if (!d) return notFound();
      const v = repo.getVersion(t, versionId || d.currentPublishedVersionId || d.latestVersionId); if (!v) return err('DOCUMENT_VERSION_NOT_FOUND');
      const g = guard(t, d, access, 'READ', v); if (!g.allowed) return g.hideExistence ? notFound() : err('DOCUMENT_ACCESS_DENIED');
      return { ok: true, preview: previewPlan(v, repo.getAsset(t, v.primaryFileAssetId), repo.listRepresentations(t, v.id)) };
    }
    /** relate(t, { documentId, documentVersionId?, relationType, targetType, targetId, targetOrganizationId? }) — cross-tenant DENY, no source cycles */
    function relate(t, r, access) {
      if (!can(access, D.PERMISSIONS.UPDATE, t) && !can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      const d = repo.getDocument(t, r.documentId); if (!d) return notFound();
      if (!D.RelationType[r.relationType]) return err('INVALID_REQUEST', 'tipo de relação inválido');
      let targetOrg = r.targetOrganizationId || null;
      if (r.targetType === 'DOCUMENT' || r.targetType === 'DOCUMENT_VERSION') { const x = r.targetType === 'DOCUMENT' ? repo.getDocument(t, r.targetId) : repo.getVersion(t, r.targetId); if (!x) return err('CROSS_TENANT_RELATION'); targetOrg = x.organizationId; }
      else if (['DEVELOPMENT', 'LOT', 'BLOCK', 'PHASE'].includes(r.targetType)) { const res = App.tenancy.resolveOrganizationId(r.targetType === 'DEVELOPMENT' ? { developmentId: r.targetId } : { developmentId: r.developmentId || d.developmentId }); targetOrg = targetOrg && res.organizationId && targetOrg !== res.organizationId ? null : (targetOrg || res.organizationId); }
      if (!targetOrg || targetOrg !== d.organizationId) return err('CROSS_TENANT_RELATION');
      if (['DERIVED_FROM', 'GENERATED_FROM', 'SUPERSEDES', 'REPLACES'].includes(r.relationType) && (r.targetType === 'DOCUMENT' || r.targetType === 'DOCUMENT_VERSION')) {
        const targetDoc = r.targetType === 'DOCUMENT' ? r.targetId : repo.getVersion(t, r.targetId).documentId;
        if (targetDoc === d.id || reaches(t, targetDoc, d.id)) return err('RELATION_CYCLE', 'o grafo de fontes não pode ter ciclos');
      }
      const rel = D.relation({ ...r, organizationId: d.organizationId }, { now: clock() }); repo.putRelation(t, rel); return { ok: true, relation: rel };
    }
    function reaches(t, from, to, seen = new Set()) {
      if (from === to) return true; if (seen.has(from)) return false; seen.add(from);
      return repo.listRelations(t, { documentId: from }).filter(r => ['DERIVED_FROM', 'GENERATED_FROM', 'SUPERSEDES', 'REPLACES'].includes(r.relationType))
        .some(r => reaches(t, r.targetType === 'DOCUMENT' ? r.targetId : (repo.getVersion(t, r.targetId) || {}).documentId, to, seen));
    }
    /** createSnapshot(t, refs[{documentId, documentVersionId}], purpose) — exact versions used by a report/analysis/share */
    function createSnapshot(t, refs, purpose, meta = {}) {
      const exact = [];
      for (const r of refs || []) { const v = repo.getVersion(t, r.documentVersionId); if (!v || v.documentId !== r.documentId) return err('DOCUMENT_VERSION_NOT_FOUND', null, { ref: r }); exact.push({ documentId: v.documentId, documentVersionId: v.id, contentChecksum: v.contentChecksum, versionNumber: v.versionNumber }); }
      const body = { organizationId: orgOf(t), documentVersionRefs: exact, purpose: purpose || null };
      const snap = freeze({ ...body, snapshotId: I.stableId('dsnap', body), generatedAt: nowIso(), checksum: I.checksumOf(body), metadata: clone(meta) });
      repo.putSnapshot(t, snap); return { ok: true, snapshot: snap };
    }
    /** createGeneratedDocument(t, { title, documentType, origin, snapshotId }, access) — GENERATED_FROM points to the exact source versions */
    function createGeneratedDocument(t, o, access) {
      const snap = repo.getSnapshot(t, o.snapshotId); if (!snap) return err('INVALID_REQUEST', 'snapshot de fontes inexistente');
      const c = createDocumentCmd(t, { documentType: o.documentType || 'GENERATED_REPORT', title: o.title, developmentId: o.developmentId, classification: o.classification || 'ORGANIZATION_INTERNAL', authority: 'INTERNAL_ANALYSIS',
        origin: D.DocumentOrigin[o.origin] ? o.origin : 'SYSTEM_GENERATED', storageMode: 'GENERATED_INTERNAL', scope: o.scope || { scopeType: 'DEVELOPMENT' }, metadata: { sourceSnapshotId: snap.snapshotId } }, access);
      if (!c.ok) return c;
      const rels = []; for (const ref of snap.documentVersionRefs) { const r = relate(t, { documentId: c.document.id, relationType: 'GENERATED_FROM', targetType: 'DOCUMENT_VERSION', targetId: ref.documentVersionId }, access); if (!r.ok) return r; rels.push(r.relation); }
      return { ok: true, document: c.document, relations: rels };
    }
    function createCollection(t, o, access) {
      if (!can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      for (const id of o.documentRefs || []) if (!repo.getDocument(t, id)) return err('CROSS_TENANT_RELATION');
      const c = freeze({ id: o.id || I.stableId('dcol', orgOf(t), o.title), organizationId: orgOf(t), title: o.title, scope: D.scope({ organizationId: orgOf(t), ...(o.scope || {}) }), documentRefs: [...(o.documentRefs || [])],
        classification: o.classification || 'ORGANIZATION_INTERNAL', createdBy: actorOf(access), createdAt: nowIso(), metadata: clone(o.metadata || {}) });
      repo.putCollection(t, c); return { ok: true, collection: c };
    }
    /** listCollection(t, id, access) — a collection never overrides the access of each document */
    function listCollection(t, id, access) { const c = repo.getCollection(t, id); if (!c) return notFound(); return { ok: true, collection: c, documents: c.documentRefs.map(x => repo.getDocument(t, x)).filter(d => d && D.decide(d, { access: { ...access, organizationId: access.organizationId || t.organizationId } }).allowed) }; }
    /** clientPackage(t, docIds, access) — explicit snapshot of approved, client-safe published versions only */
    function clientPackage(t, docIds, access) {
      const ok = [], excluded = [];
      for (const id of docIds || []) { const d = repo.getDocument(t, id), v = d && d.currentPublishedVersionId ? repo.getVersion(t, d.currentPublishedVersionId) : null;
        if (d && v && D.decide(d, { action: 'READ', version: v, access: { ...access, organizationId: t.organizationId, mode: 'CLIENT' } }).allowed) ok.push({ documentId: d.id, documentVersionId: v.id }); else excluded.push(id); }
      const s = createSnapshot(t, ok, 'CLIENT_PACKAGE'); return s.ok ? { ok: true, snapshot: s.snapshot, excludedCount: excluded.length } : s;
    }
    /** archive: published official documents are archived, never hard-deleted by default */
    function archive(t, docId, access) {
      if (!can(access, D.PERMISSIONS.ARCHIVE, t) && !can(access, D.PERMISSIONS.MANAGE, t)) return err('DOCUMENT_ACCESS_DENIED');
      const r = repo.archive(t, docId, { now: clock(), actor: actorOf(access) }); if (r.ok) events.emit('DocumentArchived', { organizationId: t.organizationId, documentId: docId, actorRef: actorOf(access), now: clock() }); return r;
    }
    /** sourceRefFor(t, documentId, versionId, locator) — the exact ref a PriceTableVersion / AvailabilityRevision / PaymentPlan stores */
    function sourceRefFor(t, documentId, versionId, loc) {
      const d = repo.getDocument(t, documentId), v = repo.getVersion(t, versionId);
      if (!d || !v || v.documentId !== d.id) return err('DOCUMENT_VERSION_NOT_FOUND');
      const errs = D.validateLocator(loc ? D.locator(loc) : null); if (errs.length) return err('INVALID_REQUEST', errs.join('; '));
      return { ok: true, sourceRef: D.sourceRef(d, v, { locator: loc }) };
    }
    return Object.freeze({ store, repo, storage, search, events, clock,
      createDocument: createDocumentCmd, matchDocument, ingest, validateVersion: validateVersionCmd, publish, resolveVersion, getDocument, requestDownload, preview, relate,
      createSnapshot, createGeneratedDocument, createCollection, listCollection, clientPackage, archive, sourceRefFor, reindex: (t, docId, verId) => search.indexVersion(t, docId, verId, { now: clock() }),
      searchDocuments: (t, q, access) => search.search(t, q, { ...access, organizationId: (access && access.organizationId) || t.organizationId }) });
  }

  // ------------------------------------------------------------------ legacy catalog (migration from plat/config/documents)
  /** seedLegacy(service, devId) → { ok, documents, report } — registers the inventoried documents exactly as configured (no publication) */
  function seedLegacy(svc, devId) {
    const cfg = D.configOf(devId); if (!cfg) return { ok: false, code: 'NO_DOCUMENT_CONFIG', documents: [] };
    const t = { organizationId: cfg.organizationId, activeDevelopmentId: devId }, repo = svc.repo, out = [];
    for (const x of cfg.documents || []) {
      const doc = D.createDocument({ ...x, scope: { organizationId: cfg.organizationId, developmentId: devId, ...(x.scope || {}) } });
      repo.saveDraft(t, doc);
      for (const a of x.fileAssets || []) repo.putAsset(t, D.createFileAsset({ ...a, organizationId: cfg.organizationId, createdAt: x.createdAt }));
      for (const v of x.versions || []) repo.putVersion(t, D.createVersion({ ...v, organizationId: cfg.organizationId, documentId: doc.id, authority: doc.authority, scope: doc.scope, metadata: { origin: 'MIGRATED_LEGACY' } }));
      for (const r of x.representations || []) repo.putRepresentation(t, D.createRepresentation({ ...r, organizationId: cfg.organizationId, generatedAt: x.createdAt }));
      for (const r of x.relations || []) repo.putRelation(t, D.relation({ ...r, organizationId: cfg.organizationId, documentId: doc.id, createdAt: x.createdAt }));
      out.push(doc);
    }
    return { ok: true, tenant: t, documents: out, report: migrationReport(devId) };
  }
  /** migrationReport(devId) → counts of the inventory matrix (DOCUMENT / DERIVED / UI_ASSET / GENERATED / TEMPORARY / UNKNOWN) */
  function migrationReport(devId) {
    const cfg = D.configOf(devId) || { documents: [], inventory: [] }, by = {};
    (cfg.inventory || []).forEach(r => { by[r.classification] = (by[r.classification] || 0) + 1; });
    const docs = cfg.documents || [];
    return freeze({ documents: docs.length, withVersion: docs.filter(d => (d.versions || []).length).length, withoutFile: docs.filter(d => !(d.versions || []).length).map(d => d.id),
      published: 0, inventoryByClass: by, pendingLegacyMatches: docs.filter(d => d.legacyMatch && d.legacyMatch.status === 'REQUIRES_REVIEW').map(d => ({ documentId: d.id, legacySourceId: d.legacyMatch.legacySourceId })),
      methodsNotDocuments: (cfg.methodsNotDocuments || []).map(m => m.legacySourceId) });
  }
  /** legacyDocumentFor(devId, legacySourceId) → { document, version } as configured (used by topic 33 to keep the candidate ref) */
  function legacyDocumentFor(devId, legacySourceId) {
    const cfg = D.configOf(devId); const d = cfg && (cfg.documents || []).find(x => x.metadata && x.metadata.legacySourceId === legacySourceId);
    return d ? { documentId: d.id, candidateVersionId: d.legacyMatch ? d.legacyMatch.candidateVersionId : null, matchStatus: d.legacyMatch ? d.legacyMatch.status : null, authority: d.authority, classification: d.classification } : null;
  }

  // ------------------------------------------------------------------ ViewModels (Card / Detail / related documents) — same domain model on every device
  const LABELS = Object.freeze({ authority: { OFFICIAL_PRIMARY: 'Oficial', OFFICIAL_SECONDARY: 'Oficial (complementar)', INTERNAL_APPROVED: 'Interno aprovado', INTERNAL_ANALYSIS: 'Análise interna', MARKETING: 'Divulgação', EXTERNAL_REFERENCE: 'Referência externa', UNKNOWN: 'Autoridade não informada' },
    classification: { PUBLIC: 'Público', ORGANIZATION_INTERNAL: 'Interno', CONFIDENTIAL: 'Confidencial', RESTRICTED: 'Restrito' },
    status: { DRAFT: 'Rascunho', UPLOADED: 'Recebida, aguardando revisão', VALIDATED: 'Validada', PUBLISHED: 'Publicada', SUPERSEDED: 'Substituída', ARCHIVED: 'Arquivada', REJECTED: 'Rejeitada' } });
  const fmtDate = s => s ? new Date(s).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null;
  function cardViewModel(svc, t, doc, access = {}) {
    const repo = svc.repo, cur = doc.currentPublishedVersionId ? repo.getVersion(t, doc.currentPublishedVersionId) : null, latest = doc.latestVersionId ? repo.getVersion(t, doc.latestVersionId) : null;
    const v = cur || latest, ac = { ...access, organizationId: access.organizationId || t.organizationId };
    const actions = [];
    if (D.decide(doc, { action: 'READ', version: cur || undefined, access: ac }).allowed) actions.push({ id: 'doc-preview', label: 'Ver', enabled: !!v });
    if (cur && D.decide(doc, { action: 'DOWNLOAD', version: cur, access: ac }).allowed) actions.push({ id: 'doc-download', label: 'Baixar original', enabled: true });
    return freeze({ documentId: doc.id, title: doc.title, typeLabel: D.typeRegistry(doc.developmentId).label(doc.documentType), scopeLabel: doc.scope.scopeType === 'DEVELOPMENT' ? 'Empreendimento' : doc.scope.scopeType === 'LOT' ? 'Lote' : 'Organização',
      currentVersionLabel: cur ? `Versão ${cur.versionNumber}${cur.publishedAt ? ' — publicada em ' + fmtDate(cur.publishedAt) : ''}` : latest ? `Versão ${latest.versionNumber} — ${LABELS.status[latest.lifecycleStatus]}` : 'Sem arquivo na plataforma',
      authorityLabel: LABELS.authority[doc.authority], classificationLabel: ac.mode === 'CLIENT' ? null : LABELS.classification[doc.classification], updatedLabel: fmtDate(doc.updatedAt),
      previewAvailability: v ? previewPlan(v, repo.getAsset(t, v.primaryFileAssetId), repo.listRepresentations(t, v.id)).type : 'UNAVAILABLE', statusLabel: v ? LABELS.status[v.lifecycleStatus] : LABELS.status.DRAFT, actions,
      ariaLabel: `${doc.title}, ${D.typeRegistry(doc.developmentId).label(doc.documentType)}, ${cur ? 'versão ' + cur.versionNumber : 'sem versão publicada'}` });
  }
  function detailViewModel(svc, t, docId, access = {}) {
    const g = svc.getDocument(t, docId, access); if (!g.ok) return g;
    const repo = svc.repo, d = g.document, mode = access.mode || 'BROKER', tech = mode === 'TECHNICAL' || mode === 'AUDIT';
    const versions = repo.listVersions(t, d.id).filter(v => tech ? true : v.id === d.currentPublishedVersionId);
    const cur = d.currentPublishedVersionId ? repo.getVersion(t, d.currentPublishedVersionId) : null, primary = cur || (tech ? versions[versions.length - 1] : null);
    return { ok: true, vm: freeze({ document: { id: d.id, title: d.title, typeLabel: D.typeRegistry(d.developmentId).label(d.documentType), authorityLabel: LABELS.authority[d.authority], description: d.description },
      currentVersion: cur ? { id: cur.id, versionNumber: cur.versionNumber, publishedAt: cur.publishedAt, label: `Versão ${cur.versionNumber}` } : null,
      versionHistory: versions.map(v => ({ id: v.id, versionNumber: v.versionNumber, statusLabel: LABELS.status[v.lifecycleStatus], uploadedAt: v.uploadedAt, publishedAt: v.publishedAt, sourceEffectiveFrom: v.sourceEffectiveFrom, current: v.id === d.currentPublishedVersionId })),
      relations: repo.listRelations(t, { documentId: d.id }).map(r => ({ relationType: r.relationType, targetType: r.targetType, targetId: r.targetId })),
      sourceMetadata: { origin: d.origin, issuedAt: primary ? primary.issuedAt : null, sourceEffectiveFrom: primary ? primary.sourceEffectiveFrom : null },
      preview: primary ? previewPlan(primary, repo.getAsset(t, primary.primaryFileAssetId), repo.listRepresentations(t, primary.id)) : null,
      extractionStatus: primary ? (repo.listExtractions(t, primary.id)[0] || {}).status || 'NOT_RUN' : null,
      accessActions: cardViewModel(svc, t, d, access).actions,
      technicalDetails: tech ? { documentId: d.id, classification: d.classification, versions: versions.map(v => ({ id: v.id, contentChecksum: v.contentChecksum, status: v.lifecycleStatus, validation: v.validationSummary })),
        assets: primary ? primary.fileAssetIds.map(id => { const a = repo.getAsset(t, id); return a && { id: a.id, mediaType: a.mediaType, detectedMediaType: a.detectedMediaType, sizeBytes: a.sizeBytes, contentChecksum: a.contentChecksum, scan: a.securityScanStatus, storage: a.storageProvider }; }).filter(Boolean) : [],
        representations: primary ? repo.listRepresentations(t, primary.id).map(r => ({ id: r.id, type: r.type, derived: r.derived, generatorId: r.generatorId, generatorVersion: r.generatorVersion })) : [], legacy: d.metadata.legacySourceId || null } : null }) };
  }
  /** relatedDocuments(svc, t, { targetType, targetId }, access) → { count, cards } for Quick View ("Documentos relacionados") and Full Details */
  function relatedDocuments(svc, t, target, access = {}) {
    const ac = { ...access, organizationId: access.organizationId || t.organizationId };
    const docs = svc.repo.listByScope(t, target).filter(d => d.lifecycleStatus !== 'ARCHIVED' && D.decide(d, { action: 'READ', access: ac }).allowed);
    const cards = docs.map(d => cardViewModel(svc, t, d, ac));
    return freeze({ count: cards.length, cards, label: cards.length ? `Documentos relacionados (${cards.length})` : 'Nenhum documento disponível' });
  }
  /** DTOs (API-ready): never storage keys, never secrets */
  const toDocumentDto = d => ({ id: d.id, organizationId: d.organizationId, developmentId: d.developmentId, documentCode: d.documentCode, documentType: d.documentType, title: d.title, description: d.description,
    scope: d.scope, classification: d.classification, authority: d.authority, lifecycleStatus: d.lifecycleStatus, currentPublishedVersionId: d.currentPublishedVersionId, latestVersionId: d.latestVersionId, tags: d.tags, createdAt: d.createdAt, updatedAt: d.updatedAt });
  const toVersionDto = v => ({ id: v.id, documentId: v.documentId, versionNumber: v.versionNumber, versionLabel: v.versionLabel, lifecycleStatus: v.lifecycleStatus, sourceEffectiveFrom: v.sourceEffectiveFrom, sourceEffectiveTo: v.sourceEffectiveTo,
    issuedAt: v.issuedAt, uploadedAt: v.uploadedAt, validatedAt: v.validatedAt, publishedAt: v.publishedAt, supersedesVersionId: v.supersedesVersionId, contentChecksum: v.contentChecksum, fileAssetIds: v.fileAssetIds });
  /** accessFromAuthz(mode) — production adapter: Topic 30 PolicyEvaluator (unknown permission keys are denied until registered) */
  const accessFromAuthz = (mode = 'BROKER') => { const ctx = App.authz.context(); return { organizationId: ctx && ctx.tenant ? ctx.tenant.organizationId : null, mode, principalId: ctx && ctx.principal ? ctx.principal.id : null,
    can: (k, res) => App.authz.can(k, res) }; };

  return Object.freeze({ createStore, createRepository, createStorage, createEventLog, createSearch, createMetadataCache, previewPlan, createService, seedLegacy, migrationReport, legacyDocumentFor,
    cardViewModel, detailViewModel, relatedDocuments, toDocumentDto, toVersionDto, accessFromAuthz, LABELS });
})();
