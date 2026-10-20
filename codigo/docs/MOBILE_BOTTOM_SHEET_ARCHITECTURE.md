# Bottom sheet móvel: arquitetura

Tópico 21. Peças puras em `plat/src/mobile/sheet.js` (`App.mobileSheet`); integração no navegador em `plat/src/presentation/app.js` (`applySheetHeight`, `sheetHeights`, `sheetEnv`, `measureSheet`, `keepLotVisible`, `sheetCoord`, arraste do `#handle`, `onViewportChange`); marcação em `plat/src/presentation/shell.html` (`aside#right`, `#handle`, `#sheetLive`); estilos em `plat/src/presentation/styles.css` (blocos "below 1024" e "mobile sheet (21)"). O conteúdo é a mesma Quick View do desktop (tópico 20).

Documentos relacionados: `MOBILE_SHEET_SNAP_BEHAVIOR.md`, `MOBILE_SHEET_GESTURES.md`, `MOBILE_MAP_CAMERA_POLICY.md`, `MOBILE_SHEET_ACCESSIBILITY.md`.

## 1. Princípio

O bottom sheet é só um contêiner. Ele não tem Quick View própria, não lê dados e não decide conteúdo: abaixo de 1024 px, o mesmo `aside#right` que no desktop é o painel lateral vira uma folha presa à base do mapa. Minimizar mantém o lote selecionado; fechar limpa a seleção. O lote selecionado nunca fica escondido atrás da folha (política de câmera).

## 2. Quando vale

| Largura | Comportamento |
|---|---|
| até 1023 px (`@media (max-width:1023px)`, `isSmall()` = `innerWidth < 1024`) | `#right` absoluto na base, cantos arredondados, sombra, alça visível, altura por `--sheet-h` |
| 1024 px ou mais | painel lateral; `applySheetHeight` remove `--sheet-h` |

Celulares e tablets em retrato usam o sheet. A distinção 700 px só afeta o cabeçalho e a legenda (recolhida por padrão abaixo de 700 px).

## 3. Peças

| Peça | Onde | Papel |
|---|---|---|
| estados e configuração | `SNAP`, `OPEN`, `SNAP_CONFIG`, `BEHAVIOR`, `CAMERA`, `OVERLAY_PRIORITY` | constantes congeladas |
| alturas | `heights(viewportHeight, { orientation, safeAreaBottom })` | snap em px a partir de frações da altura |
| decisão de snap | `resolveSnapTarget(px, velocidade, alturas)`, `next(snap, dir)` | soltura do arraste e botões |
| política | `onLotSelect`, `onMapDrag`, `onMapTapEmpty`, `collapse`, `close`, `onBack`, `initialSnap` | transições puras |
| câmera | `fitLotIntoVisibleMapArea`, `shouldAutoCenter`, `insets` | lote fora da folha |
| teclado e orientação | `keyboardAdjust`, `orientationOf` | altura visível |
| coordenador | `coordinator()` | uma folha ativa por vez (só usado nos testes) |
| acessibilidade | `announce(snap, título)` | texto da região viva |
| estado | `createState` | forma do `MobileSheetState` (não usado pela aplicação) |

## 4. Estado

O snap semântico fica no store (`plat/src/state/store.js`) na chave `sheet`: `min`, `mid` ou `full` (`TO_STORE`/`FROM_STORE` para `MINIMIZED`, `INTERMEDIATE`, `EXPANDED`). O valor inicial é `min`. `sheet` é estado de sessão e é salvo junto com o lote atual no `localStorage` do empreendimento. A posição em pixels durante o arraste nunca vai para o store: é escrita direto na variável CSS `--sheet-h` do elemento.

`HIDDEN` existe no módulo, mas a aplicação não o usa.

## 5. Folha vazia (sem lote)

Sem lote selecionado, `renderLot` grava `data-sheet="min"` e aplica a altura `MINIMIZED`, com o conteúdo de `App.panels.empty`: nome do empreendimento, "Toque em um lote no mapa, use a busca ou o painel Encontrar." e os números da base (498 lotes, faixa de preço e de área, preço por m²). A folha vazia fica minimizada como orientação, em vez de `HIDDEN` como o tópico sugere. A regra `.ws:not(.haslot) .right { --sheet-h: 64px }` é só o valor antes do JavaScript; o valor em linha de `applySheetHeight` prevalece.

## 6. Fluxo

