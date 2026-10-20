# Rotação e mudança de perfil

`App.workspace.mapQuickViewStateAcrossLayouts(estado, perfilDe, perfilPara, { detailsOpen })`

| Retrato (sheet) | → Paisagem (painel lateral) |
|---|---|
| HIDDEN | COLLAPSED |
| MINIMIZED | COMPACT (300 px) |
| INTERMEDIATE | NORMAL (340 px) |
| EXPANDED | WIDE (400 px) |
| ficha aberta | WIDE (a ficha continua aberta) |

| Paisagem | → Retrato |
|---|---|
| COLLAPSED | MINIMIZED |
| COMPACT | MINIMIZED |
| NORMAL | INTERMEDIATE |
| WIDE ou ficha aberta | EXPANDED |

A rotação preserva o lote atual, o cliente, os filtros, a camada, a recomendação, a comparação, o zoom e o centro do mapa (o SVG mantém o centro), e a seção da ficha. Isso foi verificado no navegador em 1700×950 ↔ 950×1700, 1280×800, 1180×820, 1024×768, 820×1180 e 390×844: o lote, os filtros e a comparação continuaram iguais após girar e voltar.

Depois da troca, `keepLotVisible('rotate')` recalcula as margens e move o mínimo para o lote não ficar sob o sheet ou os controles. Um pan manual recente é respeitado. Se o foco estava num elemento que deixou de existir, o foco não se perde: os controles equivalentes continuam na mesma ordem de tabulação.
