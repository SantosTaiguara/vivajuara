/* mobile/sheet.js — mobile bottom sheet as a container of the Quick View (topic 21).
   Pure pieces the browser code drives: snap states (HIDDEN / MINIMIZED / INTERMEDIATE / EXPANDED), viewport-relative
   snap heights (never one fixed pixel height), resolveSnapTarget (position + velocity), behaviour policy (what happens
   on lot select, map drag, map tap, close vs collapse), the map camera policy (fitLotIntoVisibleMapArea: never leave
   the selected lot behind the sheet), map UI insets, keyboard handling and the single-sheet coordinator. The Quick View
   content is the same view model as desktop; nothing here touches data. */
App.mobileSheet = (() => {
  const SCHEMA_VERSION = 1;
  const SNAP = Object.freeze(['HIDDEN', 'MINIMIZED', 'INTERMEDIATE', 'EXPANDED']);
  const OPEN = Object.freeze(['MINIMIZED', 'INTERMEDIATE', 'EXPANDED']);
  const TO_STORE = Object.freeze({ MINIMIZED: 'min', INTERMEDIATE: 'mid', EXPANDED: 'full' });
  const FROM_STORE = Object.freeze({ min: 'MINIMIZED', mid: 'INTERMEDIATE', full: 'EXPANDED' });
  const SNAP_CONFIG = Object.freeze({ unit: 'VIEWPORT_FRACTION', minimized: 0.16, intermediate: 0.48, expanded: 0.88, minimizedMinPx: 88, minimizedMaxPx: 132,
    minMapVisibleHeight: 64, keyboardBehavior: 'KEEP_SNAP_CLAMP_TO_VISUAL_VIEWPORT', orientationOverrides: { landscape: { minimized: 0.26, intermediate: 0.62, expanded: 0.92 } } });
  const BEHAVIOR = Object.freeze({ openStateOnLotSelect: 'INTERMEDIATE', preserveStateOnLotChange: true, collapseOnMapDrag: 'EXPANDED_TO_INTERMEDIATE', collapseOnMapTapEmpty: false,
    dismissOnBackdropTap: false, allowSwipeToDismiss: false, minVelocityToSnap: 0.45, snapThreshold: 0.5, restoreLastState: false });
  const CAMERA = Object.freeze({ autoCenterOnSelect: true, autoCenterOnSheetExpand: true, minimumVisiblePadding: 24, animationDuration: 220, respectRecentManualPan: 1500 });
  const OVERLAY_PRIORITY = Object.freeze(['FULL_DETAILS', 'FILTERS', 'LAYERS', 'QUICKVIEW', 'LEGEND_POPOVER']);

  /** snap heights in px for a viewport (dvh-aware: pass the visual viewport height); expanded always leaves a strip of map */
  function heights(viewportHeight, { orientation = 'portrait', safeAreaBottom = 0, config = SNAP_CONFIG } = {}) {
    const c = { ...config, ...(orientation === 'landscape' ? config.orientationOverrides.landscape : {}) }, vh = Math.max(0, viewportHeight || 0);
    const min = Math.round(Math.min(config.minimizedMaxPx, Math.max(config.minimizedMinPx, vh * c.minimized)) + safeAreaBottom);
    const exp = Math.round(Math.max(min, Math.min(vh * c.expanded, vh - config.minMapVisibleHeight)));
    const mid = Math.round(Math.max(min, Math.min(exp, vh * c.intermediate)));
    return { HIDDEN: 0, MINIMIZED: min, INTERMEDIATE: mid, EXPANDED: exp };
  }
  /** resolveSnapTarget(currentPx, velocity px/ms (positive = growing), heights, behavior) → snap state.
      Fast flicks move one snap in the flick direction even before the midpoint; slow releases go to the nearest snap. */
  function resolveSnapTarget(currentPx, velocity, h, behavior = BEHAVIOR) {
    const order = OPEN.map(s => ({ s, px: h[s] })).sort((a, b) => a.px - b.px);
    const v = Number.isFinite(velocity) ? velocity : 0;
    if (Math.abs(v) >= behavior.minVelocityToSnap) {
      if (v > 0) { const up = order.find(o => o.px > currentPx + 1); return up ? up.s : order[order.length - 1].s; }
      const below = [...order].reverse().find(o => o.px < currentPx - 1);
      if (!below && behavior.allowSwipeToDismiss) return 'HIDDEN';
      return below ? below.s : order[0].s;
    }
    let best = order[0]; for (const o of order) if (Math.abs(o.px - currentPx) < Math.abs(best.px - currentPx)) best = o;
    return best.s;
  }
  const next = (snap, dir) => { const i = OPEN.indexOf(snap); if (i < 0) return dir > 0 ? 'INTERMEDIATE' : 'MINIMIZED'; return OPEN[Math.max(0, Math.min(OPEN.length - 1, i + dir))]; };

  // ---------------------------------------------------------------- behaviour policy (pure transitions)
  /** a lot was selected (map, search, deep link, recommendation): minimized/hidden → intermediate; intermediate/expanded are kept */
  function onLotSelect(snap, { source = 'map', behavior = BEHAVIOR } = {}) {
    if (snap === 'HIDDEN' || snap == null) return behavior.openStateOnLotSelect;
    if (!behavior.preserveStateOnLotChange) return behavior.openStateOnLotSelect;
    return snap === 'MINIMIZED' ? behavior.openStateOnLotSelect : snap;
  }
  const onMapDrag = (snap, behavior = BEHAVIOR) => (behavior.collapseOnMapDrag === 'EXPANDED_TO_INTERMEDIATE' && snap === 'EXPANDED' ? 'INTERMEDIATE' : snap);
  const onMapTapEmpty = (snap, behavior = BEHAVIOR) => (behavior.collapseOnMapTapEmpty && OPEN.includes(snap) ? 'MINIMIZED' : snap);
  /** collapse keeps the lot; close clears it */
  const collapse = () => ({ snap: 'MINIMIZED', clearLot: false });
  const close = () => ({ snap: 'HIDDEN', clearLot: true });
  /** browser back: details first, then expanded → intermediate; otherwise let the browser go back (no hijacking) */
  function onBack({ detailsOpen, snap }) {
    if (detailsOpen) return { handled: true, closeDetails: true, snap };
    if (snap === 'EXPANDED') return { handled: true, snap: 'INTERMEDIATE' };
    return { handled: false, snap };
  }
  /** new session: no lot → HIDDEN; lot (deep link or restored) → INTERMEDIATE; EXPANDED is never restored without context */
  const initialSnap = ({ hasLot, saved }) => (!hasLot ? 'HIDDEN' : saved === 'MINIMIZED' && BEHAVIOR.restoreLastState ? 'MINIMIZED' : 'INTERMEDIATE');

  // ---------------------------------------------------------------- map camera
  /** fitLotIntoVisibleMapArea(lotScreenBounds, { mapWidth, mapHeight, sheetHeight, insets, padding }) → { dx, dy } screen pan, or null when visible.
      The visible map is the map minus the sheet (bottom) and the floating controls (top/right). */
  function fitLotIntoVisibleMapArea(b, { mapWidth, mapHeight, sheetHeight = 0, insets = {}, padding = CAMERA.minimumVisiblePadding } = {}) {
    if (!b || !mapWidth || !mapHeight) return null;
    const area = { x0: (insets.left || 0) + padding, y0: (insets.top || 0) + padding, x1: mapWidth - (insets.right || 0) - padding, y1: mapHeight - sheetHeight - padding };
    if (area.y1 - area.y0 < 24) area.y1 = area.y0 + 24; // very small visible strip: still aim at its centre
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const fits = b.x0 >= area.x0 && b.x1 <= area.x1 && b.y0 >= area.y0 && b.y1 <= area.y1;
    if (fits) return null;
    return { dx: Math.round((area.x0 + area.x1) / 2 - cx), dy: Math.round((area.y0 + area.y1) / 2 - cy), area };
  }
  /** should the camera move now? (a recent manual pan wins over automatic centring) */
  const shouldAutoCenter = ({ reason, lastManualPanAt, now, policy = CAMERA }) => {
    if (reason === 'select' && !policy.autoCenterOnSelect) return false;
    if (reason === 'expand' && !policy.autoCenterOnSheetExpand) return false;
    if (reason !== 'select' && lastManualPanAt && now - lastManualPanAt < policy.respectRecentManualPan) return false;
    return true;
  };
  /** map UI insets: controls and legend move above the sheet; the top inset is the header/search */
  const insets = ({ sheetHeight = 0, headerHeight = 0, controlsWidth = 0, safeAreaTop = 0 }) => ({ top: headerHeight + safeAreaTop, bottom: sheetHeight, right: controlsWidth, left: 0 });

  // ---------------------------------------------------------------- keyboard / viewport
  /** keyboard open (visual viewport shorter than the layout viewport): keep the snap, clamp the height to what is visible */
  function keyboardAdjust({ layoutHeight, visualHeight, sheetHeight }) {
    const kb = Math.max(0, (layoutHeight || 0) - (visualHeight || 0));
    const open = kb > 120;
    return { keyboardOpen: open, keyboardHeight: open ? kb : 0, sheetHeight: open ? Math.min(sheetHeight, Math.max(0, visualHeight - SNAP_CONFIG.minMapVisibleHeight / 2)) : sheetHeight };
  }
  const orientationOf = (w, h) => (w > h && h < 520 ? 'landscape' : 'portrait');

  // ---------------------------------------------------------------- single-sheet coordinator (UI state only)
  function coordinator(initial = 'HIDDEN') {
    let quickSnap = initial, stack = [], saved = null;
    const top = () => stack.slice().sort((a, b) => OVERLAY_PRIORITY.indexOf(a) - OVERLAY_PRIORITY.indexOf(b))[0] || (quickSnap !== 'HIDDEN' ? 'QUICKVIEW' : null);
    return {
      /** opening filters/layers/details suspends the Quick View (minimized) and remembers its snap */
      open(id) { if (!OVERLAY_PRIORITY.includes(id) || id === 'QUICKVIEW') return this.state(); if (!stack.includes(id)) stack.push(id); if (saved == null && quickSnap !== 'HIDDEN') { saved = quickSnap; quickSnap = 'MINIMIZED'; } return this.state(); },
      close(id) { stack = stack.filter(x => x !== id); if (!stack.length && saved != null) { quickSnap = saved; saved = null; } return this.state(); },
      setQuickSnap(s) { if (SNAP.includes(s)) { if (stack.length && s !== 'HIDDEN') saved = s; else quickSnap = s; } return this.state(); },
      /** selecting a lot gives the Quick View priority again */
      selectLot(source) { stack = stack.filter(x => x === 'FULL_DETAILS'); const base = saved != null ? saved : quickSnap; saved = null; quickSnap = onLotSelect(base, { source }); return this.state(); },
      state() { return { active: top(), quickSnap, stack: stack.slice(), suspendedSnap: saved }; }
    };
  }
  /** screen-reader text for a snap change */
  const announce = (snap, title) => ({ MINIMIZED: `Resumo do ${title} recolhido.`, INTERMEDIATE: `Resumo do ${title} aberto.`, EXPANDED: `Resumo do ${title} expandido.`, HIDDEN: 'Resumo fechado.' }[snap] || '');
  function createState(o = {}) {
    return { visibility: o.snap && o.snap !== 'HIDDEN' ? 'VISIBLE' : 'HIDDEN', snapState: o.snap || 'HIDDEN', currentHeight: 0, isDragging: false, dragDirection: null, velocity: 0, scrollTop: 0,
      keyboardOpen: false, viewportHeight: o.viewportHeight || 0, safeAreaBottom: o.safeAreaBottom || 0, safeAreaTop: o.safeAreaTop || 0, orientation: o.orientation || 'portrait', schemaVersion: SCHEMA_VERSION };
  }
  return { SCHEMA_VERSION, SNAP, OPEN, TO_STORE, FROM_STORE, SNAP_CONFIG, BEHAVIOR, CAMERA, OVERLAY_PRIORITY, heights, resolveSnapTarget, next, onLotSelect, onMapDrag, onMapTapEmpty, collapse, close, onBack,
    initialSnap, fitLotIntoVisibleMapArea, shouldAutoCenter, insets, keyboardAdjust, orientationOf, coordinator, announce, createState };
})();
