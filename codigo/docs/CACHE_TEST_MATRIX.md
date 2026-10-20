# Matriz de testes — cache (Tópico 48)

Arquivo: `tests/cache.test.js` (26 testes). Cobre os 24 cenários de ouro da especificação:
chaves/partição (token rejeitado), deny-by-default, registry sem SENSITIVE persistido, IMMUTABLE por versão, troca de checksum → nova chave + órfão removido, preço NETWORK_FIRST com rótulo offline, PROPOSE bloqueado com preço stale, disponibilidade UNKNOWN permanece, null ≠ 0, SWR, ETag/304, stage→commit com crash, corrupção detectada, migração de schema (ok / falha / ausente), quota/evicção sem despejar críticos, logout/tenant/permissão/share/privacidade, coerência entre abas sanitizada, reconexão/foco, invalidação seletiva por dependência, degradação sem IndexedDB.
Extras: L2 real com `fake-indexeddb`, integração LoadCoordinator+CacheManager, manifests, diagnósticos, regras do SW geradas.
