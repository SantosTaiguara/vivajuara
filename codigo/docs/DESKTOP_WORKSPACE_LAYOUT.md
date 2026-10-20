# Layout do workspace desktop

- Grade: `.body` com colunas `var(--lw) minmax(0,1fr) var(--rw)`. As larguras vêm de `App.workspace.effectiveWidths()` e são aplicadas como variáveis CSS pelo controlador `layout` em `app.js`.
- Larguras padrão: Encontrar 290 px (320 px a partir de 1600 px); lote 370 px (420 px a partir de 1600 px).
- Limites: Encontrar 260–360 px; lote 320–460 px. O mapa nunca fica abaixo de 480 px. Se a janela não comporta os dois painéis, o painel Encontrar recolhe primeiro (prioridade: mapa > lote > filtros).
- Em telas muito largas, os painéis param no máximo. Todo o ganho vai para o mapa.
- Ficha completa (modo `ANALYSIS_FOCUSED`): o painel do lote ganha 80 px, respeitando o limite e a largura mínima do mapa.
- Modos de layout: `FULL`, `MAP_FOCUSED` (os dois painéis recolhidos ou "Expandir mapa"), `ANALYSIS_FOCUSED` (ficha aberta) e `PRESENTATION`. O modo é derivado (`layoutModeOf`) e exposto em `.ws[data-mode]`.
- Landmarks: `header`, `aside` Encontrar, `main` mapa, `aside` lote (complementar) e `footer` da comparação com `role=region`.
- Ordem de tabulação: top bar → Encontrar → divisor/botão do painel → controles do mapa → painel do lote → barra de comparação.
- z-index: escala única em `workspace.css` (`--z-map`, `--z-map-controls`, `--z-panel-ctl`, `--z-panel`, `--z-drawer`, `--z-popover`, `--z-modal`, `--z-toast`). Os valores antigos do styles.css já seguiam essa ordem.
- Zoom do navegador 200%: a janela efetiva cai abaixo de 1280 px e o perfil passa a tablet (painel Encontrar vira gaveta). Isso é esperado e mantém o mapa utilizável.
