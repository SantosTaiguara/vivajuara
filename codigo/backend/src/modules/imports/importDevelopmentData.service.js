'use strict';
/* ImportDevelopmentDataService
   lots.json → LegacyAdapter/Normalizer (shared) → snapshots (shared) → Validation → Import → Database.
   - Validates BEFORE writing: unique ids, valid geometry/area/enums (LotFactory), snapshot layers, source refs.
   - Real run: backs up the original file (sha256-verified copy) first.
   - Idempotent: every write is an upsert guarded by checksums; a second run reports 0 created / 0 updated.
   - Published versions (static, analysis, price table) are immutable: different content under the
     same version is a conflict (bump the version instead of overwriting history).
   - Live availability edited through the API (revision > 0) is never overwritten by the file.
   - --dry-run executes the whole import inside a transaction that is ALWAYS rolled back:
     nothing is persisted, and database constraints are exercised too.
   - analysis-input.json (LotAnalysisInput measurements of the IntelligenceEngine), when present next to the assets,
     is validated against the static lots (same ids, codes, blocks, numbers and areas) and stored under its
     inputVersion (immutable): the backend runs the engine over these rows (analysis preview). A file that does not
     match is reported (warnings ANALYSIS_INPUT_*) and not stored; the rest of the import is unaffected. */
const fs = require('fs');
const path = require('path');
const { withTransaction } = require('../../shared/db/pool');
const { checksumOf, sha256 } = require('../../shared/domain/checksum');
const devRepo = require('../developments/developments.repository');
const lotsRepo = require('../lots/lots.repository');
const analysisRepo = require('../analysis/analysis.repository');
const commercialRepo = require('../commercial/commercial.repository');
const availabilityRepo = require('../availability/availability.repository');
const assetsRepo = require('../assets/assets.repository');
const { insertAudit } = require('../../shared/db/audit.repository');
const { splitStaticPartial } = require('../lots/lots.dto');
const { planRow } = require('../commercial/commercial.dto');
const { API_SOURCE_ID } = require('../availability/availability.service');

// Sources that are not in the development config but are referenced by data/system writes.
const SYSTEM_SOURCES = [
  { id: 'lots.json', type: 'DATASET', name: 'Arquivo legado lots.json (V1)', version: null, date: null, precision: null, description: 'Status legado quando informado no arquivo.' },
  { id: API_SOURCE_ID, type: 'SYSTEM', name: 'API de disponibilidade (V2)', version: '1', date: null, precision: 'Declarado', description: 'Alterações de status feitas pela API /api/v1.' }
];
// Development config keys that live in their own tables / pointers (not duplicated in developments.config).
const CONFIG_EXCLUDED = ['id', 'code', 'tenantId', 'name', 'slug', 'currency', 'locale', 'priceTables', 'currentPriceTableId', 'sources', 'dataSource', 'staticDataVersion', 'analysisVersion'];
const ASSET_TYPES = { plan: 'OFFICIAL_PLAN', aerial: 'AERIAL_IMAGE', logo: 'LOGO', lots: 'DATASET', routes: 'DATASET', images: 'DATASET', manifest: 'DATASET', commercial: 'DATASET' };
const CONTENT_TYPES = { '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.kmz': 'application/vnd.google-earth.kmz' };

class ImportAbort extends Error {}

const plain = o => JSON.parse(JSON.stringify(o)); // leave the vm realm; JSON-safe copy
const zero = () => ({ created: 0, updated: 0, unchanged: 0 });
const tally = (acc, r) => { if (typeof r === 'string') acc[r]++; else { acc.created += r.created; acc.updated += r.updated; acc.unchanged += r.unchanged; } return acc; };

function collectSourceIds(partial, out) {
  for (const p of Object.values(partial.provenance || {})) if (p && p.sourceId) out.add(p.sourceId);
  const intel = partial.intelligence;
  if (intel) for (const a of intel.alerts || []) if (a && a.sourceId) out.add(a.sourceId);
}

