/* pwa/pwaView.js — topic 49 UI fragments (HTML strings, no state, no storage). Styles: presentation/pwa.css.
   Accessibility (§222): banners are role="status" (polite), every action is a <button> reachable by keyboard, nothing blocks the screen,
   focus is not stolen. Wording: pt-BR, no technical terms (§221). Distinguishes "Aplicativo instalado" from "Disponível offline" (§179).
   Actions (data-act): pwaUpdateNow · pwaUpdateLater · pwaReload · pwaInstall · pwaInstallDismiss · pwaPackPrepare (data-profile) ·
   pwaPackRefresh · pwaPackRemove · pwaPackCancel · pwaSyncRetry · pwaConflictDiscard (data-id) · pwaOpenStorage · pwaCheckUpdate. */
App.pwaView = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (act, label, o = {}) => `<button type="button" class="lbtn${o.primary ? ' primary' : ''}" data-act="${act}"${o.attrs || ''}>${esc(label)}</button>`;
  const fmt = b => App.pwa.pack.fmtMB(b);
  const when = iso => { if (!iso) return 'não disponível'; const d = new Date(iso); return isNaN(d) ? 'não disponível' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

  /** global connectivity chip (§95/§96): hidden only while ONLINE with nothing pending */
  function connectivityChip(vm) {
    if (!vm || !vm.visible) return '';
    return `<span class="pwa-conn" data-state="${esc(vm.state)}" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>${esc(vm.label)}${vm.pending ? ` · <small>${esc(vm.pending)}</small>` : ''}</span>`;
  }
  /** offline / degraded banner text (complements the existing netbar) */
  function offlineBanner(vm) {
    if (!vm || !vm.visible || !vm.detail) return '';
    return `<div class="pwa-banner ${vm.tone === 'error' ? 'warn' : 'info'}" role="status" aria-live="polite"><b>${esc(vm.label)}.</b> ${esc(vm.detail)}</div>`;
  }
  /** update banner from App.pwa.update.viewModel(state) */
  function updateBanner(vm) {
    if (!vm) return '';
    return `<div class="pwa-banner ${esc(vm.tone)}" role="status" aria-live="polite"><span>${esc(vm.text)}</span>${vm.actions.map(a => btn(a.act, a.label, { primary: a.primary })).join('')}</div>`;
  }
  /** menu entry "Instalar aplicativo" (§26): button when the browser allows, instructions on iOS, nothing when installed */
  function installEntry(state, caps = {}, instructions = null) {
    if (state === 'INSTALLED') return `<p class="pwa-note">Aplicativo instalado neste aparelho.</p>`;
    if (state === 'INSTALL_PROMPT_DEFERRED' || state === 'INSTALLABLE') return btn('pwaInstall', 'Instalar aplicativo');
    if (caps.manualInstallOnly) return `<p class="pwa-note">${esc(instructions || 'No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".')}</p>`;
    return '';
  }
  /** non-blocking install suggestion, only when InstallPromptController.shouldSuggest() said yes */
  function installHint(reason) {
    const text = reason === 'MANUAL_INSTRUCTIONS' ? 'Adicione o aplicativo à tela de início para abrir mais rápido.' : 'Instale o aplicativo para abrir mais rápido, mesmo com conexão instável.';
    return `<div class="pwa-banner info" role="status"><span>${esc(text)}</span>${reason === 'MANUAL_INSTRUCTIONS' ? '' : btn('pwaInstall', 'Instalar', { primary: true })}${btn('pwaInstallDismiss', 'Agora não')}</div>`;
  }
  /** "Disponibilizar <empreendimento> offline" with the size estimate before download (§56, §58) */
  function packOffer(devName, est, { busy = false, includeHighRes = false } = {}) {
    const insufficient = est && est.quota && est.quota.insufficient;
    return `<section class="pwa-card" aria-label="Uso offline">
      <h4>Disponibilizar ${esc(devName)} offline</h4>
      <p class="small">${est ? esc(est.bytesLabel) + ' · ' + esc(est.label) : 'Calculando o tamanho…'}</p>
      ${insufficient ? `<p class="pwa-warn" role="alert">${esc(est.quota.message)}</p>` : ''}
      <label class="pwa-check"><input type="checkbox" data-pwa-opt="highres"${includeHighRes ? ' checked' : ''}> Incluir imagens em alta resolução</label>
      <div class="pwa-actions">${busy ? `<span class="small" role="status">Preparando…</span>${btn('pwaPackCancel', 'Cancelar')}` : btn('pwaPackPrepare', 'Disponibilizar offline', { primary: true, attrs: ` data-profile="${esc(est ? est.profile : 'STANDARD')}"${insufficient ? ' disabled' : ''}` })}</div>
      <p class="small muted">Instalar o aplicativo não baixa os dados. Preço e disponibilidade guardados aparecem como última informação conhecida.</p>
    </section>`;
  }
  /** OfflineDevelopmentCard (§147) */
  function developmentCard(c) {
    return `<article class="pwa-card" data-state="${esc(c.packState)}">
      <h4>${esc(c.development)}</h4>
      <p class="pwa-state">${esc(c.stateText)}</p>
      <dl class="pwa-dl"><dt>Última atualização</dt><dd>${esc(c.lastUpdated || 'não disponível')}</dd><dt>Tamanho</dt><dd>${esc(c.size || 'não disponível')}</dd>${c.dataFreshness ? `<dt>Dados comerciais</dt><dd>${esc(c.dataFreshness)}</dd>` : ''}</dl>
      ${c.access && !c.access.allowed && c.access.message ? `<p class="pwa-warn">${esc(c.access.message)}</p>` : ''}
    </article>`;
  }
  /** offline home (§143–§146): developments prepared, or the explicit "nothing prepared" message — never an empty map (§145) */
  function offlineHome(cards = []) {
    const ready = cards.filter(c => c.canOpen);
    if (!ready.length) { const m = App.pwa.pack.NO_PACK_MESSAGE; return `<div class="pwa-empty" role="status"><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></div>`; }
    return `<div class="pwa-home"><h3>Disponível offline</h3>${cards.map(developmentCard).join('')}</div>`;
  }
  /** storage screen "Armazenamento offline" (§180–§182) */
  function storagePanel(vm, { offer = '' } = {}) {
    const rows = (vm.packs || []).map(p => `<tr><td>${esc(p.developmentId)}</td><td>${esc(stateLabel(p.state))}</td><td>${esc(fmt(p.bytes))}</td><td>${esc(when(p.lastUpdatedAt))}</td>
      <td>${btn('pwaPackRefresh', 'Atualizar', { attrs: ` data-id="${esc(p.packId)}"` })}${btn('pwaPackRemove', 'Remover', { attrs: ` data-id="${esc(p.packId)}"` })}</td></tr>`).join('');
    const usage = vm.estimatedUsageBytes != null && vm.estimatedQuotaBytes ? `Uso estimado: ${fmt(vm.estimatedUsageBytes)} de ${fmt(vm.estimatedQuotaBytes)} (estimativa do navegador).` : 'Uso do armazenamento: não disponível neste navegador.';
    return `<section class="pwa-storage" aria-label="Armazenamento offline"><h3>Armazenamento offline</h3><p class="small">${esc(usage)}</p>
      ${rows ? `<div class="pwa-tablewrap"><table class="pwa-table"><thead><tr><th>Empreendimento</th><th>Situação</th><th>Tamanho</th><th>Última atualização</th><th><span class="sr">Ações</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="small">Nenhum empreendimento preparado para uso offline.</p>'}
      ${vm.persistent === false ? '<p class="pwa-warn">Este navegador não guarda os dados offline após fechar a página.</p>' : ''}${offer}</section>`;
  }
  const stateLabel = s => ({ READY: 'Disponível offline', PARTIAL: 'Incompleto', STALE: 'Não verificado recentemente', UPDATE_AVAILABLE: 'Atualização disponível', UPDATE_REQUIRED: 'Precisa ser refeito', ERROR: 'Erro', REMOVING: 'Removendo', PREPARING: 'Preparando', NOT_PREPARED: 'Não preparado' }[s] || s);
  /** "Disponível quando online" in place of an action that needs the network (§151–§153) */
  function unavailableNotice(ev) {
    if (!ev || ev.available) return '';
    return `<p class="pwa-note" role="note">${esc(ev.message || 'Disponível quando online.')}</p>`;
  }
  /** freshness lines for availability / price shown from an offline copy (§65, §66, §149) */
  function freshness(lines = []) { return lines.length ? `<ul class="pwa-fresh">${lines.filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''; }
  /** sync queue (§296–§302) */
  function syncQueue(pending = [], result = null) {
    const conflicts = pending.filter(p => p.conflictState === 'USER_REVIEW_REQUIRED');
    if (!pending.length && !(result && (result.synced || result.duplicates))) return '';
    if (!pending.length) return `<p class="pwa-note" role="status">Sincronizado</p>`;
    const n = pending.length;
    return `<section class="pwa-queue" role="status" aria-live="polite"><p>${n === 1 ? '1 alteração aguardando sincronização' : `${n} alterações aguardando sincronização`}</p>
      ${conflicts.map(c => `<div class="pwa-warn"><p>${esc(App.pwa.sync.MESSAGES.CONFLICT)}</p>${btn('pwaConflictDiscard', 'Descartar minha alteração', { attrs: ` data-id="${esc(c.mutationId)}"` })}</div>`).join('')}
      ${btn('pwaSyncRetry', 'Tentar novamente')}</section>`;
  }
  /** technical diagnostics (admin/dev only, §242–§244): no tokens, no URLs */
  function diagnostics(d) {
    if (!d) return '';
    const rows = [['Serviço offline', d.serviceWorkerState], ['Versão do aplicativo', d.appBuildId], ['Versão do serviço offline', d.serviceWorkerBuildId || 'não disponível'], ['Compatibilidade', d.compatibility],
      ['Esquema de cache', d.cacheSchemaVersion], ['Esquema de pacote', d.offlinePackSchemaVersion], ['Conexão', d.connectivityState], ['Aplicativo instalado', d.installedStandalone ? 'sim' : 'não'],
      ['Pacotes offline ativos', d.activeOfflinePackCount], ['Alterações pendentes', d.pendingMutationCount], ['Última sincronização', d.lastSyncAt ? when(d.lastSyncAt) : 'não disponível'],
      ['Armazenamento (estimativa)', d.storageEstimate && d.storageEstimate.quota ? `${fmt(d.storageEstimate.usage)} de ${fmt(d.storageEstimate.quota)}` : 'não disponível']];
    return `<table class="pwa-table pwa-diag"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>${(d.warnings || []).map(w => `<p class="pwa-warn">${esc(w)}</p>`).join('')}`;
  }
  return Object.freeze({ esc, connectivityChip, offlineBanner, updateBanner, installEntry, installHint, packOffer, developmentCard, offlineHome, storagePanel, unavailableNotice, freshness, syncQueue, diagnostics, stateLabel });
})();
