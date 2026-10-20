# Acessibilidade da navegação

- Landmark: `<nav aria-label="Navegação principal">` com lista; item ativo `aria-current="page"` (derivado da rota, nunca no HTML estático).
- Ativo não depende só de cor: fundo + barra indicadora + peso; `forced-colors` ganha contorno.
- Ícones decorativos `aria-hidden="true"`; todo item tem rótulo visível. "Empreend." é só visual (`aria-hidden`); o nome acessível continua "Empreendimento".
- Badge de Comparar: número visual `aria-hidden` + texto para leitor de tela (", 3 lotes na comparação").
- Desabilitado: `aria-disabled="true"` (continua focável) + `title` com o motivo; o clique explica via toast.
- Teclado: Tab/Shift+Tab; Enter/Espaço; setas ←/→ (↑/↓ no trilho), Home/End entre itens. "Mais": `aria-expanded`/`aria-controls`, foco vai ao primeiro controle, Esc fecha e devolve o foco ao botão, clique fora fecha.
- Atalhos (registro do manifesto, sem conflito com o tópico 22): `g então m` / `g então 1` → Ir para o Mapa; `g então e` / `g então 2` → Ir para Encontrar; `g então 3` → Ir para Comparar; `g então c` / `g então 4` → Ir para Clientes; `g então 5` → Ir para Empreendimento. Nunca enquanto digita, com modificador, com diálogo aberto, ou após 1,2 s. O segundo toque recebe `preventDefault()`, e o registro do tópico 22 ignora eventos já tratados (por isso `g m` não dispara "mapa em foco").
- Alvos: barra inferior ≥ 48 px; itens no tablet ≥ 44 px; foco visível global (`:focus-visible`).
- `prefers-reduced-motion`: sem transição nos itens. Animações curtas, nada de slide grande sobre o mapa.
- Foco em troca de workspace: Encontrar foca o primeiro campo do painel; overlays locais preservam o foco (comportamento existente).
- Contraste: usa os tokens do tema (claro/escuro) já validados; ativo = `--brand` sobre `--brand-soft`.
