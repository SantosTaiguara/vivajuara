# Motor de recomendação (hard constraints + preferências)

Tópico 15. Implementação em `plat/src/intelligence/recommendation.js` (`App.recommendation`), política em `plat/config/recommendation/viva-juara.json` (empacotada por `plat/scripts/configBundle.js` em `App.configs.recommendation`), integração em `plat/src/state/selectors.js`, `plat/src/presentation/panels.js`, `plat/src/presentation/app.js`, `plat/src/map/layers.js`, `plat/src/map/legend.js` e `plat/src/quickview/quickview.js`.

Documentos complementares: `RECOMMENDATION_CONSTRAINTS.md` (catálogo de restrições), `RECOMMENDATION_POLICY.md` (política versionada), `RECOMMENDATION_REASON_CODES.md` (códigos). A explicação do ranking (tópico 16) está em `EXPLAINABLE_RANKING_ARCHITECTURE.md`.

## 1. Situação atual dos dados

Não existe espelho de vendas: os 498 lotes têm `availability.status = UNKNOWN` (ver `AVAILABILITY_DOMAIN.md`). A política só aceita `AVAILABLE` (`allowedAvailabilityStatuses`) e manda status desconhecido para revisão (`unknownAvailabilityPolicy = REVIEW_REQUIRED`). Consequência, verificada com `plat/tests/harness.js`:

- nenhum lote é recomendado (`recommendations = []`);
- todo lote que passa nas exigências vai para o bucket de revisão com o código `AVAILABILITY_UNKNOWN`;
- o status do resultado é `NO_ELIGIBLE_LOTS`.

Exemplo verificado (perfil Privacidade = Essencial, Silêncio = Importante; exigências orçamento até 500000 e área mínima 300): `candidateCount` 498, `ineligibleCount` 274 (`AREA_BELOW_MIN` 235, `PRICE_ABOVE_MAX` 39), `reviewRequiredCount` 224, `reviewCandidates` 25 (limite `reviewLimit`), `recommendations` 0. O painel mostra "Para revisar · status a confirmar com a loteadora" e a frase "Nenhum lote com disponibilidade confirmada atende ao perfil agora." (`recommendationSection` em `panels.js`).

## 2. O que o motor responde

"Quais lotes eu deveria apresentar a este cliente agora?" combinando três camadas, nesta ordem:

| Camada | Pergunta | Onde |
|---|---|---|
| Elegibilidade do sistema | O lote pode ser oferecido? | `systemEligibility` + política de disponibilidade (tópico 8) |
| Hard constraints do cliente | O lote atende às exigências eliminatórias? | `evaluateConstraint` |
| Preferências (Fit, tópico 14) | Entre os que sobraram, quem vem primeiro? | `App.fit.fitLot` |

Regras que o código garante:

- Uma restrição nunca vira peso alto: ela elimina, manda para revisão ou passa. Não existe caminho que transforme FAIL em penalidade de pontuação.
- Restrições nunca são relaxadas automaticamente. Com zero resultados, o motor devolve `constraintImpact` e `exclusionSummary`; quem decide alterar é o usuário.
- `UNKNOWN` de disponibilidade nunca é tratado como `AVAILABLE`.
- `null` nunca vira 0: valor ausente gera status `UNKNOWN` na restrição e `fitScore = null` sem perfil.
- Nenhum boost de negócio oculto: a ordenação usa apenas fit, cobertura, confiança e `lotId`.
- Fit é aderência ao perfil informado, não probabilidade de compra (texto exibido no modo corretor: "A compatibilidade mede aderência ao perfil informado; não é probabilidade de compra.").
- O motor não altera scores técnicos, lotes nem perfil: é uma função pura que devolve um objeto congelado (`Object.freeze`).
- Nenhum lote sai do dataset: ele é recomendado, enviado para revisão ou contado em `exclusionSummary` com um código.

## 3. Contrato

`App.recommendation.recommend(request) → RecommendationResult`.

| Campo do request | Uso |
|---|---|
| `developmentId` | universo de candidatos; lote de outro empreendimento nunca entra |
| `profile` | `CustomerProfile` do Fit (`App.fit.buildProfile`) |
| `constraints` | lista de `CustomerConstraint` (ver `RECOMMENDATION_CONSTRAINTS.md`) |
| `lots` | lotes canônicos (o selector passa todos os 498) |
| `scope` | `RecommendationScope` explícito `{ lotIds?, blockIds? }` ou `null` |
| `policy`, `fitCfg` | `RecommendationPolicy` e `FitMethodology` publicadas |
| `availabilityPolicy` | política do tópico 8 (usada para PROPOSAL) |
| `commercialFreshness`, `availabilityFreshness` | `FRESH` / `STALE` / `UNKNOWN` do repositório |
| `offline` | `true` quando `connectivity === 'OFFLINE'` |
| `dataVersions` | `staticVersion`, `analysisVersion`, `priceTableVersion`, `availabilityRevision` |
| `generatedAt` | o selector passa `null` (resultado determinístico) |

