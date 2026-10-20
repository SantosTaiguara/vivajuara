# Arquitetura do ShareService

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

## Entidades
| Entidade | Papel |
|---|---|
| **ShareDefinition** | O quê se compartilha (resourceType + resourceId de um recurso client-safe congelado), audiência, binding de audiência. |
| **ShareGrant** | Uma concessão concreta: política (versão), modo de acesso, `validFrom`/`expiresAt`, lifecycle (ACTIVE / SUSPENDED / REVOKED / EXPIRED / CONSUMED), contadores. Guarda só o **hash** do token. |
| **ShareSession** | Sessão pública curta (30 min, nunca além do grant) criada na troca do token. |
| **ShareAccessDecision** | Resultado puro de `evaluateAccess` (allowed, publicError genérico, denialReasonCodes internos). |

## Módulos
- `App.share.domain` (`shareDomain.js`): enums, `POLICIES`, permissões, token (gerar/hash/redigir), `buildGrant`, ciclo de vida, `evaluateAccess`, preview de bots, assets, estado inicial, mapa de jornada, VM de gestão, inventário legado.
- `App.share.service` (`shareService.js`): `createShareService({origin, organization, presentationRepo, pepper, pbkdf2Iterations, clock})` → `issue`, `rotate`, `revoke`, `suspend`, `resume`, `changeExpiry`, `getGrant`, `listGrants`, `exchange`, `resource`, `asset`, `feedback`, `channelPayload`, `markAsSent`, `onDomainEvent`, `createLotSnapshot`. Store em memória (referência).
- `App.sharedShellView` (`sharedShellView.js`): SharedAppShell público, telas de erro/código/confirmação, lista de links, tela "link criado".
- Backend `share.tokens.js`: `generateToken`, `hashToken` (HMAC-SHA256 + `SHARE_TOKEN_PEPPER`), `verifyTokenHash` (tempo constante), `hashPasscode/verifyPasscode` (scrypt), `redactToken`.

## Recursos compartilháveis
Só snapshots client-safe: `PRESENTATION_SNAPSHOT` (tópico 41), `LOT_SNAPSHOT` (`createLotSnapshot`), `FAVORITE_COLLECTION_SNAPSHOT` e `COMPARISON_SNAPSHOT` (política existe; resolver pendente). `DOCUMENT`, `RECOMMENDATION_RESULT`, `CUSTOM_CLIENT_SAFE_RESOURCE` e o **Lot canônico** são negados.

## Relação com `services/share.js`
`deepLink` / `whatsappUrl` ficam intactos (deep link **interno**). Para cliente, o caminho novo é `App.share.service` com link opaco `/s/<token>`.
