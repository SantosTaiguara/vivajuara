# Lot Quick View: arquitetura

Tópico 20. Implementação em `plat/src/quickview/quickview.js` (`App.quickView`), configuração de prioridade de campos em `plat/config/quickview/viva-juara.json`, adaptador em `plat/src/presentation/viewmodels.js` (`quickViewVM`, `statusVM`) e componente em `plat/src/presentation/panels.js` (`quick(q, st, x)`). A orquestração fica em `plat/src/presentation/app.js` (`ctx()`, `renderLot`).

Documentos relacionados: `LOT_QUICK_VIEW_VIEWMODEL.md`, `LOT_QUICK_VIEW_ACTIONS.md`, `LOT_QUICK_VIEW_CONTEXTS.md` e, para o celular, `MOBILE_BOTTOM_SHEET_ARCHITECTURE.md`.

## 1. Princípio

A Quick View é o segundo nível de informação (depois do tooltip, antes dos detalhes): identidade, status, área, preço, score ou Fit do contexto, de 3 a 5 destaques, alertas importantes e ações. Ela lê valores já produzidos (Lot canônico, análise, `FitScoreResult`, `RecommendationResult`, `FilterResult`) e nunca calcula score, Fit ou status, nem altera a consulta de filtro. `null` aparece como "Não disponível", nunca como 0; `UNKNOWN` nunca aparece como disponível.

Um único construtor (`App.quickView.build`) atende todos os contêineres: painel lateral no desktop, bottom sheet no celular (o mesmo `aside#right`) e o cabeçalho dos detalhes (`detailsVM` usa `quickViewVM` como resumo). Não existe Quick View separada para celular.

## 2. Fluxo

```
store (currentLotId, modo, filtros, perfil, comparação, favoritos, camada, rota, conectividade)
  -> ctx() em app.js                        reúne selectors: Fit, recomendação, FilterResult, FilterQuery
  -> App.vm.quickViewVM(lot, ctx)           adapta o contexto da aplicação
  -> App.quickView.build(lot, input)
       resolveContext      -> QuickViewContext (um contexto principal)
       cfgOf(dev).modes    -> configuração de prioridade do modo
       capabilities        -> o que a tela pode fazer
       statusVM            -> status com texto, cor e aviso de frescor
       commercial, metrics -> área, preço, preço/m² com nota de frescor
       SC.primaryScore, SC.keyAttributes -> score do objetivo (resolvedor existente)
       customerFit         -> só com cliente ativo
       selectHighlights    -> 3 a 5 destaques sem repetir tema
       alertSummary        -> alertas críticos e importantes sempre visíveis
       App.filters.whyNot  -> por que o lote está fora do filtro
       actions             -> lista ordenada pela configuração
  -> App.panels.quick(q, st, x)             HTML; só desenha o view model
```

`renderLot` (em `app.js`) roda quando muda alguma chave de `LOT_KEYS` (lote, painel, simulação, favoritos, comparação, preferências, restrições, `recScope`, filtros, modo, rota, `sheet`, objetivo, camada, cliente, vista, `dataRevision`). Sem lote, mostra `App.panels.empty`. Com outro painel aberto (`details`, `simulation`, `solar`), desenha esse painel; a Quick View é o painel `quick`.

## 3. Componentes

| Componente | Função | Responsabilidade |
|---|---|---|
| QuickViewContextResolver | `resolveContext(input)` | decide uma vez o contexto principal e os resumos (ver `LOT_QUICK_VIEW_CONTEXTS.md`) |
| QuickViewCapabilities | `capabilities(ctx, lot, input)` | simular, comparar, solar, explicar; sem lógica de permissão embutida |
| QuickViewHighlightSelector | `selectHighlights(lot, ctx, input, max)` | destaques da análise e pontos fortes do perfil, deduplicados por tema |
| QuickViewAlertSummary | `alertSummary(lot, cfg, max)` | contagens por severidade e alertas do topo |
| QuickViewAction | `actions(ctx, caps, lot, input)` | ações visíveis, ordenadas por `actionOrder` (ver `LOT_QUICK_VIEW_ACTIONS.md`) |
| Builder | `build(lot, input)` | `LotQuickViewViewModel` versão 2 (ver `LOT_QUICK_VIEW_VIEWMODEL.md`) |
| Proteção contra resposta antiga | `requestGuard()` | `begin(lotId)`, `isCurrent(token, lotId)`, `cancel()` |

