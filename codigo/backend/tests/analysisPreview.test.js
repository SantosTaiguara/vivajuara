'use strict';
/* IntelligenceEngine in the backend (topic 12): the backend loads plat/src/intelligence/*.js + plat/config/scoring and
   runs the engine over the engine inputs stored by the import. Parity: backend output == frontend output for all 498
   lots (same 45 published fields, mirrored from tests/intelligence.test.js). POST .../analysis/preview returns the
   impact report against the published methodology and never publishes or writes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { h, contract, DEV, TOKEN, client, path } = require('./support');
const harness = require('../../tests/harness.js');

const RAW = JSON.parse(fs.readFileSync(path.join(h.DATA, 'lots.json'), 'utf8'));
const INPUT = JSON.parse(fs.readFileSync(path.join(h.DATA, 'analysis-input.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const { stableStringify } = require(h.BACKEND + '/src/shared/domain/checksum');

let db, srv, req, FE, feOut, cfg;
const P = `/developments/${DEV}/analysis/preview`;
const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
const counts = async () => Object.fromEntries(await Promise.all(['analysis_versions', 'lot_analysis', 'audit_log', 'price_tables', 'lot_analysis_inputs'].map(async t => [t, Number((await q(`SELECT count(*) AS n FROM ${t}`))[0].n)])));

test.before(async () => {
  db = await h.setupDatabase('analysis_preview');
  srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN }, { pool: db.pool });
  req = client(srv);
  FE = harness.load(); // the frontend context (same loader as the frontend test suite)
  cfg = FE.methodology.current(DEV);
  feOut = FE.intelligence.analyzeDevelopment(INPUT.lots, { methodology: FE.methodology.compile(cfg), inputVersion: INPUT.inputVersion });
});
test.after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('import stored the engine inputs losslessly under their inputVersion', async () => {
  const v = (await q('SELECT version, lot_count FROM analysis_input_versions'))[0];
  assert.deepEqual([v.version, v.lot_count], [INPUT.inputVersion, 498]);
  assert.equal((await q('SELECT current_analysis_input_version AS v FROM developments'))[0].v, INPUT.inputVersion);
  const stored = new Map((await q('SELECT lot_id, data FROM lot_analysis_inputs')).map(r => [r.lot_id, r.data]));
  for (const i of INPUT.lots) assert.equal(stableStringify(stored.get(i.lotId)), stableStringify(i), i.lotId);
  assert.equal(db.importReport.analysisInput.status, 'OK');
});

test('the backend loads the intelligence modules and the scoring config the same way as the shared domain', () => {
  const App = srv.app.services.analysisPreview;
  assert.equal(App.available(), true);
  const { loadErrorsOf, BACKEND_ORDER, INTELLIGENCE } = require(h.BACKEND + '/src/shared/domain/sharedDomain');
  assert.deepEqual(loadErrorsOf(h.sharedApp()), []);
  for (const f of ['intelligence/math.js', ...INTELLIGENCE]) assert.ok(BACKEND_ORDER.includes(f), f);
  assert.deepEqual(INTELLIGENCE, ['intelligence/normalization.js', 'intelligence/methodology.js', 'intelligence/engine.js', 'intelligence/textAdapter.js']);
});

test('parity: backend engine output equals the frontend engine output for all 498 lots (45 published fields, zero diff)', async () => {
  const be = await srv.app.services.analysisPreview.runPublished(DEV);
  assert.equal(be.results.length, 498);
  const byId = new Map(feOut.results.map(r => [r.lotId, r]));
  for (const r of be.results) assert.equal(stableStringify(r), stableStringify(byId.get(r.lotId)), r.lotId);
  assert.equal(stableStringify(be.report), stableStringify(feOut.report));
  // golden: the 45 fields of the published lots.json record, regenerated from the backend results
  const p = h.sharedApp().analysisText.parity(be.results, clone(be.inputs.lots), RAW);
  assert.equal(p.fieldsCompared, 45);
  assert.equal(p.lots, 498);
  assert.deepEqual(clone(p.diffs.slice(0, 5)), []);
  assert.equal(p.identical, 498);
  // and the frontend parity on its own results gives the same answer
  const fp = FE.analysisText.parity(feOut.results, INPUT.lots, RAW);
  assert.equal(fp.identical, 498);
});

test('preview without a candidate: impact zero against the published methodology; baseline reproduces the published analysis', async () => {
  const before = await counts();
  const x = await req('POST', P, {});
  assert.equal(x.r.status, 200, x.text.slice(0, 400));
  contract.assertSchema(x.body, 'AnalysisPreviewResponse');
  const d = x.body.data;
  assert.equal(d.published, false);
  assert.equal(d.sameMethodology, true);
  assert.equal(d.inputVersion, INPUT.inputVersion);
  assert.equal(d.analysisVersion, '2026-10-06');
  assert.equal(d.base.methodologyVersion, '1.0.0');
  assert.deepEqual([d.impact.lotCount, d.impact.changedLots, d.impact.massChange], [498, 0, false]);
  assert.deepEqual(d.impact.classDistribution.base, { A_PLUS: 25, A: 100, B: 199, C: 125, D: 49 });
  assert.deepEqual([d.publishedParity.lots, d.publishedParity.identical, d.publishedParity.diffs], [498, 498, []]);
  // same result as App.methodology.impact in the frontend
  const fe = clone(FE.methodology.impact(cfg, clone(cfg), INPUT.lots));
  assert.deepEqual(d.impact, (({ base, candidate, ...rest }) => rest)(fe));
  assert.deepEqual(await counts(), before, 'preview writes nothing');
});

test('preview of a candidate methodology: the impact report equals the frontend one; nothing is published', async () => {
  const before = await counts();
  const c = clone(cfg); c.methodologyVersion = '1.1.0'; c.status = 'DRAFT';
  c.scores[0].criteria[0].weight = 0.35; c.scores[0].criteria[1].weight = 0.1;
  const x = await req('POST', P, { methodology: c, topMoves: 10 });
  assert.equal(x.r.status, 200, x.text.slice(0, 400));
  contract.assertSchema(x.body, 'AnalysisPreviewResponse');
  const d = x.body.data;
  assert.equal(d.sameMethodology, false);
  assert.equal(d.candidate.methodologyVersion, '1.1.0');
  assert.ok(d.impact.scores.housing.changed > 0 && d.impact.changedLots > 0);
  assert.equal(d.impact.configDiff.length, 4);
  assert.ok(d.impact.rankingMoves.length <= 10);
  assert.equal(Object.values(d.impact.classDistribution.candidate).reduce((a, b) => a + b, 0), 498);
  const fe = clone(FE.methodology.impact(cfg, c, INPUT.lots, { topMoves: 10 }));
  assert.deepEqual(d.impact, (({ base, candidate, ...rest }) => rest)(fe));
  assert.deepEqual(await counts(), before);
  const cur = await (await fetch(srv.api + `/developments/${DEV}/analysis/current`)).json();
  assert.equal(cur.analysisVersion, '2026-10-06');
});

test('preview errors: invalid methodology → 422, bad body → 400, no inputs → 404, auth required', async () => {
  const c = clone(cfg); c.scores[0].criteria[0].weight = -0.25;
  let x = await req('POST', P, { methodology: c });
  contract.assertApiError(x.r, x.body, 422, 'INVALID_METHODOLOGY');
  assert.ok(x.body.details.some(e => e.reason === 'NEGATIVE_WEIGHT'), JSON.stringify(x.body.details));
  const other = clone(cfg); other.developmentId = 'other-dev';
  x = await req('POST', P, { methodology: other });
  contract.assertApiError(x.r, x.body, 422, 'INVALID_METHODOLOGY');
  for (const body of [{ methodology: 'x' }, { extra: 1 }, { topMoves: 0 }, { massChangeShare: 2 }, []]) {
    x = await req('POST', P, body);
    contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
  }
  x = await req('POST', P, undefined, { raw: '' });
  contract.assertApiError(x.r, x.body, 400, 'VALIDATION_ERROR');
  x = await req('POST', '/developments/other-dev/analysis/preview', {});
  contract.assertApiError(x.r, x.body, 404, 'DEVELOPMENT_NOT_FOUND');
  x = await req('POST', P, {}, { token: null });
  contract.assertApiError(x.r, x.body, 401, 'UNAUTHORIZED');
  const keep = (await q('SELECT current_analysis_input_version AS v FROM developments'))[0].v;
  await q('UPDATE developments SET current_analysis_input_version = NULL');
  try {
    x = await req('POST', P, {});
    contract.assertApiError(x.r, x.body, 404, 'ANALYSIS_INPUT_NOT_FOUND');
  } finally { await q('UPDATE developments SET current_analysis_input_version = $1', [keep]); }
});

test('a methodology config bigger than BODY_LIMIT_BYTES is accepted on the admin route (ADMIN_BODY_LIMIT_BYTES)', async () => {
  const raw = JSON.stringify({ methodology: clone(cfg) }, null, 2);
  assert.ok(Buffer.byteLength(raw) > srv.config.bodyLimitBytes, `${Buffer.byteLength(raw)} bytes`);
  const x = await req('POST', P, undefined, { raw });
  assert.equal(x.r.status, 200);
  assert.equal(x.body.data.sameMethodology, true);
});

test('import: an analysis-input file that does not match the static lots is reported and not stored', async () => {
  const { prepareAnalysisInput } = require(h.BACKEND + '/src/modules/imports/importDevelopmentData.service');
  const staticLots = { 'VJ-QA-L0001': { identity: { code: 'A1', blockId: 'A', lotNumber: 1 }, geometry: { areaM2: 675.1 } } };
  const ok = prepareAnalysisInput({ raw: { kind: 'lot-analysis-input', developmentId: DEV, inputVersion: 'v', lots: [clone(INPUT.lots[0])] }, devId: DEV, staticLots });
  assert.deepEqual(ok.errors, []);
  const bad = clone(INPUT.lots[0]); bad.geometry.areaM2 = 1;
  const r = prepareAnalysisInput({ raw: { kind: 'lot-analysis-input', developmentId: DEV, inputVersion: 'v', lots: [bad, clone(INPUT.lots[1])] }, devId: DEV, staticLots });
  assert.deepEqual(r.errors.map(e => e.code), ['ANALYSIS_INPUT_MISMATCH', 'ANALYSIS_INPUT_MISMATCH']);
  assert.equal(prepareAnalysisInput({ raw: { kind: 'x' }, devId: DEV, staticLots }).errors[0].code, 'ANALYSIS_INPUT_INVALID');
});
