'use strict';
/* PublishPriceTable (POST /api/v1/developments/{id}/price-tables, admin).
   - Prices come from the SHARED commercial rule (App.repos.CommercialRepository.commercialFor: price = areaM2 × pricePerM2
     rounded to cents; per-lot prices derive pricePerM2 like App.domain.updateLotCommercial). The area is the stored
     static area: geometry/area are read, never written.
   - Publishing creates a NEW immutable version (PUBLISHED, published_by = actor of the token, published_at = now),
     copies the payment plans of the current table, writes every lot price, archives the previous table (still readable
     by id) and moves the development pointer — all in one transaction under a row lock of the development.
   - dryRun: same validation and computation, returns the per-lot diff, writes nothing. */
const repo = require('./commercial.repository');
const lotsRepo = require('../lots/lots.repository');
const devRepo = require('../developments/developments.repository');
const { priceTableDto } = require('./commercial.dto');
const { validatePublishPriceTableRequest } = require('./priceTablePublication.dto');
const { insertAudit } = require('../../shared/db/audit.repository');
const { withTransaction } = require('../../shared/db/pool');
const { checksumOf } = require('../../shared/domain/checksum');
const { E } = require('../../shared/http/errors');
const { issue } = require('../../shared/validation');

const round2 = v => Math.round(v * 100) / 100;
const plain = o => JSON.parse(JSON.stringify(o));

