/* pwa/webManifest.js — topic 49 §19–§29, §225–§226: Web App Manifest from an OrganizationBranding (pure).
   Shared by the build (scripts/pwaBuild.js writes manifest.webmanifest) and the app/tests (App.pwa.webManifest).
   start_url and scope are RELATIVE ("./"): they resolve against the manifest's own folder, so the worker and the installed app stay
   restricted to the application directory (§22, §233) and never carry a tenant secret, share token, customer id or auth token (§21). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.pwa = App.pwa || {}; App.pwa.webManifest = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /** default branding (House 7 today; §20: an OrganizationBranding per tenant can replace it without touching the build) */
  const DEFAULT_BRANDING = Object.freeze({
    organizationId: 'house7', name: 'Plataforma de Inteligência Comercial', shortName: 'House 7',
    description: 'Mapa interativo de lotes com preço de tabela, análise, simulação e comparação. Funciona offline para empreendimentos preparados.',
    themeColor: '#2d6232', backgroundColor: '#f3f5f0', lang: 'pt-BR',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
  const HEX = /^#[0-9a-f]{6}$/i;
  /** words that must never appear in start_url, scope, id or shortcut URLs */
  const UNSAFE_URL = /(token|secret|senha|password|auth|session|customer|cliente|tenant|org(anization)?Id|cpf|email|phone|telefone|(^|\/)s\/)/i;

  /** buildWebManifest(branding?) → manifest object (serialize with JSON.stringify) */
  function buildWebManifest(b = {}) {
    const x = { ...DEFAULT_BRANDING, ...b };
    return {
      id: './', name: x.name, short_name: x.shortName, description: x.description, lang: x.lang, dir: 'ltr',
      start_url: './', scope: './', display: 'standalone', orientation: 'any',
      theme_color: x.themeColor, background_color: x.backgroundColor, categories: ['business', 'productivity'],
      icons: x.icons.map(i => ({ ...i })),
      prefer_related_applications: false,
      shortcuts: [] // §225: only stable, safe routes; never a specific customer (§226). None today (the app has one route).
    };
  }

  /** validateWebManifest(m, { scopeBase? }) → { ok, errors[] } — §329: valid manifest, icons, scope, safe start_url, standalone */
  function validateWebManifest(m, o = {}) {
    const errors = [], E = (code, message) => errors.push({ code, message });
    if (!m || typeof m !== 'object') return { ok: false, errors: [{ code: 'NOT_AN_OBJECT', message: 'manifest ausente' }] };
    if (!m.name || !m.short_name) E('NAME_REQUIRED', 'name e short_name são obrigatórios');
    if (m.short_name && m.short_name.length > 15) E('SHORT_NAME_TOO_LONG', 'short_name deve ser curto (≤ 15 caracteres)');
    if (m.display !== 'standalone') E('DISPLAY', 'display deve ser standalone');
    for (const f of ['start_url', 'scope', 'id']) {
      const v = m[f]; if (v == null) { if (f !== 'id') E('MISSING_' + f.toUpperCase(), f + ' ausente'); continue; }
      if (/[?#]/.test(v)) E('UNSAFE_' + f.toUpperCase(), f + ' não pode ter query string nem fragmento');
      if (UNSAFE_URL.test(v)) E('UNSAFE_' + f.toUpperCase(), f + ' contém termo sensível');
      if (/^[a-z]+:/i.test(v)) E('ABSOLUTE_' + f.toUpperCase(), f + ' deve ser relativo à pasta da aplicação');
    }
    if (m.scope === '/' && !o.allowRootScope) E('SCOPE_TOO_WIDE', 'scope deve ficar restrito à pasta da aplicação');
    if (m.start_url && m.scope) { const base = 'https://h/app/'; const s = new URL(m.scope, base).href, u = new URL(m.start_url, base).href; if (!u.startsWith(s)) E('START_URL_OUT_OF_SCOPE', 'start_url fora do scope'); }
    const icons = m.icons || [];
    const has = (size, purpose) => icons.some(i => String(i.sizes).split(/\s+/).includes(size) && String(i.purpose || 'any').split(/\s+/).includes(purpose));
    if (!has('192x192', 'any')) E('ICON_192', 'ícone 192x192 ausente');
    if (!has('512x512', 'any')) E('ICON_512', 'ícone 512x512 ausente');
    if (!has('512x512', 'maskable')) E('ICON_MASKABLE', 'ícone maskable ausente');
    for (const i of icons) if (/^[a-z]+:/i.test(i.src || '') || UNSAFE_URL.test(i.src || '')) E('ICON_SRC', 'ícone com URL inválida: ' + i.src);
    for (const f of ['theme_color', 'background_color']) if (!HEX.test(m[f] || '')) E('COLOR_' + f.toUpperCase(), f + ' deve ser #rrggbb');
    for (const s of m.shortcuts || []) if (!s.url || UNSAFE_URL.test(s.url) || /[?#]/.test(s.url)) E('UNSAFE_SHORTCUT', 'atalho inseguro: ' + (s.name || s.url));
    return { ok: !errors.length, errors };
  }

  /** head tags for the page (the link must be in <head> for browsers to read it) */
  const headTags = (b = {}) => { const x = { ...DEFAULT_BRANDING, ...b };
    return `<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="${x.themeColor}">\n<link rel="apple-touch-icon" href="icons/icon-192.png">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="${x.shortName}">`; };

  return Object.freeze({ DEFAULT_BRANDING, UNSAFE_URL, buildWebManifest, validateWebManifest, headTags });
});
