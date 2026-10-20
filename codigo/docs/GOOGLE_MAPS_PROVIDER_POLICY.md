# Política do provedor (Google Maps Platform)

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

ProviderPolicyVersion na configuração: reviewedAt **null**, reviewedBy null, termsVersionRef null, nextReviewAt null → **necessita confirmação**. Enquanto null, o servidor recusa chamadas ao Google (GOOGLE_MAPS_NOT_CONFIGURED). Isto não é aconselhamento jurídico.

Fatos técnicos considerados (revisar antes de produção): Nearby Search (New) é POST, exige FieldMask, usa `locationRestriction.circle` com raio em metros (máximo técnico 50.000 m), maxResultCount de 1 a 20, rankPreference DISTANCE ou POPULARITY. Circle e restriction da Maps JS usam metros e latLngBounds. computeRoutes devolve distanceMeters, duration e polyline conforme a máscara. Place IDs são isentos das restrições de cache.

Documentos a revisar: Security Guidance, Map Restrictions, Circle/Shapes, Nearby Search (New), Policies and Attributions, Place IDs, Compute Routes, Field Masks, Termos e faturamento.

Proibido: scraping, banco permanente de dados Google, arquivo de avaliações, tiles próprios offline.
