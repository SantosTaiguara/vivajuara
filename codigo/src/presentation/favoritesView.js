/* presentation/favoritesView.js — UI of topics 37/38 as pure functions returning HTML strings (no DOM, no storage).
   - toggleButton: persistent star toggle (☆ Favoritar / ★ Favoritado), aria-pressed + aria-label, never colour alone.
   - contextChip: which favorites context is active ("Meus favoritos" / "Favoritos de Maria"); switching is explicit.
   - list: favorites panel/sheet (same markup on desktop tab, tablet and mobile bottom sheet); current status and price
     come from the read model (live), a sold lot stays listed with "Vendido", an unknown price reads "Preço não disponível".
   - undoToast: removal is a domain remove; "Desfazer" calls restore.
   - dataValue: one field rendered from a topic 37 ResolvedAttributeValue (value, state label, stale overlay, aria text).
   The lead wires these in app.js/panels.js (docs/FAVORITES_UI_INTEGRATION.md). */
App.favoritesView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FLAG_LABEL = { SOLD: 'Vendido', RESERVED: 'Reservado', UNAVAILABLE: 'Indisponível', PRICE_UNKNOWN: 'Preço não disponível', PRICE_CHANGED: 'Preço mudou desde que foi favoritado',
    STATUS_CHANGED: 'Status mudou desde que foi favoritado', STALE_COMMERCIAL_DATA: 'Preço a confirmar', HAS_CRITICAL_ALERT: 'Alerta crítico', ORPHANED: 'Lote não encontrado na versão atual', ANALYSIS_UPDATED: 'Análise atualizada' };
  /** toggleButton({ lotId, isFavorite, contextLabel, compact }) — data-act="fav" (existing action) */
  function toggleButton({ lotId, isFavorite, contextLabel, compact } = {}) {
    const label = isFavorite ? App.favorites.MESSAGES.remove : App.favorites.MESSAGES.add;
    const text = isFavorite ? '★ Favoritado' : '☆ Favoritar';
    return `<button type="button" class="fav-toggle${isFavorite ? ' on' : ''}" data-act="fav" data-id="${esc(lotId)}" aria-pressed="${isFavorite ? 'true' : 'false'}" aria-label="${esc(label + (contextLabel ? ' — ' + contextLabel : ''))}">${compact ? (isFavorite ? '★' : '☆') : text}</button>`;
  }
  /** contextChip(activeContext) — the context switcher (proposed action "favCtx") is added by the lead with its features.json entry */
  const contextChip = ctx => `<span class="fav-ctx" role="status">${esc(ctx ? ctx.label : 'Meus favoritos')}</span>`;
  /** list(items, { context, client, count }) — items = service.listItems(...).items */
  function list(items, o = {}) {
    const ctx = o.context, empty = ctx && ctx.type === 'CUSTOMER' ? App.favorites.MESSAGES.emptyCustomer : App.favorites.MESSAGES.empty;
    let h = `<section class="fav-panel" aria-label="Favoritos"><header class="fav-head"><h2 class="fav-title">Favoritos</h2>${contextChip(ctx)}<span class="fav-count">${items.length} ${items.length === 1 ? 'favorito' : 'favoritos'}</span></header>`;
    if (!items.length) return h + `<p class="fav-empty">${esc(empty)}</p></section>`;
    h += '<ul class="fav-list">';
    for (const it of items) {
      const flags = it.stateFlags.filter(f => FLAG_LABEL[f] && f !== 'PRICE_UNKNOWN').map(f => `<span class="fav-flag fav-flag-${esc(f.toLowerCase())}">${esc(FLAG_LABEL[f])}</span>`).join('');
      h += `<li class="fav-item${it.orphan ? ' orphan' : ''}" data-lot="${esc(it.lotId)}"><div class="fav-main"><button type="button" class="fav-name" data-act="goLot" data-id="${esc(it.lotId)}">${esc(it.label)}</button>`
        + `<p class="fav-meta"><span class="fav-status">${esc(it.orphan ? FLAG_LABEL.ORPHANED : it.currentAvailabilityLabel)}</span> · <span class="fav-price">${esc(it.currentPriceLabel)}</span>${it.priceNote ? ` <span class="fav-note-stale">(${esc(it.priceNote)})</span>` : ''}</p>`
        + (flags ? `<p class="fav-flags">${flags}</p>` : '') + (!o.client && it.notePreview ? `<p class="fav-note">${esc(it.notePreview)}</p>` : '') + (it.collectionLabels.length ? `<p class="fav-colls">${it.collectionLabels.map(esc).join(' · ')}</p>` : '') + '</div>';
      if (!o.client && !it.orphan) h += `<div class="fav-actions"><button type="button" data-act="cmp" data-id="${esc(it.lotId)}">Comparar</button>${toggleButton({ lotId: it.lotId, isFavorite: it.isFavorite, compact: true })}</div>`;
      h += '</li>';
    }
    return h + '</ul></section>';
  }
  /** undoToast(lotId) — "Favorito removido. Desfazer": the existing "fav" action re-adds, which reactivates the same record (restore) */
  const undoToast = lotId => `<div class="fav-toast" role="status" aria-live="polite">${esc(App.favorites.MESSAGES.removedUndo)} <button type="button" data-act="fav" data-id="${esc(lotId)}">${esc(App.favorites.MESSAGES.undo)}</button></div>`;
  /** syncNotice(kind) — only when relevant (offline / rollback); technical sync states are not shown to brokers */
  const syncNotice = kind => kind === 'LOCAL' ? `<p class="fav-sync" role="status">${esc(App.favorites.MESSAGES.syncFailedLocal)}</p>` : kind === 'FAILED' ? `<p class="fav-sync err" role="alert">${esc(App.favorites.MESSAGES.saveFailed)}</p>` : '';
  /** dataValue(label, resolved) — topic 37 field rendering; HIDDEN (null) renders nothing */
  function dataValue(label, r) {
    if (!r || r.projectedState === 'HIDDEN') return '';
    const d = r.display;
    return `<div class="ds-field ${esc(d.semanticToken)}" data-state="${esc(r.projectedState)}"><dt>${esc(label)}</dt><dd aria-label="${esc(d.ariaText)}">${esc(d.primaryText)}${d.showValue && d.stateLabel ? ` <span class="ds-stale">${esc(d.stateLabel)}</span>` : ''}${d.secondaryText && !d.showValue ? ` <span class="ds-reason">${esc(d.secondaryText)}</span>` : ''}</dd></div>`;
  }
  return Object.freeze({ toggleButton, contextChip, list, undoToast, syncNotice, dataValue, FLAG_LABEL });
})();
