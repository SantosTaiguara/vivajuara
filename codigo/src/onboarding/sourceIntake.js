/* onboarding/sourceIntake.js — topic 58 §8–29, §245–258: source-first intake.
   - inspectUpload: detected type (magic bytes / text sniff) decides, the extension is never trusted; size per type;
     macros never executed (rejected); archives checked for zip-slip / bomb BEFORE any parser runs; CAD/OTHER fail safely.
   - createSourceAsset: immutable SourceAsset with sha256 checksum of the exact bytes, logical tenant-partitioned
     storageRef (never a local path), sanitized metadata. A new version is a NEW asset (supersession, never overwrite).
   - malware scan through an injected scanner interface; without a scanner the asset stays RECEIVED (quarantine).
   - SourceAuthorityDeclaration + DevelopmentSourceAuthorityMatrix (§21, §491–493): "more recent" is never "official".
   - IngestionBatch with IngestionFingerprint = source checksums + mapping version + pipeline version (§25–27):
     a duplicate batch is detected before processing; BatchSupersession makes the older batch obsolete (§413–416).
   Pure: callers pass `at`. Depends on App.integrity, App.onboarding.model, App.onboardingPolicy (+ App.securityHardening when loaded). */
App.onboarding = App.onboarding || {};
App.onboarding.intake = (() => {
  const M = App.onboarding.model, I = App.integrity;
  const policy = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);

  // ------------------------------------------------------------------ bytes & text
  const toBytes = x => x == null ? new Uint8Array(0) : typeof x === 'string' ? Uint8Array.from(I.utf8(x)) : x instanceof Uint8Array ? x : x && typeof x.length === 'number' && typeof x.subarray === 'function' ? Uint8Array.from(x) : Array.isArray(x) ? Uint8Array.from(x)
    : x && x.buffer instanceof ArrayBuffer ? new Uint8Array(x.buffer, x.byteOffset || 0, x.byteLength) : x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(0);
  /** decodeText(bytes) → { text, encoding, invalidSequences, bom } — strict UTF-8; on invalid sequences falls back to Latin-1 and says so (§44) */
  function decodeText(input) {
    const b = toBytes(input); let i = 0, out = '', bad = 0, bom = false;
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { i = 3; bom = true; }
    const start = i;
    while (i < b.length) {
      const c = b[i];
      if (c < 0x80) { out += String.fromCharCode(c); i++; continue; }
      const n = c >= 0xf0 && c < 0xf8 ? 3 : c >= 0xe0 ? 2 : c >= 0xc2 && c < 0xe0 ? 1 : -1;
      if (n < 0 || i + n > b.length - 1) { bad++; i++; continue; }
      let cp = c & (n === 1 ? 0x1f : n === 2 ? 0x0f : 0x07), okSeq = true;
      for (let k = 1; k <= n; k++) { const d = b[i + k]; if (d == null || (d & 0xc0) !== 0x80) { okSeq = false; break; } cp = (cp << 6) | (d & 0x3f); }
      if (!okSeq) { bad++; i++; continue; }
      out += String.fromCodePoint(cp); i += n + 1;
    }
    if (bad) { let l = ''; for (let k = start; k < b.length; k++) l += String.fromCharCode(b[k]); return freeze({ text: l, encoding: 'latin1', invalidSequences: bad, bom }); }
    return freeze({ text: out, encoding: 'utf-8', invalidSequences: 0, bom });
  }
  /** sniff(bytes) → detected media type: magic bytes first (App.integrity), then a conservative text sniff */
  function sniff(input) {
    const b = toBytes(input), d = I.detectMediaType(Array.from(b.subarray(0, 64))); // plain arrays cross vm realms safely
    if (d.mediaType) return d.mediaType;
    const head = decodeText(b.subarray(0, 4096)).text.replace(/^﻿/, '').trimStart();
    const low = head.slice(0, 400).toLowerCase();
    if (/<kml[\s>]/.test(low)) return 'application/vnd.google-earth.kml+xml';
    if (/^<(!doctype html|html|script)/.test(low)) return 'text/html';
    if (/^<\?xml/.test(low)) return 'application/xml';
    if (/^[\[{]/.test(head)) return 'application/json';
    if (!b.length) return null;
    let ctrl = 0; const n = Math.min(b.length, 4096); for (let k = 0; k < n; k++) { const c = b[k]; if (c < 9 || (c > 13 && c < 32) || c === 127) ctrl++; }
    return ctrl / n < 0.01 ? 'text/plain' : null;
  }
  const extOf = name => ((/\.([a-z0-9]{1,8})$/i.exec(String(name || '')) || [])[1] || '').toLowerCase();
  /** display name only (metadata); strips any directory part so no local path ever leaks (§258) */
  const displayName = n => String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().replace(/^\.+/, '').slice(0, 120) || 'arquivo';

  function checkArchive(entries, limitsId) {
    if (App.securityHardening && App.securityHardening.checkArchive) return App.securityHardening.checkArchive(entries, limitsId);
    const errors = []; // minimal fallback (same rules) when the security module is not loaded
    for (const e of entries || []) { const n = String(e.name || ''); if (!n || /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^([\\/]|[a-z]:)/i.test(n)) errors.push('ZIP_SLIP'); if (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > 100) errors.push('COMPRESSION_RATIO'); }
    return { ok: !errors.length, errors: [...new Set(errors)] };
  }

  /** inspectUpload({ sourceType, filename, bytes, declaredMime, archiveEntries }) → { ok, errors[], detectedMime, displayName, securityEvents[] }
      archiveEntries = central-directory listing of a ZIP container (name, compressedSize, uncompressedSize, depth); read BEFORE extraction. */
  function inspectUpload(f = {}) {
    const P = policy().upload, rule = P.types[f.sourceType], errors = [], events = [];
    const bytes = toBytes(f.bytes), name = displayName(f.filename), ext = extOf(name), detected = sniff(bytes);
    const E = (code, ev) => { errors.push(code); if (ev) events.push(ev); };
    if (!rule) return freeze({ ok: false, errors: ['SOURCE_TYPE_UNKNOWN'], detectedMime: detected, displayName: name, securityEvents: [] });
    if (rule.unsupported) E('SOURCE_FILE_UNSUPPORTED');
    if (!bytes.length) E('EMPTY_FILE');
    if (rule.maxBytes && bytes.length > rule.maxBytes) E('FILE_TOO_LARGE');
    if (P.macroExtensions.includes(ext)) E('MACRO_FILE', 'MACRO_FILE_REJECTED');
    if (detected === 'application/x-ole-storage') E('MACRO_FILE', 'MACRO_FILE_REJECTED'); // legacy Office containers (xls/doc) may carry macros
    if (['text/html', 'image/svg+xml', 'application/x-executable'].includes(detected)) E('EXECUTABLE_CONTENT', 'SPOOFED_MIME_REJECTED');
    if (!rule.unsupported && rule.ext.length && ext && !rule.ext.includes(ext)) E('EXTENSION_NOT_ALLOWED');
    if (!rule.unsupported && rule.detected.length && !rule.detected.includes(detected)) E('MAGIC_BYTES_MISMATCH', ext && rule.ext.includes(ext) ? 'SPOOFED_MIME_REJECTED' : null);
    if (f.declaredMime && detected && String(f.declaredMime).toLowerCase() !== detected && !(rule.detected.includes(detected))) E('DECLARED_MIME_MISMATCH');
    if (rule.archive) {
      const entries = f.archiveEntries;
      if (!Array.isArray(entries)) E('ARCHIVE_LISTING_REQUIRED');
      else {
        const a = checkArchive(entries, rule.archive);
        if (!a.ok) a.errors.forEach(c => E(c, 'MALICIOUS_ARCHIVE_REJECTED'));
        if (entries.some(e => P.macroMarkers.some(m => String(e.name || '').toLowerCase().endsWith(m.toLowerCase())))) E('MACRO_FILE', 'MACRO_FILE_REJECTED');
      }
    }
    return freeze({ ok: !errors.length, errors: [...new Set(errors)], detectedMime: detected, displayName: name, securityEvents: [...new Set(events)] });
  }

  const SAFE_META = /^(sheetNames|hiddenSheets|pageCount|width|height|dpi|resolution|crs|coordinateReference|sourceSystem|sourceVersion|externalVersion|notes|language|encoding|alignment|connectorId|cursor|receivedVia|description)$/;
  /** metadata keys allow-listed; anything path-like is dropped (no local filesystem paths, §258) */
  function sanitizeMetadata(meta = {}) {
    const out = {};
    for (const [k, v] of Object.entries(meta || {})) {
      if (!SAFE_META.test(k)) continue;
      if (typeof v === 'string' && (/^([a-z]:\\|\/(home|users|tmp|var|mnt|root)\/)/i.test(v) || /\\/.test(v))) continue;
      out[k] = v;
    }
    return freeze(out);
  }

  /** createSourceAsset({ organizationId, onboardingCaseId, sourceType, purpose, filename, bytes, uploadedBy, at, metadata, inspection })
      → frozen SourceAsset (status RECEIVED or REJECTED). The checksum is over the exact bytes received. */
  function createSourceAsset(input) {
    const bytes = toBytes(input.bytes), checksum = 'sha256:' + I.sha256(Array.from(bytes));
    const insp = input.inspection || inspectUpload({ sourceType: input.sourceType, filename: input.filename, bytes, declaredMime: input.declaredMime, archiveEntries: input.archiveEntries });
    const id = M.id('src', input.organizationId, input.onboardingCaseId, checksum, input.purpose, input.sourceType);
    return freeze({
      id, organizationId: input.organizationId, onboardingCaseId: input.onboardingCaseId, sourceType: input.sourceType, purpose: input.purpose,
      originalFileName: insp.displayName, storageRef: `obj://${input.organizationId}/onboarding/${input.onboardingCaseId}/${checksum.slice(7)}`,
      checksum, byteSize: bytes.length, uploadedBy: input.uploadedBy, uploadedAt: input.at,
      status: insp.ok ? 'RECEIVED' : 'REJECTED', rejectionReasons: freeze([...insp.errors]), detectedMime: insp.detectedMime,
      scan: freeze({ status: insp.ok ? 'PENDING' : 'SKIPPED', engine: null, at: null }),
      metadata: sanitizeMetadata(input.metadata), version: input.version || 1, supersedes: input.supersedes || null
    });
  }
  /** applyScan(asset, scanner, bytes, at) → asset with scan result. No scanner = NOT_CONFIGURED (stays quarantined). */
  function applyScan(asset, scanner, bytes, at) {
    if (asset.status !== 'RECEIVED') return asset;
    if (!scanner || typeof scanner.scan !== 'function') return freeze({ ...asset, scan: freeze({ status: 'NOT_CONFIGURED', engine: null, at }) });
    let r; try { r = scanner.scan({ checksum: asset.checksum, bytes: toBytes(bytes), sourceType: asset.sourceType }) || {}; } catch (e) { r = { verdict: 'ERROR' }; }
    if (r.verdict === 'CLEAN') return freeze({ ...asset, status: 'VALIDATED', scan: freeze({ status: 'CLEAN', engine: r.engine || null, at }) });
    if (r.verdict === 'INFECTED') return freeze({ ...asset, status: 'REJECTED', rejectionReasons: freeze([...asset.rejectionReasons, 'MALWARE_DETECTED']), scan: freeze({ status: 'INFECTED', engine: r.engine || null, at }) });
    return freeze({ ...asset, scan: freeze({ status: 'ERROR', engine: r.engine || null, at }) }); // transient: retry the scan
  }
  /** parseable only after a clean scan when the policy requires it */
  function readyForParse(asset) {
    if (!asset) return M.fail('NOT_FOUND');
    if (asset.status === 'REJECTED') return M.fail('SOURCE_REJECTED', asset.rejectionReasons.join(', '), { sourceAssetId: asset.id });
    if (asset.status === 'SUPERSEDED' || asset.status === 'ARCHIVED') return M.fail('BATCH_OBSOLETE', `fonte ${asset.status}`, { sourceAssetId: asset.id });
    if (policy().upload.malwareScanRequired && asset.status !== 'VALIDATED') return M.fail('SOURCE_SCAN_REQUIRED', asset.scan.status, { sourceAssetId: asset.id });
    return M.ok(asset);
  }
  /** duplicate detection by checksum within the same onboarding case (§11, §27) */
  const findDuplicate = (assets, candidate) => (assets || []).find(a => a.onboardingCaseId === candidate.onboardingCaseId && a.checksum === candidate.checksum && a.status !== 'REJECTED') || null;
  /** supersede(old, next, at) → [oldMarkedSuperseded, nextWithLink] — never deletes (§359) */
  function supersede(oldAsset, nextAsset, at) {
    if (oldAsset.organizationId !== nextAsset.organizationId) return M.fail('CROSS_TENANT_DENIED');
    return M.ok([freeze({ ...oldAsset, status: 'SUPERSEDED', supersededAt: at, supersededBy: nextAsset.id }), freeze({ ...nextAsset, supersedes: oldAsset.id, version: (oldAsset.version || 1) + 1 })]);
  }
  /** an asset never changes content: the only allowed changes are status/scan/supersession bookkeeping */
  function assertImmutable(before, after) {
    for (const k of ['id', 'checksum', 'byteSize', 'storageRef', 'organizationId', 'onboardingCaseId', 'sourceType', 'purpose', 'uploadedAt', 'uploadedBy'])
      if (before[k] !== after[k]) return M.fail('SOURCE_IMMUTABLE', k, { sourceAssetId: before.id });
    return M.ok(true);
  }

  // ------------------------------------------------------------------ authority
  function declareAuthority({ domain, sourceAsset, authorityLevel, declaredBy, at }) {
    if (!M.AuthorityDomain[domain] || !M.AuthorityLevel[authorityLevel]) return M.fail('VALIDATION_ERROR', 'domínio ou nível de autoridade inválido');
    if (!sourceAsset || sourceAsset.status === 'REJECTED') return M.fail('SOURCE_REJECTED', null, { sourceAssetId: sourceAsset && sourceAsset.id });
    if (!declaredBy) return M.fail('VALIDATION_ERROR', 'declaredBy obrigatório');
    return M.ok(freeze({ domain, sourceAssetId: sourceAsset.id, authorityLevel, declaredBy, declaredAt: at }));
  }
  /** DevelopmentSourceAuthorityMatrix: one PRIMARY per domain; declared, never inferred from dates */
  function authorityMatrix(declarations, assets) {
    const byId = new Map((assets || []).map(a => [a.id, a])), rows = [], problems = [];
    for (const d of Object.keys(M.AuthorityDomain)) {
      const decl = (declarations || []).filter(x => x.domain === d);
      const primary = decl.filter(x => x.authorityLevel === 'PRIMARY');
      if (primary.length > 1) problems.push({ code: 'MULTIPLE_PRIMARY', domain: d });
      const p = primary[0], a = p && byId.get(p.sourceAssetId);
      rows.push(freeze({ domain: d, primarySourceAssetId: p ? p.sourceAssetId : null, sourceType: a ? a.sourceType : null, fileName: a ? a.originalFileName : null, checksum: a ? a.checksum : null,
        status: p ? (a && a.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'DECLARED') : 'NOT_DECLARED', secondary: decl.filter(x => x.authorityLevel !== 'PRIMARY').map(x => x.sourceAssetId) }));
    }
    return freeze({ rows: freeze(rows), problems: freeze(problems), checksum: M.checksum(rows.map(r => [r.domain, r.primarySourceAssetId])) });
  }

  // ------------------------------------------------------------------ batches
  /** IngestionFingerprint (§26) */
  const fingerprint = ({ sourceChecksums, mappingVersion, pipelineVersion, batchType }) => 'ifp1:' + I.sha256(I.canonicalSerialize({ s: [...sourceChecksums].sort(), m: mappingVersion || null, p: pipelineVersion, t: batchType || null }));
  /** createBatch(existingBatches, { ... }) → ok(batch) | fail(BATCH_DUPLICATE) with the existing batch id (detected BEFORE processing, §27) */
  function createBatch(existing, { organizationId, onboardingCaseId, batchType = 'INITIAL', sourceAssets, mappingVersion, createdBy, at, pipelineVersion = policy().pipelineVersion }) {
    if (!M.BatchType[batchType]) return M.fail('VALIDATION_ERROR', 'batchType inválido');
    if (!sourceAssets || !sourceAssets.length) return M.fail('VALIDATION_ERROR', 'nenhuma fonte');
    const foreign = sourceAssets.find(a => a.organizationId !== organizationId || a.onboardingCaseId !== onboardingCaseId);
    if (foreign) return M.fail('CROSS_TENANT_DENIED', null, { sourceAssetId: foreign.id });
    const fp = fingerprint({ sourceChecksums: sourceAssets.map(a => a.checksum), mappingVersion, pipelineVersion, batchType });
    const dup = (existing || []).find(b => b.fingerprint === fp && b.onboardingCaseId === onboardingCaseId && !['FAILED', 'CANCELLED', 'SUPERSEDED', 'ROLLED_BACK'].includes(b.status));
    if (dup) return M.fail('BATCH_DUPLICATE', null, { batchId: dup.id });
    const seq = (existing || []).filter(b => b.onboardingCaseId === onboardingCaseId).length + 1;
    return M.ok(freeze({ id: M.id('batch', organizationId, onboardingCaseId, fp, seq), organizationId, onboardingCaseId, batchType, status: 'CREATED',
      sourceAssetIds: freeze(sourceAssets.map(a => a.id)), createdBy, createdAt: at, completedAt: null, pipelineVersion, mappingVersion: mappingVersion || null,
      fingerprint: fp, generation: seq, revision: '1', statusHistory: freeze([]) }));
  }
  /** BatchSupersession: the older batch can no longer publish (§415) */
  function supersedeBatch(oldBatch, replacing, reason, at) {
    const t = M.transition('batch', oldBatch, 'SUPERSEDED', { at });
    if (!t.ok) return t;
    return M.ok({ batch: freeze({ ...t.value, supersededBy: replacing.id }), record: freeze({ supersededBatchId: oldBatch.id, replacingBatchId: replacing.id, reason, createdAt: at }) });
  }

  return freeze({ toBytes, decodeText, sniff, extOf, displayName, inspectUpload, sanitizeMetadata, createSourceAsset, applyScan, readyForParse, findDuplicate, supersede, assertImmutable,
    declareAuthority, authorityMatrix, fingerprint, createBatch, supersedeBatch });
})();
