# Política de logs estruturados

`createLogger({ service, component, sinks, environment })` produz `StructuredLogEvent`:

`timestamp (UTC ISO), level, eventCode, registered, message, service, component, environment, appVersion, buildId, organizationId, developmentId, requestId, correlationId, traceId, spanId, routeCode, errorCode, metadata`.

## Regras

- `eventCode` é máquina e estável; `message` é humana. A lógica nunca lê `message`. Os 30 códigos ficam em `registry.logEvents` (ex.: `API_REQUEST_FAILED`, `CACHE_CORRUPT_ENTRY`, `MAP_GEOMETRY_LOAD_FAILED`, `PWA_SYNC_CONFLICT`, `PRICE_TABLE_PUBLISH_FAILED`, `AVAILABILITY_REVISION_CONFLICT`, `DOCUMENT_SCAN_FAILED`). Código fora do registro é registrado com `registered: false` e contado.
- Níveis: DEBUG (desenvolvimento ou diagnóstico temporário), INFO (operação normal relevante), WARN (anomalia recuperável), ERROR (operação falhou), FATAL (componente não continua). Nem tudo é ERROR.
- Nível mínimo por ambiente: development DEBUG; staging e production INFO.
- Amostragem de INFO configurável (`infoSampleRate`, hoje 1). ERROR/FATAL nunca são amostrados.
- Console só em development (`consoleOutput`), sempre com o evento já redigido. Produção não escreve no console.
- Corpo de requisição/resposta não é logado por padrão: as chaves `body`, `requestBody`, `responseBody` são bloqueadas.
- Buffer local de 300 eventos; cheio, descarta primeiro DEBUG, depois INFO (teste "bounded buffers").
- Falha de sink nunca chega ao chamador (contada em `telemetry.exportFailures`).

## Acesso

- Sucesso de requisição em INFO: o servidor já registra um log `request` por requisição (`backend/src/app.js`). Recomendação: manter como access log em camada própria e medir com métricas RED, não como log de aplicação (§25).
