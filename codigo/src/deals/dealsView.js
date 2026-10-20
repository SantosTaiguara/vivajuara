/* deals/dealsView.js — topic 57 UI strings (markup only: no DOM access, no state, no writes, no calculation).
   Input = what the deals API returns (proposal read model, reservation board, closing read model, lotCommercialState, capabilities).
   Deny by default: without proposal.read / reservation.read / closing.read the corresponding block is '' (the public visitor sees nothing).
   Never shows who reserved a lot, never shows a price other than the table snapshot, never promises valorização.
   data-act used (new, inert until the coordinator wires them): dealOpenProposal, dealOpenReservation, dealOpenClosing, dealRefresh. */
App.dealsView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => App.deals.domain;
  /** permission check: an explicit opts.can wins; else App.authz.can; else deny */
  const canFn = opts => typeof (opts && opts.can) === 'function' ? opts.can : (App.authz && typeof App.authz.can === 'function' ? k => App.authz.can(k) : () => false);
  const chip = (kind, st) => { const c = D().chip(kind, st); return `<span class="chip tone-${esc(c.tone)}">${esc(c.label)}</span>`; };

  /** lotBadge(state) — small badge for map / QuickView; '' without lot.availability.view-equivalent context */
  function lotBadge(state, opts = {}) {
    if (!canFn(opts)('reservation.read') && !canFn(opts)('proposal.read')) return '';
    const b = D().lotBadge(state);
    const until = state && state.reservedUntil && state.serverTime ? ` · ${esc(D().countdown(state.reservedUntil, state.serverTime).text)}` : '';
    return `<span class="deal-badge tone-${esc(b.tone)}">${esc(b.label)}${until}</span>`;
  }

  /** proposalCard(readModel) — proposal + current version (price from the table snapshot) */
  function proposalCard(m, opts = {}) {
    if (!m || !m.proposal || !canFn(opts)('proposal.read')) return '';
    const p = m.proposal, v = Array.isArray(m.versions) && m.versions.length ? m.versions[m.versions.length - 1] : null, pr = v && v.pricing ? v.pricing : {};
    const overlay = m.currentPriceOverlay && m.currentPriceOverlay.differsFromProposal ? `<p class="small warn">O preço de tabela mudou depois da emissão desta versão; a versão emitida não muda.</p>` : '';
    return `<article class="deal-card" data-proposal="${esc(p.id)}">
      <header><b>Proposta</b> ${chip('proposal', p.status)}${v ? ` <span class="small">versão ${esc(v.versionNumber)}</span>` : ''}</header>
      <p>Lote <b>${esc(p.lotId)}</b> · preço de tabela ${esc(D().money(pr.listPriceMinor))}${pr.offerPriceMinor != null && pr.offerPriceMinor !== pr.listPriceMinor ? ` · oferta ${esc(D().money(pr.offerPriceMinor))}` : ''}</p>
      ${v && v.validUntil && m.serverTime ? `<p class="small">Validade: ${esc(D().countdown(v.validUntil, m.serverTime).text)}</p>` : ''}${overlay}
      <button class="lbtn small" data-act="dealOpenProposal" data-id="${esc(p.id)}">Abrir proposta</button></article>`;
  }

  /** reservationBoard(rows, serverTime) — soonest expiration first (order comes from the API) */
  function reservationBoard(rows, serverTime, opts = {}) {
    if (!canFn(opts)('reservation.read')) return '';
    if (!Array.isArray(rows) || !rows.length) return `<section class="deal-board"><h3>Reservas</h3><p class="small">Nenhuma reserva ativa.</p></section>`;
    return `<section class="deal-board"><h3>Reservas</h3><ul>${rows.map(r => `<li data-reservation="${esc(r.reservationId)}">
      <b>${esc(r.lotId)}</b> ${chip('reservation', r.status)} <span class="small">${esc(D().countdown(r.expiresAt, serverTime).text)}</span>
      <button class="lbtn small" data-act="dealOpenReservation" data-id="${esc(r.reservationId)}">Abrir</button></li>`).join('')}</ul></section>`;
  }

  /** closingSummary(readModel) — checklist progress counts only (no document content, no customer data) */
  function closingSummary(m, opts = {}) {
    if (!m || !m.closing || !canFn(opts)('closing.read')) return '';
    const c = m.closing, pg = m.readiness && m.readiness.progress ? m.readiness.progress : null;
    const out = m.outcome ? ` ${chip('outcome', m.outcome.outcome)}` : '';
    return `<article class="deal-card" data-closing="${esc(c.id)}"><header><b>Fechamento</b> ${chip('closing', c.status)}${out}</header>
      ${pg ? `<p class="small">Checklist: ${esc(pg.done)} de ${esc(pg.total)} itens validados</p>` : ''}
      ${m.readiness && m.readiness.blockingItems && m.readiness.blockingItems.length ? `<p class="small warn">${esc(m.readiness.blockingItems.length)} pendência(s) antes de concluir</p>` : ''}
      <button class="lbtn small" data-act="dealOpenClosing" data-id="${esc(c.id)}">Abrir fechamento</button></article>`;
  }

  /** blocked(capabilities) — why an action is unavailable, in pt-BR (policy not configured = "necessita confirmação") */
  function reasons(cap) {
    if (!cap || !Array.isArray(cap.reasonCodes) || !cap.reasonCodes.length) return '';
    const txt = rc => { const [code] = String(rc).split(':'); return code === 'NO_PERMISSION' ? 'Sem permissão para esta ação.' : code === 'LOT_SOLD' ? 'Lote vendido.' : code.startsWith('LOT_') && !D().ERROR_CODES.includes(code) ? 'Lote indisponível para esta ação.' : D().errorMessage(code); };
    return `<ul class="deal-reasons small">${[...new Set(cap.reasonCodes.map(txt))].map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }

  /** panel(vm, opts) — whole commercial block; '' for anyone without a deals read permission */
  function panel(vm = {}, opts = {}) {
    const can = canFn(opts);
    if (!['proposal.read', 'reservation.read', 'closing.read'].some(k => can(k))) return '';
    const body = [proposalCard(vm.proposal, opts), reservationBoard(vm.reservations, vm.serverTime, opts), closingSummary(vm.closing, opts), reasons(vm.capabilities)].filter(Boolean).join('');
    return `<section class="deals-panel" aria-label="Proposta, reserva e fechamento"><h2>Negociação</h2>${body || '<p class="small">Nenhuma negociação para este contexto.</p>'}
      <p class="small">Valores do preço de tabela vigente. Sem processamento de pagamento. Não é orientação jurídica.</p>
      <button class="lbtn small" data-act="dealRefresh">Atualizar</button></section>`;
  }
  return Object.freeze({ panel, lotBadge, proposalCard, reservationBoard, closingSummary, reasons });
})();
