/* customer/customerView.js — topics 39/40 UI strings (markup only, no DOM access, no state). Map-centric: a context chip,
   the customer workspace tabs (Resumo · Jornada · Perfil · Favoritos · Comparações · Recomendações) and a light journey panel.
   Uses the app's delegated data-act actions: custClear (existing: "Sair do contexto do cliente"), custTab (data-tab),
   jnyOpen, jnyMove (data-to, data-rev), jnyNextDone (data-id, data-rev), jnyTouch, jnyOption (data-id).
   Never renders phone/e-mail in the header, never promises valorização, never shows lot availability as confirmed. */
App.customerView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = Object.freeze([['summary', 'Resumo'], ['journey', 'Jornada'], ['profile', 'Perfil'], ['favorites', 'Favoritos'], ['comparisons', 'Comparações'], ['recommendations', 'Recomendações']]);
  const READ = { OPEN: 'Em aberto', DUE_SOON: 'Vence em breve', OVERDUE: 'Atrasada', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' };
  const ATT = { ON_TRACK: 'Em dia', ACTION_DUE: 'Ação pendente', OVERDUE: 'Follow-up atrasado', WAITING_CUSTOMER: 'Aguardando o cliente', WAITING_INTERNAL: 'Aguardando equipe', PAUSED: 'Pausada', CLOSED: 'Encerrada', UNKNOWN: 'Sem próxima ação definida' };
  const date = s => { if (!s) return ''; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  /** contextChip({ label, device }) — label from App.customer.context.headerLabel / App.journey.domain.contextChip */
  function contextChip(vm) {
    if (!vm || !vm.label) return '';
    return `<div class="custchip" role="status" aria-live="polite"><span>${esc(vm.label)}</span><button class="lbtn small" data-act="custClear" aria-label="Sair do contexto do cliente" title="Sair do contexto do cliente">×</button></div>`;
  }
  /** tabs(active) — workspace tabs; the map stays the main surface */
  const tabs = active => `<div class="custtabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-act="custTab" data-tab="${id}" aria-selected="${id === active}">${esc(l)}</button>`).join('')}</div>`;
  /** journeyPanel({ available, summary, timeline, allowedMoves, suggestions, revision }) */
  function journeyPanel(vm = {}) {
    if (!vm.available) return `<div class="card"><p class="muted">A jornada comercial é registrada no servidor da organização. Neste aparelho (modo sem login) ela não fica disponível.</p></div>`;
    if (!vm.summary) return `<div class="card"><p class="muted">Este cliente ainda não tem jornada neste empreendimento.</p>${vm.canCreate ? `<button class="btn" data-act="jnyOpen">Abrir jornada</button>` : ''}</div>`;
    const s = vm.summary, rev = esc(vm.revision);
    let h = `<div class="card jny"><div class="lh1"><h3>${esc(s.currentStage ? s.currentStage.title : 'Etapa não definida')}</h3><span class="small">${esc(ATT[s.attentionState] || '')}</span></div>`;
    h += s.nextAction ? `<p><b>Próxima ação:</b> ${esc(s.nextAction.title)}${s.nextAction.dueAt ? ` · ${esc(date(s.nextAction.dueAt))}` : ''} <span class="small">(${esc(READ[s.nextAction.readState] || '')})</span> <button class="lbtn small" data-act="jnyNextDone" data-id="${esc(s.nextAction.id)}" data-rev="${rev}">Concluir</button></p>` : `<p class="muted">Defina a próxima ação (pode ser "Aguardar o cliente").</p>`;
    if ((vm.allowedMoves || []).length) h += `<div class="acts2" role="group" aria-label="Mudar etapa">${vm.allowedMoves.filter(m => !m.requiresOutcome).map(m => `<button class="btn small" data-act="jnyMove" data-to="${esc(m.toStageId)}" data-rev="${rev}"${m.requireReason ? ' data-reason="1"' : ''}>${esc(m.title)}</button>`).join('')}</div>`;
    for (const sg of vm.suggestions || []) h += `<p class="small">Sugestão: ${esc(sg.text)} <span class="muted">(não aplicada automaticamente)</span></p>`;
    h += `<div class="acts2"><button class="btn" data-act="jnyTouch">Registrar contato</button></div>`;
    const items = (vm.timeline && vm.timeline.items) || [];
    h += items.length ? `<ol class="jny-tl">${items.map(i => `<li><time datetime="${esc(i.occurredAt)}">${esc(date(i.occurredAt))}</time> ${esc(i.text)}${i.corrected ? ' <span class="small">(corrigido)</span>' : ''}</li>`).join('')}</ol>` : `<p class="muted">Sem eventos registrados.</p>`;
    return h + `</div>`;
  }
  /** optionPresentedButton(lotId) — QuickView action "Registrar como opção apresentada" (explicit; opening the lot records nothing) */
  const optionPresentedButton = (lotId, enabled) => enabled ? `<button class="lbtn small" data-act="jnyOption" data-id="${esc(lotId)}">Registrar como opção apresentada</button>` : '';
  return Object.freeze({ TABS, contextChip, tabs, journeyPanel, optionPresentedButton, esc });
})();
