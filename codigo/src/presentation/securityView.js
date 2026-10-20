/* presentation/securityView.js — pure HTML-string renderers for access control (topics 30/31).
   Organization/role context chip, "acesso negado" state, session banner, guarded buttons.
   Input = App.authz.viewModel() / App.authz.feature()/action() results. No DOM access, no state,
   no new data-act (the chip is a native <details> disclosure). Hiding/disabling is UX only. */
App.securityView = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SESSION_LABEL = { ANONYMOUS: 'Sem login (visitante)', ACTIVE: 'Sessão ativa', EXPIRED: 'Sessão expirada', REVOKED: 'Sessão encerrada', INVALID: 'Sessão inválida', NONE: 'Sem sessão' };

  /** contextChip(vm) — "House 7 Imóveis · Visitante"; expands to organization, development, roles, session and the frontend limitation. */
  function contextChip(vm) {
    if (!vm) return '';
    const org = vm.activeScope && vm.activeScope.organization, who = vm.principalSummary || {};
    const label = `${org ? esc(org.displayName) : 'Organização não identificada'} · ${esc(vm.authenticated ? (who.roleSummary || who.displayName) : 'Visitante')}`;
    const rows = [
      ['Organização', org ? esc(org.displayName) + (org.status && org.status !== 'ACTIVE' ? ` (${esc(org.status)})` : '') : 'não identificada'],
      ['Empreendimento', esc(vm.activeScope && vm.activeScope.developmentId || '—')],
      ['Acesso', vm.authenticated ? esc(who.displayName) + (who.roleSummary ? ' · ' + esc(who.roleSummary) : '') : 'Visitante (somente leitura pública)'],
      ['Sessão', esc(SESSION_LABEL[vm.sessionState] || vm.sessionState)]
    ];
    if (vm.activeScope && vm.activeScope.memberships && vm.activeScope.memberships.length > 1) rows.push(['Outras organizações', vm.activeScope.memberships.length - 1 + ' (troca valida no servidor)']);
    return `<details class="sec-chip${vm.authenticated ? ' auth' : ''}"><summary aria-label="Contexto de acesso: ${label}"><span class="sec-dot" aria-hidden="true"></span><span class="sec-lbl">${label}</span></summary>`
      + `<div class="sec-pop"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
      + (vm.warnings || []).map(w => `<p class="sec-warn">${esc(w)}</p>`).join('')
      + `<p class="sec-note">${esc(vm.limitation)}</p></div></details>`;
  }

  /** deniedState(result, { title }) — block shown instead of a section/route the user cannot access.
      Message comes from the decision and never reveals whether a hidden resource exists. */
  function deniedState(result, opts = {}) {
    const msg = (result && result.message) || 'Você não possui permissão para acessar este conteúdo.';
    return `<div class="sec-denied" role="status"><p class="sec-denied-t">${esc(opts.title || 'Acesso negado')}</p><p>${esc(msg)}</p>`
      + (result && (result.reason === 'AUTH_REQUIRED' || result.reason === 'SESSION_EXPIRED') ? '<p class="small">O acesso de visitante continua disponível para mapa, preços de tabela, simulação e comparação.</p>' : '')
      + '</div>';
  }

  /** sessionBanner(vm) — only when something needs attention (expired session, stale permissions, dev identity). */
  function sessionBanner(vm) {
    if (!vm) return '';
    const msgs = [];
    if (vm.sessionState === 'EXPIRED') msgs.push('Sua sessão expirou. Seus rascunhos locais foram mantidos; entre novamente antes de enviar alterações.');
    for (const w of vm.warnings || []) if (!/^Acesso público/.test(w)) msgs.push(w);
    return msgs.length ? `<div class="sec-banner" role="status">${msgs.map(m => `<p>${esc(m)}</p>`).join('')}</div>` : '';
  }

  /** attrs(result) — attributes for a control guarded by a feature/action result: '' when allowed.
      Disabled controls stay focusable (aria-disabled, not disabled) and carry the explanation (§285–287). */
  function attrs(result) {
    if (!result || result.allowed) return '';
    return ` aria-disabled="true" data-denied="${esc(result.reason)}" title="${esc(result.message)}" aria-label="${esc(result.message)}"`;
  }
  /** guarded(result, html) — '' when the feature must be hidden, otherwise html (caller adds attrs() to the control). */
  const guarded = (result, html) => (!result || !result.visible) ? '' : html;

  /** button(result, { act, label, cls, data }) — renders a guarded button or nothing. */
  function button(result, o = {}) {
    if (!result || !result.visible) return '';
    const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
    const why = result.allowed ? '' : `<span class="sec-why">${esc(result.message)}</span>`;
    return `<button class="btn${o.cls ? ' ' + esc(o.cls) : ''}" type="button"${o.act ? ` data-act="${esc(o.act)}"` : ''}${data}${attrs(result)}>${esc(o.label || '')}</button>${why}`;
  }
  return Object.freeze({ contextChip, deniedState, sessionBanner, attrs, guarded, button, esc });
})();
