/* services/share.js — ShareService: summaries, WhatsApp link and deep links.
   Receives prepared view data (labels already formatted by the ViewModel layer). */
App.services.share = (() => {
  const FOOT = 'Valores sem correção pelo IGP-M. Análise de ruído, privacidade e sol é estimativa.';
  /** lotsSummary({ devName, customerName, entries: [{ title, areaLabel, lines: [] }] }) */
  function lotsSummary({ devName, customerName, entries, footer }) {
    const head = (customerName ? `Olá, ${customerName}!\n\n` : '') + `${devName} · ${entries.length > 1 ? 'lotes selecionados' : 'lote selecionado'}`;
    return head + '\n\n' + entries.map(e => `${e.title} (${e.areaLabel})\n` + e.lines.join('\n')).join('\n\n') + '\n\n' + (footer || FOOT);
  }
  const whatsappUrl = text => 'https://wa.me/?text=' + encodeURIComponent(text);
  const deepLink = (base, token) => base + '#' + token;
  return { lotsSummary, whatsappUrl, deepLink, FOOT };
})();
