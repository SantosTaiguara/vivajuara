/* analytics/early.js — GAP-ARCH-10: buffer for App.analytics calls made before analytics/facade.js loads.

   App.analytics has one owner, analytics/facade.js. This placeholder is only opened with `||` (not an ownership
   claim): it keeps up to 100 calls in memory (never persisted, never sent) and the facade replays them once through
   the legacy path (same validation, privacy and consent as every other event). Loaded right after prelude.js. */
App.analytics = App.analytics || (() => {
  const early = [];
  return { early, track(evt, data) { early.push({ evt, data, t: Date.now() }); if (early.length > 100) early.shift(); }, get log() { return early.slice(); } };
})();
