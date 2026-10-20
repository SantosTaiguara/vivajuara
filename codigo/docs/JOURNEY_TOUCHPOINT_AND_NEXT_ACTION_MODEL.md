# Touchpoints, próxima ação e atenção (Tópico 40)

## Touchpoint

`{ id, journeyId, type CONTACT_ATTEMPT|CONVERSATION|MEETING|VISIT|FOLLOW_UP|OTHER, direction INBOUND|OUTBOUND|MUTUAL, channel WHATSAPP|PHONE|EMAIL|IN_PERSON|VIDEO|WEB|CRM|OTHER, occurredAt, actorUserId, externalRef?, outcomeCode?, summary?, visibility }`.
Sem conversa bruta (chaves `message`/`body`/`transcript`… recusadas), resumo ≤ 280 caracteres sem dados de contato, `outcomeCode` do registro (`INTERESTED`, `NOT_INTERESTED`, `NO_ANSWER`, `CALL_BACK`, `SCHEDULED`, `INFORMATION_SENT`, `OTHER`). CONVERSATION/MEETING → `CUSTOMER_CONTACTED`; VISIT → `VISIT_COMPLETED`; tentativa sem resposta não vira "contatado".

## JourneyNextAction

Tipos: CONTACT, FOLLOW_UP, COMPLETE_PROFILE, PREPARE_RECOMMENDATION, PRESENT_OPTIONS, SCHEDULE_VISIT, FOLLOW_UP_VISIT, PREPARE_SIMULATION, REQUEST_DOCUMENT, FOLLOW_UP_PROPOSAL, WAIT_CUSTOMER, OTHER. Status persistido: OPEN, COMPLETED, CANCELLED (com `recordRevision`). `readState` derivado: OPEN, DUE_SOON (≤ 24 h), OVERDUE (vencida), COMPLETED, CANCELLED — OVERDUE nunca é gravado. `currentNextActionId` aponta para a principal. Não envia lembrete nem notificação.

## Sugestões

`JourneyActionSuggestion` (PENDING/ACCEPTED/DISMISSED/EXPIRED) vinda do registro de eventos (ex.: após visita, follow-up em 1 dia). `followUpPolicy.createAutomatically = false`: só vira ação quando aceita.

## Atenção (`attention`)

PAUSED/CLOSED pelo lifecycle; sem próxima ação → UNKNOWN; vencida → OVERDUE; vence em breve → ACTION_DUE; `WAIT_CUSTOMER` → WAITING_CUSTOMER; senão ON_TRACK. `agingPolicies` por etapa (NEW 24/72 h desde último evento significativo; CONTACTED 72/168 h e VISITED 48/120 h desde último toque do cliente; NEGOTIATING pelo vencimento da ação) — prazos ilustrativos a validar; crítico eleva ON_TRACK/UNKNOWN para ACTION_DUE. Regras de alerta ficam com o tópico 36.

## Pausa e resultado

`pause` exige motivo (`pauseReasons`), preserva etapa; `resume` volta ao ACTIVE na mesma etapa. `closeOutcome`: WON/LOST explícito por usuário (`EXPLICIT_ACTOR_REQUIRED`), LOST exige motivo do registro (PRICE, PAYMENT_TERMS, LOT_SIZE, LOCATION, TIMING, NO_RESPONSE, CHANGED_PLAN, BOUGHT_ELSEWHERE, FINANCING, NO_SUITABLE_LOT, COMMERCIAL_CONDITION, OTHER, UNKNOWN); WON pode referenciar reserva/venda (a reserva continua a fonte autoritativa; disponibilidade nunca é alterada). Sem registro de motivo de ganho (não há necessidade de negócio).
