# Configuração dos scores (ScoringMethodologyConfig)

Tópico 13. Configuração em `plat/config/scoring/viva-juara/1.0.json` e ponteiro em `plat/config/scoring/viva-juara/current.json`. Validação, compilação, checksum, diff, impacto e ciclo de vida em `plat/src/intelligence/methodology.js` (`App.methodology`); normalizações em `plat/src/intelligence/normalization.js` (`App.inormalize`). Execução descrita em `INTELLIGENCE_ENGINE.md`. Testes em `plat/tests/intelligence.test.js`.

## 1. Situação atual

- Existe uma versão: `1.0.0`, `PUBLISHED`, `publishedAt = 2026-10-06T00:00:00.000Z`, checksum `5056f1ec`.
- `changeReason`: "Extração 1:1 da análise de 2026-10-06 (analysis.py). Nenhuma fórmula, peso ou limite foi alterado."
- Paridade: o motor com esta config reproduz os 45 campos analíticos dos 498 lotes publicados, sem diferença. Classes, rankings e alertas continuam iguais.
- Nenhum critério lê disponibilidade ou preço. `liquidity`, `relativeValue`, `priceQuality` e o score Investimento combinam atributos medidos (área, sol, privacidade, silêncio, geometria, vista); não são projeção de valorização.
- A config é dado, não código: o JSON só nomeia operações registradas e seus parâmetros. Nenhuma função é embutida no JSON e nada é avaliado por `eval`.

## 2. Arquivos e carregamento

| Arquivo | Conteúdo |
|---|---|
| `config/scoring/<dev>/<versão>.json` | config completa de uma versão |
| `config/scoring/<dev>/current.json` | ponteiro: `{ developmentId, current: "1.0.json", methodologyVersion: "1.0.0", updatedAt }` |

`scripts/configBundle.js` lê os arquivos cujo nome casa com `^\d+\.\d+\.json$` e grava `App.configs.scoring[dev] = { current, versions }` no bundle (`scripts/build.js`) e no harness de testes. `App.methodology.current(devId)` devolve a config apontada; `App.methodology.compiled(cfg)` compila uma vez e guarda em cache pelo checksum. O motor recebe sempre a config já compilada; não busca arquivo.

## 3. Cabeçalho

| Campo | Valor na v1.0 |
|---|---|
| `kind` | `scoring-methodology` |
| `schemaVersion` | `1.0` |
| `methodologyId` | `viva-juara-analysis` |
| `methodologyVersion` | `1.0.0` (semver obrigatório) |
| `developmentId` | `viva-juara` |
| `status` | `PUBLISHED` |
| `createdAt`, `publishedAt` | `2026-10-06T00:00:00.000Z` |
| `rounding` | `{ score: "HALF_EVEN", note: "NONE", displayNoteDecimals: 1 }` (declarativo; o motor lê o arredondamento de cada score) |

## 4. Scores

Todos: `aggregation = WEIGHTED_SUM`, `scale = 10`, `rounding = HALF_EVEN`, `missingPolicy = BLOCK_SCORE`, `minCoverage = 1`. Fórmula: `score = arredonda(10 × Σ peso × nota)`, notas de 0 a 10.

| Score (`fieldKey`) | Critérios e pesos |
|---|---|
| `housing` (`intelligence.scores.housing`), Moradia | quiet 0.25, privacy 0.2, solar 0.2, lowTraffic 0.15, view 0.1, geometry 0.1 |
| `investment` (`intelligence.scores.investment`), Investimento | liquidity 0.35, relativeValue 0.25, priceQuality 0.25, geometry 0.15 |
| `family` (`intelligence.scores.family`), Família | leisure 0.3, lowTraffic 0.25, gate 0.15, solar 0.15, quiet 0.15 |
| `premium` (`intelligence.scores.premium`), Premium | privacy 0.3, view 0.25, quiet 0.25, solar 0.1, geometry 0.1 |
| `overall` (`intelligence.scores.overall`), Geral | housing 0.35, premium 0.25, investment 0.25, family 0.15 (sobre os scores já arredondados; resultado `HALF_EVEN`) |