/** Pure part: parse + normalize + validate. No database access. */
function prepare({ App, raw, devId }) {
  const errors = [], warnings = [];
  const dev = App.repos.DevelopmentRepository.getDevelopment(devId);
  if (!dev) throw new ImportAbort(`Empreendimento ${devId} não existe na configuração`);
  if (!Array.isArray(raw)) throw new ImportAbort('Formato inesperado: lots.json deve ser uma lista');

  const seen = new Map();
  raw.forEach((r, i) => { const id = r && r.id; if (id == null) errors.push({ code: 'MISSING_ID', index: i, message: 'registro sem id' }); else if (seen.has(id)) errors.push({ code: 'DUPLICATE_ID', lotId: id, message: `id repetido (registros ${seen.get(id)} e ${i})` }); else seen.set(id, i); });

  const snaps = App.repos.buildSnapshotsFromLegacy(raw, dev, App.repos.CommercialRepository(devId));
  for (const w of snaps.warnings) (w.code === 'RECORD_SKIPPED' ? errors : warnings).push(plain(w));
  if (snaps.states.commercial !== 'ready') errors.push({ code: 'COMMERCIAL_FAILED', message: 'tabela de preço não pôde ser aplicada' });
  const L = App.lifecycle, layers = snaps.layers;
  const staticIds = new Set(Object.keys(layers.static.lots));
  for (const kind of ['static', 'analysis', 'commercial', 'availability']) {
    if (!layers[kind]) continue;
    for (const e of L.validateSnapshot(layers[kind], kind, dev.id, kind === 'static' ? null : staticIds)) errors.push({ ...plain(e), layer: kind });
  }
  // Full canonical validation (geometry, area, enums, scores, provenance) through the shared LotFactory.
  const composed = L.compose(layers);
  for (const r of composed.rejected) errors.push({ code: 'LOT_REJECTED', lotId: r.lotId, message: r.errors.map(e => `${e.code}: ${e.message}`).join('; ') });
  for (const o of composed.orphans) errors.push({ code: 'ORPHAN_LOT', lotId: o.lotId, layer: o.layer, message: 'lote sem dados estáticos' });
  const factoryWarnings = {};
  for (const w of composed.warnings) factoryWarnings[w.code] = (factoryWarnings[w.code] || 0) + 1;
  // Geometry: closed numeric ring with at least 3 distinct vertices; positive area.
  for (const [id, s] of Object.entries(layers.static.lots)) {
    const poly = s.geometry && s.geometry.polygon;
    if (!Array.isArray(poly) || poly.length < 3) errors.push({ code: 'INVALID_POLYGON', lotId: id, message: 'contorno com menos de 3 vértices' });
    else if (!(s.geometry.areaM2 > 0)) errors.push({ code: 'INVALID_AREA', lotId: id, message: `área inválida (${s.geometry.areaM2})` });
  }
  // Source references must exist.
  const known = new Set([...dev.sources.map(s => s.id), ...SYSTEM_SOURCES.map(s => s.id)]);
  const refs = new Set();
  for (const kind of ['static', 'analysis', 'commercial', 'availability']) if (layers[kind]) for (const p of Object.values(layers[kind].lots)) collectSourceIds(p, refs);
  for (const t of dev.priceTables) refs.add(t.sourceId);
  for (const id of refs) if (!known.has(id)) errors.push({ code: 'SOURCE_REF_INVALID', message: `fonte inexistente: ${id}` });

  return { dev: plain(dev), layers: plain(layers), errors, warnings, factoryWarnings, variants: snaps.variants.length, unmapped: plain(snaps.unmapped), totalRecords: raw.length, validLots: composed.lots.length };
}

/** analysis-input.json → validated engine inputs (pure). Any mismatch with the static lots rejects the whole file:
    the engine must analyse exactly the lots the platform publishes. */
