# DevelopmentLocationConfig

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Campos (config `developments['viva-juara'].location`): developmentId, organizationId (`org_house7`), center, maxNearbyRadiusMeters (8000), locationStatus (UNVERIFIED | VALIDATED | REJECTED), sourceRef, validationMethod (OFFICIAL_GEOREFERENCE | OFFICIAL_KML_KMZ | OFFICIAL_COORDINATE | MANUAL_CONFIRMED | GEOCODED_AND_CONFIRMED), validatedBy, validatedAt, googleMapsEnabled, version.

## Estado atual do Viva Juara
`center: null`, `locationStatus: UNVERIFIED`, `version: loc-0`. A interface mostra: **"Coordenada oficial do empreendimento ainda não validada."**

## Prontidão (`locationReadiness`)
Só é VALIDATED quando há status VALIDATED, centro dentro das faixas (LI-DQ-002/003) e proveniência completa (fonte, método, quem, quando). Qualquer falta → NOT_VALIDATED e nenhuma chamada ao provedor.

## DevelopmentLocationIntelligenceConfig
enabled (false), maxRadiusMeters 8000 = approvedMaxRadiusMeters, selectableRadiiMeters [2000, 4000, 6000, 8000], enabledCategoryCodes (12), defaultCategoryCode null (carga preguiçosa), routesEnabled false, integrações com Recomendação/Apresentação false.

## MapViewportPolicy
initialFitMode RADIUS_BOUNDS, strictBounds false (testar UX antes de ligar), padding 48 px (computador) / 16 px (celular), minZoom/maxZoom não definidos.
