# Política de histórico de navegação

`App.deeplink.navigation`

| Classe | Exemplos | Ação |
|---|---|---|
| NAVIGATIONAL | troca de rota, seleção de lote, abrir comparação, cliente, step de apresentação, stateRef | `pushState` |
| STATEFUL_REPLACE | camada, base, overlays, filtros | `replaceState` imediato |
| STATEFUL_REPLACE (viewport) | pan/zoom | `replaceState` com debounce (300 ms) |
| TRANSIENT | hover, tooltip, arraste do sheet, resize de painel, destaque, drawer, modal | nada na URL (`TRANSIENT_KEYS`) |
| NON_URL | preferências, favoritos, simulação, opacidades, modo de apresentação | só estado local (`NON_URL_KEYS`) |

`NavigationSource`: `USER_ACTION`, `URL_RESTORE` (replace canônico, sem push), `BROWSER_HISTORY` (nunca escreve; evita push recursivo no popstate), `PROGRAMMATIC`.

## NavigationCoordinator

```js
const nav = App.deeplink.navigation.createCoordinator({ history, location, encode: e => App.deeplink.codec.encode(e), pushNavigational: !isSmall() });
nav.update(envelope, { source })   // → { action: 'PUSH' | 'REPLACE' | 'REPLACE_DEBOUNCED' | 'NONE' }
```

* 100 arrastos de mapa = 0 entradas novas (teste).
* Back retorna ao lote anterior; reload restaura o mesmo estado semântico.
* **Telas pequenas**: o app já mantém um marcador de "voltar" próprio (tópico 21, `ensureBackMarker`). Para não haver dois mecanismos de push, a recomendação é `pushNavigational: false` em telas pequenas (só replace), até validação humana.
