# Controle de custo

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Alavanca | Implementação |
|---|---|
| Carga preguiçosa do mapa | loader só ao abrir Entorno |
| Categoria sob demanda | abrir Entorno = 0 chamadas Places; uma categoria = 1 chamada |
| FieldMask mínimo | 8 campos; avaliações, horários, telefone e site proibidos |
| maxResultCount | ≤ 20 |
| Rota sob demanda | 1 rota por clique |
| Single-flight | navegador e servidor |
| Descarte de respostas antigas | AbortController + transação |
| Cota interna | rateLimit (números a definir) |
| Telemetria | contadores places_requests, routes_requests, places_errors, routes_errors, maps_config_requests e ProviderUsageMetric por hora |

Sem preço no código: o faturamento do Google Cloud é a autoridade. Orçamentos e alertas de faturamento devem ser configurados no console (operacional). Observação: avaliação e contagem de avaliações podem colocar a busca num SKU mais caro; avaliar se continuam no FieldMask.
