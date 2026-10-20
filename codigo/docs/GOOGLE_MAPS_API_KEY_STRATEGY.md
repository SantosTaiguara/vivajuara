# Estratégia de chaves

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Chave | Variável | APIs | Restrição | Ambientes |
|---|---|---|---|---|
| maps-web-client | GOOGLE_MAPS_BROWSER_KEY | Maps JavaScript API | referenciadores HTTP do painel (localhost só na chave de desenvolvimento) | uma por ambiente |
| places-server | GOOGLE_MAPS_API_KEY | Places API (New) | API + IP de saída do servidor | uma por ambiente |
| routes-server | GOOGLE_MAPS_API_KEY (ou chave separada) | Routes API | API + IP | uma por ambiente |

Nenhuma chave existe ainda; só o Edmilson pode criar o projeto no Google Cloud. Rotação: criar nova chave, publicar no ambiente, revogar a antiga, sem trocar chaves não relacionadas. Comprometimento: desligar a chave afetada e usar o desligamento de emergência do Entorno.
