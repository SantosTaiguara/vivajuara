# Bottom sheet móvel: acessibilidade

Tópico 21. Marcação em `plat/src/presentation/shell.html` (`aside#right`, `#handle`, `#sheetLive`), anúncios em `plat/src/mobile/sheet.js` (`announce`) e `plat/src/presentation/app.js` (`applySheetHeight`, teclado da alça, cadeia de Esc), botões alternativos em `plat/src/presentation/panels.js` (`quick`, `.sheetctl`) e estilos em `plat/src/presentation/styles.css` (`.handle`, `.sr`, `prefers-reduced-motion`).

## 1. Papel e modalidade

| Elemento | Marcação | Observação |
|---|---|---|
| folha | `<aside class="right" id="right" aria-label="Lote selecionado">` | região complementar; não modal: sem `aria-modal`, sem fundo escurecido, o mapa continua interativo em qualquer snap |
| alça | `<button class="handle" id="handle" aria-label="Arraste ou use as setas para expandir ou recolher o resumo do lote" aria-keyshortcuts="ArrowUp ArrowDown">` | largura total, altura mínima 28 px (44 px em telas de toque) |
| região viva | `<span id="sheetLive" class="sr" aria-live="polite">` | visualmente oculta (`.sr`) |
| conteúdo | `<div class="rp" id="rp">` | painel atual (Quick View, detalhes, simulação, sol) |
| título do lote | `<h2>` no cabeçalho (`header` em `panels.js`) | "Quadra B · Lote 79", com o código abaixo |
| fechar | `<button data-act="closeLot" aria-label="Fechar lote">` | limpa a seleção |

## 2. Alternativas ao gesto

| Meio | Ação |
|---|---|
| botão "Expandir" (`aria-label="Expandir o resumo do lote"`) | próximo snap acima; desabilitado em `EXPANDED` |
| botão "Recolher" (`aria-label="Recolher o resumo do lote"`) | próximo snap abaixo; desabilitado em `MINIMIZED` |
| seta para cima / para baixo com foco na alça | próximo snap acima / abaixo |
| toque simples na alça | ciclo `min` -> `mid` -> `full` -> `min` |

Os botões "Recolher" e "Expandir" aparecem no topo da Quick View abaixo de 1024 px (`.sheetctl`), sempre visíveis, sem depender de arraste.

## 3. Anúncios

`applySheetHeight` escreve em `#sheetLive` o texto de `announce(snap, 'lote <código>')` quando há lote selecionado e o snap mudou desde o último anúncio:

| Snap | Texto (exemplo do B79) |
|---|---|
| `MINIMIZED` | "Resumo do lote QB L79 recolhido." |
| `INTERMEDIATE` | "Resumo do lote QB L79 aberto." |
| `EXPANDED` | "Resumo do lote QB L79 expandido." |

O status do lote é sempre texto na Quick View ("Status não confirmado", com a nota), nunca só a cor. Mensagens de ação usam o `#toast` (`role="status"`).

## 4. Teclado e Esc

- A alça e todos os controles da folha são `<button>` nativos, na ordem do documento: alça, cabeçalho (título, fechar), Recolher/Expandir, conteúdo, ações.
- Esc segue a cadeia global de `app.js`: foco da legenda, popover, modal, sugestões da busca, vista diferente do mapa, painel Encontrar, painel diferente da Quick View (volta ao resumo) e, por fim, fecha o lote.

## 5. Movimento e toque

- `prefers-reduced-motion: reduce`: sem transição de altura da folha e pan da câmera instantâneo.
- `touch-action: none` só na alça; o conteúdo mantém a rolagem nativa.
- Área segura inferior: `padding-bottom: env(safe-area-inset-bottom)` na folha.

## 6. Não implementado / pendências

- Enter ou Espaço na alça abrem a folha um nível (minimizada → intermediária → expandida) e, se já está expandida, voltam para a intermediária; as setas sobem e descem um nível.
- Gestão de foco: desde 08/10/2026, ao abrir um lote pela busca ou por uma lista o foco vai para o título do lote e volta para quem abriu ao fechar. Ao recolher com o foco dentro do conteúdo, o foco ainda não é movido.
- Implementado em 08/10/2026: a troca de lote é anunciada na região viva mesmo sem mudança de snap.
- Os polígonos do mapa têm `aria-label` (tópico 18), mas não são focáveis por teclado; a seleção acessível de lote é pela busca e pelas listas.
- Alvo de toque: desde 08/10/2026, em telas de toque os botões, inclusive os pequenos (`.lbtn.small`), e a alça têm 44 px de altura mínima.
- Texto ampliado (fonte do sistema) não muda as alturas dos snaps; o conteúdo depende da rolagem de `.rp`.
- Detalhes, simulação e sol não têm os botões Recolher/Expandir; nesses painéis restam a alça e as setas.
