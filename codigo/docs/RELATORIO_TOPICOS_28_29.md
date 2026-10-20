# Relatório — Tópicos 28 (histórico de preços) e 29 (disponibilidade independente do preço) — frontend

Data: 08/10/2026. Escopo deste trabalho: módulos de frontend, testes e documentação. O backend (Postgres/API) é de outro
trabalho; os contratos assumidos estão em `PRICE_HISTORY_ARCHITECTURE.md` §9 e `AVAILABILITY_PRICE_INDEPENDENCE.md` §9.

## 1. O que foi implementado

### Arquivos criados
- `src/pricing/priceHistory.js` — `App.priceHistory` (Tópico 28): modelo mínimo de versão, série (pontos, intervalos,
  eventos), deltas, CAGR sob política, R$/m² histórico, resolver histórico (4 modos), qualidade/completude, índice
  interno (cesta comum, mediana), comparação entre datas, métricas informativas para o comparador, cache, repositórios
  (local e API com fallback), serviço de aplicação, view models (resumo, gráfico em degraus, tabela acessível, períodos,
  quick view), texto de compartilhamento seguro, DTO de API, eventos de analytics sem PII.
- `src/presentation/pricingView.js` — `App.pricingView`: view models de status e preço (rótulos em português) e render
  em HTML: blocos separados de disponibilidade e preço, linha discreta do quick view, seção de histórico com gráfico SVG em degraus e tabela acessível.
- `src/presentation/pricing.css` — estilos (tokens de `styles.css`, claro/escuro, alvo ≥ 44 px em toque).
- `tests/pricing.test.js` (36 testes), `tests/availability2.test.js` (36 testes).
- `docs/PRICE_HISTORY_ARCHITECTURE.md`, `docs/AVAILABILITY_PRICE_INDEPENDENCE.md`, este relatório.

### Arquivo alterado
- `src/domain/availability.js` — estendido (Tópico 29). Todas as exportações e comportamentos do Tópico 8 mantidos;
  `tests/availability.test.js` continua verde. Acrescentados: `DataState`, `Offerability`, freshness policy,
  `resolveSources`, `lotSnapshot`, `offerability`, `capabilitiesOf`, `actionPolicy`, `shareClaim`, `priceDisplayFor`,
  `buildSnapshot`/`snapshotFromLots`, `manifestOf`/`needsSync`, `diff`, `eventsOf`, `invalidationOf`, `diagnostics`,
  `validateTransition`, `validateBatch`, `adaptFeed`, `createCache`, `resolve`, `composeCommercialContext`, `viewModelData`, `independenceOf`.

Nenhum dado foi alterado (IDs, geometria, scores, preços, R$ 1.196/m², versão única 2026-10-06, 498 lotes UNKNOWN).
Suíte do frontend: **448 testes, 448 passando** (`cd tests && npm test`).

### Fatos com os dados atuais
- 1 versão publicada → histórico de 1 ponto por lote; variação **"não pode ser calculada"** (nunca 0%, nunca tendência);
  qualidade LOW; quick view sem linha de variação; índice = 100 com variação não calculável; compartilhamento:
  "Há uma única versão publicada; não há variação a informar." + aviso.
- Vigência da tabela não informada: usada a data de emissão 06/10/2026 (marcada "necessita confirmação").
- 498 lotes UNKNOWN → todos "A confirmar", oferta NEEDS_CONFIRMATION, 0 ofertáveis; o preço de tabela continua exibido (status e preço independentes).

## 2. Chamadas de integração para o líder (arquivos de UI que não são deste trabalho)

Memoizar um serviço por empreendimento (ex.: em `app.js`):
```js
const priceHistory = App.priceHistory.forDevelopment(dev.id, {
  repository: App.priceHistory.PriceHistoryRepository(dev.id, { commercialRepo }) // o MESMO CommercialRepository passado ao LotRepository (opts.commercialRepo)
});
// depois de repo.applyPriceTable(t): priceHistory.setVersions(App.priceHistory.PriceHistoryRepository(dev.id, { commercialRepo }).listPublishedVersions());
// modo API: App.priceHistory.ApiPriceHistoryRepository(dev.id, { baseUrl, fallback: <repositório local> }) e await listPublishedVersions() → createService({ developmentId, versions, offlinePartial: !repo.complete })
const mode = q.context.presentationMode;            // 'client' | 'broker' | 'technical'  ('presentation' também aceito)
const avPolicy = App.availability.independenceOf(dev);
```
**Quick view** (`panels.js#quick`): trocar `statusLine(q.status)` (ou acrescentar logo depois) por
```js
const cvm = App.pricingView.commercialVM(lot, { mode, policy: avPolicy, offline: q.context.offline && q.context.offline.status === 'OFFLINE' });
h += App.pricingView.renderCommercialBlocks(cvm);
h += App.pricingView.renderQuickViewPriceChange(App.priceHistory.quickViewSummary(priceHistory.lotHistory(lot)));  // '' hoje (versão única)
```
e usar `cvm.simulation.allowed` / `cvm.simulation.reason` para o botão de simulação (ver §3, item 1).

**Painel de detalhes** (`panels.js#details`): nova seção "Histórico de preço de tabela" (inclusive para lote vendido):
```js
h += App.pricingView.renderHistorySection(priceHistory.viewModel(lot, { mode, from: st.priceHistoryFrom || undefined }));
// <select data-pv-period>: on change → st.priceHistoryFrom = vm.periodOptions.find(o => o.id === value).from; re-render
```
**Filtros**: nenhuma mudança obrigatória (status e preço já são independentes; combinação só por AND explícito — testado).
Opcional (§3, item 4): "só ofertáveis" com `App.availability.offerability(lot, { policy }).offerability === 'OFFERABLE'`.

