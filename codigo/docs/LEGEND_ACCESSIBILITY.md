# Acessibilidade da legenda

Tópico 19. Marcação gerada por `renderLegend` em `plat/src/presentation/app.js`, textos acessíveis montados por `App.legend.viewModel` (`aria`, em `plat/src/map/legend.js`) e estilos em `plat/src/presentation/styles.css` (bloco "smart legend (19)"). Princípio: a legenda é compreensível sem depender de cor, e o símbolo da legenda é o mesmo do mapa.

## 1. Estrutura

| Elemento | Marcação | Texto acessível |
|---|---|---|
| contêiner | `<div class="legend" id="legend">` dentro do `<main>` do mapa | — |
| chip da camada | `<button class="mbtn sm" data-act="layers" aria-haspopup="dialog">` | "Visualizar por: <camada>. Trocar camada" |
| abrir/recolher | `<button data-act="legendToggle" aria-expanded="true/false">` | "Recolher" ou "Legenda" (não aparece na camada "Sem camada") |
| lista | `<div class="items" role="list" aria-label="Legenda: <camada>">` | — |
| item | `<span role="listitem">` com `<button class="it" data-act="legendItem" aria-pressed>` | `aria-label` do view model |
| ação de filtro | `<button data-act="legendFilter">` ao lado do item focado | rótulo visível ("Aplicar esta faixa de preço", ...) |
| notas | `<div class="note">`, `note warn`, `note sel` | texto visível |
| seções de recomendação e comparação | `<div class="lsec">` com título em `<b>` | texto visível; na comparação, número e código do lote |

## 2. Texto de cada item

Cada item tem rótulo textual (faixa, categoria ou status), não só cor. O `aria-label` acrescenta contagem, seleção e hachura conforme o modo:

| Situação | Exemplo real |
|---|---|
| sem filtro (corretor) | "Até R$ 300 mil, 159 lotes" |
| com filtro (corretor) | "Até 270 m², 210 lotes nos filtros atuais, 210 no total" |
| item com 1 lote | "<rótulo>, 1 lote" (singular) |
| modo cliente | só o rótulo: "Até R$ 300 mil" |
| contém o lote selecionado | sufixo ", inclui o lote selecionado QB L79"; visualmente "◆ QB L79" |
| balde com hachura | sufixo ", marcado com hachura" |

O estado de foco é exposto por `aria-pressed`; item sem lotes fica `disabled` (fora da ordem de tabulação, opacidade 0,45).

## 3. Teclado

| Tecla | Efeito |
|---|---|
| Tab / Shift+Tab | percorre chip, "Legenda"/"Recolher", itens habilitados e, no item focado, o botão de filtro |
| Enter / Espaço | clique nativo do botão: alterna o foco do item (ação principal) |
| Esc | limpa o foco da legenda antes de qualquer outra ação da cadeia de Esc |

`:focus-visible` desenha a borda do item (`.legend button.it:focus-visible { border-color: var(--line-2) }`); o item focado tem borda na cor do texto (`.foc`).

## 4. Cor e padrão

- Mesmos tokens e cores do mapa: a legenda usa a cor de cada item da `ScaleDefinition` (teste `legend uses the map scale` em `plat/tests/map.test.js`).
- Hachura igual à marcação do mapa para estados técnicos: `.sw.p-unknown` (listras diagonais cinza) e `.sw.p-conflicted` (listras vermelhas `#b42318`), só fora do modo cliente. No mapa, os mesmos estados recebem as classes `unk` e `conf`.
- Status nunca depende só de cor: "Status não confirmado", "Disponível", etc. estão escritos no item, no tooltip e no `aria-label` do polígono.
- Base Planta, Aérea ou Híbrido não muda cores nem significado da legenda.
- `@media (forced-colors: active)` mantém as cores dos polígonos (`forced-color-adjust: none`); a legenda segue o sistema.

## 5. Modos

No modo cliente não há contagens, hachura, versões nem domínio da escala; conflito aparece como "Sem dado". Avisos de cobertura e de frescor continuam visíveis, com texto simplificado ("Valores sujeitos a confirmação.").

## 6. Toque

Itens têm `min-height: 28px` e preenchimento de 2 px por 5 px. No celular a legenda começa recolhida e fica acessível pelo chip, acima da troca de base, também com um lote aberto no bottom sheet.

## 7. Não implementado / pendências

- Implementado em 08/10/2026: a região viva `#mapLive` (`aria-live="polite"`) anuncia a troca de camada e o item em destaque na legenda; a confirmação do filtro continua no `toast` (`role="status"`).
- Abaixo de 700 px as notas informativas (`.legend .note`) ficam ocultas, inclusive o texto do lote selecionado; os avisos (`.note.warn`) continuam visíveis e são lidos pelo leitor de tela.
- Implementado em 08/10/2026: em telas de toque (`pointer: coarse`), os itens da legenda têm 44 px de altura mínima.
- Implementado em 08/10/2026: o popover tem `role="dialog"` e rótulo tirado do título, devolve o foco ao elemento que o abriu e, abaixo de 600 px, abre como folha inferior.
- Implementado em 08/10/2026: o foco do teclado volta ao item depois que a legenda é redesenhada.
- Alternativa a cor para as faixas ordenadas (Preço, Área, Score) é apenas o rótulo; não há padrão ou textura por faixa.
