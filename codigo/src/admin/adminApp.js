/* admin/adminApp.js — boot of the SEPARATE admin shell (dash/admin.html, round 5 / topic 60 §6-7). Not part of the public
   panel (dash/index.html never bundles backoffice/deals/onboarding/dataquality, and entryLink() is '' for the visitor).
   Deny by default: the shell renders only for a context the SERVER confirmed (App.authz.refresh → GET {api}/me with the
   HttpOnly session). localStorage, sessionStorage, URL/hash and DOM never grant anything (App.authz never reads them).
   In the static build there is no backend: the visitor sees only "Acesso restrito" (no queue, no data, no action button),
   and every command answers BACKEND_UNAVAILABLE. No fake data is ever shown.
   App.adminApp.render(state) → HTML string (pure, testable); App.adminApp.boot(root) wires the DOM. */
App.adminApp = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEV = 'viva-juara';
  /** restricted({ loginUrl, reason }) — the only thing an anonymous / unauthorized principal sees: no counts, no existence hints (§514) */
  function restricted(o = {}) {
    const why = o.reason === 'BACKEND_UNAVAILABLE' || !o.loginUrl
      ? 'O login não está disponível nesta versão estática do painel (servidor administrativo não conectado).'
      : 'Entre com uma conta autorizada da organização para continuar.';
    return `<section class="adm-restricted" role="alert" aria-labelledby="adm-r-h"><h1 id="adm-r-h">Acesso restrito</h1>`
      + `<p>Esta área é exclusiva de operadores autorizados. ${esc(why)}</p>`
      + (o.loginUrl ? `<p><a class="adm-login" href="${esc(o.loginUrl)}">Entrar com Google</a></p>` : '')
      + `<p class="adm-small">Nenhum dado administrativo é carregado sem uma sessão confirmada pelo servidor.</p></section>`;
  }
  /** surroundings() — "Localização & Entorno" (topic 63): capability only; flag OFF and coordinate NOT_VALIDATED today */
  function surroundings() {
    const S = App.surroundings, V = App.surroundingsView; if (!S || !S.domain || !V) return '';
    try {
      const cap = S.domain.capability(DEV, { browserKeyConfigured: false, serverKeyConfigured: false, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false });
      return `<section class="bo-sec adm-env">${V.render(V.viewModel({ developmentId: DEV, capability: cap, state: null }))}</section>`;
    } catch (e) { return ''; }
  }
  /** render({ context, nav, active, body }) — shell for an allowed context, restricted state otherwise */
  function render(s = {}) {
    const c = s.context;
    if (!c || !c.allowed) return restricted({ loginUrl: s.loginUrl || null, reason: s.reason });
    return App.backofficeView.shell({ context: c, nav: s.nav || [], active: s.active || null, support: null, emergencies: [], body: s.body || '' });
  }
  /** body(active) — area content from App.backoffice (providers without adapter → "módulo não integrado"; no backend → BACKEND_UNAVAILABLE) */
  async function body(active) {
    const B = App.backoffice, V = App.backofficeView;
    const off = App.authz.backendBaseUrl && App.authz.backendBaseUrl() ? '' : V.unavailable('BACKEND_UNAVAILABLE', 'Servidor administrativo não configurado neste painel: as filas abaixo não refletem dados reais e nenhuma alteração pode ser feita.');
    return off + await area(active);
  }
  async function area(active) {
    const B = App.backoffice, V = App.backofficeView;
    if (!active || active === 'overview' || active === 'operations') return V.home(await B.inbox.build()) + surroundings();
    if (active === 'approvals') return V.approvals(await B.approvals.list(), t => B.approvals.canDecide(t));
    const qs = (App.backofficeConfig.workQueues || []).filter(q => q.domain === active);
    if (qs.length) return (await Promise.all(qs.map(q => B.queues.view(q.id, {})))).map(r => V.queue(r)).join('');
    return V.unavailable('BACKEND_UNAVAILABLE', 'Servidor administrativo não configurado neste painel. Nenhuma alteração foi feita.');
  }
  async function boot(root) {
    if (!root) return;
    let r = { ok: false, reason: 'BACKEND_UNAVAILABLE' };
    try { r = await App.authz.refresh(); } catch (e) { r = { ok: false, reason: 'NETWORK_ERROR' }; }
    const ctx = App.backoffice.shellContext();
    let loginUrl = null; try { loginUrl = App.authz.account && App.authz.account.loginUrl(typeof location !== 'undefined' ? location.href.split('#')[0] : ''); } catch (e) { loginUrl = null; }
    if (!ctx.allowed) { root.innerHTML = render({ context: ctx, loginUrl, reason: r && r.reason === 'STATIC_PUBLIC' ? 'BACKEND_UNAVAILABLE' : r && r.reason }); return; }
    const nav = App.backoffice.navigation.getItems();
    let active = 'overview';
    const draw = async () => { const b = await body(active); root.innerHTML = render({ context: App.backoffice.shellContext(), nav, active, body: b }); };
    root.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (act === 'boNav') { e.preventDefault(); active = a.dataset.nav || 'overview'; await draw(); }
      else if (act === 'boRefresh') await draw();
      else if (act === 'boAction' || act === 'boPreview' || act === 'boConfirm' || act === 'boOpenItem') {
        e.preventDefault();
        const main = root.querySelector('#bo-main');
        if (main) main.insertAdjacentHTML('afterbegin', App.backofficeView.error({ message: 'Servidor administrativo não configurado neste painel. Nenhuma alteração foi feita.', code: 'BACKEND_UNAVAILABLE' }));
      } else if (act === 'boCancel') await draw();
    });
    await draw();
  }
  return Object.freeze({ restricted, render, body, boot, surroundings });
})();
if (typeof document !== 'undefined' && document.getElementById && document.getElementById('adm')) App.adminApp.boot(document.getElementById('adm'));
