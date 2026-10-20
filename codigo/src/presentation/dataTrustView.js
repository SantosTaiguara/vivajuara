/* presentation/dataTrustView.js — UI of topics 32, 33 and 34 as pure functions returning HTML strings.
   - Documents: "Documentos relacionados (n)" list for Quick View / Full Details (App.documentServices.relatedDocuments).
   - Provenance: small badge per field (Confirmado / Calculado / Estimado / Informado / Não disponível / Conflito / Revisar)
     and a technical drilldown (sources, method, inputs, warnings) — from App.provenanceServices projections.
   - Data confidence: technical panel only. In SHADOW / DRAFT the projection is invisible to client and broker;
     the panel always says "não é probabilidade" and never colours a band as "garantido".
   Nothing here computes: views receive projections/view models. Controls carry data-act names for the lead to wire. */
App.dataTrustView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CODE_CLASS = { CONFIRMED: 'conf', CALCULATED: 'calc', ESTIMATED: 'est', INFORMED: 'chk', LEGACY: 'chk', MANUAL: 'chk', NOT_AVAILABLE: 'nd', CONFLICT: 'chk', REVIEW: 'chk' };
  const num = v => v == null ? '—' : String(Math.round(v * 1000) / 1000).replace('.', ',');

  /** relatedDocuments(vm) — vm = App.documentServices.relatedDocuments(...) */
  function relatedDocuments(vm) {
    if (!vm || !vm.count) return `<section class="dt-docs" aria-label="Documentos relacionados"><h3>Documentos relacionados</h3><p class="dt-muted">Nenhum documento disponível.</p></section>`;
    return `<section class="dt-docs" aria-label="${esc(vm.label)}"><h3>${esc(vm.label)}</h3><ul class="dt-doclist">${vm.cards.map(c => `<li class="dt-doc" aria-label="${esc(c.ariaLabel)}">
      <div class="dt-doc-t"><b>${esc(c.title)}</b><span class="dt-muted">${esc(c.typeLabel)} · ${esc(c.authorityLabel)}${c.classificationLabel ? ' · ' + esc(c.classificationLabel) : ''}</span></div>
      <div class="dt-doc-v dt-muted">${esc(c.currentVersionLabel)}</div>
      <div class="dt-doc-a">${c.actions.map(a => `<button class="btn sm" data-act="${esc(a.id)}" data-doc="${esc(c.documentId)}"${a.enabled ? '' : ' disabled'}>${esc(a.label)}</button>`).join('')}</div></li>`).join('')}</ul></section>`;
  }
  /** badge(projection, { attributePath }) — projection = provenanceService.project(t, record, { mode }) (CLIENT/BROKER) */
  function badge(p, o = {}) {
    if (!p || p.ok === false) return '';
    const cls = CODE_CLASS[p.displayCode] || 'nd', label = p.label || '';
    const title = [p.reason ? 'Motivo: ' + p.reason : null, p.sourcePhrase || null].filter(Boolean).join(' · ');
    const act = o.attributePath && o.drilldown ? ` data-act="prov-open" data-path="${esc(o.attributePath)}" role="button" tabindex="0"` : '';
    return `<span class="dt-badge dt-${cls}"${act}${title ? ` title="${esc(title)}"` : ''} aria-label="Origem do dado: ${esc(label)}${title ? '. ' + esc(title) : ''}">${esc(label)}</span>`;
  }
  /** drilldown(projection TECHNICAL|AUDIT, lineageVm?) — technical provenance panel */
  function drilldown(p, lineage) {
    if (!p || p.ok === false) return `<div class="dt-panel"><p class="dt-muted">${esc(p && p.message || 'Sem acesso aos detalhes de proveniência.')}</p></div>`;
    const src = (p.sources || []).map(s => s.visibility === 'HIDDEN' ? '<li>Fonte restrita (oculta)</li>' : s.type === 'DOCUMENT_VERSION' && s.documentId
      ? `<li>Documento <code>${esc(s.documentId)}</code> versão <code>${esc(s.documentVersionId)}</code>${s.locator && s.locator.pageNumber ? ' · pág. ' + esc(s.locator.pageNumber) : ''}${s.locator && s.locator.cellRange ? ' · ' + esc(s.locator.sheetName) + '!' + esc(s.locator.cellRange) : ''}</li>`
      : `<li>${esc(s.label || s.type)}${s.recordType ? ' · ' + esc(s.recordType) + ' ' + esc(s.recordId) : ''}${s.configId ? ' · ' + esc(s.configId) + '@' + esc(s.configVersion) : ''}${s.moduleId ? ' · ' + esc(s.moduleId) + '@' + esc(s.moduleVersion) : ''}</li>`).join('');
    const m = p.methodRef ? `<p>Método: <code>${esc(p.methodRef.methodId)} v${esc(p.methodRef.methodVersion)}</code> (${esc(p.methodRef.methodType)})</p>` : '';
    const deps = (p.dependencyRefs || []).length ? `<p>Entradas: ${p.dependencyRefs.map(d => `<code>${esc(d.attributePath)}</code>`).join(', ')}</p>` : '';
    const tree = lineage && lineage.ok ? `<details><summary>Linhagem (profundidade ${esc(lineage.vm.depth)})</summary>${treeHtml(lineage.vm.dependencyNodes)}</details>` : '';
    const meta = p.metadata || {};
    const legacy = meta.legacyLabel ? `<p class="dt-muted">Rótulo legado: ${esc(meta.legacyLabel)}${meta.legacySourceId ? ' · fonte ' + esc(meta.legacySourceId) : ''}${meta.candidateDocumentId ? ' · documento candidato ' + esc(meta.candidateDocumentId) + ' (vínculo ' + esc(meta.candidateMatchStatus || 'não confirmado') + ')' : ''}</p>` : '';
    return `<div class="dt-panel" role="region" aria-label="Proveniência de ${esc(p.attributePath)}">
      <p><span class="dt-badge dt-${CODE_CLASS[p.displayCode] || 'nd'}">${esc(p.label)}</span> <code>${esc(p.provenanceKind)}</code> · evidência <code>${esc(p.evidenceState)}</code> · atualidade <code>${esc(p.currentness)}</code> · registro <code>${esc(p.status)}</code></p>
      ${p.reason ? `<p>Motivo da ausência: ${esc(p.reason)}</p>` : ''}${src ? `<ul class="dt-src">${src}</ul>` : '<p class="dt-muted">Nenhuma fonte exata registrada.</p>'}${m}${deps}${legacy}
      ${(p.warnings || []).length ? `<p class="dt-warn">Avisos: ${p.warnings.map(esc).join(', ')}</p>` : ''}${tree}
      <p class="dt-muted">Proveniência indica de onde o valor veio; não é garantia de que o valor está correto.</p>
      <div class="dt-acts"><button class="btn sm" data-act="prov-history" data-path="${esc(p.attributePath)}">Histórico</button>${p.conflictRef ? `<button class="btn sm" data-act="prov-resolve" data-path="${esc(p.attributePath)}">Resolver conflito</button>` : ''}</div></div>`;
  }
  const treeHtml = nodes => nodes && nodes.length ? `<ul class="dt-tree">${nodes.map(n => `<li>${esc(n.label)} <span class="dt-muted">(${esc(n.displayCode || n.type)})</span>${n.truncated ? ' …' : ''}${treeHtml(n.children)}</li>`).join('')}</ul>` : '';
  /** confidencePanel(projection TECHNICAL) — projection = confidenceService.project(t, result, { mode: 'TECHNICAL', access }) */
  function confidencePanel(c) {
    if (!c || c.ok === false || !c.visible) return '';
    const rows = (c.dimensions || []).map(d => `<tr><th scope="row">${esc(d.dimension)}</th><td>${esc(d.status)}</td><td>${num(d.score)}</td><td>${num(d.normalizedWeight)}</td><td>${num(d.contribution)}</td><td>${esc((d.reasonCodes || []).join(', '))}</td></tr>`).join('');
    return `<section class="dt-cpanel" aria-label="Confiança do dado (técnico)"><h3>Confiança do dado <span class="dt-tag">${esc(c.methodologyBadge)}</span></h3>
      <p class="dt-score">${c.score == null ? esc(c.text) : `<b>${esc(c.score)}/100</b> — ${esc(c.bandLabel)}. ${esc(c.text.replace(/^Confiança [^.]*\.\s*/, ''))}`}</p>
      ${c.shadow ? '<p class="dt-warn">Modo shadow: visível apenas no modo técnico; não altera scores, ranking, classes, recomendação nem cores.</p>' : ''}
      ${rows ? `<table class="dt-table"><caption class="dt-muted">Dimensões avaliadas</caption><thead><tr><th scope="col">Dimensão</th><th scope="col">Estado</th><th scope="col">Nota</th><th scope="col">Peso</th><th scope="col">Contribuição</th><th scope="col">Motivos</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      ${(c.appliedCaps || []).length ? `<p>Tetos aplicados: ${c.appliedCaps.map(x => esc(x.capType) + ' ≤ ' + num(x.capValue)).join(', ')}</p>` : ''}
      ${(c.limitingFactors || []).length ? `<p>Fatores limitantes: ${c.limitingFactors.map(l => esc(l.code)).join(', ')}</p>` : ''}
      <p class="dt-muted">${(c.caveats || []).map(esc).join(' ')} Calibração: ${esc(c.calibrationStatus)}.</p></section>`;
  }
  return Object.freeze({ relatedDocuments, badge, drilldown, confidencePanel, ACTIONS: Object.freeze(['doc-preview', 'doc-download', 'prov-open', 'prov-history', 'prov-resolve', 'conf-open']) });
})();
