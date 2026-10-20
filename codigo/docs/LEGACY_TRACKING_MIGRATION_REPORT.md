# Relatório de migração do rastreamento legado

## Inventário (busca por `track(`, `analytics.`, `gtag(`, `dataLayer`, `fbq(`, pixel, pageview, mixpanel, amplitude, segment, posthog, clarity, hotjar)
- **SDKs externos:** nenhum. Nenhuma chamada `gtag`/`fbq`/`dataLayer` (teste garante).
- **Rastreador existente:** `App.analytics` em `src/state/store.js:151` — log em memória (100 últimos), sem validação, sem tenant, sem privacidade.
- **Produtores:** `src/presentation/app.js` (32 nomes, incluindo ternários e o helper `workspace.set(..., why)`), `src/compare/comparisonDomain.js` (7), `src/data/offline.js` (6). Total: 46 nomes, todos no inventário (`events.json → legacy`) com ação de migração e transformador declarativo. O teste varre todo `src/` e falha se surgir nome não registrado.
- **Outros “eventos”:** `presentationmode/domain.js` (eventos de domínio), `favorites` (eventos de domínio), `share/shareService.js` (eventos de ação do servidor de referência), `pricing/priceHistory.analyticsEvent` (mapeador sem produtor). Ligados pelo Domain Bridge, não por chamadas novas na UI.

## Achados
| Severidade | Achado | Ação |
|---|---|---|
| HIGH | `share_opened` era emitido quando o **corretor** abria a janela de compartilhamento; colidia com o fato do servidor (abertura válida do link) | RENAME → `share_dialog_opened` |
| HIGH | `presentation_started` era a visão simples; colidia com a `PresentationSession` | RENAME → `presentation_view_entered` (/`_exited`) |
| MEDIUM | `guided_presentation_started` duplicaria `presentation_started` do bridge | RENAME → `guided_presentation_launched` |
| MEDIUM | `sync_failed` levava a mensagem de erro (texto livre, pode conter URL) | campo `error` descartado declaradamente |
| MEDIUM | `constraint_changed` — risco de valor de orçamento | só o nome do campo (`fieldKey`) |
| MEDIUM | `lot_selected` disparava também na reseleção do mesmo lote | `ON_CHANGE` |
| MEDIUM | `filter_zero_result` emitido dentro de `renderFind` | aceito (só na transição); mover para o handler numa refatoração de app.js |
| LOW | nomes fora da convenção (`mode`, `preset`, `quick_action`, `sheet_snap`, `offline_exit`) | RENAME |
| LOW | `layout_profile_changed` não é ação do usuário | telemetria técnica |
| LOW | eventos de layout sem consumidor (`desktop_panel_*`, `legend_*`, `comparison_bar_toggled`) | mantidos LOW; candidatos a REMOVE |
PII encontrada nos payloads atuais: nenhuma direta (só códigos), exceto o texto livre de erro em `sync_failed` (removido).

## Compatibilidade
`App.analytics.track(evt, data)` continua igual (inclusive sem `this`, como o comparisonDomain usa) e `App.analytics.log` continua `{ evt, data, t }` com o nome usado pelo chamador. Nenhuma chamada em `app.js` precisa mudar para continuar funcionando.
