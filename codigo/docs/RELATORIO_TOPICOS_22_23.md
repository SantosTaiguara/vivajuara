# Relatório — Tópicos 22 (Workstation Desktop) e 23 (Tablet / layout adaptativo)

Data: 2026-10-08. Arquitetura detalhada em `DESKTOP_WORKSTATION_ARCHITECTURE.md`, `DESKTOP_WORKSPACE_LAYOUT.md`, `DESKTOP_PANEL_BEHAVIOR.md`, `DESKTOP_MAP_CAMERA_POLICY.md`, `DESKTOP_SHORTCUTS.md`, `TABLET_RESPONSIVE_ARCHITECTURE.md`, `RESPONSIVE_PROFILE_RESOLVER.md`, `TABLET_LAYOUT_PROFILES.md`, `TABLET_ORIENTATION_STATE_MAPPING.md` e `TABLET_INPUT_CAPABILITIES.md`.

## O que foi implementado

**Arquivos criados**
- `src/layout/responsiveProfile.js` (`App.responsive`) — ResponsiveProfileResolver e InputCapabilityResolver. O layout vem do espaço real (largura, altura, orientação do viewport) e das capacidades de entrada, nunca do nome do aparelho ou do user agent. Famílias MOBILE / TABLET / DESKTOP; perfis MOBILE, TABLET_PORTRAIT, TABLET_LANDSCAPE, TABLET_COMPACT, TABLET_LARGE, DESKTOP; histerese de 24 px; fallback seguro (TABLET_COMPACT) se a entrada vier quebrada.
- `src/layout/workspace.js` (`App.workspace`) — estado de layout do desktop (painéis, larguras, modo, foco), coordenador de painéis, limites e larguras padrão, snaps do tablet, presets do painel direito, coordenador de overlays, insets de câmera e persistência de preferências por família (`ws:<empreendimento>:layout:<família>`), com migração do formato antigo.
- `src/layout/shortcuts.js` (`App.shortcuts`) — registro único de atalhos, sem conflitos, que nunca dispara enquanto se digita (exceto Esc).
- `src/presentation/workspace.css` — tokens de z-index, divisores redimensionáveis, abas de recolher, bandeja de comparação compacta, ajustes de tablet (alvos de 44 px, gaveta que não cobre o mapa inteiro).
- `tests/workspace.test.js` — 16 testes.

**Arquivos alterados**: `shell.html` (divisores, abas, botão de limpar cliente), `app.js` (controlador de layout, atalhos, divisores por mouse e teclado, limites de erro por região, câmera que revela o lote ao lado dos painéis), `panels.js` (sheet decidido pelo perfil), `styles.css` (as media queries por largura viraram seletores pelo perfil resolvido: `html[data-rp]`, `html[data-lp]`), `store.js` (estado só de layout é transitório).

**Desktop (tópico 22)**: painel esquerdo e direito fixos e redimensionáveis (arrastar ou setas/Home/End no divisor), recolher/abrir por aba, por `[` e `]` ou pelo divisor; o painel do lote fica recolhido enquanto não há lote e abre ao selecionar, mas respeita quando o usuário o fechou manualmente; modo "mapa em foco" (`m`); câmera só se move quando o lote ficaria escondido atrás de um painel; barra de comparação aparece a partir de 1 lote e pode ser minimizada; ajuda de atalhos (`?`); erro em uma região não derruba as outras (botão "Tentar de novo").

**Tablet (tópico 23)**: retrato e paisagem estreita usam bottom sheet com snaps próprios; paisagem larga usa painel direito fixo com Encontrar em gaveta; ao girar o aparelho, o lote, a seção e a rolagem continuam (mapeamento da Quick View entre layouts); sem hover não há tooltip nem destaque de hover (o toque continua funcionando igual); densidade de toque com alvos de 44 px.

## Verificação
- `npm test`: todos os testes passam, incluindo os 16 novos.
- Paridade das cores do mapa (t18.js): 0 diferenças.
- Navegador (Chromium): 1700×950, 1280×800, 1180×820, 1024×768 (escuro), 820×1180 e 390×844 — sem rolagem horizontal, seleção, redimensionar, persistência, recolher, atalhos e rotação conferidos.

## Mudança de comportamento intencional
- No desktop e no tablet com painel fixo, **Esc não fecha mais o lote**: fecha só popover, menu ou gaveta (tópico 22, "Esc não limpa a seleção"). No celular o comportamento anterior continua. O script antigo de verificação `pw6` acusa isso como erro porque foi escrito antes da regra.

## Decisões tomadas (padrão escolhido, reversível)
- Barra de comparação visível a partir de 1 lote, com dica para adicionar o segundo.
- Painel do lote recolhido quando não há lote selecionado (o mapa ganha o espaço).
- Larguras padrão 290/370 px (320/420 a partir de 1600 px); limites 260–360 e 320–460.
- Atalhos de letra única (`f`, `l`, `c`, `d`, `m`) só fora de campos de texto; Cmd/Ctrl+K como busca.

## Extra (comentário no painel): imagens das áreas comuns
Clicar (ou Enter/Espaço) numa área comum do mapa abre um pop-up com o nome, a área da planta oficial e as fotos do material de lançamento daquela área. O Clube mostra bar lounge, piscina e deck, deck sunset, área gourmet, playkids, campo society, beach tennis, pista de cooper, mercadinho e pet place; Portaria, Praças e Playgrounds mostram as suas. Áreas técnicas (EEEB, estacionamento, administração) e parques florestais dizem "Sem imagens desta área no material de lançamento". A associação é pelo nome da foto (`poiImages` em `config/developments.js`); a posição exata de cada item dentro do clube **necessita confirmação** com a loteadora. Teste: `tests/poi.test.js`.

## Pendências
- Nenhuma técnica bloqueante. Ajustes finos de larguras e snaps dependem de uso real em aparelhos da equipe.
