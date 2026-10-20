/* intelligence/math.js — shared math for the IntelligenceEngine (topic 12).
   One place for clamp, rounding, angles, percentiles and ranking, so no module
   repeats them. The original analysis ran in Python; the helpers reproduce its
   float semantics exactly (round half to even, floor modulo, radians) so the
   engine gives bit-identical notes and scores. */
App.imath = (() => {
  /** Python float modulo: result has the sign of the divisor (CPython float_rem). */
  function pyMod(a, n) { let r = a % n; if (r !== 0 && ((n < 0) !== (r < 0))) r += n; return r; }
  const DEG_TO_RAD = Math.PI / 180;
  const radians = d => d * DEG_TO_RAD;
  /** absolute angular difference in degrees, 0–180 */
  const angDiff = (a, b) => Math.abs(pyMod(a - b + 180, 360) - 180);
  const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
  /** round half to even (Python round(x)); x is an exact double, so a tie is an exact .5 */
  function roundHalfEven(x) {
    if (x == null || !Number.isFinite(x)) return null;
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1; if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  /** fixed decimals with Python's format semantics (exact decimal value, ties to even) */
  function toFixedPy(x, digits) {
    if (x == null || !Number.isFinite(x)) return null;
    let s = x.toFixed(digits); // exact decimal value, ties away from zero
    const scaled = x * Math.pow(10, digits);
    if (Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) { // exact tie
      const down = Math.floor(scaled), even = down % 2 === 0 ? down : down + 1;
      s = (even / Math.pow(10, digits)).toFixed(digits);
    }
    return s;
  }
  /** Python round(x, n) for display (e.g. notes with 1 decimal) */
  const roundTo = (x, digits) => x == null ? null : Number(toFixedPy(x, digits));
  const sector = (b, names) => names[Math.floor(pyMod(b + 22.5, 360) / 45)];
  /** percentile position of index i in a sorted list of n (0 = best) */
  const percentilePosition = (i, n) => i / n;
  /** competition ranking ("1224"): equal values share the position; returns Map key→position */
  function competitionRank(entries, order = 'DESC') {
    const s = entries.filter(e => e.value != null && Number.isFinite(e.value)).slice()
      .sort((a, b) => order === 'DESC' ? b.value - a.value : a.value - b.value);
    const out = new Map(); let prev = null, pos = 0;
    s.forEach((e, i) => { if (e.value !== prev) { pos = i + 1; prev = e.value; } out.set(e.key, { position: pos, total: s.length }); });
    return out;
  }
  const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
  return Object.freeze({ pyMod, radians, angDiff, clamp, roundHalfEven, toFixedPy, roundTo, sector, percentilePosition, competitionRank, isFiniteNumber });
})();
