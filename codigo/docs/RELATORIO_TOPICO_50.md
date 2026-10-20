# Relatório — Tópico 50: Segurança da Plataforma

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Entregue
- `src/security/hardening.js` → `App.securityHardening`: módulo puro (sem storage, DOM ou rede). Inclui escape, tipagem do estado restaurado, auditoria de storage, redação, CSP/headers, SSRF, rate limit, idempotência, webhook, upload/arquivo, CSV, ações de alto risco, eventos de segurança e validação de config.
- `config/security/`: browserPolicy, threatModel (13 ativos, T-01..T-17), dataClassification, highRiskActions (9 ações + 8 permissões propostas), rateLimits (10 políticas + inputLimits), securityEvents (18 tipos), uploadPolicy, tokenTypes, secretsCatalog (só metadados), legacyInventory (16 itens).
- `scripts/securityHeaders.js` (`_headers` com CSP por hash; `--write`/`--meta`/`--check`) e `scripts/securityScan.js` (segredos, padrões proibidos, `value=` sem escape, dependências).
- `tests/security50.test.js`: 30 testes (28 ok + 2 todo).
- Mudança compartilhada mínima: `src/state/store.js`, 2 linhas em `restore()` que chamam `scrubRestoredState` (com try/catch, nunca bloqueia o boot).
- 23 documentos pt-BR (SECURITY_ARCHITECTURE … SECURITY_TEST_MATRIX).

## Achados da auditoria
1. **XSS armazenado real** (confirmado E2E). 11 campos de filtro/estado eram renderizados sem escape em atributos `value=` em `panels.js`, com origem no `localStorage`.
   - Neutralizado pelo scrub na restauração (E2E: 0 execuções) e pela CSP estrita (0 execuções, 0 violações, app funcional).
   - A correção na view é o **patch P1** (integrador).
2. Hash/deep link: 7 vetores sem execução. `postMessage`: o SW aceita só SKIP_WAITING. Não existe eval/new Function no código do app.
3. `localStorage`: sem token/segredo/autorização. Nomes de clientes persistidos (D50-1).
4. Terceiros: só Google Fonts (D50-3). Painel sem CSP: meta é ignorada porque o host embrulha a página em `<body>` (D50-2).
5. Backend (revisão estática):
   - OK: SQL parametrizado; validação rejeita campos desconhecidos; tokens de 256 bits com timingSafeEqual; dev token e CORS `*` recusados em produção; erros genéricos.
   - Patches: **B1** (X-Forwarded-For), **B2** (rate limit por categoria), **B3** (redação no logger / stack em 500).
6. Segredos: 0 achados bloqueantes. Dependências: 15 pacotes, todos do registry, com integrity.

## Riscos residuais
- Até aplicar P1, a defesa contra o XSS em `value=` depende do scrub (e da CSP onde o host a enviar).
- Sem CSP no host atual. Fontes de terceiro recebem IP/UA.
- PII de clientes no navegador (D50-1).
- Sem IdP/MFA/CSRF real (backend com token de operador; D50-4).
- Isolamento de tenant só na aplicação (sem RLS; D50-7).
- Uploads sem scanner (D50-6).
- Rate limit em memória por instância.

## Adiado (documentado como contrato)
OIDC/sessão por cookie/CSRF, MFA, middleware por política de rate limit, endpoint de upload e scanner, webhooks e integrações de saída, RLS. Nada roda sem servidor/decisão; nada sai do dispositivo.

## Decisões humanas
- D50-1: nomes de clientes em `localStorage`.
- D50-2: CSP via headers (host próprio ou host atual).
- D50-3: auto-hospedar fontes.
- D50-4: IdP OIDC + sessão por cookie/CSRF.
- D50-5: registrar as permissões propostas no frontend e no backend.
- D50-6: scanner de malware.
- D50-7: RLS no Postgres.
