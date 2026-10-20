# Arquitetura de referência v1

Versão `1.0`, vigente a partir de 2026-10-11. Fonte máquina-legível: `config/governance/architecture.json` (ArchitectureManifest + regras de dependência). Esta versão consolida os tópicos 1–51 sem mudar regra de negócio: scores, classes, metodologia, preços (R$ 1.196/m², tabela 2026-10-06), regras financeiras e solares e IDs de lote ficam como estão.

## 1. Manifesto

```yaml
architecture:
  version: "1.0"
  style: { backend: "modular-monolith", frontend: "spa-pwa-map-centric (single-file build, global App namespace)" }
  api: { style: "REST", version: "v1", contract: "plat/backend/docs/openapi.json 1.3.0" }
  tenancy: { model: "shared-platform-tenant-scoped", status: "aplicação + FKs compostas; RLS planejado" }
  persistence: { relational: "PostgreSQL", geospatial: "PostGIS-optional (não usado: geometria em espaço de pixels da planta)", binary: "object-storage (decisão pendente)" }
  async: { domain_events: "in-process", durable_events: "outbox-when-needed (não implementado)", jobs: "worker (não implementado)" }
  analytics: { initial_store: "local no aparelho (desligado para envio)", warehouse: "adiado" }
  cache: { model: "multi-layer-version-aware (cache/cacheCore.js, 47 políticas)" }
  offline: { model: "explicit-offline-packs (tópico 49)" }
  security: { authorization: "server-side", tenancy: "server-authoritative", default: "deny" }
  observability: { model: "structured-logs-metrics-traces", interoperability: "OpenTelemetry-compatible (tópico 51)" }
```

## 2. Fluxo de valor

`EMPREENDIMENTO → MAPA → BUSCAR/FILTRAR → SELECIONAR LOTE → QUICKVIEW/FICHA → RECOMENDAR (cliente) → COMPARAR → SIMULAR → APRESENTAR/COMPARTILHAR`. Cada etapa tem um contexto dono (ver §4) e um golden (`tests/golden`).

## 3. Camadas e regra de dependência

| Camada | Pode usar | Proibido | Exemplos reais |
|---|---|---|---|
| domain | domain, shared, config, kernel | DOM, storage, rede, relógio implícito, UI | `domain/lot.js`, `domain/availability.js`, `intelligence/engine.js`, `filters/filters.js`, `compare/comparisonDomain.js`, `map/layers.js` |
| application | + infrastructure, application | DOM, rede direta | `services/*.js`, `quickview/quickview.js`, `presentation/viewmodels.js`, `state/*`, `*Services.js`, `security/authorization.js` |
| infrastructure | domain, shared, config | regra de negócio | `data/repositories.js`, `data/apiSource.js`, `data/offline.js`, `cache/*`, `loading/*`, `geo/repository.js` |
| presentation | tudo acima | mutar o Lote, escrever em repositório, storage, rede | `presentation/*View.js`, `presentation/map.js`, `customer/customerView.js` |
| composition | tudo | mutar o Lote | `presentation/app.js` |

Regras verificadas automaticamente: `ARCHITECTURE_FITNESS_FUNCTIONS.md`. Exceções atuais: `ARCHITECTURE_GAP_REPORT.md`.

## 4. Bounded contexts (donos)

| Contexto | Dono de | Fonte de verdade alvo |
|---|---|---|
| development | DevelopmentConfig, ativos, quadro do mapa, fontes | config versionada por empreendimento |
| lot | Lot canônico, Field Registry, ciclo de vida dos dados | API `/lots` (static/versioned) |
| availability | status comercial, frescor, transições | backend (espelho de vendas) — hoje `UNKNOWN` |
| pricing | PriceTableVersion, histórico | backend, versão publicada imutável |
| financial | simulação | serviço versionado pela tabela |
| analysis | metodologia, motor, scores, classes, rankings, alertas legados | AnalysisVersion imutável |
| recommendation | Fit, constraints, recomendação, explicação, reason codes | cálculo local sobre read models |
| filters | registro, compilação e execução de filtros | local |
| map | geometria, índice espacial, câmera, camadas, legenda | GeometryBundle versionado |
| comparison | sessão, snapshot, vencedor por critério | sessão local; snapshot para share |
| customer / journey / favorites | cliente, perfil, jornada, favoritos | backend tenant-scoped (pendente) |
| presentation-mode / share / navigation | apresentação client-safe, grants, deep links | snapshot + grant no servidor (pendente) |
| provenance / confidence / data-state / documents | proveniência por atributo, confiança, estados de dado, documentos | backend + object storage (pendente) |
| security | organização, permissões, autorização (guards no cliente) | servidor (deny by default) |
| cache / loading / pwa | cópias derivadas e orquestração de carga | nunca fonte de verdade |
| analytics / observability | eventos de produto (local) e telemetria técnica | separados (tópicos 44/45/51) |

## 5. Decisões de referência

- **Backend**: monolito modular (já é a forma de `plat/backend/src/modules/*`). Extração só por gatilho medido (tópico 52 §310): carga de documentos, worker de análise. Sem microservices, Kafka, Redis ou Rabbit sem necessidade demonstrada.
- **Banco**: PostgreSQL único, schema por módulo lógico; tabela de outro módulo não é tocada diretamente (exceção = ADR).
- **API**: REST v1 por recurso/caso de uso; DTOs versionados; erro com código estável (`backend/docs/API_ERRORS.md`).
- **Cliente**: SPA de página única enquanto o custo de dividir o bundle não se pagar (decisão D-HOSTING em aberto); UI não lê JSON bruto (repositórios), não chama `fetch` espalhado, não decide segurança.
- **Offline**: pacotes explícitos; o último estado conhecido é rotulado.
- **Cache**: políticas por tipo de recurso, chaves com versão e partição de tenant; dados de cliente só em memória.
- **Eventos**: eventos de domínio em processo; outbox apenas quando houver integração externa.
- **Segurança**: autorização final no servidor; o cliente só esconde o que o servidor negaria.
- **Documentos**: Document ≠ FileAsset; caminho de storage não é ACL.

## 6. Estágios de escala

Estágio 1 (agora): 1 organização, 1 empreendimento, 498 lotes, monolito, banco único. Estágio 2: várias organizações/empreendimentos, workers, CDN. Estágio 3 só sob demanda medida. Nenhuma implementação especulativa de estágio 3.

## 7. Anti-padrões proibidos

God component/service, JSON bruto espalhado, localStorage como banco, regra de negócio na UI, checagem de papel espalhada, tenant vindo de query param como autoridade, disponibilidade inferida de preço, saída analítica mutável, chamada de provedor no domínio, catch-and-ignore, limpeza global de cache, bootstrap gigante, endpoint por campo, endpoint "tudo", microservices sem necessidade, "helpers" com regra de negócio, explosão de booleanos de status, DTO de 70 campos em todo lugar, fórmula duplicada, fallback silencioso de versão/disponibilidade/preço/segurança/tenant.

## 8. Checklist de revisão de arquitetura (toda mudança significativa)

Qual contexto? Quem é dono do dado? Fonte de verdade? Versionado ou dinâmico? Escopo de tenant? Permissão? API? Política de cache? Comportamento offline? Auditoria? Analytics? Observabilidade? Classe de segurança? Testes (golden, arquitetura)? Precisa de ADR?
