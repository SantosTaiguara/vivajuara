# Relatório de paridade dos alertas (Tópico 36, modo SHADOW)

Comparação entre a saída legada e a saída do Rule Engine sobre os 498 lotes, reproduzida pelo teste `tests/rules.test.js` (golden RuleVersionShadowParity). Rule set: `ruleset:viva-juara:legacy-v1`. asOf: 2026-10-09T12:00:00.000Z.

| Campo | Valor |
|---|---|
| totalEvaluatedEntities | 498 |
| totalLegacyAlerts | 404 |
| totalEngineAlerts | 404 |
| exactMatchCount | 404 |
| missingInEngineCount | 0 |
| extraInEngineCount | 0 |
| severityMismatchCount | 0 |
| wordingMismatchCount | 0 |
| unknownEvaluations | 0 |
| errorEvaluations | 0 |
| shareWarningsCompared | 498 |
| mismatches | 0 |

## O que é comparado

1. **INTELLIGENCE_ALERTS** — objeto completo de `lot.intelligence.alerts` (id, type, severity, title, message, fieldKey, sourceId) e a ordem, lote a lote; além disso as strings "al" em ordem de análise contra `lots.json` e contra IntelligenceEngine + textAdapter.
2. **STATUS_NOTE** — ramo `warn` do statusVM, modos corretor e cliente: nos 498 lotes reais e em 498 variações sintéticas (7 status × 5 atualidades × 4 idades de atualização, relógio fixo).
3. **SHARE_WARNINGS** — lista completa de avisos do shareVM em 3 cenários (dados atuais; status/atualidade mistos; atualidade comercial ausente/STALE/EXPIRED/null e preço ausente), modos corretor e cliente.
4. **QuickViewAlertSummary** — contagens e topAlerts iguais a `quickview.alertSummary` (max 1 e 3).
5. **Projeção cliente** — mesmo subconjunto CRITICAL/IMPORTANT da ficha.

## Resultado

Zero delta semântico, de texto, de severidade, de ordem e de lotes. Nenhuma avaliação UNKNOWN ou ERROR com os dados atuais. Divergências não resolvidas: nenhuma.

Limite honesto: a paridade cobre os dados e cenários acima; MISSING_AREA não é exercitado pelos dados reais (coberto por teste unitário de verdade ternária).
