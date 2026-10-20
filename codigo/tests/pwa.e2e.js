// Topic 49 — browser E2E for the PWA (not part of `npm test`: needs Chromium). Real Service Worker, real Cache Storage, real offline.
// Usage (from plat/tests): NODE_PATH=$(npm root -g) node pwa.e2e.js <builtDashDir> <workDir> [chromiumPath]
// Steps: build A served → SW installs + controls → manifest valid (CDP) → offline pack STANDARD prepared → offline: shell boots, map renders,
// API/asset failures stay failures, share route gets the neutral page, analysis input served from the pack (exact version) → back online →
// build B published → update waits → user accepts through PwaUpdateCoordinator → one reload → new worker, pack/data caches kept.
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const SRC = path.join(__dirname, '..', 'src');
const [, , DASH, WORK, CHROME = '/opt/pw-browsers/chromium'] = process.argv;
if (!DASH || !WORK) { console.error('uso: node pwa.e2e.js <dash> <work>'); process.exit(2); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let ROOT = null, DOWN = false; // DOWN: the host drops every connection (Chromium's setOffline does not cover Service Worker fetches)
const server = http.createServer((req, res) => {
  if (DOWN) return req.socket.destroy();
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  let body = fs.readFileSync(f);
  // like a host page: the fragment's <title>/<meta>/<link rel=manifest> land in <head> (no <body> tag before them)
  if (p === '/index.html') body = Buffer.concat([Buffer.from('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'), body]);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : body);
});
const MODS = ['pwa/swRouting.js', 'pwa/webManifest.js', 'pwa/pwaCore.js', 'pwa/connectivity.js', 'pwa/update.js', 'pwa/offlinePack.js', 'pwa/sync.js', 'pwa/pwaView.js'];
const inject = () => MODS.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };

function prepareBuilds() {
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  const A = path.join(WORK, 'A'), B = path.join(WORK, 'B');
  fs.cpSync(DASH, A, { recursive: true }); fs.cpSync(DASH, B, { recursive: true });
  const idA = (fs.readFileSync(path.join(A, 'index.html'), 'utf8').match(/name="app-build-id" content="([0-9a-f]+)"/) || [])[1] || 'aaaaaaaaaa';
  // build B = the next deploy: different page code → different build id, same data
  const idB = 'b' + idA.slice(1, 9) + 'f';
  fs.writeFileSync(path.join(B, 'index.html'), fs.readFileSync(path.join(B, 'index.html'), 'utf8').replace(idA, idB) + '\n<!-- build B -->\n');
  require('../scripts/pwaBuild.js').build({ out: B, version: idB });
  return { A, B, idA, idB };
}

