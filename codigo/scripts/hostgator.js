#!/usr/bin/env node
'use strict';
// Monta o pacote do painel para hospedagem compartilhada Apache (HostGator, cPanel).
// Converte dash/_headers (formato Netlify) em .htaccess e copia só o que o painel público usa.
//   node scripts/hostgator.js [--out <pasta>] [--host www.condominiovivajuara.com.br]
const fs = require('fs');
const path = require('path');

const DASH = path.resolve(__dirname, '..', '..', 'dash');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const OUT = path.resolve(arg('--out', path.join(__dirname, '..', '..', 'hostgator')));
const HOST = arg('--host', 'www.condominiovivajuara.com.br');

// Fora do pacote: regressão de testes (index_v1.html), console admin (sem servidor ele só mostra
// "Acesso restrito") e o próprio _headers, que o Apache não lê.
const EXCLUDE = new Set(['_headers', 'index_v1.html', 'admin.html', 'lots_v2_backup.json']);

function parseHeaders(text) {
  const rules = []; let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), headers: [] }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

const q = v => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const set = ([k, v]) => `    Header always set ${k} ${q(v)}`;

function htaccess(rules) {
  const byPath = Object.fromEntries(rules.map(r => [r.path, r.headers]));
  const out = [
    '# Gerado por codigo/scripts/hostgator.js a partir de dash/_headers. Não edite à mão.',
    'Options -Indexes',
    'DirectoryIndex index.html',
    'ErrorDocument 404 /offline.html',
    '',
    '<IfModule mod_rewrite.c>',
    '  RewriteEngine On',
    '  RewriteCond %{HTTPS} !=on',
    `  RewriteRule ^ https://${HOST}%{REQUEST_URI} [L,R=301]`,
    `  RewriteCond %{HTTP_HOST} !^${HOST.replace(/\./g, '\\.')}$ [NC]`,
    `  RewriteRule ^ https://${HOST}%{REQUEST_URI} [L,R=301]`,
    '</IfModule>',
    '',
    '<IfModule mod_mime.c>',
    '  AddType image/webp .webp',
    '  AddType application/manifest+json .webmanifest',
    '  AddType application/json .json',
    '  AddType text/javascript .js',
    '</IfModule>',
    '',
    '<IfModule mod_headers.c>',
    ...(byPath['/'] || []).map(set).map(s => s.slice(2)),
    '  <FilesMatch "\\.json$">', ...(byPath['/*.json'] || []).map(set), '  </FilesMatch>',
    '  <Files "sw.js">', ...(byPath['/sw.js'] || []).map(set), '  </Files>',
    '  <FilesMatch "\\.[0-9a-f]{10}\\.(js|css)$">',
    '    Header always set Cache-Control "public, max-age=31536000, immutable"',
    '  </FilesMatch>',
    '</IfModule>',
    '',
  ];
  return out.join('\n');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(e.name) || e.name.startsWith('.') || e.name.includes('.pre_')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Recalcula dash/_headers antes: os hashes do CSP mudam a cada build e, velhos, bloqueiam o script do painel.
require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'securityHeaders.js'), '--write'], { stdio: 'inherit' });
const rules = parseHeaders(fs.readFileSync(path.join(DASH, '_headers'), 'utf8'));
if (!rules.find(r => r.path === '/')) throw new Error('dash/_headers sem a regra "/"');
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(DASH, OUT);
fs.writeFileSync(path.join(OUT, '.htaccess'), htaccess(rules));
console.log(`pacote em ${OUT} (host ${HOST})`);
