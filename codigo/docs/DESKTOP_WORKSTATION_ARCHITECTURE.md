# Workstation desktop (Tópico 22)

O desktop abre direto no mapa do empreendimento. Não há tela de cards. O layout é **Encontrar | Mapa | Lote**, com a barra de comparação embaixo quando há lotes nela.

```
Top bar (empreendimento · busca · cliente · modo · apresentar)
┌────────────┬──────────────────────────┬──────────────┐
│ Encontrar  │ Mapa (maior área sempre) │ Lote         │
│ busca      │ lotes, camadas, legenda, │ LotQuickView │
│ filtros    │ controles flutuantes     │ ficha        │
│ recomendar │                          │ simulação    │
└────────────┴──────────────────────────┴──────────────┘
Barra de comparação (2–4 lotes; oculta sem lotes; pode minimizar)
```

## Peças

| Peça | Onde | O que faz |
|---|---|---|
| `DesktopWorkspaceState` | `src/layout/workspace.js` (`desktopState`) | Estado só de layout: painéis, larguras, seções ativas, modo de layout, `schemaVersion`. |
| `DesktopPanelBehaviorConfig` | `workspace.js` (`DESKTOP_BEHAVIOR`) | Política: abrir o painel do lote ao selecionar, respeitar o fechamento manual, largura mínima do mapa, redimensionar, fixar. |
| `DesktopWorkspaceCoordinator` | `workspace.js` (`coordinator`) | Eventos → novo estado de layout: `openLeft`, `closeLeft`, `openRight`, `closeRight`, `resizePanel`, `toggleBottomBar`, `onLotSelect`, `onLotClear`, `onDetailsOpen`. Não tem regra de negócio. |
| `DesktopMapViewportInsets` / `DesktopMapCameraPolicy` | `workspace.js` (`viewportInsets`, `DESKTOP_CAMERA`, `panToReveal`, `shouldAdjust`) | Área útil do mapa e quando a câmera pode se mover. |
| `DesktopShortcutRegistry` | `src/layout/shortcuts.js` | Atalhos de teclado, sem conflitos, nunca enquanto se digita. |
| Persistência | `workspace.js` (`loadPrefs` / `savePrefs`) | Larguras e recolhimentos por aparelho e empreendimento, com versão de schema. |
| Integração | `src/presentation/app.js` (controlador `layout`) | Aplica as larguras na grade, liga os divisores, os botões de recolher, os atalhos e as error boundaries. |

## Regras mantidas

- `currentLotId`, cliente, filtros, camada, comparação, zoom e centro continuam no estado da aplicação (`App.store`). O estado de layout nunca os contém nem os limpa.
- O painel direito reutiliza o mesmo LotQuickView (Tópico 20). Não existe painel de lote duplicado.
- O painel esquerdo reutiliza o mesmo motor de filtros e busca (Tópico 17).
- Redimensionar, recolher ou trocar de seção não recalcula filtros, scores, Fit nem recomendação, e não faz fetch. O teste `workspace.test.js` verifica que os módulos de layout não importam serviços de dados.
- O bottom sheet do celular não é usado no desktop.

## Error boundaries

Cada região (Encontrar, lote, barra de comparação, overlay) é renderizada dentro de `guard()`. Se uma falhar, ela mostra "Não foi possível mostrar esta parte agora. O mapa continua funcionando." e um botão "Tentar de novo". O mapa não cai junto.
