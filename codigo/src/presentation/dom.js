/* presentation/dom.js — tiny DOM helpers shared by the views (no framework). */
App.ui = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (k, v) => v == null || v === false ? '' : v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  const ICON = {
    close: '<path d="M5 5l10 10M15 5L5 15"/>', back: '<path d="M12 4l-6 6 6 6"/>', heart: '<path d="M10 16.5s-6-3.7-6-8A3.3 3.3 0 0 1 10 6a3.3 3.3 0 0 1 6 2.5c0 4.3-6 8-6 8z"/>',
    cmp: '<path d="M4 5h5v10H4zM11 5h5v10h-5z"/>', share: '<path d="M14 7l-8 3.5 8 3.5M14 4.5a1.8 1.8 0 1 0 0 .1M14 15.5a1.8 1.8 0 1 0 0 .1M6 10.5a1.8 1.8 0 1 0 0 .1"/>',
    sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
    calc: '<rect x="4.5" y="3" width="11" height="14" rx="1.5"/><path d="M7 6.5h6M7 10h1M10 10h1M13 10h0M7 13h1M10 13h1M13 13h0"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.1"/>', layers: '<path d="M10 3l7 4-7 4-7-4zM3 11l7 4 7-4"/>', image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 13l4-4 3 3 2-2 5 5"/>',
    expand: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>', find: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>', route: '<path d="M5 16c0-4 10-3 10-8M5 16v.1M15 8V4"/><circle cx="5" cy="16" r="1.6"/><circle cx="15" cy="4" r="1.6"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5"/>', fit: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M8 10h4M10 8v4"/>', list: '<path d="M7 6h9M7 10h9M7 14h9M4 6v.1M4 10v.1M4 14v.1"/>'
  };
  const icon = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;
  let toastT = null;
  function toast(msg, ms = 2600) { const t = $('toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
  /** popover anchored to an element; closes on outside click / Escape (handled by the app).
      It is a non-modal dialog: labelled by its title, focus moves in and returns to the anchor on close.
      On phones (< 600 px) it opens as a bottom sheet instead of a floating box. */
  let popAnchor = null, popAnchorSel = null;
  function popover(anchor, html) {
    const p = $('pop'); p.innerHTML = html; p.hidden = false;
    if (anchor) { popAnchor = anchor; const box = anchor.closest('[id]'), d = anchor.dataset || {};
      popAnchorSel = d.act ? `${box ? '#' + box.id + ' ' : ''}[data-act="${d.act}"]${d.k ? `[data-k="${d.k}"]` : ''}${d.id ? `[data-id="${d.id}"]` : ''}` : null; }
    const title = p.querySelector('.poph b'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', title ? title.textContent : 'Detalhes');
    const sheet = window.innerWidth < 600; p.classList.toggle('pop-sheet', sheet);
    if (sheet) { p.style.left = ''; p.style.top = ''; }
    else if (anchor) {
      const r = anchor.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
      let x = Math.min(window.innerWidth - w - 12, Math.max(12, r.left)), y = r.bottom + 6;
      if (y + h > window.innerHeight - 12) y = Math.max(12, r.top - h - 6);
      p.style.left = x + 'px'; p.style.top = y + 'px';
    }
    const f = p.querySelector('button,[tabindex]'); if (f) f.focus({ preventScroll: true });
  }
  const closePop = () => { const p = $('pop'); if (!p || p.hidden) return; const ae = document.activeElement, back = !ae || ae === document.body || p.contains(ae) ? popAnchor : null; p.hidden = true; const sel = popAnchorSel; popAnchor = null; popAnchorSel = null;
    if (!back) return; let n = document.contains(back) ? back : null; // the anchor may have been re-rendered while the popover was open
    if (!n && sel) { try { n = document.querySelector(sel); } catch (e) { n = null; } } if (n) n.focus({ preventScroll: true }); };
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { /* ignore */ } ta.remove(); return ok; } }
  return { $, esc, attr, icon, toast, popover, closePop, copy };
})();
