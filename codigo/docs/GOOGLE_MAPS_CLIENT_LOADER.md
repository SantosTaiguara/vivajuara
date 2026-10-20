# GoogleMapsLoader (navegador)

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

`App.surroundings.client.loader({ document, capability, browserKey, mapId })`:
- só injeta o script quando `capability.GOOGLE_MAPS_ENVIRONMENT` é verdadeiro (flag ligada, coordenada validada, chave de navegador provisionada); senão devolve `GOOGLE_MAPS_LOCATION_UNVERIFIED` ou `GOOGLE_MAPS_NOT_CONFIGURED` sem tocar no DOM;
- singleton com single-flight: duas chamadas = um script;
- `https://maps.googleapis.com/maps/api/js?key=…&v=weekly&libraries=marker&language=pt-BR&region=BR&loading=async&callback=…`;
- falha ou tempo esgotado liberam nova tentativa manual;
- nunca carrega no login, no mapa de lotes nem na página de clientes: o integrador chama `load()` só quando a aba Entorno é aberta.

Adaptador `mapView`: marcador do empreendimento (◎, separado dos POIs), `Circle` com `editable/draggable/clickable = false`, `fitBounds` do envelope do raio com padding, `restriction.latLngBounds` = envelope de 8 km, `strictBounds` da política, marcadores derivados do estado (sem duplicar), clique no marcador seleciona o card, `destroy()` libera listeners. Sem TrafficLayer, sem Street View, sem autocomplete.
