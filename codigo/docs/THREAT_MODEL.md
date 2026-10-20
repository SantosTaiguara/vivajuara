# Threat Model (STRIDE)

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Fonte de verdade: `config/security/threatModel.json` (13 ativos `ThreatModelAsset`, 17 cenários `ThreatScenario`). `App.securityHardening.validate()`
garante que cada cenário referencia um ativo existente, tem categoria STRIDE, severidade/likelihood válidas e mitigação, e que **todo fluxo obrigatório
(§13) tem ao menos um cenário**: login, tenant switch, Customer data, documents, Share, Pricing publication, Availability mutation, offline packs,
Service Worker, upload/import, admin operations, webhooks/integrations (+ renderização no navegador).

| Id | Ativo | STRIDE | Ameaça | Sev. | Mitigação principal | Risco residual |
|---|---|---|---|---|---|---|
| T-01 | Conta | S | força bruta/credential stuffing | HIGH | IdP (D50-4), rate limit `auth.login`, tokens 256 bits | sem IdP real |
| T-02 | Cliente | I | BOLA/IDOR cross-tenant | CRITICAL | `tenancy.guard` antes do handler; header de org é seletor | RLS não ativada |
| T-03 | Cliente | T | XSS armazenado via innerHTML | HIGH | esc(), scrub do estado restaurado, CSP com hash | patch P1 pendente |
| T-04 | Share | I | vazamento/brute force de ShareToken | HIGH | 256 bits + HMAC, no-referrer, no-store, redação | serviço de share não implantado |
| T-05 | Share | E | corrida no one-time | MEDIUM | consumo atômico (UPDATE…RETURNING) | — |
| T-06 | Preço | T | publicação indevida/concorrente | CRITICAL | permissão CRITICAL, motivo, revisão, idempotência, audit, step-up | step-up depende do IdP |
| T-07 | Disponibilidade | T | override sem permissão / last-write-wins | CRITICAL | máquina de estados + expectedRevision + FOR UPDATE + audit | — |
| T-08 | Documento | T | upload malicioso / zip bomb / zip slip | HIGH | checkUpload/checkArchive; SVG recusado; scan | sem antivírus ainda |
| T-09 | Documento | I | URL pública/permanente, path traversal | CRITICAL | signed URL curta, ids resolvidos no servidor | — |
| T-10 | Pacote offline | E | acesso após revogação | MEDIUM | maxOfflineSessionAge + revalidação + purge | janela offline aceita |
| T-11 | SW | I | cache de resposta privada / envenenamento | HIGH | SW só same-origin GET, nunca /api/, Authorization, no-store, Set-Cookie | — |
| T-12 | Segredo | I | segredo em repo/bundle/log | CRITICAL | securityScan (CI), env sem default, redação | — |
| T-13 | API | S | webhook forjado/replay; SSRF | HIGH | checkWebhook, checkOutboundUrl | não há webhooks |
| T-14 | API | D | abuso / bypass de rate limit via XFF | MEDIUM | políticas por categoria; patch B1 | limiter em memória |
| T-15 | Audit | R | ação crítica sem rastro | HIGH | AuditEvent append-only | tamper-evidence futura |
| T-16 | Analytics | I | PII/token em evento | MEDIUM | analytics local-only + privacy filter | — |
| T-17 | Conta | I | logout + Voltar (BFCache) | MEDIUM | onPageShow → revalidar; cliente só em memória | sem login no painel hoje |

## Atores
Visitante anônimo (painel público) · corretor/gestor autenticado (futuro IdP) · operador da plataforma (ADMIN_API_TOKEN) · destinatário de link de share ·
atacante externo (links forjados, brute force, scraping) · extensão/malware no aparelho (fora do alcance: §233) · insider com credencial de escrita.

## Revisão
Atualizar o JSON a cada gatilho de §299 (novo fluxo de auth, upload, share, endpoint público, dado offline sensível, conector, segredo).
