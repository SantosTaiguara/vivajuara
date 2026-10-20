/* presentation/panels.js — left panel (Encontrar) and right panel (lot: Quick View, details, simulation, sun).
   Views receive ViewModels and return markup; every control carries data-act / data-f / data-in and the
   app handles events in one place. Nothing here reads storage or the network. */
App.panels = (() => {
  const { esc, icon, attr } = App.ui, F = App.fmt, t = App.i18n.t, AV = App.availability, FL = App.services.filtering;
  const WEIGHTS = [[0, 'Não importa'], [1, 'Pouco'], [2, 'Importante'], [3, 'Essencial']];
  const PREF_KEYS = ['quiet', 'privacy', 'solar', 'view', 'leisure', 'gate', 'lowTraffic', 'geometry', 'priceQuality', 'green', 'area'];
  const PRICE_STEPS = [300000, 350000, 400000, 450000, 500000, 600000, 700000, 800000];
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const statusDot = c => `<i style="background:${c}"></i>`;

  // ================================================================ Encontrar
  // Filters (topic 17) narrow what the map highlights; the customer profile (topics 14–15) drives the recommendation.
  // They are independent: filters only reach the recommendation through the explicit "usar filtros" action.
  const LV = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  const FILTER_LABEL = { statuses: 'Situação', onlyOfferable: 'Somente disponíveis', block: 'Quadra', price: 'Preço', area: 'Área', classMin: 'Classe mínima', noCorner: 'Sem esquina', shapes: 'Formato',
    greenBehind: 'Mata nos fundos', rearOrientation: 'Fundos para', noiseMax: 'Ruído até', privacyMin: 'Privacidade mínima', trafficMax: 'Trânsito até', gateMaxM: 'Portaria até', clubMaxM: 'Clube até',
    noNoiseAlert: 'Sem alerta de ruído', favoritesOnly: 'Só favoritos', scoreMin: 'Score mínimo', alertsExclude: 'Sem alertas', fitMin: 'Compatibilidade mínima', dataStatus: 'Qualidade do dado',
    q: 'Busca', pricePerM2: 'Preço por m²', frontage: 'Frente', depth: 'Profundidade', fitCoverageMin: 'Perfil avaliado', fitConfidenceMin: 'Confiança do perfil', freshness: 'Atualização' };
  const FRESH_LABEL = { FRESH: 'Atualizado', STALE: 'Último valor conhecido', EXPIRED: 'Vencido', UNKNOWN: 'Sem data' };
  const NI = 'não informado';
  /** filters that have a customer-requirement counterpart (used only by the explicit "Salvar como exigência do cliente" action) */
  const FL_TO_CONS = f => { const c = {}; if (f.priceMax != null) c.budgetMax = f.priceMax; if (f.areaMin != null) c.areaMin = f.areaMin; if (f.areaMax != null) c.areaMax = f.areaMax; if (f.noCorner) c.noCorner = true; if (f.greenBehind) c.greenRear = true; return c; };
  const range = (v, f) => `${v.min != null ? f(v.min) : '…'} a ${v.max != null ? f(v.max) : '…'}`;
  const WARN = { STALE_PRICE: 'Preços sem confirmação nesta sessão: o filtro usa o último valor conhecido.', STALE_AVAILABILITY: 'Disponibilidade sem confirmação nesta sessão.', ESTIMATED_FIELD: 'Ruído, privacidade e trânsito são estimativas.', FIT_UNAVAILABLE: 'Compatibilidade mínima exige um perfil de cliente.' };
  function chipText(c) { const base = chipText0(c); return c.includeUnknown ? `${base} ou ${NI}` : base; }
  function chipText0(c) {
    const v = c.value, L = FILTER_LABEL[c.filterId] || c.filterId;
    if (v === 'UNKNOWN') return `${L.replace(/ (até|mínima)$/, '')}: ${NI}`;
    switch (c.filterId) {
      case 'q': return `${L}: ${v}`;
      case 'pricePerM2': return `${L}: ${range(v, x => F.formatPricePerM2(x))}`;
      case 'frontage': case 'depth': return `${L}: ${range(v, x => F.formatMeters(x, 0))}`;
      case 'fitCoverageMin': case 'fitConfidenceMin': return `${L} ≥ ${v}%`;
      case 'freshness': return `${L}: ${v.map(k => FRESH_LABEL[k] || k).join(', ')}`;
      case 'statuses': return `${L}: ${v.map(k => t('AvailabilityStatus', k)).join(', ')}`;
      case 'price': return `${L}: ${v.min != null ? F.formatBRLShort(v.min) : '…'} a ${v.max != null ? F.formatBRLShort(v.max) : '…'}`;
      case 'area': return `${L}: ${v.min != null ? F.number(v.min) : '…'} a ${v.max != null ? F.formatSquareMeters(v.max, 0) : '…'}`;
      case 'block': return `Quadra ${v}`;
      case 'classMin': return `${L}: ${v === 'A_PLUS' ? 'A+' : v}`;
      case 'shapes': return `${L}: ${v.map(k => k === 'UNKNOWN' ? NI : t('LotShape', k)).join(', ')}`;
      case 'rearOrientation': return `${L}: ${v.join(', ')}`;
      case 'noiseMax': case 'trafficMax': case 'privacyMin': return `${L} ${F.formatLevel(v, c.filterId === 'privacyMin').toLowerCase()}`;
      case 'gateMaxM': case 'clubMaxM': return `${L} ${F.formatMeters(v)}`;
      case 'scoreMin': return `Score ${App.services.scoring.SCORE_LABEL[v.key]} ≥ ${v.min}`;
      case 'alertsExclude': return `${L}: ${v.map(k => t('AlertType', k)).join(', ')}`;
      case 'fitMin': return `${L} ${v}%`;
      case 'dataStatus': return `${L}: ${v.statuses.map(k => t('DataStatusShort', k)).join(', ')}`;
      default: return L;
    }
  }
  const chipsFor = (key, options, cur, labelOf, facet) => `<div class="chips" role="group">${options.map(o => `<button class="chip" data-act="fmToggle" data-k="${key}" data-v="${esc(o)}" aria-pressed="${cur.includes(o)}">${esc(labelOf(o))}${facet && facet[o] != null ? ` <span class="count">${F.number(facet[o])}</span>` : ''}</button>`).join('')}</div>`;
  function find(st, x) {
    const { sel, repo, mode } = x, client = mode === 'client', FXs = App.filters;
    const f = { ...FL.EMPTY, ...st.activeFilters }, lots = sel.selectLots(st), fr = sel.selectFilterResult(st), ids = fr.matchedIds, q = sel.selectFilterQuery(st);
    const active = q.query.conditions.length > 0, hasFeed = sel.selectHasAvailabilityFeed(st);
    const facets = FXs.facets(lots, q.query, { policy: sel.policy, favorites: new Set(st.favorites), fit: sel.selectFit(st) });
    const blocks = repo.getBlocks(), lv = st.filterLevels || {};
    let h = `<div class="ph"><h2>Encontrar</h2><button class="btn sm x drawer-only" data-act="closeFind" aria-label="Fechar">${icon('close')}</button></div><div class="pb">`;
    h += `<div class="rescount" aria-live="polite"><b>${F.number(ids.size)}</b><span class="muted">de ${F.number(lots.length)} lotes ${active ? 'nos filtros' : ''}</span>${active ? '<button class="lbtn" data-act="clearAll">Limpar filtros</button>' : ''}</div>`;
    if (active) h += `<div class="fchips" aria-label="Filtros ativos">${q.query.conditions.map(c => `<button class="fchip" data-act="fchip" data-id="${c.filterId}" aria-label="Remover filtro ${esc(chipText(c))}">${esc(chipText(c))} <span aria-hidden="true">×</span></button>`).join('')}</div>`;
    for (const w of [...new Set(fr.warnings.map(w => w.code))]) if (WARN[w] && !(client && w === 'ESTIMATED_FIELD')) h += `<p class="small warnl">${esc(WARN[w])}</p>`;
    if (q.errors.length && !client) h += `<p class="small warnl">${q.errors.length} filtro(s) inválido(s) foram ignorados.</p>`;
    // filters that could not be applied are shown as such in every mode (never silently dropped)
    const dropped = q.query.dropped || [];
    if (dropped.length) h += `<div class="fchips" aria-label="Filtros não aplicados">${dropped.map(d => `<button class="fchip off" data-act="fchip" data-id="${esc(d.filterId)}" aria-label="Remover filtro não aplicado ${esc(FILTER_LABEL[d.filterId] || d.filterId)}">${esc(FILTER_LABEL[d.filterId] || d.filterId)} · ${d.applied === 'PARTIAL' ? 'aplicado em parte' : client ? 'não aplicado' : d.code === 'HIDDEN_IN_MODE' ? 'não aplicado neste modo' : 'não aplicado'} <span aria-hidden="true">×</span></button>`).join('')}</div>`;
    // zero results: say which filter is blocking and what removing it would give (suggestions only; nothing is relaxed automatically)
    const dg = fr.diagnostics;
    if (active && dg && dg.zeroResult) {
      const cond = id => q.query.conditions.find(c => c.filterId === id);
      h += `<div class="zr" role="status"><p><b>Nenhum lote atende a todos os filtros juntos.</b></p>`;
      if (dg.suggestions.length) h += `<p class="small">Para ver lotes, tire um filtro:</p><div class="zrs">${dg.suggestions.slice(0, 3).map(sg => { const c = cond(sg.filterId); return `<button class="btn sm" data-act="fchip" data-id="${esc(sg.filterId)}" data-sugg="1">Sem “${esc(c ? chipText(c) : FILTER_LABEL[sg.filterId] || sg.filterId)}” → ${F.number(sg.resultCount)} ${sg.resultCount === 1 ? 'lote' : 'lotes'}</button>`; }).join('')}</div>`;
      else h += `<p class="small">Nenhum filtro sozinho resolve; tire mais de um ou use Limpar filtros.</p>`;
      if (!client) { const blk = dg.impacts.filter(i => i.uniqueRejectedCount).map(i => FILTER_LABEL[i.filterId] || i.filterId); if (blk.length) h += `<p class="small">Mais restritivo: ${esc(blk.join(', '))}.</p>`; }
      h += `</div>`;
    }
    // filters → customer requirements: only by explicit action (never automatic)
    if (!client && active) { const tc = FL_TO_CONS(st.activeFilters); if (Object.keys(tc).length) h += `<button class="lbtn small" data-act="filtersToConstraints">Salvar como exigência do cliente</button>`; }
    // ---- QUICK
    h += `<div class="fld"><label for="fQ">Código do lote ou quadra</label><input id="fQ" type="search" data-f="q" value="${esc(f.q ?? '')}" placeholder="Ex.: B7, quadra C" autocomplete="off"></div>`;
    h += `<section class="sec"><h3>Disponibilidade</h3><div class="chips" role="group" aria-label="Status comercial">`;
    for (const k of App.enums.AVAILABILITY_ORDER) {
      const n = (facets.statuses || {})[k] || 0; if (!n && !f.statuses.includes(k)) continue;
      h += `<button class="chip st" data-act="status" data-s="${k}" aria-pressed="${f.statuses.includes(k)}">${statusDot(App.services.layers.STATUS[k])}${esc(t('AvailabilityStatus', k))} <span class="count">${F.number(n)}</span></button>`;
    }
    h += `</div><label class="chk"><input type="checkbox" data-f="onlyOfferable"${f.onlyOfferable ? ' checked' : ''}> Somente disponíveis</label>`;
    if (!hasFeed) h += `<p class="small">Sem espelho de vendas: nenhum lote tem status confirmado ainda. "Somente disponíveis" vai mostrar zero lotes até a loteadora enviar o espelho.</p>`;
    h += `</section>`;
    const pmin = f.priceMin, pmax = f.priceMax, steps = [...new Set([...PRICE_STEPS, ...[pmin, pmax].filter(v => v != null)])].sort((a, b) => a - b);
    h += `<section class="sec"><h3>Preço, área e quadra</h3><div class="fgrid">
      <div class="fld"><label for="fPmin">Preço mínimo</label><select id="fPmin" data-f="priceMin">${opt('', 'Qualquer', pmin ?? '')}${steps.map(v => opt(v, F.formatBRLShort(v), pmin)).join('')}</select></div>
      <div class="fld"><label for="fPmax">Preço máximo</label><select id="fPmax" data-f="priceMax">${opt('', 'Qualquer', pmax ?? '')}${steps.map(v => opt(v, F.formatBRLShort(v), pmax)).join('')}</select></div>
      <div class="fld"><label for="fAmin">Área mínima (m²)</label><input id="fAmin" type="number" inputmode="numeric" min="0" step="10" data-f="areaMin" value="${esc(f.areaMin ?? '')}" placeholder="250"></div>
      <div class="fld"><label for="fAmax">Área máxima (m²)</label><input id="fAmax" type="number" inputmode="numeric" min="0" step="10" data-f="areaMax" value="${esc(f.areaMax ?? '')}" placeholder="700"></div>
      <div class="fld"><label for="fBlk">Quadra</label><select id="fBlk" data-f="block">${opt('', 'Todas', f.block ?? '')}${blocks.map(b => opt(b, 'Quadra ' + b + ((facets.block || {})[b] != null ? ` (${(facets.block || {})[b]})` : ''), f.block)).join('')}</select></div>
      ${client ? '' : `<div class="fld"><label for="fCls">Classe mínima</label><select id="fCls" data-f="classMin">${opt('', 'Qualquer', f.classMin ?? '')}${['A_PLUS', 'A', 'B', 'C'].map(k => opt(k, k === 'A_PLUS' ? 'A+' : k + ' ou melhor', f.classMin)).join('')}</select></div>`}
    </div><label class="chk"><input type="checkbox" data-f="noCorner"${f.noCorner ? ' checked' : ''}> Sem esquina</label></section>`;
    // ---- ADVANCED
    h += `<section class="sec"><button class="lvl" data-act="flevel" data-l="ADVANCED" aria-expanded="${!!lv.ADVANCED}">Mais filtros ${lv.ADVANCED ? '▴' : '▾'}</button>`;
    if (lv.ADVANCED) {
      h += `<div class="fld"><label>Formato</label>${chipsFor('shapes', ['RECTANGULAR', 'SQUARE', 'TRAPEZOIDAL', 'IRREGULAR', 'UNKNOWN'], f.shapes, k => k === 'UNKNOWN' ? 'Não informado' : t('LotShape', k), facets.shapes)}</div>
      <div class="fgrid">
        <div class="fld"><label for="fPm2a">Preço por m² mínimo</label><input id="fPm2a" type="number" inputmode="numeric" min="0" step="50" data-f="pricePerM2Min" value="${esc(f.pricePerM2Min ?? '')}"></div>
        <div class="fld"><label for="fPm2b">Preço por m² máximo</label><input id="fPm2b" type="number" inputmode="numeric" min="0" step="50" data-f="pricePerM2Max" value="${esc(f.pricePerM2Max ?? '')}"></div>
        <div class="fld"><label for="fFra">Frente mínima (m)</label><input id="fFra" type="number" inputmode="decimal" min="0" step="1" data-f="frontMin" value="${esc(f.frontMin ?? '')}"></div>
        <div class="fld"><label for="fFrb">Frente máxima (m)</label><input id="fFrb" type="number" inputmode="decimal" min="0" step="1" data-f="frontMax" value="${esc(f.frontMax ?? '')}"></div>
        <div class="fld"><label for="fDpa">Profundidade mínima (m)</label><input id="fDpa" type="number" inputmode="decimal" min="0" step="1" data-f="depthMin" value="${esc(f.depthMin ?? '')}"></div>
        <div class="fld"><label for="fDpb">Profundidade máxima (m)</label><input id="fDpb" type="number" inputmode="decimal" min="0" step="1" data-f="depthMax" value="${esc(f.depthMax ?? '')}"></div>
      </div>
      <div class="fld"><label>Fundos voltados para</label>${chipsFor('rearOrientation', ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], f.rearOrientation, k => ({ N: 'N', NE: 'NE', E: 'L', SE: 'SE', S: 'S', SW: 'SO', W: 'O', NW: 'NO' })[k], facets.rearOrientation)}</div>
      <div class="fgrid">
        <div class="fld"><label for="fNz">Ruído (estimativa)</label><select id="fNz" data-f="noiseMax">${opt('', 'Qualquer', f.noiseMax ?? '')}${LV.slice(0, 3).map(k => opt(k, 'Até ' + F.formatLevel(k).toLowerCase(), f.noiseMax)).join('')}${opt('UNKNOWN', 'Só não informados', f.noiseMax)}</select></div>
        <div class="fld"><label for="fPv">Privacidade (estimativa)</label><select id="fPv" data-f="privacyMin">${opt('', 'Qualquer', f.privacyMin ?? '')}${LV.slice(2).map(k => opt(k, F.formatLevel(k, true) + ' ou mais', f.privacyMin)).join('')}${opt('UNKNOWN', 'Só não informados', f.privacyMin)}</select></div>
        <div class="fld"><label for="fTr">Trânsito (estimativa)</label><select id="fTr" data-f="trafficMax">${opt('', 'Qualquer', f.trafficMax ?? '')}${LV.slice(0, 3).map(k => opt(k, 'Até ' + F.formatLevel(k).toLowerCase(), f.trafficMax)).join('')}${opt('UNKNOWN', 'Só não informados', f.trafficMax)}</select></div>
        <div class="fld"><label for="fGm">Portaria (de carro)</label><select id="fGm" data-f="gateMaxM">${opt('', 'Qualquer', f.gateMaxM ?? '')}${[200, 400, 650].map(v => opt(v, 'Até ' + v + ' m', f.gateMaxM)).join('')}</select></div>
        <div class="fld"><label for="fCm">Clube (de carro)</label><select id="fCm" data-f="clubMaxM">${opt('', 'Qualquer', f.clubMaxM ?? '')}${[250, 500, 750].map(v => opt(v, 'Até ' + v + ' m', f.clubMaxM)).join('')}</select></div>
      </div>
      ${['noiseMax', 'privacyMin', 'trafficMax'].filter(k => f[k] && f[k] !== 'UNKNOWN').map(k => `<label class="chk"><input type="checkbox" data-act="incUnknown" data-id="${k}"${(f.includeUnknown || []).includes(k) ? ' checked' : ''}> ${esc(FILTER_LABEL[k].replace(/ (até|mínima)$/, ''))}: incluir lotes ${NI}s</label>`).join('')}
      <label class="chk"><input type="checkbox" data-f="greenBehind"${f.greenBehind ? ' checked' : ''}> Mata ou parque nos fundos</label>
      <label class="chk"><input type="checkbox" data-f="noNoiseAlert"${f.noNoiseAlert ? ' checked' : ''}> Sem alerta de ruído</label>
      <label class="chk"><input type="checkbox" data-f="favoritesOnly"${f.favoritesOnly ? ' checked' : ''}> Só favoritos (${st.favorites.length})</label>`;
    }
    h += `</section>`;
    // ---- TECHNICAL (broker)
    if (!client) {
      h += `<section class="sec"><button class="lvl" data-act="flevel" data-l="TECHNICAL" aria-expanded="${!!lv.TECHNICAL}">Filtros técnicos ${lv.TECHNICAL ? '▴' : '▾'}</button>`;
      if (lv.TECHNICAL) {
        h += `<div class="fgrid">
          <div class="fld"><label for="fSk">Score</label><select id="fSk" data-f="scoreKey">${['overall', 'housing', 'investment', 'family', 'premium'].map(k => opt(k, App.services.scoring.SCORE_LABEL[k], f.scoreKey || 'overall')).join('')}</select></div>
          <div class="fld"><label for="fSm">Score mínimo</label><select id="fSm" data-f="scoreMin">${opt('', 'Qualquer', f.scoreMin ?? '')}${[60, 70, 80, 88].map(v => opt(v, v + ' ou mais', f.scoreMin)).join('')}</select></div>
          <div class="fld"><label for="fFt">Compatibilidade mínima</label><select id="fFt" data-f="fitMin"${sel.selectFit(st) ? '' : ' disabled title="Defina o perfil do cliente"'}>${opt('', 'Qualquer', f.fitMin ?? '')}${[50, 60, 70, 80].map(v => opt(v, v + '% ou mais', f.fitMin)).join('')}</select></div>
          <div class="fld"><label for="fDs">Qualidade do dado</label><select id="fDs" data-f="dataStatusField">${opt('', 'Escolha um campo', f.dataStatusField ?? '')}${['environmental.noiseLevel', 'environmental.privacyLevel', 'mobility.estimatedTraffic', 'geometry.areaM2', 'commercial.price'].map(k => opt(k, (App.model.field(k) || {}).label || k, f.dataStatusField)).join('')}</select></div>
          <div class="fld"><label for="fFc">Perfil avaliado mínimo</label><select id="fFc" data-f="fitCoverageMin"${sel.selectFit(st) ? '' : ' disabled title="Defina o perfil do cliente"'}>${opt('', 'Qualquer', f.fitCoverageMin ?? '')}${[50, 70, 90].map(v => opt(v, v + '% ou mais', f.fitCoverageMin)).join('')}</select></div>
          <div class="fld"><label for="fFq">Confiança mínima</label><select id="fFq" data-f="fitConfidenceMin"${sel.selectFit(st) ? '' : ' disabled title="Defina o perfil do cliente"'}>${opt('', 'Qualquer', f.fitConfidenceMin ?? '')}${[50, 70, 90].map(v => opt(v, v + '% ou mais', f.fitConfidenceMin)).join('')}</select></div>
        </div><div class="fld"><label>Atualização do dado comercial</label>${chipsFor('freshness', ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN'], f.freshness || [], k => FRESH_LABEL[k], facets.freshness)}</div>${f.dataStatusField ? `<div class="fld"><label>Com origem</label>${chipsFor('dataStatus', ['CONFIRMED', 'CALCULATED', 'ESTIMATED', 'TO_CONFIRM', 'UNKNOWN'], f.dataStatus, k => t('DataStatusShort', k))}</div>` : ''}
        <div class="fld"><label>Sem estes alertas</label>${chipsFor('alertsExclude', Object.keys(App.rules.ALERTS).filter(k => k !== 'OTHER'), f.alertsExclude, k => t('AlertType', k))}</div>`;
      }
      h += `</section>`;
    }
    h += profileSection(st, x) + recommendationSection(st, x, active, ids);
    h += `<div class="seeres drawer-only"><button class="btn pri wide" data-act="closeFind">${ids.size || !active ? `Ver ${F.number(ids.size)} ${ids.size === 1 ? 'lote' : 'lotes'} no mapa` : 'Voltar ao mapa'}</button></div>`;
    return h + `</div>`;
  }
  /** customer profile: preferences (soft) and constraints (hard). No personal data. */
  function profileSection(st, x) {
    const client = x.mode === 'client', c = st.constraints || {}, REC = App.services.recommendation, has = REC.isActive(st.preferences) || Object.keys(c).length;
    let h = `<section class="sec"><h3>O que o cliente procura</h3><div class="chips">${REC.PRESETS.map(p => `<button class="chip" data-act="preset" data-id="${p.id}" aria-pressed="${st.activePreset === p.id}">${esc(p.label)}</button>`).join('')}</div>
      <details class="prefs"${REC.isActive(st.preferences) ? ' open' : ''}><summary>Ajustar prioridades</summary><div class="preflist">${PREF_KEYS.map(k => {
        const w = st.preferences[k] || 0; return `<div class="pref"><label for="pf-${k}">${esc(REC.CRITERIA[k].label)}</label><select id="pf-${k}" data-pref="${k}" class="${w ? 'on' : ''}">${WEIGHTS.map(([v, l]) => opt(v, l, w)).join('')}</select></div>`; }).join('')}</div></details>
      <details class="prefs"${Object.keys(c).length ? ' open' : ''}><summary>Exigências (eliminatórias)</summary><div class="fgrid">
        <div class="fld"><label for="cBud">Orçamento máximo</label><select id="cBud" data-cons="budgetMax">${opt('', 'Sem limite', c.budgetMax ?? '')}${PRICE_STEPS.map(v => opt(v, F.formatBRLShort(v), c.budgetMax)).join('')}</select></div>
        <div class="fld"><label for="cAmin">Área mínima (m²)</label><input id="cAmin" type="number" inputmode="numeric" min="0" step="10" data-cons="areaMin" value="${esc(c.areaMin ?? '')}"></div>
        <div class="fld"><label for="cAmax">Área máxima (m²)</label><input id="cAmax" type="number" inputmode="numeric" min="0" step="10" data-cons="areaMax" value="${esc(c.areaMax ?? '')}"></div>
      </div><label class="chk"><input type="checkbox" data-cons="noCorner"${c.noCorner ? ' checked' : ''}> Não aceita esquina</label><label class="chk"><input type="checkbox" data-cons="greenRear"${c.greenRear ? ' checked' : ''}> Exige mata ou parque nos fundos</label>
      <p class="small">Exigências eliminam lotes da recomendação; prioridades só ordenam. Nada aqui altera os filtros do mapa.</p></details>
      ${has ? '<button class="lbtn" data-act="clearProfile">Limpar perfil</button>' : ''}</section>`;
    return h;
  }
  const TIER_TITLE = { PRIMARY: 'Melhores opções', STRONG_MATCH: 'Forte aderência', ALTERNATIVE: 'Alternativas' };
  const EXCL = { SOLD: 'vendidos', RESERVED: 'reservados', BLOCKED: 'bloqueados', IN_PROPOSAL: 'em proposta', STATUS_NOT_AVAILABLE: 'indisponíveis', PRICE_ABOVE_MAX: 'acima do orçamento', AREA_BELOW_MIN: 'abaixo da área mínima', AREA_ABOVE_MAX: 'acima da área máxima', CORNER_LOT: 'de esquina', REQUIRED_FEATURE_MISSING: 'sem a característica exigida', LOW_FIT: 'com compatibilidade baixa', LOW_COVERAGE: 'com poucos dados para o perfil', UNKNOWN_AREA: 'sem área' };
  function recommendationSection(st, x, filterActive, ids) {
    const { sel, repo } = x, client = x.mode === 'client', rec = sel.selectRecommendation(st);
    // topic 56: decision panel (broker) or client-safe selection (client), above the list; '' without a profile and without a customer
    const dh = x.decisionHtml ? x.decisionHtml() : '';
    if (!rec) return `<section class="sec"><h3>Recomendação</h3>${dh}<p class="small">Escolha um perfil ou ajuste as prioridades para ver os lotes mais compatíveis. Os filtros acima só destacam lotes no mapa.</p></section>`;
    let h = `<section class="sec"><h3>Recomendação</h3>${dh}${dh ? '<h4 class="dcs-listh">Lista completa da recomendação</h4>' : ''}`;
    if (filterActive || st.recScope) h += `<button class="btn sm${st.recScope ? ' on' : ''}" data-act="recScope" aria-pressed="${!!st.recScope}">${st.recScope ? `Usando ${F.number(st.recScope.lotIds.length)} lotes do filtro · voltar a todos` : `Usar os ${F.number(ids.size)} lotes do filtro na recomendação`}</button>`;
    const RC = App.reasonCodes, mode = x.mode;
    const reviewText = it => it.primaryReviewReason && RC ? RC.label(it.primaryReviewReason, client ? 'client' : 'broker') : null;
    const row = (it, i) => { const l = repo.getLotById(it.lotId); if (!l) return ''; const rv = reviewText(it); return `<div class="recrow" role="listitem"><button class="recmain" data-act="goLot" data-id="${it.lotId}" aria-current="${st.currentLotId === it.lotId}"><span class="rk">${it.rank}º</span><span><span class="nm">${esc(l.identity.displayCode)}</span><span class="sub">${F.formatSquareMeters(l.geometry.areaM2, 0)} · ${F.formatBRLShort(l.commercial.price)} · ${esc(rv && it.primaryReviewReason !== 'AVAILABILITY_UNKNOWN' ? rv.replace(/\.$/, '') : t('AvailabilityStatus', l.availability.status))}</span></span><span class="rel">${it.fitScore == null ? '—' : Math.round(it.fitScore) + '%'}</span></button><button class="lbtn small" data-act="explain" data-id="${it.lotId}" aria-label="Por que ${esc(l.identity.displayCode)} está nesta posição">Por quê?</button></div>`; };
    if (rec.status === 'INVALID_PROFILE') h += `<p class="small warnl">Perfil inválido: revise as exigências (por exemplo, área mínima maior que a máxima).</p>`;
    for (const c of (rec.conflicts || [])) h += `<p class="small warnl">${esc(c.message || (RC && RC.label(c.code, client ? 'client' : 'broker')) || 'Exigência difícil de atender com os lotes atuais.')} Nenhuma exigência é afrouxada automaticamente.</p>`;
    if (rec.recommendations.length) for (const tier of ['PRIMARY', 'STRONG_MATCH', 'ALTERNATIVE']) {
      const items = rec.recommendations.filter(r => r.tier === tier); if (!items.length) continue;
      h += `<h4>${TIER_TITLE[tier]}</h4><div class="res" role="list">${items.map(row).join('')}</div>`;
    } else if (rec.status === 'NO_STRONG_RECOMMENDATION' || rec.status === 'NO_ELIGIBLE_LOTS') h += `<p class="small">${rec.reviewTotal ? 'Nenhum lote com disponibilidade confirmada atende ao perfil agora.' : 'Nenhum lote atende às exigências.'}</p>`;
    if (rec.reviewCandidates.length) {
      const list = st.recShowAll ? rec.reviewCandidates : rec.reviewCandidates.slice(0, 8);
      h += `<h4>Para revisar <span class="small">· status a confirmar com a loteadora</span></h4><div class="res" role="list">${list.map(row).join('')}</div>`;
      if (rec.reviewCandidates.length > 8) h += `<button class="lbtn" data-act="recShowReview">${st.recShowAll ? 'Mostrar menos' : `Mostrar ${rec.reviewCandidates.length} para revisar`}</button>`;
      if (rec.reviewTotal > rec.reviewCandidates.length) h += `<p class="small">${F.number(rec.reviewTotal)} lotes precisam de confirmação; mostrando os ${rec.reviewCandidates.length} mais compatíveis.</p>`;
      const byCat = (rec.reviewSummary || {}).byCategory || {}; const cats = Object.entries(byCat).filter(([, n]) => n);
      if (!client && cats.length > 1) h += `<p class="small">Motivos da revisão: ${cats.map(([k, n]) => `${F.number(n)} ${({ AVAILABILITY: 'por disponibilidade', COMMERCIAL_DATA: 'por dado comercial', CONSTRAINT_DATA: 'por dado de exigência', FIT_DATA: 'por dado do perfil' })[k] || k.toLowerCase()}`).join(', ')}.</p>`;
    }
    const ex = Object.entries(rec.exclusionSummary || {}).filter(([, n]) => n);
    if (ex.length && !client) h += `<p class="small">Fora da recomendação: ${ex.map(([k, n]) => `${F.number(n)} ${EXCL[k] || k.toLowerCase()}`).join(', ')}.</p>`;
    if (!client) h += `<p class="small">A compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.</p>`;
    return h + `</section>`;
  }
  /** layer picker (topic 18): "Visualizar por" grouped; base map separate; overlays toggles; unavailable layers show why */
  function layerMenu(st, menu) {
    const cur = st.activeMapLayer;
    let h = `<div class="layers"><div class="seg" role="group" aria-label="Base do mapa">${menu.bases.map(b => `<button data-act="bg" data-b="${App.mapLayers.BASE_TO_STORE[b.mode]}" aria-pressed="${st.backgroundLayer === App.mapLayers.BASE_TO_STORE[b.mode]}">${esc(b.label)}</button>`).join('')}</div>`;
    if (st.backgroundLayer === 'hybrid') h += `<div class="fld"><label for="lyBl">Transparência da planta</label><input id="lyBl" type="range" min="10" max="90" step="5" data-in="blend" value="${Math.round((st.baseMapBlend ?? 0.42) * 100)}"></div>`;
    h += `<div role="radiogroup" aria-label="Visualizar por">`;
    for (const g of menu.groups) h += `<fieldset><legend>${esc(g.label)}</legend>${g.items.map(d => `<label class="${d.disabled ? 'dis' : ''}"><input type="radio" name="layer" value="${d.id}"${cur === d.id ? ' checked' : ''}${d.disabled ? ' disabled' : ''}> ${esc(d.label)}${d.disabled ? ` <small>${esc(d.reason)}</small>` : ''}</label>`).join('')}</fieldset>`;
    h += `</div>`;
    if (cur === 'score' && st.presentationMode !== 'client') h += `<div class="fld"><label for="lyScore">Qual score</label><select id="lyScore" data-in="scoreKey">${['housing', 'investment', 'family', 'premium', 'overall'].map(k => opt(k, App.services.scoring.SCORE_LABEL[k], st.scoreKey)).join('')}</select></div>`;
    const ldef = cur && App.mapLayers.registry(st.developmentId).get(cur);
    if (ldef && ldef.supportsOpacity) { const op = (st.layerOpacities || {})[cur] ?? (st.backgroundLayer === 'plan' ? 0.55 : 0.8); h += `<div class="fld"><label for="lyOp">Intensidade das cores</label><input id="lyOp" type="range" min="10" max="100" step="5" data-in="opacity" value="${Math.round(op * 100)}"></div>`; }
    const ov = new Set(st.mapOverlays || []);
    h += `<fieldset><legend>Sobreposições</legend>${menu.overlays.map(o => `<label><input type="checkbox" data-act="overlay" data-id="${o.id}"${ov.has(o.id) ? ' checked' : ''}> ${esc(o.label)}</label>`).join('')}</fieldset>`;
    return h + `<button class="lbtn" data-act="layersReset">Voltar ao padrão</button></div>`;
  }
  // ---------------------------------------------------------------- explanations (topic 16): reason codes → words, by mode
  const SUMMARY = { TOP_FIT: 'É o lote mais compatível com o perfil.', TIER_PRIMARY: 'Está entre as melhores opções para o perfil.', TIER_STRONG_MATCH: 'Tem forte aderência ao perfil.', TIER_ALTERNATIVE: 'É uma alternativa razoável para o perfil.', REVIEW_REQUIRED: 'Combina com o perfil, mas a disponibilidade precisa ser confirmada antes de oferecer.' };
  const DQ = { AVAILABILITY_UNKNOWN: 'Disponibilidade não confirmada', ESTIMATED_INPUT: 'Usa estimativa', PREFERENCE_NOT_EVALUATED: 'Sem dado para avaliar', STALE_PRICE: 'Preço não confirmado nesta sessão', STALE_COMMERCIAL_DATA: 'Dado comercial não confirmado' };
  const PAIR = { HIGHER_FIT: 'tem compatibilidade maior', TIE_BREAK_COVERAGE: 'empata na compatibilidade e tem mais dados avaliados', TIE_BREAK_CONFIDENCE: 'empata e tem dados mais confiáveis', EQUIVALENT_FOR_PROFILE: 'é equivalente para este perfil; a ordem entre os dois não indica preferência', DIFFERENT_ELIGIBILITY: 'está na lista principal, e o outro precisa de revisão antes de ser oferecido' };
  const CONS = { AREA_ABOVE_MAX: 'Área acima do máximo pedido', AREA_BELOW_MIN: 'Área abaixo do mínimo pedido', BLOCK_NOT_ACCEPTED: 'Quadra fora das aceitas', CORNER_LOT: 'Lote de esquina', DISTANCE_ABOVE_MAX: 'Distância acima do máximo pedido',
    NOISE_ABOVE_LIMIT: 'Ruído acima do limite pedido', PRICE_ABOVE_MAX: 'Preço acima do orçamento', REQUIRED_FEATURE_MISSING: 'Não tem a característica exigida', UNKNOWN_AREA: 'Área não disponível', UNKNOWN_BLOCK: 'Quadra não disponível', UNKNOWN_CORNER: 'Esquina não confirmada',
    UNKNOWN_DISTANCE: 'Distância não disponível', UNKNOWN_NOISE: 'Ruído não disponível', UNKNOWN_PRICE: 'Preço não disponível', UNKNOWN_REAR: 'Fundos não confirmados', CONFLICTED_DATA: 'Dados em conflito', CRITICAL_DATA_UNKNOWN: 'Dado necessário não disponível',
    CONSTRAINT_ERROR: 'Exigência não pôde ser avaliada', CONSTRAINT_FAILED: 'Não atende à exigência', STALE_COMMERCIAL_DATA: 'Dado comercial não confirmado nesta sessão' };
  function explainPopover(e, pair, o) {
    const client = o.mode === 'client', lbl = k => (o.fitCfg.preferences[k] || {}).label || k, n1 = v => F.number(v, 1);
    let h = `<div class="poph"><b>Por que esta posição?</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${icon('close')}</button></div>`;
    const vm = App.explanation.viewModel ? App.explanation.viewModel(e, { mode: client ? 'client' : 'broker', fitCfg: o.fitCfg }) : null;
    if (e.status === 'EXCLUDED' && vm) {
      h = h.replace('Por que esta posição?', client ? 'Por que não entrou?' : 'Por que ficou de fora?');
      h += `<p>${esc(vm.headline.text)}</p>`;
      if (!client && vm.exclusions.length) h += `<ul class="xl">${vm.exclusions.map(x => `<li>${esc(x.label)}: <b>${esc(x.actual)}</b> (pedido: ${esc(x.expected)})</li>`).join('')}</ul>`;
      if (!client && vm.preferenceTable && vm.preferenceTable.length) h += prefTable(vm.preferenceTable);
      if (!client && vm.dataQuality.length) h += `<p class="small">${esc([...new Set(vm.dataQuality.map(d => d.text))].join(' '))}</p>`;
      return h + `<p class="small">Exigências não são afrouxadas automaticamente; para incluir o lote, ajuste a exigência no perfil.</p>`;
    }
    if (e.status === 'UNAVAILABLE') return h + `<p class="small">${e.standing === 'NOT_SHORTLISTED' || e.standing === 'REVIEW_NOT_LISTED' ? 'Este lote atende ao perfil, mas ficou além do limite da lista exibida.' : 'Este lote não está na recomendação atual.'}</p>`;
    h += `<p>${esc(e.standing === 'REVIEW' && vm ? vm.headline.text : SUMMARY[e.summaryReasonCodes[0]] || SUMMARY['TIER_' + e.tier] || '')}</p>`;
    if (client) {
      if (e.positiveFactors.length) h += `<p class="small">Pontos que pesaram a favor: ${esc(e.positiveFactors.slice(0, 2).map(f => lbl(f.preferenceKey).toLowerCase()).join(' e '))}.</p>`;
      if (e.negativeFactors.length) h += `<p class="small">Ponto de atenção: ${esc(lbl(e.negativeFactors[0].preferenceKey).toLowerCase())}.</p>`;
      return h;
    }
    h += `<p class="small">${e.rank}º · compatibilidade ${e.fitScore == null ? '—' : Math.round(e.fitScore) + '%'} · dados avaliados ${Math.round((e.coverage || 0) * 100)}%</p>`;
    if (e.positiveFactors.length) h += `<h4>A favor</h4><ul class="xl">${e.positiveFactors.map(f => `<li>${esc(lbl(f.preferenceKey))} <b>+${n1(f.contribution)} pts</b></li>`).join('')}</ul>`;
    if (e.negativeFactors.length) h += `<h4>Contra</h4><ul class="xl">${e.negativeFactors.map(f => `<li>${esc(lbl(f.preferenceKey))} <b>−${n1(f.lost)} pts</b></li>`).join('')}</ul>`;
    const fails = e.constraintFactors.filter(c => c.factorType !== 'CONSTRAINT_PASS'); if (fails.length) h += `<h4>Exigências</h4><ul class="xl">${fails.map(c => `<li>${esc(CONS[c.reasonCode] || 'Exigência a confirmar')}</li>`).join('')}</ul>`;
    const dq = [...new Set(e.dataQualityFactors.map(d => DQ[d.reasonCode] || (App.reasonCodes && App.reasonCodes.label(d.reasonCode, 'broker'))).filter(Boolean).map(x => x.replace(/\.$/, '')))]; if (dq.length) h += `<p class="small">Qualidade do dado: ${esc(dq.join('; '))}.</p>`;
    if (vm && vm.preferenceTable && vm.preferenceTable.length) h += `<details class="prefs"><summary>Tabela de preferências</summary>${prefTable(vm.preferenceTable)}</details>`;
    if (pair && pair.status === 'COMPLETE' && o.aboveLot) {
      const why = pair.summaryReasonCodes.map(c => PAIR[c]).filter(Boolean)[0];
      h += `<h4>Comparado ao ${esc(o.aboveLot.identity.displayCode)} (posição acima)</h4><p class="small">O ${esc(o.aboveLot.identity.displayCode)} ${esc(why || 'fica à frente')}${pair.fitDelta ? ` (${n1(pair.fitDelta)} pts)` : ''}.</p>`;
      if ((pair.notComparableFactors || []).length) h += `<p class="small">Sem dado para comparar: ${esc([...new Set(pair.notComparableFactors.map(d => lbl(d.preferenceKey)))].join(', '))}.</p>`;
      if (pair.decisiveFactors.length) h += `<p class="small">Decidiu: ${esc(pair.decisiveFactors.map(d => `${lbl(d.preferenceKey)} (+${n1(d.delta)})`).join(', '))}.${pair.offsettingFactors.length ? ` A favor deste lote: ${esc(pair.offsettingFactors.map(d => `${lbl(d.preferenceKey)} (${n1(d.delta)})`).join(', '))}.` : ''}</p>`;
    }
    if (o.mode === 'technical') h += `<p class="small">Política ${esc(e.versions.recommendationPolicyVersion)} · Fit ${esc(e.versions.fitMethodologyVersion)} · explicação ${esc(e.versions.explanationPolicyVersion)}</p>`;
    return h;
  }
  const prefTable = rows => `<table class="xt"><thead><tr><th>Preferência</th><th>Peso</th><th>Atende</th><th>Pontos</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}${r.dataStatus && r.dataStatus !== 'Confirmado' && r.dataStatus !== 'Calculado' ? ` <small>(${esc(String(r.dataStatus).toLowerCase())})</small>` : ''}</td><td>${esc(r.importance)}</td><td>${r.evaluated === false ? 'sem dado' : esc(r.match)}</td><td>${esc(r.contribution)}</td></tr>`).join('')}</tbody></table>`;
  const CRIT_LABEL = { lowTraffic: 'Pouco trânsito', quiet: 'Silêncio', privacy: 'Privacidade', solar: 'Orientação solar', view: 'Vista', geometry: 'Formato', gate: 'Portaria', leisure: 'Lazer', liquidity: 'Liquidez', relativeValue: 'Valor relativo', priceQuality: 'Custo-benefício', area: 'Área', green: 'Área verde', flow: 'Fluxo' };
  function techExplainPopover(ex, r, lot, o) {
    let h = `<div class="poph"><b>Como o score ${esc(App.services.scoring.SCORE_LABEL[o.scoreKey])} foi calculado</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${icon('close')}</button></div>`;
    if (!ex || ex.status !== 'COMPLETE') return h + `<p class="small">Explicação indisponível para este score.</p>`;
    h += `<p class="small">Score ${esc(F.formatScore(ex.value))} = soma ponderada das notas (0–10) × 10. Mesma metodologia publicada (versão ${esc(ex.methodologyVersion)}).</p>`;
    h += `<table class="xt"><thead><tr><th>Critério</th><th>Nota</th><th>Peso</th><th>Pontos</th></tr></thead><tbody>${ex.factors.map(f => `<tr><td>${esc(CRIT_LABEL[f.criterionId] || f.criterionId)}${(f.reasons || []).length ? `<br><small>${esc(f.reasons.map(r => (App.reasonCodes && App.reasonCodes.label(r.reasonCode, 'broker')) || 'Ajuste').filter((v, i, a) => a.indexOf(v) === i).join(', '))}</small>` : ''}</td><td>${f.value == null ? '—' : F.number(f.value, 1)}</td><td>${F.number(f.weight * 100, 0)}%</td><td>${F.number(f.contribution, 1)}</td></tr>`).join('')}</tbody></table>`;
    if (ex.classBand) h += `<p class="small">Classe ${esc(F.formatLotClass(ex.classBand.class))}: ${ex.classBand.position}º de ${ex.classBand.total} no score geral (top ${F.number(ex.classBand.topShare * 100, 0)}%).</p>`;
    // topic 35 (technical mode): which analysis this is; nothing is recalculated or published from here
    const vv = o.versioning;
    if (vv) h += `<p class="small vinfo">Análise ${esc(vv.analysisVersion || 'não informada')} · metodologia ${esc(vv.methodologyVersion || 'não informada')} · medições ${esc(vv.inputVersion || 'não informadas')} · ${vv.published ? 'versão publicada ' + esc(vv.published) : 'sem versão publicada no registro analítico (baseline legado)'} · impressão digital <code>${esc(vv.fingerprint || '—')}</code></p>`;
    return h;
  }

  // ================================================================ Lot panel
  function empty(st, x) {
    const lots = x.sel.selectLots(st), ps = lots.map(l => l.commercial.price).filter(v => v != null), as = lots.map(l => l.geometry.areaM2).filter(v => v != null);
    return `<div class="pb"><div class="emptyst"><h2>${esc(x.dev.name)}</h2><p class="muted">Toque em um lote no mapa, use a busca ou o painel Encontrar.</p>
      <div class="kpi3"><div><span>Lotes</span><b>${F.number(lots.length)}</b></div><div><span>Preços</span><b>${ps.length ? F.formatBRLShort(Math.min(...ps)) : F.ND}</b><small class="small">a ${ps.length ? F.formatBRLShort(Math.max(...ps)) : ''}</small></div><div><span>Áreas</span><b>${as.length ? F.number(Math.min(...as)) : F.ND}</b><small class="small">a ${as.length ? F.formatSquareMeters(Math.max(...as), 0) : ''}</small></div></div>
      <p class="small">Preço por m² da tabela atual: ${F.formatPricePerM2(x.priceTable && x.priceTable.pricePerM2)}.</p></div></div>`;
  }
  function header(q, st, back) {
    return `<div class="ph lothd">${back ? `<button class="btn sm" data-act="panel" data-p="quick" aria-label="Voltar ao resumo">${icon('back')}</button>` : ''}
      <div class="lh1"><div><h2 id="lotTitle" tabindex="-1">${esc(q.title)}</h2><div class="did">${esc(q.displayCode)}${q.techId ? ' · ' + esc(q.techId) : ''}</div></div>${q.cls ? `<span class="cls" style="background:${q.cls.color};color:${['B'].includes(q.cls.code) ? '#1b261d' : '#fff'}" title="Classe do lote">${esc(q.cls.label)}</span>` : ''}</div>
      <button class="btn sm x" data-act="closeLot" aria-label="Fechar lote">${icon('close')}</button></div>`;
  }
  function statusLine(s) { return `<div class="status${s.warn ? ' warn' : ''}">${statusDot(s.color)}<b>${esc(s.label)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ''}${s.reservedUntil ? `<span>Reserva até ${esc(s.reservedUntil)}${s.expired ? ' (vencida)' : ''}</span>` : ''}${s.reason ? `<span>${esc(s.reason)}</span>` : ''}</div>`; }
  /** LotQuickView (topic 20): one component for desktop panel, mobile sheet and presentation; it only renders the view model */
  const ACT = { details: { act: 'panel', p: 'details' }, simulate: { act: 'panel', p: 'simulation' }, solar: { act: 'panel', p: 'solar' }, compare: { act: 'cmp' }, favorite: { act: 'fav' }, share: { act: 'share' },
    routeGate: { act: 'route', r: 'gate' }, routeLeisure: { act: 'route', r: 'leisure' }, explain: { act: 'explain' }, copyId: { act: 'copyId' }, provenance: { act: 'prov', k: 'availability.status' } };
  function actionButton(a, i) {
    if (a.id === 'primary') return `<button class="btn pri wide" data-act="primary" data-a="${a.actionCode}" data-ak="${esc(a.analyticsKey || '')}" data-tier="${esc(a.tier || '')}">${icon(a.iconToken)} ${esc(a.labelKey)}</button>`;
    const m = ACT[a.id]; if (!m) return '';
    const data = Object.entries(m).filter(([k]) => k !== 'act').map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button class="btn" data-act="${m.act}"${data} data-ak="${esc(a.analyticsKey || '')}" data-tier="${esc(a.tier || '')}"${a.pressed != null ? ` aria-pressed="${a.pressed}"` : ''}${a.enabled ? '' : ` disabled title="${esc(a.disabledReasonKey || '')}"`}>${icon(a.iconToken)} ${esc(a.labelKey)}</button>`;
  }
  const sheetCtl = st => (typeof window !== 'undefined' && (App.responsive && App.responsive.get() ? App.responsive.get().regions.right === 'SHEET' : window.innerWidth < 1024)) ? `<div class="sheetctl"><button class="lbtn small" data-act="sheetDown" aria-label="Recolher o painel do lote"${st.sheet === 'min' ? ' disabled' : ''}>Recolher</button><button class="lbtn small" data-act="sheetUp" aria-label="Expandir o painel do lote"${st.sheet === 'full' ? ' disabled' : ''}>Expandir</button></div>` : '';
  const provTag = st => st && !['CONFIRMED', 'CALCULATED'].includes(st) ? ` <small class="provt ${esc(st)}">${esc(provLabel(st))}</small>` : '';
  function quick(q, st, x) {
    const client = q.context.presentationMode === 'client', pres = q.context.mode === 'PRESENTATION';
    let h = header(q, st, false) + sheetCtl(st);
    h += `<div class="pb${pres ? ' presq' : ''}">` + statusLine(q.status);
    if (q.context.offline && q.context.offline.status === 'OFFLINE') h += `<p class="small offq">Sem conexão: ${client ? 'preço e disponibilidade sujeitos a confirmação' : 'preço e disponibilidade mostrados são os últimos salvos neste aparelho'}.</p>`;
    const badges = [];
    if (q.recommendation) badges.push(`<span class="badge rec">${esc(q.recommendation.label)}</span>`);
    const exd = !pres && x.recommendation && App.recommendation.excludedOf ? App.recommendation.excludedOf(x.recommendation, q.lotId) : null;
    if (exd) { const why = App.reasonCodes ? App.reasonCodes.label(exd.reasonCode, client ? 'client' : 'broker') : null;
      h += `<p class="small exq">${client ? 'Não entra nas sugestões para este perfil' : 'Fora da recomendação'}${why ? ': ' + esc(why.replace(/\.$/, '').toLowerCase()) : ''}. <button class="lbtn small" data-act="explain" data-id="${esc(q.lotId)}">Por quê?</button></p>`; }
    if (q.comparison) badges.push(`<span class="badge"><span class="pinlbl">${q.comparison.index}</span> na comparação</span>`);
    if (badges.length) h += `<div class="badges">${badges.join('')}</div>`;
    if (!pres && x.decisionQv) h += x.decisionQv(q.lotId); // topic 56: "Para este cliente" (only while a customer is being served)
    if (q.outsideFilter) h += `<p class="small outf">Fora dos filtros atuais${q.outsideFilter.reasons.length ? ` (${esc(q.outsideFilter.reasons.map(r => r.label).join(', '))})` : ''}. O lote continua selecionável.</p>`;
    const blocks = {};
    blocks.price = `<div class="kpi3">${q.metrics.map(m => `<div${q.uiHints.emphasizedFieldKeys.includes(m.fieldKey) ? ' class="emph"' : ''}><span>${esc(m.label)}${provTag(m.status)}</span><b>${esc(m.value)}</b>${m.note ? `<small class="pnote">${esc(m.note)}</small>` : ''}</div>`).join('')}</div>`;
    let fitH = '';
    if (q.customerFit) fitH += `<div class="relv"><b>${esc(q.customerFit.label)}</b> com o perfil${q.customerFit.customerLabel && !client ? ` de ${esc(q.customerFit.customerLabel)}` : ''}${q.customerFit.lowCoverage ? '<span class="small">Poucos dados para este perfil.</span>' : ''}${q.customerFit.note ? `<span class="small">${esc(q.customerFit.note)}</span>` : ''}${q.recommendation && !client ? ` <button class="lbtn small" data-act="explain">Por quê?</button>` : ''}</div>`;
    blocks.fit = fitH; let scoreH = '';
    if (q.primaryScore) scoreH += `<div class="pscore"><div><span class="small">Score ${esc(q.primaryScore.label)}</span><b>${esc(q.primaryScore.formatted)}</b></div><div class="bar"><i style="width:${q.primaryScore.value || 0}%"></i></div>${q.primaryScore.rankingText ? `<span class="small">${esc(q.primaryScore.rankingText)}</span>` : ''}</div>`;
    blocks.score = scoreH;
    // block order follows the view model hint (fit first for a customer or recommendation, price for the client, score otherwise)
    const order = q.uiHints.primaryMetricKey === 'fit' ? ['fit', 'price', 'score'] : q.uiHints.primaryMetricKey === 'score' ? ['price', 'score', 'fit'] : ['price', 'fit', 'score'];
    h += order.map(k => blocks[k] || '').join('');
    if (x.priceHistory && App.pricingView) { const lot0 = x.repo.getLotById(q.lotId); if (lot0) h += App.pricingView.renderQuickViewPriceChange(App.priceHistory.quickViewSummary(x.priceHistory.lotHistory(lot0))); } // '' while there is a single table version
    if (q.keyAttributes.length) h += `<div class="scorebar">${q.keyAttributes.map(k => `<div class="sb"><span>${esc(k.label)}</span><b>${esc(k.formatted)}</b><div class="bar"><i style="width:${(k.value || 0) * 10}%"></i></div></div>`).join('')}</div>`;
    if (q.facts.length) h += `<div class="notes3">${q.facts.map(f => `<span${f.emphasized ? ' class="emph"' : ''}>${esc(f.label)}: <b>${esc(f.value)}</b>${provTag(f.status)}</span>`).join('')}</div>`;
    if (!client && q.provenanceSummary && q.provenanceSummary.estimatedFields) h += `<p class="small">Estimados nesta ficha: ${esc(q.provenanceSummary.labels.join(', ').toLowerCase())}. <button class="lbtn small" data-act="panel" data-p="details" data-sec="sources">Ver origem</button></p>`;
    if (q.highlights.length) h += `<ul class="hl">${q.highlights.map(x2 => `<li${x2.type === 'CUSTOMER_MATCH' || x2.matchesCustomer ? ' class="cm"' : ''}>${esc(x2.labelKey)}${x2.matchesCustomer && x2.type !== 'CUSTOMER_MATCH' && !client ? ' <small>(o cliente valoriza)</small>' : ''}</li>`).join('')}</ul>`;
    const al = q.alerts;
    if (al.topAlerts.length) h += `<div class="alerts">${al.topAlerts.map(a => `<div class="alert ${a.severity}"><b>${esc(a.severityLabel.toUpperCase())} · ${esc(a.typeLabel)}</b>${esc(a.message)}</div>`).join('')}</div>`;
    if (al.moreCount) h += `<button class="lbtn" data-act="panel" data-p="details" data-sec="intelligence">${al.moreCount === 1 ? 'Mais 1 ponto' : `Mais ${al.moreCount} pontos`} nos detalhes</button>`;
    if (q.bestFor && !client) h += `<p class="small">${esc(q.bestFor)}.</p>`;
    const vis = q.actions.filter(a => a.visible !== false && a.tier !== 'OVERFLOW' && a.tier !== 'HIDDEN'), more = q.actions.filter(a => a.tier === 'OVERFLOW');
    h += `<div class="acts">${vis.map(actionButton).join('')}${more.length ? `<details class="moreacts"><summary class="btn">Mais ações</summary><div class="morelist">${more.map(actionButton).join('')}</div></details>` : ''}</div>`;
    if (q.dataVersions) h += `<p class="small">ID ${esc(q.lotId)} · análise ${esc(q.dataVersions.analysisVersion)} · tabela ${esc(q.dataVersions.priceTableVersion)} · Quick View v${q.viewModelVersion}</p>`;
    return h + `</div>`;
  }
  const provLabel = s => t('DataStatusShort', s);
  /** topic 37: why a field has no value (e.g. "Ainda não medido"), from the data-state resolver; known values keep their wording */
  function ndReason(lot, key, mode) {
    if (!lot || !App.dataState) return '';
    try { const r = App.dataState.resolve(lot, key, { mode }); const tx = r && r.display && !r.display.showValue ? r.display.secondaryText : null; return tx ? ` <small class="ndr">${esc(tx)}</small>` : ''; } catch (e) { return ''; }
  }
  function details(d, st, x) {
    const q = d.summary, lot0 = x.repo ? x.repo.getLotById(q.lotId) : null;
    let h = header(q, st, true) + sheetCtl(st) + `<div class="dsum">${statusLine(q.status)}<span>${esc(q.metrics[0].value)} · ${esc(q.metrics[1].value)}</span></div>`;
    h += `<nav class="catnav" aria-label="Seções do lote">${d.sections.map(s => `<button data-act="secJump" data-s="${s.id}" aria-current="${st.detailSection === s.id}">${esc(s.title)}</button>`).join('')}</nav><div class="pb" id="detBody">`;
    for (const s of d.sections) {
      const open = !!(st.openSections || {})[s.id];
      h += `<section class="acc" id="sec-${s.id}"><button class="acch" data-act="sec" data-s="${s.id}" aria-expanded="${open}"><span>${esc(s.title)}</span><small>${s.fields.length - s.unavailable} de ${s.fields.length} com dado</small></button>`;
      if (open) {
        h += `<div class="accb">`;
        if (s.alerts.length) h += `<div class="alerts">${s.alerts.map(a => `<div class="alert ${a.severity}"><b>${esc(a.severityLabel.toUpperCase())} · ${esc(a.typeLabel)}</b>${esc(a.message)}</div>`).join('')}</div>`;
        h += `<dl class="fl">${s.fields.map(f => `<dt>${esc(f.label)}</dt><dd>${f.isAvailable ? esc(f.formattedValue) : `<span class="nd">Não disponível</span>${ndReason(lot0, f.key, x.mode)}`}<button class="prov ${f.dataStatus}" data-act="prov" data-k="${f.key}" aria-label="Origem do dado: ${esc(provLabel(f.dataStatus))}">${esc(provLabel(f.dataStatus))}</button>${x.trust && lot0 ? x.trust.badgeHtml(lot0, f.key, x.mode) : ''}</dd>`).join('')}</dl>`;
        if (s.id === 'commercial' && x.priceHistory && App.pricingView) { const lot0 = x.repo.getLotById(q.lotId); if (lot0) h += App.pricingView.renderHistorySection(x.priceHistory.viewModel(lot0, { mode: x.mode, from: st.priceHistoryFrom || undefined })); }
        if (s.id === 'intelligence' && x.mode !== 'client') h += `<button class="btn sm" data-act="techExplain">${icon('info')} Como o score foi calculado</button>`;
        if (s.id === 'sources') {
          h += `<div class="small">Fontes usadas neste lote:</div><ul class="srcl">${d.sources.map(src => `<li><b>${esc(src.name)}</b><span class="small">${esc(src.precision)}</span></li>`).join('')}</ul>`;
          if (d.dataVersions) h += `<p class="small">Versões: estrutura ${esc(d.dataVersions.staticVersion)} · análise ${esc(d.dataVersions.analysisVersion)} · tabela ${esc(d.dataVersions.priceTableVersion)} · status revisão ${esc(d.dataVersions.availabilityRevision ?? 0)}</p>`;
        }
        h += `</div>`;
      }
      h += `</section>`;
    }
    if (x.trust) h += x.trust.docsHtml(x.mode); // topic 32: documents related to this development (catalog; access decided per viewer)
    return h + `</div>`;
  }
  function provPopover(lot, key, x) {
    const vm = App.vm.fieldVM(lot, key, { dev: x.dev, priceTable: x.priceTable }), p = vm.provenance, client = x.mode === 'client';
    return `<div class="poph"><b>${esc(vm.label)}</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${icon('close')}</button></div><dl>
      <dt>Valor</dt><dd>${vm.isAvailable ? esc(vm.formattedValue) : 'Não disponível'}</dd>
      <dt>Situação</dt><dd>${esc(t('DataStatus', vm.dataStatus))}</dd>
      ${vm.sourceSummary ? `<dt>Fonte</dt><dd>${esc(vm.sourceSummary)}</dd>` : ''}
      ${!client && p.method ? `<dt>Método</dt><dd>${esc(t('Method', p.method, p.method))}</dd>` : ''}
      ${!client && p.confidence ? `<dt>Confiança</dt><dd>${esc(t('Confidence', p.confidence))}</dd>` : ''}
      ${p.updatedAt ? `<dt>Data</dt><dd>${esc(F.formatDate(p.updatedAt))}</dd>` : ''}
      <dt>O que é</dt><dd>${esc(vm.helpText || '')}</dd></dl>`;
  }
  function simulation(s, q, st, x) {
    let h = header(q, st, true) + sheetCtl(st) + `<div class="pb">`;
    if (s.eligibility.warning) h += `<div class="alert ATTENTION">${esc(s.eligibility.warning)}${s.eligibility.sellAllowed ? '' : '. Use a simulação apenas como consulta.'}</div>`;
    if (!s.available) return h + `<p class="empty">${esc(s.message)}</p></div>`;
    h += `<p class="small">${esc(s.tableLabel)}${s.tableNote ? ' · <b>' + esc(s.tableNote) + '</b>' : ''}</p>`;
    h += `<div class="kpi3"><div><span>Preço</span><b>${esc(s.price)}</b></div><div><span>Entrada</span><b>${esc(s.downPayment)}</b></div><div><span>Saldo</span><b>${esc(s.financed)}</b></div></div>`;
    h += `<div class="ent"><label for="dp">Entrada</label><input id="dp" type="range" min="5" max="50" step="1" value="${s.downPaymentPct}" data-in="dp" aria-valuetext="${s.downPaymentPct}%"><input type="number" min="0" max="100" step="1" value="${s.downPaymentPct}" data-in="dpn" aria-label="Entrada em porcentagem"><span>%</span></div>`;
    h += `<div class="plans" role="radiogroup" aria-label="Plano de pagamento">${s.plans.map((p, i) => `<label class="plan${p.selected ? ' on' : ''}"><input type="radio" name="plan" value="${p.id}" data-in="plan"${p.selected ? ' checked' : ''}><span><span class="pt"><span class="swl" style="background:var(--s${i + 1})"></span>${esc(p.name)}</span><span class="pd">${esc(p.desc)}</span></span><span class="pv">${esc(p.main)}${p.annual ? `<br><small>${esc(p.annual)}</small>` : ''}<br><small>Total ${esc(p.total)}</small></span></label>`).join('')}</div>`;
    if (!st.simulation.expanded) h += `<button class="btn" data-act="simExpand">Ver fluxo completo e gráfico</button>`;
    else {
      h += `<section class="sec"><h3>Total pago ao longo do tempo</h3><div class="chart" id="simChart"></div><div class="chartleg">${s.plans.map((p, i) => `<span><i style="background:var(--s${i + 1})"></i>${esc(p.name)}</span>`).join('')}</div></section>`;
      h += `<section class="sec"><h3>${esc(s.selected.name)} por ano</h3><table class="sched"><thead><tr><th>Ano</th><th>Mensais</th><th>Anuais</th><th>No ano</th><th>Acumulado</th></tr></thead><tbody>${s.yearly.map(r => `<tr><td>${r.year === 0 ? 'Entrada' : r.year + 'º'}</td><td>${r.monthly ? F.formatBRL(r.monthly) : '—'}</td><td>${r.annual ? F.formatBRL(r.annual) : '—'}</td><td>${F.formatBRL(r.total)}</td><td>${F.formatBRL(r.cumulative)}</td></tr>`).join('')}</tbody></table></section>`;
    }
    h += `<p class="small">Valores sem correção pelo IGP-M. Simulação para conversa; condições finais dependem da loteadora.</p></div>`;
    return h;
  }
  function solar(q, st, x) {
    const S = App.services.solar.SEASONS, so = st.solar;
    return header(q, st, true) + sheetCtl(st) + `<div class="pb"><div class="sun" id="sunbox">
      <div class="seg" role="group" aria-label="Época do ano">${Object.entries(S).map(([k, v]) => `<button data-act="season" data-s="${k}" aria-pressed="${k === so.season}">${esc(v.label)}</button>`).join('')}</div>
      <svg class="dome" id="sunDome" viewBox="0 0 320 320" role="img" aria-label="Posição do sol em relação ao lote"></svg>
      <div class="hour"><button class="btn sm" data-act="play" id="sunPlay" aria-label="Animar o dia">▶</button><input id="sunH" type="range" min="5" max="19" step="0.25" value="${esc(so.hour)}" data-in="hour" aria-label="Hora do dia"><output id="sunHo">${F.formatHour(so.hour)}</output></div>
      <div class="chips">${[['Manhã', 8], ['Meio-dia', 12], ['Tarde', 15.5], ['Fim de tarde', 17]].map(([k, hh]) => `<button class="chip" data-act="hourPreset" data-h="${hh}">${k} · ${F.formatHour(hh)}</button>`).join('')}</div>
      <div class="cap" id="sunCap" aria-live="polite"></div>
      <div><div class="small">Que lado do lote recebe sol em cada hora (toque para ver)</div><div class="strip"><svg id="sunStrip" viewBox="0 0 400 92" aria-label="Horas de sol na frente e nos fundos por época do ano"></svg></div>
      <div class="leg"><span><i style="background:var(--s4)"></i>Sol na frente</span><span><i style="background:var(--s1)"></i>Sol nos fundos</span><span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>Noite</span></div></div>
      <div class="small" id="sunSum"></div>
      <label class="chk"><input type="checkbox" data-in="solarMap"${so.onMap ? ' checked' : ''}> Mostrar no mapa o lado com sol de todos os lotes</label>
      <p class="small">Cálculo astronômico para Serra/ES (latitude 20,1° S), sem sombra de vizinhos, muros ou árvores. É estimativa, não medição.</p>
    </div></div>`;
  }

  // ---------- drawings that need the DOM (solar dome, chart)
  const D2R = Math.PI / 180, SIDE_TO = { N: 'o norte', NE: 'o nordeste', E: 'o leste', SE: 'o sudeste', S: 'o sul', SW: 'o sudoeste', W: 'o oeste', NW: 'o noroeste' }, FROM = { N: 'do norte', NE: 'do nordeste', E: 'do leste', SE: 'do sudeste', S: 'do sul', SW: 'do sudoeste', W: 'do oeste', NW: 'do noroeste' };
  function drawSun(lot, so, sun) {
    const dome = document.getElementById('sunDome'); if (!dome) return;
    const az = lot.environmental.frontBearingDeg, poly = lot.geometry.polygon, [cx, cy] = lot.geometry.centroid;
    const C = 160, R = 118, P = (a, alt) => { const r = R * (1 - Math.max(alt, 0) / 90); return [C + r * Math.sin(a * D2R), C - r * Math.cos(a * D2R)]; };
    let g = `<circle class="sky" cx="${C}" cy="${C}" r="${R}"/>` + [30, 60].map(a => `<circle class="ring" cx="${C}" cy="${C}" r="${R * (1 - a / 90)}"/>`).join('');
    g += [['N', 0], ['L', 90], ['S', 180], ['O', 270]].map(([tx, a]) => `<text class="card" x="${C + (R + 14) * Math.sin(a * D2R)}" y="${C - (R + 14) * Math.cos(a * D2R) + 4}" text-anchor="middle">${tx}</text>`).join('');
    for (const k of Object.keys(sun.SEASONS)) {
      const d = sun.day(k), pts = []; for (let h = d.sunrise; h <= d.sunset; h += 0.1) { const p = sun.position(k, h); pts.push(P(p.az, p.alt)); }
      g += `<polyline class="path${k === so.season ? ' on' : ''}" points="${pts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
      const q7 = sun.position(k, 7.2), n = P(q7.az, q7.alt); g += `<text x="${n[0] + 6}" y="${n[1] - 5}">${k === 'ver' ? 'dez' : k === 'eq' ? 'mar/set' : 'jun'}</text>`;
    }
    for (const h of [6, 9, 12, 15, 18]) { const p = sun.position(so.season, h); if (p.alt > 0) { const [x, y] = P(p.az, p.alt); g += `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--fg-3)"/><text x="${x + 5}" y="${y + 12}">${h}h</text>`; } }
    const ext = Math.max(...poly.map(q => Math.hypot(q[0] - cx, q[1] - cy))), k = 44 / ext, lp = poly.map(q => [C + (q[0] - cx) * k, C + (q[1] - cy) * k]);
    if (lp.length && (lp[0][0] !== lp[lp.length - 1][0] || lp[0][1] !== lp[lp.length - 1][1])) lp.push(lp[0]);
    const sp = sun.position(so.season, so.hour), day = sp.alt > 0;
    if (az != null) { const fa = az * D2R; g += `<line class="ruaarrow" x1="${C + 54 * Math.sin(fa)}" y1="${C - 54 * Math.cos(fa)}" x2="${C + 76 * Math.sin(fa)}" y2="${C - 76 * Math.cos(fa)}"/><text class="rua" x="${C + 88 * Math.sin(fa)}" y="${C - 88 * Math.cos(fa) + 4}" text-anchor="middle">RUA</text>`; }
    if (day) { const [sx, sy] = P(sp.az, sp.alt); g += `<line class="ray" x1="${C}" y1="${C}" x2="${sx}" y2="${sy}"/>`; }
    g += `<polygon class="lotp" points="${lp.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
    if (day) {
      let a2 = 0; for (let i = 0; i < lp.length - 1; i++) a2 += lp[i][0] * lp[i + 1][1] - lp[i + 1][0] * lp[i][1]; const sg = a2 > 0 ? 1 : -1;
      const dx = Math.sin(sp.az * D2R), dy = -Math.cos(sp.az * D2R);
      for (let i = 0; i < lp.length - 1; i++) { const [x1, y1] = lp[i], [x2, y2] = lp[i + 1], ex = x2 - x1, ey = y2 - y1, L = Math.hypot(ex, ey); if (L < 0.5) continue; const nx = sg * ey / L, ny = -sg * ex / L; if (nx * dx + ny * dy > 0.2) g += `<line class="lit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
      const [sx, sy] = P(sp.az, sp.alt); g += `<circle class="glow" cx="${sx}" cy="${sy}" r="17"/><circle class="sunc" cx="${sx}" cy="${sy}" r="9"/>`;
    }
    dome.innerHTML = g;
    const S = sun.SEASONS[so.season], ho = document.getElementById('sunHo'), hi = document.getElementById('sunH');
    if (ho) ho.textContent = F.formatHour(so.hour); if (hi && +hi.value !== so.hour) hi.value = so.hour;
    const m = az == null ? null : sun.moment(az, so.season, so.hour), cap = document.getElementById('sunCap');
    if (cap) {
      if (az == null) cap.textContent = 'Orientação da frente não disponível para este lote.';
      else if (!m.day) cap.innerHTML = `<b>${esc(S.label)}, ${F.formatHour(so.hour)}:</b> o sol está abaixo do horizonte. Nasce às ${F.formatHour(m.sunrise)} e se põe às ${F.formatHour(m.sunset)}.`;
      else { const lado = { FRONT_DIRECT: 'bate de frente na <b>frente</b> do lote', FRONT_AND_SIDE: `ilumina a <b>frente</b> e a lateral voltada para ${SIDE_TO[m.lateral]}`, BACK_AND_SIDE: `ilumina os <b>fundos</b> e a lateral voltada para ${SIDE_TO[m.lateral]}`, BACK_DIRECT: 'bate de frente nos <b>fundos</b> do lote' }[m.lit];
        cap.innerHTML = `<b>${esc(S.label)}, ${F.formatHour(so.hour)}:</b> sol a ${Math.round(m.altitude)}° de altura, vindo ${FROM[m.from]}. ${lado[0].toUpperCase() + lado.slice(1)}.${m.nearZenith ? ' Sol quase a pino: pouca sombra lateral.' : ''}`; }
    }
    const strip = document.getElementById('sunStrip');
    if (strip && az != null) {
      const X0 = 58, X1 = 394, h0 = 5, h1 = 19, slot = 0.25, sx = h => X0 + (h - h0) / (h1 - h0) * (X1 - X0); let st2 = '';
      Object.keys(sun.SEASONS).forEach((kk, i) => { const y = 6 + i * 24; st2 += `<text x="0" y="${y + 13}">${kk === 'ver' ? 'Verão' : kk === 'eq' ? 'Out./prim.' : 'Inverno'}</text>`;
        for (let h = h0; h < h1; h += slot) { const sd = sun.litSide(az, kk, h + slot / 2), c = sd === 'FRONT' ? 'var(--s4)' : sd === 'BACK' ? 'var(--s1)' : 'var(--surface-2)';
          st2 += `<rect x="${sx(h) + 0.5}" y="${y}" width="${sx(h + slot) - sx(h) - 1}" height="18" rx="2" fill="${c}" data-s="${kk}" data-h="${h + slot / 2}"><title>${sun.SEASONS[kk].label}, ${F.formatHour(h)}–${F.formatHour(h + slot)}: ${sd === 'NIGHT' ? 'noite' : sd === 'FRONT' ? 'sol na frente' : 'sol nos fundos'}</title></rect>`; } });
      for (const h of [6, 9, 12, 15, 18]) st2 += `<text x="${sx(h)}" y="88" text-anchor="middle">${h}h</text>`;
      const ci = Object.keys(sun.SEASONS).indexOf(so.season);
      st2 += `<line x1="${sx(so.hour)}" x2="${sx(so.hour)}" y1="2" y2="76" stroke="var(--fg)" stroke-width="2"/><rect x="${X0 - 2}" y="${4 + ci * 24}" width="${X1 - X0 + 4}" height="22" rx="4" fill="none" stroke="var(--fg-2)" stroke-width="1"/>`;
      strip.innerHTML = st2;
      const I = sun.intervals(az, so.season), fmtI = arr => arr.length ? arr.map(([a, b]) => `${F.formatHour(a)}–${F.formatHour(b)}`).join(' e ') : 'nenhum horário', dur = arr => arr.reduce((s, [a, b]) => s + b - a, 0);
      const sum = document.getElementById('sunSum'); if (sum) sum.innerHTML = `<b>${esc(S.label)} (${esc(S.when)}):</b> sol na frente ${fmtI(I.FRONT)} (${F.number(dur(I.FRONT), 1)} h); nos fundos ${fmtI(I.BACK)} (${F.number(dur(I.BACK), 1)} h).`;
    }
  }
  /** cumulative paid per plan (one axis, thin lines, crosshair tooltip) */
  function drawChart(s) {
    const box = document.getElementById('simChart'); if (!box || !s || !s.available) return;
    const series = App.services.finance.cumulative(s.sim), N = Math.max(...series.map(x => x.pts.length)) - 1, max = Math.max(...series.map(x => x.pts[x.pts.length - 1]));
    const W = 360, H = 180, ml = 46, mr = 8, mt = 8, mb = 22, X = k => ml + k / N * (W - ml - mr), Y = v => mt + (1 - v / max) * (H - mt - mb);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
    let g = `<g class="grid">${ticks.map(v => `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${ml - 4}" y="${Y(v) + 3}" text-anchor="end">${F.formatBRLShort(v).replace('R$ ', '')}</text>`).join('')}</g>`;
    for (const y of [0, 3, 6, 9, 12]) if (y * 12 <= N) g += `<text x="${X(y * 12)}" y="${H - 6}" text-anchor="middle">${y === 0 ? 'hoje' : y + ' anos'}</text>`;
    series.forEach((sr, i) => { g += `<polyline fill="none" stroke="var(--s${i + 1})" stroke-width="2" stroke-linejoin="round" points="${sr.pts.map((v, k) => X(k).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`; });
    g += `<line class="cx" y1="${mt}" y2="${H - mb}" stroke="var(--fg-3)" stroke-width="1" visibility="hidden"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total pago acumulado por plano">${g}</svg><div class="ctip" hidden></div>`;
    const sv = box.querySelector('svg'), tip = box.querySelector('.ctip'), cx = sv.querySelector('.cx');
    sv.addEventListener('pointermove', e => { const r = sv.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W; const k = Math.max(0, Math.min(N, Math.round((px - ml) / (W - ml - mr) * N)));
      cx.setAttribute('x1', X(k)); cx.setAttribute('x2', X(k)); cx.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.innerHTML = `<b>${k === 0 ? 'Entrada' : 'Mês ' + k}</b><br>` + series.map((sr, i) => `<span style="color:var(--s${i + 1})">●</span> ${esc(sr.name)}: ${F.formatBRL(sr.pts[Math.min(k, sr.pts.length - 1)])}`).join('<br>');
      tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, e.clientX - r.left + 10)) + 'px'; });
    sv.addEventListener('pointerleave', () => { tip.hidden = true; cx.setAttribute('visibility', 'hidden'); });
  }
  return { FL_TO_CONS, find, layerMenu, explainPopover, techExplainPopover, empty, quick, details, provPopover, simulation, solar, drawSun, drawChart, PREF_KEYS, chipText };
})();
