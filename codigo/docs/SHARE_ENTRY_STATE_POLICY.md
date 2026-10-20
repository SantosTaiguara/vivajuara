# Política de estado de entrada de share (ShareEntryStatePolicy)

O tópico 42 define que a URL externa é **somente** `/s/<token>` (`validateShareUrl` rejeita query e fragmento). O estado inicial do cliente vem do `ShareEntryPoint.initialViewState` ligado ao grant no backend.

`App.deeplink.codec.shareEntryState(request, scope)` trata qualquer pedido de navegação dentro de um share (parâmetro anexado por alguém, navegação na página) como **não confiável**:

* `scope` = `{ allowedLotRefs, allowedStepIds, startStepId, allowedComparisonSections }`, derivado do ShareGrant/snapshot (nunca da URL).
* Chaves permitidas: `step`, `lot`/`lotRef`, `sec`/`comparisonSection`, `vp`/`mapViewportPreset` — validadas por `App.share.domain.validateInitialViewState`.
* Lote fora do conjunto permitido → `LOT_OUT_OF_SCOPE` (branch ignorada).
* Step inválido → step inicial (`PRESENTATION_STEP_NOT_FOUND`).
* `customerId`, `journeyId`, `resourceId`, `priceVersion`, revisão de disponibilidade, qualquer `*Id` → `SCOPE_EXPANSION_REJECTED`.
* `__proto__`/`constructor` → `PROTOTYPE_POLLUTION_REJECTED`; PII → `PII_REJECTED`; mais de 8 parâmetros → rejeitado.

Resultado `{ ok, state, rejected, warnings, startAtDefault }`. **Nunca amplia o escopo**; um token válido com `?lotId=LOTE-FORA` não mostra o lote.

Geração: `LinkStateService.createLink({ intent: 'EXTERNAL_SHARE' })` não gera URL — devolve `{ delegate: 'SHARE_SERVICE' }`. O codec recusa `encode` em contexto SHARE_ENTRY.
