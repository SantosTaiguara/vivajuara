# Filtros em três níveis (arquitetura)

Tópico 17. Implementação em `plat/src/filters/filters.js` (`App.filters`), com fachada em `plat/src/services/finding.js` (`App.services.filtering`), integração em `plat/src/state/selectors.js`, `plat/src/state/store.js` (persistência e link), `plat/src/presentation/panels.js` (painel Encontrar), `plat/src/presentation/app.js` (eventos), `plat/src/map/layers.js` (esmaecer no mapa), `plat/src/map/legend.js` (contagens e filtro pela legenda) e `plat/src/quickview/quickview.js` ("fora dos filtros").

Documentos complementares: `FILTER_REGISTRY.md` (definições), `FILTER_QUERY_SCHEMA.md` (estado, query, resultado, URL), `FILTER_LEVELS.md` (níveis e modos).

## 1. Configuração

`plat/scripts/configBundle.js` empacota as pastas `fit`, `recommendation`, `filters`, `layers` e `quickview` de `plat/config/` quando existem. A pasta `plat/config/filters/` não existe: o registro de filtros está no código (`DEFS` em `filters.js`) e não há configuração de filtros por empreendimento. As opções de distância (`[200, 400, 650]` e `[250, 500, 750]`), de compatibilidade (`[50, 60, 70, 80]`) e de score no painel (`[60, 70, 80, 88]`) estão fixas no código.

## 2. Princípio

Filtro responde "quais lotes eu quero ver destacados agora". Ele não decide recomendação nem perfil:

- O filtro nunca remove lotes do domínio nem do mapa: o mapa esmaece o que não corresponde (overlay `filterDim`, classe `dim`); o lote selecionado e os lotes em comparação continuam selecionáveis.
- O filtro nunca altera o `CustomerProfile`, as exigências nem a recomendação. `selectRecommendation` não recebe `activeFilters` (verificado: com o filtro Quadra B o objeto da recomendação é o mesmo).
- O filtro só chega à recomendação por ação explícita do usuário: o botão "Usar os N lotes do filtro na recomendação" grava um `RecommendationScope` (ver `RECOMMENDATION_ENGINE.md`, seção 10). O escopo é uma fotografia dos ids naquele momento.
- Disponibilidade `UNKNOWN` nunca é tratada como disponível: "Somente disponíveis" usa `App.availability.isOfferable` e hoje devolve 0 lotes, porque os 498 estão UNKNOWN (sem espelho de vendas). O painel avisa: "Sem espelho de vendas: nenhum lote tem status confirmado ainda. "Somente disponíveis" vai mostrar zero lotes até a loteadora enviar o espelho."
- `null` nunca vira 0: um valor ausente segue a política de nulos do filtro (`nullPolicy`), não é comparado como número.
- Sem `eval`: operadores numa lista fechada (`OPS`).

## 3. Pipeline

```
FilterState (st.activeFilters, chaves planas editadas pela UI)
   │ compile(state, { mode, developmentId })        validação, normalização, ordem estável
   ▼
FilterQuery { version, developmentId, conditions[], scope: null, unknownPolicy: 'PER_FILTER', createdAt: null, hash }
   │ run(lots, query, ctx)                         plano por custo, nulos, avisos
   ▼
FilterResult { status, hash, matchedIds, total, unmatchedCount, warnings, plan, elapsedMs }
   ├─► selectRenderModel → MapRenderModel (esmaece não correspondentes)
   ├─► selectLegend → contagens filtradas
   ├─► painel Encontrar (contagem "N de 498 lotes nos filtros", chips)
   └─► Quick View (whyNot → "Fora dos filtros atuais (…). O lote continua selecionável.")
```

| Função | Papel |
|---|---|
| `compile(state, ctx)` | `FilterState` → `{ query, errors }`; condições inválidas são relatadas em `errors` e não entram na query |
| `run(lots, query, ctx)` | executa as condições (AND entre filtros), devolve `matchedIds` |
| `test(condition, lot, ctx)` | avalia uma condição num lote, com política de nulos |
| `valueOf` (interno) | provedor de valor: o único ponto que lê o lote (inclui favoritos, fit, score, proveniência e classe) |
| `whyNot(lot, query, ctx)` | condições que o lote não atende, com `unknown: true` quando falta o dado |
| `facets(lots, query, ctx, ids)` | contagens por opção, excluindo a própria condição (facetas autoexcludentes) |
| `rangeStats(lots, fieldKey)` | `{ min, max, count, unknown }` a partir dos dados |
| `serialize` / `parse` | estado ↔ texto compacto para o link |
| `without(state, filterId)` | remove um filtro (chip ×) |
| `levelsFor(mode)`, `visible(def, mode)` | níveis e filtros visíveis por modo |

## 4. Execução

- Composição: AND entre condições; dentro de uma condição de lista (`IN`), OR entre valores. Não há grupos OU entre filtros.
- Plano: condições ordenadas por `cost` (0 identidade/status/favoritos, 1 números e classe/score, 2 atributos avançados, 3 alertas/proveniência, 4 fit) e por `filterId`; para no primeiro teste falso.
- Empreendimento: `query.developmentId` diferente de `ctx.developmentId` → `status INVALID`, `matchedIds` vazio, aviso `WRONG_DEVELOPMENT`.
- Custo: O(N × K) sobre os 498 lotes, sem índice; o teste "filters do not mutate their inputs and run fast on 498 lots" cobre não mutação e desempenho.
- Valores derivados não são recalculados: score, classe, alertas e proveniência são lidos do lote canônico; o fit vem do mapa já calculado pelo selector (`selectFit`).

