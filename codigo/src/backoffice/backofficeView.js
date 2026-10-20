/* backoffice/backofficeView.js — App.backofficeView (topic 60): pure HTML-string renderers for the ADMIN / OPERATIONS SHELL.
   Separate from the broker panel (§6-7): the broker app shows at most one entry link (entryLink), and nothing for the
   static public visitor. Input = results of App.backoffice.* (navigation, inbox, queues, approvals, commands, governance).
   Everything is escaped; status never relies on color only (label + shape, §505); tables use caption/th scope/aria-sort
   (§498); no hover-only controls; destructive actions only behind preview + explicit confirm (§153, §225).
   data-act names (wired by the integrator): boOpen, boNav, boOpenItem, boAction, boPreview, boConfirm, boCancel, boRefresh, boExitSupport. */
App.backofficeView = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const B = () => App.backoffice;
  const sev = s => `<span class="bo-sev bo-sev-${esc(String(s).toLowerCase())}"><span aria-hidden="true">${esc(B().SEVERITY_ICON[s] || '•')}</span> ${esc(B().SEVERITY_LABEL[s] || s)}</span>`;
  const st = s => `<span class="bo-status">${esc(B().INBOX_STATUS_LABEL[s] || s)}</span>`;
  const when = v => v ? `<time datetime="${esc(v)}">${esc(String(v).replace('T', ' ').slice(0, 16))} UTC</time>` : '—';

  /** entryLink(o) — "Console administrativo" link for the broker shell; '' for the visitor / without backoffice.access */
  function entryLink(o = {}) {
    if (!B().entryVisible(o)) return '';
    return '<button type="button" class="bo-entry" data-act="boOpen" aria-label="Abrir o console administrativo">Console administrativo</button>';
  }
  /** denied(message) — never reveals counts or existence (§514) */
  const denied = (msg) => `<section class="bo-denied" role="alert"><h2>Acesso negado</h2><p>${esc(msg || 'Você não possui permissão para esta área.')}</p></section>`;
  const unavailable = (status, message) => `<div class="bo-unavailable" role="status" data-provider-status="${esc(status)}">${esc(message || 'Módulo não disponível.')}</div>`;

  /** supportBanner(model) — always on top while a SupportSession is active (§96) */
  function supportBanner(b) {
    if (!b) return '';
    return `<div class="bo-support" role="alert"><strong>${esc(b.text)}</strong> <span>${esc(b.detail)}</span> <button type="button" data-act="boExitSupport">Encerrar sessão de suporte</button></div>`;
  }
  /** emergencyStrip(controls) — active emergency controls are prominent (§297) */
  function emergencyStrip(list) {
    const act = (list || []).filter(c => c && c.status === 'ACTIVE'); if (!act.length) return '';
    return `<div class="bo-emergency" role="alert"><strong>Controle de emergência ativo</strong><ul>${act.map(c => `<li>${esc((App.backoffice.governance.EMERGENCY_TYPES || {})[c.controlType] || c.controlType)} · escopo ${esc(c.scopeRef)} · até ${when(c.expiresAt)}</li>`).join('')}</ul></div>`;
  }

  /** shell({ context, nav, active, support, emergencies, body }) — admin shell with tenant header (§163) */
  function shell(o = {}) {
    const c = o.context; if (!c || !c.allowed) return denied(c && c.message);
    const nav = (o.nav || []).map(i => `<li><a href="#${esc(i.route)}" data-act="boNav" data-nav="${esc(i.id)}"${i.id === o.active ? ' aria-current="page"' : ''}>${esc(i.label)}${o.badges && o.badges[i.id] ? ` <span class="bo-badge" aria-label="${esc(o.badges[i.id])} itens">${esc(o.badges[i.id])}</span>` : ''}</a></li>`).join('');
    return `<div class="bo-shell" data-shell="admin">${supportBanner(o.support)}${emergencyStrip(o.emergencies)}`
      + `<header class="bo-head"><h1>${esc(c.title)}</h1><p class="bo-tenant" aria-live="polite"><span class="bo-tenant-chip">${esc(c.tenantLabel)}</span></p><p class="bo-who">${esc(c.principal.displayName)}</p></header>`
      + `<nav class="bo-nav" aria-label="Áreas do console"><ul>${nav}</ul></nav><main class="bo-main" id="bo-main" tabindex="-1">${o.body || ''}</main></div>`;
  }

  /** itemsTable(items, { caption, sort }) — accessible data-dense table (§498) */
  function itemsTable(items, o = {}) {
    const sortCol = o.sort || 'severity';
    const th = (k, l) => `<th scope="col"${k === sortCol ? ' aria-sort="descending"' : ''}>${l}</th>`;
    return `<table class="bo-table"><caption>${esc(o.caption || 'Itens')}</caption><thead><tr>${th('severity', 'Severidade')}${th('title', 'Item')}${th('status', 'Status')}${th('dueAt', 'Prazo')}${th('assignedTo', 'Responsável')}<th scope="col"><span class="bo-sr">Ações</span></th></tr></thead><tbody>`
      + items.map(i => `<tr><td>${sev(i.severity)}${i.overdue ? ' <span class="bo-overdue">Atrasado</span>' : ''}</td><td>${esc(i.title)}${i.description ? `<div class="bo-desc">${esc(i.description)}</div>` : ''}</td><td>${st(i.status)}</td><td>${when(i.dueAt)}</td><td>${esc(i.assignedTo || '—')}</td>`
        + `<td>${i.actionRoute ? `<a href="#${esc(i.actionRoute)}" data-act="boOpenItem" data-id="${esc(i.id)}">Abrir</a>` : ''}</td></tr>`).join('') + '</tbody></table>';
  }
  /** home(inboxResult) — work first (§21): urgent → approvals/deadlines/failures → indicators. Not a vanity dashboard. */
  function home(r) {
    if (!r || !r.allowed) return denied(r && r.message);
    const unav = Object.entries(r.providers || {}).filter(([, s]) => s.status !== 'AVAILABLE').map(([n, s]) => `<li>${esc(n)}: ${esc(s.message)}</li>`).join('');
    const sec = (title, list, empty) => `<section class="bo-sec"><h2>${esc(title)} <span class="bo-count">(${list.length})</span></h2>${list.length ? itemsTable(list.slice(0, 20), { caption: title }) : `<p class="bo-empty">${esc(empty)}</p>`}</section>`;
    return `<div class="bo-home">${sec('Urgente', r.sections.urgent, 'Nada urgente agora.')}${sec('Aprovações pendentes', r.sections.approvals, 'Nenhuma aprovação pendente.')}`
      + `${sec('Prazos', r.sections.deadlines, 'Nenhum prazo aberto.')}${sec('Falhas', r.sections.failures, 'Nenhuma falha registrada.')}`
      + (unav ? `<section class="bo-sec"><h2>Áreas indisponíveis</h2><ul class="bo-unav">${unav}</ul></section>` : '')
      + `<p class="bo-fresh">Projeção operacional (não é fonte de verdade) · atualizada ${when(r.lastUpdatedAt)} <button type="button" data-act="boRefresh">Atualizar</button></p></div>`;
  }
  /** queue(viewResult) */
  function queue(r) {
    if (!r || !r.ok) return r && r.code === 'NOT_AUTHORIZED' ? denied(r.message) : `<p class="bo-error" role="alert">${esc(r ? r.message : 'Fila indisponível.')}</p>`;
    if (r.providerStatus !== 'AVAILABLE') return `<section class="bo-queue"><h2>${esc(r.queue.label)}</h2>${unavailable(r.providerStatus, r.providerMessage)}</section>`;
    const acts = r.actions.map(a => `<button type="button" data-act="boAction" data-code="${esc(a.actionCode)}"${a.enabled ? '' : ` disabled aria-disabled="true" title="${esc(a.message || '')}"`}>${esc(a.label)}</button>`).join(' ');
    return `<section class="bo-queue"><h2>${esc(r.queue.label)}</h2><div class="bo-actions">${acts}</div>${r.items.length ? itemsTable(r.items, { caption: r.queue.label }) : `<p class="bo-empty">${esc(r.emptyText)}</p>`}`
      + `<p class="bo-fresh">Última atualização: ${when(r.lastUpdatedAt)}</p></section>`;
  }
  /** approvals(listResult, decideOf(task) → canDecide result) */
  function approvals(r, decideOf = () => ({ ok: false })) {
    if (!r || !r.allowed) return denied(r && r.message);
    if (!r.tasks.length) return `<section class="bo-approvals"><h2>Aprovações</h2><p class="bo-empty">${esc(r.emptyText)}</p></section>`;
    return `<section class="bo-approvals"><h2>Aprovações</h2><ul class="bo-tasks">${r.tasks.map(t => { const d = decideOf(t);
      return `<li>${sev(t.severity)} <strong>${esc(t.summary)}</strong> <span class="bo-meta">${esc(t.approvalType)} · pedido em ${when(t.requestedAt)}</span> `
        + (d.ok ? `<button type="button" data-act="boPreview" data-code="commercial.approval.decide" data-id="${esc(t.id)}">Revisar e decidir</button>` : `<span class="bo-why">${esc(d.message || 'Sem permissão para decidir.')}</span>`) + '</li>'; }).join('')}</ul></section>`;
  }
  /** reasonField(policy) — structured reason code + optional free text (§147-148) */
  function reasonField(pol) {
    if (!pol || !pol.requiresReason) return '';
    return `<label class="bo-field">Motivo <select name="reasonCode" required><option value="">Selecione…</option>${App.backofficeConfig.reasonCodes.map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('')}</select></label>`
      + '<label class="bo-field">Detalhe (opcional, sem dados pessoais) <textarea name="reasonText" maxlength="500" rows="2"></textarea></label>';
  }
  /** preview(previewResult, policy) — impact before confirm (§142-143, §226, §431) */
  function preview(r, pol) {
    if (!r || !r.ok) return error(r);
    const p = r.preview, list = (t, a) => a && a.length ? `<h3>${esc(t)}</h3><ul>${a.map(x => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : '';
    const blocked = p.allowed === false || (p.blockers || []).length;
    return `<section class="bo-preview" role="dialog" aria-modal="true" aria-labelledby="bo-pv-t"><h2 id="bo-pv-t">${esc(pol ? pol.label : p.actionCode)}</h2>`
      + (pol && pol.help ? `<p class="bo-help">${esc(pol.help)}</p>` : '')
      + list('Bloqueios', p.blockers) + list('Avisos', p.warnings) + list('Afeta', p.affectedEntities) + list('Aprovações necessárias', p.requiredApprovals)
      + `<p class="bo-meta">Revisão esperada: ${esc(p.expectedRevision || '—')} · prévia válida até ${when(p.expiresAt)}</p><p class="bo-audit">${esc(p.auditNotice)}</p>`
      + reasonField(pol)
      + `<div class="bo-actions"><button type="button" data-act="boCancel">Cancelar</button> <button type="button" data-act="boConfirm" data-code="${esc(p.actionCode)}"${blocked ? ' disabled aria-disabled="true"' : ''}>Confirmar</button></div></section>`;
  }
  /** conflict(view) — "registro mudou desde que você abriu": yours vs current + diff (§152, §312) */
  function conflict(c) {
    if (!c) return '';
    return `<section class="bo-conflict" role="alert"><h2>${esc(c.title)}</h2><p>Sua versão: <strong>${esc(c.yourRevision || '—')}</strong> · Versão atual: <strong>${esc(c.currentRevision || '—')}</strong></p>`
      + (c.diff.length ? `<table class="bo-table"><caption>Diferenças</caption><thead><tr><th scope="col">Campo</th><th scope="col">Sua versão</th><th scope="col">Atual</th></tr></thead><tbody>${c.diff.map(d => `<tr><td>${esc(d.field)}</td><td>${esc(JSON.stringify(d.yours))}</td><td>${esc(JSON.stringify(d.current))}</td></tr>`).join('')}</tbody></table>` : '')
      + '<button type="button" data-act="boRefresh">Atualizar e comparar</button></section>';
  }
  /** error(result) — what happened, what to do, request ID; never a stack or a bare "409" (§313, §321) */
  function error(r) {
    if (!r) return '';
    if (r.conflict) return conflict(r.conflict);
    return `<div class="bo-error" role="alert"><p><strong>${esc(r.message || 'Não foi possível concluir.')}</strong></p>${r.whatToDo ? `<p>${esc(r.whatToDo)}</p>` : ''}${r.requestId ? `<p class="bo-meta">ID da requisição: <code>${esc(r.requestId)}</code></p>` : ''}</div>`;
  }
  /** secrets(view) — configured / missing / expiring only (§100-101) */
  function secrets(list) {
    return `<table class="bo-table"><caption>Credenciais (somente status; valores nunca são exibidos)</caption><thead><tr><th scope="col">Credencial</th><th scope="col">Status</th></tr></thead><tbody>${(list || []).map(s => `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.label)}</td></tr>`).join('')}</tbody></table>`;
  }
  /** configChange(change) — versioned change with mandatory diff (§120-121) */
  function configChange(c) {
    if (!c) return '';
    return `<section class="bo-config"><h2>${esc(c.configType)} · ${esc(c.scopeRef)}</h2><p class="bo-meta">Versão ${esc(c.currentVersion)} → ${esc(c.proposedVersion)} · status ${esc(c.status)} · revisão: ${esc(c.reviewKind)}</p>`
      + `<table class="bo-table"><caption>Diff</caption><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead><tbody>${c.diff.map(d => `<tr><td>${esc(d.field)}</td><td>${esc(JSON.stringify(d.before))}</td><td>${esc(JSON.stringify(d.after))}</td></tr>`).join('')}</tbody></table></section>`;
  }
  return Object.freeze({ esc, entryLink, denied, unavailable, supportBanner, emergencyStrip, shell, itemsTable, home, queue, approvals, reasonField, preview, conflict, error, secrets, configChange,
    DATA_ACTS: Object.freeze(['boOpen', 'boNav', 'boOpenItem', 'boAction', 'boPreview', 'boConfirm', 'boCancel', 'boRefresh', 'boExitSupport']) });
})();
