# Taxonomia de eventos

Seis tipos de evento, com donos, armazenamento e regras diferentes. Misturá-los é proibido (invariante 15).

| Tipo | Para que serve | Onde existe hoje | Quem emite | Destino | PII |
|---|---|---|---|---|---|
| **Domain Event** | fato de negócio dentro de um contexto (ex.: disponibilidade mudou, alerta reabriu, etapa da jornada mudou) | `domain/availability.js` (`eventsOf`, `ChangeFlag`, `diff`), `journey/journeyDomain.js` (JourneyEvent append-only), `rules/alertDomain.js` (ciclo do AlertInstance), `cache/cacheCore.js` (`InvalidationEvent`: AvailabilityRevisionPublished, PriceTableActivated, AnalysisVersionActivated, …), `LotRepository.subscribe` | módulo de domínio dono | em processo (callbacks); outbox quando houver consumidor externo | só referências (ids) |
| **Integration Event** | contrato para sistemas externos (CRM, loteadora) | nenhum ainda | backend via outbox | fila/webhook (não implementado) | mínimo, contratado |
| **Analytics Event** | comportamento de produto (funis, uso) | `analytics/registry.js` + `config/analytics/events.json`: 85 eventos (NAVIGATION 7, MAP 9, FILTERS 8, RECOMMENDATION 8, COMPARISON 8, LAYOUT 7, FAVORITES 3, CUSTOMER_JOURNEY 4, PRESENTATION 10, SHARE 7, FINANCIAL 3, SEARCH 4, TECHNICAL 7); `App.analytics.track` | `analytics/client.js` (envelope, dedupe, privacidade) | **somente local**; envio desligado (D-ANALYTICS-LEGAL) | proibida (`analytics/privacy.js` bloqueia nome, telefone, e-mail, CPF, notas, preço de cliente) |
| **Audit Event** | quem fez o quê, com que permissão | `security/authorization.js` (AuditLogService, local), backend `audit_log` (`shared/db/audit.repository.js`) | serviço de aplicação/autorização | store de auditoria (append-only) | identificador do ator, nunca conteúdo |
| **Security Event** | negação, token inválido, violação de política | `security/authorization.js` (securityEvents); tópicos 50/51 em andamento (`security/hardening.js`, `observability/*`) | camada de segurança | observabilidade/segurança | sem segredo, sem token |
| **Operational Telemetry** | desempenho e saúde | `geo/perf.js` (marks `map_first_render`, `map_geometry_decode`, `map_index_build`, `map_layer_switch`), backend `shared/logging/logger.js`; tópico 51 | infraestrutura | backend de observabilidade (separado do banco de produto) | nenhuma |

## Regras

- Um evento de analytics não serve de auditoria; uma auditoria não alimenta funil; telemetria não carrega dado de negócio de cliente.
- Domain events não mudam a verdade de outro contexto por si: o consumidor decide (ex.: InvalidationEvent invalida cache, não altera preço).
- Payload de evento referencia ids e versões; nunca o Lote inteiro, nunca PII.
- Event bus distribuído, Kafka ou fila só com necessidade demonstrada (tópico 52 §88/§94). Hoje: callbacks em processo bastam para 498 lotes.
- `OutboxEvent` (quando necessário): `{ id, aggregateType, aggregateId, eventType, payloadVersion, payload, organizationId, createdAt, publishedAt, attempts }` gravado na mesma transação do agregado.
