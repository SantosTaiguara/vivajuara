# Bottom sheet móvel: política de câmera do mapa

Tópico 21. Funções puras em `plat/src/mobile/sheet.js` (`CAMERA`, `fitLotIntoVisibleMapArea`, `shouldAutoCenter`, `insets`), integração em `plat/src/presentation/app.js` (`keepLotVisible`, `selectLot`, `backLotBtn`) e movimento do mapa em `plat/src/presentation/map.js` (`lotScreenBounds`, `panBy`, `focusLot`, `isVisible`, `lastManualPan`). Regra: o lote selecionado nunca fica atrás da folha.

## 1. Configuração

`CAMERA`: `autoCenterOnSelect = true`, `autoCenterOnSheetExpand = true`, `minimumVisiblePadding = 24` px, `animationDuration = 220` ms, `respectRecentManualPan = 1500` ms.

## 2. Área visível do mapa

A folha fica sobre o mapa (`.svgbox` ocupa toda a área central). A área útil é o mapa menos a folha embaixo e os controles flutuantes:

```
x0 = insets.left + padding          y0 = insets.top + padding
x1 = largura - insets.right - padding
y1 = altura - alturaDaFolha - padding
```

Se a faixa visível tiver menos de 24 px (`y1 - y0 < 24`), `y1 = y0 + 24` e a câmera mira o centro dessa faixa mínima.

`fitLotIntoVisibleMapArea(retânguloDoLote, { mapWidth, mapHeight, sheetHeight, insets, padding })`:

- sem retângulo ou sem dimensões do mapa: `null`;
- retângulo do lote inteiro dentro da área: `null` (lote visível não é movido);
- senão: `{ dx, dy, area }`, o deslocamento em pixels de tela que leva o centro do lote ao centro da área.

Exemplo (mapa 390 x 713, folha intermediária de 342 px, `insets` top 56 e right 56): área de (24, 80) a (310, 347); um lote em (80, 500)-(110, 530) recebe `dx = 72`, `dy = -301`. O teste `camera: a lot behind the sheet is moved into the visible map; a visible lot is left alone` verifica esse caso (sem `insets`) e também que um lote já visível não se move.

## 3. Quando a câmera se move

`keepLotVisible(reason)` em `app.js`:

| Condição | Regra |
|---|---|
| largura menor que 1024 px, lote selecionado e vista Mapa | obrigatório; caso contrário não faz nada |
| `reason = 'select'` (qualquer seleção: mapa, busca, lista, comparação) | sempre centraliza se preciso (`autoCenterOnSelect`) |
| `reason = 'expand'` (qualquer mudança de `sheet`, para cima ou para baixo) | centraliza se preciso, exceto se houve pan manual há menos de 1.500 ms |

`shouldAutoCenter` decide; um pan manual recente vence a centralização automática só no caso `expand`. A seleção explícita de um lote sempre leva a câmera até ele.

A medição espera 240 ms (`setTimeout`), para a transição de altura (0,22 s) terminar. São usados: o retângulo do lote na tela (`map.lotScreenBounds`, a partir de `geometry.bounds`), o tamanho de `.svgbox`, a altura do snap atual (`sheetHeights()`) e `insets` fixos `{ top: 56, right: 56 }` para a área de busca e controles.

## 4. Movimento

`map.panBy(dx, dy, 220)` converte o deslocamento de tela em unidades do SVG e anima o `viewBox` por 220 ms com desaceleração cúbica (`requestAnimationFrame`). Com `prefers-reduced-motion: reduce`, o deslocamento é instantâneo. O zoom não muda; só o pan.

## 5. Outros caminhos de câmera

| Caminho | Comportamento |
|---|---|
| lista, busca, comparação (`goLot`, `sugg`, `center: true`) | `map.focusLot(id)` centraliza o lote com largura de até 620 unidades; depois `keepLotVisible('select')` corrige pela folha |
| link aberto sem viewport salvo | `map.focusLot(currentLotId)` na carga; sem correção pela folha |
| mudança de hash na página | `map.focusLot(id, false)` sem zoom |
| botão "Voltar ao lote" | aparece quando o centro do lote está fora de `.svgbox` (`isVisible`); chama `focusLot(id, false)` |
| desktop (1024 px ou mais) | sem política de câmera; o painel lateral não cobre o mapa |

## 6. Controles e insets

Os controles flutuantes se movem por CSS a partir de `--sheet-h-now` (ver `MOBILE_BOTTOM_SHEET_ARCHITECTURE.md`, seção 7). `MS.insets({ sheetHeight, headerHeight, controlsWidth, safeAreaTop })` calcula os insets formais, mas a aplicação não usa essa função.

## 7. Não implementado / pendências

- Implementado em 08/10/2026: a câmera mede os controles flutuantes (botão de busca no topo, zoom à direita); 56 px só valem quando não há medida. A área segura do topo ainda não entra.
- Lote maior que a área visível: a câmera centraliza, sem afastar o zoom para caber.
- Implementado em 08/10/2026: "Voltar ao lote" aparece também quando o lote está escondido atrás da folha.
- Na carga por link e na mudança de hash não há correção pela altura da folha.
- Implementado em 08/10/2026: a pinça grava `lastManualPanAt`, como o arraste.
- Padding dinâmico do mapa (área segura, teclado) e preferência por mover o mínimo em vez de centralizar: não implementados.
