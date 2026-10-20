// Topic 53: prints the compact header markup (navigation/menuView.js headerHtml) that replaces the <header class="hd">…</header>
// block of src/presentation/shell.html. The header stays static in the shell (no flicker while auth/profile load);
// menuView.applyProfile()/update() adjust it at runtime. Usage (from plat/):
//   node scripts/navHeader.js            → prints the markup
//   node scripts/navHeader.js --check    → exit 1 when shell.html has a compact header that differs from the registry
const fs = require('fs'), path = require('path');
const { load, SRC } = require('../tests/harness.js');
const App = load();
for (const f of ['navigation/navigationRegistry.js', 'navigation/navigationService.js', 'navigation/menuView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
const html = App.navigation.view.headerHtml();
if (process.argv.includes('--check')) {
  const shell = fs.readFileSync(path.join(SRC, 'presentation/shell.html'), 'utf8'), m = shell.match(/<header class="hd cnav"[\s\S]*?<\/header>/);
  if (!m) { console.log('shell.html ainda usa o header antigo (tópico 53 não integrado).'); process.exit(0); }
  if (m[0].trim() !== html.trim()) { console.error('O header de shell.html difere do registro de navegação: rode node scripts/navHeader.js e cole o resultado.'); process.exit(1); }
  console.log('header de shell.html = registro de navegação'); process.exit(0);
}
process.stdout.write(html + '\n');
