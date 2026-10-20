# Segurança, privacidade e compartilhamento de favoritos (Tópico 38)

- Favorito nunca é autorização; localStorage/IndexedDB nunca concedem acesso. Principal (organizationId, userId, developmentId) validado na criação do serviço.
- Isolamento: namespace por tenant + usuário; mesmo usuário em duas organizações → namespaces separados; consulta de outra organização → FAVORITE_TENANT_MISMATCH;
  de outro usuário → FAVORITE_PERMISSION_DENIED sem `favorite.readOthers` (negado por padrão; gerente não vê favoritos pessoais sem política).
- Coleção de outro tenant não é encontrada (sem vazar existência). Nenhuma contagem global de popularidade é exposta.
- Sem PII: contextRef aceita apenas ids opacos; nomes de cliente ficam só no label de UI. Notas são conteúdo interno: fora de eventos, logs, URLs,
  projeções CLIENT/SHARE e do snapshot compartilhado. Eventos carregam organizationId, userId, developmentId, favoriteId, lotId, contextType, source/collectionId, timestamp.
- Projeções: INTERNAL (notas e contexto), CLIENT/SHARE (somente informação segura do lote, sem favoriteId, sem ref de contexto, sem ações), TECHNICAL (revisões e syncState).
- Compartilhamento: `shareProjection(collectionId)` exige visibilidade não-PRIVATE (ou `explicit`) e gera snapshot `{ title, snapshotChecksum, items[lotId, sortOrder] }` — sem ownerUserId, sem notas. ShareService (Tópico 42) decide o envio.
- Links: favoritos não vão para a URL (o filtro `favoritesOnly` já é omitido da serialização); deep link de coleção futura deve usar id opaco e exigir autorização.
- Logout: `dispose({ purge: true })`; troca de tenant: novo serviço, projeção anterior descartada.
