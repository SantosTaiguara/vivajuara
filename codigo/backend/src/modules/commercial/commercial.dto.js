'use strict';
/* Commercial DTOs.
   - CommercialSnapshotDto = { kind:'commercial', schemaVersion, developmentId, priceTableId, priceTableVersion, revision, updatedAt, validFrom, validUntil, sourceId, lots }.
   - PriceTableDto: same shape as DevelopmentConfig.priceTables[] in the frontend (plans restored losslessly). */
function commercialSnapshot(schemaVersion, devId, v, rows) {
  const lots = {};
  for (const r of rows) lots[r.lot_id] = r.metadata;
  return { kind: 'commercial', schemaVersion, developmentId: devId, priceTableId: v.priceTableId, priceTableVersion: v.version, revision: v.revision,
    updatedAt: v.issuedOn, validFrom: v.validFrom, validUntil: v.validUntil, sourceId: v.sourceId, lots };
}

function priceTableDto(t, plans) {
  return {
    id: t.id, developmentId: t.development_id, version: t.version, name: t.name, sourceId: t.source_id, createdAt: t.issued_on,
    validFrom: t.valid_from, validUntil: t.valid_until, pricePerM2: t.price_per_m2, downPaymentDefault: t.down_payment_default,
    plans: plans.filter(p => p.price_table_id === t.id).sort((a, b) => a.position - b.position).map(p => p.rules)
  };
}

/** frontend plan definition → payment_plans row (structured columns + lossless rules) */
function planRow(p, i, table) {
  return {
    code: p.id, position: i, name: p.name, type: p.kind, down_payment_percent: table.downPaymentDefault != null ? Math.round(table.downPaymentDefault * 100000) / 1000 : null,
    installments: p.months ?? null, monthly_rate: p.rate ?? null, annual_payments: p.annualCount ?? null,
    discount_percent: p.discount != null ? Math.round(p.discount * 100000) / 1000 : null, rules: p
  };
}

module.exports = { commercialSnapshot, priceTableDto, planRow };
