'use strict';
/* Shadow comparison (dual read): JSON path vs API path, through the REAL frontend code.
   - JSON: App.repos.createLotRepository with the default config (JsonLotSource over the published lots.json).
   - API:  the same factory with dataSource.useBackendData=true (ApiLotSource against the running server, no fallback).
   Every lot is compared with App.domain.serializeLot (deterministic) after removing volatile metadata
   (metadata.freshness depends on the clock). Also checks the map read model and a sample of lot details. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAppContext, BACKEND_ORDER } = require('../../src/shared/domain/sharedDomain');
const { stableStringify } = require('../../src/shared/domain/checksum');

const FRONTEND_ORDER = [...BACKEND_ORDER, 'data/apiSource.js'];
// key order is irrelevant (JSONB reorders object keys): always compare key-sorted JSON
const sha = v => crypto.createHash('sha256').update(stableStringify(v)).digest('hex').slice(0, 16);
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

function fileFetch(dataDir) {
  return async url => {
    const f = path.join(dataDir, url);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null, headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')), headers: { get: () => null } };
  };
}

/** Switches a development to the backend inside one App context (config copy; the source file is not modified). */
function useBackend(App, devId, dataSource) {
  const list = App.config.DEVELOPMENTS, i = list.findIndex(d => d.id === devId);
  list[i] = { ...list[i], dataSource: { ...(list[i].dataSource || {}), ...dataSource } };
  return list[i];
}

/** volatile: freshness is computed against the current clock */
function comparable(App, lot) {
  const copy = JSON.parse(JSON.stringify(lot));
  if (copy.metadata) delete copy.metadata.freshness;
  return App.domain.serializeLot(copy);
}

function diffPaths(a, b, prefix = '', out = []) {
  if (out.length >= 10) return out;
  if (stableStringify(a) === stableStringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
  } else out.push(prefix || '(root)');
  return out;
}

const CHECKS = {
  area: l => get(l, 'geometry.areaM2'),
  price: l => get(l, 'commercial.price'),
  status: l => get(l, 'availability.status'),
  scores: l => get(l, 'intelligence.scores'),
  class: l => get(l, 'intelligence.class'),
  alerts: l => get(l, 'intelligence.alerts'),
  distances: l => ({ location: l.location, routes: l.mobility })
};

async function runShadowCompare({ apiBaseUrl, developmentId = 'viva-juara', dataDir, srcDir, detailSample = 25 }) {
  const t0 = Date.now();
  const jsonApp = createAppContext({ srcDir, files: FRONTEND_ORDER, fetch: fileFetch(dataDir) });
  const apiApp = createAppContext({ srcDir, files: FRONTEND_ORDER, fetch: (...a) => fetch(...a) });
  useBackend(apiApp, developmentId, { useBackendData: true, apiBaseUrl, fallbackToJson: false });

  const jsonRepo = jsonApp.repos.createLotRepository(developmentId);
  const apiRepo = apiApp.repos.createLotRepository(developmentId);
  const [jsonLots, apiLots] = await Promise.all([jsonRepo.load(), apiRepo.load()]);
  const apiState = apiRepo.getDataState();

  const jsonById = new Map(jsonLots.map(l => [l.identity.id, l])), apiById = new Map(apiLots.map(l => [l.identity.id, l]));
  const ids = [...new Set([...jsonById.keys(), ...apiById.keys()])].sort();
  const lots = [];
  for (const id of ids) {
    const j = jsonById.get(id), a = apiById.get(id);
    if (!j || !a) { lots.push({ lotId: id, identical: false, missingIn: !j ? 'json' : 'api' }); continue; }
    const row = { lotId: id, identical: comparable(jsonApp, j) === comparable(apiApp, a) };
    for (const [k, f] of Object.entries(CHECKS)) row[k] = stableStringify(f(j)) === stableStringify(f(a));
    const gj = sha(j.geometry.polygon), ga = sha(a.geometry.polygon);
    row.geometryChecksum = { json: gj, api: ga, match: gj === ga };
    if (!row.identical) row.diff = diffPaths(JSON.parse(comparable(jsonApp, j)), JSON.parse(comparable(apiApp, a)));
    lots.push(row);
  }

  // Map read model (LotSummaryDto) against the composed JSON lots.
  const map = await (await fetch(`${apiBaseUrl}/developments/${developmentId}/map-lots`)).json();
  const mapMismatches = [];
  for (const s of map.lots) {
    const j = jsonById.get(s.id);
    const exp = j && { code: j.identity.code, blockId: j.identity.blockId, lotNumber: j.identity.lotNumber, areaM2: j.geometry.areaM2, status: j.availability.status, price: j.commercial.price,
      pricePerM2: j.commercial.pricePerM2, class: j.intelligence.class, overallScore: j.intelligence.scores.overall, polygon: j.geometry.polygon, centroid: j.geometry.centroid };
    const got = { code: s.code, blockId: s.blockId, lotNumber: s.lotNumber, areaM2: s.areaM2, status: s.status, price: s.price, pricePerM2: s.pricePerM2, class: s.class, overallScore: s.overallScore, polygon: s.polygon, centroid: s.centroid };
    if (!exp || stableStringify(exp) !== stableStringify(got)) mapMismatches.push({ lotId: s.id, diff: exp ? diffPaths(exp, got) : ['missing in JSON'] });
  }

  // Detail endpoint (composed server-side) for an evenly spread sample.
  const sample = detailSample >= ids.length ? ids : ids.filter((_, i) => i % Math.ceil(ids.length / Math.max(detailSample, 1)) === 0);
  const detailMismatches = [];
  for (const id of sample) {
    const d = await (await fetch(`${apiBaseUrl}/lots/${id}`)).json();
    if (!d.lot || comparable(jsonApp, d.lot) !== comparable(jsonApp, jsonById.get(id))) detailMismatches.push({ lotId: id, diff: d.lot ? diffPaths(JSON.parse(comparable(jsonApp, jsonById.get(id))), JSON.parse(comparable(jsonApp, d.lot))) : [d.code] });
  }

  const count = k => lots.filter(r => r[k] === true || (r[k] && r[k].match === true)).length;
  const summary = {
    developmentId, apiBaseUrl, at: new Date().toISOString(), durationMs: 0,
    jsonLots: jsonLots.length, apiLots: apiLots.length, apiLayerStates: apiState, comparedLots: ids.length,
    identical: count('identical'), area: count('area'), price: count('price'), status: count('status'), scores: count('scores'), class: count('class'),
    alerts: count('alerts'), distances: count('distances'), geometryChecksum: count('geometryChecksum'),
    mapLots: { count: map.count, mismatches: mapMismatches.length }, detailSample: { checked: sample.length, mismatches: detailMismatches.length },
    excludedFromComparison: ['metadata.freshness (depends on the current clock)']
  };
  summary.parity = summary.identical === ids.length && jsonLots.length === apiLots.length && !mapMismatches.length && !detailMismatches.length;
  summary.durationMs = Date.now() - t0;
  return { summary, lots, mapMismatches, detailMismatches };
}

module.exports = { runShadowCompare, FRONTEND_ORDER, useBackend, fileFetch, comparable };
