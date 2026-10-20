# Câmera e viewport (Tópico 46 §55–§59, §104, §142)

## Estados
- **Câmera lógica** `vb = {x, y, w, h}` (mundo); `MapCameraState = { center, zoom: fit.w / w }`, sem rotação (planta norte para cima).
- **viewBox confirmado** `vbC`: o que o DOM tem, arredondado a 0,1 como sempre.
- **Translação** de `#gCam` = origem confirmada − origem lógica arredondada (0,1). Desenho idêntico ao de um `viewBox` novo.

## Regras
1. Pan (mesma escala): só translação; `viewBox` confirmado 350 ms após o último movimento.
2. Zoom (wheel, pinch, botões, `focusLot`, `setViewport`): `viewBox` direto (a escala muda).
3. Um clique confirma o `viewBox` antes do hit nativo (seleção idêntica à de antes).
4. Gestos escrevem no máximo uma vez por quadro; chamadas programáticas escrevem na hora (quem chama pode ler `lotScreenBounds` logo depois).
5. Mundo↔tela por matemática (`App.geo.camera.worldToScreen/screenToWorld`, meet/letterbox) com retângulos em cache; nada de `getScreenCTM`/`getBoundingClientRect` em `pointermove`.
6. `pointermove` não escreve no store global (só `onHover` com id, como antes; `hoverLotId` silencioso).

## fitLot / insets
`lotScreenBounds` usa o bbox pré-calculado; nunca carrega a ficha. `effectiveRect(rect, insets)` e `bboxVisible()` existem para os Tópicos 21–23; a política de câmera mobile (`MS.fitLotIntoVisibleMapArea`, `WK.panToReveal`) continua em `app.js`, inalterada.

## Deep links (Tópico 43)
`viewport()`/`setViewport()` mantêm o formato `{x, y, k}`; foco por lote usa o centróide pré-calculado, sem esperar detalhe.
