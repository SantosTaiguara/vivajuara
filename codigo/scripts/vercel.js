#!/usr/bin/env node
'use strict';
// Gera o vercel.json da raiz do repositório a partir de dash/_headers.
// A Vercel publica a pasta dash/ como site estático, sem build.
//   node scripts/vercel.js [--host www.condominiovivajuara.com.br]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DASH = path.join(ROOT, 'dash');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const HOST = arg('--host', 'www.condominiovivajuara.com.br');
const APEX = HOST.replace(/^www\./, '');

function parseHeaders(text) {
  const rules = []; let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), headers: [] }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    cur.headers.push({ key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
  }
  return rules;
}

// Na Vercel, quando duas regras definem o mesmo cabeçalho, vale a última.
const SOURCE = { '/': '/(.*)', '/*.json': '/(.*)\\.json', '/sw.js': '/sw.js', '/index.html': '/index.html', '/admin.html': '/admin.html' };
// Recalcula dash/_headers antes: os hashes do CSP mudam a cada build e, velhos, bloqueiam o script do painel.
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'securityHeaders.js'), '--write'], { stdio: 'inherit' });
const rules = parseHeaders(fs.readFileSync(path.join(DASH, '_headers'), 'utf8'));
if (!rules.find(r => r.path === '/')) throw new Error('dash/_headers sem a regra "/"');
const headers = rules.map(r => {
  if (!SOURCE[r.path]) throw new Error(`regra sem tradução para a Vercel: ${r.path}`);
  return { source: SOURCE[r.path], headers: r.headers };
});
headers.push({ source: '/chunks/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] });

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  // Copia dash/ para public/ procurando a pasta a partir da raiz configurada na Vercel
  // (funciona com Root Directory vazio, codigo/ ou codigo/backend). A apresentação vai junto em /apresentacao/.
  buildCommand: 'for d in dash ../dash ../../dash; do if [ -f "$d/index.html" ]; then rm -rf public && mkdir public && cp -R "$d"/. public/ && rm -f public/_headers public/index_v1.html && r=$(dirname "$d") && if [ -d "$r/apresentacao" ]; then cp -R "$r/apresentacao" public/apresentacao; fi && echo "painel copiado de $d" && exit 0; fi; done; echo "pasta dash nao encontrada"; exit 1',
  installCommand: 'echo "sem dependencias"',
  outputDirectory: 'public',
  cleanUrls: false,
  trailingSlash: false,
  redirects: [
    { source: '/(.*)', has: [{ type: 'host', value: APEX }], destination: `https://${HOST}/$1`, permanent: true },
    // index_v1.html só existe para o teste de regressão; não é para o público.
    { source: '/index_v1.html', destination: '/', permanent: false },
    { source: '/_headers', destination: '/', permanent: false },
  ],
  headers,
};
fs.writeFileSync(path.join(ROOT, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`vercel.json gerado (${headers.length} regras de cabeçalho, host ${HOST})`);
