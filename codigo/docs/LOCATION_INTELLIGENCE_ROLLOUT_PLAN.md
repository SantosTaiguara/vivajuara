# Plano de implantação

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

Flag `location_intelligence_google_maps` (configuração, DESLIGADA). Etapas: administradores internos → corretores selecionados → House 7 → futuros clientes. Reverter = desligar a flag; nenhum dado central precisa ser revertido; o mapa dos 498 lotes não muda.

Pré-requisitos para ligar, nesta ordem:
1. coordenada oficial do Viva Juara validada (DevelopmentLocationChange publicado);
2. projeto Google Cloud, chaves de navegador e servidor com restrições, orçamento e alertas;
3. revisão dos termos (providerPolicy.reviewedAt);
4. números de limite (rateLimit);
5. política de aprovação da coordenada (requireDistinctApprover);
6. integração das rotas no backend (app.js, permissões, erros, OpenAPI) e da aba no painel;
7. CSP com as origens do Google;
8. concessão da permissão `development.location_environment.read` aos papéis decididos.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

Etapa antecipada por decisão do proprietário: o mapa de fundo sem chave (OpenStreetMap) está ligado para todos. As etapas do Google (Places, Routes, Maps JS) continuam como acima, com a flag desligada.
