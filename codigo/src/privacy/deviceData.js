/* privacy/deviceData.js — topic 59 §203–212, §431–434: what THIS DEVICE keeps (localStorage, IndexedDB, Cache Storage),
   built from the real code (every key literal in plat/src is covered: tests/privacy.test.js fails on a new uncatalogued
   key), plus the local Privacy Center operations: scan (LegacyPrivacyFinding), export (JSON package with checksum) and
   erase (personal data only, or everything). Storage handles are injected (never read for authorization). Erasing never
   touches the server; customer data is not on any server today. Not legal advice. */
App.privacy = App.privacy || {};
App.privacy.device = (() => {
  const fz = o => Object.freeze(o);
  const arr = x => (Array.isArray(x) ? x : []);
  // kind: LOCAL_STORAGE | INDEXED_DB | CACHE_STORAGE ; personal: holds personal data (PERSONAL also when pseudonymous)
  const INVENTORY = fz([
    { id: 'LS_STATE', kind: 'LOCAL_STORAGE', pattern: '^ws:[a-z0-9-]+:state$', example: 'ws:viva-juara:state', source: 'src/state/store.js (keyOf)', holds: 'Preferências de interface + sessão; inclui clientes de trabalho (nome, perfil, orçamento, lotes), filtros e favoritos legados', categories: ['IDENTITY', 'CUSTOMER_PREFERENCE', 'FINANCIAL_DECLARED', 'CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'STRIP_PERSONAL_FIELDS', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'LS_STATE_TENANT', kind: 'LOCAL_STORAGE', pattern: '^ws:org:[^:]+:dev:[^:]+:[a-z]+$', example: 'ws:org:org_house7:dev:viva-juara:state', source: 'src/security/organization.js (storageKey, preparado)', holds: 'Estado por organização (formato futuro)', categories: ['IDENTITY', 'CUSTOMER_PREFERENCE'], personal: true, eraseOnPersonal: 'STRIP_PERSONAL_FIELDS', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'LS_STATE_V2', kind: 'LOCAL_STORAGE', pattern: '^ws-state$', example: 'ws-state', source: 'src/state/store.js (LEGACY_KEY)', holds: 'Estado da versão 2 (pode ter clientes e favoritos)', categories: ['IDENTITY', 'CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'LS_LEGACY_FAVS', kind: 'LOCAL_STORAGE', pattern: '^vj-favs$', example: 'vj-favs', source: 'src/state/store.js, src/favorites/favorites.js (primeiro painel)', holds: 'Favoritos do primeiro painel (ids de lote)', categories: ['CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'LS_LEGACY_UI', kind: 'LOCAL_STORAGE', pattern: '^vj-(ent|sun-s|sun-h|sel|bg2)$', example: 'vj-ent', source: 'src/state/store.js (primeiro painel)', holds: 'Preferências de interface antigas (entrada, sol, lote, fundo)', categories: [], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'LS_DEVICE_ID', kind: 'LOCAL_STORAGE', pattern: '^vj-device-id$', example: 'vj-device-id', source: 'src/presentation/app.js', holds: 'Id pseudônimo do aparelho (namespace dos favoritos; não é identidade)', categories: ['DEVICE_TECHNICAL'], personal: true, eraseOnPersonal: 'KEEP', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'LS_LAYOUT', kind: 'LOCAL_STORAGE', pattern: '^ws:[a-z0-9-]+:layout:[a-z_]+$', example: 'ws:viva-juara:layout:desktop', source: 'src/layout/workspace.js (prefKey)', holds: 'Layout do painel por família de aparelho', categories: [], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'LS_PWA_INSTALL', kind: 'LOCAL_STORAGE', pattern: '^ws-pwa-install$', example: 'ws-pwa-install', source: 'src/pwa/pwaCore.js (INSTALL_POLICY.storageKey)', holds: 'Contador de sessões para sugerir instalação', categories: [], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'LS_FAVORITES_FALLBACK', kind: 'LOCAL_STORAGE', pattern: '^fav:v\\d+:', example: 'fav:v1:org_house7:dev_x:viva-juara', source: 'src/favorites/favorites.js (nsKey, sem IndexedDB)', holds: 'Favoritos por organização + aparelho', categories: ['CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'IDB_FAVORITES', kind: 'INDEXED_DB', pattern: '^ws-favorites$', example: 'ws-favorites', source: 'src/favorites/favorites.js (idbBackend)', holds: 'Favoritos por organização + aparelho (+ contexto de cliente)', categories: ['CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'IDB_ANALYTICS', kind: 'INDEXED_DB', pattern: '^vj-analytics$', example: 'vj-analytics', source: 'src/analytics/client.js (idbPersistence; desligado: persistOffline=false)', holds: 'Fila de eventos de uso pseudônimos (não usada hoje)', categories: ['ANALYTICS_PSEUDONYMOUS'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'PRODUCT_ANALYTICS' },
    { id: 'IDB_SYNC_QUEUE', kind: 'INDEXED_DB', pattern: '^ws-pwa-queue$', example: 'ws-pwa-queue', source: 'src/pwa/sync.js (IdbMutationStore)', holds: 'Fila de alterações offline por organização + usuário (vazia no modo visitante)', categories: ['CUSTOMER_BEHAVIOR'], personal: true, eraseOnPersonal: 'REMOVE', purpose: 'CUSTOMER_RELATIONSHIP' },
    { id: 'IDB_DATA_CACHE', kind: 'INDEXED_DB', pattern: '^ws-cache$', example: 'ws-cache', source: 'src/data/offline.js (DB_NAME)', holds: 'Cópia offline dos dados de lotes (públicos)', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'IDB_CACHE_L2', kind: 'INDEXED_DB', pattern: '^ws-cache-l2$', example: 'ws-cache-l2', source: 'src/cache/cacheManager.js (idbKv)', holds: 'Cache L2 de dados derivados (sem dado pessoal)', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'CS_SHELL', kind: 'CACHE_STORAGE', pattern: '^ws-(shell|img)-', example: 'ws-shell-<build>', source: 'src/pwa/swRouting.js, src/sw.template.js', holds: 'Página e imagens do painel', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'CS_RUNTIME', kind: 'CACHE_STORAGE', pattern: '^ws-runtime-v\\d+$', example: 'ws-runtime-v2', source: 'src/pwa/swRouting.js', holds: 'Respostas públicas em cache', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'CS_PACK', kind: 'CACHE_STORAGE', pattern: '^ws-pack(:|-index$)', example: 'ws-pack:viva-juara', source: 'src/pwa/offlinePack.js (sem notas/cliente: DROP list)', holds: 'Pacote offline do empreendimento', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null },
    { id: 'CS_ASSETS', kind: 'CACHE_STORAGE', pattern: '^ws:[^:]+:assets$', example: 'ws:viva-juara:assets', source: 'src/data/offline.js (assets)', holds: 'Plantas e imagens do empreendimento', categories: ['LOT_DATA'], personal: false, eraseOnPersonal: 'KEEP', purpose: null }
  ].map(fz));
  const PERSONAL_STATE_FIELDS = fz(['customers', 'currentCustomerId', 'preferences', 'constraints', 'objective', 'activePreset', 'favorites', 'recScope']);
  const STORE_PATCH = fz({ customers: [], currentCustomerId: null, preferences: {}, constraints: {}, objective: null, activePreset: null, favorites: [], recScope: null });
  const entryOf = (kind, name) => INVENTORY.find(e => e.kind === kind && new RegExp(e.pattern).test(name)) || null;

  function lsKeys(s) {
    if (!s) return [];
    try { if (typeof s.length === 'number' && typeof s.key === 'function') { const out = []; for (let i = 0; i < s.length; i++) out.push(s.key(i)); return out; } } catch (e) { return []; }
    if (typeof s.keys === 'function') return [...s.keys()];
    return [];
  }
  const read = (s, k) => { try { return s.getItem(k); } catch (e) { return null; } };
  const parse = v => { try { return JSON.parse(v); } catch (e) { return null; } };
  const customersIn = obj => { const p = obj && (obj.prefs || obj.s || obj); return p && Array.isArray(p.customers) ? p.customers : []; };

  /** scan({ localStorage, indexedDBNames, cacheNames }) → { entries, findings (LegacyPrivacyFinding), summary } — names/values never logged */
  function scan(o = {}) {
    const entries = [], findings = [], s = o.localStorage;
    for (const k of lsKeys(s)) {
      const e = entryOf('LOCAL_STORAGE', k), v = read(s, k);
      entries.push(fz({ kind: 'LOCAL_STORAGE', name: k, inventoryId: e ? e.id : null, personal: e ? e.personal : null, sizeBytes: v == null ? 0 : String(v).length }));
      if (!e) findings.push(fz({ location: 'localStorage ' + k, dataCategories: [], issueType: 'UNKNOWN', severity: 'LOW', remediation: 'Chave fora do inventário: classificar.' }));
      if (e && (e.id === 'LS_STATE' || e.id === 'LS_STATE_TENANT' || e.id === 'LS_STATE_V2')) {
        const cs = customersIn(parse(v)), named = cs.filter(c => c && typeof c.name === 'string' && c.name.trim()).length;
        if (named) findings.push(fz({ location: 'localStorage ' + k + ' (customers)', dataCategories: ['IDENTITY', 'CUSTOMER_PREFERENCE'], issueType: 'NO_BASIS_RECORD', severity: 'MEDIUM', remediation: 'Nomes de clientes guardados no aparelho sem base legal validada (LPF_LOCAL_CUSTOMER_NAMES): decisão pendente.', count: named }));
      }
      if (v && App.privacy.core && App.privacy.core.detect(String(v)).some(c => c === 'CPF' || c === 'BEARER' || c === 'JWT')) findings.push(fz({ location: 'localStorage ' + k, dataCategories: ['DOCUMENT_IDENTIFIER'], issueType: 'INSECURE_STORAGE', severity: 'HIGH', remediation: 'Valor de alto risco no navegador: remover (§210).' }));
    }
    for (const n of arr(o.indexedDBNames)) { const e = entryOf('INDEXED_DB', n); entries.push(fz({ kind: 'INDEXED_DB', name: n, inventoryId: e ? e.id : null, personal: e ? e.personal : null })); if (!e) findings.push(fz({ location: 'IndexedDB ' + n, dataCategories: [], issueType: 'UNKNOWN', severity: 'LOW', remediation: 'Banco fora do inventário.' })); }
    for (const n of arr(o.cacheNames)) { const e = entryOf('CACHE_STORAGE', n); entries.push(fz({ kind: 'CACHE_STORAGE', name: n, inventoryId: e ? e.id : null, personal: e ? e.personal : null })); }
    return fz({ entries: fz(entries), findings: fz(findings), summary: fz({ total: entries.length, personal: entries.filter(e => e.personal).length, unknown: entries.filter(e => !e.inventoryId).length }) });
  }

  /** exportLocal({ localStorage, indexedDBNames, now }) → { package, filename } — titular's own device data, structured JSON (§83, §319) */
  function exportLocal(o = {}) {
    const s = o.localStorage, items = [];
    for (const k of lsKeys(s)) { const e = entryOf('LOCAL_STORAGE', k); if (!e || !e.personal) continue; const v = read(s, k); items.push({ storage: 'localStorage', key: k, inventoryId: e.id, holds: e.holds, value: parse(v) ?? v }); }
    for (const n of arr(o.indexedDBNames)) { const e = entryOf('INDEXED_DB', n); if (e && e.personal) items.push({ storage: 'IndexedDB', key: n, inventoryId: e.id, holds: e.holds, value: null, note: 'Conteúdo exportado pelo próprio módulo (ex.: favoritos); aqui só a existência.' }); }
    const t = o.now != null ? new Date(o.now) : new Date();
    const pkg = { kind: 'device-personal-data-export', generatedAt: t.toISOString(), scope: 'THIS_DEVICE', notice: 'Dados guardados neste aparelho pelo painel. Nada foi enviado a servidor.', items };
    const sum = App.integrity && App.integrity.sha256 ? 'sha256:' + App.integrity.sha256(JSON.stringify(pkg)) : null;
    return fz({ package: fz({ ...pkg, checksum: sum }), filename: 'dados-deste-aparelho-' + t.toISOString().slice(0, 10) + '.json' }); // no PII in the file name (§67)
  }

  /** eraseLocal({ localStorage, indexedDB, caches, scope: 'PERSONAL' | 'ALL' }) → { removedKeys, rewrittenKeys, deletedDatabases, deletedCaches, storePatch, errors }
      Apply storePatch to App.store BEFORE its next save (otherwise the in-memory state would be written back). */
  async function eraseLocal(o = {}) {
    const scope = o.scope === 'ALL' ? 'ALL' : 'PERSONAL', s = o.localStorage, out = { scope, removedKeys: [], rewrittenKeys: [], deletedDatabases: [], deletedCaches: [], errors: [] };
    for (const k of lsKeys(s)) {
      const e = entryOf('LOCAL_STORAGE', k);
      try {
        if (scope === 'ALL' && e) { s.removeItem(k); out.removedKeys.push(k); continue; }
        if (!e || !e.personal) continue;
        if (e.eraseOnPersonal === 'REMOVE') { s.removeItem(k); out.removedKeys.push(k); }
        else if (e.eraseOnPersonal === 'STRIP_PERSONAL_FIELDS') {
          const v = parse(read(s, k));
          if (v && typeof v === 'object') { for (const part of ['prefs', 'session', 's']) if (v[part] && typeof v[part] === 'object') for (const f of PERSONAL_STATE_FIELDS) delete v[part][f]; s.setItem(k, JSON.stringify(v)); out.rewrittenKeys.push(k); }
          else { s.removeItem(k); out.removedKeys.push(k); }
        }
      } catch (x) { out.errors.push({ key: k, code: 'STORAGE_UNAVAILABLE' }); }
    }
    const idb = o.indexedDB, names = arr(o.indexedDBNames).length ? arr(o.indexedDBNames) : INVENTORY.filter(e => e.kind === 'INDEXED_DB').map(e => e.example);
    for (const n of names) {
      const e = entryOf('INDEXED_DB', n); if (!e || (scope === 'PERSONAL' && !e.personal)) continue;
      if (!idb || typeof idb.deleteDatabase !== 'function') continue;
      try { await new Promise(res => { const r = idb.deleteDatabase(n); if (!r) return res(); r.onsuccess = r.onerror = r.onblocked = () => res(); }); out.deletedDatabases.push(n); } catch (x) { out.errors.push({ key: n, code: 'IDB_DELETE_FAILED' }); }
    }
    if (scope === 'ALL' && o.caches && typeof o.caches.keys === 'function') {
      try { for (const n of await o.caches.keys()) if (entryOf('CACHE_STORAGE', n)) { await o.caches.delete(n); out.deletedCaches.push(n); } } catch (x) { out.errors.push({ key: 'caches', code: 'CACHE_DELETE_FAILED' }); }
    }
    return fz({ ...out, storePatch: STORE_PATCH, ok: !out.errors.length });
  }

  /** centerVM({ scan, dpo }) → view model of the Privacy Center (no values, only what/where/why) */
  function centerVM(o = {}) {
    const sc = o.scan || scan({}), core = App.privacy.core, dpo = (core && core.config().governance && core.config().governance.dpo) || {};
    const rows = INVENTORY.filter(e => e.personal || sc.entries.some(x => x.inventoryId === e.id)).map(e => fz({ id: e.id, where: e.kind === 'LOCAL_STORAGE' ? 'Navegador (localStorage)' : e.kind === 'INDEXED_DB' ? 'Navegador (IndexedDB)' : 'Navegador (cache)',
      what: e.holds, personal: e.personal, present: sc.entries.some(x => x.inventoryId === e.id), erasedBy: e.personal ? (e.eraseOnPersonal === 'KEEP' ? 'Apagar tudo' : 'Apagar dados pessoais') : 'Apagar tudo' }));
    return fz({ rows: fz(rows), findings: sc.findings, dpo: fz({ configured: !!(dpo.publicDisplayName && dpo.publicContactChannel && dpo.status === 'ACTIVE'), name: dpo.publicDisplayName || null, channel: dpo.publicContactChannel || null }),
      disclaimer: 'Esta central mostra e apaga apenas o que fica neste aparelho. Não é aconselhamento jurídico: bases legais, prazos e o encarregado dependem de validação da organização.' });
  }

  return fz({ INVENTORY, PERSONAL_STATE_FIELDS, STORE_PATCH, entryOf, scan, exportLocal, eraseLocal, centerVM });
})();
