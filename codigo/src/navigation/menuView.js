/* navigation/menuView.js — topic 53: the compact header / primary navigation, rendered from App.navigation.registry.
   One markup for every device (registry único, containers diferentes):
   - headerHtml() → the <header class="hd cnav"> that replaces the header of shell.html (static, so nothing flickers;
     scripts/navHeader.js prints it). It keeps every id and data-act the shell already uses (devSel, devSub, q, sugg,
     secChip, syncInd, custBtn, custClr, data-act=mode/present/view) and adds the 5 primary items (data-act="nav" data-ws).
   - applyProfile(profile) → html[data-nav] = top | bottom | rail and moves the movable header tools between the inline
     zone (.hdr) and the overflow panel ("Mais") following the manifest overflow rule for that layout profile.
   - update(vm) → aria-current="page", badge, hidden / aria-disabled with reason, FIND "open" mark, customer flag.
   - bind(document) → overflow open/close (outside click, Esc), roving arrow keys in the nav, G-sequence shortcuts.
   - W3 login: update() also renders the account control from vm.account ("Entrar com Google", or the first name +
     "Sair") — only when a backend is configured (vm.account.visible). Without a backend (the published static panel)
     nothing is added to the DOM, so the visitor header stays byte-for-byte what headerHtml() printed.
   Business state is never read here: update() receives App.navigation.service.viewModel(). */
