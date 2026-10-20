# Semântica das distâncias

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Medida | Origem | Rótulo |
|---|---|---|
| Linha reta | Haversine (raio médio da Terra 6.371.008,8 m) entre o centro oficial e o local | "Linha reta: 5,2 km" / "Distância aproximada em linha reta" |
| De carro | Routes API, sob demanda | "De carro: 7,1 km" |
| Tempo | Routes API | "Tempo estimado: 11 min" (estimativa do provedor, não garantia) |

- Guardado em metros e segundos com precisão total; filtro antes de arredondar; exibição: < 1 km em metros, ≥ 1 km com uma casa decimal.
- "Raio de 8 km" = proximidade geográfica (linha reta). O trajeto pode passar de 8 km e não é cortado: "O local está dentro do raio de 8 km; o trajeto por vias pode ser maior."
- Nada de distância euclidiana em graus.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

Os círculos de 2, 4, 6 e 8 km do Entorno são distâncias em linha reta (círculos geodésicos na esfera de raio médio 6.371.008,8 m, projetados em Web Mercator) a partir da portaria AC3. O texto sempre diz "linha reta" e avisa que o trajeto por vias é maior.
