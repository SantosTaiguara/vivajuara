# Matriz de testes de segurança

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

`tests/security50.test.js`: 30 testes (28 passam, 2 `todo` aguardando P1/B1).

| Área | Teste | Ameaça |
|---|---|---|
| Registros/config | registries válidos; `validateSecurityConfig` nega config fraca | T-12 |
| Cenários de ouro (§346) | casos do spec, um por cenário | vários |
| XSS armazenado | `scrubRestoredState` (tipos num/bool/token/list, `customers[].profile`); hook do store; fuzz de render das views com estado envenenado → 0 execuções | T-03 |
| XSS em template | baseline de `scanValueAttributes`: 17 interpolações conhecidas = 11 do P1 + 6 numéricas/ids de config (`baseMapBlend`, opacidade, `downPaymentPct`, `d.id`, `p.id`); qualquer nova falha o teste | T-03 |
| URL/hash | 7 deep links maliciosos rejeitados; `safeUrl` | T-03, T-09 |
| Storage | `auditStorage`: só chaves permitidas, sem token/segredo; exceção D50-1 | T-12, T-16 |
| Redação/eventos | `redactText`/`redactRecord`; `securityEvent` recusa tipo desconhecido | T-15, T-16 |
| CSP/headers | `securityHeaders.js` gera hash correto; `evaluateCsp` acusa `unsafe-inline`/`unsafe-eval`/curinga | T-03 |
| Upload/arquivo/CSV | magic bytes, dupla extensão, RTLO, zip slip/bomb, fórmula CSV | T-08 |
| SSRF | IPs privados, metadata, IPv6, credenciais na URL | T-13 |
| Webhook/idempotência | assinatura, replay, conflito de corpo | T-13 |
| Rate limit | janela, 429 + Retry-After | T-01, T-14 |
| Alto risco | step-up, dupla aprovação, permissão inexistente nega | T-06, T-07 |
| Tenant/mascaramento | cross-tenant nega; mascaramento de cliente | T-02 |
| BFCache/logout | `onPageShow`, `logoutPlan` | T-17 |
| SW | `classify`/`storable` (tópico 49) | T-10, T-11 |
| Backend puro | `applyCors`, `validateObject`, lotId, `loadConfig` em produção, `share.tokens`; B1 (`todo`) | T-01, T-04, T-14 |
| Segredos | segredo plantado é detectado; repositório limpo | T-12 |
| Dependências | inventário sem fonte fora do registry | T-12 |

## Fora do escopo local
Testes com Postgres (RLS, D50-7), E2E com IdP (D50-4) e E2E de CSP no host real (D50-2). Os E2E de XSS/CSP foram feitos com Playwright na auditoria (scripts de rascunho, fora do repositório).
