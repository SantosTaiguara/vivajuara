# Relatório — Tópico 53: Menu compacto e arquitetura de navegação

## Entregue
- `config/navigation/manifest.json` (NavigationManifest `nav-2026-10-11.1`): 5 itens primários, seções de workspace, ações contextuais, ferramentas do cabeçalho com regra de overflow por perfil, colocação por perfil, densidade, políticas por modo, preservação de contexto, atalhos G e mensagens pt-BR.
- `src/navigation/navigationRegistry.js` (`App.navigation.registry`): NavigationRegistry, resolvedor de permissão (App.authz ou `NavigationContext.permissions`; nunca código de papel), entitlement, OfflineNavCapability, NavigationPlacementResolver, overflow do cabeçalho, alcançabilidade, contrato e inventário legado.
- `src/navigation/navigationService.js` (`App.navigation.state` / `.service` / `.shortcuts`): NavigationState derivado da rota, NavigationService (`plan`/`goToWorkspace`, `goToLot`, `goToCustomer`, `goBack`), RouteAccessDecision com redirect seguro sem loop, preservação de contexto, troca de empreendimento/tenant, restauração da última rota (PWA), UnsavedChangesGuard, view model, sequências G.
- `src/navigation/menuView.js` (`App.navigation.view`) + `src/presentation/navigation.css`: cabeçalho compacto (topo no desktop/tablet paisagem, barra inferior no celular/tablet retrato, trilho implementado e desligado), menu "Mais", estado ativo, badge, teclado.
- `scripts/navHeader.js`: imprime o header para `shell.html`; `--check` garante shell = registro.
- 13 documentos: NAVIGATION_ARCHITECTURE, PRIMARY_NAVIGATION_REGISTRY, WORKSPACE_NAVIGATION_MODEL, CONTEXTUAL_ACTION_MODEL, NAVIGATION_ROUTE_CONTRACT, NAVIGATION_CONTEXT_PRESERVATION, RESPONSIVE_NAVIGATION_POLICY, NAVIGATION_PERMISSION_POLICY, OFFLINE_NAVIGATION_POLICY, NAVIGATION_ACCESSIBILITY, NAVIGATION_LEGACY_MIGRATION_REPORT, NAVIGATION_TEST_MATRIX e NAVIGATION_INTEGRATION_RECIPE (receita exata).

## Inventário e decisões de arquitetura de informação
- Menu antigo: 4 abas (Mapa, Comparar, Clientes, Empreendimento) + "Encontrar" como botão no mapa. Solar, Simular, Scores, Rankings, Documentos, Favoritos e Apresentação **já eram contextuais** nesta base; continuam assim, agora com registro (`contextualActions` espelha o QuickView; teste garante).
- Novo primário: **Mapa · Encontrar · Comparar · Clientes · Empreendimento**. Mapa é o padrão; a logo leva ao Mapa.
- Encontrar = painel Encontrar do mapa. No celular/tablet retrato abre a gaveta e vira o item ativo; no desktop expande e foca o painel ancorado, o Mapa continua ativo e Encontrar ganha o marcador "aberto".
- Cabeçalho: seletor de empreendimento, busca, chip do cliente (só com cliente ativo), sincronização, modo Corretor/Cliente/Técnico, Apresentar; no celular modo/Apresentar/sync/acesso vão para "Mais". O contexto de acesso (antes só ≥ 1440 px) fica no "Mais" em todos os perfis.

## Prova de não regressão
- O teste `no feature loss…` cobre os 6 perfis × com/sem cliente: todo controle do cabeçalho antigo continua alcançável e todo controle alcançável existe no markup. Um teste de mutação mostra que o teste falha se um item ou ferramenta sumir.
- Ganhos: Técnico (antes oculto < 420 px), Apresentar (< 700 px), acesso (< 1440 px) passam a ser alcançáveis no celular.
- No navegador, a receita foi aplicada numa cópia: 28/28 checagens Playwright (troca de workspace, mapa→comparar→mapa preserva o lote, logo→Mapa, Encontrar ancorado/gaveta, g c / g m / g 3 sem disparar o atalho "m", badge 3, setas/Home/End, "Mais" com Esc e devolução de foco, apresentação esconde a navegação, modo pelo "Mais" no celular, chip do cliente, sheet acima da barra inferior), 0 erros de página. Capturas a 320/390/768/1024/1400 px antes e depois, claro e escuro (`scratchpad/t53/`).
- Altura do mapa: 320 px 506→487; 390 px 713→691; 768 px 878→861; 1024 px 663→663; 1400 px 847→845. Sem rolagem horizontal.
- `navigation.css` só tem seletores com escopo (teste): o painel construído hoje não muda. Paridade de cores t18: TOTAL DIFF 0.

## Não alterado
IDs de lote, geometria, scores, classes, metodologia, preços (R$ 1.196/m², tabela 2026-10-06), regras financeiras e solares, disponibilidade (UNKNOWN nos 498 lotes), semântica de analytics (`route_viewed` igual), codec de deep link (único serializador), permissões.

## Arquivos
- Criados: os 3 módulos de `src/navigation/`, `src/presentation/navigation.css`, `config/navigation/manifest.json`, `scripts/navHeader.js`, `tests/navigation.test.js`, os 13 documentos e este relatório.
- Alterado (compartilhado, aditivo): `scripts/configBundle.js` (`'navigation'` na lista de subpastas).
- Para o coordenador (não editados por mim): `shell.html`, `app.js`, `tests/harness.js` (ORDER), `scripts/build.js` (UI), `config/security/features.json` (`actions.nav`). Ver NAVIGATION_INTEGRATION_RECIPE.md.

## Testes
`tests/navigation.test.js`: 28 testes, todos passando. Até a integração, `security.test.js` "every existing panel action has a permission contract" acusa `nav` (junto com ações de outros tópicos): resolve com `actions.nav` no features.json.

## Diferido e decisões humanas
- D1 Trilho lateral no desktop (§53): implementado e desligado até `layout/workspace.js` descontar a largura do trilho. Hoje o desktop usa a navegação no topo.
- D2 No celular, o modo Corretor/Cliente fica no "Mais" (antes estava visível). Pode voltar para o cabeçalho se os corretores trocarem de modo com frequência.
- D3 Clientes/Empreendimento não criam entrada de histórico no desktop (a URL continua MAP). Exige rota no codec (CUSTOMER só por stateRef autenticada, sem PII) e depende do backend.
- D4 Rota FIND própria (reservada no codec) × painel do mapa.
- D5 Reduzir o menu no modo Cliente (§211). Por ora os 5 itens continuam.
- D6 Rótulo "Encontrar lote" no desktop (§281): só com evidência de usabilidade.
- D7 Teste de usabilidade com corretores (§271) e métricas de navegação (§273) dependem do plano de Product Analytics.
- Backend: guarda de rota no servidor, permissões revisadas e AnalysisVersion por empreendimento seguem com os tópicos 30/31/36. Nada disso roda aqui.
