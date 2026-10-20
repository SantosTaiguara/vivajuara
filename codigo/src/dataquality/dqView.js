/* dataquality/dqView.js — topic 61 backoffice UI strings (markup only: no DOM access, no state, no calculation).
   Dados → Qualidade & Governança: Saúde (cards por domínio), Findings (fila), Regras, Owners, Limitações conhecidas.
   Input = App.dataQuality.engine.assess(…) (+ policy). Internal/technical audience only: the broker/client panel never
   shows this jargon (spec §231, §304) — for them use clientNotice(), which only says "Informação pendente"-style text.
   No data-act yet (no action is wired; the coordinator maps the future ones): tabs use data-dq-tab. Everything escaped. */
App.dataQualityView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = { HEALTHY: 'Saudável', DEGRADED: 'Degradado', CRITICAL: 'Crítico', UNKNOWN: 'Desconhecido' };
  const REASON = { NOT_MONITORED: 'não monitorado', NO_RULES_EVALUATED: 'sem regras avaliadas', CHECK_FAILED: 'verificação não executou', FRESHNESS_UNKNOWN: 'frescor desconhecido (sem data da fonte)',
    SOURCE_AUTHORITY_UNDEFINED: 'fonte de autoridade não definida', BLOCKING_FINDINGS: 'findings bloqueantes', OPEN_FINDINGS: 'findings abertos', SLO_BREACH: 'SLO violado', STALE: 'desatualizado' };
  const SEV = { INFO: 'Info', WARNING: 'Aviso', ERROR: 'Erro', BLOCKING: 'Bloqueante' };
  const tone = s => ({ HEALTHY: 'ok', DEGRADED: 'warn', CRITICAL: 'bad', UNKNOWN: 'unk' })[s] || 'unk';
  const nc = v => v ? esc(v) : '<span class="dq-nc">necessita confirmação</span>';
  function healthCards(h) {
    return `<ul class="dq-cards" aria-label="Saúde por domínio">${h.domains.filter(d => d.active).map(d => `<li class="dq-card dq-${tone(d.status)}"><b>${esc(d.name)}</b> — ${esc(STATUS[d.status])}
      <span class="small">${d.statusReason ? esc(REASON[d.statusReason] || d.statusReason) : `${esc(d.rulesPassed)}/${esc(d.rulesEvaluated)} regras ok`}${d.openFindings ? ` · ${esc(d.openFindings)} finding(s)` : ''}${d.blockingFindings ? ` · ${esc(d.blockingFindings)} bloqueante(s)` : ''}</span></li>`).join('')}</ul>`;
  }
  function findingsTable(fs) {
    if (!fs.length) return '<p class="small">Nenhum finding aberto.</p>';
    return `<table class="dq-table"><caption>Findings</caption><thead><tr><th scope="col">Regra</th><th scope="col">Domínio</th><th scope="col">Severidade</th><th scope="col">Modo</th><th scope="col">Falhas</th><th scope="col">Exemplos</th><th scope="col">Status</th></tr></thead><tbody>${
      fs.map(f => `<tr><td>${esc(f.ruleId)} <span class="small">${esc(f.ruleName)}</span></td><td>${esc(f.dataDomainId)}</td><td>${esc(SEV[f.severity] || f.severity)}</td><td>${esc(f.effectiveMode)}${f.modeReason === 'RULE_UNOWNED' ? ' <span class="small">(sem owner)</span>' : ''}</td><td>${esc(f.failedEntityCount)}/${esc(f.evaluatedCount)}</td><td class="small">${esc((f.sampleEntityRefs || []).slice(0, 3).join(', '))}</td><td>${esc(f.status)}</td></tr>`).join('')}</tbody></table>`;
  }
  function ownersTable(rows) {
    return `<table class="dq-table"><caption>Owners e stewards</caption><thead><tr><th scope="col">Domínio</th><th scope="col">Criticidade</th><th scope="col">Fonte de autoridade</th><th scope="col">Owner</th><th scope="col">Steward</th></tr></thead><tbody>${
      rows.map(o => `<tr><td>${esc(o.name)}</td><td>${esc(o.criticality)}</td><td>${nc(o.sourceOfTruthRef)}</td><td>${nc(o.owner)}</td><td>${nc(o.steward)}</td></tr>`).join('')}</tbody></table>`;
  }
  const limitations = ls => `<ul class="dq-lim">${ls.map(k => `<li><b>${esc(k.description)}</b> <span class="small">${esc(k.impact)}</span></li>`).join('')}</ul>`;
  /** home(assessment) → HTML of the "Qualidade & Governança" section (technical mode / backoffice only) */
  function home(a) {
    const M = App.dataQuality.model, p = a.policy, h = a.health;
    const open = (a.run.findings || []).filter(f => f.effectiveMode !== 'SHADOW');
    return `<section class="dq-home" aria-labelledby="dq-h"><h3 id="dq-h">Qualidade e governança dos dados</h3>
      <p class="dq-overall dq-${tone(h.overallStatus)}">Situação geral: <b>${esc(STATUS[h.overallStatus])}</b> <span class="small">(regra: crítico &gt; desconhecido &gt; degradado; desconhecido nunca conta como saudável)</span></p>
      <nav class="dq-tabs" aria-label="Seções"><button type="button" data-dq-tab="health">Saúde</button><button type="button" data-dq-tab="findings">Findings</button><button type="button" data-dq-tab="owners">Owners</button><button type="button" data-dq-tab="limits">Limitações conhecidas</button></nav>
      ${healthCards(h)}${findingsTable(open)}${ownersTable(M.ownershipMatrix(p))}
      <h4>Limitações conhecidas</h4>${limitations(M.knownLimitations(p))}
      <p class="small">Verificação ${esc(a.run.id)} · ${esc(a.run.status)} · políticas ${esc(Object.values(p.policyVersions).filter(Boolean).join(', '))}. Metas de SLO, owners e prazos: não configurados.</p></section>`;
  }
  /** clientNotice(policy) → client-safe sentences only (no governance jargon) */
  const clientNotice = p => { const ls = App.dataQuality.model.clientSafeLimitations(p); return ls.length ? `<ul class="dq-client">${ls.map(l => `<li>${esc(l.text)}</li>`).join('')}</ul>` : ''; };
  return { home, healthCards, findingsTable, ownersTable, clientNotice, esc };
})();