## 5. Critérios (notas 0–10)

Cada critério tem `id`, `fieldKey`, `label`, `version: "1.0"`, `requires` (informativo) e `steps`, executados em ordem. `THRESHOLD` e `PIECEWISE` aplicam só a primeira faixa que casa.

| Critério (`fieldKey`) | Etapas e parâmetros |
|---|---|
| `lowTraffic` (`intelligence.notes.lowTraffic`) | `ENUM_MAPPING` de `mobility.estimatedTraffic`: VERY_LOW 10, LOW 8, MEDIUM 6, HIGH 4, VERY_HIGH 2 |
| `quiet` (`environmental.quietScore`) | parte de 10; avenida <50 −4, <100 −3, <150 −2, <250 −1; portaria <60 −2, <120 −1; clube <50 −2, <100 −1; playground <25 −1.5, <50 −0.7; praça <25 −1, <50 −0.5; estacionamento <60 −0.7; área técnica <30 −1; fluxo VERY_HIGH −2.5, HIGH −1.5, MEDIUM −0.7; `CAP` 0–10 |
| `privacy` (`environmental.privacyScore`) | parte de 6; fundos GREEN_EXTERNAL +3, CONDO_GREEN +3, PERIMETER +2, COMMON_AREA +1; esquina −2; duas frentes −1.5; fluxo VERY_HIGH −2, HIGH −1.5, MEDIUM −0.7; menor distância praça/playground <30 −1; portaria <80 −1; `LOT_ADJUSTMENT`; `CAP` 0–10 |
| `solar` (`environmental.solarScore`) | `COSINE_ORIENTATION` de `environmental.rearBearingDeg`: 3 + 7 × (1 + cos(ângulo até 20°)) / 2 |
| `view` (`environmental.viewScore`) | `ENUM_MAPPING` de `surroundings.viewBase`: CONDO_PARK 8.5, FOREST_EXTERNAL 8, OPEN_EXTERNAL 6, STREET_BOTH_SIDES 4.5, INTERNAL 4.5; +0.5 se a menor distância praça/clube for <40 e a nota estiver abaixo de 6 |
| `geometry` (`geometry.usableGeometryScore`) | `ENUM_MAPPING` de `geometry.shapeClass`: RECTANGULAR 8.5, SQUARE 8.5, TRAPEZOIDAL 7, IRREGULAR 5.5, CORNER 7.5; frente <10 −1.5, ≥12 +0.5; profundidade/frente >3.2 −1; `CAP` 0–10 |
| `gate` (`intelligence.notes.gate`) | `LINEAR` de `mobility.routeDistanceToGateM`: 10 − 7 × (x − 150) / 850; `CAP` 3–10 |
| `leisure` (`intelligence.notes.leisure`) | `LINEAR` de `mobility.routeDistanceToLeisureM` com os mesmos parâmetros; `CAP` 3–10; playground <120 +1; `CAP` 0–10 |
| `liquidity` (`intelligence.notes.liquidity`) | `PIECEWISE_VALUE` da área: ≤300 8, ≤400 7, ≤500 6, acima 5, ausente 6.5; + Σ (nota − centro) × peso: solar (6.5; 0.25), privacy (6; 0.2), quiet (7; 0.2), geometry (7.5; 0.2); `CAP` 0–10 |
| `relativeValue` (`intelligence.notes.relativeValue`) | `MEAN` de view, privacy, quiet, solar; área ≥400 +0.5; `CAP` 0–10 |
| `priceQuality` (`intelligence.notes.priceQuality`) | `WEIGHTED_SUM`: quiet 0.25, privacy 0.2, solar 0.2, lowTraffic 0.15, view 0.1, geometry 0.1; `CAP` 0–10. Nota da config: "O preço por m² é igual para todos os lotes: a nota mede atributos entregues pelo mesmo R$/m²." |

Ajustes por lote (`lotAdjustments`, aplicados pela etapa `LOT_ADJUSTMENT` e registrados no trace com o motivo):

