# Disponibilidade independente do preço (Tópico 29)

Módulo: `src/domain/availability.js` (`App.availability`, estendido — toda a API do Tópico 8 foi mantida sem mudança).
UI: `src/presentation/pricingView.js` (`availabilityVM`, `priceVM`, `commercialVM`, blocos separados).
Testes: `tests/availability2.test.js` (36 testes) + `tests/availability.test.js` (inalterado, verde).

Este documento reúne o que a especificação pedia em sete documentos (arquitetura, independência, semântica de status,
política de atualidade, fontes e conflitos, contratos de API e relatório de desacoplamento).

## 1. Regra central

Disponibilidade ≠ preço. Nenhuma função de disponibilidade recebe ou lê preço; nenhuma função de preço lê status.
Proibido: preço presente → AVAILABLE; preço ausente → SOLD; preço 0 → UNAVAILABLE; SOLD → apagar preço; mudança de
preço → mudança de status; mudança de status → nova versão de tabela. Os testes cobrem as 11 combinações do §7 da
especificação e verificam que `offerability`/`capabilitiesOf` dão o mesmo resultado com e sem preço para todo status/atualidade.

## 2. Estado e semântica

- Status canônicos (Tópico 8, preservados): `AVAILABLE, RESERVED, PROPOSAL, BLOCKED, SOLD, UNAVAILABLE, UNKNOWN`.
  Máquina de estados e matriz de transições do Tópico 8 **não foram reescritas**.
- `DataState`: `VALID, CONFLICTED, INCOMPLETE, INVALID, UNKNOWN_SOURCE` — conflito é qualidade do dado, não status.
- `Freshness`: `FRESH, STALE, EXPIRED, UNKNOWN`. `evaluateFreshness(state, policy, now)` nunca promove para FRESH;
  `freshnessPolicyOf(dev)` lê `DevelopmentConfig.freshnessPolicy` (limites nulos hoje = decisão de negócio, sem TTL universal).
- Rótulos (só na apresentação): Disponível; "Disponível — último status conhecido, confirmar atualização" (corretor) /
  "Último status conhecido: disponível. Confirmar disponibilidade." (cliente); Reservado; Em negociação; Bloqueado
  (cliente: "Indisponível no momento"); Vendido; Indisponível no momento; **UNKNOWN = "A confirmar"**; conflito =
  "Status com divergência — confirmar". O domínio guarda só códigos (`viewModelData` → `labelKey`, `badgeStyleToken`).

## 3. Oferta e capacidades

`offerability(lot)` → `OfferabilityResult { offerability: OFFERABLE | CONDITIONAL | NOT_OFFERABLE | NEEDS_CONFIRMATION | UNKNOWN, reasons, requiresConfirmation, availabilityRevision, freshness, dataState, policyVersion }`:

| Situação | Resultado |
|---|---|
| AVAILABLE + FRESH + VALID | OFFERABLE |
| AVAILABLE + STALE | NEEDS_CONFIRMATION (política `staleOfferability: 'CONDITIONAL'` permite CONDITIONAL) |
| AVAILABLE + EXPIRED / atualidade desconhecida | NEEDS_CONFIRMATION |
| PROPOSAL | NOT_OFFERABLE; CONDITIONAL se `proposalCountsAsOfferable` |
| RESERVED (reserva vencida → NEEDS_CONFIRMATION), BLOCKED, SOLD, UNAVAILABLE | NOT_OFFERABLE |
| UNKNOWN (qualquer atualidade/política) | NEEDS_CONFIRMATION — **nunca OFFERABLE** |
| dataState CONFLICTED / INVALID / INCOMPLETE | NEEDS_CONFIRMATION |

`capabilitiesOf(lot)` → `AvailabilityCapabilities { canRecommend, canStartProposal, canReserve, canSimulate,
simulationConsultative, canCompare (sempre true), canShareAsAvailable (OFFERABLE e FRESH), canShowCommercialCTA,
canShowPriceHistory (sempre true), requiresStatusConfirmation, reasons }`. São capacidades semânticas, não permissões
(Tópico 30: ação final = capacidade E permissão). `canReserve` é sempre falso enquanto `authoritativeWrites` for falso
(frontend somente leitura; nenhuma reserva local; localStorage nunca é autoridade). `actionPolicy` agrupa as decisões.

## 4. Composição comercial

`composeCommercialContext(lot, { mode })` → `CommercialLotContext { lotId, price{amount, pricePerM2, status, freshness,
priceTableVersion, display}, availability (LotAvailabilitySnapshot), offerability, capabilities, simulation{allowed,
consultative, blockedBy: 'PRICE'|'AVAILABILITY'|null}, paymentPlans, versionRefs{priceTableId, priceTableVersion,
availabilityRevision, paymentPlanVersions}, warnings }`. Preço e disponibilidade ficam lado a lado com refs próprias;
não existe "versão comercial" única. Simulação sem preço é bloqueada **por preço**, não por disponibilidade.

Política de exibição do preço por status (`priceDisplayFor`, configurável em `availabilityPolicy.priceDisplay`):
todos os status mostram "Preço de tabela" (inclusive UNKNOWN: "Status a confirmar, preço R$ Y"); **SOLD** mostra
"Último preço de tabela" nos modos corretor/técnico e **oculta** nos modos cliente/apresentação. O preço nunca sai do domínio.

## 5. Snapshot, manifesto, mudanças, eventos

