/* onboarding/onboardingView.js — topic 58 §282–291: technical/admin onboarding screens as HTML strings (everything escaped).
   Not shown to brokers or public visitors (§377): the integrator mounts it only behind development_onboarding.read.
   Source inventory, mapping table, data-quality grouped by severity, diff, publication preview (watermark
   "DADOS NÃO PUBLICADOS"), checklist and publish summary. Warnings are never hidden (§291, §449). */
App.onboardingView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = () => App.onboarding.model;
  const table = (cls, head, rows) => `<table class="${esc(cls)}"><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">Nada a mostrar.</td></tr>`}</tbody></table>`;
  const short = c => c ? String(c).replace(/^sha256:/, '').slice(0, 12) + '…' : '—';

  function sourceInventory(sources = [], matrix = null) {
    const auth = new Map(); if (matrix) for (const r of matrix.rows) if (r.primarySourceAssetId) auth.set(r.primarySourceAssetId, [...(auth.get(r.primarySourceAssetId) || []), r.domain]);
    return `<section class="ob-sources" aria-label="Inventário de fontes"><h3>Fontes</h3>${table('ob-table', ['Fonte', 'Tipo', 'Finalidade', 'Versão', 'Status', 'Checksum', 'Recebida', 'Autoridade'],
      sources.map(s => [s.originalFileName, s.sourceType, s.purpose, s.version, s.status + (s.scan && s.scan.status !== 'CLEAN' ? ` (varredura: ${s.scan.status})` : ''), short(s.checksum), s.uploadedAt || '—', (auth.get(s.id) || []).join(', ') || '—']))}</section>`;
  }
  function mappingTable(schema, set) {
    const rules = new Map((set ? set.rules : []).map(r => [r.sourceField, r]));
    return `<section class="ob-mapping" aria-label="Mapeamento de campos"><h3>Mapeamento</h3>${table('ob-table', ['Campo de origem', 'Amostra', 'Campo de destino', 'Transformação', 'Estado'],
      (schema ? schema.fields : []).map(f => { const r = rules.get(f.sourceField); return [f.sourceField, f.sampleValues.slice(0, 2).join(' · '), r ? r.targetFieldKey : 'não mapeado', r ? r.transformId : '—', r ? (r.confidence === 'CONFIRMED' ? 'confirmado' : 'sugestão: necessita confirmação') : '—']; }))}</section>`;
  }
  function qualityPanel(quality) {
    if (!quality) return '<section class="ob-quality"><h3>Qualidade dos dados</h3><p>Ainda não avaliado.</p></section>';
    const s = quality.summary, fails = quality.checks.filter(c => c.result === 'FAIL'), L = M().LABELS.severity;
    const group = sev => { const xs = fails.filter(c => (c.waived ? 'WARNING' : c.severity) === sev); return `<h4>${esc(L[sev])} (${xs.length})</h4>${xs.length ? `<ul>${xs.map(c => `<li><code>${esc(c.code)}</code>${c.count != null ? ` — ${esc(c.count)}` : ''}${c.details ? ` — ${esc(c.details)}` : ''}${c.waived ? ' (exceção aprovada)' : ''}</li>`).join('')}</ul>` : ''}`; };
    return `<section class="ob-quality" aria-label="Qualidade dos dados"><h3>Qualidade dos dados</h3><p class="ob-dq-status" data-status="${esc(s.status)}">${esc(s.status === 'FAIL' ? 'Publicação bloqueada' : s.status === 'PASS' ? 'Sem pendências' : 'Aprovado com avisos')} · ${esc(s.passed)} de ${esc(s.totalChecks)} verificações ok · ${esc(s.blockers)} bloqueio(s) · ${esc(s.errors)} erro(s) · ${esc(s.warnings)} aviso(s)${s.coveragePercent != null ? ` · proveniência ${esc(s.coveragePercent)}%` : ''}</p>${['BLOCKING', 'ERROR', 'WARNING', 'INFO'].map(group).join('')}</section>`;
  }
  function diffPanel(diff) {
    if (!diff) return '';
    return `<section class="ob-diff" aria-label="O que mudou"><h3>O que mudou</h3><p>${esc(diff.lots.added.length)} lote(s) novo(s) · ${esc(diff.lots.changed.length)} alterado(s) · ${esc(diff.lots.removed.length)} removido(s) (exigem classificação) · ${esc(diff.geometry.changed.length)} geometria(s) alterada(s) · gravidade ${esc(diff.severity)}</p>${table('ob-table', ['Lote', 'Campo', 'Antes', 'Depois', 'Gravidade'], diff.fieldChanges.slice(0, 50).map(f => [f.entityId, f.fieldKey, JSON.stringify(f.before), JSON.stringify(f.after), f.severity]))}</section>`;
  }
  function preview(run, { watermark = App.onboardingPolicy.previewWatermark } = {}) {
    if (!run) return '';
    const d = run.dataset, lots = d.drafts.length, geo = d.geometry && d.geometry.match ? d.geometry.match.matches.length : 0;
    const priced = d.prices ? d.prices.candidates.length : null, av = d.availability ? d.availability.candidates.length : null;
    const rows = [['Lotes', lots], ['Quadras', run.blocks.blocks.length], ['Geometrias vinculadas', geo], ['Cobertura de preço', priced == null ? 'não importado' : `${priced} de ${lots}`], ['Cobertura de disponibilidade', av == null ? 'não importado' : `${av} de ${lots}`],
      ['Documentos', (d.documentExtractions || []).length], ['Análise', 'não incluída nesta publicação'], ['Qualidade', run.quality.summary.status]];
    return `<section class="ob-preview" aria-label="Prévia da publicação"><p class="ob-watermark" role="note">${esc(watermark)}</p><h3>Prévia da publicação</h3>${table('ob-table', ['Item', 'Valor'], rows)}<ul class="ob-plain">${run.plainSummary.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
  }
  function checklist(run, caseStatus) {
    const q = run && run.quality, has = c => q && q.checks.some(x => x.code === c && x.result === 'PASS');
    const items = [['Fontes', !!run], ['Mapeamento', has('CONSISTENCY.MAPPING_VALID')], ['Geometria', has('GEOMETRY_INTEGRITY.VALID_POLYGON') && has('COMPLETENESS.GEOMETRY_PRESENT')], ['Lotes', has('UNIQUENESS.CANONICAL_LOT_ID') && has('COMPLETENESS.LOT_ID_PRESENT')],
      ['Comercial', !!(run && run.dataset.prices && run.dataset.availability)], ['Documentos', !!(run && (run.dataset.documentExtractions || []).length)], ['Validação', !!(q && q.gate.publishable)], ['Pronto para publicar', caseStatus === 'READY_TO_PUBLISH' || caseStatus === 'PUBLISHED']];
    return `<ul class="ob-checklist" aria-label="Checklist do onboarding">${items.map(([l, ok]) => `<li data-ok="${ok ? '1' : '0'}">${ok ? '✓' : '○'} ${esc(l)}</li>`).join('')}</ul>`;
  }
  function publishSummary(r) {
    if (!r) return '';
    const v = r.versionsActivated;
    return `<section class="ob-publish" aria-label="Resumo da publicação"><h3>Publicação #${esc(r.publicationNumber)}</h3><p>ID ${esc(r.publicationId)}</p>${table('ob-table', ['Domínio', 'Versão ativada'], [['Lotes', v.lot], ['Geometria', v.geometry], ['Configuração', v.config], ['Tabela de preço', v.price || '—'], ['Disponibilidade', v.availability || '—']])}<p>Alvo de rollback: ${esc(r.rollbackTarget || 'nenhum (primeira publicação)')}</p>${r.warnings.length ? `<p>Avisos: ${r.warnings.map(esc).join(', ')}</p>` : ''}</section>`;
  }
  /** publish button only when the gate allows; otherwise an explanation (no dead controls, §400) */
  const publishControl = (run, canPublish) => !canPublish ? '' : run && run.quality.gate.publishable ? '<button type="button" class="ob-btn" data-act="onboarding-publish">Publicar candidato</button>' : `<p class="ob-blocked">Publicação bloqueada: ${esc((run ? run.quality.gate.blockers : []).join(', ') || 'sem candidato')}</p>`;

  return Object.freeze({ sourceInventory, mappingTable, qualityPanel, diffPanel, preview, checklist, publishSummary, publishControl });
})();