## 4. Configuração de prioridade

`plat/config/quickview/viva-juara.json` (`kind: quickview-field-priority`, `version 1.0.0`, `viewModelVersion 2`). Nota do arquivo: "Somente decide o que aparece primeiro na Quick View de cada modo. Não altera nenhum valor."

| Modo | P0 | maxMetrics | maxHighlights | maxAlerts | showScore | showFacts |
|---|---|---|---|---|---|---|
| `client` | status, área, preço | 3 | 3 | 2 | não | sim |
| `broker` | status, área, preço | 3 | 4 | 3 | sim | sim |
| `technical` | status, área, preço | 3 | 5 | 4 | sim | sim |
| `presentation` | status, área, preço | 3 | 3 | 2 | não | sim |

P1 no cliente e na apresentação: preço/m² (só cliente), ruído, privacidade, sol do norte. P1 no corretor e no técnico acrescenta os scores; P2 traz classe e rankings, e no técnico também `identity.id` e `metadata.dataVersions`. As listas `p0Fields`/`p1Fields`/`p2Fields` documentam a prioridade; o construtor usa os limites numéricos e as flags (`maxMetrics`, `maxHighlights`, `maxAlerts`, `showScore`, `showFacts`).

## 5. Estado vazio

Sem lote selecionado, `App.panels.empty` mostra o nome do empreendimento, a orientação "Toque em um lote no mapa, use a busca ou o painel Encontrar." e três números da base carregada: Lotes 498, Preços de R$ 299 mil a R$ 911 mil, Áreas de 250 a 762 m² (máximo real 761,96 m², arredondado na exibição), mais "Preço por m² da tabela atual: R$ 1.196/m²."

## 6. Atualização e proteção

- Mudança de preço, análise, Fit ou recomendação chega por `dataRevision` ou pelas chaves do store; `renderLot` refaz o view model do lote atual.
- A rolagem do painel é mantida só quando o lote e o painel são os mesmos (`sameLotPanel`); trocar de lote volta ao topo.
- `requestGuard` protege a única parte assíncrona: a explicação técnica do score (`openTechExplain`). Se o usuário mudou de lote durante o carregamento de `analysis-input.json`, o resultado é descartado.
- Falha no bloco de inteligência ou de Fit não derruba a Quick View: o bloco entra em `partialErrors` e `loadStatus` fica `PARTIAL`.

## 7. Desempenho

Medido com `plat/tests/harness.js` em Node: cerca de 0,04 ms por lote para montar o view model (498 lotes no modo corretor).

## 8. Testes

Em `plat/tests/map.test.js`: limite de destaques por modo e sem tema repetido (`quick view: highlights are capped per mode and never repeat a topic`); modo cliente sem códigos internos, sem frescor técnico e sem rótulo de cliente sem nome; lote fora do filtro continua selecionável e explica o motivo.

## 9. Não implementado / pendências

- Estados `INITIAL` e esqueleto de carregamento: `LOAD_STATUS` declara `INITIAL`, `PARTIAL`, `READY`, `ERROR`, mas os dados são síncronos e o construtor só devolve `READY` ou `PARTIAL`. Não há error boundary além do `try/catch` por bloco.
- Implementado em 08/10/2026: a Quick View mostra selo de origem nas métricas e fatos estimados e, no modo corretor, a nota "Estimados nesta ficha".
- Implementado em 08/10/2026: ao abrir um lote pela busca ou por uma lista, o foco vai para o título do lote e volta para quem abriu ao fechar; a troca de lote é anunciada ao leitor de tela.
- Telemetria: `lot_selected` e, desde 08/10/2026, `quick_action` (chave e nível da ação), ainda só em memória.
- Implementado em 08/10/2026: botão Técnico (oculto abaixo de 420 px) e botão "Apresentar" (visão limpa para o cliente; Esc ou "Sair da apresentação" volta ao modo anterior).
- A separação em `p0Fields`/`p1Fields`/`p2Fields` não comanda a montagem campo a campo; métricas e fatos têm lista fixa no construtor.
