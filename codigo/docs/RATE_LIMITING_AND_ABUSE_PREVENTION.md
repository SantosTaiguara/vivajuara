# Rate limiting e prevenção de abuso

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Políticas (config/security/rateLimits.json)
`global.ip`, `auth.login` (ip+conta), `auth.passwordReset`, `share.validate` (ip), `share.validate.token` (token), `search` (ip+org), `analytics.expensive`, `export.bulk`, `admin.write`, `upload`. Resposta: **429 + Retry-After**, com mensagem genérica.

`inputLimits` define:
- tamanho de corpo (geral e admin)
- profundidade de JSON
- tamanho de página
- ids por lote
- tamanho de busca
- vértices/feições de geometria

`createRateLimiter(policyOrId)` é uma implementação pura de janela, testada. Ela serve de referência para o middleware.

## Estado do backend (revisão estática)
- `createRateLimiter({ windowMs, max })` existe só como limite **global por IP** (patch **B2**: aplicar as políticas por categoria acima).
- **B1**: `clientIp()` (`backend/src/shared/http/middleware.js:61`) usa o **primeiro** valor de `X-Forwarded-For` com `TRUST_PROXY`. Esse valor é controlado pelo cliente: dá para burlar o limite e falsificar o IP no log.
  Patch:
  ```js
  function clientIp(req, trustProxy, hops = 1) {
    if (trustProxy) { const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf) { const ips = xf.split(',').map(s => s.trim()).filter(Boolean); const ip = ips[ips.length - hops]; if (ip) return ip; } }
    return req.socket && req.socket.remoteAddress || 'unknown';
  }
  ```
  (`hops` = número de proxies confiáveis; teste `todo` em `security50.test.js` fica verde após o patch.)
- O contador é em memória: em múltiplas instâncias, use um store compartilhado (decisão de infraestrutura).
