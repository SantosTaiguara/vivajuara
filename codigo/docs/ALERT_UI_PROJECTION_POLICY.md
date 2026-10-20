# Política de projeção dos alertas na UI (Tópico 36)

`App.alerts.project(alert, audience)` — a instância não muda por modo; só a projeção.

| Público | Vê | Não vê |
|---|---|---|
| CLIENT | só CRITICAL e IMPORTANT (como a ficha atual), tipo, severidade, mensagem de cliente | ids de regra/versão, alertKey, fieldKey, impressão digital, fonte restrita |
| BROKER | todos, alertKey, fieldKey, reconhecido, tipo de razão | ids internos de versão |
| TECHNICAL | + ruleCode, ruleDefinitionId, ruleVersionId, fingerprint, explicação (fatos/limites), evidências | — |

Ordenação (`sortAlerts`): severidade (CRITICAL primeiro), depois sequência da regra, depois lote — determinística. `quickViewSummary(alerts, max)` reproduz `quickview.alertSummary` (paridade testada). Severidade e confiança são comunicadas separadamente; baixa confiança vira caveat, nunca reduz severidade.

## Integração (sem trocar a UI neste tópico)

Com `dev.features.ruleEngineAlerts !== true` tudo continua legado. Para trocar:

- `App.alertMigration.intelligenceAlertsFor(lot, { dev, analysisResult, asOf })` → `{ alerts, source }` no formato de `lot.intelligence.alerts` (precisa do `LotAnalysisResult`, como em `openTechExplain`; sem ele volta ao legado).
- `App.alertMigration.statusNoteFor(lot, mode, { dev, asOf })` → `{ note: { note, warn } | null }` (ramo de aviso do statusVM).
- `App.alertMigration.shareWarningsFor(lots, { dev, asOf, shareCtx })` → `{ warnings }` (avisos "CONFIRA ANTES DE ENVIAR").
- Mapa/filtros/comparação continuam lendo a lista legada projetada (mesmos tipos); alerta nunca esconde lote nem decide vencedor.

Acessibilidade: textos explícitos em português, sem cor sozinha, sem modais; ações reconhecer/adiar/descartar com rótulo explícito quando forem para a UI.
