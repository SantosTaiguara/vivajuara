# Política de gestão de segredos

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Inventário (config/security/secretsCatalog.json — só metadados, nunca valores)
`DATABASE_URL`, `ADMIN_API_TOKEN`, `WRITE_API_KEY` (legado, deprecated), `SHARE_TOKEN_PEPPER`, `OIDC_CLIENT_SECRET` (futuro), `WEBHOOK_SECRET_<integracao>`. Cada um tem dono, escopo, ambiente, rotação e procedimento de vazamento.

## Regras
1. **Nenhum segredo no frontend.** O artefato é público por natureza. `securityScan.js` varre `src/`, `config/`, `scripts/`, `backend/`, `docs/` e o `dash/` construído (AWS, chave privada, GitHub, Slack, Google, chaves estilo OpenAI/Anthropic, JWT, URL de banco com senha, dev token, atribuição a nomes de segredo). Resultado atual: **0 achados bloqueantes**.
2. Segredos só via ambiente/gerenciador no servidor. `.env` nunca é versionado (o scanner acusa `DOTENV_FILE_PRESENT`). `backend/.env.example` só tem placeholders.
3. Produção recusa dev tokens e configuração fraca (`loadConfig` falha em produção sem os segredos obrigatórios; testado).
4. Logs e erros nunca carregam segredo (SECURITY_LOGGING_AND_REDACTION.md). Os achados do scanner nunca imprimem o valor encontrado.
5. Rotação: ação de alto risco `SECRET_ROTATION` (permissão proposta `secret.rotate`, step-up, dupla aprovação). Vazamento → runbook "Segredo vazado".
6. Fixtures de teste devem conter `test`/`example`/`fake`/`dummy` no valor; o scanner as ignora (`FIXTURE_RE`).
