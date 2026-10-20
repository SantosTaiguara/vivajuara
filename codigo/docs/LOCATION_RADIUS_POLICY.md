# Política de raio

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

- Máximo do produto: **8.000 m** (regra explícita da especificação). O máximo técnico do Google (50.000 m) nunca é usado.
- Raios permitidos: 2.000, 4.000, 6.000 e 8.000 m.
- `effectiveRadius = min(requested, development.maxNearbyRadiusMeters)`, mas um valor fora da lista é **rejeitado** (422 LOCATION_RADIUS_INVALID, motivo INVALID_RADIUS), nunca ajustado em silêncio: 9.000, 12.000, 3.000, 0, negativos, decimais e texto.
- O raio escolhido vai direto ao Google (2 km → radius 2000), não 8 km com filtro no cliente.
- Configuração acima do aprovado (ex.: 10 km) → GOOGLE_MAPS_NOT_CONFIGURED até nova versão aprovada da configuração.
- O círculo no mapa é comunicação; a regra vale no servidor. O círculo não é editável nem arrastável.
- Tolerância do pós-filtro: 1 m (ponto flutuante), limitada a 5 m no código.
