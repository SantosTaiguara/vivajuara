# Modelo de segurança de compartilhamento

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Complementa SHARE_GRANT_AND_TOKEN_SECURITY.md, SHARE_PUBLIC_RUNTIME_SECURITY.md e LINK_PRIVACY_AND_SECURITY_POLICY.md (tópicos anteriores); aqui só o que o tópico 50 audita e acrescenta.

## Estado atual (auditado)
- Backend `share.tokens`: token de 256 bits, armazenado como HMAC com `SHARE_TOKEN_PEPPER`, comparação com `timingSafeEqual`; revogação e expiração verificadas no servidor (testado de forma pura em `security50.test.js`).
- Front: o link de deep link (`#v=…`) carrega **só estado de navegação** (filtros, lote, câmera). O codec (`src/deeplink/linkStateCodec.js`) rejeita padrões de script; 7 hashes maliciosos na auditoria E2E → nenhuma execução.
- Nenhum dado de cliente, preço negociado ou token vai na URL. O link de WhatsApp usa `encodeURIComponent` e é gerado pelo usuário.

## Regras
1. ShareToken é um tipo próprio (`tokenTypes.json`): nunca serve como sessão, nunca vai em log e nunca em `localStorage`.
2. A validação pública é limitada (`rateLimits.json`: `share.validate` por IP e `share.validate.token` por token), e a resposta é genérica (sem distinguir inexistente/expirado/revogado).
3. Revogar (`share.revoke`, permissão proposta, D50-5) invalida no servidor. Cópias offline do PWA recebem `OFFLINE_ACCESS_REVOKED` na próxima conexão.
4. O link público mostra só o recurso concedido (`SHARE_RESOURCE_AND_ASSET_SECURITY.md`). Preço é sempre "preço de tabela"; disponibilidade UNKNOWN nunca é exibida como disponível.

## Ameaças cobertas: T-04 (vazamento/força bruta de ShareToken), T-05 (corrida no one-time). Runbook: INCIDENT_RESPONSE_RUNBOOKS.md §Vazamento de link.
