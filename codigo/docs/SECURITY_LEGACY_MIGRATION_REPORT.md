# Relatório de migração de segurança do legado

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Inventário completo: `config/security/legacyInventory.json` (16 itens). Resumo:

| # | Local | Categoria | Severidade | Estado |
|---|---|---|---|---|
| 1 | `panels.js:93-94,103-108,152-153` `value="${f.areaMin}"`… | XSS armazenado | ALTA | **Mitigado** (scrub + CSP); **patch P1** pendente do integrador |
| 2 | `panels.js:382` `value="${so.hour}"` | XSS armazenado | ALTA | idem |
| 3 | `store.js sanitize()` não tipava valores | XSS | MÉDIA | **Corrigido** (hook `scrubRestoredState`) |
| 4 | `localStorage` `prefs.customers[].name` | PII | MÉDIA | Decisão D50-1 |
| 5 | Google Fonts | Terceiro | BAIXA | Decisão D50-3 |
| 6 | Painel sem CSP | Header | MÉDIA | `_headers` gerado; decisão D50-2 |
| 7 | `clientIp` com primeiro X-Forwarded-For | Abuso | MÉDIA | **Patch B1** |
| 8 | Rate limit só global | Abuso | MÉDIA | **Patch B2** |
| 9 | Logger sem redação central / stack em 500 | Log | MÉDIA | **Patch B3** |
| 10 | `applyCors` | CORS | — | OK (`*` recusado em produção, sem credenciais) |
| 11 | `iam/authentication.js` | Auth | — | OK (256 bits, timingSafeEqual, dev token recusado em produção) |
| 12 | `*.repository.js` | SQL | — | OK (parametrizado, colunas por allow-list) |
| 13 | SW | PWA | — | OK (mesmo origin, GET, só SKIP_WAITING) |
| 14 | `linkStateCodec.js` | XSS/URL | — | OK (7 vetores sem execução) |
| 15 | `app.js:200 vj-device-id` | Storage | BAIXA | Id aleatório local, sem PII; aceitável |
| 16 | `security/authorization.js` | AuthZ | — | OK (nega por padrão; precisa das permissões D50-5) |

## Patch P1 (panels.js) — para o integrador
Envolver cada interpolação em `esc()`:
- `value="${f.areaMin ?? ''}"` → `value="${esc(f.areaMin ?? '')}"`
- o mesmo para areaMax, pricePerM2Min/Max, frontMin/Max, depthMin/Max (linhas 93-94, 103-108)
- `c.areaMin`/`c.areaMax` (152-153)
- `so.hour` (382)

Diff unificado de 11 linhas no relatório final. Verificação: com o patch, o fuzz de render tem 0 execuções mesmo sem o scrub, e o baseline de `scanValueAttributes` cai de 17 para 6 (as 6 restantes são números do viewmodel ou ids de config; envolvê-las em `esc()` também é recomendado como defesa em profundidade). Após aplicar, troque o teste `todo` P1 por teste normal.
