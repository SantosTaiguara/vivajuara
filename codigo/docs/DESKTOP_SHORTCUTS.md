# Atalhos de teclado

| Tecla | Ação | Desktop | Tablet com teclado |
|---|---|---|---|
| `/` ou Ctrl/Cmd+K | Buscar lote | sim | sim |
| `F` | Abrir/fechar Encontrar (filtros) | sim | sim |
| `L` | Trocar a camada do mapa | sim | sim |
| `C` | Pôr/tirar o lote atual da comparação | sim | não |
| `D` | Abrir a ficha completa | sim | não |
| `[` / `]` | Recolher/abrir Encontrar / painel do lote | sim | só `]` com painel lateral |
| `M` | Mapa em foco | sim | não |
| `?` | Lista de atalhos | sim | sim |
| Esc | Fecha popover, menu ou painel temporário (não tira a seleção) | sim | sim |

- Nenhum atalho dispara enquanto se digita em campo, select ou lista de sugestões (exceto Esc).
- Combinações do navegador e do sistema (Ctrl/Cmd/Alt + letra) não são capturadas, exceto Ctrl/Cmd+K. Cmd e Ctrl são equivalentes.
- Com uma janela de diálogo aberta, os atalhos esperam.
- O registro único (`App.shortcuts.REGISTRY`) é testado contra conflitos (`conflicts()`).
- A busca já tinha ↑/↓ e Enter. Os divisores são `role=separator` com `aria-valuenow/min/max` e respondem ao teclado.
- Paleta de comandos: não implementada (opcional na especificação).
