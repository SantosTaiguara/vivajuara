# Armazenamento offline e cota

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Tela "Armazenamento offline" (`App.pwaView.storagePanel(StorageUsageViewModel)`): pacotes, situação, tamanho, última atualização, Atualizar, Remover, opção "Incluir imagens em alta resolução" e "Disponibilizar <empreendimento> offline" com a estimativa antes do download.

- `StorageUsageViewModel`: `estimatedUsageBytes`, `estimatedQuotaBytes`, `approximate: true`, `persistent`, `packs[]`. Sempre apresentado como **estimativa** (§182).
- Cota (§59, §60): `navigator.storage.estimate()` (ou o CacheQuotaManager do tópico 48) é consultada **antes** de baixar; margem de 10 % + 1 MB. Falta de espaço: "Espaço insuficiente no aparelho. São necessários cerca de X MB e há cerca de Y MB livres (estimativa)." e o botão fica desabilitado.
- Remoção atômica (§287): índice marca REMOVING (o worker deixa de usar) → cache apagado → registro removido. `maintenance()` apaga staging órfão.
- Pressão de armazenamento: a aérea (alta resolução) é opcional e a primeira a sair (política BASE_MAP_HIGH do tópico 48).
- Tamanhos reais hoje: BASIC ≈ 2,0 MB, STANDARD ≈ 2,6 MB, FULL_MAP ≈ 5,5 MB.
