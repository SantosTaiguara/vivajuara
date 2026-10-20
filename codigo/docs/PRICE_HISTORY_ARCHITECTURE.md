# Histórico de preços de tabela — arquitetura (Tópico 28)

Módulo: `src/pricing/priceHistory.js` → `App.priceHistory` (carregado logo após `services/finance.js`).
UI: `src/presentation/pricingView.js` → `App.pricingView` (funções puras que devolvem HTML) + `src/presentation/pricing.css`.
Testes: `tests/pricing.test.js` (36 testes).

Este documento reúne o que a especificação pedia em sete documentos (arquitetura, modelo de série, metodologia de variação,
índice do empreendimento, qualidade, visualização e migração). Cada um corresponde a uma seção abaixo.

## 1. Princípio

Histórico de preço = **sequência temporal de versões publicadas da tabela**, não uma lista de valores sobrescritos.
O histórico é um *read model* derivado: as versões publicadas são a única fonte de verdade. Nada aqui grava, corrige
ou interpola preço. Para corrigir um ponto, corrige-se a governança da versão (Tópico 27), nunca a série.

Toda saída usa a linguagem **"preço de tabela" / "variação do preço de tabela"**, em valores **nominais**. Não é preço
efetivo de venda, não é retorno, não é promessa. Todo view model traz o aviso obrigatório `App.priceHistory.DISCLAIMER`:

> Preço de tabela publicado pela loteadora, em valores nominais. Não é o preço efetivo de uma venda, e variações passadas da tabela não indicam variações futuras.

Os testes verificam que nenhuma saída (VM, HTML, texto de compartilhamento, em qualquer modo) contém
`valoriz|rentabil|retorno|lucro|ganho|rendeu|garant|vai subir`.

## 2. Dependência do Tópico 27 (lacuna) — modelo mínimo de versão

O Tópico 27 (PriceTable/PriceTableVersion) **não foi fornecido**. Foi criado apenas o contrato mínimo necessário,
`PriceTableVersionRef` (`toVersion`, `versionsFrom`), montado a partir do que existe:

| Campo | Origem hoje | Observação |
|---|---|---|
| `id`, `priceTableId` | `priceTables[].id` (config/commercial.json) ou `PriceTableDto.id` | uma linha de `price_tables` = uma versão |
| `developmentId` | idem | |
| `version` | `version` ("2026-10-06") | rótulo |
| `effectiveFrom` | `effectiveFrom` → `validFrom` → `createdAt`/`issued_on` → `version` se for data | `effectiveFromBasis` guarda a origem |
| `effectiveTo` / `validUntil` | `validUntil` ou início da próxima versão | |
| `status` | `PriceTableDto.status` (DRAFT/PUBLISHED/ARCHIVED, migration 001/005) | config e commercial.json só têm tabelas publicadas → `PUBLISHED`; DRAFT é sempre descartado |
| `publishedAt` / `knownAt` | `published_at` (migration 005) | base para "o que se sabia naquela data" (bitemporal mínimo) |
| `priceType` | `priceType` (não existe hoje) | padrão `LIST_PRICE` |
| `pricingMode`, `lotPrices` | migration 005 (`PER_M2`/`PER_LOT`/`MIXED`) | preço por lote quando houver |
| `reasonCode` | `reasonCode` (não existe hoje) | padrão `UNKNOWN_REASON` — nunca inferido da direção do preço |
| `checksum` | `price_tables.checksum` ou FNV dos campos econômicos | auditoria: todo ponto leva ao checksum da versão |

**Inventário atual**: 1 versão (`lancamento-2026-10`, versão 2026-10-06, R$ 1.196/m², lote de 250 m² = R$ 299.000),
1 priceType (`LIST_PRICE`), moeda BRL, **sem histórico legado**. A tabela não informa vigência (`validFrom` nulo):
a data de emissão (06/10/2026) é usada como início, marcada `ISSUE_DATE` e rebaixa a qualidade ("necessita confirmação").

Consequência: **cada lote tem um único ponto; a variação "não pode ser calculada"** (nunca 0%, nunca tendência),
a qualidade é `LOW` com aviso `SINGLE_VERSION`, a linha discreta do quick view fica oculta e o índice do empreendimento
tem um único ponto (100) com variação `NOT_CALCULABLE`.

## 3. Modelo da série

- `PriceHistoryPoint` — um por versão elegível (mesmo priceType, não DRAFT, `effectiveFrom ≤ asOf`, opcionalmente
  `knownAt ≤ asOfKnowledgeDate`), ordenado por `effectiveFrom` (empate: `publishedAt`, `revision`, `id`).
  Valores em centavos (`amountMinor`). `pointStatus`: `VALID | MISSING | WITHHELD | CONFLICTED | INVALID | NOT_APPLICABLE`.
  Pontos não válidos **permanecem** na série.
