# Política de regressão visual

Paridade visual não é pixel-perfect eterno. O que é preservado: a planta e a posição dos lotes, a semântica das cores por camada, a hierarquia QuickView → ficha, a legibilidade em 320–1700 px, claro/escuro.

## Camadas de verificação

| Nível | Como | Automático? |
|---|---|---|
| Cor de cada lote em cada camada | golden `layers` (hex por lote) + t18 (`TOTAL DIFF 0`) | sim (CI) |
| Geometria/posição | golden `lots.*.geometry.polygonFingerprint`, `map.renderChecksum`, `map.representativeAnchors` | sim (CI) |
| Telas | capturas Playwright em 320/390/768/1024/1100/1280/1400/1700 px, claro/escuro (séries `z_*`, `y_*`, `w_*`, `ws_*` do ambiente de trabalho, tópicos 41–48) | não: revisão humana |
| Acessibilidade | foco, contraste, alvos de 44 px no toque | parcial (testes de view) |

```ts
interface VisualRegressionPolicy { surface: string; viewports: number[]; themes: ('light'|'dark')[]; tolerance: 'EXACT_COLOR'|'LAYOUT_REVIEW'; blocking: boolean; }
```

## Regras

- Mudar paleta/limiares **e** renderer no mesmo release é proibido sem revisão (tópico 54 §365).
- Mudança grande de paleta: documentar antes/depois, motivo (acessibilidade?) e aprovação; exceção no golden `layers`.
- Tooltip que mudou de lugar: revisão, não bloqueio. Alerta crítico que sumiu: bloqueio.
- Capturas de referência novas são feitas no mesmo viewport e tema das antigas.
