/* presentation/viewmodels.js — Lot → screen-ready data, by information level:
   0 development · 1 map (tooltip) · 2 Quick View · 3 details (sections) · 4 evidence (provenance).
   Formatting happens here and in utils/formatters.js only. Nothing here touches the DOM. */
App.vm = (() => {
  const M = App.model, F = App.fmt, t = App.i18n.t, AV = App.availability, SC = App.services.scoring;
  const STATUS_COLOR = App.services.layers.STATUS;
  const FEM = new Set(['environmental.privacyLevel', 'intelligence.liquidity']);
  const GROUP_OVERRIDE = { 'environmental.eastSide': 'EastSide' };

  /** one value of the Field Registry formatted for display */
  function formatField(f, v, lot, ctx = {}) {
    if (v == null || (Array.isArray(v) && !v.length && f.type !== 'array')) return null;
    switch (f.type) {
      case 'number': {
        if (f.unit === 'm²') return F.formatSquareMeters(v);
        if (f.unit === 'm') return F.formatMeters(v, v < 100 && v % 1 ? 1 : 0);
        if (f.unit === 'BRL') return F.formatBRL(v);
        if (f.unit === 'BRL/m²') return F.formatPricePerM2(v);
        if (f.unit === 'score 0–10') return `${F.formatNote(v)}/10`;
        if (f.unit === 'score 0–100') return F.formatScore(v);
        if (f.unit === '%') return `${F.number(v, v % 1 ? 1 : 0)}%`;
        if (f.unit === 'graus') return f.key.startsWith('location.') ? F.number(v, 6) + '°' : `${F.number(v)}°`;
        if (f.unit === 'lotes') return `${F.number(v)} lotes`;
        return F.number(v, v % 1 ? 2 : 0);
      }
      case 'boolean': return F.formatBool(v);
      case 'enum': return f.enum === 'Level' ? F.formatLevel(v, FEM.has(f.key)) : f.key === 'environmental.orientationFront' || f.key === 'environmental.orientationRear' ? F.formatDirection(v, f.key === 'environmental.orientationFront' ? lot.environmental.frontBearingDeg : null) : t(GROUP_OVERRIDE[f.key] || f.enum, v);
      case 'date': return F.formatDate(v);
      case 'datetime': return F.formatDateTime(v);
      case 'array': {
        if (!v.length) return f.key === 'environmental.noiseSources' ? 'Nenhuma fonte relevante identificada' : f.key === 'construction.easements' ? 'Nenhuma indicada na planta' : null;
        if (f.key === 'environmental.morningSun' || f.key === 'environmental.afternoonSun') return F.capital(F.formatSides(v));
        if (f.key === 'environmental.noiseSources') return v.map(s => `${s.detail === 'STREET_FLOW' ? `fluxo ${F.formatLevel(s.relevance).toLowerCase()} na rua` : t('NoiseSourceDetail', s.detail)}${s.distanceM != null ? ` (${F.formatMeters(s.distanceM)})` : ''}`).join('; ');
        if (f.key === 'construction.easements') return v.map(e => e.description).join('; ');
        if (f.key === 'intelligence.idealProfiles') return F.capital(v.map(p => t('Profile', p)).join(', '));
        if (f.key === 'commercial.availablePlans') { const tb = ctx.priceTable; return v.map(id => (tb && (tb.plans.find(p => p.id === id) || {}).name) || id).join(', '); }
        if (f.key === 'intelligence.rankings') return v.map(r => `${t('RankingType', r.type)}: ${r.position}º de ${r.total}`).join(' · ');
        if (f.key === 'intelligence.highlights') return v.map(h => h.title).join('; ');
        if (f.key === 'intelligence.alerts') return `${v.length} ${v.length === 1 ? 'alerta' : 'alertas'}`;
        return v.join(', ');
      }
      case 'string': return f.key === 'environmental.northReference' ? 'Planta oficial, norte para cima' : String(v);
      default: return null;
    }
  }
  /** FieldViewModel: value + its provenance (level 4 lives in the popover) */
  function fieldVM(lot, key, ctx = {}) {
    const f = M.field(key); if (!f) return null;
    const raw = M.get(lot, key), prov = M.getFieldProvenance(lot, key), formatted = formatField(f, raw, lot, ctx);
    const src = prov.sourceId && ctx.dev ? ctx.dev.sources.find(s => s.id === prov.sourceId) : null;
    return { key, label: f.label, formattedValue: formatted, rawValue: raw, unit: f.unit, priority: f.priority, dataStatus: prov.status, provenance: prov,
      sourceSummary: src ? src.name : null, helpText: f.meaning, isAvailable: formatted != null };
  }

  /** status presentation: label + color + freshness, always with text (never color alone) */
  function statusVM(lot, mode) {
    const a = lot.availability, label = t('AvailabilityStatus', a.status), client = mode === 'client';
    let note = null, warn = false;
    if (a.status === 'UNKNOWN') { note = client ? 'Disponibilidade sujeita a confirmação' : 'Sem espelho de vendas: confirme com a loteadora'; warn = true; }
    else if (a.freshness === 'EXPIRED') { note = client ? 'Disponibilidade sujeita a confirmação' : `Informação vencida, confirme antes de oferecer${a.updatedAt ? ' · ' + F.formatAge(a.updatedAt) : ''}`; warn = true; }
    else if (a.freshness === 'STALE') { note = client ? 'Disponibilidade sujeita a confirmação' : `Disponibilidade não confirmada${a.updatedAt ? ' · última atualização ' + F.formatAge(a.updatedAt) : ''}`; warn = true; }
    else if (a.updatedAt && !client) note = `Atualizado ${F.formatAge(a.updatedAt)}`;
    // the label never says "Disponível" alone when the source did not confirm it now
    const shown = a.status === 'AVAILABLE' && a.freshness !== 'FRESH' ? (client ? 'Disponível (sujeito a confirmação)' : 'Disponível, não confirmado agora') : label;
    return { code: a.status, label: shown, color: STATUS_COLOR[a.status], note, warn, freshness: a.freshness, offerable: AV.isOfferable(a.status), reservedUntil: a.status === 'RESERVED' && !client && a.reservedUntil ? F.formatDateTime(a.reservedUntil) : null,
      expired: AV.isReservationExpired(a), reason: !client && a.reason ? t('AvailabilityReason', a.reason) : null };
  }
  /** price freshness (commercial layer): FRESH only when the published table was confirmed in this session */
  function priceNote(lot, mode) {
    const f = lot.metadata.freshness && lot.metadata.freshness.commercial;
    if (!f || f === 'FRESH') return null;
    if (f === 'EXPIRED') return mode === 'client' ? 'Valor sujeito a confirmação' : 'Tabela vencida: não use para fechar negócio';
    if (f === 'UNKNOWN') return 'Preço não disponível';
    return mode === 'client' ? 'Valor sujeito a confirmação' : 'Baseado na última tabela disponível';
  }
  /** connectivity banner + sync indicator (topic 10). Client mode never sees cache jargon. */
  function connectivityVM({ connectivity, sync, freshness, mode, loadOrigin }) {
    const client = mode === 'client';
    let banner = null;
    if (connectivity === 'OFFLINE') banner = { tone: 'warn', text: 'Você está offline. Alguns dados comerciais podem estar desatualizados.' };
    else if (connectivity === 'DEGRADED') banner = { tone: 'warn', text: 'Mapa disponível. Dados comerciais podem estar temporariamente desatualizados.' };
    else if (freshness && freshness.commercial === 'EXPIRED') banner = { tone: 'error', text: client ? 'Valores sujeitos a confirmação.' : 'A tabela de preços está vencida. Confirme os valores antes de negociar.' };
    let indicator = null;
    if (!client) {
      const st = sync && sync.state, last = sync && sync.lastSuccessfulSyncAt;
      if (connectivity === 'OFFLINE') indicator = { state: 'OFFLINE', text: 'Offline' + (last ? ` · sincronizado ${F.formatAge(last)}` : '') };
      else if (st === 'SYNCING') indicator = { state: 'SYNCING', text: 'Sincronizando…' };
      else if (st === 'SUCCESS' || st === 'PARTIAL') indicator = { state: st, text: (st === 'PARTIAL' ? 'Sincronizado em parte' : 'Sincronizado') + (last ? ' ' + F.formatAge(last) : '') };
      else if (st === 'ERROR') indicator = { state: 'ERROR', text: 'Não foi possível sincronizar' };
      else if (loadOrigin === 'CACHE') indicator = { state: 'IDLE', text: 'Dados salvos neste aparelho' };
    }
    return { banner, indicator };
  }
  /** level 1: tooltip (desktop hover), at most 4–5 lines */
  function tooltipVM(lot, ctx) {
    const lines = [`Q${lot.identity.blockId} · L${lot.identity.lotNumber}`, F.formatSquareMeters(lot.geometry.areaM2, 2), lot.commercial.price != null ? F.formatBRL(lot.commercial.price) : 'Preço não disponível', t('AvailabilityStatus', lot.availability.status)];
    const r = ctx.ranking && ctx.ranking.byId.get(lot.identity.id);
    if (r) lines.push(`${Math.round(r.relevance * 100)}% compatível`);
    return lines;
  }

  /** level 2: Quick View */
  /** level 2: Quick View — built by App.quickView (topic 20); this wrapper adapts the app context */
  function quickViewVM(lot, ctx) {
    const id = lot.identity.id;
    return App.quickView.build(lot, { dev: ctx.dev, cfg: ctx.cfg, mode: ctx.mode, presentation: !!ctx.presentation, objective: ctx.objective, prefs: ctx.prefs, favorites: ctx.favorites, compareIds: ctx.compareIds, view: ctx.view,
      filter: { active: !!ctx.filterActive, matchedIds: ctx.filteredIds || new Set([id]), query: ctx.filterQuery || null, ctx: ctx.filterCtx || {} }, fit: ctx.fitById ? ctx.fitById.get(id) || null : null,
      customer: ctx.customer || null, recommendation: ctx.recommendation || null, activeLayerId: ctx.activeLayerId || null, connectivity: ctx.connectivity, showRoute: ctx.showRoute, statusVM });
  }

  /** level 3: details, ten sections; fields grouped by Field Registry domain */
  const SECTION_FIELDS = {
    geometry: f => f.domain === 'GEOMETRY' && f.type !== 'geometry',
    location: f => f.domain === 'LOCATION',
    surroundings: f => f.domain === 'SURROUNDINGS',
    mobility: f => f.domain === 'MOBILITY' && f.type !== 'geometry',
    comfort: f => f.domain === 'ENVIRONMENTAL',
    construction: f => f.domain === 'CONSTRUCTION',
    commercial: f => f.domain === 'COMMERCIAL' || f.domain === 'AVAILABILITY',
    intelligence: f => f.domain === 'INTELLIGENCE' || f.key === 'intelligence.confidence',
    sources: f => f.domain === 'IDENTITY' || f.key === 'metadata.schemaVersion'
  };
  const SUMMARY_KEYS = ['geometry.areaM2', 'commercial.price', 'commercial.pricePerM2', 'availability.status', 'geometry.frontM', 'geometry.averageDepthM', 'location.blockPosition',
    'surroundings.rearNeighborType', 'environmental.orientationFront', 'environmental.northSunSide', 'environmental.noiseLevel', 'environmental.privacyLevel', 'mobility.estimatedTraffic',
    'mobility.routeDistanceToGateM', 'intelligence.class', 'intelligence.scores.housing'];
  const ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
  function detailsVM(lot, ctx) {
    const { cfg, mode, dev, priceTable } = ctx, client = mode === 'client', fctx = { dev, priceTable };
    const visible = f => !f.virtual && cfg.isFieldVisible(f.key, mode) && !(client && f.priority === 'P3');
    const rows = keys => keys.map(k => M.field(k)).filter(f => f && visible(f)).map(f => fieldVM(lot, f.key, fctx));
    const sections = cfg.detailSections.filter(s => !(client && (cfg.hiddenSections.client || []).includes(s.id))).map(s => {
      let fields;
      if (s.id === 'summary') fields = rows(SUMMARY_KEYS);
      else fields = M.FIELDS.filter(f => SECTION_FIELDS[s.id] && SECTION_FIELDS[s.id](f) && visible(f)).sort((a, b) => ORDER[a.priority] - ORDER[b.priority]).map(f => fieldVM(lot, f.key, fctx));
      const unavailable = fields.filter(x => !x.isAvailable).length;
      return { id: s.id, title: s.title, open: !!(ctx.openSections && ctx.openSections[s.id]), fields, unavailable,
        alerts: s.id === 'summary' || s.id === 'intelligence' ? lot.intelligence.alerts.filter(a => !client || ['CRITICAL', 'IMPORTANT'].includes(a.severity)).map(a => ({ ...a, typeLabel: t('AlertType', a.type), severityLabel: t('Severity', a.severity) })) : [] };
    });
    const used = new Set(); M.FIELDS.forEach(f => { const p = M.getFieldProvenance(lot, f.key); if (p.sourceId) used.add(p.sourceId); });
    return { summary: quickViewVM(lot, ctx), sections, sources: dev.sources.filter(s => used.has(s.id)), dataVersions: client ? null : lot.metadata.dataVersions };
  }

  /** comparison: primary block first, then the full grouped table. Status at the top of every column. */
  function comparisonVM(lots, ctx) {
    const { cfg, mode, objective, dev } = ctx, client = mode === 'client';
    const o = cfg.objectives[objective] || cfg.objectives[cfg.defaultObjective];
    const columns = lots.map(l => ({ id: l.identity.id, code: l.identity.code, title: F.formatLotTitle(l.identity.blockId, l.identity.lotNumber), short: `Q${l.identity.blockId} · L${l.identity.lotNumber}`,
      status: statusVM(l, mode), cls: client ? null : { code: l.intelligence.class, label: F.formatLotClass(l.intelligence.class), color: App.services.layers.CLASS[l.intelligence.class] } }));
    const row = (label, get, fmt, better, fieldKey) => ({ label, get, fmt, better, fieldKey });
    const crit = k => row(SC.NOTE_LABEL[k], l => M.criterion(l, k), v => v == null ? F.ND : `${F.formatNote(v)}/10`, 'max', M.CRITERIA_FIELDS[k]);
    const primaryRows = [
      row('Preço', l => l.commercial.price, F.formatBRL, 'min', 'commercial.price'),
      row('Área', l => l.geometry.areaM2, v => F.formatSquareMeters(v), 'max', 'geometry.areaM2'),
      ...(client ? [] : [row(`Score ${SC.SCORE_LABEL[o.score]}`, l => l.intelligence.scores[o.score], F.formatScore, 'max', 'intelligence.scores.' + o.score)]),
      ...(client ? [] : o.keyAttributes.slice(0, 5).map(crit))
    ];
    const groups = [
      { id: 'summary', title: 'Resumo', rows: [row('Preço por m²', l => l.commercial.pricePerM2, F.formatPricePerM2, 'min', 'commercial.pricePerM2'), row('Frente', l => l.geometry.frontM, v => F.formatMeters(v, 1), 'max', 'geometry.frontM'),
        row('Profundidade média', l => l.geometry.averageDepthM, v => F.formatMeters(v, 1), null, 'geometry.averageDepthM'), row('Formato', l => l.geometry.shape, v => t('LotShape', v), null, 'geometry.shape'),
        row('Posição na quadra', l => l.location.blockPosition, v => t('BlockPosition', v), null, 'location.blockPosition')] },
      { id: 'location', title: 'Localização', rows: [row('Portaria (percurso)', l => l.mobility.routeDistanceToGateM, F.formatMeters, 'min', 'mobility.routeDistanceToGateM'), row('Clube (percurso)', l => l.mobility.routeDistanceToLeisureM, F.formatMeters, 'min', 'mobility.routeDistanceToLeisureM'),
        row('Parque florestal', l => l.location.distanceToGreenAreaM, F.formatMeters, 'min', 'location.distanceToGreenAreaM'), row('Av. Porto Dourado', l => l.location.distanceToExternalRoadM, F.formatMeters, 'max', 'location.distanceToExternalRoadM'),
        row('Nos fundos', l => l.surroundings.rearNeighborType, v => t('NeighborType', v), null, 'surroundings.rearNeighborType'), row('Trânsito estimado', l => l.mobility.estimatedTraffic, v => F.formatLevel(v), null, 'mobility.estimatedTraffic')] },
      { id: 'comfort', title: 'Conforto', rows: [row('Frente voltada para', l => l.environmental.orientationFront, v => t('Direction', v), null, 'environmental.orientationFront'), row('Sol do norte', l => l.environmental.northSunSide, v => t('NorthSunSide', v), null, 'environmental.northSunSide'),
        row('Ruído provável', l => l.environmental.noiseLevel, v => F.formatLevel(v), null, 'environmental.noiseLevel'), row('Privacidade', l => l.environmental.privacyLevel, v => F.formatLevel(v, true), null, 'environmental.privacyLevel'),
        row('Vista', l => l.surroundings.viewDetail, v => t('ViewDetail', v), null, 'surroundings.viewDetail')] },
      { id: 'commercial', title: 'Comercial', rows: [row('Disponibilidade', l => l.availability.status, v => t('AvailabilityStatus', v), null, 'availability.status'), row('Entrada padrão', l => l.commercial.downPaymentDefaultValue, F.formatBRL, 'min', 'commercial.downPaymentDefaultValue')] },
      ...(client ? [] : [{ id: 'intelligence', title: 'Inteligência', rows: [...['housing', 'investment', 'family', 'premium'].map(k => row(`Score ${SC.SCORE_LABEL[k]}`, l => l.intelligence.scores[k], F.formatScore, 'max', 'intelligence.scores.' + k)),
        row('Classe', l => l.intelligence.class, v => F.formatLotClass(v), null, 'intelligence.class'), row('Alertas', l => l.intelligence.alerts.length, v => v === 0 ? 'Nenhum' : String(v), 'min', 'intelligence.alerts')] }]),
      { id: 'technical', title: 'Técnico', rows: [row('Fundos (largura)', l => l.geometry.rearM, v => F.formatMeters(v, 1), null, 'geometry.rearM'), row('Lateral esquerda', l => l.geometry.leftDepthM, v => F.formatMeters(v, 1), null, 'geometry.leftDepthM'),
        row('Lateral direita', l => l.geometry.rightDepthM, v => F.formatMeters(v, 1), null, 'geometry.rightDepthM'), row('Topografia', l => l.construction.topography, v => v == null ? F.ND : t('TopographyType', v), null, 'construction.topography')] }
    ];
    const cmp = rs => App.services.comparison.compare(lots, rs).map(r => ({ label: r.label, fieldKey: r.fieldKey, cells: r.values.map((v, i) => ({ text: v == null ? F.ND : r.fmt(v), win: r.winners.includes(i) })) }));
    const winners = client ? [] : App.services.comparison.leaders(lots, o.keyAttributes.slice(0, 5).map(k => ({ label: SC.NOTE_LABEL[k], get: l => M.criterion(l, k) }))).map(w => ({ label: w.label, lot: columns[w.index].short }));
    return { columns, primary: cmp(primaryRows), groups: groups.map(g => ({ id: g.id, title: g.title, rows: cmp(g.rows) })), winners };
  }

  /** simulation, progressive: price, down payment, plan, installment first; full flow on demand */
  function simulationVM(lot, ctx) {
    const { simulation, priceTable, dev } = ctx, elig = AV.simulationEligibility(lot.availability.status, AV.policyOf(dev));
    const plans = priceTable ? priceTable.plans.filter(p => lot.commercial.availablePlans.includes(p.id)) : [];
    const sim = App.services.finance.simulate({ price: lot.commercial.price, downPaymentPct: simulation.downPaymentPct, plans });
    if (!sim) return { available: false, eligibility: elig, message: 'Preço não disponível para este lote: a simulação depende da tabela comercial.' };
    const sel = sim.plans.find(p => p.id === simulation.planId) || sim.plans[0];
    return {
      available: true, eligibility: elig, price: F.formatBRL(sim.price), downPaymentPct: simulation.downPaymentPct, downPayment: F.formatBRL(sim.downPayment), financed: F.formatBRL(sim.financed),
      tableLabel: `${priceTable.name} · versão ${F.formatDate(priceTable.version)}`, tableNote: priceNote(lot, ctx.mode) && priceNote(lot, ctx.mode) !== 'Preço não disponível' ? 'Baseado na última tabela disponível.' : null,
      plans: sim.plans.map(p => ({ id: p.id, name: p.name, desc: p.desc, selected: p.id === sel.id,
        main: `${p.main.count}x de ${F.formatBRL(p.main.value, true)}`, annual: p.annual ? `+ ${p.annualCount} anuais de ${F.formatBRL(p.annual, true)}` : null, total: F.formatBRL(p.total) })),
      selected: sel, sim, yearly: App.services.finance.yearly(sel)
    };
  }

  /** share text: never claims "disponível" unless the status is AVAILABLE and fresh */
  function shareVM(lots, ctx) {
    const { dev, customerName, mode } = ctx;
    const warnings = [];
    const entries = lots.map(l => {
      const st = l.availability.status, fresh = l.availability.freshness === 'FRESH', priceFresh = !l.metadata.freshness || l.metadata.freshness.commercial === 'FRESH';
      const statusLine = st === 'AVAILABLE' && fresh ? 'Disponível' : st === 'UNKNOWN' || !fresh ? 'Disponibilidade sujeita a confirmação' : t('AvailabilityStatus', st);
      if (st === 'UNKNOWN' || !fresh) warnings.push(`${l.identity.code}: status ${st === 'UNKNOWN' ? 'não confirmado' : 'pode estar desatualizado'}`);
      else if (!AV.isOfferable(st)) warnings.push(`${l.identity.code}: ${t('AvailabilityStatus', st).toLowerCase()}, não é uma oportunidade disponível`);
      if (!priceFresh && l.commercial.price != null) warnings.push(`${l.identity.code}: preço baseado na última tabela disponível`);
      const lines = [`Preço: ${l.commercial.price != null ? F.formatBRL(l.commercial.price) + (priceFresh ? '' : ' (sujeito a confirmação)') : 'não disponível'}`, statusLine,
        `Sol do norte: ${t('NorthSunSide', l.environmental.northSunSide).split(':')[0].split(';')[0].toLowerCase()}`, `Ruído provável (estimativa): ${F.formatLevel(l.environmental.noiseLevel).toLowerCase()}`];
      if (mode !== 'client') lines.push(`Score Moradia ${F.formatScore(l.intelligence.scores.housing)} · classe ${F.formatLotClass(l.intelligence.class)}`);
      return { title: F.formatLotTitle(l.identity.blockId, l.identity.lotNumber), areaLabel: F.formatSquareMeters(l.geometry.areaM2), lines };
    });
    const text = App.services.share.lotsSummary({ devName: dev.name, customerName, entries });
    return { text, warnings, whatsapp: App.services.share.whatsappUrl(text) };
  }

  /** glossary: what each visible field means (from the registry) */
  const glossary = keys => keys.map(k => M.field(k)).filter(Boolean).map(f => ({ key: f.key, label: f.label, meaning: f.meaning, status: t('DataStatus', f.status) }));
  return { formatField, fieldVM, statusVM, priceNote, connectivityVM, tooltipVM, quickViewVM, detailsVM, comparisonVM, simulationVM, shareVM, glossary };
})();
