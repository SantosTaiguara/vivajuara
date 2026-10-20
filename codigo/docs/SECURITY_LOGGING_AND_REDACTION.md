# Logging de segurança e redação

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Fronteira com observabilidade: SECURITY_OBSERVABILITY_BOUNDARY.md (tópico 51). **SecurityEvent ≠ AuditEvent ≠ evento de analytics.**

## SecurityEvent (config/security/securityEvents.json, `securityEvent(type, data)`)
18 tipos, entre eles:
- LOGIN_SUCCESS/FAILURE, MFA_FAILURE
- PERMISSION_DENIED, TENANT_SCOPE_VIOLATION
- TOKEN_REPLAY, RATE_LIMIT_TRIGGERED
- SUSPICIOUS_EXPORT, UPLOAD_*
- CSRF_VALIDATION_FAILED, INVALID_SIGNATURE, SSRF_BLOCKED
- STORED_STATE_SCRUBBED, STEP_UP_REQUIRED
- SECRET_LEAK_DETECTED, CSP_VIOLATION, OFFLINE_ACCESS_REVOKED

O construtor recusa tipo desconhecido, remove campos fora do contrato e redige o resto. O IP é guardado só como hash.

## Redação (`redactText`, `redactRecord`)
Remove:
- Bearer/JWT/chaves conhecidas
- URL com senha e query string de token
- e-mail, telefone e CPF/CNPJ
- campos com nome sensível (`password`, `token`, `secret`, `authorization`, `cookie`, `pepper`, `apiKey`…)

Profundidade e tamanho são limitados.

## Backend (revisão estática)
- Logger estruturado JSON. O log de request não inclui corpo nem query.
- **B3**: o caminho de 500 (`backend/src/app.js:167`) registra `err.message` e `err.stack`. Uma mensagem de erro do driver pode conter SQL/valores, e não há redação central.
  Patch: em `shared/logging/logger.js`, passar os campos por uma redação equivalente a `redactRecord` antes de serializar e, em produção, omitir `stack` (ou registrá-lo só em nível debug).
  A resposta HTTP já é genérica (500 sem detalhes).
- Nunca registrar token, segredo, corpo de request, nome de cliente ou URL com query de token.
