# Legenda inteligente e contextual

Tópico 19. Implementação em `plat/src/map/legend.js` (`App.legend`), seleção memoizada em `plat/src/state/selectors.js` (`selectLegend`), desenho em `plat/src/presentation/app.js` (`renderLegend`, `legendOpen`) e estilos em `plat/src/presentation/styles.css` (bloco "smart legend (19)" e regras de `.legend` por largura). A política vem de `legendPolicy` em `plat/config/layers/viva-juara.json`.

Documentos relacionados: `LEGEND_MODEL_SCHEMA.md`, `LEGEND_INTERACTION_POLICY.md`, `LEGEND_ACCESSIBILITY.md` e, para escalas, `MAP_LAYER_SCALES.md`.

## 1. Princípio

A legenda explica a visualização ativa; ela não é uma segunda fonte de verdade. O `LegendModel` é derivado do `MapRenderModel` (tópico 18): mesma `ScaleDefinition`, mesmos `LayerValueResult`, mesmo resolvedor de faixa. Por isso a cor de um lote, o item da legenda em que ele cai e o texto do tooltip sempre concordam. A legenda não recalcula valores, não refaz escala com filtro e não aplica filtro sozinha.

Verificado em `plat/tests/map.test.js` (`legend invariants`): em 13 camadas, com filtro ativo, a soma dos totais é 498, a soma dos filtrados é igual ao tamanho do `FilterResult` e as cores dos itens (sem baldes) são exatamente as cores da escala do mapa.

## 2. Pipeline

```
selectRenderModel(st)                         MapRenderModel (tópico 18)
  -> selectLegend(st)                         memo(model, FilterResult, filtroAtivo, modo, loteAtual, freshness)
     -> App.legend.build(input)               LegendModel (sem formatação de texto)
  -> App.legend.viewModel(lm, opções)         LegendViewModel (textos, contagens, aria, avisos por modo)
  -> renderLegend(st, model) em app.js        HTML em #legend
```

`renderMap` chama `renderLegend` sempre que o mapa é redesenhado (chaves `MAP_KEYS` do store, incluindo `legendFocus` e `legendExpanded`). Com a análise solar aberta e "Sol agora" no mapa, a legenda é a de `renderSolarLegend` ("Lado com sol neste horário"), fora deste motor.

## 3. Componentes

| Componente | Função | Responsabilidade |
|---|---|---|
| Política | `policyOf(devId)` | padrão do código sobrescrito por `legendPolicy` |
| LegendCountAggregator | `aggregate(values, matched)` | cada lote entra em exatamente um item (faixa, categoria ou balde `#<valueStatus>`) |
| LegendEngine | `build(input)` | monta `LegendModel`, seções, cobertura, frescor, qualidade, indicador do selecionado e invariante |
| Ação de filtro | `filterActionFor(def, item, values, lots)` | item -> patch de filtro, só quando o mapeamento é exato |
| LegendViewModel | `viewModel(lm, { mode, selectedCode, customerLabel })` | texto das contagens, `aria`, avisos, cobertura, overlays |
| LegendState | `defaultState`, `focus`, `clearFocus`, `onLayerChange`, `persistable` | estado de UI; a aplicação usa as chaves `legendFocus` e `legendExpanded` do store em vez destas funções |

## 4. Política do Viva Juara

`legendPolicy` (versão `1.0.0`): `lowCoverageRatio = 0.8`, `countModeWithoutFilter = TOTAL_ONLY`, `countModeWithFilter = FILTERED_AND_TOTAL`, `interaction = { hoverHighlight: true, clickFocus: true, clickPin: false, explicitFilterAction: true, allowMultiFocus: false, keyboardNavigation: true }`. O que cada flag faz de fato está em `LEGEND_INTERACTION_POLICY.md`.

## 5. Status e contagem

| Status | Regra em `build` |
|---|---|
| `READY` | cobertura completa, ou Disponibilidade (UNKNOWN é categoria); também a camada `none` (sem seções) |
| `PARTIAL` | `coverageRatio < 1` fora da Disponibilidade |
| `NO_DATA` | nenhum lote com valor (e não é a Disponibilidade com UNKNOWN) |
| `ERROR` | escala com erro ou exceção no motor (`legend:error`) |
| `UNAVAILABLE` | declarado em `STATUS`, nunca produzido |

