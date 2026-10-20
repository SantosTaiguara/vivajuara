# Payloads de Canal

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

O sistema **gera payloads**; não envia nada. `channelPayload(ctx, {grantId, channel, url, recipientFirstName?})`:

| Canal | Payload | Evento de jornada |
|---|---|---|
| COPY_LINK | `{ url }` | nenhum (copiar ≠ enviar) |
| WHATSAPP | texto do template + URL `wa.me/?text=` | só ao `markAsSent` → PRESENTATION_SHARED |
| EMAIL | `subject` + `body` (mailto) | idem |
| NATIVE_SHARE | `{title, text, url}` para `navigator.share`; sem suporte → copiar | idem |
| QR_CODE | URL + `QR_WARNING` ("quem fotografar o QR acessa o link"); alternativa textual sempre presente | idem |

## Templates (`TEMPLATES`)
Versionados, pt-BR, variáveis permitidas: `shareUrl`, `organizationName`, `recipientFirstName`, `presenterName`, `expiresAt`. `validateTemplate` rejeita markup/`javascript:` (`MARKUP_NOT_ALLOWED`), variável fora da lista e fato comercial (preço, "disponível", status: `COMMERCIAL_FACT_IN_TEMPLATE`). O nome do destinatário só entra com `allowRecipientName` e é reduzido ao primeiro nome, sanitizado.

Por padrão, nenhum payload leva preço, status de disponibilidade, score ou PII.
