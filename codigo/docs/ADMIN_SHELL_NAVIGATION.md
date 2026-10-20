# ADMIN_SHELL_NAVIGATION — Shell administrativo e navegação

> Tópico 60. Código: `src/backoffice/*`, `src/config/backoffice/backofficeConfig.js`, `backend/src/modules/backoffice/*`, migração `014_backoffice_admin`. Testes: `tests/backoffice.test.js`, `backend/tests/backoffice.test.js`. Valores de política ainda não decididos ficam `null` ("necessita confirmação") e o código recusa enquanto isso.

- `AdminNavigationRegistry` = `App.backoffice.navigation.getItems({ context })`, a partir de `backofficeConfig.navigation` (13 áreas da §14 + Aprovações).
- Cada item exige **todas** as permissões em `requiredPermissions` (sempre `backoffice.access` + a da área). Chave desconhecida = negada.
- Visitante anônimo / painel estático: `entryVisible() === false`, `getItems() === []`, nenhuma entrada aparece.
- `routeAccess(route)`: só rotas `/admin/...` com segmentos seguros; rota desconhecida = negada. A rota nunca é autorização: o servidor revalida (`GET /api/v1/admin/backoffice/navigation`).
- Cabeçalho do tenant sempre visível: "Organização ativa: House 7 Imóveis" (`shellContext().tenantLabel`), não só por cor.
- Badges apenas operacionais (`badgeSource`), nunca para áreas sem acesso (§514).
