/* services/scoring.js — ScoringService.
   Scores, classes, alerts, rankings and highlights live in Lot.intelligence
   (methodology unchanged). This service only interprets them for a context:
   primary score by objective, key attributes, ranking lookup. */
App.services.scoring = (() => {
  const SCORE_LABEL = { housing: 'Moradia', investment: 'Investimento', family: 'Família', premium: 'Premium', overall: 'Geral' };
  const NOTE_LABEL = { quiet: 'Silêncio', privacy: 'Privacidade', solar: 'Sol', view: 'Vista', leisure: 'Lazer', gate: 'Portaria', lowTraffic: 'Baixo fluxo',
    geometry: 'Geometria', priceQuality: 'Custo-benefício', liquidity: 'Liquidez', relativeValue: 'Valor relativo' };
  const RANK_TYPE = { housing: 'HOUSING', investment: 'INVESTMENT', family: 'FAMILY', premium: 'PREMIUM', overall: 'OVERALL' };
  const objectiveOf = (cfg, objective) => cfg.objectives[objective] || cfg.objectives[cfg.defaultObjective];
  /** primary score: the customer's or broker's objective, else the development default */
  function primaryScore(l, cfg, objective) {
    const o = objectiveOf(cfg, objective);
    return { key: o.score, label: SCORE_LABEL[o.score], value: l.intelligence.scores[o.score], fieldKey: 'intelligence.scores.' + o.score, ranking: ranking(l, o.score) };
  }
  /** key attributes: customer priorities first (most important first), then the objective's list */
  function keyAttributes(l, cfg, objective, customerPrefs, n) {
    const o = objectiveOf(cfg, objective);
    const fromCustomer = Object.entries(customerPrefs || {}).filter(([k, w]) => w > 0 && NOTE_LABEL[k]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return [...new Set([...fromCustomer, ...o.keyAttributes])].slice(0, n)
      .map(k => ({ key: k, label: NOTE_LABEL[k], value: App.model.criterion(l, k), fieldKey: App.model.CRITERIA_FIELDS[k] }));
  }
  const ranking = (l, key) => l.intelligence.rankings.find(r => r.type === RANK_TYPE[key]) || null;
  return { SCORE_LABEL, NOTE_LABEL, RANK_TYPE, primaryScore, keyAttributes, ranking };
})();
