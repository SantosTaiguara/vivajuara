# Modelo de etapas e transições (Tópico 40)

## Modelo V1 (`config/journey/policy.json → stageModels`)

Não havia pipeline comercial no código; o V1 é o **template técnico do spec (§44)**, publicado e marcado `requiresHumanValidation: true`. A organização pode trocá-lo por um modelo próprio (nova versão).

| Ordem | Código | Título | Categoria |
|---|---|---|---|
| 0 | NEW | Novo | NEW |
| 1 | CONTACTED | Contato feito | ENGAGEMENT |
| 2 | QUALIFYING | Qualificando | QUALIFICATION |
| 3 | PROFILED | Perfil levantado | DISCOVERY |
| 4 | RECOMMENDING | Opções em preparo | RECOMMENDATION |
| 5 | SHORTLISTED | Opções selecionadas | SHORTLIST |
| 6 | VISIT_PLANNED | Visita agendada | VISIT |
| 7 | VISITED | Visitou | VISIT |
| 8 | NEGOTIATING | Negociação | NEGOTIATION |
| 9 | PROPOSAL | Proposta | PROPOSAL |
| 10 | RESERVATION | Reserva em andamento | RESERVATION |
| 11 | CLOSED_WON | Fechado (ganho) | WON (terminal) |
| 12 | CLOSED_LOST | Encerrado (perdido) | LOST (terminal) |

## Grafo de transições (88 definições)

- próxima etapa: livre;
- pular uma etapa: exige motivo;
- voltar a qualquer etapa anterior: exige motivo;
- qualquer etapa aberta → CLOSED_LOST: `journey.close` + resultado (motivo de perda);
- NEGOTIATING/PROPOSAL/RESERVATION → CLOSED_WON: `journey.close` + resultado;
- fora do grafo: só com override (`journey.overrideTransition` + motivo de `overrideReasons`), auditado (`JourneyStageOverride`).

Etapa terminal só pelo `closeOutcome` (`OUTCOME_REQUIRED` se tentado direto). Revisão esperada obrigatória (`JOURNEY_REVISION_CONFLICT`); sem last-write-wins. Offline: transição e resultado bloqueados (`OFFLINE_NOT_ALLOWED`).

## Governança

`draftFrom(published)` → DRAFT V(n+1); `editDraft` recusa publicado (`STAGE_MODEL_IMMUTABLE`); `validateStageModel`; `publish` congela e calcula checksum; `impactReport(old, new, journeys)` (etapas/transições adicionadas/removidas, semântica terminal, jornadas a migrar, etapas não mapeáveis, `autoMigration: false`); `migrationPlan(old, new, map)` exige revisão; `applyMigrationPlan` só com aprovação, gerando transição `STAGE_MODEL_MIGRATION`. Jornada guarda `stageModelVersionId` e nunca mistura ids de versões diferentes (`STAGE_MODEL_MISMATCH`).

## Sugestões e automação

Eventos podem sugerir etapa (`JourneyStageSuggestion` PENDING, só para frente). `automationPolicy.allowAutoStageTransition = false`: nada se move sozinho. Aceitar sugestão = transição normal (`SUGGESTION_ACCEPTED`). Kanban (`board`) é projeção; mover card chama `stage.transition`; `allowedMoves` lista as opções.
