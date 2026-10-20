// Generates the data-derived governance documents (topics 52/54/55) from the real code and the governance configs.
//   node scripts/governanceDocs.js
// Written files (pt-BR, regenerated — do not edit by hand):
//   docs/CURRENT_ARCHITECTURE_INVENTORY.md · docs/DOMAIN_MODULE_MAP.md · docs/MODULE_DEPENDENCY_MATRIX.md
//   docs/CAPABILITY_PRESERVATION_MATRIX.md · docs/GOLDEN_TEST_MATRIX.md · docs/DATA_PARITY_REPORT.md
//   docs/ROADMAP_DEPENDENCY_GRAPH.md · docs/ROADMAP_PHASE_DEFINITIONS.md
const fs = require('fs'), path = require('path');
const G = require('./governanceSources.js');
const A = G.mod('architectureConformance.js'), C = G.mod('capabilityRegistry.js'), R = G.mod('roadmap.js');
const DOCS = path.join(G.ROOT, 'docs');
const HEAD = (title, src) => `# ${title}\n\n> Documento gerado por \`node scripts/governanceDocs.js\` a partir de ${src}. Não editar à mão: altere a fonte e gere de novo.\n\n`;
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const write = (f, s) => { fs.writeFileSync(path.join(DOCS, f), s.endsWith('\n') ? s : s + '\n'); console.log('docs/' + f); };

const manifest = G.cfg('architecture'), sources = G.sources();
const res = A.evaluate({ manifest, sources });
const rat = A.ratchet(res.findings, manifest.knownViolations.map(k => k.key));
const gapOf = new Map(manifest.knownViolations.map(k => [k.key, k.gapId]));
const fact = f => res.facts.get(f);
const ownedNs = f => [...res.owners].filter(([, o]) => o === f).map(([ns]) => 'App.' + ns);

