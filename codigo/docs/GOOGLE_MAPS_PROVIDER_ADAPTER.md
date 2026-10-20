# Adaptador do provedor Google

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Interfaces: ExternalMapProvider (`getMapRuntimeConfig`), NearbyPlacesProvider (`searchNearby`), RouteProvider (`computeRoute`), em `backend/src/modules/surroundings/google.provider.js`.

- **GoogleHttpClient**: único ponto HTTP. Base URL, `X-Goog-Api-Key` lido de `GOOGLE_MAPS_API_KEY` a cada chamada, `X-Goog-FieldMask` obrigatório (curinga recusado), timeout, nova tentativa limitada, mapeamento de erros, telemetria. Transporte injetável (testes usam um Google falso).
- **GooglePlacesProviderAdapter**: monta o corpo de `places:searchNearby` (includedTypes da categoria, maxResultCount ≤ 20, `locationRestriction.circle`, rankPreference, pt-BR, BR) e mapeia `GoogleNearbySearchResponse` → `NearbyPlace`. Nomes de campos do Google ficam aqui.
- **GoogleRoutesProviderAdapter**: `directions/v2:computeRoutes`, origem = centro oficial, destino = Place ID, DRIVE, converte "754s" em segundos.
- **GoogleMapsProviderAdapter**: configuração de execução do mapa, sem chave.

Ausente no provedor → ausente no DTO (avaliação nunca vira 0, endereço nunca é inventado).
