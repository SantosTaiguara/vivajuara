# Política de SDLC seguro

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

## Portões
| Fase | Controle | Ferramenta |
|---|---|---|
| Design | Modelo de ameaças atualizado para fluxo novo (THREAT_MODEL.md, `threatModel.json.requiredFlows`) | revisão |
| Código | Todo dado em template passa por `esc()`/`escapeHtml` (inclusive `value="${…}"`); nada de `eval`, `new Function`, `document.write`, timer com string, `javascript:` | `securityScan.js` (scanCode, scanValueAttributes) |
| Config | Config de segurança válida (`validateSecurityConfig`), negar por padrão | `security50.test.js` |
| Testes | Suíte de regressão de segurança verde | `npm test` |
| Build | CSP com hash do build; `--check` sem achado HIGH | `securityHeaders.js --check` |
| Deploy | Headers do host aplicados (`--write`), segredos só no ambiente | checklist |
| Operação | SecurityEvents monitorados; runbooks | INCIDENT_RESPONSE_RUNBOOKS.md |

## Regras de revisão
- Mudanças em autorização, tenant, tokens, uploads, export ou SW exigem um revisor com contexto de segurança.
- Bug de segurança → teste de regressão antes do fix (exemplo: o XSS armazenado em `value=` desta auditoria tem teste fuzz e baseline do scanner).
- PII mínima. Nenhuma PII em URL, log ou analytics.