| Campo do resultado | Conteúdo |
|---|---|
| `requestId`, `cacheKey` | `rec-<checksum>` e a chave completa (seção 9) |
| `developmentId`, `customerProfileId`, `customerProfileVersion` | identificação |
| `recommendationPolicyVersion`, `fitMethodologyVersion`, `dataVersions`, `generatedAt` | snapshot de versões |
| `status` | ver seção 7 |
| `candidateCount`, `eligibleCount`, `reviewRequiredCount`, `ineligibleCount`, `outOfScopeCount`, `lowFitCount`, `reviewTotal` | contagens |
| `recommendations` | `RecommendedLot[]` (até `shortlistSize`) |
| `reviewCandidates` | candidatos em revisão (até `reviewLimit`), `tier = REVIEW_REQUIRED` |
| `exclusionSummary` | contagem por código de exclusão (se `exclusionSummaryEnabled`) |
| `constraintImpact` | `{ constraintId, key, rejectedCount, unknownCount }` por restrição |
| `warnings`, `diagnostics` | avisos do resultado e erros/avisos de validação |

Cada item (`RecommendedLot` ou candidato em revisão) carrega `lotId`, `code`, `rank`, `tier`, `fitScore`, `coverage`, `confidence` (valor), `fitConfidence` (nível), `keyReasonCodes`, `constraintSummary { passed, unknown[], total }`, `constraintResults`, `eligibility`, `availabilityStatus`, `commercialFreshness`, `warnings`, `reviewReasons` e o `FitScoreResult` completo em `fit` (evidência para o tópico 16). Os dados de exibição do lote não são duplicados: a interface busca o lote pelo `lotId`.

## 4. Pipeline

| Fase | O que faz | Código |
|---|---|---|
| 0. Validação | `App.fit.validateProfile` + `validateConstraints`; erro → `INVALID_PROFILE` com `diagnostics`, sem ranking. Sem preferências e sem restrições → `INSUFFICIENT_PROFILE` | `recommend` |
| 1. Universo | lotes do `developmentId` e dentro do `scope` explícito; o resto conta em `outOfScopeCount` | `inScope` |
| 2. Elegibilidade do sistema | status fora da lista permitida → inelegível (curto-circuito: SOLD etc. não chegam às restrições nem ao Fit); UNKNOWN → revisão; disponibilidade STALE → conforme `staleCommercialPolicy` | `systemEligibility` |
| 3. Hard constraints | avaliadas da mais barata para a mais cara; para no primeiro FAIL/ERROR | `effective`, `evaluateConstraint` |
| 4. Qualidade do dado | offline com `offlinePolicy = COMMERCIAL_CONFIRMATION_REQUIRED` → aviso `COMMERCIAL_CONFIRMATION_REQUIRED` no resultado | `recommend` |
| 5. Fit | só para lotes ainda elegíveis ou em revisão; cobertura abaixo de `minFitCoverage` ou confiança abaixo de `minFitConfidence` → revisão; fit abaixo de `minimumFitScore` → `LOW_FIT` | `App.fit.fitLot` |
| 6. Ranking | `compare`: fitScore DESC, coverage DESC, confidence DESC, lotId ASC | `cmp` |
| 7. Tiers | PRIMARY / STRONG_MATCH / ALTERNATIVE; revisão separada | `recommend` |

Ordem de custo das restrições (`COST`): `identity` 0; `commercial` e `geometry` 1; `surroundings` 2; `environmental`, `location`, `mobility` 3; empate pelo `id` da restrição.

## 5. Ranking

- Só candidatos elegíveis entram em `recommendations`; a revisão é ordenada com o mesmo comparador, em lista separada.
- Sem aleatoriedade e sem boost: `cmp` não lê preço, score técnico, estoque ou prioridade comercial.
- A ordem de entrada dos lotes não altera o resultado, porque o último critério é o `lotId`.
- Quando vários lotes empatam no fit (caso comum com perfis de um só critério), a posição entre eles é decidida por cobertura, confiança e, por fim, `lotId`. A explicação do tópico 16 chama esse caso de `EQUIVALENT_FOR_PROFILE` e não diz que um é "melhor".

## 6. Tiers

