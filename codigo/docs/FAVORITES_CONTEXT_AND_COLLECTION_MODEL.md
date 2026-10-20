# Contextos e coleções de favoritos (Tópico 38)

## Contextos (`FavoriteContextType`)
| Tipo | contextRef | Persistido | Uso |
|---|---|---|---|
| PERSONAL | — | sim | favoritos do corretor ("Meus favoritos") |
| CUSTOMER | customerId opaco (`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`) | sim | preparação do Tópico 39 (sem Customer completo) |
| SESSION | id da sessão | **não** (memória) | favorito temporário |
| SHARED_COLLECTION | id | sim | fundação |
`FavoriteActiveContext { type, ref, label }` é estado de UI; o label ("Favoritos de Maria") nunca é gravado. E-mail/nome como ref é recusado (FAVORITE_INVALID_CONTEXT).
Trocar de cliente não troca o contexto silenciosamente: `bindStore(...).setContext(ctx)` é explícito. Pessoal e cliente coexistem para o mesmo lote.
`copyToContext` copia (o pessoal fica); mover = copiar + remover, por decisão do usuário. Cliente arquivado: o favorito fica, `contextResolution` informa (CONTEXT_ARCHIVED / NOT_FOUND).

## Coleções
`FavoriteCollection`: id, organizationId, ownerUserId, developmentId, contextType (PERSONAL/CUSTOMER/PRESENTATION/INVESTMENT_SHORTLIST/CUSTOM),
contextRef, title, description, lifecycleStatus (ACTIVE/ARCHIVED/DELETED soft), visibility (PRIVATE padrão; ORGANIZATION_SHARED / LINK_SHARED /
CUSTOMER_SHARED exigem favorite.share), viewMode (LIVE padrão / SNAPSHOT), recordRevision.
`FavoriteCollectionItem`: id, collectionId, favoriteId, sortOrder (persistido), addedAt, addedBy, note (nota da shortlist).

Invariantes: coleção não é obrigatória; muitos-para-muitos; membership duplicada idempotente; remover da coleção ≠ desfavoritar;
arquivar/apagar coleção mantém os favoritos; a visão viva só mostra favoritos ACTIVE (a histórica mantém todos); reorder exige permutação exata;
coleção é por empreendimento; SESSION não entra em coleção; coleção de outro tenant não é encontrada.

## Snapshot
`snapshotCollection(id, { purpose, capture })` → `FavoriteCollectionSnapshot { id, organizationId, collectionId, itemRefs[lotId, sortOrder, priceSnapshot,
priceTableVersionId, availabilityStatus, availabilityRevision, analysisVersion], createdAt, createdBy, purpose, checksum }`.
`captureSnapshotRef(lot)` dá a linha de base opcional de um favorito (default: nenhuma).

## Status da coleção
`statusSummary(favs)` → total, available, reserved, proposal, blocked, sold, unavailable, unknown + faixa de preço só com preços KNOWN e contagem explícita de desconhecidos (sem média com zero).
