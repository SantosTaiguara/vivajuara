# Observabilidade e diagnóstico (Tópico 48)

- `Metrics`: hits/misses/stale/revalidações/304/evicções/corrupções/bytes por tipo — contadores locais, não enviados a lugar nenhum (integração com analytics 44/45 só com flag OFF e decisão humana).
- `CacheManager.inspect()`: lista tipo, partição (escopo apenas), versão, frescor, tamanho — sem valores.
- `LoadCoordinator.diagnostics()`: estado por recurso, in-flight, filas, desperdício de prefetch.
- `isDegraded()` indica L2 indisponível.
