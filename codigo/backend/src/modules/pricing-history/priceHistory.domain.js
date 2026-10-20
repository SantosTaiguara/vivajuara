'use strict';
/* PriceHistoryService (topic 28) — PURE functions, no I/O (works in backend, batch and tests).
   Source of truth: published price table versions (PUBLISHED current + ARCHIVED previous; immutable since migration 005).
   The history is a derived read model: never edited, never a new authoritative price.
   Rules implemented here:
     - points ordered by effectiveFrom (ties: publishedAt, then id); one point per version, invalid points are kept;
     - a version without price for the lot is a MISSING point (gap), never zero, never a decrease (changeType REMOVED);
     - no interpolation: intervals carry only the values of their own version (step series);
     - a change (absolute / percent) is computed ONLY between ≥ 2 comparable VALID points (same priceType LIST_PRICE and
       currency); otherwise null + notCalculableReason. Percent is not computed from a zero start price;
     - change reason is never inferred: UNKNOWN_REASON unless the publication carries a note (reasonText, as informed);
     - wording: "variação do preço de tabela" (nominal). Never "valorização do ativo", "rentabilidade" or "retorno".
   Not implemented (documented): CAGR/annualized rate, inflation adjustment, promotional series (no promotional price type
   exists), asOfKnowledgeDate queries, transaction prices (no sales data). */

const METHODOLOGY_VERSION = 'price-history-1.0';
const PRICE_TYPE = 'LIST_PRICE';
const CAVEATS = Object.freeze([
  'Valores são preços de tabela publicados; não são preços efetivos de venda.',
  'Variações são nominais e referem-se ao preço de tabela; não representam valorização do ativo, rentabilidade nem retorno.',
  'Nenhum valor é interpolado entre versões: períodos sem preço publicado aparecem como lacuna.',
  'O histórico descreve fatos passados e não indica tendência futura.'
]);

const round2 = v => (v == null ? null : Math.round(v * 100) / 100);
const isAmount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const dateOnly = v => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) : null);

function median(values) {
  const xs = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** effectiveFrom of a version: validFrom (business validity) → issuedOn (table date) → publication date */
const effectiveFromOf = v => dateOnly(v.validFrom) || dateOnly(v.issuedOn) || dateOnly(v.publishedAt);

/** orders versions (series order rule) and fills effectiveFrom / effectiveTo (validUntil, else next version start) */
function orderVersions(versions) {
  const xs = versions.map(v => ({ ...v, effectiveFrom: effectiveFromOf(v) }))
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) || String(a.publishedAt || '').localeCompare(String(b.publishedAt || '')) || String(a.priceTableId).localeCompare(String(b.priceTableId)));
  return xs.map((v, i) => ({ ...v, effectiveTo: dateOnly(v.validUntil) || (xs[i + 1] ? xs[i + 1].effectiveFrom : null), versionNumber: i + 1 }));
}

/** delta between two VALID comparable amounts */
function delta(from, to) {
  const absolute = round2(to - from);
  if (from === 0) return { absolute, relativePct: null, calculationStatus: 'PARTIAL', reason: 'ZERO_START_PRICE' };
  return { absolute, relativePct: round2(((to - from) / from) * 100), calculationStatus: 'CALCULATED', reason: null };
}

/**
 * buildLotHistory({ developmentId, lotId, areaM2, versions, pricesByTable, currentPriceTableId, generatedAt }) → LotPriceHistory
 * versions: [{ priceTableId, version, status, currency, validFrom, validUntil, issuedOn, publishedAt, archivedAt, sourceId, checksum, pricingMode, changeReason }]
 * pricesByTable: Map(priceTableId → { amount, pricePerM2, currency }) for this lot (absent = no price in that version)
 */