**Comparador**: linhas informativas (sem vencedor) a partir de
`priceHistory.comparisonMetrics(lots, { to: hoje }).metrics` → `{ key, label, values, semantics: 'INFORMATIONAL', better: null }`;
se `comparable === false`, mostrar "não comparável" (`reasons`). Hoje todos os valores são `null` (versão única).

**Compartilhar**: `App.priceHistory.shareText(priceHistory.lotHistory(lot), { lotLabel })` para o fato histórico; status com
`App.availability.shareClaim(lot)` (códigos) ou `App.pricingView.shareStatusText(lot)` (texto; só na UI, pois pricingView não carrega no harness).

**CSS**: `src/presentation/pricing.css` é concatenado pelo build automaticamente.

## 3. Acoplamentos encontrados fora dos meus arquivos — correção exata sugerida

1. `src/quickview/quickview.js#capabilities` — `canSimulate` usa só o status; lote AVAILABLE sem preço aparece como
   simulável (a simulação devolve `null`). Trocar por:
   ```js
   const cc = AV.composeCommercialContext(lot, { mode: ctx.presentationMode, policy: AV.independenceOf(input.dev) });
   canSimulate: cc.simulation.allowed,
   simulateReason: cc.simulation.allowed ? null : cc.simulation.blockedBy === 'PRICE' ? 'Simulação indisponível: lote sem preço de tabela utilizável.' : sim.warning || 'Simulação indisponível para este status.',
   ```
2. `src/quickview/quickview.js` linha ~135 (`customerFit.note`) — junta atualidade de preço e de disponibilidade numa
   nota única. Separar: `noteAvailability: lot.availability.freshness !== 'FRESH' ? 'Disponibilidade sujeita a confirmação' : null`,
   `notePrice: commercial.freshness && commercial.freshness !== 'FRESH' ? 'Preço sujeito a confirmação' : null`.
3. `src/intelligence/recommendation.js#systemEligibility` — só trata `availabilityFreshness === 'STALE'`; EXPIRED passa
   como elegível. Trocar a condição por `['STALE', 'EXPIRED'].includes(ctx.availabilityFreshness)` e, para EXPIRED, nunca
   `ALLOW_WITH_WARNING` (no mínimo REVIEW).
4. `src/services/finding.js#commercial` (ranking comercial) e `src/filters/filters.js` linha 177 (`OFFERABLE`) — usam
   `isOfferable(status)`, que ignora atualidade: AVAILABLE STALE conta como ofertável. Trocar por
   `App.availability.offerability(l, { policy }).offerability === 'OFFERABLE'` (mudança de semântica: decisão do líder;
   hoje não altera resultados, pois todos os lotes são UNKNOWN).
5. Backend `src/modules/availability/availability.dto.js#toAvailabilityState` — `freshness: 'FRESH'` para qualquer status
   não UNKNOWN, sem olhar a idade de `updated_at`. Calcular pela política do empreendimento (ou omitir e deixar o cliente decidir).
6. `src/presentation/viewmodels.js#statusVM` — rótulo de UNKNOWN é "Status não confirmado"; a especificação prefere
   "A confirmar". Opcional (o texto atual é seguro).

Não foi encontrada nenhuma inferência direta preço→status ou status→preço (`price != null`, `!price`, `price > 0`).

## 4. O que ficou pendente e por quê

- **Tópico 27 não fornecido**: o modelo de versão é mínimo (sem PriceEntry/PriceChangeSet/aprovação). Campos `priceType`,
  `reasonCode`, `publishedAt`, `lotPrices`, `checksum` no DTO são assumidos; hoje caem em padrões seguros.
- **Endpoints de histórico/listagem de versões e manifest/changes de disponibilidade não existem** no OpenAPI atual;
  contratos assumidos documentados para conciliação com o backend.
- Integração nos arquivos de UI do líder (quick view, detalhes, comparador, share, filtros): funções prontas, encaixe não feito (arquivos não são deste trabalho).
- Gráfico só de preço nominal (R$/m² está no resumo e na tabela; segundo gráfico não foi feito para evitar eixo duplo).
- Inflação/valor real, série de transações e índice segmentado: fora de escopo pela própria especificação.
- Escrita autoritativa de disponibilidade (reserva, transições): frontend permanece somente leitura (sem backend autoritativo ligado).
- A especificação pedia 7 documentos por tópico; foram consolidados em um documento por tópico, com uma seção para cada.

## 5. Decisões humanas necessárias

1. **Data de vigência da tabela 2026-10-06**: confirmar se vale desde a emissão (hoje inferida) e se há validade final.
2. **Preço de lote vendido no modo cliente/apresentação**: hoje oculto (corretor/técnico veem "Último preço de tabela").
   Configurável em `availabilityPolicy.priceDisplay`.
3. **AVAILABLE desatualizado**: NEEDS_CONFIRMATION (padrão) ou CONDITIONAL (`availabilityPolicy.staleOfferability`).
4. **Proposta conta como oferta?** (`proposalCountsAsOfferable`, hoje falso).
5. **Limites de atualidade** (`freshnessPolicy.availabilityMaxAgeMs/ExpireAfterMs`, hoje nulos).
6. **Fonte autoritativa de disponibilidade** e modo de conflito (hoje `NO_AUTOMATIC_RESOLUTION`).
7. **Período mínimo para variação anualizada** (365 dias) e qualidade mínima para a linha do quick view (MEDIUM).
8. Rótulo de PROPOSAL ("Em negociação") e de BLOCKED no modo cliente ("Indisponível no momento").
