# Qualidade de dados

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Regra | Verificação | Viva Juara hoje |
|---|---|---|
| LI-DQ-001 | centro validado com proveniência | **falha** (sem coordenada oficial) |
| LI-DQ-002 | -90 ≤ latitude ≤ 90 | não se aplica |
| LI-DQ-003 | -180 ≤ longitude ≤ 180 | não se aplica |
| LI-DQ-004 | raio máximo ≤ 8.000 m e igual ao aprovado | ok |
| LI-DQ-005 | cada resultado dentro do raio efetivo (pós-filtro) | por requisição |
| LI-DQ-006 | categoria usa só tipos oficiais | ok (12 categorias) |
| LI-DQ-007 | destino da rota é um local retornado no círculo | por requisição |

Resultado sem Place ID, nome ou posição é descartado. Função: `App.surroundings.domain.dataQuality(developmentId)`.
