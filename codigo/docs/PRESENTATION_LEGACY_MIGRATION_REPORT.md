# Relatório de Migração do Legado — Apresentação

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

Inventário em `runtime.LEGACY_INVENTORY`:

| Local | Comportamento | Classificação | Ação |
|---|---|---|---|
| `presentation/app.js` togglePresentation + `store.presentationView` | Botão "Apresentar" põe o painel em modo cliente | UI_ONLY (payload completo na página) | REUSE_UI |
| `config/presentation.js` hiddenFields/hiddenSections | deny-list de campos | CLIENT_SAFE_PROJECTION | REUSE_UI, agora com allow-list (`clientSafeFields`) |
| classes `ws.client/ws.pres/ws.tech` | CSS esconde controles | UI_ONLY | REVIEW (não é segurança) |

## Mudança feita
`src/config/presentation.js` (aditiva): `clientDenyByDefault: true`, `clientSafeFields` (100 chaves). `isFieldVisible` checa a allow-list antes da `hiddenFields`. Resultado visual idêntico; os testes existentes continuam passando.

## Não alterado
`store.js` (`presentationView`/`presentationMode`), `app.js`, `panels.js`, `overlays.js`, `shell.html`, `build.js`, `features.json`.

## Próximos passos
1. Registrar `presentationView.js` no build e plugar as actions `pm*` em `app.js`.
2. Fazer o botão "Apresentar" abrir um snapshot (template SHORTLIST com favoritos), mantendo o modo atual como fallback.
3. Backend: tabelas e endpoints (ver RELATORIO_TOPICO_41.md).
