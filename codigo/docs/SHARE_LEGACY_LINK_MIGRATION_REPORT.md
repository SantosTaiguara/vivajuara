# Relatório de Migração de Links Legados

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

Inventário em `App.share.domain.LEGACY_INVENTORY`:

| Local | Padrão atual | Risco | Ação |
|---|---|---|---|
| `app.js shareLink()` → `services/share.js deepLink` | `<artifact>#viva-juara.lots.<código>` | BAIXO (dados públicos, códigos curtos; sem expiração/revogação) | WRAP: manter como link interno |
| `viewmodels.js shareVM` → `whatsappUrl` (`wa.me/?text=`) | texto com nome do cliente, preço e status; fora do modo cliente inclui score e classe | **MÉDIO** (PII + fatos comerciais na URL) | REPLACE pelo payload de canal genérico |
| `compare/comparisonDomain.js sharePayload/deepLinkToken` | `#<dev>.compare.<a>~<b>` | BAIXO | WRAP → futuro COMPARISON_SNAPSHOT + grant |
| `store.js App.router` (`?layer=&f=`) | filtros na URL | BAIXO (o filtro pode refletir o orçamento de um cliente) | REVIEW (tópico 43) |

`services/share.js` **não foi alterado**: os testes atuais dependem dele, e o deep link segue útil internamente. A substituição do texto de WhatsApp legado depende de decisão humana e de mudança em `viewmodels.js`/`app.js`.
