# Arquitetura de segurança da plataforma

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Princípio
Autenticação explícita, autorização no servidor, isolamento multi-tenant por padrão, menor privilégio, validação de toda entrada,
proteção por classificação e defesa em profundidade. **O frontend não é fronteira de segurança**: esconder/desabilitar um botão
reduz erro operacional, mas toda ação protegida é reautorizada pelo backend.

## Camadas (de fora para dentro)
| Camada | Onde | Estado |
|---|---|---|
| Host estático do painel (headers, CSP, HSTS) | `scripts/securityHeaders.js` → `dash/_headers` | política validada; aplicação depende do host (D50-2) |
| Navegador: escape de saída, scrub do estado restaurado, storage policy | `App.securityHardening` + hook em `state/store.js` | implementado |
| Autorização de UX (deny by default) | `App.authz` / `App.permissions` / `App.tenancy` (tópicos 30/31) | existente |
| API: CORS allow-list, rate limit, validação DTO, write guard, tenancy.guard, idempotência, audit | `backend/src/app.js` + `shared/http/*` | existente; patches B1–B3 |
| Dados: SQL parametrizado, `organization_id`, revisões/expectedRevision | `backend/src/modules/*` + migrations | existente |

Pipeline de toda requisição protegida (backend, `app.js`): *writes habilitadas?* → `authenticate` → permissão da rota (deny by default; rota sem política = falha de boot)
→ `tenancy.checkRoute` + `tenancy.guard` (dono do recurso + escopo) → leitura do corpo (limite) → idempotência → handler (máquina de estados, revisão) → audit → resposta.

## Separação de conceitos (regra de encerramento §387)
AUTHENTICATION (quem) ≠ AUTHORIZATION (pode?) ≠ DOMAIN CAPABILITY (o estado permite?) ≠ TENANT CONTEXT (de quem é?).
SESSION ≠ TOKEN ≠ SECRET ≠ SHARE TOKEN ≠ SIGNED URL ≠ CSRF TOKEN ≠ IDEMPOTENCY KEY (ver `config/security/tokenTypes.json`).
AUDIT EVENT (registro de ação crítica, servidor, append-only) ≠ SECURITY EVENT (`securityEvents.json`, sinais de ataque) ≠ PRODUCT ANALYTICS (tópico 45, local).

## Módulo `App.securityHardening` (puro)
escapeHtml/safeUrl/isMarkupFree · scrubRestoredState · auditStorage · redactText/redactRecord · csvCell · buildCsp/evaluateCsp/securityHeaders ·
checkOutboundUrl · sniffMime/checkUpload/checkArchive · createRateLimiter · evaluateHighRisk · idempotency · checkWebhook · securityEvent ·
validateSecurityConfig · onPageShow/logoutPlan · threatModel/classificationOf/legacyInventory/tokenTypes · validate.
Nada nele concede acesso; política desconhecida → DENY.

## Documentos relacionados
THREAT_MODEL · SECURITY_DATA_CLASSIFICATION · IDENTITY_AND_AUTHENTICATION_SECURITY · SESSION_AND_TOKEN_SECURITY · AUTHORIZATION_AND_PERMISSION_ENFORCEMENT ·
TENANT_ISOLATION_SECURITY · API_SECURITY_POLICY · BROWSER_SECURITY_HEADERS_AND_CSP · CSRF_AND_CORS_POLICY · SHARE_SECURITY_MODEL · DOCUMENT_AND_UPLOAD_SECURITY ·
SECRETS_MANAGEMENT_POLICY · HIGH_RISK_ACTION_SECURITY · RATE_LIMITING_AND_ABUSE_PREVENTION · PWA_AND_OFFLINE_SECURITY · WEBHOOK_AND_INTEGRATION_SECURITY ·
SECURITY_LOGGING_AND_REDACTION · SUPPLY_CHAIN_SECURITY · SECURE_SDLC_POLICY · INCIDENT_RESPONSE_RUNBOOKS · SECURITY_LEGACY_MIGRATION_REPORT · SECURITY_TEST_MATRIX.

## O que este tópico **não** muda
Modelo de lote, metodologia de preço/análise, máquina de estados de disponibilidade, Fit/Recomendação/Comparação, fórmulas financeiras/solares,
semântica de Share/Deep Link/Analytics/Cache/PWA. Segurança só restringe acesso ou exige revalidação; nunca muda regra de negócio.
