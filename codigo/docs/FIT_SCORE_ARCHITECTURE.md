# Fit Score (compatibilidade cliente × lote)

Tópico 14. Implementação em `plat/src/intelligence/fit.js` (`App.fit`), metodologia em `plat/config/fit/viva-juara.json`, integração em `plat/src/state/selectors.js`, `plat/src/intelligence/recommendation.js`, `plat/src/filters/filters.js`, `plat/src/map/layers.js`, `plat/src/quickview/quickview.js` e `plat/src/presentation/panels.js`. Testes em `plat/tests/customer.test.js`. Esquema do perfil em `CUSTOMER_PROFILE_SCHEMA.md`; fórmulas e parâmetros em `FIT_METHODOLOGY.md`.

## 1. Conceito

O Fit Score responde "o quanto este lote combina com as preferências que este cliente informou". É uma média ponderada de 0 a 100 sobre as preferências avaliáveis.

- **Não é probabilidade de compra** nem previsão de comportamento. O painel do corretor diz isso: "A compatibilidade mede aderência ao perfil informado; não é probabilidade de compra." (`src/presentation/panels.js`). O rótulo oficial é `App.fit.label()` = "Compatibilidade com o perfil".
- **100 não é lote perfeito**: é aderência total às preferências preenchidas.
- **Não promete valorização**: nenhuma preferência ou matcher estima valorização futura.
- **Disponibilidade não muda o Fit**: o cálculo não lê `availability`. Um lote vendido tem o mesmo Fit que teria disponível; quem decide se ele pode ser oferecido é o RecommendationEngine (tópico 15), e UNKNOWN nunca é tratado como AVAILABLE.
- **`null` nunca vira 0**: preferência sem dado do lote sai do cálculo e reduz a cobertura; perfil sem preferência dá `fitScore = null`.

## 2. Score base e Fit

| | Score base (Moradia, Investimento, Família, Premium, Geral) | Fit Score |
|---|---|---|
| Pergunta | quanto o lote vale pela metodologia oficial | quanto o lote combina com este cliente |
| Depende do cliente | não; igual para todos | sim |
| Onde nasce | análise publicada (`Lot.intelligence`), reproduzida pelo `IntelligenceEngine` | `App.fit.fitLot` a cada perfil |
| Configuração | `config/scoring/viva-juara/1.0.json` | `config/fit/viva-juara.json` |
| Altera o outro | não | não; o Fit só lê o score base quando o cliente escolhe uma preferência de score (por exemplo, `housing`) |

O Fit não altera o Lot nem o perfil: os resultados são objetos congelados (`Object.freeze`) e o Lot é só lido por `App.model.get`.

## 3. Componentes (`App.fit`)

| Membro | Papel |
|---|---|
| `SOURCES`, `TYPES`, `STATUS` | vocabulários de origem da preferência, tipo de preferência e status do resultado |
| `MatchingRegistry` | matchers por id (`has`, `get`, `list`); sem `eval` (`has('EVAL') = false`) |
| `cfgOf(devId)` | `FitMethodologyConfig` do empreendimento (`App.configs.fit[devId]`) |
| `validateProfile(profile, cfg)` | valida o perfil contra o catálogo; devolve `{ ok, errors, warnings }` |
| `effectivePreferences(profile, cfg)` | preferências ativas, a última vence por chave, na ordem do catálogo |
| `buildProfile(input, cfg)` | ProfileBuilder: estado da interface → `CustomerProfile` |
| `isEmpty(profile)`, `profileCompleteness(profile, cfg)` | perfil sem preferência ativa; preenchimento do questionário (preferências ÷ 5, até 1) |
| `contextFor(lots, opts)` | contexto do lote: faixa de área do empreendimento e versões/atualidade de dados |
| `fitLot(profile, lot, cfg, ctx)` | FitScoreEngine para um lote; puro |
| `fitLots(profile, lots, cfg, opts)` | lote inteiro: valida o perfil (lança `INVALID_PROFILE`), monta um contexto único e chama `fitLot` |
| `cache()` | memoização por perfil e versões |
| `label()` | "Compatibilidade com o perfil" |

## 4. Fluxo na aplicação

