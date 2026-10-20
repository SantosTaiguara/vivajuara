# Relatório de migração da navegação legada

## Inventário (LegacyNavigationInventory)
| Local | Rótulo | Destino | Uso | Fica primário | Workspace alvo | Migração | Notas |
|---|---|---|---|---|---|---|---|
| header .nav | Mapa | view=map | PRIMARY | sim | MAP | KEEP_PRIMARY | Padrão; data-act=view → data-act=nav data-ws=MAP |
| header .nav | Comparar (n) | view=compare | PRIMARY | sim | COMPARE | KEEP_PRIMARY | Badge = candidatos (0 → sem badge) |
| header .nav | Clientes | view=clients | PRIMARY | sim | CUSTOMERS | KEEP_PRIMARY | Oculto sem customer_profile.manage |
| header .nav | Empreendimento | view=development | PRIMARY | sim | DEVELOPMENT | KEEP_PRIMARY | Seções administrativas por permissão |
| mapa .edge.l | ⌕ Encontrar (n) | openFind (painel esquerdo/gaveta) | SECONDARY | sim | FIND | KEEP_PRIMARY | Promovido a item primário; o botão do mapa continua |
| header | Seletor de empreendimento | devSel → recarrega com #<dev> | ADMIN | não | — | REVIEW | Seletor ≠ menu primário (§67); fica no header |
| header | Busca de lote/quadra | #q + sugestões | CONTEXTUAL | não | MAP | MOVE_TO_WORKSPACE | Search ≠ navigation; continua no header (gatilho de busca) |
| header | Indicador de sincronização | view=development | CONTEXTUAL | não | DEVELOPMENT | REVIEW | Indicador global de conectividade; no "Mais" no celular |
| header | Chip do cliente / × | view=clients / custClear | CONTEXTUAL | não | CUSTOMERS | REVIEW | Chip de contexto, não item de navegação (§93) |
| header | Corretor / Cliente / Técnico | presentationMode | CONTEXTUAL | não | — | REVIEW | Modo de exibição; no "Mais" no celular (antes: Técnico invisível < 420 px) |
| header | Apresentar | presentationView | CONTEXTUAL | não | — | MOVE_TO_CONTEXTUAL | No "Mais" no celular (antes: invisível < 700 px) |
| header | Contexto de acesso (organização · papel) | secChip | ADMIN | não | — | MOVE_TO_ADMIN | No menu "Mais" em todos os perfis (antes: só ≥ 1440 px) |
| QuickView | Solar / Sol no lote | panel=solar | CONTEXTUAL | não | MAP | MOVE_TO_CONTEXTUAL | Já contextual (nunca foi menu primário nesta base) |
| QuickView / Lote | Simular (financeiro) | panel=simulation | CONTEXTUAL | não | MAP | MOVE_TO_CONTEXTUAL | Já contextual; também em Comparar |
| QuickView / Ficha | Scores | details / technical | CONTEXTUAL | não | MAP | MOVE_TO_CONTEXTUAL | Lote, comparação, recomendação e modo técnico |
| Encontrar | Rankings / recomendações | painel Encontrar | SECONDARY | não | FIND | MOVE_TO_WORKSPACE | Encontrar / Recommendation / Técnico |
| Empreendimento / Técnico | Análises / versões | view=development | SECONDARY | não | DEVELOPMENT | MOVE_TO_WORKSPACE | Seção "Análises" (analysis.preview) |
| Empreendimento / Ficha | Documentos | doc-preview | CONTEXTUAL | não | DEVELOPMENT | MOVE_TO_WORKSPACE | Biblioteca em Empreendimento; documento do lote no contexto |
| Clientes / filtro | Favoritos | custTab=favorites / filtro | CONTEXTUAL | não | CUSTOMERS | MOVE_TO_CONTEXTUAL | Coleção/estado do usuário |
| Comparar / Clientes / Favoritos | Apresentação guiada | pmStart | CONTEXTUAL | não | CUSTOMERS | MOVE_TO_CONTEXTUAL | Resultado de trabalho, não destino |
| rodapé | Barra de comparação / FAB | view=compare | CONTEXTUAL | não | COMPARE | REVIEW | Bandeja no mapa: o item ativo continua MAP (§287) |
| modal | Atalhos de teclado (?) | shortcutHelp | CONTEXTUAL | não | — | REVIEW | Também no menu "Mais" (desktop/tablet) |