function buildLotHistory({ developmentId, lotId, areaM2 = null, versions, pricesByTable, currentPriceTableId = null, generatedAt = new Date().toISOString() }) {
  const ordered = orderVersions(versions);
  let seriesCurrency = null;
  const points = ordered.map(v => {
    const p = pricesByTable.get(v.priceTableId) || null;
    const currency = (p && p.currency) || v.currency || null;
    let pointStatus = 'MISSING';
    if (p && p.amount != null) pointStatus = isAmount(p.amount) ? 'VALID' : 'INVALID';
    if (pointStatus === 'VALID') {
      seriesCurrency = seriesCurrency || currency;
      if (currency !== seriesCurrency) pointStatus = 'NOT_APPLICABLE'; // another currency: never mixed into the series
    }
    return {
      lotId, priceTableId: v.priceTableId, priceTableVersion: v.version, versionNumber: v.versionNumber, versionStatus: v.status,
      effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, publishedAt: v.publishedAt || null, archivedAt: v.archivedAt || null,
      amount: pointStatus === 'VALID' ? p.amount : null, pricePerM2: pointStatus === 'VALID' && p.pricePerM2 != null ? p.pricePerM2 : null,
      currency, priceType: PRICE_TYPE, pointStatus, sourceId: v.sourceId || null, checksum: v.checksum || null, pricingMode: v.pricingMode || null
    };
  });
  const intervals = points.map(p => ({ startAt: p.effectiveFrom, endAt: p.effectiveTo, amount: p.amount, priceTableId: p.priceTableId, status: p.pointStatus,
    durationDays: daysBetween(p.effectiveFrom, p.effectiveTo) }));

  const changeEvents = [];
  let prev = null, everValid = false;
  for (const [i, p] of points.entries()) {
    const v = ordered[i];
    const base = { developmentId, lotId, priceType: PRICE_TYPE, fromPriceTableId: prev ? prev.priceTableId : null, toPriceTableId: p.priceTableId, effectiveAt: p.effectiveFrom,
      previousAmount: null, newAmount: p.amount, absoluteDelta: null, relativeDeltaPct: null, reason: 'UNKNOWN_REASON',
      reasonText: v.changeReason || null, reasonSource: v.changeReason ? 'PUBLICATION_NOTE' : null };
    if (p.pointStatus === 'VALID') {
      if (!everValid) changeEvents.push({ ...base, changeType: 'INITIAL' });
      else if (prev && prev.pointStatus === 'VALID') {
        const d = delta(prev.amount, p.amount);
        changeEvents.push({ ...base, previousAmount: prev.amount, absoluteDelta: d.absolute, relativeDeltaPct: d.relativePct,
          changeType: p.amount > prev.amount ? 'INCREASE' : p.amount < prev.amount ? 'DECREASE' : 'UNCHANGED' });
      } else changeEvents.push({ ...base, changeType: 'RESTORED' }); // after a gap: no delta across the gap
      everValid = true;
    } else if (prev && prev.pointStatus === 'VALID') {
      changeEvents.push({ ...base, previousAmount: prev.amount, newAmount: null, changeType: p.pointStatus === 'MISSING' ? 'REMOVED' : 'CONFLICTED' });
    }
    prev = p;
  }

  const valid = points.filter(p => p.pointStatus === 'VALID');
  const last = points[points.length - 1] || null;
  const warnings = [];
  if (last && last.pointStatus !== 'VALID' && valid.length) warnings.push('LATEST_VERSION_WITHOUT_VALID_PRICE');
  if (points.some(p => p.pointStatus === 'NOT_APPLICABLE')) warnings.push('MIXED_CURRENCY_EXCLUDED');
  if (points.some(p => p.pointStatus === 'INVALID')) warnings.push('INVALID_PRICE_POINT');
  if (currentPriceTableId && last && last.priceTableId !== currentPriceTableId) warnings.push('LATEST_VERSION_IS_NOT_CURRENT_TABLE');

  let summary;
  const first = valid[0] || null, lastValid = valid[valid.length - 1] || null;
  const common = {
    priceType: PRICE_TYPE, currency: seriesCurrency, comparableVersionCount: valid.length,
    initialKnownPrice: first ? first.amount : null, initialKnownAt: first ? first.effectiveFrom : null,
    lastKnownPrice: lastValid ? lastValid.amount : null, lastKnownAt: lastValid ? lastValid.effectiveFrom : null,
    currentPrice: last && last.pointStatus === 'VALID' && (!currentPriceTableId || last.priceTableId === currentPriceTableId) ? last.amount : null,
    currentPriceTableId, consistentWithCurrent: !!(last && currentPriceTableId && last.priceTableId === currentPriceTableId),
    initialPricePerM2: first ? first.pricePerM2 : null, lastPricePerM2: lastValid ? lastValid.pricePerM2 : null,
    changeCount: changeEvents.filter(e => e.changeType === 'INCREASE' || e.changeType === 'DECREASE').length,
    lastChangeAt: (changeEvents.filter(e => e.changeType === 'INCREASE' || e.changeType === 'DECREASE').pop() || {}).effectiveAt || null,
    label: 'Variação do preço de tabela (nominal)'
  };
  if (valid.length < 2) {
    summary = { ...common, absoluteChange: null, relativeChangePct: null, pricePerM2Change: null, calculationStatus: 'NOT_CALCULABLE',
      notCalculableReason: valid.length === 0 ? 'NO_VALID_PRICE' : 'INSUFFICIENT_COMPARABLE_VERSIONS', periodDays: null };
  } else {
    const d = delta(first.amount, lastValid.amount);
    summary = { ...common, absoluteChange: d.absolute, relativeChangePct: d.relativePct,
      pricePerM2Change: first.pricePerM2 != null && lastValid.pricePerM2 != null ? round2(lastValid.pricePerM2 - first.pricePerM2) : null,
      calculationStatus: d.calculationStatus, notCalculableReason: d.reason, periodDays: daysBetween(first.effectiveFrom, lastValid.effectiveFrom) };
  }
  const missing = points.filter(p => p.pointStatus === 'MISSING').length;
  const coverageRatio = points.length ? round2(valid.length / points.length) : 0;
  const level = valid.length === 0 ? 'INSUFFICIENT' : valid.length === 1 ? 'LOW' : coverageRatio === 1 ? 'HIGH' : coverageRatio >= 0.5 ? 'MEDIUM' : 'LOW';
  return {
    developmentId, lotId, priceType: PRICE_TYPE, currency: seriesCurrency, areaM2, methodologyVersion: METHODOLOGY_VERSION, generatedAt,
    points, intervals, changeEvents, summary,
    quality: { level, versionCount: points.length, validPointCount: valid.length, missingPointCount: missing,
      invalidPointCount: points.filter(p => p.pointStatus === 'INVALID' || p.pointStatus === 'NOT_APPLICABLE').length, coverageRatio, warnings },
    versionRefs: points.map(p => ({ priceTableId: p.priceTableId, version: p.priceTableVersion, checksum: p.checksum })),
    caveats: [...CAVEATS]
  };
}

