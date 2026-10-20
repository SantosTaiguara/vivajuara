/* governance/goldenBaseline.js — topic 54: golden baseline of the CURRENT product (non-regression).
   capture(App, input) runs the real modules over the real Viva Juara dataset and returns one plain JSON object per
   golden category (DATA, CALCULATION, MAP, LAYER, FILTER, RECOMMENDATION, FINANCIAL, SOLAR, QUICKVIEW, SHARE,
   COMPARISON, SEARCH, TEXT). diff(expected, actual) lists every drift by JSON path. Nothing here changes data:
   it reads canonical Lots through the repository, the published configuration and the existing services.
   Values are snapshotted as the product computes them today; floats from trigonometry/finance are rounded to
   1e-6 only to make the snapshot independent of the JS engine's last-bit differences (display rounding is
   never applied here: calculation precision is what is preserved).
   Rule: the snapshot covers data and computed outputs, never in-progress UI modules (actions, navigation, layout). */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.governance = App.governance || {};
App.governance.golden = (() => {
  const SCHEMA_VERSION = '1.0';
  const CATEGORIES = Object.freeze(['dataset', 'lots', 'map', 'layers', 'filters', 'recommendations', 'finance', 'solar', 'quickview', 'share', 'comparison', 'search', 'texts']);

  // ------------------------------------------------------------------ canonical JSON + fingerprints
  /** stable(x): JSON with sorted object keys; Map → object, Set → sorted array, undefined/functions dropped */
  function stable(x) {
    const norm = v => {
      if (v === undefined || typeof v === 'function') return undefined;
      if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
      const tag = Object.prototype.toString.call(v); // cross-realm safe (the Node harness runs modules in a vm)
      if (tag === '[object Map]') return norm(Object.fromEntries(v));
      if (tag === '[object Set]') return [...v].map(norm).sort();
      if (Array.isArray(v)) return v.map(x => { const n = norm(x); return n === undefined ? null : n; });
      const o = {}; for (const k of Object.keys(v).sort()) { const n = norm(v[k]); if (n !== undefined) o[k] = n; } return o;
    };
    return JSON.stringify(norm(x));
  }
  const plain = x => JSON.parse(stable(x));
  const sha = s => (App.integrity && App.integrity.sha256) ? App.integrity.sha256(s) : fnv(s);
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const fingerprint = x => sha(stable(x));
  const r6 = v => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v;
  const round6 = x => x == null || typeof x !== 'object' ? r6(x) : Array.isArray(x) ? x.map(round6) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round6(v)]));

  // ------------------------------------------------------------------ sections
  function dataset({ files, manifest, lots, fieldKeys }) {
    const codes = lots.map(l => l.identity.code).sort();
    return {
      lotCount: lots.length,
      uniqueIds: new Set(lots.map(l => l.identity.id)).size,
      codesFingerprint: fingerprint(codes),
      blocks: [...new Set(lots.map(l => l.identity.blockId))].sort(),
      lotsPerBlock: Object.fromEntries([...new Set(lots.map(l => l.identity.blockId))].sort().map(b => [b, lots.filter(l => l.identity.blockId === b).length])),
      fileFingerprints: Object.fromEntries(Object.keys(files).sort().map(f => [f, files[f] == null ? null : fingerprint(files[f])])),
      manifest: manifest ? { lotCount: manifest.lotCount, staticVersion: manifest.staticVersion, analysisVersion: manifest.analysisVersion, priceTableVersion: manifest.priceTableVersion, checksums: manifest.checksums } : null,
      fieldRegistry: { count: fieldKeys.length, fingerprint: fingerprint(fieldKeys.slice().sort()), keys: fieldKeys.slice().sort() },
      availabilityStatusCounts: countBy(lots, l => l.availability.status),
      classCounts: countBy(lots, l => l.intelligence.class),
      pricePerM2Values: [...new Set(lots.map(l => l.commercial.pricePerM2))].sort(),
      priceTableVersions: [...new Set(lots.map(l => l.commercial.priceTableVersion))].sort(),
      nullPriceCount: lots.filter(l => l.commercial.price == null).length
    };
  }
  const countBy = (xs, f) => { const o = {}; for (const x of xs) { const k = String(f(x)); o[k] = (o[k] || 0) + 1; } return Object.fromEntries(Object.entries(o).sort()); };

  /** per-lot snapshot: identity, geometry summary, commercial, availability, scores/classes/rankings/alerts, key derived fields */
  function lotRecord(l) {
    const g = l.geometry, poly = g.polygon || [];
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    return {
      id: l.identity.id, code: l.identity.code, blockId: l.identity.blockId, lotNumber: l.identity.lotNumber, displayCode: l.identity.displayCode,
      geometry: { areaM2: g.areaM2, frontM: g.frontM, rearM: g.rearM, leftDepthM: g.leftDepthM, rightDepthM: g.rightDepthM, averageDepthM: g.averageDepthM, shape: g.shape, isCorner: g.isCorner, cornerType: g.cornerType,
        vertices: poly.length, bbox: poly.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null, polygonFingerprint: fingerprint(poly) },
      location: { blockPosition: l.location.blockPosition, perimeterPosition: l.location.perimeterPosition, latitude: l.location.latitude, longitude: l.location.longitude,
        distanceToGateLinearM: l.location.distanceToGateLinearM, distanceToClubLinearM: l.location.distanceToClubLinearM, distanceToGreenAreaM: l.location.distanceToGreenAreaM, distanceToExternalRoadM: l.location.distanceToExternalRoadM },
      surroundings: { rearNeighborType: l.surroundings.rearNeighborType, hasGreenRear: l.surroundings.hasGreenRear, viewDetail: l.surroundings.viewDetail },
      mobility: { routeDistanceToGateM: l.mobility.routeDistanceToGateM, routeDistanceToLeisureM: l.mobility.routeDistanceToLeisureM, estimatedTraffic: l.mobility.estimatedTraffic },
      environmental: { orientationFront: l.environmental.orientationFront, orientationRear: l.environmental.orientationRear, frontBearingDeg: l.environmental.frontBearingDeg, northSunSide: l.environmental.northSunSide,
        solarScore: l.environmental.solarScore, noiseLevel: l.environmental.noiseLevel, quietScore: l.environmental.quietScore, privacyLevel: l.environmental.privacyLevel, privacyScore: l.environmental.privacyScore },
      commercial: { price: l.commercial.price, pricePerM2: l.commercial.pricePerM2, downPaymentDefaultPercent: l.commercial.downPaymentDefaultPercent, downPaymentDefaultValue: l.commercial.downPaymentDefaultValue,
        availablePlans: l.commercial.availablePlans, priceTableId: l.commercial.priceTableId, priceTableVersion: l.commercial.priceTableVersion },
      availability: { status: l.availability.status, freshness: l.availability.freshness, revision: l.availability.revision },
      intelligence: { analysisVersion: l.intelligence.analysisVersion, scores: l.intelligence.scores, class: l.intelligence.class, notes: l.intelligence.notes, liquidity: l.intelligence.liquidity,
        idealProfiles: l.intelligence.idealProfiles, rankings: l.intelligence.rankings, alerts: (l.intelligence.alerts || []).map(a => `${a.type}:${a.severity}`), alertTexts: (l.intelligence.alerts || []).map(a => `${a.title} — ${a.message}`),
        highlights: (l.intelligence.highlights || []).map(h => h.type) },
      provenanceStatuses: Object.fromEntries(Object.entries(l.provenance || {}).map(([k, p]) => [k, p && p.status]).sort()),
      lotFingerprint: fingerprint(l)
    };
  }

  function mapSection({ App, lots, dev, representative }) {
    const G = App.geo && App.geo.geometry, SI = App.geo && App.geo.spatialIndex, HT = App.geo && App.geo.hitTest;
    if (!G || !SI || !HT) return { unavailable: true };
    const bundle = G.buildBundle({ organizationId: dev.tenantId, developmentId: dev.id, dev, lots, sourceGeometryVersion: dev.staticDataVersion });
    const index = SI.build(bundle.features.filter(f => f.ring)), svc = HT.create(bundle.features, index);
    const anchorOf = new Map(bundle.labelAnchors.map(a => [a.lotId, a.at]));
    const mismatches = [];
    for (const l of lots) { const at = anchorOf.get(l.identity.id); const h = at ? svc.hitTest(at, {}) : { status: 'NO_ANCHOR' }; if (h.lotId !== l.identity.id) mismatches.push({ code: l.identity.code, hit: h.status, lotId: h.lotId || null }); }
    return {
      featureCount: bundle.manifest.featureCount, featuresWithRing: bundle.features.filter(f => f.ring).length,
      sourceChecksum: bundle.manifest.sourceChecksum, renderChecksum: bundle.manifest.renderChecksum, renderGeometryVersion: bundle.manifest.renderGeometryVersion,
      developmentBounds: round6(bundle.manifest.developmentBounds),
      anchorHitMismatches: mismatches,
      representativeAnchors: Object.fromEntries(representative.map(code => { const l = lots.find(x => x.identity.code === code); const at = l && anchorOf.get(l.identity.id); return [code, at ? round6(at) : null]; }))
    };
  }

  function layersSection({ App, lots, freshness }) {
    const ML = App.mapLayers, LY = App.services.layers, out = {};
    for (const d of LY.DEFS) for (const sk of d.id === 'score' ? ['housing', 'investment', 'family', 'premium', 'overall'] : [null]) {
      const key = sk ? `${d.id}:${sk}` : d.id;
      const layerState = { ...ML.defaultState(), primaryLayerId: d.id, layerSettings: sk ? { score: { scoreKey: sk } } : {} };
      const m = ML.buildRenderModel({ developmentId: lots[0].identity.developmentId, lots, layerState, mode: 'broker', filter: { active: false }, freshness, dataVersions: {} });
      const byColor = {};
      for (const l of lots) { const st = m.lotStylesById.get(l.identity.id); const c = st ? st.fill : null; (byColor[c] = byColor[c] || []).push(l.identity.code); }
      for (const c of Object.keys(byColor)) byColor[c].sort();
      const legend = App.legend ? App.legend.build({ model: m, lots, filter: { active: false }, mode: 'broker', developmentId: lots[0].identity.developmentId }) : null;
      out[key] = { colorCounts: Object.fromEntries(Object.entries(byColor).map(([c, v]) => [c, v.length]).sort()), lotsByColor: byColor,
        coverage: m.layerMetadata && m.layerMetadata.coverage ? m.layerMetadata.coverage.availableCount : null,
        legend: legend && legend.sections ? legend.sections.map(s => ({ id: s.id || null, items: (s.items || []).map(i => `${i.key}:${i.totalCount}`) })) : null };
    }
    return out;
  }

  function filtersSection({ App, lots, scenarios, developmentId }) {
    const ctx = { developmentId, policy: App.availability.DEFAULT_POLICY, mode: 'broker', favorites: new Set(), fitById: null };
    const out = {};
    for (const s of scenarios) {
      const c = App.filters.compile(s.state, ctx), r = App.filters.run(lots, c.query, ctx);
      const codes = lots.filter(l => r.matchedIds.has(l.identity.id)).map(l => l.identity.code).sort();
      out[s.id] = { count: codes.length, queryHash: c.query.hash || null, dropped: (c.query.dropped || []).map(d => `${d.filterId}:${d.code}`), codes };
    }
    return out;
  }

  function recommendationsSection({ App, lots, profiles, developmentId }) {
    const byId = new Map(lots.map(l => [l.identity.id, l])), RS = App.services.recommendation;
    const legacy = {};
    for (const p of RS.PRESETS) {
      const ranking = RS.rank(lots, p.prefs, null);
      legacy[p.id] = { size: ranking.length, top10: ranking.slice(0, 10).map(r => [byId.get(r.id).identity.code, r6(r.relevance)]), commercialCount: RS.commercial(ranking, byId, App.availability.DEFAULT_POLICY).length };
    }
    const pol = App.recommendation.policyOf(developmentId), fitCfg = App.fit.cfgOf(developmentId), engine = {};
    // real data: every lot is UNKNOWN, so the engine must recommend none (UNKNOWN is never AVAILABLE).
    // "synthetic:" entries run the SAME engine over a hypothetical copy where every status is AVAILABLE — a test fixture
    // that exercises the ranking path, never shown to anyone and never written back (the house tests do the same).
    const runs = [...profiles.map(p => ({ id: p.id, p, ls: lots })), ...profiles.map(p => ({ id: 'synthetic:' + p.id, p, ls: lots.map(l => ({ ...l, availability: { ...l.availability, status: 'AVAILABLE' } })) }))];
    for (const { id, p, ls } of runs) {
      const r = App.recommendation.recommend({ developmentId, profile: App.fit.buildProfile({ preferences: p.preferences }), constraints: [], lots: ls, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: {} });
      const code = id => (byId.get(id) || { identity: { code: id } }).identity.code;
      engine[id] = { status: r.status, recommended: (r.recommendations || []).length, review: (r.review || r.inReview || []).length, excluded: (r.excluded || []).length,
        topRecommended: (r.recommendations || []).slice(0, 10).map(x => [code(x.lotId), r6(x.fitScore ?? x.score ?? null)]), topReview: (r.review || r.inReview || []).slice(0, 10).map(x => code(x.lotId)),
        excludedReasons: countBy(r.excluded || [], x => x.reasonCode || x.code || (x.reasons && x.reasons[0]) || '?') };
    }
    // Fit (topic 14) for the same profiles: score of the representative top lots
    const fit = {};
    for (const p of profiles) { const fs = App.fit.fitLots(App.fit.buildProfile({ preferences: p.preferences }), lots, fitCfg); fit[p.id] = { count: fs.length, top10: [...fs].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || String(a.lotId).localeCompare(String(b.lotId))).slice(0, 10).map(f => [code0(byId, f.lotId), r6(f.fitScore)]) }; }
    return { legacyPresets: legacy, engine, fit };
  }
  const code0 = (byId, id) => (byId.get(id) || { identity: { code: id } }).identity.code;

  function financeSection({ App, repo, dev, scenarios }) {
    const table = dev.priceTables.find(t => t.id === dev.currentPriceTableId) || dev.priceTables[0], out = {};
    for (const s of scenarios) {
      const l = repo.getLotByCode(s.code); const plans = table.plans.filter(p => l.commercial.availablePlans.includes(p.id));
      const sim = App.services.finance.simulate({ price: l.commercial.price, downPaymentPct: s.downPaymentPct, plans });
      out[`${s.code}@${s.downPaymentPct}`] = sim ? round6({ price: sim.price, downPayment: sim.downPayment, financed: sim.financed,
        plans: sim.plans.map(p => ({ id: p.id, kind: p.kind, main: p.main, annual: p.annual ?? null, annualCount: p.annualCount ?? null, total: p.total, months: p.months, first: p.at(1), yearly: App.services.finance.yearly(p) })) }) : null;
    }
    return { priceTable: { id: table.id, version: table.version, pricePerM2: table.pricePerM2, downPaymentDefault: table.downPaymentDefault, planIds: table.plans.map(p => p.id) }, simulations: out };
  }

  function solarSection({ App, dev, repo, representative, seasons, moments }) {
    const S = App.services.solar.make(dev.geo), out = {};
    for (const code of representative) {
      const l = repo.getLotByCode(code); const b = l && l.environmental.frontBearingDeg; if (b == null) { out[code] = null; continue; }
      out[code] = { frontBearingDeg: b, seasons: Object.fromEntries(seasons.map(s => [s, round6({ day: S.day(s), intervals: S.intervals(b, s), moments: Object.fromEntries(moments.map(h => [h, S.moment(b, s, h)])) })])) };
    }
    return out;
  }

  const QV_KEYS = ['identity', 'availability', 'commercial', 'metrics', 'intelligence', 'highlights', 'alerts', 'facts', 'provenanceSummary', 'bestFor', 'cls', 'primaryScore', 'keyAttributes', 'status'];
  function quickviewSection({ App, repo, dev, representative }) {
    const vmCtx = mode => ({ dev, cfg: dev.presentation, mode, objective: dev.presentation.defaultObjective, prefs: {}, favorites: new Set(), compareIds: [], view: 'map', filterActive: false, connectivity: 'ONLINE' });
    const out = {};
    for (const code of representative) { const l = repo.getLotByCode(code); out[code] = {}; for (const mode of ['broker', 'client']) { const v = App.vm.quickViewVM(l, vmCtx(mode)); out[code][mode] = Object.fromEntries(QV_KEYS.map(k => [k, v[k] === undefined ? null : v[k]])); } }
    return plain(out);
  }

  function shareSection({ App, repo, dev, sets }) {
    const out = {};
    for (const set of sets) { const ls = set.map(c => repo.getLotByCode(c)); for (const mode of ['broker', 'client']) { const s = App.vm.shareVM(ls, { dev, customerName: null, mode }); out[`${set.join('+')}:${mode}`] = { text: s.text, warnings: s.warnings, whatsapp: s.whatsapp }; } }
    return out;
  }

  function comparisonSection({ App, repo, dev, sets }) {
    const out = {};
    for (const set of sets) {
      const ls = set.map(c => repo.getLotByCode(c));
      for (const mode of ['broker', 'client']) {
        const v = App.vm.comparisonVM(ls, { cfg: dev.presentation, mode, objective: dev.presentation.defaultObjective, dev });
        out[`${set.join('+')}:${mode}`] = plain({ columns: v.columns.map(c => ({ code: c.code, title: c.title, status: c.status && c.status.label, cls: c.cls && c.cls.code })), primary: v.primary, groups: v.groups, winners: v.winners });
      }
    }
    return out;
  }

  function searchSection({ App, repo, lots, queries }) {
    const byCode = new Map(lots.map(l => [l.identity.code, l])), blocks = repo.getBlocks(), out = {};
    for (const q of queries) { const r = App.services.search.parse(q, { blocks, all: lots, byCode }); out[q] = { kind: r.kind, block: r.block || null, codes: (r.lots || []).map(l => l.identity.code) }; }
    return out;
  }

  function textsSection({ App, keyTexts }) {
    const get = p => p.split('.').reduce((o, k) => o == null ? o : o[k], App);
    const out = Object.fromEntries(keyTexts.map(t => [t.id, get(t.path) ?? null]));
    const t = (e, v) => App.i18n && App.i18n.t ? App.i18n.t(e, v) : null;
    out['availability.UNKNOWN'] = t('AvailabilityStatus', 'UNKNOWN');
    out['availability.AVAILABLE'] = t('AvailabilityStatus', 'AVAILABLE');
    const E = App.enums || {};
    out['dataStatus'] = Object.keys(E.DataStatus || {}).map(s => [s, t('DataStatus', s), t('DataStatusShort', s)]);
    out['availabilityStatus'] = Object.keys(E.AvailabilityStatus || {}).map(s => [s, t('AvailabilityStatus', s)]);
    out['format.notAvailable'] = App.fmt && App.fmt.formatBRL ? App.fmt.formatBRL(null) : null;
    out['format.price'] = App.fmt && App.fmt.formatBRL ? App.fmt.formatBRL(807419.6) : null;
    out['format.pricePerM2'] = App.fmt && App.fmt.formatPricePerM2 ? App.fmt.formatPricePerM2(1196) : null;
    out['format.area'] = App.fmt && App.fmt.formatSquareMeters ? App.fmt.formatSquareMeters(675.1, 2) : null;
    return out;
  }

  /** capture(App, { repo, dev, spec, files, manifest }) → { meta, categories: { name: data } } */
  function capture(App, { repo, dev, spec, files = {}, manifest = null }) {
    const lots = repo.lotsSync().slice().sort((a, b) => a.identity.id.localeCompare(b.identity.id));
    const representative = spec.representativeLots.map(r => r.code);
    const fieldKeys = (App.model.FIELDS || []).map(f => f.key);
    const freshness = repo.getFreshness ? repo.getFreshness() : {};
    const categories = {
      dataset: dataset({ files, manifest, lots, fieldKeys }),
      lots: Object.fromEntries(lots.map(l => [l.identity.code, lotRecord(l)])),
      map: mapSection({ App, lots, dev, representative }),
      layers: layersSection({ App, lots, freshness }),
      filters: filtersSection({ App, lots, scenarios: spec.filterScenarios, developmentId: spec.developmentId }),
      recommendations: recommendationsSection({ App, lots, profiles: spec.recommendationProfiles, developmentId: spec.developmentId }),
      finance: financeSection({ App, repo, dev, scenarios: spec.financeScenarios }),
      solar: solarSection({ App, dev, repo, representative, seasons: spec.solarSeasons, moments: spec.solarMoments }),
      quickview: quickviewSection({ App, repo, dev, representative }),
      share: shareSection({ App, repo, dev, sets: spec.shareSets }),
      comparison: comparisonSection({ App, repo, dev, sets: spec.comparisonSets }),
      search: searchSection({ App, repo, lots, queries: spec.searchQueries }),
      texts: textsSection({ App, keyTexts: spec.keyTexts })
    };
    const out = {};
    for (const k of CATEGORIES) out[k] = plain(categories[k]);
    const meta = { schemaVersion: SCHEMA_VERSION, baselineId: spec.baselineId, developmentId: spec.developmentId, lotCount: lots.length, fixedClock: spec.fixedClock,
      datasetVersion: manifest ? `${manifest.staticVersion}|${manifest.analysisVersion}|${manifest.priceTableVersion}` : null,
      fixtureRefs: CATEGORIES.map(c => `tests/golden/${c}.golden.json`),
      categoryFingerprints: Object.fromEntries(CATEGORIES.map(c => [c, fingerprint(out[c])])) };
    return { meta, categories: out };
  }

  /** diff(expected, actual) → [{ path, expected, actual }] (every drift; arrays compared index by index + length) */
  function diff(expected, actual, path = '$', out = [], max = Infinity) {
    if (out.length >= max) return out;
    const te = expected === null ? 'null' : Array.isArray(expected) ? 'array' : typeof expected, ta = actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual;
    if (te !== ta) { out.push({ path, expected, actual }); return out; }
    if (te === 'array') { if (expected.length !== actual.length) out.push({ path: path + '.length', expected: expected.length, actual: actual.length }); for (let i = 0; i < Math.min(expected.length, actual.length); i++) diff(expected[i], actual[i], `${path}[${i}]`, out, max); return out; }
    if (te === 'object') { for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) { if (!(k in actual)) out.push({ path: `${path}.${k}`, expected: expected[k], actual: undefined }); else if (!(k in expected)) out.push({ path: `${path}.${k}`, expected: undefined, actual: actual[k] }); else diff(expected[k], actual[k], `${path}.${k}`, out, max); } return out; }
    if (expected !== actual) out.push({ path, expected, actual });
    return out;
  }

  /** applyExceptions(drifts, exceptions) → { blocking, excepted }: a drift is excepted only by an APPROVED ParityException whose pathPattern matches */
  function applyExceptions(drifts, exceptions = []) {
    const ok = exceptions.filter(e => e && e.approvedBy && e.approvedAt && e.pathPattern), res = { blocking: [], excepted: [] };
    for (const d of drifts) { const e = ok.find(x => new RegExp(x.pathPattern).test(d.path)); (e ? res.excepted : res.blocking).push(e ? { ...d, exception: e.capabilityId } : d); }
    return res;
  }

  return Object.freeze({ SCHEMA_VERSION, CATEGORIES, stable, fingerprint, capture, diff, applyExceptions, lotRecord });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = App.governance.golden;
