/* governance/architectureConformance.js — topic 52: architecture fitness functions over the REAL modules.
   The platform is a single-file browser app: every module is a plain script attaching to the global App
   (App.compare.domain = …). There are no imports, so the dependency graph is read from the App.<namespace>
   references of each file. This module is pure (strings in, report out): the Node test and the report script
   read the files and the manifest (plat/config/governance/architecture.json) and pass them in.

   What it checks (rule ids are stable; the manifest gives severity and the known-violation baseline):
   - LAYER_DIRECTION     a module only depends on layers its own layer may use (domain → domain/shared/config…)
   - FORBIDDEN_CONTEXT   explicit forbidden context pairs (Availability → Pricing, Lot → Customer, Pricing → UI…)
   - DOMAIN_NO_DOM       domain/application code never touches document/window DOM/navigator/events
   - DOMAIN_NO_STORAGE   domain code never touches localStorage/sessionStorage/indexedDB/Cache Storage
   - NO_NETWORK_OUTSIDE_INFRA  fetch/XMLHttpRequest/sendBeacon/WebSocket only in infrastructure (+ composition root)
   - PRESENTATION_NO_DOMAIN_MUTATION  views never assign into canonical Lot data nor call repository writes
   - RAW_JSON_ONLY_IN_DATA  'lots.json' / 'commercial.json' / 'analysis-input.json' are named only by the data layer
   - NAMESPACE_OWNERSHIP a namespace (App.x / App.x.y) is assigned by exactly one module
   - UNCLASSIFIED_MODULE a file under src/ that the manifest does not place in a context/layer (warning)
   - CONTEXT_CYCLE       cycles in the logical context graph (reported; the manifest decides severity)
   Nothing here hides a violation: evaluate() returns every finding; the known-violation baseline only decides
   which findings are NEW (blocking) and which are already registered debt (ARCHITECTURE_GAP_REPORT.md). */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.governance = App.governance || {};
