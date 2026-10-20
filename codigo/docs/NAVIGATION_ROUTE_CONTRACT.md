# Contrato de rotas da navegação

| Workspace | routeCode | Rota no codec (tópico 43) | Status no codec | Estado que a representa | Restaura em refresh por |
|---|---|---|---|---|---|
| MAP | MAP | MAP | ACTIVE | view=map | URL (hash) |
| FIND | FIND | FIND | RESERVED | view=map + gaveta Encontrar (transiente) | estado de sessão (store SESSION) |
| COMPARE | COMPARE | COMPARE | ACTIVE | view=compare | URL (hash) |
| CUSTOMERS | CUSTOMERS | CUSTOMER | STATE_REF_ONLY | view=clients | estado de sessão (store SESSION) |
| DEVELOPMENT | DEVELOPMENT | DEVELOPMENT | ALIAS_OF_MAP | view=development | estado de sessão (store SESSION) |

- Rotas semânticas sugeridas pela spec (`/developments/:id/map` …) são representadas pelo codec do tópico 43 (`#<dev>`, `#<dev>.lots.<lote>`, `#<dev>.compare.<a>~<b>`). **Não há segundo serializador de URL.**
- Rótulo nunca é path; routeCode é estável e independe do idioma.
- Sem PII na URL: cliente só por id opaco dentro de stateRef autenticada (CUSTOMER = `STATE_REF_ONLY`).
- Share Routes continuam segregadas (`/s/<token>`, ShareService).
- **Histórico**: o NavigationCoordinator do tópico 43 decide push/replace. Telas pequenas não fazem push (o marcador de voltar do tópico 21 controla o Back); ajustes de sheet nunca criam entrada. Trocar para Clientes/Empreendimento não muda o envelope (a URL continua MAP), por isso não cria entrada de histórico no desktop: decisão D3.
- **Modal × rota**: estado navegável importante → rota/estado; ação transitória → overlay; Ficha completa = painel contextual (o item ativo continua MAP).

## RouteAccessDecision
`service.routeAccess(ws, ctx) → { allowed, reasonCode?, redirectRouteCode?, message? }`.
| Origem | Negado → |
|---|---|
| PRIMARY_NAV / CONTEXT_ACTION / SHORTCUT | fica onde está e explica (toast com a mensagem da feature) |
| DEEP_LINK / BROWSER_HISTORY / SYSTEM_REDIRECT | redireciona com segurança para MAP (ou o primeiro workspace permitido) |
| MAP negado | nenhum redirecionamento (sem loop) |
Permissões mudaram (`authz.subscribe`): `service.onPermissionsChanged(state, ctx)` devolve o plano de redirecionamento se o workspace atual deixou de ser permitido. Frontend guard é UX; o backend continua sendo a fronteira de segurança.

## Ações formais (§183)
`NAVIGATE_TO_MAP | NAVIGATE_TO_FIND | NAVIGATE_TO_COMPARE | NAVIGATE_TO_CUSTOMER | NAVIGATE_TO_DEVELOPMENT` → `service.plan(target, state, ctx)`; `goToLot(lotId)`, `goToCustomer(customerId)`, `goBack()`.
