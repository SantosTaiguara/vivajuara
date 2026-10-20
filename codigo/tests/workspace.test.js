// Topics 22 (desktop workstation) and 23 (tablet): responsive profile, workspace layout state, coordinators,
// quick view mapping across layouts, insets/camera, persistence and the shortcut registry. Layout only: no domain state.
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');
const App = load(), RS = App.responsive, WK = App.workspace, SC = App.shortcuts;
const P = (w, h, o = {}) => RS.resolve({ viewportWidth: w, viewportHeight: h, ...o });

test('profile resolver: dimension scenarios (values are scenarios, not device names)', () => {
  const cases = [[390, 844, 'MOBILE'], [768, 1024, 'TABLET_PORTRAIT'], [810, 1080, 'TABLET_PORTRAIT'], [820, 1180, 'TABLET_PORTRAIT'], [1024, 768, 'TABLET_LANDSCAPE'], [1080, 810, 'TABLET_LANDSCAPE'],
    [1180, 820, 'TABLET_LARGE'], [900, 700, 'TABLET_COMPACT'], [1024, 500, 'TABLET_COMPACT'], [507, 1024, 'MOBILE'], [1280, 800, 'DESKTOP'], [1920, 1080, 'DESKTOP']];
  for (const [w, h, want] of cases) assert.strictEqual(P(w, h).layoutProfile, want, `${w}x${h}`);
});
test('profile resolver: same space → same profile whatever the user agent; pointer changes enhancements, not structure', () => {
  const a = P(1024, 768, { userAgent: 'iPad' }), b = P(1024, 768, { userAgent: 'Windows' }), c = P(1024, 768, { pointerType: 'FINE', hoverCapability: 'HOVER' });
  assert.strictEqual(a.layoutProfile, b.layoutProfile); assert.strictEqual(a.layoutProfile, c.layoutProfile);
  assert.strictEqual(JSON.stringify(a.regions), JSON.stringify(c.regions));
  assert.strictEqual(c.capabilities.hover, true); assert.strictEqual(a.capabilities.hover, false);
});
test('profile resolver: unknown pointer is touch-safe; broken input falls back to TABLET_COMPACT', () => {
  assert.strictEqual(RS.resolveInput({}).touch, true);
  const f = RS.resolve({}); assert.strictEqual(f.layoutProfile, 'TABLET_COMPACT'); assert.strictEqual(f.fallback, true);
  assert.strictEqual(RS.resolve({ viewportWidth: 'x', viewportHeight: null }).layoutProfile, 'TABLET_COMPACT');
});
test('profile resolver: missing orientation is inferred from the ratio; hysteresis keeps the profile near a threshold', () => {
  assert.strictEqual(RS.orientationOf({ viewportWidth: 800, viewportHeight: 1100 }), 'PORTRAIT');
  const d = P(1280, 800); assert.strictEqual(RS.resolve({ viewportWidth: 1270, viewportHeight: 800 }, d).family, 'DESKTOP');
  assert.strictEqual(RS.resolve({ viewportWidth: 1240, viewportHeight: 800 }, d).family, 'TABLET');
  const l = P(1000, 760); assert.strictEqual(RS.resolve({ viewportWidth: 950, viewportHeight: 760 }, l).layoutProfile, 'TABLET_LANDSCAPE');
});
test('regions: portrait/compact use the sheet, landscape/large dock the lot panel, only desktop docks the left panel', () => {
  for (const p of ['MOBILE', 'TABLET_PORTRAIT', 'TABLET_COMPACT']) assert.strictEqual(RS.REGIONS[p].right, 'SHEET');
  for (const p of ['TABLET_LANDSCAPE', 'TABLET_LARGE', 'DESKTOP']) assert.strictEqual(RS.REGIONS[p].right, 'DOCKED');
  for (const p of RS.PROFILES) assert.strictEqual(RS.REGIONS[p].left === 'DOCKED', p === 'DESKTOP');
  assert.strictEqual(JSON.stringify(RS.attrs(P(1024, 768))), JSON.stringify({ layout: 'tablet-landscape', lp: 'overlay', rp: 'docked', hover: 'none', density: 'medium' }));
});
test('desktop: the map never drops under the minimum width, panels are clamped, very wide screens do not stretch panels', () => {
  for (const vw of [1280, 1366, 1440, 1700, 2560, 3840]) {
    const ws = WK.desktopState({ rightPanel: { collapsed: false }, panelSizes: { left: 9999, right: 9999 } }), e = WK.effectiveWidths(ws, { viewportWidth: vw });
    assert.ok(e.map >= 480, `${vw}: map ${e.map}`); assert.ok(e.left <= 360 && e.right <= 460, `${vw}: ${e.left}/${e.right}`);
  }
  const ws = WK.desktopState({ rightPanel: { collapsed: false }, panelSizes: { left: 10, right: -5 } }), e = WK.effectiveWidths(ws, { viewportWidth: 1400 });
  assert.strictEqual(e.left, 260); assert.strictEqual(e.right, 320);
  const both = WK.effectiveWidths(WK.desktopState({ leftPanel: { collapsed: true }, rightPanel: { collapsed: true } }), { viewportWidth: 1400 });
  assert.strictEqual(both.map, 1400);
});
test('desktop coordinator: right panel opens on lot select, a manual close is respected, clear lot collapses unless pinned', () => {
  const C = WK.coordinator; let ws = WK.desktopState();
  assert.strictEqual(ws.rightPanel.collapsed, true, 'closed without a lot');
  ws = C.onLotSelect(ws, { source: 'MAP_CLICK' }); assert.strictEqual(ws.rightPanel.collapsed, false);
  ws = C.closeRight(ws); ws = C.onLotSelect(ws, { source: 'MAP_CLICK' }); assert.strictEqual(ws.rightPanel.collapsed, true, 'manual collapse kept');
  ws = C.onLotSelect(ws, { source: 'DEEP_LINK' }); assert.strictEqual(ws.rightPanel.collapsed, false, 'a deep link opens it');
  ws = C.onLotClear(ws); assert.strictEqual(ws.rightPanel.collapsed, true); assert.strictEqual(ws.activeRightSection, 'EMPTY');
  ws = C.pin(C.openRight(ws), 'right', true); ws = C.onLotClear(ws); assert.strictEqual(ws.rightPanel.collapsed, false, 'pinned stays');
  assert.strictEqual(C.onRecommendationStart(C.closeLeft(ws)).activeLeftSection, 'FIND');
});
test('workspace state is layout only: no lot, customer, filters, layer, zoom or scores', () => {
  const keys = JSON.stringify([WK.desktopState(), WK.tabletState()]);
  for (const k of ['currentLot', 'customer', 'filters', 'activeMapLayer', 'zoom', 'center', 'score', 'recommendation']) assert.ok(!keys.includes(k), k);
});
test('layout mode: presentation > map focused > analysis focused > full', () => {
  const ws = WK.desktopState({ rightPanel: { collapsed: false } });
  assert.strictEqual(WK.layoutModeOf(ws, { presentation: true }), 'PRESENTATION');
  assert.strictEqual(WK.layoutModeOf(ws, { fullMap: true }), 'MAP_FOCUSED');
  assert.strictEqual(WK.layoutModeOf(ws, { details: true }), 'ANALYSIS_FOCUSED');
  assert.strictEqual(WK.layoutModeOf(ws), 'FULL');
});
test('tablet: quick view state maps across portrait ↔ landscape without losing intent', () => {
  const m = WK.mapQuickViewStateAcrossLayouts;
  assert.strictEqual(m('INTERMEDIATE', 'TABLET_PORTRAIT', 'TABLET_LANDSCAPE'), 'NORMAL');
  assert.strictEqual(m('EXPANDED', 'TABLET_PORTRAIT', 'TABLET_LANDSCAPE'), 'WIDE');
  assert.strictEqual(m('MINIMIZED', 'TABLET_PORTRAIT', 'TABLET_LARGE'), 'COMPACT');
  assert.strictEqual(m('NORMAL', 'TABLET_LANDSCAPE', 'TABLET_PORTRAIT'), 'INTERMEDIATE');
  assert.strictEqual(m('COLLAPSED', 'TABLET_LANDSCAPE', 'TABLET_PORTRAIT'), 'MINIMIZED');
  assert.strictEqual(m('NORMAL', 'TABLET_LANDSCAPE', 'TABLET_PORTRAIT', { detailsOpen: true }), 'EXPANDED');
  assert.strictEqual(m('INTERMEDIATE', 'TABLET_PORTRAIT', 'TABLET_COMPACT'), 'INTERMEDIATE', 'sheet to sheet keeps the snap');
});
test('tablet: one primary overlay at a time; closing restores the quick view', () => {
  const c = WK.overlayCoordinator();
  let s = c.open('FILTERS', { quickView: 'INTERMEDIATE' }); assert.strictEqual(s.quickView, 'MINIMIZED');
  s = c.open('LAYERS', { quickView: s.quickView }); assert.strictEqual(s.primary, 'LAYERS'); assert.strictEqual(s.saved, 'INTERMEDIATE');
  s = c.close(); assert.strictEqual(s.primary, 'NONE'); assert.strictEqual(s.quickView, 'INTERMEDIATE');
});
test('tablet: snap config is separate and less aggressive than the phone; docked panel width is clamped', () => {
  const t = App.mobileSheet.heights(1000, { config: WK.TABLET_SNAP_CONFIG }), p = App.mobileSheet.heights(1000);
  assert.ok(t.INTERMEDIATE >= 300 && t.INTERMEDIATE <= 400); assert.ok(t.EXPANDED >= 650 && t.EXPANDED <= 800); assert.ok(t.EXPANDED < p.EXPANDED);
  const e = WK.effectiveWidths(WK.desktopState({ rightPanel: { collapsed: false }, panelSizes: { right: 900 } }), { viewportWidth: 1024, profile: 'TABLET' });
  assert.ok(e.right <= 400 && e.map >= 420);
});
test('insets and camera: temporary drawers do not count; a visible lot never moves; a recent manual pan wins', () => {
  assert.strictEqual(JSON.stringify(WK.viewportInsets({ topControls: 56, rightControls: 50, sheetHeight: 120, leftOverlay: 340 })), JSON.stringify({ top: 56, left: 0, right: 50, bottom: 120 }));
  assert.strictEqual(WK.panToReveal({ x0: 300, y0: 300, x1: 340, y1: 330 }, { mapWidth: 800, mapHeight: 600, insets: { top: 56 } }), null);
  const mv = WK.panToReveal({ x0: 780, y0: 300, x1: 820, y1: 330 }, { mapWidth: 800, mapHeight: 600, insets: { right: 50 } }); assert.ok(mv.dx < 0 && mv.dy === 0);
  assert.strictEqual(WK.shouldAdjust({ reason: 'resizeEnd', lastManualPanAt: 1000, now: 1500 }), false);
  assert.strictEqual(WK.shouldAdjust({ reason: 'select', lastManualPanAt: 1000, now: 1500 }), true);
  assert.strictEqual(WK.shouldAdjust({ reason: 'overlay', policy: WK.TABLET_CAMERA }), false);
});
test('persistence: per device family, schema-versioned, invalid values fall back, legacy leftCollapsed migrates, transient UI is not saved', () => {
  const mem = {}, storage = { get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; } };
  const fresh = WK.loadPrefs('viva-juara', 'DESKTOP', storage, { leftCollapsed: true }); assert.strictEqual(fresh.leftCollapsed, true);
  WK.savePrefs('viva-juara', 'DESKTOP', { ...fresh, leftWidth: 300, rightWidth: 'abc', hover: 'x', openPopover: true }, storage);
  const saved = mem['ws:viva-juara:layout:desktop']; assert.strictEqual(saved.leftWidth, 300); assert.strictEqual(saved.rightWidth, null); assert.ok(!('hover' in saved) && !('openPopover' in saved));
  mem['ws:viva-juara:layout:desktop'] = { schemaVersion: 99, leftWidth: 5000 }; assert.strictEqual(WK.loadPrefs('viva-juara', 'DESKTOP', storage).leftWidth, null);
  const t = WK.loadPrefs('viva-juara', 'TABLET', storage); assert.ok(t.portrait && t.landscape, 'tablet prefs split by orientation');
  WK.savePrefs('viva-juara', 'TABLET', { ...t, landscape: { rightPanelWidth: 360 }, portrait: { lastSnapState: 'EXPANDED', primaryOverlay: 'FILTERS' } }, storage);
  assert.ok(!JSON.stringify(mem['ws:viva-juara:layout:tablet']).includes('FILTERS'), 'open overlays are never restored');
});
test('shortcuts: no conflicts, never fire while typing (except Esc), Cmd and Ctrl are equivalent, tablets get a subset', () => {
  assert.strictEqual(SC.conflicts().length, 0);
  const ev = (key, o = {}) => ({ key, target: o.target || { tagName: 'BODY' }, ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: false });
  assert.strictEqual(SC.match(ev('/')), 'focusSearch');
  assert.strictEqual(SC.match(ev('f', { target: { tagName: 'INPUT' } })), null);
  assert.strictEqual(SC.match(ev('Escape', { target: { tagName: 'INPUT' } })), 'closeTransient');
  assert.strictEqual(SC.match(ev('k', { ctrl: true })), 'commandSearch'); assert.strictEqual(SC.match(ev('k', { meta: true })), 'commandSearch');
  assert.strictEqual(SC.match(ev('f', { ctrl: true })), null, 'browser shortcuts untouched');
  assert.strictEqual(SC.match(ev('d'), { family: 'TABLET' }), null); assert.strictEqual(SC.match(ev('f'), { family: 'TABLET' }), 'openFilters');
  assert.ok(SC.list('TABLET').length < SC.list('DESKTOP').length);
});
test('layout modules never touch domain data (no recalculation on resize/rotation)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/layout/workspace.js'), 'utf8') + require('fs').readFileSync(require('path').join(__dirname, '..', 'src/layout/responsiveProfile.js'), 'utf8');
  for (const k of ['App.services', 'App.intelligence', 'App.recommendation', 'App.filters', 'App.repos', 'selectRanking', 'fetch(']) assert.ok(!src.includes(k), k);
});
