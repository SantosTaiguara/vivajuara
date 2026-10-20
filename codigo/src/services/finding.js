/* services/finding.js — SearchService, FilteringService, RecommendationService.
   They receive canonical Lots and return ids, rankings and reasons. No HTML. */
App.services = App.services || {};

App.services.search = (() => {
  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/QUADRA/g, 'Q ').replace(/LOTE/g, 'L ').replace(/[·,;:_/-]/g, ' ').replace(/\s+/g, ' ').trim();
  /** parse(query, { blocks, all, byCode }) → { kind: 'lot' | 'block' | 'multi' | 'none', lots, block } — a single lot is never guessed from an ambiguous query. */
  function parse(q, { blocks, all, byCode }) {
    const s = norm(q); if (!s) return { kind: 'none', lots: [] };
    const B = new Set(blocks.map(b => b.toUpperCase()));
    // "Lote 5" means lot number 5 in any block (L is also a block letter here).
    const explicitLot = /^\s*lote\s*\d+\s*$/i.test(q);
    let m = explicitLot ? null : (s.match(/^[A-Z]+ Q([A-Z]+) L0*(\d+)$/) || s.match(/^Q ?([A-Z]+) ?L ?(\d+)$/) || s.match(/^([A-Z]+) ?(\d+)$/));
    if (m && B.has(m[1])) { const l = byCode.get(m[1] + Number(m[2])); return l ? { kind: 'lot', lots: [l] } : { kind: 'none', lots: [] }; }
    m = s.match(/^Q ?([A-Z]+)$/) || (s.length <= 2 && s.match(/^([A-Z]+)$/));
    if (m && B.has(m[1])) return { kind: 'block', block: m[1], lots: all.filter(l => l.identity.blockId === m[1]) };
    m = explicitLot ? s.match(/^L ?(\d+)$/) : s.match(/^(\d+)$/);
    if (m) { const ls = all.filter(l => l.identity.lotNumber === Number(m[1])); return ls.length === 1 ? { kind: 'lot', lots: ls } : ls.length ? { kind: 'multi', lots: ls } : { kind: 'none', lots: [] }; }
    const pre = all.filter(l => l.identity.code.startsWith(s.replace(/ /g, '')));
    return pre.length === 1 ? { kind: 'lot', lots: pre } : pre.length ? { kind: 'multi', lots: pre.slice(0, 12) } : { kind: 'none', lots: [] };
  }
  return { parse, norm };
})();

App.services.filtering = (() => {
  // Facade over the three-level filter system (filters/filters.js, topic 17): same API as before.
  const FX = App.filters;
  /** apply(lots, filterState, ctx) → Set of lot ids */
  const apply = (lots, f, ctx = {}) => FX.run(lots, FX.compile(f, ctx).query, ctx).matchedIds;
  return { EMPTY: FX.EMPTY, FILTERS: FX.DEFS, isActive: FX.isActive, activeCount: FX.activeCount, apply, get: App.model.get };
})();

App.services.recommendation = (() => {
  const C = App.model.criterion;
  // Criteria on a 0–10 scale. Scores (0–100) are divided by 10; area is relative to the dataset.
  const CRITERIA = {
    quiet: { label: 'Silêncio', get: l => C(l, 'quiet') },
    privacy: { label: 'Privacidade', get: l => C(l, 'privacy') },
    solar: { label: 'Orientação solar', get: l => C(l, 'solar') },
    view: { label: 'Vista', get: l => C(l, 'view') },
    leisure: { label: 'Perto do lazer', get: l => C(l, 'leisure') },
    gate: { label: 'Perto da portaria', get: l => C(l, 'gate') },
    lowTraffic: { label: 'Pouco trânsito', get: l => C(l, 'lowTraffic') },
    geometry: { label: 'Formato do lote', get: l => C(l, 'geometry') },
    priceQuality: { label: 'Custo-benefício', get: l => C(l, 'priceQuality') },
    green: { label: 'Área verde nos fundos', get: l => l.surroundings.hasGreenRear == null ? null : l.surroundings.hasGreenRear ? 10 : 0 },
    area: { label: 'Área maior', get: (l, c) => l.geometry.areaM2 == null ? null : 10 * (l.geometry.areaM2 - c.areaMin) / Math.max(1, c.areaMax - c.areaMin) },
    housing: { label: 'Score Moradia', get: l => l.intelligence.scores.housing / 10 },
    investment: { label: 'Score Investimento', get: l => l.intelligence.scores.investment / 10 },
    family: { label: 'Score Família', get: l => l.intelligence.scores.family / 10 },
    premium: { label: 'Score Premium', get: l => l.intelligence.scores.premium / 10 }
  };
  const WEIGHT = { 1: 1, 2: 2, 3: 4 };  // Pouco, Importante, Essencial
  const PRESETS = [
    { id: 'moradia', label: 'Melhores para moradia', prefs: { housing: 3 }, objective: 'housing' },
    { id: 'invest', label: 'Melhores para investimento', prefs: { investment: 3 }, objective: 'investment' },
    { id: 'silencio', label: 'Mais silenciosos', prefs: { quiet: 3, lowTraffic: 2 } },
    { id: 'privados', label: 'Mais privados', prefs: { privacy: 3, quiet: 1 } },
    { id: 'sol', label: 'Melhor orientação', prefs: { solar: 3 } },
    { id: 'custo', label: 'Melhor custo-benefício', prefs: { priceQuality: 3 } },
    { id: 'premium', label: 'Premium', prefs: { premium: 3 }, objective: 'premium' },
    { id: 'familia', label: 'Para família', prefs: { family: 3 }, objective: 'family' },
    { id: 'verde', label: 'Com área verde nos fundos', prefs: { green: 3, privacy: 1 } }
  ];
  const isActive = p => !!p && Object.values(p).some(w => w > 0);
  /** rank(lots, prefs, eligibleIds) → technical ranking: [{ id, relevance (0–1), reasons }] over every lot that passes the filters. */
  function rank(lots, prefs, eligible) {
    const as = lots.map(l => l.geometry.areaM2).filter(v => v != null), ctx = { areaMin: Math.min(...as), areaMax: Math.max(...as) };
    const keys = Object.entries(prefs || {}).filter(([k, w]) => w > 0 && CRITERIA[k]);
    const out = [];
    for (const l of lots) {
      if (eligible && !eligible.has(l.identity.id)) continue;
      let num = 0, den = 0; const reasons = [];
      for (const [k, w] of keys) {
        const v = CRITERIA[k].get(l, ctx); if (v == null) continue;
        num += WEIGHT[w] * Math.max(0, Math.min(10, v)); den += WEIGHT[w] * 10;
        reasons.push({ key: k, label: CRITERIA[k].label, value: v });
      }
      if (den) out.push({ id: l.identity.id, code: l.identity.code, relevance: num / den, reasons: reasons.sort((a, b) => b.value - a.value) });
    }
    return out.sort((a, b) => b.relevance - a.relevance || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  }
  /** commercial ranking: the technical one restricted to lots the availability policy lets us recommend (UNKNOWN and SOLD never are) */
  const commercial = (ranking, byId, policy) => ranking.filter(r => { const l = byId.get(r.id); return l && App.availability.isEligibleForRecommendation(l.availability.status, policy); });
  return { CRITERIA, PRESETS, WEIGHT, isActive, rank, commercial };
})();
