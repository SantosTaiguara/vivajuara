# Matriz de Testes — ShareService

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

Arquivo: `tests/share.test.js` (26 testes, todos passando).

| Cenário | Coberto |
|---|---|
| SharePresentationWithToken: token opaco de 43 caracteres, só hash armazenado, URL sem PII/ID | sim |
| SharePresentationWithExpiry: TTL padrão/máximo, sem expiração negado, estender exige permissão | sim |
| SharePresentationRevoked: imediato para acesso, sessão, cache e asset | sim |
| SharePresentationSafetyRevoked / REVIEW_REQUIRED | sim |
| Passcode: hash, tentativas, bloqueio, erro genérico | sim |
| One-time: confirmação humana, consumo único, bot não consome | sim |
| Preview bot: só metadados genéricos | sim |
| Erros públicos indistinguíveis (inexistente/expirado/revogado) | sim |
| Cross-tenant / tenant suspenso | sim |
| Stale com aviso (apresentação) / bloqueio (financeiro) | sim |
| LOT_SNAPSHOT client-safe; Lot canônico negado; DOCUMENT negado | sim |
| Payloads de canal (copiar, WhatsApp, e-mail, QR, nativo) sem preço/status/PII; templates validados | sim |
| Estado inicial validado (fragmento, pertence ao recurso) | sim |
| Feedback com capability + CSRF; não altera perfil | sim |
| Jornada: copiar ≠ enviar; abrir/feedback mapeados | sim |
| Rotação revoga o antigo | sim |
| Concorrência one-time (duas confirmações → uma sessão), rate limit sem IP cru, assets por proxy | sim |
| Backend `share.tokens.js` (HMAC com pepper, verificação em tempo constante, scrypt, recusa sem pepper) | sim (sem DB) |

Não coberto: persistência real, concorrência do consumo único em Postgres, rate limit distribuído, CDN/cache de borda.
