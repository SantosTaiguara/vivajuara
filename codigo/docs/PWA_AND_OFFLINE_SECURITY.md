# Segurança do PWA e do modo offline

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Auditoria (Service Worker reescrito pelo tópico 49: `src/pwa/swRouting.js` + `sw.template.js`)
- O SW cacheia só o mesmo origin e só GET. Não cacheia rotas de API autenticadas nem respostas com `Authorization` ou `no-store` (`classify`/`storable` testados em `security50.test.js`).
- `postMessage`: o SW aceita apenas `{type:'SKIP_WAITING'}`. Mensagens via BroadcastChannel são sanitizadas. Não existe `eval`/`new Function` no código do app (scanner).
- Escopo `./`. `sw.js` deve ser servido com `Cache-Control: no-cache` (o `_headers` gerado já faz isso).

## Regras
1. Nenhum token, segredo ou dado sensível de cliente em Cache Storage, IndexedDB ou `localStorage` (`auditStorage` + `browserPolicy.json.storage.allowedKeyPatterns`).
2. Logout (`logoutPlan`): apagar caches privados, estado da sessão e filas de sync, e avisar outras abas.
3. BFCache: `onPageShow(event)` → se `persisted` e a sessão expirou, recarregar/limpar a tela (recipe para app.js).
4. Revogação de acesso offline → `OFFLINE_ACCESS_REVOKED` na reconexão.

## Exceção conhecida (D50-1)
Os nomes de clientes (PII) ficam em `localStorage` (`prefs.customers[].name`, decisão aberta desde o tópico 39). `auditStorage` os marca como `knownExceptions`. O scrub tipa os valores restaurados, mas não apaga os nomes.
