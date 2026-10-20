'use strict';
/* AnalysisPreview (POST /api/v1/developments/{id}/analysis/preview, admin) — topic 12 §88 / topic 13 impact report.
   Runs the SAME IntelligenceEngine as the frontend (plat/src/intelligence/*.js loaded by sharedDomain, methodology
   configs from plat/config/scoring) over the engine inputs stored for the development (analysis_input_versions /
   lot_analysis_inputs) and returns App.methodology.impact(published, candidate, inputs): what a candidate methodology
   would change — scores, classes, rankings, alerts — WITHOUT publishing or writing anything.
   publishedParity proves the baseline: the published methodology run on the stored inputs reproduces the stored
   published analysis (scores, class, rankings, highlights, alerts). */
const analysisRepo = require('./analysis.repository');
const { toRealm } = require('../../shared/domain/sharedDomain');
const { E } = require('../../shared/http/errors');
const { stableStringify } = require('../../shared/domain/checksum');
const { issue } = require('../../shared/validation');

const plain = o => JSON.parse(JSON.stringify(o));
const SCORE_KEYS = ['housing', 'investment', 'family', 'premium', 'overall'];
const PARITY_FIELDS = ['scores', 'class', 'rankings', 'highlights.type', 'alerts.type', 'alerts.severity'];
const BODY_FIELDS = ['methodology', 'massChangeShare', 'topMoves'];

function validatePreviewRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw E.badRequest('Corpo deve ser um objeto JSON', [issue('(body)', 'type', { expected: 'object' })]);
  const issues = [];
  for (const k of Object.keys(body)) if (!BODY_FIELDS.includes(k)) issues.push(issue(k, 'unknown_field'));
  const m = body.methodology;
  if (m !== undefined && m !== null && (typeof m !== 'object' || Array.isArray(m))) issues.push(issue('methodology', 'type', { expected: 'object (ScoringMethodologyConfig)' }));
  const share = body.massChangeShare;
  if (share !== undefined && share !== null && (typeof share !== 'number' || !Number.isFinite(share) || share <= 0 || share > 1)) issues.push(issue('massChangeShare', 'range', { min: 0, max: 1, exclusiveMin: true }));
  const top = body.topMoves;
  if (top !== undefined && top !== null && (!Number.isInteger(top) || top < 1 || top > 100)) issues.push(issue('topMoves', 'range', { min: 1, max: 100 }));
  if (issues.length) throw E.badRequest('Requisição inválida', issues);
  return { methodology: m ?? null, massChangeShare: share ?? null, topMoves: top ?? null };
}

