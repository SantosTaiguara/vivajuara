/* share/sharedShellView.js — topic 42 renderers: SharedAppShell (public runtime: branding, client-safe content, allowed
   actions, expiry/safety warning, feedback when the capability exists — no admin nav, no CRM shortcuts, no customer
   search, no internal shortcuts), generic error/passcode/confirmation screens, and the internal link-management list.
   Markup only. data-act: sharedFeedback (data-type, data-lot), sharedPasscode, sharedConfirm, sharedPrint,
   shareCopy, shareNative, shareWhatsapp, shareEmail, shareQr, shareRevoke / shareSuspend / shareResume / shareRotate (data-id). */
App.sharedShellView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** headMeta(meta) — noindex/nofollow + no-referrer; generic Open Graph (never a customer name or price) */
  const headMeta = m => `<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">${m && m.title ? `<meta property="og:title" content="${esc(m.title)}">` : ''}${m && m.description ? `<meta property="og:description" content="${esc(m.description)}">` : ''}`;
  function shell(r) {
    const caps = r.capabilities || [], b = r.branding || {}, a = r.content || {};
    const fb = caps.includes('SUBMIT_FEEDBACK');
    const blocks = App.presentationView && a.blocks ? a.blocks.map(x => `<section class="sh-block">${App.presentationView.block(x)}</section>`).join('') : '';
    return `<div class="sh-shell"><header class="sh-head" role="banner"><strong>${esc(b.organizationName)}</strong></header>
      ${(r.warnings || []).length ? `<div class="sh-warn" role="status">${r.warnings.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
      <main class="sh-main" aria-label="${esc(r.title || 'Conteúdo compartilhado')}"><h1>${esc(r.title)}</h1>${a.preparedAtLabel ? `<p class="small">${esc(a.preparedAtLabel)}</p>` : ''}${blocks}</main>
      <footer class="sh-foot">${caps.includes('PRINT') ? '<button class="btn" data-act="sharedPrint">Imprimir</button>' : ''}${fb ? '<button class="btn" data-act="sharedFeedback" data-type="MORE_INFO">Quero saber mais</button><button class="btn" data-act="sharedFeedback" data-type="VISIT_INTEREST">Quero visitar</button>' : ''}
        ${b.contactCta && b.contactCta.channel !== 'NONE' ? `<button class="btn pri" data-act="sharedContact">${esc(b.contactCta.label)}</button>` : ''}
        ${r.expiresAt ? `<p class="small">Disponível até ${esc(App.fmt ? App.fmt.formatDateTime(r.expiresAt) : r.expiresAt)}.</p>` : ''}</footer></div>`;
  }
  const error = (message) => `<main class="sh-err" role="alert"><h1>Link indisponível</h1><p>${esc(message)}</p></main>`;
  const passcode = (message) => `<main class="sh-pass"><h1>Código de acesso</h1>${message ? `<p role="alert">${esc(message)}</p>` : ''}<label for="shPass">Código</label><input id="shPass" type="password" inputmode="numeric" autocomplete="one-time-code" data-in="sharedPasscode"><button class="btn pri" data-act="sharedPasscode">Entrar</button></main>`;
  const confirm = (message) => `<main class="sh-confirm"><p>${esc(message)}</p><button class="btn pri" data-act="sharedConfirm">Abrir apresentação</button></main>`;
  /** links(vms) — internal management (statusVM from App.share.domain.linkStatusVM); never shows the raw token */
  function links(vms) {
    return `<table class="sh-links"><caption>Links compartilhados</caption><thead><tr><th scope="col">Recurso</th><th scope="col">Criado</th><th scope="col">Expira</th><th scope="col">Situação</th><th scope="col">Modo</th><th scope="col">Último acesso</th><th scope="col">Acessos</th><th scope="col">Ações</th></tr></thead><tbody>
      ${vms.map(v => `<tr><td>${esc(v.resource)} <span class="small">${esc(v.maskedLink)}</span></td><td>${esc(v.created)}</td><td>${esc(v.expires)}</td><td>${esc(v.statusLabel)}</td><td>${esc(v.accessMode)}</td><td>${esc(v.lastAccess)}</td><td>${esc(v.accessCount)}</td>
        <td>${v.actions.map(a => `<button class="lbtn small" data-act="${{ CREATE_NEW_LINK: 'shareRotate', REVOKE: 'shareRevoke', SUSPEND: 'shareSuspend', RESUME: 'shareResume' }[a]}" data-id="${esc(v.shareGrantId)}">${esc({ CREATE_NEW_LINK: 'Criar novo link', REVOKE: 'Revogar', SUSPEND: 'Suspender', RESUME: 'Reativar' }[a])}</button>`).join('')}</td></tr>`).join('')}</tbody></table>`;
  }
  /** issued(result, opts) — shown once right after issuance: link + channel buttons (QR keeps a textual URL alternative) */
  function issued(res, o = {}) {
    return `<section class="sh-issued" aria-label="Link criado"><p>Link criado. Ele não será mostrado novamente depois que você fechar esta janela.</p>
      <label for="shUrl">Link</label><input id="shUrl" readonly value="${esc(res.url)}">
      <div role="group" aria-label="Enviar"><button class="btn" data-act="shareCopy">Copiar link</button>${o.native ? '<button class="btn" data-act="shareNative">Compartilhar…</button>' : ''}<button class="btn" data-act="shareWhatsapp">WhatsApp</button><button class="btn" data-act="shareEmail">E-mail</button><button class="btn" data-act="shareQr">QR Code</button></div>
      <p class="small">Quem receber este link poderá abri-lo até ${esc(res.expiresAt && App.fmt ? App.fmt.formatDateTime(res.expiresAt) : 'expirar')} ou até ser revogado; o link não é pessoal.</p></section>`;
  }
  return Object.freeze({ headMeta, shell, error, passcode, confirm, links, issued, esc });
})();