| Lote | Critério | Delta | Motivo (resumo) |
|---|---|---|---|
| N8 | privacy | −1 | ajuste manual da análise (lote junto à servidão projetada). O motivo de B67 e B68 não terem o mesmo ajuste não foi registrado: necessita confirmação |
| N11 | privacy | −1 | "Idem N8." |
| N12 | privacy | −1 | "Idem N8." |

## 6. Registro de normalizações (`App.inormalize`)

Todas na versão `1.0`. Uma op desconhecida é rejeitada na validação, nunca durante a análise. Nenhuma op transforma `null` em 0: entrada obrigatória ausente devolve `{ missing }`.

| Op | Parâmetros | Efeito |
|---|---|---|
| `FIXED_SCALE` | `value` | valor fixo inicial |
| `ENUM_MAPPING` | `input`, `map` | valor do mapa; fora do mapa → `UNKNOWN_ENUM` |
| `ENUM_DELTA` | `input`, `map` | soma o delta do mapa; fora do mapa → sem ajuste |
| `BOOLEAN_DELTA` | `input`, `whenTrue` | soma se a entrada for `true` |
| `THRESHOLD` | `bands` (`input` ou `inputMinOf`) | primeira faixa (`lt`/`lte`/`gte`) soma seu `delta` |
| `THRESHOLD_IF_BELOW` | `lt`, `currentBelow`, `delta` | soma se entrada < `lt` e nota atual < `currentBelow` |
| `THRESHOLD_ABOVE` | `input`, `delta` (`gt` ou `gte`) | soma se acima do limite; entrada ausente não aplica |
| `PIECEWISE` | `input`, `pieces` | primeira faixa soma seu `delta` |
| `PIECEWISE_VALUE` | `input`, `pieces` (opcional `missing`) | primeira faixa define o valor; ausente usa `missing` se declarado |
| `LINEAR` | `input`, `from`, `drop`, `start`, `span` | `from − drop × (x − start) / span` |
| `MIN_MAX`, `INVERTED_MIN_MAX` | `input`, `min`, `max` | escala 0–10 direta ou invertida (sem uso na v1.0) |
| `COSINE_ORIENTATION` | `input`, `targetDeg`, `base`, `amplitude` | `base + amplitude × (1 + cos Δ) / 2` |
| `WEIGHTED_SUM` | `terms` | Σ valor × peso |
| `WEIGHTED_DEVIATIONS` | `terms` | nota + Σ (valor − `center`) × peso |
| `MEAN` | `inputs` | média simples |
| `CAP`, `FLOOR` | `min`, `max` / `min` | limita a faixa (`FLOOR` sem uso na v1.0) |
| `LOT_ADJUSTMENT` | — | soma os `lotAdjustments` do lote para o critério |

## 7. Política de dado ausente

| Política (`MISSING`) | Comportamento no motor | Uso na v1.0 |
|---|---|---|
| `BLOCK_SCORE` | score `null`, status `INSUFFICIENT_DATA` | todos os scores |
| `IGNORE_AND_RENORMALIZE` | remove o peso e renormaliza os presentes, se `coverage ≥ minCoverage` | nenhum |
| `NEUTRAL` | critério ausente vale 5 (valor fixo no código) | nenhum |
| `ZERO_CONTRIBUTION` | critério ausente contribui 0, com o peso mantido | nenhum |

`coverage` = soma dos pesos com nota / soma dos pesos, e vai em `criteriaResults[score].coverage`. Coverage mede quanto dos critérios teve dado; a confiança (`confidence`) é separada e vem da qualidade da medição. `USE_DEFAULT` e `CUSTOM` não existem e são rejeitados (`INVALID_MISSING_POLICY`).

## 8. Níveis, métricas, classe, ranking, confiança, perfis e alertas