function prepareAnalysisInput({ raw, devId, staticLots }) {
  const errors = [], warnings = [];
  if (!raw || raw.kind !== 'lot-analysis-input' || !Array.isArray(raw.lots) || typeof raw.inputVersion !== 'string' || !raw.inputVersion) {
    errors.push({ code: 'ANALYSIS_INPUT_INVALID', message: 'analysis-input: esperado { kind: "lot-analysis-input", inputVersion, lots: [] }' });
    return { errors, warnings, items: [] };
  }
  if (raw.developmentId !== devId) errors.push({ code: 'ANALYSIS_INPUT_INVALID', message: `analysis-input de ${raw.developmentId} ≠ ${devId}` });
  const seen = new Set(), items = [];
  for (const [i, x] of raw.lots.entries()) {
    const id = x && x.lotId, s = id && staticLots[id];
    if (!id) { errors.push({ code: 'ANALYSIS_INPUT_INVALID', index: i, message: 'entrada sem lotId' }); continue; }
    if (seen.has(id)) { errors.push({ code: 'ANALYSIS_INPUT_INVALID', lotId: id, message: 'lotId repetido' }); continue; }
    seen.add(id);
    if (!s) { errors.push({ code: 'ANALYSIS_INPUT_MISMATCH', lotId: id, message: 'lote inexistente nos dados estáticos' }); continue; }
    const g = x.geometry || {};
    const diffs = [['code', x.code, s.identity.code], ['blockId', x.blockId, s.identity.blockId], ['lotNumber', x.lotNumber, s.identity.lotNumber], ['geometry.areaM2', g.areaM2 ?? null, s.geometry.areaM2 ?? null]]
      .filter(([, a, b]) => a !== b).map(([k]) => k);
    if (diffs.length) { errors.push({ code: 'ANALYSIS_INPUT_MISMATCH', lotId: id, message: `diverge dos dados estáticos: ${diffs.join(', ')}` }); continue; }
    items.push({ lot_id: id, data: x, checksum: checksumOf(x) });
  }
  const missing = Object.keys(staticLots).filter(id => !seen.has(id));
  if (missing.length) warnings.push({ code: 'ANALYSIS_INPUT_INCOMPLETE', message: `${missing.length} lotes sem medições de entrada do motor` });
  return { errors, warnings, items, version: raw.inputVersion, schemaVersion: String(raw.schemaVersion || '1.0'), sourceIds: Array.isArray(raw.sourceIds) ? raw.sourceIds : [] };
}

function assetEntries(dev, assetDir) {
  const out = [], warnings = [];
  for (const [key, file] of Object.entries(dev.assets || {})) {
    const p = path.join(assetDir, file);
    if (!fs.existsSync(p)) { warnings.push({ code: 'ASSET_FILE_MISSING', message: `${key}: ${file} não encontrado` }); continue; }
    const buf = fs.readFileSync(p), sum = sha256(buf), version = sum.slice(0, 12);
    out.push({ key, type: ASSET_TYPES[key] || 'OTHER', storageKey: `developments/${dev.id}/${key}/${version}/${path.basename(file)}`, contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      sizeBytes: buf.length, version, checksum: sum, metadata: { originalName: path.basename(file) } });
  }
  return { out, warnings };
}

/** Copies the original file next to a .sha256 sidecar; verifies the copy. Idempotent (same checksum → reused). */
function backupFile(file, fileBuf, fileSum, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(file, path.extname(file));
  const target = path.join(backupDir, `${base}.${fileSum.slice(0, 16)}${path.extname(file)}`);
  let reused = true;
  if (!fs.existsSync(target)) { fs.writeFileSync(target, fileBuf, { flag: 'wx' }); fs.writeFileSync(target + '.sha256', `${fileSum}  ${path.basename(file)}\n`); reused = false; }
  const check = sha256(fs.readFileSync(target));
  if (check !== fileSum) throw new ImportAbort(`Backup corrompido: ${target}`);
  return { path: target, key: path.basename(target), checksum: check, reused };
}

