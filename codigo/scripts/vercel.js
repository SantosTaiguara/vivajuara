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
  // Sem um comando de build a Vercel ignora outputDirectory e serve a raiz (404).
  buildCommand: 'echo "painel ja compilado em dash/"',
  installCommand: 'echo "sem dependencias"',
  outputDirectory: 'dash',
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
