/* utils/formatters.js — the only place that turns numbers and enums into display text. */
App.fmt = (() => {
  const LOC = 'pt-BR', ND = 'Não disponível';
  const nf = (d0, d1) => new Intl.NumberFormat(LOC, { minimumFractionDigits: d0, maximumFractionDigits: d1 });
  const N0 = nf(0, 0), N1 = nf(1, 1), N2 = nf(2, 2);
  const cur0 = new Intl.NumberFormat(LOC, { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const cur2 = new Intl.NumberFormat(LOC, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ok = v => v != null && Number.isFinite(v);
  const f = {
    ND,
    number: (v, d = 0) => ok(v) ? (d === 0 ? N0 : d === 1 ? N1 : N2).format(v) : ND,
    formatBRL: (v, cents = false) => ok(v) ? (cents ? cur2 : cur0).format(v) : 'Preço não disponível',
    formatBRLShort: v => !ok(v) ? 'Preço não disponível' : v >= 1e6 ? `R$ ${N1.format(v / 1e6)} mi` : `R$ ${N0.format(Math.round(v / 1000))} mil`,
    formatPricePerM2: v => ok(v) ? `${cur0.format(v)}/m²` : ND,
    formatSquareMeters: (v, d = 2) => ok(v) ? `${(d === 2 ? N2 : d === 1 ? N1 : N0).format(v)} m²` : ND,
    formatMeters: (v, d = 0) => ok(v) ? `${(d ? N1 : N0).format(v)} m` : ND,
    formatPercentage: (v, d = 0) => ok(v) ? `${(d ? N1 : N0).format(v * 100)}%` : ND,
    formatScore: v => ok(v) ? `${N0.format(v)}/100` : ND,
    formatNote: v => ok(v) ? N1.format(v) : ND,
    formatLotClass: c => App.i18n.t('LotClass', c, ND),
    formatAvailability: s => App.i18n.t('AvailabilityStatus', s || 'UNKNOWN'),
    formatDataStatus: s => App.i18n.t('DataStatus', s || 'UNKNOWN'),
    formatDate: iso => { if (!iso) return 'Data não informada'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; },
    formatLotTitle: (block, n) => `Quadra ${block} · Lote ${n}`,
    formatLotCode: (block, n) => `${block}-${n}`,
    formatDateTime: iso => { if (!iso) return 'Data não informada'; const d = new Date(iso); if (Number.isNaN(+d)) return 'Data não informada'; return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); },
    formatAge: (iso, now = Date.now()) => { if (!iso) return null; const m = Math.round((now - Date.parse(iso)) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dias`; },
    formatDirection: (d, deg) => d ? App.i18n.t('Direction', d) + (ok(deg) ? ` (${N0.format(deg)}°)` : '') : ND,
    formatLevel: (v, fem) => App.i18n.t(fem ? 'LevelF' : 'Level', v, ND),
    formatSides: arr => arr && arr.length ? arr.map(s => App.i18n.t('LotSide', s)).join(' e ') : ND,
    formatBool: (v, yes = 'Sim', no = 'Não') => v == null ? ND : v ? yes : no,
    formatHour: h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; },
    capital: s => s ? s[0].toUpperCase() + s.slice(1) : s
  };
  return Object.freeze(f);
})();
