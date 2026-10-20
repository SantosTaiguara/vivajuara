# Revalidação HTTP (ETag / 304) (Tópico 48)

- O loader recebe `{etag, lastModified}` da entrada existente e envia `If-None-Match` / `If-Modified-Since`.
- Resposta 304 → loader devolve `envelope(null, {notModified: true})`; o CacheManager atualiza `validatedAt` sem reescrever o valor (DomainFreshness passa a "confirmado").
- 200 → novo valor passa por checksum e stage→commit.
- Hosts estáticos sem ETag: cai para comparação por checksum do manifest.
- Reconexão (`onReconnect`) e foco (`FocusRevalidationPolicy`, com intervalo mínimo) marcam NETWORK_FIRST/SWR como devidos (`markDueForRevalidation`) — preço e disponibilidade revalidam primeiro.