App.governance.architecture = (() => {
  const VERSION = '1.0.0';

  // ------------------------------------------------------------------ lexer: blank comments and strings, keep strings aside
  /** strip(source) → { code, strings }: comments removed, string/template/regex literal contents blanked (template
   *  ${…} expressions stay as code), so rules never match words inside comments or HTML strings. */
  function strip(src) {
    let out = '', i = 0; const n = src.length, strings = [], stack = []; // stack of template depth markers
    let lastSig = ''; // last significant char of code (for regex detection)
    const REGEX_PREV = '(,=:[!&|?{};+-*%<>~^';
    const isIdent = c => /[A-Za-z0-9_$]/.test(c);
    let lastWord = '';
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } if (src[j] === '\n') break; s += src[j]; j++; }
        strings.push(s); out += c + ' '.repeat(Math.max(0, j - i - 1)) + c; i = j + 1; lastSig = c; lastWord = ''; continue;
      }
      if (c === '`') { i++; out += '`'; stack.push('T'); i = readTemplate(i); continue; }
      if (c === '}' && stack.length && stack[stack.length - 1] === '{') { stack.pop(); out += c; i++; lastSig = c; continue; }
      if (c === '}' && stack.length && stack[stack.length - 1] === '$') { stack.pop(); out += '}'; i++; i = readTemplate(i); continue; }
      if (c === '{' && stack.length) { stack.push('{'); out += c; i++; lastSig = c; continue; }
      if (c === '/' && (lastSig === '' || REGEX_PREV.includes(lastSig) || /^(return|typeof|case|in|of|void|delete|throw|else|do)$/.test(lastWord))) {
        let j = i + 1, inClass = false;
        while (j < n) { const ch = src[j]; if (ch === '\\') { j += 2; continue; } if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) break; else if (ch === '\n') break; j++; }
        out += '/' + ' '.repeat(Math.max(0, j - i - 1)) + '/'; i = j + 1; while (i < n && /[a-z]/.test(src[i])) { out += src[i]; i++; } lastSig = '/'; lastWord = ''; continue;
      }
      out += c; i++;
      if (!/\s/.test(c)) { lastSig = c; if (isIdent(c)) { lastWord = (isIdent(src[i - 2] || '') ? lastWord : '') + c; } else lastWord = ''; }
    }
    return { code: out, strings };
    function readTemplate(k) {
      let s = '';
      while (k < n) {
        const ch = src[k];
        if (ch === '\\') { s += src[k + 1]; out += '  '; k += 2; continue; }
        if (ch === '`') { stack.pop(); out += '`'; strings.push(s); lastSig = '`'; lastWord = ''; return k + 1; }
        if (ch === '$' && src[k + 1] === '{') { strings.push(s); s = ''; out += '${'; stack.push('$'); lastSig = '{'; lastWord = ''; return k + 2; }
        s += ch; out += ch === '\n' ? '\n' : ' '; k++;
      }
      return k;
    }
  }

  // ------------------------------------------------------------------ per-file facts
  const DOM_RX = /(?<![.\w$])(document\s*\.|window\s*\.\s*(?!App\b)(?:addEventListener|removeEventListener|innerWidth|innerHeight|matchMedia|location|history|open|scrollTo|getComputedStyle|requestAnimationFrame|devicePixelRatio)|(?<![.\w$])navigator\s*\.|requestAnimationFrame\s*\(|HTMLElement\b|\.innerHTML\b|\.querySelector(All)?\s*\(|\.addEventListener\s*\(|\.classList\b|\.getBoundingClientRect\s*\()/g;
  const STORAGE_RX = /\b(localStorage|sessionStorage|indexedDB|caches\s*\.)/g;
  const NETWORK_RX = /\b(fetch\s*\(|XMLHttpRequest\b|sendBeacon\s*\(|new\s+WebSocket\b|new\s+EventSource\b)/g;
  const MUTATION_RX = /\b[A-Za-z_$][\w$]*\s*\.\s*(identity|geometry|commercial|availability|intelligence|environmental|location|surroundings|mobility|construction|provenance)\s*\.\s*[A-Za-z_$][\w$.]*\s*(?:[+\-*/]?=(?!=)|\+\+|--)/g;
  const REPO_WRITE_RX = /\.(applyStructuralUpdate|applyAnalyticalUpdate|applyCommercialUpdate|applyAvailabilityUpdate|applyPriceTable|applyAvailabilityFeed)\s*\(/g;
  const RAW_FILES = ['lots.json', 'commercial.json', 'analysis-input.json'];
  // a raw-file REFERENCE is a string literal that is the file path itself (texts that merely mention the file are documentation)
  const RAW_REF_RX = /^(?:\.\/|\/)?(?:[\w-]+\/)*(lots|commercial|analysis-input)\.json(?:\?.*)?$/;
  const ASSIGN_RX = /(?:^|[^.\w$])App((?:\.[A-Za-z_$][\w$]*){1,2})\s*=(?!=)/g;
  const REF_RX = /(?:^|[^.\w$])App((?:\.[A-Za-z_$][\w$]*){1,2})/g;

  const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;
  /** every match, deduplicated by line + text (one finding per construct per line) */
  const all = (rx, code) => { const r = [], seen = new Set(); rx.lastIndex = 0; let m; while ((m = rx.exec(code))) { const x = { text: m[0].trim(), line: lineOf(code, m.index) }, k = x.line + '|' + x.text; if (!seen.has(k)) { seen.add(k); r.push(x); } } return r; };

  /** analyzeSource(file, source) → facts used by the rules (no judgement here) */
  function analyzeSource(file, source) {
    const { code, strings } = strip(source);
    const assigns = all(ASSIGN_RX, code).map(x => ({ ns: x.text.replace(/^[^A]*App\./, '').replace(/\s*=.*$/, '').trim(), line: x.line }));
    const refs = all(REF_RX, code).map(x => ({ path: x.text.replace(/^[^A]*App\./, '').trim(), line: x.line }));
    return {
      file, bytes: source.length, lines: source.split('\n').length,
      assigns, refs,
      dom: all(DOM_RX, code), storage: all(STORAGE_RX, code), network: all(NETWORK_RX, code),
      mutations: all(MUTATION_RX, code), repoWrites: all(REPO_WRITE_RX, code),
      rawFiles: [...new Set(strings.map(s => s.trim()).filter(s => RAW_REF_RX.test(s)))]
    };
  }

  // ------------------------------------------------------------------ manifest helpers
  /** classify(manifest, file) → { context, layer } from the longest matching path prefix (file entries win) */
  function classify(manifest, file) {
    let best = null;
    for (const m of manifest.modules) if (file === m.path || (m.path.endsWith('/') && file.startsWith(m.path))) if (!best || m.path.length > best.path.length) best = m;
    return best ? { context: best.context, layer: best.layer, entry: best } : null;
  }
  /** namespace owners: App.x.y assigned in file F → owner F (first assignment wins; more are NAMESPACE_OWNERSHIP findings) */
  function ownersOf(facts) {
    const owners = new Map(), dups = [];
    for (const f of facts) for (const a of f.assigns) {
      const parts = a.ns.split('.');
      // "App.compare = App.compare || {}" opens a shared namespace container: not an ownership claim
      if (parts.length === 1 && f.containerOpeners && f.containerOpeners.has(a.ns)) continue;
      if (!owners.has(a.ns)) owners.set(a.ns, f.file);
      else if (owners.get(a.ns) !== f.file) dups.push({ ns: a.ns, owner: owners.get(a.ns), file: f.file, line: a.line });
    }
    return { owners, dups };
  }
  const containerOpeners = (source) => { const s = new Set(); const rx = /App\.([A-Za-z_$][\w$]*)\s*=\s*App\.\1\s*\|\|/g; let m; while ((m = rx.exec(source))) s.add(m[1]); return s; };
  /** resolve a reference path (e.g. "services.layers", "repos") to the owner file */
  const ownerOfRef = (owners, p) => { const parts = p.split('.'); if (parts.length > 1 && owners.has(parts[0] + '.' + parts[1])) return owners.get(parts[0] + '.' + parts[1]); return owners.get(parts[0]) || null; };

  // ------------------------------------------------------------------ evaluation
  /** evaluate({ manifest, sources: { 'compare/comparisonDomain.js': '…' } }) → { findings, graph, contextGraph, cycles, modules } */
  function evaluate({ manifest, sources }) {
    const files = Object.keys(sources).sort();
    const facts = files.map(f => { const x = analyzeSource(f, sources[f]); x.containerOpeners = containerOpeners(sources[f]); return x; });
    const byFile = new Map(facts.map(f => [f.file, f]));
    const { owners, dups } = ownersOf(facts);
    const findings = [], add = (rule, file, detail, line) => findings.push({ rule, file, detail, line: line || null, severity: (manifest.rules[rule] || {}).severity || 'ERROR' });
    const modules = new Map();
    for (const f of facts) {
      const c = classify(manifest, f.file);
      if (!c) { add('UNCLASSIFIED_MODULE', f.file, 'arquivo sem contexto/camada no manifesto'); continue; }
      modules.set(f.file, c);
    }
    const layerOf = file => (modules.get(file) || {}).layer, ctxOf = file => (modules.get(file) || {}).context;
    // file dependency graph
    const graph = new Map();
    for (const f of facts) {
      const deps = new Map();
      for (const r of f.refs) { const o = ownerOfRef(owners, r.path); if (o && o !== f.file && !deps.has(o)) deps.set(o, { via: 'App.' + r.path, line: r.line }); }
      graph.set(f.file, deps);
    }
    const L = manifest.layers;
    for (const f of facts) {
      const me = modules.get(f.file); if (!me) continue;
      const lay = L[me.layer] || {};
      const exempt = rule => (me.entry.exemptions || []).includes(rule);
      for (const [dep, info] of graph.get(f.file)) {
        const other = modules.get(dep); if (!other) continue;
        if (!(lay.mayDependOn || []).includes(other.layer) && other.layer !== me.layer && !exempt('LAYER_DIRECTION'))
          add('LAYER_DIRECTION', f.file, `${me.layer} → ${other.layer} (${info.via} em ${dep})`, info.line);
        for (const fb of manifest.forbiddenContextDependencies || []) if (fb.from === me.context && fb.to === other.context && !exempt('FORBIDDEN_CONTEXT'))
          add('FORBIDDEN_CONTEXT', f.file, `${me.context} → ${other.context} (${info.via}): ${fb.reason}`, info.line);
      }
      if (lay.noDom && !exempt('DOMAIN_NO_DOM')) for (const x of f.dom) add('DOMAIN_NO_DOM', f.file, `${me.layer} usa ${x.text}`, x.line);
      if (lay.noStorage && !exempt('DOMAIN_NO_STORAGE')) for (const x of f.storage) add('DOMAIN_NO_STORAGE', f.file, `${me.layer} usa ${x.text}`, x.line);
      if (lay.noNetwork && !exempt('NO_NETWORK_OUTSIDE_INFRA')) for (const x of f.network) add('NO_NETWORK_OUTSIDE_INFRA', f.file, `${me.layer} usa ${x.text}`, x.line);
      if (lay.noDomainMutation && !exempt('PRESENTATION_NO_DOMAIN_MUTATION')) {
        for (const x of f.mutations) add('PRESENTATION_NO_DOMAIN_MUTATION', f.file, `atribuição em dado do Lote: ${x.text}`, x.line);
        for (const x of f.repoWrites) add('PRESENTATION_NO_DOMAIN_MUTATION', f.file, `escrita de repositório na UI: ${x.text}`, x.line);
      }
      if (!lay.mayNameRawFiles && !exempt('RAW_JSON_ONLY_IN_DATA')) for (const r of f.rawFiles) add('RAW_JSON_ONLY_IN_DATA', f.file, `nomeia ${r} fora da camada de dados`);
    }
    for (const d of dups) add('NAMESPACE_OWNERSHIP', d.file, `App.${d.ns} já é atribuído por ${d.owner}`, d.line);
    // context graph + cycles
    const contextGraph = new Map();
    const UI_LAYERS = new Set(manifest.cycleExcludedLayers || ['presentation', 'composition', 'governance']);
    for (const [file, deps] of graph) { const a = ctxOf(file); if (!a || UI_LAYERS.has(layerOf(file))) continue; if (!contextGraph.has(a)) contextGraph.set(a, new Map()); for (const dep of deps.keys()) { const b = ctxOf(dep); if (!b || b === a || UI_LAYERS.has(layerOf(dep))) continue; const m = contextGraph.get(a); m.set(b, (m.get(b) || 0) + 1); } }
    const cycles = scc(contextGraph).filter(c => c.length > 1);
    for (const c of cycles) add('CONTEXT_CYCLE', c.join(' ↔ '), `ciclo lógico entre contextos: ${c.join(', ')}`);
    findings.sort((a, b) => (a.rule + a.file + (a.line || 0)).localeCompare(b.rule + b.file + (b.line || 0)));
    return { version: VERSION, findings, graph, contextGraph, cycles, modules, owners, facts: byFile };
  }

  /** Tarjan SCC → array of components (each sorted) */
  function scc(g) {
    const nodes = new Set([...g.keys()]); for (const m of g.values()) for (const k of m.keys()) nodes.add(k);
    let idx = 0; const index = new Map(), low = new Map(), on = new Set(), st = [], out = [];
    const visit = v => {
      index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
      for (const w of (g.get(v) || new Map()).keys()) { if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w))); }
      if (low.get(v) === index.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); out.push(c.sort()); }
    };
    for (const v of [...nodes].sort()) if (!index.has(v)) visit(v);
    return out;
  }

  /** key of a finding for the known-violation baseline: line numbers are NOT part of it (edits move lines) */
  const keyOf = f => `${f.rule}|${f.file}|${f.detail}`;
  /** ratchet(findings, known) → { blocking, known, fixed, warnings }: a finding is blocking when its rule is ERROR
   *  and it is not registered in the baseline; fixed = registered entries that no longer occur (remove from baseline). */
  function ratchet(findings, knownKeys) {
    const known = new Set(knownKeys || []), seen = new Set();
    const res = { blocking: [], known: [], fixed: [], warnings: [] };
    for (const f of findings) { const k = keyOf(f); seen.add(k); if (known.has(k)) res.known.push(f); else if (f.severity === 'ERROR') res.blocking.push(f); else res.warnings.push(f); }
    res.fixed = [...known].filter(k => !seen.has(k)).sort();
    return res;
  }

  /** dependency matrix (context × context → reference count) for MODULE_DEPENDENCY_MATRIX.md */
  function matrix(result) {
    const ctxs = [...new Set([...result.modules.values()].map(m => m.context))].sort();
    return { contexts: ctxs, cell: (a, b) => (result.contextGraph.get(a) || new Map()).get(b) || 0 };
  }

  /** markdown report of the findings (used by scripts/architectureReport.js) */
  function reportMarkdown(result, rat) {
    const rows = result.findings.map(f => `| ${f.rule} | \`${f.file}\`${f.line ? ':' + f.line : ''} | ${f.severity} | ${String(f.detail).replace(/\|/g, '\\|')} | ${rat && rat.blocking.includes(f) ? 'NOVA' : 'registrada'} |`);
    return ['| Regra | Arquivo | Severidade | Detalhe | Situação |', '|---|---|---|---|---|', ...rows].join('\n');
  }

  return Object.freeze({ VERSION, strip, analyzeSource, classify, evaluate, scc, ratchet, keyOf, matrix, reportMarkdown });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = App.governance.architecture;
