# Acesso e Revogação

> Tópico 42 — ShareService. Implementação de referência no frontend (`src/share/`) + utilitário de token puro no backend (`backend/src/modules/share/share.tokens.js`). Expiração, revogação, consumo único, rate limit e auditoria definitivos são **backend** (contratos aqui). Um token no frontend **nunca** é autorização.

## Decisão de acesso (`evaluateAccess`)
Ordem: tenant ativo → grant existe → lifecycle (REVOKED / SUSPENDED / CONSUMED) → janela de validade (`NOT_YET_VALID` / `EXPIRED`) → safety do recurso (REVOKED / REVIEW_REQUIRED) → frescor por política (`AVAILABILITY_STALE`, `PRICING_STALE`, `FINANCIAL_EXPIRED`) → passcode (`PASSCODE_REQUIRED` / `PASSCODE_INVALID` / `PASSCODE_LOCKED`) → rate limit → limite de acessos.

## Erros públicos (genéricos)
Ao público só saem `LINK_INVALID_OR_UNAVAILABLE`, `RESOURCE_UNAVAILABLE`, `PASSCODE_REQUIRED` / `PASSCODE_INVALID` e `RATE_LIMITED`. Os motivos internos (`denialReasonCodes`) ficam na auditoria. Token inexistente, revogado e expirado são indistinguíveis para quem tenta.

## Contagem
`access_count` só incrementa ao **iniciar sessão** (não em preview de bot, assets ou refresh).

## Revogação
`revoke(ctx, id, reasonCode)` (CUSTOMER_REQUEST, SHARE_CREATED_IN_ERROR, CUSTOMER_RELATIONSHIP_ENDED, SECURITY_POLICY_CHANGE, DATA_CORRECTION, OTHER com texto): efeito imediato para novos acessos, sessões ativas, cache e assets. A URL continua bem formada, mas não autoriza mais nada. `suspend` / `resume` são reversíveis.

## Eventos de domínio
`onDomainEvent`: `PresentationSnapshotRevoked` / `LotSnapshotRevoked` / safety `REVIEW_REQUIRED` → recurso indisponível (`RESOURCE_UNAVAILABLE`), mesmo com o grant ACTIVE. Tenant suspenso → tudo negado.

## Permissões (`domain.PERMISSIONS`)
`share.read / create / issue / revoke / suspend / channel.generate` → chave interina `share.create`. `share.extendExpiry`, `share.viewAccessHistory`, `share.overridePolicy` → `null` (negadas localmente; precisam entrar no registro de permissões do backend). Ler o recurso ≠ poder compartilhá-lo (`externalShareCapability`).
