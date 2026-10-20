/* onboarding/mapping.js — topic 58 §54–66, §256–257: schema mapping, TransformRegistry, null semantics, Mapper + Normalizer.
   - FieldMappingRule.targetFieldKey MUST be a stored field of the FieldRegistry (App.model) — no ad hoc targets (§55–56).
   - Suggestions (header synonyms + the registry's own legacy codes) are always SUGGESTED; only CONFIRMED rules
     (approvedBy + approvedAt) feed a publishable batch (§57–58, §499–505).
   - MappingSet is versioned with optimistic concurrency (§417–418): a stale expectedRevision is refused.
   - Transforms are versioned (§61); development-specific transforms must declare owner + developmentId (§63).
   - Null semantics are explicit (§64–66): blank/"N/A"/"-"/"sem informação" → null (UNKNOWN); "0" is a value;
     unknown is never false.
   - Columns that look like personal data are flagged and can never be mapped into the lot domain (§256–257).
   Pure. Depends on App.model (FieldRegistry), App.onboarding.model, App.onboardingPolicy. */
App.onboarding = App.onboarding || {};
App.onboarding.mapping = (() => {
  const M = App.onboarding.model, P = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);
  const okv = (value, state = 'CONFIRMED') => ({ ok: true, value, state });
  const bad = (code, message) => ({ ok: false, code, message });
  const normHeader = h => String(h == null ? '' : h).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

  // ------------------------------------------------------------------ null semantics
  const isNullToken = v => v == null || (typeof v === 'string' && P().nullTokens.includes(v.trim().toLowerCase()));

  // ------------------------------------------------------------------ TransformRegistry (§59–61)
  function parseNumber(v, hint) {
    if (typeof v === 'number') return Number.isFinite(v) ? okv(v) : bad('INVALID_NUMBER', 'número não finito');
    const s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return bad('INVALID_NUMBER', 'valor não numérico');
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) return okv(s.lastIndexOf(',') > s.lastIndexOf('.') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, '')));
    if (hasC) { if (/^-?\d{1,3}(,\d{3})+$/.test(s) && hint === 'dot') return okv(Number(s.replace(/,/g, ''))); return okv(Number(s.replace(',', '.'))); }
    if (hasD && /^-?\d{1,3}(\.\d{3})+$/.test(s)) { if (hint === 'comma') return okv(Number(s.replace(/\./g, ''))); if (hint !== 'dot') return bad('AMBIGUOUS_DECIMAL', `"${s}" pode ser milhar ou decimal: declare o separador`); }
    return okv(Number(s));
  }
  const T = (id, version, fn, o = {}) => freeze({ id, version, ref: `${id}@${version}`, fn, scope: o.scope || 'GENERIC', owner: o.owner || null, developmentId: o.developmentId || null, description: o.description || '' });
  const BUILTIN = [
    T('identity', '1.0.0', v => okv(v), { description: 'Sem transformação.' }),
    T('trimString', '1.0.0', v => okv(String(v).trim()), { description: 'Remove espaços nas pontas.' }),
    T('parseBrazilianDecimal', '1.0.0', v => parseNumber(v, 'comma'), { description: '1.234,56 → 1234,56 (vírgula decimal).' }),
    T('parseDecimal', '1.0.0', (v, ctx) => parseNumber(v, ctx && ctx.decimalHint), { description: 'Número com o separador detectado na fonte; ambíguo → erro.' }),
    T('parseCurrencyBRL', '1.0.0', v => { const r = parseNumber(v, 'comma'); return r.ok ? okv(Math.round(r.value * 100)) : r; }, { description: 'R$ 299.000,00 → 29900000 (centavos).' }),
    T('normalizeBoolean', '1.0.0', v => { const s = String(v).trim().toLowerCase(), B = P().booleanTokens; return B.true.includes(s) ? okv(true) : B.false.includes(s) ? okv(false) : bad('INVALID_BOOLEAN', 'valor booleano desconhecido (desconhecido ≠ falso)'); }),
    T('normalizeLotCode', '1.0.0', v => { const s = String(v).trim().toUpperCase().replace(/^(LOTE|LT|L)\s*/, ''); if (/^\d+$/.test(s)) return okv(parseInt(s, 10)); return s ? okv(s, 'NEEDS_CONFIRMATION') : bad('INVALID_LOT_CODE', 'código de lote vazio'); }, { description: '"0327" → 327; "327A" é mantido e vai para revisão.' }),
    T('normalizeBlockCode', '1.0.0', v => { const s = String(v).trim().toUpperCase().replace(/^(QUADRA|QD\.?|Q)\s*(?=\S)/, ''); return /^[A-Z0-9]{1,6}$/.test(s) ? okv(s) : bad('INVALID_BLOCK_CODE', 'código de quadra inválido'); }, { description: '"Quadra a" → "A". Nunca inventa zero à esquerda.' }),
    T('convertHectareToSqm', '1.0.0', v => { const r = parseNumber(v, 'comma'); return r.ok ? okv(Math.round(r.value * 10000 * 100) / 100) : r; }),
    T('excelSerialDate', '1.0.0', v => { const n = Number(v); if (!Number.isFinite(n) || n < 1) return bad('INVALID_DATE', 'data Excel inválida'); const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return okv(d.toISOString().slice(0, 10)); }),
    T('parseDateBR', '1.0.0', v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v).trim()); return m ? okv(`${m[3]}-${m[2]}-${m[1]}`) : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? okv(String(v).slice(0, 10)) : bad('INVALID_DATE', 'data inválida'); }),
    T('polygonPoints', '1.0.0', v => Array.isArray(v) && v.every(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)) ? okv(v.map(p => [p[0], p[1]])) : bad('INVALID_GEOMETRY', 'lista de pontos inválida')),
    T('upperTrim', '1.0.0', v => okv(String(v).trim().toUpperCase()))
  ];
  function createTransformRegistry(custom = []) {
    const map = new Map(BUILTIN.map(t => [t.id, t])), errors = [];
    for (const c of custom) {
      if (!c || !c.id || !c.version || typeof c.fn !== 'function') { errors.push('transform customizada inválida'); continue; }
      if (!c.owner || !c.developmentId) { errors.push(`${c.id}: transform específica exige owner e developmentId (§63)`); continue; }
      if (map.has(c.id)) { errors.push(`${c.id}: já existe`); continue; }
      map.set(c.id, T(c.id, c.version, c.fn, { scope: 'DEVELOPMENT_SPECIFIC', owner: c.owner, developmentId: c.developmentId, description: c.description }));
    }
    return freeze({ get: id => map.get(id) || null, list: () => [...map.values()].map(t => ({ id: t.id, version: t.version, scope: t.scope, owner: t.owner, developmentId: t.developmentId, description: t.description })),
      developmentSpecific: () => [...map.values()].filter(t => t.scope === 'DEVELOPMENT_SPECIFIC').map(t => ({ id: t.id, version: t.version, owner: t.owner, developmentId: t.developmentId })), errors: freeze(errors), version: P().transformsVersion });
  }
  const DEFAULT_TRANSFORM = { 'identity.blockId': 'normalizeBlockCode', 'identity.lotNumber': 'normalizeLotCode', 'geometry.areaM2': 'parseDecimal', 'commercial.price': 'parseCurrencyBRL', 'availability.status': 'upperTrim',
    'geometry.polygon': 'polygonPoints', 'identity.externalCode': 'trimString', 'identity.id': 'trimString' };
  const SPECIAL_SOURCE = new Set(['$geometry', '$externalId']);

  // ------------------------------------------------------------------ registry targets
  const targetField = key => { const f = App.model.field(key); return f && !f.virtual ? f : null; };

  // ------------------------------------------------------------------ PII (§256–257)
  function detectPii(ps) {
    const pats = P().piiPatterns.map(p => ({ id: p.id, re: new RegExp(p.re) })), hints = P().piiHeaderHints, out = new Map();
    for (const r of ps.records) for (const [k, v] of Object.entries(r.values)) {
      if (typeof v !== 'string') continue;
      for (const p of pats) if (p.re.test(v)) { const key = k + '|' + p.id; out.set(key, { sourceField: k, patternId: p.id, count: ((out.get(key) || {}).count || 0) + 1 }); }
    }
    const fields = new Set(ps.records.flatMap(r => Object.keys(r.values)));
    for (const k of fields) if (hints.includes(normHeader(k))) { const key = k + '|HEADER'; if (!out.has(key)) out.set(key, { sourceField: k, patternId: 'HEADER_HINT', count: null }); }
    return freeze([...out.values()].map(freeze)); // only field names + counts: the values themselves are never copied
  }

  // ------------------------------------------------------------------ suggestions (§57)
  function suggest(schema) {
    const syn = P().headerSynonyms, byLegacy = new Map(App.model.FIELDS.filter(f => f.legacy && !f.virtual).map(f => [f.legacy, f.key]));
    const out = [];
    for (const f of schema.fields) {
      const n = normHeader(f.sourceField), target = byLegacy.get(f.sourceField) || syn[n] || null;
      if (!target || !targetField(target)) continue;
      out.push(freeze({ sourceField: f.sourceField, targetFieldKey: target, transformId: DEFAULT_TRANSFORM[target] || (targetField(target).type === 'number' ? 'parseDecimal' : 'trimString'),
        basis: byLegacy.get(f.sourceField) ? 'FIELD_REGISTRY_LEGACY_CODE' : 'HEADER_SYNONYM', confidence: 'SUGGESTED' }));
    }
    return freeze(out);
  }

  // ------------------------------------------------------------------ rules & mapping sets
  function makeRule(sourceAssetId, r, i) {
    return freeze({ id: r.id || M.id('map', sourceAssetId, r.sourceField, r.targetFieldKey, i), sourceAssetId, sourceField: r.sourceField, targetFieldKey: r.targetFieldKey,
      transformId: r.transformId || DEFAULT_TRANSFORM[r.targetFieldKey] || 'identity', unitConversionId: r.unitConversionId || null, nullPolicy: r.nullPolicy || 'NULL_TOKENS_ARE_UNKNOWN',
      confidence: r.confidence || 'UNVERIFIED', approvedBy: r.approvedBy || null, approvedAt: r.approvedAt || null, basis: r.basis || 'MANUAL' });
  }
  function createMappingSet({ sourceAssetId, rules = [], by, at }) {
    const list = rules.map((r, i) => makeRule(sourceAssetId, r, i));
    return freeze({ id: M.id('mapset', sourceAssetId), sourceAssetId, version: 1, revision: '1', rules: freeze(list), checksum: M.checksum(list.map(stripMeta)), history: freeze([{ version: 1, by: by || null, at: at || null, change: 'CREATED' }]) });
  }
  const stripMeta = r => ({ s: r.sourceField, t: r.targetFieldKey, x: r.transformId, u: r.unitConversionId, n: r.nullPolicy, c: r.confidence });
  /** updateMappingSet(set, { upsert:[rules], remove:[ruleIds], confirm:[ruleIds] }, { expectedRevision, by, at }) — optimistic concurrency */
  function updateMappingSet(set, change, { expectedRevision, by, at } = {}) {
    if (expectedRevision == null || String(expectedRevision) !== set.revision) return M.fail('MAPPING_REVISION_CONFLICT', `revisão esperada ${expectedRevision}, atual ${set.revision}`);
    if (!by) return M.fail('VALIDATION_ERROR', 'autor obrigatório');
    let rules = set.rules.filter(r => !(change.remove || []).includes(r.id));
    for (const u of change.upsert || []) { rules = rules.filter(r => !(r.sourceField === u.sourceField && r.targetFieldKey === u.targetFieldKey)); rules.push(makeRule(set.sourceAssetId, { ...u, confidence: u.confidence === 'CONFIRMED' ? 'CONFIRMED' : (u.confidence || 'UNVERIFIED'), approvedBy: u.confidence === 'CONFIRMED' ? by : null, approvedAt: u.confidence === 'CONFIRMED' ? at : null }, rules.length)); }
    rules = rules.map(r => (change.confirm || []).includes(r.id) ? freeze({ ...r, confidence: 'CONFIRMED', approvedBy: by, approvedAt: at }) : r);
    const version = set.version + 1;
    return M.ok(freeze({ ...set, version, revision: String(version), rules: freeze(rules), checksum: M.checksum(rules.map(stripMeta)),
      history: freeze([...set.history, { version, by, at, change: { upserted: (change.upsert || []).length, removed: (change.remove || []).length, confirmed: (change.confirm || []).length } }]) }));
  }
  const mappingVersionOf = set => `${set.id}@v${set.version}:${set.checksum.slice(7, 19)}`;

  const IDENTITY_KEYS = ['identity.id', 'identity.externalCode'];
  const REQUIRED_BY_PURPOSE = { LOT_MASTER: [['identity.blockId'], ['identity.lotNumber']], PRICING: [['commercial.price']], AVAILABILITY: [['availability.status']], GEOMETRY: [['geometry.polygon']] };
  /** validateMappingSet(set, { purpose, schema, piiFindings, transforms }) → { ok, errors[], warnings[], unmappedFields[] } */
  function validateMappingSet(set, { purpose, schema, piiFindings = [], transforms = createTransformRegistry() } = {}) {
    const errors = [], warnings = [], E = (code, detail) => errors.push(freeze({ code, detail })), Wn = (code, detail) => warnings.push(freeze({ code, detail }));
    const fieldsInSource = new Set(schema ? schema.fields.map(f => f.sourceField) : []), pii = new Set(piiFindings.map(p => p.sourceField));
    const confirmed = set.rules.filter(r => r.confidence === 'CONFIRMED');
    for (const r of set.rules) {
      if (!targetField(r.targetFieldKey)) E('FIELD_MAPPING_UNKNOWN_TARGET', r.targetFieldKey);
      if (!transforms.get(r.transformId)) E('TRANSFORM_UNKNOWN', r.transformId);
      if (schema && !SPECIAL_SOURCE.has(r.sourceField) && !fieldsInSource.has(r.sourceField)) E('SOURCE_FIELD_NOT_FOUND', r.sourceField);
      if (pii.has(r.sourceField)) E('PII_FIELD_NOT_ALLOWED', r.sourceField);
      if (r.nullPolicy === 'ZERO_IS_NULL' && !r.approvedBy) E('ZERO_IS_NULL_NOT_APPROVED', r.sourceField);
      if (r.confidence !== 'CONFIRMED') Wn('MAPPING_NOT_CONFIRMED', `${r.sourceField} → ${r.targetFieldKey}`);
    }
    const byTarget = new Map(); confirmed.forEach(r => byTarget.set(r.targetFieldKey, [...(byTarget.get(r.targetFieldKey) || []), r]));
    for (const [t, rs] of byTarget) if (rs.length > 1) E('FIELD_MAPPING_AMBIGUOUS', t);
    const req = REQUIRED_BY_PURPOSE[purpose] || [];
    for (const alts of req) if (!alts.some(k => byTarget.has(k))) E('FIELD_MAPPING_MISSING', alts.join(' | '));
    if (purpose && purpose !== 'LOT_MASTER' && ['PRICING', 'AVAILABILITY', 'GEOMETRY'].includes(purpose)) {
      const hasIdentity = IDENTITY_KEYS.some(k => byTarget.has(k)) || (byTarget.has('identity.blockId') && byTarget.has('identity.lotNumber')) || (purpose === 'GEOMETRY' && confirmed.some(r => r.sourceField === '$externalId'));
      if (!hasIdentity) E('FIELD_MAPPING_MISSING', 'identidade do lote (identity.id | identity.externalCode | quadra + lote)');
    }
    const mappedSources = new Set(set.rules.map(r => r.sourceField));
    const unmappedFields = [...fieldsInSource].filter(f => !mappedSources.has(f));
    return freeze({ ok: !errors.length, errors: freeze(errors), warnings: freeze(warnings), unmappedFields: freeze(unmappedFields) });
  }

  // ------------------------------------------------------------------ Mapper + Normalizer (§33, §32)
  /** mapRecords(ps, set) → MappedRecord[] (raw values keyed by FieldRegistry key; CONFIRMED rules only unless allowUnconfirmed for dry-run previews) */
  function mapRecords(ps, set, { allowUnconfirmed = false } = {}) {
    const rules = set.rules.filter(r => r.confidence === 'CONFIRMED' || allowUnconfirmed);
    return freeze(ps.records.map(rec => {
      const raw = {}, from = {};
      for (const r of rules) {
        const v = r.sourceField === '$geometry' ? (rec.geometry ? geometryPoints(rec.geometry) : undefined) : r.sourceField === '$externalId' ? rec.sourceExternalId : rec.values[r.sourceField];
        if (v === undefined) continue;
        raw[r.targetFieldKey] = v; from[r.targetFieldKey] = r;
      }
      return freeze({ recordRef: rec.recordRef, sourceAssetId: ps.sourceAssetId, raw: freeze(raw), rules: freeze(from), sourceExternalId: rec.sourceExternalId || null, geometryRaw: rec.geometry || null });
    }));
  }
  /** first outer ring of a Polygon (or each polygon of a MultiPolygon) as [[x,y]...] — coordinates stay in their own reference */
  function geometryPoints(g) { if (!g) return undefined; if (g.type === 'Polygon') return g.coordinates && g.coordinates[0]; if (g.type === 'MultiPolygon') return g.coordinates && g.coordinates.length === 1 ? g.coordinates[0][0] : { multi: g.coordinates.map(p => p[0]) }; return undefined; }
  /** normalizeRecords(mapped, { transforms, batchId, at, decimalHint }) → NormalizedRecord[] with fieldStates + IngestionProvenance per field (§312–313) */
  function normalizeRecords(mapped, { transforms = createTransformRegistry(), batchId, at, decimalHint } = {}) {
    return freeze(mapped.map(m => {
      const values = {}, fieldStates = {}, provenance = {}, issues = [];
      for (const [key, v] of Object.entries(m.raw)) {
        const rule = m.rules[key], t = transforms.get(rule.transformId);
        provenance[key] = freeze({ sourceAssetId: m.sourceAssetId, sourceRecordRef: m.recordRef, sourceField: rule.sourceField, mappingRuleId: rule.id, transformId: t ? t.ref : rule.transformId, batchId: batchId || null, producedAt: at || null });
        const nullish = rule.nullPolicy === 'BLANK_ONLY' ? v == null || (typeof v === 'string' && v.trim() === '') : isNullToken(v) || (rule.nullPolicy === 'ZERO_IS_NULL' && Number(v) === 0);
        if (nullish) { values[key] = null; fieldStates[key] = 'UNKNOWN'; continue; }
        if (v && typeof v === 'object' && v.multi) { values[key] = v; fieldStates[key] = 'NEEDS_CONFIRMATION'; issues.push(freeze({ code: 'MULTI_GEOMETRY', fieldKey: key })); continue; }
        const r = t ? t.fn(v, { decimalHint }) : bad('TRANSFORM_UNKNOWN', rule.transformId);
        if (!r.ok) { values[key] = null; fieldStates[key] = 'NEEDS_CONFIRMATION'; issues.push(freeze({ code: r.code, fieldKey: key, message: r.message })); continue; }
        values[key] = r.value; fieldStates[key] = r.state || 'CONFIRMED';
      }
      return freeze({ recordRef: m.recordRef, sourceAssetId: m.sourceAssetId, values: freeze(values), fieldStates: freeze(fieldStates), provenance: freeze(provenance), issues: freeze(issues), sourceExternalId: m.sourceExternalId, geometryRaw: m.geometryRaw });
    }));
  }
  /** ingestion template (§468–472): CSV header the loteadora can fill; cells sanitized against formula injection (§253) */
  const TEMPLATE_VERSION = 'ingestion-template@1.0.0';
  const sanitizeCell = v => { const s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
  function ingestionTemplateCsv() {
    const cols = [['quadra', 'identity.blockId'], ['lote', 'identity.lotNumber'], ['area_m2', 'geometry.areaM2'], ['preco', 'commercial.price'], ['status', 'availability.status'], ['codigo_loteadora', 'identity.externalCode']];
    return `# ${TEMPLATE_VERSION}\n` + cols.map(c => sanitizeCell(c[0])).join(';') + '\n';
  }

  return freeze({ normHeader, isNullToken, parseNumber, createTransformRegistry, targetField, detectPii, suggest, makeRule, createMappingSet, updateMappingSet, mappingVersionOf,
    validateMappingSet, mapRecords, normalizeRecords, geometryPoints, sanitizeCell, ingestionTemplateCsv, TEMPLATE_VERSION, DEFAULT_TRANSFORM: freeze(DEFAULT_TRANSFORM) });
})();
