// Generates the analytics catalog docs and TypeScript types from the single source of truth
// (plat/config/analytics/*.json through App.eventTracking.registry / App.semanticLayer), so docs, types and code never diverge.
// Run from plat/: node scripts/analyticsDocs.js   (tests/analytics.test.js fails when the committed files are stale)
const fs = require('fs'), path = require('path');
const { load, SRC } = require('../tests/harness.js');
const DOCS = path.join(__dirname, '..', 'docs');
function generate() {
  const App = load();
  for (const f of ['registry', 'privacy', 'client', 'semantic']) new Function('App', fs.readFileSync(path.join(SRC, 'analytics', f + '.js'), 'utf8'))(App);
  const r = App.eventTracking.registry.current(), S = App.semanticLayer.current();
  const head = '<!-- GERADO por plat/scripts/analyticsDocs.js a partir de plat/config/analytics — não editar à mão. -->\n';
  const events = head + `# Catálogo de eventos de analytics (tópico 45)\n\nVersão do registro: **${r.version}** · envelope \`${r.schemaVersion}\` · ${r.list().length} eventos · ${r.legacy().length} nomes antigos mapeados.\n\n`
    + 'Convenção: `snake_case` semântico (intenção, nunca o componente visual); versão inteira e monotônica; evento PUBLISHED é imutável. `*` = propriedade obrigatória. Defaults omitidos: classe produto, produtor CLIENT (WEB_CLIENT), privacidade NONE, consentimento ANALYTICS, prioridade NORMAL, dedupe EVENT_ID, sem amostragem, destinos LOCAL_BUFFER + FIRST_PARTY_INGESTION (desligado).\n\n'
    + r.generateDocs() + `\n## Eventos sem métrica consumidora (a questionar, §35)\n\n${r.unconsumed().map(n => '`' + n + '`').join(', ') || '—'}\n`;
  const m = [...S.metrics.values()];
  const metrics = head + `# Catálogo de métricas (tópico 44)\n\nRegistro v${S.src.metricRegistryVersion} · funis v${S.src.funnelRegistryVersion} · dimensões v${S.src.dimensionRegistryVersion} · transformação v${S.src.transformationVersion}.\n\n`
    + '| Código | Nome | Domínio | Entidade | Medida | Fórmula (expressionRef) | Numerador / Denominador | Base de tempo | 0/0 | Dimensões | Versão | Status | Disponível no aparelho |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n'
    + m.map(x => `| \`${x.code}\` | ${x.name} | ${x.domain} | ${x.entity} | ${x.measureType} | ${x.expressionRef}${x.params && x.params.events ? ' (' + x.params.events.join(', ') + ')' : ''} | ${x.numeratorMetricRef ? x.numeratorMetricRef + ' / ' + x.denominatorMetricRef : '—'} | ${x.timestampBasis} | ${x.zeroDenominatorPolicy} | ${(x.dimensionsAllowed || []).join(', ') || '—'} | ${x.version} | ${x.status} | ${S.isLocal(x) ? 'sim' : 'não (precisa do servidor)'} |`).join('\n')
    + '\n\n## Definições\n\n' + m.map(x => `### \`${x.code}\` — ${x.name}\n\n${x.description}${(x.caveats || []).length ? '\n\nRessalvas: ' + x.caveats.join(' ') : ''}${x.associationOnly ? '\n\nAssociação/sequência — não é efeito causal.' : ''}${x.blockedReason ? '\n\nBloqueada: ' + x.blockedReason : ''}\n\nLinhagem: ${(x.lineage.sourceFacts || []).join(', ') || '—'} → ${(x.lineage.transformations || []).join('; ') || '—'}.\n`).join('\n');
  return { 'ANALYTICS_EVENT_CATALOG.md': events, 'ANALYTICS_METRIC_CATALOG.md': metrics, 'ANALYTICS_EVENT_TYPES.d.ts': r.generateTypes() };
}
if (require.main === module) { const out = generate(); for (const [f, c] of Object.entries(out)) fs.writeFileSync(path.join(DOCS, f), c); console.log('ok', Object.keys(out).join(', ')); }
module.exports = { generate, DOCS };
