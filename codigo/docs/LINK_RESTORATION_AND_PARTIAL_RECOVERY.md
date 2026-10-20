# Restauração e recuperação parcial

`App.deeplink.restoration.restore(envelope, deps)` → `LinkRestoreResult`:

```ts
{ status: 'FULL' | 'PARTIAL' | 'FAILED', restoredBranches, skippedBranches: [{ branch, reason }], warnings,
  finalRoute, finalAppStatePatch, hints: { viewport?, comparisonSectionId?, presentation?, journeyId?, message? },
  errorState, message }
```

`deps`: `currentDevelopmentId`, `developmentExists(id)`, `resolveLot(ref)`, `layerRegistry`, `mapDefaults`, `filters`, `mapBounds`, `detailSections`, `authorize(chave, recurso)`, `presentation.getSnapshot(id) → { stepIds, startStepId }`, `presentationMode`.

## Ordem (§43) — `restoration.ORDER`

organization (stateRef) → development → route → customer → journey → filters → map → comparison → lot → viewport → presentation → ui.
Lote nunca antes do empreendimento; cliente nunca antes da autorização; cliente nunca inferido de filtros.

## Patch

Só chaves do ApplicationState já usadas pelo `App.router.parse`: `developmentId, currentLotId, panel, detailSection, view, comparisonLotIds, backgroundLayer, activeMapLayer, scoreKey, mapOverlays, activeFilters` e, com stateRef autorizado, `currentCustomerId`. Nunca `sheet`, larguras, `mapViewport` em pixels, nem dados de lote.

## Avisos

`FILTER_REMOVED, LOT_NOT_FOUND, LAYER_UNAVAILABLE, OVERLAY_UNAVAILABLE, COMPARISON_NOT_FOUND, COMPARISON_LOT_NOT_FOUND, STATE_VERSION_MIGRATED, CUSTOMER_ACCESS_DENIED, JOURNEY_ACCESS_DENIED, PRESENTATION_NOT_FOUND, PRESENTATION_ACCESS_DENIED, PRESENTATION_STEP_NOT_FOUND, VIEWPORT_RESET, SECTION_NOT_FOUND, STATE_REF_EXPIRED, STATE_REF_NOT_FOUND, STATE_REF_TIMEOUT, LINK_VERSION_UNSUPPORTED`.

## Casos

* **Lote ausente**: `currentLotId: null`, mapa, mensagem "O lote deste link não está mais disponível na base atual." Nunca redireciona para outro lote.
* **Lote vendido/indisponível**: o link continua válido; o estado atual é mostrado (LIVE).
* **Camada removida**: lote restaurado, camada volta ao padrão do empreendimento, `PARTIAL`.
* **Comparação**: ordem preservada, duplicatas removidas, máx. 4, ausentes reportados; valores recalculados pelo domínio Comparison.
* **Step inválido**: step inicial do snapshot.
* **Empreendimento desconhecido / diferente do carregado**: `FAILED` (`requiresDevelopment` informa qual recarregar).

## Assíncrono e corrida

`restoreAsync(env, deps, { references, authCtx, transactions, timeoutMs })` busca o stateRef e verifica, após cada `await`, se a transação ainda é a ativa (`LinkRestorationTransaction`). Link A seguido rapidamente de B: a resposta tardia de A retorna `CANCELLED` e não é aplicada. Timeout → `STATE_REF_TIMEOUT` (restaura o restante).

## Responsivo

O mesmo link gera o mesmo patch em desktop/tablet/mobile; o container (painel direito, sheet intermediário) é decidido pelo layout (`App.mobileSheet.initialSnap({ hasLot })` → `INTERMEDIATE`).
