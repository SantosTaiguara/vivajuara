# Segurança da cadeia de suprimentos

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Inventário (`securityScan.js` → `dependencyInventory()`)
- **Painel (frontend)**: zero dependências de runtime. O artefato é um único HTML com código próprio, e não há CDN de script. O único recurso de terceiro é o Google Fonts (CSS + fontes), decisão D50-3.
- **backend/package-lock.json** + **tests/package-lock.json**: 15 pacotes no total, todos de `registry.npmjs.org` e com `integrity`.
  Achados `INSTALL_SCRIPT`/`NON_REGISTRY_SOURCE`/`MISSING_INTEGRITY` aparecem no relatório quando existirem. Hoje não há nenhum bloqueante.
- Ferramentas de auditoria usadas fora do repositório (Playwright, acorn) não entram no build.

## Regras
1. Instalar com `npm ci` (lockfile obrigatório). Pacote novo → revisão (mantenedor, scripts de instalação, tamanho, licença).
2. Nenhuma dependência git/http. Nenhum script remoto no painel. Se um dia houver, use SRI + CSP.
3. `node scripts/securityScan.js` no CI. Sai com código 1 em achado CRITICAL/HIGH (segredo, padrão proibido ou dependência fora do registry).
4. `npm audit` periódico no backend (requer rede; fora do escopo local).
5. Comprometimento de dependência → runbook específico.
