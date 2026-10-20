/* presentation/overlays.js — views over the map: Comparar, Clientes, Empreendimento (with data and offline
   information), the share dialog and small informational popovers. Markup only. */
App.overlays = (() => {
  const { esc, icon } = App.ui, F = App.fmt, t = App.i18n.t;
  const head = (title, extra = '') => `<div class="oh"><h2>${esc(title)}</h2>${extra}<span class="sp"></span><button class="btn" data-act="view" data-v="map">${icon('close')} Voltar ao mapa</button></div>`;

  function compare(c, st, x) {
    if (!c) return head('Comparar lotes') + `<div class="ob"><p class="empty">Adicione até 4 lotes pelo botão Comparar no painel do lote.</p></div>`;
    const client = x.mode === 'client';
    let h = head('Comparar lotes', `<span class="small">${c.columns.length} de 4</span>`) + `<div class="ob">`;
    if (c.winners.length) h += `<div class="winners">${c.winners.map(w => `<span>${esc(w.label)}: <b>${esc(w.lot)}</b></span>`).join('')}</div>`;
    const colh = `<tr><th scope="col"><span class="vh">Atributo</span></th>${c.columns.map((col, i) => `<th scope="col"><div class="colh"><span class="pinlbl">${i + 1}</span><button class="lbtn nm" data-act="goLot" data-id="${col.id}">${esc(col.short)}</button><div class="row"><span class="status${col.status.warn ? ' warn' : ''}"><i style="background:${col.status.color}"></i>${esc(col.status.label)}</span>${col.cls ? `<span class="cls" style="background:${col.cls.color};color:${col.cls.code === 'B' ? '#1b261d' : '#fff'}">${esc(col.cls.label)}</span>` : ''}</div><button class="lbtn small" data-act="cmpRemove" data-id="${col.id}">Remover</button></div></th>`).join('')}</tr>`;
    const rows = rs => rs.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.cells.map(cell => `<td class="${cell.win ? 'win' : ''}">${esc(cell.text)}</td>`).join('')}</tr>`).join('');
    h += `<div class="cmpt"><table><thead>${colh}</thead><tbody>${rows(c.primary)}`;
    for (const g of c.groups) h += `<tr class="grp"><th colspan="${c.columns.length + 1}">${esc(g.title)}</th></tr>${rows(g.rows)}`;
    h += `</tbody></table></div>`;
    if (c.columns.some(col => col.status.warn)) h += `<p class="small">Disponibilidade sujeita a confirmação para os lotes sem status confirmado.</p>`;
    // lots outside the current filters stay in the comparison, with a warning (the filter never removes them)
    if (x.filterActive) { const out = c.columns.filter(col => !x.filteredIds.has(col.id)); if (out.length) h += `<p class="small warnl">${out.map(col => esc(col.short)).join(', ')} ${out.length === 1 ? 'está fora' : 'estão fora'} dos filtros atuais.</p>`; }
    // customer profile: preference by preference, who matches best (only when a profile exists; never a purchase probability)
    if (x.recommendation && App.explanation.compareMany && c.columns.length >= 2) {
      let cm = null; try { cm = App.explanation.compareMany(x.recommendation, c.columns.map(col => col.id), { fit: x.fitById || undefined }); } catch (e) { cm = null; }
      if (cm && (cm.status === 'COMPLETE' || cm.status === 'PARTIAL') && cm.preferences.length) {
        const nameOf = id => (c.columns.find(col => col.id === id) || {}).short || id, lbl = k => (((App.fit.cfgOf && App.fit.cfgOf(x.dev.id)) || {}).preferences || {})[k] ? App.fit.cfgOf(x.dev.id).preferences[k].label : k;
        h += `<h3>Para o perfil ${x.customerName ? 'de ' + esc(x.customerName) : 'do cliente'}</h3><div class="cmpp"><table class="xt"><thead><tr><th scope="col">Preferência</th><th scope="col">Atende melhor</th></tr></thead><tbody>${cm.preferences.map(p => `<tr><th scope="row">${esc(lbl(p.preferenceKey))}</th><td>${p.comparable === false ? `Sem dado para comparar${p.notComparableLotIds && p.notComparableLotIds.length ? ' (' + p.notComparableLotIds.map(nameOf).map(esc).join(', ') + ')' : ''}` : p.tied || !p.winnerLotIds.length ? 'Empate' : p.winnerLotIds.map(nameOf).map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
        if (!client && cm.lots.some(l => l.standing && l.standing !== 'RECOMMENDED')) h += `<p class="small">${cm.lots.filter(l => l.standing && l.standing !== 'RECOMMENDED').map(l => `${esc(nameOf(l.lotId))}: ${l.standing === 'EXCLUDED' ? 'fora da recomendação' : l.standing === 'REVIEW' ? 'precisa de revisão' : 'fora da lista exibida'}`).join('; ')}.</p>`;
        h += `<p class="small">Compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.</p>`;
      }
    }
    h += `<div class="acts2"><button class="btn" data-act="shareCmp">${icon('share')} Compartilhar comparação</button><button class="btn" data-act="cmpClear">Limpar comparação</button></div>`;
    if (!client) h += `<p class="small">"Melhor" marca o maior valor em notas e áreas e o menor em preço e distâncias. É leitura da análise, não promessa de valorização.</p>`;
    return h + `</div>`;
  }

  /** clients(st, x, extra) — extra (topics 38–40, from app.js): { tab, tabsHtml, favHtml, journeyHtml, recommendation }. Without extra: the previous overlay. */
  function clients(st, x, extra) {
    const tab = extra && extra.tab || 'summary';
    if (extra && tab !== 'summary') return head('Clientes') + `<div class="ob">${extra.tabsHtml || ''}<div class="custpanel" role="tabpanel">${clientTab(tab, st, x, extra)}</div></div>`;
    const cur = st.customers.find(c => c.id === st.currentCustomerId) || null;
    let h = head('Clientes') + `<div class="ob">${extra ? extra.tabsHtml || '' : ''}<p class="small">Os clientes ficam somente neste aparelho, sem telefone ou documento. Não fazem parte do pacote offline nem são enviados a nenhum servidor.</p><div class="twocol"><div class="custlist">`;
    h += st.customers.map(c => `<button data-act="custPick" data-id="${c.id}" aria-current="${c.id === st.currentCustomerId}"><span>${esc(c.name)}</span><small>${c.lots.length} lotes</small></button>`).join('') || `<p class="empty">Nenhum cliente ainda.</p>`;
    h += `<form class="custnew" data-act="custAdd"><input name="name" maxlength="60" placeholder="Nome ou apelido do cliente" aria-label="Nome do cliente" required><button class="btn pri">Adicionar</button></form></div><div class="card">`;
    if (!cur) h += `<p class="muted">Escolha um cliente para guardar os lotes que ele gostou e montar o resumo.</p>`;
    else {
      const lots = x.repo.getLotsByIds(cur.lots);
      h += `<div class="lh1"><h2>${esc(cur.name)}</h2><button class="lbtn" data-act="custDel" data-id="${cur.id}">Excluir</button></div>`;
      h += lots.length ? `<div class="res">${lots.map(l => `<button data-act="goLot" data-id="${l.identity.id}"><span class="rk">${esc(l.identity.blockId)}</span><span><span class="nm">${esc(l.identity.displayCode)}</span><span class="sub">${F.formatSquareMeters(l.geometry.areaM2, 0)} · ${F.formatBRLShort(l.commercial.price)} · ${esc(t('AvailabilityStatus', l.availability.status))}</span></span><span class="lbtn" data-act="custRemoveLot" data-id="${l.identity.id}">Tirar</span></button>`).join('')}</div>`
        : `<p class="muted">Abra um lote e use "Guardar para ${esc(cur.name)}" no painel, ou adicione o lote aberto agora.</p>`;
      h += `<div class="acts2">${st.currentLotId ? `<button class="btn" data-act="custAddLot">Guardar o lote aberto</button>` : ''}${lots.length ? `<button class="btn pri" data-act="shareCust">${icon('share')} Resumo para o cliente</button><button class="btn" data-act="custCompare">Comparar estes lotes</button>` : ''}</div>`;
    }
    return h + `</div></div></div>`;
  }
  /** the other customer workspace tabs: Jornada · Perfil · Favoritos · Comparações · Recomendações (map stays the main surface) */
  function clientTab(tab, st, x, extra) {
    const cur = st.customers.find(c => c.id === st.currentCustomerId) || null, who = cur ? esc(cur.name) : null;
    if (tab === 'favorites') return extra.favHtml || '';
    if (tab === 'journey') return (cur ? '' : '<p class="muted">Escolha um cliente na aba Resumo para ver a jornada.</p>') + (extra.journeyHtml || '');
    if (tab === 'profile') {
      const n = Object.keys(st.preferences || {}).length, k = Object.keys(st.constraints || {}).length;
      return `<div class="card"><p>${who ? `Perfil de <b>${who}</b>` : 'Perfil de trabalho (sem cliente)'}: ${n} ${n === 1 ? 'prioridade' : 'prioridades'} e ${k} ${k === 1 ? 'exigência' : 'exigências'} definidas.</p><p class="small muted">As prioridades e exigências são ajustadas no painel Encontrar; a compatibilidade mede aderência ao perfil informado, não probabilidade de compra.</p><div class="acts2"><button class="btn" data-act="openFind">Abrir Encontrar</button></div></div>`;
    }
    if (tab === 'comparisons') {
      const lots = x.repo.getLotsByIds(st.comparisonLotIds);
      return `<div class="card">${lots.length ? `<p>Comparação aberta com ${lots.length} ${lots.length === 1 ? 'lote' : 'lotes'}: ${lots.map(l => esc(l.identity.displayCode)).join(', ')}.</p><div class="acts2"><button class="btn pri" data-act="view" data-v="compare">Abrir comparação</button></div>` : '<p class="muted">Nenhuma comparação aberta. Use "Comparar" no painel do lote.</p>'}</div>`;
    }
    if (tab === 'recommendations') {
      const rec = extra.recommendation, items = rec && rec.recommendations ? rec.recommendations.slice(0, 5) : [];
      return `<div class="card">${items.length ? `<p>Sugestões para ${who ? 'o perfil de ' + who : 'o perfil atual'}:</p><div class="res">${items.map(r => { const l = x.repo.getLotById(r.lotId); return l ? `<button data-act="goLot" data-id="${esc(l.identity.id)}"><span class="nm">${esc(l.identity.displayCode)}</span><span class="sub">${esc(F.formatSquareMeters(l.geometry.areaM2, 0))} · ${esc(l.commercial.price != null ? F.formatBRLShort(l.commercial.price) : F.ND)}</span></button>` : ''; }).join('')}</div><p class="small muted">Compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.</p>` : '<p class="muted">Defina prioridades no painel Encontrar para ver sugestões.</p>'}</div>`;
    }
    return '';
  }

  function development(st, x, info) {
    const d = x.dev, client = x.mode === 'client';
    let h = head(d.name, `<span class="small">${esc(d.legalName)} · ${esc(d.city)}</span>`) + `<div class="ob"><div class="grid2">`;
    h += `<div class="card"><h3>Quadro de áreas</h3><table class="qa">${d.facts.areas.map(([n, a, p]) => `<tr><td>${esc(n)}</td><td>${F.formatSquareMeters(a)}${p != null ? ` · ${F.number(p, 2)}%` : ''}</td></tr>`).join('')}</table><p class="small">${esc(d.facts.avenueNote)}</p></div>`;
    h += `<div class="card"><h3>Áreas comuns</h3><table class="qa">${d.pois.map(p => `<tr><td>${esc(p.name)} <small class="small">${esc(p.id)}</small></td><td>${F.formatSquareMeters(p.areaM2)}</td></tr>`).join('')}</table></div>`;
    h += `<div class="card"><h3>Dados pendentes</h3><table class="qa">${d.pendingData.map(([n, why]) => `<tr><td><b>${esc(n)}</b><br><span class="small">${esc(why)}</span></td><td></td></tr>`).join('')}</table></div>`;
    h += `<div class="card"><h3>Fontes</h3><table class="qa qsrc">${d.sources.map(s => `<tr><td><b>${esc(s.name)}</b><br><span class="small">${esc(s.description)} ${esc(s.precision)}</span></td><td>${s.date ? F.formatDate(s.date) : ''}</td></tr>`).join('')}</table></div>`;
    h += offlineCard(st, x, info);
    if (!client && info.report) {
      const r = info.report;
      h += `<div class="card"><h3>Qualidade dos dados</h3><table class="qa"><tr><td>Lotes válidos</td><td>${r.validLots} de ${r.totalLots}</td></tr><tr><td>Lotes rejeitados</td><td>${r.invalidLots}</td></tr><tr><td>Avisos de validação</td><td>${r.warnings}</td></tr><tr><td>Lotes com medidas por dois métodos</td><td>${r.measurementVariants}</td></tr><tr><td>Campos antigos sem mapeamento</td><td>${r.unmappedLegacyFields.length}</td></tr></table></div>`;
    }
    h += `</div>`;
    h += `<section class="sec"><h3>Galeria</h3><div class="gal" id="gal">${(info.images || []).map((im, i) => `<figure><button class="galb" data-act="lightbox" data-i="${i}" aria-label="Ampliar ${esc(im.title)}"><img data-src="${esc(im.src)}" alt="${esc(im.title)}" ${galImgAttrs()}></button><figcaption>${esc(im.title)}</figcaption></figure>`).join('') || '<p class="small">Galeria indisponível offline.</p>'}</div><p class="small">Imagens ilustrativas de divulgação.</p></section>`;
    h += `<section class="sec"><h3>Glossário</h3><dl class="gloss">${App.vm.glossary(['geometry.areaM2', 'commercial.price', 'availability.status', 'environmental.noiseLevel', 'environmental.privacyLevel', 'mobility.estimatedTraffic', 'environmental.northSunSide', 'surroundings.rearNeighborType', ...(client ? [] : ['intelligence.class', 'intelligence.scores.housing'])]).map(g => `<dt>${esc(g.label)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl></section>`;
    return h + `</div>`;
  }

  const galImgAttrs = () => App.loading && App.loading.planner ? App.loading.planner.imageAttrs({ width: 320, height: 200 }) : 'loading="lazy"';
  /** "Dados e funcionamento offline": what is local, how fresh, and the two technical actions */
  function offlineCard(st, x, info) {
    const client = x.mode === 'client', fr = info.freshness || {}, ver = info.versions || {}, sync = info.sync || {}, est = info.estimate;
    const fl = s => esc(t('Freshness', s && s.status));
    let h = `<div class="card"><h3>Dados e funcionamento offline</h3>`;
    if (client) {
      h += `<p class="muted">${info.connectivity === 'OFFLINE' ? 'Sem internet agora: o mapa e a análise continuam disponíveis.' : 'O mapa continua funcionando se a internet cair.'} Preço e disponibilidade estão sujeitos a confirmação com o corretor.</p></div>`;
      return h;
    }
    h += `<table class="qa">
      <tr><td>Conexão</td><td>${esc(t('ConnectivityState', info.connectivity))}</td></tr>
      <tr><td>Carregado de</td><td>${info.origin === 'CACHE' ? 'Cópia salva neste aparelho' : info.origin === 'REMOTE' ? 'Arquivos publicados' : 'Arquivo publicado'}</td></tr>
      <tr><td>Última sincronização</td><td>${sync.lastSuccessfulSyncAt ? esc(F.formatDateTime(sync.lastSuccessfulSyncAt)) : 'Ainda não sincronizado'}${sync.state ? ` · ${esc(t('SyncState', sync.state))}` : ''}</td></tr>
      <tr><td>Planta e lotes (estrutura)</td><td>versão ${esc(ver.staticVersion)}</td></tr>
      <tr><td>Análise</td><td>versão ${esc(ver.analysisVersion)}</td></tr>
      <tr><td>Tabela de preços</td><td>${esc(ver.priceTableVersion)} · ${fl(fr.commercial)}${fr.commercial && fr.commercial.source === 'BUNDLED' ? ' (tabela embutida)' : ''}</td></tr>
      <tr><td>Disponibilidade</td><td>${fr.availability && fr.availability.status === 'UNKNOWN' ? 'Sem espelho de vendas' : 'revisão ' + esc(ver.availabilityRevision) + ' · ' + fl(fr.availability)}</td></tr>
      ${info.cacheLabels && info.cacheLabels.price ? `<tr><td>Preço na cópia local</td><td>${esc(info.cacheLabels.price)}</td></tr>` : ''}${info.cacheLabels && info.cacheLabels.availability ? `<tr><td>Status dos lotes na cópia local</td><td>${esc(info.cacheLabels.availability)}</td></tr>` : ''}
      <tr><td>Armazenamento local</td><td>${info.backend === 'indexeddb' ? 'IndexedDB' : 'Somente memória (sem cópia local)'}${est && est.quota ? ` · ${F.number(est.usage / 1048576, 1)} MB de ${F.number(est.quota / 1048576, 0)} MB` : ''}</td></tr>
      <tr><td>Planta salva para uso offline</td><td>${info.planCached ? 'Sim' : info.cachesSupported ? 'Ainda não' : 'Não suportado neste navegador'}</td></tr>
      <tr><td>Abrir sem internet</td><td>${info.offlineReady ? 'Disponível offline' : info.sw && info.sw.registered ? 'Após o primeiro carregamento completo' : 'Este endereço não permite abrir a página sem internet; os dados já carregados continuam funcionando se a conexão cair'}</td></tr>
    </table>
    <p class="small">A cópia local serve para continuar trabalhando. Preço e disponibilidade só valem como atuais quando a fonte oficial confirma.</p>
    <div class="acts2"><button class="btn" data-act="refresh">${icon('refresh')} Atualizar dados</button><button class="btn" data-act="clearLocal">Limpar dados locais</button></div></div>`;
    return h;
  }

  function share(s, x) {
    return `<div class="box" role="dialog" aria-modal="true" aria-labelledby="shT"><div class="ph"><h2 id="shT">Compartilhar</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${icon('close')}</button></div><div class="pb">
      ${s.warnings.length ? `<div class="alert ATTENTION"><b>CONFIRA ANTES DE ENVIAR</b>${s.warnings.map(esc).join('<br>')}</div>` : ''}
      <label class="fld"><span class="lb">Nome do cliente (opcional)</span><input data-in="shareName" value="${esc(x.customerName || '')}" maxlength="60"></label>
      <textarea class="sum" id="shareText" aria-label="Texto do resumo">${esc(s.text)}</textarea>
      <div class="acts2"><a class="btn pri" href="${esc(s.whatsapp)}" target="_blank" rel="noopener">Enviar no WhatsApp</a><button class="btn" data-act="copyText">Copiar texto</button><button class="btn" data-act="copyLink">Copiar link</button><button class="btn" disabled title="Em breve">PDF (em breve)</button></div>
      <details class="shmgmt"><summary>Links gerenciados</summary><p class="small">Links com validade, revogação e registro de acesso exigem o servidor da organização e não estão disponíveis neste painel. O "Copiar link" continua abrindo o mapa público com os lotes escolhidos.</p></details>
    </div></div>`;
  }
  const confirmInfo = mode => `<div class="poph"><b>Confirmar disponibilidade</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${icon('close')}</button></div>
    <p>${mode === 'client' ? 'A disponibilidade deste lote será confirmada pelo corretor.' : 'Este lote ainda não tem status confirmado pelo espelho de vendas. Confirme com a loteadora antes de oferecer; o aplicativo não reserva lotes.'}</p>
    <div class="acts2"><button class="btn" data-act="panel" data-p="simulation">Simular mesmo assim</button></div>`;
  const lightbox = im => `<div class="box lightbox" role="dialog" aria-modal="true" aria-label="${esc(im.title)}"><div class="ph"><h2>${esc(im.title)}</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${icon('close')}</button></div><div class="pb"><img src="${esc(im.url)}" alt="${esc(im.title)}"></div></div>`;
  return { compare, clients, development, share, confirmInfo, lightbox };
})();
