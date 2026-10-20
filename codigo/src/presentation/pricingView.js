/* presentation/pricingView.js — UI of topics 28 and 29, as pure functions returning HTML strings.
   - Status and price are two independent blocks: the status never hides because a price is missing, the price never
     decides the status. Labels (Portuguese) live here; the domain (App.availability, App.priceHistory) keeps codes.
   - Price history: summary, step chart (SVG, no smoothing, no interpolation, gaps drawn apart), accessible table,
     quality, disclaimer. A single published version shows one step and "não pode ser calculada" (never 0%).
   - Increase/decrease never by colour alone (text and symbol), no green = success / red = failure.
   The lead wires these into the quick view, details panel and filters (see docs/RELATORIO_TOPICOS_28_29.md). */
App.pricingView = (() => {
  const AV = App.availability, PH = App.priceHistory;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = d => d ? App.fmt.formatDate(String(d).slice(0, 10)) : 'Data não informada';

  // ------------------------------------------------------------------ availability (topic 29)
  const STATUS_LABEL = { AVAILABLE: 'Disponível', RESERVED: 'Reservado', PROPOSAL: 'Em negociação', BLOCKED: 'Bloqueado', SOLD: 'Vendido', UNAVAILABLE: 'Indisponível no momento', UNKNOWN: 'A confirmar',
    CONFLICTED: 'Status com divergência — confirmar' };
  const LAST_KNOWN = { client: 'Último status conhecido: disponível. Confirmar disponibilidade.', broker: 'Disponível — último status conhecido, confirmar atualização', technical: 'Disponível (STALE) — confirmar atualização', presentation: 'Disponibilidade a confirmar' };
  const FRESHNESS_LABEL = { FRESH: 'Atualizado', STALE: 'Último status conhecido', EXPIRED: 'Informação vencida, confirmar antes de oferecer', UNKNOWN: 'Sem data de atualização' };
  const WARNING_LABEL = { TO_CONFIRM: 'Sem espelho de vendas: disponibilidade a confirmar com a loteadora.', STALE: 'Status não confirmado agora: confirme antes de oferecer.',
    EXPIRED: 'Status vencido: não use para oferecer sem confirmar.', CONFLICTED: 'Fontes divergentes sobre o status: confirme com a loteadora.' };
  const OFFERABILITY_LABEL = { OFFERABLE: 'Pode ser oferecido', CONDITIONAL: 'Oferta condicionada', NOT_OFFERABLE: 'Não disponível para nova oferta', NEEDS_CONFIRMATION: 'Confirmar disponibilidade antes de oferecer', UNKNOWN: 'Disponibilidade desconhecida' };
  const REASON_LABEL = { TECHNICAL_REVIEW: 'Revisão técnica', COMMERCIAL_HOLD: 'Retenção comercial', LEGAL_HOLD: 'Pendência jurídica', INTERNAL_BLOCK: 'Bloqueio interno', NOT_RELEASED: 'Não liberado', DATA_VALIDATION: 'Validação de dados', OTHER: 'Outro' };
  /** LotAvailabilityViewModel(lot, { mode, policy, now, offline, freshnessPolicy }) */
  function availabilityVM(lot, o = {}) {
    const mode = o.mode || 'broker', d = AV.viewModelData(lot, o);
    const label = d.labelKey === 'AVAILABLE_LAST_KNOWN' ? LAST_KNOWN[mode] || LAST_KNOWN.broker : STATUS_LABEL[d.labelKey] || STATUS_LABEL.UNKNOWN;
    return Object.freeze({ status: d.status, label, badgeStyleToken: d.badgeStyleToken, freshness: d.freshness, freshnessLabel: mode === 'client' ? null : FRESHNESS_LABEL[d.freshness],
      updatedAtLabel: d.updatedAt && mode !== 'client' ? `Atualizado em ${fmtDate(d.updatedAt)}` : null, warning: d.warningKey ? WARNING_LABEL[d.warningKey] : null,
      offerability: d.offerability, offerabilityLabel: mode === 'client' ? null : OFFERABILITY_LABEL[d.offerability], capabilities: d.capabilities,
      reason: d.reasonCode ? REASON_LABEL[d.reasonCode] || null : null, technicalMeta: d.technicalMeta });
  }
  /** price block view model from a CommercialLotContext (price facts only) */
  function priceVM(ctx, mode = 'broker') {
    const p = ctx.price, hidden = p.display === 'HIDE';
    const label = p.display === 'LAST' ? 'Último preço de tabela' : 'Preço de tabela';
    const text = p.status === 'VALID' ? App.fmt.formatBRL(p.amount) : p.status === 'WITHHELD' ? 'Consulte condição comercial' : p.status === 'CONFLICTED' ? 'Preço com divergência — confirmar' : 'Preço não disponível';
    const note = p.status !== 'VALID' ? null : p.freshness === 'FRESH' ? null : p.freshness === 'EXPIRED' ? (mode === 'client' ? 'Valor sujeito a confirmação' : 'Tabela vencida: não use para fechar negócio') : (mode === 'client' ? 'Valor sujeito a confirmação' : 'Baseado na última tabela disponível');
    return Object.freeze({ hidden, label, text, perM2: p.status === 'VALID' && p.pricePerM2 != null ? App.fmt.formatPricePerM2(p.pricePerM2) : null, status: p.status,
      dataStatus: p.status === 'VALID' ? 'CALCULATED' : 'UNKNOWN', note, tableVersion: mode === 'technical' ? p.priceTableVersion : null });
  }
  const SIM_REASON = { PRICE: 'Simulação indisponível: lote sem preço de tabela utilizável.', AVAILABILITY: 'Simulação indisponível para este status.' };
  const SHARE_STATUS = { AVAILABLE_CONFIRMED: 'Disponível', LAST_KNOWN_AVAILABLE: 'Último status conhecido: disponível. Confirmar disponibilidade.', TO_CONFIRM: 'Disponibilidade a confirmar.' };
  /** status line for share texts (never "disponível" from a stale or unknown status) */
  const shareStatusText = (lot, o = {}) => { const c = AV.shareClaim(lot, o); return c.claim === 'STATUS' ? STATUS_LABEL[c.status] : SHARE_STATUS[c.claim]; };
  /** commercialVM(lot, { mode, policy, now, offline }) → { availability, price, simulation, shareStatus, versionRefs } */
  function commercialVM(lot, o = {}) {
    const mode = o.mode || 'broker', ctx = AV.composeCommercialContext(lot, { ...o, mode });
    return Object.freeze({ lotId: ctx.lotId, availability: availabilityVM(lot, o), price: priceVM(ctx, mode),
      simulation: { allowed: ctx.simulation.allowed, consultative: ctx.simulation.consultative, reason: ctx.simulation.blockedBy ? SIM_REASON[ctx.simulation.blockedBy] : ctx.simulation.consultative ? 'Simulação apenas consultiva: o lote não está disponível para oferta.' : null },
      shareStatus: shareStatusText(lot, o), versionRefs: mode === 'technical' ? ctx.versionRefs : null, context: ctx });
  }

  // ------------------------------------------------------------------ render: commercial blocks (status and price apart)
  const renderStatusBlock = vm => `<section class="pv-block pv-status" aria-label="Disponibilidade"><h4 class="pv-h">Disponibilidade</h4>`
    + `<p class="pv-badge ${esc(vm.badgeStyleToken)}"><span class="pv-dot" aria-hidden="true"></span>${esc(vm.label)}</p>`
    + (vm.freshnessLabel ? `<p class="pv-meta">${esc(vm.freshnessLabel)}${vm.updatedAtLabel ? ' · ' + esc(vm.updatedAtLabel) : ''}</p>` : '')
    + (vm.offerabilityLabel ? `<p class="pv-meta">${esc(vm.offerabilityLabel)}</p>` : '') + (vm.reason ? `<p class="pv-meta">Motivo: ${esc(vm.reason)}</p>` : '')
    + (vm.warning ? `<p class="pv-warn" role="note">${esc(vm.warning)}</p>` : '')
    + (vm.technicalMeta ? `<p class="pv-tech">revisão ${esc(vm.technicalMeta.revision)} · fonte ${esc(vm.technicalMeta.sourceId || '—')} · dado ${esc(vm.technicalMeta.dataState)}</p>` : '') + `</section>`;
  const renderPriceBlock = vm => vm.hidden ? '' : `<section class="pv-block pv-price" aria-label="${esc(vm.label)}"><h4 class="pv-h">${esc(vm.label)}</h4>`
    + `<p class="pv-value">${esc(vm.text)}</p>` + (vm.perM2 ? `<p class="pv-meta">${esc(vm.perM2)} · calculado (área × R$/m² da tabela)</p>` : '')
    + (vm.note ? `<p class="pv-warn" role="note">${esc(vm.note)}</p>` : '') + (vm.tableVersion ? `<p class="pv-tech">tabela ${esc(vm.tableVersion)}</p>` : '') + `</section>`;
  /** both blocks, side by side (stacked on narrow widths) */
  const renderCommercialBlocks = vm => `<div class="pv-commercial">${renderStatusBlock(vm.availability)}${renderPriceBlock(vm.price)}</div>`;

  // ------------------------------------------------------------------ render: price history (topic 28)
  /** quick view line: "+5,4% desde 08/2026" only when the domain allows; empty string otherwise */
  const renderQuickViewPriceChange = qv => !qv || !qv.visible ? '' : `<p class="pv-qv-change" title="${esc(qv.title)}"><span class="pv-k">${esc(qv.label)}</span> ${esc(qv.text)}</p>`;
  /** step chart SVG from a PriceHistoryChartViewModel: horizontal/vertical segments only, gaps dashed and labelled; the table carries the same facts */
  function renderStepChart(ch, o = {}) {
    const W = o.width || 320, H = o.height || 120, pad = { l: 8, r: 8, t: 14, b: 18 };
    const t0 = Date.parse(ch.xAxis.from), t1 = Math.max(Date.parse(ch.xAxis.to), t0 + 86400000);
    const x = d => pad.l + (Date.parse(d) - t0) / (t1 - t0) * (W - pad.l - pad.r);
    const lo = ch.yAxis.min, hi = ch.yAxis.max, y = v => lo == null ? H / 2 : hi === lo ? (pad.t + H - pad.b) / 2 : pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b);
    let path = '', prevY = null;
    for (const s of ch.intervals) { const yy = y(s.y).toFixed(1); path += prevY == null ? `M${x(s.x0).toFixed(1)} ${yy}` : ` V${yy}`; path += ` H${x(s.x1).toFixed(1)}`; prevY = yy; }
    const gaps = ch.gapSegments.map(g => `<line class="pv-gap" x1="${x(g.x0).toFixed(1)}" x2="${x(g.x1).toFixed(1)}" y1="${H - pad.b}" y2="${H - pad.b}"><title>${esc(g.tooltip)}</title></line>`).join('');
    const pts = ch.points.filter(p => p.y != null).map(p => `<circle class="pv-pt" cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.5"><title>${esc(p.tooltip)}</title></circle>`).join('');
    const marks = ch.markers.map(m => `<text class="pv-mark" x="${x(m.x).toFixed(1)}" y="${pad.t - 3}" text-anchor="middle">${m.changeType === 'INCREASE' ? '▲' : m.changeType === 'DECREASE' ? '▼' : '•'}<title>${esc(m.label)}</title></text>`).join('');
    const ann = ch.annotations.map(a => `<text class="pv-ann" x="${W / 2}" y="${H - 4}" text-anchor="middle">${esc(a.text)}</text>`).join('');
    return `<svg class="pv-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gráfico em degraus do preço de tabela; os mesmos dados estão na tabela abaixo" data-series="${esc(ch.seriesType)}" data-interpolation="${esc(ch.interpolation)}">`
      + `<path class="pv-step" d="${path}" fill="none"/>${gaps}${pts}${marks}${ann}</svg>`;
  }
  const renderAccessibleTable = rows => `<table class="pv-table"><caption>Histórico do preço de tabela</caption><thead><tr><th scope="col">Vigência</th><th scope="col">Preço de tabela</th><th scope="col">Mudança</th></tr></thead><tbody>`
    + rows.map(r => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.price || 'Sem preço registrado')}</td><td>${esc(r.change || r.text)}</td></tr>`).join('') + `</tbody></table>`
    + `<ul class="pv-sr">${rows.map(r => `<li>${esc(r.text)}${r.change ? ' ' + esc(r.change) : ''}</li>`).join('')}</ul>`;
  /** full details section from a PriceHistoryViewModel */
  function renderHistorySection(vm) {
    const s = vm.summary, row = (k, f) => f ? `<div class="pv-row"><dt>${esc(k)}</dt><dd data-status="${esc(f.dataStatus)}">${esc(f.text)}</dd></div>` : '';
    const periods = vm.periodOptions.map(p => `<option value="${esc(p.id)}"${p.enabled ? '' : ' disabled'}${p.id === 'SINCE_FIRST' ? ' selected' : ''}>${esc(p.label)}${p.reason ? ' — ' + esc(p.reason) : ''}</option>`).join('');
    const tech = vm.technicalDetails ? `<details class="pv-techbox"><summary>Detalhes técnicos</summary><ul>${vm.technicalDetails.versions.map(v => `<li>${esc(v.id)} · versão ${esc(v.label)} · vigência ${esc(fmtDate(v.effectiveFrom))} (${esc(v.effectiveFromBasis)}) · ${esc(v.status)} · checksum ${esc(v.checksum)}</li>`).join('')}</ul>`
      + `<p>Metodologia ${esc(vm.technicalDetails.methodologyVersion)} · lacunas: ${esc(vm.technicalDetails.gaps.length)}</p></details>` : '';
    return `<section class="pv-history" aria-label="Histórico de preço de tabela"><h3 class="pv-title">${esc(s.title)}</h3>`
      + (vm.offlinePartial ? `<p class="pv-warn" role="note">Histórico parcial disponível offline.</p>` : '')
      + (vm.mode === 'presentation' ? '' : `<label class="pv-period">Período <select data-pv-period>${periods}</select></label>`)
      + `<p class="pv-meta">${esc(s.periodLabel)}</p><dl class="pv-summary">${row('Preço de tabela atual', s.currentPrice)}${row('Primeiro preço registrado', s.initialPrice)}`
      + `${row('Variação (R$)', s.absoluteChange)}${row('Variação (%)', s.relativeChange)}${row('Variação anualizada nominal', s.cagrNominal)}${row('R$/m² atual', s.currentPricePerM2)}${row('R$/m² inicial', s.initialPricePerM2)}</dl>`
      + renderStepChart(vm.chart) + renderAccessibleTable(vm.accessibleRows)
      + `<p class="pv-meta">${esc(s.dataQualityLabel)}</p>` + s.caveats.map(c => `<p class="pv-warn" role="note">${esc(c)}</p>`).join('')
      + `<p class="pv-disclaimer">${esc(vm.disclaimer)}</p>${tech}</section>`;
  }
  return Object.freeze({ STATUS_LABEL, FRESHNESS_LABEL, OFFERABILITY_LABEL, availabilityVM, priceVM, commercialVM, shareStatusText, renderStatusBlock, renderPriceBlock, renderCommercialBlocks,
    renderQuickViewPriceChange, renderStepChart, renderAccessibleTable, renderHistorySection, esc });
})();
