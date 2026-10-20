# Arquitetura de deploy

## Unidades de deploy

| Unidade | Conteúdo | Como é gerada | Estado |
|---|---|---|---|
| web-client | `dash/index.html` (página única), `dash/sw.js`, `manifest.json`, ícones, `planta.webp`, `aerea.webp` | `node scripts/build.js` (ORDER do harness + UI) e `scripts/build-data.js` (commercial.json, manifest.json) | publicado como estático |
| dados publicados | `lots.json`, `commercial.json`, `analysis-input.json`, `routes.json` | pipeline de dados (scripts/build-data.js; importador no backend) | versionados por manifest |
| api-backend | `plat/backend` | `npm start` (`src/server.js`); `DEPLOYMENT_V2.md` | pronto; sem ambiente provisionado aqui |
| worker | mesmo código do backend | — | não implementado |

## Ambientes

`local` (harness Node + servidor estático `serve.js` na porta 8765) → `staging` (obrigatório antes de produção; dados sintéticos ou cópia anonimizada, nunca dado de cliente real) → `production`. Produção não é staging (tópico 52 §151). Configuração por ambiente vem de variáveis (`backend/src/shared/config`); segredos nunca no frontend nem em logs.

## Release

- Metadados de release: `appVersion` do manifest (hash do build), `architectureVersion`, versões de dados (static/analysis/priceTable), versão da API (`openapi.json` 1.3.0).
- Rollback do app: republicar o build anterior (artefato estático versionado); o SW troca de versão por `CACHE_RULES`/manifest.
- Rollback de banco: só migrations com `down` testado (`backend/migrations/down`); dados mutáveis preferem roll-forward.
- Versões publicadas imutáveis simplificam rollback: reativar o ponteiro anterior.

## Backup, restore, DR

Política de backup do PostgreSQL e teste de restore são obrigatórios antes do primeiro dado mutável real (disponibilidade). RPO/RTO **não são inventados aqui**: decisão D-RPO-RTO.

## Pendências de hospedagem (D-HOSTING)

Compressão gzip/brotli (≈2,8 MB → ≈0,7 MB), cabeçalhos de cache, divisão do bundle, índice do mapa mais leve.
