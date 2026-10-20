# Arquitetura do onboarding de empreendimentos

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

## Visão geral
Pipeline em estágios separados, cada um puro e testável, coordenados por `App.onboarding.orchestrator` (que coordena, mas não detém lógica de domínio: não calcula score, não interpreta cláusula jurídica, não decide disponibilidade, não calcula plano financeiro).

| Estágio | Módulo | Saída |
|---|---|---|
| Intake | `sourceIntake.js` | `SourceAsset` imutável (sha256), varredura, autoridade, `IngestionBatch` |
| Parser | `parsers.js` | `ParsedSource` (registros com `recordRef`) |
| Discovery/Mapper | `mapping.js` | `DiscoveredSchema`, `FieldMappingSet` versionado |
| Normalizer | `mapping.js` (`normalizeRecords`) | valores + estado por campo + proveniência |
| Identidade | `canonical.js` | `LotDraft` com `canonicalLotId`, reconciliação |
| Geometria | `geometryIngest.js` | features, validação, vínculo, alinhamento, artefatos |
| Comercial | `commercialImport.js` | candidatos/diffs de preço e disponibilidade (comandos para os donos) |
| Validator | `quality.js` | `DataConflict`, checks, gate, `ReviewItem` |
| Publisher | `publication.js` | config, candidato, aprovação, ativação atômica, rollback, relatório |

Estados (`onboardingModel.js`, `MACHINES`): caso, batch, revisão, conflito, publicação e aprovação; transições inválidas são recusadas no servidor (`transition`). Estado `CANCELLED` é terminal.

## Fronteiras
- Tópico 61 (qualidade de dados) pluga regras via `quality.registerProvider()` — sem import cruzado.
- `backend/src/modules/imports` e `scripts/import.js` continuam intocados; o golden test prova que os IDs são os mesmos do `prepare()` existente.
- Nada publicado hoje muda: o onboarding só move o seu próprio ponteiro; quem grava em lotes/preço/disponibilidade é um `activator` injetado (ainda não existe).
- UI técnica: `onboardingView.js` (HTML escapado), nunca exibida ao visitante público.
