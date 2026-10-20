# Relatório — Tópico 38: favoritos como domínio formal

## Entregue
- `src/favorites/favorites.js` (`App.favorites`): FavoriteRecord (recordRevision), FavoriteIdentityKey, contextos PERSONAL/CUSTOMER/SESSION/SHARED_COLLECTION,
  sources, lifecycle soft, transições, coleções + itens (muitos-para-muitos, ordem manual, soft delete), snapshots de coleção, FavoriteSnapshotRef opcional,
  repositório com backends IndexedDB/localStorage/memória, FavoriteApplicationService, FavoriteIntegrityValidator, read model/assembler em lote (preço via Tópico 37),
  FavoriteSetProjection + cache key, projeções INTERNAL/CLIENT/SHARE/TECHNICAL, eventos, fila de mutações, sync com conflitos por revisão do servidor, servidor de referência em memória,
  LegacyFavoriteMigrationAdapter idempotente e sem perda, `bindStore` (API antiga do store mantida), diagnostics.
- `src/presentation/favoritesView.js` + `favorites.css`: estrela acessível, lista/painel, chip de contexto, desfazer, aviso de sync.
- Alteração mínima: `src/state/store.js` — `restoredFavorites()` (cópia do array bruto antes do sanitize).
- Docs: FAVORITES_DOMAIN_ARCHITECTURE, FAVORITES_CONTEXT_AND_COLLECTION_MODEL, FAVORITES_OFFLINE_SYNC_POLICY, FAVORITES_UI_INTEGRATION,
  FAVORITES_SECURITY_AND_SHARING, FAVORITES_LEGACY_MIGRATION_REPORT, FAVORITES_TEST_MATRIX.
- Testes: `tests/favorites.test.js` (22), os 15 cenários dourados.

## Garantias verificadas por teste
Sem `isFavorite` no Lot; Recommendation/Fit/Availability/vencedor inalterados (e esses módulos não leem favoritos); vendido/bloqueado/sem preço continua favorito;
remover de coleção não desfavorita; seleção/comparação não migram; ids legados não resolvidos reportados; reload não duplica; tenant/usuário isolados; logout apaga;
eventos sem nota/PII; lista em uma chamada batch.

## Adiado / limitações
- Ligação no app.js/panels.js (receita em FAVORITES_UI_INTEGRATION.md); botões de coleção/contexto aguardam ações em features.json.
- Backend/API real e `HybridFavoriteRepository` de rede: contrato + `sync(remote)`; sem Postgres.
- Sincronização entre abas: só `reload()`; Customer completo (39), ShareService (42), analytics (44/45), notificações: fora do escopo.
- Sem login hoje: o userId é um id local do aparelho — favoritos continuam device-local até existir autenticação.

## Decisões humanas
1. Política de conflito ADD_REMOVE (servidor vence) e resolução manual de notas.
2. Permissões `favorite.*` no registro do backend; gerente pode ver favoritos de clientes atribuídos?
3. Coleções multi-empreendimento; arquivar automaticamente lotes vendidos (hoje: nunca).
4. Onde fica "Favoritos" no menu (Tópico 53) — não adicionado ao menu principal.