- `lotSnapshot` → `LotAvailabilitySnapshot` (modos `CURRENT, EXPLICIT_REVISION, LAST_KNOWN, OFFLINE_LAST_KNOWN`;
  último conhecido/offline nunca aparece como FRESH, com aviso).
- `buildSnapshot`/`snapshotFromLots` → `AvailabilitySnapshot` congelado, contagens por status/atualidade/dataState,
  checksum FNV sobre estados canônicos ordenados por lotId (não depende de preço — testado zerando todos os preços).
- `manifestOf` + `needsSync` (mesma revisão e checksum → nada a baixar).
- `diff(prev, next)` → `AvailabilityChangeSet` com flags `STATUS_CHANGED, FRESHNESS_CHANGED, RESERVATION_EXPIRED,
  PROPOSAL_UPDATED, SOURCE_CHANGED, CONFLICT_DETECTED, CONFLICT_RESOLVED` (não existe flag de preço) e resumo.
- `eventsOf` → `AvailabilityRevisionPublished`, `AvailabilityStatusChanged`, `AvailabilityConflictDetected`,
  `AvailabilityReservationExpired` (sem preço, sem PII). `invalidationOf` → `fit: false, price: false, priceHistory: false`.
- `diagnostics` → `AvailabilityDiagnostics` (inclui `availableCount` e `offerableCount`, que podem diferir).

## 6. Fontes e conflitos

`AvailabilitySourceRef`, `SOURCE_POLICY` padrão `NO_AUTOMATIC_RESOLUTION`. `resolveSources(observações, política)`:
fontes divergentes sem fonte autoritativa → `status UNKNOWN + dataState CONFLICTED` com os candidatos; `AUTHORITATIVE_SOURCE_WINS`
e `MOST_RECENT_AUTHORITATIVE` só com fonte explicitamente autoritativa. Sem last-write-wins silencioso.

## 7. Validação, feed, cache, resolver

- `validateTransition(current, status, { expectedRevision, reasonCode })` → `TransitionValidationResult` (409 lógico
  `REVISION_CONFLICT`, `REASON_REQUIRED` para BLOCKED/UNAVAILABLE, matriz do Tópico 8, aviso `READ_ONLY_NO_AUTHORITATIVE_BACKEND`).
- `validateBatch(batch, ctx)` → lote desconhecido, duplicado, status inválido, revisão não monotônica, transição ilegal,
  timestamp de fonte antigo, lote idêntico (`sourceHash`) idempotente (`duplicate: true, apply: false`), campos de preço ignorados.
- `adaptFeed(rows, sourceRef)` → AvailabilityFeedAdapter (API/CSV/planilha); códigos legados mapeados; desconhecido → UNKNOWN com aviso; colunas de preço ignoradas.
- `createCache()` → AvailabilityCache próprio (chave desenvolvimento|revisão|checksum + ponteiro corrente). Limpar o cache
  de preço não afeta este e vice-versa (testado).
- `resolve(snapshotOuCache, { lotId, revision?, offline?, allowLastKnown? })` → AvailabilityResolver.

Existente e mantido: `LotRepository.applyAvailabilityFeed/applyAvailabilityUpdate` (revisão monotônica, snapshot atômico,
matriz de transições). Teste: feed de disponibilidade não muda `priceTableVersion` nem preço; nova tabela não muda
`availabilityRevision` nem status.

## 8. Consumidores (verificados em teste)

Filtros: status e preço independentes; combinação só por AND explícito (AVAILABLE sem preço passa no filtro de status;
SOLD com preço passa no filtro de preço). Recomendação: SOLD excluído na elegibilidade com Fit preservado; UNKNOWN nunca
recomendado como disponível; AVAILABLE sem preço nunca falha na etapa de disponibilidade. Comparador: candidato
permanece ao virar SOLD; só a célula de status muda. Simulação: mesma fórmula para SOLD e AVAILABLE; muda apenas a
capacidade (consultiva). Histórico de preço de lote vendido: idêntico.

## 9. API (contrato assumido, para conciliar com o backend)

Existente: `GET /developments/{id}/availability` (snapshot), `GET .../availability/stream`, `GET/PATCH /lots/{lotId}/availability`
(com `expectedRevision`), `GET /lots/{lotId}/availability/history`. Assumido como futuro:
`GET /developments/{id}/availability/manifest` → `manifestOf`; `GET .../availability/changes?since=` → `AvailabilityChangeSet`;
`POST /developments/{id}/lots/{lotId}/availability/transitions` `{ targetStatus, expectedRevision, reasonCode?, reservationExpiry?, proposalRef?, idempotencyKey }`.
Observação para o backend: `availability.dto.js#toAvailabilityState` devolve `freshness: 'FRESH'` para qualquer status
não UNKNOWN, sem considerar a idade de `updated_at`; o cliente então não consegue distinguir STALE vindo do servidor.

## 10. Acoplamentos encontrados (relatório de desacoplamento)

Nenhuma inferência direta preço→status ou status→preço foi encontrada (`grep` por `price != null`, `!price`, `price > 0`
em `src/`). Acoplamentos indiretos, fora dos arquivos deste trabalho, descritos com a correção exata em
`RELATORIO_TOPICOS_28_29.md` §3: capacidade de simular do quick view ignora ausência de preço; nota única de "preço e
disponibilidade" no quick view; elegibilidade de recomendação não trata atualidade EXPIRED; ranking comercial do
`finding.js` ignora atualidade; atualidade fixa FRESH no DTO do backend.
