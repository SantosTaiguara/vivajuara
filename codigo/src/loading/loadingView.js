/* loading/loadingView.js — topic 47: HTML for local loading states (UI module: in the build's UI list, not in the harness ORDER).
   skeleton(kind) reserves the final layout (no jump), is aria-busy and announces ONE polite status; background prefetch is never
   announced. resourceStatus(result) turns a ResourceLoadResult into the local message: error of an action the user asked for →
   announced with a keyboard-reachable retry; optional failures degrade silently to their failure-policy text. Never a default
   value pretending to be data (no "R$ 0", no "Disponível" while loading). */
App.loadingView = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LINES = { quickview: ['big', 'w80', 'w60', 'w80', 'w40'], section: ['w80', 'w60', 'w80'], comparison: ['big', 'w80', 'w80', 'w60'], legend: ['w60', 'w40'], text: ['w80', 'w60'] };
  const LABEL = { quickview: 'Carregando dados essenciais do lote…', section: 'Carregando a seção…', comparison: 'Carregando a comparação…', legend: 'Carregando a camada…', text: 'Carregando…', image: 'Carregando a imagem…', technical: 'Carregando as medições…' };
  /** skeleton(kind, { label, minHeight, aspectRatio }) → HTML */
  function skeleton(kind = 'text', o = {}) {
    const label = o.label || LABEL[kind] || LABEL.text;
    if (kind === 'image') return `<div class="ldsk-img" role="img" aria-label="${esc(label)}"${o.aspectRatio ? ` style="--ldsk-ar:${esc(o.aspectRatio)}"` : ''}></div>`;
    const lines = (LINES[kind] || LINES.text).map(c => `<i class="ldl ${c}" aria-hidden="true"></i>`).join('');
    return `<div class="ldsk ldsk-${esc(kind)}" aria-busy="true"${o.minHeight ? ` style="--ldsk-h:${Math.round(o.minHeight)}px"` : ''}><span class="sr" role="status" aria-live="polite">${esc(label)}</span>${lines}</div>`;
  }
  /** resourceStatus(result, { what, userRequested, retryAct }) → '' when ready; otherwise a local status line */
  function resourceStatus(r, o = {}) {
    if (!r || r.state === 'READY') return '';
    const what = esc(o.what || 'o conteúdo');
    if (r.state === 'PARTIAL') return `<p class="ldst" role="status">Parte dos dados de ${what} ainda está carregando.</p>`;
    if (r.state === 'SCHEDULED' || r.state === 'LOADING') return skeleton(o.kind || 'text', { label: `Carregando ${o.what || 'o conteúdo'}…` });
    if (r.state === 'CANCELLED' || r.state === 'DISCARDED_STALE') return '';
    const msg = (r.failure && r.failure.message) || `Não foi possível carregar ${o.what || 'o conteúdo'} agora.`;
    const retry = r.failure && r.failure.userRetryAllowed && o.retryAct ? ` <button class="btn sm" type="button" data-act="${esc(o.retryAct)}"${o.retryKey ? ` data-k="${esc(o.retryKey)}"` : ''}>Tentar de novo</button>` : '';
    return `<p class="ldst err" role="${o.userRequested ? 'alert' : 'status'}">${esc(msg)}${retry}</p>`;
  }
  return Object.freeze({ skeleton, resourceStatus, LABEL });
})();
