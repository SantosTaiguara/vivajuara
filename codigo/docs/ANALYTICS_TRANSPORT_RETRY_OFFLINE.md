# Transporte, retry e offline

## Buffer
Memória primeiro. `LOCAL_BUFFER` (o que a camada semântica lê) até 2000 eventos por organização; fila remota (`outbox`) até 500. Pressão de memória despeja `LOW → NORMAL → HIGH → CRITICAL`, sempre o mais antigo da menor prioridade, contando `LOCAL_BUFFER_OVERFLOW`/`OUTBOX_OVERFLOW` e marcando `truncatedBefore` (a métrica fica `INCOMPLETE`). `localStorage` nunca é fila.

## Lotes
`flush()` agrupa por organização e destino: até 25 eventos e 64 KB por lote. Assíncrono, nunca bloqueia a UI; um flush por vez.

## Retry (`policy.retry`)
`maxAttempts 5`, `initialDelayMs 1000`, `backoffMultiplier 2`, `maxDelayMs 60000`, jitter. Repete em rede/429/5xx; **400 não repete** (vai para quarentena `SERVER_REJECTED`); rejeição parcial respeitada por evento; tentativas esgotadas → descartado e contado (`RETRY_EXHAUSTED`). Entrega **at-least-once** + dedupe no servidor; nunca “exactly-once”.

## Offline
`setOnline(false)` pausa; `setOnline(true)` dispara flush. Persistência opcional (`buffer.persistOffline`, desligada — D4) via `idbPersistence(indexedDB)`; `restore(org)` descarta o que passou de `maxOfflineAgeSeconds` (7 dias, contado `OFFLINE_EXPIRED`).

## Transports
`createHttpTransport({ fetch, endpoint: '/api/v1/analytics/events' })` (só construído quando D2 ligar o destino), `createTestTransport(script)`, `createDevConsoleTransport()` (fora de produção). `sendBeacon` não é usado: eventos críticos são do servidor.
