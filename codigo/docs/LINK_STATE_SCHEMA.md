# Schema do estado de link (`LinkStateEnvelope`)

```ts
interface LinkStateEnvelope {
  schema: 'link-state'; version: 1;            // CURRENT_VERSION
  context: 'INTERNAL' | 'SHARE_ENTRY' | 'PRESENTATION' | 'BOOKMARK';
  route: 'MAP' | 'LOT' | 'COMPARE' | 'PRESENTATION' | 'CUSTOMER' | 'JOURNEY' | 'FIND' | 'SHARED_PRESENTATION' | 'DEVELOPMENT';
  resource?: { type: 'DEVELOPMENT' | 'LOT' | 'COMPARISON' | 'PRESENTATION' | 'CUSTOMER' | 'JOURNEY' | 'SHARE'; id: string };
  state?: LinkStatePayload;   // pequeno e seguro
  stateRef?: string;          // LS + 6–32 alfanuméricos; exclusivo com branches de estado inline (só rota/recurso convivem)
  resourceMode?: 'LIVE' | 'SNAPSHOT';
}
```

## Branches (`BRANCH_KEYS` — qualquer outra chave é rejeitada)

| Branch | Chaves | Privacidade | Inline? |
|---|---|---|---|
| development | developmentId | INTERNAL | sim (path) |
| lot | selectedLotId, focusedLotId | INTERNAL | sim (path; código curto B79 ou id canônico) |
| ui | panel (`details`/`simulation`/`solar`), detailSection, workspaceMode | INTERNAL | sim (sufixo do path) |
| map | layerId, baseMapMode, overlays, scoreKey, viewport {centerX, centerY, zoom} | INTERNAL | sim |
| filters | filterSchemaVersion, values (FilterState do registry), mode, presetId | INTERNAL | sim, exceto aderência (ft/fc/fq), texto livre não-código e favoritos |
| comparison | candidateLotIds (2–4, ordem preservada), activeSectionId, comparisonId, profileId | INTERNAL | sim |
| presentation | snapshotId, stepId, lotId, mode | INTERNAL | sim (snapshotId `prs_…`, step `stN`); sessionId nunca |
| customer | customerId (`cus_…`), profileVersionId | SENSITIVE | **não** — só em stateRef |
| journey | journeyId (`jny_…`) | SENSITIVE | **não** — só em stateRef |

Não existem: matriz de comparação, vencedores, ranking, preço, disponibilidade, perfil do cliente, notas, larguras de painel, snap do sheet, scroll, coordenadas de tela.

## Filtros

O URL usa a forma compacta do `App.filters` (tópico 17): `f=<chave curta>:<valor>;…` codificado. Na restauração os valores passam por `App.filters.compile` (fieldKey e operador vêm do FilterRegistry; nada de expressão livre, JS ou SQL). Condições inválidas viram `FILTER_REMOVED`; filtros TECHNICAL só em contexto INTERNAL/BOOKMARK.

## Viewport

Em **unidades do mapa** (`centerX`, `centerY`, `zoom`), nunca pixels. Só na rota MAP (com lote em foco é redundante e é removido). Fora do quadro do empreendimento → `VIEWPORT_RESET`. Observação: `store.mapViewport` é uma transformação de tela e **não** é extraído; o chamador passa o centro em unidades do mapa (`viewport` em `extract`).
