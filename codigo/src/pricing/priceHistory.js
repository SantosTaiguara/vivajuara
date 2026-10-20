/* pricing/priceHistory.js — Topic 28: price history as a time series of PUBLISHED price table versions.
   History is a derived read model: the published versions are the only source of truth (never edited here).
   - PriceTableVersionRef: minimum version model (topic 27 was not provided): id, developmentId, effectiveFrom,
     status PUBLISHED/ARCHIVED, source, priceType, currency, pricing mode, checksum. Built from the frontend
     DevelopmentConfig.priceTables, commercial.json or the backend PriceTableDto.
   - Points (one per version, invalid ones kept), intervals (validity periods), change events, deltas,
     price per m², quality/completeness, development index (same-lot basket, median), date comparison.
   - Nothing is interpolated; a single version gives a single point and the change is NOT_CALCULABLE (never 0%).
   - Wording: "preço de tabela" / "variação do preço de tabela", nominal. It is not a transaction price, not
     a return and not a promise; every view model carries DISCLAIMER.
   Pure functions (no fetch) except the API repository. Money is kept in minor units (centavos). */
App.priceHistory = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const METHODOLOGY_VERSION = '28.1.0';
  const PointStatus = E('VALID', 'MISSING', 'WITHHELD', 'CONFLICTED', 'INVALID', 'NOT_APPLICABLE');
  const ChangeType = E('INITIAL', 'INCREASE', 'DECREASE', 'UNCHANGED', 'WITHHELD', 'RESTORED', 'REMOVED', 'CONFLICTED', 'CORRECTION', 'PROMOTION_START', 'PROMOTION_END', 'OTHER_CONFIGURED');
  const ChangeReason = E('TABLE_REPRICING', 'COMMERCIAL_CAMPAIGN', 'PROMOTION', 'CORRECTION', 'PHASE_CHANGE', 'MANUAL_APPROVED', 'UNKNOWN_REASON');
  const PriceType = E('LIST_PRICE', 'PROMOTIONAL_PRICE', 'REFERENCE_PRICE');
  const VersionStatus = E('DRAFT', 'PUBLISHED', 'ARCHIVED');
  const ResolutionMode = E('EXACT_EFFECTIVE', 'LAST_KNOWN_BEFORE', 'PUBLISHED_AS_OF', 'EXPLICIT_VERSION');
  const MissingDataPolicy = E('STRICT_GAP', 'LAST_KNOWN_WITH_WARNING', 'EXCLUDE_PERIOD', 'CUSTOM_EXPLICIT');
  const PromotionAdjustmentPolicy = E('INCLUDE_AS_OBSERVED', 'EXCLUDE_FROM_BASE_APPRECIATION', 'SEPARATE_SERIES', 'MARK_ONLY');
  const QualityLevel = E('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT');
  const MetricType = E('ABSOLUTE_CHANGE', 'PERCENT_CHANGE', 'CAGR_NOMINAL', 'PRICE_PER_M2_CHANGE', 'DEVELOPMENT_RELATIVE_CHANGE', 'OTHER_CONFIGURED');
  const IndexMethod = E('MEDIAN_PRICE_PER_M2', 'MEDIAN_LOT_PRICE', 'SAME_LOT_BASKET');
  const CalcStatus = E('CALCULATED', 'NOT_CALCULABLE');
  const EVENTS = Object.freeze(['price_history_opened', 'price_history_period_changed', 'price_history_shared', 'price_history_comparison_opened']);
  const QUALITY_RANK = { INSUFFICIENT: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const DAY = 86400000;

  /** PriceHistory policies (one object, overridable per development through DevelopmentConfig.priceHistoryPolicy) */
  const DEFAULT_POLICY = Object.freeze({
    version: METHODOLOGY_VERSION, primaryPriceType: 'LIST_PRICE', missingDataPolicy: 'STRICT_GAP', promotionPolicy: 'SEPARATE_SERIES',
    excludeCorrectionsFromChange: true, cagr: Object.freeze({ minElapsedDays: 365, modes: Object.freeze(['broker', 'technical']) }),
    quickView: Object.freeze({ minQuality: 'MEDIUM', minValidPoints: 2 }),
    aggregation: Object.freeze({ method: 'SAME_LOT_BASKET', eligibleStatuses: Object.freeze(['VALID']), eligiblePriceTypes: Object.freeze(['LIST_PRICE']), requireSameLotBasket: true,
      minCoverage: 0.8, outlierPolicy: 'MEDIAN_ROBUST', missingDataPolicy: 'STRICT_GAP', weightingMethod: null, version: METHODOLOGY_VERSION })
  });
  const policyOf = dev => { const o = (dev && dev.priceHistoryPolicy) || {}; return { ...DEFAULT_POLICY, ...o, cagr: { ...DEFAULT_POLICY.cagr, ...(o.cagr || {}) }, quickView: { ...DEFAULT_POLICY.quickView, ...(o.quickView || {}) }, aggregation: { ...DEFAULT_POLICY.aggregation, ...(o.aggregation || {}) } }; };

  const DISCLAIMER = 'Preço de tabela publicado pela loteadora, em valores nominais. Não é o preço efetivo de uma venda, e variações passadas da tabela não indicam variações futuras.';
  const INDEX_LABEL = 'Índice interno de preços de tabela do empreendimento (não é índice de mercado).';

  // ------------------------------------------------------------------ small helpers
  const iso = d => d == null ? null : String(d).slice(0, 10);
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d.slice(0, 10)));
  const days = (a, b) => Math.round((Date.parse(iso(b)) - Date.parse(iso(a))) / DAY);
  const today = now => new Date(now != null ? now : Date.now()).toISOString().slice(0, 10);
  const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const lotIdOf = lot => lot && (lot.identity ? lot.identity.id : lot.id);
  const areaOf = lot => lot && (lot.geometry ? lot.geometry.areaM2 : lot.areaM2);
  const toMinor = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 100);
  const fromMinor = m => m == null ? null : m / 100;

  // ------------------------------------------------------------------ PriceTableVersionRef (minimum topic-27 contract)
  /** toVersion(table, opts) — table: DevelopmentConfig.priceTables[] | commercial.json priceTables[] | backend PriceTableDto.
      effectiveFrom: effectiveFrom → validFrom → createdAt (issue date) → version label when it is a date; the basis is kept,
      and an inferred basis lowers quality (validity was not informed by the source). */
  function toVersion(t, opts = {}) {
    if (!t || !t.id) return null;
    const basis = t.effectiveFrom ? 'EFFECTIVE_FROM' : t.validFrom ? 'VALID_FROM' : t.createdAt ? 'ISSUE_DATE' : isDate(t.version) ? 'VERSION_LABEL' : 'UNKNOWN';
    const effectiveFrom = iso(t.effectiveFrom || t.validFrom || t.createdAt || (isDate(t.version) ? t.version : null));
    const status = VersionStatus[t.status] ? t.status : 'PUBLISHED'; // the frontend config and commercial.json only carry published tables
    const priceType = PriceType[t.priceType] ? t.priceType : 'LIST_PRICE';
    const reasonCode = ChangeReason[t.reasonCode] ? t.reasonCode : 'UNKNOWN_REASON'; // never inferred from the price movement
    const lotPrices = t.lotPrices && typeof t.lotPrices === 'object' ? t.lotPrices : null;
    const pricingMode = t.pricingMode || (lotPrices ? (t.pricePerM2 != null ? 'MIXED' : 'PER_LOT') : 'PER_M2');
    const v = { id: t.id, priceTableId: t.priceTableId || t.id, developmentId: t.developmentId || opts.developmentId || null, version: t.version || null,
      effectiveFrom, effectiveFromBasis: basis, effectiveTo: iso(t.effectiveTo || t.validUntil || null), validUntil: iso(t.validUntil || null),
      publishedAt: t.publishedAt || null, importedAt: t.importedAt || null, knownAt: iso(t.publishedAt || t.importedAt || null) || effectiveFrom,
      status, priceType, currency: t.currency || opts.currency || 'BRL', pricingMode, pricePerM2: t.pricePerM2 != null ? Number(t.pricePerM2) : null, lotPrices,
      reasonCode, changeReason: t.changeReason || null, isCorrection: reasonCode === 'CORRECTION', retroactive: !!(t.retroactive && reasonCode === 'CORRECTION'),
      isPromotion: priceType === 'PROMOTIONAL_PRICE' || reasonCode === 'PROMOTION', source: { sourceId: t.sourceId || null, kind: opts.sourceKind || 'CONFIG' },
      revision: t.revision != null ? t.revision : null };
    v.checksum = t.checksum || fnv(JSON.stringify([v.id, v.version, v.effectiveFrom, v.priceType, v.currency, v.pricingMode, v.pricePerM2, lotPrices ? Object.keys(lotPrices).sort().map(k => [k, lotPrices[k]]) : null]));
    return Object.freeze(v);
  }
  const orderVersions = vs => vs.slice().sort((a, b) => (a.effectiveFrom || '9999') < (b.effectiveFrom || '9999') ? -1 : (a.effectiveFrom || '9999') > (b.effectiveFrom || '9999') ? 1
    : (a.publishedAt || '') < (b.publishedAt || '') ? -1 : (a.publishedAt || '') > (b.publishedAt || '') ? 1 : (a.revision || 0) - (b.revision || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** versionsFrom({ priceTables, currentPriceTableId, developmentId, currency }) → ordered PUBLISHED/ARCHIVED versions (DRAFT dropped) with versionNumber */
  function versionsFrom(src, opts = {}) {
    const list = ((src && src.priceTables) || []).map(t => toVersion(t, { developmentId: src.developmentId || src.id, currency: src.currency, ...opts })).filter(v => v && v.status !== 'DRAFT' && v.effectiveFrom);
    return Object.freeze(orderVersions(list).map((v, i) => Object.freeze({ ...v, versionNumber: i + 1 })));
  }
  /** inventory of the versions (report and technical mode) */
  const inventory = versions => ({ count: versions.length, priceTypes: [...new Set(versions.map(v => v.priceType))], currencies: [...new Set(versions.map(v => v.currency))],
    first: versions.length ? versions[0].effectiveFrom : null, last: versions.length ? versions[versions.length - 1].effectiveFrom : null,
    inferredEffectiveDates: versions.filter(v => !['EFFECTIVE_FROM', 'VALID_FROM'].includes(v.effectiveFromBasis)).map(v => v.id) });

  /** lotPrice(version, lot) → { amountMinor, status } — same rule as CommercialRepository.commercialFor (area × R$/m², cents) or the per-lot entry */
  function lotPrice(v, lot) {
    const id = lotIdOf(lot), area = areaOf(lot);
    if (v.lotPrices && Object.prototype.hasOwnProperty.call(v.lotPrices, id)) {
      const e = v.lotPrices[id];
      if (e == null) return { amountMinor: null, status: 'MISSING' };
      if (typeof e === 'object') { const st = PointStatus[e.status] ? e.status : 'VALID', a = e.amount != null ? Number(e.amount) : null;
        if (st === 'VALID' && (a == null || !Number.isFinite(a))) return { amountMinor: null, status: 'MISSING' };
        if (a != null && a < 0) return { amountMinor: null, status: 'INVALID' };
        return { amountMinor: st === 'VALID' || st === 'CONFLICTED' ? toMinor(a) : null, status: st }; }
      const a = Number(e); if (!Number.isFinite(a) || a < 0) return { amountMinor: null, status: 'INVALID' };
      return { amountMinor: toMinor(a), status: 'VALID' };
    }
    if (v.pricingMode === 'PER_LOT' || v.pricePerM2 == null) return { amountMinor: null, status: 'MISSING' };
    if (area == null || !Number.isFinite(area)) return { amountMinor: null, status: 'NOT_APPLICABLE' };
    return { amountMinor: toMinor(App.pricing.formula.lotPrice(area, v.pricePerM2)), status: 'VALID' }; // TD-12: single formula
  }

  // ------------------------------------------------------------------ series
  /** eligibleVersions(versions, q): priceType, no DRAFT, no future version (effectiveFrom > asOf), knowledge date (bitemporal) */
  function eligibleVersions(versions, q = {}) {
    const asOf = q.asOf || today(q.now), pt = q.priceType || 'LIST_PRICE';
    return orderVersions(versions.filter(v => v.status !== 'DRAFT' && v.priceType === pt && v.effectiveFrom && v.effectiveFrom <= asOf && (!q.asOfKnowledgeDate || (v.knownAt || v.effectiveFrom) <= q.asOfKnowledgeDate)));
  }
  /** buildPoints → PriceHistoryPoint[] ordered by effectiveFrom; invalid/missing points are kept (the series must know its gaps) */
  function buildPoints(versions, lot, q = {}) {
    const vs = eligibleVersions(versions, q), area = areaOf(lot), base = vs.length ? vs[0].currency : null;
    return vs.map((v, i) => {
      const next = vs[i + 1], p = lotPrice(v, lot);
      let status = p.status; const flags = [];
      if (v.currency !== base) { status = 'INVALID'; flags.push('MIXED_CURRENCY'); }
      const effectiveTo = v.validUntil && (!next || v.validUntil < next.effectiveFrom) ? v.validUntil : next ? next.effectiveFrom : null;
      const ppm2 = status !== 'VALID' ? null : v.pricingMode === 'PER_M2' ? toMinor(v.pricePerM2) : area ? Math.round(p.amountMinor / area) : null;
      return Object.freeze({ lotId: lotIdOf(lot), priceTableVersionId: v.id, priceTableId: v.priceTableId, versionLabel: v.version, versionNumber: v.versionNumber || i + 1,
        effectiveFrom: v.effectiveFrom, effectiveTo, amountMinor: status === 'VALID' || status === 'CONFLICTED' ? p.amountMinor : null, currency: v.currency, priceType: v.priceType,
        entryStatus: p.status, pointStatus: status, areaM2: area != null ? area : null, pricePerM2Minor: ppm2,
        provenance: Object.freeze({ sourceId: v.source.sourceId, sourceKind: v.source.kind, versionStatus: v.status, checksum: v.checksum, effectiveFromBasis: v.effectiveFromBasis, knownAt: v.knownAt }),
        sourceRef: v.source.sourceId, metadata: Object.freeze({ reasonCode: v.reasonCode, isCorrection: v.isCorrection, retroactive: v.retroactive, isPromotion: v.isPromotion, flags }) });
    });
  }
  /** buildIntervals: one interval per point plus explicit MISSING gaps when a validity ends before the next version starts */
  function buildIntervals(points, q = {}) {
    const asOf = q.asOf || today(q.now), out = [];
    points.forEach((p, i) => {
      const end = p.effectiveTo, next = points[i + 1];
      out.push(Object.freeze({ startAt: p.effectiveFrom, endAt: end, amountMinor: p.amountMinor, priceTableVersionId: p.priceTableVersionId, status: p.pointStatus, durationDays: days(p.effectiveFrom, end || asOf), open: end == null, sourceRef: p.sourceRef }));
      if (end && (next ? end < next.effectiveFrom : end < asOf)) out.push(Object.freeze({ startAt: end, endAt: next ? next.effectiveFrom : null, amountMinor: null, priceTableVersionId: null, status: 'MISSING', durationDays: days(end, next ? next.effectiveFrom : asOf), open: !next, sourceRef: null, gap: true }));
    });
    return out;
  }
  /** calculateDelta(from, to, opts) → PriceDelta. Never a percentage from zero; never between non-VALID points or different price types/currencies. */
  function calculateDelta(from, to, opts = {}) {
    const pol = opts.policy || DEFAULT_POLICY, warnings = [];
    const base = { lotId: (to || from || {}).lotId || null, priceType: (to || from || {}).priceType || null, fromDate: from ? from.effectiveFrom : null, toDate: to ? to.effectiveFrom : null,
      fromVersionId: from ? from.priceTableVersionId : null, toVersionId: to ? to.priceTableVersionId : null, fromAmountMinor: from ? from.amountMinor : null, toAmountMinor: to ? to.amountMinor : null,
      absoluteDeltaMinor: null, relativeDeltaPct: null, elapsedDays: null, annualizedRatePct: null };
    const no = reason => Object.freeze({ ...base, calculationStatus: 'NOT_CALCULABLE', reason, warnings });
    if (!from || !to) return no('MISSING_POINT');
    if (from.priceTableVersionId === to.priceTableVersionId) return no('SINGLE_POINT');
    if (from.pointStatus !== 'VALID' || to.pointStatus !== 'VALID') return no('INVALID_POINT');
    if (from.priceType !== to.priceType) return no('MIXED_PRICE_TYPE');
    if (from.currency !== to.currency) return no('MIXED_CURRENCY');
    const abs = to.amountMinor - from.amountMinor, elapsed = days(opts.fromDate || from.effectiveFrom, opts.toDate || to.effectiveFrom);
    const rel = from.amountMinor > 0 ? abs / from.amountMinor : null; if (rel == null) warnings.push('ZERO_START');
    const cagr = calculateCagr(from.amountMinor, to.amountMinor, elapsed, pol);
    if (cagr.reason === 'SHORT_PERIOD') warnings.push('SHORT_PERIOD_NO_ANNUALIZATION');
    return Object.freeze({ ...base, absoluteDeltaMinor: abs, relativeDeltaPct: rel, elapsedDays: elapsed, annualizedRatePct: cagr.value, calculationStatus: 'CALCULATED', reason: null, warnings });
  }
  /** CAGR nominal = (final/initial)^(365/elapsedDays) − 1, only with initial > 0, final > 0 and elapsedDays ≥ policy.minElapsedDays */
  function calculateCagr(initial, final, elapsedDays, policy = DEFAULT_POLICY) {
    if (!(initial > 0) || !(final > 0)) return { value: null, reason: 'NON_POSITIVE_VALUE' };
    if (!(elapsedDays > 0)) return { value: null, reason: 'NO_ELAPSED_TIME' };
    if (elapsedDays < ((policy.cagr && policy.cagr.minElapsedDays) || 365)) return { value: null, reason: 'SHORT_PERIOD' };
    return { value: Math.pow(final / initial, 365 / elapsedDays) - 1, reason: null };
  }
  /** buildChangeEvents → PriceChangeEvent[]. Reason comes only from the version metadata (UNKNOWN_REASON otherwise). */
  function buildChangeEvents(points, q = {}) {
    const out = []; let lastValid = null, prev = null, inPromo = false;
    for (const p of points) {
      let type, delta = null;
      if (p.pointStatus === 'WITHHELD') type = 'WITHHELD';
      else if (p.pointStatus === 'CONFLICTED') type = 'CONFLICTED';
      else if (p.pointStatus !== 'VALID') type = lastValid ? 'REMOVED' : 'OTHER_CONFIGURED';
      else if (!lastValid) type = 'INITIAL';
      else {
        delta = calculateDelta(lastValid, p, q);
        if (prev && prev.pointStatus !== 'VALID') type = 'RESTORED';
        else if (p.metadata.isCorrection) type = 'CORRECTION';
        else if (p.metadata.isPromotion && !inPromo) type = 'PROMOTION_START';
        else if (!p.metadata.isPromotion && inPromo) type = 'PROMOTION_END';
        else type = delta.absoluteDeltaMinor > 0 ? 'INCREASE' : delta.absoluteDeltaMinor < 0 ? 'DECREASE' : 'UNCHANGED';
      }
      if (p.pointStatus === 'VALID') inPromo = !!p.metadata.isPromotion;
      out.push(Object.freeze({ developmentId: q.developmentId || null, lotId: p.lotId, priceType: p.priceType, fromVersionId: lastValid ? lastValid.priceTableVersionId : null, toVersionId: p.priceTableVersionId,
        effectiveAt: p.effectiveFrom, previousAmountMinor: lastValid ? lastValid.amountMinor : null, newAmountMinor: p.amountMinor, absoluteDeltaMinor: delta ? delta.absoluteDeltaMinor : null,
        relativeDeltaPct: delta ? delta.relativeDeltaPct : null, changeType: type, reason: p.metadata.reasonCode, reasonSource: p.metadata.reasonCode === 'UNKNOWN_REASON' ? null : 'VERSION_METADATA',
        provenance: p.provenance, qualityFlags: p.metadata.flags }));
      if (p.pointStatus === 'VALID') lastValid = p;
      prev = p;
    }
    return out;
  }
  /** completeness + quality. Quality qualifies, never changes values. */
  function evaluateCompleteness(points, intervals, q = {}) {
    const valid = points.filter(p => p.pointStatus === 'VALID'), asOf = q.asOf || today(q.now);
    const first = valid.length ? valid[0].effectiveFrom : null, last = valid.length ? valid[valid.length - 1].effectiveFrom : null;
    const gaps = intervals.filter(i => i.status !== 'VALID'), span = first ? Math.max(1, days(first, asOf)) : 0;
    const gapDays = gaps.reduce((s, g) => s + Math.max(0, g.durationDays || 0), 0), covered = first ? Math.max(0, span - gapDays) : 0;
    return Object.freeze({ firstKnownAt: first, lastKnownAt: last, coveredDays: covered, gapDays, gapCount: gaps.length, expectedVersionCount: q.expectedVersionCount != null ? q.expectedVersionCount : null,
      observedVersionCount: points.length, coverageRatio: first ? covered / span : 0 });
  }
  function evaluateQuality(points, completeness, q = {}) {
    const c = s => points.filter(p => p.pointStatus === s).length, valid = c('VALID'), warnings = [];
    const missing = c('MISSING') + c('WITHHELD') + c('NOT_APPLICABLE'), conflicted = c('CONFLICTED'), invalid = c('INVALID');
    let level = valid === 0 ? 'INSUFFICIENT' : 'HIGH';
    if (valid === 1) { level = 'LOW'; warnings.push('SINGLE_VERSION'); }
    if (conflicted) { warnings.push('CONFLICTED_POINTS'); if (level === 'HIGH') level = 'MEDIUM'; }
    if (invalid) warnings.push(points.some(p => p.metadata.flags.includes('MIXED_CURRENCY')) ? 'MIXED_CURRENCY' : 'INVALID_POINTS');
    if (completeness.gapCount) { warnings.push('GAPS'); if (level === 'HIGH') level = completeness.coverageRatio >= 0.9 ? 'MEDIUM' : 'LOW'; }
    if (points.some(p => !['EFFECTIVE_FROM', 'VALID_FROM'].includes(p.provenance.effectiveFromBasis))) { warnings.push('EFFECTIVE_DATE_INFERRED'); if (level === 'HIGH') level = 'MEDIUM'; }
    if (q.offlinePartial) { warnings.push('OFFLINE_PARTIAL_HISTORY'); if (QUALITY_RANK[level] > QUALITY_RANK.LOW) level = 'LOW'; }
    return Object.freeze({ level, validPointCount: valid, missingPointCount: missing, conflictedPointCount: conflicted, invalidPointCount: invalid, stalePointCount: q.stale ? valid : 0,
      coverageRatio: completeness.coverageRatio, continuityScore: null, sourceConsistency: new Set(points.map(p => p.currency)).size <= 1 ? 'CONSISTENT' : 'MIXED', warnings });
  }

  /** buildLotHistory(versions, lot, query) → LotPriceHistory. query = { developmentId, priceType, asOf, asOfKnowledgeDate, now, offlinePartial, generatedAt, policy } */
  function buildLotHistory(versions, lot, q = {}) {
    const pol = q.policy || DEFAULT_POLICY, pt = q.priceType || pol.primaryPriceType, qq = { ...q, priceType: pt, policy: pol };
    const points = buildPoints(versions, lot, qq), intervals = buildIntervals(points, qq), changeEvents = buildChangeEvents(points, qq);
    const completeness = evaluateCompleteness(points, intervals, qq), quality = evaluateQuality(points, completeness, qq);
    const valid = points.filter(p => p.pointStatus === 'VALID');
    const promotional = pt === 'LIST_PRICE' && pol.promotionPolicy === 'SEPARATE_SERIES' && versions.some(v => v.priceType === 'PROMOTIONAL_PRICE')
      ? buildPoints(versions, lot, { ...qq, priceType: 'PROMOTIONAL_PRICE' }) : null;
    return Object.freeze({ developmentId: q.developmentId || (versions[0] && versions[0].developmentId) || null, lotId: lotIdOf(lot), lotCode: lot && lot.identity ? lot.identity.code : null,
      priceType: pt, currency: points.length ? points[0].currency : null,
      series: Object.freeze({ points, intervals, changeEvents, metadata: Object.freeze({ methodologyVersion: METHODOLOGY_VERSION, missingDataPolicy: pol.missingDataPolicy, promotionPolicy: pol.promotionPolicy,
        asOf: q.asOf || today(q.now), asOfKnowledgeDate: q.asOfKnowledgeDate || null, seriesType: 'STEP', interpolation: 'NONE' }) }),
      promotionalSeries: promotional, pricePerM2: pricePerM2History(points, lot),
      firstKnownPriceAt: valid.length ? valid[0].effectiveFrom : null, latestKnownPriceAt: valid.length ? valid[valid.length - 1].effectiveFrom : null,
      pointCount: points.length, quality, completeness, versionRefs: points.map(p => ({ priceTableVersionId: p.priceTableVersionId, versionLabel: p.versionLabel, checksum: p.provenance.checksum, effectiveFrom: p.effectiveFrom })),
      generatedAt: q.generatedAt || null, offlinePartial: !!q.offlinePartial, policyVersion: pol.version });
  }
  /** PricePerM2History: price / canonical static area (the area is not versioned today: policy STATIC_CANONICAL_AREA) */
  function pricePerM2History(points, lot) {
    return Object.freeze({ areaPolicy: 'STATIC_CANONICAL_AREA', areaVersionRef: lot && lot.metadata && lot.metadata.dataVersions ? lot.metadata.dataVersions.staticVersion || null : null,
      points: points.map(p => Object.freeze({ effectiveAt: p.effectiveFrom, priceMinor: p.amountMinor, areaM2: p.areaM2, pricePerM2Minor: p.pricePerM2Minor, priceVersionId: p.priceTableVersionId,
        calculationStatus: p.pricePerM2Minor != null ? 'CALCULATED' : 'NOT_CALCULABLE' })) });
  }

  // ------------------------------------------------------------------ HistoricalPriceResolver
  /** resolveAt(history, date, mode, opts) → { status, point, fallback, warnings }. No interpolation; no value before the first known price. */
  function resolveAt(history, date, mode = 'EXACT_EFFECTIVE', opts = {}) {
    const points = history.series ? history.series.points : history, d = iso(date), warnings = [];
    if (mode === 'EXPLICIT_VERSION') { const p = points.find(x => x.priceTableVersionId === opts.versionId); return { status: p ? p.pointStatus : 'MISSING', point: p || null, fallback: false, warnings }; }
    const known = mode === 'PUBLISHED_AS_OF' ? points.filter(p => (p.provenance.knownAt || p.effectiveFrom) <= d) : points;
    if (!known.length || d < known[0].effectiveFrom) return { status: 'MISSING', point: null, fallback: false, reason: 'BEFORE_FIRST_KNOWN', warnings };
    // PUBLISHED_AS_OF: the end of a validity set by a version published later was not known at that date
    const exact = mode === 'PUBLISHED_AS_OF' ? known.filter(p => p.effectiveFrom <= d).pop() : known.filter(p => p.effectiveFrom <= d && (p.effectiveTo == null || d < p.effectiveTo)).pop();
    if (exact) return { status: exact.pointStatus, point: exact, fallback: false, warnings };
    if (mode === 'LAST_KNOWN_BEFORE' || (opts.policy && opts.policy.missingDataPolicy === 'LAST_KNOWN_WITH_WARNING')) {
      const last = known.filter(p => p.effectiveFrom <= d && p.pointStatus === 'VALID').pop();
      if (last) { warnings.push('LAST_KNOWN_FALLBACK'); return { status: 'VALID', point: last, fallback: true, warnings }; }
    }
    return { status: 'MISSING', point: null, fallback: false, reason: 'GAP', warnings };
  }

  // ------------------------------------------------------------------ summary / appreciation results
  /** summarize(history, { from, to, mode, policy }) → LotPriceHistorySummary (+ PriceAppreciationResult[]) */
  function summarize(history, o = {}) {
    const pol = o.policy || DEFAULT_POLICY, pts = history.series.points, valid = pts.filter(p => p.pointStatus === 'VALID'), warnings = [...history.quality.warnings];
    const to = iso(o.to) || history.series.metadata.asOf;
    const endR = resolveAt(history, to, 'EXACT_EFFECTIVE', { policy: pol }), end = endR.status === 'VALID' ? endR.point : null;
    let start = null, periodBasis = 'SINCE_FIRST_RECORDED';
    if (o.from) { const r = resolveAt(history, o.from, 'EXACT_EFFECTIVE', { policy: pol }); start = r.status === 'VALID' ? r.point : null; periodBasis = 'CUSTOM'; if (!start) warnings.push('NO_START_PRICE'); }
    else start = valid.length ? valid[0] : null;
    const from = o.from ? iso(o.from) : start ? start.effectiveFrom : null;
    let delta = start && end ? calculateDelta(start, end, { policy: pol, fromDate: from, toDate: to }) : null;
    if (delta && delta.reason === 'SINGLE_POINT') delta = null;
    const inPeriod = history.series.changeEvents.filter(e => from && e.effectiveAt > from && e.effectiveAt <= to);
    const corrections = inPeriod.filter(e => e.changeType === 'CORRECTION');
    if (corrections.length) warnings.push('CORRECTION_IN_PERIOD');
    if (inPeriod.some(e => e.changeType === 'PROMOTION_START' || e.changeType === 'PROMOTION_END')) warnings.push('PROMOTION_IN_PERIOD');
    // repricing-only change: chain-linked over non-correction events (a correction of an error is not a repricing)
    let repricing = null;
    if (delta && delta.calculationStatus === 'CALCULATED' && pol.excludeCorrectionsFromChange && corrections.length) {
      const f = inPeriod.filter(e => e.relativeDeltaPct != null && e.changeType !== 'CORRECTION').reduce((acc, e) => acc * (1 + e.relativeDeltaPct), 1);
      repricing = f - 1;
    }
    const calc = !!(delta && delta.calculationStatus === 'CALCULATED');
    if (!calc) warnings.push(valid.length <= 1 ? 'CHANGE_NOT_CALCULABLE_SINGLE_VERSION' : 'CHANGE_NOT_CALCULABLE');
    const cagrAllowed = calc && (pol.cagr.modes || []).includes(o.mode || 'broker');
    const res = (metricType, startValue, endValue, resultValue) => Object.freeze({ lotId: history.lotId, metricType, period: { from, to }, startValue, endValue, resultValue,
      currency: history.currency, methodologyVersion: METHODOLOGY_VERSION, dataQuality: history.quality.level, calculationStatus: resultValue == null ? 'NOT_CALCULABLE' : 'CALCULATED', warnings: warnings.slice(),
      sourceVersionRefs: [start && start.priceTableVersionId, end && end.priceTableVersionId].filter(Boolean), nominal: true });
    const ppm2Change = calc && start.pricePerM2Minor && end.pricePerM2Minor ? (end.pricePerM2Minor - start.pricePerM2Minor) / start.pricePerM2Minor : null;
    const results = [res('ABSOLUTE_CHANGE', start && start.amountMinor, end && end.amountMinor, calc ? delta.absoluteDeltaMinor : null),
      res('PERCENT_CHANGE', start && start.amountMinor, end && end.amountMinor, calc ? delta.relativeDeltaPct : null),
      res('PRICE_PER_M2_CHANGE', start && start.pricePerM2Minor, end && end.pricePerM2Minor, ppm2Change),
      res('CAGR_NOMINAL', start && start.amountMinor, end && end.amountMinor, cagrAllowed ? delta.annualizedRatePct : null)];
    return Object.freeze({ lotId: history.lotId, priceType: history.priceType, currency: history.currency, period: { from, to, basis: periodBasis },
      initialKnownPrice: start ? start.amountMinor : null, currentPrice: end ? end.amountMinor : null, absoluteChange: calc ? delta.absoluteDeltaMinor : null, relativeChange: calc ? delta.relativeDeltaPct : null,
      repricingChangeExcludingCorrections: repricing, cagrNominal: cagrAllowed ? delta.annualizedRatePct : null, elapsedDays: calc ? delta.elapsedDays : null,
      firstKnownAt: history.firstKnownPriceAt, lastChangeAt: (history.series.changeEvents.filter(e => ['INCREASE', 'DECREASE', 'RESTORED', 'PROMOTION_START', 'PROMOTION_END'].includes(e.changeType) && e.absoluteDeltaMinor).pop() || {}).effectiveAt || null,
      changeCount: history.series.changeEvents.filter(e => ['INCREASE', 'DECREASE'].includes(e.changeType) || (['RESTORED', 'PROMOTION_START', 'PROMOTION_END'].includes(e.changeType) && e.absoluteDeltaMinor)).length,
      currentPricePerM2: end ? end.pricePerM2Minor : null, initialPricePerM2: start ? start.pricePerM2Minor : null,
      calculationStatus: calc ? 'CALCULATED' : 'NOT_CALCULABLE', dataQuality: history.quality.level, warnings: [...new Set(warnings)], results });
  }
  /** current consistency: the last valid point must equal the price the app shows now (PricingResolver current = lot.commercial.price) */
  function checkCurrentConsistency(history, lot) {
    const last = history.series.points.filter(p => p.pointStatus === 'VALID').pop(), cur = lot && lot.commercial ? toMinor(lot.commercial.price) : null;
    const curVersion = lot && lot.commercial ? lot.commercial.priceTableVersion || null : null;
    if (!last && cur == null) return { consistent: true, reason: 'BOTH_ABSENT', historyMinor: null, currentMinor: null };
    const sameVersion = !curVersion || !last || last.versionLabel === curVersion;
    return { consistent: !!last && cur === last.amountMinor && sameVersion, reason: !last ? 'NO_HISTORY' : cur !== last.amountMinor ? 'AMOUNT_MISMATCH' : sameVersion ? null : 'VERSION_MISMATCH', historyMinor: last ? last.amountMinor : null, currentMinor: cur };
  }

  // ------------------------------------------------------------------ development aggregation
  /** developmentIndex(versions, lots, { policy, asOf }) → DevelopmentPriceIndex (base = 100 at the first version). Median, never a naive average. */
  function developmentIndex(versions, lots, o = {}) {
    const pol = { ...DEFAULT_POLICY.aggregation, ...((o.policy && o.policy.aggregation) || {}) }, vs = eligibleVersions(versions, o), warnings = [];
    if (!vs.length) return Object.freeze({ method: pol.method, baseDate: null, points: [], coverage: 0, quality: 'INSUFFICIENT', methodologyVersion: METHODOLOGY_VERSION, label: INDEX_LABEL, warnings: ['NO_VERSIONS'], change: null });
    const priced = v => new Map(lots.map(l => [lotIdOf(l), lotPrice(v, l)]).filter(([, p]) => pol.eligibleStatuses.includes(p.status)));
    const base = vs[0], bp = priced(base), area = new Map(lots.map(l => [lotIdOf(l), areaOf(l)]));
    const points = vs.map(v => {
      const cp = v === base ? bp : priced(v), basket = [...cp.keys()].filter(id => bp.has(id));
      let value = null;
      if (pol.method === 'SAME_LOT_BASKET') { const r = median(basket.filter(id => bp.get(id).amountMinor > 0).map(id => cp.get(id).amountMinor / bp.get(id).amountMinor)); value = r == null ? null : r * 100; }
      else { const m = ids => median(ids.map(id => pol.method === 'MEDIAN_PRICE_PER_M2' ? cp.get(id).amountMinor / area.get(id) : cp.get(id).amountMinor)), mb = median([...bp.keys()].map(id => pol.method === 'MEDIAN_PRICE_PER_M2' ? bp.get(id).amountMinor / area.get(id) : bp.get(id).amountMinor));
        const ids = pol.requireSameLotBasket ? basket : [...cp.keys()], mv = m(ids); value = mv != null && mb ? mv / mb * 100 : null; }
      const coverage = lots.length ? basket.length / lots.length : 0;
      return Object.freeze({ effectiveAt: v.effectiveFrom, indexValue: value, baseDate: base.effectiveFrom, method: pol.method, eligibleLotCount: basket.length, totalLotCount: lots.length, coverage, sourceVersionId: v.id,
        quality: coverage >= pol.minCoverage ? 'HIGH' : coverage > 0 ? 'LOW' : 'INSUFFICIENT' });
    });
    const minCov = Math.min(...points.map(p => p.coverage)); if (minCov < pol.minCoverage) warnings.push('LOW_COVERAGE');
    if (points.length === 1) warnings.push('SINGLE_VERSION');
    const last = points[points.length - 1];
    return Object.freeze({ method: pol.method, baseDate: base.effectiveFrom, points, coverage: minCov, quality: points.length === 1 ? 'LOW' : minCov >= pol.minCoverage ? 'HIGH' : 'LOW', methodologyVersion: METHODOLOGY_VERSION,
      label: INDEX_LABEL, coverageText: `Índice calculado sobre ${last.eligibleLotCount} de ${lots.length} lotes com preço válido.`, warnings,
      change: points.length > 1 && last.indexValue != null ? { calculationStatus: 'CALCULATED', relative: last.indexValue / 100 - 1 } : { calculationStatus: 'NOT_CALCULABLE', relative: null } });
  }
  /** compareDates(versions, lots, from, to) → HistoricalPriceComparison (common lot basket; added lots apart; removed/withheld is not a decrease) */
  function compareDates(versions, lots, from, to, o = {}) {
    const warnings = [], lotChanges = [], added = [], removed = [];
    for (const l of lots) {
      const h = buildLotHistory(versions, l, { ...o, asOf: iso(to) }), a = resolveAt(h, from), b = resolveAt(h, to);
      if (a.status !== 'VALID' && b.status === 'VALID') { added.push(h.lotId); continue; }
      if (a.status === 'VALID' && b.status !== 'VALID') { removed.push({ lotId: h.lotId, toStatus: b.status }); continue; }
      if (a.status !== 'VALID') continue;
      const d = a.point.priceTableVersionId === b.point.priceTableVersionId ? null : calculateDelta(a.point, b.point, { ...o, fromDate: from, toDate: to });
      lotChanges.push(Object.freeze({ lotId: h.lotId, fromPrice: a.point.amountMinor, toPrice: b.point.amountMinor, absoluteDelta: d ? d.absoluteDeltaMinor : 0, relativeDelta: d ? d.relativeDeltaPct : 0,
        pricePerM2Delta: a.point.pricePerM2Minor != null && b.point.pricePerM2Minor != null ? b.point.pricePerM2Minor - a.point.pricePerM2Minor : null,
        changeType: !d ? 'SAME_VERSION' : d.absoluteDeltaMinor > 0 ? 'INCREASE' : d.absoluteDeltaMinor < 0 ? 'DECREASE' : 'UNCHANGED', quality: h.quality.level }));
    }
    const sameVersion = lotChanges.length && lotChanges.every(c => c.changeType === 'SAME_VERSION');
    if (sameVersion) warnings.push('SAME_VERSION_BOTH_DATES');
    const coverage = lots.length ? lotChanges.length / lots.length : 0; if (coverage < DEFAULT_POLICY.aggregation.minCoverage) warnings.push('LOW_COVERAGE');
    return Object.freeze({ fromSnapshotRef: { date: iso(from) }, toSnapshotRef: { date: iso(to) }, lotChanges, added, removed, commonLotCount: lotChanges.length, coverage, methodologyVersion: METHODOLOGY_VERSION, warnings,
      developmentSummary: { medianRelativeChange: sameVersion || !lotChanges.length ? null : median(lotChanges.map(c => c.relativeDelta)), calculationStatus: sameVersion || !lotChanges.length ? 'NOT_CALCULABLE' : 'CALCULATED' } });
  }

  // ------------------------------------------------------------------ comparison metrics (topics 24/25: INFORMATIONAL, never a winner)
  /** comparisonMetrics(histories, { from, to }) → { comparable, reasons, metrics[] } — all candidates on the same period, price type and methodology */
  function comparisonMetrics(histories, period = {}) {
    const reasons = [], sums = histories.map(h => summarize(h, period));
    if (new Set(histories.map(h => h.priceType)).size > 1) reasons.push('MIXED_PRICE_TYPE');
    if (new Set(histories.map(h => h.policyVersion + '|' + h.series.metadata.methodologyVersion)).size > 1) reasons.push('MIXED_METHODOLOGY');
    if (new Set(sums.map(s => `${s.period.from}|${s.period.to}`)).size > 1) reasons.push('DIFFERENT_PERIOD');
    const comparable = !reasons.length;
    const m = (key, label, pick) => ({ key, label, semantics: 'INFORMATIONAL', better: null, values: sums.map(s => comparable ? pick(s) : null),
      notComparable: sums.map(s => !comparable || pick(s) == null) });
    return { comparable, reasons, period: sums.length ? sums[0].period : null, metrics: [
      m('priceChangePctPeriod', 'Variação do preço de tabela no período (%)', s => s.relativeChange),
      m('priceChangeAbsolutePeriod', 'Variação do preço de tabela no período (R$)', s => fromMinor(s.absoluteChange)),
      m('pricePerM2ChangePeriod', 'Variação do R$/m² de tabela no período', s => s.results.find(r => r.metricType === 'PRICE_PER_M2_CHANGE').resultValue),
      m('cagrNominalPeriod', 'Variação anualizada nominal da tabela', s => s.cagrNominal)] };
  }

  // ------------------------------------------------------------------ cache, repository, application service
  /** PriceHistoryCache: key = developmentId | priceTableIds | lot or aggregation key | from | to | priceType | hash(included version ids + checksums) | methodology. No UI state in the key. */
  function createCache() {
    const store = new Map();
    const keyOf = (devId, scopeKey, versions, q = {}) => { const vs = eligibleVersions(versions, q);
      return [devId, [...new Set(vs.map(v => v.priceTableId))].join(','), scopeKey, iso(q.from) || '-', q.asOf || today(q.now), q.priceType || 'LIST_PRICE', fnv(vs.map(v => v.id + ':' + v.checksum).join(';')), METHODOLOGY_VERSION].join('|'); };
    return { keyOf, get: k => store.get(k), set: (k, v) => (store.set(k, v), v), has: k => store.has(k), size: () => store.size, clear: () => store.clear(),
      invalidateDevelopment: devId => { for (const k of [...store.keys()]) if (k.startsWith(devId + '|')) store.delete(k); } };
  }
  /** local PriceHistoryRepository: versions from the CommercialRepository (frontend config) */
  function PriceHistoryRepository(devId, opts = {}) {
    const dev = opts.dev || App.repos.DevelopmentRepository.getDevelopment(devId), commercial = opts.commercialRepo || App.repos.CommercialRepository(devId);
    const list = () => versionsFrom({ priceTables: commercial.getPriceTables(), developmentId: devId, currency: dev.currency }, { sourceKind: 'CONFIG' });
    return { kind: 'local', listPublishedVersions: (from, to) => list().filter(v => (!from || (v.effectiveTo || '9999') >= from) && (!to || v.effectiveFrom <= to)), getVersion: id => list().find(v => v.id === id) || null, complete: true };
  }
  /** API repository (assumed contract, see PRICE_HISTORY_ARCHITECTURE.md §API): GET /api/v1/developments/{id}/price-tables → PriceTableDto[]
      (PUBLISHED + ARCHIVED). On failure falls back to the local versions and flags the history as partial. */
  function ApiPriceHistoryRepository(devId, opts = {}) {
    const base = (opts.baseUrl || '').replace(/\/$/, ''), f = opts.fetch || (typeof fetch === 'function' ? fetch : null), local = opts.fallback || null;
    let complete = false;
    return { kind: 'api', get complete() { return complete; },
      async listPublishedVersions() {
        try { const r = await f(`${base}/api/v1/developments/${encodeURIComponent(devId)}/price-tables?status=PUBLISHED,ARCHIVED`); if (!r.ok) throw new Error('HTTP ' + r.status);
          const body = await r.json(), items = Array.isArray(body) ? body : body && (body.data || body.items) || [];
          complete = true; return versionsFrom({ priceTables: items, developmentId: devId }, { sourceKind: 'API' }); }
        catch (e) { complete = false; return local ? local.listPublishedVersions() : []; }
      },
      async getLotHistory(lotId, q = {}) {
        const qs = ['from', 'to', 'priceType', 'asOfKnowledgeDate'].filter(k => q[k]).map(k => `${k}=${encodeURIComponent(q[k])}`).join('&');
        const r = await f(`${base}/api/v1/developments/${encodeURIComponent(devId)}/lots/${encodeURIComponent(lotId)}/price-history${qs ? '?' + qs : ''}`);
        if (!r.ok) return null; return r.json();
      } };
  }
  /** PriceHistoryApplicationService: versions + cache → lot histories, summaries, index, comparisons. Sync over a loaded version list. */
  function createService({ developmentId, versions, cache = createCache(), policy = DEFAULT_POLICY, offlinePartial = false } = {}) {
    let vs = versions || [];
    const svc = {
      versions: () => vs, inventory: () => inventory(vs), policy,
      /** new published version: replaces the list; histories whose included versions change get a new cache key (closed periods stay cached) */
      setVersions(next) { vs = next; return svc; },
      lotHistory(lot, q = {}) { const qq = { developmentId, policy, offlinePartial, ...q }, k = cache.keyOf(developmentId, lotIdOf(lot), vs, qq) + (qq.offlinePartial ? '|partial' : '');
        return cache.get(k) || cache.set(k, buildLotHistory(vs, lot, qq)); },
      summary(lot, q = {}) { return summarize(svc.lotHistory(lot, q), { ...q, policy }); },
      consistency(lot, q = {}) { return checkCurrentConsistency(svc.lotHistory(lot, q), lot); },
      index(lots, q = {}) { const k = cache.keyOf(developmentId, 'INDEX:' + (q.method || policy.aggregation.method), vs, q); return cache.get(k) || cache.set(k, developmentIndex(vs, lots, { ...q, policy })); },
      compare(lots, from, to) { return compareDates(vs, lots, from, to, { policy }); },
      comparisonMetrics(lots, period = {}) { return comparisonMetrics(lots.map(l => svc.lotHistory(l, { asOf: period.to })), period); },
      viewModel(lot, o = {}) { const h = svc.lotHistory(lot, o); return viewModel(h, { ...o, lot, policy }); }
    };
    return svc;
  }
  /** convenience for the UI: local service of a development (sync) */
  function forDevelopment(devId, opts = {}) {
    const dev = opts.dev || App.repos.DevelopmentRepository.getDevelopment(devId), repo = opts.repository || PriceHistoryRepository(devId, { dev });
    return createService({ developmentId: devId, versions: repo.listPublishedVersions(), policy: policyOf(dev), offlinePartial: repo.complete === false || !!opts.offlinePartial, cache: opts.cache });
  }

  // ------------------------------------------------------------------ view models (labels in Portuguese live here, the domain keeps codes)
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const longDate = d => { if (!d) return 'data não informada'; const [y, m, dd] = iso(d).split('-'); return `${Number(dd)} de ${MONTHS[Number(m) - 1]} de ${y}`; };
  const shortDate = d => App.fmt.formatDate(iso(d));
  const brl = m => m == null ? 'Não disponível' : App.fmt.formatBRL(fromMinor(m));
  const brlM2 = m => m == null ? 'Não disponível' : App.fmt.formatPricePerM2(fromMinor(m));
  const pct = (v, d = 1) => v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v * 100))}%`;
  const QUALITY_LABEL = { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa', INSUFFICIENT: 'Insuficiente' };
  const CHANGE_LABEL = { INITIAL: 'Primeiro preço registrado', INCREASE: 'Aumento na tabela', DECREASE: 'Redução na tabela', UNCHANGED: 'Sem alteração de preço', WITHHELD: 'Preço sob consulta',
    RESTORED: 'Preço publicado novamente', REMOVED: 'Sem preço publicado', CONFLICTED: 'Preço com divergência', CORRECTION: 'Correção de tabela (não é reajuste)', PROMOTION_START: 'Início de condição promocional',
    PROMOTION_END: 'Fim de condição promocional', OTHER_CONFIGURED: 'Outro evento' };
  const WARNING_TEXT = { SINGLE_VERSION: 'Há uma única versão publicada da tabela: a variação não pode ser calculada.', GAPS: 'Há períodos sem preço publicado; nada foi preenchido automaticamente.',
    EFFECTIVE_DATE_INFERRED: 'A tabela não informa a data de vigência; usada a data de emissão (necessita confirmação).', CONFLICTED_POINTS: 'Há preços com divergência entre fontes.',
    MIXED_CURRENCY: 'Versões em moedas diferentes foram excluídas do cálculo.', INVALID_POINTS: 'Há registros de preço inválidos excluídos do cálculo.',
    OFFLINE_PARTIAL_HISTORY: 'Histórico parcial disponível offline.', NO_START_PRICE: 'Sem preço registrado no início do período escolhido.',
    CORRECTION_IN_PERIOD: 'Há correção de tabela no período; correção não é reajuste.', PROMOTION_IN_PERIOD: 'Há condição promocional no período, marcada à parte.',
    CHANGE_NOT_CALCULABLE_SINGLE_VERSION: null, CHANGE_NOT_CALCULABLE: 'A variação não pode ser calculada para este período.', SHORT_PERIOD_NO_ANNUALIZATION: null };
  const warningTexts = ws => [...new Set(ws.map(w => WARNING_TEXT[w]).filter(Boolean))];
  /** period options: an option is enabled only when its start date has a known price (no fake start value) */
  function periodOptions(history, now) {
    const to = history.series.metadata.asOf, first = history.firstKnownPriceAt;
    const back = (n, unit) => { const d = new Date(Date.parse(to)); if (unit === 'd') d.setUTCDate(d.getUTCDate() - n); else d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
    const opt = (id, label, from) => ({ id, label, from, enabled: !!first && (from == null || from >= first), reason: !first ? 'Sem preço registrado' : from != null && from < first ? 'Sem preço registrado no início do período' : null });
    return [opt('SINCE_FIRST', 'Desde o primeiro preço registrado', null), opt('D30', 'Últimos 30 dias', back(30, 'd')), opt('D90', 'Últimos 90 dias', back(90, 'd')),
      opt('M6', 'Últimos 6 meses', back(6, 'm')), opt('M12', 'Últimos 12 meses', back(12, 'm')), { id: 'CUSTOM', label: 'Período personalizado', from: null, enabled: !!first, reason: null }];
  }
  /** PriceHistoryChartViewModel: STEP series, no smoothing, no interpolation; gaps are segments of their own */
  function chartViewModel(history, summary) {
    const asOf = history.series.metadata.asOf, iv = history.series.intervals, pts = history.series.points, events = new Map(history.series.changeEvents.map(e => [e.toVersionId, e]));
    const amounts = pts.map(p => p.amountMinor).filter(v => v != null);
    const tip = p => { const e = events.get(p.priceTableVersionId);
      return [`Vigência desde ${shortDate(p.effectiveFrom)}${p.provenance.effectiveFromBasis === 'ISSUE_DATE' ? ' (data de emissão)' : ''}`, `Preço de tabela: ${p.pointStatus === 'VALID' ? brl(p.amountMinor) : CHANGE_LABEL[e ? e.changeType : 'REMOVED']}`,
        `Versão: ${p.versionLabel || p.priceTableVersionId}`, 'Tipo: preço de tabela', `Fonte: ${p.provenance.versionStatus === 'ARCHIVED' ? 'tabela arquivada' : 'tabela publicada'}`,
        `Variação vs anterior: ${e && e.relativeDeltaPct != null ? pct(e.relativeDeltaPct) : 'não se aplica'}`].join(' · '); };
    return Object.freeze({ seriesType: 'STEP', smoothing: false, interpolation: 'NONE',
      points: pts.map(p => ({ x: p.effectiveFrom, y: p.amountMinor, status: p.pointStatus, versionId: p.priceTableVersionId, changeType: (events.get(p.priceTableVersionId) || {}).changeType || null, tooltip: tip(p) })),
      intervals: iv.filter(i => i.status === 'VALID').map(i => ({ x0: i.startAt, x1: i.endAt || asOf, y: i.amountMinor, open: i.open, versionId: i.priceTableVersionId })),
      gapSegments: iv.filter(i => i.status !== 'VALID').map(i => ({ x0: i.startAt, x1: i.endAt || asOf, status: i.status, tooltip: 'Sem preço publicado disponível neste período.' })),
      markers: history.series.changeEvents.filter(e => e.changeType !== 'INITIAL').map(e => ({ x: e.effectiveAt, changeType: e.changeType, label: CHANGE_LABEL[e.changeType] })),
      xAxis: { from: history.firstKnownPriceAt || asOf, to: asOf, label: 'Data de vigência' },
      yAxis: { min: amounts.length ? Math.min(...amounts) : null, max: amounts.length ? Math.max(...amounts) : null, label: 'Preço de tabela (R$, nominal)', nominal: true },
      annotations: summary.calculationStatus === 'CALCULATED' ? [] : [{ x: history.firstKnownPriceAt, text: history.quality.validPointCount === 1 ? 'Única versão publicada da tabela' : 'Variação não calculável' }],
      tooltips: pts.map(tip) });
  }
  /** accessible table: the chart's information as text rows */
  function accessibleRows(history) {
    const ev = new Map(history.series.changeEvents.map(e => [e.toVersionId, e])), rows = [];
    for (const i of history.series.intervals) {
      if (i.status !== 'VALID') { rows.push({ date: i.startAt, price: null, text: `De ${longDate(i.startAt)}${i.endAt ? ` a ${longDate(i.endAt)}` : ' em diante'}: sem preço registrado neste período.`, change: null }); continue; }
      const e = ev.get(i.priceTableVersionId);
      rows.push({ date: i.startAt, price: brl(i.amountMinor), text: `Em ${longDate(i.startAt)}, preço de tabela ${brl(i.amountMinor)}.`,
        change: !e || e.changeType === 'INITIAL' ? 'Primeiro preço registrado.' : e.relativeDeltaPct != null ? `Variação de ${pct(e.relativeDeltaPct)} em relação à versão anterior (${CHANGE_LABEL[e.changeType].toLowerCase()}).` : CHANGE_LABEL[e.changeType] + '.' });
    }
    return rows;
  }
  /** PriceHistorySummaryViewModel */
  function summaryViewModel(s, history, mode) {
    const calc = s.calculationStatus === 'CALCULATED', single = history.quality.validPointCount <= 1;
    const notCalc = single ? `Não pode ser calculada: há uma única versão da tabela${history.firstKnownPriceAt ? ` (${shortDate(history.firstKnownPriceAt)})` : ''}.` : 'Não pode ser calculada para este período.';
    const field = (value, text, dataStatus) => ({ value, text, dataStatus });
    return Object.freeze({ title: 'Variação do preço de tabela',
      currentPrice: field(fromMinor(s.currentPrice), brl(s.currentPrice), s.currentPrice == null ? 'UNKNOWN' : 'CALCULATED'),
      initialPrice: field(fromMinor(s.initialKnownPrice), brl(s.initialKnownPrice), s.initialKnownPrice == null ? 'UNKNOWN' : 'CALCULATED'),
      absoluteChange: field(calc ? fromMinor(s.absoluteChange) : null, calc ? `${s.absoluteChange > 0 ? '+' : s.absoluteChange < 0 ? '−' : ''}${brl(Math.abs(s.absoluteChange))}` : notCalc, calc ? 'CALCULATED' : 'UNKNOWN'),
      relativeChange: field(calc ? s.relativeChange : null, calc && s.relativeChange != null ? pct(s.relativeChange) : notCalc, calc && s.relativeChange != null ? 'CALCULATED' : 'UNKNOWN'),
      cagrNominal: mode === 'client' || mode === 'presentation' || !calc ? null : field(s.cagrNominal, s.cagrNominal != null ? `${pct(s.cagrNominal)} ao ano (nominal, tabela)` : 'Não calculada (período curto ou sem variação)', s.cagrNominal != null ? 'CALCULATED' : 'UNKNOWN'),
      currentPricePerM2: field(fromMinor(s.currentPricePerM2), brlM2(s.currentPricePerM2), s.currentPricePerM2 == null ? 'UNKNOWN' : 'CALCULATED'),
      initialPricePerM2: field(fromMinor(s.initialPricePerM2), brlM2(s.initialPricePerM2), s.initialPricePerM2 == null ? 'UNKNOWN' : 'CALCULATED'),
      periodLabel: s.period.basis === 'CUSTOM' ? `De ${shortDate(s.period.from)} a ${shortDate(s.period.to)}` : s.period.from ? `Desde o primeiro preço registrado (${shortDate(s.period.from)})` : 'Sem preço registrado',
      dataQualityLabel: `Qualidade do histórico: ${QUALITY_LABEL[history.quality.level]}`, changeCount: s.changeCount, calculationStatus: s.calculationStatus,
      caveats: warningTexts(s.warnings), disclaimer: DISCLAIMER });
  }
  /** viewModel(history, { mode: client|broker|technical|presentation, lot, from, to }) → PriceHistoryViewModel */
  function viewModel(history, o = {}) {
    const mode = o.mode || 'broker', s = summarize(history, { from: o.from, to: o.to, mode, policy: o.policy }), sum = summaryViewModel(s, history, mode);
    const events = history.series.changeEvents.map(e => ({ effectiveAt: e.effectiveAt, dateLabel: shortDate(e.effectiveAt), changeType: e.changeType, label: CHANGE_LABEL[e.changeType],
      price: brl(e.newAmountMinor), change: e.relativeDeltaPct != null ? pct(e.relativeDeltaPct) : null, reason: mode === 'technical' ? e.reason : null }));
    const technical = mode === 'technical' ? { methodologyVersion: METHODOLOGY_VERSION, policyVersion: history.policyVersion, asOf: history.series.metadata.asOf,
      versions: history.series.points.map(p => ({ id: p.priceTableVersionId, label: p.versionLabel, effectiveFrom: p.effectiveFrom, effectiveFromBasis: p.provenance.effectiveFromBasis, status: p.provenance.versionStatus, checksum: p.provenance.checksum, sourceId: p.provenance.sourceId, pointStatus: p.pointStatus })),
      gaps: history.series.intervals.filter(i => i.status !== 'VALID'), completeness: history.completeness } : null;
    return Object.freeze({ lot: { lotId: history.lotId, code: history.lotCode }, mode, summary: sum, series: mode === 'presentation' ? null : history.series,
      chart: chartViewModel(history, s), changeEvents: mode === 'presentation' ? events.filter(e => e.changeType === 'INITIAL' || e.change) : events, periodOptions: periodOptions(history),
      quality: { level: history.quality.level, label: QUALITY_LABEL[history.quality.level], coverageRatio: history.completeness.coverageRatio },
      warnings: warningTexts(history.quality.warnings), offlinePartial: history.offlinePartial, accessibleRows: accessibleRows(history), disclaimer: DISCLAIMER,
      actions: { canChangePeriod: history.quality.validPointCount > 0, canShare: history.quality.validPointCount > 0, canCompare: true }, technicalDetails: technical, quickView: quickViewSummary(history, { mode, policy: o.policy, summary: s }) });
  }
  /** QuickView: discreet "+5,4% desde 08/2026" only when the same price type, enough quality, defined start and "tabela" wording; otherwise hidden (with the reason) */
  function quickViewSummary(history, o = {}) {
    const pol = o.policy || DEFAULT_POLICY, s = o.summary || summarize(history, { mode: o.mode, policy: pol });
    const hide = reason => ({ visible: false, reason, label: 'Variação da tabela', text: null });
    if (history.quality.validPointCount < pol.quickView.minValidPoints) return hide('SINGLE_VERSION');
    if (QUALITY_RANK[history.quality.level] < QUALITY_RANK[pol.quickView.minQuality]) return hide('LOW_QUALITY');
    if (s.calculationStatus !== 'CALCULATED' || s.relativeChange == null || !s.period.from) return hide('NOT_CALCULABLE');
    const [y, m] = s.period.from.split('-');
    return { visible: true, reason: null, label: 'Variação da tabela', text: `${pct(s.relativeChange)} desde ${m}/${y}`, title: 'Variação nominal do preço de tabela. ' + DISCLAIMER };
  }
  /** shareText: historical facts only, always "preço de tabela"; never a return or a promise */
  function shareText(history, o = {}) {
    const s = summarize(history, { ...o, mode: 'client' }), name = o.lotLabel || history.lotCode || history.lotId;
    if (s.currentPrice == null) return `Lote ${name}: sem preço de tabela publicado no período.`;
    const body = s.calculationStatus === 'CALCULATED' && s.absoluteChange !== 0
      ? `Preço de tabela do lote ${name} passou de ${brl(s.initialKnownPrice)} para ${brl(s.currentPrice)} entre ${shortDate(s.period.from)} e ${shortDate(s.period.to)} (variação nominal da tabela de ${pct(s.relativeChange)}).`
      : s.calculationStatus === 'CALCULATED' ? `Preço de tabela do lote ${name} manteve-se em ${brl(s.currentPrice)} entre ${shortDate(s.period.from)} e ${shortDate(s.period.to)}.`
      : `Preço de tabela do lote ${name}: ${brl(s.currentPrice)} (tabela de ${shortDate(history.latestKnownPriceAt)}). Há uma única versão publicada; não há variação a informar.`;
    return `${body} ${DISCLAIMER}`;
  }

  // ------------------------------------------------------------------ API-ready DTOs
  function toLotPriceHistoryDto(history, o = {}) {
    const s = summarize(history, o);
    return { lotId: history.lotId, priceType: history.priceType, currency: history.currency,
      series: history.series.points.map(p => ({ priceTableVersionId: p.priceTableVersionId, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, amount: fromMinor(p.amountMinor), pricePerM2: fromMinor(p.pricePerM2Minor), pointStatus: p.pointStatus })),
      summary: { initialKnownPrice: fromMinor(s.initialKnownPrice), currentPrice: fromMinor(s.currentPrice), absoluteChange: fromMinor(s.absoluteChange), relativeChange: s.relativeChange, calculationStatus: s.calculationStatus, period: s.period, changeCount: s.changeCount },
      quality: { level: history.quality.level, warnings: history.quality.warnings, coverageRatio: history.completeness.coverageRatio }, versionRefs: history.versionRefs, methodologyVersion: METHODOLOGY_VERSION };
  }
  const analyticsEvent = (name, data = {}) => EVENTS.includes(name) ? { name, lotId: data.lotId || null, period: data.period || null, mode: data.mode || null } : null; // no PII by construction

  return Object.freeze({ METHODOLOGY_VERSION, PointStatus, ChangeType, ChangeReason, PriceType, VersionStatus, ResolutionMode, MissingDataPolicy, PromotionAdjustmentPolicy, QualityLevel, MetricType, IndexMethod, CalcStatus, EVENTS,
    DEFAULT_POLICY, DISCLAIMER, INDEX_LABEL, policyOf, toVersion, versionsFrom, inventory, lotPrice, eligibleVersions, buildPoints, buildIntervals, buildChangeEvents, calculateDelta, calculateCagr,
    evaluateCompleteness, evaluateQuality, buildLotHistory, pricePerM2History, resolveAt, summarize, checkCurrentConsistency, developmentIndex, compareDates, comparisonMetrics,
    createCache, PriceHistoryRepository, ApiPriceHistoryRepository, createService, forDevelopment, periodOptions, chartViewModel, accessibleRows, summaryViewModel, viewModel, quickViewSummary, shareText,
    toLotPriceHistoryDto, analyticsEvent, longDate });
})();
