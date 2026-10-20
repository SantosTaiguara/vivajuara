# Classificação de dados de segurança

> Tópico 50 — Segurança da Plataforma · 2026-10-12 · código: `src/security/hardening.js` (App.securityHardening), `config/security/*.json`, `scripts/securityScan.js`, `scripts/securityHeaders.js`, testes `tests/security50.test.js`.

Níveis: **PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED < SECRET** (`App.securityHardening.CLASSIFICATION`, `CLASS_ORDER`). Fonte: `config/security/dataClassification.json`
(`classificationOf(tipo)`). A classificação documental do tópico 32 é **mapeada** (não duplicada) em `documentMapping`.

| Tipo | Classe | Onde vive hoje |
|---|---|---|
| Imagem de marketing, geometria, tabela de preço publicada | PUBLIC | CDN/SW, lots.json, commercial.json |
| Disponibilidade, input de análise, config do empreendimento | INTERNAL | API / IndexedDB (cópia marcada STALE) / bundle |
| Preferências de UI, id pseudônimo do aparelho, favoritos (ids) | INTERNAL | localStorage / IndexedDB |
| Resumo e perfil de cliente | CONFIDENTIAL | memória (**exceção**: nome em localStorage — D50-1) |
| Contato, documento, nota de jornada do cliente | RESTRICTED | servidor / memória; nunca persistido no cliente por padrão |
| ShareGrant | CONFIDENTIAL | servidor (somente hash) |
| AuditEvent, SecurityEvent | RESTRICTED | servidor; buffer local só de diagnóstico |
| Segredos (DB, ADMIN_API_TOKEN, pepper de share, OIDC) | SECRET | secret manager → env do servidor |

Regras: dado ≥ CONFIDENTIAL não vai para analytics nem URL; ≥ RESTRICTED não persiste offline por padrão; SECRET nunca no frontend, repositório, log,
analytics, mensagem de erro ou storage. Pseudônimo (device id) ainda é dado pessoal (§107).
