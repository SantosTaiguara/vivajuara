# Segurança de Recursos e Assets

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

- O recurso entregue é o `audience` congelado do snapshot (tópico 41) ou o `LOT_SNAPSHOT` client-safe (identidade por código curto, preço de tabela, disponibilidade "sujeita a confirmação"). Nunca o lote canônico, scores internos, provenance ou IDs internos.
- `resource(sessionRef)` reavalia grant + safety a cada chamada; resposta em cache é invalidada na revogação.
- `assetAccess` / `asset()`: asset público estático seguro (`PUBLIC_STATIC_SAFE_ASSET`) pode ser servido diretamente; asset específico do cliente exige sessão válida e é servido por proxy autorizado ou URL assinada curta (`PROXY_AUTHORIZED` / `SHORT_LIVED_SIGNED_URL`). Depois da revogação → negado.
- `validateInitialViewState`: estado inicial (passo, lote, mapa) precisa pertencer ao recurso (`STEP_NOT_IN_RESOURCE`, `LOT_NOT_IN_RESOURCE`) e só pode vir no fragmento, nunca em query (`QUERY_PARAMS` → `INVALID_VIEW_STATE`).
- `feedback(sessionRef, {type, lotRef}, csrf)`: só com capability `SUBMIT_FEEDBACK`, tipos fixos (MORE_INFO, VISIT_INTEREST, FINANCIAL_INTEREST…), token CSRF da sessão; não altera perfil nem favoritos.
