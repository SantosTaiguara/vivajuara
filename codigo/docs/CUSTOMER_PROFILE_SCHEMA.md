# Esquema do perfil do cliente (CustomerProfile)

Tópico 14. Esquema implementado em `plat/src/intelligence/fit.js` (`buildProfile`, `validateProfile`, `effectivePreferences`, `isEmpty`, `profileCompleteness`) com o catálogo de preferências de `plat/config/fit/viva-juara.json`. Uso do perfil no cálculo: `FIT_SCORE_ARCHITECTURE.md` e `FIT_METHODOLOGY.md`.

## 1. Situação atual

- O perfil não é uma entidade guardada: `selectors.selectProfile` (`src/state/selectors.js`) o monta a cada mudança com `App.fit.buildProfile({ id: currentCustomerId || 'working-profile', developmentId, preferences })`.
- A interface oferece 11 preferências ("Ajustar prioridades" em `src/presentation/panels.js`, `PREF_KEYS`): quiet, privacy, solar, view, leisure, gate, lowTraffic, geometry, priceQuality, green, area. Cada uma com "Não importa" (0), "Pouco" (1), "Importante" (2) ou "Essencial" (3).
- Orçamento máximo e área mínima da tela "Exigências (eliminatórias)" são restrições do RecommendationEngine (tópico 15), não preferências: o app não as passa para `buildProfile`. As preferências `budget` e `areaRange` existem no catálogo e no builder, mas hoje só os testes as usam.
- Persistência: `state.preferences` é salvo no `localStorage` do navegador, por empreendimento (`src/state/store.js`, parte `prefs`). Não sai do dispositivo, não existe no backend e "Limpar dados locais" mantém as preferências, salvo pedido explícito.
- Lista de clientes (overlay "Clientes", `src/presentation/overlays.js`): `state.customers` guarda `{ id, name, lots }` com "Nome ou apelido do cliente" (até 60 caracteres) e os lotes guardados. A tela informa: "Os clientes ficam somente neste aparelho, sem telefone ou documento. Não fazem parte do pacote offline nem são enviados a nenhum servidor."
- As preferências não são guardadas por cliente: existe um único `state.preferences` por empreendimento. Trocar de cliente muda só o `id` do perfil (e com isso a `cacheKey`), não as preferências.
- O perfil não leva dado pessoal: o builder grava `name = null` e `notes = null`.

## 2. CustomerProfile

| Campo | Tipo | Regra |
|---|---|---|
| `id` | texto | obrigatório (`MISSING_FIELD`); no app, `currentCustomerId` ou `working-profile` |
| `name` | texto ou `null` | opcional; o builder grava `null` |
| `developmentId` | texto | padrão `viva-juara` |
| `createdAt`, `updatedAt` | datetime ou `null` | o builder grava `createdAt = null`; `updatedAt` vem da entrada |
| `profileVersion` | texto | obrigatório (`MISSING_FIELD`); checksum de `{ developmentId, preferences: [key, target, importance, enabled] }` |
| `templateId` | texto ou `null` | modelo de partida, quando informado |
| `preferences` | `CustomerPreference[]` | lista; vazia = perfil vazio |
| `constraints` | lista | o builder grava `[]`; restrições são do tópico 15 |
| `budget` | `{ max, currency: 'BRL' }` ou `null` | preenchido quando `budgetMax` é informado |
| `notes` | `null` | texto livre não entra no Fit |
| `metadata` | `{ questionsAnswered }` | número de preferências geradas |

## 3. CustomerPreference

| Campo | Tipo | Regra |
|---|---|---|
| `id` | texto | o builder usa `pref-<key>` |
| `key` | chave do catálogo | obrigatório; fora do catálogo → `INVALID_FIELDKEY` |
| `fieldKey` | fieldKey canônico | opcional; se informado, deve ser igual ao do catálogo (`INVALID_FIELDKEY`); o do catálogo precisa existir no registro de campos |
| `preferenceType` | um de `TYPES` | opcional; se informado, igual ao do catálogo (`TYPE_MISMATCH`) |
| `target` | depende do tipo | ver seção 5 |
| `importance` | `LOW`, `MEDIUM`, `HIGH` | obrigatório (`INVALID_IMPORTANCE`) |
| `tolerance` | número ≥ 0 | opcional (`INVALID_TOLERANCE`); na mesma unidade do campo |
| `enabled` | booleano | `false` tira a preferência do cálculo |
| `source` | `EXPLICIT_USER`, `BROKER_INTERPRETATION`, `PROFILE_TEMPLATE`, `IMPORTED`, `INFERRED` | opcional; fora da lista → `INVALID_SOURCE` |

