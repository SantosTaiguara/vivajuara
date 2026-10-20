# Capacidades de entrada (InputCapabilityResolver)

`App.responsive.resolveInput(input)` → `{ pointerType, touch, finePointer, hover, keyboardLikely, gesturePreferred }`.

- Lido das media queries `any-pointer` e `hover`, nunca do nome do aparelho.
- Pointer desconhecido = toque (controles de 44 px).
- Hover disponível: tooltip no mapa e destaque ao passar o mouse na legenda e na busca. Sem hover: tooltip desligado (`html[data-hover="none"]`); um toque abre o Quick View.
- Trackpad ou mouse conectados mudam só os realces, não a estrutura. O layout não muda quando um trackpad conecta ou desconecta.
- Teclado externo: atalhos essenciais do tablet (`/`, Ctrl/Cmd+K, `F`, `L`, `]`, `?`, Esc) e foco visível.
- Movimento reduzido: as transições de painel e de sheet são desligadas.
