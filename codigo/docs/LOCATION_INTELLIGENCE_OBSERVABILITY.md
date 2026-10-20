# Observabilidade

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Contadores do serviço: maps_config_requests, places_requests, routes_requests, places_errors, routes_errors, places_single_flight_hits, google_places_request_total, google_routes_request_total, google_provider_error_total; amostras de latência por serviço; ProviderUsageMetric { provider GOOGLE_MAPS, service, organizationId, developmentId, requestCount, timestampBucket por hora }.

Logs: requestId, developmentId, categoryCode, errorCode, removidos pelo pós-filtro. Nunca chave, resposta completa do provedor, nome de local ou localização de usuário.

Eventos de produto (tópico 45, ainda não registrados): environment_map_opened, nearby_category_selected, nearby_radius_selected, nearby_place_selected, route_estimate_requested — só categoryCode e radiusBucket.

Alertas sugeridos (limiares a definir): taxa de erro Places/Routes, falha de autorização, cota esgotada, pico de uso. Nada de alerta por um único timeout. Integração com o registro de métricas do tópico 51 pendente.
