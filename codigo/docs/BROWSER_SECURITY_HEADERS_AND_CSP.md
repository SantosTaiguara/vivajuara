# Headers de segurança e CSP do navegador

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Política (config/security/browserPolicy.json)
```
default-src 'none'; script-src 'self' 'sha256-<script inline>'; style-src-elem 'self' https://fonts.googleapis.com 'sha256-<style inline>';
style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src https://fonts.gstatic.com; connect-src 'self' [apiBaseUrl];
worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
```
Sem `'unsafe-eval'`; sem `'unsafe-inline'` em scripts (o único `<script>` do artefato é liberado por hash, calculado no build). `style-src-attr 'unsafe-inline'`
é necessário porque as views usam `style="left:…"`/variáveis CSS inline (não executa script). Trusted Types: avaliar depois (todas as views usam innerHTML).

## Viabilidade — verificada
Servidor de teste com a política em **header** e em **meta**: painel completo (mapa 498 lotes, ficha, detalhes, Service Worker, fontes) **sem nenhuma violação**.
Com o estado envenenado da auditoria (11 vetores de XSS armazenado), nenhum handler executou: `script-src-attr` bloqueia `onerror=`.
Isto vale também antes do patch P1.

## O que o host estático precisa
- Enviar os headers de `node scripts/securityHeaders.js` (`--write` gera `dash/_headers`, formato Netlify/Cloudflare Pages): CSP, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, HSTS (quando o domínio estiver pronto),
  `sw.js` com `Cache-Control: no-cache`.
- **Meta CSP**: só funciona dentro de `<head>`; o host de artefatos embrulha o arquivo em `<body>` (ver `serve.js`), onde a meta é ignorada, e `frame-ancestors`/`report-uri`
  nunca valem em meta. Por isso a política é aplicada por header (decisão D50-2: host próprio ou host atual). `--meta` imprime a variante para referência.
- A CSP muda a cada build (hash). Rode `securityHeaders.js --write` depois de `build.js` (passo de deploy) e `--check` no CI.

## Terceiros
Único: Google Fonts (`fonts.googleapis.com` CSS, `fonts.gstatic.com` arquivos) — recebem IP/User-Agent (sem Referer). D50-3: auto-hospedar as fontes e remover os dois
de `style-src-elem`/`font-src`. Nenhum analytics/SDK de terceiro; WhatsApp só como link do usuário (`https://wa.me/?text=` + encodeURIComponent).

## Clickjacking / embed
App interno: `frame-ancestors 'none'`. Embed de share futuro terá política própria (`headers.share`).
