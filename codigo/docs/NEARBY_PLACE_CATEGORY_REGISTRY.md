# NearbyPlaceCategoryRegistry

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Tipos conferidos em 16/10/2026 na tabela oficial "Place types (New)", tabela A (página atualizada em 13/10/2026): https://developers.google.com/maps/documentation/places/web-service/place-types

| Código | Rótulo | Tipos Google | Versão |
|---|---|---|---|
| SUPERMARKETS | Supermercados | supermarket, grocery_store | 1 |
| SCHOOLS | Escolas | school, primary_school, secondary_school, preschool | 1 |
| HEALTH | Hospitais e clínicas | hospital, medical_clinic | 1 |
| PHARMACIES | Farmácias | pharmacy, drugstore | 1 |
| SHOPPING_COMMERCE | Comércio e shopping | shopping_mall, department_store | 1 |
| RESTAURANTS | Restaurantes | restaurant | 1 |
| GYMS | Academias | gym, fitness_center | 1 |
| PARKS_LEISURE | Parques e lazer | park | 1 |
| BEACHES | Praias | beach | 1 |
| GAS_STATIONS | Postos de combustível | gas_station | 1 |
| BANKS | Bancos e caixas eletrônicos | bank, atm | 1 |
| PUBLIC_TRANSPORT | Transporte público | bus_station, bus_stop, transit_station, train_station | 1 |

Regras: uma categoria com tipo fora da tabela fica DISABLED_INVALID_TYPES (LI-DQ-006) e o tipo nunca é enviado; o cliente envia só o código da categoria; maxResults ≤ 20; uma categoria por vez; mudança de tipos = nova `version` (entra na chave de cache). Saúde foi separada em "Hospitais e clínicas" e "Farmácias".