Tipos (`TYPES`): `SCORE_PREFERENCE`, `BOOLEAN`, `ENUM`, `CATEGORICAL_SET`, `NUMERIC_RANGE`, `NUMERIC_TARGET`, `MINIMUM`, `MAXIMUM`, `PROXIMITY`, `AVOIDANCE`, `RELATIVE_HIGHER`.

## 4. Importância

| Importância | Rótulo (`importanceLabels`) | Peso (`importanceMap`) | Valor da interface (`legacyImportance`) |
|---|---|---|---|
| `LOW` | Pouco | 1 | 1 |
| `MEDIUM` | Importante | 2 | 2 |
| `HIGH` | Essencial | 4 | 3 |

Importância é peso no Fit, não restrição: nenhuma importância exclui lote. O usuário não digita pesos numéricos.

## 5. Catálogo de preferências (Viva Juara)

Status do dado = proveniência do campo nos 498 lotes hoje (`App.model.getFieldProvenance`). Nenhum dos campos está `null` em lote algum.

| Chave | fieldKey | Tipo | Domínio | Parâmetros do catálogo | Alvo exigido | Status do dado |
|---|---|---|---|---|---|---|
| `quiet` | `environmental.quietScore` | SCORE_PREFERENCE | ENVIRONMENT | `scaleMax` 10 | — | estimado |
| `privacy` | `environmental.privacyScore` | SCORE_PREFERENCE | ENVIRONMENT | `scaleMax` 10 | — | estimado |
| `solar` | `environmental.solarScore` | SCORE_PREFERENCE | ENVIRONMENT | `scaleMax` 10 | — | estimado |
| `view` | `environmental.viewScore` | SCORE_PREFERENCE | ENVIRONMENT | `scaleMax` 10 | — | estimado |
| `leisure` | `intelligence.notes.leisure` | SCORE_PREFERENCE | LOCATION | `scaleMax` 10 | — | estimado |
| `gate` | `intelligence.notes.gate` | SCORE_PREFERENCE | LOCATION | `scaleMax` 10 | — | estimado |
| `lowTraffic` | `intelligence.notes.lowTraffic` | SCORE_PREFERENCE | MOBILITY | `scaleMax` 10 | — | estimado |
| `geometry` | `geometry.usableGeometryScore` | SCORE_PREFERENCE | GEOMETRY | `scaleMax` 10 | — | estimado |
| `priceQuality` | `intelligence.notes.priceQuality` | SCORE_PREFERENCE | COMMERCIAL | `scaleMax` 10 | — | estimado |
| `green` | `surroundings.hasGreenRear` | BOOLEAN | ENVIRONMENT | `target` true | — | calculado (493), não disponível (5) |
| `area` | `geometry.areaM2` | RELATIVE_HIGHER | GEOMETRY | faixa do empreendimento | — | confirmado |
| `housing` | `intelligence.scores.housing` | SCORE_PREFERENCE | SCORE | `scaleMax` 100 | — | estimado |
| `investment` | `intelligence.scores.investment` | SCORE_PREFERENCE | SCORE | `scaleMax` 100 | — | estimado |
| `family` | `intelligence.scores.family` | SCORE_PREFERENCE | SCORE | `scaleMax` 100 | — | estimado |
| `premium` | `intelligence.scores.premium` | SCORE_PREFERENCE | SCORE | `scaleMax` 100 | — | estimado |
| `budget` | `commercial.price` | MAXIMUM | COMMERCIAL | `toleranceRatio` 0.1, `usesPrice` | número > 0 | calculado |
| `areaRange` | `geometry.areaM2` | NUMERIC_RANGE | GEOMETRY | `toleranceM2` 50 | `{ min, max }`, ao menos um | confirmado |
| `noCorner` | `geometry.isCorner` | BOOLEAN | GEOMETRY | `target` false | — | calculado |
| `rearOrientation` | `environmental.orientationRear` | ENUM | ENVIRONMENT | similaridade 0.5 com os vizinhos de N, S, E, W | texto do vocabulário | calculado |
| `nearGate` | `mobility.routeDistanceToGateM` | PROXIMITY | LOCATION | `idealM` 150, `zeroAtM` 1000 | — | calculado |
| `awayFromAvenue` | `location.distanceToExternalRoadM` | AVOIDANCE | LOCATION | `zeroAtM` 50, `idealM` 250 | — | calculado |

O lote com "não disponível" em `green` ainda tem valor (`false`); o matcher usa o valor, e a confiança da preferência vai a 0 (ver `FIT_METHODOLOGY.md`).

## 6. Validação (`validateProfile`)

