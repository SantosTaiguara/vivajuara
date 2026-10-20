# Relatório — Tópico 48: Arquitetura de cache

## Entregue
- `src/cache/cacheCore.js`: CacheKey (ResourceKey + partição + schema), partição com tenant obrigatório e rejeição de tokens, registro de políticas deny-by-default, frescor técnico × frescor de negócio, `useDecision` por intenção (VIEW/SIMULATE/PROPOSE/RESERVE), rótulos pt-BR, `priceDisplay`/`availabilityDisplay`, índice de dependências, migração de schema, cache negativo, evicção, manifests, taxonomia de 12 caches físicos, NEVER_CACHED, inventário do legado.
- `src/cache/cacheManager.js`: L1 memória LRU, L2 IndexedDB `ws-cache-l2` com envelope + checksum + stage→commit + recover, ETag/304, coerência entre abas só com metadados, revalidação em foco/reconexão, purgas (logout, tenant, permissão, share, privacidade), manutenção e diagnóstico; degrada para memória sem IndexedDB.
- `src/sw.template.js` + `scripts/cacheRules.js`: regras do SW geradas do registro (comportamento preservado) e bypass de Authorization/no-store/private/opacos.
- `src/data/lifecycle.js`: invalidação por campos (não prefixo).
- `scripts/build-data.js`: analysis-input.json no manifest com checksum (28 assets).

## Garantias
Preço só sai do cache com rótulo "necessita confirmação"; propor/reservar exige preço confirmado; disponibilidade sem confirmação = "Status não confirmado"; PII, clientes, shares e tokens nunca persistidos; nada é enviado a terceiros; offline continua (ws-cache v1 intacto).

## Testes
`tests/cache.test.js`: 26 testes (24 cenários de ouro + L2 real com fake-indexeddb, integração com o coordenador, regras do SW).

## Decisões humanas
1. Hard TTL da tabela de preço em uso offline (hoje: sem limite, sempre rotulada).
2. Migração do `ws-cache` para v2 com organizationId (multi-tenant).
3. Versionar o runtime cache de `/img/` e persistir analysis-input.json offline (tópico 49).
4. Headers de cache/ETag no host estático.