/**
 * buildDevelopmentHistory({ developmentId, versions, pricesByTable: Map(tableId → Map(lotId → price)), lotCount, currentPriceTableId })
 * Internal index of the development's TABLE prices (never a market index). Changes use the SAME-LOT BASKET (only lots
 * priced in both versions) and medians (robust to outliers, no naive average, no mix effect).
 */
function buildDevelopmentHistory({ developmentId, versions, pricesByTable, lotCount, currentPriceTableId = null, generatedAt = new Date().toISOString() }) {
  const ordered = orderVersions(versions);
  const validMap = id => {
    const m = pricesByTable.get(id) || new Map();
    return new Map([...m].filter(([, p]) => p && isAmount(p.amount)));
  };
  const vs = ordered.map(v => {
    const m = validMap(v.priceTableId);
    return { priceTableId: v.priceTableId, version: v.version, versionNumber: v.versionNumber, status: v.status, currency: v.currency, effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo, publishedAt: v.publishedAt || null, archivedAt: v.archivedAt || null, sourceId: v.sourceId || null, checksum: v.checksum || null,
      pricingMode: v.pricingMode || null, pricedLotCount: m.size, coverageRatio: lotCount ? round2(m.size / lotCount) : 0,
      medianPrice: round2(median([...m.values()].map(p => p.amount))), medianPricePerM2: round2(median([...m.values()].map(p => p.pricePerM2))) };
  });
  const basket = (a, b) => {
    const ma = validMap(a.priceTableId), mb = validMap(b.priceTableId);
    const ids = [...ma.keys()].filter(id => mb.has(id));
    const comparable = a.currency === b.currency;
    const rel = ids.filter(id => ma.get(id).amount > 0).map(id => ((mb.get(id).amount - ma.get(id).amount) / ma.get(id).amount) * 100);
    let increased = 0, decreased = 0, unchanged = 0;
    for (const id of ids) { const x = ma.get(id).amount, y = mb.get(id).amount; if (y > x) increased++; else if (y < x) decreased++; else unchanged++; }
    const ok = comparable && ids.length > 0;
    return { fromPriceTableId: a.priceTableId, toPriceTableId: b.priceTableId, fromEffectiveAt: a.effectiveFrom, toEffectiveAt: b.effectiveFrom,
      method: 'SAME_LOT_BASKET_MEDIAN', commonLotCount: ids.length, coverageRatio: lotCount ? round2(ids.length / lotCount) : 0,
      addedLotCount: [...mb.keys()].filter(id => !ma.has(id)).length, removedPriceLotCount: [...ma.keys()].filter(id => !mb.has(id)).length,
      increased, decreased, unchanged,
      medianRelativeChangePct: ok ? round2(median(rel)) : null,
      medianPricePerM2From: ok ? round2(median(ids.map(id => ma.get(id).pricePerM2))) : null, medianPricePerM2To: ok ? round2(median(ids.map(id => mb.get(id).pricePerM2))) : null,
      calculationStatus: ok ? 'CALCULATED' : 'NOT_CALCULABLE', notCalculableReason: !comparable ? 'MIXED_CURRENCY' : ids.length ? null : 'NO_COMMON_LOTS' };
  };
  const changes = vs.slice(1).map((b, i) => basket(vs[i], b));
  const summary = vs.length < 2
    ? { change: null, calculationStatus: 'NOT_CALCULABLE', notCalculableReason: 'INSUFFICIENT_COMPARABLE_VERSIONS' }
    : (() => { const c = basket(vs[0], vs[vs.length - 1]); return { change: c.calculationStatus === 'CALCULATED' ? c : null, calculationStatus: c.calculationStatus, notCalculableReason: c.notCalculableReason }; })();
  const last = vs[vs.length - 1] || null;
  return {
    developmentId, priceType: PRICE_TYPE, methodologyVersion: METHODOLOGY_VERSION, generatedAt, lotCount,
    label: 'Índice interno dos preços de tabela do empreendimento — não é índice de mercado nem valorização do ativo.',
    versions: vs, changes,
    summary: { versionCount: vs.length, firstVersionAt: vs.length ? vs[0].effectiveFrom : null, latestVersionAt: last ? last.effectiveFrom : null,
      currentPriceTableId, consistentWithCurrent: !!(last && currentPriceTableId && last.priceTableId === currentPriceTableId),
      numberOfRepricings: changes.filter(c => c.increased + c.decreased > 0).length, ...summary },
    caveats: [...CAVEATS]
  };
}

module.exports = { buildLotHistory, buildDevelopmentHistory, orderVersions, median, delta, METHODOLOGY_VERSION, PRICE_TYPE, CAVEATS };
