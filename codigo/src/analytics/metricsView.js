/* analytics/metricsView.js — technical-mode "Métricas locais" view model + markup (topics 44/45).

   Shows what this device recorded (never other devices, never other tenants): product KPI cards with definition,
   time basis, version, quality and freshness; the local funnels; tracking health (captured / accepted / duplicates /
   quarantine / sampled / dropped); consent and destinations (every remote one OFF, with the decision that keeps it
   off); the quarantine; the event catalog summary; the commercial metrics that need the server ("não disponível");
   and the open decisions. Gated by the technical UI mode (App.authz.uiMode('technical')): never for a normal user in
   production, never in client/presentation mode. Pure: returns data and an HTML string; app.js wires it. */
App.metricsView = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ISSUE_TEXT = Object.freeze({
    PRODUCER_NOT_WIRED: 'nenhum ponto do painel produz este evento ainda', REQUIRES_BACKEND: 'precisa dos dados do servidor', SAMPLED_SOURCE: 'parte dos eventos é amostrada',
    BUFFER_TRUNCATED: 'memória cheia: eventos antigos saíram', CONSENT_DENIED: 'coleta recusada neste aparelho', QUARANTINED_SOURCE_EVENTS: 'há eventos deste tipo em quarentena',
    NOT_PUBLISHED: 'métrica em rascunho', PARAMS_REQUIRED: 'precisa escolher as etapas', CROSS_TENANT_ROWS_EXCLUDED: 'linhas de outra organização ignoradas'
  });
  /** action names the integrator maps in config/security/features.json (deny by default until then) */
  const ACTS = Object.freeze({ refresh: 'analyticsRefresh', range: 'analyticsRange', clear: 'analyticsClear' });
  const RANGE = Object.freeze({ session: 'Esta sessão', today: 'Hoje', '7d': 'Últimos 7 dias' });
  const CONSENT_TEXT = Object.freeze({ UNKNOWN: 'Não informado — eventos sem dados pessoais ficam só na memória deste aparelho', GRANTED: 'Concedido', DENIED: 'Recusado — nada de produto é registrado', NOT_REQUIRED_BY_POLICY: 'Não exigido pela política' });
  const pct = v => v == null ? 'N/A' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v * 100)}%`;
  const int = v => v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v);

  function rangeOf(key, client, nowMs, tz) {
    const S = App.semanticLayer, to = nowMs + 1;
    if (key === '7d') return { from: new Date(nowMs - 7 * 86400000).toISOString(), to: new Date(to).toISOString() };
    if (key === 'today') { const ds = S.localDate(nowMs, tz); let t = nowMs; while (S.localDate(t - 60000, tz) === ds) t -= 60000; return { from: new Date(t - (t % 60000)).toISOString(), to: new Date(to).toISOString() }; }
    const s = client.session(); return { from: new Date(s ? s.startedAt : nowMs - 1800000).toISOString(), to: new Date(to).toISOString() };
  }
  /** viewModel({ client?, organizationId?, range: 'session'|'today'|'7d', now?, allowed? }) */
  function viewModel(o = {}) {
    const A = App.analytics, S = App.semanticLayer, client = o.client || A.client;
    const allowed = o.allowed != null ? !!o.allowed : !!(App.authz && App.authz.uiMode('technical').allowed);
    if (!allowed) return { allowed: false, title: 'Métricas locais', message: 'Disponível só no modo Técnico.' };
    const nowMs = o.now ? o.now() : Date.now(), ctx = A.context ? A.context() : {}, org = o.organizationId || ctx.organizationId;
    if (!org) return { allowed: true, title: 'Métricas locais', message: 'Organização não identificada: nenhuma métrica é calculada sem tenant.' };
    if (!o.client && A.syncDomainEvents) A.syncDomainEvents();
    const pol = (App.configs.analytics || {}).policy || {}, dash = ((App.configs.analytics || {}).metrics || {}).dashboards.find(d => d.code === 'local_product_usage');
    const range = RANGE[o.range] ? o.range : 'session', tz = S.timezoneOf(org), timeRange = rangeOf(range, client, nowMs, tz);
    const q = { organizationId: org, metricCodes: [...dash.metricCodes, ...dash.qualityMetricCodes, ...dash.commercialPreview], timeRange, grain: 'TOTAL' };
    const res = S.query(q, { client, now: () => nowMs });
    const card = s => {
      const m = S.current().metric(s.metricCode), qual = res.metadata.quality[s.metricCode], info = S.metricInfo(m), blocked = qual.status === 'BLOCKED';
      return { code: m.code, name: m.name, domain: m.domain, valueText: blocked ? 'não disponível' : S.formatValue(m, s.total.value), valueLabel: blocked ? 'não disponível' : s.total.value == null ? 'calculado (sem denominador: N/A)' : qual.status === 'VALID' ? 'calculado' : 'calculado com ressalva',
        detail: !blocked && s.total.denominator != null && ['RATE', 'RATIO'].includes(m.measureType) ? `${int(s.total.numerator)} de ${int(s.total.denominator)}` : !blocked && s.total.extra && s.total.extra.n != null ? `P75 ${S.formatValue(m, s.total.extra.p75)} · P90 ${S.formatValue(m, s.total.extra.p90)} · ${int(s.total.extra.n)} sessões` : null,
        quality: qual.status, qualityText: qual.label, issues: qual.issueCodes.map(c => ISSUE_TEXT[c] || c), definition: info.definition, timeBasis: info.timeBasis, version: info.version, entity: info.entity, caveats: info.caveats, associationOnly: info.associationOnly };
    };
    const series = new Map(res.series.map(s => [s.metricCode, s]));
    const funnels = dash.funnelCodes.map(code => { const f = S.funnel(code, { organizationId: org, timeRange }, { client, now: () => nowMs }); return { code, name: f.name, entityKey: f.entityKey, quality: f.quality.label, blocked: f.quality.status === 'BLOCKED', note: f.note,
      steps: f.steps.map(s => ({ label: s.label, count: f.quality.status === 'BLOCKED' ? 'não disponível' : int(s.count), fromPrevious: s.conversionFromPrevious == null ? '—' : pct(s.conversionFromPrevious), fromFirst: s.conversionFromFirst == null ? '—' : pct(s.conversionFromFirst), dropOff: s.dropOff == null ? '—' : int(s.dropOff) })) }; });
    const h = client.health(), reg = App.eventTracking.registry.current(), cats = {};
    for (const d of reg.list()) cats[d.category] = (cats[d.category] || 0) + 1;
    return {
      allowed: true, title: 'Métricas locais', organizationId: org, timezone: tz, range, rangeLabel: RANGE[range], ranges: Object.entries(RANGE).map(([k, label]) => ({ key: k, label, current: k === range })),
      banner: 'Dados só deste aparelho e desta aba. Nada é enviado: todos os destinos remotos estão desligados.',
      freshness: res.metadata.freshness == null ? 'Sem eventos registrados ainda' : 'Atualizado agora (memória local)', generatedAt: res.metadata.generatedAt, semanticBundle: res.metadata.semanticBundle,
      kpis: dash.metricCodes.map(c => card(series.get(c))), quality: dash.qualityMetricCodes.map(c => card(series.get(c))), commercial: dash.commercialPreview.map(c => card(series.get(c))), funnels,
      health: { captured: h.captured, accepted: h.accepted, duplicated: h.duplicated, quarantined: h.quarantined, sampledOut: h.sampledOut, notCaptured: h.notCaptured, dropped: h.dropped, droppedByReason: h.droppedByReason, purgedByConsent: h.purgedByConsent, propertiesDropped: h.propertiesDropped },
      consent: { state: client.consentState(), text: CONSENT_TEXT[client.consentState()] || client.consentState() },
      destinations: client.destinations().map(d => ({ code: d.code, label: d.label, enabled: d.enabled, status: d.enabled ? 'ligado' : 'desligado', remote: d.remote, thirdParty: d.thirdParty, reason: d.reason, decisionRef: d.decisionRef })),
      quarantine: client.quarantined(org).slice(-10).reverse().map(x => ({ eventName: x.eventName || '(desconhecido)', reason: x.reason, at: x.at, paths: x.issues.map(i => i.path).filter(Boolean).join(', '), legacyName: x.legacyName })),
      catalog: { events: reg.list().length, byCategory: cats, legacyMapped: reg.legacy().length, unconsumed: reg.unconsumed(), version: reg.version },
      recent: client.debugRecent(12), decisions: (pol.decisions || []).map(d => ({ id: d.id, title: d.title, current: d.current, needs: d.needs })),
      acts: ACTS
    };
  }
  const cardHtml = k => `<li class="am-card" data-quality="${esc(k.quality)}"><div class="am-k">${esc(k.name)}</div><div class="am-v">${esc(k.valueText)}</div><div class="am-l">${esc(k.valueLabel)}${k.detail ? ' · ' + esc(k.detail) : ''}</div>`
    + (k.issues.length ? `<div class="am-i">${k.issues.map(esc).join(' · ')}</div>` : '')
    + `<details class="am-d"><summary>Definição</summary><p>${esc(k.definition)}</p><p class="small">Base de tempo: ${esc(k.timeBasis)} · entidade: ${esc(k.entity)} · versão ${esc(k.version)}${k.associationOnly ? ' · associação, não causa' : ''}</p>${(k.caveats || []).map(c => `<p class="small">${esc(c)}</p>`).join('')}</details></li>`;
  const btn = (act, label, extra = '') => `<button class="btn" data-act="${esc(act)}"${extra}>${esc(label)}</button>`;
  /** html(vm) → markup for the technical panel (data-act: analyticsRefresh, analyticsRange[data-range], analyticsClear) */
  function html(vm) {
    if (!vm || !vm.allowed || vm.message) return `<section class="am" aria-label="Métricas locais"><h3>Métricas locais</h3><p class="small">${esc(vm && vm.message || 'Indisponível.')}</p></section>`;
    const tbl = (caption, head, rows) => `<table class="am-t"><caption>${esc(caption)}</caption><thead><tr>${head.map(x => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
    return `<section class="am" aria-label="Métricas locais">
<h3>Métricas locais</h3><p class="am-banner">${esc(vm.banner)}</p>
<div class="am-bar" role="group" aria-label="Período">${vm.ranges.map(r => btn(vm.acts.range, r.label, ` data-range="${esc(r.key)}" aria-pressed="${r.current}"`)).join('')}${btn(vm.acts.refresh, 'Atualizar')}</div>
<p class="small">${esc(vm.freshness)} · fuso ${esc(vm.timezone)} · métricas v${esc(vm.semanticBundle.metricRegistryVersion)} · catálogo v${esc(vm.catalog.version)}</p>
<h4>Uso do painel</h4><ul class="am-cards">${vm.kpis.map(cardHtml).join('')}</ul>
${vm.funnels.map(f => tbl(`${f.name} — ${f.quality}. ${f.note}`, ['Etapa', 'Entidades', 'Da etapa anterior', 'Da primeira', 'Saíram'], f.steps.map(s => [s.label, s.count, s.fromPrevious, s.fromFirst, s.dropOff]))).join('')}
<h4>Qualidade do rastreamento</h4><ul class="am-cards">${vm.quality.map(cardHtml).join('')}</ul>
${tbl('Saúde dos eventos', ['Contador', 'Valor'], [['Capturados', vm.health.captured], ['Aceitos', vm.health.accepted], ['Duplicados ignorados', vm.health.duplicated], ['Em quarentena', vm.health.quarantined], ['Fora da amostra', vm.health.sampledOut], ['Não registrados (consentimento)', vm.health.notCaptured], ['Descartados', vm.health.dropped], ['Propriedades removidas', vm.health.propertiesDropped]])}
<h4>Consentimento e destinos</h4><p>${esc(vm.consent.text)}</p>
${tbl('Destinos', ['Destino', 'Situação', 'Motivo'], vm.destinations.map(d => [d.label, d.status, d.reason || (d.remote ? '' : 'local')]))}
<h4>Métricas comerciais</h4><p class="small">Definidas e versionadas; precisam dos fatos do servidor (jornadas, links), por isso aparecem como não disponíveis aqui.</p><ul class="am-cards">${vm.commercial.map(cardHtml).join('')}</ul>
${vm.quarantine.length ? tbl('Quarentena (últimos)', ['Evento', 'Motivo', 'Campos', 'Quando'], vm.quarantine.map(x => [x.eventName, x.reason, x.paths || '—', x.at])) : '<p class="small">Quarentena vazia.</p>'}
<details class="am-d"><summary>Catálogo de eventos (${esc(vm.catalog.events)})</summary>${tbl('Eventos por categoria', ['Categoria', 'Eventos'], Object.entries(vm.catalog.byCategory))}<p class="small">${esc(vm.catalog.legacyMapped)} nomes antigos mapeados. Sem métrica consumidora: ${esc(vm.catalog.unconsumed.join(', ') || '—')}.</p></details>
<details class="am-d"><summary>Últimos eventos</summary>${tbl('Últimos eventos aceitos', ['Evento', 'Versão', 'Quando'], vm.recent.map(r => [r.eventName, r.version, r.at]))}</details>
<details class="am-d"><summary>Decisões em aberto (${esc(vm.decisions.length)})</summary><ul>${vm.decisions.map(d => `<li><b>${esc(d.id)} · ${esc(d.title)}</b> — ${esc(d.current)} <i>${esc(d.needs)}</i></li>`).join('')}</ul></details>
<div class="am-bar">${btn(vm.acts.clear, 'Limpar dados deste aparelho')}</div>
</section>`;
  }
  return Object.freeze({ viewModel, html, ISSUE_TEXT, ACTS });
})();
