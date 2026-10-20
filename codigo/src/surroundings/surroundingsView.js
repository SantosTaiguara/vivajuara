/* surroundings/surroundingsView.js — topic 63: "Mapa de Lotes | Entorno" as HTML strings (App.surroundingsView).
   Separate surface: the Google map never goes into the lot map (§0, §75). Markup only, no DOM access, everything escaped.
   States: NOT_VALIDATED ("Coordenada oficial do empreendimento ainda não validada.") · NOT_CONFIGURED · OFFLINE · AVAILABLE.
   In the first three, only the state message is rendered: no map container, so the integrator never loads the Google script.
   Delegated data-acts: envTab (data-v lots|environment), envRadius (data-v meters), envCategory (data-v code),
   envRank (data-v DISTANCE|POPULARITY), envPlace (data-id), envRoute, envOpenMaps (link, new tab, noopener).
   Accessibility: the list is the primary interface (the map is not the only one, §231–§235); chips are buttons with
   aria-pressed; categories carry a text glyph, never color alone (§236); loading is local (§238). */
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.domain) || require('./surroundingsDomain.js');
  const C = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.config) || require('../config/surroundings/surroundings.config.js');

  /** viewModel({ developmentId, capability, state }) → EnvironmentViewModel-like plain object (no raw provider payload) */
  function viewModel({ developmentId, capability, state = null }) {
    const Dm = D(), Cf = C(), d = Cf.developments[developmentId];
    const policy = d ? Dm.radiusPolicy(developmentId, Cf) : null, registry = Dm.buildRegistry(Cf, developmentId);
    const st = state || { selectedRadiusMeters: policy ? policy.defaultRadiusMeters : null, phase: 'IDLE', places: [], routePhase: 'IDLE' };
    const sel = st.selectedPlaceId ? (st.places || []).find(p => p.providerPlaceId === st.selectedPlaceId) : null;
    return { developmentId, developmentName: d ? d.location.name : '', state: capability ? capability.state : 'NOT_CONFIGURED', message: capability ? capability.message : Cf.copy.notConfigured,
      places: capability && capability.NEARBY_PLACES, routes: capability && capability.ROUTE_ESTIMATES,
      radius: { selectedMeters: st.selectedRadiusMeters, maxMeters: policy ? policy.maxRadiusMeters : null, options: policy ? policy.selectableRadiiMeters : [] },
      categories: registry.enabled.map(c => ({ code: c.code, label: c.label, shortLabel: c.shortLabel, glyph: c.glyph, iconKey: c.iconKey })),
      selectedCategory: st.selectedCategory ? registry.byCode[st.selectedCategory] : null, rank: st.rankPreference || 'DISTANCE',
      phase: st.phase, list: st.places || [], selectedPlace: sel || null, route: st.route || null, routePhase: st.routePhase || 'IDLE', routeError: st.routeError || null,
      error: st.error || null, summary: st.summary || null, linkMessage: st.linkMessage || null, copy: Cf.copy, attribution: Cf.attribution,
      baseMap: capability && capability.baseMap ? capability.baseMap : null, nearbyPending: Cf.environmentMap ? Cf.environmentMap.copy.nearbyPending : null };
  }

  /** tabs({ active, showEnvironment }) → the separate surface switch. Entorno is hidden when the capability is off (§277). */
  function tabs({ active = 'lots', showEnvironment = false } = {}) {
    const b = (v, label) => `<button type="button" role="tab" class="envtab${active === v ? ' on' : ''}" data-act="envTab" data-v="${v}" aria-selected="${active === v}">${esc(label)}</button>`;
    return `<div class="envtabs" role="tablist" aria-label="Superfícies do empreendimento">${b('lots', 'Mapa de Lotes')}${showEnvironment ? b('environment', 'Entorno') : ''}</div>`;
  }

  /** stateNotice(vm) → the only markup for NOT_VALIDATED / NOT_CONFIGURED / OFFLINE (no map container, no script) */
  function stateNotice(vm) {
    const cls = vm.state === 'OFFLINE' ? 'offline' : vm.state === 'NOT_VALIDATED' ? 'notvalidated' : 'notconfigured';
    return `<section class="envp envp-${cls}" aria-labelledby="envh"><h3 id="envh">Localização &amp; Entorno</h3><p class="envmsg" role="status">${esc(vm.message || vm.copy.notConfigured)}</p>${vm.state === 'NOT_VALIDATED' ? `<p class="small">O entorno só usa a coordenada oficial validada do empreendimento. Nenhuma posição aproximada é usada no lugar dela.</p>` : ''}${vm.baseMap && vm.baseMap.available ? `<p class="small">Mapa do entorno sem chave (OpenStreetMap, planta e círculos de 2 a 8 km): disponível no mapa, em "Mapa de Lotes | Entorno". ${esc(vm.nearbyPending || '')}</p>` : ''}</section>`;
  }

  function placeCard(p, vm) {
    const Dm = D(), on = vm.selectedPlace && vm.selectedPlace.providerPlaceId === p.providerPlaceId, cat = vm.selectedCategory;
    const rating = Dm.formatRating(p.rating, p.userRatingCount);
    return `<li class="envpl${on ? ' on' : ''}"><button type="button" class="envplb" data-act="envPlace" data-id="${esc(p.providerPlaceId)}" aria-pressed="${on}" aria-label="${esc(`${p.name}, ${cat ? cat.label : ''}, ${Dm.formatDistance(p.straightLineDistanceMeters)} em linha reta`)}">
      <span class="envgl" aria-hidden="true">${esc(cat ? cat.glyph : '•')}</span><span class="envnm">${esc(p.name)}</span>
      <span class="envd">Linha reta: ${esc(Dm.formatDistance(p.straightLineDistanceMeters))}</span>${rating ? `<span class="envr">Avaliação: ${esc(rating)}</span>` : ''}</button></li>`;
  }

  function detail(vm) {
    const Dm = D(), p = vm.selectedPlace; if (!p) return '';
    const rating = Dm.formatRating(p.rating, p.userRatingCount), url = Dm.mapsUrl(p);
    const route = vm.routePhase === 'READY' && vm.route ? `<dt>De carro</dt><dd>${esc(Dm.formatDistance(vm.route.distanceMeters))}</dd><dt>Tempo estimado</dt><dd>${esc(Dm.formatDuration(vm.route.durationSeconds))}</dd>` : '';
    const routeCta = !vm.routes ? '' : vm.routePhase === 'LOADING' ? `<p class="small" role="status">Calculando trajeto...</p>` : vm.routePhase === 'READY' ? `<p class="small">${esc(vm.copy.routeNote)}</p>`
      : `<button type="button" class="lbtn" data-act="envRoute" data-id="${esc(p.providerPlaceId)}">Calcular trajeto</button>${vm.routePhase === 'ERROR' ? `<p class="small warnl" role="status">${esc(vm.copy.routeFailed)}</p>` : ''}`;
    return `<article class="envdet" aria-labelledby="envdeth"><h4 id="envdeth">${esc(p.name)}</h4>${vm.selectedCategory ? `<p class="small">${esc(vm.selectedCategory.label)}</p>` : ''}
      <dl><dt>Linha reta</dt><dd>${esc(Dm.formatDistance(p.straightLineDistanceMeters))}</dd>${route}
      ${p.formattedAddress ? `<dt>Endereço</dt><dd>${esc(p.formattedAddress)}</dd>` : ''}<dt>Avaliação</dt><dd>${esc(rating || vm.copy.noRating)}</dd></dl>
      ${routeCta}${url ? `<a class="lbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-act="envOpenMaps">Abrir no Google Maps</a>` : ''}
      <p class="small">A avaliação é do provedor e não é recomendação da plataforma.</p></article>`;
  }

  function results(vm) {
    if (!vm.places) return `<p class="small">Busca de locais desativada para este empreendimento.</p>`;
    if (!vm.selectedCategory) return `<p class="envhint">${esc(vm.copy.selectCategory)}</p>`;
    if (vm.phase === 'LOADING') return `<p class="envload" role="status" aria-live="polite">${esc(vm.copy.loading)}</p>`;
    if (vm.phase === 'ERROR') return `<p class="envmsg warnl" role="alert">${esc(vm.copy.unavailable)}</p>`; // distinct from "no results" (§243)
    if (vm.phase === 'EMPTY' || !vm.list.length) return `<p class="envmsg" role="status">${esc(vm.copy.empty)}</p><p class="small">${esc(vm.copy.emptyHint)}</p>`;
    return `<h4 class="envrh">${esc(vm.copy.resultsHeading)}</h4>${vm.summary ? `<p class="small" role="status">${esc(vm.summary.text)}${vm.summary.nearest ? ' ' + esc(vm.summary.nearest) : ''}</p>` : ''}
      <ul class="envlist" aria-label="${esc(vm.copy.resultsHeading)}">${vm.list.map(p => placeCard(p, vm)).join('')}</ul>${detail(vm)}`;
  }

  /** render(vm) → Entorno panel. Only AVAILABLE gets the map container (data-surroundings-map) that the integrator fills. */
  function render(vm) {
    if (vm.state !== 'AVAILABLE') return stateNotice(vm);
    const Dm = D(), chip = (act, v, label, on, extra = '') => `<button type="button" class="envchip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}"${extra}>${label}</button>`;
    const radius = vm.radius.options.map(r => chip('envRadius', r, esc(Dm.formatRadius(r)), r === vm.radius.selectedMeters)).join('');
    const cats = vm.places ? vm.categories.map(c => chip('envCategory', c.code, `<span aria-hidden="true">${esc(c.glyph)}</span> ${esc(c.shortLabel)}`, !!vm.selectedCategory && vm.selectedCategory.code === c.code, ` aria-label="${esc(c.label)}"`)).join('') : '';
    const rank = vm.places && vm.selectedCategory ? `<div class="envrank" role="group" aria-label="Ordem">${chip('envRank', 'DISTANCE', 'Mais próximos', vm.rank === 'DISTANCE')}${chip('envRank', 'POPULARITY', 'Mais relevantes no provedor', vm.rank === 'POPULARITY')}</div>` : '';
    return `<section class="envp envp-on" aria-labelledby="envh"><h3 id="envh">Entorno em até ${esc(Dm.formatRadius(vm.radius.maxMeters))}</h3>
      ${vm.linkMessage ? `<p class="small" role="status">${esc(vm.linkMessage)}</p>` : ''}
      <div class="envlay"><div class="envmapw"><div class="envmap" data-surroundings-map="${esc(vm.developmentId)}" role="region" aria-label="Mapa do entorno de ${esc(vm.developmentName)} (a lista ao lado traz as mesmas informações)"></div>
      <p class="small envleg"><span aria-hidden="true">◎</span> ${esc(vm.developmentName)} · Área analisada — até ${esc(Dm.formatRadius(vm.radius.selectedMeters))} · ${esc(vm.copy.maxRadius)}</p></div>
      <div class="envside"><div role="group" aria-label="Raio">${radius}</div>${cats ? `<div class="envcats" role="group" aria-label="Categorias">${cats}</div>` : ''}${rank}
      <div class="envres">${results(vm)}</div></div></div>
      <p class="small envattr">${esc(vm.attribution.text)}</p><p class="small envfoot">${esc(vm.copy.footer)}</p></section>`;
  }

  const api = { viewModel, tabs, render, stateNotice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) App.surroundingsView = api;
})();
