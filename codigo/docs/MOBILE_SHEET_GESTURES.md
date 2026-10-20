# Bottom sheet móvel: gestos

Tópico 21. Arraste da folha no bloco "bottom sheet drag" de `plat/src/presentation/app.js` (função anônima sobre `#handle`), decisão de snap em `plat/src/mobile/sheet.js` (`resolveSnapTarget`, `BEHAVIOR`), gestos do mapa em `plat/src/presentation/map.js` (`pointerdown`, `pointermove`, `pointerup`, `wheel`) e CSS em `plat/src/presentation/styles.css` (`.handle`, `.right.dragging`). Estados e alturas em `MOBILE_SHEET_SNAP_BEHAVIOR.md`.

## 1. Divisão de responsabilidades

| Área | Dono do gesto | O que faz |
|---|---|---|
| alça (`button#handle`, largura total, altura mínima 28 px, 44 px em telas de toque, `touch-action: none`) | arraste da folha | redimensiona a folha |
| conteúdo da folha (`.rp`) | rolagem nativa | rola o conteúdo; não arrasta a folha |
| mapa (`.svgbox`) | `MapView` | pan, pinça, roda; toque seleciona |
| botões, legenda, pins, links e campos sobre o mapa | o próprio elemento | o mapa ignora `pointerdown` vindo deles |

Só a alça arrasta a folha. Não há passagem da rolagem do conteúdo para o arraste (scroll handoff).

## 2. Arraste da alça

| Fase | Comportamento |
|---|---|
| `pointerdown` | guarda a posição e a altura atual (`getBoundingClientRect`), captura o ponteiro, adiciona `.dragging` (sem transição) |
| `pointermove` | altura = altura inicial + deslocamento para cima, limitada entre `0,8 x MINIMIZED` e `EXPANDED`, escrita direto em `--sheet-h`; velocidade = deslocamento para cima / tempo desde o último evento (px/ms, mínimo 1 ms) |
| `pointerup` com menos de 8 px de movimento | é um toque: ciclo `min` -> `mid` -> `full` -> `min` |
| `pointerup` com arraste | `resolveSnapTarget(altura inicial + deslocamento, última velocidade, alturas)`; grava o snap no store (ou reaplica a altura se o snap não mudou); registra `sheet_snap` |
| `pointercancel` | encerra e volta à altura do snap atual |

Nenhum quadro do arraste escreve no store: só a soltura grava o snap semântico. A velocidade usada é a do último evento de movimento, sem suavização.

## 3. Regra de snap

`minVelocityToSnap = 0,45` px/ms. Acima disso (em módulo), um piparote leva ao próximo snap na direção do gesto (subindo: o primeiro snap acima da altura atual; descendo: o primeiro abaixo; sem snap abaixo, fica em `MINIMIZED`, porque `allowSwipeToDismiss = false`). Abaixo disso, vai ao snap mais próximo. Velocidade inválida (`NaN`) é tratada como 0.

Teste (`sheet snaps: slow release → nearest, flick → next in that direction, expanded leaves map visible`, mapa de 844 px): `INTERMEDIATE + 20` parado -> `INTERMEDIATE`; `MINIMIZED + 30` a +0,9 -> `INTERMEDIATE`; `INTERMEDIATE - 10` a -0,9 -> `MINIMIZED`; `EXPANDED` com `NaN` -> `EXPANDED`.

## 4. Gestos do mapa com a folha aberta

| Gesto | Comportamento (`map.js`) | Efeito na folha |
|---|---|---|
| arrastar com um dedo | pan; acima de 6 px de movimento conta como arraste e nunca seleciona | `onMapDrag`: `EXPANDED` -> `INTERMEDIATE` |
| pinça com dois dedos | zoom em torno do ponto médio; conta como movimento (não seleciona) | nenhum: o ramo da pinça retorna antes de chamar `onMapDrag` |
| roda do mouse | zoom no cursor (fator 1,15) | nenhum |
| toque em lote | seleciona (`elementFromPoint` + `.lot`) | `onLotSelect` (seção 3 de `MOBILE_SHEET_SNAP_BEHAVIOR.md`) |
| toque em área vazia | fecha o Encontrar, ou limpa o foco da legenda; senão `onMapTapEmpty` (sem mudança) | mantém |

Pan e pinça continuam funcionando na área do mapa acima da folha em qualquer snap. O pan com um dedo grava `lastManualPanAt`, usado pela política de câmera; a pinça não grava.

## 5. Movimento reduzido

Com `prefers-reduced-motion: reduce`, as transições de altura da folha são removidas (`.right { transition: none }`) e o pan automático da câmera é instantâneo (`panBy` sem animação).

## 6. Não implementado / pendências

- Implementado em 08/10/2026: arrastar o conteúdo move a folha, com passagem para a rolagem: puxar para baixo com a rolagem no topo recolhe a folha, e empurrar para cima antes de expandir aumenta a folha.
- Trava de direção (vertical x horizontal) e conflito com carrossel: não há gestos horizontais na folha.
- O arraste muda `height` (via `--sheet-h`), não `transform`; não há `will-change`.
- Gesto horizontal para o lote anterior ou seguinte, toque longo, duplo toque no lote e retorno háptico: não implementados.
- Dispensar por gesto (swipe to dismiss) está desligado por configuração; fechar é sempre pelo botão "Fechar lote".
- Implementado em 08/10/2026: a velocidade é suavizada nos últimos ~100 ms do gesto, então um último evento lento não anula o piparote.
