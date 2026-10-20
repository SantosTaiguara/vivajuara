# Projeção de estados na UI (Tópico 37)

`display(resolved, { mode, format, label, compact })` → `AttributeDisplayProjection { primaryText, secondaryText, stateLabel, iconToken, semanticToken, showValue, showReason, actionIds, ariaText }`.
O domínio guarda só códigos; os rótulos pt-BR ficam em `LABELS`/`DISPLAY_POLICIES` (modos CLIENT, BROKER, TECHNICAL; `presentation` → CLIENT).

| Estado | Cliente | Corretor | Técnico |
|---|---|---|---|
| UNKNOWN | Informação não disponível | Dado desconhecido | UNKNOWN / motivo |
| NOT_AVAILABLE | Informação ainda não disponível | Não disponível | NOT_AVAILABLE / motivo |
| NOT_APPLICABLE | Não se aplica | Não se aplica | NOT_APPLICABLE |
| PENDING | Em atualização | Em atualização | PENDING |
| CONFLICTED | Informação a confirmar | Dados divergentes — confirmar | CONFLICTED |
| INVALID | Informação não disponível | Dado inválido — revisar | INVALID |
| ERROR | Informação temporariamente indisponível | Falha ao processar | ERROR / PROCESSING_FAILED |
| PARTIAL | Informação parcial | Dado parcial | PARTIAL |
| RESTRICTED | Informação restrita | Acesso restrito | RESTRICTED |
| KNOWN + STALE | valor + "Confirmar condição atual" | valor + "Desatualizado — confirmar" | valor + STALE |

- Compacto (célula de comparação): `N/D`, com o motivo no tooltip/drilldown.
- Precedência de exibição: HIDDEN > RESTRICTED > ERROR > INVALID > CONFLICTED > PENDING > NOT_APPLICABLE > NOT_AVAILABLE > UNKNOWN > PARTIAL > KNOWN; frescor sobrepõe depois do estado (CONFLICTED + STALE mostra o conflito).
- Tokens neutros (`ds-nodata`, `ds-na`) para ausência — nunca vermelho; `ds-warning` para conflito/inválido; `ds-stale` como sobreposição; `ds-error` só técnico.
- Leitor de tela: `ariaText` ("Recuo frontal: não disponível."; "Preço: R$ … . Informação desatualizada; confirmar condição atual.").
- Ações: corretor vê `requestConfirmation` / `viewSource`; conflito `viewSource`, `requestConfirmation`; stale `refresh`; NOT_APPLICABLE nenhuma. As ações dependem de permissões (lead).
- `UiLoadState` (`withLoad`) é separado: LOADING → skeleton; FAILED → mensagem de carregamento, sem alterar o estado canônico.
- HTML de referência: `App.favoritesView.dataValue(label, resolved)` (`src/presentation/favoritesView.js`).