function createPriceTablePublicationService({ pool, App, developments }) {
  const invalid = (message, details) => E.unprocessable('INVALID_PRICE_TABLE', message, details);

  /** commercial layer of one lot under table t (shared rule); override = { price } | { pricePerM2 } */
  function commercialOf(commercialRepo, areaM2, t, override) {
    if (!override) return plain(commercialRepo.commercialFor(areaM2, t));
    if (override.pricePerM2 != null) return plain(commercialRepo.commercialFor(areaM2, { ...t, pricePerM2: override.pricePerM2 }));
    const ppm2 = areaM2 ? round2(override.price / areaM2) : null; // same derivation as App.domain.updateLotCommercial
    const c = plain(commercialRepo.commercialFor(areaM2, { ...t, pricePerM2: ppm2 }));
    c.price = override.price;
    c.pricePerM2 = ppm2;
    c.downPaymentDefaultValue = c.downPaymentDefaultPercent != null ? Math.round(override.price * c.downPaymentDefaultPercent) / 100 : null;
    return c;
  }

  /** validation + computation (pure reads through `db`); returns everything publish needs */
  async function prepare(db, devId, cmd, { actorId, now }) {
    const issues = [];
    if (cmd.validFrom && cmd.validUntil && cmd.validUntil < cmd.validFrom) issues.push(issue('validUntil', 'before_valid_from', { validFrom: cmd.validFrom, validUntil: cmd.validUntil }));
    const v = await developments.getVersions(devId);
    const dev = await devRepo.findById(db, devId);
    const sharedDev = App.repos.DevelopmentRepository.getDevelopment(devId);
    if (!sharedDev) throw invalid('Empreendimento sem configuração comercial compartilhada', { developmentId: devId });
    const commercialRepo = App.repos.CommercialRepository(devId);
    const curId = dev.current_price_table_id;
    const cur = curId ? await repo.findTable(db, curId) : null;
    const plans = cur ? (await repo.findPlans(db, [cur.id])).sort((a, b) => a.position - b.position) : [];
    if (!plans.length) issues.push(issue('(table)', 'no_payment_plans', { message: 'sem tabela corrente com planos de pagamento para copiar' }));
    if (cmd.sourceId) {
      const sources = await devRepo.listSources(db, devId);
      if (!sources.some(s => s.id === cmd.sourceId)) issues.push(issue('sourceId', 'unknown_source', { value: cmd.sourceId }));
    }
    const rows = await lotsRepo.findStaticRows(db, devId);
    if (!rows.length) throw E.notFound('Nenhuma versão static publicada para este empreendimento', { developmentId: devId, layer: 'static' }, 'STATIC_VERSION_NOT_FOUND');
    const byId = new Map(rows.map(r => [r.id, r]));
    const overrides = new Map();
    for (const x of cmd.lotPrices || []) {
      if (!byId.has(x.lotId)) issues.push(issue(`lotPrices[${x.index}].lotId`, 'lot_not_found', { lotId: x.lotId }));
      else if (overrides.has(x.lotId)) issues.push(issue(`lotPrices[${x.index}].lotId`, 'duplicate_lot', { lotId: x.lotId }));
      else overrides.set(x.lotId, x);
    }
    if (cmd.pricePerM2 == null) {
      const missing = rows.filter(r => !overrides.has(r.id)).map(r => r.id);
      if (missing.length) issues.push(issue('lotPrices', 'lots_without_price', { count: missing.length, lotIds: missing.slice(0, 20) }));
    }
    const id = cmd.id || `${devId}-${cmd.version}`;
    if (!cmd.id && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) issues.push(issue('id', 'required', { message: 'id gerado longo demais; informe id' }));
    if (issues.length) throw invalid('Tabela de preço inválida', issues.slice(0, 100));

    const pricingMode = cmd.pricePerM2 == null ? 'PER_LOT' : overrides.size ? 'MIXED' : 'PER_M2';
    const t = {
      id, developmentId: devId, version: cmd.version, name: cmd.name || (cur ? cur.name : 'Tabela de preço'), sourceId: cmd.sourceId || null,
      createdAt: now.toISOString().slice(0, 10), validFrom: cmd.validFrom, validUntil: cmd.validUntil, pricePerM2: cmd.pricePerM2,
      downPaymentDefault: cmd.downPaymentDefault != null ? cmd.downPaymentDefault : cur.down_payment_default, plans: plans.map(p => p.rules)
    };
    const lots = {};
    for (const r of rows) {
      const o = overrides.get(r.id);
      lots[r.id] = { commercial: commercialOf(commercialRepo, r.static.geometry.areaM2, t, o ? (o.price != null ? { price: o.price } : { pricePerM2: o.pricePerM2 }) : null) };
    }
    // the shared snapshot validation (no field of another layer, every lot exists in the static data)
    const snapshot = App.lifecycle.snapshot('commercial', devId, { priceTableId: t.id, priceTableVersion: t.version, revision: 1, updatedAt: t.createdAt,
      validFrom: t.validFrom, validUntil: t.validUntil, sourceId: t.sourceId }, lots);
    const snapErrors = App.lifecycle.validateSnapshot(snapshot, 'commercial', devId, new Set(byId.keys()));
    if (snapErrors.length) throw new Error(`price table snapshot rejected by the shared validation: ${JSON.stringify(plain(snapErrors.slice(0, 3)))}`);
    for (const [lotId, p] of Object.entries(lots)) if (p.commercial.price != null && !(Number.isFinite(p.commercial.price) && p.commercial.price > 0)) throw invalid('Preço calculado inválido', [issue('lotPrices', 'invalid_result', { lotId })]);

    // per-lot diff against the current table
    const currentPrices = new Map(curId ? (await repo.findLotPrices(db, curId)).map(x => [x.lot_id, x.metadata.commercial]) : []);
    const diff = { lotCount: rows.length, changed: 0, unchanged: 0, increased: 0, decreased: 0, newlyPriced: 0, totals: { current: null, proposed: 0, delta: null }, lots: [] };
    let curTotal = 0, curAll = true;
    for (const r of rows) {
      const c = lots[r.id].commercial, o = currentPrices.get(r.id) || null, o2 = overrides.get(r.id);
      const before = o ? o.price : null, after = c.price;
      const delta = before != null && after != null ? round2(after - before) : null;
      const changed = before !== after || (o ? o.pricePerM2 : null) !== c.pricePerM2;
      if (changed) diff.changed++; else diff.unchanged++;
      if (delta != null && delta > 0) diff.increased++;
      if (delta != null && delta < 0) diff.decreased++;
      if (before == null && after != null) diff.newlyPriced++;
      if (before == null) curAll = false; else curTotal += before;
      if (after != null) diff.totals.proposed += after;
      diff.lots.push({ lotId: r.id, code: r.static.identity.code, areaM2: r.static.geometry.areaM2, currentPrice: before, currentPricePerM2: o ? o.pricePerM2 : null,
        proposedPrice: after, proposedPricePerM2: c.pricePerM2, delta, deltaPercent: delta != null && before ? round2((delta / before) * 100) : null, changed,
        source: o2 ? (o2.price != null ? 'LOT_PRICE' : 'LOT_PRICE_PER_M2') : 'TABLE_PRICE_PER_M2' });
    }
    diff.totals.proposed = round2(diff.totals.proposed);
    if (curAll && currentPrices.size) { diff.totals.current = round2(curTotal); diff.totals.delta = round2(diff.totals.proposed - diff.totals.current); }
    const checksum = checksumOf({ table: { ...t, createdAt: undefined }, lots });
    return { v, cur, t, lots, plans, diff, pricingMode, checksum, actorId };
  }

  const tableDto = (p, status) => ({ ...priceTableDto({ id: p.t.id, development_id: p.t.developmentId, version: p.t.version, name: p.t.name, source_id: p.t.sourceId, issued_on: p.t.createdAt,
    valid_from: p.t.validFrom, valid_until: p.t.validUntil, price_per_m2: p.t.pricePerM2, down_payment_default: p.t.downPaymentDefault }, p.plans.map(x => ({ ...x, price_table_id: p.t.id }))),
  status, currency: p.currency, revision: 1 });

  /** publish(devId, body, { dryRun, actorId, requestId }) → { status, data, meta, location } */
  async function publish(devId, body, { dryRun = false, actorId = null, actorType = null, permissionKey = null, requestId = null } = {}) {
    const cmd = validatePublishPriceTableRequest(body);
    await developments.getVersions(devId); // 404 DEVELOPMENT_NOT_FOUND
    const now = new Date();
    const result = (p, extra) => ({
      dryRun,
      priceTable: tableDto(p, dryRun ? 'DRAFT' : 'PUBLISHED'),
      publication: { publishedAt: extra.publishedAt, publishedBy: dryRun ? null : p.actorId, previousPriceTableId: p.cur ? p.cur.id : null,
        previousPriceTableVersion: p.cur ? p.cur.version : null, pricingMode: p.pricingMode, changeReason: cmd.changeReason, checksum: p.checksum },
      diff: p.diff
    });
    if (dryRun) {
      const p = await prepare(pool, devId, cmd, { actorId, now });
      p.currency = (await devRepo.findById(pool, devId)).currency;
      const conflicts = await repo.findConflicting(pool, devId, p.t.id, p.t.version);
      const data = result(p, { publishedAt: null });
      data.wouldConflict = conflicts.length > 0;
      return { status: 200, data, meta: { versions: developments.versionsDto(p.v) } };
    }
    const out = await withTransaction(pool, async db => {
      const locked = await repo.lockDevelopment(db, devId);
      if (!locked) throw E.developmentNotFound(devId);
      const p = await prepare(db, devId, cmd, { actorId, now });
      const conflicts = await repo.findConflicting(db, devId, p.t.id, p.t.version);
      if (conflicts.length) throw E.conflict('PRICE_TABLE_VERSION_EXISTS', 'Já existe tabela de preço com esta versão ou id; publique uma nova versão', { developmentId: devId, priceTableId: p.t.id, version: p.t.version, existing: conflicts.map(c => ({ priceTableId: c.id, version: c.version })) });
      const dev = await devRepo.findById(db, devId);
      p.currency = dev.currency;
      const row = await repo.insertPublishedTable(db, { id: p.t.id, developmentId: devId, version: p.t.version, name: p.t.name, currency: dev.currency, pricePerM2: p.t.pricePerM2,
        downPaymentDefault: p.t.downPaymentDefault, validFrom: p.t.validFrom, validUntil: p.t.validUntil, sourceId: p.t.sourceId, issuedOn: p.t.createdAt, revision: 1,
        checksum: p.checksum, publishedBy: actorId, changeReason: cmd.changeReason, pricingMode: p.pricingMode });
      await repo.upsertPlans(db, p.t.id, p.plans.map(x => ({ code: x.code, position: x.position, name: x.rules.name, type: x.rules.kind,
        down_payment_percent: Math.round(p.t.downPaymentDefault * 100000) / 1000, installments: x.rules.months ?? null, monthly_rate: x.rules.rate ?? null,
        annual_payments: x.rules.annualCount ?? null, discount_percent: x.rules.discount != null ? Math.round(x.rules.discount * 100000) / 1000 : null, rules: x.rules })));
      await repo.upsertLotPrices(db, p.t.id, Object.entries(p.lots).map(([lotId, m]) => ({ lot_id: lotId, amount: m.commercial.price, currency: m.commercial.currency,
        price_per_m2: m.commercial.pricePerM2, discount_rules: null, metadata: m, checksum: checksumOf(m) })));
      if (p.cur) await repo.archiveTable(db, p.cur.id);
      await repo.setCurrentPriceTable(db, devId, p.t.id);
      await insertAudit(db, { actorId, actorType, permissionKey, action: 'PRICE_TABLE_PUBLISH', entityType: 'price_table', entityId: p.t.id, developmentId: devId,
        oldValue: p.cur ? { priceTableId: p.cur.id, version: p.cur.version } : null,
        newValue: { priceTableId: p.t.id, version: p.t.version, pricingMode: p.pricingMode, pricePerM2: p.t.pricePerM2, lots: p.diff.lotCount, changed: p.diff.changed, checksum: p.checksum, changeReason: cmd.changeReason },
        requestId });
      return result(p, { publishedAt: row.published_at.toISOString() });
    });
    const v = await developments.getVersions(devId);
    return { status: 201, data: out, meta: { versions: developments.versionsDto(v) }, location: `/api/v1/developments/${devId}/price-tables/${encodeURIComponent(out.priceTable.id)}` };
  }

  return { publish };
}

module.exports = { createPriceTablePublicationService };
