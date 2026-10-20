# Arquitetura do domínio de favoritos (Tópico 38)

Módulo: `src/favorites/favorites.js` → `App.favorites`. UI: `src/presentation/favoritesView.js` + `favorites.css`.

```
Ação do usuário → comando → FavoriteApplicationService (createService)
   ├─ regras de domínio: identidade única, ciclo de vida, coleções, contexto, tenant/usuário
   ├─ FavoriteRepository: snapshot em memória + backend (IndexedDB → localStorage → memória)
   ├─ FavoriteMutationQueue → FavoriteSyncService (sync com remoto, revisão do servidor)
   ├─ eventos de domínio (sem nota, sem PII)
   └─ FavoriteReadModelAssembler (lote atual em lote único) → mapa / Quick View / lista / comparação / compartilhamento
```

## Distinções (§665)
| Conceito | Onde vive | Favorito altera? |
|---|---|---|
| Lote atual / selecionado | `store.currentLotId` (sessão) | não |
| Candidato de comparação | `store.comparisonLotIds` / `App.compare.domain` | não |
| Recomendação | `App.recommendation` | não (favorito não é sinal) |
| Favorito / coleção / favorito de cliente | `App.favorites` | — |
| Reserva / proposta / status | `App.availability` (Tópico 29) | não |
Nenhum `isFavorite` no Lot canônico: o read model compõe Lot + contexto de favoritos.

## Entidades
- `FavoriteRecord`: id, organizationId, userId, developmentId, entityType `LOT`, entityId (LotId canônico), contextType, contextRef,
  collectionIds, source, lifecycleStatus, note, createdAt, updatedAt, removedAt, archivedAt, createdOnDeviceId, **recordRevision**
  (nome escolhido em vez de syncRevision, §405), serverRevision, syncState, snapshotRef, metadata.
- `FavoriteIdentityKey` = organizationId + userId + contextType + contextRef + entityType + entityId; um ativo por chave.
- Enums: ContextType, Source (MAP … MIGRATION, OTHER), Lifecycle (ACTIVE/REMOVED/ARCHIVED), SyncState, MutationState,
  EntityResolution, ContextResolution, Sort, ViewMode (LIVE/SNAPSHOT), StateFlag, ProjectionMode, SyncConflictType, EventType, Errors, Warnings.
- `FavoriteStateTransition` registrada a cada mudança de ciclo de vida.

## Operações (`createService(...)`)
add (idempotente; re-add reativa o mesmo registro), remove (soft), restore, archive, toggle, updateNote (concorrência otimista),
copyToContext (explícito), list(FavoriteQuery), isFavorite, setProjection → `FavoriteSetProjection { context, lotIds, revision }`,
projectionCacheKey, coleções (create/rename/archive/delete/restore/addTo/removeFrom/reorder/collectionItems/snapshot), captureSnapshotRef,
readModels, listItems, statusSummary, shareProjection, validate (FavoriteIntegrityValidator), diagnostics, sync, resolveConflict, subscribe, dispose, reload.

## Read model
Vivo por padrão: status atual (Tópico 29), preço via `App.dataState.resolve` (Tópico 37: KNOWN+STALE mostra valor e aviso, UNKNOWN "Preço não disponível").
Flags derivadas, nunca persistidas: SOLD, RESERVED, UNAVAILABLE, PRICE_UNKNOWN, STALE_COMMERCIAL_DATA, HAS_CRITICAL_ALERT, ORPHANED e,
somente com snapshotRef capturado, PRICE_CHANGED / STATUS_CHANGED / ANALYSIS_UPDATED. Uma chamada `resolveLots(ids)` por lista (sem N+1).
O favorito não assina atualizações nem notifica (NotificationService fora do escopo).

## Permissões propostas
favorite.read, favorite.create, favorite.remove, favorite.manageCollections (corretor), favorite.share, favorite.readOthers (sensível, negado por padrão).
Hoje o recurso é device-local (`lot.favorite` em features.json). O serviço recebe `authorize(permission)`; padrão nega readOthers e manageSharedCollections.