| Bloco | Valores na v1.0 |
|---|---|
| `levels.environmental.noiseLevel` (de quiet) | VERY_LOW ≥8.5, LOW ≥7, MEDIUM ≥5, HIGH ≥3, VERY_HIGH abaixo |
| `levels.environmental.privacyLevel` (de privacy) | VERY_HIGH ≥9, HIGH ≥7, MEDIUM ≥5, LOW ≥3, VERY_LOW abaixo |
| `levels.intelligence.liquidity` (de liquidity) | VERY_HIGH ≥8.5, HIGH ≥7, MEDIUM ≥5.5, LOW ≥4, VERY_LOW abaixo |
| `levels.geometry.usableGeometryClass` (de geometry) | GOOD ≥8, MEDIUM ≥6, LOW abaixo |
| `metrics.traffic` (veículos de passagem) | VERY_HIGH ≥150, HIGH ≥70, MEDIUM ≥25, LOW ≥6, VERY_LOW abaixo |
| `metrics.streetHierarchy` | LOCAL_QUIET <6, LOCAL <25, SECONDARY <70, MAIN acima; rua sem saída → CUL_DE_SAC |
| `metrics.gateProximity` (rota) | VERY_CLOSE <200, CLOSE <400, INTERMEDIATE <650, FAR acima |
| `metrics.shape` | trapézio: diferença de larguras >0.15 e retangularidade ≥0.75; irregular: retangularidade <0.85; quadrado: profundidade/frente entre 0.85 e 1.18 |
| `metrics.solar` | janela lateral 60°; sol do norte 67.5°; leste 67.5°; sol forte da tarde: rumo 285° ± 35° |
| `metrics.rearSequence` | ignora `outro`; perímetro = `fora`, `perimetro`; mata quando vegetação ≥0.2 |
| `classification` | `PERCENTILE_BANDS` sobre o overall não arredondado, decrescente, desempate pela ordem do lote: A_PLUS <0.05, A <0.25, B <0.65, C <0.9, D restante |
| `ranking` | `COMPETITION`, decrescente, sobre o score arredondado; empate divide a posição; tipos HOUSING, INVESTMENT, FAMILY, PREMIUM, OVERALL |
| `confidence` | medição HIGH → MEDIUM, MEDIUM → MEDIUM, LOW → LOW ("A análise usa MÉDIA sempre que a medição não é baixa; nenhum lote tem medição baixa hoje.") |
| `profiles` (segundo perfil se a até 0.3 do primeiro) | QUIET_LIVING: quiet 0.45, privacy 0.35, lowTraffic 0.2; FAMILY, HIGH_END, INVESTOR: score family, premium, investment ÷ 10; ELDERLY_MOBILITY: gate 0.6, lowTraffic 0.2, geometry 0.2, −0.5; NATURE: view 0.6 + mata nos fundos (10 se sim, 3 se não) 0.4 |
| `alerts` | NOISE quiet <5; PRIVACY privacy <4; AFTERNOON_SUN sol forte da tarde; TECHNICAL_AREA <40 m; EASEMENT servidão projetada; AVENUE ≤100 m; TRAFFIC fluxo HIGH ou VERY_HIGH; GEOMETRY geometry <6 ou frente <9; BUILDING_RESTRICTION fundos GREEN_EXTERNAL; MISSING_AREA área ausente |

## 9. Validação (`validate(cfg)`)

Devolve `{ ok, errors, warnings }` com códigos e caminho; nunca lança. `compile` lança `INVALID_CONFIG` com a lista de erros.

