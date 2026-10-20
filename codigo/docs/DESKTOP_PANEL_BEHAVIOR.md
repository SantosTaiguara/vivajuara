# Comportamento dos painéis (desktop)

| Situação | Comportamento |
|---|---|
| Abrir o empreendimento sem lote | Encontrar aberto (ou como o usuário deixou da última vez). Painel do lote recolhido, e o mapa ocupa o espaço. |
| Selecionar lote (mapa, busca, lista de recomendação, link) | O painel do lote abre, exceto se o usuário o fechou manualmente nesta sessão. Um link direto ou atalho abre mesmo assim. |
| Fechar o painel do lote (botão › na borda ou `]`) | Fica fechado até o usuário reabrir. A seleção continua, e o botão ‹ na borda mostra "Abrir o painel do lote QA L5". |
| Tirar a seleção (×) | O painel volta a EMPTY e recolhe, salvo se estiver fixado. |
| Recolher Encontrar (botão ‹ na borda, `[` ou "Encontrar" no mapa) | O mapa expande. Filtros, recomendação e rolagem continuam como estavam. |
| Redimensionar | Arrastar o divisor (atualiza só uma variável CSS por quadro). O valor é salvo ao soltar. Teclado no divisor: ←/→ 16 px (Shift 48), Home/End mínimo/máximo, Enter recolhe. |
| Barra de comparação | Aparece com 1 a 4 lotes. Cada chip traz código, preço de tabela e área, com remover. "Comparar N lotes" aparece a partir de 2. "Minimizar" a reduz a uma linha. |
| Cliente no topo | Chip "Cliente: Nome" com × para encerrar o atendimento. O cadastro e o perfil continuam salvos no cliente; o perfil de trabalho é limpo. |
| Esc | Fecha popover, menu, ficha e overlay. No desktop nunca tira a seleção do lote. |

Persistência (`ws:<empreendimento>:layout:desktop`, schema 1): largura de cada painel, Encontrar recolhido, painel do lote fixado, última seção e barra minimizada. Não são salvos hover, foco, popovers abertos nem o "fechei o painel nesta sessão". Valores inválidos voltam ao padrão, e larguras salvas são sempre limitadas aos mínimos e máximos atuais. Migração: a preferência antiga `leftCollapsed` do estado da aplicação é lida uma vez.

A URL não guarda largura nem painel recolhido. O link compartilhado continua levando empreendimento, lote, filtros, camada e comparação (Tópicos 17 e 18).
