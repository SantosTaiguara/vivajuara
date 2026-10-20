/* layout/responsiveProfile.js — ResponsiveProfileResolver and InputCapabilityResolver (topics 22 and 23).
   The layout is chosen from the space the workspace really has (width, height, orientation) and the input
   capabilities, never from the device name or the user agent. The result says which family (MOBILE / TABLET /
   DESKTOP), which layout profile and where each region goes (DOCKED, OVERLAY, SHEET, POPOVER). Pointer and hover only
   switch interaction enhancements (tooltips, hover highlight), never the structure. All numbers live in one config. */
App.responsive = (() => {
  /** ResponsiveBreakpointConfig: the only place with layout numbers (CSS reads the resolved profile, not widths) */
  const BREAKPOINTS = Object.freeze({
    mobileMax: 699, tabletMin: 700, tabletMax: 1279, desktopMin: 1280,
    tabletLandscapeMinWidth: 960, tabletLargeMinWidth: 1150, compactMaxHeight: 540,
    hysteresis: 24, // px band around a threshold where the previous profile is kept (browser chrome, small resizes)
    minMapWidth: { DESKTOP: 480, TABLET: 420 },
    panelMinWidth: { left: 260, right: 320, tabletRight: 300 },
    panelMaxWidth: { left: 360, right: 460, tabletRight: 400 }
  });
  const FAMILY = Object.freeze(['MOBILE', 'TABLET', 'DESKTOP']);
  const PROFILES = Object.freeze(['MOBILE', 'TABLET_PORTRAIT', 'TABLET_LANDSCAPE', 'TABLET_COMPACT', 'TABLET_LARGE', 'DESKTOP']);
  const PLACEMENT = Object.freeze(['DOCKED', 'OVERLAY', 'SHEET', 'POPOVER']);
  /** where each region goes per layout profile (topic 23 §96–97; topic 22 §12) */
  const REGIONS = Object.freeze({
    MOBILE: { left: 'OVERLAY', right: 'SHEET', comparison: 'FAB', legend: 'COMPACT' },
    TABLET_COMPACT: { left: 'OVERLAY', right: 'SHEET', comparison: 'FAB', legend: 'COMPACT' },
    TABLET_PORTRAIT: { left: 'OVERLAY', right: 'SHEET', comparison: 'FAB', legend: 'COMPACT' },
    TABLET_LANDSCAPE: { left: 'OVERLAY', right: 'DOCKED', comparison: 'TRAY', legend: 'COMPACT' },
    TABLET_LARGE: { left: 'OVERLAY', right: 'DOCKED', comparison: 'TRAY', legend: 'EXPANDED' },
    DESKTOP: { left: 'DOCKED', right: 'DOCKED', comparison: 'TRAY', legend: 'EXPANDED' }
  });
  const DENSITY = Object.freeze({ MOBILE: 'comfortable', TABLET_COMPACT: 'comfortable', TABLET_PORTRAIT: 'comfortable', TABLET_LANDSCAPE: 'medium', TABLET_LARGE: 'medium', DESKTOP: 'compact' });

  const num = (v, d = 0) => Number.isFinite(+v) && +v >= 0 ? +v : d;
  /** orientation from the signal when given, otherwise from the width/height ratio (§249) */
  function orientationOf(input) {
    const o = String(input.orientation || '').toUpperCase();
    if (o.startsWith('PORTRAIT') || o.startsWith('LANDSCAPE')) return o.startsWith('PORTRAIT') ? 'PORTRAIT' : 'LANDSCAPE';
    const w = num(input.containerWidth || input.viewportWidth), h = num(input.containerHeight || input.viewportHeight);
    return w >= h ? 'LANDSCAPE' : 'PORTRAIT';
  }
  /** InputCapabilityResolver: touch / fine pointer / hover / keyboard likely. Unknown pointer is treated as touch-safe (§248). */
  function resolveInput(input = {}) {
    const p = String(input.pointerType || 'UNKNOWN').toUpperCase(), hover = String(input.hoverCapability || 'NONE').toUpperCase() === 'HOVER';
    const pointerType = ['COARSE', 'FINE', 'HYBRID'].includes(p) ? p : 'UNKNOWN';
    const touch = pointerType !== 'FINE', finePointer = pointerType === 'FINE' || pointerType === 'HYBRID';
    return { pointerType, touch, finePointer, hover, keyboardLikely: !!input.keyboardSeen || pointerType === 'FINE', gesturePreferred: touch && !finePointer };
  }
  /** family by available width, with hysteresis around the thresholds when the previous profile is known */
  function familyOf(w, prev, bp) {
    const band = prev ? bp.hysteresis : 0, pf = prev && prev.family;
    if (pf === 'DESKTOP' && w >= bp.desktopMin - band) return 'DESKTOP';
    if (pf === 'MOBILE' && w <= bp.mobileMax + band) return 'MOBILE';
    if (pf === 'TABLET' && w >= bp.tabletMin - band && w <= bp.tabletMax + band) return 'TABLET';
    return w >= bp.desktopMin ? 'DESKTOP' : w >= bp.tabletMin ? 'TABLET' : 'MOBILE';
  }
  function tabletProfile(w, h, orientation, prev, bp) {
    const band = prev && prev.family === 'TABLET' ? bp.hysteresis : 0, pp = prev && prev.layoutProfile;
    const keep = (p, ok) => pp === p && ok;
    if (h < bp.compactMaxHeight && !keep('TABLET_LANDSCAPE', h >= bp.compactMaxHeight - band) && !keep('TABLET_LARGE', h >= bp.compactMaxHeight - band)) return 'TABLET_COMPACT';
    if (orientation === 'PORTRAIT') return 'TABLET_PORTRAIT';
    if (w >= bp.tabletLargeMinWidth || keep('TABLET_LARGE', w >= bp.tabletLargeMinWidth - band)) return 'TABLET_LARGE';
    if (w >= bp.tabletLandscapeMinWidth || keep('TABLET_LANDSCAPE', w >= bp.tabletLandscapeMinWidth - band)) return 'TABLET_LANDSCAPE';
    return 'TABLET_COMPACT'; // landscape but too narrow for a docked panel next to the map (split screen, zoom)
  }
  /** ResponsiveProfileResolver: ResponsiveProfileInput → ResponsiveProfile. Never throws: a broken input falls back to
      TABLET_COMPACT, where the map stays reachable (§247, §250). The user agent is not an input. */
  function resolve(input = {}, prev = null, bp = BREAKPOINTS) {
    try {
      const w = num(input.containerWidth || input.viewportWidth), h = num(input.containerHeight || input.viewportHeight);
      if (!w || !h) throw new Error('no dimensions');
      const orientation = orientationOf(input), family = familyOf(w, prev, bp);
      const layoutProfile = family === 'MOBILE' ? 'MOBILE' : family === 'DESKTOP' ? 'DESKTOP' : tabletProfile(w, h, orientation, prev, bp);
      return build(family, layoutProfile, orientation, input, w, h, bp);
    } catch (e) { return build('TABLET', 'TABLET_COMPACT', orientationOf(input), input, num(input.viewportWidth), num(input.viewportHeight), bp, true); }
  }
  function build(family, layoutProfile, orientation, input, w, h, bp, fallback = false) {
    const regions = REGIONS[layoutProfile], caps = resolveInput(input);
    return Object.freeze({ family, layoutProfile, orientation, density: DENSITY[layoutProfile], inputMode: caps.gesturePreferred ? 'TOUCH' : caps.finePointer && caps.touch ? 'HYBRID' : caps.finePointer ? 'POINTER' : 'TOUCH',
      capabilities: Object.freeze({ ...caps, hoverTooltips: caps.hover, reducedMotion: !!input.prefersReducedMotion }), regions: Object.freeze({ ...regions }),
      minMapWidth: family === 'DESKTOP' ? bp.minMapWidth.DESKTOP : bp.minMapWidth.TABLET, width: w, height: h, fallback });
  }
  /** html data attributes the stylesheet keys on (data-layout, data-lp, data-rp, data-hover): same link, different container */
  function attrs(p) { return { layout: p.layoutProfile.toLowerCase().replace(/_/g, '-'), lp: p.regions.left === 'DOCKED' ? 'docked' : 'overlay', rp: p.regions.right === 'DOCKED' ? 'docked' : 'sheet', hover: p.capabilities.hover ? 'hover' : 'none', density: p.density }; }
  /** browser input (read once per change; the resolver itself stays pure and testable) */
  function readEnvironment(container) {
    const w = typeof window !== 'undefined' ? window : null; if (!w) return {};
    const mm = q => { try { return !!(w.matchMedia && w.matchMedia(q).matches); } catch (e) { return false; } };
    const r = container && container.getBoundingClientRect ? container.getBoundingClientRect() : null;
    const coarse = mm('(any-pointer: coarse)'), fine = mm('(any-pointer: fine)');
    return { viewportWidth: w.innerWidth, viewportHeight: w.innerHeight, containerWidth: r && r.width || w.innerWidth, containerHeight: r && r.height || w.innerHeight,
      orientation: mm('(orientation: portrait)') ? 'PORTRAIT' : mm('(orientation: landscape)') ? 'LANDSCAPE' : null, // the viewport's orientation, not the screen's (split screen)
      pointerType: coarse && fine ? 'HYBRID' : coarse ? 'COARSE' : fine ? 'FINE' : 'UNKNOWN', hoverCapability: mm('(hover: hover)') ? 'HOVER' : 'NONE', prefersReducedMotion: mm('(prefers-reduced-motion: reduce)') };
  }
  function apply(p, root) { const a = attrs(p), el = root || (typeof document !== 'undefined' && document.documentElement); if (!el || !el.dataset) return a; for (const [k, v] of Object.entries(a)) if (el.dataset[k] !== v) el.dataset[k] = v; return a; }
  /** live profile for the app: resolve on load, then on resize / orientation / container changes (debounced through rAF) */
  let current = null;
  function init() {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) return null;
    current = resolve(readEnvironment(null), null); apply(current); return current;
  }
  const get = () => current;
  function refresh() { const prev = current; current = resolve(readEnvironment(null), prev); apply(current); return { profile: current, changed: !prev || prev.layoutProfile !== current.layoutProfile, previous: prev }; }
  // set the attributes before the first paint (the shell markup is already parsed when the inline script runs)
  try { if (typeof document !== 'undefined' && document.documentElement && typeof window !== 'undefined' && window.innerWidth) init(); } catch (e) { /* not a browser */ }
  return { BREAKPOINTS, FAMILY, PROFILES, PLACEMENT, REGIONS, DENSITY, resolve, resolveInput, orientationOf, attrs, readEnvironment, apply, init, get, refresh };
})();
