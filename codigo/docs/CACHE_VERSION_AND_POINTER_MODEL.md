# Versões e ponteiros (Tópico 48)

- `manifest.json` é o **ponteiro**: lista 28 assets com checksum (inclui agora `analysis-input.json`, adicionado em `scripts/build-data.js`).
- `resourceVersionManifest(manifest)` → mapa tipo→versão; `versionEvents(old, new)` → eventos `VERSION_CHANGED{type, from, to}` que alimentam a invalidação seletiva.
- Recursos imutáveis são endereçados por versão: trocar o checksum gera **outra chave**; a anterior vira órfã e é removida em `maintenance('APP_UPDATE')`.
- 404 em recurso versionado → atualizar ponteiro uma vez (LoadCoordinator `hooks.refreshPointer`).
- `cacheManifest()` descreve o que existe em cache (tipos, versões, tamanhos) para diagnóstico — sem valores.
