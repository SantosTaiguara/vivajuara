# Destinos e mapeamentos

| Código | Estado | Observação |
|---|---|---|
| `LOCAL_BUFFER` | ligado | memória da aba; alimenta “Métricas locais” |
| `FIRST_PARTY_INGESTION` | **desligado** | `POST /api/v1/analytics/events`; backend inexistente (D2) |
| `GOOGLE_ANALYTICS` | **desligado** | terceiro (D3); só mapeamento |
| `META_PIXEL` | **desligado** | terceiro (D3); só mapeamento |
| `CUSTOM_WAREHOUSE` | **desligado** | futuro (D2) |
| `DEBUG` | desligado em produção | nomes/versões no console com `App.debug` |

O evento canônico é mapeado para o fornecedor; o fornecedor nunca define o schema. Mapeamentos atuais (`policy.destinations.*.mappings`): GA — `lot_selected(selectionSource)`, `comparison_opened(candidateCount)`, `presentation_completed(purpose, lotCount)`, `deep_link_restored(routeCode, restoreStatus)`; Meta — `presentation_completed → PresentationCompleted(purpose)`. Além disso o evento precisa listar o destino em `destinations`.

`privacy.vendorPayload` só leva os parâmetros do mapeamento, passa pelo scrub e remove `customerId`, `journeyId`, `userId`, `anonymousId`, `shareGrantId`; rota só como código sanitizado (nunca `location.href`). Cada destino tem seu `AnalyticsDestinationDeliveryRecord` (`PENDING/SENT/FAILED/SKIPPED`, tentativas, último erro): falha do GA não apaga nem atrasa o evento first-party. Reprocessamento/backfill nunca reenvia para terceiros.
