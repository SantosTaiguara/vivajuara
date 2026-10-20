# Receita de integração do Tópico 53 (para o coordenador)

Aplicada e verificada numa cópia (`scratchpad/t53/preview.js` + `recipe.js`): 0 erros de página, 28/28 checagens.

## 1. harness ORDER (tests/harness.js)
Depois de `'deeplink/linkRestoration.js'` (fim da lista): `'navigation/navigationRegistry.js'`, `'navigation/navigationService.js'`.

## 2. build.js — lista UI
Depois de `'presentation/dom.js'`: `'navigation/menuView.js'`. (`navigation.css` já está em `src/presentation/` e entra sozinho; é inerte sem o header novo.)

## 3. config/security/features.json — `actions`
```json
"nav": {"variantKey":"ws","variants":{"MAP":"map.view","FIND":"map.view","COMPARE":"lot.compare","CUSTOMERS":"customer.profile","DEVELOPMENT":"development.info"},"default":null}
```
(sem isso o teste "every existing panel action has a permission contract" acusa `nav`).

## 4. src/presentation/shell.html
Substituir o bloco `<header class="hd"> … </header>` inteiro pela saída de `node scripts/navHeader.js`. Depois, `node scripts/navHeader.js --check` deve passar (o teste também roda o check).

## 5. src/presentation/app.js — substituições exatas
### 5.1
Trocar
```js
  let prof = RS.get() || RS.init() || RS.resolve({ viewportWidth: 1280, viewportHeight: 800 });
```
por
```js
  let prof = RS.get() || RS.init() || RS.resolve({ viewportWidth: 1280, viewportHeight: 800 });
  // topic 53: compact navigation — one registry; placement (bottom / top / rail) and header overflow per responsive profile
  const NAVI = App.navigation, NAVV = NAVI && NAVI.view;
  if (NAVV) { NAVV.applyProfile(prof); NAVV.bind(document); }
  const navCtx = () => ({ profile: prof, authz: App.authz, resource: { developmentId: devId }, connectivity: store.get().connectivity });
```

### 5.2
Trocar
```js
    document.querySelectorAll('.nav [data-v]').forEach(b => b.setAttribute('aria-current', String(st.view === b.dataset.v)));
    const n = st.comparisonLotIds.length, c = document.querySelector('.nav .cnt'); c.textContent = n; c.hidden = !n;
```
por
```js
    if (NAVV) NAVV.update(NAVI.service.viewModel(st, navCtx())); // topic 53: aria-current, badge, permission/offline state
```

### 5.3
Trocar
```js
if (any(keys, ['view', 'comparisonLotIds', 'presentationMode', 'customers', 'currentCustomerId', 'activeFilters'])) renderHeader(st);
```
por
```js
if (any(keys, ['view', 'comparisonLotIds', 'presentationMode', 'customers', 'currentCustomerId', 'activeFilters', 'drawerOpen', 'leftCollapsed', 'connectivity', 'presentationView'])) renderHeader(st);
```

### 5.4
Trocar
```js
const r = RS.refresh(); prof = r.profile; nav.setPushNavigational(!isSmall());
```
por
```js
const r = RS.refresh(); prof = r.profile; nav.setPushNavigational(!isSmall()); if (NAVV && r.changed) { NAVV.applyProfile(prof); renderHeader(store.get()); }
```

### 5.5
Trocar
```js
      case 'view': store.set({ view: a.dataset.v, drawerOpen: false }); closePop(); break;
```
por
```js
      case 'view': store.set({ view: a.dataset.v, drawerOpen: false }); closePop(); break;
      case 'nav': { // topic 53: primary navigation through the NavigationService (route guard + context preservation)
        const p = NAVI.service.plan(a.dataset.ws, st, { ...navCtx(), source: a.closest('.pnav') ? 'PRIMARY_NAV' : 'CONTEXT_ACTION' });
        if (!p.ok) { toast((p.decision && p.decision.message) || 'Área indisponível.'); break; }
        if (p.patch) store.set(p.patch); closePop();
        for (const fx of p.effects) {
          if (fx === 'EXPAND_FIND_PANEL' && layout.get().leftPanel.collapsed) layout.toggleLeft();
          else if (fx === 'FOCUS_FIND') setTimeout(() => { const f = [...$('left').querySelectorAll('input,select,button')].find(x => x.offsetParent !== null && !x.disabled); if (f) f.focus({ preventScroll: true }); }, 60);
        }
        break; }
```

### 5.6
Trocar
```js
      if (st.leftCollapsed !== lc || st.rightCollapsed !== rc) store.set({ leftCollapsed: lc, rightCollapsed: rc }, { silent: true });
```
por
```js
      if (st.leftCollapsed !== lc || st.rightCollapsed !== rc) store.set({ leftCollapsed: lc, rightCollapsed: rc }, { silent: true });
      if (NAVV && st.leftCollapsed !== lc) NAVV.update(NAVI.service.viewModel(store.get(), navCtx())); // topic 53: Encontrar "open" mark follows the docked panel
```

### 5.7
Trocar
```js
safeAreaBottom: safeBottom,
```
por
```js
safeAreaBottom: NAVV && NAVV.placement() === 'BOTTOM_NAV' ? 0 : safeBottom,
```

## 6. Opcional
- `App.authz.subscribe` já chama `renderHeader`; para redirecionar quando o workspace atual perder a permissão: `const p = NAVI.service.onPermissionsChanged(store.get(), navCtx()); if (p && p.patch) store.set(p.patch);` no mesmo callback.
- A ajuda de atalhos (`showShortcuts`) pode listar `App.navigation.shortcuts.list()`.
- Nenhum evento novo de analytics: `route_viewed` (já emitido em `syncUrl`) cobre a abertura de workspace; o código de rota analítico continua igual (CLIENTS/DEVELOPMENT/COMPARE/MAP/LOT) para não mudar a semântica.
