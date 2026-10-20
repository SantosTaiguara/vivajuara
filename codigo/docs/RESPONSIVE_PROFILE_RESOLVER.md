# ResponsiveProfileResolver

`App.responsive.resolve(input, previous?)` é uma função pura e testada.

**Entrada (`ResponsiveProfileInput`):** `viewportWidth`, `viewportHeight`, `containerWidth`, `containerHeight`, `orientation` (da media query de orientação da janela, não da tela), `pointerType` (COARSE/FINE/HYBRID/UNKNOWN), `hoverCapability`, `prefersReducedMotion`.

**Saída (`ResponsiveProfile`):** `family` (MOBILE/TABLET/DESKTOP), `layoutProfile`, `orientation`, `density`, `inputMode`, `capabilities`, `regions` (onde vai cada região: DOCKED, OVERLAY, SHEET), `minMapWidth`.

## ResponsiveBreakpointConfig (único lugar com números)

| Chave | Valor |
|---|---|
| mobileMax / tabletMin | 699 / 700 |
| tabletMax / desktopMin | 1279 / 1280 |
| tabletLandscapeMinWidth | 960 |
| tabletLargeMinWidth | 1150 |
| compactMaxHeight | 540 |
| hysteresis | 24 px |
| minMapWidth | desktop 480 · tablet 420 |
| painéis | Encontrar 260–360 · lote desktop 320–460 · lote tablet 300–400 |

## Regras

1. Família pela largura disponível.
2. Tablet com altura < 540 px → TABLET_COMPACT (zoom alto, janela baixa).
3. Tablet em retrato → TABLET_PORTRAIT.
4. Tablet em paisagem: ≥ 1150 px → TABLET_LARGE; ≥ 960 px → TABLET_LANDSCAPE; menor → TABLET_COMPACT.
5. Histerese: perto de um limite (±24 px), o perfil anterior é mantido para não alternar com a barra do navegador.
6. Entrada inválida → TABLET_COMPACT com `fallback: true`. O mapa continua acessível.
7. Pointer desconhecido é tratado como toque.

O resolvedor roda ao carregar o script (antes da primeira pintura) e depois a cada `resize`, `visualViewport.resize` e `orientationchange`, agrupado em um quadro de animação. Em modo técnico, `App.debugInfo().responsive` mostra o perfil atual.
