# Segurança do Runtime Público

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

## Cabeçalhos (`SECURITY_HEADERS`)
`Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, CSP restritiva (`frame-ancestors 'none'`, `base-uri 'none'`). `App.sharedShellView.headMeta` repete `robots`/`referrer` no HTML.

## Bots de preview
`isPreviewBot(userAgent)` (WhatsApp, facebookexternalhit, Slackbot, Twitterbot, TelegramBot, LinkedInBot, Discordbot…) → `previewMetadata`: título e descrição genéricos da organização. Sem nome de cliente, preço ou imagem do lote. Não consome ONE_TIME_TOKEN nem incrementa contador.

## SharedAppShell
Marca da organização, conteúdo client-safe, aviso de validade/frescor, ações permitidas pela capability (imprimir, feedback, contato). **Sem** navegação administrativa, atalhos de CRM, busca de clientes ou atalhos internos.

## Troca de token
`exchange(token)` → sessão curta (`sessionRef` opaco) + token CSRF. O token sai da barra de endereço (`history.replaceState` sugerido) e não é salvo em localStorage.

## Origem
`validateShareUrl` / `shareUrl(origin, token)`: só https (localhost permitido em dev), sem credenciais na URL, caminho `/s/<token>`. Origem inválida → `INVALID_SHARE_ORIGIN`.
