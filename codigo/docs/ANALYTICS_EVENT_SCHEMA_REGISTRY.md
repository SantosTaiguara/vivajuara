# Schema Registry de eventos

Fonte única: `config/analytics/events.json` (empacotado em `App.configs.analytics.events`). Dela saem:
- o validador usado pelo cliente (`registry.validatePayload`);
- os tipos TypeScript (`docs/ANALYTICS_EVENT_TYPES.d.ts`, via `registry.generateTypes()`);
- a documentação (`docs/ANALYTICS_EVENT_CATALOG.md`, via `registry.generateDocs()`);
- fixtures mínimas por evento (`registry.fixture(nome)`).
`node scripts/analyticsDocs.js` regenera; o teste falha se os arquivos estiverem desatualizados.

## AnalyticsEventDefinition
`name`, `version`, `category`, `eventClass` (PRODUCT | TECHNICAL_TELEMETRY), `description`, `owner`, `triggerSemantics`, `entityType`, `requiredProperties`/`optionalProperties` (AnalyticsPropertyDefinition: `type` STRING/NUMBER/BOOLEAN/ENUM/ID/TIMESTAMP/ARRAY, `required`, `enumValues`, `piiClass`, `maxLength`, `allowNull`, `format` code/path, `min`/`max`, `maxItems`), `privacyClass`, `consentRequirement`, `producerPolicyRef` (CLIENT/SERVER/DOMAIN_BRIDGE/HYBRID) + `sources`, `deduplication`, `sampling`, `priority`, `purposes` (métricas do tópico 44), `destinations`, `status` (DRAFT → VALIDATED → PUBLISHED → DEPRECATED).

## Validação do payload
- **Produtor canônico (estrito):** qualquer problema rejeita → quarentena.
- **Fachada legada** (`App.analytics.track`): propriedade opcional inválida/desconhecida/proibida é removida com aviso registrado (`propertiesDropped`); obrigatória ausente/inválida rejeita.
- `format: code` normaliza para `[A-Za-z0-9_.:-]{1,64}` (ex.: `HTTP 500` → `HTTP_500`) **depois** de passar pelos detectores de PII.
- `format: path` recusa esquema/URL e corta `?`/`#`.
- Chaves reservadas (`organizationId`, `userId`, `tenant`, `session`, `eventId`…) nunca são aceitas no payload.

## Testes de contrato (`registry.contractErrors`)
Nomes únicos e `snake_case` semântico, nomes proibidos (`click`, `action`, `map_pan`…), versões 1..n sem buracos, metadados obrigatórios, propriedades proibidas por privacidade, PII proibida em evento de produto, evento só-servidor sem `WEB_CLIENT`, amostragem proibida em HIGH/CRITICAL, destinos conhecidos, telemetria só local, inventário legado apontando para eventos existentes e produzíveis pelo navegador, `purposes` referenciando métricas reais.

## Ciclo de vida e depreciação
Em produção o cliente só emite `PUBLISHED` (e `DEPRECATED` durante a transição); `DRAFT`/`VALIDATED` → quarentena `NOT_PUBLISHED`. Mudança incompatível = nova versão (`version + 1`); o produtor fixa a versão com `ctx.version`; versão inexistente → `UNSUPPORTED_VERSION`.
