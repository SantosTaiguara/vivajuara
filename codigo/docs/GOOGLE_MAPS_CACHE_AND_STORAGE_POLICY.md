# Cache e armazenamento

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Conteúdo | Modo | TTL |
|---|---|---|
| Place ID | PLACE_ID_ONLY (tabela `surroundings_place_refs`) | sem expiração definida; renovação de IDs antigos = null (necessita confirmação) |
| Resultado de busca (nome, posição, endereço, tipos, avaliação) | NO_PERSIST | — |
| Estimativa de rota | NO_PERSIST | — |
| Avaliações escritas | não solicitadas | — |
| Tiles | NO_PERSIST | — |

Sem cache de resultados no servidor até a revisão dos termos; só deduplicação de requisições em andamento. Chaves de cache (quando houver) incluem organização, empreendimento, versão da coordenada, categoria, versão da categoria, raio, ordem e provedor. No navegador: nada em localStorage/IndexedDB, Service Worker não guarda respostas do Google. Configuração do mapa pode ser cacheada (versionada).

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

Tiles OpenStreetMap: nenhum armazenamento próprio. O Service Worker não trata pedidos de outra origem; o navegador só usa o cache HTTP normal. Só os tiles visíveis mais 1 anel são pedidos, sem pré-carga nem download em massa.