App.navigation = App.navigation || {};
App.navigation.view = (() => {
  const freeze = Object.freeze, R = () => App.navigation.registry;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** icon registry (same 20×20 stroke style as App.ui.icon); decorative: aria-hidden, the label is always present */
  const ICONS = freeze({
    map: '<path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z"/><path d="M7.5 3.5v11M12.5 5.5v11"/>',
    find: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
    compare: '<path d="M4 5h5v10H4zM11 5h5v10h-5z"/>',
    users: '<circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 16c.4-2.8 2.3-4.4 4.7-4.4s4.3 1.6 4.7 4.4"/><circle cx="14" cy="7.6" r="2"/><path d="M13.2 11.7c2 .1 3.5 1.5 3.9 4"/>',
    building: '<path d="M4 17V4.5l7-1.5V17M11 7.5l5 1.5V17M2.5 17h15"/><path d="M6.5 7h2M6.5 10h2M6.5 13h2M13 11h1.5M13 14h1.5"/>',
    more: '<circle cx="5" cy="10" r="1.1"/><circle cx="10" cy="10" r="1.1"/><circle cx="15" cy="10" r="1.1"/>',
    calc: '<rect x="4.5" y="3" width="11" height="14" rx="1.5"/><path d="M7 6.5h6M7 10h1M10 10h1M13 10h0M7 13h1M10 13h1M13 13h0"/>',
    list: '<path d="M7 6h9M7 10h9M7 14h9M4 6v.1M4 10v.1M4 14v.1"/>', cmp: '<path d="M4 5h5v10H4zM11 5h5v10h-5z"/>',
    heart: '<path d="M10 16.5s-6-3.7-6-8A3.3 3.3 0 0 1 10 6a3.3 3.3 0 0 1 6 2.5c0 4.3-6 8-6 8z"/>',
    share: '<path d="M14 7l-8 3.5 8 3.5M14 4.5a1.8 1.8 0 1 0 0 .1M14 15.5a1.8 1.8 0 1 0 0 .1M6 10.5a1.8 1.8 0 1 0 0 .1"/>',
    sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
    route: '<path d="M5 16c0-4 10-3 10-8M5 16v.1M15 8V4"/><circle cx="5" cy="16" r="1.6"/><circle cx="15" cy="4" r="1.6"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.1"/>', copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M4 13V5.5A1.5 1.5 0 0 1 5.5 4H13"/>'
  });
  const icon = (id, cls = 'nico') => `<svg class="${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[id] || ''}</svg>`;
  /** tools that never move (always in the header row) */
  const FIXED_TOOLS = freeze(['brand', 'development', 'search']);
  const PLACEMENT_ATTR = freeze({ BOTTOM_NAV: 'bottom', TOP_NAV: 'top', LEFT_RAIL: 'rail' });

  // ------------------------------------------------------------------ static markup
  function itemHtml(i) {
    const t = R().t, label = t(i.labelKey), short = i.shortLabelKey ? t(i.shortLabelKey) : null;
    const lbl = short && short !== label ? `<span class="nl"><span class="nfull">${esc(label)}</span><span class="nshort" aria-hidden="true">${esc(short)}</span></span>` : `<span class="nl">${esc(label)}</span>`;
    const badge = i.badgeProviderId ? `<span class="cnt" aria-hidden="true" hidden></span><span class="vh nbl"></span>` : '';
    return `<li><button type="button" class="ni" data-act="nav" data-ws="${esc(i.id)}" data-route="${esc(i.routeCode)}">${icon(i.iconId)}${lbl}${badge}</button></li>`;
  }
  const TOOL_HTML = {
    access: () => `<div class="secctx" id="secChip"></div>`,
    sync: () => `<button class="syncind" id="syncInd" data-act="view" data-v="development" hidden></button>`,
    customer: () => `<button class="cust" id="custBtn" data-act="view" data-v="clients"></button><button class="custx" id="custClr" data-act="custClear" hidden aria-label="Encerrar o atendimento deste cliente (o cadastro continua salvo)" title="Encerrar atendimento">×</button>`,
    mode: () => `<div class="seg" role="group" aria-label="Modo de apresentação"><button data-act="mode" data-mode="broker">Corretor</button><button data-act="mode" data-mode="client">Cliente</button><button class="mtech" data-act="mode" data-mode="technical" title="Mostra fontes, versões e detalhes técnicos">Técnico</button></div>`,
    present: () => `<button class="btn sm presbtn" data-act="present" aria-pressed="false" title="Apresentar ao cliente em tela limpa (Esc para sair)">Apresentar</button>`,
    shortcuts: () => `<button class="lbtn small" data-act="shortcutHelp">Atalhos de teclado</button>`
  };
  /** tools whose controls do not name themselves get a caption inside the overflow panel */
  const CAPTIONED = freeze(['access', 'sync', 'customer', 'mode']);
  const toolHtml = (h, where) => `<div class="ntool" data-tool="${esc(h.id)}" data-where="${where}">${CAPTIONED.includes(h.id) ? `<span class="ncap">${esc(R().t(h.labelKey))}</span>` : ''}${TOOL_HTML[h.id] ? TOOL_HTML[h.id]() : ''}</div>`;
  /** headerHtml({ profile = 'DESKTOP' }) → the static header (desktop layout; applyProfile() rearranges at runtime) */
  function headerHtml(o = {}) {
    const m = R().manifest(), t = R().t, hl = R().headerLayout(o.profile || 'DESKTOP', { hasCustomer: false });
    const movable = R().headerTools().filter(h => !FIXED_TOOLS.includes(h.id) && TOOL_HTML[h.id]);
    const pl = id => (hl.tools.find(x => x.id === id) || {}).placement;
    const inline = movable.filter(h => pl(h.id) === 'INLINE' || pl(h.id) === 'INLINE_WHEN_ACTIVE').map(h => toolHtml(h, 'inline')).join('');
    const over = movable.filter(h => pl(h.id) === 'OVERFLOW' || pl(h.id) === 'NONE').map(h => toolHtml(h, 'overflow')).join('');
    return `<header class="hd cnav" data-nav-v="${esc(m.version)}">
    <button type="button" class="brand" data-act="nav" data-ws="MAP" aria-label="${esc(t('hdr.brand'))}"><img class="logo" src="logo.png" alt="House 7 Imóveis" width="90" height="30"></button>
    <div class="dev"><select id="devSel" aria-label="Empreendimento"></select><small id="devSub"></small></div>
    <nav class="nav pnav" id="pnav" aria-label="${esc(t('nav.label'))}"><ul class="pnl" role="list">${R().items().map(itemHtml).join('')}</ul></nav>
    <div class="gs"><input id="q" type="search" placeholder="Buscar lote (B79) ou quadra" aria-label="Buscar lote ou quadra" autocomplete="off"><div class="sugg" id="sugg" role="listbox" hidden></div></div>
    <div class="hdr">${inline}<div class="nmore"><button type="button" class="nmorebtn" aria-expanded="false" aria-controls="navMore" aria-label="${esc(t('nav.more.aria'))}">${icon('more')}<span class="nml">${esc(t('nav.more'))}</span></button><div class="nmorepanel" id="navMore" role="group" aria-label="${esc(t('nav.more.aria'))}" hidden>${over}</div></div></div>
  </header>`;
  }

  // ------------------------------------------------------------------ runtime
  const hdOf = root => (root && root.querySelector ? root : typeof document !== 'undefined' ? document : null)?.querySelector('.hd.cnav') || null;
  let lastPlacement = null;
  /** applyProfile(responsiveProfile, root) → { placement, layout } — html[data-nav] + tool moves (idempotent) */
  function applyProfile(profile, root) {
    const pl = R().placement(profile), doc = root && root.documentElement ? root : typeof document !== 'undefined' ? document : null;
    const html = doc && doc.documentElement; if (html && html.dataset) html.dataset.nav = PLACEMENT_ATTR[pl.primaryPlacement] || 'top';
    lastPlacement = pl.primaryPlacement;
    const hd = hdOf(doc); if (!hd) return freeze({ placement: pl, layout: null });
    const hl = R().headerLayout(profile, { hasCustomer: hd.dataset.customer === '1' }), hdr = hd.querySelector('.hdr'), more = hd.querySelector('.nmore'), list = hd.querySelector('#navMore');
    for (const tl of hl.tools) {
      if (FIXED_TOOLS.includes(tl.id)) continue;
      const w = hd.querySelector(`.ntool[data-tool="${tl.id}"]`); if (!w) continue;
      const toOverflow = tl.placement === 'OVERFLOW' || tl.placement === 'NONE';
      if (toOverflow && w.parentNode !== list) list.appendChild(w); else if (!toOverflow && w.parentNode !== hdr) hdr.insertBefore(w, more);
      w.dataset.where = toOverflow ? 'overflow' : 'inline';
      w.hidden = tl.placement === 'NONE';
      if (tl.placement === 'INLINE_WHEN_ACTIVE') w.setAttribute('data-when-active', ''); else w.removeAttribute('data-when-active');
    }
    // keep manifest order inside each container
    const order = hl.tools.map(x => x.id);
    for (const box of [list, hdr]) { const ws = [...box.querySelectorAll(':scope > .ntool')].sort((a, b) => order.indexOf(a.dataset.tool) - order.indexOf(b.dataset.tool)); for (const w of ws) box.insertBefore(w, box === hdr ? more : null); }
    more.hidden = !hl.tools.some(x => x.placement === 'OVERFLOW');
    hd.dataset.placement = PLACEMENT_ATTR[pl.primaryPlacement] || 'top';
    return freeze({ placement: pl, layout: hl });
  }
  /** update(viewModel, root) — reflects the NavigationViewModel; never reorders items (no flicker) */
  function update(vm, root) {
    const hd = hdOf(root); if (!hd || !vm) return false;
    const nav = hd.querySelector('.pnav'); if (nav) nav.hidden = !vm.visible;
    for (const it of vm.items) {
      const b = hd.querySelector(`.pnav [data-ws="${it.id}"]`); if (!b) continue;
      const li = b.closest('li') || b; li.hidden = it.state === 'HIDDEN';
      if (it.current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      if (it.open) b.setAttribute('data-open', ''); else b.removeAttribute('data-open');
      const dis = it.state === 'VISIBLE_DISABLED', msg = dis && it.disabledReason ? (it.disabledReason.message || R().t(it.disabledReason.messageKey)) : null;
      if (dis) { b.setAttribute('aria-disabled', 'true'); b.title = msg || ''; b.dataset.reason = it.disabledReason.code; } else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); delete b.dataset.reason; }
      if (it.open && !dis) b.title = R().t('nav.find.open');
      const c = b.querySelector('.cnt'), l = b.querySelector('.nbl');
      if (c) { c.textContent = it.badge ? String(it.badge.count) : ''; c.hidden = !it.badge; if (it.badge) c.dataset.status = it.badge.status; }
      if (l) l.textContent = it.badge ? `, ${it.badge.label}` : '';
    }
    renderAccount(hd, vm.account);
    hd.dataset.customer = vm.hasCustomer ? '1' : '';
    hd.dataset.workspace = vm.workspace; hd.dataset.mode = vm.mode; hd.dataset.offline = vm.connectivity === 'OFFLINE' ? '1' : '';
    // INLINE_WHEN_ACTIVE wrappers are shown/hidden by CSS on [data-customer]
    return true;
  }
  const placement = () => lastPlacement;

  // ------------------------------------------------------------------ account control (W3 login, backend mode only)
  const GOOGLE_G = '<svg class="nacct-g" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
  /** accountHtml(vm.account) → markup of the control (pure; also used by the tests) */
  function accountHtml(a) {
    if (!a || !a.visible) return '';
    if (!a.authenticated) return `<button type="button" class="btn sm nacct-in" data-act="authLogin" aria-label="${esc(a.ariaLabel)}">${GOOGLE_G}<span>${esc(a.loginLabel)}</span></button>${a.notice ? `<span class="nacct-msg" role="status">${esc(a.notice)}</span>` : ''}`;
    return `<span class="nacct-name"${a.limited ? ' data-limited="1" title="Conta sem acesso de organização: peça um convite ao administrador."' : ''}>${esc(a.firstName)}</span><button type="button" class="btn sm nacct-out" data-act="authLogout" aria-label="${esc(a.ariaLabel)}"${a.busy ? ' aria-busy="true" disabled' : ''}>${esc(a.logoutLabel)}</button>`;
  }
  function renderAccount(hd, a) {
    let box = hd.querySelector('.nacct');
    if (!a || !a.visible) { if (box) box.remove(); return; }
    const hdr = hd.querySelector('.hdr'), more = hd.querySelector('.nmore'), list = hd.querySelector('#navMore');
    // desktop/top layout: inline next to the other tools; bottom bar / rail (phones, tablets): first item of "Mais"
    const inline = hd.dataset.placement === 'top' || !more || more.hidden || !list;
    if (!box) { box = (hd.ownerDocument || document).createElement('div'); box.className = 'ntool nacct'; box.dataset.tool = 'account'; }
    if (inline && box.parentNode !== hdr) hdr.insertBefore(box, more || null);
    else if (!inline && box.parentNode !== list) list.insertBefore(box, list.firstChild);
    box.dataset.where = inline ? 'inline' : 'overflow';
    const html = accountHtml(a);
    if (box.dataset.k !== html) { box.innerHTML = html; box.dataset.k = html; }
    if (inline) fitAccount(hd, hdr, list, more, box);
  }
  // the header row must never scroll sideways: inline control too wide → icon-only button (name kept in aria-label),
  // still too wide → first item of "Mais". One layout read; skipped where layout is unavailable (tests).
  function fitAccount(hd, hdr, list, more, box) {
    try {
      const over = () => hd.scrollWidth > hd.clientWidth + 1 || (hdr && hdr.getBoundingClientRect().right > hd.getBoundingClientRect().right + 1);
      delete box.dataset.compact;
      if (!hd.clientWidth || !over()) return;
      box.dataset.compact = '1';
      if (over() && list && more && !more.hidden) { list.insertBefore(box, list.firstChild); box.dataset.where = 'overflow'; delete box.dataset.compact; }
    } catch (_) { /* layout not measurable */ }
  }

  // ------------------------------------------------------------------ behaviour
  function setMore(hd, open, focusBtn) {
    const b = hd && hd.querySelector('.nmorebtn'), p = hd && hd.querySelector('#navMore'); if (!b || !p) return;
    p.hidden = !open; b.setAttribute('aria-expanded', String(!!open));
    if (open) { const f = p.querySelector('button:not([hidden]):not([disabled]),select,summary,[tabindex="0"]'); if (f) f.focus({ preventScroll: true }); }
    else if (focusBtn) b.focus({ preventScroll: true });
  }
  /** bind(document, { shortcuts = true }) → unbind(). Listeners only; navigation still goes through the shell's data-act="nav" handler. */
  function bind(doc, o = {}) {
    const d = doc || document, matcher = App.navigation.shortcuts.createSequenceMatcher(o);
    const onClick = e => {
      const hd = hdOf(d); if (!hd) return;
      const acc = e.target.closest && e.target.closest('.nacct [data-act=authLogin], .nacct [data-act=authLogout]');
      if (acc && App.authz && App.authz.account) {
        if (acc.dataset.act === 'authLogin') { const w = d.defaultView || window, url = App.authz.account.loginUrl(w.location.href); if (url) w.location.assign(url); } // full-page navigation: the API answers 302 to Google
        else Promise.resolve(App.authz.account.logout()).catch(() => {});
        return;
      }
      const mb = e.target.closest && e.target.closest('.nmorebtn');
      if (mb && hd.contains(mb)) { setMore(hd, mb.getAttribute('aria-expanded') !== 'true'); return; }
      const p = hd.querySelector('#navMore'); if (!p || p.hidden) return;
      if (!p.contains(e.target)) setMore(hd, false);
      else if (e.target.closest('[data-act]')) setTimeout(() => setMore(hd, false), 0); // after the shell handled the action
    };
    const onKeyCapture = e => {
      const hd = hdOf(d); if (!hd) return;
      const p = hd.querySelector('#navMore');
      if (e.key === 'Escape' && p && !p.hidden) { e.preventDefault(); e.stopPropagation(); setMore(hd, false, true); return; }
      if (o.shortcuts === false) return;
      const modal = d.getElementById && d.getElementById('modal'); if (modal && !modal.hidden) { matcher.reset(); return; }
      const r = matcher.handle(e);
      if (r.state === 'MATCH') { const b = hd.querySelector(`.pnav [data-ws="${r.target}"]`); if (b && !(b.closest('li') || b).hidden) { e.preventDefault(); b.click(); } }
    };
    const onNavKey = e => {
      const b = e.target.closest && e.target.closest('.pnav .ni'); if (!b) return;
      const rail = (d.documentElement.dataset.nav === 'rail'), next = rail ? 'ArrowDown' : 'ArrowRight', prev = rail ? 'ArrowUp' : 'ArrowLeft';
      if (![next, prev, 'Home', 'End'].includes(e.key)) return;
      const all = [...b.closest('.pnav').querySelectorAll('.ni')].filter(x => !(x.closest('li') || x).hidden), i = all.indexOf(b);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === next ? 1 : -1) + all.length) % all.length;
      e.preventDefault(); all[j].focus();
    };
    d.addEventListener('click', onClick); d.addEventListener('keydown', onKeyCapture, true); d.addEventListener('keydown', onNavKey);
    // W3 login: in backend mode, load the principal from GET /me once (App.authz subscribers re-render the header) and drop
    // the ?login= notice flag from the address bar. No backend configured → start() does nothing (no request at all).
    try {
      const w = d.defaultView || (typeof window !== 'undefined' ? window : null);
      if (w && App.authz && App.authz.account && App.authz.backendBaseUrl && App.authz.backendBaseUrl()) {
        const search = w.location.search;
        App.authz.account.start({ search });
        if (/[?&]login=/.test(search) && w.history && w.history.replaceState) { const u = new URL(w.location.href); u.searchParams.delete('login'); w.history.replaceState(w.history.state, '', u.pathname + u.search + u.hash); }
      }
    } catch (_) { /* the visitor panel never depends on the login */ }
    return () => { d.removeEventListener('click', onClick); d.removeEventListener('keydown', onKeyCapture, true); d.removeEventListener('keydown', onNavKey); };
  }
  return freeze({ ICONS, FIXED_TOOLS, PLACEMENT_ATTR, icon, headerHtml, applyProfile, update, placement, bind, setMore, accountHtml });
})();
