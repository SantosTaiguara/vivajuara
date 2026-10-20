# Inventário de fórmulas legadas

Toda fórmula que produz um número visível, onde ela mora, quem é o dono, como é provada e onde há cópia. Fórmula desconhecida nunca é refatorada por palpite (tópico 54 §195).

| Fórmula | Definição atual | Dono | Onde aparece | Prova de paridade | Observação |
|---|---|---|---|---|---|
| Preço do lote | `round(areaM2 × pricePerM2 × 100) / 100`, R$ 1.196/m², tabela `lancamento-2026-10` v`2026-10-06` | pricing | `data/repositories.js:33` (composição), `domain/lot.js:162` (patch), `pricing/priceHistory.js:106` (histórico), `provenance/provenanceServices.js:369` (verificação) | golden `lots.*.commercial.price`; teste "area × 1196 = price" em `preservation54.test.js`; `pricing.test.js` | TD-12 resolvido em 2026-10-12: uma só função, `App.pricing.formula` (em `domain/model.js`, presente nas duas ordens de carga — navegador e backend: `lotPrice`, `downPaymentValue`, `pricePerM2Of`), usada pelos 4 caminhos; resultado idêntico (golden inalterado) |
| Entrada padrão | `price × 12 / 100` (`downPaymentDefault 0.12`) | pricing/financial | `data/repositories.js`, `services/finance.js` | golden `lots.*.commercial.downPaymentDefaultValue`, `finance` | — |
| Parcela Price | `PMT = financiado × i / (1 − (1+i)^−n)`, i = 0,8% a.m., n = 144 | financial | `services/finance.js` `factor` | `regression.test.js` (executa o código de `dash/index_v1.html`), golden `finance` | sem IGP-M (rodapé obrigatório) |
| Price com anuais | mensal = fin × monthlyShare × PMT; anual = fin × (1 − share) / Σ (1+i)^−(first+12k) | financial | `services/finance.js` `annualPV` | idem | 11 anuais a partir do mês 11 (P144A) |
| Parcelado com desconto | total = preço × (1 − desconto); parcela = (total − entrada)/n | financial | `services/finance.js` | idem (I18, I36) | sem juros |
| Scores (housing, investment, family, premium, overall), classe, notas, rankings, destaques, alertas | metodologia `config/scoring/viva-juara/1.0.json` (methodologyVersion 1.0.0) | analysis | `intelligence/engine.js` + `methodology.js` + `normalization.js` | `intelligence.test.js`: 498 lotes × 45 campos, zero diff; golden `lots` | refactor ≠ recalibração |
| Fit Score | soma ponderada de matchers por preferência, cobertura e confiança | recommendation | `intelligence/fit.js` + `config/fit/viva-juara.json` | `recommendation.test.js`, golden `recommendations.fit` | relativo ao perfil; nunca probabilidade de compra |
| Relevância dos presets | `App.services.recommendation.rank` (pesos por preset) | recommendation (legado) | `services/finding.js` | golden `recommendations.legacyPresets` | TD-03 |
| Posição solar | declinação + ângulo horário, UTC-3 sem horário de verão, lat −20,145 / lon −40,208 | solar | `services/solar.js` | golden `solar` (21 lotes × 3 estações) | não considera sombra de vizinhos (KLB-04) |
| Lado iluminado | frente iluminada quando o sol está a < 90° do rumo da frente | solar | `services/solar.js` `litSide` | golden `solar` + camada "Sol agora" | — |
| Faixas das camadas | quantis dos dados ou faixas fixas da config | map | `map/layers.js` + `services/layers.js` | golden `layers` (cor de cada lote), t18 | TD-02 (duas implementações) |
| Distâncias | linear e por percurso (rotas), em metros | lot (estático) | `lots.json`, `routes.json` | golden `lots.*.location/mobility` | dado publicado, não recalculado |
| Confiança do dado | dimensões × pesos (modo sombra) | confidence | `confidence/confidenceEngine.js` | `confidence.test.js` | pesos aguardam aprovação (D-CONFIDENCE) |
| Checksums | FNV-1a dos snapshots; sha256 de integridade | shared | `data/offline.js` checksum, `documents/integrity.js` | `regression.test.js` (manifest) | — |

## Se uma fórmula não puder ser reconstruída

Manter o valor publicado como dado (`MIGRATED_LEGACY` em `versioning/analysisVersioning.js`), marcar o método como não referenciado e não recalcular.