| Tier | Regra (`recommend`, fase 7) |
|---|---|
| `PRIMARY` | `fitScore ≥ strongMatchFitScore` (70) e ainda há vaga em `primaryTierSize` (3) |
| `STRONG_MATCH` | `fitScore ≥ 70` depois de preenchidas as vagas de PRIMARY |
| `ALTERNATIVE` | elegível, `fitScore` entre `minimumFitScore` (50) e 70, ou `fitScore` nulo (perfil só com restrições) |
| `REVIEW_REQUIRED` | candidato com `reviewReasons` (disponibilidade UNKNOWN, dado crítico desconhecido, dado STALE, cobertura ou confiança baixa) |

PRIMARY nunca é forçado: sem preferências não há PRIMARY, e se nenhum lote atinge 70 a lista não tem PRIMARY e o status é `NO_STRONG_RECOMMENDATION`.

## 7. Status do resultado

| Status | Quando |
|---|---|
| `SUCCESS` | há pelo menos um PRIMARY |
| `NO_STRONG_RECOMMENDATION` | há recomendações sem PRIMARY, ou nenhuma recomendação mas houve lotes com fit baixo (`LOW_FIT`) |
| `NO_ELIGIBLE_LOTS` | nenhum lote elegível (hoje é o caso: todos vão para revisão) |
| `INSUFFICIENT_PROFILE` | perfil sem preferências e sem restrições |
| `INVALID_PROFILE` | erro de validação do perfil ou das restrições |

## 8. UNKNOWN, STALE e offline

| Situação | Comportamento |
|---|---|
| Disponibilidade UNKNOWN | revisão (`AVAILABILITY_UNKNOWN`); com `unknownAvailabilityPolicy = EXCLUDE` seria exclusão |
| Disponibilidade STALE | `staleCommercialPolicy`: hoje `REVIEW_REQUIRED` → revisão (`STALE_AVAILABILITY`) |
| Preço STALE com restrição de orçamento | restrição marcada `commercial: true` passa, mas o lote vai para revisão (`STALE_COMMERCIAL_DATA`) |
| Campo da restrição nulo, `UNKNOWN` ou `CONFLICTED` na proveniência | `onUnknown` da restrição: `EXCLUDE`, `REVIEW_REQUIRED` ou `ALLOW_WITH_WARNING` |
| Offline | o cálculo roda sobre o cache; o resultado leva `COMMERCIAL_CONFIRMATION_REQUIRED` |

## 9. Cache e determinismo

`cacheKey(req, policy, fitCfg)` junta: `developmentId`, `profile.id`, `profileVersion`, as quatro versões de dados, `fitMethodologyVersion`, `policy.version`, checksum das restrições efetivas (`metricKey`, `operator`, `expectedValue`, `onUnknown`), checksum do escopo (ou `all`), `on`/`off` e `commercialFreshness`. O `requestId` é o checksum dessa chave: mesmos insumos, mesmo id e mesma ordem.

No navegador não há cache dedicado de recomendação: `App.selectors` memoiza `recommendation(...)` pela identidade dos argumentos (lotes, perfil, lista de restrições, escopo, frescor, `dataRevision`, offline). O Fit tem cache próprio (`App.fit.cache()`). Uma mudança de preço, disponibilidade, perfil, política ou metodologia muda a chave e recalcula tudo (recompute completo, sem atualização incremental).

## 10. Integração com o estado (`state/selectors.js`)

```
preferences ─► selectProfile ─► CustomerProfile ─┐
constraints ─► selectConstraints (constraintList) ├─► selectRecommendation ─► selectRanking (lista, pinos, tooltip)
todos os lotes (selectLots) ──────────────────────┤
recScope (somente por ação explícita) ────────────┘
activeFilters ─► selectFilterQuery ─► selectFilterResult (só esmaece o mapa)
```

- A recomendação roda sobre todos os lotes do empreendimento. `selectRecommendation` não recebe `activeFilters`: mudar um filtro não muda perfil, restrições nem recomendação (verificado: com o filtro Quadra B o objeto da recomendação é o mesmo, por identidade).
- `RecommendationScope` só existe por ação explícita: o botão "Usar os N lotes do filtro na recomendação" (`data-act="recScope"` em `app.js`) grava `recScope = { lotIds (ordenados), filterHash, appliedAt: null }`. Esse escopo é uma fotografia: mexer nos filtros depois não o altera; o botão passa a "Usando N lotes do filtro · voltar a todos" e um segundo clique volta a `null`. Exemplo verificado com Quadra B: `candidateCount` 88, `outOfScopeCount` 410.
- "Limpar perfil" (`clearProfile`) zera preferências, restrições, preset e escopo.
- `constraintList` descarta valores `null`, `false` e `''`, e chaves fora do catálogo da política (`constraint` devolve `null`). `store.sanitize` também descarta chaves de restrição desconhecidas no estado salvo.
- `selectRanking` é a visão de compatibilidade usada pela lista, pinos e tooltip: recomendações primeiro, depois a revisão, com `relevance = fitScore / 100` e `review = true` na revisão.

