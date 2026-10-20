# Modelo de conectividade (ConnectivityService)

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

`ConnectivityState = { browserHint, backendReachability, effectiveState, lastSuccessfulBackendContactAt }`.

| effectiveState | Significado | Texto |
|---|---|---|
| ONLINE | backend respondeu de fato | Online |
| DEGRADED | navegador diz online, requisições falham | Conexão instável |
| OFFLINE | sem conectividade útil | Offline |
| UNKNOWN | nenhuma resposta ainda | Verificando conexão |
| (SYNCING) | indicador com fila sincronizando | Sincronizando |

## Política (ConnectivityPolicy)
`{"failuresBeforeDegraded":2,"failuresBeforeOffline":4,"successesBeforeOnline":1,"probeBackoffMs":[5000,15000,60000,300000],"probeTimeoutMs":5000,"foregroundProbeAfterMs":60000,"freshContactMs":30000}`
- Histerese (§308): uma falha isolada não muda a UI; 2 falhas seguidas → DEGRADED; 4 → OFFLINE.
- Evento `offline` do navegador acelera para OFFLINE; a volta a ONLINE só com sonda/requisição bem-sucedida (§310): OFFLINE → DEGRADED → ONLINE.
- Sonda: HEAD `manifest.json` com `no-store` (o worker não intercepta). Com backend: `/api/v1/health/connectivity`.
- Gatilhos: reconexão, primeiro plano após 60 s, ação crítica (`ensureOnline()`), e só em DEGRADED/OFFLINE com o navegador online, intervalo crescente 5 s → 15 s → 60 s → 5 min. Nunca polling em ONLINE.
- O sinal bruto do tópico 10 (`App.offline.Connectivity`) alimenta o serviço via `onReport` (adição mínima em data/offline.js).
