# Relatório — Tópico 45: Event tracking / instrumentação

## Entregue
- `config/analytics/events.json`: catálogo de 85 eventos versionados + 46 nomes legados mapeados (renomear, entidade, mapa de valores, descarte de campos).
- `config/analytics/policy.json`: consentimento, sessão (30 min), relógio, limites de payload (4 KB), buffer, retry, privacidade, destinos, decisões D1–D8.
- `src/analytics/registry.js`: schema registry, validação, transformador legado, contratos, geração de tipos TS, docs e fixtures.
- `src/analytics/privacy.js`: chaves proibidas/reservadas, detectores (telefone, e-mail, CPF, token, URL), redação, UTM, consentimento, payload de fornecedor.
- `src/analytics/client.js`: AnalyticsClient (envelope, eventId, occurredAt ≠ capturedAt, sessão, identidade User ≠ Customer, dedupe, amostragem determinística, buffer por organização com despejo por prioridade, fila com lote/retry/backoff, offline, transports HTTP/Teste/Console, destinos, quarentena sem valores, saúde e autodiagnóstico) e Domain Event Analytics Bridge.
- `src/analytics/facade.js`: `App.analytics.track(evt, data)` compatível (inclusive sem bind), `log` mantido.
- Teste de inventário: nenhum ponto do código usa nome de evento não registrado.
- Documentos: EVENT_TRACKING_ARCHITECTURE, ANALYTICS_EVENT_ENVELOPE, _EVENT_SCHEMA_REGISTRY, _IDENTITY_AND_SESSION_POLICY, _PRIVACY_AND_CONSENT_POLICY, _TRANSPORT_RETRY_OFFLINE, _DESTINATION_MAPPING, _INGESTION_AND_DEDUPLICATION, _EVENT_HEALTH_AND_QUARANTINE, LEGACY_TRACKING_MIGRATION_REPORT, EVENT_TRACKING_TEST_MATRIX, ANALYTICS_EVENT_CATALOG e ANALYTICS_EVENT_TYPES.d.ts (gerados).

## Política padrão
- **Nada sai do aparelho.** Só `LOCAL_BUFFER` ligado. Ingestão first-party, GA e Meta desligados; o mapeamento existe só para quando um humano decidir.
- Consentimento UNKNOWN = captura só local; DENIED = não captura e apaga dados locais.
- Sem PII, sem preço de lote, sem campos de cliente, sem URL completa em eventos.

## Diferido
- Ingestão no backend, armazenamento bruto, dedupe no servidor (contrato em ANALYTICS_INGESTION_AND_DEDUPLICATION.md).
- Persistência em IndexedDB (implementada, desligada — D4).
- ID anônimo persistente (D5), retenção (D7), permissões `analytics.*` (D6).
- UI de consentimento; ligar `syncDomainEvents`/`attachFavorites` e o painel técnico na UI (fora da minha área).

## Decisões humanas abertas
D1 base legal da captura local · D2 ingestão first-party · D3 GA/Meta · D4 IndexedDB · D5 ID anônimo persistente · D6 permissões analytics · D7 retenção · D8 validação das métricas comerciais.

## Testes
`tests/analytics.test.js`: 34 testes (tópicos 44 e 45). Suíte completa: 871/871.
