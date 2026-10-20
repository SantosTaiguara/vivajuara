# Arquitetura de navegação (Tópico 53)

> Manifesto `nav-2026-10-11.1` · gerado de `config/navigation/manifest.json` e `src/navigation/*`.

## Princípio
O menu representa **espaços de trabalho**; ferramentas aparecem no contexto. Cinco itens primários, na ordem do fluxo do corretor:
**Mapa → Encontrar → Comparar → Clientes → Empreendimento**. O Mapa é o workspace padrão (sem dashboard antes dele).

## Três níveis
| Nível | O quê | Onde mora |
|---|---|---|
| 1 — Primário | 5 workspaces | `PrimaryNavItem` (manifest.primaryItems) |
| 2 — Workspace | seções/abas de cada workspace | `WorkspaceNavDefinition` (manifest.workspaces) |
| 3 — Contextual | ações sobre lote/cliente | `ContextualActionDefinition` (manifest.contextualActions) — espelha a lista do QuickView |

## Módulos
| Arquivo | Global | Papel |
|---|---|---|
| `config/navigation/manifest.json` | `App.configs.navigation.manifest` | NavigationManifest (metadado de configuração estática, versionado) |
| `src/navigation/navigationRegistry.js` | `App.navigation.registry` | NavigationRegistry, NavigationPermissionResolver, OfflineNavCapability, NavigationPlacementResolver, regras de overflow do cabeçalho, alcançabilidade, contrato, inventário legado |
| `src/navigation/navigationService.js` | `App.navigation.state` / `.service` / `.shortcuts` | NavigationState derivado, NavigationService (plan/goToLot/goToCustomer/goBack), RouteAccessDecision, preservação de contexto, troca de empreendimento/tenant, restauração da última rota, UnsavedChangesGuard, view model, atalhos G |
| `src/navigation/menuView.js` | `App.navigation.view` | Markup do cabeçalho compacto, `applyProfile`, `update`, `bind` |
| `src/presentation/navigation.css` | — | Tokens e contêineres (topo, barra inferior, trilho). Escopo `.hd.cnav`/`html[data-nav]`: inerte até a integração |
| `scripts/navHeader.js` | — | Imprime o header para colar em `shell.html`; `--check` garante que shell = registro |

## Fluxos
```text
Rota (store.view + envelope do tópico 43) → NavigationState derivado → render (menuView.update)
Ação do usuário (data-act="nav") → NavigationService.plan → { patch, effects } → store.set → NavigationCoordinator (URL)
```
- **Não existe** `activeMenu`/`selectedView` paralelos: o workspace é derivado de `store.view` (+ gaveta Encontrar nos perfis com painel sobreposto).
- O serviço **não muta nada** e só escreve `view`/`drawerOpen`; seleção, comparação, filtros, camada, câmera e cliente são preservados por construção.
- Um único serializador de URL (o codec do tópico 43). FIND é `RESERVED` no codec; CUSTOMERS só via stateRef (sem PII na URL).

## Máquina de estados (§343)
`ROUTE_REQUESTED → CONTEXT_RESOLVED → ACCESS_CHECKED → (LOAD_PLAN_STARTED → SHELL_READY → WORKSPACE_INTERACTIVE)`.
O `NavigationTransition` registra `REQUESTED | RESOLVED | DENIED | FAILED` com `source` (PRIMARY_NAV, CONTEXT_ACTION, DEEP_LINK, BROWSER_HISTORY, SYSTEM_REDIRECT, SHORTCUT).
As etapas de carga continuam com o coordenador de carga existente (tópico 47); o menu não gerencia cache.

## Integração
Ver `NAVIGATION_INTEGRATION_RECIPE.md` (substituições exatas em `shell.html`, `app.js`, `features.json`, ORDER e lista UI do build).
