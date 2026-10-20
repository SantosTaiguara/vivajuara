# Relatório de migração da proveniência legada (Tópico 33)

Entrada: rótulos do FieldRegistry (`App.model`: status, sourceId, method) + sobreposições por lote (`lot.provenance`), resolvidos por
`App.model.getFieldProvenance`. Saída: 66.732 `AttributeProvenanceRecord` (498 lotes × 134 atributos rastreados; campos virtuais e
`metadata.schemaVersion` ficam fora). Migração `1.0.0`, determinística (mesmo lote ⇒ mesmos ids), **zero-delta** (`serializeLot` de todos
os lotes idêntico antes/depois — testado).

## Mapeamento aplicado
| Rótulo legado | Resultado | Registros |
|---|---|---|
| CONFIRMED + `official` / `declared` (sem fonte exata recuperável) | LEGACY_DECLARED / UNRESOLVED; `metadata.candidateDocumentId` (vínculo REQUIRES_REVIEW) | 3.984 |
| CONFIRMED + `config` / `inventory` (developments.js, analysisVersion, regulamento ausente) | DIRECT_SOURCE / VERIFIED com `CONFIG_VERSION` + checksum | 1.494 |
| TO_CONFIRM (fechamento dos fundos — evento de lançamento) | LEGACY_DECLARED / UNRESOLVED, currentness REVIEW_REQUIRED | 196 |
| CALCULATED com método versionado (`plan-geometry-v1`, vetorização, regras/ranking `analysis-v1`, regra de id/código) | CALCULATED / PARTIAL + MethodRef + dependências do registro | 8.857 |
| CALCULATED com método sem versão (`kmz-v1` geoespacial/regras/rotas, `aerial-v1` interpretação visual) | LEGACY_DECLARED / PARTIAL (versão não inventada) | 14.200 |
| ESTIMATED (`analysis_model`, `solar_orientation`) fora de `intelligence.*` | ESTIMATED / PARTIAL | 9.462 |
| `intelligence.*` (scores, classe, notas, alertas, destaques, rankings) | ANALYSIS_DERIVED / PARTIAL + `ANALYSIS_RESULT` (análise 2026-10-06, metodologia 1.0.0) | 8.964 |
| UNKNOWN (null) | NOT_AVAILABLE com motivo configurado; sem motivo → `UNKNOWN_REASON` + REVIEW_REQUIRED | 10.458 |
| UNKNOWN com valor (sobreposição por lote) | LEGACY_DECLARED / UNRESOLVED | 153 |
| NOT_APPLICABLE (número da quadra) | NOT_AVAILABLE / NOT_APPLICABLE | 498 |
| `commercial.*` (adapter Pricing) | DIRECT_SOURCE / PARTIAL com `PriceTableVersion` (arquivo da tabela não recebido); preço e entrada CALCULATED | 1.992 + 996 + 996 (vigência ausente) |
| `availability.*` (adapter Availability) | NOT_AVAILABLE / SOURCE_NOT_INGESTED (status UNKNOWN, **nunca** disponível); revisão = registro do sistema | 3.486 + 498 + 498 |

**Nenhum "confirmado" legado virou VERIFIED** sem evidência localizável (`verifiedFromLegacyConfirmed = 0`; os 1.494 VERIFIED vêm de
configuração versionada, que é localizável). Em particular a área oficial (`geometry.areaM2`) é `LEGACY_DECLARED / UNRESOLVED` até que o PDF
da planta seja publicado como documento e a página/linha do quadro de áreas seja referenciada.

## Nulos sem motivo registrado (7 campos × 498 = 3.486, em REVIEW_REQUIRED)
`identity.externalCode`, `geometry.perimeterM`, `geometry.irregularityLevel`, `location.sector`, `location.distanceToAppM`,
`location.distanceToMainInternalRoadM`, `surroundings.appNearby`. Não se inventou motivo: decisão humana.

## Verificações
Diagnóstico após migração: 0 referências de documento quebradas, 0 dependências quebradas, 0 divergências de fingerprint, 0 conflitos.
Preço de tabela = área × R$ 1.196/m² reproduzido nos 498 lotes. Nenhum score, classe, ranking, preço, geometria ou metodologia alterado.

## Pendências humanas
1. Confirmar/publicar a planta e indicar o locator (página do quadro de áreas) → reprocessar áreas, códigos, quadras e servidões como
   DIRECT_SOURCE / VERIFIED.
2. Versionar formalmente os métodos geoespaciais do KMZ e a interpretação da aérea (hoje LEGACY_DECLARED / PARTIAL).
3. Motivos para os 7 campos nulos sem motivo.
4. Arquivo da tabela de preço e gravação do evento (entrada padrão, planos, fechamento dos fundos).
