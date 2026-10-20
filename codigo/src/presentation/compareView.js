/* presentation/compareView.js — renders the EvaluatedComparisonViewModel (App.compare.viewModel) as HTML strings.
   Same view model on desktop, tablet and mobile: only CSS changes (cards scroll horizontally on narrow screens; each group
   is a <details> with its own accessible table: lots are column headers, criteria are row headers).
   Buttons use the app's delegated data-act actions: goLot, cmpRemove, cmpMove (data-dir -1|1), cmpProfile (data-v), shareCmp, cmpClear.
   Highlights are badges with text (never color alone) and there is no overall "best lot". Markup only, no DOM access in render. */
App.compareView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ComparisonUiState (kept apart from the domain): open groups, chosen metric profile, focused candidate
  const ui = { profileId: null, expanded: {}, focusedCandidateId: null, layoutVariant: null };
  let last = null; // previous fromState result (session identity + selective re-evaluation)

  function cand(c, vm) {
    const client = vm.mode === 'client' || vm.mode === 'presentation';
    return `<li class="cmpv-cand${c.missing ? ' missing' : ''}" data-id="${esc(c.id)}">
      <div class="cmpv-ch"><span class="pinlbl" aria-hidden="true">${c.order}</span><button class="lbtn nm" data-act="goLot" data-id="${esc(c.id)}" aria-label="Abrir ${esc(c.name)} no mapa">${esc(c.title)}</button></div>
      <p class="cmpv-st${c.statusWarn ? ' warn' : ''}"><span class="vh">Situação: </span>${esc(c.statusLabel)}</p>
      <p class="cmpv-pr"><span class="vh">Preço de tabela: </span>${esc(c.priceText)}${c.priceNote ? ` <span class="small">(${esc(c.priceNote)})</span>` : ''}</p>
      <p class="small"><span class="vh">Área: </span>${esc(c.areaText)}</p>
      ${c.criterionSummary && c.criterionSummary.text ? `<p class="cmpv-cs">${esc(c.criterionSummary.text)}</p>` : ''}
      ${c.outsideFilter ? `<p class="small warnl">Fora dos filtros atuais</p>` : ''}${!client && c.recommendationText ? `<p class="small">${esc(c.recommendationText)}</p>` : ''}
      <div class="cmpv-ca" role="group" aria-label="Ações de ${esc(c.name)}">
        <button class="lbtn small" data-act="cmpMove" data-id="${esc(c.id)}" data-dir="-1"${c.canMoveLeft ? '' : ' disabled'} aria-label="Mover ${esc(c.name)} para a esquerda" title="Mover para a esquerda">◀</button>
        <button class="lbtn small" data-act="cmpMove" data-id="${esc(c.id)}" data-dir="1"${c.canMoveRight ? '' : ' disabled'} aria-label="Mover ${esc(c.name)} para a direita" title="Mover para a direita">▶</button>
        <button class="lbtn small" data-act="cmpRemove" data-id="${esc(c.id)}" aria-label="Remover ${esc(c.name)} da comparação">Remover</button>
      </div></li>`;
  }
  function row(r, vm, cols) {
    const ev = r.evaluation, tech = vm.mode === 'technical';
    const cells = r.cells.map(c => `<td class="cs-${c.cellState.toLowerCase()}${c.emphasis ? ' emph' : ''}" aria-label="${esc(c.ariaLabel)}"><span class="v">${esc(c.text)}</span>${c.note ? `<span class="nt">${esc(c.note)}</span>` : ''}${c.badge ? `<span class="bdg bdg-${c.cellState.toLowerCase()}">${c.cellState === 'WINNER' ? '★ ' : c.cellState === 'CO_WINNER' ? '= ' : '≈ '}${esc(c.badge)}</span>` : ''}</td>`).join('');
    const why = [ev.explanationText, ev.caveatText, tech ? ev.policyText : null].filter(Boolean);
    return `<tr class="${r.emphasis ? 'emph ' : ''}hl-${ev.highlightMode}"><th scope="row">${esc(r.label)}${r.emphasis ? ' <span class="vh">(camada ativa no mapa)</span>' : ''}${tech && r.hiddenInNormalMode ? ' <span class="small">(oculto fora do modo técnico)</span>' : ''}</th>${cells}</tr>`
      + (why.length ? `<tr class="cmpv-why"><td colspan="${cols + 1}">${why.map((x, i) => `<span class="${i ? 'small' : ''}">${esc(x)}</span>`).join(' ')}</td></tr>` : '');
  }
  function group(g, vm) {
    const open = ui.expanded[g.id] != null ? ui.expanded[g.id] : !g.collapsedByDefault, names = vm.candidates.map(c => c.name);
    const body = g.empty ? `<p class="small cmpv-empty">${esc(g.emptyText)}</p>` : `<div class="cmpv-scroll" role="region" aria-label="${esc(g.label)}" tabindex="0"><table class="cmpv-t">
      <caption class="vh">${esc(g.label)}: comparação entre ${esc(names.join(', '))}</caption>
      <thead><tr><th scope="col"><span class="vh">Critério</span></th>${vm.candidates.map(c => `<th scope="col"><span class="pinlbl" aria-hidden="true">${c.order}</span> ${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>${g.rows.map(r => row(r, vm, vm.candidates.length)).join('')}</tbody></table></div>`;
    return `<details class="cmpv-grp" data-group="${esc(g.id)}"${open ? ' open' : ''}><summary><span>${esc(g.label)}</span> <span class="small">${g.rows.length} ${g.rows.length === 1 ? 'critério' : 'critérios'}</span></summary>${body}</details>`;
  }
  /** render(vm) → HTML string (content of the comparison overlay body). vm = null renders the empty state. */
  function render(vm) {
    if (!vm) return `<div class="cmpv"><p class="empty">Adicione até 4 lotes pelo botão Comparar no painel do lote.</p></div>`;
    let h = `<div class="cmpv" data-mode="${esc(vm.mode)}" data-status="${esc(vm.status)}">`;
    h += `<div class="cmpv-top"><p class="small cmpv-count">${esc(vm.countLabel)} lotes${vm.canCompare ? '' : ' · ' + esc(vm.summaryMessage)}</p>`;
    if (vm.profiles && vm.profiles.length) h += `<div class="cmpv-prof" role="group" aria-label="Conjunto de critérios">${vm.profiles.map(p => `<button class="chip" data-act="cmpProfile" data-v="${esc(p.id)}" aria-pressed="${p.selected}">${esc(p.label)}</button>`).join('')}</div>`;
    h += `</div>`;
    if (vm.warnings.length) h += `<ul class="cmpv-warn" role="status">${vm.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    if (vm.criterionHighlights.length) h += `<section class="cmpv-hl" aria-labelledby="cmpvHl"><h3 id="cmpvHl">Destaques por critério</h3><ul>${vm.criterionHighlights.map(x => `<li><b>${esc(x.name)}</b>: ${esc(x.items.join('; '))}</li>`).join('')}</ul>${vm.highlightsNote ? `<p class="small">${esc(vm.highlightsNote)}</p>` : ''}</section>`;
    h += `<ol class="cmpv-cands" aria-label="Lotes em comparação">${vm.candidates.map(c => cand(c, vm)).join('')}</ol>`;
    if (vm.canCompare) h += vm.groups.map(g => group(g, vm)).join('');
    if (vm.fitNote) h += `<p class="small">${esc(vm.fitNote)}</p>`;
    h += `<div class="acts2">${vm.actions.map(a => `<button class="btn" data-act="${esc(a.act)}">${esc(a.label)}</button>`).join('')}</div>`;
    if (vm.completeness && vm.completeness.text) h += `<p class="small">${esc(vm.completeness.text)}</p>`;
    if (vm.technical) h += `<p class="small cmpv-tech">Snapshot ${esc(vm.technical.snapshotHash)} · política de destaque ${esc(fmtV(vm.technical.evaluationPolicyVersion))} · análise ${esc(fmtV(vm.technical.dataVersions.analysisVersion))} · tabela ${esc(fmtV(vm.technical.dataVersions.priceTableVersion))}</p>`;
    h += `<p class="small">${esc(vm.footnote)}</p></div>`;
    return h;
  }
  const fmtV = v => Array.isArray(v) ? v.join(' / ') + ' (divergentes)' : v == null || v === '' ? '—' : v; // a real 0 is a value (topic 37)

  /** view(input) → { html, result }: builds the view model with App.compare.viewModel.fromState (remembering the previous result
      and the UI profile choice) and renders it. input: see App.compare.viewModel.fromState. */
  function view(input) {
    const res = App.compare.viewModel.fromState({ ...input, metricProfileId: input.metricProfileId || ui.profileId || undefined, previous: last && last.session && last.session.developmentId === input.developmentId ? last : null });
    last = res;
    return { html: render(res.vm), result: res };
  }
  /** handle(el, appState) for the delegated actions cmpMove / cmpProfile → { patch?, rerender? } (the caller applies the patch to the app store) */
  function handle(el, st) {
    const act = el && el.dataset ? el.dataset.act : null;
    if (act === 'cmpMove') {
      const ids = (st.comparisonLotIds || []).slice(), i = ids.indexOf(el.dataset.id), j = i + (Number(el.dataset.dir) < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= ids.length) return { patch: null, rerender: false };
      [ids[i], ids[j]] = [ids[j], ids[i]]; ui.focusedCandidateId = el.dataset.id;
      return { patch: { comparisonLotIds: ids }, rerender: false, focus: { act: 'cmpMove', id: el.dataset.id, dir: el.dataset.dir } };
    }
    if (act === 'cmpProfile') { if (App.compare.domain.profile(el.dataset.v)) ui.profileId = el.dataset.v; return { patch: null, rerender: true }; }
    return { patch: null, rerender: false };
  }
  /** bind(root): remembers which groups are open across re-renders (toggle does not bubble: captured once per root) and
      restores keyboard focus on the moved candidate's button. Idempotent. */
  function bind(root) {
    if (!root) return;
    if (!root.__cmpvBound) {
      root.__cmpvBound = true;
      root.addEventListener('toggle', e => { const d = e.target; if (d && d.classList && d.classList.contains('cmpv-grp')) ui.expanded[d.dataset.group] = d.open; }, true);
    }
    if (ui.focusedCandidateId && root.querySelector) {
      const b = root.querySelector(`.cmpv-cand[data-id="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(ui.focusedCandidateId) : ui.focusedCandidateId}"] [data-act="cmpMove"]:not([disabled])`);
      if (b) b.focus(); ui.focusedCandidateId = null;
    }
  }
  const reset = () => { last = null; ui.profileId = null; ui.expanded = {}; };
  return { render, view, handle, bind, reset, ui, esc };
})();
