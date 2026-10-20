# Segurança de webhooks e integrações

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Entrada (`checkWebhook({ body, timestamp, signature, secret, seen, now })`)
- Assinatura HMAC-SHA256 sobre `timestamp.body`, comparada em tempo constante.
- Janela de tempo (anti-replay) e id de entrega já visto → `TOKEN_REPLAY`.
- Corpo limitado. Segredo por integração (`WEBHOOK_SECRET_<integracao>`), com rotação e dupla aceitação durante a troca.
- Assinatura inválida → `INVALID_SIGNATURE`, resposta genérica.

## Saída (`checkOutboundUrl(url, { allowHosts })`, anti-SSRF)
Só `https`, porta padrão, host na allow-list. Bloqueia:
- IP literal privado/loopback/link-local/metadata (169.254.169.254), IPv6 local e IPv4-mapeado
- `localhost`, `*.internal` e credenciais na URL

A resolução DNS deve ser revalidada no servidor (DNS rebinding) e redirects não devem ser seguidos sem nova validação. Bloqueio → `SSRF_BLOCKED`.

## Idempotência (`idempotency`)
Mesma chave + mesmo corpo → reaproveita a resposta. Mesma chave + corpo diferente → conflito 409. A chave é escopada por organização/usuário. O backend já tem `shared/http/idempotency.js` (revisado; não registra o corpo).

## Estado
Hoje não existe integração de saída nem webhook de entrada. Nada sai do dispositivo. Estas funções são o contrato testado.
