# Segurança

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

- Chave do servidor (Places + Routes): só `GOOGLE_MAPS_API_KEY` no ambiente do backend (gerenciador de segredos). Nunca no Git, no bundle, em respostas, erros ou logs (testes verificam).
- Chave do navegador (Maps JavaScript): `GOOGLE_MAPS_BROWSER_KEY`, entregue pelo deploy, restrita por referenciador HTTP e por API. Não é segredo, mas tem restrição.
- Rotas internas exigem sessão; organização vem do guard de tenancy; outra organização = 404.
- Proxy semântico: nada de `/google-proxy`, de URL, tipo Google, FieldMask ou corpo vindos do cliente. FieldMask, maxResultCount e idioma fixos no servidor.
- Limite interno por usuário (`rateLimit`, números null = recusado).
- Erros neutros, sem detalhes do provedor.
- CSP (a aplicar quando a flag ligar, sem curingas): script-src `https://maps.googleapis.com`; connect-src `https://maps.googleapis.com`; img-src `https://maps.gstatic.com https://*.googleapis.com` (conferir a lista oficial antes de produção). Places e Routes não entram no CSP do navegador, porque são chamados pelo servidor.
- Desligamento de emergência: `GOOGLE_MAPS_EMERGENCY_DISABLED=true` (tópico 60) esconde o Entorno sem afetar o mapa de lotes.
- Sem geolocalização do usuário, sem pedido de permissão de localização.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

CSP: `img-src` passou a incluir exatamente `https://tile.openstreetmap.org` (tiles do mapa de fundo do Entorno). Nada mais mudou: nenhum script de terceiros, nenhum `connect-src` novo. `evaluateCsp` marca como HIGH qualquer curinga em `img-src`, e `node scripts/securityHeaders.js --check` falha nesse caso. As origens do Google listadas acima só entram quando a flag e a chave existirem.