async function importDevelopmentData({ pool, App, file, developmentId, dryRun = false, backupDir, assetDir = path.dirname(file), analysisInputFile, requestId = null, now = new Date() }) {
  const t0 = Date.now();
  const fileBuf = fs.readFileSync(file);
  const fileSum = sha256(fileBuf);
  const report = { status: 'OK', developmentId, file: path.basename(file), fileChecksum: fileSum, dryRun, total: 0, validLots: 0, created: 0, updated: 0, unchanged: 0,
    entities: {}, errors: [], warnings: [], warningsByCode: {}, backup: null, durationMs: 0 };
  let prep;
  try { prep = prepare({ App, raw: JSON.parse(fileBuf.toString('utf8')), devId: developmentId }); }
  catch (e) { report.status = 'FAILED'; report.errors.push({ code: e instanceof ImportAbort ? 'INVALID_INPUT' : 'PARSE_ERROR', message: e.message }); report.durationMs = Date.now() - t0; return report; }
  const { dev, layers } = prep;
  report.total = prep.totalRecords; report.validLots = prep.validLots;
  report.warnings.push(...prep.warnings); report.errors.push(...prep.errors);
  report.measurementVariants = prep.variants; report.unmappedLegacyFields = prep.unmapped;
  const assets = assetEntries(dev, assetDir); report.warnings.push(...assets.warnings);
  // engine inputs (optional file; validated before any write)
  const inputFile = analysisInputFile !== undefined ? analysisInputFile : path.join(assetDir, 'analysis-input.json');
  let ai = null;
  if (inputFile && fs.existsSync(inputFile)) {
    const buf = fs.readFileSync(inputFile);
    try { ai = prepareAnalysisInput({ raw: JSON.parse(buf.toString('utf8')), devId: developmentId, staticLots: layers.static.lots }); }
    catch (e) { ai = { errors: [{ code: 'ANALYSIS_INPUT_INVALID', message: `analysis-input ilegível: ${e.message}` }], warnings: [], items: [] }; }
    ai.fileChecksum = sha256(buf);
    report.warnings.push(...ai.warnings);
    report.analysisInput = { file: path.basename(inputFile), fileChecksum: ai.fileChecksum, inputVersion: ai.version || null, lots: ai.items.length, status: ai.errors.length ? 'REJECTED' : 'OK' };
    // inputs are optional for the platform: a rejected file is reported (warnings with the reason) and not stored;
    // the rest of the import goes on and the analysis preview stays on the previously imported inputs (if any)
    if (ai.errors.length) { report.warnings.push(...ai.errors.slice(0, 50).map(e => ({ ...e, code: e.code, severity: 'ERROR' }))); ai = null; }
  } else report.warnings.push({ code: 'ANALYSIS_INPUT_MISSING', message: 'analysis-input.json não encontrado: a prévia de análise ficará indisponível' });
  for (const w of report.warnings) report.warningsByCode[w.code] = (report.warningsByCode[w.code] || 0) + 1;
  report.lotValidationWarningsByCode = prep.factoryWarnings;
  if (report.errors.length) { report.status = 'FAILED'; report.durationMs = Date.now() - t0; return report; }

  if (!dryRun && backupDir) report.backup = backupFile(file, fileBuf, fileSum, backupDir);

  const E = report.entities;
  const ROLLBACK = Symbol('dry-run');
  try {
    await withTransaction(pool, async db => {
      // lots that exist under another development are a hard conflict
      const ids = Object.keys(layers.static.lots);
      const foreign = await db.query('SELECT id FROM lots WHERE id = ANY($1::text[]) AND development_id <> $2', [ids, dev.id]);
      if (foreign.rows.length) { foreign.rows.forEach(r => report.errors.push({ code: 'LOT_OWNED_BY_OTHER_DEVELOPMENT', lotId: r.id })); throw new ImportAbort('conflito de empreendimento'); }

      const config = Object.fromEntries(Object.entries(dev).filter(([k]) => !CONFIG_EXCLUDED.includes(k)));
      E.development = tally(zero(), await devRepo.upsert(db, { id: dev.id, tenantId: dev.tenantId || null, code: dev.code, name: dev.name, slug: dev.slug || dev.id, currency: dev.currency, locale: dev.locale, config }));

      E.assets = zero();
      for (const a of assets.out) tally(E.assets, await assetsRepo.upsert(db, dev.id, a));
      E.sources = zero();
      for (const [i, s] of [...dev.sources, ...SYSTEM_SOURCES].entries()) tally(E.sources, await devRepo.upsertSource(db, dev.id, s, i));

      // ---- static
      const lotRows = [], blocks = new Map();
      for (const [id, partial] of Object.entries(layers.static.lots)) {
        const split = splitStaticPartial(partial);
        const idn = partial.identity;
        if (!blocks.has(idn.blockId)) blocks.set(idn.blockId, { code: idn.blockId, number: idn.blockNumber ?? null, name: `Quadra ${idn.blockId}` });
        lotRows.push({ id, code: idn.code, lot_number: idn.lotNumber, area_m2: partial.geometry.areaM2, latitude: partial.location ? partial.location.latitude : null,
          longitude: partial.location ? partial.location.longitude : null, static_version: layers.static.staticDataVersion, static: split.static, geometry: split.geometry,
          checksum: checksumOf(partial), geometry_checksum: checksumOf(partial.geometry.polygon), block: idn.blockId });
      }
      const staticChecksum = sha256(lotRows.map(r => `${r.id}:${r.checksum}`).sort().join('\n'));
      const existingStatic = await lotsRepo.findStaticVersion(db, dev.id, layers.static.staticDataVersion);
      if (existingStatic && existingStatic.checksum !== staticChecksum) {
        report.errors.push({ code: 'STATIC_VERSION_CONFLICT', message: `staticDataVersion ${layers.static.staticDataVersion} já publicada com conteúdo diferente; incremente a versão` });
        throw new ImportAbort('static version conflict');
      }
      E.staticVersion = tally(zero(), await lotsRepo.upsertStaticVersion(db, { developmentId: dev.id, version: layers.static.staticDataVersion, schemaVersion: layers.static.schemaVersion,
        checksum: staticChecksum, lotCount: lotRows.length, sourceFileChecksum: fileSum }));
      const b = await lotsRepo.upsertBlocks(db, dev.id, [...blocks.values()]);
      E.blocks = { created: b.created, updated: b.updated, unchanged: b.unchanged };
      for (const r of lotRows) { r.block_id = b.ids.get(r.block); delete r.block; }
      const l = await lotsRepo.upsertLots(db, dev.id, lotRows);
      E.lots = { created: l.created.length, updated: l.updated.length, unchanged: l.unchanged };
      Object.assign(report, { created: l.created.length, updated: l.updated.length, unchanged: l.unchanged });
      if (l.updated.length) report.updatedLotIds = l.updated.slice(0, 50);

      // ---- analysis (versioned, immutable once published)
      const an = layers.analysis;
      const anItems = Object.entries(an.lots).map(([id, p]) => ({ lot_id: id, class: p.intelligence ? p.intelligence.class : null, overall_score: p.intelligence && p.intelligence.scores ? p.intelligence.scores.overall : null, data: p, checksum: checksumOf(p) }));
      const anChecksum = sha256(anItems.map(i => `${i.lot_id}:${i.checksum}`).sort().join('\n'));
      let anVersion = await analysisRepo.findVersion(db, dev.id, an.analysisVersion);
      if (anVersion && anVersion.checksum !== anChecksum) {
        report.errors.push({ code: 'ANALYSIS_VERSION_CONFLICT', message: `analysisVersion ${an.analysisVersion} já publicada com conteúdo diferente; publique uma nova versão` });
        throw new ImportAbort('analysis version conflict');
      }
      E.analysisVersion = zero();
      if (!anVersion) {
        const id = await analysisRepo.insertVersion(db, { developmentId: dev.id, version: an.analysisVersion, generatedAt: an.generatedAt, methodologyVersion: an.analysisVersion, sourceId: an.sourceId, status: 'PUBLISHED', checksum: anChecksum, lotCount: anItems.length });
        anVersion = { id }; E.analysisVersion.created++;
      } else E.analysisVersion.unchanged++;
      E.lotAnalysis = await analysisRepo.upsertLotAnalysis(db, anVersion.id, anItems);

      // ---- commercial (price table applied atomically)
      const co = layers.commercial;
      const table = dev.priceTables.find(t => t.id === co.priceTableId);
      const tableChecksum = checksumOf(table);
      const existingTable = await commercialRepo.findTable(db, table.id);
      if (existingTable && existingTable.checksum !== tableChecksum) {
        report.errors.push({ code: 'PRICE_TABLE_CONFLICT', message: `tabela ${table.id} já publicada com conteúdo diferente; crie uma nova versão` });
        throw new ImportAbort('price table conflict');
      }
      E.priceTable = tally(zero(), existingTable ? 'unchanged' : await commercialRepo.insertTable(db, { id: table.id, developmentId: dev.id, version: table.version, name: table.name, currency: dev.currency,
        pricePerM2: table.pricePerM2, downPaymentDefault: table.downPaymentDefault, validFrom: table.validFrom, validUntil: table.validUntil, status: 'PUBLISHED', sourceId: table.sourceId,
        issuedOn: table.createdAt || null, revision: co.revision, checksum: tableChecksum }).then(r => (r === 'exists' ? 'unchanged' : r)));
      E.paymentPlans = await commercialRepo.upsertPlans(db, table.id, table.plans.map((p, i) => planRow(p, i, table)));
      E.lotPrices = await commercialRepo.upsertLotPrices(db, table.id, Object.entries(co.lots).map(([id, p]) => ({ lot_id: id, amount: p.commercial.price, currency: p.commercial.currency,
        price_per_m2: p.commercial.pricePerM2, discount_rules: null, metadata: p, checksum: checksumOf(p) })));

      // ---- availability (initial state only; API-managed rows are preserved)
      const av = await availabilityRepo.upsertInitial(db, dev.id, Object.entries(layers.availability.lots).map(([id, p]) => ({ lot_id: id, status: p.availability.status,
        updated_at: p.availability.updatedAt, source_id: p.availability.sourceId, reserved_until: p.availability.reservedUntil, proposal_id: p.availability.proposalId,
        reason: p.availability.reason, notes: p.availability.notes, provenance: p.provenance || null })));
      E.availability = { created: av.created, updated: av.updated, unchanged: av.unchanged };
      if (av.managedByApi) report.warnings.push({ code: 'AVAILABILITY_MANAGED_BY_API', message: `${av.managedByApi} lotes com status mantido pela API (não sobrescritos pelo arquivo)` });

      await devRepo.setCurrentPointers(db, dev.id, { staticVersion: layers.static.staticDataVersion, analysisVersionId: anVersion.id, priceTableId: table.id });

      // ---- engine inputs (versioned by inputVersion, immutable)
      if (ai) {
        const aiChecksum = sha256(ai.items.map(i => `${i.lot_id}:${i.checksum}`).sort().join('\n'));
        const existingAi = await analysisRepo.findInputVersion(db, dev.id, ai.version);
        if (existingAi && existingAi.checksum !== aiChecksum) {
          report.errors.push({ code: 'ANALYSIS_INPUT_VERSION_CONFLICT', message: `inputVersion ${ai.version} já importada com conteúdo diferente; incremente a versão` });
          throw new ImportAbort('analysis input version conflict');
        }
        E.analysisInputVersion = tally(zero(), await analysisRepo.insertInputVersion(db, { developmentId: dev.id, version: ai.version, schemaVersion: ai.schemaVersion, checksum: aiChecksum,
          lotCount: ai.items.length, sourceIds: ai.sourceIds, sourceFileChecksum: ai.fileChecksum }));
        E.lotAnalysisInputs = await analysisRepo.upsertLotInputs(db, dev.id, ai.version, ai.items);
        await analysisRepo.setCurrentInputVersion(db, dev.id, ai.version);
      }

      report.durationMs = Date.now() - t0;
      if (dryRun) throw ROLLBACK;
      await insertAudit(db, { action: 'IMPORT', entityType: 'development', entityId: dev.id, developmentId: dev.id, newValue: { file: report.file, fileChecksum: fileSum, entities: E }, requestId });
      await db.query('INSERT INTO import_runs (development_id, source_file, source_file_checksum, backup_key, report, started_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
        [dev.id, report.file, fileSum, report.backup ? report.backup.key : null, JSON.stringify({ ...report, backup: report.backup ? { key: report.backup.key, checksum: report.backup.checksum } : null }), now]);
    });
  } catch (e) {
    if (e !== ROLLBACK) {
      report.status = 'FAILED';
      if (!(e instanceof ImportAbort)) report.errors.push({ code: 'DATABASE_ERROR', message: e.message });
    }
  }
  if (report.backup) report.backup = { key: report.backup.key, checksum: report.backup.checksum, reused: report.backup.reused, path: report.backup.path };
  report.warningsByCode = {};
  for (const w of report.warnings) report.warningsByCode[w.code] = (report.warningsByCode[w.code] || 0) + 1;
  report.durationMs = Date.now() - t0;
  return report;
}

module.exports = { importDevelopmentData, prepare, prepareAnalysisInput, SYSTEM_SOURCES };
