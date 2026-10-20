# Escrita atômica e integridade (Tópico 48)

`PersistentCacheStore.write`: grava em `stage:<key>` → valida checksum → `commit` move para a chave final e remove o stage. Um crash entre as etapas deixa só stage, que `recover()` descarta no APP_START — o leitor nunca vê meio-escrito.

- Checksum (hash canônico) verificado em toda leitura L2; divergência → entrada INVALID, removida, recarregada da rede (`corruption recovery`).
- Falha de IndexedDB (quota, modo privado) → `isDegraded()` = true, operação segue só com L1; o app continua funcionando.
- Hooks de teste: `interruptAfterStaging`, `crashOnCommit`, `memoryKv._failNext`.
