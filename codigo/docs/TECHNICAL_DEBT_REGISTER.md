# Registro de dívida técnica

Dívida ≠ bug: é uma escolha que funciona hoje e cobra juros depois. Bugs entram em `LEGACY_BEHAVIOR_INVENTORY.md` (classificação BUG).

| ID | Componente | Descrição | Juros (custo de manter) | Gap/relacionado | Fase-alvo | Status |
|---|---|---|---|---|---|---|
| TD-01 | `services/comparison.js` | API legada de comparação mantida para `viewmodels.comparisonVM` e QuickView, ao lado de `compare/*` | duas implementações de "vencedor"/linhas | GAP-ARCH-02 | 9.5 | aberto |
| TD-02 | `services/layers.js` | paleta e cálculo legado de camadas usados por `map/layers.js` | cores definidas em dois lugares | GAP-ARCH-02 | 9.5 | aberto |
| TD-03 | `services/finding.js` (`App.services.recommendation` presets) | ranking legado por presets ao lado de `intelligence/recommendation.js` | duas formas de "melhores lotes" | CAP-14 | 9.5 | aberto |
| TD-04 | `state/store.js` stub de `App.analytics` | stub sobrescrito pela fachada | ordem de carga importa | GAP-ARCH-10 | 7.6 | resolvido (2026-10-12, RELATORIO_LIMPEZA_2026-10-12.md) |
| TD-05 | `presentation/app.js` (1.159 linhas) | composition root grande, faz fetch de analysis-input | difícil testar boot | GAP-ARCH-11 | 1.5 | aberto |
| TD-06 | `data/legacyAdapter.js` | adaptador do lots.json legado (nomes `did`, `st`, …) | necessário até a API | `LEGACY_SUNSET_PLAN.md` | 9.3 | transitório |
| TD-07 | `layout/responsiveProfile.js` | resolver lê DOM | teste depende de stub de DOM | GAP-ARCH-09 | 2.7 | aberto |
| TD-08 | página única | bundle ≈2,8 MB sem compressão | tempo de carga em 4G | D-HOSTING | 9.7 | aberto |
| TD-09 | backend: ponteiros em `developments` escritos por 3 módulos | acoplamento de tabela | GAP-ARCH-15 | 3.6 | aberto |
| TD-10 | E2E/visual fora do CI | scripts Playwright no ambiente de trabalho | regressão visual só manual | `VISUAL_REGRESSION_POLICY.md` | 0.5 | aberto |
| TD-11 | Feature flags de migração (`ruleEngineAlerts`, confiança em sombra) | sem data de retirada antes deste tópico | flags viram permanentes | `LEGACY_SUNSET_PLAN.md` | 9.2 | com sunset |
| TD-12 | Fórmula de preço (área × R$/m²) duplicada em 4 arquivos: `data/repositories.js:33`, `domain/lot.js:162`, `pricing/priceHistory.js:106`, `provenance/provenanceServices.js:369` | cada caminho calcula localmente | divergência silenciosa se a tabela mudar em um só lugar (dupla verdade) | `LEGACY_FORMULA_INVENTORY.md`; golden `lots`/`finance` protege o resultado | 9.5 | resolvido (2026-10-12, RELATORIO_LIMPEZA_2026-10-12.md) |
