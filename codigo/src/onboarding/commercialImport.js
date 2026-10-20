/* onboarding/commercialImport.js — topic 58 §112–135, §226–227, §483–486: pricing and availability import candidates.
   Onboarding never writes prices or statuses: it produces validated CANDIDATES and a domain command that the Pricing
   domain (price table publication, topic 27) or the Availability domain (state machine, topic 8) executes with its own
   rules and permissions. A CSV can never set "SOLD" directly (§484).
   - Pricing: minor units, currency check, negative/zero, duplicates, unknown lots, diff (new/changed/missing/unexpected);
     the "large delta" threshold is business policy → not configured → every change needs review (no universal X).
   - Missing price is "price missing", never UNAVAILABLE (§120, §340); availability is never inferred from pricing.
   - Availability: status mapping registry; an unmapped source value (e.g. "PRÉ-RESERVA") is AVAILABILITY_STATUS_UNKNOWN
     and goes to review — never guessed (§132, §341). UNKNOWN is never AVAILABLE.
   Pure. Depends on App.availability, App.enums, App.onboarding.model, App.onboardingPolicy. */
App.onboarding = App.onboarding || {};
App.onboarding.commercial = (() => {
  const M = App.onboarding.model, P = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);
  const issue = (code, severity, lotId, detail, ref) => freeze({ code, severity, lotId: lotId || null, detail: detail || null, sourceRecordRef: ref || null });

  // ------------------------------------------------------------------ pricing
  /** priceCandidates(records, { lotIdOf, knownLotIds, currency, proposedPriceTableVersion }) → { candidates[], missing[], issues[] } */
  function priceCandidates(records, { lotIdOf, knownLotIds, currency = 'BRL', proposedPriceTableVersion }) {
    const candidates = [], missing = [], issues = [], seen = new Map(), known = knownLotIds ? new Set(knownLotIds) : null;
    if (!P().currencyAllowed.includes(currency)) issues.push(issue('CURRENCY_NOT_ALLOWED', 'BLOCKING', null, currency));
    for (const r of records) {
      const lotId = lotIdOf(r), ref = `${r.sourceAssetId}#${r.recordRef}`;
      if (!lotId) { issues.push(issue('PRICE_LOT_UNRESOLVED', 'ERROR', null, 'linha sem identidade de lote', ref)); continue; }
      if (known && !known.has(lotId)) { issues.push(issue('PRICE_LOT_NOT_FOUND', 'BLOCKING', lotId, 'preço para lote inexistente', ref)); continue; }
      const v = r.values['commercial.price'];
      if (v == null) { missing.push(lotId); continue; } // price missing ≠ unavailable
      if (!Number.isInteger(v)) { issues.push(issue('PRICE_NOT_MINOR_UNITS', 'BLOCKING', lotId, 'valor não convertido para centavos', ref)); continue; }
      if (v < 0) { issues.push(issue('PRICE_NEGATIVE', 'BLOCKING', lotId, null, ref)); continue; }
      if (v === 0 && !P().zeroPriceAllowed) { issues.push(issue('PRICE_ZERO', 'BLOCKING', lotId, 'zero só vale se declarado semanticamente válido', ref)); continue; }
      if (seen.has(lotId)) { const prev = seen.get(lotId); issues.push(issue('PRICE_DUPLICATE', 'BLOCKING', lotId, prev.listPriceMinor === v ? 'linha repetida' : 'dois preços diferentes para o mesmo lote', ref)); continue; }
      const c = freeze({ lotId, listPriceMinor: v, currency, sourceRecordRef: ref, proposedPriceTableVersion });
      seen.set(lotId, c); candidates.push(c);
    }
    return freeze({ candidates: freeze(candidates), missing: freeze(missing), issues: freeze(issues) });
  }
  /** priceDiff(currentMinorByLot, candidates, expectedLotIds) → PriceImportDiff + review need (§123–126) */
  function priceDiff(current = {}, candidates, expectedLotIds = null) {
    const now = new Map(candidates.map(c => [c.lotId, c.listPriceMinor])), before = new Map(Object.entries(current).filter(([, v]) => v != null));
    const addedLotIds = [...now.keys()].filter(id => !before.has(id)).sort(), removedLotIds = [...before.keys()].filter(id => !now.has(id)).sort();
    const changedPrices = [...now].filter(([id, v]) => before.has(id) && before.get(id) !== v).map(([id, v]) => freeze({ lotId: id, beforeMinor: before.get(id), afterMinor: v,
      deltaPercent: before.get(id) ? Math.round((v - before.get(id)) / before.get(id) * 10000) / 100 : null })).sort((a, b) => a.lotId < b.lotId ? -1 : 1);
    const unexpected = expectedLotIds ? [...now.keys()].filter(id => !expectedLotIds.includes(id)) : [];
    const threshold = P().priceChangeReviewThresholdPercent;
    const largeDeltas = threshold == null ? [] : changedPrices.filter(c => c.deltaPercent == null || Math.abs(c.deltaPercent) > threshold).map(c => c.lotId);
    const review = threshold == null ? changedPrices.length > 0 || removedLotIds.length > 0 : largeDeltas.length > 0 || removedLotIds.length > 0;
    return freeze({ addedLotIds: freeze(addedLotIds), removedLotIds: freeze(removedLotIds), changedPrices: freeze(changedPrices), unchangedCount: [...now].filter(([id, v]) => before.get(id) === v).length,
      unexpectedLotIds: freeze(unexpected), largeDeltaLotIds: freeze(largeDeltas), thresholdStatus: threshold == null ? P().priceChangeReviewThresholdStatus : 'configurado', requiresReview: review });
  }
  /** domain command for the Pricing domain (topic 27): a NEW PriceTableVersion — never a lot identity change (§343) */
  function pricingCommand({ developmentId, proposedPriceTableVersion, candidates, diff, batchId }) {
    return freeze({ domain: 'PRICING', command: 'PUBLISH_PRICE_TABLE_VERSION', routeTo: 'commercial/priceTablePublication', developmentId, priceTableVersion: proposedPriceTableVersion,
      entryCount: candidates.length, entriesChecksum: M.checksum(candidates.map(c => [c.lotId, c.listPriceMinor, c.currency])), changedCount: diff ? diff.changedPrices.length : null, batchId,
      touchesLotIdentity: false, requiresPermission: 'price_table.publish' });
  }

  // ------------------------------------------------------------------ availability
  const canonStatus = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  /** status mapping registry: platform vocabulary + approved per-source mappings (AvailabilityStatusMapping §131) */
  function statusRegistry(extra = []) {
    const map = new Map();
    for (const s of Object.keys(App.enums.AvailabilityStatus)) map.set('*|' + s, s);
    for (const [k, v] of Object.entries(App.availability.LEGACY_CODES || {})) map.set('*|' + canonStatus(k), v);
    for (const m of [...P().availabilityStatusMappings, ...extra]) {
      if (!m || !m.sourceSystem || m.sourceValue == null || !App.enums.AvailabilityStatus[m.canonicalStatus]) continue;
      map.set(m.sourceSystem + '|' + canonStatus(m.sourceValue), m.canonicalStatus);
    }
    return freeze({ resolve: (sourceSystem, v) => map.get(sourceSystem + '|' + canonStatus(v)) || map.get('*|' + canonStatus(v)) || null, size: map.size });
  }
  /** approve a new mapping (review resolution, §165) — explicit, auditable, never inferred */
  function statusMapping({ sourceSystem, sourceValue, canonicalStatus, approvedBy, at }) {
    if (!approvedBy) return M.fail('VALIDATION_ERROR', 'mapeamento de status exige aprovação');
    if (!App.enums.AvailabilityStatus[canonicalStatus]) return M.fail('VALIDATION_ERROR', 'status canônico inválido');
    return M.ok(freeze({ sourceSystem, sourceValue, canonicalStatus, approvedBy, approvedAt: at }));
  }
  /** availabilityCandidates(records, { lotIdOf, knownLotIds, sourceSystem, registry }) → { candidates[], unknownStatuses[], issues[] } */
  function availabilityCandidates(records, { lotIdOf, knownLotIds, sourceSystem = 'source', registry = statusRegistry() }) {
    const candidates = [], unknown = new Map(), issues = [], seen = new Set(), known = knownLotIds ? new Set(knownLotIds) : null;
    for (const r of records) {
      const lotId = lotIdOf(r), ref = `${r.sourceAssetId}#${r.recordRef}`;
      if (!lotId) { issues.push(issue('AVAILABILITY_LOT_UNRESOLVED', 'ERROR', null, null, ref)); continue; }
      if (known && !known.has(lotId)) { issues.push(issue('AVAILABILITY_LOT_NOT_FOUND', 'BLOCKING', lotId, null, ref)); continue; }
      if (seen.has(lotId)) { issues.push(issue('AVAILABILITY_DUPLICATE', 'BLOCKING', lotId, null, ref)); continue; }
      seen.add(lotId);
      const raw = r.values['availability.status'];
      if (raw == null) { candidates.push(freeze({ lotId, sourceStatus: null, canonicalStatus: 'UNKNOWN', sourceTimestamp: r.values['availability.updatedAt'] || undefined, sourceRecordRef: ref })); continue; }
      const c = registry.resolve(sourceSystem, raw);
      if (!c) { const k = String(raw); unknown.set(k, [...(unknown.get(k) || []), lotId]); continue; } // never guessed
      candidates.push(freeze({ lotId, sourceStatus: String(raw), canonicalStatus: c, sourceTimestamp: r.values['availability.updatedAt'] || undefined, sourceRecordRef: ref }));
    }
    const unknownStatuses = [...unknown].map(([sourceValue, lotIds]) => freeze({ sourceSystem, sourceValue, lotIds: freeze(lotIds) }));
    unknownStatuses.forEach(u => issues.push(issue('AVAILABILITY_STATUS_UNKNOWN', 'BLOCKING', null, `"${u.sourceValue}" sem mapeamento (${u.lotIds.length} lote(s))`)));
    return freeze({ candidates: freeze(candidates), unknownStatuses: freeze(unknownStatuses), issues: freeze(issues) });
  }
  function availabilityDiff(current = {}, candidates) {
    const changed = candidates.filter(c => (current[c.lotId] || 'UNKNOWN') !== c.canonicalStatus).map(c => freeze({ lotId: c.lotId, before: current[c.lotId] || 'UNKNOWN', after: c.canonicalStatus }));
    return freeze({ changed: freeze(changed), unchangedCount: candidates.length - changed.length });
  }
  /** domain command for the Availability domain: initial snapshot or incremental revision (§134–135); transitions are validated there */
  function availabilityCommand({ developmentId, candidates, initial, batchId }) {
    return freeze({ domain: 'AVAILABILITY', command: initial ? 'SEED_INITIAL_REVISION' : 'APPLY_INCREMENTAL_REVISION', routeTo: 'availability/availability.service', developmentId,
      entryCount: candidates.length, entriesChecksum: M.checksum(candidates.map(c => [c.lotId, c.canonicalStatus])), batchId, requiresPermission: 'availability.write', bypassesStateMachine: false });
  }
  /** SourceFreshness (§389–391): static files are not "stale"; external sources without cadence are UNKNOWN */
  function freshness({ sourceDomain, external, lastSuccessfulSyncAt, expectedUpdateCadenceMs = null, now }) {
    if (!external) return freeze({ sourceDomain, status: 'UNKNOWN', applicable: false, note: 'arquivo estático: versão, não atualidade' });
    if (!lastSuccessfulSyncAt || expectedUpdateCadenceMs == null) return freeze({ sourceDomain, lastSuccessfulSyncAt: lastSuccessfulSyncAt || undefined, expectedUpdateCadence: expectedUpdateCadenceMs == null ? 'não configurado' : String(expectedUpdateCadenceMs), status: 'UNKNOWN', applicable: true });
    return freeze({ sourceDomain, lastSuccessfulSyncAt, expectedUpdateCadence: String(expectedUpdateCadenceMs), status: Date.parse(now) - Date.parse(lastSuccessfulSyncAt) <= expectedUpdateCadenceMs ? 'FRESH' : 'STALE', applicable: true });
  }

  return freeze({ priceCandidates, priceDiff, pricingCommand, canonStatus, statusRegistry, statusMapping, availabilityCandidates, availabilityDiff, availabilityCommand, freshness });
})();
