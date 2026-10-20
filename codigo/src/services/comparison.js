/* services/comparison.js — legacy ComparisonService API, kept for the callers that still use it (viewmodels.comparisonVM,
   quickview). Since topics 24–25 the comparison is its own domain (compare/comparisonDomain.js) and the "winner" of a row
   comes only from the registered per-criterion semantics (compare/criterionWinner.js). The old rule "max for scores and
   areas, min for prices and distances" is gone: rows whose fieldKey has no registered semantics get no winner (fail closed),
   ties within tolerance and immaterial differences get none, a single valid value never wins. */
App.services.comparison = (() => {
  const MAX_LOTS = 4;
  const E = () => App.compare && App.compare.evaluation;
  /** compare(items, rows) → rows with values[] and winners[] (indexes). rows: { label, get, fmt, better (ignored), fieldKey } */
  function compare(items, rows) {
    let winners = rows.map(() => []);
    try { if (E() && items.length > 1) winners = E().legacyRowWinners(items, rows); } catch (e) { winners = rows.map(() => []); }
    return rows.map((r, k) => {
      const values = items.map(it => { try { return r.get(it); } catch (e) { return null; } });
      return { ...r, values, winners: winners[k] || [] };
    });
  }
  /** leaders(items, criteria): who has a clear advantage on each analysis note (0–10), with tie tolerance and margin */
  function leaders(items, criteria) {
    try { return E() ? E().legacyLeaders(items, criteria) : []; } catch (e) { return []; }
  }
  return { MAX_LOTS, compare, leaders };
})();