## 5. Avisos de qualidade

`run` adiciona avisos sem esconder lotes:

| Aviso | Quando | Texto no painel |
|---|---|---|
| `STALE_PRICE` | filtro de preço com `freshness.commercial.status = STALE` | "Preços sem confirmação nesta sessão: o filtro usa o último valor conhecido." |
| `STALE_AVAILABILITY` | filtro de status ou "Somente disponíveis" com disponibilidade STALE | "Disponibilidade sem confirmação nesta sessão." |
| `ESTIMATED_FIELD` | ruído, privacidade ou trânsito (campos estimados) | "Ruído, privacidade e trânsito são estimativas." (oculto no modo cliente; os rótulos já dizem "(estimativa)") |
| `FIT_UNAVAILABLE` | compatibilidade mínima sem perfil | "Compatibilidade mínima exige um perfil de cliente." |

Hoje a disponibilidade tem frescor `UNKNOWN` (não STALE), então o aviso que aparece é o de ausência de espelho de vendas.

## 6. Estado, persistência e link

- `st.activeFilters` é persistido por empreendimento (`ws:<dev>:state`, parte `prefs`, `store.save`). Ao restaurar, `store.sanitize` descarta chaves desconhecidas, status fora do enum e quadra inexistente.
- `st.filterLevels` (`{ ADVANCED, TECHNICAL }`) guarda quais seções estão abertas.
- O link carrega os filtros em `?f=` (`App.router.token` usa `serialize`; `parse` lê de volta e descarta partes desconhecidas ou malformadas). Favoritos são pessoais e nunca vão no link.

## 7. Interface

- Filtragem ao vivo em todos os níveis: cada `change` em `data-f` chama `setFilter` e grava no store; não há botão Aplicar nem debounce.
- Chips dos filtros ativos (`chipText`) com remoção individual (`fchip`) e "Limpar filtros" (`clearAll`).
- Facetas ao lado das opções (status, quadra, formato, orientação dos fundos); status com contagem 0 não aparece, a menos que esteja selecionado.
- Legenda: um item vira filtro só quando o motor expressa exatamente os mesmos lotes (`filterActionFor`): situação (`statuses`), faixa de preço ou de área e "mata nos fundos" (`greenBehind`, só no modo corretor). O resultado é um `FilterState` normal, com chip.
- Analytics: `filter_changed`, `filter_removed`, `filters_cleared`, `recommendation_scope` (`app.js`), sem dado pessoal.

## 8. Backend

`plat/backend/src/modules/lots/lots.query.js` tem parâmetros próprios para a listagem da API (`status`, `block`, `minArea`, `maxArea`, `minPrice`, `maxPrice`, `class`, `minHousingScore`, `noiseLevel`, `privacyLevel`, `corner`, `search`), cada um mapeado para um `fieldKey` canônico. Esse contrato não usa `FilterQuery` nem o registro de `filters.js`: as semânticas são paralelas, não compartilhadas.

## 9. Testes

`plat/tests/filters.test.js` (executar `cd plat/tests && node --test filters.test.js`): paridade com os filtros anteriores; "Somente disponíveis" = 0 hoje; nulo nunca corresponde a condição de valor e não é zero; hash e ordem estáveis, valores inválidos relatados; níveis por modo; filtros novos; facetas autoexcludentes com UNKNOWN separado; STALE gera aviso; link ida e volta sem favoritos; sem mutação e rápido em 498 lotes.

## 10. Não implementado / pendências

- `plat/config/filters/` não existe; registro e opções estão fixos no código.
- Implementado em 08/10/2026: todo filtro que não pôde ser aplicado (inválido, aplicado em parte ou oculto no modo) fica em `query.dropped`, e o painel o mostra como não aplicado em todos os modos. A aplicação não é bloqueada.
- Implementado em 08/10/2026: busca textual como parte da query (filtro `q`, por código de lote ou quadra) e migração de query (`migrateQuery`, `migrateState`).
- Grupos OU entre filtros (`FilterGroup`), presets e filtros salvos (`SavedFilter`), modo "mostrar só correspondentes", botão Aplicar no celular e debounce: não implementados. A gaveta do celular ganhou o botão "Ver N lotes no mapa", que fecha a gaveta; os filtros continuam valendo na hora.
- Implementado em 08/10/2026: `FilterResult` traz `unmatchedLotIds`, `facets` (contagem por opção) e `diagnostics`.
- Implementado em 08/10/2026: diagnóstico de zero resultados e impacto por filtro (`FilterImpact`); o painel mostra sugestões "tirar filtro X → N lotes".
- Implementado em 08/10/2026: a comparação avisa quando um lote comparado está fora dos filtros atuais.
- Implementado em 08/10/2026: botão "Salvar como exigência do cliente" (modo corretor). Filtros nunca mudam o perfil sozinhos.
- Analytics `advanced_filters_opened` e `technical_filters_opened`: não emitidos. Desde 08/10/2026 são emitidos (em memória) `filter_zero_result`, `filter_suggestion_applied` e `filters_saved_as_constraints`.
- Implementado em 08/10/2026: filtros de cobertura e confiança mínimas do Fit (`fitCoverageMin`, `fitConfidenceMin`) e de frescor (`freshness`). Filtro por versão de dados continua inexistente.
