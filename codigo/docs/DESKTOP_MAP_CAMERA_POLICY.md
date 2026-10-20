# Política de câmera (desktop e tablet com painel lateral)

- Os painéis fixos ficam fora da área do mapa (são colunas da grade). Como o SVG mantém o centro ao mudar de tamanho, abrir, fechar ou redimensionar painel não faz o mapa pular.
- `DesktopMapViewportInsets`: `{ top, left, right, bottom }` vêm dos controles flutuantes (linha Encontrar no topo, coluna de zoom à direita). Gavetas temporárias não entram (Tópico 23 §93).
- `panToReveal()` move o mínimo necessário para o lote ficar dentro da área útil. Se o lote já está visível, não mexe.
- `DESKTOP_CAMERA`: `autoCenterOnSelect`, `adjustOnPanelOpen`, `adjustOnPanelResizeEnd`, `respectRecentManualPan` (1,5 s), `padding` 24 px, animação 220 ms.
- Um pan manual recente vence ajustes automáticos (painel aberto, fim de redimensionamento, rotação). Uma seleção direta de lote sempre pode ajustar.
- O ajuste após redimensionar acontece no fim do arraste, nunca a cada pixel.
