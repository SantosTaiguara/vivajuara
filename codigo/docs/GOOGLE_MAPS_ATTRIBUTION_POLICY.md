# Atribuição

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

- O mapa do Google mantém logotipo e atribuições padrão (nenhuma opção remove).
- A lista fora do mapa mostra "Dados de locais: Google Maps" em toda resposta de busca e rota (`attribution` no DTO).
- Avaliação é dado do provedor: "A avaliação é do provedor e não é recomendação da plataforma." Nada de "melhor supermercado".
- Pontos curados (CuratedLocationPoint: Lagoa do Juara, Mestre Álvaro) seriam outra fonte, com proveniência própria; não implementados nesta fase.
- Revisar o texto exato de atribuição exigido pela política vigente antes de produção.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

O mapa de fundo OpenStreetMap mostra sempre "© OpenStreetMap contributors" com link para https://www.openstreetmap.org/copyright (exigência da política de tiles da OSMF). A atribuição "Dados de locais: Google Maps" só se aplica quando houver resultados do Google.