- Preço do lote numa versão (`lotPrice`): mesma regra de `CommercialRepository.commercialFor` (área × R$/m², arredondado ao
  centavo) ou o preço por lote. Teste de consistência: o último ponto válido é igual a `lot.commercial.price` nos 498 lotes.
- `PriceInterval` — período de vigência de cada ponto; quando `validUntil` termina antes da próxima versão, um intervalo
  `MISSING` explícito (gap). Nada é preenchido.
- `PriceChangeEvent` — `INITIAL, INCREASE, DECREASE, UNCHANGED, WITHHELD, RESTORED, REMOVED, CONFLICTED, CORRECTION,
  PROMOTION_START, PROMOTION_END, OTHER_CONFIGURED`. Motivo só vem do metadado da versão (`reasonSource`).
- `LotPriceHistory` — `{ developmentId, lotId, priceType, currency, series{points, intervals, changeEvents, metadata},
  promotionalSeries, pricePerM2, firstKnownPriceAt, latestKnownPriceAt, pointCount, quality, completeness, versionRefs }`.
- `HistoricalPriceResolver` (`resolveAt`): `EXACT_EFFECTIVE` (padrão), `LAST_KNOWN_BEFORE` (marca `fallback` e aviso),
  `PUBLISHED_AS_OF` (só versões já publicadas na data), `EXPLICIT_VERSION`. Antes do primeiro preço: `BEFORE_FIRST_KNOWN`.
- `MissingDataPolicy` padrão `STRICT_GAP`.

## 4. Metodologia de variação (nominal)

- `PriceDelta`: absoluta = to − from; relativa = (to − from)/from; **sem percentual se from = 0**; nunca entre pontos não
  válidos, priceTypes ou moedas diferentes; mesma versão nas duas pontas → `NOT_CALCULABLE` (`SINGLE_POINT`).
- CAGR nominal = (final/inicial)^(365/dias) − 1, só com inicial > 0, final > 0 e dias ≥ `policy.cagr.minElapsedDays`
  (365); exibido apenas nos modos corretor/técnico; rótulo "variação anualizada nominal da tabela" (nunca "rentabilidade").
- `summarize` → `LotPriceHistorySummary` + `PriceAppreciationResult[]` (`ABSOLUTE_CHANGE`, `PERCENT_CHANGE`,
  `PRICE_PER_M2_CHANGE`, `CAGR_NOMINAL`), cada um com período, versões de origem, qualidade e `calculationStatus`.
- Período: "Desde o primeiro preço registrado" (nunca "desde o lançamento", pois não sabemos se a série começa nele);
  período personalizado só calcula se houver preço vigente na data inicial (`NO_START_PRICE` — sem valor inicial inventado).
- `changeCount` conta só mudanças reais (`INCREASE/DECREASE` e restaurações/promoções com diferença); `UNCHANGED` e `CORRECTION` não contam.
- Correção (`reasonCode CORRECTION`): evento `CORRECTION`, aviso `CORRECTION_IN_PERIOD` e
  `repricingChangeExcludingCorrections` (variação encadeada sem as correções). Correção retroativa só com `retroactive: true` explícito.
- Promoção (`PromotionAdjustmentPolicy` padrão `SEPARATE_SERIES`): `PROMOTIONAL_PRICE` vira série separada
  (`promotionalSeries`); dentro da série de lista, só versões com `reasonCode PROMOTION` são marcadas. Queda de preço nunca é inferida como promoção.
- `PricePerM2History`: preço / área canônica estática (`areaPolicy: STATIC_CANONICAL_AREA`; a área não é versionada hoje).

## 5. Índice interno do empreendimento

`developmentIndex(versions, lots, policy)` — base 100 na primeira versão. Métodos: `SAME_LOT_BASKET` (padrão: mediana da
razão preço_k/preço_base dos lotes presentes nas duas versões; controla o efeito de mix), `MEDIAN_PRICE_PER_M2`,
`MEDIAN_LOT_PRICE`. Mediana, nunca média ingênua. Cobertura sempre reportada ("Índice calculado sobre N de 498 lotes com
preço válido"); cobertura < `minCoverage` (0,8) → `LOW_COVERAGE`. Rótulo obrigatório: "Índice interno de preços de tabela
do empreendimento (não é índice de mercado)". `compareDates` → `HistoricalPriceComparison` (cesta comum, lotes novos em
`added`, preço removido/retido em `removed` — nunca como queda).

## 6. Qualidade e completude

`PriceHistoryCompleteness`: primeiro/último conhecido, dias cobertos, dias e número de lacunas, versões observadas, cobertura.
`PriceHistoryQuality.level`: `HIGH | MEDIUM | LOW | INSUFFICIENT`. Regras: nenhum ponto válido → INSUFFICIENT; um ponto →
LOW (`SINGLE_VERSION`); conflito, lacuna ou data de vigência inferida rebaixam; offline parcial → no máximo LOW
(`OFFLINE_PARTIAL_HISTORY`). Qualidade só qualifica, nunca altera valores.

## 7. Visualização

