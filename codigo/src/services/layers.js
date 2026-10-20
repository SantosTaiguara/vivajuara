/* services/layers.js — MapLayerService: one thematic layer at a time.
   Fill = thematic class; interaction state is drawn separately (outline).
   Bins come from the data (quantiles) or from configured methodology. */
App.services.layers = (() => {
  const GREEN = ['#86B068', '#64994B', '#477E38', '#2D6232', '#1A3F20'];
  const ORANGE = ['#E59A6C', '#D27B47', '#B9602D', '#93451E', '#682D11'];
  const CLASS = { A_PLUS: '#2D6232', A: '#64994B', B: '#D8D3BF', C: '#D27B47', D: '#93451E' };
  const STATUS = { AVAILABLE: '#2D6232', RESERVED: '#eda100', PROPOSAL: '#2a78d6', BLOCKED: '#5f6b61', SOLD: '#93451E', UNAVAILABLE: '#a9b0a6', UNKNOWN: '#e4e7e0' };
  const NODATA = '#cdd2c9';
  const LV = App.enums.LEVEL_ORDER;
  const t = App.i18n.t, F = App.fmt;
  const SCORE_BINS = [[0, 60, 'Abaixo de 60'], [60, 70, '60 a 69'], [70, 80, '70 a 79'], [80, 88, '80 a 87'], [88, 101, '88 ou mais']];

  function niceBreaks(vals, step, n = 5) {
    const s = vals.filter(v => v != null).sort((a, b) => a - b); if (!s.length) return [];
    const br = []; for (let i = 1; i < n; i++) { const q = s[Math.floor(i * s.length / n)]; const r = Math.round(q / step) * step; if (r > s[0] && r <= s[s.length - 1] && !br.includes(r)) br.push(r); }
    return br;
  }
  function binsFrom(breaks, labelFn) {
    const edges = [-Infinity, ...breaks, Infinity];
    return edges.slice(0, -1).map((lo, i) => ({ key: 'b' + i, lo, hi: edges[i + 1], label: labelFn(lo, edges[i + 1]) }));
  }
  const pickRamp = (arr, n) => { if (n <= 1) return [arr[3]]; const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]); return out; };

  const DEFS = [
    { id: 'availability', fieldKey: 'availability.status', group: 'Comercial', label: 'Disponibilidade', client: true,
      build(items) { const keys = App.enums.AVAILABILITY_ORDER; const value = it => it.availability.status;
        return { classes: keys.map(k => ({ key: k, label: t('AvailabilityStatus', k), color: STATUS[k] })), value,
          neutral: items.every(it => value(it) === 'UNKNOWN'), note: items.every(it => value(it) === 'UNKNOWN') ? 'Ainda sem espelho de vendas: nenhum lote tem status confirmado. A planta aparece limpa.' : null }; } },
    { id: 'price', fieldKey: 'commercial.price', group: 'Comercial', label: 'Preço', client: true,
      build(items) { const br = niceBreaks(items.map(i => i.commercial.price), 10000);
        const bins = binsFrom(br, (lo, hi) => lo === -Infinity ? `Até ${F.formatBRLShort(hi)}` : hi === Infinity ? `Acima de ${F.formatBRLShort(lo)}` : `${F.formatBRLShort(lo)} a ${F.formatBRLShort(hi)}`);
        const cols = pickRamp(GREEN, bins.length); bins.forEach((b, i) => b.color = cols[i]);
        return { classes: bins, value: it => it.commercial.price == null ? null : bins.find(b => it.commercial.price >= b.lo && it.commercial.price < b.hi).key, note: 'Faixas calculadas a partir dos preços da tabela atual.' }; } },
    { id: 'pricePerM2', fieldKey: 'commercial.pricePerM2', group: 'Comercial', label: 'Preço por m²', client: true,
      build(items) { const u = [...new Set(items.map(i => i.commercial.pricePerM2).filter(v => v != null))].sort((a, b) => a - b);
        const cols = pickRamp(GREEN, u.length);
        return { classes: u.map((v, i) => ({ key: String(v), label: F.formatPricePerM2(v), color: cols[i] })), value: it => it.commercial.pricePerM2 == null ? null : String(it.commercial.pricePerM2),
          note: u.length === 1 ? 'A tabela atual tem o mesmo preço por m² para todos os lotes.' : null }; } },
    { id: 'area', fieldKey: 'geometry.areaM2', group: 'Comercial', label: 'Área', client: true,
      build(items) { const br = niceBreaks(items.map(i => i.geometry.areaM2), 10);
        const bins = binsFrom(br, (lo, hi) => lo === -Infinity ? `Até ${F.formatSquareMeters(hi, 0)}` : hi === Infinity ? `Acima de ${F.formatSquareMeters(lo, 0)}` : `${F.number(lo)} a ${F.formatSquareMeters(hi, 0)}`);
        const cols = pickRamp(GREEN, bins.length); bins.forEach((b, i) => b.color = cols[i]);
        return { classes: bins, value: it => { const a = it.geometry.areaM2; return a == null ? null : bins.find(b => a >= b.lo && a < b.hi).key; } }; } },
    { id: 'class', fieldKey: 'intelligence.class', group: 'Qualidade', label: 'Classe', client: false,
      build() { return { classes: App.enums.CLASS_ORDER.map(k => ({ key: k, label: k === 'A_PLUS' ? 'A+ (5% melhores)' : k === 'D' ? 'D (exigem atenção)' : t('LotClass', k), color: CLASS[k] })), value: it => it.intelligence.class === 'UNKNOWN' ? null : it.intelligence.class }; } },
    { id: 'score', fieldKey: 'intelligence.scores', group: 'Qualidade', label: 'Score', client: false, param: 'scoreKey',
      build(items, o) { const k = o.scoreKey || 'housing';
        return { title: `Score ${App.services.scoring.SCORE_LABEL[k]}`, classes: SCORE_BINS.map((b, i) => ({ key: 'b' + i, lo: b[0], hi: b[1], label: b[2], color: GREEN[i] })),
          value: it => { const v = it.intelligence.scores[k]; if (v == null) return null; return 'b' + SCORE_BINS.findIndex(b => v >= b[0] && v < b[1]); } }; } },
    { id: 'sun', fieldKey: 'environmental.orientationRear', group: 'Ambiental', label: 'Sol nos fundos', client: true,
      build() { const g = d => ['N', 'NE', 'NW'].includes(d) ? 'north' : ['E', 'W'].includes(d) ? 'eastwest' : d ? 'south' : null;
        return { classes: [{ key: 'north', label: 'Fundos para N, NE ou NO (mais sol)', color: GREEN[4] }, { key: 'eastwest', label: 'Fundos para leste ou oeste', color: GREEN[2] }, { key: 'south', label: 'Fundos para S, SE ou SO (mais sombra)', color: GREEN[0] }],
          value: it => g(it.environmental.orientationRear), note: 'Resumo da orientação. A análise solar do lote mostra hora a hora.' }; } },
    { id: 'noise', fieldKey: 'environmental.noiseLevel', group: 'Ambiental', label: 'Ruído (estimativa)', client: true, build: items => levelLayer(items, it => it.environmental.noiseLevel, ORANGE, false, 'Exposição potencial estimada, não medição.') },
    { id: 'forest', fieldKey: 'surroundings.hasGreenRear', group: 'Ambiental', label: 'Mata / área verde nos fundos', client: true,
      build() { return { classes: [{ key: 'yes', label: 'Mata ou parque nos fundos', color: GREEN[3] }, { key: 'no', label: 'Outro lote ou área aberta', color: '#D8D3BF' }],
        value: it => it.surroundings.hasGreenRear == null ? null : it.surroundings.hasGreenRear ? 'yes' : 'no', note: 'Somente o que a planta, o KMZ e a imagem mostram hoje.' }; } },
    { id: 'privacy', fieldKey: 'environmental.privacyLevel', group: 'Ambiental', label: 'Privacidade (estimativa)', client: true, build: items => levelLayer(items, it => it.environmental.privacyLevel, GREEN, true) },
    { id: 'traffic', fieldKey: 'mobility.estimatedTraffic', group: 'Mobilidade', label: 'Trânsito (estimativa)', client: true, build: items => levelLayer(items, it => it.mobility.estimatedTraffic, ORANGE, false, 'Fluxo relativo estimado pelas rotas internas, não contagem.') },
    { id: 'gate', fieldKey: 'mobility.gateProximity', group: 'Mobilidade', label: 'Distância à portaria', client: true,
      build() { const ks = ['VERY_CLOSE', 'CLOSE', 'INTERMEDIATE', 'FAR'], cols = [GREEN[4], GREEN[3], GREEN[1], GREEN[0]];
        return { classes: ks.map((k, i) => ({ key: k, label: `${t('GateProximity', k)} (${['até 200', '200 a 399', '400 a 649', '650 ou mais'][i]} m de carro)`, color: cols[i] })), value: it => it.mobility.gateProximity }; } },
    { id: 'leisure', fieldKey: 'mobility.routeDistanceToLeisureM', group: 'Mobilidade', label: 'Distância ao clube', client: true,
      build() { const B = [[0, 250, 'Até 249 m'], [250, 500, '250 a 499 m'], [500, 750, '500 a 749 m'], [750, 1e9, '750 m ou mais']], cols = [GREEN[4], GREEN[3], GREEN[1], GREEN[0]];
        return { classes: B.map((b, i) => ({ key: 'b' + i, label: b[2] + ' de carro', color: cols[i] })),
          value: it => { const v = it.mobility.routeDistanceToLeisureM; return v == null ? null : 'b' + B.findIndex(b => v >= b[0] && v < b[1]); } }; } },
    { id: 'none', fieldKey: null, group: 'Base', label: 'Sem camada (só a planta)', client: true, build: () => ({ classes: [], value: () => null, neutral: true }) }
  ];
  function levelLayer(items, get, pal, fem, note) {
    const present = LV.filter(k => items.some(it => get(it) === k));
    const cols = pal === GREEN ? present.map(k => GREEN[LV.indexOf(k)]) : present.map(k => ORANGE[LV.indexOf(k)]);
    return { classes: present.map((k, i) => ({ key: k, label: App.fmt.formatLevel(k, fem), color: cols[i] })), value: get, note };
  }
  const BY = Object.fromEntries(DEFS.map(d => [d.id, d]));
  /** does a ChangeSet touch this layer? (selective update: price changes repaint the price layer, never the geometry) */
  const affectedBy = (layerId, change) => { const d = BY[layerId]; return !!(d && d.fieldKey && change.changedFields.some(f => f.startsWith(d.fieldKey))); };
  /** compute(layerId, lots, opts) → { def, classes (with counts), keyOf: Map id→key, colorOf: Map id→color, neutral, note }. Reads canonical Lots only. */
  function compute(layerId, items, opts = {}) {
    const def = BY[layerId] || BY.availability;
    const b = def.build(items, opts), keyOf = new Map(), colorOf = new Map();
    const col = Object.fromEntries(b.classes.map(c => [c.key, c.color]));
    const counts = Object.fromEntries(b.classes.map(c => [c.key, 0])); let nd = 0;
    for (const it of items) {
      const id = it.identity.id, k = b.value(it); keyOf.set(id, k);
      colorOf.set(id, k == null ? (b.neutral ? STATUS.UNKNOWN : NODATA) : (col[k] || NODATA));
      if (opts.counted && !opts.counted.has(id)) continue;
      if (k == null) nd++; else if (counts[k] != null) counts[k]++;
    }
    const classes = b.classes.map(c => ({ ...c, count: counts[c.key] })).filter(c => layerId !== 'availability' || c.count > 0 || c.key !== 'UNKNOWN');
    if (nd && !b.neutral) classes.push({ key: null, label: 'Sem dado', color: NODATA, count: nd });
    return { def, title: b.title || def.label, classes, keyOf, colorOf, neutral: !!b.neutral, note: b.note || null };
  }
  /** solar "now" layer used while the solar analysis is open */
  function solarNow(items, solar, season, hour) {
    const C = { FRONT: '#eda100', BACK: '#2a78d6', NIGHT: '#c9cec5' }, keyOf = new Map(), colorOf = new Map(), counts = { FRONT: 0, BACK: 0, NIGHT: 0 };
    for (const it of items) { const b = it.environmental.frontBearingDeg; const k = b == null ? 'NIGHT' : solar.litSide(b, season, hour); keyOf.set(it.identity.id, k); colorOf.set(it.identity.id, C[k]); counts[k]++; }
    return { def: { id: 'solarNow', label: 'Sol agora' }, title: 'Lado com sol neste horário', keyOf, colorOf, neutral: false,
      classes: [{ key: 'FRONT', label: 'Sol na frente', color: C.FRONT, count: counts.FRONT }, { key: 'BACK', label: 'Sol nos fundos', color: C.BACK, count: counts.BACK }, { key: 'NIGHT', label: 'Sem sol', color: C.NIGHT, count: counts.NIGHT }],
      note: 'Cálculo astronômico; não considera sombra de vizinhos.' };
  }
  return { DEFS, BY, compute, solarNow, affectedBy, CLASS, STATUS, GREEN, ORANGE };
})();
