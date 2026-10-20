# RouteEstimateService

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

`POST /api/v1/developments/:developmentId/route-estimates` com `{ providerPlaceId, travelMode: "DRIVE", trafficMode? }`.
- Só sob demanda (botão "Calcular trajeto"); uma rota por interação; nenhuma rota ao buscar ou ao selecionar.
- Destino tem de ser um Place ID que uma busca deste empreendimento devolveu dentro do círculo, na versão atual da coordenada (LI-DQ-007); senão 422 LOCATION_PLACE_NOT_IN_SCOPE.
- Origem = centro oficial (nunca usuário ou cliente). FieldMask `routes.distanceMeters,routes.duration` (polilinha desligada).
- Resposta: routeSummary { mode DRIVE, distanceMeters, durationSeconds, trafficAware, computedAt }, labels "De carro" e "Tempo estimado", persisted=false.
- Falha: GOOGLE_ROUTES_UNAVAILABLE / QUOTA_EXCEEDED; o local continua visível com a distância em linha reta.
- Exige `routesEnabled` e `rateLimit.routesRequestsPerMinute` configurados.
