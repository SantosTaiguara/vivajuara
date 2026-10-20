/* decision/decisionView.js — topic 56 UI strings (markup only: no DOM access, no state, no calculation).
   Input = App.decision.services.viewModel(result, …) / clientSafe(result, …) / quickViewBlock(…).
   Broker panel "O que mostrar a este cliente — e por quê": context line, stage (Descobrir · Selecionar · Comparar · Decidir),
   status, readiness, next step, candidate cards (facts before score; reasons, points of attention, availability caveat),
   the selection (shortlist) and its actions. Never promises valorização, never shows availability UNKNOWN as confirmed.
   data-act used: goLot, explain, cmp, openFind (existing) · decMode, decShortlist, decFavCust, decCompareShortlist, decPresent, decRefresh (new). */
App.decisionView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TONE = { CONFIRMED_OPTIONS: 'ok', OPTIONS_PENDING_CONFIRMATION: 'warn', NO_STRONG_MATCH: 'warn', NO_ELIGIBLE_LOTS: 'warn', INSUFFICIENT_CONTEXT: 'info', INVALID_CONTEXT: 'warn' };
  const ACT_LABEL = { decCompareShortlist: 'Comparar', decPresent: 'Preparar', openFind: 'Ajustar perfil' };
  function card(c, i) {
    const reasons = c.reasons.length ? `<ul class="dcs-pros" aria-label="Por que mostrar">${c.reasons.map(r => `<li><span aria-hidden="true">+</span> ${esc(r.text)}${r.facts && r.facts.length ? ` <span class="small">${esc(r.facts.join(' · '))}</span>` : ''}</li>`).join('')}</ul>` : '';
    const cons = c.tradeoffs.length ? `<ul class="dcs-cons" aria-label="Pontos de atenção">${c.tradeoffs.map(t => `<li class="sev-${esc(String(t.severity || '').toLowerCase())}"><span aria-hidden="true">!</span> ${esc(t.text)}</li>`).join('')}</ul>` : '';
    const obj = c.objective && c.objective.facts && c.objective.facts.length ? `<details class="dcs-obj"><summary>${esc(c.objective.title)}</summary><ul>${c.objective.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details>` : '';
    return `<li class="dcs-card${c.inShortlist ? ' in' : ''}" data-lot="${esc(c.lotId)}">
      <div class="dcs-ch"><button class="nm" data-act="goLot" data-id="${esc(c.lotId)}" aria-label="Ver ${esc(c.code)} no mapa">${esc(c.code)}</button><span class="dcs-pos">${esc(c.position)}</span>${c.tier ? `<span class="dcs-tier">${esc(c.tier)}</span>` : ''}</div>
      ${c.curated ? `<p class="small dcs-cur">${esc(c.curated)}</p>` : ''}${c.breach ? `<p class="dcs-breach">${esc(c.breach)}</p>` : ''}
      <p class="dcs-facts"><b>${esc(c.price)}</b> · ${esc(c.area)}</p>
      <p class="dcs-av ${c.availabilityTone === 'ok' ? 'ok' : 'warn'}">${esc(c.availability)}</p>
      ${reasons}${cons}
      ${c.fit ? `<p class="small">${esc(c.fit)} · ${esc(c.dataQuality)}</p>` : `<p class="small">${esc(c.dataQuality)}</p>`}
      ${c.financial ? `<p class="small dcs-fin">${esc(c.financial)}</p>` : ''}${obj}
      <div class="dcs-acts">
        <button class="lbtn small" data-act="goLot" data-id="${esc(c.lotId)}">Ver no mapa</button>
        <button class="lbtn small" data-act="explain" data-id="${esc(c.lotId)}" aria-label="Por que ${esc(c.code)} está nesta posição">Por quê?</button>
        <button class="lbtn small" data-act="decShortlist" data-id="${esc(c.lotId)}" data-op="${c.inShortlist ? 'remove' : 'add'}" aria-pressed="${!!c.inShortlist}">${c.inShortlist ? 'Tirar da seleção' : 'Adicionar à seleção'}</button>
        <button class="lbtn small" data-act="cmp" data-id="${esc(c.lotId)}" aria-pressed="${!!c.compared}">${c.compared ? 'Na comparação' : 'Comparar'}</button>
        <button class="lbtn small" data-act="decFavCust" data-id="${esc(c.lotId)}" aria-pressed="${!!c.favorite}">${c.favorite ? 'Favorito do cliente' : 'Favoritar para o cliente'}</button>
      </div></li>`;
  }
  /** panel(vm) → broker panel HTML (vm = App.decision.services.viewModel(result, { context, shortlist, … })) */
  function panel(vm) {
    if (!vm) return '';
    const h = vm.header, tone = TONE[vm.status.code] || 'info';
    let s = `<section class="dcs" aria-labelledby="dcsT"><header class="dcs-h"><h3 id="dcsT">${esc(h.title)}</h3>
      <p class="dcs-ctx small"><span>${esc(h.customerLabel)}</span> · <span>${esc(h.objective)}</span>${h.budget ? ` · <span>${esc(h.budget)}</span>` : ''}</p>
      <div class="seg dcs-modes" role="group" aria-label="Etapa da decisão">${h.modes.map(m => `<button data-act="decMode" data-mode="${esc(m.id)}" aria-pressed="${m.active}">${esc(m.label)}</button>`).join('')}</div></header>
      <div class="dcs-status ${tone}" role="status"><b>${esc(vm.status.title)}</b><p>${esc(vm.status.text)}</p></div>`;
    if (vm.validation.length) s += `<ul class="dcs-val small">${vm.validation.map(v => `<li>${esc(v)}</li>`).join('')}</ul>`;
    if (vm.readiness && vm.readiness.label) s += `<p class="dcs-ready"><b>${esc(vm.readiness.label)}</b>${vm.readiness.items.length ? ` <span class="small">· ${esc(vm.readiness.items.join(' · '))}</span>` : ''}</p>`;
    if (vm.nextAction) s += `<div class="dcs-nba"><span class="small">Próximo passo sugerido</span><p>${esc(vm.nextAction.text)}</p>${vm.nextAction.act ? `<button class="btn sm" data-act="${esc(vm.nextAction.act)}">${esc(ACT_LABEL[vm.nextAction.act] || 'Abrir')}</button>` : ''}${vm.otherActions.length ? `<p class="small">Depois: ${esc(vm.otherActions.map(a => a.text).join(' · '))}</p>` : ''}</div>`;
    if (vm.cards.length) s += `<ol class="dcs-cards">${vm.cards.map(card).join('')}</ol>`;
    if (vm.resolution.length) s += `<div class="dcs-res"><b>Para avançar</b><ul>${vm.resolution.map(r => `<li>${esc(r)}</li>`).join('')}</ul><p class="small">Nenhum critério é alterado sem a sua confirmação.</p></div>`;
    const sl = vm.shortlist;
    s += `<div class="dcs-sl"><p><b>Seleção para o cliente:</b> ${sl.count} de até ${sl.max}</p>`;
    if (sl.portfolio && sl.count) s += `<p class="small">${esc(sl.portfolio.coverageSummary.budgetCoverage)} · ${esc(sl.portfolio.coverageSummary.locationDiversity)}${sl.portfolio.gaps.length ? ' · ' + esc(sl.portfolio.gaps.join(' · ')) : ''}${sl.portfolio.duplicatedProfiles.length ? ' · Opções muito parecidas: ' + esc(sl.portfolio.duplicatedProfiles.join(', ')) : ''}</p>`;
    s += `<div class="dcs-acts"><button class="btn sm" data-act="decCompareShortlist"${sl.count < 2 ? ' disabled' : ''}>Comparar a seleção</button><button class="btn sm" data-act="decPresent"${sl.count < 1 ? ' disabled' : ''}>Apresentar a seleção</button><button class="lbtn small" data-act="decRefresh">Atualizar recomendação</button></div></div>`;
    if (vm.exclusions.length) s += `<details class="dcs-ex"><summary>Fora da recomendação</summary><ul class="small">${vm.exclusions.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small">Exigências não são afrouxadas automaticamente.</p></details>`;
    return s + `<ul class="dcs-cav small">${vm.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></section>`;
  }
  /** clientList(cs) → client-safe list (cs = App.decision.services.clientSafe(result, …)): facts only, no score, no internal codes */
  function clientList(cs) {
    if (!cs || !cs.items.length) return '';
    return `<section class="dcs dcs-client"><h3>${esc(cs.title)}</h3><ol class="dcs-cards">${cs.items.map(i => `<li class="dcs-card"><div class="dcs-ch"><b>${esc(i.lot)}</b></div><p class="dcs-facts"><b>${esc(i.price)}</b> · ${esc(i.area)}</p><p class="dcs-av warn">${esc(i.availability)}</p>
      ${i.highlights.length ? `<ul class="dcs-pros">${i.highlights.map(x => `<li><span aria-hidden="true">+</span> ${esc(x)}</li>`).join('')}</ul>` : ''}${i.attention ? `<p class="small">Atenção: ${esc(i.attention)}</p>` : ''}${i.note ? `<p class="small">${esc(i.note)}</p>` : ''}</li>`).join('')}</ol>
      <ul class="dcs-cav small">${cs.footer.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>`;
  }
  /** quickViewBlock(block) → "Para este cliente" block for the Quick View (block = App.decision.services.quickViewBlock(…)) */
  const quickView = b => b && b.lines.length ? `<div class="dcs-qv"><b>${esc(b.title)}</b><ul>${b.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>` : '';
  /** overrideConfirm({ lotCode, breaches, reasons }) → modal body asking for a reason when the lot breaks a criterion (FAIL stays visible) */
  function overrideConfirm({ lotId, lotCode, breaches = [], reasons = [] } = {}) {
    const B = { PRICE_ABOVE_MAX: 'Este lote excede o orçamento máximo informado.', REVIEW_REQUIRED: 'Este lote precisa de confirmação (disponibilidade ou dado pendente).', INELIGIBLE: 'Este lote não atende a uma exigência do cliente.' };
    const lines = [...new Set(breaches.map(b => B[b] || 'Este lote não atende a todos os critérios informados.'))];
    return `<div class="dcs-ov"><p><b>${esc(lotCode)}</b></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p>Deseja incluí-lo mesmo assim? O critério não atendido continua visível.</p>
      <div class="fld"><label for="dcsReason">Motivo</label><select id="dcsReason" data-in="decReason">${reasons.map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select></div>
      <div class="fld"><label for="dcsNote">Observação interna (não aparece para o cliente)</label><input id="dcsNote" data-in="decNote" maxlength="500"></div>
      <div class="acts2"><button class="btn pri" data-act="decShortlist" data-id="${esc(lotId)}" data-op="add" data-ack="1">Incluir assim mesmo</button><button class="btn" data-act="closeModal">Cancelar</button></div></div>`;
  }
  return Object.freeze({ panel, card, clientList, quickView, overrideConfirm, esc, ACTS: Object.freeze(['decMode', 'decShortlist', 'decFavCust', 'decCompareShortlist', 'decPresent', 'decRefresh']) });
})();
