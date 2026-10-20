# Identidade e sessões de analytics

## Atores
`USER` (autenticado; `userId`), `ANONYMOUS` (`anonymousId` aleatório, só da sessão de produto), `SYSTEM` (Domain Bridge/servidor sem usuário). `CUSTOMER` nunca é ator implícito: `customerId` só aparece em eventos `PSEUDONYMOUS` e nunca é ligado ao `userId`.

## Regras
- **Sem fingerprinting.** `anonymousId` = UUID aleatório em memória (D5 decide se haverá ID persistente).
- **Sem identity stitching** (`consent.identityStitching = false`): login não liga `anonymousId → userId`.
- **Logout:** `setIdentity({ userId: null })` remove o usuário e gira a sessão de produto.
- **Troca de usuário:** gira a sessão; duas pessoas no mesmo navegador nunca viram o mesmo usuário.
- **Troca de organização:** gira a sessão; filas e buffers são separados por `organizationId`; evento pendente da organização A nunca é reetiquetado para B.
- O tenant vem do contexto autoritativo (`App.authz.context().tenant`); `ctx.organizationId` diferente → `TENANT_MISMATCH`; sem tenant → `TENANT_UNRESOLVED`.

## Sessões (nenhuma sessão universal)
| Sessão | Campo | Origem |
|---|---|---|
| Produto | `session.productSessionId` | cliente; 30 min de inatividade; gira em logout/troca |
| Autenticação | (servidor) | não exposta ao analytics |
| Apresentação | `session.presentationSessionId` | `PresentationSession` (Domain Bridge) |
| Acesso a link | `session.shareAccessSessionId` | `ShareAccessSession` (servidor) |
| Jornada | `session.journeyId` | só em eventos pseudônimos |

Fechar o navegador não é evento de fim de sessão.