Esta base nunca teve Solar/Financeiro/Scores/Rankings/Documentos/Favoritos como menu primário: o menu antigo tinha 4 abas (Mapa, Comparar, Clientes, Empreendimento). A migração promove **Encontrar** (antes só botão no mapa) e organiza o cabeçalho.

## Rotas legadas
| Legado | Alvo | Redirect? | Notas |
|---|---|---|---|
| #<dev> | MAP | não (decodificado pelo codec) | gramática v0 do roteador (tópicos 10/18/20/24), migrada sem perda pelo codec |
| #<dev>/lots/<lot>[/<seção>\|/simular\|/sol] | MAP (lote selecionado) | não (decodificado pelo codec) | Solar/Simular = painel contextual do lote (§264) |
| #<dev>/compare/<a>~<b>… | COMPARE | não (decodificado pelo codec) |  |
| #<dev>/presentation/<id> | PRESENTATION (fora do menu) | não (decodificado pelo codec) |  |
| store.view = clients \| development (sessão) | CUSTOMERS \| DEVELOPMENT | não (decodificado pelo codec) | restaurado do estado de sessão, não da URL |
Nenhum link existente quebra: o codec do tópico 43 continua lendo a gramática v0 e v1. Telemetria temporária `legacy_route_used`/`redirect_count` não foi criada (não há redirect).

## Prova de que nada alcançável ficou inalcançável
Teste `no feature loss…` (tests/navigation.test.js): para os 6 perfis × com/sem cliente, cada controle do cabeçalho antigo (congelado de `shell.html` em 2026-10-11) é alcançável no novo (menu primário, cabeçalho ou "Mais"), e cada controle alcançável existe no markup. Um teste de mutação confirma que remover um item ou esconder uma ferramenta faz o teste falhar. Verificação real no navegador (preview com a receita aplicada, 28 checagens Playwright em `scratchpad/t53/func.js`).

| Viewport | Cabeçalho antes | Depois | Altura do mapa | Alcance |
|---|---|---|---|---|
| 320 × 640 (MOBILE) | 134 px (3 linhas: logo/seletor/modo · busca · 4 abas roláveis) | 95 px + barra inferior 58 px | 506 → 487 px | Técnico, Apresentar, chip de cliente, sincronização e contexto de acesso estavam ocultos por CSS; agora Técnico/Apresentar/sync/acesso no "Mais", chip quando há cliente |
| 390 × 844 (MOBILE) | 131 px (3 linhas) | 95 px + barra inferior 58 px | 713 → 691 px | idem |
| 768 × 1024 (TABLET_PORTRAIT) | 146 px (3 linhas) | 105 px + barra inferior 58 px | 878 → 861 px | chip de cliente e acesso estavam ocultos; agora chip quando há cliente, acesso no "Mais" |
| 1024 × 768 (TABLET_LANDSCAPE) | 105 px (2 linhas) | 105 px (2 linhas) | 663 → 663 px | sincronização passa ao "Mais"; Encontrar entra no menu |
| 1400 × 900 (DESKTOP) | 53 px | 55 px | 847 → 845 px | "Sem cliente" sai (Clientes está no menu); acesso (antes só ≥ 1440 px) no "Mais" |

## Fases (§348)
1–2 inventário e registro ✔ · 3 códigos de rota ✔ (sem redirect necessário) · 4 topo compacto ✔ / trilho implementado, desligado · 5 barra inferior ✔ · 6 tablet ✔ · 7 ferramentas já contextuais ✔ · 8 permissões ✔ · 9 preservação ✔ · 10 deep links ✔ · 11 offline ✔ · 12 acessibilidade ✔ · 13 instrumentação mínima (reuso de `route_viewed`) ✔ · 14 sem redirect necessário · 15 testes ✔ · 16 remover menu antigo = aplicar a receita (coordenador) e validar com corretores.
