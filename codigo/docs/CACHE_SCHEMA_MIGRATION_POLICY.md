# Migração de schema (Tópico 48)

- O schema faz parte da `CacheKey`; mudar o formato do valor = nova chave.
- `SchemaMigrationRegistry.register(type, from, to, fn)`; `sourcesFor(type, to)` diz quais schemas antigos podem ser migrados.
- Leitura: sem entrada no schema atual → procura nos schemas de origem → migra → grava no novo → remove o antigo. Migração que falha → INVALID (recarrega da rede). Sem migração registrada → MISS.
- `maintenance('APP_UPDATE')` remove órfãos de schemas não registrados.
- `ws-cache` v1 legado não é tocado (teste fixa versão 1 com 6 stores); migração v2 com organizationId é decisão adiada.