Modo de contagem: `NONE` no modo cliente; `FILTERED_AND_TOTAL` com filtro ativo ("<filtrados> / <total>"); `TOTAL_ONLY` sem filtro. O total é sempre do empreendimento inteiro; o filtrado vem de `FilterResult.matchedIds`. A escala não muda com filtro, e a legenda diz isso: "<m> de <t> correspondem aos filtros. A escala não muda com o filtro."

Situação atual (498 lotes, sem espelho de vendas): na Disponibilidade, 498 lotes em "Status não confirmado" e 0 nos demais status, com a nota "Ainda sem espelho de vendas: nenhum lote tem status confirmado. A planta aparece limpa." Os itens com 0 lotes ficam desabilitados. As demais camadas têm 498 de 498 lotes com valor.

## 6. Conteúdo por modo

| Elemento | Cliente | Corretor | Técnico |
|---|---|---|---|
| itens com rótulo e cor | sim | sim | sim |
| contagens | não | sim | sim |
| hachura (desconhecido/conflito) | não | sim | sim |
| conflito | somado a "Sem dado" | "Fontes divergentes" | "Fontes divergentes" |
| aviso de baixa cobertura | sim | sim | sim |
| "Com dado: X de Y lotes." | não | sim | sim |
| aviso de frescor comercial | "Valores sujeitos a confirmação." | "Dados comerciais sem confirmação nesta sessão: mostrando o último valor conhecido." ou "<n> lotes com dados comerciais desatualizados." | igual ao corretor |
| resumo de qualidade (estimados, conflitos) | não | só no modelo (não é desenhado) | só no modelo (não é desenhado) |
| título da camada Fit | "Compatibilidade com o cliente" | "Compatibilidade com <nome>" | igual ao corretor |
| seção de recomendação | "Sugestões para você", sem números | "Recomendação para o cliente", com contagem | igual |
| escala, domínio e versão | não | não | "Escala <tipo> · <domínio> · versão <v>" |
| ação de filtro no item | Disponibilidade, Preço e Área | também "Mata nos fundos" | igual ao corretor |

Só no modo cliente, na Disponibilidade, sem conexão e com espelho de vendas carregado: "Disponibilidade sujeita a confirmação."

## 7. Layout responsivo

| Largura | Comportamento (`styles.css`, `legendOpen` em `app.js`) |
|---|---|
| a partir de 1024 px | painel flutuante no canto inferior esquerdo (`left: 10px; bottom: 10px`), largura máxima `min(560px, 100% - 20px)` |
| abaixo de 1024 px, sem lote | acima da troca de base (`bottom: var(--sheet-h-now) + 50px`) |
| abaixo de 1024 px, com lote aberto | continua acessível como chip, acima da troca de base (`.edge.r` fica em `--sheet-h-now + 10px`), altura máxima limitada e rolagem própria |
| abaixo de 700 px | começa recolhida (`legendExpanded == null` e `innerWidth < 700`): só o chip "<camada> ▾" e o botão "Legenda"; fonte 11,5 px |
| teclado virtual aberto | oculta (`.ws.kb .legend`) |

O chip "<camada> ▾" abre o menu de camadas ("o que quero visualizar?"); o botão "Legenda"/"Recolher" abre ou fecha a explicação ("o que esta visualização significa?"). Uma escolha explícita (`legendExpanded`) vale para qualquer largura e fica salva como preferência.

## 8. Erros

Exceção em `viewModel` ou `build`: a legenda mostra "Legenda indisponível." e o mapa continua interativo. Camada pedida indisponível: aviso "Não foi possível usar a camada pedida; mostrando a camada padrão."

## 9. Não implementado / pendências

- Abaixo de 700 px, a regra `.legend .note { display: none }` esconde as notas informativas da legenda (resumo do filtro, texto do lote selecionado); os avisos (`.note.warn`, cobertura baixa e dado desatualizado) continuam visíveis.
- Legenda contínua (gradiente, ticks): nenhuma camada usa escala contínua.
- Implementado em 08/10/2026: o marcador de posição do lote selecionado aparece sobre a escala.
- `dataQualitySummary`, `freshnessSummary.lastSyncAt` e a confiança (alta, média, baixa sempre `null`) não aparecem na interface.
- Seções de referência e de rota (pontos de referência, rotas) não existem na legenda.
- Ajuda contextual ("o que significa") além da descrição e da nota da camada: não implementada.
- Posição arrastável e "fixar" (`pinned`) da legenda: só no estado, sem interface.
