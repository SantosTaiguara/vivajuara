# Relatório de rotas legadas e migração

Inventário em código: `App.deeplink.codec.LEGACY_ROUTE_INVENTORY` (complementa `App.share.domain.LEGACY_INVENTORY` do tópico 42).

## Pontos encontrados

| Local | Padrão | Propósito | PII | Ação | Severidade |
|---|---|---|---|---|---|
| `state/store.js` App.router.parse/token/write (replaceState em todo render) | `#<dev>[.lots.<c>[.<seção>|.simular|.sol]|.compare.<c>~<c>][?base&layer&score&ov&f]` | navegação interna | não | MIGRATE (v0 → v1) | LOW |
| `presentation/app.js` boot (`location.hash.split('.')[0]`) e `hashchange` | `#<dev>…` | navegação interna | não | MIGRATE (usar restoration) | LOW |
| `presentation/app.js` `shareLink()` → `services/share.js deepLink` | `<shareUrl>#<dev>.lots.<c>` / `.compare.` | copiar link interno | não | REPLACE (LinkStateService) | LOW |
| `compare/comparisonDomain.js` deepLinkToken/parseDeepLink | `#<dev>.compare.<c>~<c>` | interno | não | KEEP (mesma gramática, teste de paridade) | LOW |
| `presentation/app.js` devSel (`location.hash = devId; reload`) | `#<dev>` | interno | não | KEEP | LOW |
| `presentation/app.js` ensureBackMarker/popstate (`pushState({vjBack:1})`) | mesma URL | estado temporário (voltar no mobile) | não | KEEP (coordenador sem push em tela pequena) | LOW |
| `services/share.js` whatsappUrl | `wa.me/?text=` | share externo | **sim** (nome do cliente no texto) | REPLACE (já no tópico 42) | MEDIUM |
| `share/shareDomain.js` shareUrl | `/s/<token>` | share externo | não | KEEP | LOW |
| `state/store.js` localStorage `ws:<dev>:state` | — | preferências/sessão | não | KEEP (deep link ≠ localStorage) | LOW |

Não foram encontrados: `URLSearchParams`/`searchParams`, `?customer=`, `?phone=`, `state=<base64 store>`, `journey=`, tokens em URL.

## Parâmetros deprecados (`DEPRECATED_PARAMS`)

| Parâmetro | Motivo | Ação |
|---|---|---|
| `f` → `ft`, `fc`, `fq` (aderência) | derivados do perfil do cliente | não são mais escritos; ignorados na leitura (`FILTER_SENSITIVE_IGNORED`); continuam no localStorage local |
| `f` → `tx` (texto livre) | pode conter nome/telefone | só código de lote é escrito/lido |
| `f` → `fv` (favoritos) | conjunto pessoal | nunca foi escrito; ignorado |

## Compatibilidade garantida por teste

Todo token do `App.router.token` decodifica para o mesmo patch do `App.router.parse`; o hash canônico é o token com `v=1`; o `App.router` antigo lê links v1.