| Código | Regra |
|---|---|
| `INVALID_CONFIG`, `INVALID_KIND`, `MISSING_FIELD` | config ausente; `kind` diferente de `scoring-methodology`; falta `methodologyId`, `methodologyVersion`, `developmentId`, `criteria`, `scores`, `overall`, ou `publishedAt` em config publicada |
| `INVALID_VERSION`, `INVALID_STATUS` | versão fora do semver; status fora de DRAFT, VALIDATED, PUBLISHED, ARCHIVED |
| `INVALID_CRITERION_ID`, `DUPLICATE_CRITERION`, `MISSING_STEPS` | id ausente ou repetido; critério sem etapas |
| `UNKNOWN_FIELD_KEY` | `fieldKey` fora do registro de campos (`App.model.field`) |
| `UNKNOWN_NORMALIZER`, `MISSING_PARAM` | op não registrada; parâmetro obrigatório ausente |
| `UNKNOWN_INPUT` | entrada que não é métrica do motor (`METRIC_KEYS`) nem critério |
| `THRESHOLD_ORDER` | limites de faixas fora de ordem crescente; níveis que não são decrescentes ou não terminam em `null` |
| `INVALID_NUMBER`, `INVALID_WEIGHT`, `NEGATIVE_WEIGHT`, `INVALID_RANGE` | valor ou peso não numérico; peso negativo; `CAP` com min > max; `minCoverage` fora de 0–1 |
| `WEIGHT_SUM` | pesos de um `WEIGHTED_SUM` ou do overall não somam 1 (tolerância 1e-9) |
| `CYCLE` | dependência circular entre critérios |
| `DUPLICATE_SCORE`, `INVALID_AGGREGATION`, `INVALID_ROUNDING`, `INVALID_MISSING_POLICY` | score repetido; valores fora dos enums |
| `UNKNOWN_CRITERION`, `UNKNOWN_SCORE` | referência a critério ou score inexistente (scores, níveis, ajustes, overall, ranking) |
| `INVALID_CLASSIFICATION`, `CLASS_BOUNDARY` | método diferente de `PERCENTILE_BANDS`; faixas fora de A_PLUS, A, B, C, D, limites fora de (0, 1) ou não crescentes, última faixa não aberta |
| `INVALID_RANKING` | método diferente de `COMPETITION` |
| `MISSING_REASON` | ajuste por lote sem motivo |
| avisos `ZERO_WEIGHT`, `MISSING_CHANGE_REASON` | peso zero; config sem `changeReason` |

A compilação ordena os critérios pelo grafo de dependências, liga cada etapa à função registrada, agrupa os ajustes por lote, calcula o checksum (FNV-1a 32 bits sobre o JSON estável, o mesmo do cache offline) e congela tudo.

## 10. Versionamento e ciclo de vida

`App.methodology.registry(initial)` mantém as versões de um empreendimento em memória:

| Ação | Regra |
|---|---|
| `add(cfg)` | guarda uma cópia; versão já `PUBLISHED`/`ARCHIVED` não pode ser substituída (`PUBLISHED_IMMUTABLE`); a primeira publicada vira a atual |
| `update(v, patch)` | só em versão não publicada; volta a `DRAFT` |
| `markValidated(v)` | só de `DRAFT`; roda `validate` e recusa config inválida |
| `publish(v, meta)` | só de `VALIDATED`; exige motivo (`meta.reason` ou `changeReason`); congela e vira a atual |
| `archive(v)` | só versão publicada que não seja a atual |
| `setCurrent(v)` | rollback: aponta para outra versão publicada; a mais nova continua `PUBLISHED` |
| `audit()` | `{ action, version, at, reason, by }` de cada ação |

`diff(a, b)` compara duas configs casando itens de lista pela primeira chave presente entre `id`, `lotCode`, `criterion`, `score` e `type` (critérios e scores por id, ajustes por lote, pesos por critério, alertas por tipo); se duas entradas da lista tiverem a mesma chave, a lista é comparada por posição, para nenhuma mudança sumir, e classifica cada mudança: `WEIGHT_CHANGED`, `THRESHOLD_CHANGED`, `PARAMETER_CHANGED`, `NORMALIZATION_CHANGED`, `ROUNDING_CHANGED`, `MISSING_POLICY_CHANGED`, `CLASSIFICATION_CHANGED`, `RANKING_CHANGED`, `METADATA_CHANGED`, `CRITERION_ADDED`/`CRITERION_REMOVED`, `ITEM_ADDED`/`ITEM_REMOVED`, `VALUE_CHANGED`.

`impact(base, candidata, inputs, opts)` roda as duas metodologias sobre as mesmas medições, sem publicar nada, e devolve: versões e checksums, `configDiff`, `lotCount`, `changedLots`, `changedShare`, `massChange` (participação ≥ `opts.massChangeShare`, padrão 0.2), por score `changed`/`maxAbsDelta`/`meanDelta` (as diferenças só usam lotes com valor antes e depois; um score que passa a ser `null`, ou deixa de ser, conta em `nullTransitions` e nunca como 0), distribuição de classes antes e depois, matriz de classes, lotes que mudaram de classe, maiores movimentos no ranking geral (padrão 20) e mudanças de alertas.

