# Grant e Segurança do Token

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

## Token
- 32 bytes de CSPRNG (`crypto.getRandomValues` / `crypto.randomBytes`), base64url, 43 caracteres (256 bits). Sem crypto disponível → `TOKEN_RNG_UNAVAILABLE` (nunca `Math.random`).
- Nunca derivado de ID, cliente, lote ou data. URL: `<origin>/s/<token>`; sem query, sem nome de cliente, sem ID.
- Armazenado **só como hash**: SHA-256 na referência; no backend, HMAC-SHA256 com pepper (`SHARE_TOKEN_PEPPER`, ≥16 caracteres) em `share_tokens.token_hash` (índice único). O token cru aparece uma vez (`ShareGrantCreateResultDto`).
- `tokenPrefix` (4 caracteres) para suporte. `redactToken` em logs e analytics.
- Rotação = novo grant + novo token; o antigo é revogado (nunca muda de segredo).

## Modos de acesso
`TOKEN`, `TOKEN_PLUS_PASSCODE`, `ONE_TIME_TOKEN` (exige confirmação humana antes de consumir, para que preview de bot não consuma o link), `AUTHENTICATED` (contrato).

## Código de acesso (passcode)
`SHARE_PASSCODE_POLICY`: mínimo 6, 5 tentativas, bloqueio 900 s. Rejeita código igual ao token ou parecido com PII. Hash: PBKDF2-SHA256 (referência) / scrypt N=16384 r=8 p=1 (backend), com salt.

## Rate limit
`RATE_LIMIT_POLICY`: 30 tentativas/min, 10 tokens inválidos/min, bloqueio de 900 s.

## Contrato de backend (tabelas)
- `share_definitions(id, organization_id, resource_type, resource_id, audience_type, audience_binding, created_by, created_at)`
- `share_grants(id, organization_id, share_definition_id, policy_id, policy_version, access_mode, valid_from, expires_at, lifecycle_status, max_access_count, access_count, last_access_at, revoked_at, revoked_by, revoke_reason_code, created_by, created_at)`
- `share_tokens(grant_id, token_hash UNIQUE, token_prefix, created_at)`
- `share_passcodes(grant_id, algorithm, salt, hash, failed_attempts, locked_until)`
- `share_sessions(id, grant_id, created_at, expires_at, invalidated_at)`
- `share_access_events(id, grant_id, kind, at, outcome, reason_code)` (sem IP cru e sem user-agent completo; usar hash/truncado)
- Consumo único: `UPDATE share_grants SET access_count = access_count + 1 WHERE id = $1 AND (max_access_count IS NULL OR access_count < max_access_count) RETURNING …`.
