# Matriz de testes

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

| Cenário de ouro | Teste |
|---|---|
| §411 raio 12.000 → rejeitado, nenhuma chamada | backend "golden §411–§414" |
| §413/§414 8 km e 4 km chegam ao provedor | backend idem |
| §415/§416 coordenada ausente/não validada | backend "golden §415/§416"; frontend "Viva Juara" |
| §417/§418 7.999 m fica, 8.100 m sai | backend "golden §417/§418"; frontend "distance" |
| §419 queda do Places | backend "golden §419" |
| §420 queda do Routes | backend "golden §420"; frontend "§428 + §420" |
| §422 chave no navegador | frontend "security"; backend "no Google key in source" |
| §423 categoria não suportada | backend "golden §423" |
| §424/§425 maxResultCount ≤ 20, sem curinga | backend "Nearby Search (New)" |
| §426 avaliação nula | backend §417; frontend "view AVAILABLE" |
| §427 resposta vazia | backend "golden §427" |
| §428 8 → 2 km | frontend |
| §429 deep link com Place ID antigo | frontend "deep link" |
| §430 offline | frontend "loader" e "view" |
| §431 isolamento de organização | backend "golden §431" |
| §432 coordenada alterada | backend "golden §432 + §383" |
| §433/§434 cache e Place ID | backend "Place IDs only" |
| §435 atribuição | backend §417; frontend view |
| §436–§439 custo | frontend "golden §436–§439" |
| §516 corrida de respostas | frontend "race" |

Execução: `cd tests && node --test surroundings.test.js` (14) e `cd backend && node --test tests/surroundings.test.js` (23). Sem rede e sem Postgres. E2E com Google real: pendente das chaves.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

`tests/entorno.test.js` (15 testes): projeção ida e volta, índice de tile, ajuste afim nos 498 lotes (resíduos < 5 m), raio dos círculos, orçamento de tiles, estados de capacidade, links sem dados do usuário/sem chave, CSP, Service Worker, permissões, divisão de código e falha dos tiles. Navegador: `scratchpad/pw_r7.js` (320/768/1280/1700, claro e escuro; tiles falsos locais e tiles bloqueados).