Para mudar um peso, o caminho que o código permite hoje: copiar o JSON para um novo arquivo com nova `methodologyVersion` e status `DRAFT`; validar; rodar `impact` contra a versão atual; publicar pelo registro; gravar o arquivo com `PUBLISHED` e `publishedAt`; atualizar `current.json`; rodar os testes e o build. A nova `analysisVersion` sai sozinha (`<versão>+<checksum>`).

## 11. Auditoria de um score

`LotAnalysisResult.criteriaResults[score]` responde: metodologia e versão (`methodologyVersion`, e `methodologyId`/`analysisVersion` no resultado), critérios, pesos, valor de cada nota, contribuição, status (`OK`/`MISSING`), `coverage`, etapas aplicadas com motivo e entrada (`reasons`), e o checksum da config em `provenance.methodologyChecksum`. `App.explanation.explainTechnical` monta a explicação técnica a partir disso, sem recalcular.

## 12. Testes

Em `tests/intelligence.test.js`: validação rejeita op desconhecida, peso negativo, soma de pesos errada, faixas fora de ordem, critério inexistente, fieldKey fora do registro, limite de classe inválido, ciclo, entrada desconhecida, status inválido, política de ausência inválida e ajuste sem motivo; checksum estável e sensível a qualquer parâmetro; diff por id; impacto (config igual não muda nada; mudança de peso é medida); ciclo de vida (publicada imutável, rollback mantém a versão nova, arquivamento).

## 13. Não implementado / pendências

- `ZERO_CONTRIBUTION` e `NEUTRAL` são aceitos pela validação. A v1.0 não usa nenhum dos dois, mas uma config nova com `ZERO_CONTRIBUTION` trataria critério ausente como contribuição 0 (verificado: housing do lote A1 sem orientação cai para 54, status `PARTIAL`). Implementado em 08/10/2026: a validação exige justificativa escrita para cada critério de um score com `ZERO_CONTRIBUTION` (`MISSING_JUSTIFICATION`). O valor neutro 5 continua fixo no código.
- O registro de versões vive só em memória: não há persistência, changelog gravado, `createdBy`, aprovação nem fluxo de publicação. Publicar é editar arquivos e rodar o build.
- Implementado em 08/10/2026: `scripts/configBundle.js` aceita `N.N.json` e `N.N.N.json`, confere o nome do arquivo com a `methodologyVersion` e a coerência de `current.json`; qualquer erro faz o build falhar.
- Campos declarativos que o motor não lê: `rounding` do topo, `overall.rounding` (o overall é sempre `HALF_EVEN`), `classification.basis`/`order`/`tieBreaker`, `ranking.basis`/`ties`, `confidence.rule`, `requires` e `direction` dos critérios. `requires` de `view` cita `surroundings.viewDetail`, que o motor não produz.
- A validação não cobre: regras `when` dos alertas, `profiles`, `metrics`, `scale` dos scores, completude dos mapas de enum.
- Normalizações da especificação ausentes do registro: `PERCENTILE`, `BOOLEAN_MAPPING`, normalizador customizado por id. Política `USE_DEFAULT`/`CUSTOM`: não existem.
- Exigência de proveniência mínima por critério (`allowedStatuses`), confiança do score calculada pela proveniência, herança e overrides por empreendimento e editor: não existem. A pré-visualização existe desde 08/10/2026 no backend (`POST /api/v1/developments/{id}/analysis/preview`), que devolve o relatório de impacto sem publicar.
- Destaques, severidade dos alertas e o limite de frente estreita do alerta GEOMETRY ficam em `src/domain/rules.js` e `src/intelligence/engine.js`, fora da config. Quais regras ficam no código e quais na configuração depende de decisão.
- A config é embutida no bundle do app e pode ser lida no navegador; não há interface para alterá-la, então nenhum usuário muda score global pelo browser.
