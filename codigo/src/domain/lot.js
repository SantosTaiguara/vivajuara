/* domain/lot.js — the canonical Lot aggregate (the platform's central contract).
   Lot { identity, geometry, location, surroundings, mobility, environmental,
         construction, commercial, intelligence, availability, provenance, metadata }
   - LotSchema: derived from the Field Registry (types, units, enums, nullability)
     plus the aggregate invariants. Strict for identity/polygon, permissive (null)
     for data that is legitimately unavailable.
   - LotFactory: the only way to create a Lot. Validates, drops unknown fields with a
     warning, freezes, and returns { success, lot, errors, warnings }.
   - Updates by copy (commercial, availability, intelligence); identity never changes.
   - Deterministic serialization and validated rehydration.
   A Lot holds no UI data (labels, colors, selection, favorites, formatted values). */
App.domain = (() => {
  const SCHEMA_VERSION = '1.0';
  const M = App.model, EN = App.enums;
  const TOP = ['identity', 'geometry', 'location', 'surroundings', 'mobility', 'environmental', 'construction', 'commercial', 'intelligence', 'availability', 'provenance', 'metadata'];
  const METADATA_KEYS = ['schemaVersion', 'createdAt', 'updatedAt', 'dataVersions', 'freshness'];
  const ERRORS = Object.freeze({ INVALID_LOT_ID: 'INVALID_LOT_ID', INVALID_AREA: 'INVALID_AREA', INVALID_POLYGON: 'INVALID_POLYGON', INVALID_SCORE: 'INVALID_SCORE', UNKNOWN_ENUM: 'UNKNOWN_ENUM',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD', INVALID_NUMBER: 'INVALID_NUMBER', INVALID_PRICE: 'INVALID_PRICE', INVALID_TYPE: 'INVALID_TYPE', INVALID_FIELD_KEY: 'INVALID_FIELD_KEY',
    DUPLICATE_LOT_ID: 'DUPLICATE_LOT_ID', SCHEMA_MISMATCH: 'SCHEMA_MISMATCH', IDENTITY_CHANGE: 'IDENTITY_CHANGE' });
  const WARNINGS = Object.freeze({ MISSING_OPTIONAL_FIELD: 'MISSING_OPTIONAL_FIELD', UNKNOWN_PROVENANCE: 'UNKNOWN_PROVENANCE', CONFLICTED_SOURCE: 'CONFLICTED_SOURCE',
    LEGACY_FIELD_USED: 'LEGACY_FIELD_USED', EXTRA_FIELD_IGNORED: 'EXTRA_FIELD_IGNORED' });
  // Structural fields: a Lot cannot exist without them.
  const STRICT = new Set(['identity.id', 'identity.code', 'identity.developmentId', 'identity.blockId', 'identity.lotNumber', 'geometry.polygon', 'availability.status', 'metadata.schemaVersion']);
  const STORED = M.getStoredFields();
  const KEYS = new Set(STORED.map(f => f.key));
  const PREFIXES = new Set(); STORED.forEach(f => { const p = f.key.split('.'); for (let i = 1; i < p.length; i++) PREFIXES.add(p.slice(0, i).join('.')); });

  const get = M.get;
  const RECORD_ANCHOR = { availability: 'availability.status', commercial: 'commercial.price' }, RECORD_META = /\.(updatedAt|sourceId|reason|notes|reservedUntil|proposalId|validFrom|validUntil|freshness)$/;
  function setPath(o, path, v) { const p = path.split('.'); let c = o; for (let i = 0; i < p.length - 1; i++) { if (c[p[i]] == null || typeof c[p[i]] !== 'object') c[p[i]] = {}; c = c[p[i]]; } c[p[p.length - 1]] = v; }
  /** value used when a layer is absent: never a semantic default (no LOW, no AVAILABLE) */
  const emptyValue = f => f.type === 'array' ? [] : f.key === 'intelligence.class' ? 'UNKNOWN' : f.key === 'availability.status' ? 'UNKNOWN' : null;
  const isEnum = (name, v) => !!(EN[name] && Object.prototype.hasOwnProperty.call(EN[name], v));

  function checkValue(f, v, push) {
    const bad = (code, msg) => push('e', code, f.key, msg);
    if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad(ERRORS.INVALID_NUMBER, `não é número (${v})`);
      if (f.unit === 'm²' && v <= 0) return bad(ERRORS.INVALID_AREA, `área deve ser > 0 (${v})`);
      if ((f.unit === 'm' || f.unit === 'lotes' || f.unit === '%') && v < 0) return bad(ERRORS.INVALID_NUMBER, `valor negativo (${v})`);
      if ((f.unit === 'BRL' || f.unit === 'BRL/m²') && v < 0) return bad(ERRORS.INVALID_PRICE, `preço negativo (${v})`);
      if (f.unit === 'score 0–10' && (v < 0 || v > 10)) return bad(ERRORS.INVALID_SCORE, `fora de 0–10 (${v})`);
      if (f.unit === 'score 0–100' && (v < 0 || v > 100)) return bad(ERRORS.INVALID_SCORE, `fora de 0–100 (${v})`);
      if (f.key === 'identity.lotNumber' && !(Number.isInteger(v) && v > 0)) return bad(ERRORS.MISSING_REQUIRED_FIELD, `número de lote inválido (${v})`);
    } else if (f.type === 'string' || f.type === 'date' || f.type === 'datetime') { if (typeof v !== 'string') return bad(ERRORS.INVALID_TYPE, 'não é texto'); }
    else if (f.type === 'boolean') { if (typeof v !== 'boolean') return bad(ERRORS.INVALID_TYPE, 'não é booleano'); }
    else if (f.type === 'enum') { if (!isEnum(f.enum, v)) return bad(ERRORS.UNKNOWN_ENUM, `${v} não pertence a ${f.enum}`); }
    else if (f.type === 'array') {
      if (!Array.isArray(v)) return bad(ERRORS.INVALID_TYPE, 'não é lista');
      if (f.enum) for (const x of v) { const c = x && typeof x === 'object' ? x.type : x; if (!isEnum(f.enum, c)) return bad(ERRORS.UNKNOWN_ENUM, `${c} não pertence a ${f.enum}`); }
    } else if (f.type === 'geometry' && f.key === 'geometry.polygon') {
      if (!Array.isArray(v) || v.length < 3 || !v.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return bad(ERRORS.INVALID_POLYGON, 'contorno ausente ou com menos de 3 vértices');
    }
  }

  /** validateLot(data) → { errors, warnings } (data is not modified except for unknown fields, which are removed) */
  function validateLot(d) {
    const errors = [], warnings = [], lotId = (d && d.identity && d.identity.id) || '?';
    const push = (kind, code, fieldKey, message) => (kind === 'e' ? errors : warnings).push({ code, lotId, fieldKey, message });
    if (!d || typeof d !== 'object') { push('e', ERRORS.MISSING_REQUIRED_FIELD, null, 'lote vazio'); return { errors, warnings }; }
    // unknown fields: dropped and reported (no silent proliferation)
    for (const k of Object.keys(d)) if (!TOP.includes(k)) { push('w', WARNINGS.EXTRA_FIELD_IGNORED, k, 'campo fora do contrato'); delete d[k]; }
    (function walk(o, path) {
      for (const k of Object.keys(o)) {
        const p = path ? path + '.' + k : k;
        if (KEYS.has(p)) continue;
        if (PREFIXES.has(p) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { walk(o[k], p); continue; }
        push('w', WARNINGS.EXTRA_FIELD_IGNORED, p, 'campo fora do contrato'); delete o[k];
      }
    })(Object.fromEntries(TOP.filter(t => t !== 'provenance' && t !== 'metadata' && d[t]).map(t => [t, d[t]])), '');
    if (d.metadata) for (const k of Object.keys(d.metadata)) if (!METADATA_KEYS.includes(k)) { push('w', WARNINGS.EXTRA_FIELD_IGNORED, 'metadata.' + k, 'campo fora do contrato'); delete d.metadata[k]; }

    for (const f of STORED) {
      const v = get(d, f.key);
      if (v === undefined) { push('e', ERRORS.MISSING_REQUIRED_FIELD, f.key, 'campo ausente na estrutura'); continue; }
      if (v === null) { if (STRICT.has(f.key)) push('e', f.key === 'geometry.polygon' ? ERRORS.INVALID_POLYGON : ERRORS.MISSING_REQUIRED_FIELD, f.key, 'obrigatório'); else if (!f.nullable) push('w', WARNINGS.MISSING_OPTIONAL_FIELD, f.key, 'sem valor'); continue; }
      checkValue(f, v, push);
    }
    const id = d.identity && d.identity.id;
    if (typeof id === 'string' && !/^[A-Z0-9]+-Q[A-Z0-9]+-L\d{4}$/.test(id)) push('e', ERRORS.INVALID_LOT_ID, 'identity.id', `formato inválido (${id})`);
    if (d.metadata && d.metadata.schemaVersion != null && d.metadata.schemaVersion !== SCHEMA_VERSION) push('e', ERRORS.SCHEMA_MISMATCH, 'metadata.schemaVersion', `esperado ${SCHEMA_VERSION}, recebido ${d.metadata.schemaVersion}`);
    // provenance: only canonical fieldKeys, valid statuses
    for (const [k, p] of Object.entries(d.provenance || {})) {
      if (!M.field(k)) push('e', ERRORS.INVALID_FIELD_KEY, k, 'proveniência para campo inexistente');
      else if (!p || !isEnum('DataStatus', p.status)) push('e', ERRORS.UNKNOWN_ENUM, k, `status de proveniência inválido (${p && p.status})`);
      else if (p.status === 'CONFLICTED') push('w', WARNINGS.CONFLICTED_SOURCE, k, 'fontes divergentes');
      if (p && p.confidence != null && !isEnum('Confidence', p.confidence)) push('e', ERRORS.UNKNOWN_ENUM, k, `confiança inválida (${p.confidence})`);
    }
    // a value without provenance: neither the lot nor the Field Registry says where it came from (UNKNOWN sentinels and empty lists carry no value).
    // Record metadata (updatedAt, sourceId, reason…) follows the provenance of its record's anchor field (availability.status, commercial.price).
    const hasProv = k => !!(d.provenance && d.provenance[k]) || (() => { const r = M.field(k); return !!(r && r.status && r.status !== 'UNKNOWN'); })();
    for (const f of STORED) {
      const v = get(d, f.key);
      if (v == null || v === 'UNKNOWN' || (Array.isArray(v) && !v.length) || hasProv(f.key)) continue;
      const anchor = RECORD_ANCHOR[f.key.split('.')[0]];
      if (anchor && anchor !== f.key && RECORD_META.test(f.key) && hasProv(anchor)) continue;
      push('w', WARNINGS.UNKNOWN_PROVENANCE, f.key, 'valor sem proveniência registrada');
    }
    const intel = d.intelligence || {};
    (Array.isArray(intel.alerts) ? intel.alerts : (intel.alerts != null && push('e', ERRORS.INVALID_TYPE, 'intelligence.alerts', 'lista esperada'), [])).forEach(a => {
      if (!a || !isEnum('AlertType', a.type) || !isEnum('AlertSeverity', a.severity)) push('e', ERRORS.UNKNOWN_ENUM, 'intelligence.alerts', `alerta inválido (${a && a.type}/${a && a.severity})`);
      else if (a.fieldKey != null && !M.field(a.fieldKey)) push('e', ERRORS.INVALID_FIELD_KEY, 'intelligence.alerts', `fieldKey inexistente (${a.fieldKey})`);
    });
    (Array.isArray(intel.highlights) ? intel.highlights : (intel.highlights != null && push('e', ERRORS.INVALID_TYPE, 'intelligence.highlights', 'lista esperada'), [])).forEach(h => { if (!h || !M.field(h.fieldKey)) push('e', ERRORS.INVALID_FIELD_KEY, 'intelligence.highlights', `destaque sem campo válido (${h && h.fieldKey})`); });
    (Array.isArray(intel.rankings) ? intel.rankings : (intel.rankings != null && push('e', ERRORS.INVALID_TYPE, 'intelligence.rankings', 'lista esperada'), [])).forEach(r => { if (!r || !isEnum('RankingType', r.type) || !(Number.isInteger(r.position) && r.position >= 1)) push('e', ERRORS.UNKNOWN_ENUM, 'intelligence.rankings', 'ranking inválido'); });
    return { errors, warnings };
  }

  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }

  const LotFactory = {
    /** create(normalizedLot) → { success, lot?, errors, warnings } */
    create(data) {
      const { errors, warnings } = validateLot(data);
      if (errors.length) return { success: false, lotId: (data && data.identity && data.identity.id) || null, errors, warnings };
      return { success: true, lot: deepFreeze(data), errors, warnings };
    },
    /** createMany(list) → { lots, rejected, warnings, report } — one bad lot is isolated, never the whole dataset */
    createMany(list) {
      const lots = [], rejected = [], warnings = [], seen = new Set(), perLot = [];
      for (const d of list) {
        const r = this.create(d);
        if (r.success && seen.has(r.lot.identity.id)) { r.success = false; r.errors = [{ code: ERRORS.DUPLICATE_LOT_ID, lotId: r.lot.identity.id, fieldKey: 'identity.id', message: 'ID duplicado' }]; }
        warnings.push(...r.warnings);
        if (r.success) { seen.add(r.lot.identity.id); lots.push(r.lot); } else rejected.push({ lotId: r.lotId || (r.lot && r.lot.identity.id), errors: r.errors });
        if (r.errors.length || r.warnings.length) perLot.push({ lotId: r.lotId || (r.lot && r.lot.identity.id), errors: r.errors, warnings: r.warnings });
      }
      return { lots, rejected, warnings, report: qualityReport(list.length, lots, rejected, warnings, perLot) };
    },
    /** rehydrate(serialized) — never trusts stored data: schema version and full validation */
    rehydrate(serialized) {
      let data; try { data = typeof serialized === 'string' ? JSON.parse(serialized) : JSON.parse(JSON.stringify(serialized)); }
      catch (e) { return { success: false, errors: [{ code: ERRORS.INVALID_TYPE, lotId: null, fieldKey: null, message: 'JSON inválido' }], warnings: [] }; }
      if (!data || !data.metadata || data.metadata.schemaVersion !== SCHEMA_VERSION) return { success: false, errors: [{ code: ERRORS.SCHEMA_MISMATCH, lotId: data && data.identity && data.identity.id, fieldKey: 'metadata.schemaVersion', message: 'versão de schema incompatível' }], warnings: [] };
      return this.create(data);
    }
  };

  function qualityReport(total, lots, rejected, warnings, perLot) {
    const byCode = {}; warnings.forEach(w => { byCode[w.code] = (byCode[w.code] || 0) + 1; });
    const missing = {}; warnings.filter(w => w.code === WARNINGS.MISSING_OPTIONAL_FIELD).forEach(w => { missing[w.fieldKey] = (missing[w.fieldKey] || 0) + 1; });
    const conflicts = warnings.filter(w => w.code === WARNINGS.CONFLICTED_SOURCE).length;
    return { totalLots: total, validLots: lots.length, invalidLots: rejected.length, warnings: warnings.length, warningsByCode: byCode, missingOptionalFields: missing, conflicts, perLot };
  }

  /** deterministic serialization: keys sorted at every level */
  function stable(v) { return Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v; }
  const serializeLot = lot => JSON.stringify(stable(lot));
  const deserializeLot = s => LotFactory.rehydrate(s);

  // ---- updates by copy (the store/repository calls these; components never mutate a Lot)
  const clone = o => JSON.parse(JSON.stringify(o));
  function copyWith(lot, domain, value, provenancePatch) {
    const d = { ...lot, [domain]: value, provenance: { ...lot.provenance, ...(provenancePatch || {}) }, metadata: { ...lot.metadata } };
    for (const k of TOP) if (k !== domain && k !== 'provenance' && k !== 'metadata') d[k] = lot[k]; // other domains shared, untouched
    return d;
  }
  /** commercial change: price ↔ pricePerM2 recomputed together; geometry untouched */
  function updateLotCommercial(lot, patch) {
    const c = { ...lot.commercial, ...patch }, a = lot.geometry.areaM2;
    if ('price' in patch && !('pricePerM2' in patch)) c.pricePerM2 = App.pricing.formula.pricePerM2Of(c.price, a);
    if ('pricePerM2' in patch && !('price' in patch)) c.price = App.pricing.formula.lotPrice(a, c.pricePerM2); // TD-12: single formula
    if (c.price != null && c.downPaymentDefaultPercent != null) c.downPaymentDefaultValue = App.pricing.formula.downPaymentValue(c.price, c.downPaymentDefaultPercent);
    return createChecked(lot, copyWith(lot, 'commercial', c));
  }
  /** availability change: status, updatedAt, source; scores and geometry untouched */
  function updateLotAvailability(lot, patch) {
    const a = { ...lot.availability, ...patch };
    const prov = a.status === 'UNKNOWN' ? {} : { 'availability.status': { status: 'CONFIRMED', sourceId: a.sourceId || null, method: 'declared', confidence: 'HIGH', updatedAt: a.updatedAt || null } };
    return createChecked(lot, copyWith(lot, 'availability', a, prov));
  }
  /** new analysis: scores, class, alerts, rankings, highlights, analysisVersion; area and price untouched */
  function updateLotIntelligence(lot, patch) { return createChecked(lot, copyWith(lot, 'intelligence', { ...lot.intelligence, ...patch })); }
  function createChecked(before, data) {
    const thawed = clone(data); // validation may drop unknown fields; work on a private copy
    for (const k of ['id', 'code', 'developmentId', 'blockId', 'lotNumber']) if (thawed.identity[k] !== before.identity[k]) return { success: false, errors: [{ code: ERRORS.IDENTITY_CHANGE, lotId: before.identity.id, fieldKey: 'identity.' + k, message: 'identidade não pode mudar por atualização' }], warnings: [] };
    return LotFactory.create(thawed);
  }

  /** O(1) indexes: by technical id, by short code, by block */
  function buildIndex(lots) {
    const byId = new Map(), byCode = new Map(), byBlock = new Map();
    for (const l of lots) {
      byId.set(l.identity.id, l); byCode.set(l.identity.code, l);
      if (!byBlock.has(l.identity.blockId)) byBlock.set(l.identity.blockId, []);
      byBlock.get(l.identity.blockId).push(l);
    }
    return { byId, byCode, byBlock };
  }
  return Object.freeze({ SCHEMA_VERSION, ERRORS, WARNINGS, STRICT, TOP, validateLot, LotFactory, serializeLot, deserializeLot, updateLotCommercial, updateLotAvailability,
    updateLotIntelligence, buildIndex, emptyValue, setPath, deepFreeze, stable });
})();
