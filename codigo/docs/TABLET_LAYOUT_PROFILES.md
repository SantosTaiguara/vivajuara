# Perfis de layout do tablet

| Perfil | Quando | Encontrar | Lote (Quick View) | Comparação | Legenda |
|---|---|---|---|---|---|
| TABLET_PORTRAIT | tablet em retrato | gaveta temporária (até 50% da largura) | bottom sheet com alturas de tablet | botão flutuante "Comparar N" | compacta |
| TABLET_LANDSCAPE | paisagem, 960–1149 px | gaveta temporária (até 40%) | painel lateral fixo, 300–400 px | barra inferior compacta | compacta |
| TABLET_LARGE | paisagem, 1150–1279 px | gaveta temporária | painel lateral fixo, 360 px padrão | barra inferior compacta | expandida |
| TABLET_COMPACT | split screen, zoom alto, janela baixa ou paisagem estreita | gaveta temporária | bottom sheet | botão flutuante | compacta |

- Nunca há dois painéis grandes fixos com um mapa pequeno: no tablet o Encontrar é sempre gaveta. Com gaveta e painel lateral abertos, o mapa fica com pelo menos 420 px. A gaveta sobrepõe o mapa sem empurrar o painel do lote.
- Prioridade quando falta espaço: mapa > lote atual > filtros temporários.
- Densidade (`TabletDensityConfig`): só espaçamentos e alturas mínimas de 44 px. A fonte nunca diminui.
- Em modo Apresentar, o tablet mostra mapa + lote com a interface do cliente (o mesmo modo do desktop).
- Larguras de 300/340/400 px (COMPACT/NORMAL/WIDE) servem para levar o estado do sheet para o painel lateral na rotação.
- Preferências por orientação (`ws:<empreendimento>:layout:tablet`): retrato guarda o último snap e a legenda; paisagem guarda a largura e o recolhimento do painel do lote. Gavetas abertas nunca são restauradas.
