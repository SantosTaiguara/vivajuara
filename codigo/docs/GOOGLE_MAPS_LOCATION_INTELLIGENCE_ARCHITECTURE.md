# Arquitetura — inteligência de localização (Entorno)

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

## Duas superfícies
| Superfície | Autoridade | Tecnologia |
|---|---|---|
| Mapa de Lotes | geometria oficial (PIXEL_SPACE da planta), disponibilidade, preço, score | SVG próprio (`presentation/map.js`, `geo/*`) — **inalterado** |
| Entorno | coordenada oficial validada do empreendimento + POIs do Google em até 8 km | Maps JavaScript API (navegador) + Places API (New) e Routes API (servidor) |

O Google Maps nunca entra no mapa de lotes e não georreferencia os 498 lotes.

## Módulos
| Camada | Arquivo | Papel |
|---|---|---|
| Configuração | `src/config/surroundings/surroundings.config.js` | DevelopmentLocationConfig, raios, categorias, tabela de tipos, FieldMasks, políticas (fonte única navegador + backend) |
| Domínio | `src/surroundings/surroundingsDomain.js` | regras puras: prontidão da coordenada, raio, Haversine, pós-filtro, categorias, FieldMask, cópia, deep link, fluxo de alteração da coordenada |
| Cliente | `src/surroundings/surroundingsClient.js` | cliente das rotas semânticas, controlador de estado (transações, descarte de respostas antigas), GoogleMapsLoader, adaptador Maps JS |
| UI | `src/surroundings/surroundingsView.js` + `surroundings.css` | "Mapa de Lotes \| Entorno", estados, chips, lista acessível, ficha do local |
| Backend | `backend/src/modules/surroundings/*` | serviço, controlador, adaptadores Google, repositórios (memória + Postgres), fragmento OpenAPI |
| Banco | `backend/migrations/016_surroundings_location.sql` | versões da coordenada, fluxo de alteração, Place IDs |

## Fluxo
Navegador → `GET /api/v1/developments/:id/nearby-places?category&radius&rank` → NearbyPlacesService (tenant, empreendimento, raio, categoria, flag, coordenada, chave, limite, single-flight) → GooglePlacesProviderAdapter → GoogleHttpClient → Places API (New) → mapeamento para NearbyPlace → pós-filtro Haversine → resposta com atribuição.

Rotas: `POST /api/v1/developments/:id/route-estimates` só sob demanda, destino = Place ID retornado pela busca dentro do círculo.

## Dependência do tópico 62 (lacuna)
O tópico 62 (continuidade de negócio, backup e DR) não foi entregue. O Entorno se declara dependência externa `REFERENCE_ONLY`: queda do Google degrada só o Entorno, sem declaração de desastre. Faltam do 62: classificação formal da dependência, inclusão das tabelas da migração 016 no plano de backup e o runbook de recuperação.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

Novos módulos do chunk `surroundings`: `geoMercator.js` (projeção Web Mercator, tiles, haversine, círculos geodésicos, ajuste afim planta → KMZ), `slippyMap.js` (mapa de tiles próprio, sem biblioteca) e `entornoView.js` (superfície Entorno). O domínio expõe `baseMap`, `baseMapProvider` e `externalLinks`; a capacidade ganhou `BASE_MAP`. O caminho do Google continua igual e desligado.
