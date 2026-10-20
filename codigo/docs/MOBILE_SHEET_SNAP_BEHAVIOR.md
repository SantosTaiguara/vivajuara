# Bottom sheet móvel: estados e snaps

Tópico 21. Configuração e funções puras em `plat/src/mobile/sheet.js` (`SNAP_CONFIG`, `BEHAVIOR`, `heights`, `resolveSnapTarget`, `next`, `onLotSelect`, `onMapDrag`, `onMapTapEmpty`, `keyboardAdjust`, `orientationOf`); aplicação em `plat/src/presentation/app.js` (`applySheetHeight`, `sheetHeights`, `sheetEnv`, `selectLot`, ações `sheetUp`/`sheetDown`/`panel`). Arquitetura em `MOBILE_BOTTOM_SHEET_ARCHITECTURE.md`.

## 1. Estados

| Estado | Store (`sheet`) | Altura | Uso na aplicação |
|---|---|---|---|
| `HIDDEN` | — | 0 | não usado |
| `MINIMIZED` | `min` | faixa baixa (88 a 132 px): alça e começo do cabeçalho do lote; sem lote, a orientação do estado vazio | sim |
| `INTERMEDIATE` | `mid` | cerca de metade da área do mapa | sim |
| `EXPANDED` | `full` | quase toda a área, com uma faixa do mapa sempre visível | sim |

O conteúdo não muda entre os snaps: é sempre o painel atual (Quick View, detalhes, simulação ou sol), e só a altura visível muda, com rolagem própria em `.rp`. `EXPANDED` não é a tela de detalhes: os detalhes são um painel (`panel = details`) dentro da mesma folha.

## 2. Alturas relativas

`SNAP_CONFIG` (unidade `VIEWPORT_FRACTION`):

| Chave | Retrato | Paisagem (`orientationOverrides.landscape`) |
|---|---|---|
| `minimized` | 0,16 da altura, entre 88 e 132 px (`minimizedMinPx`, `minimizedMaxPx`) | 0,26, mesmos limites |
| `intermediate` | 0,48 | 0,62 |
| `expanded` | 0,88 | 0,92 |
| `minMapVisibleHeight` | 64 px de mapa sempre visíveis | 64 px |
| `keyboardBehavior` | `KEEP_SNAP_CLAMP_TO_VISUAL_VIEWPORT` | igual |

`heights(h, { orientation, safeAreaBottom })`:

- `MINIMIZED` = `round(min(132, max(88, h x minimized)) + safeAreaBottom)`
- `EXPANDED` = `round(max(MINIMIZED, min(h x expanded, h - 64)))`
- `INTERMEDIATE` = `round(max(MINIMIZED, min(EXPANDED, h x intermediate)))`

`h` é a altura da área do mapa (`#center`), medida a cada chamada (`sheetEnv`), nunca um valor fixo. Paisagem: largura maior que a altura e altura menor que 520 px (`orientationOf`).

Alturas calculadas por `heights`:

| Altura do mapa | Orientação | MINIMIZED | INTERMEDIATE | EXPANDED |
|---|---|---|---|---|
| 844 px | retrato | 132 | 405 | 743 |
| 713 px | retrato | 114 | 342 | 627 |
| 600 px | retrato | 96 | 288 | 528 |
| 480 px | retrato | 88 | 230 | 416 |
| 390 px | paisagem | 101 | 242 | 326 |
| 320 px | paisagem | 88 | 198 | 256 |

Em todos os casos `h - EXPANDED >= 64` (teste `sheet snaps ...`, inclusive 390 px em paisagem).

Antes do JavaScript, o CSS usa valores provisórios: `min` 92 px, `mid` `min(52%, 460px)`, `full` `calc(100% - 64px)`, sem lote 64 px. `applySheetHeight` substitui por `--sheet-h` em linha. Transição de altura de 0,22 s, desligada durante o arraste e com `prefers-reduced-motion`.

## 3. Política de comportamento