| Código | Quando |
|---|---|
| `INVALID_PROFILE` | perfil ausente |
| `MISSING_FIELD` | sem `id` ou sem `profileVersion` |
| `INVALID_FIELDKEY` | chave fora do catálogo, fieldKey divergente ou fora do registro de campos |
| `TYPE_MISMATCH` | `preferenceType` diferente do catálogo |
| `INVALID_IMPORTANCE` | importância fora de LOW, MEDIUM, HIGH |
| `INVALID_SOURCE` | origem fora de `SOURCES` |
| `INVALID_TARGET` | `NUMERIC_RANGE` sem limites; `MINIMUM`/`MAXIMUM` sem número positivo; `ENUM` sem texto |
| `INVALID_RANGE` | `min > max` |
| `INVALID_TOLERANCE` | tolerância negativa |
| aviso `DUPLICATE_PREFERENCE` | mesma chave repetida: vale a última |
| aviso `CONTRADICTORY_PREFERENCES` | orçamento abaixo de área mínima × `minPricePerM2` (ver pendências) |

`fitLots` lança `INVALID_PROFILE` (com a lista de erros) quando o perfil não é válido; `fitLot` não valida.

## 7. Preferências efetivas e precedência

`effectivePreferences`: ignora `enabled: false`, mantém a última ocorrência de cada chave e devolve na ordem do catálogo (determinística). Não há precedência por origem: uma preferência `PROFILE_TEMPLATE` posterior substitui uma `EXPLICIT_USER` anterior.

## 8. ProfileBuilder (`buildProfile`)

Entrada: `{ id, name, developmentId, preferences: { chave: 1 | 2 | 3 ou 'LOW' | 'MEDIUM' | 'HIGH' }, budgetMax, areaMin, areaMax, templateId, source, updatedAt }`.

- Valor 0, vazio ou chave fora do catálogo é descartado; não há importância padrão escondida.
- `target` vem do catálogo (`d.target ?? null`); o builder não recebe alvo por preferência.
- `budgetMax` gera `budget` (MAXIMUM, `HIGH`); `areaMin`/`areaMax` geram `areaRange` (NUMERIC_RANGE, `MEDIUM`).
- Com `templateId`, a preferência cuja importância é igual à do modelo recebe `source = PROFILE_TEMPLATE`; as demais ficam com a origem informada (padrão `EXPLICIT_USER`).

Modelos (`templates`), que só preenchem preferências e podem ser ajustados:

| id | Rótulo | Preferências |
|---|---|---|
| `moradia` | Melhores para moradia | housing HIGH |
| `invest` | Melhores para investimento | investment HIGH |
| `silencio` | Mais silenciosos | quiet HIGH, lowTraffic MEDIUM |
| `privados` | Mais privados | privacy HIGH, quiet LOW |
| `sol` | Melhor orientação | solar HIGH |
| `custo` | Melhor custo-benefício | priceQuality HIGH |
| `premium` | Premium | premium HIGH |
| `familia` | Para família | family HIGH |
| `verde` | Com área verde nos fundos | green HIGH, privacy LOW |

## 9. Não implementado / pendências

- Implementado em 08/10/2026: `App.fit.profileWarnings` deriva os avisos dos lotes: `PREFERENCE_NOT_SATISFIABLE` (nenhum lote atende a uma preferência), `CONTRADICTORY_PREFERENCES` (nenhum lote atende a duas preferências ao mesmo tempo) e `PROFILE_TRADEOFF` (nenhum lote é forte nas duas ao mesmo tempo). A regra antiga por `minPricePerM2` continua sem efeito, porque a config não tem esse campo.
- Campos da especificação ausentes: `direction` e `notes` da preferência; `CustomerBudget` com `targetPrice`, entrada, parcela e financiamento (só `max`).
- `rearOrientation` (ENUM) não pode ser montada pelo builder, que não recebe alvo; montada assim, falharia em `validateProfile` (`INVALID_TARGET`).
- Precedência por origem (EXPLICIT_USER > TEMPLATE > INFERRED): não implementada; vale a última.
- Templates sem versão própria; a interface não passa `templateId` ao builder, então no app a origem é sempre `EXPLICIT_USER`.
- Implementado em 08/10/2026: cada cliente guarda as próprias preferências e exigências no registro do cliente (`customers[].profile`, sem telefone ou documento); escolher o cliente carrega esse perfil.
- Repositório de perfis, perfil no backend, compartilhamento entre dispositivos, retenção e permissões: não existem. O aviso de armazenamento local aparece na lista de clientes, não no painel de prioridades.
- `profileCompleteness` divide por 5 fixo no código, não por um questionário configurado.
