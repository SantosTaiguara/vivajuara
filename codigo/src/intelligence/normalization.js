/* intelligence/normalization.js — NormalizationRegistry (topic 13).
   Every transformation a methodology config may use is a named, versioned,
   pure function registered here. A config only names an op and its parameters:
   no eval, no Function, no field access by string evaluation. A config that names
   an unknown op is rejected at validation, never at analysis time.
   Each op receives (acc, step, read) and returns { value, delta?, applied? }:
   - acc: the criterion value so far (null before the first op)
   - read(key): a value from the metric context (fieldKey or criterion id)
   Ops never turn null into 0: a missing required input returns { missing: [key] }. */
App.inormalize = (() => {
  const M = App.imath;
  const minOf = (step, read) => {
    const keys = step.inputMinOf || [step.input], vals = keys.map(read);
    if (vals.some(v => v == null)) return { missing: keys.filter((k, i) => vals[i] == null) };
    return { value: Math.min(...vals) };
  };
  const req = (read, key) => { const v = read(key); return v == null ? { missing: [key] } : { value: v }; };
  const bandDelta = (x, bands) => { for (const b of bands) if ((b.lt == null || x < b.lt) && (b.lte == null || x <= b.lte) && (b.gte == null || x >= b.gte)) return b.delta; return 0; };

  const OPS = {
    FIXED_SCALE: { version: '1.0', params: ['value'], run: (acc, s) => ({ value: s.value }) },
    ENUM_MAPPING: { version: '1.0', params: ['input', 'map'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      if (!Object.prototype.hasOwnProperty.call(s.map, r.value)) return { unknownEnum: { key: s.input, value: r.value } };
      return { value: s.map[r.value] }; } },
    ENUM_DELTA: { version: '1.0', params: ['input', 'map'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      const d = Object.prototype.hasOwnProperty.call(s.map, r.value) ? s.map[r.value] : 0;
      return d ? { value: acc + d, delta: d, applied: true, input: r.value } : { value: acc }; } },
    BOOLEAN_DELTA: { version: '1.0', params: ['input', 'whenTrue'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      return r.value === true ? { value: acc + s.whenTrue, delta: s.whenTrue, applied: true } : { value: acc }; } },
    /** first band that matches subtracts/adds its delta (only one band applies) */
    THRESHOLD: { version: '1.0', params: ['bands'], run(acc, s, read) {
      const r = minOf(s, read); if (r.missing) return r;
      const d = bandDelta(r.value, s.bands);
      return d ? { value: acc + d, delta: d, applied: true, input: r.value } : { value: acc, input: r.value }; } },
    /** adds delta only while the current value is below a ceiling (view bonus) */
    THRESHOLD_IF_BELOW: { version: '1.0', params: ['lt', 'currentBelow', 'delta'], run(acc, s, read) {
      const r = minOf(s, read); if (r.missing) return r;
      return r.value < s.lt && acc < s.currentBelow ? { value: acc + s.delta, delta: s.delta, applied: true, input: r.value } : { value: acc, input: r.value }; } },
    THRESHOLD_ABOVE: { version: '1.0', params: ['input', 'delta'], run(acc, s, read) {
      const v = read(s.input);
      const hit = v != null && ((s.gt != null && v > s.gt) || (s.gte != null && v >= s.gte));
      if (hit) return { value: acc + s.delta, delta: s.delta, applied: true, input: v };
      return s.addZeroOtherwise ? { value: acc + 0, input: v } : { value: acc, input: v }; } },
    /** first matching piece adds its delta */
    PIECEWISE: { version: '1.0', params: ['input', 'pieces'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      const d = bandDelta(r.value, s.pieces);
      return d ? { value: acc + d, delta: d, applied: true, input: r.value } : { value: acc, input: r.value }; } },
    /** first matching piece sets the value; a missing input uses the declared `missing` value (documented, not a guess) */
    PIECEWISE_VALUE: { version: '1.0', params: ['input', 'pieces'], run(acc, s, read) {
      const v = read(s.input);
      if (v == null) return 'missing' in s ? { value: s.missing, usedMissingValue: true } : { missing: [s.input] };
      for (const p of s.pieces) if (p.lte == null || v <= p.lte) return { value: p.value, input: v };
      return { missing: [s.input] }; } },
    /** from − drop·(x − start)/span (linear decay with distance) */
    LINEAR: { version: '1.0', params: ['input', 'from', 'drop', 'start', 'span'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      return { value: s.from - s.drop * (r.value - s.start) / s.span, input: r.value }; } },
    MIN_MAX: { version: '1.0', params: ['input', 'min', 'max'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      return { value: 10 * (r.value - s.min) / Math.max(1e-9, s.max - s.min) }; } },
    INVERTED_MIN_MAX: { version: '1.0', params: ['input', 'min', 'max'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      return { value: 10 - 10 * (r.value - s.min) / Math.max(1e-9, s.max - s.min) }; } },
    /** base + amplitude·(1 + cos(angle to target))/2 */
    COSINE_ORIENTATION: { version: '1.0', params: ['input', 'targetDeg', 'base', 'amplitude'], run(acc, s, read) {
      const r = req(read, s.input); if (r.missing) return r;
      return { value: s.base + s.amplitude * (1 + Math.cos(M.radians(M.angDiff(r.value, s.targetDeg)))) / 2, input: r.value }; } },
    WEIGHTED_SUM: { version: '1.0', params: ['terms'], run(acc, s, read) {
      const vals = s.terms.map(t => read(t.input)), miss = s.terms.filter((t, i) => vals[i] == null).map(t => t.input);
      if (miss.length) return { missing: miss };
      let sum = 0; s.terms.forEach((t, i) => { sum += vals[i] * t.weight; });
      return { value: sum }; } },
    /** acc + Σ (x − center)·weight, summed first (as in the original) */
    WEIGHTED_DEVIATIONS: { version: '1.0', params: ['terms'], run(acc, s, read) {
      const vals = s.terms.map(t => read(t.input)), miss = s.terms.filter((t, i) => vals[i] == null).map(t => t.input);
      if (miss.length) return { missing: miss };
      let sum = 0; s.terms.forEach((t, i) => { sum += (vals[i] - t.center) * t.weight; });
      return { value: acc + sum, delta: sum, applied: true }; } },
    MEAN: { version: '1.0', params: ['inputs'], run(acc, s, read) {
      const vals = s.inputs.map(read), miss = s.inputs.filter((k, i) => vals[i] == null);
      if (miss.length) return { missing: miss };
      let sum = 0; for (const v of vals) sum += v; return { value: sum / vals.length }; } },
    CAP: { version: '1.0', params: ['min', 'max'], run: (acc, s) => ({ value: M.clamp(acc, s.min, s.max) }) },
    FLOOR: { version: '1.0', params: ['min'], run: (acc, s) => ({ value: Math.max(s.min, acc) }) },
    /** per-lot adjustments declared in the config (lotAdjustments), never hidden in code */
    LOT_ADJUSTMENT: { version: '1.0', params: [], run(acc, s, read, ctx) {
      const adj = (ctx.adjustments || []).filter(a => a.criterion === ctx.criterionId);
      let v = acc, d = 0; for (const a of adj) { v += a.delta; d += a.delta; }
      return adj.length ? { value: v, delta: d, applied: true, adjustments: adj.map(a => a.reason) } : { value: acc }; } }
  };
  const has = op => Object.prototype.hasOwnProperty.call(OPS, op);
  const get = op => has(op) ? OPS[op] : null;
  const catalog = () => Object.entries(OPS).map(([id, o]) => ({ id, version: o.version, params: o.params }));
  return Object.freeze({ has, get, catalog, OPS: Object.freeze(Object.keys(OPS)) });
})();
