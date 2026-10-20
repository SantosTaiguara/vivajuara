/* services/solar.js — SolarAnalysisService (same astronomy as before).
   Declination + hour angle, clock time UTC-3 without daylight saving.
   Returns structured results; drawing lives in presentation/solar.js. */
App.services.solar = (() => {
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;
  const SEASONS = {
    ver: { label: 'Verão', when: '21 de dezembro', decl: -23.44, eot: 1.7 },
    eq: { label: 'Outono / primavera', when: '21 de março e 23 de setembro', decl: 0, eot: 0 },
    inv: { label: 'Inverno', when: '21 de junho', decl: 23.44, eot: -1.8 }
  };
  const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function make(geo) {
    const lat = geo.lat * D2R, lonOff = (geo.lon - geo.utcOffset * 15) / 15; // (lon + 45)/15 for UTC-3
    function position(season, h) {
      const p = SEASONS[season], d = p.decl * D2R, H = 15 * (h + lonOff + p.eot / 60 - 12) * D2R;
      const alt = Math.asin(Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H)) * R2D;
      const az = (Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(lat) - Math.cos(d) * Math.sin(lat) * Math.cos(H)) * R2D + 360) % 360;
      return { alt, az };
    }
    function day(season) {
      const p = SEASONS[season], H0 = Math.acos(-Math.tan(lat) * Math.tan(p.decl * D2R)) * R2D / 15, off = lonOff + p.eot / 60;
      return { sunrise: 12 - H0 - off, sunset: 12 + H0 - off };
    }
    const relAngle = (a, b) => ((a - b + 540) % 360) - 180;
    const sectorOf = a => SECTORS[Math.round((((a % 360) + 360) % 360) / 45) % 8];
    /** 'FRONT' | 'BACK' | 'NIGHT': front is lit when the sun is within 90° of the front bearing */
    function litSide(frontBearing, season, h) { const p = position(season, h); if (p.alt <= 0) return 'NIGHT'; return Math.abs(relAngle(p.az, frontBearing)) < 90 ? 'FRONT' : 'BACK'; }
    function intervals(frontBearing, season) {
      const d = day(season), out = { FRONT: [], BACK: [] }; let cur = null, st = d.sunrise;
      for (let h = d.sunrise; h <= d.sunset + 1e-6; h += 1 / 60) { const k = litSide(frontBearing, season, Math.min(h, d.sunset - 1e-4)); if (k !== cur) { if (cur && cur !== 'NIGHT') out[cur].push([st, h]); cur = k; st = h; } }
      if (cur && cur !== 'NIGHT') out[cur].push([st, d.sunset]);
      return out;
    }
    /** structured reading of the sun on a lot at a moment */
    function moment(frontBearing, season, h) {
      const p = position(season, h);
      if (p.alt <= 0) return { day: false, ...day(season) };
      const rel = relAngle(p.az, frontBearing), ar = Math.abs(rel);
      const lateral = sectorOf(frontBearing + (rel > 0 ? 90 : -90));
      const lit = ar <= 30 ? 'FRONT_DIRECT' : ar < 90 ? 'FRONT_AND_SIDE' : ar < 150 ? 'BACK_AND_SIDE' : 'BACK_DIRECT';
      return { day: true, altitude: p.alt, azimuth: p.az, from: sectorOf(p.az), lit, lateral, nearZenith: p.alt > 70 };
    }
    return { SEASONS, position, day, relAngle, sectorOf, litSide, intervals, moment };
  }
  return { make, SEASONS };
})();