## 11. Mapa e interface

| Elemento | Comportamento | Arquivo |
|---|---|---|
| Overlay "Recomendação" | contorno sólido nos recomendados; pinos numerados nos 5 primeiros. Sem recomendados, contorno tracejado e pinos "Nº para revisar (status a confirmar)" nos 5 primeiros da revisão | `map/layers.js` (`recommendationFeatures`, `resolveStyle`) |
| Legenda | seção "Recomendação para o cliente" (cliente: "Sugestões para você") com contagem por tier; REVIEW_REQUIRED usa `reviewTotal` | `map/legend.js` |
| Painel Encontrar | grupos "Melhores opções", "Forte aderência", "Alternativas", "Para revisar" (8 visíveis, botão para ver todos os carregados), resumo de exclusões só no modo corretor | `presentation/panels.js` |
| Quick View | selo "Nº na recomendação" ou "Nº para revisar (status a confirmar)"; ação "Por que esta posição?" fora do modo cliente | `quickview/quickview.js` |
| Geometria | nunca é alterada; a recomendação só muda contorno, pino e camada de destaque | `map/layers.js` |

`App.recommendation.mapIds` existe, mas o mapa usa `App.mapLayers.recommendationFeatures`.

## 12. Testes

`plat/tests/customer.test.js` (executar `cd plat/tests && node --test customer.test.js`):

- hoje todos UNKNOWN: nada recomendado, 498 em revisão, `reviewCandidates.length = reviewLimit`;
- lotes AVAILABLE são ranqueados e recebem tier; SOLD nunca chega a restrições nem ao Fit (`exclusionSummary.SOLD`);
- restrições excluem com motivo, não relaxam e reportam impacto (`budgetMax` 1000 → `NO_ELIGIBLE_LOTS`, `rejectedCount` 498);
- dado desconhecido segue `onUnknown` (`UNKNOWN_REAR`); `areaMin > areaMax` → `HARD_CONSTRAINT_CONFLICT`;
- escopo explícito, mudança de disponibilidade reordena, `cacheKey` muda com os insumos, `requestId` determinístico, offline gera `COMMERCIAL_CONFIRMATION_REQUIRED`.

## 13. Não implementado / pendências

- Espelho de vendas: sem ele, nenhuma recomendação comercial é possível; só o bucket de revisão.
- Status `PARTIAL` e `FAILED` da especificação não existem; o código usa `INVALID_PROFILE` para erro de validação.
- `NOT_APPLICABLE` como status de restrição não existe.
- Implementado em 08/10/2026: lote sem `identity`, sem disponibilidade ou de outro empreendimento gera diagnóstico (`INVALID_LOT`, `OTHER_DEVELOPMENT`) em `diagnostics`.
- Implementado em 08/10/2026: `excluded` traz um `ExcludedLotDetail` por lote excluído (etapa, regra, valor real e esperado). O resultado também traz avisos de conflito derivados dos dados (`BUDGET_BELOW_CHEAPEST_MATCH`, `BUDGET_BELOW_CHEAPEST_LOT`, `CONSTRAINT_UNSATISFIABLE`), sempre com `autoRelaxed: false`.
- `minFitConfidence` manda o lote para revisão; a especificação sugeria usá-lo só como requisito de PRIMARY. A política de confiança mínima por tier depende de decisão.
- Perfil só com restrições (sem preferências): o primeiro item recebe `TOP_FIT` e todos recebem `HIGH_PROFILE_COVERAGE` (cobertura assumida 1), embora `fitScore` seja `null` e a ordem seja por `lotId`. Necessita confirmação se esses códigos devem ser suprimidos nesse caso.
- `rankingStrategy` e `tieBreakers` da política são declarativos: o comparador é fixo no código.
- Modo offline só adiciona aviso; não muda o status do resultado.
- Execução no backend, API de recomendação, snapshot de auditoria, compartilhamento da recomendação, diversificação de resultados e prioridade comercial explícita: não implementados.
- Restrições `blocks`, `maxNoise` e `maxGateRoute` existem no catálogo, mas não têm controle na interface.
- Requisitos condicionais e grupos OU de restrições: não implementados.
