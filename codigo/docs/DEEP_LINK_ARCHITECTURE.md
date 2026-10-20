# Arquitetura de Deep Links (Tópico 43)

Deep link é um **contrato navegacional mínimo e versionado**, não um dump do estado do app. Ele pede navegação; não concede acesso, não carrega preço/disponibilidade (links LIVE resolvem o dado atual) e não carrega PII.

## Módulos

| Arquivo | Global | Papel |
|---|---|---|
| `src/deeplink/linkStateCodec.js` | `App.deeplink.codec` | enums (`DeepLinkContext`, `AppRouteCode`, `LinkPrivacyClass`, `LinkPersistenceClass`, `LinkResourceMode`, `LinkReproducibilityClass`, `LinkIntent`), `RouteRegistry`, `LinkStateRegistry` (`FIELDS`), políticas de tamanho/filtros/privacidade, aliases, migrações, `validate`, `canonicalize`, `createCodec` (`encode`/`decode`), `shareEntryState` (ShareEntryStatePolicy), inventário legado, nomes de eventos/métricas |
| `src/deeplink/linkRestoration.js` | `App.deeplink.restoration` | `restore` (síncrono), `restoreAsync` (stateRef + transação), `createTransactions`, `eventsFor`, `createMetrics` |
| idem | `App.deeplink.references` | `LinkStateReferenceService` de referência (em memória; contrato do backend) |
| idem | `App.deeplink.navigation` | `NavigationHistoryPolicy` + `NavigationCoordinator` |
| idem | `App.deeplink.service` | `LinkStateExtractor` (perfis allow-list) + `LinkStateService.createLink` (copiar link interno; EXTERNAL_SHARE delega ao ShareService) |

Todos são puros em relação ao app: nenhum lê o DOM, o store ou a rede por conta própria; tudo é injetado (`deps`).

## Fluxo de geração

```
ApplicationState → LinkStateExtractor (perfil) → split (sensível × inline)
  → LinkStateValidator → LinkCanonicalizer → inline (#hash) | stateRef (?s=LS…)
```

## Fluxo de abertura

```
location.hash → codec.decode (parse → migrate → validate; sem efeitos colaterais)
  → restoration.restore / restoreAsync (autoriza, resolve, ordem do §43, restauração parcial)
  → finalAppStatePatch (chaves explícitas do store) + hints (viewport, seção da comparação, step)
```

## Interno × externo

* **Link interno** (`INTERNAL`/`BOOKMARK`): hash do painel, LinkStateService.
* **Link externo** (`SHARE_ENTRY`): sempre `/s/<token>` do ShareService (tópico 42). O codec se recusa a escrever links SHARE_ENTRY; parâmetros anexados a um `/s/<token>` passam por `shareEntryState` e só podem restringir o escopo do grant.

## Distinções obrigatórias (§141)

| Conceito | Onde |
|---|---|
| INTERNAL ROUTE | `ROUTES` (`MAP`, `LOT`, `COMPARE`, `PRESENTATION`) |
| INTERNAL DEEP LINK | `#<dev>…?v=1…` gerado por `encode` |
| BOOKMARK | `LinkIntent.BOOKMARK` / contexto `BOOKMARK` (sem nova fronteira de segurança) |
| STATE REF | `?s=LS…`, `App.deeplink.references` (autenticado, nunca público) |
| EXTERNAL SHARE LINK | `/s/<token>` (tópico 42) |
| SHARE ENTRY STATE | `codec.shareEntryState` sobre `ShareEntryPoint.initialViewState` |
| LIVE RESOURCE | rotas MAP/LOT/COMPARE (`resourceMode: LIVE`) |
| SNAPSHOT RESOURCE | PRESENTATION / SHARED_PRESENTATION (`resourceMode: SNAPSHOT`) |
| NAVIGATIONAL STATE | o envelope |
| DOMAIN STATE | repositórios (nunca na URL) |
| TRANSIENT UI STATE | `navigation.TRANSIENT_KEYS` (nunca na URL) |
