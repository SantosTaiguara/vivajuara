# Sessões e tokens

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Tipos (nunca reutilizar um no papel de outro) — `config/security/tokenTypes.json`
SESSION_TOKEN (cookie HttpOnly, planejado) · ACCESS_TOKEN / REFRESH_TOKEN (só servidor↔IdP, planejado) · ADMIN_API_TOKEN (ativo) · DEV_TOKEN (só dev/teste) ·
SHARE_TOKEN (path `/s/<token>`, servidor guarda HMAC) · SIGNED_ASSET_TOKEN (≤ 5 min, planejado) · CSRF_TOKEN (planejado, com cookie) ·
IDEMPOTENCY_KEY (ativo) · WEBHOOK_SIGNATURE (planejado).

## Sessão de navegador (quando houver IdP)
Cookie `__Host-ws_session`: `Secure; HttpOnly; SameSite=Lax; Path=/` (sem `Domain` — sem curinga). ID com ≥ 128 bits do CSPRNG; rotação em login,
elevação de privilégio e troca sensível; fixation impossível (id novo após autenticar). Expiração idle 30 min / absoluta 12 h (admin 15 min / 8 h).
"Lembrar-me" = refresh rotativo com detecção de reuso, nunca sessão infinita. `validateSecurityConfig()` falha em produção com cookie sem Secure/HttpOnly ou
SameSite fraco e avisa domínio curinga.

## Token em armazenamento do navegador
**Proibido** token de longa duração em localStorage/sessionStorage (XSS lê storage). Verificado: nenhum módulo escreve token (scanner `TOKEN_IN_WEB_STORAGE` +
teste); `App.authz` nunca lê storage/URL/DOM para identidade; `auditStorage()` acusa Bearer/JWT/token/segredo/PII em qualquer chave.

## Logout
`browserPolicy.logout.steps` (`logoutPlan()`): revogar no servidor e limpar cookie → `App.authz.reset('logout')` → limpar estado sensível do tenant
(`App.tenancy.TENANT_SENSITIVE_STATE`) → purgar caches user/tenant-aware e pacotes RESTRICTED → cancelar mutações offline pendentes → `pageshow(persisted)` revalida (BFCache).
Logout global (revogar todas) e inventário de sessões: futuro, no IdP.
