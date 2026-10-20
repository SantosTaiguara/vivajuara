/* layout/workspace.js — workspace layout state and coordinators (topics 22 desktop and 23 tablet).
   Only UI layout lives here: panel visibility, widths, active sections, which overlay is on top, how the Quick View
   container maps between layouts, map viewport insets, the camera policy and the layout preferences saved on the
   device. Domain state (current lot, customer, filters, layer, comparison, scores) stays in the store and is never
   reset by anything in this file. Every function is pure except the small preference store at the end. */
App.workspace = (() => {
  const SCHEMA_VERSION = 1;
  const RB = () => App.responsive.BREAKPOINTS;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- desktop (topic 22)
  /** DesktopPanelBehaviorConfig */
  const DESKTOP_BEHAVIOR = Object.freeze({ autoOpenRightOnLotSelect: true, preserveManualCollapse: true, autoOpenLeftOnSearch: false, keepMapCenteredWhenPanelsChange: true,
    minMapWidth: 480, allowPanelResize: true, allowPin: true, restoreLayout: true, rightWithoutLot: 'COLLAPSED', comparisonBarMinLots: 1, wideDetailsExtra: 80 });
  const DEFAULT_WIDTHS = Object.freeze({ left: 290, right: 370, leftLarge: 320, rightLarge: 420 });
  const RIGHT_CONTEXT = Object.freeze(['EMPTY', 'LOT', 'CUSTOMER', 'RECOMMENDATION', 'COMPARISON', 'DETAILS']);
  const LEFT_SECTIONS = Object.freeze(['SEARCH', 'FILTERS', 'FIND', 'LAYERS']);
  const LAYOUT_MODES = Object.freeze(['FULL', 'MAP_FOCUSED', 'ANALYSIS_FOCUSED', 'PRESENTATION']);
  /** z-index tokens (§124): the stylesheet uses the same numbers through --z-* custom properties */
  const Z = Object.freeze({ map: 1, mapControls: 5, panel: 20, bottomBar: 20, drawer: 25, popover: 120, modal: 150, toast: 200 });

  const panel = (o = {}) => ({ visible: o.visible !== false, collapsed: !!o.collapsed, width: o.width == null ? null : o.width, pinned: !!o.pinned, activeTab: o.activeTab || null });
  /** DesktopWorkspaceState: layout only (§31). zoom, center, layer, selection, current lot and customer are not here. */
  function desktopState(o = {}) {
    return { leftPanel: panel(o.leftPanel), rightPanel: panel({ collapsed: true, ...(o.rightPanel || {}) }), bottomBar: { collapsed: !!(o.bottomBar && o.bottomBar.collapsed) },
      activeLeftSection: LEFT_SECTIONS.includes(o.activeLeftSection) ? o.activeLeftSection : 'FIND', activeRightSection: RIGHT_CONTEXT.includes(o.activeRightSection) ? o.activeRightSection : 'EMPTY',
      layoutMode: LAYOUT_MODES.includes(o.layoutMode) ? o.layoutMode : 'FULL', panelSizes: { left: null, right: null, ...(o.panelSizes || {}) }, focusRegion: o.focusRegion || null,
      rightClosedByUser: !!o.rightClosedByUser, schemaVersion: SCHEMA_VERSION };
  }
  /** width limits for one panel given the viewport and the other panel: the map never drops under minMapWidth (§42–43) */
  function widthLimits(which, { viewportWidth, otherWidth = 0, profile = 'DESKTOP' }) {
    const b = RB(), tablet = profile !== 'DESKTOP', min = which === 'left' ? b.panelMinWidth.left : tablet ? b.panelMinWidth.tabletRight : b.panelMinWidth.right;
    let max = which === 'left' ? b.panelMaxWidth.left : tablet ? b.panelMaxWidth.tabletRight : b.panelMaxWidth.right;
    const minMap = tablet ? b.minMapWidth.TABLET : b.minMapWidth.DESKTOP;
    max = Math.max(min, Math.min(max, (viewportWidth || 0) - otherWidth - minMap));
    return { min, max };
  }
  function defaultWidth(which, viewportWidth) { const large = viewportWidth >= 1600; return which === 'left' ? (large ? DEFAULT_WIDTHS.leftLarge : DEFAULT_WIDTHS.left) : (large ? DEFAULT_WIDTHS.rightLarge : DEFAULT_WIDTHS.right); }
  /** effective widths for the grid (0 when collapsed); invalid or stale saved widths are clamped (§138), never trusted */
  function effectiveWidths(ws, { viewportWidth, profile = 'DESKTOP', details = false }) {
    if (profile !== 'DESKTOP') {
      const rw = ws.rightPanel.collapsed ? 0 : clampWidth('right', ws.panelSizes.right == null ? tabletRightPreset(ws.rightPanel.activeTab, viewportWidth) : ws.panelSizes.right, { viewportWidth, otherWidth: 0, profile });
      return { left: 0, right: rw, map: viewportWidth - rw };
    }
    let lw = ws.leftPanel.collapsed ? 0 : (ws.panelSizes.left == null ? defaultWidth('left', viewportWidth) : ws.panelSizes.left);
    let rw = ws.rightPanel.collapsed ? 0 : (ws.panelSizes.right == null ? defaultWidth('right', viewportWidth) : ws.panelSizes.right) + (details ? DESKTOP_BEHAVIOR.wideDetailsExtra : 0);
    if (lw) lw = clampWidth('left', lw, { viewportWidth, otherWidth: rw ? RB().panelMinWidth.right : 0, profile });
    if (rw) rw = clampWidth('right', rw, { viewportWidth, otherWidth: lw, profile });
    // still too wide for the map (very small desktop window): the left panel gives way first (map > lot > filters)
    if (viewportWidth - lw - rw < RB().minMapWidth.DESKTOP && lw) lw = 0;
    return { left: lw, right: rw, map: viewportWidth - lw - rw };
  }
  function clampWidth(which, w, ctx) { const { min, max } = widthLimits(which, ctx); const v = Number.isFinite(+w) ? +w : min; return Math.round(clamp(v, min, max)); }
  /** layout mode derived from the panels (§238): presentation wins, then both collapsed = map focused, details = analysis focused */
  function layoutModeOf(ws, { presentation = false, fullMap = false, details = false } = {}) {
    if (presentation) return 'PRESENTATION';
    if (fullMap || (ws.leftPanel.collapsed && ws.rightPanel.collapsed)) return 'MAP_FOCUSED';
    if (details && !ws.rightPanel.collapsed) return 'ANALYSIS_FOCUSED';
    return 'FULL';
  }

  /** DesktopWorkspaceCoordinator: events in, new layout state out. No business rules (§158). */
  const coordinator = {
    openLeft(ws, section) { return { ...ws, leftPanel: { ...ws.leftPanel, collapsed: false }, activeLeftSection: LEFT_SECTIONS.includes(section) ? section : ws.activeLeftSection }; },
    closeLeft(ws) { return { ...ws, leftPanel: { ...ws.leftPanel, collapsed: true } }; },
    toggleLeft(ws) { return ws.leftPanel.collapsed ? coordinator.openLeft(ws) : coordinator.closeLeft(ws); },
    openRight(ws, context = 'LOT') { return { ...ws, rightPanel: { ...ws.rightPanel, collapsed: false }, activeRightSection: RIGHT_CONTEXT.includes(context) ? context : 'LOT', rightClosedByUser: false }; },
    /** a manual close is remembered for the session (§36), so the next lot selection does not reopen it */
    closeRight(ws, { manual = true } = {}) { return { ...ws, rightPanel: { ...ws.rightPanel, collapsed: true }, rightClosedByUser: manual ? true : ws.rightClosedByUser }; },
    resizePanel(ws, which, width, ctx) { const w = clampWidth(which, width, ctx); return { ...ws, panelSizes: { ...ws.panelSizes, [which]: w } }; },
    toggleBottomBar(ws) { return { ...ws, bottomBar: { collapsed: !ws.bottomBar.collapsed } }; },
    pin(ws, which, on) { const k = which === 'left' ? 'leftPanel' : 'rightPanel'; return { ...ws, [k]: { ...ws[k], pinned: !!on } }; },
    /** lot selected (map, search, recommendation list, deep link): open the right panel unless the user closed it (§35–36) */
    onLotSelect(ws, { source = 'MAP_CLICK', behavior = DESKTOP_BEHAVIOR } = {}) {
      if (!behavior.autoOpenRightOnLotSelect) return { ...ws, activeRightSection: 'LOT' };
      if (behavior.preserveManualCollapse && ws.rightClosedByUser && source !== 'SHORTCUT' && source !== 'DEEP_LINK') return { ...ws, activeRightSection: 'LOT' };
      return { ...ws, rightPanel: { ...ws.rightPanel, collapsed: false }, activeRightSection: 'LOT' };
    },
    /** lot cleared: the panel goes back to EMPTY; collapsed by policy unless pinned (§33, §161) */
    onLotClear(ws, { behavior = DESKTOP_BEHAVIOR } = {}) {
      if (ws.rightPanel.pinned || behavior.rightWithoutLot !== 'COLLAPSED') return { ...ws, activeRightSection: 'EMPTY' };
      return { ...ws, rightPanel: { ...ws.rightPanel, collapsed: true }, activeRightSection: 'EMPTY', rightClosedByUser: false };
    },
    onRecommendationStart(ws) { return coordinator.openLeft(ws, 'FIND'); },
    onDetailsOpen(ws) { return { ...ws, rightPanel: { ...ws.rightPanel, collapsed: false }, activeRightSection: 'DETAILS' }; },
    onDetailsClose(ws, hasLot) { return { ...ws, activeRightSection: hasLot ? 'LOT' : 'EMPTY' }; }
  };

  // ---------------------------------------------------------------- tablet (topic 23)
  const TABLET_SNAP_CONFIG = Object.freeze({ unit: 'VIEWPORT_FRACTION', minimized: 0.12, intermediate: 0.36, expanded: 0.74, minimizedMinPx: 88, minimizedMaxPx: 132, minMapVisibleHeight: 160,
    keyboardBehavior: 'KEEP_SNAP_CLAMP_TO_VISUAL_VIEWPORT', orientationOverrides: { landscape: { minimized: 0.18, intermediate: 0.42, expanded: 0.72 } } });
  /** TabletDensityConfig (§169–177): spacing only, never smaller fonts */
  const TABLET_DENSITY = Object.freeze({ TABLET_PORTRAIT: { spacing: 12, controlHeight: 44, panelPadding: 16, listDensity: 'comfortable', metricGridColumns: 2, maxQuickActions: 3 },
    TABLET_LANDSCAPE: { spacing: 10, controlHeight: 44, panelPadding: 14, listDensity: 'medium', metricGridColumns: 2, maxQuickActions: 4 },
    TABLET_LARGE: { spacing: 10, controlHeight: 44, panelPadding: 14, listDensity: 'medium', metricGridColumns: 3, maxQuickActions: 4 },
    TABLET_COMPACT: { spacing: 12, controlHeight: 44, panelPadding: 14, listDensity: 'comfortable', metricGridColumns: 2, maxQuickActions: 3 } });
  const RIGHT_PRESETS = Object.freeze({ COMPACT: 300, NORMAL: 340, WIDE: 400 });
  function tabletRightPreset(preset, viewportWidth) { const p = RIGHT_PRESETS[preset] || RIGHT_PRESETS.NORMAL; return viewportWidth >= 1150 && !RIGHT_PRESETS[preset] ? 360 : p; }
  const OVERLAYS = Object.freeze(['NONE', 'FILTERS', 'LAYERS', 'LEGEND', 'DETAILS', 'COMPARISON', 'RECOMMENDATION_LIST']);
  /** TabletWorkspaceState: layout only (§24) */
  function tabletState(o = {}) {
    return { layoutProfile: o.layoutProfile || 'TABLET_PORTRAIT', orientation: o.orientation || 'PORTRAIT', primaryOverlay: OVERLAYS.includes(o.primaryOverlay) ? o.primaryOverlay : 'NONE',
      quickViewContainerState: o.quickViewContainerState || 'HIDDEN', leftDrawerState: o.leftDrawerState || 'CLOSED', rightPanelState: o.rightPanelState || 'COLLAPSED',
      bottomTrayState: o.bottomTrayState || 'HIDDEN', lastStableLayout: o.lastStableLayout || null, schemaVersion: SCHEMA_VERSION };
  }
  const isSheetProfile = p => p === 'MOBILE' || p === 'TABLET_PORTRAIT' || p === 'TABLET_COMPACT';
  /** mapQuickViewStateAcrossLayouts (§83–84, §154–157): the same semantic state in another container.
      sheet: HIDDEN / MINIMIZED / INTERMEDIATE / EXPANDED · side panel: COLLAPSED / COMPACT / NORMAL / WIDE.
      Details open is user intent: it stays details (EXPANDED sheet or WIDE panel). */
  function mapQuickViewStateAcrossLayouts(state, fromProfile, toProfile, { detailsOpen = false } = {}) {
    const fromSheet = isSheetProfile(fromProfile), toSheet = isSheetProfile(toProfile);
    if (fromSheet === toSheet) return state;
    if (fromSheet && !toSheet) { if (state === 'HIDDEN') return 'COLLAPSED'; if (detailsOpen || state === 'EXPANDED') return 'WIDE'; return state === 'MINIMIZED' ? 'COMPACT' : 'NORMAL'; }
    if (state === 'COLLAPSED') return 'MINIMIZED';
    if (detailsOpen || state === 'WIDE') return 'EXPANDED';
    return state === 'COMPACT' ? 'MINIMIZED' : 'INTERMEDIATE';
  }
  /** TabletOverlayCoordinator: one large overlay at a time; the Quick View state is kept aside and restored (§112–118) */
  function overlayCoordinator(initial = {}) {
    let s = { primary: 'NONE', saved: null, ...initial };
    return {
      open(type, { quickView = null, sheetProfile = true } = {}) {
        if (!OVERLAYS.includes(type) || type === 'NONE') return s;
        const saved = s.primary === 'NONE' ? quickView : s.saved;
        s = { primary: type, saved, quickView: sheetProfile && quickView && quickView !== 'HIDDEN' && type !== 'LEGEND' ? 'MINIMIZED' : quickView }; return s;
      },
      close() { const restore = s.saved; s = { primary: 'NONE', saved: null, quickView: restore }; return s; },
      state() { return { ...s }; }
    };
  }

  // ---------------------------------------------------------------- insets and camera (both)
  /** DesktopMapViewportInsets / TabletMapViewportInsets: docked panels are outside the map box already (grid columns), so they
      add nothing; overlays only count when they are docked-like (sheet, comparison tray). Temporary drawers are ignored (§93). */
  function viewportInsets({ topControls = 0, rightControls = 0, sheetHeight = 0, trayHeight = 0, leftOverlay = 0, overlayTemporary = true } = {}) {
    return { top: Math.max(0, Math.round(topControls)), left: overlayTemporary ? 0 : Math.max(0, Math.round(leftOverlay)), right: Math.max(0, Math.round(rightControls)), bottom: Math.max(0, Math.round(sheetHeight + trayHeight)) };
  }
  const DESKTOP_CAMERA = Object.freeze({ autoCenterOnSelect: true, adjustOnPanelOpen: true, adjustOnPanelResizeEnd: true, respectRecentManualPan: 1500, padding: 24, animationDuration: 220 });
  const TABLET_CAMERA = Object.freeze({ autoCenterOnSelect: true, adjustForDockedPanels: true, ignoreTemporaryOverlay: true, respectRecentManualPan: 1500, minPadding: 24, animationDuration: 220 });
  /** whether the camera may move now: a recent manual pan wins over automatic moves, except a direct selection */
  function shouldAdjust({ reason, lastManualPanAt = 0, now = Date.now(), policy = DESKTOP_CAMERA }) {
    if (reason === 'overlay' && policy.ignoreTemporaryOverlay) return false;
    if (reason === 'select') return policy.autoCenterOnSelect !== false;
    if (reason === 'panelOpen' && policy.adjustOnPanelOpen === false) return false;
    if (reason === 'resizeEnd' && policy.adjustOnPanelResizeEnd === false) return false;
    return !(lastManualPanAt && now - lastManualPanAt < policy.respectRecentManualPan);
  }
  /** smallest pan that brings the lot inside the effective viewport (no move when it is already visible: no camera jumps) */
  function panToReveal(b, { mapWidth, mapHeight, insets = {}, padding = 24 }) {
    if (!b) return null;
    const a = { x0: (insets.left || 0) + padding, y0: (insets.top || 0) + padding, x1: mapWidth - (insets.right || 0) - padding, y1: mapHeight - (insets.bottom || 0) - padding };
    if (a.x1 <= a.x0 || a.y1 <= a.y0) return null;
    const dx = b.x0 < a.x0 ? a.x0 - b.x0 : b.x1 > a.x1 ? a.x1 - b.x1 : 0, dy = b.y0 < a.y0 ? a.y0 - b.y0 : b.y1 > a.y1 ? a.y1 - b.y1 : 0;
    // a lot larger than the area is centred instead
    const cx = (b.x1 - b.x0) > (a.x1 - a.x0) ? (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2 : dx, cy = (b.y1 - b.y0) > (a.y1 - a.y0) ? (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 : dy;
    return cx || cy ? { dx: Math.round(cx), dy: Math.round(cy) } : null;
  }

  // ---------------------------------------------------------------- persistence (device + development + family)
  /** what is saved: widths, collapsed states, last left section, bottom bar; tablet prefs per orientation (§133, §206–211).
      Never saved: hover, focus, open popovers or drawers (§135, §212). Invalid data falls back to defaults (§309). */
  const prefKey = (devId, family) => `ws:${devId}:layout:${String(family || 'DESKTOP').toLowerCase()}`;
  function sanitizePrefs(raw, family) {
    const okW = v => Number.isFinite(v) && v >= 120 && v <= 1200 ? Math.round(v) : null, sec = v => LEFT_SECTIONS.includes(v) ? v : 'FIND';
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) return null;
    if (family === 'TABLET') {
      const p = raw.portrait || {}, l = raw.landscape || {};
      return { schemaVersion: SCHEMA_VERSION, portrait: { lastSnapState: ['MINIMIZED', 'INTERMEDIATE', 'EXPANDED'].includes(p.lastSnapState) ? p.lastSnapState : null, legendExpanded: typeof p.legendExpanded === 'boolean' ? p.legendExpanded : null, lastDrawerSection: sec(p.lastDrawerSection) },
        landscape: { rightPanelWidth: okW(l.rightPanelWidth), rightPanelCollapsed: !!l.rightPanelCollapsed, lastLeftDrawerSection: sec(l.lastLeftDrawerSection) } };
    }
    return { schemaVersion: SCHEMA_VERSION, leftWidth: okW(raw.leftWidth), rightWidth: okW(raw.rightWidth), leftCollapsed: !!raw.leftCollapsed, rightPinned: !!raw.rightPinned, lastLeftSection: sec(raw.lastLeftSection), bottomBarCollapsed: !!raw.bottomBarCollapsed };
  }
  /** layout migration (§137): before this schema the only layout preference was the store's leftCollapsed flag */
  function migratePrefs(raw, family, legacy = {}) {
    const ok = sanitizePrefs(raw, family); if (ok) return ok;
    if (family === 'TABLET') return { schemaVersion: SCHEMA_VERSION, portrait: { lastSnapState: null, legendExpanded: null, lastDrawerSection: 'FIND' }, landscape: { rightPanelWidth: null, rightPanelCollapsed: false, lastLeftDrawerSection: 'FIND' } };
    return { schemaVersion: SCHEMA_VERSION, leftWidth: null, rightWidth: null, leftCollapsed: !!legacy.leftCollapsed, rightPinned: false, lastLeftSection: 'FIND', bottomBarCollapsed: false };
  }
  function loadPrefs(devId, family, storage, legacy) { let raw = null; try { raw = storage.get(prefKey(devId, family)); } catch (e) { raw = null; } return migratePrefs(raw, family, legacy); }
  function savePrefs(devId, family, prefs, storage) { const ok = sanitizePrefs({ ...prefs, schemaVersion: SCHEMA_VERSION }, family); if (ok) try { storage.set(prefKey(devId, family), ok); } catch (e) { /* private mode */ } return ok; }

  return { SCHEMA_VERSION, DESKTOP_BEHAVIOR, DEFAULT_WIDTHS, RIGHT_CONTEXT, LEFT_SECTIONS, LAYOUT_MODES, Z, desktopState, widthLimits, clampWidth, defaultWidth, effectiveWidths, layoutModeOf, coordinator,
    TABLET_SNAP_CONFIG, TABLET_DENSITY, RIGHT_PRESETS, OVERLAYS, tabletState, tabletRightPreset, isSheetProfile, mapQuickViewStateAcrossLayouts, overlayCoordinator,
    viewportInsets, DESKTOP_CAMERA, TABLET_CAMERA, shouldAdjust, panToReveal, prefKey, sanitizePrefs, migratePrefs, loadPrefs, savePrefs };
})();