```
state.preferences ({ chave: 1 | 2 | 3 }) + currentCustomerId
  → selectProfile   (App.fit.buildProfile)
  → selectFit       (fitCache.get → fitLots; Map lotId → FitScoreResult)
  → filtro "Compatibilidade mínima" (fitMin), camada de mapa "fit", Quick View, legenda
  → selectRecommendation (App.recommendation.recommend chama App.fit.fitLot por lote elegível ou em revisão)
```

| Consumidor | O que lê |
|---|---|
| `filters/filters.js` (`fitMin`) | `fitScore` |
| `map/layers.js` (camada `fit`) | `fitScore`; sem valor se status `INSUFFICIENT_PROFILE` ou `FAILED` ou `fitScore` `null` |
| `quickview/quickview.js` | com cliente selecionado: "<n>% compatível" ou "Compatibilidade não calculada", "Poucos dados para este perfil." se `coverage < 0.5`, "Resultado sujeito a confirmação de preço e disponibilidade" se preço ou status não estiver atualizado; pontos fortes como "Atende ao perfil: <rótulo>" |
| `intelligence/recommendation.js` (tópico 15) | `fitScore`, `coverage`, `confidence`; cobertura e confiança mínimas e Fit mínimo vêm de `config/recommendation` |
| `presentation/panels.js`, `app.js` | "<n>% compatível" (arredondado), "dados avaliados <n>%" |

`fitLots` roda sobre os 498 lotes, inclusive vendidos e UNKNOWN, porque compatibilidade não é elegibilidade. A exclusão por status é feita fora do Fit.

## 5. FitScoreResult

| Campo | Conteúdo |
|---|---|
| `customerProfileId`, `customerProfileVersion` | snapshot do perfil usado |
| `lotId`, `code` | lote |
| `status` | `COMPLETE` (cobertura 1), `PARTIAL` (cobertura < 1, ou nenhuma preferência avaliável), `INSUFFICIENT_PROFILE` (perfil vazio) |
| `fitScore` | 0–100, sem arredondamento; `null` em `INSUFFICIENT_PROFILE` ou sem preferência avaliável |
| `coverage` | 0–1: peso das preferências avaliadas ÷ peso de todas as preferências ativas |
| `confidence` | `{ value: 0–1 ou null, level: HIGH, MEDIUM, LOW ou UNKNOWN }` |
| `preferenceMatches` | uma entrada por preferência (ver `FIT_METHODOLOGY.md`), ordenada por contribuição |
| `domainMatches` | Fit por domínio (ENVIRONMENT, LOCATION, MOBILITY, GEOMETRY, COMMERCIAL, SCORE), derivado das mesmas preferências, sem peso extra |
| `strengths`, `mismatches`, `neutral` | até 5 maiores acertos, até 5 maiores incompatibilidades, demais |
| `warnings` | `EMPTY_PROFILE`, `NO_EVALUABLE_PREFERENCE`, `LOW_COVERAGE`, `STALE_PRICE` |
| `missingInputs` | fieldKeys sem dado no lote (ou sem contexto) |
| `versions` | `fitMethodologyVersion`, `profileVersion`, `lotAnalysisVersion`, `priceTableVersion` (só quando o orçamento participou; senão `null`) |
| `generatedAt`, `cacheKey` | data vinda do contexto (`null` se ausente); chave de reprodução |

O motor devolve códigos (`FIT_STRONG_MATCH`, `FIT_PARTIAL_MATCH`, `FIT_MISMATCH`, `FIT_MISSING_LOT_DATA`, `FIT_MISSING_CONTEXT`), nunca frases. A interface traduz.

## 6. Cobertura, confiança e preenchimento

| Medida | Pergunta | Cálculo |
|---|---|---|
| `coverage` | temos dado do lote para avaliar as preferências? | Σ peso avaliado ÷ Σ peso ativo |
| `confidence` | os dados usados são confiáveis? | Σ peso × qualidade da proveniência ÷ Σ peso avaliado; preço com atualidade `STALE` multiplica a qualidade por `stalePenalty` |
| `profileCompleteness` | o cliente informou preferências? | preferências efetivas ÷ 5, limitado a 1 |

Fit alto com cobertura baixa não deve ser lido como recomendação forte: abaixo de `minCoverage` o resultado leva `LOW_COVERAGE`, e o Quick View marca cobertura baixa.

