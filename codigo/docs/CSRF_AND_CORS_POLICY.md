# CSRF e CORS

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## CORS (backend `applyCors`)
Allow-list explícita `CORS_ORIGINS` por ambiente; preflight com métodos/headers fixos e `Max-Age 600`; origem desconhecida em preflight → 403 `CORS_ORIGIN_DENIED`;
`Vary: Origin`. Nunca `Access-Control-Allow-Credentials` (auth é Bearer). `*` é **recusado no startup em produção** (`loadConfig`); fora de produção é aceito sem credenciais.
`validateSecurityConfig()` também acusa `*`+credentials, origens `http://` e localhost em produção.

## CSRF
Hoje a API não usa cookie de sessão (Bearer explícito) ⇒ CSRF clássico não se aplica. **Quando o IdP introduzir cookie** (D50-4):
SameSite=Lax + token CSRF double-submit em header `X-CSRF-Token` + validação de `Origin`/`Referer` em mutações (não depender só de SameSite).
GET nunca altera estado (rotas de escrita são POST/PATCH com `meta.write`). Testes previstos (§331): token ausente/inválido, origem cross-site, same-site válido.

## Testes
`security50.test.js`: origem desconhecida negada no preflight, origem aprovada ecoada, sem credentials; produção com `*` falha.
