# Política de importação de disponibilidade

> Tópico 58 — Onboarding de empreendimentos / pipeline de ingestão. Código: `src/onboarding/*`, política `src/config/onboarding/onboardingPolicy.js`, backend `backend/src/modules/onboarding/*`, migration 012. Valores de política ainda não decididos ficam `null` com status **necessita confirmação** e o código aplica a leitura mais restritiva.

- Status externos só viram canônicos via `StatusMapping` aprovado; mapa padrão vazio (`availabilityStatusMappings: []`).
- Status desconhecido (ex.: "PRÉ-RESERVA") → `AVAILABILITY_STATUS_UNKNOWN` BLOCKING + revisão; nunca adivinhado.
- Nulo → `UNKNOWN`; **UNKNOWN nunca é AVAILABLE**. Hoje os 498 lotes estão `UNKNOWN` e assim permanecem.
- `availabilityCommand`: `SEED_INITIAL_REVISION` ou `APPLY_INCREMENTAL_REVISION`, `bypassesStateMachine: false` (passa pela máquina de estados do domínio de disponibilidade).
- Rollback de publicação **não** reverte disponibilidade (`NO_AUTOMATIC_ROLLBACK`).