## 7. Versões, reprodutibilidade e cache

`cacheKey` de cada resultado = `profileId | profileVersion | lotId | analysisVersion (ou "analysis?") | priceTableVersion (ou "price?", só se o orçamento participou; senão "-") | fitMethodologyVersion`. A disponibilidade não entra na chave: mudar o status de um lote não invalida o Fit (teste "availability never changes the Fit").

`profileVersion` é o checksum (`App.methodology.checksum`) de `{ developmentId, preferences: [key, target, importance, enabled] }`: o mesmo perfil gera a mesma versão, e mudar uma importância muda a versão.

`App.fit.cache()` guarda até 21 conjuntos de resultados (um por chave); chave `profileId | profileVersion | fitMethodologyVersion | analysisVersion | priceTableVersion | commercialFreshness | quantidade de lotes`. Acima disso o cache é limpo.

Mesmo perfil, mesmo lote, mesmo contexto e mesma metodologia dão o mesmo resultado; `fitLot` isolado e `fitLots` em lote coincidem (teste "single equals batch"), porque usam o mesmo contexto (`contextFor` calcula a faixa de área uma vez por lote de cálculo).

## 8. Desempenho

Cálculo síncrono, sem memoização interna. Medido em Node neste ambiente: cerca de 13 ms para 498 lotes com 5 preferências. O teste exige menos de 1 s.

## 9. Testes (`tests/customer.test.js`)

| Teste | Garante |
|---|---|
| "fit v1 reproduces the panel's previous compatibility" | para os 9 modelos e os 498 lotes, `fitScore / 100` é igual à relevância do ranking antigo (`App.services.recommendation.rank`) com diferença < 1e-12 |
| "golden profiles" | QuietFamily: melhor lote acima de 85, `COMPLETE`, cobertura 1; InvestorBudget: orçamento 1 dentro e 0 acima da tolerância; `priceTableVersion` `null` quando não informado; NaturePremium: lotes com mata nos fundos trazem `green` entre os pontos fortes |
| "matchers" | faixa, enum, booleano, proximidade, afastamento, máximo; nenhum matcher `EVAL` |
| "empty profile" | `INSUFFICIENT_PROFILE`, `fitScore` `null` (nunca 0) |
| "missing lot data" | dado ausente sai do cálculo, cobertura 0.5, `PARTIAL`, campo em `missingInputs` |
| "availability never changes the Fit" | mesmo Fit e mesma `cacheKey` com status SOLD; preço `STALE` reduz confiança e gera `STALE_PRICE` |
| "profile validation" | chave fora do catálogo, faixa invertida, duplicata (vale a última), versão determinística, `fitLots` recusa perfil inválido |
| "single equals batch" | igualdade e tempo |

```
cd plat/tests && node --test customer.test.js
```

## 10. Não implementado / pendências

- `CustomerFitApplicationService` e repositório de perfis: não existem. O perfil é montado a cada leitura a partir de `state.preferences`; as preferências ficam só no `localStorage` do navegador (ver `CUSTOMER_PROFILE_SCHEMA.md`). Desde 08/10/2026 cada cliente guarda o próprio perfil, também só no aparelho.
- Não há `fitAnalysisVersion` própria; `versions` não traz `lotStaticVersion` nem `availabilityRevision` (a disponibilidade não participa).
- Implementado em 08/10/2026: o resultado é validado; NaN, Infinity ou `fitScore` fora da faixa viram status `FAILED` com `fitScore` nulo.
- Implementado em 08/10/2026: a chave do cache inclui a revisão dos dados (`dataRevision`) e uma impressão digital dos valores e da proveniência dos campos que o perfil lê; um preço novo com a mesma `priceTableVersion` gera resultado novo.
- Implementado em 08/10/2026: um matcher que lança exceção ou devolve valor inválido marca aquela preferência como `FAILED` (fica fora da média e nunca conta como 0); `validateConfig` confere a metodologia antes do uso.
- Recomputação incremental, Web Worker, execução no backend, NLP e questionário: não existem.
- Calibração do Fit, simulação financeira (entrada, parcela) e afinidade de preço além do orçamento máximo: não existem.