function createAnalysisPreviewService({ pool, App, developments }) {
  const available = () => !!(App.intelligence && App.methodology && App.analysisText && App.methodology.current);

  function publishedMethodology(devId) {
    if (!available()) throw E.unavailable('INTELLIGENCE_UNAVAILABLE', 'Motor de inteligência indisponível neste servidor');
    const base = App.methodology.current(devId);
    if (!base) throw E.unavailable('INTELLIGENCE_UNAVAILABLE', 'Nenhuma metodologia publicada para este empreendimento');
    return base;
  }

  /** stored engine inputs, as objects of the engine's realm (identical to what the browser hands the engine) */
  async function loadInputs(devId) {
    const stored = await analysisRepo.findCurrentInputs(pool, devId);
    if (!stored || !stored.lots.length) throw E.notFound('Medições de entrada do motor não importadas para este empreendimento', { developmentId: devId }, 'ANALYSIS_INPUT_NOT_FOUND');
    return { ...stored, lots: toRealm(App, stored.lots) };
  }

  /** RunAnalysis(devId) — the published methodology over the stored inputs (results of every lot; nothing written) */
  async function runPublished(devId) {
    await developments.getVersions(devId);
    const base = publishedMethodology(devId);
    const inputs = await loadInputs(devId);
    const out = App.intelligence.analyzeDevelopment(inputs.lots, { methodology: App.methodology.compiled(base), inputVersion: inputs.version });
    return { inputs, results: out.results, report: out.report, methodology: base };
  }

  /** engine results vs the stored published analysis (same comparison as tests/intelligence.test.js) */
  async function parityWithPublished(v, results) {
    if (!v.analysis) return null;
    const rows = await analysisRepo.findLotAnalysis(pool, v.analysis.id);
    const pub = new Map(rows.map(r => [r.lot_id, r.data.intelligence || {}]));
    const diffs = [];
    const same = (a, b) => stableStringify(a) === stableStringify(b); // JSONB does not keep key order
    for (const r of results) {
      const p = pub.get(r.lotId);
      if (!p) { diffs.push({ lotId: r.lotId, field: '*', engine: 'present', published: 'missing' }); continue; }
      const alerts = App.rules.sortAlerts(r.alerts); // the canonical lot orders alerts by severity; the engine keeps rule order
      const pairs = [
        ['scores', Object.fromEntries(SCORE_KEYS.map(k => [k, r.scores[k]])), Object.fromEntries(SCORE_KEYS.map(k => [k, p.scores ? p.scores[k] : null]))],
        ['class', r.class, p.class], ['rankings', plain(r.rankings), p.rankings],
        ['highlights.type', r.highlights.map(h => h.type), (p.highlights || []).map(h => h.type)],
        ['alerts.type', alerts.map(a => a.type), (p.alerts || []).map(a => a.type)], ['alerts.severity', alerts.map(a => a.severity), (p.alerts || []).map(a => a.severity)]
      ];
      for (const [field, a, b] of pairs) if (!same(a, b)) diffs.push({ lotId: r.lotId, field, engine: plain(a), published: plain(b) });
    }
    const bad = new Set(diffs.map(d => d.lotId));
    return { analysisVersion: v.analysis.version, lots: results.length, identical: results.length - bad.size, fieldsCompared: PARITY_FIELDS, diffs: diffs.slice(0, 20) };
  }

  /** preview(devId, body) → { data: AnalysisPreviewDto, meta } */
  async function preview(devId, body) {
    const cmd = validatePreviewRequest(body);
    const v = await developments.getVersions(devId);
    const base = publishedMethodology(devId);
    let candidate = base;
    if (cmd.methodology) {
      candidate = toRealm(App, cmd.methodology);
      const check = App.methodology.validate(candidate);
      const errors = check.ok ? [] : plain(check.errors);
      if (candidate.developmentId !== devId) errors.push({ code: 'DEVELOPMENT_MISMATCH', path: 'developmentId', message: `${candidate.developmentId} ≠ ${devId}` });
      if (errors.length) throw E.unprocessable('INVALID_METHODOLOGY', 'Metodologia candidata inválida', errors.slice(0, 50).map(e => ({ field: e.path ? `methodology.${e.path}` : 'methodology', reason: e.code, message: e.message })));
    }
    const inputs = await loadInputs(devId);
    const opts = {};
    if (cmd.massChangeShare != null) opts.massChangeShare = cmd.massChangeShare;
    if (cmd.topMoves != null) opts.topMoves = cmd.topMoves;
    const impact = plain(App.methodology.impact(base, candidate, inputs.lots, opts));
    const baseRun = App.intelligence.analyzeDevelopment(inputs.lots, { methodology: App.methodology.compiled(base), inputVersion: inputs.version });
    const publishedParity = await parityWithPublished(v, baseRun.results);
    const { base: b, candidate: c, ...report } = impact;
    return {
      data: {
        developmentId: devId, published: false, engineVersion: App.intelligence.ENGINE_VERSION, inputVersion: inputs.version, analysisVersion: v.analysis ? v.analysis.version : null,
        base: b, candidate: c, sameMethodology: b.checksum === c.checksum, impact: report, publishedParity
      },
      meta: { versions: developments.versionsDto(v) }
    };
  }

  return { preview, runPublished, loadInputs, available, validatePreviewRequest };
}

module.exports = { createAnalysisPreviewService, validatePreviewRequest };
