# Runtime e Navegação

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

`App.presentationMode.runtime`:
- `openSnapshot` → `start` (verifica permissão, safety e checksum) → `goTo / next / previous / jumpToLot / returnToMap`.
- `setMode`, `pause / resume`, `setFullscreen`, `markCompleted`, `end` (retorna `journeyEvents` com `PRESENTATION_COMPLETED` só se concluída, e sugestão de estágio `autoApply:false`).
- Sessão encerrada não navega (`guardActive`).
- `audienceView(id)`: só conteúdo client-safe do passo atual. `presenterControlState`: controles do apresentador (não aparecem para a audiência; `PRESENTER_CONTROLS_POLICY`).
- `createOverlayCoordinator`: um overlay por vez, ESC fecha.
- `recordFeedback`: registra interesse/dúvida por lote; **não** altera perfil nem favoritos. `outcome`, `notes` (notas internas exigem `presentation.internalNotes.read`).
- `restorePayload / restore`: restaura só ids e passo, nunca conteúdo.
- `bindAuth`: perda de permissão/troca de tenant encerra a sessão e limpa estado privado (`clearPrivateState`).
- Tema: `DEFAULT_THEME`, `validateTheme` (rejeita chaves que soem como preço/score/filtro/ranking/disponibilidade/admin/debug). `LAYOUT / layoutFor(viewport)`.
- `exportRequest`: pedido de exportação (PDF etc.) para o backend. Nada é gerado no frontend.
- Rota interna sugerida: `/presentations/{id}`.

## UI (`App.presentationView`)
`audience(view)`, `presenter(state)`, `preflight(result)`, `block(b)`, `card(c)`. data-act: `pmPrev`, `pmNext`, `pmStep`, `pmLot`, `pmMap`, `pmFeedback`, `pmComplete`, `pmEnd`.
