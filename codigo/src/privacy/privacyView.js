/* privacy/privacyView.js — topic 59 UI strings (markup only, no DOM access, no state). Plain Portuguese for the broker
   ("Solicitação do titular", never "DSAR"). Data-acts (to be mapped in features.json as uiOnlyActions):
   privacyExport · privacyEraseLocal (data-scope="PERSONAL" | "ALL") · privacyEraseConfirm (data-scope).
   Every value is escaped. Nothing here shows a personal value: only what is stored, where and why. */
App.privacyView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BLOCKER_LABEL = { NO_APPROVED_BASIS: 'Base legal não validada', RETENTION_UNDEFINED: 'Retenção não definida', CONTROLLER_ROLE_UNASSESSED: 'Papel controlador/operador não avaliado', VENDOR_UNREVIEWED: 'Fornecedor sem revisão',
    TRANSFER_WITHOUT_MECHANISM: 'Transferência internacional sem mecanismo', DPO_NOT_APPOINTED: 'Encarregado não registrado', NOTICE_NOT_APPROVED: 'Aviso de privacidade não aprovado', DEADLINE_NOT_CONFIGURED: 'Prazo não configurado' };
  /** center(vm from App.privacy.device.centerVM) — "Privacidade deste aparelho" card */
  function center(vm = {}) {
    const rows = vm.rows || [];
    let h = `<section class="card privacy-center" aria-labelledby="privacy-center-h"><h3 id="privacy-center-h">Privacidade deste aparelho</h3>`;
    h += `<p class="small">${esc(vm.disclaimer || '')}</p>`;
    h += rows.length ? `<table class="xt"><thead><tr><th scope="col">O que fica guardado</th><th scope="col">Onde</th><th scope="col">Dado pessoal</th><th scope="col">Neste aparelho</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${esc(r.what)}</td><td>${esc(r.where)}</td><td>${r.personal ? 'Sim' : 'Não'}</td><td>${r.present ? 'Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">Nada guardado.</p>`;
    const fnd = (vm.findings || []).filter(f => f.severity !== 'LOW');
    if (fnd.length) h += `<p class="small" role="note">${fnd.map(f => esc(f.remediation)).join('<br>')}</p>`;
    h += `<div class="acts2" role="group" aria-label="Ações de privacidade"><button class="btn" data-act="privacyExport">Baixar meus dados deste aparelho</button>`;
    h += `<button class="btn" data-act="privacyEraseLocal" data-scope="PERSONAL">Apagar dados pessoais deste aparelho</button>`;
    h += `<button class="btn" data-act="privacyEraseLocal" data-scope="ALL">Apagar tudo deste aparelho</button></div>`;
    h += `<p class="small">Encarregado pelo tratamento de dados: ${vm.dpo && vm.dpo.configured ? `${esc(vm.dpo.name)} · ${esc(vm.dpo.channel)}` : 'não configurado (necessita confirmação da organização).'}</p>`;
    return h + `</section>`;
  }
  /** confirmErase(scope) — modal body; the destructive button needs a second click */
  function confirmErase(scope) {
    const all = scope === 'ALL';
    return `<div class="card" role="alertdialog" aria-labelledby="privacy-erase-h"><h3 id="privacy-erase-h">${all ? 'Apagar tudo deste aparelho?' : 'Apagar dados pessoais deste aparelho?'}</h3>
<p>${all ? 'Clientes de trabalho, favoritos, preferências, layout, id do aparelho e cópias offline serão apagados. O painel recarrega os dados públicos depois.' : 'Clientes de trabalho (nomes e perfis), favoritos e filas locais serão apagados. Preferências de tela continuam.'}</p>
<p class="small">Só este aparelho é afetado. Não é possível desfazer.</p>
<div class="acts2"><button class="btn pri" data-act="privacyEraseConfirm" data-scope="${all ? 'ALL' : 'PERSONAL'}">Apagar</button><button class="btn" data-act="closeModal">Cancelar</button></div></div>`;
  }
  /** governance(compliancePackage) — technical mode summary (Encarregado/admin view; not for the broker or the client) */
  function governance(pkg = {}) {
    const b = pkg.blockers || [], m = pkg.maturity || {};
    const counts = {}; for (const x of b) counts[x.code] = (counts[x.code] || 0) + 1;
    let h = `<section class="card privacy-gov"><h3>Privacidade e LGPD (governança)</h3><p class="small">Nível de maturidade: <b>${esc(m.level || 'L0')}</b> (meta antes de escalar: ${esc(m.target || 'L3')}). Isto não é parecer jurídico.</p>`;
    h += `<ul>${Object.entries(counts).map(([k, n]) => `<li>${esc(BLOCKER_LABEL[k] || k)}: ${esc(n)}</li>`).join('')}</ul>`;
    h += `<p class="small">Atividades de tratamento: ${esc((pkg.processingActivityRegister || []).length)} · Fornecedores: ${esc((pkg.vendorRegister || []).length)} · Transferências a avaliar: ${esc((pkg.transferRegister || []).length)}</p>`;
    return h + `</section>`;
  }
  /** contactSignal(canContactResult) — broker operational signal, e.g. "Marketing WhatsApp: não permitido" (§295) */
  const contactSignal = r => r ? `<span class="small privacy-signal" data-allowed="${r.allowed ? 'true' : 'false'}">${esc(r.label)}</span>` : '';
  /** noteHint(sensitiveTextWarning) — advisory under a free-text note field (§164) */
  const noteHint = w => w && w.warn ? `<p class="small" role="note">${esc(w.message)}</p>` : '';
  return Object.freeze({ center, confirmErase, governance, contactSignal, noteHint, BLOCKER_LABEL });
})();
