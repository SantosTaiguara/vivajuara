# NearbyPlacesService

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

`GET /api/v1/developments/:developmentId/nearby-places?category=SUPERMARKETS&radius=4000&rank=DISTANCE` — permissão `development.location_environment.read`.

Ordem das verificações (qualquer falha = zero chamadas ao Google):
1. organização resolvida pelo guard de tenancy (nunca enviada pelo cliente); empreendimento de outra organização → 404 DEVELOPMENT_NOT_FOUND;
2. query só com category, radius, rank (outro parâmetro → 400);
3. raio da lista → senão 422 LOCATION_RADIUS_INVALID (`details.reason = INVALID_RADIUS`);
4. categoria do registro → senão 422 LOCATION_CATEGORY_UNSUPPORTED;
5. flag, empreendimento habilitado, coordenada VALIDATED, raio máximo aprovado;
6. chave do servidor, limites de requisição e revisão dos termos configurados → senão 503 GOOGLE_MAPS_NOT_CONFIGURED com `details.missing`;
7. limite interno; single-flight por (organização, empreendimento, versão da coordenada, categoria, versão da categoria, raio, ordem);
8. chamada, mapeamento, pós-filtro, ordenação, gravação só dos Place IDs.

Resposta NearbyPlacesResult: developmentId, center, locationVersion, requestedRadiusMeters, effectiveRadiusMeters, maxRadiusMeters, categoryCode, categoryVersion, rankPreference, resultLimit, resultCount, places, provider, generatedAt, freshness, persisted=false, summaryText, attribution. Nunca a chave.
