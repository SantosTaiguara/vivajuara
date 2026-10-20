/* presentationmode/presentationView.js — topic 41 renderer: HTML strings from the AUDIENCE view (runtime.audienceView) and,
   on a separate surface, the presenter controls / preflight panel. It never receives a canonical Lot, a customer or a
   definition, so there is nothing internal to hide with CSS. Markup only; actions use delegated data-act:
   pmPrev, pmNext, pmStep (data-step), pmLot (data-lot), pmMap, pmFeedback (data-type, data-lot), pmComplete, pmEnd.
   Accessibility: landmarks, a live region for the step and for unconfirmed states, text (never colour alone),
   keyboard order = reading order, reduced motion respected by CSS (no animation here). */
App.presentationView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p = (t, cls) => t ? `<p${cls ? ` class="${cls}"` : ''}>${esc(t)}</p>` : '';
  const LOT_ACTION = { FOCUS_ON_MAP: 'Ver no mapa', COMPARE: 'Comparar', OPEN_FINANCIAL: 'Simular', RECORD_INTEREST: 'Gostei', REQUEST_VISIT: 'Quero visitar' };
  const ACT = { FOCUS_ON_MAP: 'pmLot', COMPARE: 'pmFeedback', OPEN_FINANCIAL: 'pmFeedback', RECORD_INTEREST: 'pmFeedback', REQUEST_VISIT: 'pmFeedback' };
  const FB = { COMPARE: 'COMPARE', OPEN_FINANCIAL: 'FINANCIAL_INTEREST', RECORD_INTEREST: 'LIKED', REQUEST_VISIT: 'VISIT_INTEREST' };
  function card(c) {
    if (!c) return '';
    const pr = c.price || {}, av = c.availability || {};
    return `<article class="pm-card" aria-label="${esc(c.identityLabel)}"><h3>${esc(c.identityLabel)}</h3>
      <p class="pm-av${av.confirmed ? '' : ' warn'}"><span class="vh">Situação: </span>${esc(av.label)}${av.caveat && av.caveat !== av.label ? ` <span class="small">${esc(av.caveat)}</span>` : ''}</p>
      <p class="pm-pr"><span class="lbl">${esc(pr.label)}:</span> ${esc(pr.text)}${pr.pricePerM2Text ? ` <span class="small">(${esc(pr.pricePerM2Text)})</span>` : ''}${pr.caveat ? ` <span class="small warn">${esc(pr.caveat)}</span>` : ''}</p>
      ${c.area ? p(`${c.area.label}: ${c.area.text}`, 'small') : ''}
      ${c.fitSummary ? `<p class="pm-fit">${esc(c.fitSummary.label)}${c.fitSummary.percentText ? ` · ${esc(c.fitSummary.percentText)}` : ''}${c.fitSummary.caveat ? ` <span class="small">${esc(c.fitSummary.caveat)}</span>` : ''}</p>` : ''}
      ${c.keyHighlights && c.keyHighlights.length ? `<ul class="pm-hl">${c.keyHighlights.map(h => `<li>${esc(h.text)}</li>`).join('')}</ul>` : ''}
      ${c.clientSafeAlerts && c.clientSafeAlerts.length ? `<ul class="pm-al" aria-label="Pontos de atenção">${c.clientSafeAlerts.map(a => `<li class="lv-${esc(String(a.level).toLowerCase())}">${a.title ? `<strong>${esc(a.title)}:</strong> ` : ''}${esc(a.text)}</li>`).join('')}</ul>` : ''}
      <div class="pm-acts" role="group" aria-label="Ações de ${esc(c.identityLabel)}">${(c.actions || []).filter(a => LOT_ACTION[a]).map(a => `<button class="btn small" data-act="${ACT[a]}" data-lot="${esc(c.lotRef)}"${FB[a] ? ` data-type="${FB[a]}"` : ''}>${esc(LOT_ACTION[a])}</button>`).join('')}</div></article>`;
  }
  function block(b) {
    if (!b) return `<p>${esc('Conteúdo indisponível nesta etapa.')}</p>`;
    const x = b.payload || {}, h = b.title ? `<h2>${esc(b.title)}</h2>` : '';
    switch (b.type) {
      case 'INTRO': return `${h}<h2>${esc(x.headline)}</h2>${p(x.subtitle)}${x.customerLabel ? p(`Preparado para ${x.customerLabel}`, 'small') : ''}${p(x.text)}`;
      case 'DEVELOPMENT_OVERVIEW': return `${h}<h2>${esc(x.name)}</h2>${p(x.city)}${p(x.legalName, 'small')}`;
      case 'CUSTOMER_OBJECTIVE': return `${h || '<h2>Seu objetivo</h2>'}${p(x.objective)}${p(x.priorities)}${p(x.budget)}`;
      case 'RECOMMENDATION_SUMMARY': return `${h || '<h2>Opções selecionadas</h2>'}${x.empty ? p(x.emptyText) : `<ol class="pm-recs">${x.items.map(i => `<li><p class="small">${esc(i.positionLabel)}</p>${card(i.card)}${i.reasons.length ? `<ul class="small">${i.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`}${(x.caveats || []).map(c => p(c, 'small')).join('')}`;
      case 'LOT_HIGHLIGHT': return h + card(x.card);
      case 'LOT_DETAILS': return h + card(x.card) + `<dl class="pm-dl">${(x.rows || []).map(r => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}${r.qualifier ? ` <span class="small">(${esc(r.qualifier)})</span>` : ''}</dd>`).join('')}</dl>`;
      case 'COMPARISON': return `${h || '<h2>Comparação</h2>'}<div class="pm-cmp">${(x.candidateCards || []).map(card).join('')}</div>
        ${(x.safeHighlights || []).length ? `<ul class="pm-hl">${x.safeHighlights.map(s => `<li><strong>${esc(s.lotLabel)}</strong> — ${esc(s.text)}</li>`).join('')}</ul>` : ''}
        <table class="pm-t"><caption class="vh">Critérios comparados</caption><thead><tr><th scope="col">Critério</th><th scope="col">Resultado</th></tr></thead><tbody>${(x.comparisonSections || []).map(s => `<tr><th scope="row">${esc(s.criterion)}</th><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table>${(x.caveats || []).map(c => p(c, 'small')).join('')}`;
      case 'FINANCIAL_SIMULATION': { const s = x.simulation || {}; return `${h || '<h2>Condições de pagamento</h2>'}${card(x.card)}${s.available ? `<p class="pm-st"><strong>${esc(s.statusLabel)}</strong>${s.statusText ? ' — ' + esc(s.statusText) : ''}</p>
        <p>${esc(s.basePrice.label)}: ${esc(s.basePrice.text)} · ${esc(s.downPayment.label)}: ${esc(s.downPayment.text)}</p><ul>${s.plans.map(pl => `<li><strong>${esc(pl.name)}</strong>: ${esc(pl.installments)}${pl.annual ? ' ' + esc(pl.annual) : ''}${pl.condition ? ` <span class="small">(${esc(pl.condition)})</span>` : ''}</li>`).join('')}</ul>
        ${s.assumptions.map(a => p(a, 'small')).join('')}${s.caveats.map(c => p(c, 'small')).join('')}` : p(s.text)}`; }
      case 'MAP': return `${h || '<h2>Localização no empreendimento</h2>'}<button class="btn" data-act="pmMap">Abrir mapa</button><ul class="pm-maplist" aria-label="Lotes apresentados (alternativa ao mapa)">${(x.textAlternative || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
      case 'LOCATION': return `${h || '<h2>Distâncias</h2>'}${(x.items || []).map(i => `<h3>${esc(i.lotLabel)}</h3><dl class="pm-dl">${i.rows.map(r => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join('')}</dl>`).join('')}`;
      case 'AVAILABILITY_STATUS': return `${h || '<h2>Situação comercial</h2>'}<ul>${(x.items || []).map(i => `<li>${esc(i.lotLabel)}: ${esc(i.availability.label)}${i.availability.caveat && i.availability.caveat !== i.availability.label ? ' ' + esc(i.availability.caveat) : ''}</li>`).join('')}</ul>`;
      case 'INVESTMENT_CONTEXT': return `${h || '<h2>Preço de tabela por m²</h2>'}<ul>${(x.items || []).map(i => `<li>${esc(i.lotLabel)}: ${esc(i.priceText)}${i.pricePerM2Text ? ` (${esc(i.pricePerM2Text)})` : ''}</li>`).join('')}</ul>${p(x.tableLabel, 'small')}${p(x.caveat, 'small')}`;
      case 'ALERTS_CLIENT_SAFE': return `${h || '<h2>Pontos de atenção</h2>'}${(x.items || []).map(i => `<h3>${esc(i.lotLabel)}</h3><ul>${i.alerts.map(a => `<li>${a.title ? `<strong>${esc(a.title)}:</strong> ` : ''}${esc(a.text)}</li>`).join('')}</ul>`).join('')}`;
      case 'NEXT_STEPS': return `${h || '<h2>Próximos passos</h2>'}<ol>${(x.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ol>`;
      case 'CUSTOM': return h + p(x.text);
      default: return p('Conteúdo indisponível nesta etapa.');
    }
  }
  /** audience(view) — view = App.presentationMode.runtime.audienceView(sessionId) */
  function audience(v) {
    const st = v.step;
    return `<main class="pm-aud" aria-labelledby="pmTitle"><header class="pm-head"><h1 id="pmTitle">${esc(v.title)}</h1>${v.preparedAtLabel ? `<p class="small">${esc(v.preparedAtLabel)}</p>` : ''}</header>
      <section class="pm-step" aria-live="polite" aria-label="${st ? `Etapa ${st.order} de ${st.total}` : 'Apresentação'}">${block(v.block)}</section>
      <nav class="pm-nav" aria-label="Navegação da apresentação"><button class="btn" data-act="pmPrev"${st && st.order > 1 ? '' : ' disabled'}>Anterior</button>
        <span class="small">${st ? `${st.order} / ${st.total}` : ''}</span><button class="btn pri" data-act="pmNext"${st && st.order < st.total ? '' : ' disabled'}>Próximo</button>
        <button class="btn" data-act="pmMap">Mapa</button></nav></main>`;
  }
  /** presenter(controlState) — separate surface/drawer; never mirrored to the audience */
  function presenter(c) {
    return `<aside class="pm-presenter" aria-label="Controles do apresentador"><h2>Apresentador</h2>
      ${(c.warnings || []).length ? `<ul class="small warnl">${c.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${c.presenterNotesVisible && c.notes.length ? `<ul class="pm-notes">${c.notes.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
      <div role="group" aria-label="Ações"><button class="btn" data-act="pmComplete">Concluir apresentação</button><button class="btn" data-act="pmEnd">Encerrar</button></div></aside>`;
  }
  /** preflight(result) — internal preview issue panel (presenter only) */
  function preflight(r) {
    const li = xs => xs.map(i => `<li>${esc(i.message)}${i.lotRef ? ` (${esc(i.lotRef)})` : ''}${i.overridden ? ' — liberado com justificativa' : ''}</li>`).join('');
    const lbl = { PASS: 'Pronta para apresentar', PASS_WITH_WARNINGS: 'Pronta, com avisos', FAIL: 'Bloqueada: corrija antes de apresentar' }[r.status];
    return `<section class="pm-pre" aria-label="Verificação da apresentação"><h2>${esc(lbl)}</h2>${r.blockingIssues.length ? `<h3>Bloqueios</h3><ul>${li(r.blockingIssues)}</ul>` : ''}${r.warnings.length ? `<h3>Avisos</h3><ul>${li(r.warnings)}</ul>` : ''}</section>`;
  }
  return Object.freeze({ audience, presenter, preflight, block, card, esc });
})();