`BEHAVIOR`: `openStateOnLotSelect = INTERMEDIATE`, `preserveStateOnLotChange = true`, `collapseOnMapDrag = EXPANDED_TO_INTERMEDIATE`, `collapseOnMapTapEmpty = false`, `dismissOnBackdropTap = false`, `allowSwipeToDismiss = false`, `minVelocityToSnap = 0.45` (px/ms), `snapThreshold = 0.5`, `restoreLastState = false`.

| Evento | Regra | Resultado | Na aplicação |
|---|---|---|---|
| seleção de lote (mapa, busca, lista, comparação) sem lote aberto | `onLotSelect('HIDDEN')` | `INTERMEDIATE` | `selectLot` |
| seleção com folha `MINIMIZED` | `onLotSelect` | `INTERMEDIATE` | `selectLot` |
| seleção com folha `INTERMEDIATE` ou `EXPANDED` | `onLotSelect` | mantém | `selectLot` |
| arrastar o mapa (mais de 6 px) | `onMapDrag` | `EXPANDED` -> `INTERMEDIATE`; demais mantêm | `onMapDrag` do `MapView` |
| tocar em área vazia do mapa | `onMapTapEmpty` | mantém (`collapseOnMapTapEmpty = false`) | `onSelect(null)`, depois de fechar o Encontrar e limpar o foco da legenda |
| abrir detalhes, simulação ou sol com a folha minimizada | ação `panel` | `mid` | `app.js` |
| "Fechar lote" | `closeLot` | limpa o lote; folha volta à altura mínima com o estado vazio | `app.js` |
| abrir o Encontrar | `sheetCoord` | guarda o snap e minimiza; ao fechar, devolve | `app.js` |

`snapThreshold` é declarado, mas a soltura lenta usa o snap mais próximo (seção 4).

## 4. Soltura do arraste

`resolveSnapTarget(px, v, alturas)`:

- `|v| >= 0,45 px/ms` (piparote): vai para o próximo snap na direção do gesto, mesmo antes do meio do caminho; para baixo do `MINIMIZED`, fica em `MINIMIZED` (dispensar por gesto está desligado).
- `|v| < 0,45` ou velocidade inválida: snap mais próximo da altura atual.

Exemplos com mapa de 713 px (114 / 342 / 627): 200 px parado vai para `MINIMIZED`; 200 px subindo a 0,5 vai para `INTERMEDIATE`; 600 px subindo a 0,6 vai para `EXPANDED`; 400 px a 0,44 vai para `INTERMEDIATE`. Detalhes do gesto em `MOBILE_SHEET_GESTURES.md`.

## 5. Controles sem gesto

| Controle | Efeito |
|---|---|
| "Expandir" (`sheetUp`) | `next(snap, +1)`: `min` -> `mid` -> `full`; desabilitado em `full` |
| "Recolher" (`sheetDown`) | `next(snap, -1)`: `full` -> `mid` -> `min`; desabilitado em `min` |
| toque na alça (menos de 8 px de movimento) | ciclo `min` -> `mid` -> `full` -> `min` |
| setas para cima e para baixo com foco na alça | `next(snap, +1)` / `next(snap, -1)` |

## 6. Teclado virtual

`keyboardAdjust`: considera o teclado aberto quando o viewport visual é mais de 120 px menor que o de layout. O snap não muda; a altura é limitada a `altura visível - 32 px` (metade de `minMapVisibleHeight`), e `.ws.kb` oculta legenda e "Comparar". Ao fechar o teclado, `visualViewport.resize` devolve a altura do snap.

## 7. Persistência e link

`sheet` é estado de sessão salvo no `localStorage` do empreendimento e restaurado como estava. O snap não entra no link (o link representa o lote, não a posição da folha).

## 8. Não implementado / pendências

- Implementado em 08/10/2026: `initialSnap` é chamado na carga: link direto para lote abre em `INTERMEDIATE` e `EXPANDED` nunca é restaurado.
- `HIDDEN` não é usado: sem lote, a folha fica minimizada com a orientação (decisão de produto).
- Folha minimizada quando a busca recebe foco: não implementado (opcional no tópico).
- Implementado em 08/10/2026: `safeAreaBottom` é passado para `heights`.
- Altura proporcional ao conteúdo (conteúdo curto ou longo): não implementada.
