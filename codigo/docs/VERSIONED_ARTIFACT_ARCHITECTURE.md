# Arquitetura de artefatos versionados

## Classes de dado (tópico 7, `data/lifecycle.js`)

| Classe | O que é | Exemplos no Viva Juara | Mudança |
|---|---|---|---|
| STATIC | estrutura do empreendimento | identidade, geometria, medidas, vizinhança | nova `staticVersion` (hoje `2026-10-06.1`) |
| VERSIONED | resultado publicado de um processo | análise (`2026-10-06`), tabela de preços (`2026-10-06`), metodologia (`config/scoring/viva-juara/current.json`), documentos | nova versão imutável; correção = nova versão |
| DYNAMIC | estado comercial que muda sozinho | disponibilidade (`availabilityRevision`), preço comercial vigente | revisão monotônica com frescor |
| USER/WORKFLOW | dados do trabalho do corretor | cliente, jornada, favoritos, comparação, apresentação, share | revisão por registro, tenant-scoped |

## Regras

1. **Versão publicada é imutável** (invariante 6). `methodology.js` valida checksum; `configBundle.js` faz o build falhar se `current.json` não confere com o arquivo; backend arquiva a tabela anterior (`ARCHIVED`) e cria uma nova (migration 005).
2. **Current é ponteiro, não artefato** (invariante 8): `config/scoring/<dev>/current.json`, `currentPriceTableId`, `developments.current_*` no backend.
3. **Version vector** por lote: `metadata.dataVersions = { staticVersion, analysisVersion, priceTableVersion, availabilityRevision }`. Cache, deep link, share e comparação carregam as versões com que foram gerados e avisam quando a versão atual é outra.
4. Nem todo recurso precisa de todas as versões: um deep link de lote não precisa de priceTableVersion; um share com preço precisa.
5. Mismatch de versão é observável (cache `validateCompatibility`, share `freshness`), nunca silencioso.
6. Checksums: manifest publica FNV dos snapshots (`static 563a5f06`, `analysis 98319c8d`); o golden registra sha256 do JSON canônico de cada arquivo de dados (`DATA_PARITY_REPORT.md`).

## Fluxos de publicação

**Tabela de preços**: rascunho → validação (todos os lotes com preço, planos coerentes) → `POST /price-tables?dryRun=true` (diferença lote a lote) → publicação (nova versão, anterior arquivada, auditoria) → InvalidationEvent `PriceTableActivated` → caches de PRICING_SNAPSHOT expiram; históricos ganham um ponto.

**Análise**: nova metodologia (DRAFT) → `analysis/preview` (relatório de impacto, sem publicar) → validação humana → publicação de `analysis_versions` → `AnalysisVersionActivated`. Refactor nunca muda score sem nova `methodologyVersion` (golden `lots` falha).

**Disponibilidade**: feed/admin → `validateTransition` (máquina de estados) → revisão + histórico → SSE `availability/stream` → cliente aplica `applyAvailabilityFeed` sem tocar preço.
