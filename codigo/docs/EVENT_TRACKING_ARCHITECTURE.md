# Arquitetura de Event Tracking (tópico 45)

**Princípio:** o rastreamento registra *qual evento ocorreu, quando, para qual entidade, em que contexto, por qual ator/sessão, segundo qual contrato e com qual política de privacidade*. Não decide estado de negócio, não é fonte operacional e não calcula KPI (isso é do tópico 44).

## Separações
| Tipo | Onde vive | Exemplo |
|---|---|---|
| Evento de domínio | módulos de domínio (`presentationmode`, `favorites`, `journey`, `share`) | `PresentationStarted`, `FavoriteAdded` |
| Evento de produto/analytics | `App.eventTracking` (buffer local) | `lot_selected`, `presentation_started` |
| Telemetria técnica | mesmo cliente, `eventClass = TECHNICAL_TELEMETRY`, só `LOCAL_BUFFER` | `cache_hit`, `sync_failed` |
| Auditoria | `App.authz.audit` | `PresentationStarted` (audit) |
| Evento de segurança | `App.authz.securityEvent` | `AUTHZ_DENIED` |
| Autodiagnóstico do rastreador | `client.diagnostics()` | `analytics_transport_failure`, `analytics_buffer_overflow`, `analytics_schema_rejection` |
| Marketing (terceiros) | só mapeamento central, destino desligado | GA/Meta |

## Módulos
| Arquivo | Global | Papel |
|---|---|---|
| `src/analytics/registry.js` | `App.eventTracking.registry` | catálogo, schema registry, validação de payload, inventário legado, geradores (tipos TS, docs, fixtures), testes de contrato |
| `src/analytics/privacy.js` | `App.eventTracking.privacy` | chaves proibidas/reservadas, detectores de valor, redação DROP/BUCKET/HASH/ALLOW, UTM, política de consentimento, payload de terceiros |
| `src/analytics/client.js` | `App.eventTracking.createClient`, `createBridge`, transports | AnalyticsClient, ContextProvider, envelope, dedupe, amostragem, buffer, fila, retry, offline, destinos, quarentena, saúde, Domain Bridge |
| `src/analytics/semantic.js` | `App.semanticLayer` | camada semântica (tópico 44) |
| `src/analytics/metricsView.js` | `App.metricsView` | visão “Métricas locais” (modo Técnico) |
| `src/analytics/facade.js` | `App.analytics` | fachada compatível com `App.analytics.track(evt, data)` |
| `config/analytics/events.json`, `policy.json`, `metrics.json` | `App.configs.analytics` | fonte única (empacotada por `scripts/configBundle.js`) |

## Fluxo de captura
```
ação semântica (handler / serviço / Domain Bridge)
  → client.track(nome, payload, ctx)            (síncrono, barato, nunca lança)
  → registro: conhecido? versão? PUBLISHED? fonte permitida (WEB_CLIENT/SERVER/DOMAIN_BRIDGE…)?
  → tenant: organização do contexto; ctx.organizationId diferente → TENANT_MISMATCH
  → consentimento (política) → NOT_CAPTURED se recusado
  → transformador legado (se veio de App.analytics.track) → validação de schema + privacidade
  → ContextProvider → envelope (eventId, occurredAt ≠ capturedAt, schemaVersion)
  → relógio (futuro > 5 min → quarentena; > 7 dias → expirado) → tamanho (≤ 4 KB)
  → dedupe → amostragem → LOCAL_BUFFER (memória, por organização, despejo por prioridade)
  → fila remota SOMENTE se destino ligado E consentimento GRANTED (hoje: nunca)
```
Eventos inválidos vão para a **quarentena** com motivo; nada é descartado em silêncio e o valor ofensivo nunca é guardado.

## Estado padrão (seguro)
Nada sai do aparelho: `FIRST_PARTY_INGESTION`, `GOOGLE_ANALYTICS`, `META_PIXEL`, `CUSTOM_WAREHOUSE` e `DEBUG` estão desligados (decisões D2/D3). Nenhum SDK de terceiro é carregado; não existe `gtag`/`fbq` no código (teste).

## Integração com o tópico 44
Tópico 45 entrega envelopes; o tópico 44 (`App.semanticLayer`) transforma em métricas. O rastreador não calcula KPI.