```
selectLot(id, { from })                    mapa, busca, lista do Encontrar, comparação, link interno
  -> MS.onLotSelect(snap atual ou HIDDEN)  min -> mid; mid e full mantidos
  -> store.set({ currentLotId, panel: 'quick', sheet, ... })
  -> render(keys): renderLot -> applySheetHeight(sheet) -> --sheet-h, data-snap, região viva
                   measureSheet -> --sheet-h-now (altura real, no próximo frame e após 260 ms)
                   keys.has('sheet') -> keepLotVisible('expand')
  -> keepLotVisible('select')              câmera (MOBILE_MAP_CAMERA_POLICY.md)
```

`onViewportChange` (eventos `resize`, `visualViewport.resize` e `orientationchange` com 120 ms de atraso) recalcula a altura do snap atual; nenhuma altura em pixel fica velha depois de girar a tela.

## 7. Controles flutuantes

Todos se posicionam a partir de `--sheet-h-now` (altura medida da folha):

| Controle | Posição abaixo de 1024 px |
|---|---|
| troca de base (`.edge.r`, Planta/Aérea/Híbrido) | `left: 10px; bottom: sheet + 10px`; botão de tela cheia oculto |
| legenda | com lote: `bottom: sheet + 50px`, acima da troca de base, como chip ("<camada> ▾"); abaixo de 700 px começa recolhida |
| zoom (`.zoom`) | `bottom: sheet + 70px` |
| "Voltar ao lote" (`.backlot`) | `bottom: sheet + 14px` |
| escala | `left: 10px; bottom: sheet + 50px` |
| norte | `bottom: sheet + 44px`; oculto abaixo de 700 px |
| aviso do mapa (`.mapmsg.warn`) | `bottom: sheet + 60px` |
| "Comparar <n>" (`.cmpfab`) | `right: 10px; bottom: sheet + 10px`; a barra de comparação some |
| "Encontrar" (`.edge.l`) | canto superior esquerdo, sem mudança |

Com o teclado virtual aberto (`.ws.kb`), legenda e "Comparar" ficam ocultos.

## 8. Uma folha por vez

O painel Encontrar é a outra folha concorrente abaixo de 1024 px. `sheetCoord` em `app.js`: ao abrir o Encontrar com um lote aberto, guarda o snap e minimiza a Quick View; ao fechar, devolve o snap guardado. Selecionar um lote por busca ou lista (origem diferente do mapa) fecha o Encontrar. O menu de camadas e as explicações abrem como popover e não suspendem a folha. `MS.coordinator()` implementa a pilha completa (`FULL_DETAILS > FILTERS > LAYERS > QUICKVIEW > LEGEND_POPOVER`), mas só os testes o usam.

## 9. Conteúdo

O conteúdo é o de `renderLot`: Quick View (`panels.quick`), detalhes, simulação ou sol, os mesmos do desktop. Só a Quick View acrescenta, abaixo de 1024 px, a barra "Recolher" / "Expandir" (`.sheetctl`). `.right .rp` tem rolagem própria. A rolagem é mantida quando o lote e o painel são os mesmos e volta ao topo ao trocar de lote: o snap é preservado e a rolagem é reiniciada.

## 10. Testes

Em `plat/tests/map.test.js`: snaps (soltura lenta vai ao mais próximo, piparote vai ao próximo na direção, expandido deixa mapa visível, inclusive em paisagem), comportamento (selecionar abre intermediário, voltar recolhe antes de fechar, coordenador suspende e devolve) e câmera.

## 11. Não implementado / pendências

- `HIDDEN`, `collapse`, `close`, `insets`, `createState` e `coordinator` não são usados pelo navegador. Desde 08/10/2026, `initialSnap` e `onBack` são usados.
- Implementado em 08/10/2026: o botão voltar do celular fecha as camadas em ordem (modal, popover, gaveta, sobreposição, detalhes, folha expandida, lote) sem sair do app, com uma entrada de histórico própria e tratamento de `popstate`.
- Implementado em 08/10/2026: link direto para lote abre a folha em `INTERMEDIATE`; `full` nunca é restaurado numa nova sessão.
- Implementado em 08/10/2026: `safeAreaBottom` é passado para `heights`, então as alturas incluem a área segura do iPhone.
- Altura sensível ao conteúdo, navegação anterior/próximo entre lotes, gesto horizontal, toque longo e retorno háptico: não implementados.
- Painéis de detalhes, simulação e sol não têm os botões "Recolher" / "Expandir" (só a alça).