- `viewModel(history, { mode })` → `PriceHistoryViewModel { lot, summary, series, chart, changeEvents, periodOptions, quality,
  warnings, offlinePartial, accessibleRows, disclaimer, actions, technicalDetails, quickView }`.
- Gráfico (`chartViewModel`, `renderStepChart`): **degraus** (só comandos H/V no path SVG), `smoothing: false`,
  `interpolation: 'NONE'`, lacunas como segmentos tracejados com "Sem preço publicado disponível neste período.";
  tooltip com vigência, preço, versão, tipo, fonte e variação vs anterior. Uma versão → um degrau e a anotação
  "Única versão publicada da tabela". Aumento/redução por símbolo (▲/▼) e texto, sem verde/vermelho.
- Tabela acessível + lista para leitor de tela: "Em 6 de outubro de 2026, preço de tabela R$ 807.420." / "Variação de +X% em relação à versão anterior".
- Modos: cliente (simplificado, sem CAGR), corretor, técnico (versões, checksums, base da vigência, lacunas), apresentação (só fatos sólidos).
- Quick view: `quickViewSummary` → "+5,4% desde 08/2026" com rótulo "Variação da tabela" **somente** com ≥ 2 pontos válidos, qualidade ≥ MEDIUM e período definido; caso contrário `visible: false` e `renderQuickViewPriceChange` devolve `''`.
- Compartilhamento (`shareText`): "Preço de tabela do lote X passou de R$ A para R$ B entre D1 e D2 (variação nominal da tabela de +Y%)." + aviso; com uma versão: "Há uma única versão publicada; não há variação a informar."
- Comparador (`comparisonMetrics`): `priceChangePctPeriod`, `priceChangeAbsolutePeriod`, `pricePerM2ChangePeriod`,
  `cagrNominalPeriod`, todas `semantics: 'INFORMATIONAL'`, `better: null` (nunca "vencedor"); exige mesmo período, priceType e metodologia (`DIFFERENT_PERIOD`, `MIXED_PRICE_TYPE`, `MIXED_METHODOLOGY`).

## 8. Serviço, cache e repositórios

- `createService({ developmentId, versions, cache, policy, offlinePartial })` = PriceHistoryApplicationService
  (`lotHistory`, `summary`, `consistency`, `index`, `compare`, `comparisonMetrics`, `viewModel`, `setVersions`, `inventory`).
- `forDevelopment(devId)` — atalho síncrono para a UI (versões do `CommercialRepository`).
- `PriceHistoryCache` — chave: desenvolvimento | priceTableIds | lote ou chave de agregação | from | asOf | priceType |
  hash(ids+checksums das versões incluídas) | metodologia. Sem estado de UI. Nova versão publicada muda o hash dos
  históricos correntes; períodos fechados (sem a nova versão) continuam em cache; correção retroativa dentro do período muda o hash.
- `PriceHistoryRepository` (local) e `ApiPriceHistoryRepository` (ver §9). Sem `fetch` no domínio.

## 9. API — contrato assumido (para o líder conciliar com o backend)

O `backend/docs/openapi.json` atual só tem `POST /developments/{id}/price-tables`, `GET .../price-tables/{priceTableId}`
e `GET .../commercial/price-tables/current`. Não há listagem de versões nem histórico. O frontend assume:

1. `GET /api/v1/developments/{id}/price-tables?status=PUBLISHED,ARCHIVED` → `PriceTableDto[]` (ou `{ data: [...] }`),
   com `status`, `revision`, `currency`, `validFrom`, `createdAt`, `publishedAt` (novo), `pricingMode` (novo),
   `lotPrices` opcional para tabelas `PER_LOT`, `reasonCode`/`changeReason` (novos), `checksum` (novo no DTO).
   Falha → usa as versões locais e marca o histórico como parcial (`complete: false`).
2. `GET /api/v1/developments/{id}/lots/{lotId}/price-history?from&to&priceType&asOfKnowledgeDate` → `LotPriceHistoryDto`
   (mesma forma de `toLotPriceHistoryDto`: `{ lotId, priceType, currency, series[{ priceTableVersionId, effectiveFrom,
   effectiveTo, amount, pricePerM2, pointStatus }], summary, quality, versionRefs, methodologyVersion }`).
3. Futuro: `GET .../pricing/history`, `.../pricing/history/compare`, `.../pricing/index`.
As versões publicadas continuam sendo a fonte de verdade; tabelas materializadas seriam só read models.

## 10. Migração (relatório)

Fases 1–4: inventário feito (1 versão, 1 priceType, sem histórico legado, nenhuma proveniência legada a classificar).
Fases 5–31 implementadas neste módulo (ver §3–§8). Fase 26–29 (integração em detalhes, quick view, comparador, share):
funções prontas; o encaixe nos arquivos de UI é do líder (ver `RELATORIO_TOPICOS_28_29.md`). Desempenho: 498 lotes × 1
versão é trivial; o cache evita recomputar por lote.
