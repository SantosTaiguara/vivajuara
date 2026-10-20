/* services/finance.js — FinancialSimulationService.
   Receives price, down payment and the price table's plans; returns structured
   plans and schedules. Same formulas as the launch presentation (no IGP-M). */
App.services.finance = (() => {
  const factor = (i, n) => i / (1 - Math.pow(1 + i, -n));
  function annualPV(i, first, count) { let s = 0; for (let k = 0; k < count; k++) s += Math.pow(1 + i, -(first + 12 * k)); return s; }
  function buildPlan(p, price, dp) {
    const fin = price - dp;
    if (p.kind === 'PRICE') {
      const m = fin * factor(p.rate, p.months);
      return { monthly: m, annual: 0, months: p.months, annualCount: 0, total: dp + m * p.months, main: { count: p.months, value: m },
        parts: k => k === 0 ? [dp, 0] : [k <= p.months ? m : 0, 0] };
    }
    if (p.kind === 'PRICE_ANNUAL') {
      const m = fin * p.monthlyShare * factor(p.rate, p.months), a = fin * (1 - p.monthlyShare) / annualPV(p.rate, p.firstAnnualMonth, p.annualCount);
      const isAnnual = k => k >= p.firstAnnualMonth && (k - p.firstAnnualMonth) % 12 === 0 && (k - p.firstAnnualMonth) / 12 < p.annualCount;
      return { monthly: m, annual: a, months: p.months, annualCount: p.annualCount, total: dp + m * p.months + a * p.annualCount, main: { count: p.months, value: m },
        parts: k => k === 0 ? [dp, 0] : [k <= p.months ? m : 0, isAnnual(k) ? a : 0] };
    }
    // INSTALLMENTS: discount on the full price, no interest.
    const total = price * (1 - p.discount), m = (total - dp) / p.months;
    return { monthly: m, annual: 0, months: p.months, annualCount: 0, total, discount: p.discount, main: { count: p.months, value: m },
      parts: k => k === 0 ? [dp, 0] : [k <= p.months ? m : 0, 0] };
  }
  /** simulate({ price, downPaymentPct (0–100), plans }) → null when there is no price */
  function simulate({ price, downPaymentPct, plans }) {
    if (price == null) return null;
    const dp = price * downPaymentPct / 100;
    return { price, downPaymentPct, downPayment: dp, financed: price - dp, plans: plans.map(p => { const b = buildPlan(p, price, dp); return { id: p.id, name: p.name, desc: p.desc, kind: p.kind, ...b, at: k => b.parts(k)[0] + b.parts(k)[1] }; }) };
  }
  /** yearly table of one plan: [{ year (0 = ato), monthly, annual, total, cumulative }] */
  function yearly(plan) {
    const rows = [{ year: 0, monthly: 0, annual: 0, total: plan.at(0) }];
    for (let y = 0; y * 12 < plan.months; y++) {
      let m = 0, a = 0; for (let k = y * 12 + 1; k <= y * 12 + 12; k++) { const [pm, pa] = plan.parts(k); m += pm; a += pa; }
      if (m || a) rows.push({ year: y + 1, monthly: m, annual: a, total: m + a });
    }
    let c = 0; rows.forEach(r => { c += r.total; r.cumulative = c; });
    return rows;
  }
  /** cumulative paid per month for each plan, for charts */
  function cumulative(sim, horizon) {
    const H = horizon || Math.max(...sim.plans.map(p => p.months));
    return sim.plans.map(p => { let acc = 0; const pts = []; for (let k = 0; k <= H; k++) { acc += p.at(k); pts.push(acc); } return { id: p.id, name: p.name, pts }; });
  }
  return { simulate, yearly, cumulative, factor, annualPV };
})();
