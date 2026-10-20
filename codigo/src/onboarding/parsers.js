/* onboarding/parsers.js — topic 58 §30–53: Parser adapters (SourceParser) + schema discovery.
   A parser turns ONE SourceAsset into a ParsedSource (raw structured records + warnings). Parsed data is NOT canonical:
   no mapping, no meaning, no defaults. Every record has a stable reference (`row:42`, `sheet:Preços,row:42`,
   `feature:VJ-QA-L0001`, `placemark:/Quadra A/A1`, `page:7,table:1,row:3`).
   Adapters: CsvParser, JsonRecordsParser (legacy lots.json, manual form, API payloads), GeoJsonParser, KmlParser,
   KmzParser / XlsxParser (work only on the listing+entries produced by a safe extractor AFTER the archive check — no
   inflate in the browser, so without an extractor they fail safely as SOURCE_FILE_UNSUPPORTED), PdfTableParser
   (structure unreliable → REVIEW_REQUIRED; OCR is LOW confidence), ImageParser (metadata only: a raster is never
   geometry), CadParser (honestly unsupported). Pure and synchronous; parseAsync wraps for the spec interface. */
App.onboarding = App.onboarding || {};
App.onboarding.parsers = (() => {
  const M = App.onboarding.model, IN = App.onboarding.intake;
  const freeze = o => Object.freeze(o);
  const W = (code, message, ref) => freeze({ code, message, recordRef: ref || null });
  const parsed = (asset, parser, records, warnings, metadata = {}, extra = {}) => freeze({ sourceAssetId: asset.id, parserId: parser.id, parserVersion: parser.version,
    records: freeze(records.map(freeze)), warnings: freeze(warnings), metadata: freeze(metadata), requiresReview: !!extra.requiresReview, confidence: extra.confidence || 'HIGH' });

  // ------------------------------------------------------------------ CSV (§44: delimiter, encoding, decimal separator, header)
  function splitCsv(text, delim) {
    const rows = []; let row = [], cell = '', q = false, quotedCell = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === '') { q = true; quotedCell = true; continue; }
      if (c === delim) { row.push(cell); cell = ''; quotedCell = false; continue; }
      if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; quotedCell = false; continue; }
      cell += c;
    }
    if (cell !== '' || row.length || quotedCell) { row.push(cell); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  }
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
    let best = ',', bestScore = -1;
    for (const d of [';', ',', '\t', '|']) {
      const counts = lines.map(l => splitCsv(l, d)[0] ? splitCsv(l, d)[0].length : 0);
      if (!counts.length || counts[0] < 2) continue;
      const consistent = counts.filter(c => c === counts[0]).length / counts.length, score = consistent * 100 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  /** decimal separator hint from numeric-looking cells (",": 1.234,56 / 250,5) vs (".": 1,234.56 / 250.5) — a hint, not authority */
  function detectDecimal(rows) {
    let comma = 0, dot = 0;
    for (const r of rows.slice(1, 200)) for (const v of r) { const s = String(v).trim(); if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) comma++; else if (/^-?\d{1,3}(,\d{3})*\.\d+$/.test(s) || /^-?\d+\.\d+$/.test(s)) dot++; }
    return comma > dot ? 'comma' : dot > comma ? 'dot' : 'unknown';
  }
  const looksNumeric = s => /^-?[\d.,]+$/.test(String(s).trim()) && /\d/.test(String(s));
  function tableToRecords(rows, refPrefix, warnings) {
    if (!rows.length) return { records: [], header: [] };
    const first = rows[0], headerLike = first.every(c => String(c).trim() !== '' && !looksNumeric(c));
    let header = first.map(h => String(h).trim()), body = rows.slice(1), startRow = 2;
    if (!headerLike) { warnings.push(W('HEADER_NOT_DETECTED', 'Primeira linha não parece cabeçalho; colunas nomeadas col1…colN')); header = first.map((_, i) => `col${i + 1}`); body = rows; startRow = 1; }
    const seen = new Map(); header = header.map(h => { const k = h || 'sem_nome'; const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > 1) warnings.push(W('DUPLICATE_HEADER', `cabeçalho repetido "${k}"`)); return n > 1 ? `${k}#${n}` : k; });
    const records = [];
    body.forEach((r, i) => {
      if (r.length !== header.length) warnings.push(W('ROW_WIDTH_MISMATCH', `linha com ${r.length} colunas (cabeçalho tem ${header.length})`, `${refPrefix}row:${startRow + i}`));
      const values = {}; header.forEach((h, k) => { values[h] = r[k] == null ? '' : r[k]; });
      records.push({ recordRef: `${refPrefix}row:${startRow + i}`, values: freeze(values) });
    });
    return { records, header };
  }
  const CsvParser = freeze({ id: 'csv', version: '1.0.0', supports: a => a.sourceType === 'CSV' || a.sourceType === 'TXT',
    parse(asset, { bytes }) {
      const dec = IN.decodeText(bytes), warnings = [];
      if (dec.encoding !== 'utf-8') warnings.push(W('ENCODING_FALLBACK', `Arquivo não é UTF-8 válido (${dec.invalidSequences} sequência(s) inválida(s)); lido como Latin-1 — confirme acentos`));
      const delim = detectDelimiter(dec.text), rows = splitCsv(dec.text, delim);
      const t = tableToRecords(rows, '', warnings);
      return parsed(asset, this, t.records, warnings, { delimiter: delim, encoding: dec.encoding, bom: dec.bom, decimalSeparatorHint: detectDecimal(rows), columns: t.header, rowCount: t.records.length },
        { requiresReview: dec.encoding !== 'utf-8' });
    } });

  // ------------------------------------------------------------------ JSON records (legacy lots.json, manual form, API)
  const JsonRecordsParser = freeze({ id: 'json-records', version: '1.0.0', supports: a => ['MANUAL_FORM', 'API', 'OTHER'].includes(a.sourceType),
    parse(asset, { bytes, json }) {
      let data = json;
      if (data === undefined) { try { data = JSON.parse(IN.decodeText(bytes).text); } catch (e) { return M.fail('SOURCE_SCHEMA_INVALID', 'JSON inválido', { sourceAssetId: asset.id }); } }
      const list = Array.isArray(data) ? data : data && Array.isArray(data.records) ? data.records : null;
      if (!list) return M.fail('SOURCE_SCHEMA_INVALID', 'esperado uma lista de registros', { sourceAssetId: asset.id });
      const prefix = asset.sourceType === 'MANUAL_FORM' ? 'form:' : asset.sourceType === 'API' ? `api:${(data && data.cursor) || 'snapshot'}:` : 'index:';
      const warnings = [], records = list.map((r, i) => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) { warnings.push(W('RECORD_NOT_OBJECT', 'registro não é objeto', prefix + i)); return null; }
        return { recordRef: `${prefix}${i}`, values: freeze({ ...r }) };
      }).filter(Boolean);
      return parsed(asset, this, records, warnings, { recordCount: records.length, cursor: data && data.cursor || null, manualAuthor: asset.sourceType === 'MANUAL_FORM' ? asset.uploadedBy : null });
    } });

  // ------------------------------------------------------------------ GeoJSON (§46: type, ids, properties, coordinate order)
  const GEO_TYPES = { Polygon: 'POLYGON', MultiPolygon: 'MULTIPOLYGON', LineString: 'LINE', MultiLineString: 'LINE', Point: 'POINT', MultiPoint: 'POINT' };
  function coordsOf(g) { const out = []; (function walk(c) { if (Array.isArray(c) && typeof c[0] === 'number') out.push(c); else if (Array.isArray(c)) c.forEach(walk); })(g && g.coordinates); return out; }
  const lonLatRange = pts => pts.length > 0 && pts.every(p => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  const GeoJsonParser = freeze({ id: 'geojson', version: '1.0.0', supports: a => a.sourceType === 'GEOJSON',
    parse(asset, { bytes, json }) {
      let fc = json; if (fc === undefined) { try { fc = JSON.parse(IN.decodeText(bytes).text); } catch (e) { return M.fail('SOURCE_SCHEMA_INVALID', 'GeoJSON inválido', { sourceAssetId: asset.id }); } }
      if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return M.fail('SOURCE_SCHEMA_INVALID', 'esperado FeatureCollection', { sourceAssetId: asset.id });
      const warnings = [], records = [], types = new Set(), all = [];
      fc.features.forEach((f, i) => {
        const fid = f && f.id != null ? String(f.id) : null, ref = `feature:${fid != null ? fid : '#' + i}`;
        if (!f || f.type !== 'Feature') { warnings.push(W('NOT_A_FEATURE', 'item não é Feature', ref)); return; }
        const t = f.geometry && GEO_TYPES[f.geometry.type];
        if (!t) { warnings.push(W('GEOMETRY_TYPE_UNSUPPORTED', `tipo ${f.geometry && f.geometry.type}`, ref)); }
        else types.add(t);
        if (fid == null) warnings.push(W('FEATURE_ID_MISSING', 'feature sem id', ref));
        const pts = coordsOf(f.geometry); all.push(...pts);
        records.push({ recordRef: ref, values: freeze({ ...(f.properties || {}) }), geometry: f.geometry || null, sourceExternalId: fid });
      });
      // RFC 7946 coordinates are lon,lat (WGS84) — accepted only when every coordinate is in range; otherwise UNKNOWN (never fake WGS84)
      let crs = 'UNKNOWN';
      if (fc.crs && fc.crs.properties && fc.crs.properties.name) { crs = String(fc.crs.properties.name); warnings.push(W('CRS_MEMBER_PRESENT', `membro crs legado: ${crs}`)); }
      else if (lonLatRange(all)) crs = 'EPSG:4326';
      else warnings.push(W('COORDINATES_NOT_LONLAT', 'coordenadas fora de lon/lat: referência desconhecida (não assumimos WGS84)'));
      if (crs === 'EPSG:4326' && all.some(p => Math.abs(p[0]) <= 90 && Math.abs(p[1]) > 90)) warnings.push(W('COORDINATE_ORDER_SUSPECT', 'possível inversão lat/lon'));
      return parsed(asset, this, records, warnings, { featureCount: records.length, coordinateReference: crs, geometryTypes: [...types].sort() });
    } });

  // ------------------------------------------------------------------ KML (§45: placemark, geometry, folder hierarchy, properties, CRS)
  const xmlText = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  const parseCoords = s => String(s || '').trim().split(/\s+/).filter(Boolean).map(t => t.split(',').map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0], p[1]]);
  function parseKmlText(text, asset, parser) {
    const warnings = [], records = [];
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return M.fail('SOURCE_REJECTED', 'KML com DTD/entidades (XXE) não é aceito', { sourceAssetId: asset.id });
    if (/<(NetworkLink|Link)\b/i.test(text)) warnings.push(W('EXTERNAL_LINK_IGNORED', 'NetworkLink/Link ignorado: recursos externos nunca são buscados (§255)'));
    const tokens = [], re = /<(\/?)(Folder|Placemark)\b[^>]*>/g; let m;
    while ((m = re.exec(text))) tokens.push({ close: !!m[1], tag: m[2], at: m.index, end: re.lastIndex });
    const stack = []; let pmIndex = 0;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.tag === 'Folder') { if (t.close) stack.pop(); else { const nm = /<name>([\s\S]*?)<\/name>/.exec(text.slice(t.end, (tokens[k + 1] || { at: text.length }).at)); stack.push(nm ? xmlText(nm[1]) : '(pasta)'); } continue; }
      if (t.close) continue;
      const endIdx = text.indexOf('</Placemark>', t.end), body = text.slice(t.end, endIdx < 0 ? text.length : endIdx);
      const idAttr = /id="([^"]*)"/.exec(text.slice(t.at, t.end)), name = (/<name>([\s\S]*?)<\/name>/.exec(body) || [])[1];
      const values = {}; let mm; const dre = /<Data\s+name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g; while ((mm = dre.exec(body))) values[mm[1]] = xmlText(mm[2]);
      const sre = /<SimpleData\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/SimpleData>/g; while ((mm = sre.exec(body))) values[mm[1]] = xmlText(mm[2]);
      if (name != null) values.name = xmlText(name);
      const polys = []; const pre = /<Polygon\b[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Polygon>/g; while ((mm = pre.exec(body))) polys.push([parseCoords(mm[1])]);
      const pt = /<Point\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(body);
      const geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : polys.length > 1 ? { type: 'MultiPolygon', coordinates: polys } : pt ? { type: 'Point', coordinates: parseCoords(pt[1])[0] || null } : null;
      if (!geometry) warnings.push(W('PLACEMARK_WITHOUT_GEOMETRY', 'placemark sem geometria suportada'));
      const path = '/' + [...stack, values.name || (idAttr && idAttr[1]) || '#' + pmIndex].join('/');
      records.push({ recordRef: `placemark:${path}`, values: freeze(values), geometry, sourceExternalId: idAttr ? idAttr[1] : null, folderPath: freeze([...stack]) });
      pmIndex++;
    }
    const all = []; records.forEach(r => r.geometry && coordsOf(r.geometry).forEach(p => all.push(p)));
    const crs = lonLatRange(all) ? 'EPSG:4326' : 'UNKNOWN'; // KML 2.2 is WGS84 by definition; out-of-range values are not silently trusted
    if (crs === 'UNKNOWN' && all.length) warnings.push(W('COORDINATES_NOT_LONLAT', 'coordenadas KML fora de lon/lat'));
    return parsed(asset, parser, records, warnings, { placemarkCount: records.length, coordinateReference: crs });
  }
  const KmlParser = freeze({ id: 'kml', version: '1.0.0', supports: a => a.sourceType === 'KML', parse(asset, { bytes }) { return parseKmlText(IN.decodeText(bytes).text, asset, this); } });
  const KmzParser = freeze({ id: 'kmz', version: '1.0.0', supports: a => a.sourceType === 'KMZ',
    parse(asset, { extracted }) {
      if (!extracted || !extracted.entries) return M.fail('SOURCE_FILE_UNSUPPORTED', 'KMZ exige um extrator seguro (após a verificação do arquivo compactado); não configurado neste ambiente', { sourceAssetId: asset.id });
      const name = Object.keys(extracted.entries).find(n => /(^|\/)doc\.kml$/i.test(n)) || Object.keys(extracted.entries).find(n => /\.kml$/i.test(n));
      if (!name) return M.fail('SOURCE_SCHEMA_INVALID', 'KMZ sem .kml', { sourceAssetId: asset.id });
      return parseKmlText(extracted.entries[name], asset, this);
    } });

  // ------------------------------------------------------------------ XLSX (§43: sheets, merged, formulas, hidden, locale, Excel dates, headers)
  const XlsxParser = freeze({ id: 'xlsx', version: '1.0.0', supports: a => a.sourceType === 'XLSX',
    parse(asset, { extracted }) {
      if (!extracted || !Array.isArray(extracted.sheets)) return M.fail('SOURCE_FILE_UNSUPPORTED', 'XLSX exige um extrator seguro de planilhas (sem macros); não configurado neste ambiente', { sourceAssetId: asset.id });
      const wanted = asset.metadata && Array.isArray(asset.metadata.sheetNames) ? asset.metadata.sheetNames : null, warnings = [], records = [], sheets = [];
      for (const sh of extracted.sheets) {
        if (sh.hidden) { warnings.push(W('HIDDEN_SHEET', `aba oculta "${sh.name}" ${wanted && wanted.includes(sh.name) ? 'lida por escolha explícita' : 'ignorada'}`)); if (!(wanted && wanted.includes(sh.name))) continue; }
        if (wanted && !wanted.includes(sh.name)) continue;
        if ((sh.merged || []).length) warnings.push(W('MERGED_CELLS', `aba "${sh.name}" tem ${sh.merged.length} célula(s) mesclada(s): valores não são replicados`));
        let formulas = 0;
        const rows = (sh.rows || []).map(r => r.map(c => { if (c && typeof c === 'object' && 'f' in c) { formulas++; return c.v == null ? '' : c.v; } return c == null ? '' : c; }));
        if (formulas) warnings.push(W('FORMULA_CACHED_VALUE', `aba "${sh.name}": ${formulas} fórmula(s) — usado o valor calculado salvo, fórmula nunca executada`));
        const t = tableToRecords(rows, `sheet:${sh.name},`, warnings); records.push(...t.records); sheets.push({ name: sh.name, columns: t.header, rowCount: t.records.length });
      }
      return parsed(asset, this, records, warnings, { sheets, date1904: !!extracted.date1904 });
    } });

  // ------------------------------------------------------------------ PDF / image / CAD
  const PdfTableParser = freeze({ id: 'pdf-table', version: '1.0.0', supports: a => a.sourceType === 'PDF',
    parse(asset, { extracted }) {
      const warnings = [W('PDF_STRUCTURE_UNRELIABLE', 'PDF não garante estrutura tabular: toda extração exige revisão humana')];
      if (!extracted || !Array.isArray(extracted.tables)) return parsed(asset, this, [], warnings, { tables: 0 }, { requiresReview: true, confidence: 'LOW' });
      const records = [];
      extracted.tables.forEach((tb, ti) => { const r = tableToRecords(tb.rows || [], `page:${tb.page},table:${ti + 1},`, warnings); records.push(...r.records); });
      if (extracted.ocr) warnings.push(W('OCR_LOW_CONFIDENCE', 'resultado de OCR: baixa confiança até revisão'));
      return parsed(asset, this, records, warnings, { tables: extracted.tables.length, ocr: !!extracted.ocr }, { requiresReview: true, confidence: 'LOW' });
    } });
  function imageSize(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) return { width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
    return { width: null, height: null };
  }
  const ImageParser = freeze({ id: 'image-metadata', version: '1.0.0', supports: a => a.sourceType === 'IMAGE',
    parse(asset, { bytes }) {
      const s = imageSize(IN.toBytes(bytes));
      return parsed(asset, this, [], [W('RASTER_NOT_GEOMETRY', 'Imagem raster registrada como mapa base: não é geometria de lote (§91–92)')],
        { width: s.width, height: s.height, alignment: asset.metadata && asset.metadata.alignment || null, role: 'BASE_MAP' });
    } });
  const CadParser = freeze({ id: 'cad', version: '0.0.0', supports: a => a.sourceType === 'CAD', parse(asset) { return M.fail('SOURCE_FILE_UNSUPPORTED', 'Importador CAD ainda não existe (§47)', { sourceAssetId: asset.id }); } });

  // ------------------------------------------------------------------ registry
  const REGISTRY = [CsvParser, XlsxParser, GeoJsonParser, KmlParser, KmzParser, PdfTableParser, ImageParser, CadParser, JsonRecordsParser];
  const parserFor = asset => REGISTRY.find(p => p.supports(asset)) || null;
  /** parse(asset, { bytes, json, extracted }) → ParsedSource | fail. Refuses unless the intake gate passed (scan, rejection). */
  function parse(asset, input = {}) {
    const g = IN.readyForParse(asset); if (!g.ok) return g;
    const p = parserFor(asset); if (!p) return M.fail('SOURCE_FILE_UNSUPPORTED', asset.sourceType, { sourceAssetId: asset.id });
    try { return p.parse(asset, input); } catch (e) { return M.fail('SOURCE_PARSE_FAILED', 'erro interno do parser', { sourceAssetId: asset.id, parserId: p.id }); }
  }
  const parseAsync = (asset, input) => Promise.resolve(parse(asset, input));

  // ------------------------------------------------------------------ schema discovery (§51–53: inference is a suggestion)
  function inferType(v) {
    if (v == null) return 'null';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    if (typeof v === 'boolean') return 'boolean';
    if (Array.isArray(v)) return v.length && Array.isArray(v[0]) ? 'geometry' : 'array';
    if (typeof v === 'object') return 'object';
    const s = String(v).trim();
    if (/^-?\d+$/.test(s)) return 'integer';
    if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+[.,]\d+$/.test(s)) return 'number';
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{2}\/\d{2}\/\d{4}$/.test(s)) return 'date';
    return 'string';
  }
  function discoverSchema(ps) {
    const nulls = new Set(App.onboardingPolicy.nullTokens), by = new Map();
    for (const r of ps.records) for (const [k, v] of Object.entries(r.values)) {
      if (!by.has(k)) by.set(k, { types: {}, samples: [], nulls: 0, n: 0, distinct: new Set() });
      const f = by.get(k), isNull = v == null || (typeof v === 'string' && nulls.has(v.trim().toLowerCase()));
      f.n++; if (isNull) { f.nulls++; continue; }
      const t = inferType(v); f.types[t] = (f.types[t] || 0) + 1;
      const key = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v); f.distinct.add(key);
      if (f.samples.length < 5 && !f.samples.some(s => (typeof s === 'object' ? JSON.stringify(s).slice(0, 80) : String(s)) === key)) f.samples.push(typeof v === 'object' ? '[estrutura]' : v);
    }
    const fields = [...by].map(([sourceField, f]) => {
      const ts = Object.entries(f.types).sort((a, b) => b[1] - a[1]);
      const inferredType = !ts.length ? 'null' : ts.length > 1 && ts.every(([t]) => t === 'integer' || t === 'number') ? 'number' : ts[0][0];
      return freeze({ sourceField, inferredType, inferenceStatus: 'SUGGESTED', sampleValues: freeze(f.samples), nullRate: f.n ? Math.round(f.nulls / f.n * 1000) / 1000 : null, distinctCount: f.distinct.size });
    });
    return freeze({ sourceAssetId: ps.sourceAssetId, parserId: ps.parserId, parserVersion: ps.parserVersion, fields: freeze(fields) });
  }

  return freeze({ REGISTRY: freeze(REGISTRY), CsvParser, JsonRecordsParser, GeoJsonParser, KmlParser, KmzParser, XlsxParser, PdfTableParser, ImageParser, CadParser,
    parserFor, parse, parseAsync, discoverSchema, inferType, splitCsv, detectDelimiter });
})();
