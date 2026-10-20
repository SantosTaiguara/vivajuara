# Plano de retirada do legado (LegacySunset)

Nenhum componente sai antes de: adoção completa do substituto, paridade aceitável (golden sem diferença ou exceção aprovada) e janela de rollback considerada. Todo legado tem marcador, substituto, dono e fase.

| Componente | Substituto | Dono | Fase-alvo | Bloqueios |
|---|---|---|---|---|
| `data/legacyAdapter.js` (lots.json legado) | DTO da API v1 (`/lots`, `/analysis/current`) | backend + frontend | 9.3 | fase 3.2 (shadow read com 0 diferenças) |
| leitura direta de `dash/*.json` pelo repositório | `data/apiSource.js` | frontend | 9.4 | GAP-ARCH-11, 3.2 |
| `services/comparison.js` | `compare/comparisonDomain.js` + `criterionWinner.js` | frontend | 9.5 | golden `comparison` igual com o novo caminho |
| `services/layers.js` (paleta/compute legado) | `map/layers.js` (MapLayerRegistry) | frontend | 9.5 | golden `layers` + t18 = 0 |
| presets de `App.services.recommendation` | `intelligence/recommendation.js` | frontend | 9.5 | decisão de produto: manter "Melhores para…" como atalho? |
| alertas legados de `domain/rules.js` | Rule Engine (`rules/*`, flag `ruleEngineAlerts` OFF) | frontend | 9.2 | D-ALERTS; paridade legada em sombra |
| confiança legada `lot.intelligence.confidence` | `confidence/*` (sombra) | frontend | 9.2 | D-CONFIDENCE |
| stub `App.analytics` em `state/store.js` | `analytics/facade.js` | frontend | 9.2 | nenhum |
| `dash/index_v1.html` (referência do financeiro) | golden `finance` | — | manter como referência até 3.7 | fase 3.7 em sombra |
| menu/rotas antigas | menu compacto (tópico 53) | frontend | 9.6 | golden + matriz de preservação: nada removido, só movido |

## Regras

- Flag de migração tem data/fase de retirada no momento em que é criada.
- Fallback para o legado é contado (métrica de fallback, `ROADMAP_MIGRATION_METRICS.md`) e não pode mascarar bug indefinidamente.
- Remoção usa `LEGACY_REMOVAL_CHECKLIST.md`.