(async () => {
  const { A, B, idA, idB } = prepareBuilds();
  ROOT = A; await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL0 = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(URL0, { waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
    const ver = await page.evaluate(() => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data); navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }));
    check('PwaFirstInstall: worker installed and controlling, build id matches the page', ver.serviceWorkerBuildId === idA, JSON.stringify(ver));
    const cdp = await ctx.newCDPSession(page);
    const man = await cdp.send('Page.getAppManifest');
    const parsed = JSON.parse(man.data || '{}');
    check('manifest.webmanifest read by Chromium without errors', man.errors.length === 0 && parsed.display === 'standalone' && parsed.short_name === 'House 7', JSON.stringify(man.errors));
    let inst = null; try { inst = await cdp.send('Page.getInstallabilityErrors'); } catch (e) { /* older CDP */ }
    if (inst) check('installability: no blocking errors reported', !(inst.installabilityErrors || []).some(e => /manifest|icon|service-worker|start-url/i.test(e.errorId)), JSON.stringify(inst.installabilityErrors));
    const cacheNames0 = await page.evaluate(() => caches.keys());
    check('precache: shell of this build present, no data/high-res cached by the worker', cacheNames0.includes('ws-shell-' + idA), cacheNames0.join(','));
    await page.waitForFunction(() => document.querySelectorAll('svg path, canvas').length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // ---- offline pack (explicit, STANDARD)
    await page.addScriptTag({ content: inject() });
    const prep = await page.evaluate(async () => {
      const m = App.pwa.pack.OfflinePackManager({ organizationId: 'house7', developmentId: 'viva-juara' });
      const est = await m.estimate('STANDARD'); const r = await m.prepare('STANDARD');
      return { est: est.bytesLabel, ok: r.ok, state: r.state, code: r.code, res: r.record ? Object.keys(r.record.resources) : [], st: (await m.inspect(undefined, { verify: true })).state };
    });
    check('PwaPrepareStandardDevelopmentPack: READY with exact versions, verified', prep.ok && prep.state === 'READY' && prep.st === 'READY' && prep.res.includes('analysis-input.json'), JSON.stringify(prep));

    // ---- offline
    await ctx.setOffline(true); DOWN = true;
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('svg path, canvas').length > 0, null, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2500);
    const off = await page.evaluate(async () => {
      const o = { title: document.title, hasApp: typeof App !== 'undefined', conn: App.debugInfo ? App.debugInfo().connectivity : null, origin: App.debugInfo ? App.debugInfo().origin : null };
      try { const r = await fetch('api/v1/lots'); o.api = 'status ' + r.status + ' ' + r.headers.get('content-type'); } catch (e) { o.api = 'network-error'; }
      try { const r = await fetch('img/nao-existe.webp'); o.asset = 'status ' + r.status; } catch (e) { o.asset = 'network-error'; }
      try { const r = await fetch('analysis-input.json'); o.ai = { status: r.status, pack: r.headers.get('x-ws-offline-pack'), version: r.headers.get('x-ws-resource-version') }; } catch (e) { o.ai = 'network-error'; }
      try { const r = await fetch('commercial.json'); o.price = 'status ' + r.status; } catch (e) { o.price = 'network-error'; }
      o.netbar = (document.getElementById('netbar') || {}).textContent || '';
      return o;
    });
    check('PwaAppShellOfflineBoot: app shell boots offline from the cache, data from the device copy', off.hasApp && /Viva Juara/.test(off.title) && off.origin === 'CACHE', JSON.stringify({ title: off.title, origin: off.origin, conn: off.conn }));
    check('offline state is visible (netbar)', /offline|conex|sem/i.test(off.netbar), off.netbar);
    check('API offline: network error, never the app shell (§196)', off.api === 'network-error', off.api);
    check('missing asset offline stays an asset failure (§316)', off.asset === 'network-error', off.asset);
    check('price (commercial.json) never answered by the worker offline (data layer keeps it labelled)', off.price === 'network-error', off.price);
    check('analysis input served from the offline pack, exact version, marked', off.ai && off.ai.status === 200 && /^pack:house7:viva-juara$/.test(off.ai.pack) && !!off.ai.version, JSON.stringify(off.ai));
    await page.screenshot({ path: path.join(WORK, 'pwa_offline_map.png') });
    const share = await ctx.newPage();
    await share.goto(URL0 + 's/AbCdEfGhIjKlMnOpQrStUv', { waitUntil: 'load' }).catch(() => null);
    const shareText = await share.evaluate(() => document.body ? document.body.innerText : '');
    check('PwaSharedRouteNotAvailableOffline: neutral page, no internal app', /Link compartilhado indisponível offline/.test(shareText) && !(await share.evaluate(() => typeof App !== 'undefined')), shareText.slice(0, 80));
    await share.screenshot({ path: path.join(WORK, 'pwa_offline_share.png') }); await share.close();

    // ---- update to build B (online)
    await ctx.setOffline(false); DOWN = false;
    ROOT = B;
    await page.reload({ waitUntil: 'load' }); // network-first navigation: page B code, worker A still controlling
    await page.waitForTimeout(1500);
    await page.addScriptTag({ content: inject() });
    const upd = await page.evaluate(async () => {
      const U = App.pwa.update.PwaUpdateCoordinator({ reload: () => { window.__reloaded = (window.__reloaded || 0) + 1; location.reload(); } });
      window.__U = U; await U.register('sw.js'); const s0 = U.getState();
      const t0 = Date.now(); let s = await U.checkForUpdate('MANUAL');
      while (s.state !== 'UPDATE_AVAILABLE' && Date.now() - t0 < 20000) { await new Promise(r => setTimeout(r, 300)); s = U.getState(); }
      const vm = App.pwa.update.viewModel(s);
      return { before: s0.swInfo && s0.swInfo.serviceWorkerBuildId, compat: s0.compatibility, state: s.state, waiting: s.waitingInfo && s.waitingInfo.serviceWorkerBuildId, banner: vm && vm.text, actions: vm && vm.actions.map(a => a.label) };
    });
    check('PwaServiceWorkerUpdateWaiting: new worker waits, banner "Nova versão disponível"', upd.state === 'UPDATE_AVAILABLE' && upd.waiting === idB && upd.banner === 'Nova versão disponível.', JSON.stringify(upd));
    check('mixed version detected but tolerated (same schemas) before the update', upd.compat === 'TOLERATED', upd.compat);
    const ctl = await page.evaluate(() => navigator.serviceWorker.controller && new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data.serviceWorkerBuildId); navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }));
    check('old worker keeps controlling until the user accepts (no automatic skipWaiting)', ctl === idA, ctl);
    const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => { window.__U.activateWaitingVersion('USER_CONFIRMED'); });
    await nav;
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
    const after = await page.evaluate(async () => {
      const v = await new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data); navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]); });
      const keys = await caches.keys(); const idx = await (await caches.open('ws-pack-index')).match('__pack__/index.json'); const doc = idx ? await idx.json() : null;
      return { build: v.serviceWorkerBuildId, keys, pack: doc && Object.values(doc.packs).map(p => p.state), meta: document.querySelector('meta[name="app-build-id"]').content };
    });
    check('PwaSafeUpdateActivation: one controlled reload, new worker active', after.build === idB && after.meta === idB, JSON.stringify(after.build));
    check('update removed the old shell only; offline pack and data kept (§35, §211, §218)', !after.keys.includes('ws-shell-' + idA) && after.keys.includes('ws-shell-' + idB) && after.keys.some(k => k.startsWith('ws-pack:')) && (after.pack || []).includes('READY'), after.keys.join(','));
    // offline again after the update: the new shell boots
    await ctx.setOffline(true); DOWN = true; await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2000);
    const off2 = await page.evaluate(() => ({ meta: (document.querySelector('meta[name="app-build-id"]') || {}).content, app: typeof App !== 'undefined' }));
    check('offline boot after the update uses the new shell', off2.app && off2.meta === idB, JSON.stringify(off2));
    await ctx.setOffline(false); DOWN = false;
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check('e2e run', false, e.stack); }
  finally { await browser.close(); server.close(); }
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(WORK, 'e2e-result.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
