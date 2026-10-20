# Identidade e autenticação

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Estado atual (inventário)
- **Painel publicado**: sem login; contexto `STATIC_PUBLIC` anônimo (somente leitura, grants `PUBLIC_VISITOR` em empreendimentos PUBLIC).
- **Backend**: `SystemCredentialProvider` (ADMIN_API_TOKEN → principal SYSTEM; legado WRITE_API_KEY deprecated) e `DevTokenProvider`
  (`plat_dev_<43>`; só sha256 armazenado; **recusado em produção** no `loadConfig`). Comparação por sha256 + `crypto.timingSafeEqual`.
- Sem senhas próprias; nenhum hash de senha fraco no código (scrypt só para passcode de share, `share.tokens.js`).

## Decisão recomendada (D50-4, humana)
IdP padrão **OIDC** (Google Workspace / Microsoft Entra / provedor gerenciado) com sessão de servidor em cookie. Se senha própria for inevitável:
Argon2id, blocklist de senhas vazadas, rate limit, MFA. Nunca MD5/SHA1/SHA256(senha)/texto.

## MFA e step-up
`AuthStrength`: PASSWORD_ONLY(1) · MFA_VERIFIED(2) · RECENT_REAUTH(3) · FEDERATED_HIGH_ASSURANCE(3). MFA recomendado para OWNER_ADMIN, publicação de
preço, override de disponibilidade, gestão de papéis e segredos. `evaluateHighRisk()` devolve `REQUIRES_STEP_UP` quando a força < MFA ou a sessão é
mais antiga que `maxSessionAgeForActionMs` (ver HIGH_RISK_ACTION_SECURITY.md). `App.authz.evaluate(..., { stepUpForCritical })` já existia (tópico 30).

## UX
Login: "Credenciais inválidas" (sem revelar se o e-mail existe). Reset: resposta idêntica para conta existente/inexistente. Reautenticação explica o motivo.
