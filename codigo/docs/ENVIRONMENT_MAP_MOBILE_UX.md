# UX móvel do Entorno

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Abaixo de 760 px: mapa (300 px) → chips de raio → chips de categoria com rolagem lateral → lista → ficha do local. A lista funciona como a folha inferior; a integração com `mobile/sheet.js` (tópico 21) fica para o integrador. Alvos de 44 px, sem pedido de localização, gesto "cooperative" no mapa para não prender a rolagem da página.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

Em telas estreitas (< 600 px) o cartão do Entorno abre recolhido (título, "Mostrar detalhes", os dois links do Google Maps) para deixar espaço ao mapa; a folha inferior do lote continua por cima. Arrastar com um dedo move, pinça muda o zoom em passos inteiros, botões de 44 px.