// ---------------------------------------------------------------- inventory
{
  const files = Object.keys(sources).sort();
  const byLayer = {}; for (const f of files) { const m = res.modules.get(f); const k = m ? m.layer : '(não classificado)'; byLayer[k] = (byLayer[k] || 0) + 1; }
  const lines = files.reduce((n, f) => n + fact(f).lines, 0);
  let s = HEAD('Inventário da arquitetura atual (Fase 0.1)', '`plat/src/**/*.js` e `config/governance/architecture.json`');
  s += `Data da geração: ${new Date().toISOString().slice(0, 10)}. ${files.length} arquivos JavaScript em \`plat/src\`, ${lines.toLocaleString('pt-BR')} linhas. Arquitetura atual: aplicação de página única (build \`scripts/build.js\` concatena os módulos na ordem de \`tests/harness.js\` + lista de UI) em que cada módulo é um script que se pendura no objeto global \`App\`. Não há imports: as dependências são as referências \`App.<namespace>\` lidas pelo teste de arquitetura.\n\n`;
  s += '## Arquivos por camada\n\n| Camada | Arquivos |\n|---|---|\n' + Object.entries(byLayer).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
  s += '## Fontes de dados, storage e rede (achados estáticos)\n\n- Dados publicados lidos por: ' + files.filter(f => fact(f).rawFiles.length && (res.modules.get(f) || {}).layer !== 'governance').map(f => `\`${f}\` (${fact(f).rawFiles.join(', ')})`).join(', ') + '.\n';
  s += '- Uso de storage do browser (localStorage/sessionStorage/IndexedDB/Cache Storage): ' + files.filter(f => fact(f).storage.length).map(f => `\`${f}\``).join(', ') + '.\n';
  s += '- Chamadas de rede (fetch/XHR/sendBeacon/WebSocket/EventSource): ' + files.filter(f => fact(f).network.length).map(f => `\`${f}\``).join(', ') + '.\n';
  s += '- Acesso a DOM/browser fora das views: ' + files.filter(f => fact(f).dom.length && !['presentation', 'composition'].includes((res.modules.get(f) || {}).layer)).map(f => `\`${f}\``).join(', ') + '.\n\n';
  s += '## Módulos\n\n| Arquivo | Namespace(s) atribuído(s) | Contexto | Camada | Linhas | Depende de (arquivos) | Storage | Rede | DOM |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const f of files) { const m = res.modules.get(f) || {}, x = fact(f); s += `| \`${f}\` | ${esc(ownedNs(f).join(', ') || '—')} | ${m.context || '**não classificado**'} | ${m.layer || '—'} | ${x.lines} | ${(res.graph.get(f) || new Map()).size} | ${x.storage.length ? 'sim' : ''} | ${x.network.length ? 'sim' : ''} | ${x.dom.length ? 'sim' : ''} |\n`; }
  s += '\n## Backend (`plat/backend`)\n\nNode + PostgreSQL, monolito modular: `src/modules/{analysis, assets, availability, commercial, developments, iam, imports, lots, pricing-history, share, tenancy}` sobre `src/shared/{config, contracts, db, domain, http, logging, validation}`; migrations `001`–`009` com scripts `down`; contrato OpenAPI 1.3.0 (`backend/docs/openapi.json`). Os testes de banco não rodam neste ambiente (sem senha do Postgres).\n';
  write('CURRENT_ARCHITECTURE_INVENTORY.md', s);
}
// ---------------------------------------------------------------- domain module map
{
  const ctx = {}; for (const [f, m] of res.modules) (ctx[m.context] = ctx[m.context] || []).push({ f, layer: m.layer });
  let s = HEAD('Mapa de módulos por bounded context', '`config/governance/architecture.json`');
  s += 'Cada bounded context agrupa os módulos que são donos de um conceito. Um contexto pode ter módulos em várias camadas (domínio puro, aplicação, infraestrutura, apresentação).\n\n| Contexto | Domínio | Aplicação | Infraestrutura | Apresentação/composição | Outros |\n|---|---|---|---|---|---|\n';
  for (const k of Object.keys(ctx).sort()) { const by = l => ctx[k].filter(x => (Array.isArray(l) ? l : [l]).includes(x.layer)).map(x => '`' + x.f + '`').join('<br>'); s += `| **${k}** | ${by('domain')} | ${by('application')} | ${by('infrastructure')} | ${by(['presentation', 'composition'])} | ${by(['kernel', 'config', 'shared', 'worker', 'governance'])} |\n`; }
  write('DOMAIN_MODULE_MAP.md', s);
}
// ---------------------------------------------------------------- dependency matrix
{
  const mx = A.matrix(res);
  let s = HEAD('Matriz de dependências entre módulos', 'o grafo real de referências `App.*` (`tests/architecture52.test.js`)');
  s += '## Regras por camada\n\n| Camada | Pode depender de | Sem DOM | Sem storage | Sem rede | Sem mutar Lote |\n|---|---|---|---|---|---|\n';
  for (const [k, l] of Object.entries(manifest.layers)) s += `| ${k} | ${(l.mayDependOn || []).join(', ') || '—'} | ${l.noDom ? 'sim' : ''} | ${l.noStorage ? 'sim' : ''} | ${l.noNetwork ? 'sim' : ''} | ${l.noDomainMutation ? 'sim' : ''} |\n`;
  s += '\n## Dependências proibidas entre contextos\n\n| De | Para | Motivo |\n|---|---|---|\n' + manifest.forbiddenContextDependencies.map(f => `| ${f.from} | ${f.to} | ${esc(f.reason)} |`).join('\n') + '\n\n';
  s += '## Matriz contexto × contexto (número de arquivos que referenciam; views e composition root excluídos)\n\nLinha = contexto que depende; coluna = contexto usado.\n\n| | ' + mx.contexts.join(' | ') + ' |\n|' + '---|'.repeat(mx.contexts.length + 1) + '\n';
  for (const a of mx.contexts) s += `| **${a}** | ` + mx.contexts.map(b => a === b ? '·' : (mx.cell(a, b) || '')).join(' | ') + ' |\n';
  s += '\n## Ciclos lógicos\n\n' + (res.cycles.length ? res.cycles.map(c => `- ${c.join(' ↔ ')}`).join('\n') : 'Nenhum.') + '\n\nCiclos são avisos: quebrá-los com eventos de domínio, orquestração na camada de aplicação ou interfaces de leitura (ver `ARCHITECTURE_GAP_REPORT.md`).\n\n';
  s += `## Achados atuais (${res.findings.length}; ${rat.blocking.length} novos, ${rat.known.length} registrados, ${rat.warnings.length} avisos)\n\n| Regra | Arquivo | Detalhe | Gap |\n|---|---|---|---|\n`;
  for (const f of res.findings) s += `| ${f.rule} | \`${f.file}\`${f.line ? ':' + f.line : ''} | ${esc(f.detail)} | ${gapOf.get(A.keyOf(f)) || (f.severity === 'WARNING' ? 'aviso' : '**NOVO**')} |\n`;
  write('MODULE_DEPENDENCY_MATRIX.md', s);
}
// ---------------------------------------------------------------- capability matrix
const REG = G.cfg('capabilities');
{
  let s = HEAD('Matriz de preservação de capacidades', '`config/governance/capabilities.json` (CapabilityPreservationRegistry)');
  s += 'Prioridade: P0 não pode regredir (bloqueia release) · P1 importante (revisão obrigatória) · P2 útil · P3 opcional/legado.\n\n| ID | Capacidade | Prioridade | Nível | Onde está hoje | Destino | Golden / testes | Modo de migração | Status |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const r of C.matrixRows(REG)) s += `| ${r.id} | ${esc(r.name)} | ${r.priority} | ${r.level} | ${esc(r.current)} | ${esc(r.target)} | ${esc(r.golden)} | ${r.mode} | ${r.status} |\n`;
  s += '\n## Mudanças permitidas e regressões proibidas\n\n';
  for (const c of REG.capabilities) s += `### ${c.capabilityId} — ${c.name}\n\n- Hoje: ${c.currentBehavior}\n- Por que vale: ${c.valueReason || '—'}\n- Pode mudar: ${c.allowedImplementationChanges.join('; ') || '—'}\n- Não pode regredir: ${c.forbiddenRegressions.join('; ')}\n- Métricas: ${c.metrics.join('; ') || '—'}\n- Classificação do legado: ${c.legacyClassification}\n\n`;
  write('CAPABILITY_PRESERVATION_MATRIX.md', s);
}
// ---------------------------------------------------------------- golden matrix + data parity
{
  const base = JSON.parse(fs.readFileSync(path.join(G.ROOT, 'tests', 'golden', 'baseline.json'), 'utf8'));
  const spec = G.cfg('golden'), cat = c => JSON.parse(fs.readFileSync(path.join(G.ROOT, 'tests', 'golden', c + '.golden.json'), 'utf8'));
  const what = { dataset: 'contagens, blocos, hashes sha256 canônicos dos arquivos de dados, versões do manifest, Field Registry (chaves), contagem por status/classe', lots: 'um registro por lote (498): identidade, geometria (área, frente, fundos, laterais, forma, esquina, bbox, hash do polígono), localização, vizinhança, mobilidade, orientação/sol/ruído/privacidade, preço, R$/m², entrada, planos, status, scores, classe, notas, rankings, alertas (tipo:severidade e texto), destaques, status de proveniência, hash do lote inteiro', map: 'bundle de geometria (contagem, checksums de origem e render, limites), hit-test no ponto de rótulo de cada lote (deve cair no próprio lote), âncoras dos lotes representativos', layers: 'para cada camada (e cada score): lotes por cor, contagem por cor, cobertura e itens da legenda', filters: `${spec.filterScenarios.length} cenários de filtro: contagem, hash da query, filtros descartados e códigos casados`, recommendations: 'presets legados (top 10 + relevância + contagem comercial), motor de recomendação nos dados reais (0 recomendados: tudo UNKNOWN) e num cenário sintético AVAILABLE (só teste), Fit top 10', finance: 'simulação de 4 cenários × todos os planos da tabela: entrada, financiado, parcela principal, anuais, total, fluxo anual', solar: 'para 21 lotes representativos × 3 estações: nascer/pôr, intervalos frente/fundos e momento às 8/12/16 h', quickview: 'fatos essenciais do QuickView (identidade, status, preço, métricas, inteligência, destaques, alertas, fatos, proveniência, capacidades) nos modos corretor e cliente; ações e layout ficam de fora', share: 'texto do resumo/WhatsApp, avisos e link wa.me para 3 conjuntos × 2 modos', comparison: 'colunas, linhas primárias, grupos e vencedores por critério para 2 conjuntos × 2 modos', search: `${spec.searchQueries.length} consultas de busca: tipo de resultado e códigos`, texts: 'rótulos-chave: status de disponibilidade, status do dado, formatos de moeda/área, rodapé do resumo' };
  let s = HEAD('Matriz de testes golden', '`config/governance/golden.json` e `tests/golden/baseline.json`');
  s += `Baseline \`${base.baselineId}\`, empreendimento \`${base.developmentId}\`, ${base.lotCount} lotes, relógio fixo ${base.fixedClock}, dataset \`${base.datasetVersion}\`. Teste: \`tests/preservation54.test.js\` (qualquer diferença falha, salvo ParityException aprovada).\n\n| Categoria (golden test category) | O que é capturado | Entradas | Fingerprint sha256 |\n|---|---|---|---|\n`;
  for (const c of Object.keys(base.categoryFingerprints)) s += `| ${c} | ${esc(what[c] || '')} | ${Object.keys(cat(c)).length} | \`${base.categoryFingerprints[c].slice(0, 16)}…\` |\n`;
  s += '\n## Lotes representativos\n\n| Código | Por quê |\n|---|---|\n' + spec.representativeLots.map(r => `| ${r.code} | ${esc(r.why)} |`).join('\n') + '\n\n## Cenários de filtro\n\n| Cenário | Estado do filtro | Lotes |\n|---|---|---|\n';
  const fl = cat('filters'); s += spec.filterScenarios.map(f => `| ${f.id} | \`${esc(JSON.stringify(f.state))}\` | ${fl[f.id].count} |`).join('\n') + '\n';
  write('GOLDEN_TEST_MATRIX.md', s);
  const d = cat('dataset');
  let p = HEAD('Relatório de paridade de dados (DATA_PARITY_REPORT)', '`tests/golden/dataset.golden.json` e `lots.golden.json`');
  p += `Estado em ${base.createdAt}: baseline gravado. Toda migração (JSON → API, renderer, motor) compara contra estes valores; diferença = falha do \`preservation54.test.js\`.\n\n| Item | Valor no baseline |\n|---|---|\n| Lotes | ${d.lotCount} (IDs únicos: ${d.uniqueIds}) |\n| Quadras | ${d.blocks.length} (${d.blocks.join(', ')}) |\n| Campos do Field Registry | ${d.fieldRegistry.count} (hash \`${d.fieldRegistry.fingerprint.slice(0, 16)}…\`) |\n| Status de disponibilidade | ${Object.entries(d.availabilityStatusCounts).map(([k, v]) => `${k}: ${v}`).join(', ')} |\n| Classes | ${Object.entries(d.classCounts).map(([k, v]) => `${k}: ${v}`).join(', ')} |\n| R$/m² | ${d.pricePerM2Values.join(', ')} (tabela ${d.priceTableVersions.join(', ')}) |\n| Lotes sem preço | ${d.nullPriceCount} |\n| Versões publicadas | static ${d.manifest.staticVersion} · análise ${d.manifest.analysisVersion} · tabela ${d.manifest.priceTableVersion} |\n| Checksums FNV do manifest | static ${d.manifest.checksums.static} · analysis ${d.manifest.checksums.analysis} |\n\n## Hashes dos arquivos de dados (JSON canônico, sha256)\n\n| Arquivo | sha256 |\n|---|---|\n` + Object.entries(d.fileFingerprints).map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n') + '\n\n## Preservação de campos (FieldPreservationReport)\n\nAs chaves do Field Registry ficam no golden (`dataset.fieldRegistry.keys`). Remover ou renomear um campo faz o teste falhar; a remoção exige justificativa em `LEGACY_PARITY_EXCEPTIONS.md`.\n\n## Diferenças aprovadas\n\nNenhuma (`parityExceptions` vazio).\n';
  write('DATA_PARITY_REPORT.md', p);
}
// ---------------------------------------------------------------- roadmap
const RM = G.cfg('roadmap');
{
  const ws = R.waveStatus(RM), m = R.maturity(RM);
  let s = HEAD('Grafo de dependências do roadmap', '`config/governance/roadmap.json`');
  s += 'Setas cheias = dependência HARD; tracejadas = VALIDATION (pode implementar, não pode cortar antes da outra validar). Dependências SOFT/OPTIONAL ficam só nos dados. Cores: verde DONE, azul VALIDATING, amarelo IN_PROGRESS, vermelho BLOCKED, cinza READY, branco NOT_STARTED.\n\n```mermaid\n' + R.mermaid(RM) + '\n```\n\n';
  s += '## Situação por onda\n\n| Onda | Nome | Fases | DONE | VALIDATING | IN_PROGRESS | BLOCKED | READY | NOT_STARTED |\n|---|---|---|---|---|---|---|---|---|\n' + ws.map(w => `| ${w.waveId} | ${w.name} | ${w.phases} | ${w.DONE} | ${w.VALIDATING} | ${w.IN_PROGRESS} | ${w.BLOCKED} | ${w.READY} | ${w.NOT_STARTED} |`).join('\n');
  s += `\n\nMaturidade atual (tópico 55 §317): **${m.level} — ${m.name}**. ${m.detail.map(x => `${x.level} ${x.doneOrValidating}/${x.phases}`).join(' · ')}.\n\nPróximas fases acionáveis (dependências HARD DONE/VALIDATING): ${R.nextActionable(RM).join(', ')}.\n\nOrdem topológica: ${R.order(RM).join(' → ')}.\n\n## Todas as dependências\n\n| De | Para | Tipo | Motivo |\n|---|---|---|---|\n` + RM.dependencies.map(d => `| ${d.fromPhaseId} | ${d.toPhaseId} | ${d.type} | ${esc(d.reason)} |`).join('\n') + '\n';
  write('ROADMAP_DEPENDENCY_GRAPH.md', s);
  const topicPhases = t => RM.phases.filter(p => p.topics.includes(t)).map(p => p.phaseId).join(', ');
  let q = HEAD('Definições das fases do roadmap', '`config/governance/roadmap.json` (RoadmapPhaseDefinition)');
  for (const w of RM.waves) {
    q += `## ${w.waveId} — ${w.name}\n\n`;
    for (const p of RM.phases.filter(x => x.waveId === w.waveId)) {
      const deps = RM.dependencies.filter(d => d.toPhaseId === p.phaseId).map(d => `${d.fromPhaseId} (${d.type})`).join(', ') || '—';
      q += `### ${p.phaseId} ${p.name} — **${p.status}**\n\n- Tópicos: ${p.topics.join(', ')}\n- Objetivo: ${p.objective}\n- Pré-requisitos: ${deps}\n- Entregáveis/evidência: ${[...p.deliverables, ...p.evidence].join('; ') || '—'}\n- Pendente: ${p.pending.join('; ') || '—'}\n- Bloqueios (decisões): ${p.blockers.join(', ') || '—'}\n- Quality gates: ${p.qualityGates.join(', ')}\n- Critério de saída: ${p.exitCriteria.join('; ') || 'quality gates verdes + paridade registrada'}\n- Rollback: ${p.rollbackStrategy}\n- Trilha: ${p.workstream}\n\n`;
    }
  }
  q += '## Tópicos 1–56 → fases\n\n| Tópico | Título | Fases |\n|---|---|---|\n' + Object.entries(RM.topics).map(([t, n]) => `| ${t} | ${esc(n)}${RM.specMissing.includes(Number(t)) ? ' ⚠' : ''} | ${topicPhases(Number(t))} |`).join('\n') + '\n\n⚠ = especificação não recebida neste projeto.\n';
  write('ROADMAP_PHASE_DEFINITIONS.md', q);
}
